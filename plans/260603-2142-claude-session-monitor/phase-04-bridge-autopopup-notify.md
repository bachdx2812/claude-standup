# Phase 04 — Bridge + auto-popup + notifications

**Context:** [plan.md](plan.md) · [Tauri report §2,3,8](../reports/researcher-260603-2142-tauri-v2-macos-patterns.md)
**Priority:** P0 · **Status:** planned · **v1:** yes · **Serves goal 3 (auto-popup)**

## Overview
Connect the Rust engine to the UI and implement **the headline behavior: when any session transitions to ACTIVE, automatically surface the monitor window.** Expose Tauri commands for the frontend to fetch state, stream live updates via events, keep the tray title showing the active-session count, and fire a system notification on new activity.

## Key insights (from research)
- `AppHandle::emit("event", payload)` broadcasts JSON to all windows; cheap to clone `AppHandle` into the tokio watcher. Throttle/batch high-frequency emits.
- For LLM token streaming later, `tauri::ipc::Channel` exists (phase-06); session updates use plain `emit`.
- `WebviewWindow::show()` then **`set_focus()`** (required on macOS) surfaces the window; position via `tauri-plugin-positioner`.
- Notifications need permission on first use; no click callback in v2 (use tray/window focus instead).
- Don't emit while holding the `RwLock` (deadlock risk) — snapshot, drop lock, then emit.

## Requirements
**Functional:**
- Commands: `get_sessions()→Vec<SessionSnapshot>`, `get_decisions(session_id)→Vec<DecisionEvent>`, `get_session_detail(session_id)`, `set_auto_popup(bool)`, `toggle_window()`.
- Event `sessions-update` emitted on registry change (throttled ~250–500ms) with the full snapshot list (small payload — no transcripts).
- **Auto-popup:** on any session edge `not-active → ACTIVE`, if auto-popup enabled, `show()+set_focus()` the monitor window. Debounce so a burst of activations pops once. Respect a user "snooze/disable" toggle.
- Tray title/tooltip reflects active count (e.g. `●2`); tray icon variant when ≥1 active.
- Notification on new ACTIVE session (rate-limited; not on every tool step).
**Non-functional:** auto-popup must not steal focus repeatedly (anti-annoyance: once per active-burst, configurable); event payloads stay small (snapshots only, decisions fetched on demand).

## Architecture
```
bridge/events.rs   : emit_sessions(app, &snapshots)  (throttled)
bridge/commands.rs : get_sessions / get_decisions / get_session_detail / set_auto_popup / toggle_window
bridge/tray.rs     : update_tray(app, active_count)  (title + icon)
bridge/popup.rs    : maybe_auto_popup(app, transitions)  (edge-detect + debounce + snooze)
```
Watcher loop (phase-02/03), after `recompute`, computes the diff of states vs previous tick → passes transitions to `popup.rs` + `events.rs` + `tray.rs`. Previous-state map lives in registry.

## Auto-popup logic
```
for each session: prev_state vs new_state
  if new_state==ACTIVE and prev_state!=ACTIVE: collect as activation
if activations not empty and auto_popup_enabled and not snoozed:
    debounce(1.5s): show()+set_focus()+position; notify(once) "N session(s) active"
```

## Related code files
**Create:** `src-tauri/src/bridge/{events,commands,popup}.rs`
**Modify:** `src-tauri/src/bridge/tray.rs` (`update_tray`), `src-tauri/src/main.rs` (register commands, pass AppHandle to loop), `src-tauri/src/app_state.rs` (prev-state map, `auto_popup`/`snooze` flags), frontend `src/lib/tauri-events.ts` (listen+invoke wrappers)

## Implementation steps
1. `events.rs`: `emit_sessions` with a min-interval throttle (store last-emit instant in state); payload = `Vec<SessionSnapshot>` (serde Serialize).
2. `commands.rs`: implement the 5 commands reading `tauri::State<Arc<RwLock<SessionRegistry>>>`; `get_decisions` returns cached vec for a session.
3. `popup.rs`: edge-detect activations from the transition diff; debounce; `show()+set_focus()`; positioner placement; honor `auto_popup`/`snooze`.
4. `tray.rs`: `update_tray` sets title `●{n}` (empty when 0) + swaps icon for active state.
5. Watcher loop: after recompute → build transitions → call popup/events/tray (snapshot then drop lock before emit).
6. Frontend `tauri-events.ts`: `onSessionsUpdate(cb)` (listen), `fetchSessions()`, `fetchDecisions(id)`, `setAutoPopup(b)` (invoke). Wire a temporary console render to verify end-to-end before phase-05 UI.
7. Manual test: start a Claude session in another project → monitor window auto-pops, tray shows `●1`, notification fires once.

## Todo
- [ ] `emit_sessions` throttled event
- [ ] 5 Tauri commands
- [ ] auto-popup edge-detect + debounce + snooze/disable
- [ ] tray active-count title + icon variant
- [ ] rate-limited new-active notification
- [ ] frontend listen/invoke wrappers (temp console render)
- [ ] end-to-end manual test (real session triggers popup)

## Success criteria
Launching a Claude session elsewhere makes the monitor window appear within ~1–2s; tray shows correct active count; only one popup per activation burst; auto-popup can be disabled; no deadlocks; payloads small.

## Risks
- Focus-stealing annoyance → debounce + per-burst + user toggle + optional "notify only, don't raise" mode.
- Event spam from chatty sessions → throttle emits; decisions fetched on demand, not pushed.
- `set_focus` behavior on Spaces/fullscreen → test; consider `set_visible_on_all_workspaces`.

## Security
Commands expose only the user's own session metadata to the local webview. No remote calls in this phase.

## Next steps
→ phase-05 replaces the console render with the Mission Control UI.
