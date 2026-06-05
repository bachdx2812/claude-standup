# Changelog

All notable changes to Claude StandUp are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.0] - 2026-06-05

### Added

- **Reactions** — the office reacts to what your agents do:
  - **Confetti** bursts over a desk the moment a session lands a new key
    decision (commit, PR, file write, …).
  - **Sweat** drops appear on a worker when its context window is ≥90% full.
- **Progression** — lightweight, local-only gamification (pure flavour, never
  affects monitoring):
  - Per-project **XP + seniority levels** (Junior → Mid → Senior → Staff →
    Principal) earned from key decisions, shown as `Lv N` on session cards.
  - **Daily-use streak** chip (🔥) in the header.
  - **"Employee of the day"** crown (👑) on the highest-spend session.

### Changed

- Panel entrances animate in (reduced-motion respected); the identity panel
  re-fades when you switch agents.

## [1.3.0] - 2026-06-04

### Added

- **Fun office** — the office is livelier while you work:
  - Each desk lamp is the session's **status light** (green = running, amber =
    waiting on you, grey = idle) with a coloured glow pool; the room dims after 7pm.
  - **Poke an agent** (click) and it pops a witty one-liner in its bubble.
  - **Konami code** (↑↑↓↓←→←→ B A) triggers an 8-second disco party.

### Changed

- **Clearer workers** — redrawn over-the-shoulder with lit dual monitors, bigger
  and higher-contrast. Dropped the office header text, the boss-assignment floor
  oval, the cryptic "+N" subagent suffix, and the raised-hand cue. Empty status
  now reads "Processing".

## [1.2.0] - 2026-06-04

### Added

- **Native macOS fullscreen** — the app now uses a regular activation policy, so
  the green title-bar button enters fullscreen and a Dock icon appears. Clicking
  the Dock icon reopens the window; the menubar tray still works.

### Removed

- **Summary-model setting** — the optional summary-model override is gone;
  summaries always use the local `claude` CLI default model.

### Changed

- **App-window polish** — WCAG-AA muted text, calmer (non-uppercase) section
  labels, tactile press + keyboard focus rings, a summary-column identity header,
  brighter office canvas text, and a blank native title bar (removes the duplicate
  "Claude StandUp").

## [1.1.0] - 2026-06-04

### Added

- **Attention routing** — the menubar tray shows a `🔔N` badge when sessions need
  your input, and a notify-only desktop notification fires the moment a session
  hands back to you (including Running → NeedsInput, which previously fired
  nothing), carrying the agent's pending question. A pinned "Needs you" group sits
  atop the session rail, each card showing the question.

### Fixed

- **Update check** — the "Check for updates" button no longer closes the settings
  popover; it shows inline status (checking / up to date / failed) instead of
  native alerts. The launch auto-check is now silent.

### Changed

- **Readability & affordance** — lifted muted text to WCAG AA on the dark theme,
  looser summary line-height, tactile `:active` press and keyboard `:focus-visible`
  rings on cards and buttons.
- **Landing page** — removed AI-design tells, moved facts to chips, added card
  accents.

## [1.0.0] - 2026-06-04

Initial release.

### Added

- **Office view** — each active Claude Code session is a pixel employee at a desk
  with a live status bubble. Responsive grid that fits the window and only scrolls
  when desks genuinely overflow.
- **Boss (you)** — sending a prompt to any session beams it to that desk with a
  comic speech bubble, so you remember what you asked each agent to do.
- **Session states** — Running / Needs Input / Idle, color-coded; an animated
  "z Z Z" once a session has been idle for 5+ minutes.
- **Cost + context** — per-session USD cost (from transcript token usage) and a
  context-window HP bar that's aware of the 200k vs 1M model windows; an overall
  usage pill in the header.
- **Key decisions timeline** — prompts answered, PRs opened, subagents spawned,
  skills invoked, commits, file writes, plan approvals.
- **Auto summaries** — short per-session summaries via the local `claude` CLI
  (running sessions refresh every 30s), rendered as markdown.
- **Layout** — sessions list (left), office (center), checked-session summary
  (right), and a drag-resizable detail footer (session info + key decisions).
- **Live wall clock** showing the machine time.
- **macOS app** via Tauri v2 (Rust core + React frontend), with local dev/build
  scripts that pin the rustup stable toolchain.
- **Internationalization** — English + Tiếng Việt, switchable in Settings (persisted).
- **Persistent settings** — auto-popup + summary model survive restarts.
- **Auto-update** — in-app updates via the Tauri updater against signed GitHub
  Releases, with a "Check for updates" action and the app version shown in Settings.
- **Performance** — the office canvas idles at a few fps when nothing animates, the
  watcher caches its directory walk, and the `claude` binary/PATH lookup is cached.

### Notes

- Sessions are selected by a recency window (1 / 3 / 12 / 24 h) — no hooks or
  process scanning, so it works with any terminal or IDE.
- The app reads `~/.claude/projects/**/*.jsonl` read-only and shells out to
  `claude -p` for summaries. Nothing else leaves your machine.

[Unreleased]: https://github.com/bachdx2812/claude-standup/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/bachdx2812/claude-standup/releases/tag/v1.0.0
