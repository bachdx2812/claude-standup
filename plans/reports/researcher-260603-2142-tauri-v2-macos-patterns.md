# Tauri v2 macOS Agent Desktop App — Implementation Reference
**Date:** 2026-06-03 | **Target:** Claude Code Session Monitor (menubar accessory + Rust core + web frontend) | **Platform:** macOS 25.5.0 (Apple Silicon)

---

## 1. Menubar / System Tray App

**Crate/API:** `tauri::tray::TrayIconBuilder` + `tauri::menu` for native menus. In Tauri v2, system-tray renamed to tray-icon.

**Snippet:**
```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;

TrayIconBuilder::with_id("monitor-tray")
  .icon(icon_handle.clone())
  .menu(&Menu::default().add(MenuItem::new("Show", true, None)))
  .on_menu_event(|tray, event| {
    eprintln!("tray event: {}", event.id);
  })
  .build(&app)?;
```

**Gotcha:** Tray menu click events fire `on_menu_event`, not tray click directly. For click vs menu-item, attach click handler separately via `on_tray_icon_event`. Tray icon updates (title, tooltip, icon) are live; dynamic updates work immediately.

---

## 2. Show/Hide Window Programmatically (Menubar Popup)

**Crate/API:** `tauri::window::WebviewWindow::show()` / `.hide()` / `.set_focus()`. Create hidden window on app start or on-demand.

**Snippet:**
```rust
// In tauri command handler (from frontend)
#[tauri::command]
pub fn toggle_monitor(window: tauri::Window) {
  if window.is_visible().unwrap_or(false) {
    let _ = window.hide();
  } else {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

// OR in Rust task: get window from app_handle
let window = app_handle.get_webview_window("monitor").unwrap();
window.show().unwrap();
```

**Gotcha:** Pre-create hidden window in main (faster show). On-demand window creation has startup latency. Use `tauri-plugin-positioner` (next section) to auto-position below tray. `set_focus()` after show is critical on macOS—window may not steal focus without it.

---

## 3. Rust → Frontend Event Bridge

**Crate/API:** `AppHandle::emit()` / `AppHandle::emit_to()` for global events. `WebviewWindow::emit()` for window-specific. No Channel type in Tauri v2 events (JSON only).

**Snippet:**
```rust
// Background tokio task: push session update to frontend
use std::sync::Arc;
use tokio::task;

#[tauri::command]
pub async fn spawn_session_monitor(app: tauri::AppHandle) -> Result<()> {
  task::spawn_local(async move {
    loop {
      // ... watch logic ...
      let payload = serde_json::json!({"session_id": "abc123", "status": "active"});
      app.emit("session-update", payload).unwrap();
      tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
  });
  Ok(())
}
```

**Frontend listener (TS):**
```typescript
import { listen } from '@tauri-apps/api/event';
await listen('session-update', (event) => {
  console.log("Update:", event.payload);
});
```

**Gotcha:** `emit()` is fire-and-forget; payloads must be JSON-serializable (no custom types). For high-frequency updates (file tailing), batch events or throttle. `AppHandle` is cheap to clone into tokio tasks; use it to pass context. Avoid emitting from inside a lock (deadlock risk).

---

## 4. Filesystem Watching in Rust

**Crate:** `notify` (v6.1+) + `notify-debouncer-full` for FSEvents integration on macOS.

**Snippet:**
```rust
use notify::{Watcher, RecursiveMode, watcher};
use notify_debouncer_full::new_debouncer;
use std::path::Path;
use std::time::Duration;

let (tx, rx) = std::sync::mpsc::channel();
let mut debouncer = new_debouncer(Duration::from_millis(500), None, tx)?;
debouncer.watch(Path::new("~/.claude/projects/"), RecursiveMode::Recursive)?;

for result in rx {
  match result {
    Ok(events) => {
      for event in events {
        eprintln!("Event: {:?}", event);
      }
    }
    Err(_) => {}
  }
}
```

**Gotcha:** FSEvents on macOS coalesces rapid events (e.g., file write in 100ms → 1 event). Debouncing helps. Watching many files (1000+) can hit macOS limits; filter by extension first. No partial-file-write events; only file-close-write. Requires `target 'cfg(target_os = "macos")'` or conditional compilation.

---

## 5. Efficient Incremental File Tailing (10MB–110MB JSONL)

**Crate:** `std::fs::File` + `std::io::{Seek, SeekFrom, BufReader, Read}`. Optional: `linemux` for streaming line-by-line reads.

**Snippet:**
```rust
use std::fs::File;
use std::io::{BufReader, Seek, SeekFrom, BufRead};
use std::collections::HashMap;

let mut offsets: HashMap<String, u64> = HashMap::new();

fn tail_file(path: &str, offsets: &mut HashMap<String, u64>) -> Result<Vec<String>> {
  let mut file = File::open(path)?;
  let last_offset = offsets.entry(path.to_string()).or_insert(0);
  
  file.seek(SeekFrom::Start(*last_offset))?;
  let reader = BufReader::new(file);
  let mut lines = Vec::new();
  
  for line in reader.lines() {
    let line = line?;
    lines.push(line);
  }
  
  *last_offset = file.seek(SeekFrom::Current(0))?; // Update offset
  Ok(lines)
}
```

**Gotcha:** Partial last line (file append mid-write) is not complete JSON—skip it. After reading, update offset. File truncation/rotation: detect via size decrease; reset offset to 0. `BufReader` memory-bounds to buffer size (default 8KB), not file size. Don't hold offset in a mutable file handle across async boundaries; use `Arc<Mutex<HashMap>>` for state.

---

## 6. Autostart at Login

**Crate:** `tauri-plugin-autostart` v2.0.0+.

**Snippet:**
```rust
use tauri_plugin_autostart::MacosLauncher;

let autostart = tauri::Builder::default()
  .plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    Some(vec!["--minimized".to_string()]),
  ))
  .build(tauri::generate_context!())?;

// In frontend: invoke autostart command
#[tauri::command]
pub async fn enable_autostart(app: tauri::AppHandle) -> Result<()> {
  tauri_plugin_autostart::enable(&app)?;
  Ok(())
}
```

**Gotcha:** Requires `tauri-plugin-autostart` permission in capabilities.json. `MacosLauncher::LaunchAgent` (preferred) vs `AppleScript`. Autostart runs with minimal args; UI may not be visible on first launch.

---

## 7. Single Instance (Prevent Double Launch)

**Crate:** `tauri-plugin-single-instance` v2.3.6+. Must be first plugin in builder chain.

**Snippet:**
```rust
.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
  eprintln!("another instance tried to launch");
  if let Some(window) = app.get_webview_window("monitor") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}))
```

**Gotcha:** Must be registered before other plugins. Closure fires when secondary instance detected; focus the main window. On sandboxed (snap/flatpak) systems, may not work due to DBus restrictions.

---

## 8. System Notifications

**Crate:** `tauri-plugin-notification` v2.0.0+.

**Snippet:**
```rust
use tauri_plugin_notification::NotificationBuilder;

#[tauri::command]
pub async fn notify_session_active(app: tauri::AppHandle) -> Result<()> {
  NotificationBuilder::new()
    .title("Claude Session")
    .body("New session detected: llm-task-123")
    .show(&app)?;
  Ok(())
}
```

**JS frontend:**
```typescript
import { sendNotification } from '@tauri-apps/plugin-notification';
sendNotification("Session Active");
```

**Gotcha:** Notifications require user permission on first use (`requestPermission()` on frontend). On macOS, notifications appear in Notification Center, not as banners by default. No callback on click in v2 (limitation vs Electron).

---

## 9. Anthropic Claude API from Rust

**Approach:** Use `reqwest` + manual HTTP POST, or use community Rust SDK. **Recommendation: Use `reqwest` directly for full control + streaming support.**

**Snippet:**
```rust
use reqwest::Client;

#[tauri::command]
pub async fn query_claude(prompt: String) -> Result<String, String> {
  let api_key = std::env::var("ANTHROPIC_API_KEY")
    .map_err(|_| "ANTHROPIC_API_KEY not set".to_string())?;
  
  let client = Client::new();
  let response = client
    .post("https://api.anthropic.com/v1/messages")
    .header("x-api-key", &api_key)
    .header("anthropic-version", "2023-06-01")
    .json(&serde_json::json!({
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [{"role": "user", "content": prompt}]
    }))
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json::<serde_json::Value>()
    .await
    .map_err(|e| e.to_string())?;
  
  Ok(response["content"][0]["text"].as_str().unwrap_or("").to_string())
}
```

**API Key Storage:** Use `keyring` crate (native macOS Keychain) instead of env for security:
```rust
use keyring::Entry;

let entry = Entry::new("claude-monitor", "ANTHROPIC_API_KEY")?;
let api_key = entry.get_password()?;
// Or set: entry.set_password("sk-...")?;
```

**Gotcha:** API key in `.env` is visible in process listings. Keychain requires code signing on production builds (free dev accounts can skip, but security is worse). Stream responses via SSE by parsing event lines (prefix "data: "). Current model IDs (June 2026): `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.

---

## 10. Packaging / Distribution

**Build:** `tauri build` produces `.app` bundle + `.dmg`. 

**tauri.conf.json menubar/accessory config:**
```json
{
  "app": {
    "windows": [{
      "label": "monitor",
      "title": "Claude Monitor",
      "url": "index.html",
      "minimizable": false,
      "maximizable": false,
      "resizable": false,
      "fullscreen": false,
      "focus": true
    }],
    "macOS": {
      "activationPolicy": "accessory"
    }
  },
  "bundle": {
    "macOS": {
      "infoPlist": {
        "LSUIElement": true
      },
      "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
    }
  }
}
```

**Code-signing + notarization (macOS):**
```bash
# Set env vars before tauri build
export APPLE_SIGNING_IDENTITY="Developer ID Application: ..."
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"

tauri build --release
# Tauri auto-signs + notarizes. DMG is ready for distribution.
```

**Gotcha:** Free Apple Developer account cannot notarize (app shows unverified). `LSUIElement: true` + `activationPolicy: "accessory"` required together to hide from Dock. Notarization takes 1–5 min; watch logs. Code signing fails silently if entitlements are missing.

---

## 11. State Management (Session Registry)

**Pattern:** `Arc<RwLock<T>>` for read-heavy, infrequent writes. `Arc<Mutex<T>>` for write-heavy or short lock durations.

**Snippet (registry pattern):**
```rust
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct SessionRegistry {
  sessions: HashMap<String, SessionState>,
}

#[derive(Clone, Debug)]
pub struct SessionState {
  pub id: String,
  pub status: String,
  pub last_update: u64,
}

// In main setup:
let registry = Arc::new(RwLock::new(SessionRegistry { sessions: HashMap::new() }));

// Spawn watcher task with clone:
let registry_clone = registry.clone();
tokio::spawn(async move {
  loop {
    // ... watch files ...
    let mut reg = registry_clone.write().await;
    reg.sessions.insert("session-1".to_string(), SessionState {
      id: "session-1".to_string(),
      status: "active".to_string(),
      last_update: std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs(),
    });
  }
});

// In Tauri command (read):
#[tauri::command]
pub async fn get_sessions(registry: tauri::State<'_, Arc<RwLock<SessionRegistry>>>) -> Result<Vec<String>> {
  let reg = registry.read().await;
  Ok(reg.sessions.keys().cloned().collect())
}

// Emit to frontend on change:
let _ = app_handle.emit("registry-update", &registry.read().await.sessions);
```

**Gotcha:** `RwLock` is slower than `Mutex` if many writers; use `Mutex` if contention high. Don't hold read/write lock across `.await` in another function. `State<'_, Arc<...>>` in commands requires the Arc to be managed by Tauri; insert via `.manage(registry)` in builder. Use `clone()` to move Arc into tokio tasks.

---

## Recommended Architecture Wiring

```
┌─ Tauri App (main) ────────────────────────────────────────────┐
│                                                                │
│  1. Setup:                                                     │
│     - Arc<RwLock<SessionRegistry>> → .manage()               │
│     - Single-instance plugin (first)                           │
│     - Autostart plugin                                         │
│     - Tray icon + menu                                         │
│                                                                │
│  2. FSEvents Watcher (tokio::spawn_local in setup):           │
│     - notify crate watches ~/.claude/projects recursively      │
│     - On file-write event → tail new lines from JSONL         │
│     - Parse JSON, extract session_id + status                 │
│     - Write to Arc<RwLock<SessionRegistry>>                   │
│     - app_handle.emit("session-update", payload)             │
│                                                                │
│  3. Tray Events:                                               │
│     - Click → show/hide monitor window                         │
│     - Positioned below tray via tauri-plugin-positioner        │
│     - Updates tray tooltip with active session count           │
│                                                                │
│  4. Frontend (React/Vue):                                      │
│     - listen('session-update') → re-render session list       │
│     - invoke('get_sessions') → fetch full state on mount      │
│     - Button clicks invoke Rust commands (e.g., query_claude) │
│                                                                │
│  5. Claude API:                                                │
│     - Rust command invoked from UI                             │
│     - reqwest POST to api.anthropic.com/v1/messages            │
│     - API key from Keychain (keyring crate)                    │
│     - Stream or batch response, emit to frontend               │
│                                                                │
│  6. Notifications:                                             │
│     - On new session → tauri-plugin-notification               │
│     - User clicks → tray event handler re-shows window        │
└────────────────────────────────────────────────────────────────┘
```

**Data flow:** File append → FSEvents → notify debouncer → tokio task tail logic → Arc<RwLock> update → emit event → JS listener → React re-render + tray update.

---

## Open Questions / Risks

1. **File rotation handling:** Does Claude Code rotate task JSONL files? Need to detect size decrease / file recreation and reset offset tracking.

2. **Keychain + code-signing:** Free dev account can't code-sign; Keychain access will fail. Fallback to env var needed.

3. **Event serialization ceiling:** Tauri event JSON has no hard limit in docs; test with large session payloads (1MB event → potential slowdown).

4. **FSEvents coalescing:** If tasks update every 100ms, OSX may batch → app sees update every 500ms+. Acceptable for session monitor?

5. **Tauri single-instance on Cmd+Tab focus:** Does `set_focus()` steal focus on macOS, or does system keep previous window focused? Test on real M-series Mac.

6. **Claude API streaming UI:** Should streaming responses to frontend use SSE-style event emits or a polling command? Research latency impact.

7. **Background daemon mode:** If user closes main window, should watcher + tray stay alive? Currently yes (accessory app). Confirm expected behavior.

---

**References & Authority:**
- [Tauri v2 System Tray](https://v2.tauri.app/learn/system-tray/)
- [Tauri v2 Window API](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)
- [Tauri v2 Events](https://v2.tauri.app/develop/calling-frontend/)
- [Notify Crate FSEvents](https://docs.rs/notify/latest/notify/)
- [Tauri Plugins (autostart, single-instance, notification, positioner)](https://v2.tauri.app/plugin/)
- [Keyring Crate](https://docs.rs/keyring/latest/keyring/)
- [Anthropic Claude API Models (June 2026)](https://platform.claude.com/docs/en/about-claude/models/overview)
- [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
