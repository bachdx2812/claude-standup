import { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import IsoOffice from "./components/IsoOffice";
import DecisionTimeline from "./components/DecisionTimeline";
import SessionSummary from "./components/SessionSummary";
import SessionDetail from "./components/SessionDetail";
import { fetchSessions, onSessionsUpdate } from "./lib/tauri-events";
import { useSessions } from "./store/sessions-store";
import { useLang } from "./store/lang-store";
import { contextPct, nowSec } from "./lib/format";
import { t } from "./lib/i18n";
import { checkForUpdate } from "./lib/updater";
import { addXp, tickStreak } from "./lib/progression";
import { addSpend, todaySpend } from "./lib/daily-spend";

export default function App() {
  const sessions = useSessions((s) => s.sessions);
  const setSessions = useSessions((s) => s.setSessions);
  const [selected, setSelected] = useState<string | null>(null);
  const [streak] = useState(() => tickStreak()); // daily streak, bumped once on load
  const [todayCost, setTodayCost] = useState(() => todaySpend());
  const prevDecisionsRef = useRef<Map<string, number>>(new Map());
  const seededXpRef = useRef(false);
  const prevCostRef = useRef<Map<string, number>>(new Map());
  const seededCostRef = useRef(false);
  useLang((s) => s.lang); // re-render the chrome when the language changes
  const [windowHours, setWindowHours] = useState(() => {
    const v = Number(localStorage.getItem("cm.windowHours"));
    return [1, 3, 12, 24].includes(v) ? v : 3;
  });
  // Resizable footer (detail bar) so you can size it to your content — no forced scrolling.
  const [footerH, setFooterH] = useState(() => {
    const v = Number(localStorage.getItem("cm.footerH"));
    return Number.isFinite(v) && v >= 150 && v <= window.innerHeight * 0.72 ? v : 300;
  });
  const footerHRef = useRef(footerH);
  footerHRef.current = footerH;
  const detailBarRef = useRef<HTMLDivElement>(null);

  const changeWindow = (h: number) => {
    setWindowHours(h);
    localStorage.setItem("cm.windowHours", String(h));
  };

  // Resize by writing the height straight to the DOM during the drag (no React
  // re-render per mousemove); commit to state + localStorage once on mouse-up.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const bar = detailBarRef.current;
    let h = footerHRef.current;
    const onMove = (ev: MouseEvent) => {
      h = Math.min(window.innerHeight * 0.72, Math.max(150, window.innerHeight - ev.clientY));
      if (bar) bar.style.height = `${h}px`;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setFooterH(h);
      localStorage.setItem("cm.footerH", String(Math.round(h)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
    const unlisten = onSessionsUpdate(setSessions);
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, [setSessions]);

  // Quietly check GitHub Releases for a newer build shortly after launch.
  useEffect(() => {
    const id = setTimeout(() => checkForUpdate(), 4000);
    return () => clearTimeout(id);
  }, []);

  // Award per-project XP when a session lands new key decisions. Seed silently
  // on the first pass so existing history doesn't all count at once.
  useEffect(() => {
    const prev = prevDecisionsRef.current;
    const seeded = seededXpRef.current;
    for (const s of sessions) {
      const old = prev.get(s.id);
      if (seeded && old !== undefined && s.decisionCount > old) {
        addXp(s.projectPath, s.decisionCount - old);
      }
      prev.set(s.id, s.decisionCount);
    }
    seededXpRef.current = true;
  }, [sessions]);

  // Accumulate USD spent today from positive per-session cost deltas. Seed
  // silently on the first pass so lifetime cost doesn't all land at once.
  useEffect(() => {
    const prev = prevCostRef.current;
    const seeded = seededCostRef.current;
    let added = 0;
    for (const s of sessions) {
      const old = prev.get(s.id);
      const cost = s.costUsd || 0;
      if (seeded && old !== undefined && cost > old) added += cost - old;
      prev.set(s.id, cost);
    }
    if (added > 0) setTodayCost(addSpend(added));
    seededCostRef.current = true;
  }, [sessions]);

  // Show every real session (backend already drops stubs/temp). Sorted by the
  // backend: Running → Needs-Input → Idle, so active ones sit on top and nothing
  // ever drops off the board.
  // Recently-active sessions only, newest first.
  const cutoff = nowSec() - windowHours * 3600;
  const visible = sessions
    .filter((s) => (s.lastActivityUnix ?? 0) >= cutoff)
    .sort((a, b) => (b.lastActivityUnix ?? 0) - (a.lastActivityUnix ?? 0));
  const running = visible.filter((s) => s.state === "running").length;
  const needsSessions = visible.filter((s) => s.state === "needsInput");
  const restSessions = visible.filter((s) => s.state !== "needsInput");
  const needs = needsSessions.length;
  // Overall Claude usage = Σ cost across visible sessions, + the busiest window.
  const totalCost = visible.reduce((a, s) => a + (s.costUsd || 0), 0);
  const maxContextPct = visible.reduce<number | null>((acc, s) => {
    const p = contextPct(s.contextUsedTokens, s.contextLimit);
    return p === null ? acc : Math.max(acc ?? 0, p);
  }, null);
  // Only while the checked session is still active (in view): hide the detail
  // footer + summary once it ages out or there are no sessions.
  const selectedSession = visible.find((s) => s.id === selected);
  // "Employee of the day": the visible session with the highest spend.
  const topId = visible.reduce<{ id: string | null; cost: number }>(
    (best, s) => ((s.costUsd || 0) > best.cost ? { id: s.id, cost: s.costUsd || 0 } : best),
    { id: null, cost: 0 },
  ).id;

  return (
    <div className="app-shell">
      <Header
        running={running}
        needs={needs}
        windowHours={windowHours}
        onWindowChange={changeWindow}
        totalCost={totalCost}
        maxContextPct={maxContextPct}
        streak={streak}
        todayCost={todayCost}
      />
      <div className="app-body">
        <div className="main-col">
          {/* Top row: sessions list + office. */}
          <div className="app-main">
            <aside className="left-rail">
              {needsSessions.length > 0 && (
                <>
                  <div className="rail-head needs">
                    🔔 {t("needsYou")} · {needsSessions.length}
                  </div>
                  <div className="rail-cards needs-cards">
                    {needsSessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        s={s}
                        compact
                        selected={s.id === selected}
                        top={s.id === topId}
                        onSelect={() => setSelected(s.id)}
                      />
                    ))}
                  </div>
                </>
              )}
              <div className="rail-head">
                {t("sessions")} · {restSessions.length}
              </div>
              {restSessions.length === 0 ? (
                <div className="rail-empty muted">{t("noneActive")}</div>
              ) : (
                <div className="rail-cards">
                  {restSessions.map((s) => (
                    <SessionCard
                      key={s.id}
                      s={s}
                      compact
                      selected={s.id === selected}
                      top={s.id === topId}
                      onSelect={() => setSelected(s.id)}
                    />
                  ))}
                </div>
              )}
            </aside>
            <section className="office-stage">
              {visible.length === 0 ? (
                <div className="app-empty">
                  <p>{t("emptyTitle")}</p>
                  <p className="muted">{t("emptyHint")}</p>
                </div>
              ) : (
                <IsoOffice sessions={visible} selected={selected} onSelect={setSelected} />
              )}
            </section>
          </div>
          {/* Footer row: detail (under the list) + key decisions (under the office) —
              one aligned band, the detail column flush with the sessions list above. */}
          {selectedSession && (
            <div className="detail-bar" ref={detailBarRef} style={{ height: footerH }}>
              <div className="detail-resizer" onMouseDown={startResize} title="Drag to resize" />
              <SessionDetail key={selectedSession.id} session={selectedSession} />
              <DecisionTimeline session={selectedSession} />
            </div>
          )}
        </div>
        {/* Far-right: the checked session's summary, full height. */}
        {selectedSession && (
          <aside className="summary-col">
            <SessionSummary session={selectedSession} />
          </aside>
        )}
      </div>
    </div>
  );
}
