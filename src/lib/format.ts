// Small presentation helpers shared across components.

import { t } from "./i18n";
import type { DecisionKind, SessionSnapshot, SessionState } from "./types";

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** True if `unix` is within the last `minutes`. */
export function isRecent(unix: number | null | undefined, minutes: number): boolean {
  if (!unix) return false;
  return nowSec() - unix <= minutes * 60;
}

export function timeAgo(unix?: number | null): string {
  if (!unix) return "—";
  const s = Math.max(0, nowSec() - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Display name: AI-generated title if present, else the project folder name. */
export function projectName(s: SessionSnapshot): string {
  if (s.title && s.title.trim()) return s.title;
  const parts = s.projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || s.projectPath;
}

/** Trailing folder of the project path (always the path, never the title). */
export function projectFolder(s: SessionSnapshot): string {
  const parts = s.projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || s.projectPath;
}

export function stateColor(state: SessionState): string {
  switch (state) {
    case "running":
      return "#34d399"; // green
    case "needsInput":
      return "#fbbf24"; // amber — your turn
    default:
      return "#64748b"; // grey — idle
  }
}

export function stateLabel(state: SessionState): string {
  switch (state) {
    case "running":
      return t("running");
    case "needsInput":
      return t("needsInput");
    default:
      return t("idle");
  }
}

/** USD cost as a compact `$0.42` / `$12.3` / `$1.2k` string. */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}

/** Context-window usage %, or null when the limit is unknown (0). */
export function contextPct(used: number, limit: number): number | null {
  if (!limit || limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

/** Color a context % by pressure: amber > 80, red > 95, else muted. */
export function contextColor(pct: number): string {
  if (pct > 95) return "#f87171"; // red
  if (pct > 80) return "#fbbf24"; // amber
  return "rgba(148,163,184,0.85)"; // muted slate
}

export function decisionIcon(kind: DecisionKind): string {
  switch (kind) {
    case "questionAnswered":
      return "🧠";
    case "prOpened":
      return "🔀";
    case "subagentSpawned":
      return "🤖";
    case "skillInvoked":
      return "✨";
    case "commit":
      return "✓";
    case "fileWrite":
      return "📝";
    case "planApproved":
      return "📋";
    case "awaySummary":
      return "💤";
    default:
      return "›";
  }
}
