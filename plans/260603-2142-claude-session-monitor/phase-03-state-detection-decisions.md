# Phase 03 — State detection + decision extraction

**Context:** [plan.md](plan.md) · [JSONL analysis §B–E](../reports/analysis-260603-2142-jsonl-detection-extraction.md)
**Priority:** P0 · **Status:** planned · **v1:** yes · **Serves goals 1 & 2**

## Overview
Turn the parsed line buffers from phase-02 into the two things the user cares about: **(1) live state + "what's it doing"** per session, and **(2) a key-decisions timeline** so nothing is forgotten. Pure logic over `SessionRuntime`; produces `SessionSnapshot` + `Vec<DecisionEvent>`. Fully heuristic/offline (the LLM layer is phase-06).

## Key insights (from analysis report)
- **No explicit session-end event exists.** Lifecycle = last *timestamped* line's type + its age. Ignore non-timestamped state markers when timing.
- **State rule:** ACTIVE if `age(last_ts) ≤ 30s` AND last meaningful event not turn-terminal (last assistant `stop_reason=="tool_use"`, or unmatched tool_result, or `queue-operation` enqueue). IDLE if turn-terminal (`end_turn`/`turn_duration`/`away_summary`/`stop_hook_summary`) AND `age ≤ 30min`. ENDED otherwise (time-based).
- **Long-tool edge:** if last assistant `stop_reason=="tool_use"` with an *unmatched* later tool_result, keep ACTIVE up to ~10min cap (avoid false ENDED during slow Bash/Agent).
- `pendingBackgroundAgentCount > 0` ⇒ still busy even if main turn ended.
- **Status mapping:** last `tool_use` name → verb+object (Bash→`Running <cmd[0]>`, Edit→`Editing <file>`, Read→`Reading <file>`, Agent→`Spawning subagent <type>`, Skill→`Running skill <skill>`, AskUserQuestion→`Waiting for you`…). tool_use w/o matching tool_result = executing now.
- **AskUserQuestion answer ★** = following `type:user` line's top-level `toolUseResult.answers` (`{question→chosen label}`), matched by `tool_result.tool_use_id`. Highest-value decision signal.
- Decision ranking: 1) AskUserQuestion answers, 2) pr-link, 3) user prompts, 4) subagent spawns, 5) skills, 6) commits/writes, 7) away_summary (recap). ExitPlanMode absent locally → implement defensively, expect AskUserQuestion as de-facto plan approval.
- Subagent link: parent `toolUseResult.agentId` == `subagents/agent-<id>.jsonl`; live via `agent-<id>.meta.json.toolUseId`. `isSidechain` separates subagent vs main lines.

## Requirements
**Functional:** compute `SessionSnapshot{state, current_status, started_at, last_activity, title, branch, latest_prompt, decision_count, subagent_count, pending_background_agents}`; build ordered `Vec<DecisionEvent>` per session; recompute on dirty (debounced ≤1s). Decision extraction must be idempotent (re-tailing same lines must not duplicate decisions — key by `tool_use_id`/uuid/timestamp).
**Non-functional:** snapshot recompute reads only the rolling tail buffer for state/status; full-history decision scan runs lazily/async and is cached per session (avoid re-scanning 116MB).

## Architecture
```
analysis/session_state.rs : derive_state(runtime) -> SessionState + last_activity
analysis/status_map.rs    : current_status(runtime) -> String  (tool→verb table)
analysis/decisions.rs     : extract_decisions(lines) -> Vec<DecisionEvent>  (dedup by ref_id)
analysis/subagents.rs     : count + correlate subagents (glob meta.json + agentId)
```
`SessionRuntime.recompute()` → fills `snapshot` (cheap, tail-only) + merges any newly-seen decisions into a deduped `decisions` vec. `DecisionEvent{kind, timestamp, summary, detail, ref_id}` per report §G.

## Decision render templates
- QuestionAnswered → `chose "<label>" for "<header>"` (detail = full question)
- QuestionAsked (no answer yet) → `asked: "<header>"`
- PrOpened → `opened PR #<n> (<repo>)`
- UserPrompt → `you asked: "<first 80 chars>"`
- SubagentSpawned → `spawned <subagent_type>: <description>`
- SkillInvoked → `ran skill <skill>`
- Commit → `committed: <msg>` · FileWrite → `wrote <file>`
- AwaySummary → recap header (detail = content)

## Related code files
**Create:** `src-tauri/src/analysis/{mod,session_state,status_map,decisions,subagents}.rs`
**Modify:** `src-tauri/src/app_state.rs` (`SessionRuntime.recompute()`, cache decisions + dedup set), `src-tauri/src/transcript/tool_input.rs` (AskUserQuestion + answer extraction helpers)

## Implementation steps
1. `session_state.rs`: walk runtime buffer backward to last line with `timestamp`; classify terminal vs non-terminal; apply 30s/30min/10min-tool rules + `pendingBackgroundAgentCount` override. Return `(SessionState, last_activity)`.
2. `status_map.rs`: find last meaningful event; if assistant tool_use(s) take last; map via table; detect unmatched tool_result (executing now) vs result-present (thinking) vs end_turn (waiting). Truncate display ≤40 chars.
3. `decisions.rs`: scan lines for each signal; for AskUserQuestion, locate the answer on the following `user` line via `toolUseResult.answers` keyed by `tool_use_id`; dedup by stable `ref_id` (tool_use_id / pr number / uuid).
4. `subagents.rs`: subagent_count = distinct `agentId` in parent + glob of `<sid>/subagents/agent-*.jsonl`; live spawns via `meta.json.toolUseId` ↔ in-flight Agent tool_use.
5. Wire `recompute()` into the watcher dirty path; cache full-history decisions once, then only append from new tail lines.
6. Tests: feed redacted fixtures — (a) active mid-tool, (b) idle end_turn, (c) ended stale, (d) AskUserQuestion+answer linkage, (e) pr-link, (f) subagent spawn, (g) long-tool no-false-ENDED, (h) dedup on re-tail.

## Todo
- [ ] `derive_state` (30s/30min/10min-tool + pending-bg override)
- [ ] `current_status` tool→verb table + executing/thinking/waiting detection
- [ ] `extract_decisions` all 7 signals, AskUserQuestion answer linkage
- [ ] dedup by stable ref_id (idempotent re-tail)
- [ ] subagent count + live correlation
- [ ] lazy full-history scan + cache, append-only thereafter
- [ ] fixture tests (a–h)

## Success criteria
A running session shows correct ACTIVE + accurate "what it's doing"; finishing a turn flips to IDLE; stale → ENDED; an AskUserQuestion in a session yields a `chose "X" for "Y"` decision; re-tailing produces no duplicate decisions; slow 2-min Bash stays ACTIVE.

## Risks
- N=30s false-ENDED on long tools → mitigated by unmatched-tool_result cap; **validate against a real slow build** before trusting.
- `stop_hook_summary.stopReason` empty in samples → don't depend on it for "blocked"; treat as turn boundary only.
- Schema drift in `toolUseResult` across versions → guard all `Value` lookups.

## Security
All offline. Decision `summary`/`detail` may contain user text → keep in local state only; never logged to disk in plaintext beyond the user's own machine.

## Next steps
→ phase-04 emits snapshots/decisions to UI + auto-pops window on →ACTIVE transition.
