// On-demand session summarization via the locally-installed Claude Code CLI
// (`claude -p`), reusing the user's existing Claude login. Opt-in, per session,
// never automatic. No API key, no extra cost beyond the user's Claude plan.

pub mod claude_cli;
pub mod pricing;
pub mod prompt;
