# Claude StandUp — Development Roadmap

Living document. Tracks phases beyond v1.0. Last updated: 2026-06-04.

## Vision

Claude StandUp watches active Claude Code sessions as a pixel-art office (each
session = an employee, the user = the boss). Today it is a **passive live
monitor**. The roadmap pushes it along three axes:

- **ACT** — close the loop from *notice* → *do* (the menubar should be useful without opening the window).
- **REMEMBER** — turn ephemeral live state into history (reports, analytics, archive).
- **CHARM** — the office visual is the differentiator; make it truthful and fun.

## Keystone: a persistence layer

The app currently keeps **live state only** — on window close, history is gone.
A single local persistence layer (store session snapshots over time) unlocks
three features at once: the StandUp report, cost analytics, and the session
archive. Build it once in v1.2; v1.3 consumes it. Attention routing (v1.1) and
office charm (v1.4) are independent and can land in any order.

## Data already available (no new parsing)

Per session the engine already parses: `costUsd`, `contextUsedTokens` /
`contextLimit`, `model`, `branch`, `projectPath`, `latestPrompt`, decision
events (`commit`, `prOpened`, `fileWrite`, `planApproved`, `skillInvoked`,
`subagentSpawned`, `questionAnswered`, …), `subagentCount`,
`pendingBackgroundAgents`, timestamps, `state`. Most "REMEMBER" features are
aggregation + storage, not new transcript parsing.

---

## Phases

### v1.0 — Shipped ✅
Live office, per-session cost + context %, key decisions, AI summary (local
`claude -p`), auto-popup + notifications, settings persistence, i18n (en/vi),
Tauri auto-update, open-source release infra.

### v1.1 — Attention routing  `[independent · quick win]`
**Status:** ✅ Implemented (local; built/release pending). Make the menubar useful without opening the window.
- Tray title badge `🔔N` when N sessions need input (Tauri tray `set_title`; app is already a menubar accessory).
- Native notification on **transition** into `needsInput` (track previous state per session, dedup — not on every poll).
- Pinned "Needs you" section at the top of the session rail.
- **Risk / unknown:** we store `latestPrompt` (the user's prompt), not the agent's pending question. Capturing the question text for the notification body needs a transcript check — verify before committing.

### v1.2 — Persistence + Cost analytics  `[FOUNDATION]`
**Status:** Planned. The keystone.
- Store layer: SQLite via `tauri-plugin-sql` — daily upsert per session / project / model: final cost, peak context, model, duration.
- **Gotcha:** `costUsd` is cumulative per session — persist the final/max per session, never the sum of snapshots (double-count bug).
- Analytics tab: spend over time, per-project, per-model, context-pressure trend. Prefer hand-drawn canvas (visual consistency with the office) or a tiny chart lib.
- Budget guardrail: `dailyLimitUsd` setting → notify on cross.

### v1.3 — Daily StandUp report  `[⭐ signature · needs v1.2]`
**Status:** Planned. The feature the name promises.
- Generate a digest for a period from persisted data: per agent — what was done (group decisions: commits / PRs / files / plans / skills), cost, outcome, timespan.
- LLM polish: feed decisions + summary to `claude -p` → a narrative ("auth-service: shipped login, 3 commits + 1 PR, $0.42, done").
- Output: in-app Reports view + export `.md` + optional Slack post (MCP / webhook) + "Standup ready" notification.
- Schedule: generate on the first launch of a new day + a manual button.

### v1.4 — Office charm / live activity  `[independent · ongoing polish]`
**Status:** Backlog.
- Current tool / file per agent ("editing auth.ts") from the latest transcript event → office animation per tool type.
- Stuck detection: same tool ×N / errors / no progress → employee sweats / turns red.
- Persistent desk + avatar per project (hash `projectPath` → stable index). Mood: context-full = stressed, commit = brief celebrate.
- **Risk / unknown:** live tool/file parse depends on the transcript event schema — needs a spike.

---

## Sequencing logic

1. **v1.1** ships value alone (low effort, daily payoff).
2. **v1.2** lays the keystone (persistence) with analytics as its first consumer.
3. **v1.3** lands the signature feature once historical data exists.
4. **v1.4** is continuous charm — incremental, drives marketing screenshots.

## Open unknowns (verify before/with planning)

1. **Agent-question text** for attention notifications — is the pending question recoverable from the transcript, or only the user's `latestPrompt`?
2. **Live tool/file parse** — transcript event schema for the in-progress tool call; needs a recon spike before v1.4.
