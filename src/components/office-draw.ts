// Pure canvas drawing helpers for the office hero (no React state here).
// Each function takes explicit coordinates so layout math stays in IsoOffice.

import {
  contextColor,
  contextPct,
  formatCost,
  projectFolder,
  stateColor,
  stateLabel,
} from "../lib/format";
import { t } from "../lib/i18n";
import type { SessionSnapshot } from "../lib/types";

const ACCENT = "#34d399";

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Char cap with an ellipsis — for short identity labels (no spaces).
export function ellipsize(t: string, max: number): string {
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// Fit a sentence to a pixel width, breaking on a word boundary when sensible
// so we never cut mid-word ("Explain how…" not "Explain how th…").
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  const sp = t.lastIndexOf(" ");
  if (sp >= 5) t = t.slice(0, sp); // prefer a whole-word cut when there's room
  return t.replace(/[\s.,;:]+$/, "") + "…";
}

export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  topY: number,
  text: string,
  col: string,
  maxW = 124,
) {
  ctx.font = "9px ui-monospace, monospace";
  const t = fitText(ctx, text || "—", maxW);
  const tw = ctx.measureText(t).width;
  const w = tw + 12;
  const h = 16;
  const bx = x - w / 2;

  roundRect(ctx, bx, topY, w, h, 5);
  ctx.fillStyle = "rgba(16,22,32,0.96)";
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(x - 4, topY + h);
  ctx.lineTo(x + 4, topY + h);
  ctx.lineTo(x, topY + h + 5);
  ctx.closePath();
  ctx.fillStyle = "rgba(16,22,32,0.96)";
  ctx.fill();

  ctx.fillStyle = "#dbe4ef";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t, x, topY + h / 2);
}

// One employee = one session. `phase` drives idle animation; `summoned` flags the
// agent the boss is currently addressing (floor ring + brighter name).
export function drawWorker(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  s: SessionSnapshot,
  phase: number,
  appear: number,
  selected: boolean,
  summoned: boolean,
) {
  const col = stateColor(s.state);
  const y = baseY - (1 - appear) * 14;
  const skin = "#e8b98c";
  const hair = "#2a1f17";
  const px = (dx: number, dy: number, ww: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + dx), Math.round(y + dy), ww, hh);
  };

  ctx.save();
  ctx.globalAlpha = appear;

  // Floor ring when the boss is pointing at this desk.
  if (summoned) {
    ctx.save();
    ctx.globalAlpha = appear * (0.3 + 0.35 * Math.abs(Math.sin(phase * 0.5)));
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 30, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // --- Speech bubble (what they're doing) ---
  drawBubble(ctx, x, y - 52, s.currentStatus?.trim() || stateLabel(s.state), col);

  // --- Employee (behind desk) ---
  if (s.state === "needsInput" || summoned) {
    px(5, -34, 2, 9, summoned ? ACCENT : col); // raised arm (also when summoned)
    px(5, -35, 3, 2, skin);
  }
  px(-5, -31, 10, 3, hair);
  px(-4, -29, 8, 8, skin); // head
  px(-5, -29, 1, 4, hair);
  px(4, -29, 1, 4, hair);
  if (s.state === "idle") {
    px(-2, -25, 2, 1, "#111");
    px(1, -25, 2, 1, "#111");
  } else {
    px(-2, -25, 1, 1, "#111");
    px(2, -25, 1, 1, "#111");
  }
  px(-6, -21, 12, 11, col); // shirt
  px(-8, -20, 2, 8, col);
  px(6, -20, 2, 8, col);

  // --- Desk + monitor ---
  ctx.fillStyle = "#39414f";
  roundRect(ctx, x - 22, y - 6, 44, 9, 2);
  ctx.fill();
  ctx.fillStyle = "#2a313c";
  ctx.fillRect(Math.round(x - 22), Math.round(y + 1), 44, 2); // front edge

  if (s.state === "running") {
    ctx.shadowColor = col;
    ctx.shadowBlur = 8;
  }
  px(-7, -9, 14, 8, "#10151d"); // monitor
  ctx.shadowBlur = 0;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x - 7), Math.round(y - 9), 14, 8);

  if (s.state === "running") {
    const ty = Math.sin(phase) * 1.5;
    px(-10, -3 + ty, 2, 2, skin);
    px(8, -3 - ty, 2, 2, skin);
  }
  if (s.state === "idle") {
    const afk = Date.now() / 1000 - (s.lastActivityUnix ?? 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    if (afk > 300) {
      // Asleep (AFK > 5 min): a rising, fading "z Z Z" loop.
      for (let i = 0; i < 3; i++) {
        const t = (((phase * 0.35 + i / 3) % 1) + 1) % 1;
        ctx.globalAlpha = appear * 0.8 * (1 - t);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = `${8 + i * 2}px ui-monospace, monospace`;
        ctx.fillText("z", x + 8 + t * 5, y - 28 - t * 16);
      }
      ctx.globalAlpha = appear;
    } else {
      ctx.fillStyle = "rgba(203,213,225,0.5)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText("z", x + 9, y - 30);
    }
  }

  // Selected = ACTIVE: floor spotlight + glow ring + tag, clearly lifted.
  if (selected) {
    ctx.save();
    const grad = ctx.createRadialGradient(x, y + 3, 2, x, y + 3, 42);
    grad.addColorStop(0, "rgba(147,197,253,0.32)");
    grad.addColorStop(1, "rgba(147,197,253,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, y + 5, 44, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#60a5fa";
    ctx.shadowBlur = 12;
    roundRect(ctx, x - 27, y - 33, 54, 39, 9);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // "CHECKING" pill above the status bubble (this is the session you're inspecting)
    ctx.font = "bold 8px ui-monospace, monospace";
    const tag = `● ${t("checking")}`;
    const pillH = 14;
    const pillY = y - 82;
    const pw = ctx.measureText(tag).width + 14;
    roundRect(ctx, x - pw / 2, pillY, pw, pillH, 7);
    ctx.fillStyle = "#13243a";
    ctx.fill();
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#bfdbfe";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, x, pillY + pillH / 2 + 0.5);
    ctx.restore();
  }

  // Name.
  ctx.fillStyle = summoned ? ACCENT : "rgba(210,220,235,0.9)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const name =
    ellipsize(projectFolder(s), 18) + (s.subagentCount > 0 ? ` +${s.subagentCount}` : "");
  ctx.fillText(name, x, y + 13);

  // Cost on a tiny muted line, then a game-style "HP bar" for the context window.
  const pct = contextPct(s.contextUsedTokens, s.contextLimit);
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(148,163,184,0.85)";
  ctx.fillText(formatCost(s.costUsd ?? 0), x, y + 25);

  if (s.contextLimit > 0 && pct !== null) {
    const barW = 50;
    const barH = 6;
    const bx = x - barW / 2;
    const by = y + 36;
    const c = contextColor(pct);
    // track
    roundRect(ctx, bx, by, barW, barH, 3);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    // fill (HP)
    const fw = Math.max(2, Math.round((barW * pct) / 100));
    roundRect(ctx, bx, by, fw, barH, 3);
    ctx.fillStyle = c;
    ctx.fill();
    // outline
    roundRect(ctx, bx, by, barW, barH, 3);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // tiny % to the right
    ctx.fillStyle = c;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${pct}%`, bx + barW + 4, by + barH / 2 + 0.5);
  }

  ctx.restore();
}

// The boss (= the user) stands at the head of the room. `speaking` raises a
// pointing arm; the bubble + beam are drawn by the caller (needs the target pos).
export function drawBoss(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  now: number,
  speaking: boolean,
) {
  const bob = Math.sin(now / 450) * 1.2;
  const y = baseY + bob;
  const suit = "#3b4a6b";
  const skin = "#e8b98c";
  const hair = "#20170f";
  const px = (dx: number, dy: number, ww: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + dx), Math.round(y + dy), ww, hh);
  };

  ctx.save();
  // legs
  px(-4, -8, 3, 8, "#222a3a");
  px(1, -8, 3, 8, "#222a3a");
  // suit body
  px(-6, -22, 12, 15, suit);
  // collar + tie
  px(-3, -22, 2, 3, "#e7edf6");
  px(1, -22, 2, 3, "#e7edf6");
  px(-1, -22, 2, 10, ACCENT);
  // arms
  px(-8, -21, 2, 10, suit);
  if (speaking) {
    // pointing arm extended down-forward toward the desks
    px(6, -20, 3, 2, suit);
    px(8, -18, 2, 4, suit);
    px(9, -14, 2, 2, skin);
  } else {
    px(6, -21, 2, 10, suit);
  }
  // head
  px(-4, -32, 8, 9, skin);
  px(-5, -33, 10, 3, hair);
  px(-5, -32, 1, 4, hair);
  px(4, -32, 1, 4, hair);
  // glasses
  px(-3, -28, 2, 2, "#0c1016");
  px(1, -28, 2, 2, "#0c1016");
  px(-1, -27, 2, 1, "#0c1016");

  // label
  ctx.fillStyle = ACCENT;
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(t("boss"), x, y + 3);
  ctx.fillStyle = "rgba(100,116,139,0.9)";
  ctx.font = "8px ui-monospace, monospace";
  ctx.fillText(t("you"), x, y + 13);
  ctx.restore();
}

// Glowing dashed beam from the boss to the target desk, with an arrowhead.
export function drawBeam(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  now: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(52,211,153,0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 8;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -((now / 40) % 12);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  // arrowhead
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 8 * Math.cos(a - 0.4), y2 - 8 * Math.sin(a - 0.4));
  ctx.lineTo(x2 - 8 * Math.cos(a + 0.4), y2 - 8 * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Static office props for a richer room — door + clock top-right, potted plants
// in the lower corners, a water cooler on the left. Drawn behind the desks.
// A wall clock is the only standing decor for now (bigger, easy to read).
export function drawDecor(ctx: CanvasRenderingContext2D, W: number) {
  drawClock(ctx, W - 56, 52, 18);
}

// Wall clock showing the current machine time (hour + minute hands + ticks, live).
function drawClock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const d = new Date();
  const min = d.getMinutes();
  const hr = d.getHours() % 12;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#1b2433";
  ctx.fill();
  ctx.strokeStyle = "#3a4760";
  ctx.lineWidth = 2;
  ctx.stroke();
  // hour ticks
  ctx.strokeStyle = "#46566e";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r1 = r - 2;
    const r2 = r - (i % 3 === 0 ? 5 : 3.5);
    ctx.beginPath();
    ctx.moveTo(x + r1 * Math.sin(a), y - r1 * Math.cos(a));
    ctx.lineTo(x + r2 * Math.sin(a), y - r2 * Math.cos(a));
    ctx.stroke();
  }
  const hand = (len: number, ang: number, w: number, c: string) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len * Math.sin(ang), y - len * Math.cos(ang));
    ctx.stroke();
  };
  hand(r * 0.5, ((hr + min / 60) / 12) * Math.PI * 2, 2.6, "#e2e8f0"); // hour
  hand(r * 0.78, (min / 60) * Math.PI * 2, 1.6, "#94a3b8"); // minute
  ctx.fillStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
