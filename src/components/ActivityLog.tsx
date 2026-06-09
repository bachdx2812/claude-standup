import { useEffect, useState } from "react";
import { fetchActivity } from "../lib/tauri-events";
import { toolIcon } from "../lib/format";
import { t } from "../lib/i18n";
import type { ActivityEvent, SessionSnapshot } from "../lib/types";

// The checked session's live tool-activity feed (raw tool_use stream), newest
// first. Refreshes whenever the session lands new transcript lines.
export default function ActivityLog({ session }: { session: SessionSnapshot }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const id = session.id;
  const lineCount = session.lineCount;

  useEffect(() => {
    let alive = true;
    fetchActivity(id)
      .then((e) => alive && setEvents(e))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, lineCount]);

  return (
    <div className="activity">
      <div className="decisions-head">{t("liveActivity")}</div>
      <div className="activity-feed">
        {events.length === 0 ? (
          <div className="muted">{t("noActivity")}</div>
        ) : (
          [...events].reverse().map((e, i) => (
            <div className="activity-row" key={`${e.timestamp ?? ""}-${i}`}>
              <span className="activity-icon">{toolIcon(e.tool)}</span>
              <span className="activity-tool">{e.tool}</span>
              {e.detail && (
                <span className="activity-detail" title={e.detail}>
                  {e.detail}
                </span>
              )}
              {e.timestamp && (
                <span className="activity-time">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
