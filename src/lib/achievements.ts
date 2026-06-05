// localStorage-backed achievements. Earned once, kept forever; surfaced as
// badges on the Recap card and a one-off toast on unlock. Pure flavour — derived
// from data the app already tracks (streak, today's tallies, project levels).

export interface Achievement {
  id: string;
  emoji: string;
  label: string;
}

export interface AchievementCtx {
  streak: number;
  spend: number; // today
  decisions: number; // today
  sessionCount: number; // today
  maxLevel: number; // highest project level seen
}

// id + how it's earned. Order = display order on the recap card.
const LIST: (Achievement & { earned: (c: AchievementCtx) => boolean })[] = [
  { id: "streak-3", emoji: "🔥", label: "3-day streak", earned: (c) => c.streak >= 3 },
  { id: "streak-7", emoji: "⚡", label: "7-day streak", earned: (c) => c.streak >= 7 },
  { id: "busy-bee", emoji: "🐝", label: "5 sessions in a day", earned: (c) => c.sessionCount >= 5 },
  { id: "decisive", emoji: "🧠", label: "25 decisions in a day", earned: (c) => c.decisions >= 25 },
  { id: "big-day", emoji: "💸", label: "$50 in a day", earned: (c) => c.spend >= 50 },
  { id: "senior", emoji: "🎧", label: "Reached Senior", earned: (c) => c.maxLevel >= 4 },
  { id: "principal", emoji: "👑", label: "Reached Principal", earned: (c) => c.maxLevel >= 9 },
];

export const ACHIEVEMENT_COUNT = LIST.length;

const KEY = "cm.achievements";
const strip = ({ id, emoji, label }: Achievement): Achievement => ({ id, emoji, label });

function loadEarned(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Evaluate achievements; persist + return the full earned list + any newly unlocked. */
export function checkAchievements(ctx: AchievementCtx): {
  earned: Achievement[];
  newly: Achievement[];
} {
  const have = loadEarned();
  const newly: Achievement[] = [];
  for (const a of LIST) {
    if (a.earned(ctx) && !have.has(a.id)) {
      have.add(a.id);
      newly.push(strip(a));
    }
  }
  if (newly.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify([...have]));
    } catch {
      /* storage disabled / full — ignore */
    }
  }
  return { earned: LIST.filter((a) => have.has(a.id)).map(strip), newly };
}

/** The earned list with no mutation — for the recap card. */
export function earnedAchievements(): Achievement[] {
  const have = loadEarned();
  return LIST.filter((a) => have.has(a.id)).map(strip);
}
