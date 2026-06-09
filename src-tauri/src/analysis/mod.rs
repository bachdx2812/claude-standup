// Derivation of the user-facing signals from a session's recent transcript
// lines: lifecycle state, "what's it doing" status, and the key-decisions
// timeline. See reports/analysis-260603-2142-jsonl-detection-extraction.md.

pub mod decisions;
pub mod pending_question;
pub mod session_state;
pub mod status_map;
pub mod usage_blocks;

/// Trim + truncate to `max` chars with an ellipsis.
pub fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let head: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{head}…")
    }
}

/// Last path segment (file name) of a unix/windows path.
pub fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// A short human detail for a tool_use, from its most descriptive input field.
/// Used by the live activity feed.
pub fn tool_detail(name: &str, input: &serde_json::Value) -> String {
    let s = |k: &str| input.get(k).and_then(serde_json::Value::as_str).unwrap_or("");
    match name {
        "Bash" => truncate(s("command"), 60),
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            basename(s("file_path")).to_string()
        }
        "Grep" | "Glob" => truncate(s("pattern"), 44),
        "Task" | "Agent" => {
            let (st, d) = (s("subagent_type"), s("description"));
            if d.is_empty() {
                st.to_string()
            } else {
                format!("{st}: {}", truncate(d, 40))
            }
        }
        "Skill" => s("skill").to_string(),
        "WebFetch" | "WebSearch" => {
            truncate(if s("url").is_empty() { s("query") } else { s("url") }, 50)
        }
        "AskUserQuestion" => "asked you".to_string(),
        _ => {
            for k in ["command", "path", "query", "prompt", "description"] {
                let v = s(k);
                if !v.is_empty() {
                    return truncate(v, 50);
                }
            }
            String::new()
        }
    }
}
