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
            bridge::commands::get_settings,
            bridge::commands::set_auto_popup,
            bridge::commands::snooze_popups,
            bridge::commands::summarize_session,
            bridge::commands::set_summary_model,
        ])
        .setup(|app| {
            // Build the menubar tray (icon + Show/Quit menu + click-to-toggle).
            bridge::tray::build_tray(app.handle())?;

            // Menubar-only: no Dock icon. Accessory policy hides it at runtime in
            // dev and bundled runs. LSUIElement (Info.plist) is added in phase 07.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Start the background watcher: tails ~/.claude/projects into the registry.
            let app_state = app.state::<AppState>().inner().clone();
            // Load persisted settings onto the live state before anything reads them.
            settings::apply(settings::load(app.handle()), &app_state);
            watcher::spawn(app.handle().clone(), app_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Claude Monitor");
}
