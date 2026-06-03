# Phase 02 — Core engine: discovery, tail, parse, registry

**Context:** [plan.md](plan.md) · [JSONL analysis](../reports/analysis-260603-2142-jsonl-detection-extraction.md)
**Priority:** P0 · **Status:** planned · **v1:** yes · **Serves goal 1**

## Overview
The Rust data engine. Discover all session transcripts under `~/.claude/projects/`, watch for changes (FSEvents + mtime poll), **incrementally tail** only newly-appended bytes (files up to 116MB — never full re-read), parse each line with a permissive serde model, and maintain an `Arc<RwLock<SessionRegistry>>`. Output: a list of raw parsed lines per session feeding phase-03. No UI yet — verify via unit tests + a debug `list_sessions` command/log.

## Key insights (from analysis report)
- **Append-only, offsets stable.** Per-file byte-offset tail: `seek(offset)` → read to EOF → split `\n` → parse complete lines → buffer trailing partial fragment. Advance offset only past last `\n`.
- **mtime is the cheap liveness pre-filter** — only tail files whose mtime advanced. FSEvents is just a wakeup (it coalesces; don't trust it alone).
- **`.cwd` is authoritative** for the real project path; directory-name decode is lossy (proven by worktree case) → use only as label fallback.
- State markers (`last-prompt`, `ai-title`, `mode`, `permission-mode`) have **no timestamp** and repeat — never use them for timing; `aiTitle`/`lastPrompt` = take the latest.
- Permissive serde: `Option`-heavy `RawLine` + `#[serde(flatten)] extra`, `message`/`toolUseResult` as `serde_json::Value`. NOT a `#[serde(tag="type")]` enum (schema drift 2.1.119→2.1.161 would hard-fail).

## Requirements
**Functional:** enumerate sessions (main `.jsonl` only, exclude `subagents/`); detect new/changed/added files live; tail incrementally with stable offsets; tolerate one partial trailing line; handle truncation/rotation (size shrink → reset offset to 0); never panic on unknown `type`/version.
**Non-functional:** parse must never block the Tauri main thread (runs in tokio task); CPU near-idle when no sessions active; bounded memory (don't retain full transcripts — keep rolling tail window + derived snapshot).

## Architecture
```
watcher/discovery.rs : scan ~/.claude/projects/*/*.jsonl  → SessionFile{path, session_id, dir_slug}
watcher/fs_watch.rs  : notify(RecursiveMode) + notify-debouncer-full → wakeup tx
                       + interval(1s) mtime poll for known files
watcher/tailer.rs    : Tailer{ offsets: HashMap<PathBuf,u64> } → read_new_lines(path)->Vec<String>
transcript/raw_line.rs : RawLine (permissive serde) + parse_line(&str)->Option<RawLine>
transcript/content_block.rs : ContentBlock enum (Text|Thinking|ToolUse|ToolResult|Image)
transcript/tool_input.rs    : typed getters (bash_cmd, file_path, subagent_type, skill, askq…)
app_state.rs : SessionRegistry{ sessions: HashMap<String, SessionRuntime> }, Arc<RwLock<>>
```
`SessionRuntime` holds: file path, offset, rolling recent-lines buffer (cap ~200), partial-line fragment, and the derived `SessionSnapshot` (filled in phase-03).

Tokio loop: wakeup OR 1s tick → for each file with advanced mtime → `tailer.read_new_lines` → `parse_line` each → push to runtime buffer → mark dirty for phase-03 recompute.

## Related code files
**Create:** `src-tauri/src/watcher/{mod,discovery,fs_watch,tailer}.rs`, `src-tauri/src/transcript/{mod,raw_line,content_block,tool_input}.rs`
**Modify:** `src-tauri/src/app_state.rs` (real `SessionRegistry`/`SessionRuntime`), `src-tauri/src/main.rs` (spawn watcher task in `setup`, `.manage` state)

## Implementation steps
1. `discovery.rs`: glob `~/.claude/projects/*/` then `*.jsonl` (skip `subagents` subdir). Resolve `~` via `dirs` crate. Return `Vec<SessionFile>`.
2. `tailer.rs`: `read_new_lines(path)` — open, `seek(Start(offset))`, read to end into String, split on `\n`; last element without trailing `\n` → stash as fragment, prepend next call; update offset to last newline boundary. Detect `len < offset` → reset to 0 (rotation).
3. `raw_line.rs`: implement `RawLine` exactly per analysis report §G (camelCase rename, all `Option`, `#[serde(flatten)] extra`, `message`/`tool_use_result` as `Value`). `parse_line` = `serde_json::from_str` returning `None` on error (log at trace).
4. `content_block.rs` + `tool_input.rs`: lazy parsers over `message.content[]` and tool `input` (only call when phase-03 needs them).
5. `fs_watch.rs`: notify recursive watch on projects root + debouncer; also a `tokio::time::interval(1s)` mtime scan. Both feed a `tokio::sync::mpsc` of "files possibly changed".
6. `app_state.rs`: `SessionRegistry` + `SessionRuntime`; methods `upsert_file`, `push_lines`, `snapshot_all`.
7. `main.rs`: in `setup`, `tokio::spawn` the watcher loop with cloned `AppHandle` + `Arc<RwLock<SessionRegistry>>`.
8. Debug command `list_sessions()` → returns `[{session_id, path, line_count, last_raw_type}]`; log on change.
9. Unit tests: tail across simulated appends; partial-line handling; rotation reset; permissive parse of a sampled (redacted) line corpus incl. unknown `type`.

## Todo
- [ ] discovery scan (exclude subagents)
- [ ] byte-offset incremental tailer + partial-line + rotation
- [ ] permissive `RawLine` serde model + `parse_line`
- [ ] lazy `ContentBlock` / tool-input parsers
- [ ] notify + debouncer + 1s mtime poll → mpsc
- [ ] `SessionRegistry` / `SessionRuntime` in `Arc<RwLock>`
- [ ] watcher tokio task spawned in setup
- [ ] debug `list_sessions` command
- [ ] unit tests (tail, partial, rotation, parse-drift)

## Success criteria
Start app with live sessions running → `list_sessions` lists them with growing line counts; appending to a transcript shows new lines within ~1–2s; a 116MB file never causes a full read (offset tail only); unknown `type` lines don't crash; tests green.

## Risks
- **notify** API differs by version → pin current; keep fs_watch isolated so swapping is cheap. mtime poll is the real safety net.
- Symlinks/worktrees under projects/ → resolve via `.cwd`, not path math.
- Many files (600+) → glob + mtime stat is cheap; only tail the few that changed.

## Security
Read-only access to user's own `~/.claude/projects`. Never write back. No transcript content leaves the machine in this phase.

## Next steps
→ phase-03 consumes `SessionRuntime` buffers to derive state, status, decisions.
