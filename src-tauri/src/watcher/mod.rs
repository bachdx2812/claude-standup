// The background watcher task: an FSEvents wakeup + a 1s mtime poll drive a scan
// pass that tails changed transcripts into the session registry. FSEvents only
// reduces latency; the mtime poll is the source of truth (FSEvents coalesces).
//
// Phase 04 hooks emit/tray/auto-popup into the end of each scan pass.

pub mod discovery;
pub mod tailer;

use crate::app_state::{AppState, SessionRuntime};
use crate::transcript::{parse_line, RawLine};
use discovery::SessionFile;
use std::collections::HashMap;
use std::time::Duration;
use tailer::Tailer;

/// Drop sessions that have been Ended for longer than this from the registry,
/// so a long-running menubar agent doesn't accumulate stale sessions forever.
/// Their `mtimes` entry is kept, so a real new append resurrects them.
const EVICT_SECS: i64 = 24 * 3600;

/// Re-walk the projects dir at most this often; between walks the cached file
/// list is re-stat'd for changes (cheap) rather than re-walked + re-allocated.
const REWALK: Duration = Duration::from_secs(5);

/// Cached `discovery::discover()` result so the full directory walk + its
/// per-file allocations run at most every `REWALK`, not on every poll/poke.
struct DiscoverCache {
    files: Vec<SessionFile>,
    last: std::time::Instant,
}

/// Spawn the watcher on Tauri's async runtime (tokio-backed). NOT `tokio::spawn`
/// — `setup` runs on the main thread with no ambient tokio reactor.
pub fn spawn(app: tauri::AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        run(app, state).await;
    });
}

async fn run(app: tauri::AppHandle, state: AppState) {
    let (poke_tx, mut poke_rx) = tokio::sync::mpsc::channel::<()>(16);
    // Keep the watcher alive for the lifetime of the task.
    let _watcher = setup_notify(poke_tx);

    let mut tailer = Tailer::new();
    // Per-session last-seen mtime (liveness filter), kept OUTSIDE the registry
    // lock so the changed-file check needs no lock.
    let mut mtimes: HashMap<String, i64> = HashMap::new();
    let mut disco = DiscoverCache {
        files: Vec::new(),
        last: std::time::Instant::now()
            .checked_sub(REWALK)
            .unwrap_or_else(std::time::Instant::now),
    };
    let mut interval = tokio::time::interval(Duration::from_millis(1000));
    // Throttle UI emits; init in the past so the first change emits immediately.
    let mut last_emit = std::time::Instant::now()
        .checked_sub(Duration::from_secs(1))
        .unwrap_or_else(std::time::Instant::now);
    // Recompute the account-wide 5h billing block on a slow cadence (its own file
    // IO, decoupled from the 1s state scan). Start in the past so it runs at once.
    const BLOCK_REFRESH: Duration = Duration::from_secs(30);
    // Feed events from a bit over 5h back so the block's floored-hour start is
    // never lost to the window filter.
    const BLOCK_WINDOW_SECS: i64 = 6 * 3600;
    let mut last_block = std::time::Instant::now()
        .checked_sub(BLOCK_REFRESH)
        .unwrap_or_else(std::time::Instant::now);

    loop {
        tokio::select! {
            _ = interval.tick() => {}
            _ = poke_rx.recv() => {}
        }
        let result = scan_once(&state, &mut tailer, &mut mtimes, &mut disco).await;

        crate::bridge::tray::update_count(&app, result.active_count, result.needs_count);

        if result.changed && last_emit.elapsed() >= Duration::from_millis(250) {
            crate::bridge::events::emit_sessions(&app, &state).await;
            last_emit = std::time::Instant::now();
        }
        if !result.activations.is_empty() {
            crate::bridge::popup::on_activations(&app, &state, &result.activations);
        }
        if !result.needs_attention.is_empty() {
            crate::bridge::popup::on_needs_attention(&app, &state, &result.needs_attention);
        }

        if last_block.elapsed() >= BLOCK_REFRESH {
            last_block = std::time::Instant::now();
            let now = chrono::Utc::now().timestamp();
            let events =
                crate::transcript::history_scan::scan_recent_usage(now - BLOCK_WINDOW_SECS);
            let block = crate::analysis::usage_blocks::active_block(&events, now);
            crate::bridge::events::emit_block(&app, block);
        }
    }
}

/// Outcome of one scan pass, consumed by `run` to drive the UI/tray/popup.
struct ScanResult {
    changed: bool,
    activations: Vec<crate::model::SessionSnapshot>,
    active_count: usize,
    needs_count: usize,
    needs_attention: Vec<crate::model::SessionSnapshot>,
}

/// FSEvents watcher that pokes the loop on any change under projects/.
fn setup_notify(poke_tx: tokio::sync::mpsc::Sender<()>) -> Option<notify::RecommendedWatcher> {
    use notify::{RecursiveMode, Watcher};
    let root = discovery::projects_root()?;
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = poke_tx.try_send(());
        }
    })
    .ok()?;
    watcher.watch(&root, RecursiveMode::Recursive).ok()?;
    Some(watcher)
}

/// One discovery + tail pass.
/// Phase 1 reads changed files with NO lock held (transcripts are 100MB+).
/// Phase 2 takes the registry write lock only for in-memory ingest + recompute.
async fn scan_once(
    state: &AppState,
    tailer: &mut Tailer,
    mtimes: &mut HashMap<String, i64>,
    disco: &mut DiscoverCache,
) -> ScanResult {
    use crate::model::SessionState;

    struct Ingest {
        sf: SessionFile,
        lines: Vec<RawLine>,
        subagent_count: usize,
    }

    // --- Phase 1: file IO outside the lock. ---
    // Re-walk the projects dir only occasionally; otherwise re-stat the cache.
    if disco.files.is_empty() || disco.last.elapsed() >= REWALK {
        disco.files = discovery::discover();
        disco.last = std::time::Instant::now();
    }
    let mut ingests: Vec<Ingest> = Vec::new();
    for sf in &disco.files {
        let Some(mtime) = discovery::mtime_millis(&sf.path) else {
            continue; // transient stat failure — leave the stored mtime intact
        };
        if mtimes.get(&sf.session_id) == Some(&mtime) {
            continue; // unchanged since last sight
        }
        mtimes.insert(sf.session_id.clone(), mtime);

        let raw = tailer.read_new_lines(&sf.path).unwrap_or_default();
        let lines: Vec<RawLine> = raw.iter().filter_map(|l| parse_line(l)).collect();
        let subagent_count = discovery::subagent_count(&sf.path, &sf.session_id);
        ingests.push(Ingest {
            sf: sf.clone(),
            lines,
            subagent_count,
        });
    }

    // --- Phase 2: short write lock — mutate registry, recompute (no IO). ---
    let mut reg = state.registry.write().await;
    let mut changed = !ingests.is_empty();
    for ing in ingests {
        let runtime = reg
            .sessions
            .entry(ing.sf.session_id.clone())
            .or_insert_with(|| SessionRuntime::new(&ing.sf));
        for rl in ing.lines {
            runtime.ingest(rl);
        }
        runtime.subagent_count = ing.subagent_count;
    }

    // Recompute everything (Active→Idle→Ended turns on the clock) + detect edges.
    let mut activations = Vec::new();
    let mut needs_attention = Vec::new();
    let mut active_count = 0;
    let mut needs_count = 0;
    for runtime in reg.sessions.values_mut() {
        let prev = runtime.prev_state;
        runtime.recompute();
        let now_state = runtime.snapshot.state;
        // Empty stubs + temp/system sessions never count, show, or pop up.
        let displayable = runtime.snapshot.is_displayable();

        if Some(now_state) != prev {
            changed = true;
            // Auto-popup the window only when a session starts *working*.
            if displayable
                && now_state == SessionState::Running
                && prev != Some(SessionState::Running)
            {
                activations.push(runtime.snapshot.clone());
            }
            // Notify (no focus-steal) when a session starts *needing you* —
            // includes Running→NeedsInput, the "agent handed back to you" moment
            // the old activation edge silently dropped.
            if displayable && now_state == SessionState::NeedsInput {
                needs_attention.push(runtime.snapshot.clone());
            }
        }
        if displayable && now_state == SessionState::Running {
            active_count += 1;
        }
        if displayable && now_state == SessionState::NeedsInput {
            needs_count += 1;
        }
        runtime.prev_state = Some(now_state);
    }

    // Evict sessions Ended for > EVICT_SECS. Keep their `mtimes` entry so they
    // aren't instantly re-discovered; a genuine new append brings them back.
    let now = chrono::Utc::now().timestamp();
    let evict: Vec<String> = reg
        .sessions
        .iter()
        .filter(|(_, rt)| {
            // Drop stubs/temp eagerly + long-idle sessions. NOT based on is_open
            // (a momentary process-scan miss must not wipe the registry).
            !rt.snapshot.is_real()
                || (rt.snapshot.state == SessionState::Idle
                    && rt
                        .snapshot
                        .last_activity_unix
                        .is_some_and(|t| now - t > EVICT_SECS))
        })
        .map(|(id, _)| id.clone())
        .collect();
    if !evict.is_empty() {
        changed = true;
        for id in &evict {
            reg.sessions.remove(id);
        }
    }

    ScanResult {
        changed,
        activations,
        active_count,
        needs_count,
        needs_attention,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::SessionRuntime;

    /// End-to-end smoke test against the real ~/.claude/projects on this machine.
    /// Ignored by default (machine-dependent); run with `cargo test -- --ignored`.
    #[test]
    #[ignore = "reads real ~/.claude/projects"]
    fn engine_reads_real_sessions() {
        let files = discovery::discover();
        assert!(!files.is_empty(), "expected real sessions on this machine");

        let mut tailer = Tailer::new();
        let mut built = 0usize;
        let mut with_meta = 0usize;
        for sf in files.iter().take(25) {
            let mut rt = SessionRuntime::new(sf);
            if let Ok(lines) = tailer.read_new_lines(&sf.path) {
                for l in &lines {
                    if let Some(rl) = parse_line(l) {
                        rt.ingest(rl);
                    }
                }
            }
            rt.recompute();
            built += 1;
            if rt.snapshot.title.is_some() || rt.snapshot.project_path.contains('/') {
                with_meta += 1;
            }
        }
        eprintln!("built {built} snapshots, {with_meta} carried title/real-path");
        assert!(built > 0);
        assert!(
            with_meta > 0,
            "expected at least one snapshot with metadata"
        );
    }
}
