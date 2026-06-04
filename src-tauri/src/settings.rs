// Persist user settings (auto-popup, summary model) to a small JSON in the app
// config dir, so they survive restarts. Hand-rolled (no plugin). `snooze_until`
// is intentionally NOT persisted — snoozing is a session-scoped action.

use crate::app_state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::Ordering::Relaxed;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize)]
pub struct PersistedSettings {
    #[serde(default = "default_true")]
    pub auto_popup: bool,
    #[serde(default)]
    pub summary_model: String,
}

fn default_true() -> bool {
    true
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            auto_popup: true,
            summary_model: String::new(),
        }
    }
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("settings.json"))
}

/// Read settings from disk; missing/corrupt → defaults (best-effort, never panics).
pub fn load(app: &AppHandle) -> PersistedSettings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Apply persisted settings to the live state (once, at startup).
pub fn apply(s: PersistedSettings, state: &AppState) {
    state.auto_popup.store(s.auto_popup, Relaxed);
    *state.summary_model.lock().unwrap_or_else(|e| e.into_inner()) = s.summary_model;
}

/// Snapshot the current live settings to disk (best-effort).
pub fn save(app: &AppHandle, state: &AppState) {
    let Some(path) = settings_path(app) else {
        return;
    };
    let s = PersistedSettings {
        auto_popup: state.auto_popup.load(Relaxed),
        summary_model: state
            .summary_model
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&s) {
        let _ = std::fs::write(&path, json);
    }
}
