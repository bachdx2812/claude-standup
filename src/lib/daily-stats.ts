// localStorage-backed "today at the office" tallies: spend, key-decisions, and
// the set of sessions seen — all reset when the date rolls over. Pure insight /
// flavour, best-effort (storage may be disabled/full). Feeds the header "today"
// pill and the daily Recap card. Mirrors the seed-silently pattern in App.tsx.

const KEY = "cm.dailyStats"; // { date, spend, decisions, sessions[] }

export interface DailyStats {
  date: string;
  spend: number;
  decisions: number;
  sessions: string[];
}

const today = (): string => new Date().toISOString().slice(0, 10);

function load(): DailyStats {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      date: r.date ?? "",
      spend: r.spend ?? 0,
      decisions: r.decisions ?? 0,
      sessions: Array.isArray(r.sessions) ? r.sessions : [],
    };
  } catch {
    return { date: "", spend: 0, decisions: 0, sessions: [] };
  }
}

/** Today's bucket, rolling over to a fresh one if the stored date is stale. */
function freshToday(prev: DailyStats): DailyStats {
  return prev.date === today()
    ? prev
    : { date: today(), spend: 0, decisions: 0, sessions: [] };
}

/** Fold a scan's positive deltas into today's tallies; returns updated stats. */
export function recordToday(d: {
  spend?: number;
  decisions?: number;
  sessionIds?: string[];
}): DailyStats {
  const s = freshToday(load());
  if (d.spend && d.spend > 0) s.spend += d.spend;
  if (d.decisions && d.decisions > 0) s.decisions += d.decisions;
  for (const id of d.sessionIds ?? []) {
    if (!s.sessions.includes(id)) s.sessions.push(id);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled / full — ignore */
  }
  return s;
}

/** Today's tallies (zeroed if the stored date has rolled over). */
export function getToday(): DailyStats {
  return freshToday(load());
}
