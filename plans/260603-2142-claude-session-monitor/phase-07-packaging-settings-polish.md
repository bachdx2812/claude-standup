# Phase 07 — Settings, persistence, local-build polish

**Context:** [plan.md](plan.md) · [Tauri report §6,7,10](../reports/researcher-260603-2142-tauri-v2-macos-patterns.md)
**Priority:** P1 (v1.1 / ship) · **Status:** planned

## Overview
Make it configurable and daily-driver robust as a **locally-built app**: settings panel (idle window, auto-popup, autostart, calm mode, OpenAI key/model), persistent config + decisions cache, autostart at login, app/tray icons. **Code-signing + notarization are DEFERRED** — dev/personal use runs the unsigned local build (`cargo tauri dev` or local `tauri build` + Gatekeeper "open anyway"). Add signing later when the Apple account is supplied (steps documented, not executed now).

## Key insights
- For dev/personal use, **unsigned local build is enough** — `tauri build` produces a `.app`/`.dmg`; first launch needs right-click→Open (Gatekeeper). No notarization required to run locally.
- Accessory app config (`LSUIElement:true` + `activationPolicy:"accessory"`) already set in phase-01.
- `tauri-plugin-autostart` (`MacosLauncher::LaunchAgent`) for launch-at-login toggle.
- Persist config + decisions cache under `app_data_dir` (`~/Library/Application Support/<app>/`).
- **Signing later (deferred):** env `APPLE_SIGNING_IDENTITY`/`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` → Tauri auto-signs+notarizes. Document; wire `build-release.sh` to use them IF present, else produce unsigned.

## Requirements
**Functional:** Settings UI — auto-popup on/off + "notify only" mode, idle window minutes, active threshold seconds, calm/animation toggle, autostart toggle, OpenAI enable + key + model, "snooze popups 1h". Persist all to config file. Persist decisions cache so timelines survive restart. Autostart at login. Local build runs (unsigned OK).
**Non-functional:** config changes apply live (no restart) where feasible; fast cache load; reproducible local build via documented script.

## Architecture
```
src-tauri/src/settings.rs : Settings struct (serde) + load/save (app_data_dir) + defaults + live-apply
src-tauri/src/persist.rs  : decisions cache load/save (per-session json)
src/components/Settings.tsx: settings panel UI (shared with phase-06)
docs/deployment-guide.md  : local unsigned build steps + DEFERRED signing/notarization (when account ready)
scripts/build-release.sh  : tauri build wrapper — signs IF apple env present, else unsigned
```

## Implementation steps
1. `settings.rs`: `Settings` (auto_popup, popup_mode, idle_minutes, active_seconds, calm, autostart, llm_enabled, openai_model). Load on boot, defaults if absent; `set_settings` command saves + applies live (push thresholds into watcher/popup).
2. `persist.rs`: write decisions cache per session on change (debounced); load on boot to prefill timelines.
3. `Settings.tsx`: form bound to commands; autostart toggle → `tauri-plugin-autostart`; snooze sets a timed flag; OpenAI key+model+enable (from phase-06).
4. Tray menu: add Settings, Snooze 1h, Quit; window settings panel.
5. Icons: design tray icons (idle/active variants) + app icon; run `tauri icon`.
6. `build-release.sh`: run `tauri build`; if Apple signing env vars present → signed/notarized, else emit **unsigned** `.app`/`.dmg` (default for now).
7. `docs/deployment-guide.md`: (a) local unsigned build + Gatekeeper open-anyway (current path); (b) DEFERRED signing/notarization steps for when the Apple account is supplied; (c) autostart notes.
8. Polish: calm mode wiring, empty/error states, first-run welcome, idle-CPU pass (~0%).

## Todo
- [ ] `Settings` struct + load/save + live-apply
- [ ] decisions cache persistence (load on boot)
- [ ] Settings.tsx panel (popup/idle/active/calm/autostart/OpenAI)
- [ ] snooze + "notify only" popup mode
- [ ] tray menu (Settings/Snooze/Quit) + icon variants
- [ ] app/tray icons + `tauri icon`
- [ ] `scripts/build-release.sh` (unsigned default; signed if env present)
- [ ] `docs/deployment-guide.md` (local now; signing deferred)
- [ ] idle-CPU performance pass

## Success criteria
Settings persist across restarts and apply live; decisions timelines survive restart; autostart works; `build-release.sh` produces a runnable **unsigned** local `.app`/`.dmg` (open-anyway); idle CPU ≈ 0%. Signing path documented for later.

## Risks
- Unsigned app Gatekeeper friction → documented open-anyway; acceptable for dev/personal. Full sign/notarize when account provided.
- Autostart + accessory interplay → verify app starts hidden to tray on login.
- OpenAI key in config file (dev) → `0600`, never committed; Keychain once signed.

## Security
Config/cache in `app_data_dir`; OpenAI key in `0600` config file (dev) with explicit warning, Keychain later. No secrets in repo. Signing/notarization improves trust when added.

## Next steps
v1.1 complete (local build). Later: code-sign/notarize (account supplied), aquarium/factory visual modes, multi-machine, analytics, Windows/Linux.
