// Running / NeedsInput / Idle classification.
//
//   Running    = a tool/agent is in flight, OR Claude generated something in the
//                last ~90s and isn't waiting on you.
//   NeedsInput = Claude finished its turn or asked a question (AskUserQuestion /
//                end_turn / turn boundary) and is waiting for your response.
//   Idle       = none of the above recently (stepped away / abandoned).
//
// `tool_running` (open non-question tool_use ids) and `pending_question`
// (an unanswered AskUserQuestion) are tracked incrementally by the runtime, so
// they survive `recent` being capped.

use crate::model::SessionState;
use crate::transcript::RawLine;
use std::collections::VecDeque;

/// Recent generation (no tool, not waiting) still counts as Running within this.
const RUNNING_SECS: i64 = 90;
/// A tool/agent in flight keeps Running up to here even with no output.
const TOOL_CAP_SECS: i64 = 10 * 60;
/// Past this, a "waiting for you" turn is treated as Idle (you clearly stepped
/// away). Generous so a session genuinely waiting on you doesn't vanish.
const NEEDS_INPUT_CUTOFF_SECS: i64 = 4 * 60 * 60;

pub fn derive(
    recent: &VecDeque<RawLine>,
    pending_bg: u32,
    tool_running: bool,
    pending_question: bool,
    now: i64,
) -> SessionState {
    let Some(last) = recent.iter().rev().find(|r| r.unix_ts().is_some()) else {
        return SessionState::Idle;
    };
    let age = now - last.unix_ts().unwrap();

    // A real tool / background agent executing = actively working.
    if (tool_running || pending_bg > 0) && age <= TOOL_CAP_SECS {
        return SessionState::Running;
    }

    let waiting = pending_question || is_turn_end(last);

    if age <= RUNNING_SECS {
        // Recent: waiting on you, or still generating.
        return if waiting {
            SessionState::NeedsInput
        } else {
            SessionState::Running
        };
    }

    if waiting && age <= NEEDS_INPUT_CUTOFF_SECS {
        return SessionState::NeedsInput;
    }

    SessionState::Idle
}

/// A turn-ending event: assistant end_turn, or a system turn-boundary subtype.
fn is_turn_end(last: &RawLine) -> bool {
    match last.kind.as_str() {
        "assistant" => last.stop_reason() == Some("end_turn"),
        "system" => matches!(
            last.subtype.as_deref(),
            Some("turn_duration") | Some("away_summary") | Some("stop_hook_summary")
        ),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::derive;
    use crate::model::SessionState;
    use crate::transcript::{parse_line, RawLine};
    use std::collections::VecDeque;

    const NOW: i64 = 1_900_000_000;

    fn ts(unix: i64) -> String {
        chrono::DateTime::from_timestamp(unix, 0)
            .unwrap()
            .to_rfc3339()
    }

    fn dq(lines: &[String]) -> VecDeque<RawLine> {
        lines.iter().filter_map(|l| parse_line(l)).collect()
    }

    fn assistant(at: i64, stop: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{}","message":{{"role":"assistant","stop_reason":"{}","content":[]}}}}"#,
            ts(at),
            stop
        )
    }

    #[test]
    fn tool_in_flight_is_running() {
        // A tool fired 2 min ago, no result yet → Running (within tool cap).
        let q = dq(&[assistant(NOW - 120, "tool_use")]);
        assert_eq!(derive(&q, 0, true, false, NOW), SessionState::Running);
    }

    #[test]
    fn replied_recently_needs_input() {
        let q = dq(&[assistant(NOW - 20, "end_turn")]);
        assert_eq!(derive(&q, 0, false, false, NOW), SessionState::NeedsInput);
    }

    #[test]
    fn pending_question_needs_input() {
        // Last line isn't end_turn, but an AskUserQuestion is open.
        let q = dq(&[assistant(NOW - 600, "tool_use")]);
        assert_eq!(derive(&q, 0, false, true, NOW), SessionState::NeedsInput);
    }

    #[test]
    fn stale_waiting_is_idle() {
        // Replied 5h ago and you never came back → Idle, not NeedsInput.
        let q = dq(&[assistant(NOW - 5 * 3600, "end_turn")]);
        assert_eq!(derive(&q, 0, false, false, NOW), SessionState::Idle);
    }

    #[test]
    fn no_parseable_timestamp_is_idle() {
        let bad = r#"{"type":"assistant","timestamp":"nope","message":{"role":"assistant"}}"#;
        assert_eq!(
            derive(&dq(&[bad.to_string()]), 0, false, false, NOW),
            SessionState::Idle
        );
    }
}
