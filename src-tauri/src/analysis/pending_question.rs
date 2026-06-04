// Best-effort "what is the agent waiting on you for", used as the attention
// notification body + the rail subtitle while a session is NeedsInput.

use super::truncate;
use crate::transcript::content_block::{first_text, tool_uses};
use crate::transcript::RawLine;
use serde_json::Value;
use std::collections::VecDeque;

/// The agent's pending question or last message, `None` if not recoverable.
/// Prefers an open `AskUserQuestion` (anywhere in `recent`, newest first); else
/// the prose of a plain end-of-turn reply.
pub fn pending_question(recent: &VecDeque<RawLine>) -> Option<String> {
    // Inspect ONLY the last timestamped line — the agent's current handback.
    // Scanning further back could surface an already-answered AskUserQuestion
    // whose tool_use block still lingers in `recent` (the answering user line
    // clears the runtime flag but does not evict the block).
    let last = recent.iter().rev().find(|r| r.is_timestamped())?;
    let msg = last.message.as_ref()?;
    // An unanswered AskUserQuestion is the last thing the agent did.
    for tu in tool_uses(msg) {
        if tu.name == "AskUserQuestion" {
            if let Some(q) = first_question(tu.input) {
                return Some(truncate(&collapse_ws(q), 140));
            }
        }
    }
    // Plain end-of-turn handback → the assistant's closing prose.
    if last.stop_reason() == Some("end_turn") {
        if let Some(text) = first_text(msg) {
            return Some(truncate(&collapse_ws(text), 140));
        }
    }
    None
}

/// Collapse whitespace runs (incl. newlines) to single spaces — keeps the
/// notification body + rail subtitle on one tidy line.
fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `questions[0].question` from an AskUserQuestion tool input.
fn first_question(input: &Value) -> Option<&str> {
    input
        .get("questions")
        .and_then(Value::as_array)?
        .first()?
        .get("question")
        .and_then(Value::as_str)
}

#[cfg(test)]
mod tests {
    use super::pending_question;
    use crate::transcript::{parse_line, RawLine};
    use std::collections::VecDeque;

    const TS: &str = "2026-06-04T10:00:00Z";

    fn dq(lines: &[String]) -> VecDeque<RawLine> {
        lines.iter().filter_map(|l| parse_line(l)).collect()
    }

    #[test]
    fn ask_user_question_extracted() {
        let line = format!(
            r#"{{"type":"assistant","timestamp":"{TS}","message":{{"role":"assistant","content":[{{"type":"tool_use","name":"AskUserQuestion","input":{{"questions":[{{"question":"Pick A or B?"}}]}}}}]}}}}"#
        );
        assert_eq!(
            pending_question(&dq(&[line])).as_deref(),
            Some("Pick A or B?")
        );
    }

    #[test]
    fn end_turn_prose_extracted() {
        let line = format!(
            r#"{{"type":"assistant","timestamp":"{TS}","message":{{"role":"assistant","stop_reason":"end_turn","content":[{{"type":"text","text":"Done. Proceed?"}}]}}}}"#
        );
        assert_eq!(
            pending_question(&dq(&[line])).as_deref(),
            Some("Done. Proceed?")
        );
    }

    #[test]
    fn answered_question_then_end_turn_uses_prose() {
        // Q1 asked, answered, agent continued, handed back via end_turn. Must
        // return the end_turn prose — NOT the stale, already-answered Q1 whose
        // block still lingers in `recent` (regression guard for the scan-back bug).
        let ask = format!(
            r#"{{"type":"assistant","timestamp":"{TS}","message":{{"role":"assistant","content":[{{"type":"tool_use","name":"AskUserQuestion","input":{{"questions":[{{"question":"Old Q1?"}}]}}}}]}}}}"#
        );
        let answer = format!(
            r#"{{"type":"user","timestamp":"{TS}","message":{{"role":"user","content":[{{"type":"tool_result","tool_use_id":"x"}}]}}}}"#
        );
        let end = format!(
            r#"{{"type":"assistant","timestamp":"{TS}","message":{{"role":"assistant","stop_reason":"end_turn","content":[{{"type":"text","text":"All done, anything else?"}}]}}}}"#
        );
        assert_eq!(
            pending_question(&dq(&[ask, answer, end])).as_deref(),
            Some("All done, anything else?")
        );
    }

    #[test]
    fn running_tool_is_none() {
        let line = format!(
            r#"{{"type":"assistant","timestamp":"{TS}","message":{{"role":"assistant","stop_reason":"tool_use","content":[{{"type":"tool_use","name":"Bash","input":{{"command":"ls"}}}}]}}}}"#
        );
        assert_eq!(pending_question(&dq(&[line])), None);
    }
}
