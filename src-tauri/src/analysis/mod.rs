// Derivation of the user-facing signals from a session's recent transcript
// lines: lifecycle state, "what's it doing" status, and the key-decisions
// timeline. See reports/analysis-260603-2142-jsonl-detection-extraction.md.

pub mod decisions;
pub mod session_state;
pub mod status_map;

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
