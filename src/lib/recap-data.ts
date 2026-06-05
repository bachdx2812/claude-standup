// Assemble the daily "StandUp Recap" from what the app already knows: today's
// tallies (daily-stats), the live sessions, the streak, and per-project levels.
// Pure derivation — no new tracking. Drives recap-draw.ts.

import type { SessionSnapshot } from "./types";
import { getToday } from "./daily-stats";
import { contextPct, projectName } from "./format";
import { levelOf, levelTitle } from "./progression";

export interface RecapData {
  date: string;
  spend: number;
  decisions: number;
  sessionCount: number;
  streak: number;
  /** Employee of the day = the highest-spend session (the canvas hero). */
  top?: { name: string; level: number; title: string; session: SessionSnapshot };
  persona: { label: string; emoji: string };
}

/** Pick a playful "team vibe" from today's mix (first match wins). */
function persona(
  spend: number,
  decisions: number,
  sessionCount: number,
  peakCtx: number,
): { label: string; emoji: string } {
  if (spend === 0 && decisions === 0) return { label: "Brewing Coffee", emoji: "☕" };
  if (decisions >= 20) return { label: "Shipping Machine", emoji: "🚀" };
  if (spend >= 10) return { label: "Big Spender", emoji: "💸" };
  if (sessionCount >= 4) return { label: "Multitasker", emoji: "🤹" };
  if (peakCtx >= 90) return { label: "Context Daredevil", emoji: "😅" };
  if (decisions >= 1) return { label: "Steady Hand", emoji: "🛠" };
  return { label: "Warming Up", emoji: "🌱" };
}

export function buildRecap(sessions: SessionSnapshot[], streak: number): RecapData {
  const stats = getToday();

  const topSession = sessions.reduce<SessionSnapshot | null>(
    (best, s) => ((s.costUsd || 0) > (best?.costUsd || 0) ? s : best),
    null,
  );
  const top =
    topSession && (topSession.costUsd || 0) > 0
      ? {
          name: projectName(topSession),
          level: levelOf(topSession.projectPath),
          title: levelTitle(levelOf(topSession.projectPath)),
          session: topSession,
        }
      : undefined;

  const peakCtx = sessions.reduce((acc, s) => {
    const p = contextPct(s.contextUsedTokens, s.contextLimit);
    return p === null ? acc : Math.max(acc, p);
  }, 0);

  return {
    date: stats.date,
    spend: stats.spend,
    decisions: stats.decisions,
    sessionCount: stats.sessions.length,
    streak,
    top,
    persona: persona(stats.spend, stats.decisions, stats.sessions.length, peakCtx),
  };
}
