//! 登録フォルダを読んで、ファイルの記録を今の状態に合わせる（照合）。
//! 元のファイルは読むだけ（docs/CONCEPT.md「照合」）。
//!
//! 照合の順：
//! 1. 覚えているパスにある → そのまま（大きさ・更新日時が変わっていればハッシュを捨てる）
//! 2. 無い → 新しく見つかったファイルのうち、ファイル ID が同じものを同じファイルとみなす
//! 3. それも無い → 行方不明にする。あとでハッシュを計算したとき（`hash_one`）、
//!    大きさとハッシュが同じ新しいファイルが見つかれば、つなぎ直す
//!
//! 行方不明の行は消さない（あとでタグ・メモが付くようになっても失わないため）。

use crate::db;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 扱う種類（拡張子は小文字）。docs/CONCEPT.md「扱う種類」。
pub fn kind_of(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "pdf" => "pdf",
        "doc" | "docx" | "rtf" | "odt" => "word",
        "xls" | "xlsx" | "xlsm" | "ods" => "excel",
        "ppt" | "pptx" | "odp" => "powerpoint",
        "txt" | "md" | "markdown" | "csv" | "tsv" => "text",
        _ => return None,
    })
}

/// 読まない名前。隠しファイル・Office の一時ファイル（`~$`）・システムのフォルダ。
fn skipped(name: &str) -> bool {
    name.starts_with('.')
        || name.starts_with("~$")
        || matches!(
            name,
            "node_modules" | "$RECYCLE.BIN" | "System Volume Information"
        )
}

#[derive(Debug, Clone)]
pub struct Found {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: i64,
    pub mtime: i64,
    pub file_id: Option<String>,
    /// 登録フォルダからの相対のフォルダ（区切りは `/`、直下は空）。
    pub dir: String,
}

/// フォルダの下を読み、扱う種類のファイルを集める。`recursive` が false なら直下だけ。
/// データベースには触らない（共有ドライブで時間がかかっても、そのあいだ一覧を止めないため）。
pub fn walk(root: &Path, recursive: bool) -> Vec<Found> {
    let mut found = Vec::new();
    let it = walkdir::WalkDir::new(root)
        .follow_links(false)
        .max_depth(if recursive { usize::MAX } else { 1 })
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !skipped(&e.file_name().to_string_lossy()));
    for entry in it {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                // 読めないサブフォルダ（権限など）は飛ばして続ける。
                log::warn!("scan: {e}");
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if kind_of(&ext).is_none() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        found.push(Found {
            path: path.to_string_lossy().into_owned(),
            name: entry.file_name().to_string_lossy().into_owned(),
            ext,
            size: meta.len() as i64,
            mtime: mtime_ms(&meta),
            file_id: file_id(path, &meta),
            dir: rel_dir(root, path),
        });
    }
    found
}

/// 登録フォルダから見た、ファイルのあるフォルダ（`a/b`。直下は空）。
fn rel_dir(root: &Path, file: &Path) -> String {
    file.parent()
        .and_then(|p| p.strip_prefix(root).ok())
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// 中にサブフォルダがあるか（読まない名前は数えない）。登録するときに、サブフォルダも読むかを聞くかどうか。
pub fn has_subdirs(path: &Path) -> bool {
    std::fs::read_dir(path)
        .map(|it| {
            it.flatten().any(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && !skipped(&e.file_name().to_string_lossy())
            })
        })
        .unwrap_or(false)
}

fn mtime_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// ファイル ID：同じボリュームの中で、移動・改名しても変わらない番号。
#[cfg(unix)]
fn file_id(_path: &Path, meta: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(format!("{:x}:{:x}", meta.dev(), meta.ino()))
}

/// Windows：ボリュームのシリアル番号とファイルのインデックス（NTFS の File ID）。
/// 取るにはファイルを開く必要がある（読むだけ。共有の指定は std の既定で、ほかのアプリを邪魔しない）。
#[cfg(windows)]
fn file_id(path: &Path, _meta: &std::fs::Metadata) -> Option<String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let f = std::fs::File::open(path).ok()?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe { GetFileInformationByHandle(HANDLE(f.as_raw_handle()), &mut info) }.ok()?;
    Some(format!(
        "{:x}:{:x}{:08x}",
        info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
    ))
}

#[cfg(not(any(unix, windows)))]
fn file_id(_path: &Path, _meta: &std::fs::Metadata) -> Option<String> {
    None
}

struct Known {
    id: i64,
    root_id: i64,
    size: i64,
    mtime: i64,
    file_id: Option<String>,
}

/// `walk` の結果で、そのフォルダの記録を合わせる。1 つのトランザクションで行う。
pub fn apply(conn: &mut Connection, root_id: i64, found: Vec<Found>) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let now = db::now_ms();
    // このフォルダで覚えているもの（パスで引く）
    let mut known: HashMap<String, Known> = HashMap::new();
    {
        let mut st = tx.prepare(
            "SELECT id, root_id, path, size, mtime, file_id FROM files WHERE root_id = ?1",
        )?;
        let rows = st.query_map([root_id], |r| {
            Ok((
                r.get::<_, String>(2)?,
                Known {
                    id: r.get(0)?,
                    root_id: r.get(1)?,
                    size: r.get(3)?,
                    mtime: r.get(4)?,
                    file_id: r.get(5)?,
                },
            ))
        })?;
        for row in rows {
            let (path, k) = row?;
            known.insert(path, k);
        }
    }

    // 1. 同じパスにある
    let mut fresh = Vec::new();
    for f in found {
        match known.remove(&f.path) {
            Some(k) => {
                let changed = k.size != f.size || k.mtime != f.mtime;
                tx.execute(
                    "UPDATE files SET size = ?2, mtime = ?3, file_id = ?4, missing = 0,
                        hash = CASE WHEN ?5 THEN NULL ELSE hash END, dir = ?6
                     WHERE id = ?1",
                    params![k.id, f.size, f.mtime, f.file_id, changed, f.dir],
                )?;
            }
            None => fresh.push(f),
        }
    }

    // 見つからなかったもの：このフォルダで今回無かったもの＋前から行方不明のもの（ほかのフォルダから移ってきたかもしれない）
    let mut gone: Vec<Known> = known.into_values().collect();
    {
        let mut st = tx.prepare(
            "SELECT id, root_id, size, mtime, file_id FROM files WHERE missing = 1 AND root_id != ?1",
        )?;
        let rows = st.query_map([root_id], |r| {
            Ok(Known {
                id: r.get(0)?,
                root_id: r.get(1)?,
                size: r.get(2)?,
                mtime: r.get(3)?,
                file_id: r.get(4)?,
            })
        })?;
        for row in rows {
            gone.push(row?);
        }
    }

    // 2. ファイル ID が同じ → 移動・改名とみなす
    for f in fresh {
        let hit = f.file_id.as_ref().and_then(|fid| {
            gone.iter()
                .position(|g| g.file_id.as_deref() == Some(fid.as_str()))
        });
        match hit {
            Some(i) => {
                let g = gone.swap_remove(i);
                let changed = g.size != f.size || g.mtime != f.mtime;
                tx.execute(
                    "UPDATE files SET root_id = ?2, path = ?3, name = ?4, ext = ?5, size = ?6,
                        mtime = ?7, missing = 0, hash = CASE WHEN ?8 THEN NULL ELSE hash END,
                        dir = ?9
                     WHERE id = ?1",
                    params![g.id, root_id, f.path, f.name, f.ext, f.size, f.mtime, changed, f.dir],
                )?;
            }
            None => {
                tx.execute(
                    "INSERT INTO files (root_id, path, name, ext, size, mtime, file_id, dir, added_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![root_id, f.path, f.name, f.ext, f.size, f.mtime, f.file_id, f.dir, now],
                )?;
            }
        }
    }

    // 3. 残りは行方不明（このフォルダのものだけ。ほかのフォルダの行方不明はそのまま）
    for g in gone.iter().filter(|g| g.root_id == root_id) {
        tx.execute("UPDATE files SET missing = 1 WHERE id = ?1", [g.id])?;
    }
    tx.commit()
}

/// ハッシュがまだ無い、次の 1 件（id・パス）。
pub fn next_unhashed(conn: &Connection) -> rusqlite::Result<Option<(i64, PathBuf)>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT id, path FROM files WHERE missing = 0 AND hash IS NULL ORDER BY id LIMIT 1",
        [],
        |r| Ok((r.get(0)?, PathBuf::from(r.get::<_, String>(1)?))),
    )
    .optional()
}

/// ファイルの中身の SHA-256。データベースの外で（ロックを持たずに）呼ぶ。
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// 計算したハッシュを記録する。大きさとハッシュが同じ行方不明の行があれば、
/// それを同じファイルとみなしてつなぎ直し、新しい行は消す。つなぎ直したら true。
///
/// `hash` が None（読めなかった）のときは、空の印を付けて同じファイルを何度も読まないようにする。
pub fn record_hash(conn: &mut Connection, id: i64, hash: Option<&str>) -> rusqlite::Result<bool> {
    let tx = conn.transaction()?;
    let Some(hash) = hash else {
        tx.execute("UPDATE files SET hash = '' WHERE id = ?1", [id])?;
        tx.commit()?;
        return Ok(false);
    };
    tx.execute(
        "UPDATE files SET hash = ?2 WHERE id = ?1",
        params![id, hash],
    )?;
    let lost: Option<i64> = {
        use rusqlite::OptionalExtension;
        tx.query_row(
            "SELECT m.id FROM files m, files n
             WHERE n.id = ?1 AND m.missing = 1 AND m.hash = ?2 AND m.size = n.size
             ORDER BY m.id LIMIT 1",
            params![id, hash],
            |r| r.get(0),
        )
        .optional()?
    };
    let Some(lost) = lost else {
        tx.commit()?;
        return Ok(false);
    };
    // 新しい行の中身を、行方不明だった行へ移す（行方不明の行の id を残す：あとで付くタグ・メモはそちらに付いている）。
    #[allow(clippy::type_complexity)]
    let row: (
        i64,
        String,
        String,
        String,
        i64,
        Option<String>,
        Option<String>,
    ) = tx.query_row(
        "SELECT root_id, path, name, ext, mtime, file_id, dir FROM files WHERE id = ?1",
        [id],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        },
    )?;
    // つなぎ直す前に新しい行へ付けたタグ・仮想フォルダも引き継ぐ
    db::copy_organization(&tx, id, lost)?;
    tx.execute("DELETE FROM files WHERE id = ?1", [id])?;
    tx.execute(
        "UPDATE files SET root_id = ?2, path = ?3, name = ?4, ext = ?5, mtime = ?6,
            file_id = ?7, dir = ?8, missing = 0 WHERE id = ?1",
        params![lost, row.0, row.1, row.2, row.3, row.4, row.5, row.6],
    )?;
    tx.commit()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup() -> (tempfile::TempDir, Connection, i64) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let id = db::insert_root(&conn, &dir.path().to_string_lossy(), true).unwrap();
        (dir, conn, id)
    }

    fn scan(conn: &mut Connection, root: i64, dir: &Path) {
        apply(conn, root, walk(dir, true)).unwrap();
    }

    fn names(conn: &Connection, view: db::Place) -> Vec<String> {
        db::list_files(conn, view)
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect()
    }

    #[test]
    fn reads_only_the_kinds_it_handles_and_skips_hidden() {
        let (dir, mut conn, root) = setup();
        let d = dir.path();
        fs::create_dir_all(d.join("sub/.git")).unwrap();
        fs::write(d.join("a.pdf"), "a").unwrap();
        fs::write(d.join("sub/b.XLSX"), "b").unwrap();
        fs::write(d.join("photo.jpg"), "x").unwrap();
        fs::write(d.join("~$a.docx"), "x").unwrap();
        fs::write(d.join(".hidden.txt"), "x").unwrap();
        fs::write(d.join("sub/.git/c.txt"), "x").unwrap();
        scan(&mut conn, root, d);
        assert_eq!(names(&conn, db::Place::All), ["a.pdf", "b.XLSX"]);
        let b = db::list_files(&conn, db::Place::All).unwrap();
        assert_eq!(b[1].ext, "xlsx");
    }

    #[test]
    fn a_moved_file_keeps_its_row() {
        let (dir, mut conn, root) = setup();
        let d = dir.path();
        fs::write(d.join("a.pdf"), "a").unwrap();
        scan(&mut conn, root, d);
        let before = db::list_files(&conn, db::Place::All).unwrap()[0].id;
        fs::create_dir(d.join("sub")).unwrap();
        fs::rename(d.join("a.pdf"), d.join("sub/renamed.pdf")).unwrap();
        scan(&mut conn, root, d);
        let files = db::list_files(&conn, db::Place::All).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].id, before);
        assert_eq!(files[0].name, "renamed.pdf");
        assert!(names(&conn, db::Place::Missing).is_empty());
    }

    #[test]
    fn a_deleted_file_becomes_missing_and_comes_back_by_hash() {
        let (dir, mut conn, root) = setup();
        let d = dir.path();
        fs::write(d.join("a.pdf"), "same").unwrap();
        scan(&mut conn, root, d);
        // ハッシュを付けておく
        while let Some((id, path)) = next_unhashed(&conn).unwrap() {
            record_hash(&mut conn, id, hash_file(&path).ok().as_deref()).unwrap();
        }
        let before = db::list_files(&conn, db::Place::All).unwrap()[0].id;
        // 消して、同じ中身を別のファイルとして作る（ファイル ID は変わる）
        fs::remove_file(d.join("a.pdf")).unwrap();
        scan(&mut conn, root, d);
        assert_eq!(names(&conn, db::Place::Missing), ["a.pdf"]);
        fs::write(d.join("copy.pdf"), "same").unwrap();
        scan(&mut conn, root, d);
        // 同じ inode が使い回されればファイル ID で、そうでなければハッシュでつながる
        while let Some((id, path)) = next_unhashed(&conn).unwrap() {
            record_hash(&mut conn, id, hash_file(&path).ok().as_deref()).unwrap();
        }
        let files = db::list_files(&conn, db::Place::All).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].id, before);
        assert_eq!(files[0].name, "copy.pdf");
        assert!(names(&conn, db::Place::Missing).is_empty());
    }

    #[test]
    fn record_hash_reconnects_a_missing_row() {
        let (_dir, mut conn, root) = setup();
        conn.execute(
            "INSERT INTO files (id, root_id, path, name, ext, size, mtime, hash, missing, added_at)
             VALUES (1, ?1, '/old/a.pdf', 'a.pdf', 'pdf', 4, 1, 'h', 1, 1),
                    (2, ?1, '/new/b.pdf', 'b.pdf', 'pdf', 4, 2, NULL, 0, 2),
                    (3, ?1, '/new/c.pdf', 'c.pdf', 'pdf', 5, 2, NULL, 0, 2)",
            [root],
        )
        .unwrap();
        let tag = db::ensure_tag(&conn, "t").unwrap();
        db::tag_files(&mut conn, &[2], tag, true).unwrap();
        // 大きさが違えば、ハッシュが同じでもつながない
        assert!(!record_hash(&mut conn, 3, Some("h")).unwrap());
        assert!(record_hash(&mut conn, 2, Some("h")).unwrap());
        let files = db::list_files(&conn, db::Place::All).unwrap();
        let ids: Vec<_> = files.iter().map(|f| (f.id, f.name.as_str())).collect();
        assert_eq!(ids, [(1, "b.pdf"), (3, "c.pdf")]);
        // 新しい行に付けたタグは、つなぎ直した行へ移る
        assert_eq!(files[0].tags, [tag]);
    }

    #[test]
    fn keeps_the_folders_and_lists_only_what_is_directly_inside() {
        let (dir, mut conn, root) = setup();
        let d = dir.path();
        fs::create_dir_all(d.join("議事録/2026")).unwrap();
        fs::create_dir_all(d.join("空")).unwrap();
        fs::write(d.join("top.pdf"), "a").unwrap();
        fs::write(d.join("議事録/2026/11月.docx"), "b").unwrap();
        scan(&mut conn, root, d);
        let at = |dir: &str| {
            names(
                &conn,
                db::Place::Root {
                    id: root,
                    dir: dir.into(),
                },
            )
        };
        assert_eq!(at(""), ["top.pdf"]);
        assert!(at("議事録").is_empty());
        assert_eq!(at("議事録/2026"), ["11月.docx"]);
        // 扱うファイルが無いフォルダ（空）は出さない。上のフォルダは木をつなぐために出す
        let dirs = &db::list_roots(&conn).unwrap()[0].dirs;
        let dirs: Vec<_> = dirs.iter().map(|x| (x.path.as_str(), x.count)).collect();
        assert_eq!(dirs, [("議事録", 0), ("議事録/2026", 1)]);
    }

    #[test]
    fn a_folder_registered_without_subfolders_reads_only_its_own_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("a.pdf"), "a").unwrap();
        fs::write(d.join("sub/b.pdf"), "b").unwrap();
        assert!(has_subdirs(d));
        assert!(!has_subdirs(&d.join("sub")));
        let mut conn = db::open_in_memory().unwrap();
        let root = db::insert_root(&conn, &d.to_string_lossy(), false).unwrap();
        apply(&mut conn, root, walk(d, false)).unwrap();
        assert_eq!(names(&conn, db::Place::All), ["a.pdf"]);
        let r = &db::list_roots(&conn).unwrap()[0];
        assert!(!r.recursive);
        assert!(r.dirs.is_empty());
    }

    #[test]
    fn an_unreadable_file_is_not_hashed_again() {
        let (dir, mut conn, root) = setup();
        fs::write(dir.path().join("a.pdf"), "a").unwrap();
        scan(&mut conn, root, dir.path());
        let (id, _) = next_unhashed(&conn).unwrap().unwrap();
        record_hash(&mut conn, id, None).unwrap();
        assert!(next_unhashed(&conn).unwrap().is_none());
    }
}
