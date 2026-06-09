// Tauri commands invoked from the React frontend.

use crate::app_state::AppState;
use crate::model::{ActivityEvent, DecisionEvent, SessionSnapshot, SessionState};
use std::sync::atomic::Ordering::Relaxed;
use tauri::State;

/// Sort active → idle → ended, then most-recent activity first.
pub fn sort_snapshots(v: &mut [SessionSnapshot]) {
    v.sort_by(|a, b| {
        rank(a).cmp(&rank(b)).then(
            b.last_activity_unix
                .unwrap_or(0)
                .cmp(&a.last_activity_unix.unwrap_or(0)),
        )
    });
}

fn rank(s: &SessionSnapshot) -> u8 {
    match s.state {
        SessionState::Running => 0,
        SessionState::NeedsInput => 1,
        SessionState::Idle => 2,
    }
}

/// Read lock → clone displayable snapshots → sort. Shared by `get_sessions` and
/// the live `emit_sessions` push.
pub async fn collect_displayable(state: &AppState) -> Vec<SessionSnapshot> {
    let mut v: Vec<SessionSnapshot> = {
        let reg = state.registry.read().await;
        reg.sessions
            .values()
            .map(|r| r.snapshot.clone())
            .filter(SessionSnapshot::is_displayable)
            .collect()
    };
    sort_snapshots(&mut v);
    v
}

#[tauri::command]
pub async fn get_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSnapshot>, ()> {
    Ok(collect_displayable(&state).await)
}

#[tauri::command]
pub async fn get_decisions(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DecisionEvent>, ()> {
    let reg = state.registry.read().await;
    Ok(reg
        .sessions
        .get(&session_id)
        .map(|r| r.extractor.events.clone())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_activity(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ActivityEvent>, ()> {
    let reg = state.registry.read().await;
    Ok(reg
        .sessions
        .get(&session_id)
        .map(|r| r.activity.iter().cloned().collect())
        .unwrap_or_default())
}

#[tauri::command]
pub fn toggle_window(window: tauri::WebviewWindow) {
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub auto_popup: bool,
    pub snoozed: bool,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsDto {
    let now = chrono::Utc::now().timestamp();
    SettingsDto {
        auto_popup: state.auto_popup.load(Relaxed),
        snoozed: state.snooze_until.load(Relaxed) > now,
    }
}

/// On-demand session summary via the local Claude Code CLI (`claude -p`), reusing
/// the user's existing Claude login. Opt-in; sends decisions + metadata, not the
/// raw transcript. Errors are user-facing strings.
#[tauri::command]
pub async fn summarize_session(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (snapshot, decisions) = {
        let reg = state.registry.read().await;
        let rt = reg
            .sessions
            .get(&session_id)
            .ok_or_else(|| "Unknown session".to_string())?;
        (rt.snapshot.clone(), rt.extractor.events.clone())
    };
    let prompt = crate::llm::prompt::build_prompt(&snapshot, &decisions);
    crate::llm::claude_cli::summarize(&prompt, None).await
}

#[tauri::command]
pub fn set_auto_popup(enabled: bool, state: State<'_, AppState>, app: tauri::AppHandle) {
    state.auto_popup.store(enabled, Relaxed);
    crate::settings::save(&app, &state);
}

#[tauri::command]
pub fn snooze_popups(minutes: i64, state: State<'_, AppState>) {
    let until = chrono::Utc::now().timestamp() + minutes.max(0) * 60;
    state.snooze_until.store(until, Relaxed);
}

/// Save recap-card PNG bytes to the user's Downloads folder; return the path.
/// A browser `<a download>` is unreliable in WKWebView, so we persist natively.
#[tauri::command]
pub fn save_png(file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "No Downloads/home folder found".to_string())?;
    // Keep only the basename + force .png, so a crafted name can't escape the dir.
    let stem = std::path::Path::new(&file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("claude-standup");
    let path = dir.join(format!("{stem}.png"));
    std::fs::write(&path, &bytes).map_err(|e| format!("Failed to save: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
