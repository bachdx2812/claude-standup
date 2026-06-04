// Enumerate Claude Code session transcripts under ~/.claude/projects and answer
// cheap filesystem questions (mtime, subagent count). Subagent files live in a
// nested `<id>/subagents/` dir and are intentionally excluded from discovery.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone)]
pub struct SessionFile {
    pub session_id: String,
    pub path: PathBuf,
    pub dir_slug: String,
}

pub fn projects_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

/// All main session `.jsonl` files (one per session), skipping `subagents/`.
pub fn discover() -> Vec<SessionFile> {
    let mut out = Vec::new();
    let Some(root) = projects_root() else {
        return out;
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return out;
    };
    for dir in entries.flatten() {
        let dpath = dir.path();
        if !dpath.is_dir() {
            continue;
        }
        let dir_slug = dir.file_name().to_string_lossy().into_owned();
        let Ok(files) = std::fs::read_dir(&dpath) else {
            continue;
        };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                    out.push(SessionFile {
                        session_id: stem.to_owned(),
                        path: p.clone(),
                        dir_slug: dir_slug.clone(),
                    });
                }
            }
        }
    }
    out
}

/// File modification time in unix MILLISECONDS (the cheap liveness filter).
/// Sub-second resolution so two appends within the same wall-clock second are
/// not coalesced into "unchanged" (which would defeat the FSEvents fast path).
pub fn mtime_millis(path: &Path) -> Option<i64> {
    let meta = std::fs::metadata(path).ok()?;
    let mt = meta.modified().ok()?;
    mt.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

/// Fallback display label from the directory slug. The real path comes from the
/// `.cwd` field — slug decode is lossy (real dir names contain hyphens), so we
/// only take the trailing segment as a human-friendly hint.
pub fn slug_label(dir_slug: &str) -> String {
    dir_slug
        .trim_start_matches('-')
        .rsplit('-')
        .find(|s| !s.is_empty())
        .unwrap_or(dir_slug)
        .to_string()
}

/// Count subagent transcripts: `<project-dir>/<session-id>/subagents/agent-*.jsonl`.
pub fn subagent_count(session_file: &Path, session_id: &str) -> usize {
    let Some(parent) = session_file.parent() else {
        return 0;
    };
    let sub = parent.join(session_id).join("subagents");
    let Ok(rd) = std::fs::read_dir(&sub) else {
        return 0;
    };
    rd.flatten()
        .filter(|e| {
            let p = e.path();
            p.extension().and_then(|x| x.to_str()) == Some("jsonl")
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("agent-"))
        })
        .count()
}
