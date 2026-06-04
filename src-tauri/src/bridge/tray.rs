// Menubar tray icon: Show/Quit menu + left-click toggles the monitor window.
// Active-session count + icon variants are added in phase 04.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// Build the tray icon, its menu, and event handlers. Called once in `setup`.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Monitor", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("monitor-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Claude Monitor")
        .menu(&menu)
        // Left-click should toggle the window, not open the menu (right-click does).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_and_focus(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            // Let the positioner plugin track the tray rect for window placement.
            tauri_plugin_positioner::on_tray_event(app, &event);

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

/// Reflect the active + needs-you counts in the menubar title + tooltip.
/// `●R` = sessions working, `🔔N` = sessions waiting on you.
pub fn update_count(app: &AppHandle, active: usize, needs: usize) {
    if let Some(tray) = app.tray_by_id("monitor-tray") {
        let title: Option<String> = match (active, needs) {
            (a, n) if a > 0 && n > 0 => Some(format!("●{a} 🔔{n}")),
            (_, n) if n > 0 => Some(format!("🔔{n}")),
            (a, _) if a > 0 => Some(format!("●{a}")),
            _ => None,
        };
        let _ = tray.set_title(title);
        let _ = tray.set_tooltip(Some(format!(
            "Claude Monitor — {active} active · {needs} need you"
        )));
    }
}

fn show_and_focus(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("monitor") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("monitor") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}
