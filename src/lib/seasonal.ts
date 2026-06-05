// A tiny seasonal accent for the header — pure flavour, null on ordinary days.
// Uses the local date; the office stays the same, this is just a festive chip.

export interface Season {
  emoji: string;
  label: string;
}

export function seasonalAccent(d: Date = new Date()): Season | null {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m === 1 && day <= 2) return { emoji: "🎉", label: "Happy New Year" };
  if (m === 2 && day === 14) return { emoji: "💝", label: "Valentine's Day" };
  if (m === 10 && day >= 25) return { emoji: "🎃", label: "Spooky season" };
  if (m === 12) return { emoji: "❄️", label: "Happy Holidays" };
  return null;
}
