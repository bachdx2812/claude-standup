import { useEffect, useRef, useState } from "react";
import { fetchDecisions, summarizeSession } from "../lib/tauri-events";
import { contextColor, contextPct, decisionIcon, formatCost, projectName } from "../lib/format";
import { SummaryMarkdown } from "./summary-markdown";
import type { DecisionEvent, SessionSnapshot } from "../lib/types";

const AUTO_SUMMARY_MS = 30_000;

// Module-level cache so summaries persist across re-selection. Keyed by session
// id; `activity` is the session's last-activity stamp when it was summarized, so
// re-selecting an unchanged session reuses the cached text instead of re-running.
const summaryCache = new Map<string, { activity: number | null; text: string }>();

export default function DecisionTimeline({ session }: { session?: SessionSnapshot }) {
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const id = session?.id;
  const state = session?.state;
  const decisionCount = session?.decisionCount ?? 0;
  const lastActivity = session?.lastActivityUnix ?? null;

  const inFlight = useRef(false);
  const lastActivityRef = useRef(lastActivity);
  lastActivityRef.current = lastActivity;

  // Decisions: refetch on select + when new ones land.
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

  // Show any cached summary immediately on select.
  useEffect(() => {
    setSummaryError(null);
    setSummary(id ? (summaryCache.get(id)?.text ?? null) : null);
  }, [id]);

  // Summarize policy:
  //   running     → refresh every 30s.
  //   needsInput/idle → run once on select; on re-select with unchanged activity,
  //                     reuse the cached summary (don't re-run).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const run = () => {
      if (inFlight.current) return; // never overlap
      inFlight.current = true;
      setSummarizing(true);
      const act = lastActivityRef.current;
      summarizeSession(id)
        .then((s) => {
          if (!cancelled) {
            setSummary(s);
            setSummaryError(null);
          }
          summaryCache.set(id, { activity: act, text: s });
        })
        .catch((e) => !cancelled && setSummaryError(String(e)))
        .finally(() => {
          inFlight.current = false;
          if (!cancelled) setSummarizing(false);
        });
    };

    if (state === "running") {
      run();
      const timer = setInterval(run, AUTO_SUMMARY_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }

    // Non-running: only summarize if we have nothing fresh for this activity.
    const cached = summaryCache.get(id);
    if (!cached || cached.activity !== lastActivityRef.current) {
      run();
    } else {
      setSummary(cached.text);
    }
    return () => {
      cancelled = true;
    };
  }, [id, state]);

  if (!session) {
    return <div className="detail detail-empty">Select a session to see its decisions + summary.</div>;
  }

  return (
    <div className="detail">
      {/* LEFT: identity + key decisions (the focus). */}
      <div className="detail-main">
        <div className="detail-head">
          <div className="detail-title">{projectName(session)}</div>
          <div className="detail-status">{session.currentStatus}</div>
        </div>
        <DetailMeta session={session} />
        {session.latestPrompt && <div className="detail-prompt">“{session.latestPrompt}”</div>}

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

      {/* RIGHT: a small summary box. */}
      <aside className="detail-side">
        <div className="summarize-head">
          <span className="summarize-label">✦ Summary</span>
          {summarizing && <span className="summarizing">● summarizing…</span>}
        </div>
        {summaryError ? (
          <div className="summary-error">{summaryError}</div>
        ) : summary ? (
          <SummaryMarkdown text={summary} />
        ) : (
          <div className="muted">{summarizing ? "Generating summary…" : "—"}</div>
        )}
      </aside>
    </div>
  );
}

// Identity badges: working dir, git branch, model, cost, context%. Styled pills.
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
