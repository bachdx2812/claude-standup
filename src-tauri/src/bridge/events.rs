// Push live session snapshots to the frontend via the `sessions-update` event.

use crate::app_state::AppState;
use crate::bridge::commands::collect_displayable;
use tauri::{AppHandle, Emitter};

/// Emit the full (small) snapshot list. Decisions are fetched on demand, not pushed.
pub async fn emit_sessions(app: &AppHandle, state: &AppState) {
    let snapshots = collect_displayable(state).await;
    let _ = app.emit("sessions-update", snapshots);
}
