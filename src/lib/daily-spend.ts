// localStorage-backed "spent today" tracker. Sums positive per-session cost
// deltas into one daily bucket that resets when the date rolls over. Pure
// insight — never affects monitoring. Best-effort (storage may be disabled/full),
// so every accessor swallows errors. Mirrors the seed-silently pattern in
// [progression.ts] so existing lifetime cost doesn't all land at once.

const KEY = "cm.dailySpend"; // { date: "YYYY-MM-DD", total: number }

type Bucket = { date: string; total: number };

const today = (): string => new Date().toISOString().slice(0, 10);

function load(): Bucket {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { date: raw.date ?? "", total: raw.total ?? 0 };
  } catch {
    return { date: "", total: 0 };
  }
}

/** Add a positive USD delta to today's running total; returns the new total. */
export function addSpend(deltaUsd: number): number {
  if (!(deltaUsd > 0)) return todaySpend();
  const t = today();
  const cur = load();
  const total = (cur.date === t ? cur.total : 0) + deltaUsd;
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: t, total }));
  } catch {
    /* storage disabled / full — ignore */
  }
  return total;
}

/** USD spent so far today (0 if none, or the stored date has rolled over). */
export function todaySpend(): number {
  const cur = load();
  return cur.date === today() ? cur.total : 0;
}
