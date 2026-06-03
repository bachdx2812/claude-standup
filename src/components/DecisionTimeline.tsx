import { useEffect, useState } from "react";
import { fetchDecisions } from "../lib/tauri-events";
import { contextColor, contextPct, decisionIcon, formatCost, projectName } from "../lib/format";
import type { DecisionEvent, SessionSnapshot } from "../lib/types";

// Footer detail: LEFT = session info (title, status, badges, latest prompt);
// CENTER = the key-decisions timeline. The summary lives in the right rail.
export default function DecisionTimeline({ session }: { session?: SessionSnapshot }) {
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const id = session?.id;
  const decisionCount = session?.decisionCount ?? 0;

  useEffect(() => {
    if (!id) {
      setEvents([]);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchDecisions(id)
      .then((e) => alive && setEvents(e))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, decisionCount]);

  if (!session) {
    return <div className="detail detail-empty">Select a session to see its info + decisions.</div>;
  }

  return (
    <div className="detail">
      {/* LEFT: identity + latest command. */}
      <div className="detail-info">
        <div className="detail-head">
          <div className="detail-title">{projectName(session)}</div>
          <div className="detail-status">{session.currentStatus}</div>
        </div>
        <DetailMeta session={session} />
        {session.latestPrompt && <div className="detail-prompt">“{session.latestPrompt}”</div>}
      </div>

      {/* CENTER: key decisions. */}
      <div className="detail-center">
        <div className="decisions-head">Key Decisions</div>
        <div className="detail-decisions">
          {loading ? (
            <div className="muted">Loading…</div>
          ) : events.length === 0 ? (
            <div className="muted">No key decisions captured yet.</div>
          ) : (
            [...events].reverse().map((e, i) => (
              <div className="decision" key={e.refId ?? i}>
                <span className="decision-icon">{decisionIcon(e.kind)}</span>
                <div className="decision-body">
                  <div className="decision-summary">{e.summary}</div>
                  {e.timestamp && (
                    <div className="decision-time">{new Date(e.timestamp).toLocaleTimeString()}</div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Identity badges: working dir, git branch, model, cost, context%.
function DetailMeta({ session }: { session: SessionSnapshot }) {
  const pct = contextPct(session.contextUsedTokens, session.contextLimit);
  const hasCost = (session.costUsd ?? 0) > 0;
  return (
    <div className="detail-meta">
      <span className="meta-pill pill-cwd" title={session.projectPath}>
        📁 {session.projectPath}
      </span>
      {session.branch && <span className="meta-pill pill-branch">⎇ {session.branch}</span>}
      {session.model && <span className="meta-pill pill-model">{session.model}</span>}
      {hasCost && <span className="meta-pill pill-cost">{formatCost(session.costUsd)}</span>}
      {pct !== null && (
        <span
          className="meta-pill pill-ctx"
          style={{ color: contextColor(pct), borderColor: contextColor(pct) }}
        >
          {pct}% ctx
        </span>
      )}
    </div>
  );
}
