import { contextColor, contextPct, formatCost, projectName, stalledMins } from "../lib/format";
import type { SessionSnapshot } from "../lib/types";

// At/above this context %, nudge the user to /compact (aligns with the amber
// pressure band in format.ts: amber > 80, red > 95).
const CTX_NUDGE = 85;

// The checked session's identity — rendered as the seamless footer of the
// sessions list (left column): title, status, badges, latest command.
export default function SessionDetail({ session }: { session: SessionSnapshot }) {
  const pct = contextPct(session.contextUsedTokens, session.contextLimit);
  const hasCost = (session.costUsd ?? 0) > 0;
  const stalled = stalledMins(session);
  return (
    <div className="session-detail">
      <div className="detail-head">
        <div className="detail-title">{projectName(session)}</div>
        <div className="detail-status">{session.currentStatus}</div>
      </div>
      <div className="detail-meta">
        <span className="meta-pill pill-cwd" title={session.projectPath}>
          📁 {session.projectPath}
        </span>
        {session.branch && <span className="meta-pill pill-branch">⎇ {session.branch}</span>}
        {session.model && <span className="meta-pill pill-model">{session.model}</span>}
        {hasCost && <span className="meta-pill pill-cost">{formatCost(session.costUsd)}</span>}
        {stalled !== null && (
          <span className="meta-pill pill-stalled" title="Running, but no new output for a while — it may be on a long tool, or stuck">
            ⏳ {stalled}m
          </span>
        )}
        {pct !== null && (
          <span
            className="meta-pill pill-ctx"
            style={{ color: contextColor(pct), borderColor: contextColor(pct) }}
            title={pct >= CTX_NUDGE ? "Context is filling up — run /compact in this session to free room" : undefined}
          >
            {pct}% ctx{pct >= CTX_NUDGE ? " · /compact?" : ""}
          </span>
        )}
      </div>
      {session.latestPrompt && <div className="detail-prompt">“{session.latestPrompt}”</div>}
    </div>
  );
}
