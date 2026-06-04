// Summarize a session by shelling out to the locally-installed Claude Code CLI
// (`claude -p`), reusing the user's existing Claude login — no API key, no extra
// cost beyond their Claude plan. GUI apps don't inherit the shell PATH, so the
// binary + PATH are resolved via a login shell once and cached.

use std::sync::atomic::{AtomicU64, Ordering};
use tokio::process::Command;
use tokio::sync::OnceCell;

// Resolving the binary and the login PATH each spawns an interactive login shell
// (which sources ~/.zshrc — can take 100s of ms), so do it once per app lifetime.
static RESOLVED: OnceCell<Option<(String, Option<String>)>> = OnceCell::const_new();
static RUN_SEQ: AtomicU64 = AtomicU64::new(0);

/// (claude binary path, login PATH) — resolved once, then cached.
async fn resolved() -> Option<(String, Option<String>)> {
    RESOLVED
        .get_or_init(|| async {
            let bin = resolve_bin().await?;
            Some((bin, login_path().await))
        })
        .await
        .clone()
}

/// Run `claude -p <prompt>` and return its text output.
pub async fn summarize(prompt: &str, model: Option<&str>) -> Result<String, String> {
    let (bin, path) = resolved().await.ok_or_else(|| {
        "Claude Code CLI not found. Install Claude Code, or set CLAUDE_BIN to its path.".to_string()
    })?;

    let mut cmd = Command::new(&bin);
    cmd.arg("-p").arg(prompt);
    if let Some(m) = model {
        if !m.trim().is_empty() {
            cmd.arg("--model").arg(m.trim());
        }
    }
    // GUI apps launched from /Applications inherit only a minimal PATH, so the
    // node runtime claude relies on isn't found ("claude not found in PATH").
    if let Some(p) = &path {
        cmd.env("PATH", p);
    }

    // A unique temp subdir per run, isolating concurrent runs. The monitor filters
    // the "claude-monitor-summaries" path out, so its own summary runs never show
    // up as sessions. Cleaned up afterwards.
    let seq = RUN_SEQ.fetch_add(1, Ordering::Relaxed);
    let work = std::env::temp_dir()
        .join("claude-monitor-summaries")
        .join(format!("run-{}-{seq}", std::process::id()));
    let _ = std::fs::create_dir_all(&work);
    cmd.current_dir(&work);

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to launch claude: {e}"))?;
    let _ = std::fs::remove_dir_all(&work);

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = err.trim();
        return Err(if msg.is_empty() {
            format!("claude exited with status {}", output.status)
        } else {
            format!("claude error: {msg}")
        });
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Err("claude returned empty output".to_string())
    } else {
        Ok(text)
    }
}

/// The PATH from a login shell — GUI apps don't inherit the user's full PATH,
/// which claude (a Node CLI) needs to find its runtime + itself.
async fn login_path() -> Option<String> {
    // Interactive login shell (`-lic`) so .zshrc — where PATH is commonly set
    // (homebrew, node version managers, ~/.local/bin) — is sourced. Markers
    // bracket the value so any shell-init noise on stdout is discarded.
    let out = Command::new("/bin/zsh")
        .args(["-lic", "printf 'CMPSTART%sCMPEND' \"$PATH\""])
        .output()
        .await
        .ok()?;
    extract_marked(&out.stdout).filter(|p| !p.is_empty())
}

/// Locate the `claude` binary: explicit CLAUDE_BIN, then a login shell's PATH,
/// then common install locations.
async fn resolve_bin() -> Option<String> {
    if let Ok(explicit) = std::env::var("CLAUDE_BIN") {
        if !explicit.trim().is_empty() {
            return Some(explicit);
        }
    }
    if let Ok(out) = Command::new("/bin/zsh")
        .args(["-lic", "printf 'CMPSTART%sCMPEND' \"$(command -v claude)\""])
        .output()
        .await
    {
        if let Some(path) = extract_marked(&out.stdout) {
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }
    for candidate in [
        // cmux bundles its own claude; support it as a fallback.
        "/Applications/cmux.app/Contents/Resources/bin/claude",
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ] {
        if std::path::Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }
    let home = dirs::home_dir()?;
    for rel in [".local/bin/claude", ".claude/local/claude"] {
        let p = home.join(rel);
        if p.exists() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

/// Pull the value bracketed by `CMPSTART…CMPEND` out of shell stdout, ignoring
/// any surrounding shell-init noise.
fn extract_marked(stdout: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(stdout);
    Some(s.split("CMPSTART").nth(1)?.split("CMPEND").next()?.trim().to_string())
}
