// Push live session snapshots to the frontend via the `sessions-update` event.

use crate::analysis::usage_blocks::BillingBlock;
use crate::app_state::AppState;
use crate::bridge::commands::collect_displayable;
use tauri::{AppHandle, Emitter};

/// Emit the full (small) snapshot list. Decisions are fetched on demand, not pushed.
pub async fn emit_sessions(app: &AppHandle, state: &AppState) {
    let snapshots = collect_displayable(state).await;
    let _ = app.emit("sessions-update", snapshots);
}

/// Push the current 5h billing block (or `None` to clear) via `block-update`.
pub fn emit_block(app: &AppHandle, block: Option<BillingBlock>) {
    let _ = app.emit("block-update", block);
}
