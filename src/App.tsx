import { useEffect, useRef, useState } from "react";
import Header from "./components/Header";
import SessionCard from "./components/SessionCard";
import IsoOffice from "./components/IsoOffice";
import DecisionTimeline from "./components/DecisionTimeline";
import SessionSummary from "./components/SessionSummary";
import SessionDetail from "./components/SessionDetail";
import { fetchSessions, onBlockUpdate, onSessionsUpdate } from "./lib/tauri-events";
import type { BillingBlock, SessionSnapshot } from "./lib/types";
import { useSessions } from "./store/sessions-store";
import { useLang } from "./store/lang-store";
import { contextPct, nowSec } from "./lib/format";
import { t } from "./lib/i18n";
import { checkForUpdate } from "./lib/updater";
import { addXp, levelOf, tickStreak } from "./lib/progression";
import { getToday, recordToday } from "./lib/daily-stats";
import { type Achievement, checkAchievements } from "./lib/achievements";
import RecapModal from "./components/RecapModal";

export default function App() {
  const sessions = useSessions((s) => s.sessions);
  const setSessions = useSessions((s) => s.setSessions);
  const [selected, setSelected] = useState<string | null>(null);
  const [streak] = useState(() => tickStreak()); // daily streak, bumped once on load
  const [today, setToday] = useState(() => getToday());
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [recapOpen, setRecapOpen] = useState(false);
  const [achievement, setAchievement] = useState<Achievement | null>(null);
  const prevDecisionsRef = useRef<Map<string, number>>(new Map());
  const prevCostRef = useRef<Map<string, number>>(new Map());
  const seededRef = useRef(false);
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
    const unSessions = onSessionsUpdate(setSessions);
    const unBlock = onBlockUpdate(setBlock);
    return () => {
      unSessions.then((f) => f()).catch(() => {});
      unBlock.then((f) => f()).catch(() => {});
    };
  }, [setSessions]);

  // Quietly check GitHub Releases for a newer build shortly after launch.
  useEffect(() => {
    const id = setTimeout(() => checkForUpdate(), 4000);
    return () => clearTimeout(id);
  }, []);

  // Per-session deltas drive XP + today's tallies (spend, decisions, sessions
  // seen). Seed silently on the first pass so lifetime history doesn't all land
  // at once.
  useEffect(() => {
    const prevD = prevDecisionsRef.current;
    const prevC = prevCostRef.current;
    const seeded = seededRef.current;
    let dSpend = 0;
    let dDec = 0;
    const touched: string[] = [];
    for (const s of sessions) {
      const oldD = prevD.get(s.id);
      const oldC = prevC.get(s.id);
      const cost = s.costUsd || 0;
      if (seeded) {
        if (oldD !== undefined && s.decisionCount > oldD) {
          const inc = s.decisionCount - oldD;
          addXp(s.projectPath, inc);
          dDec += inc;
          touched.push(s.id);
        }
        if (oldC !== undefined && cost > oldC) {
          dSpend += cost - oldC;
          touched.push(s.id);
        }
      }
      prevD.set(s.id, s.decisionCount);
      prevC.set(s.id, cost);
    }
    if (dSpend > 0 || dDec > 0) {
      setToday(recordToday({ spend: dSpend, decisions: dDec, sessionIds: touched }));
    }
    seededRef.current = true;
  }, [sessions]);

  // Unlock achievements from the live stats; surface the newest as a toast.
  useEffect(() => {
    const maxLevel = sessions.reduce((m, s) => Math.max(m, levelOf(s.projectPath)), 0);
    const { newly } = checkAchievements({
      streak,
      spend: today.spend,
      decisions: today.decisions,
      sessionCount: today.sessions.length,
      maxLevel,
    });
    if (newly.length) setAchievement(newly[newly.length - 1]);
  }, [sessions, streak, today]);

  useEffect(() => {
    if (!achievement) return;
    const id = setTimeout(() => setAchievement(null), 4500);
    return () => clearTimeout(id);
  }, [achievement]);

  // Show every real session (backend already drops stubs/temp). Sorted by the
  // backend: Running → Needs-Input → Idle, so active ones sit on top and nothing
  // ever drops off the board.
  // Recently-active sessions only, newest first.
  const cutoff = nowSec() - windowHours * 3600;
  const visible = sessions
    .filter((s) => (s.lastActivityUnix ?? 0) >= cutoff)
    .sort((a, b) => (b.lastActivityUnix ?? 0) - (a.lastActivityUnix ?? 0));
  const needsSessions = visible.filter((s) => s.state === "needsInput");
  const runningSessions = visible.filter((s) => s.state === "running");
  const idleSessions = visible.filter((s) => s.state === "idle");
  const running = runningSessions.length;
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

  // One titled rail section per state group; renders nothing when the group is empty.
  const railSection = (
    label: string,
    list: SessionSnapshot[],
    headClass = "",
    cardsClass = "",
  ) =>
    list.length > 0 ? (
      <>
        <div className={`rail-head ${headClass}`.trim()}>{label}</div>
        <div className={`rail-cards ${cardsClass}`.trim()}>
          {list.map((s) => (
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
    ) : null;

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
        todayCost={today.spend}
        block={block}
        onOpenRecap={() => setRecapOpen(true)}
      />
      <div className="app-body">
        <div className="main-col">
          {/* Top row: sessions list + office. */}
          <div className="app-main">
            <aside className="left-rail">
              {railSection(
                `🔔 ${t("needsYou")} · ${needsSessions.length}`,
                needsSessions,
                "needs",
                "needs-cards",
              )}
              {railSection(`${t("running")} · ${runningSessions.length}`, runningSessions)}
              {railSection(`${t("idle")} · ${idleSessions.length}`, idleSessions)}
              {visible.length === 0 && <div className="rail-empty muted">{t("noneActive")}</div>}
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
      <RecapModal
        open={recapOpen}
        sessions={sessions}
        streak={streak}
        onClose={() => setRecapOpen(false)}
      />
      {achievement && (
        <div className="achievement-toast">
          🏆 Unlocked: {achievement.emoji} {achievement.label}
        </div>
      )}
    </div>
  );
}
