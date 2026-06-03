// "What is this session doing right now" — a short human verb + object derived
// from the last meaningful transcript line.

use super::{basename, truncate};
use crate::transcript::content_block::{has_block, tool_uses};
use crate::transcript::RawLine;
use serde_json::Value;
use std::collections::VecDeque;

pub fn current_status(recent: &VecDeque<RawLine>) -> String {
    let Some(last) = recent.iter().rev().find(|r| r.is_timestamped()) else {
        return "—".to_string();
    };

    match last.kind.as_str() {
        "assistant" => assistant_status(last),
        "user" => user_status(last),
        "system" => match last.subtype.as_deref() {
            Some("away_summary") => "Idle (stepped away)".to_string(),
            Some("turn_duration") | Some("stop_hook_summary") => "Finished a turn".to_string(),
            Some("api_error") => "Retrying (API error)".to_string(),
            Some("compact_boundary") => "Compacting context".to_string(),
            _ => "Idle".to_string(),
        },
        "pr-link" => "Opened a PR".to_string(),
        "queue-operation" => "Queued input".to_string(),
        _ => "—".to_string(),
    }
}

fn assistant_status(line: &RawLine) -> String {
    let Some(msg) = &line.message else {
        return "Thinking…".to_string();
    };
    if let Some(tu) = tool_uses(msg).last() {
        return tool_verb(tu.name, tu.input);
    }
    if line.stop_reason() == Some("end_turn") {
        return "Replied · waiting for you".to_string();
    }
    if has_block(msg, "thinking") {
        return "Thinking…".to_string();
    }
    "Working…".to_string()
}

fn user_status(line: &RawLine) -> String {
    if let Some(msg) = &line.message {
        if has_block(msg, "tool_result") {
            return "Processing result…".to_string();
        }
        if msg.get("content").and_then(Value::as_str).is_some() {
            return "Picking up your request…".to_string();
        }
    }
    "Working…".to_string()
}

/// Map a tool name + input to a short status line, truncated for display.
fn tool_verb(name: &str, input: &Value) -> String {
    let field = |k: &str| input.get(k).and_then(Value::as_str).unwrap_or("");
    let s = match name {
        "Bash" => {
            let cmd = field("command");
            let head = cmd.split_whitespace().next().unwrap_or("command");
            format!("Running {head}")
        }
        "Read" => format!("Reading {}", basename(field("file_path"))),
        "Edit" | "MultiEdit" => format!("Editing {}", basename(field("file_path"))),
        "Write" => format!("Writing {}", basename(field("file_path"))),
        "Grep" => format!("Searching \"{}\"", field("pattern")),
        "Glob" => format!("Globbing \"{}\"", field("pattern")),
        "Agent" | "Task" => format!("Spawning {}", field("subagent_type")),
        "Skill" => format!("Running skill {}", field("skill")),
        "TaskCreate" | "TaskUpdate" | "TaskList" => "Managing tasks".to_string(),
        "WebFetch" => "Fetching a page".to_string(),
        "WebSearch" => format!("Searching web \"{}\"", field("query")),
        "AskUserQuestion" => "Waiting for you".to_string(),
        other if other.starts_with("mcp__") => {
            let seg = other.rsplit("__").next().unwrap_or(other);
            format!("Calling {seg}")
        }
        other => other.to_string(),
    };
    truncate(&s, 44)
}
