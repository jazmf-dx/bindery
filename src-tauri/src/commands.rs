//! Rust のコマンド。画面からは src/lib/api.ts のラッパ経由で呼ぶ。
//! 足したら src/dev/mockBackend.ts も同じ PR で直す。

use tauri::{AppHandle, Manager};

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
