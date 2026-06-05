// localStorage-backed gamification: per-project XP + level, and a daily streak.
// Pure flavour — never affects monitoring. All reads/writes are best-effort
// (storage may be disabled or full), so every accessor swallows errors.

const XP_KEY = "cm.xp"; // { [projectPath]: xpNumber }
const STREAK_KEY = "cm.streak"; // { date: "YYYY-MM-DD", streak: number }

type XpMap = Record<string, number>;

function loadXp(): XpMap {
  try {
    return JSON.parse(localStorage.getItem(XP_KEY) || "{}") as XpMap;
  } catch {
    return {};
  }
}

function saveXp(m: XpMap): void {
  try {
    localStorage.setItem(XP_KEY, JSON.stringify(m));
  } catch {
    /* storage disabled / full — ignore */
  }
}

/** Level from XP. XP = lifetime key-decisions; sqrt curve so it slows over time. */
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp))));
}

/** Add XP (key-decision deltas) to a project; returns new level + level-up flag. */
export function addXp(project: string, amount: number): { level: number; leveledUp: boolean } {
  if (amount <= 0) return { level: levelOf(project), leveledUp: false };
  const m = loadXp();
  const before = m[project] ?? 0;
  const after = before + amount;
  m[project] = after;
  saveXp(m);
  return { level: levelForXp(after), leveledUp: levelForXp(after) > levelForXp(before) };
}

/** Current level for a project. */
export function levelOf(project: string): number {
  return levelForXp(loadXp()[project] ?? 0);
}

/** Seniority title for a level. */
export function levelTitle(level: number): string {
  if (level >= 9) return "Principal";
  if (level >= 6) return "Staff";
  if (level >= 4) return "Senior";
  if (level >= 2) return "Mid";
  return "Junior";
}

const dayStr = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Bump the daily streak — call once on app load. Returns the current streak. */
export function tickStreak(): number {
  const today = dayStr(Date.now());
  let date = "";
  let streak = 0;
  try {
    const raw = JSON.parse(localStorage.getItem(STREAK_KEY) || "{}");
    date = raw.date ?? "";
    streak = raw.streak ?? 0;
  } catch {
    /* defaults */
  }
  if (date === today) return streak; // already counted today
  streak = date === dayStr(Date.now() - 86_400_000) ? streak + 1 : 1;
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify({ date: today, streak }));
  } catch {
    /* ignore */
  }
  return streak;
}
