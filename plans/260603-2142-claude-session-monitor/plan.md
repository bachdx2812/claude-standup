---
title: Claude Session Monitor — macOS native (Tauri + Rust)
slug: claude-session-monitor
created: 2026-06-03 21:42
updated: 2026-06-03 22:15
status: v1-complete
mode: hard
blockedBy: []
blocks: []
owner: bachdx
---

# Claude Session Monitor

Menubar-resident macOS app that watches every active Claude Code session, shows a **fun Mission-Control dashboard** of what each session is doing, captures **key decisions** so you never forget what a session decided, and **auto-pops the monitor** the moment a session goes active. Monitoring only — never intervenes in sessions.

## Decisions (locked)

| Topic | Choice |
|---|---|
| Stack | **Tauri v2** — Rust core (24/7 watcher) + **React** web UI (fun visuals) |
| Visual | **Mission Control** dashboard — animated session cards + activity stream + radar |
| Decisions | **Hybrid** — heuristic live extraction + on-demand LLM summary (**OpenAI**, key provided later) |
| v1 scope | **All 3 goals incl. LLM** (monitor + auto-popup + heuristic decisions + on-demand OpenAI recap) |
| Distribution | Dev phase = **local unsigned build** (`cargo tauri dev` / local `.app`). Code-sign/notarize **deferred** until Apple account supplied. |

## Data source (verified, see reports/)

- Source: `~/.claude/projects/<slug>/<session-id>.jsonl` (append-only, 1 JSON/line) + nested `subagents/agent-*.jsonl`.
- **No intervention needed** — just tail transcripts. Use `.cwd` for real path (dir-decode is lossy). Title = last `aiTitle`. Active/Idle/Ended from last *timestamped* line. AskUserQuestion answers in following `user` line's `toolUseResult.answers`.
- Full findings: `plans/reports/analysis-260603-2142-jsonl-detection-extraction.md` + `plans/reports/researcher-260603-2142-tauri-v2-macos-patterns.md`.

## Phases

| # | Phase | Goal served | v1? | Status |
|---|---|---|---|---|
| 01 | [Scaffold — Tauri menubar accessory](phase-01-scaffold-tauri-menubar.md) | foundation | ✅ | ✅ done |
| 02 | [Core engine — discovery, tail, parse, registry](phase-02-core-engine-watch-parse.md) | 1 | ✅ | ✅ done |
| 03 | [State detection + decision extraction](phase-03-state-detection-decisions.md) | 1,2 | ✅ | ✅ done |
| 04 | [Bridge + auto-popup + notifications](phase-04-bridge-autopopup-notify.md) | 3 | ✅ | ✅ done |
| 05 | [Mission Control UI (React + GSAP)](phase-05-mission-control-ui.md) | 1,2 | ✅ | ✅ done |
| 06 | [Hybrid LLM session summary (OpenAI)](phase-06-llm-summary-hybrid.md) | 2 | ✅ | ✅ done |
| 07 | [Settings, persistence, local-build polish](phase-07-packaging-settings-polish.md) | ship | ◑ v1.1 | ☐ planned |

**v1 (01→06) COMPLETE** — implemented, compiles clean (rustc 1.96 via `./scripts/dev.sh`), 7 Rust unit tests pass, frontend builds. Phase 07 = settings/persistence/local-build polish (fast-follow; signing deferred to when Apple account supplied).

**Run it:** `./scripts/dev.sh` (NOT bare `cargo tauri dev` — Homebrew rustc 1.86 is too old; the wrapper pins rustup stable).

**Code review:** independent pass done — 1 CRITICAL + 3 HIGH + 4 MED/LOW fixed (lock-across-IO, UTF-8 line corruption, unbounded decision growth, tool-detection vs recent-cap, sub-second mtime, key-file race). See [code-review report](../reports/code-review-260603-2340-claude-monitor-v1.md). 9 unit tests pass.

## Architecture (one glance)

```
~/.claude/projects/  ──FSEvents+mtime poll──▶  Rust watcher (tokio)
                                                  │ tail new bytes (per-file offset)
                                                  │ parse RawLine (permissive serde)
                                                  ▼
                            analysis: state(Active/Idle/Ended) + status + decisions
                                                  │ Arc<RwLock<SessionRegistry>>
                              ┌───────────────────┼─────────────────────┐
                       emit("session-update")  tray title=N active   auto-show window
                              ▼                                          (on →Active)
                  React UI (Vite+TS+GSAP) — Mission Control: cards · stream · radar · decisions
                                                  │ on-demand
                                                  ▼  Tauri cmd → reqwest → OpenAI (key: dev=config/env, later=Keychain)
                                             LLM session summary
```

## Key dependencies / risks

- **notify** crate API differs across versions — pin current, follow docs (researcher snippet was dated).
- **Active-state heuristic** N=30s has a long-running-tool edge case → mitigate with unmatched-`tool_result` ACTIVE cap (~10 min). Validate against a real slow build. (phase-03)
- **OpenAI key** = dev: read from config file / env (`OPENAI_API_KEY`); move to Keychain once app is signed (phase-06/07). Key supplied by user later — feature degrades gracefully without it.
- **FSEvents coalescing** → never rely on FSEvents alone; mtime poll is the source of truth. (phase-02)
- Huge transcripts (up to 116MB) → byte-offset tail only, never full re-read. (phase-02)
- **No signing in dev** → local build runs via Gatekeeper "open anyway"; full sign/notarize deferred. (phase-07)

## Out of scope (v1)

Windows/Linux, session intervention/control, multi-machine sync, historical analytics dashboards, auth, code-signing/notarization (until account provided). Keep YAGNI.
