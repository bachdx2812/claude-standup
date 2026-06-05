// Account-wide 5-hour billing-block math. Claude usage resets on a rolling 5h
// window that starts at the first message, floored to the top of the hour (UTC),
// and is shared across all concurrent sessions. We group usage events into those
// windows and report the active block's spend + burn rate + time-to-reset.
//
// Plan tier (Pro / Max) — and thus the token *ceiling* — is NOT in the
// transcripts, so we report consumption (spend, burn, reset), never "% of limit".

use serde::Serialize;

/// A billing window is 5 hours.
const BLOCK_SECS: i64 = 5 * 60 * 60;

/// One billable assistant turn: when it happened, its billable tokens + USD.
#[derive(Debug, Clone, Copy)]
pub struct UsageEvent {
    pub ts_unix: i64,
    pub tokens: u64,
    pub cost_usd: f64,
}

/// The active 5-hour billing block, shaped for the UI (camelCase wire format).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingBlock {
    pub start_unix: i64,
    pub end_unix: i64,
    pub tokens: u64,
    pub cost_usd: f64,
    pub burn_tokens_per_min: f64,
    pub resets_in_secs: i64,
    /// False once the window has elapsed (the UI hides the block then).
    pub active: bool,
}

/// Floor a unix timestamp to the top of its hour (UTC) — block-start rounding.
fn floor_hour(ts: i64) -> i64 {
    ts - ts.rem_euclid(3600)
}

/// Compute the current billing block from account-wide usage events. Events may
/// arrive unsorted; only the LATEST block (the one in progress) is returned.
/// `None` when there are no events. Feed events from a little over 5h back (e.g.
/// now-6h) so the active block's floored-hour start is never missed.
pub fn active_block(events: &[UsageEvent], now: i64) -> Option<BillingBlock> {
    if events.is_empty() {
        return None;
    }
    let mut evs: Vec<UsageEvent> = events.to_vec();
    evs.sort_by_key(|e| e.ts_unix);

    // Walk events; a new window opens whenever an event lands past the current
    // block's end. Accumulation resets each time, so we end on the latest block.
    let mut start = floor_hour(evs[0].ts_unix);
    let mut tokens = 0u64;
    let mut cost = 0.0;
    for e in &evs {
        if e.ts_unix >= start + BLOCK_SECS {
            start = floor_hour(e.ts_unix);
            tokens = 0;
            cost = 0.0;
        }
        tokens += e.tokens;
        cost += e.cost_usd;
    }

    let end = start + BLOCK_SECS;
    let active = now < end;
    // Elapsed within the block so far (>=1min to avoid a div-by-zero spike at start).
    let elapsed_min = ((now.min(end) - start).max(60)) as f64 / 60.0;
    Some(BillingBlock {
        start_unix: start,
        end_unix: end,
        tokens,
        cost_usd: cost,
        burn_tokens_per_min: tokens as f64 / elapsed_min,
        resets_in_secs: (end - now).max(0),
        active,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A fixed UTC anchor on an exact hour boundary: 2026-06-05T06:00:00Z.
    const H6: i64 = 1_780_380_000;

    fn ev(ts: i64, tokens: u64, cost: f64) -> UsageEvent {
        UsageEvent { ts_unix: ts, tokens, cost_usd: cost }
    }

    #[test]
    fn floors_start_to_the_hour() {
        // First message at 06:25 → block starts 06:00, ends 11:00.
        let now = H6 + 25 * 60 + 5 * 60; // 06:30
        let b = active_block(&[ev(H6 + 25 * 60, 1000, 0.5)], now).unwrap();
        assert_eq!(b.start_unix, H6);
        assert_eq!(b.end_unix, H6 + BLOCK_SECS);
        assert!(b.active);
        assert_eq!(b.tokens, 1000);
    }

    #[test]
    fn sums_all_events_in_window() {
        let now = H6 + 90 * 60; // 07:30
        let b = active_block(
            &[ev(H6 + 10 * 60, 100, 0.1), ev(H6 + 80 * 60, 300, 0.4)],
            now,
        )
        .unwrap();
        assert_eq!(b.tokens, 400);
        assert!((b.cost_usd - 0.5).abs() < 1e-9);
    }

    #[test]
    fn boundary_crossing_starts_a_new_block() {
        // 06:00 block, then a message at 11:30 → new block 11:00–16:00, counting
        // only the later message.
        let now = H6 + 5 * 3600 + 45 * 60; // 11:45
        let b = active_block(
            &[ev(H6 + 5 * 60, 999, 9.9), ev(H6 + 5 * 3600 + 30 * 60, 200, 0.2)],
            now,
        )
        .unwrap();
        assert_eq!(b.start_unix, H6 + 5 * 3600); // 11:00
        assert_eq!(b.tokens, 200);
    }

    #[test]
    fn elapsed_window_is_inactive() {
        // Last activity 06:05, now 12:00 → block 06:00–11:00 already expired.
        let now = H6 + 6 * 3600;
        let b = active_block(&[ev(H6 + 5 * 60, 100, 0.1)], now).unwrap();
        assert!(!b.active);
        assert_eq!(b.resets_in_secs, 0);
    }

    #[test]
    fn burn_rate_is_tokens_per_minute() {
        // 1200 tokens, 60 min elapsed → 20 tok/min.
        let now = H6 + 60 * 60;
        let b = active_block(&[ev(H6 + 1, 1200, 1.0)], now).unwrap();
        assert!((b.burn_tokens_per_min - 20.0).abs() < 1e-6, "got {}", b.burn_tokens_per_min);
    }

    #[test]
    fn no_events_is_none() {
        assert!(active_block(&[], H6).is_none());
    }
}
