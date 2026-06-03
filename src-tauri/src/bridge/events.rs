// Push live session snapshots to the frontend via the `sessions-update` event.

use crate::app_state::AppState;
use crate::bridge::commands::sort_snapshots;
use crate::model::SessionSnapshot;
use tauri::{AppHandle, Emitter};

/// Emit the full (small) snapshot list. Decisions are fetched on demand, not pushed.
pub async fn emit_sessions(app: &AppHandle, state: &AppState) {
    let mut snapshots: Vec<SessionSnapshot> = {
        let reg = state.registry.read().await;
        reg.sessions
            .values()
            .map(|r| r.snapshot.clone())
            .filter(SessionSnapshot::is_displayable)
            .collect()
    };
    sort_snapshots(&mut snapshots);
    let _ = app.emit("sessions-update", snapshots);
}
