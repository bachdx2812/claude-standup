# Phase 01 — Scaffold: Tauri v2 menubar accessory

**Context:** [plan.md](plan.md) · [Tauri report](../reports/researcher-260603-2142-tauri-v2-macos-patterns.md)
**Priority:** P0 (foundation) · **Status:** planned · **v1:** yes

## Overview
Stand up the Tauri v2 project as a **menubar-only accessory app** (no Dock icon): tray icon, single pre-created hidden window, single-instance guard, optional autostart. Goal = `cargo tauri dev` launches a tray icon; clicking it toggles an (empty) window; no Dock icon; only one instance runs. Pure plumbing — no monitor logic yet.

## Key insights (from research)
- Accessory mode needs BOTH `app.macOS.activationPolicy: "accessory"` AND `bundle.macOS.infoPlist.LSUIElement: true`.
- Pre-create the hidden window in `setup()` (fast show) rather than on-demand.
- `tauri-plugin-single-instance` MUST be the first plugin registered; its callback focuses the existing window.
- `set_focus()` after `show()` is required on macOS or the window won't surface.
- Tray: `TrayIconBuilder` (`tauri::tray`); menu clicks → `on_menu_event`, icon clicks → `on_tray_icon_event` (separate handlers).

## Requirements
**Functional:** tray icon visible; left-click toggles window show/hide; tray menu has Show / Quit; second launch focuses first instance instead of opening new; no Dock icon; window starts hidden, non-resizable, sized ~880×600.
**Non-functional:** cold start < 1s; idle RAM < ~40MB; clean `cargo build` (no warnings-as-errors blockers).

## Architecture
```
src-tauri/src/main.rs
  Builder
    .plugin(single_instance::init(focus_cb))   // FIRST
    .plugin(autostart::init(...))
    .manage(AppState::default())               // empty for now
    .setup(|app| { build_tray(app); create_hidden_window(app); set_activation_policy(Accessory); })
    .invoke_handler([toggle_window])
```

## Related code files
**Create:**
- `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/build.rs`, `src-tauri/icons/*`
- `src-tauri/src/main.rs` — builder, plugins, setup
- `src-tauri/src/bridge/tray.rs` — `build_tray()`, tray event handlers
- `src-tauri/src/bridge/mod.rs` — module re-exports
- `src-tauri/src/app_state.rs` — `AppState` placeholder (`Arc<RwLock<SessionRegistry>>` stub)
- `src-tauri/capabilities/default.json` — permissions (tray, window, autostart, notification, single-instance)
- `src/index.html`, `src/main.ts`, `vite.config.ts`, `package.json` — minimal frontend ("Monitor booting…")

## Implementation steps
1. `npm create tauri-app@latest` (vanilla-ts template) → restructure to match plan tree. Pin Tauri v2 stable.
2. `tauri.conf.json`: window `{label:"monitor", visible:false, resizable:false, width:880, height:600, title:"Claude Monitor"}`; `app.macOS.activationPolicy:"accessory"`; `bundle.macOS.infoPlist.LSUIElement:true`.
3. Add deps: `tauri`, `tauri-plugin-single-instance`, `tauri-plugin-autostart`, `tauri-plugin-notification`, `tauri-plugin-positioner`, `serde`, `serde_json`, `tokio` (features `rt-multi-thread,macros,fs,time,sync`).
4. `tray.rs`: build tray with id `monitor-tray`, tooltip "Claude Monitor", menu [Show, Quit]; left-click → `toggle_window`; Quit → `app.exit(0)`.
5. `main.rs`: register single-instance FIRST (callback shows+focuses `monitor` window); create hidden window in `setup`; `app.set_activation_policy(ActivationPolicy::Accessory)`.
6. `toggle_window` command: if visible → hide; else show + `set_focus`; position near tray via positioner.
7. `cargo tauri dev`; verify all acceptance criteria.

## Todo
- [ ] Tauri v2 vanilla-ts project, restructured to plan tree
- [ ] Accessory config (no Dock icon) verified
- [ ] Tray icon + menu (Show/Quit)
- [ ] Hidden window pre-created, toggles on tray click
- [ ] Single-instance guard focuses existing window
- [ ] Autostart plugin wired (toggle deferred to phase-07)
- [ ] `capabilities/default.json` permissions set
- [ ] `cargo tauri dev` runs clean

## Success criteria
Tray icon shows; no Dock icon; click toggles window; Quit exits; 2nd launch focuses 1st; clean dev build.

## Risks
- Plugin version skew vs Tauri v2 core → pin compatible versions from current docs.
- Accessory + LSUIElement misconfig → Dock icon leaks. Test explicitly.

## Security
No secrets yet. `capabilities` least-privilege (only needed plugin perms).

## Next steps
→ phase-02 (core engine) plugs the watcher into `AppState`.
