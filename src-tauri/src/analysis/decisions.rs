// Incremental extraction of "key decisions" from a transcript stream.
//
// Highest-value signal is AskUserQuestion: the chosen answer lands on the
// *following* `user` line as `toolUseResult.answers` ({question -> label}),
// linked to the question's `tool_use_id`. We also surface PRs, subagent spawns,
// skills, user prompts, commits/writes, plan approvals and away-summaries.
//
// `feed` is called once per ingested line; dedup by a stable `ref_id` keeps
// re-tailing idempotent.

use super::{basename, truncate};
use crate::model::{DecisionEvent, DecisionKind};
use crate::transcript::content_block::{tool_result_ids, tool_uses};
use crate::transcript::RawLine;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Cap on retained decision events per session. The app is a long-lived menubar
/// agent, so an unbounded vec would leak; the UI shows newest-first anyway.
const EVENTS_CAP: usize = 200;

#[derive(Default)]
pub struct DecisionExtractor {
    pub events: Vec<DecisionEvent>,
    seen: HashSet<String>,
    /// AskUserQuestion tool_use_id -> (question text -> header) for answer linkage.
    pending_questions: HashMap<String, HashMap<String, String>>,
}

impl DecisionExtractor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, rl: &RawLine) {
        match rl.kind.as_str() {
            "pr-link" => self.feed_pr(rl),
            "system" if rl.subtype.as_deref() == Some("away_summary") => self.feed_away(rl),
            "user" => self.feed_user(rl),
            "assistant" => self.feed_assistant(rl),
            _ => {}
        }
    }

    fn feed_pr(&mut self, rl: &RawLine) {
        let Some(n) = rl.pr_number else { return };
        let repo = rl.pr_repository.clone().unwrap_or_default();
        let summary = if repo.is_empty() {
            format!("opened PR #{n}")
        } else {
            format!("opened PR #{n} ({repo})")
        };
        self.push(
            DecisionKind::PrOpened,
            rl.timestamp.clone(),
            summary,
            rl.pr_url.clone(),
            format!("pr:{n}"),
        );
    }

    fn feed_away(&mut self, rl: &RawLine) {
        let content = rl
            .extra
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("");
        if content.is_empty() {
            return;
        }
        let summary = truncate(content.lines().next().unwrap_or(content), 80);
        let ref_id = format!("away:{}", rl.uuid.clone().unwrap_or_default());
        self.push(
            DecisionKind::AwaySummary,
            rl.timestamp.clone(),
            summary,
            Some(content.to_string()),
            ref_id,
        );
    }

    fn feed_user(&mut self, rl: &RawLine) {
        // 1) AskUserQuestion answer (highest value).
        if let Some(tur) = &rl.tool_use_result {
            if let Some(answers) = tur.get("answers").and_then(Value::as_object) {
                let ids = rl.message.as_ref().map(tool_result_ids).unwrap_or_default();
                // Merge header maps from every matching pending question (a batch
                // may answer more than one AskUserQuestion at once).
                let mut headers: HashMap<String, String> = HashMap::new();
                for id in &ids {
                    if let Some(map) = self.pending_questions.get(*id) {
                        for (q, h) in map {
                            headers.insert(q.clone(), h.clone());
                        }
                    }
                }
                let link = ids.first().copied().unwrap_or("");
                for (question, label) in answers {
                    let label = label.as_str().unwrap_or("");
                    let header = headers
                        .get(question)
                        .cloned()
                        .unwrap_or_else(|| truncate(question, 40));
                    let summary = format!("chose \"{label}\" for \"{header}\"");
                    let ref_id = format!("ans:{link}:{question}");
                    self.push(
                        DecisionKind::QuestionAnswered,
                        rl.timestamp.clone(),
                        summary,
                        Some(question.clone()),
                        ref_id,
                    );
                }
                // Answered → drop the pending entries so the map stays bounded.
                for id in &ids {
                    self.pending_questions.remove(*id);
                }
            }
        }

        // 2) Genuine user prompt: bare string content, not an injected meta line.
        if rl.is_meta != Some(true) {
            if let Some(text) = rl
                .message
                .as_ref()
                .and_then(|m| m.get("content"))
                .and_then(Value::as_str)
            {
                let t = text.trim();
                if !t.is_empty() {
                    let ref_id = format!("prompt:{}", rl.uuid.clone().unwrap_or_default());
                    let summary = format!("you asked: \"{}\"", truncate(t, 80));
                    self.push(
                        DecisionKind::UserPrompt,
                        rl.timestamp.clone(),
                        summary,
                        Some(t.to_string()),
                        ref_id,
                    );
                }
            }
        }
    }

    fn feed_assistant(&mut self, rl: &RawLine) {
        let Some(msg) = &rl.message else { return };
        for tu in tool_uses(msg) {
            let id = tu.id.unwrap_or("");
            let ts = rl.timestamp.clone();
            let field = |k: &str| tu.input.get(k).and_then(Value::as_str).unwrap_or("");
            match tu.name {
                "AskUserQuestion" => {
                    let mut headers = HashMap::new();
                    if let Some(qs) = tu.input.get("questions").and_then(Value::as_array) {
                        for q in qs {
                            let qt = q.get("question").and_then(Value::as_str).unwrap_or("");
                            let h = q.get("header").and_then(Value::as_str).unwrap_or(qt);
                            headers.insert(qt.to_string(), h.to_string());
                        }
                    }
                    self.pending_questions.insert(id.to_string(), headers);
                }
                "Agent" | "Task" => {
                    let st = field("subagent_type");
                    let desc = truncate(field("description"), 50);
                    let summary = if desc.is_empty() {
                        format!("spawned {st}")
                    } else {
                        format!("spawned {st}: {desc}")
                    };
                    self.push(
                        DecisionKind::SubagentSpawned,
                        ts,
                        summary,
                        None,
                        format!("agent:{id}"),
                    );
                }
                "Skill" => {
                    self.push(
                        DecisionKind::SkillInvoked,
                        ts,
                        format!("ran skill {}", field("skill")),
                        None,
                        format!("skill:{id}"),
                    );
                }
                "Write" => {
                    self.push(
                        DecisionKind::FileWrite,
                        ts,
                        format!("wrote {}", basename(field("file_path"))),
                        None,
                        format!("write:{id}"),
                    );
                }
                "ExitPlanMode" => {
                    self.push(
                        DecisionKind::PlanApproved,
                        ts,
                        "approved a plan".to_string(),
                        None,
                        format!("plan:{id}"),
                    );
                }
                "Bash" => {
                    let cmd = field("command");
                    if cmd.contains("git commit") {
                        self.push(
                            DecisionKind::Commit,
                            ts,
                            "committed changes".to_string(),
                            Some(truncate(cmd, 100)),
                            format!("commit:{id}"),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    fn push(
        &mut self,
        kind: DecisionKind,
        timestamp: Option<String>,
        summary: String,
        detail: Option<String>,
        ref_id: String,
    ) {
        if !self.seen.insert(ref_id.clone()) {
            return; // already recorded — idempotent re-tail
        }
        self.events.push(DecisionEvent {
            kind,
            timestamp,
            summary,
            detail,
            ref_id: Some(ref_id),
        });
        // Bound memory: drop the oldest events and forget their ref_ids so `seen`
        // stays bounded too (re-appearance after eviction is acceptable).
        if self.events.len() > EVENTS_CAP {
            let overflow = self.events.len() - EVENTS_CAP;
            for ev in self.events.drain(0..overflow) {
                if let Some(r) = ev.ref_id {
                    self.seen.remove(&r);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::parse_line;

    #[test]
    fn links_askuserquestion_answer_and_dedups() {
        let mut ex = DecisionExtractor::new();
        let question = r#"{"type":"assistant","timestamp":"2026-06-03T21:00:00Z","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"toolu_1","name":"AskUserQuestion","input":{"questions":[{"question":"Which stack?","header":"Stack","options":[]}]}}]}}"#;
        let answer = r#"{"type":"user","timestamp":"2026-06-03T21:00:05Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1"}]},"toolUseResult":{"answers":{"Which stack?":"Tauri (Rust core)"}}}"#;

        ex.feed(&parse_line(question).unwrap());
        ex.feed(&parse_line(answer).unwrap());
        assert_eq!(ex.events.len(), 1);
        assert_eq!(ex.events[0].kind, DecisionKind::QuestionAnswered);
        assert_eq!(
            ex.events[0].summary,
            "chose \"Tauri (Rust core)\" for \"Stack\""
        );

        // Re-feeding the same answer must not duplicate.
        ex.feed(&parse_line(answer).unwrap());
        assert_eq!(ex.events.len(), 1);
    }

    #[test]
    fn extracts_pr_link() {
        let mut ex = DecisionExtractor::new();
        let pr = r#"{"type":"pr-link","timestamp":"2026-06-03T21:00:00Z","prNumber":77,"prRepository":"me/app","prUrl":"http://x"}"#;
        ex.feed(&parse_line(pr).unwrap());
        assert_eq!(ex.events.len(), 1);
        assert_eq!(ex.events[0].kind, DecisionKind::PrOpened);
        assert_eq!(ex.events[0].summary, "opened PR #77 (me/app)");
    }
}
