// Bounded backward read of every recent transcript to reconstruct account-wide
// token-usage events for the current ~5h billing window.
//
// The state Tailer keeps only the last 128KB tail (enough for live state), so
// block math — which needs the block's TRUE start, possibly hours back — gets its
// own read path here. JSONL is append-only chronological, so the recent window
// always lives at the END of each file; we read at most CAP_BYTES back per file.

use crate::analysis::usage_blocks::UsageEvent;
use crate::llm::pricing;
use crate::transcript::parse_line;
use crate::watcher::discovery;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Read at most this many bytes from the end of each transcript. Bounds IO; a 5h
/// window is far smaller in practice. If a file exceeds this AND its oldest read
/// line is still inside the window, the block may undercount — logged, not silent.
const CAP_BYTES: u64 = 16 * 1024 * 1024;

/// Collect billable usage events (account-wide) with `ts >= since_unix`. Only
/// files modified since then are read (stale files hold nothing in-window).
pub fn scan_recent_usage(since_unix: i64) -> Vec<UsageEvent> {
    let mut out = Vec::new();
    for sf in discovery::discover() {
        // Cheap mtime gate: a file untouched since the window opened has nothing.
        if discovery::mtime_millis(&sf.path).is_some_and(|m| m / 1000 < since_unix) {
            continue;
        }
        if let Err(e) = scan_file(&sf.path, since_unix, &mut out) {
            eprintln!("usage scan: {} — {e}", sf.path.display());
        }
    }
    out
}

fn scan_file(path: &Path, since_unix: i64, out: &mut Vec<UsageEvent>) -> std::io::Result<()> {
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let capped = len > CAP_BYTES;
    file.seek(SeekFrom::Start(len.saturating_sub(CAP_BYTES)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);

    let mut lines = text.split('\n');
    if capped {
        lines.next(); // first segment is mid-record after a capped seek — drop it
    }

    let mut oldest_seen = i64::MAX;
    for line in lines {
        let Some(rl) = parse_line(line) else { continue };
        if rl.kind != "assistant" {
            continue;
        }
        let Some(ts) = rl.unix_ts() else { continue };
        oldest_seen = oldest_seen.min(ts);
        if ts < since_unix {
            continue;
        }
        let Some(msg) = &rl.message else { continue };
        let Some(model) = pricing::real_model(msg) else { continue };
        let Some(usage) = pricing::parse_usage(msg) else { continue };
        out.push(UsageEvent {
            ts_unix: ts,
            tokens: usage.billable_tokens(),
            cost_usd: pricing::message_cost_usd(model, &usage),
        });
    }

    if capped && oldest_seen >= since_unix {
        eprintln!(
            "usage scan: {} hit the {}MB cap; the 5h window may be truncated",
            path.display(),
            CAP_BYTES / 1024 / 1024
        );
    }
    Ok(())
}
