// Claude Monitor — menubar-resident macOS app that watches active Claude Code sessions.
// Phase 01: scaffold only — tray + hidden window + accessory mode + single-instance.
// Watcher/parse/analysis/UI wiring arrives in later phases.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analysis;
mod app_state;
mod bridge;
mod llm;
mod model;
mod settings;
mod transcript;
mod watcher;

use app_state::AppState;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Single-instance MUST be registered first: a second launch focuses the
        // existing window instead of spawning a duplicate menubar agent.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("monitor") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            bridge::commands::toggle_window,
            bridge::commands::get_sessions,
            bridge::commands::get_decisions,
            bridge::commands::get_activity,
            bridge::commands::get_settings,
            bridge::commands::set_auto_popup,
            bridge::commands::snooze_popups,
            bridge::commands::summarize_session,
            bridge::commands::save_png,
        ])
        .setup(|app| {
            // Build the menubar tray (icon + Show/Quit menu + click-to-toggle).
            bridge::tray::build_tray(app.handle())?;

            // Regular activation policy: shows a Dock icon and enables native macOS
            // fullscreen (green button + a separate Space). The menubar tray stays,
            // so the app is reachable both ways.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            // Start the background watcher: tails ~/.claude/projects into the registry.
            let app_state = app.state::<AppState>().inner().clone();
            // Load persisted settings onto the live state before anything reads them.
            settings::apply(settings::load(app.handle()), &app_state);
            // Animated menubar pet: a tiny pixel worker reflecting live state.
            bridge::tray_pet::spawn(app.handle().clone(), app_state.clone());
            watcher::spawn(app.handle().clone(), app_state);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Claude Monitor")
        .run(|_app, _event| {
            // With a Dock icon present, clicking it when no window is visible
            // reopens the monitor window instead of doing nothing.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                if let Some(w) = _app.get_webview_window("monitor") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });
}
