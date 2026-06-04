// Auto-popup: surface the monitor window when a session becomes active.
// Edge-triggered (only on not-active → active), debounced, and gated by the
// user's auto-popup toggle + snooze so it never steals focus repeatedly.

use crate::app_state::AppState;
use crate::model::SessionSnapshot;
use std::sync::atomic::Ordering::Relaxed;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Minimum seconds between auto-popups (anti focus-steal).
const POPUP_DEBOUNCE_SECS: i64 = 3;

pub fn on_activations(app: &AppHandle, state: &AppState, activations: &[SessionSnapshot]) {
    if activations.is_empty() || !state.auto_popup.load(Relaxed) {
        return;
    }
    let now = chrono::Utc::now().timestamp();
    if state.snooze_until.load(Relaxed) > now {
        return;
    }
    if now - state.last_popup.load(Relaxed) < POPUP_DEBOUNCE_SECS {
        return;
    }
    state.last_popup.store(now, Relaxed);

    if let Some(window) = app.get_webview_window("monitor") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let body = match activations {
        [one] => format!("{} is active", label(one)),
        many => format!("{} sessions just became active", many.len()),
    };
    let _ = app
        .notification()
        .builder()
        .title("Claude Monitor")
        .body(body)
        .show();
}

/// A session just started needing you. Notify only — no window focus-steal —
/// with the agent's pending question. Edge-triggered by the watcher (fires once
/// per entry into NeedsInput, batching all that flipped in the same scan), so it
/// needs no debounce. Gated only by snooze — NOT the auto-popup toggle, which
/// governs window focus-steal; a notify-only "your move" still fires.
pub fn on_needs_attention(app: &AppHandle, state: &AppState, needs: &[SessionSnapshot]) {
    if needs.is_empty() {
        return;
    }
    let now = chrono::Utc::now().timestamp();
    if state.snooze_until.load(Relaxed) > now {
        return;
    }

    let body = match needs {
        [one] => match &one.pending_question {
            Some(q) => format!("{}: {q}", label(one)),
            None => format!("{} is waiting for you", label(one)),
        },
        many => format!("{} sessions need your input", many.len()),
    };
    let _ = app
        .notification()
        .builder()
        .title("🔔 Needs you")
        .body(body)
        .show();
}

fn label(s: &SessionSnapshot) -> String {
    s.title.clone().unwrap_or_else(|| {
        s.project_path
            .rsplit('/')
            .find(|seg| !seg.is_empty())
            .unwrap_or(&s.project_path)
            .to_string()
    })
}
