# Claude Code Transcript Format — Detection & Extraction Reference

Reverse-engineered from local files (macOS, user `macos`). Scope: 611 jsonl total; **114 main session files**, 28 `subagents/` dirs. All samples REDACTED/truncated. Aggregates from streaming line-by-line scans (huge files capped at 4k lines).

Path layout (confirmed):
- Main: `~/.claude/projects/<dir-slug>/<session-id>.jsonl`
- Subagent: `~/.claude/projects/<dir-slug>/<session-id>/subagents/agent-<agentId>.jsonl` + sibling `agent-<agentId>.meta.json`

## 0. Line taxonomy (evidence)

Top-level `type` counts (114 main files, sampled):

| type | count | timestamped? | role |
|---|---|---|---|
| attachment | 23181 | yes | hook output / tool aux (image, file) |
| assistant | 22152 | yes | model turn (content blocks) |
| user | 13204 | yes | human prompt OR tool_result carrier |
| last-prompt | 3992 | **NO** | state marker: latest prompt text |
| permission-mode | 3626 | **NO** | state marker |
| ai-title | 3087 | **NO** | state marker: session title |
| system | 2227 | yes | lifecycle events (subtypes below) |
| file-history-snapshot | 1846 | yes | file snapshot for undo |
| mode | 865 | **NO** | state marker (only ever `normal`) |
| queue-operation | 757 | yes | prompt queue enqueue/dequeue/remove |
| pr-link | 625 | yes | PR created |
| worktree-state | 47 | **NO** | git worktree mapping (NEW type) |

**CRITICAL nuance:** `last-prompt`, `mode`, `permission-mode`, `ai-title` carry **no `timestamp`** and are **re-emitted/rewritten** (one file had 688 identical `ai-title` lines). They are current-state markers, not events. First line is frequently `queue-operation`/`last-prompt`/`permission-mode` (no ts). → **Never use first/last *line* for timing; use first/last line that HAS a `timestamp`.**

Content blocks (`message.content[]`): tool_use 11898, tool_result 11895, thinking 5931, text 4593, image 214, document 6.
`message.stop_reason`: tool_use 20629, end_turn 1484, stop_sequence 15, max_tokens 2.
`version`: 2.1.119 → 2.1.161 (schema drift → see §G).

## A. Session identity & metadata

Authoritative source = any line with `timestamp` (user/assistant/system carry full envelope). State markers give title/prompt.

| Field | Path | Notes |
|---|---|---|
| session id | `.sessionId` / filename stem | filename stem == sessionId |
| cwd (real path) | `.cwd` on any timestamped line | **authoritative** |
| git branch | `.gitBranch` | often `"HEAD"` |
| version | `.version` | e.g. `"2.1.161"` |
| project slug | `.slug` | stable, 1/session; e.g. `typed-soaring-curry` |
| session start | **first line with `.timestamp`** | NOT literal first line |
| last activity | **last line with `.timestamp`** | NOT literal last line |
| human title | last `type:"ai-title"` → `.aiTitle` | repeated; take last |
| latest prompt | last `type:"last-prompt"` → `.lastPrompt` | string; `.leafUuid` = convo leaf |

**Directory-name decode — DO NOT rely on it.** Dir = cwd with `/`→`-`, leading `-`, BUT real dir names contain hyphens (`slot-game`) so decode is lossy. PROVEN: dir `...-slot-sugar-rush--claude-worktrees-builder-grid-step` naive-decodes wrong; real `.cwd` = `/Users/macos/apps/kerberos/slot-game/slot-sugar-rush/.claude-worktrees/builder-grid-step`. → **Read `.cwd`; dir-decode only as label fallback.** `--` = a `.`-prefixed segment / worktree marker.

`lastPrompt` only on `type:"last-prompt"`: `{type, lastPrompt, leafUuid, sessionId}`. Genuine human prompt also = `type:"user"` with `message.content` string && **`isMeta!=true`** (isMeta:true = injected caveats/command-output, not human).

## B. ACTIVE vs IDLE vs ENDED ★

**There is NO explicit session-end event.** No Stop/close/terminate line type — the transcript just stops growing. Lifecycle inferred from (a) last *timestamped* event type + (b) its age.

### system subtypes (lifecycle signals) — enumerated

| subtype | count | meaning | shape highlights |
|---|---|---|---|
| `turn_duration` | 838 | assistant turn finished | `{durationMs, messageCount, pendingBackgroundAgentCount?}` |
| `stop_hook_summary` | 837 | **Stop hook ran** (turn boundary) | `{hookCount, hookInfos[], hookErrors[], preventedContinuation, stopReason:"", hasOutput, level, toolUseID}` |
| `away_summary` | 270 | user stepped away; AI summarized | `{content:"Goal: …", slug}` ← **strong IDLE marker + recap text** |
| `api_error` | 144 | transient API error (retrying) | `{level:"error", cause, error, retryInMs, retryAttempt, maxRetries}` — NOT terminal |
| `compact_boundary` | 137 | context compacted | `{compactMetadata:{trigger,preTokens,postTokens,…}}` |
| `informational` | 1 | notice | `{content, level:"notice"}` |

End-of-finished-turn sequence (verified): `assistant(stop=end_turn)` → `attachment`(s) → `system/stop_hook_summary` → `system/turn_duration` → (later) `system/away_summary`. `stopReason` on stop_hook_summary is `""` here.

### Last-TIMESTAMPED-event distribution (114 sessions)
`attachment` 62, `system/away_summary` 20, `user` 11, `system/turn_duration` 6, `queue-operation` 5, `pr-link` 3, `assistant` 1. (Last *line* incl markers: `last-prompt` 61, `permission-mode` 29 — confirming markers trail real events.)

### Recommended heuristic
`last_ts` = ts of last line that has one.
```
ACTIVE  if age(last_ts) <= 30s
        AND last meaningful event NOT turn-terminal
            (last assistant.stop_reason=="tool_use"
             OR last event user/tool_result with no newer assistant
             OR last event queue-operation enqueue)
IDLE    if last meaningful event IS turn-terminal
            (assistant.stop_reason=="end_turn" OR system/turn_duration
             OR system/away_summary OR stop_hook_summary)
        AND age(last_ts) <= IDLE_WINDOW (recommend 30 min)
ENDED   age(last_ts) > IDLE_WINDOW  (pure time-based)
```
**N_active = 30s** (turns emit lines every few s; tool runs pause output up to ~30s). **IDLE_WINDOW = 30 min** (config). Pre-filter by file **mtime** before parsing.

**Long-tool edge:** a long single Bash/Agent (>30s no output) briefly looks ENDED. Mitigation: if last assistant `stop_reason=="tool_use"` with an *unmatched* tool_result, treat ACTIVE up to a longer cap (~10 min).

### mid-turn vs waiting vs done
- **Generating / tool running**: last assistant `stop_reason=="tool_use"`, no terminating system event after. A `tool_use` block with no matching later `tool_result` = that tool is *executing now* ("Running X"). Result present but no newer assistant = model *thinking next step*.
- **Waiting for user**: last assistant `stop_reason=="end_turn"`, OR AskUserQuestion tool_use with no result yet.
- **Done/idle**: end_turn / turn_duration / away_summary present and stale.

### `pendingBackgroundAgentCount`
On `type:"system"` (subtype turn_duration), values 1–2 = background/detached agents still running when turn ended. >0 ⇒ session still busy even if main turn shows end_turn.

### Live file behavior
Append-only confirmed: 114/114 files last-line parses OK and ends `\n`. Offsets stable, earlier bytes never rewritten. mtime updates per append. Partial trailing line possible mid-flush but rare → skip unparseable final line, retry next poll.

## C. "What is it doing right now" — status mapping

Take last timestamped meaningful line; if assistant with `tool_use` (or the just-finished tool's user/tool_result), map the tool; else map by stop_reason/system subtype.

tool_use block: `{type:"tool_use", id:"toolu_…", name, input:{…}}`. Per-tool `input` keys (verified):

| name | input keys | display field |
|---|---|---|
| Bash | `command`, `description` | first token of `command` |
| Read | `file_path` | basename(file_path) |
| Edit | `file_path`, `old_string`, `new_string`, `replace_all` | basename(file_path) |
| Write | `file_path`, `content` | basename(file_path) |
| Grep | `pattern`, `path`, `output_mode` | `pattern` |
| Agent | `subagent_type`, `description`, `prompt` | subagent_type + description |
| Skill | `skill` | `skill` |
| TaskCreate | `subject`, `description`, `activeForm` | activeForm |
| AskUserQuestion | `questions[]` | "Waiting for you" |

Status templates: Bash→`Running <cmd[0]>` · Read→`Reading <file>` · Edit→`Editing <file>` · Write→`Writing <file>` · Grep→`Searching "<pattern>"` · Agent→`Spawning subagent <type>` · Skill→`Running skill <skill>` · AskUserQuestion→`Waiting for you (question)` · thinking-only(stop=tool_use)→`Thinking…` · text(stop=end_turn)→`Replied · waiting for you` · away_summary→`Idle (stepped away)` · turn_duration→`Idle` · mcp__…→`Calling <last segment>`. Truncate display to ~40 chars; if multiple tool_use on one line use the last.

## D. KEY DECISION signals (ranked)

### 1. AskUserQuestion ★ — answer linkage NAILED
tool_use input:
```json
{"questions":[{"question":"<text>","header":"<short>","multiSelect":false,
  "options":[{"label":"Full runtime (Recommended)","description":"<…>"}, …]}]}
```
Answer is on the FOLLOWING `type:"user"` line (tool_result carrier), TWO places:
- (a) `message.content[]`→`tool_result.content` string: `Your questions have been answered: "<question>"="<selected label>", …`
- (b) **`toolUseResult` top-level field (same line)** — structured, BEST: `{"questions":[…], "answers": {"<full question text>":"<selected label>", …}}`

Match by `tool_result.tool_use_id == AskUserQuestion tool_use id`. **Use `toolUseResult.answers`**. Render: `chose "<label>" for "<header>"`.

### 2. User prompts — `last-prompt.lastPrompt` (current) + `type:"user"` string content w/ `isMeta!=true` (history). promptId links to resulting turn.
### 3. pr-link (HAS timestamp) — `{type:"pr-link", prNumber, prUrl, prRepository, timestamp}`. Render `Opened PR #<n> (<repo>)`.
### 4. Subagent spawn — Agent `input.{subagent_type,description}`; completion `toolUseResult.{status,agentId,agentType,totalDurationMs,totalTokens,totalToolUseCount}`.
### 5. Skill — tool_use `name:"Skill"`, `input.skill`; completion `toolUseResult.{success,commandName}`. Also `attributionSkill` on assistant lines.
### 6. Commits/writes — commit = Bash `command` contains `git commit`; Write→`toolUseResult.{filePath,structuredPatch}`; Edit `structuredPatch` has the hunk.
### 7. away_summary — `system/away_summary.content` = AI's own session-goal/state summary. Ideal "what did this session do" recap (270 instances).

**Plan approval (ExitPlanMode): NOT present anywhere (0 in all 611 files).** `type:"mode".mode` always `"normal"` — native plan mode unused on this machine. User approves plans via **AskUserQuestion** + `ck-plan`/`planning` skills. Implement ExitPlanMode defensively but expect AskUserQuestion as the de-facto plan-approval signal here.

**Timeline ranking:** 1) AskUserQuestion answers · 2) pr-link · 3) user prompts · 4) subagent spawns · 5) skills · 6) commits/writes · 7) away_summary (recap header).

## E. Subagent correlation (3 links, all verified)

Parent `toolUseResult.agentId` == subagent filename `agent-<agentId>.jsonl` (verified). 

| Link | parent side | subagent side |
|---|---|---|
| **agentId** (post-completion) | `toolUseResult.agentId` | filename `agent-<id>.jsonl`; `.agentId` on each line |
| **toolUseId** (live, pre-completion) | Agent `tool_use.id` | `agent-<id>.meta.json`→`.toolUseId` |
| **sessionId** | `.sessionId` | subagent lines share same parent `.sessionId` |

`agent-<id>.meta.json` = `{agentType, description, toolUseId}` written at spawn → use for **live** subagents (no toolUseResult yet). Subagent lines: `isSidechain:true` always; main-file lines `isSidechain:false` → clean filter. Subagent count = `len(glob(<sid>/subagents/agent-*.jsonl))`.

## F. Incremental parsing strategy

- **Append-only, offsets stable** (confirmed). Lines newline-terminated.
- **Per-file byte-offset tail:** store `path→last_offset`; `seek(offset)`, read to EOF, split `\n`, parse complete lines, buffer trailing partial fragment (prepend next read). Advance offset only past last `\n`.
- **Cheap liveness pre-filter:** stat mtime; only parse-tail files whose mtime advanced.
- **Snapshot without full read:** tail last ~128KB for last-event/ai-title/last-prompt/recent-decisions. Full scan only for complete decisions timeline (do lazily/async, cache).
- **Biggest files (offset-tail makes size irrelevant):** 116MB, 78MB, 60MB, 49MB, 43MB.
- Poll 1–2s for active files; back off when idle/ended.

## G. Recommended Rust model (serde)

**Use a permissive flat struct with `Option`/`#[serde(default)]` + `#[serde(flatten)] extra`, NOT `#[serde(tag="type")]` enum.** Reason: 12+ `type` variants, drift across 2.1.119→2.1.161; an internally-tagged enum hard-fails on unknown `type`. Keep `message`/`toolUseResult` as `serde_json::Value`, parse lazily per-tool. Dispatch on the `type` string at runtime.

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLine {
    #[serde(rename = "type")] pub kind: String,
    #[serde(default)] pub session_id: Option<String>,
    #[serde(default)] pub timestamp: Option<String>,   // absent on state markers
    #[serde(default)] pub cwd: Option<String>,          // AUTHORITATIVE path
    #[serde(default)] pub git_branch: Option<String>,
    #[serde(default)] pub version: Option<String>,
    #[serde(default)] pub slug: Option<String>,
    #[serde(default)] pub is_sidechain: Option<bool>,
    #[serde(default)] pub is_meta: Option<bool>,
    #[serde(default)] pub subtype: Option<String>,      // type=system
    #[serde(default)] pub ai_title: Option<String>,
    #[serde(default)] pub last_prompt: Option<String>,
    #[serde(default)] pub agent_id: Option<String>,
    #[serde(default)] pub pending_background_agent_count: Option<u32>,
    #[serde(default)] pub pr_number: Option<u64>,
    #[serde(default)] pub pr_url: Option<String>,
    #[serde(default)] pub pr_repository: Option<String>,
    #[serde(default)] pub attribution_skill: Option<String>,
    #[serde(default)] pub message: Option<Value>,           // {role,content[],stop_reason}
    #[serde(default)] pub tool_use_result: Option<Value>,   // AskUserQuestion.answers lives here
    #[serde(flatten)] pub extra: std::collections::HashMap<String, Value>,
}

pub enum SessionState { Active, Idle, Ended }

pub struct SessionSnapshot {
    pub id: String, pub project_path: String, pub project_slug: Option<String>,
    pub title: Option<String>, pub branch: Option<String>, pub version: Option<String>,
    pub state: SessionState, pub current_status: String,
    pub started_at: Option<String>, pub last_activity: Option<String>,
    pub latest_prompt: Option<String>,
    pub decision_count: usize, pub subagent_count: usize, pub pending_background_agents: u32,
}

pub enum DecisionKind {
    UserPrompt, QuestionAsked, QuestionAnswered, PrOpened,
    SubagentSpawned, SkillInvoked, Commit, FileWrite, PlanApproved, AwaySummary,
}

pub struct DecisionEvent {
    pub kind: DecisionKind, pub timestamp: Option<String>,
    pub summary: String,   // e.g. 'chose "Full runtime" for "Call gate depth"'
    pub detail: Option<String>, pub ref_id: Option<String>,
}
```
Parse `message.content[]` with a small `ContentBlock` enum (`Text|Thinking|ToolUse{name,input}|ToolResult{tool_use_id,content}|Image`) only when needed. `from_str::<RawLine>` must never panic on a new `type`/version.

## Unresolved questions
1. **N_active=30s** long-tool false-ENDED — mitigate via unmatched-tool_result ACTIVE cap (~10 min). Validate vs slow build.
2. **stop_hook_summary.stopReason empty** in all samples — does a *blocking* Stop hook populate it? Not observed.
3. **Live (pending) AskUserQuestion** frozen shape not captured; assume AskUserQuestion last event + no result ⇒ "waiting for you".
4. **ExitPlanMode result shape** unverifiable locally (0 occurrences).
5. **queue-operation semantics** (enqueue/dequeue/remove) lightly sampled — trailing `enqueue` ⇒ queued user input (ACTIVE-ish).
