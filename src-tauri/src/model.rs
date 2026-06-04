// Serializable types shared between the Rust core and the web frontend.
// Field names are camelCase to match the React/TS side directly.

use serde::Serialize;

/// What a Claude Code session is doing, derived from its transcript tail.
/// `Running`    = actively working (a tool/agent in flight, or generating now).
/// `NeedsInput` = Claude finished its turn or asked a question — your move.
/// `Idle`       = stepped away / nothing happening recently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Running,
    NeedsInput,
    Idle,
}

/// A point-in-time view of one session, pushed to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub id: String,
    pub project_path: String,
    pub project_slug: Option<String>,
    pub title: Option<String>,
    pub branch: Option<String>,
    pub version: Option<String>,
    pub state: SessionState,
    pub current_status: String,
    pub started_at: Option<String>,
    pub last_activity: Option<String>,
    pub last_activity_unix: Option<i64>,
    pub latest_prompt: Option<String>,
    pub decision_count: usize,
    pub subagent_count: usize,
    pub pending_background_agents: u32,
    pub line_count: usize,
    /// Cumulative USD cost across all real assistant turns in this session.
    pub cost_usd: f64,
    /// Tokens resident in the context window on the most recent real turn.
    pub context_used_tokens: u64,
    /// Context-window size used to compute the usage %. Default 200k.
    pub context_limit: u64,
    /// Last real (non-synthetic) model id observed (e.g. `claude-opus-4-8`).
    pub model: Option<String>,
    /// While `NeedsInput`: the agent's pending question / last message, for the
    /// attention notification + rail subtitle. `None` otherwise.
    pub pending_question: Option<String>,
}

/// Kinds of "key decisions" extracted from a transcript (ranked by value).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DecisionKind {
    UserPrompt,
    QuestionAnswered,
    PrOpened,
    SubagentSpawned,
    SkillInvoked,
    Commit,
    FileWrite,
    PlanApproved,
    AwaySummary,
}

/// One entry in a session's key-decisions timeline.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionEvent {
    pub kind: DecisionKind,
    pub timestamp: Option<String>,
    pub summary: String,
    pub detail: Option<String>,
    /// Stable id used to dedupe across re-tails (tool_use id / pr number / uuid).
    pub ref_id: Option<String>,
}

impl SessionSnapshot {
    /// Surface this session: real content, not a stub or a temp summary run.
    /// Recency/visibility filtering lives in the UI.
    pub fn is_displayable(&self) -> bool {
        self.is_real()
    }

    pub fn is_real(&self) -> bool {
        self.last_activity_unix.is_some() && !is_temp_path(&self.project_path)
    }
}

/// True for temp/system project paths we never want to surface — the monitor's
/// own `claude -p` summary runs, plus throwaway sessions launched in /tmp,
/// /var/folders, $TMPDIR (e.g. /tmp/claude-501), etc.
fn is_temp_path(path: &str) -> bool {
    path.contains("claude-monitor-summaries")
        || matches!(path, "tmp" | "T" | "claude-501")
        || path.starts_with("/tmp")
        || path.starts_with("/private/tmp")
        || path.starts_with("/var/folders")
        || path.starts_with("/private/var/folders")
}
