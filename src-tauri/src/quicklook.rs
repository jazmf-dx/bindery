//! Quick Look（スペースで大きく見る。docs/CONCEPT.md「プレビュー」）。
//!
//! - macOS：OS の Quick Look のウィンドウを出す。アプリの画面には元のファイルを出さないので、
//!   CSP は変えない。今は `qlmanage -p`（macOS に入っている Quick Look の道具）で開く。
//!   Finder と同じパネル（QLPreviewPanel）を直接使う作りは、実機で確かめながらあとで検討する
//! - Windows：OS に同じものが無いので、既定のアプリで開く
//!
//! もう一度押す（または別のファイルで押す）と、前のウィンドウを閉じる。

use std::process::Child;
use std::sync::Mutex;

static OPEN: Mutex<Option<Child>> = Mutex::new(None);

/// 開いている Quick Look を閉じる。閉じたら true。
fn close() -> bool {
    let Ok(mut open) = OPEN.lock() else {
        return false;
    };
    match open.take() {
        Some(mut child) => {
            // もう閉じられていたら（ユーザーが閉じた）、閉じたことにはしない
            let running = matches!(child.try_wait(), Ok(None));
            let _ = child.kill();
            let _ = child.wait();
            running
        }
        None => false,
    }
}

/// `paths` を Quick Look で見る。開いていれば閉じる（Finder のスペースと同じ）。
pub fn toggle(paths: &[String]) -> Result<(), String> {
    if close() || paths.is_empty() {
        return Ok(());
    }
    show(paths)
}

#[cfg(target_os = "macos")]
fn show(paths: &[String]) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let child = Command::new("/usr/bin/qlmanage")
        .arg("-p")
        .args(paths)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Quick Look を開けませんでした：{e}"))?;
    if let Ok(mut open) = OPEN.lock() {
        *open = Some(child);
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn show(paths: &[String]) -> Result<(), String> {
    for p in paths {
        tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(())
}
