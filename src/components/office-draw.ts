// Pure canvas drawing helpers for the office hero (no React state here).
// Each function takes explicit coordinates so layout math stays in IsoOffice.

import {
  contextColor,
  contextPct,
  formatCost,
  projectFolder,
  stateColor,
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
  quip?: string,
  hatTier = 0,
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

  // --- Speech bubble: a fresh quip (from poking) takes over, else the status. ---
  const status = s.currentStatus?.trim();
  const bubbleText = quip ?? (status && status !== "—" ? status : "Processing");
  drawBubble(ctx, x, y - 64, bubbleText, quip ? "#fbbf24" : col);

  // --- Workstation over the employee's shoulder. Everything sits ON the desk:
  //     monitor + lamp stand on it, keyboard lies on it; employee in front. ---

  // Dual monitors with LIT screens (bright = clearly monitors), over the
  // shoulder. Running adds a coloured glow around the bezels.
  if (s.state === "running") {
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
  }
  px(-25, -38, 19, 15, "#0a0d12"); // left bezel
  px(1, -38, 19, 15, "#0a0d12"); // right bezel
  ctx.shadowBlur = 0;
  px(-23, -36, 15, 11, "#26406a"); // left lit screen
  px(3, -36, 15, 11, "#26406a"); // right lit screen
  px(-22, -33, 12, 1, col); // screen content lines
  px(-22, -30, 8, 1, "#6c91c4");
  px(4, -33, 12, 1, col);
  px(4, -30, 8, 1, "#6c91c4");
  px(-16, -23, 2, 2, "#2a313c"); // left stand
  px(10, -23, 2, 2, "#2a313c"); // right stand

  // Lamp at the desk's right edge = STATUS LIGHT: green = running, amber =
  // waiting, grey = idle (glow pool added later in drawLampGlow).
  px(23, -24, 4, 2, "#39414f"); // base
  px(24, -31, 1, 7, "#566073"); // pole
  px(22, -34, 6, 3, col); // shade in the state colour
  ctx.save();
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  px(23, -31, 4, 1, col); // bulb
  ctx.restore();

  // Big desk, high contrast: light top + dark front face.
  ctx.fillStyle = "#525c6e";
  roundRect(ctx, x - 29, y - 23, 58, 6, 2); // top surface
  ctx.fill();
  ctx.fillStyle = "#2a313c";
  ctx.fillRect(Math.round(x - 29), Math.round(y - 17), 58, 6); // front face

  // Keyboard on the desk.
  px(-11, -21, 22, 3, "#1a1f28");
  for (let kx = -10; kx < 11; kx += 3) px(kx, -20, 2, 1, "#4a5468"); // keys

  // Employee NEAREST us: clear back of head + shoulders (coloured shirt pops).
  px(-13, 1, 26, 7, col); // shoulders / upper back
  px(-7, -11, 14, 13, hair); // back of head (big)
  px(-6, -12, 12, 1, hair); // rounded crown
  px(-8, -6, 1, 3, skin); // left ear
  px(7, -6, 1, 3, skin); // right ear
  px(-4, 1, 8, 2, skin); // nape of the neck

  // Cosmetic hat, unlocked as the project levels up (pure flavour).
  if (hatTier > 0) drawHat(ctx, x, y, hatTier);

  // "Waiting for you" cue: a bobbing, pulsing amber "!" badge floating up to the
  // right, well clear of the person + the workstation, only while waiting on you.
  if (s.state === "needsInput") {
    const bx = x;
    const by = y - 73 + Math.sin(phase * 0.8) * 2;
    ctx.save();
    ctx.globalAlpha = appear * (0.6 + 0.4 * Math.abs(Math.sin(phase * 0.6)));
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#211808";
    ctx.fill();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", bx, by + 0.5);
    ctx.restore();
  }

  // Sweat when the context window is nearly full (stress).
  const ctxPct = contextPct(s.contextUsedTokens, s.contextLimit);
  if (ctxPct !== null && ctxPct >= 90) drawSweat(ctx, x, y, phase);

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
        ctx.fillText("z", x + 8 + t * 5, y - 13 - t * 16);
      }
      ctx.globalAlpha = appear;
    } else {
      ctx.fillStyle = "rgba(203,213,225,0.5)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText("z", x + 9, y - 15);
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
    roundRect(ctx, x - 29, y - 39, 58, 47, 9);
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
  ctx.fillStyle = summoned ? ACCENT : "rgba(214,224,238,0.96)";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const name = ellipsize(projectFolder(s), 18);
  ctx.fillText(name, x, y + 13);

  // Cost on a tiny muted line, then a game-style "HP bar" for the context window.
  const pct = contextPct(s.contextUsedTokens, s.contextLimit);
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(162,176,196,0.95)";
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
  ctx.fillStyle = "rgba(132,145,166,0.95)";
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

// --- Fun: day-night ambient light + disco easter egg ------------------------

// Time-of-day wash over the whole office, driven by the local machine clock:
// clear in daytime, warm at dawn/dusk, cool blue at night. Drawn last, over the
// scene, so the room visibly shifts as the hours pass while you work.
// True from 7pm to 6am (local machine clock) — drives the desk lamps + the night
// dim, so the office visibly settles into evening while you work.
export function isNightHour(hour = new Date().getHours()): boolean {
  return hour >= 19 || hour < 6; // 7pm to 6am
}

// A gentle night dim over the room, drawn UNDER the desks so the warm desk-lamp
// pools glow on top. Clear during the day.
export function drawAmbientLight(ctx: CanvasRenderingContext2D, w: number, h: number) {
  if (!isNightHour()) return;
  ctx.fillStyle = "rgba(16,24,52,0.22)";
  ctx.fillRect(0, 0, w, h);
}

// Warm glow pool from a lit desk lamp, drawn additively AFTER the night dim so
// the lamp light punches through the darkened room. Coords match the fixture.
export function drawLampGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const glow = ctx.createRadialGradient(x + 24, y - 22, 1, x + 24, y - 22, 17);
  glow.addColorStop(0, color + "99"); // state colour (≈60% alpha) at the bulb
  glow.addColorStop(1, color + "00"); // fading to transparent
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(x + 24, y - 21, 17, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Konami-code disco: a hue-cycling wash + drifting music notes. Pure fun.
export function drawDisco(ctx: CanvasRenderingContext2D, w: number, h: number, now: number) {
  const hue = (now / 12) % 360;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = `hsla(${hue}, 90%, 55%, 0.22)`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  ctx.font = "16px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 6; i++) {
    const rise = ((now / 1000) * 0.4 + i / 6) % 1;
    const x = (w * (i + 0.5)) / 6 + Math.sin(now / 300 + i) * 20;
    const y = h - rise * (h - 20) - 10;
    ctx.globalAlpha = 0.85 * (1 - rise);
    ctx.fillStyle = `hsl(${(hue + i * 60) % 360}, 90%, 65%)`;
    ctx.fillText(i % 2 ? "♪" : "♫", x, y);
  }
  ctx.restore();
}

const CONFETTI = ["#34d399", "#fbbf24", "#60a5fa", "#f87171", "#c4b5fd", "#f0abfc"];

// A celebratory confetti burst above a desk (t = 0..1 over the burst's life).
export function drawConfetti(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.save();
  const n = 16;
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / n - 0.5) * Math.PI * 1.4; // mostly-upward fan
    const speed = 34 + (i % 5) * 9;
    const px = x + Math.cos(ang) * speed * t;
    const py = y + Math.sin(ang) * speed * t + 70 * t * t; // gravity
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    ctx.fillRect(Math.round(px), Math.round(py), 3, 3);
  }
  ctx.restore();
}

// A cosmetic hat on the worker's head, unlocked by the project's seniority:
// 1 Mid = cap · 2 Senior = headphones · 3 Staff = grad cap · 4 Principal = crown.
function drawHat(ctx: CanvasRenderingContext2D, x: number, y: number, tier: number) {
  const px = (dx: number, dy: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + dx), Math.round(y + dy), w, h);
  };
  if (tier === 1) {
    // Cap: dome + short brim.
    px(-6, -15, 12, 3, "#3b82f6");
    px(-9, -13, 4, 1, "#2563eb");
  } else if (tier === 2) {
    // Headphones: band + two earcups.
    px(-7, -16, 14, 2, "#64748b");
    px(-8, -14, 2, 5, "#22d3ee");
    px(6, -14, 2, 5, "#22d3ee");
  } else if (tier === 3) {
    // Graduation cap: mortarboard + tassel.
    px(-8, -14, 16, 2, "#1f2937");
    px(-2, -16, 4, 2, "#1f2937");
    px(6, -14, 1, 5, "#fbbf24");
    px(5, -9, 2, 2, "#fbbf24");
  } else {
    // Crown: gold band + points + a little shine.
    px(-6, -15, 12, 3, "#f59e0b");
    px(-6, -18, 2, 3, "#fbbf24");
    px(-1, -19, 2, 4, "#fbbf24");
    px(4, -18, 2, 3, "#fbbf24");
    px(-5, -15, 9, 1, "#fde68a");
  }
}

// Sweat drops by the head when the context window is nearly full (stress!).
function drawSweat(ctx: CanvasRenderingContext2D, x: number, y: number, phase: number) {
  ctx.save();
  for (let i = 0; i < 2; i++) {
    const drip = (((phase * 0.4 + i * 0.5) % 1) + 1) % 1;
    const dx = i === 0 ? -10 : 11;
    ctx.globalAlpha = 0.85 * (1 - drip * 0.5);
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath();
    ctx.ellipse(x + dx, y - 8 + drip * 10, 1.6, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
