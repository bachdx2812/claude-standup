// Shared application state: a registry of live `SessionRuntime`s keyed by
// session id. The watcher task ingests new transcript lines into each runtime
// and calls `recompute()`; Tauri commands read the derived `snapshot`.
//
// Phase 02 fills metadata + a basic state/status. Phase 03 replaces the
// `derive_state` / `basic_status` heuristics and populates `decisions`.

use crate::analysis::{self, decisions::DecisionExtractor};
use crate::llm::pricing::{self, DEFAULT_CONTEXT_LIMIT};
use crate::model::{ActivityEvent, SessionSnapshot, SessionState};
use crate::transcript::content_block::{tool_result_ids, tool_uses};
use crate::transcript::RawLine;
use crate::watcher::discovery::{self, SessionFile};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU32};
use std::sync::Arc;
use tokio::sync::RwLock;

/// How many recent raw lines to retain per session (enough for state/status).
const RECENT_CAP: usize = 60;
/// Cap on the live tool-activity feed retained per session.
const ACTIVITY_CAP: usize = 50;

#[derive(Default)]
pub struct SessionRegistry {
    pub sessions: HashMap<String, SessionRuntime>,
}

/// Per-session ingest buffer + derived snapshot.
pub struct SessionRuntime {
    pub session_id: String,
    /// Transcript file path — session identity; used by the lazy full-history
    /// scan in phase 06.
    #[allow(dead_code)]
    pub path: PathBuf,
    pub dir_slug: String,
    /// Last derived state, for edge-detecting transitions (→ Active triggers popup).
    pub prev_state: Option<SessionState>,
    /// Cached subagent count (refreshed only when the file changes).
    pub subagent_count: usize,
    pub line_count: usize,
    pub recent: VecDeque<RawLine>,
    /// Non-question tool_use ids with no matching tool_result yet = a tool
    /// running now. Tracked incrementally so it survives `recent` being capped.
    pub running_tool_ids: HashSet<String>,
    /// An AskUserQuestion was asked and not yet answered (waiting for the user).
    pub pending_question: bool,

    // Derived metadata (latest-wins).
    pub project_path: Option<String>,
    pub slug: Option<String>,
    pub branch: Option<String>,
    pub version: Option<String>,
    pub title: Option<String>,
    pub latest_prompt: Option<String>,
    pub started_at: Option<String>,
    pub last_activity: Option<String>,
    pub last_activity_unix: Option<i64>,
    pub pending_bg: u32,

    /// Running USD cost, accumulated incrementally per assistant turn (never
    /// re-scanned from the whole file). See `llm::pricing`.
    pub cost_usd: f64,
    /// Context-window tokens from the LATEST real assistant turn (latest-wins).
    pub context_used_tokens: u64,
    /// Peak context tokens ever seen — picks the 200k vs 1M window tier.
    pub context_peak_tokens: u64,
    /// Last real (non-synthetic) model id seen, for pricing + UI display.
    pub model: Option<String>,

    /// Key-decisions extractor + timeline.
    pub extractor: DecisionExtractor,
    /// Live tool-activity feed (bounded ring of recent tool_use events).
    pub activity: VecDeque<ActivityEvent>,

    pub snapshot: SessionSnapshot,
}

impl SessionRuntime {
    pub fn new(sf: &SessionFile) -> Self {
        let label = discovery::slug_label(&sf.dir_slug);
        Self {
            session_id: sf.session_id.clone(),
            path: sf.path.clone(),
            dir_slug: sf.dir_slug.clone(),
            prev_state: None,
            subagent_count: 0,
            line_count: 0,
            recent: VecDeque::with_capacity(RECENT_CAP),
            running_tool_ids: HashSet::new(),
            pending_question: false,
            project_path: None,
            slug: None,
            branch: None,
            version: None,
            title: None,
            latest_prompt: None,
            started_at: None,
            last_activity: None,
            last_activity_unix: None,
            pending_bg: 0,
            cost_usd: 0.0,
            context_used_tokens: 0,
            context_peak_tokens: 0,
            model: None,
            extractor: DecisionExtractor::new(),
            activity: VecDeque::new(),
            snapshot: empty_snapshot(&sf.session_id, label),
        }
    }

    /// Fold one parsed line into the running metadata + recent buffer.
    pub fn ingest(&mut self, rl: RawLine) {
        self.line_count += 1;

        if let Some(cwd) = rl.cwd.as_ref() {
            self.project_path = Some(cwd.clone());
        }
        if let Some(s) = rl.slug.as_ref() {
            self.slug = Some(s.clone());
        }
        if let Some(b) = rl.git_branch.as_ref() {
            self.branch = Some(b.clone());
        }
        if let Some(v) = rl.version.as_ref() {
            self.version = Some(v.clone());
        }
        if let Some(t) = rl.ai_title.as_ref() {
            self.title = Some(t.clone());
        }
        if let Some(p) = rl.last_prompt.as_ref() {
            self.latest_prompt = Some(p.clone());
        }
        if let Some(n) = rl.pending_background_agent_count {
            self.pending_bg = n;
        }
        if rl.is_timestamped() {
            if self.started_at.is_none() {
                self.started_at = rl.timestamp.clone();
            }
            self.last_activity = rl.timestamp.clone();
            self.last_activity_unix = rl.unix_ts();
        }

        // Track running tools + pending questions incrementally so they survive
        // `recent` being capped. AskUserQuestion = waiting for the user (NeedsInput),
        // NOT a running tool.
        if rl.kind == "assistant" {
            if let Some(msg) = &rl.message {
                for tu in tool_uses(msg) {
                    if tu.name == "AskUserQuestion" {
                        self.pending_question = true;
                    } else if let Some(id) = tu.id {
                        self.running_tool_ids.insert(id.to_string());
                    }
                    self.activity.push_back(ActivityEvent {
                        tool: tu.name.to_string(),
                        detail: analysis::tool_detail(tu.name, tu.input),
                        timestamp: rl.timestamp.clone(),
                    });
                    while self.activity.len() > ACTIVITY_CAP {
                        self.activity.pop_front();
                    }
                }
                self.accumulate_usage(msg);
            }
        } else if rl.kind == "user" {
            if let Some(msg) = &rl.message {
                let results = tool_result_ids(msg);
                for id in &results {
                    self.running_tool_ids.remove(*id);
                }
                // A real user line (answer or new prompt) = you responded.
                let has_prompt = msg.get("content").and_then(|c| c.as_str()).is_some();
                if !results.is_empty() || has_prompt {
                    self.pending_question = false;
                }
            }
        }

        // Extract key decisions before the line ages out of `recent`.
        self.extractor.feed(&rl);

        // Only buffer real (timestamped) events. State markers (ai-title,
        // last-prompt, mode, permission-mode) repeat heavily — one file had 688
        // identical lines — and would otherwise push the last real event out of
        // the capped buffer, making the session look stateless (→ wrongly Idle →
        // hidden). Metadata from markers was already applied above.
        if rl.is_timestamped() {
            self.recent.push_back(rl);
            while self.recent.len() > RECENT_CAP {
                self.recent.pop_front();
            }
        }
    }

    /// Fold one assistant message's token usage into the running cost + context.
    /// Skips `<synthetic>` turns and messages with no usage dict (no real cost).
    /// Cost accumulates; context_used is latest-wins (the live window estimate).
    fn accumulate_usage(&mut self, message: &Value) {
        let Some(model) = pricing::real_model(message) else {
            return;
        };
        let Some(usage) = pricing::parse_usage(message) else {
            return;
        };
        self.cost_usd += pricing::message_cost_usd(model, &usage);
        let used = usage.context_used_tokens();
        self.context_used_tokens = used;
        if used > self.context_peak_tokens {
            self.context_peak_tokens = used;
        }
        self.model = Some(model.to_string());
    }

    /// Recompute the derived snapshot from current state. Cheap; runs per scan.
    pub fn recompute(&mut self) {
        let now = chrono::Utc::now().timestamp();
        let tool_running = !self.running_tool_ids.is_empty();
        let state = analysis::session_state::derive(
            &self.recent,
            self.pending_bg,
            tool_running,
            self.pending_question,
            now,
        );
        let current_status = analysis::status_map::current_status(&self.recent);
        // Only while waiting on you: extract the agent's question for the
        // attention notification + rail subtitle.
        let pending_question = if state == SessionState::NeedsInput {
            analysis::pending_question::pending_question(&self.recent)
        } else {
            None
        };
        let subagent_count = self.subagent_count;

        let label = self
            .project_path
            .clone()
            .unwrap_or_else(|| discovery::slug_label(&self.dir_slug));
        self.snapshot = SessionSnapshot {
            id: self.session_id.clone(),
            project_path: label,
            project_slug: self.slug.clone(),
            title: self.title.clone(),
            branch: self.branch.clone(),
            version: self.version.clone(),
            state,
            current_status,
            started_at: self.started_at.clone(),
            last_activity: self.last_activity.clone(),
            last_activity_unix: self.last_activity_unix,
            latest_prompt: self.latest_prompt.clone(),
            decision_count: self.extractor.events.len(),
            subagent_count,
            pending_background_agents: self.pending_bg,
            line_count: self.line_count,
            cost_usd: self.cost_usd,
            context_used_tokens: self.context_used_tokens,
            context_limit: pricing::context_tier_limit(self.context_peak_tokens),
            model: self.model.clone(),
            pending_question,
        };
    }
}

fn empty_snapshot(id: &str, label: String) -> SessionSnapshot {
    SessionSnapshot {
        id: id.to_string(),
        project_path: label,
        project_slug: None,
        title: None,
        branch: None,
        version: None,
        state: SessionState::Idle,
        current_status: "—".to_string(),
        started_at: None,
        last_activity: None,
        last_activity_unix: None,
        latest_prompt: None,
        decision_count: 0,
        subagent_count: 0,
        pending_background_agents: 0,
        line_count: 0,
        cost_usd: 0.0,
        context_used_tokens: 0,
        context_limit: DEFAULT_CONTEXT_LIMIT,
        model: None,
        pending_question: None,
    }
}

/// App-wide state managed by Tauri (`.manage`) and shared with the watcher task.
#[derive(Clone)]
pub struct AppState {
    pub registry: Arc<RwLock<SessionRegistry>>,
    /// Auto-show the window when a session becomes active.
    pub auto_popup: Arc<AtomicBool>,
    /// Unix seconds until which popups are snoozed (0 = not snoozed).
    pub snooze_until: Arc<AtomicI64>,
    /// Unix seconds of the last popup — debounce against focus-steal spam.
    pub last_popup: Arc<AtomicI64>,
    /// Live counts (running / needs-you) for the animated menubar pet.
    pub active: Arc<AtomicU32>,
    pub needs: Arc<AtomicU32>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(RwLock::new(SessionRegistry::default())),
            auto_popup: Arc::new(AtomicBool::new(true)),
            snooze_until: Arc::new(AtomicI64::new(0)),
            last_popup: Arc::new(AtomicI64::new(0)),
            active: Arc::new(AtomicU32::new(0)),
            needs: Arc::new(AtomicU32::new(0)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
