# Code Review — Claude Monitor v1 (post-fix)

Reviewer pass over Rust core (23 files) + React frontend (11 files). Overall: well-built; security/privacy sound (key 0600 never logged, only egress is opt-in OpenAI sending derived data not raw transcript, React escaping, read-only on transcripts). Verified Tauri v2 invoke camelCase→snake_case mapping correct; std Mutex not held across await.

All CRITICAL/HIGH + targeted MEDIUM/LOW resolved before declaring v1 done.

## Resolved

| # | Sev | Issue | Fix |
|---|-----|-------|-----|
| C1 | CRITICAL | `RwLock` write guard held across blocking file IO (100MB+ reads) for whole scan → UI/reactor stall | watcher/mod.rs `scan_once` split: **phase 1 reads files with no lock** → `Vec<Ingest>`; **phase 2** locks only for in-memory ingest+recompute. Liveness `mtimes` map moved out of registry. |
| H1 | HIGH | `from_utf8_lossy` per byte-chunk corrupts multi-byte chars at read boundaries → real lines dropped | tailer.rs now buffers **raw bytes** (`partials: Vec<u8>`), splits on `\n` byte, decodes only complete segments. Test added (emoji split across two reads). |
| H2 | HIGH | `DecisionExtractor` `events`/`seen`/`pending_questions` grow unbounded (persistent menubar agent) | `EVENTS_CAP=200`: drain oldest + evict their `ref_id` from `seen`; `pending_questions` entry removed once answered. |
| H3 | HIGH | `is_running_tool` scanned capped 60-line `recent`; tool result aging out → false Active→Ended, skips Idle | Open tool ids tracked **incrementally** in `ingest` (`open_tool_ids: HashSet`); `derive` takes a `running_tool` bool. Immune to `recent` cap. |
| M1 | MED | whole-second mtime coalesces same-second appends → defeats FSEvents fast path | `mtime_millis` (sub-second). |
| M3 | MED | AskUserQuestion answer linkage used only first tool_result id's header map | Merge header maps over all matching ids. |
| L1 | LOW | malformed ts → `unwrap_or(now)` fakes Active | `derive` only considers lines with a **parseable** ts; bad-ts → Ended. Test added. |
| Sec | MED | key file `create` then `chmod` → brief world-readable window | `OpenOptions...mode(0o600)` atomic create. |

## Deferred to phase 07 (noted, not blocking)
- M2: `discover()` does ~600 `readdir`/tick — throttle new-file discovery to ~5–10s, keep recompute-all. (C1 fix already moved it off-lock.)
- C1 residual: phase-1 IO still on async worker (multi-thread runtime absorbs it); could `spawn_blocking` for full reactor isolation.
- Session eviction: Ended runtimes persist in registry forever — add age-based drop.
- M4: OpenAI model free-text unvalidated (user's own key/account).

## Verification
- 9 Rust unit tests pass (tailer ×3 incl. UTF-8 boundary; session_state ×4 incl. bad-ts; decisions ×2). 0 warnings.
- Real-data smoke test: 25 snapshots built from live transcripts, 22 with metadata.

## Unresolved questions
1. Expected concurrent live session count (≈600 = total on disk; live is far fewer) — affects M2 priority.
2. Session eviction policy desired? (drop Ended > N hours from registry).
3. H3 cap sizing vs real tool round-trip length — incremental tracking sidesteps it, but worth a live check.
