// Summarize a session by shelling out to the locally-installed Claude Code CLI
// (`claude -p`), reusing the user's existing Claude login — no API key, no extra
// cost beyond their Claude plan. GUI apps don't inherit the shell PATH, so the
// binary is resolved via a login shell + common install locations.

use tokio::process::Command;

/// Run `claude -p <prompt>` and return its text output.
pub async fn summarize(prompt: &str, model: Option<&str>) -> Result<String, String> {
    let bin = resolve_bin().await.ok_or_else(|| {
        "Claude Code CLI not found. Install Claude Code, or set CLAUDE_BIN to its path.".to_string()
    })?;

    let mut cmd = Command::new(&bin);
    cmd.arg("-p").arg(prompt);
    if let Some(m) = model {
        if !m.trim().is_empty() {
            cmd.arg("--model").arg(m.trim());
        }
    }
    // Run in a dedicated, clearly-named temp subdir; the monitor filters this
    // path out so its own summary runs never appear as sessions.
    let work = std::env::temp_dir().join("claude-monitor-summaries");
    let _ = std::fs::create_dir_all(&work);
    cmd.current_dir(&work);

    // GUI apps launched from /Applications inherit only a minimal PATH, so the
    // node runtime claude relies on isn't found ("claude not found in PATH").
    // Give it the user's real login PATH.
    if let Some(path) = login_path().await {
        cmd.env("PATH", path);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to launch claude: {e}"))?;

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
    let out = Command::new("/bin/zsh")
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
        .await
        .ok()?;
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if p.is_empty() {
        None
    } else {
        Some(p)
    }
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
        .args(["-lc", "command -v claude"])
        .output()
        .await
    {
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !path.is_empty() && std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }
    for candidate in [
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
