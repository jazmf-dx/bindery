//! Rust のコマンド。画面からは src/lib/api.ts のラッパ経由で呼ぶ。
//! 足したら src/dev/mockBackend.ts も同じ PR で直す。

use crate::db::{self, FileRow, Place, Root, Tag, VFolder};
use crate::library::{self, Shared};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

pub type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ------------------------------------------------------------ 登録フォルダ

#[tauri::command]
pub fn list_roots(lib: State<Shared>) -> CmdResult<Vec<Root>> {
    lib.with(|c| db::list_roots(c))
}

/// フォルダを登録して、裏で読み込みを始める。`recursive` が false ならサブフォルダは読まない。
/// 元のフォルダには何も書かない。
#[tauri::command]
pub fn add_root(
    app: AppHandle,
    lib: State<Shared>,
    path: PathBuf,
    recursive: bool,
) -> CmdResult<Root> {
    let existing = lib.with(|c| db::list_roots(c))?;
    library::check_new_root(&path, recursive, &existing)?;
    let id = lib.with(|c| db::insert_root(c, &path.to_string_lossy(), recursive))?;
    library::rescan(&app);
    let roots = lib.with(|c| db::list_roots(c))?;
    roots
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "登録したフォルダが見つかりません".into())
}

/// 落とされた・選ばれたパスがフォルダか、中にサブフォルダがあるか（登録の前に、何を聞くか決めるため）。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    path: String,
    is_dir: bool,
    has_subdirs: bool,
}

#[tauri::command]
pub fn inspect_paths(paths: Vec<PathBuf>) -> Vec<PathInfo> {
    paths
        .into_iter()
        .map(|p| {
            let is_dir = p.is_dir();
            PathInfo {
                has_subdirs: is_dir && crate::scan::has_subdirs(&p),
                is_dir,
                path: p.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

/// 登録を外す。アプリのデータの中の行だけを消し、元のファイルには触らない。
#[tauri::command]
pub fn remove_root(lib: State<Shared>, id: i64) -> CmdResult<()> {
    lib.with(|c| db::delete_root(c, id))
}

/// 登録フォルダか、その中のフォルダ（`dir`。登録フォルダからの相対、区切りは `/`）を Finder / エクスプローラーで表示する。
/// 登録フォルダの外は指せない（`..` などは断る）。
#[tauri::command]
pub fn reveal_root(lib: State<Shared>, id: i64, dir: String) -> CmdResult<()> {
    let root = lib
        .with(|c| db::root_path(c, id))?
        .ok_or("登録フォルダが見つかりません")?;
    let path = library::inside_root(std::path::Path::new(&root), &dir)
        .ok_or("登録フォルダの中のフォルダではありません")?;
    if !path.exists() {
        return Err(format!("フォルダが見つかりません：{}", path.display()));
    }
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

/// そのフォルダのファイルのうち、タグか仮想フォルダが付いているものの数（外す前の確認用）。
#[tauri::command]
pub fn root_organized_count(lib: State<Shared>, id: i64) -> CmdResult<i64> {
    lib.with(|c| db::organized_count(c, id))
}

#[tauri::command]
pub fn list_files(lib: State<Shared>, place: Place) -> CmdResult<Vec<FileRow>> {
    lib.with(|c| db::list_files(c, place))
}

// -------------------------------------------------------------- 開く操作

fn paths(lib: &Shared, ids: &[i64]) -> CmdResult<Vec<String>> {
    let paths = lib.with(|c| db::paths_of(c, ids))?;
    if paths.is_empty() && !ids.is_empty() {
        return Err("ファイルが見つかりません（行方不明）".into());
    }
    Ok(paths)
}

/// 既定のアプリで開く。
#[tauri::command]
pub fn open_files(lib: State<Shared>, ids: Vec<i64>) -> CmdResult<()> {
    for p in paths(&lib, &ids)? {
        tauri_plugin_opener::open_path(p, None::<&str>).map_err(err)?;
    }
    Ok(())
}

/// Finder / エクスプローラーで表示する（最初の 1 件）。
#[tauri::command]
pub fn reveal_file(lib: State<Shared>, id: i64) -> CmdResult<()> {
    let p = paths(&lib, &[id])?;
    tauri_plugin_opener::reveal_item_in_dir(&p[0]).map_err(err)
}

/// スペースで見るプレビュー（docs/CONCEPT.md「プレビュー」、preview.rs）。
/// 作れないとき・中身が合わないときは `None`。
#[tauri::command]
pub async fn file_preview(
    app: AppHandle,
    lib: State<'_, Shared>,
    id: i64,
) -> CmdResult<Option<crate::preview::Preview>> {
    let info = lib.with(|c| db::preview_info(c, id))?;
    let Some((path, ext, size, mtime)) = info else {
        return Err("ファイルが見つかりません（行方不明）".into());
    };
    let previews = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("previews");
    tauri::async_runtime::spawn_blocking(move || {
        use crate::preview::{self, Preview};
        let path = PathBuf::from(path);
        let made = match crate::scan::kind_of(&ext) {
            Some("text") => preview::text(&path, &ext),
            Some("pdf") => preview::is_pdf(&path).then_some(Preview::Pdf { path: path.clone() }),
            Some(_) => preview::document(&previews, id, size, mtime, &path, &ext),
            None => None,
        };
        // 画面（asset プロトコル）が読めるのは、いま見せる PDF と、作ったプレビューの置き場所だけ
        let scope = app.asset_protocol_scope();
        match &made {
            Some(Preview::Pdf { path }) => scope.allow_file(path).map_err(err)?,
            Some(Preview::Html { dir, .. }) => scope.allow_directory(dir, true).map_err(err)?,
            _ => {}
        }
        Ok(made)
    })
    .await
    .map_err(err)?
}

// ------------------------------------------------------------------ タグ

fn name_of(name: &str) -> CmdResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("名前が空です".into());
    }
    Ok(name.chars().take(100).collect())
}

#[tauri::command]
pub fn list_tags(lib: State<Shared>) -> CmdResult<Vec<Tag>> {
    lib.with(|c| db::list_tags(c))
}

/// その名前のタグをファイルに付ける（無ければ作る）。付けたタグの id を返す。
#[tauri::command]
pub fn add_tag(lib: State<Shared>, ids: Vec<i64>, name: String) -> CmdResult<i64> {
    let name = name_of(&name)?;
    lib.with(|c| {
        let tag = db::ensure_tag(c, &name)?;
        db::tag_files(c, &ids, tag, true)?;
        Ok(tag)
    })
}

#[tauri::command]
pub fn set_tag(lib: State<Shared>, ids: Vec<i64>, tag_id: i64, on: bool) -> CmdResult<()> {
    lib.with(|c| db::tag_files(c, &ids, tag_id, on))
}

#[tauri::command]
pub fn create_tag(lib: State<Shared>, name: String) -> CmdResult<i64> {
    let name = name_of(&name)?;
    lib.with(|c| db::ensure_tag(c, &name))
}

#[tauri::command]
pub fn rename_tag(lib: State<Shared>, id: i64, name: String) -> CmdResult<()> {
    let name = name_of(&name)?;
    lib.with(|c| db::rename_tag(c, id, &name))
}

/// タグを消す。ファイルからも外れる。元のファイルには触らない。
#[tauri::command]
pub fn delete_tag(lib: State<Shared>, id: i64) -> CmdResult<()> {
    lib.with(|c| db::delete_tag(c, id))
}

// ------------------------------------------------------------ 仮想フォルダ

#[tauri::command]
pub fn list_vfolders(lib: State<Shared>) -> CmdResult<Vec<VFolder>> {
    lib.with(|c| db::list_vfolders(c))
}

#[tauri::command]
pub fn create_vfolder(lib: State<Shared>, name: String, parent_id: Option<i64>) -> CmdResult<i64> {
    let name = name_of(&name)?;
    lib.with(|c| db::create_vfolder(c, &name, parent_id))
}

#[tauri::command]
pub fn rename_vfolder(lib: State<Shared>, id: i64, name: String) -> CmdResult<()> {
    let name = name_of(&name)?;
    lib.with(|c| db::rename_vfolder(c, id, &name))
}

/// 仮想フォルダを消す（下の仮想フォルダも）。中のファイルはそのまま。
#[tauri::command]
pub fn delete_vfolder(lib: State<Shared>, id: i64) -> CmdResult<()> {
    lib.with(|c| db::delete_vfolder(c, id))
}

#[tauri::command]
pub fn move_vfolder(lib: State<Shared>, id: i64, parent_id: Option<i64>) -> CmdResult<()> {
    if lib.with(|c| db::move_vfolder(c, id, parent_id))? {
        Ok(())
    } else {
        Err("仮想フォルダを、それ自身の中へは移せません".into())
    }
}

#[tauri::command]
pub fn set_vfolder(lib: State<Shared>, ids: Vec<i64>, vfolder_id: i64, on: bool) -> CmdResult<()> {
    lib.with(|c| db::file_into_vfolder(c, &ids, vfolder_id, on))
}

// ------------------------------------------------------------------ メモ

/// メモの長さの上限（文字）。
const NOTE_MAX: usize = 10_000;

/// メモを書く。空白だけなら消す。アプリのデータに書くだけで、元のファイルには触らない。
#[tauri::command]
pub fn set_note(lib: State<Shared>, id: i64, note: String) -> CmdResult<()> {
    let note: String = if note.trim().is_empty() {
        String::new()
    } else {
        note.chars().take(NOTE_MAX).collect()
    };
    lib.with(|c| db::set_note(c, id, &note))
}

// ------------------------------------------------------------ 行方不明

/// 行方不明のファイルを、手で選んだファイルへつなぎ直す（docs/CONCEPT.md「照合」の 4）。
/// 選べるのは登録フォルダの中で、読み込みで見つかる場所のファイルだけ（外のものは次の読み込みでまた行方不明になる）。
#[tauri::command]
pub fn relink_file(app: AppHandle, lib: State<Shared>, id: i64, path: PathBuf) -> CmdResult<()> {
    let roots = lib.with(|c| db::list_roots(c))?;
    let root = library::root_for(&path, &roots).ok_or(
        "登録フォルダの中のファイルを選んでください（サブフォルダを読まないフォルダでは、直下のファイルだけ）",
    )?;
    let found = crate::scan::found_at(std::path::Path::new(&root.path), &path).ok_or(
        "扱えないファイルです（PDF・オフィス文書・テキストで、隠しフォルダなど読まない場所の外にあるもの）",
    )?;
    let root_id = root.id;
    if !lib.with(|c| crate::scan::relink(c, id, root_id, found))? {
        return Err("行方不明のファイルではありません".into());
    }
    // つなぎ直したファイルのハッシュを計算し直す
    library::hash_in_background(&app);
    Ok(())
}

/// 行方不明のファイルの記録を外す（付けたタグ・仮想フォルダ・メモも消える）。元のファイルには触らない。
#[tauri::command]
pub fn forget_files(lib: State<Shared>, ids: Vec<i64>) -> CmdResult<usize> {
    lib.with(|c| db::forget_missing(c, &ids))
}

/// すべての登録フォルダを読み直す（照合）。
#[tauri::command]
pub fn rescan(app: AppHandle) {
    library::rescan(&app);
}

/// 読み込みの途中か（画面を開いた直後に、`scan-state` を聞き逃した分を補う）。
#[tauri::command]
pub fn scan_status(lib: State<Shared>) -> bool {
    lib.scanning()
}

// ------------------------------------------------------------------ 土台

/// Shows the log file (tauri-plugin-log, see lib.rs) in Finder / Explorer.
#[tauri::command]
pub fn reveal_log(app: AppHandle) -> CmdResult<()> {
    let dir = app.path().app_log_dir().map_err(err)?;
    let file = dir.join(format!("{}.log", crate::LOG_FILE));
    if file.is_file() {
        tauri_plugin_opener::reveal_item_in_dir(file).map_err(err)
    } else {
        std::fs::create_dir_all(&dir).map_err(err)?;
        tauri_plugin_opener::open_path(dir, None::<&str>).map_err(err)
    }
}

/// The update feed: `plugins.updater.endpoints` of the build's config.
fn update_feed(app: &AppHandle) -> Option<String> {
    let updater = app.config().plugins.0.get("updater")?;
    updater
        .get("endpoints")?
        .get(0)?
        .as_str()
        .map(str::to_owned)
}

/// The proxy the OS uses for the update feed (PAC included), for the updater:
/// its HTTP client can't run PAC scripts. None = connect directly.
#[tauri::command]
pub async fn system_proxy(app: AppHandle) -> Option<String> {
    let url = update_feed(&app)?;
    tauri::async_runtime::spawn_blocking(move || crate::proxy::for_url(&url))
        .await
        .ok()
        .flatten()
}

/// Opens the GitHub release page of `version` in the browser. The update
/// dialog links there for what changed, instead of showing the release notes
/// in the app.
#[tauri::command]
pub fn open_release_page(app: AppHandle, version: String) -> CmdResult<()> {
    let feed = update_feed(&app).unwrap_or_default();
    let page = release_page(&feed, &version)?;
    tauri_plugin_opener::open_url(page, None::<&str>).map_err(err)
}

/// The release page in the same repository as the update feed
/// (`https://github.com/<owner>/<repo>/releases/...`), tagged `v<version>`.
/// Only a version goes into the URL, so the page can't be sent anywhere else.
fn release_page(feed: &str, version: &str) -> CmdResult<String> {
    let version = version.strip_prefix('v').unwrap_or(version);
    let ok = !version.is_empty()
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'));
    if !ok {
        return Err(format!("not a version: {version}"));
    }
    let repo = feed
        .strip_prefix("https://github.com/")
        .and_then(|rest| rest.split_once("/releases/"))
        .map(|(repo, _)| repo)
        .filter(|repo| {
            let mut parts = repo.split('/');
            let name_ok = |p: Option<&str>| {
                p.is_some_and(|p| {
                    !p.is_empty()
                        && p.chars()
                            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                })
            };
            name_ok(parts.next()) && name_ok(parts.next()) && parts.next().is_none()
        })
        .ok_or_else(|| "このビルドの更新の配信先には、更新内容のページがありません".to_string())?;
    Ok(format!("https://github.com/{repo}/releases/tag/v{version}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEED: &str = "https://github.com/jazmf-dx/bindery/releases/latest/download/latest.json";

    #[test]
    fn release_page_from_feed() {
        assert_eq!(
            release_page(FEED, "0.1.0").unwrap(),
            "https://github.com/jazmf-dx/bindery/releases/tag/v0.1.0"
        );
        assert_eq!(
            release_page(FEED, "v0.1.0").unwrap(),
            "https://github.com/jazmf-dx/bindery/releases/tag/v0.1.0"
        );
    }

    #[test]
    fn release_page_refuses_odd_input() {
        assert!(release_page(FEED, "0.1/../x").is_err());
        assert!(release_page(FEED, "").is_err());
        assert!(release_page("https://example.com/latest.json", "0.1.0").is_err());
    }
}
