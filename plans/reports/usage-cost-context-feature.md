# Usage Feature: Per-session Cost (USD) + Context-window % + Overall Header

Feature adds, per Claude Code session: cumulative USD cost, context-window
usage %, last real model id; plus an overall usage pill in the app header
(Σ cost across visible sessions + busiest context %).

## Files changed

### Backend (Rust)
- `src-tauri/src/llm/pricing.rs` **(new)** — pricing tables, `Usage` struct,
  `parse_usage`, `real_model`, `message_cost_usd`, `DEFAULT_CONTEXT_LIMIT`,
  `Usage::context_used_tokens`. Unit tests included.
- `src-tauri/src/llm/mod.rs` — `pub mod pricing;`
- `src-tauri/src/model.rs` — added `cost_usd: f64`, `context_used_tokens: u64`,
  `context_limit: u64`, `model: Option<String>` to `SessionSnapshot` (serde camelCase).
- `src-tauri/src/app_state.rs` — added running accumulators (`cost_usd`,
  `context_used_tokens`, `model`) to `SessionRuntime`; new private
  `accumulate_usage(&Value)` called from `ingest()` on each assistant line;
  both snapshot constructors (`recompute` + `empty_snapshot`) set the new fields.

### Frontend (TS/React)
- `src/lib/types.ts` — mirrored the 4 new fields on `SessionSnapshot`.
- `src/lib/format.ts` — new helpers `formatCost`, `contextPct`, `contextColor` (DRY,
  shared by all 3 UI sites).
- `src/components/office-draw.ts` — `drawWorker` draws a tiny 8px muted second line
  (`$0.42 · 38%`) at `y + 20`; % colored amber > 80 / red > 95; only when `contextLimit > 0`.
- `src/components/Header.tsx` — new props `totalCost`, `maxContextPct`; renders a
  subtle `Σ $1.23 · 95%` pill (matches `.active-badge`).
- `src/App.tsx` — computes `totalCost = Σ costUsd` and `maxContextPct` over `visible`;
  passes both to `<Header>`.
- `src/components/DecisionTimeline.tsx` — `DetailUsage` sub-component shows
  `model · $cost · NN% ctx` muted line in the detail head.
- `src/styles.css` — `.usage-pill`, `.usage-ctx`, `.detail-usage` (dark theme, tabular-nums).

## Cost formula

Per assistant message with a real (non-`<synthetic>`) model + a `usage` dict:

```
cost = input_tokens      * inPrice
     + output_tokens     * outPrice
     + cache_read_tokens * cacheReadPrice
     + cacheWriteCost
```
`cacheWriteCost`: if `usage.cache_creation.{ephemeral_1h,ephemeral_5m}_input_tokens`
present → `1h*cacheWrite1h + 5m*cacheWrite5m`; else price all
`cache_creation_input_tokens` at the 5m rate. All prices USD per 1,000,000 tokens.
Table chosen by case-insensitive substring of `message.model`:
opus / sonnet / haiku; unknown → opus (so cost is never under-reported).

Hand-validated on the confirmed example turn (`claude-opus-4-8`,
in 2 / out 517 / cacheRead 188838 / 1h-write 1144):
`(2*15 + 517*75 + 188838*1.5 + 1144*30)/1e6 = $0.356382`; context used =
`2 + 1144 + 188838 = 189,984` → `95%` of 200k. Rust unit tests assert the same.

**Context %:** `context_used = input + cache_creation + cache_read` (output
excluded — not resident in the next prompt) from the LATEST real assistant turn
(latest-wins). `context_limit = 200_000` constant (some models support 1M; 200k
is the default — noted in code). UI computes `round(used/limit*100)`.

## Pricing source / caveat
`pricing.rs` header: *"Approximate public Anthropic pricing as of 2026-06; update
when rates change."* Data-driven (`PriceTable` consts), trivial to edit.

## Where accumulation happens
`SessionRuntime::ingest()` (`app_state.rs`) runs once per newly-tailed line
(watcher `scan_once` phase 2). For `type=="assistant"` lines it calls
`accumulate_usage`, which **adds** the turn's cost to the running `cost_usd`
(never re-scans the file) and **overwrites** `context_used_tokens` + `model`
with the latest turn's values. The tailer reads only appended bytes, so each
line is ingested exactly once → cost accumulates correctly and incrementally.

## Compile checks — BLOCKED (could not run)
`cargo check` (rustup stable) and `npx tsc --noEmit` could **not** be executed:
every bash command naming `cargo`, `rustup`, `npx`, `tsc`, `python3`, or paths
under `~/.claude` / `.rustup` was rejected by this session's permission layer
("Permission to use Bash has been denied"). Basic bash (`ls`, `echo`, writes to
`/tmp`) works; the denial is specific to those toolchain commands, and I did not
attempt to obfuscate command strings to bypass it (the denial explicitly forbids
workarounds). **The parent/orchestrator must run both checks.**

To run:
```
STABLE_BIN="$(dirname "$(rustup which --toolchain stable cargo)")"; export PATH="$STABLE_BIN:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
```

### Manual self-audit (in lieu of running)
- Rust: both `SessionSnapshot` constructors set all 4 new fields; `pricing` module
  registered in `mod.rs`; `serde_json` already a dep; `let-else` OK on edition 2021;
  `real_model` borrows from the `message` arg (not `self`) so `&mut self` in
  `accumulate_usage` has no borrow conflict.
- TS: no `SessionSnapshot` object literals exist in `src/` (all sites are type
  annotations over backend data), so the 3 new required fields break no construction
  site; all new `format.ts` helpers are imported where used; `null` narrowing guards
  precede every `contextColor()` / template use of `pct` / `maxContextPct`.

## Constraints honored
- No new deps; immutable patterns; small focused files; existing dark theme + style.
- Numbers come only from real transcript `usage` data — no mocks/hardcoded samples.
- Did not touch the `monitor` window label, Tauri event names, session
  state/detection logic, or `IsoOffice.tsx` layout (only `office-draw.ts` desk line).

## Unresolved questions
1. **Cannot self-verify compilation** in this session (toolchain commands denied).
   Need the orchestrator to run `cargo check` + `tsc` and confirm 0 errors.
2. **Overall context %** is shown as the **max** across visible sessions (each
   session has its own 200k window; summing %s isn't meaningful). Task allowed
   "max or total" — confirm max is the desired display.
3. Cost excludes any server-side tool/websearch surcharges and assumes the public
   per-token rates above; treat as an estimate, not a billing figure.
