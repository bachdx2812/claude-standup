import { useEffect, useState } from "react";
import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import IsoOffice from "./components/IsoOffice";
import DecisionTimeline from "./components/DecisionTimeline";
import { fetchSessions, onSessionsUpdate } from "./lib/tauri-events";
import { useSessions } from "./store/sessions-store";
import { contextPct, nowSec } from "./lib/format";

export default function App() {
  const sessions = useSessions((s) => s.sessions);
  const setSessions = useSessions((s) => s.setSessions);
  const [selected, setSelected] = useState<string | null>(null);
  const [windowHours, setWindowHours] = useState(
    () => Number(localStorage.getItem("cm.windowHours")) || 3,
  );

  const changeWindow = (h: number) => {
    setWindowHours(h);
    localStorage.setItem("cm.windowHours", String(h));
  };

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
    const unlisten = onSessionsUpdate(setSessions);
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, [setSessions]);

  // Show every real session (backend already drops stubs/temp). Sorted by the
  // backend: Running → Needs-Input → Idle, so active ones sit on top and nothing
  // ever drops off the board.
  // Recently-active sessions only, newest first.
  const cutoff = nowSec() - windowHours * 3600;
  const visible = sessions
    .filter((s) => (s.lastActivityUnix ?? 0) >= cutoff)
    .sort((a, b) => (b.lastActivityUnix ?? 0) - (a.lastActivityUnix ?? 0));
  const running = visible.filter((s) => s.state === "running").length;
  const needs = visible.filter((s) => s.state === "needsInput").length;
  // Overall Claude usage = Σ cost across visible sessions, + the busiest window.
  const totalCost = visible.reduce((a, s) => a + (s.costUsd || 0), 0);
  const maxContextPct = visible.reduce<number | null>((acc, s) => {
    const p = contextPct(s.contextUsedTokens, s.contextLimit);
    return p === null ? acc : Math.max(acc ?? 0, p);
  }, null);
  // Keep the open detail even if its session just dropped off the board.
  const selectedSession = sessions.find((s) => s.id === selected);

  return (
    <div className="app-shell">
      <Header
        running={running}
        needs={needs}
        windowHours={windowHours}
        onWindowChange={changeWindow}
        totalCost={totalCost}
        maxContextPct={maxContextPct}
      />
      <div className="app-body">
        <div className="app-main">
          {/* HERO: the office fills the main area — pixel employees ARE the sessions. */}
          <section className="office-stage">
            {visible.length === 0 ? (
              <div className="app-empty">
                <p>No active sessions right now.</p>
                <p className="muted">Start Claude Code in any project — it'll appear here.</p>
              </div>
            ) : (
              <IsoOffice sessions={visible} selected={selected} onSelect={setSelected} />
            )}
          </section>
          {/* Right rail: session list only. */}
          <aside className="right">
            <div className="rail-head">Sessions · {visible.length}</div>
            {visible.length === 0 ? (
              <div className="rail-empty muted">None active.</div>
            ) : (
              <div className="rail-cards">
                {visible.map((s) => (
                  <SessionCard
                    key={s.id}
                    s={s}
                    compact
                    selected={s.id === selected}
                    onSelect={() => setSelected(s.id)}
                  />
                ))}
              </div>
            )}
          </aside>
        </div>
        {/* Selected session detail: full-width bottom bar — only once you pick one. */}
        {selectedSession && (
          <div className="detail-bar">
            <DecisionTimeline session={selectedSession} />
          </div>
        )}
      </div>
    </div>
  );
}
