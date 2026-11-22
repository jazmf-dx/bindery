//! Bindery のアプリの土台。stockroom の lib.rs から、どのアプリでも使う部分
//! （プラグインの配線・ログ・ウィンドウ）だけを写した（desktop-platform
//! playbook/new-tool.md）。整理の仕組み（登録フォルダ・照合・タグ）はまだ無い。

pub mod commands;
pub mod proxy;

use commands::*;

/// The log file's name in the app's log folder (without ".log").
pub const LOG_FILE: &str = "bindery";

/// Panics into the log too: release builds abort on panic, so stderr is all
/// that would be left, and nobody sees it.
fn log_panics() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("{info}");
        default(info);
    }));
}

/// The window, from tauri.conf.json (where it isn't created by itself). On
/// macOS, transparent over the "sidebar" material: the page lets it show
/// through the sidebar (index.css, `.vibrant`) and covers it elsewhere.
/// Windows keeps an ordinary window.
fn main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .expect("window in tauri.conf.json");
    let builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
    #[cfg(target_os = "macos")]
    let builder = {
        use tauri::window::{Color, Effect, EffectState, EffectsBuilder};
        builder
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .effects(
                EffectsBuilder::new()
                    .effect(Effect::Sidebar)
                    // Always the plain grey a background window gets: the active
                    // material is tinted by the desktop, which made the whole
                    // sidebar look selected.
                    .state(EffectState::Inactive)
                    .build(),
            )
    };
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch quits before setting anything up: it only
        // brings this app's window up.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app)
        }))
        // log::* from Rust and the frontend's warnings (src/lib/log.ts), into
        // the app's log folder and stdout.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some(LOG_FILE.into()),
                    }),
                ])
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(2))
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Size, place and maximized of the window, kept between launches. Not
        // fullscreen or hidden: the app should always open as a visible,
        // ordinary window.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            log_panics();
            main_window(app.handle())?;
            log::info!(
                "{} {} ({} {})",
                app.package_info().name,
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reveal_log,
            system_proxy,
            open_release_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
