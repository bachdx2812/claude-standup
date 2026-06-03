// Build a compact, size-capped prompt string from a session's snapshot +
// decisions. We send the heuristic-derived summary, NOT the raw transcript.

use crate::analysis::truncate;
use crate::model::{DecisionEvent, SessionSnapshot};

const INSTRUCTION: &str = "Summarize this Claude Code session for a developer who runs many sessions \
in parallel and forgets what each did. In 3-5 sentences: what it set out to do, the key decisions \
made, and where it currently stands. Be concrete and concise. No preamble.";

/// A single prompt string for `claude -p`.
pub fn build_prompt(snapshot: &SessionSnapshot, decisions: &[DecisionEvent]) -> String {
    let mut ctx = String::new();
    ctx.push_str(INSTRUCTION);
    ctx.push_str("\n\n");
    ctx.push_str(&format!(
        "Title: {}\nProject: {}\nState: {:?}\nCurrently: {}\n",
        snapshot.title.clone().unwrap_or_else(|| "(untitled)".into()),
        snapshot.project_path,
        snapshot.state,
        snapshot.current_status,
    ));
    if let Some(branch) = &snapshot.branch {
        ctx.push_str(&format!("Branch: {branch}\n"));
    }
    if let Some(prompt) = &snapshot.latest_prompt {
        ctx.push_str(&format!("Latest request: {}\n", truncate(prompt, 400)));
    }
    ctx.push_str(&format!(
        "Subagents spawned: {}\n\nKey decisions (oldest first):\n",
        snapshot.subagent_count
    ));
    for d in decisions.iter().take(50) {
        ctx.push_str(&format!("- {}\n", d.summary));
    }
    truncate(&ctx, 8000)
}
