import { useEffect, useState } from "react";
import { fetchDecisions } from "../lib/tauri-events";
import { decisionIcon } from "../lib/format";
import { t } from "../lib/i18n";
import type { DecisionEvent, SessionSnapshot } from "../lib/types";

// The checked session's key-decisions timeline (footer under the office).
export default function DecisionTimeline({ session }: { session: SessionSnapshot }) {
  const [events, setEvents] = useState<DecisionEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const id = session.id;
  const decisionCount = session.decisionCount;

  useEffect(() => {
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

  return (
    <div className="decisions">
      <div className="decisions-head">{t("keyDecisions")}</div>
      <div className="detail-decisions">
        {loading ? (
          <div className="muted">{t("loading")}</div>
        ) : events.length === 0 ? (
          <div className="muted">{t("noDecisions")}</div>
        ) : (
          [...events].reverse().map((e, i) => (
            <div className="decision" key={e.refId ?? i}>
              <span className="decision-icon">{decisionIcon(e.kind)}</span>
              <div className="decision-body">
                <div className="decision-summary" title={e.summary}>
                  {e.summary}
                </div>
                {e.timestamp && (
                  <div className="decision-time">{new Date(e.timestamp).toLocaleTimeString()}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
