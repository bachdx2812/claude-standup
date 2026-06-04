import { useEffect, useRef, useState } from "react";
import { isRecent, projectFolder } from "../lib/format";
import { t } from "../lib/i18n";
import { drawBeam, drawBoss, drawDecor, drawWorker, roundRect } from "./office-draw";
import type { SessionSnapshot } from "../lib/types";

// The office hero: each session is a pixel employee at a desk with a speech
// bubble (live status). The BOSS (= the user) stands at the TOP-CENTER and, when
// you send any agent a new prompt, fires a beam at that desk + shows a big speech
// bubble with your prompt. Desks lay out top-aligned in a responsive grid; the
// canvas is sized to exactly fill the visible area and only grows (→ scroll) when
// even the tightest row spacing can't fit every desk.

const COL_W = 220; // target px per column → drives responsive column count
const MAX_COLS = 5;
const BOSS_BASE_Y = 110; // boss stands here, centered near the top
const DESK_TOP = 208; // first desk row baseline (clears the boss + its comic bubble)
const BOT_PAD = 46;
const MIN_GAP = 98; // tightest row spacing before we allow scrolling
const MAX_GAP = 128;
const BOSS_MSG_MS = 7000;

interface Props {
  sessions: SessionSnapshot[];
  selected: string | null;
  onSelect: (id: string) => void;
}

interface Worker {
  slot: number;
  appearAt: number;
  phase: number;
}

interface Layout {
  cols: number;
  gap: number;
  startY: number;
}

function colsFor(W: number): number {
  return Math.max(2, Math.min(MAX_COLS, Math.floor(W / COL_W) || 2));
}

function deskPos(slot: number, W: number, lay: Layout) {
  const col = slot % lay.cols;
  const row = Math.floor(slot / lay.cols);
  const colW = W / lay.cols;
  return { x: colW * col + colW / 2, y: lay.startY + row * lay.gap };
}

export default function IsoOffice({ sessions, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const workersRef = useRef<Map<string, Worker>>(new Map());
  const usedSlotsRef = useRef<Set<number>>(new Set());
  const selectedRef = useRef(selected);
  const layoutRef = useRef<Layout>({ cols: 2, gap: MAX_GAP, startY: DESK_TOP });
  const byIdRef = useRef<Map<string, SessionSnapshot>>(new Map());
  selectedRef.current = selected;

  // Boss message: newest prompt wins; the draw loop times it out.
  const bossRef = useRef<{ targetId: string; text: string; shownAt: number } | null>(null);
  const prevPromptsRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);

  const [wrapW, setWrapW] = useState(0);
  const [wrapH, setWrapH] = useState(0);

  // Detect new user prompts: when a session's latestPrompt changes, the boss
  // speaks it. Seed silently on first pass so history doesn't replay.
  useEffect(() => {
    const prev = prevPromptsRef.current;
    const seeded = seededRef.current;
    for (const s of sessions) {
      const p = (s.latestPrompt || "").trim();
      const old = prev.get(s.id);
      const isNew = old === undefined ? isRecent(s.lastActivityUnix, 5) : p !== old;
      if (seeded && p !== "" && isNew) {
        bossRef.current = { targetId: s.id, text: p, shownAt: 0 };
      }
      prev.set(s.id, p);
    }
    for (const id of [...prev.keys()]) {
      if (!sessions.some((s) => s.id === id)) prev.delete(id);
    }
    seededRef.current = true;
  }, [sessions]);

  // Reconcile desks (one Worker per session) + the id→snapshot map ONLY when the
  // session set changes — keeps these allocations out of the per-frame draw loop.
  useEffect(() => {
    const byId = new Map<string, SessionSnapshot>();
    for (const s of sessions) byId.set(s.id, s);
    byIdRef.current = byId;

    const workers = workersRef.current;
    const used = usedSlotsRef.current;
    for (const [id, w] of [...workers]) {
      if (!byId.has(id)) {
        used.delete(w.slot);
        workers.delete(id);
      }
    }
    const now = performance.now();
    for (const s of sessions) {
      if (!workers.has(s.id)) {
        let slot = 0;
        while (used.has(slot)) slot++;
        used.add(slot);
        workers.set(s.id, { slot, appearAt: now, phase: Math.random() * 6 });
      }
    }
  }, [sessions]);

  // Track the wrapper size so the canvas can be sized to fit it exactly.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWrapW(entry.contentRect.width);
      setWrapH(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastDraw = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);

      const workers = workersRef.current;
      const byId = byIdRef.current;

      // Expire the boss message (state — runs every tick, cheap).
      let boss = bossRef.current;
      if (boss && boss.shownAt === 0) boss.shownAt = now;
      if (boss && (now - boss.shownAt > BOSS_MSG_MS || !byId.has(boss.targetId))) {
        bossRef.current = null;
        boss = null;
      }

      // Full frame rate only while something actually moves (running typing/glow,
      // a desk popping in, the boss beam, or a sleeping "zzz"); otherwise idle at a
      // few fps — enough for the clock — to spare CPU + battery.
      let animating = boss !== null;
      const nowSecs = Date.now() / 1000;
      for (const [id, w] of workers) {
        const s = byId.get(id);
        if (!s) continue;
        if (
          s.state === "running" ||
          now - w.appearAt < 470 ||
          (s.state === "idle" && nowSecs - (s.lastActivityUnix ?? 0) > 300)
        ) {
          animating = true;
          break;
        }
      }
      if (now - lastDraw < (animating ? 40 : 220)) return;
      const dt = Math.min(0.05, (now - lastDraw) / 1000);
      lastDraw = now;

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      drawDecor(ctx, W);

      const lay = layoutRef.current;
      const summonId = boss?.targetId ?? null;

      // Desks.
      for (const [id, w] of workers) {
        const s = byId.get(id);
        if (!s) continue;
        w.phase += dt * (s.state === "running" ? 7 : 3);
        const { x, y } = deskPos(w.slot, W, lay);
        const appear = Math.min(1, (now - w.appearAt) / 450);
        drawWorker(ctx, x, y, s, w.phase, appear, id === selectedRef.current, id === summonId);
      }

      // Boss: beam (under), then figure, then the big speech bubble (on top).
      const bossX = W / 2;
      if (boss) {
        const tw = workers.get(boss.targetId);
        if (tw) {
          const tp = deskPos(tw.slot, W, lay);
          drawBeam(ctx, bossX, BOSS_BASE_Y - 8, tp.x, tp.y - 26, now);
        }
      }
      drawBoss(ctx, bossX, BOSS_BASE_Y, now, !!boss);
      if (boss) {
        const ts = byId.get(boss.targetId);
        if (ts) drawBossBubble(ctx, ts, boss.text, bossX, W);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const W = canvas.clientWidth;
    const lay = layoutRef.current;
    let best: string | null = null;
    let bestD = 42 * 42;
    for (const [id, w] of workersRef.current) {
      const { x, y } = deskPos(w.slot, W, lay);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best) onSelect(best);
  };

  // Layout: desks top-aligned under the boss. Pick a row spacing that fits every
  // row in the visible height; only when even the tightest spacing overflows does
  // the canvas grow taller than the viewport (→ the wrapper scrolls).
  const cols = colsFor(wrapW || COL_W * 2);
  const rows = Math.max(1, Math.ceil(sessions.length / cols));
  const availH = wrapH || 360;
  const neededMin = DESK_TOP + rows * MIN_GAP + BOT_PAD;
  const fits = neededMin <= availH;
  const usable = Math.max(0, availH - DESK_TOP - BOT_PAD);
  const gap = fits ? Math.max(MIN_GAP, Math.min(MAX_GAP, usable / rows)) : MIN_GAP;
  const canvasH = fits ? availH : neededMin;
  layoutRef.current = { cols, gap, startY: DESK_TOP };

  return (
    <div className="office">
      <div className="office-head">
        {t("office")} · {sessions.length} {sessions.length === 1 ? t("desk") : t("desks")}
      </div>
      <div className="office-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="office-canvas"
          style={{ height: canvasH }}
          onClick={onClick}
        />
      </div>
    </div>
  );
}

// Greedy word-wrap to a pixel width, capped at maxLines (last line ellipsized if
// the text doesn't fully fit). Caller sets ctx.font first.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  let truncated = false;
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width <= maxW || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines) {
        truncated = true;
        cur = "";
        break;
      }
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (truncated && lines.length) {
    let l = lines[lines.length - 1];
    while (l.length > 1 && ctx.measureText(`${l}…`).width > maxW) l = l.slice(0, -1);
    lines[lines.length - 1] = l.replace(/[\s.,;:]+$/, "") + "…";
  }
  return lines;
}

// The boss's big speech bubble: header (→ target folder) + the prompt wrapped
// across several lines. Centered just under the boss, with a tail pointing up.
function drawBossBubble(
  ctx: CanvasRenderingContext2D,
  ts: SessionSnapshot,
  text: string,
  cx: number,
  W: number,
) {
  const pad = 10;
  const lineH = 15;
  const bottom = BOSS_BASE_Y - 36; // bubble sits ABOVE the boss (comic style)
  const headY = BOSS_BASE_Y - 26; // tail points down to the boss's head
  const left = cx + 10; // ...and up to the RIGHT of the speaker
  const maxW = Math.min(W - left - 16, 520);
  const maxLines = Math.max(2, Math.min(5, Math.floor((bottom - 26) / lineH)));

  ctx.font = "11px ui-monospace, monospace";
  const promptLines = wrapText(ctx, text, maxW - pad * 2, Math.max(1, maxLines - 1));
  const header = `→ ${projectFolder(ts)}`;

  let contentW = ctx.measureText(header).width;
  for (const ln of promptLines) contentW = Math.max(contentW, ctx.measureText(ln).width);
  const w = Math.min(maxW, contentW + pad * 2);
  const rows = 1 + promptLines.length;
  const h = rows * lineH + pad * 2 - 2;
  const top = bottom - h;

  ctx.save();
  roundRect(ctx, left, top, w, h, 9);
  ctx.fillStyle = "rgba(13,18,27,0.97)";
  ctx.fill();
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(52,211,153,0.45)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Comic tail: from the bubble's lower-left, down-left to the boss's head.
  ctx.beginPath();
  ctx.moveTo(left + 10, bottom - 3);
  ctx.lineTo(left + 24, bottom - 3);
  ctx.lineTo(cx + 3, headY + 2);
  ctx.closePath();
  ctx.fillStyle = "rgba(13,18,27,0.97)";
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#34d399";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.fillText(header, left + pad, top + pad);
  ctx.fillStyle = "#e8eef7";
  ctx.font = "11px ui-monospace, monospace";
  promptLines.forEach((ln, i) => {
    ctx.fillText(ln, left + pad, top + pad + (i + 1) * lineH);
  });
  ctx.restore();
}
