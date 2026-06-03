// Lively office floor: wandering pets (cat + dog), a fish tank with swimming
// fish, and lounge furniture (rug, pool table, dining table, glass meeting room).
// Animation state lives in a Life object owned by the caller; layout is derived
// from the canvas size each frame so it survives resizes.

import { roundRect } from "./office-draw";

interface Pet {
  kind: "cat" | "dog";
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: number; // facing: +1 right, -1 left
  pause: number; // seconds to idle before next wander
}

interface Fish {
  rx: number; // px offset within the tank (from tank.x) — keeps fish inside it
  ry: number; // fraction 0..1 down the tank
  vx: number;
  phase: number;
  color: string;
}

export interface Life {
  pets: Pet[];
  fish: Fish[];
  v: number; // init version — re-seeds if the shape changes (survives HMR)
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LIFE_V = 2;

export function createLife(): Life {
  return { pets: [], fish: [], v: 0 };
}

// Draw + animate the whole floor. `floorTop` is the y below the desks where the
// open floor begins; nothing is drawn if the floor is too short to hold it.
export function drawOfficeLife(
  ctx: CanvasRenderingContext2D,
  life: Life,
  W: number,
  H: number,
  floorTop: number,
  dt: number,
) {
  const fh = H - floorTop;
  // Reserve a bottom band for the props; once desks grow down into it, skip the
  // whole band so agents always have room (the office scrolls instead).
  if (fh < 200 || W < 380) return;

  // Props hug the bottom band, spread across it: tank (left), pool (center),
  // meeting room (right). Desks grow into the open floor above.
  const tank: Rect = { x: 46, y: H - 184, w: 110, h: 62 };
  const pool: Rect = { x: W * 0.5 - 72, y: H - 158, w: 144, h: 74 };
  const meeting: Rect = { x: W - 224, y: H - 190, w: 200, h: 150 };

  drawMeetingRoom(ctx, meeting);
  drawPoolTable(ctx, pool);
  drawTank(ctx, tank);

  if (life.v !== LIFE_V) initLife(life, W, H, floorTop);

  updateFish(life.fish, tank, dt);
  for (const f of life.fish) drawFish(ctx, f, tank);

  updatePets(life.pets, W, H, floorTop, dt);
  for (const p of life.pets) drawPet(ctx, p);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function initLife(life: Life, W: number, H: number, floorTop: number) {
  const petY = () => rand(floorTop + 40, H - 26);
  life.pets = [
    { kind: "cat", x: W * 0.3, y: petY(), tx: W * 0.5, ty: petY(), dir: 1, pause: 0 },
    { kind: "dog", x: W * 0.6, y: petY(), tx: W * 0.4, ty: petY(), dir: -1, pause: 0 },
  ];
  const colors = ["#f59e0b", "#ef6f6f", "#5ec5e8"];
  life.fish = colors.map((color, i) => ({
    rx: 24 + i * 28,
    ry: 0.38 + i * 0.13,
    vx: i % 2 === 0 ? 26 : -26,
    phase: i * 1.7,
    color,
  }));
  life.v = LIFE_V;
}

// ---- fish -----------------------------------------------------------------

function updateFish(fish: Fish[], tank: Rect, dt: number) {
  for (const f of fish) {
    f.rx += f.vx * dt;
    f.phase += dt * 3;
    if (f.rx < 12) {
      f.rx = 12;
      f.vx = Math.abs(f.vx);
    } else if (f.rx > tank.w - 12) {
      f.rx = tank.w - 12;
      f.vx = -Math.abs(f.vx);
    }
  }
}

function drawFish(ctx: CanvasRenderingContext2D, f: Fish, tank: Rect) {
  const x = tank.x + f.rx;
  const y = tank.y + f.ry * tank.h + Math.sin(f.phase) * 5;
  const dir = f.vx >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(dir, 1);
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // tail
  ctx.moveTo(-5, 0);
  ctx.lineTo(-9, -3);
  ctx.lineTo(-9, 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0b0e14"; // eye
  ctx.fillRect(3, -1, 1, 1);
  ctx.restore();
}

function drawTank(ctx: CanvasRenderingContext2D, t: Rect) {
  ctx.save();
  // stand
  ctx.fillStyle = "#2b3445";
  ctx.fillRect(Math.round(t.x + 8), Math.round(t.y + t.h), 10, 16);
  ctx.fillRect(Math.round(t.x + t.w - 18), Math.round(t.y + t.h), 10, 16);
  // water
  roundRect(ctx, t.x, t.y, t.w, t.h, 6);
  ctx.fillStyle = "rgba(56,160,210,0.22)";
  ctx.fill();
  // gravel
  ctx.fillStyle = "#3b4a3a";
  ctx.fillRect(Math.round(t.x + 2), Math.round(t.y + t.h - 6), t.w - 4, 5);
  // seaweed
  ctx.strokeStyle = "#3ca36a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(t.x + 16, t.y + t.h - 4);
  ctx.quadraticCurveTo(t.x + 10, t.y + t.h - 22, t.x + 18, t.y + t.h - 36);
  ctx.stroke();
  // glass frame
  roundRect(ctx, t.x, t.y, t.w, t.h, 6);
  ctx.strokeStyle = "#5b7fa6";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// ---- pets -----------------------------------------------------------------

function updatePets(pets: Pet[], W: number, H: number, floorTop: number, dt: number) {
  const minX = 36;
  const maxX = W - 36;
  const minY = floorTop + 30;
  const maxY = H - 24;
  for (const p of pets) {
    if (p.pause > 0) {
      p.pause -= dt;
      continue;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      p.pause = rand(0.8, 3);
      p.tx = rand(minX, maxX);
      p.ty = rand(minY, maxY);
      continue;
    }
    const speed = p.kind === "dog" ? 34 : 26;
    p.x += (dx / dist) * speed * dt;
    p.y += (dy / dist) * speed * dt;
    if (Math.abs(dx) > 1) p.dir = dx >= 0 ? 1 : -1;
    p.x = Math.max(minX, Math.min(maxX, p.x));
    p.y = Math.max(minY, Math.min(maxY, p.y));
  }
}

function drawPet(ctx: CanvasRenderingContext2D, p: Pet) {
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  ctx.scale(p.dir, 1);
  // soft shadow
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(0, 1, 9, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (p.kind === "cat") drawCat(ctx);
  else drawDog(ctx);
  ctx.restore();
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function drawCat(ctx: CanvasRenderingContext2D) {
  const body = "#9aa3af";
  const dark = "#6b7280";
  px(ctx, -6, -7, 12, 5, body); // body
  px(ctx, -5, -2, 2, 2, dark); // legs
  px(ctx, 3, -2, 2, 2, dark);
  px(ctx, 5, -11, 2, 5, body); // tail up
  px(ctx, -10, -10, 5, 5, body); // head
  px(ctx, -10, -12, 2, 2, body); // ears
  px(ctx, -7, -12, 2, 2, body);
  px(ctx, -9, -9, 1, 1, "#111"); // eye
}

function drawDog(ctx: CanvasRenderingContext2D) {
  const body = "#a9734b";
  const dark = "#7c5535";
  px(ctx, -8, -8, 15, 6, body); // body
  px(ctx, -6, -2, 2, 2, dark); // legs
  px(ctx, 4, -2, 2, 2, dark);
  px(ctx, 6, -12, 2, 5, body); // tail
  px(ctx, -13, -11, 6, 6, body); // head
  px(ctx, -13, -12, 2, 4, dark); // floppy ear
  px(ctx, -14, -8, 2, 2, body); // snout
  px(ctx, -11, -10, 1, 1, "#111"); // eye
}

// ---- furniture ------------------------------------------------------------

function drawPoolTable(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.save();
  // rail
  roundRect(ctx, r.x - 6, r.y - 6, r.w + 12, r.h + 12, 8);
  ctx.fillStyle = "#5b3a25";
  ctx.fill();
  // felt
  roundRect(ctx, r.x, r.y, r.w, r.h, 4);
  ctx.fillStyle = "#1f7a4d";
  ctx.fill();
  // pockets
  ctx.fillStyle = "#0b0e14";
  const pk = [
    [r.x, r.y],
    [r.x + r.w / 2, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w / 2, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ];
  for (const [bx, by] of pk) {
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // balls
  const balls = ["#eab308", "#ef4444", "#3b82f6", "#f8fafc"];
  balls.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(r.x + r.w * 0.4 + i * 9, r.y + r.h * 0.5 + (i % 2) * 8, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  // cue
  ctx.strokeStyle = "#caa15a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(r.x + r.w * 0.15, r.y + r.h + 8);
  ctx.lineTo(r.x + r.w * 0.7, r.y + r.h * 0.4);
  ctx.stroke();
  ctx.restore();
}

function drawMeetingRoom(ctx: CanvasRenderingContext2D, r: Rect) {
  ctx.save();
  // glass walls
  roundRect(ctx, r.x, r.y, r.w, r.h, 10);
  ctx.fillStyle = "rgba(120,170,210,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(140,180,220,0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // door gap on the left wall
  ctx.strokeStyle = "rgba(11,14,20,1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + r.h * 0.55);
  ctx.lineTo(r.x, r.y + r.h * 0.8);
  ctx.stroke();
  // long table
  const tx = r.x + r.w * 0.2;
  const ty = r.y + r.h * 0.42;
  ctx.fillStyle = "#46566e";
  roundRect(ctx, tx, ty, r.w * 0.6, r.h * 0.3, 5);
  ctx.fill();
  // chairs
  ctx.fillStyle = "#37414f";
  for (let i = 0; i < 4; i++) {
    const cx = tx + 6 + i * (r.w * 0.6 - 12) / 3;
    ctx.fillRect(Math.round(cx - 3), Math.round(ty - 8), 6, 6);
    ctx.fillRect(Math.round(cx - 3), Math.round(ty + r.h * 0.3 + 2), 6, 6);
  }
  // label
  ctx.fillStyle = "rgba(148,163,184,0.9)";
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("MEETING ROOM", r.x + 8, r.y + 6);
  ctx.restore();
}
