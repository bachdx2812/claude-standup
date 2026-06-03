// Lazy accessors over a message's `content[]` array. Borrow from the raw
// `serde_json::Value` so we never clone large payloads.

use serde_json::Value;

static NULL: Value = Value::Null;

/// A tool invocation block (`type == "tool_use"`).
pub struct ToolUse<'a> {
    pub id: Option<&'a str>,
    pub name: &'a str,
    pub input: &'a Value,
}

/// All tool_use blocks in a message, in order.
pub fn tool_uses(message: &Value) -> Vec<ToolUse<'_>> {
    let mut out = Vec::new();
    let Some(arr) = message.get("content").and_then(Value::as_array) else {
        return out;
    };
    for blk in arr {
        if blk.get("type").and_then(Value::as_str) == Some("tool_use") {
            if let Some(name) = blk.get("name").and_then(Value::as_str) {
                out.push(ToolUse {
                    id: blk.get("id").and_then(Value::as_str),
                    name,
                    input: blk.get("input").unwrap_or(&NULL),
                });
            }
        }
    }
    out
}

/// `tool_use_id`s carried by tool_result blocks (a `user` line answering tools).
pub fn tool_result_ids(message: &Value) -> Vec<&str> {
    let mut out = Vec::new();
    let Some(arr) = message.get("content").and_then(Value::as_array) else {
        return out;
    };
    for blk in arr {
        if blk.get("type").and_then(Value::as_str) == Some("tool_result") {
            if let Some(id) = blk.get("tool_use_id").and_then(Value::as_str) {
                out.push(id);
            }
        }
    }
    out
}

/// True if the message contains at least one block of `kind`.
pub fn has_block(message: &Value, kind: &str) -> bool {
    message
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|arr| arr.iter().any(|b| b.get("type").and_then(Value::as_str) == Some(kind)))
}
