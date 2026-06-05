// Render the daily "StandUp Recap" onto a canvas in the pixel-office aesthetic —
// a shareable portrait card. Reuses the office's drawWorker/drawBoss so the hero
// is a real pixel employee. No new deps: the canvas exports straight to PNG.

import type { RecapData } from "./recap-data";
import { formatCost } from "./format";
import { hatTierForLevel } from "./progression";
import { drawBoss, drawWorker } from "../components/office-draw";

export const RECAP_W = 440;
export const RECAP_H = 600;

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

function prettyDate(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDay;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Draw the recap at 2× for crisp export; returns nothing (mutates the canvas). */
export function drawRecapCard(canvas: HTMLCanvasElement, data: RecapData): void {
  const dpr = 2;
  canvas.width = RECAP_W * dpr;
  canvas.height = RECAP_H * dpr;
  // Display size is left to CSS (responsive: scales down to fit small windows
  // while preserving the 440×600 aspect ratio from the canvas's intrinsic dims).
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  // Background + frame.
  const g = ctx.createLinearGradient(0, 0, 0, RECAP_H);
  g.addColorStop(0, "#0c1016");
  g.addColorStop(1, "#161d28");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, RECAP_W, RECAP_H);
  ctx.strokeStyle = "rgba(148,163,184,0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(8.5, 8.5, RECAP_W - 17, RECAP_H - 17);

  const cx = RECAP_W / 2;
  ctx.textAlign = "center";

  // Header: wordmark + date + title.
  ctx.fillStyle = "#34d399";
  ctx.font = "bold 13px ui-monospace, monospace";
  ctx.fillText("● CLAUDE STANDUP", cx, 42);
  ctx.fillStyle = "rgba(148,163,184,0.8)";
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillText(prettyDate(data.date), cx, 62);
  ctx.fillStyle = "#e8edf4";
  ctx.font = "bold 20px ui-monospace, monospace";
  ctx.fillText("Today at the office", cx, 98);

  // Hero: employee of the day (a real pixel worker), else the boss.
  if (data.top) {
    drawWorker(ctx, cx, 224, data.top.session, 0, 1, false, false, undefined, hatTierForLevel(data.top.level));
  } else {
    drawBoss(ctx, cx, 214, 0, false);
  }

  // Persona badge.
  ctx.fillStyle = "#c4b5fd";
  ctx.font = "bold 16px ui-monospace, monospace";
  ctx.fillText(`${data.persona.emoji}  ${data.persona.label}`, cx, 300);
  ctx.fillStyle = "rgba(148,163,184,0.7)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("today's vibe", cx, 316);

  // Stat rows (left-aligned column, centered block).
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const rows: [string, string][] = [
    ["💰", `${formatCost(data.spend)} spent`],
    ["🧠", plural(data.decisions, "key decision")],
    ["🗂", plural(data.sessionCount, "session")],
    ["🔥", `${data.streak}-day streak`],
  ];
  ctx.textAlign = "left";
  let y = 366;
  for (const [icon, label] of rows) {
    ctx.font = "16px ui-monospace, monospace";
    ctx.fillStyle = "#e8edf4";
    ctx.fillText(icon, 78, y);
    ctx.font = "14px ui-monospace, monospace";
    ctx.fillStyle = "rgba(220,228,238,0.92)";
    ctx.fillText(label, 110, y);
    y += 34;
  }

  // Employee of the day caption.
  ctx.textAlign = "center";
  if (data.top) {
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.fillText(`👑 ${truncate(data.top.name, 22)}`, cx, 528);
    ctx.fillStyle = "rgba(148,163,184,0.85)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillText(`Lv ${data.top.level} · ${data.top.title} · employee of the day`, cx, 546);
  }

  // Footer.
  ctx.fillStyle = "rgba(148,163,184,0.55)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText("watch your Claude Code sessions like a tiny office standup", cx, 580);
}
