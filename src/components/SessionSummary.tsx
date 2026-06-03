import { useEffect, useRef, useState } from "react";
import { summarizeSession } from "../lib/tauri-events";
import { SummaryMarkdown } from "./summary-markdown";
import type { SessionSnapshot } from "../lib/types";

const AUTO_SUMMARY_MS = 30_000;

// Module-level cache so summaries persist across re-selection. Keyed by session
// id; `activity` is the session's last-activity stamp when it was summarized, so
// re-selecting an unchanged session reuses the cached text instead of re-running.
const summaryCache = new Map<string, { activity: number | null; text: string }>();

// Lives at the bottom of the right rail (under the sessions list). Auto-summary
// policy: running → every 30s; idle/needs-input → once per activity, then cached.
export default function SessionSummary({ session }: { session?: SessionSnapshot }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const id = session?.id;
  const state = session?.state;
  const lastActivity = session?.lastActivityUnix ?? null;

  const inFlight = useRef(false);
  const lastActivityRef = useRef(lastActivity);
  lastActivityRef.current = lastActivity;

  useEffect(() => {
    setSummaryError(null);
    setSummary(id ? (summaryCache.get(id)?.text ?? null) : null);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const run = () => {
      if (inFlight.current) return;
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

    const cached = summaryCache.get(id);
    if (!cached || cached.activity !== lastActivityRef.current) run();
    else setSummary(cached.text);
    return () => {
      cancelled = true;
    };
  }, [id, state]);

  if (!session) return null;

  return (
    <div className="rail-summary">
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
    </div>
  );
}
