//! データベースの持ち方と、裏で動く仕事（フォルダの読み込み・ハッシュの計算）。
//!
//! - 読み込み（`scan::walk`）とハッシュの計算はロックを持たずに行い、結果を書くときだけロックする。
//!   共有ドライブで時間がかかっても、そのあいだ一覧の表示を止めないため
//! - 変わったら `files-changed` を、読み込みの始まりと終わりに `scan-state` を画面へ送る

use crate::{db, scan};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub const FILES_CHANGED: &str = "files-changed";
pub const SCAN_STATE: &str = "scan-state";

#[derive(Default)]
pub struct Library {
    conn: Mutex<Option<Connection>>,
    scanning: AtomicBool,
    /// 読み込みの途中で、もう一度読むように頼まれた（登録が続いたときなど）
    rescan_again: AtomicBool,
    hashing: AtomicBool,
}

pub type Shared = Arc<Library>;

impl Library {
    pub fn with<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|e| e.to_string())?;
        let conn = guard.as_mut().ok_or("データベースを開けていません")?;
        f(conn).map_err(|e| e.to_string())
    }

    pub fn scanning(&self) -> bool {
        self.scanning.load(Ordering::SeqCst)
    }
}

/// 起動時：データベースを開き、登録フォルダを読み直す（docs/CONCEPT.md「照合」：開いたときに照合する）。
pub fn start(app: &AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = db::open(&dir.join("bindery.db")).map_err(|e| e.to_string())?;
    let lib = app.state::<Shared>();
    *lib.conn.lock().map_err(|e| e.to_string())? = Some(conn);
    rescan(app);
    Ok(())
}

/// すべての登録フォルダを裏で読み直す。読んでいる途中なら、終わったあとにもう一度読む。
pub fn rescan(app: &AppHandle) {
    let lib = app.state::<Shared>().inner().clone();
    if lib.scanning.swap(true, Ordering::SeqCst) {
        lib.rescan_again.store(true, Ordering::SeqCst);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = app.emit(SCAN_STATE, true);
        loop {
            lib.rescan_again.store(false, Ordering::SeqCst);
            scan_all(&app, &lib);
            if !lib.rescan_again.load(Ordering::SeqCst) {
                break;
            }
        }
        lib.scanning.store(false, Ordering::SeqCst);
        let _ = app.emit(SCAN_STATE, false);
        hash_in_background(&app);
    });
}

fn scan_all(app: &AppHandle, lib: &Library) {
    let roots = match lib.with(|c| db::list_roots(c)) {
        Ok(r) => r,
        Err(e) => {
            log::error!("scan: {e}");
            return;
        }
    };
    for root in roots {
        let path = PathBuf::from(&root.path);
        // つながっていないドライブ・共有を読むと、中のファイルが全部行方不明になってしまう。
        // フォルダそのものが見えないときは、そのフォルダは読まずに前のままにしておく。
        if !path.is_dir() {
            log::warn!("scan: not reachable, kept as is: {}", root.path);
            continue;
        }
        let started = std::time::Instant::now();
        let found = scan::walk(&path, root.recursive);
        let n = found.len();
        if let Err(e) = lib.with(|c| scan::apply(c, root.id, found)) {
            log::error!("scan {}: {e}", root.path);
            continue;
        }
        log::info!("scan {}: {n} files in {:?}", root.path, started.elapsed());
        let _ = app.emit(FILES_CHANGED, ());
    }
}

/// ハッシュがまだ無いファイルを、1 件ずつ裏で計算する（docs/CONCEPT.md「照合」の 3）。
fn hash_in_background(app: &AppHandle) {
    let lib = app.state::<Shared>().inner().clone();
    if lib.hashing.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // 読み込みが始まったら譲る（読み込みが終わればまた呼ばれる）
            if lib.scanning() {
                break;
            }
            let next = match lib.with(|c| scan::next_unhashed(c)) {
                Ok(Some(n)) => n,
                Ok(None) => break,
                Err(e) => {
                    log::error!("hash: {e}");
                    break;
                }
            };
            let (id, path) = next;
            let hash = match scan::hash_file(&path) {
                Ok(h) => Some(h),
                Err(e) => {
                    log::warn!("hash {}: {e}", path.display());
                    None
                }
            };
            match lib.with(|c| scan::record_hash(c, id, hash.as_deref())) {
                Ok(true) => {
                    log::info!("reconnected by hash: {}", path.display());
                    let _ = app.emit(FILES_CHANGED, ());
                }
                Ok(false) => {}
                Err(e) => {
                    log::error!("hash: {e}");
                    break;
                }
            }
        }
        lib.hashing.store(false, Ordering::SeqCst);
    });
}

/// 登録できるフォルダか。同じファイルが 2 つの登録フォルダに入ってしまうものは断る：
/// サブフォルダまで読む登録フォルダの中と、サブフォルダまで読むときに、登録したフォルダを含むもの。
/// 直下だけ読むフォルダとは重ならないので、その中のフォルダや、それを直下だけで含むフォルダは登録できる。
pub fn check_new_root(path: &Path, recursive: bool, existing: &[db::Root]) -> Result<(), String> {
    if !path.is_dir() {
        return Err(format!("フォルダが見つかりません：{}", path.display()));
    }
    for r in existing {
        let other = Path::new(&r.path);
        if path == other {
            return Err(format!("「{}」はもう登録してあります", r.name));
        }
        if r.recursive && path.starts_with(other) {
            return Err(format!("登録したフォルダ「{}」の中にあります", r.name));
        }
        if recursive && other.starts_with(path) {
            return Err(format!(
                "登録したフォルダ「{}」を含んでいます。先にそちらを外してください",
                r.name
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(path: &str) -> db::Root {
        db::Root {
            id: 1,
            path: path.into(),
            name: Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into(),
            count: 0,
            missing: 0,
            recursive: true,
            dirs: Vec::new(),
        }
    }

    #[test]
    fn refuses_nested_roots() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = a.join("b");
        std::fs::create_dir_all(&b).unwrap();
        let have_a = [root(&a.to_string_lossy())];
        assert!(check_new_root(&a, true, &have_a).is_err());
        assert!(check_new_root(&b, true, &have_a).is_err());
        let have_b = [root(&b.to_string_lossy())];
        assert!(check_new_root(&a, true, &have_b).is_err());
        assert!(check_new_root(dir.path(), true, &[]).is_ok());
        assert!(check_new_root(&dir.path().join("none"), true, &[]).is_err());
    }

    #[test]
    fn a_folder_read_without_subfolders_does_not_overlap() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = a.join("b");
        std::fs::create_dir_all(&b).unwrap();
        // a を直下だけで登録していれば、b は登録できる
        let mut flat_a = root(&a.to_string_lossy());
        flat_a.recursive = false;
        assert!(check_new_root(&b, true, &[flat_a.clone()]).is_ok());
        assert!(check_new_root(&a, false, &[flat_a]).is_err());
        // b を登録していても、a を直下だけでなら登録できる
        let have_b = [root(&b.to_string_lossy())];
        assert!(check_new_root(&a, false, &have_b).is_ok());
    }
}
