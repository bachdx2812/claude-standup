// Token-usage cost + context-window accounting for Claude Code sessions.
//
// Approximate public Anthropic pricing as of 2026-06; update when rates change.
// Prices are USD per 1,000,000 tokens. The table is picked by matching the model
// id substring (case-insensitive); unknown models fall back to the Opus table.

use serde_json::Value;

/// Default context window. Some models advertise 1M, but 200k is the standard
/// default across the Claude family, so we use it as the universal estimate.
pub const DEFAULT_CONTEXT_LIMIT: u64 = 200_000;

/// Pick the smallest standard context window that fits the session's observed
/// peak usage. Claude Code runs either the 200k default or the 1M long-context
/// beta; if a session ever held >200k tokens it must be on the 1M window, so we
/// size the gauge accordingly (otherwise its usage % reads as >100%).
pub fn context_tier_limit(peak_used_tokens: u64) -> u64 {
    if peak_used_tokens > DEFAULT_CONTEXT_LIMIT {
        1_000_000
    } else {
        DEFAULT_CONTEXT_LIMIT
    }
}

/// Per-million-token USD prices for one model family.
#[derive(Debug, Clone, Copy)]
struct PriceTable {
    input: f64,
    output: f64,
    cache_read: f64,
    /// Writing into the 5-minute ephemeral cache.
    cache_write_5m: f64,
    /// Writing into the 1-hour ephemeral cache.
    cache_write_1h: f64,
}

const OPUS: PriceTable = PriceTable {
    input: 15.0,
    output: 75.0,
    cache_read: 1.5,
    cache_write_5m: 18.75,
    cache_write_1h: 30.0,
};

const SONNET: PriceTable = PriceTable {
    input: 3.0,
    output: 15.0,
    cache_read: 0.30,
    cache_write_5m: 3.75,
    cache_write_1h: 6.0,
};

const HAIKU: PriceTable = PriceTable {
    input: 1.0,
    output: 5.0,
    cache_read: 0.10,
    cache_write_5m: 1.25,
    cache_write_1h: 2.0,
};

/// Pick a price table from a model id. Substring match, case-insensitive.
/// Unknown / future model ids fall back to Opus (the most expensive table) so we
/// never silently under-report cost.
fn table_for(model: &str) -> PriceTable {
    let m = model.to_ascii_lowercase();
    if m.contains("opus") {
        OPUS
    } else if m.contains("sonnet") {
        SONNET
    } else if m.contains("haiku") {
        HAIKU
    } else {
        OPUS
    }
}

/// Token counts pulled from one assistant message's `usage` object.
#[derive(Debug, Clone, Copy, Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    /// `cache_creation.ephemeral_1h_input_tokens` (None when the breakdown is absent).
    pub ephemeral_1h_input_tokens: Option<u64>,
    /// `cache_creation.ephemeral_5m_input_tokens` (None when the breakdown is absent).
    pub ephemeral_5m_input_tokens: Option<u64>,
}

impl Usage {
    /// Tokens currently occupying the context window: input + cache (read + write).
    /// Output is excluded — it isn't resident in the next turn's prompt window.
    pub fn context_used_tokens(&self) -> u64 {
        self.input_tokens + self.cache_creation_input_tokens + self.cache_read_input_tokens
    }
}

fn u64_field(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn opt_u64_field(parent: &Value, key: &str) -> Option<u64> {
    parent.get(key).and_then(Value::as_u64)
}

/// Extract the `usage` object from an assistant `message`. Returns `None` for
/// messages without a usage dict (non-billing lines) so callers can skip them.
pub fn parse_usage(message: &Value) -> Option<Usage> {
    let usage = message.get("usage")?;
    if !usage.is_object() {
        return None;
    }
    let cache_creation = usage.get("cache_creation");
    Some(Usage {
        input_tokens: u64_field(usage, "input_tokens"),
        output_tokens: u64_field(usage, "output_tokens"),
        cache_read_input_tokens: u64_field(usage, "cache_read_input_tokens"),
        cache_creation_input_tokens: u64_field(usage, "cache_creation_input_tokens"),
        ephemeral_1h_input_tokens: cache_creation
            .and_then(|c| opt_u64_field(c, "ephemeral_1h_input_tokens")),
        ephemeral_5m_input_tokens: cache_creation
            .and_then(|c| opt_u64_field(c, "ephemeral_5m_input_tokens")),
    })
}

/// The `message.model` string, if it's a real (non-synthetic) model.
/// `<synthetic>` turns carry no real cost/usage and are filtered out here.
pub fn real_model(message: &Value) -> Option<&str> {
    let model = message.get("model").and_then(Value::as_str)?;
    if model.is_empty() || model == "<synthetic>" {
        None
    } else {
        Some(model)
    }
}

/// Incremental USD cost of a single assistant turn, given its model + usage.
///
/// cost = input*inPrice + output*outPrice + cacheRead*cacheReadPrice + cacheWrite
/// where cacheWrite uses the 1h/5m breakdown when present; otherwise the whole
/// `cache_creation_input_tokens` is priced at the 5m rate.
pub fn message_cost_usd(model: &str, usage: &Usage) -> f64 {
    let t = table_for(model);
    const PER_MILLION: f64 = 1_000_000.0;

    let cache_write_tokens_cost = match (usage.ephemeral_1h_input_tokens, usage.ephemeral_5m_input_tokens)
    {
        (None, None) => {
            // No breakdown: price all cache-creation tokens at the 5m rate.
            usage.cache_creation_input_tokens as f64 * t.cache_write_5m
        }
        (h, f) => {
            let h = h.unwrap_or(0) as f64 * t.cache_write_1h;
            let f = f.unwrap_or(0) as f64 * t.cache_write_5m;
            h + f
        }
    };

    let total = usage.input_tokens as f64 * t.input
        + usage.output_tokens as f64 * t.output
        + usage.cache_read_input_tokens as f64 * t.cache_read
        + cache_write_tokens_cost;

    total / PER_MILLION
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_real_assistant_usage_from_transcript_shape() {
        // The confirmed real shape from the task spec.
        let msg = json!({
            "model": "claude-opus-4-8",
            "usage": {
                "input_tokens": 2,
                "cache_creation_input_tokens": 1144,
                "cache_read_input_tokens": 188838,
                "output_tokens": 517,
                "cache_creation": {
                    "ephemeral_1h_input_tokens": 1144,
                    "ephemeral_5m_input_tokens": 0
                }
            }
        });
        let u = parse_usage(&msg).unwrap();
        assert_eq!(u.input_tokens, 2);
        assert_eq!(u.output_tokens, 517);
        assert_eq!(u.cache_read_input_tokens, 188838);
        assert_eq!(u.cache_creation_input_tokens, 1144);
        assert_eq!(u.ephemeral_1h_input_tokens, Some(1144));
        assert_eq!(u.ephemeral_5m_input_tokens, Some(0));
        assert_eq!(real_model(&msg), Some("claude-opus-4-8"));
        // context window = input + cache_creation + cache_read (no output).
        assert_eq!(u.context_used_tokens(), 2 + 1144 + 188838);
    }

    #[test]
    fn synthetic_model_is_filtered() {
        let msg = json!({ "model": "<synthetic>", "usage": { "input_tokens": 10 } });
        assert_eq!(real_model(&msg), None);
    }

    #[test]
    fn cost_uses_breakdown_when_present() {
        let usage = Usage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            cache_read_input_tokens: 1_000_000,
            cache_creation_input_tokens: 1_000_000,
            ephemeral_1h_input_tokens: Some(1_000_000),
            ephemeral_5m_input_tokens: Some(0),
        };
        // opus: 15 + 75 + 1.5 + (1M*30/1M = 30) = 121.5
        let cost = message_cost_usd("claude-opus-4-8", &usage);
        assert!((cost - 121.5).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn cost_falls_back_to_5m_rate_without_breakdown() {
        let usage = Usage {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 1_000_000,
            ephemeral_1h_input_tokens: None,
            ephemeral_5m_input_tokens: None,
        };
        // sonnet cache_write_5m = 3.75 per 1M
        let cost = message_cost_usd("claude-sonnet-4-5", &usage);
        assert!((cost - 3.75).abs() < 1e-6, "got {cost}");
    }

    #[test]
    fn unknown_model_falls_back_to_opus() {
        let usage = Usage { input_tokens: 1_000_000, ..Default::default() };
        let cost = message_cost_usd("some-future-model", &usage);
        assert!((cost - 15.0).abs() < 1e-6, "got {cost}");
    }
}
