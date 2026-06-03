// Permissive representation of a single transcript line.
//
// Deliberately NOT a `#[serde(tag = "type")]` enum: there are 12+ `type`
// variants and the schema drifts across Claude Code versions (2.1.119 ->
// 2.1.161). An `Option`-heavy struct with `#[serde(flatten)] extra` tolerates
// unknown types/fields instead of hard-failing. `message`/`toolUseResult` stay
// as raw `Value` and are parsed lazily per tool when needed.

use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
// Mirrors the on-disk transcript schema; some fields document the format and are
// not consumed yet (e.g. agent_id / is_sidechain for future subagent linking).
#[allow(dead_code)]
pub struct RawLine {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub is_sidechain: Option<bool>,
    #[serde(default)]
    pub is_meta: Option<bool>,
    /// `type == "system"` subtype: turn_duration / stop_hook_summary / away_summary / ...
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub ai_title: Option<String>,
    #[serde(default)]
    pub last_prompt: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub pending_background_agent_count: Option<u32>,
    #[serde(default)]
    pub pr_number: Option<u64>,
    #[serde(default)]
    pub pr_url: Option<String>,
    #[serde(default)]
    pub pr_repository: Option<String>,
    #[serde(default)]
    pub attribution_skill: Option<String>,
    /// `{ role, content[], stop_reason, usage }` — parsed lazily.
    #[serde(default)]
    pub message: Option<Value>,
    /// Where AskUserQuestion answers live (`toolUseResult.answers`).
    #[serde(default)]
    pub tool_use_result: Option<Value>,
    /// Catch-all so unknown/￼future fields never break deserialization.
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

impl RawLine {
    /// True if this line carries a real event timestamp. State markers
    /// (last-prompt / ai-title / mode / permission-mode) do NOT.
    pub fn is_timestamped(&self) -> bool {
        self.timestamp.is_some()
    }

    pub fn stop_reason(&self) -> Option<&str> {
        self.message.as_ref()?.get("stop_reason")?.as_str()
    }

    pub fn unix_ts(&self) -> Option<i64> {
        self.timestamp.as_deref().and_then(parse_ts_unix)
    }
}

/// Parse one JSONL line. Returns `None` on blank or malformed input — a single
/// bad/partial line must never abort tailing.
pub fn parse_line(s: &str) -> Option<RawLine> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    serde_json::from_str::<RawLine>(s).ok()
}

/// Parse an RFC3339 timestamp (e.g. `2026-06-03T21:43:00.123Z`) to unix seconds.
pub fn parse_ts_unix(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
}
