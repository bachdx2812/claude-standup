# UI/UX — Office-Hero Layout Redesign

**Date:** 2026-06-04
**Scope:** Frontend space-allocation reorg (no visual overhaul). Office canvas promoted to hero; session cards collapsed into a compact right rail.
**tsc:** `npx tsc --noEmit` → **0 errors** (verified before + after).

## Problem
Old layout: `.left` (flex:2) held an auto-fill card grid → with ~4 sessions, one row of cards + huge empty black void below. The fun office visual was crammed into a narrow right sidebar. Wasted ~half the window.

## Decision
Office (pixel employees at desks) already represents each session, so make IT the hero filling the main area. Session cards shrink into a compact, scrollable right rail. Selection stays in sync (desk click ↔ card click, both lift to `App` `selected`/`setSelected` — unchanged).

## What changed

### `src/App.tsx`
- `.left` card-grid → `.office-stage` (main hero) rendering `<IsoOffice>` full-bleed. Empty-state message moved here.
- `.right` rail now holds a **compact session list** (`.rail-list` → `.rail-head` + `.rail-cards` mapping `<SessionCard compact />`) on top, `<DecisionTimeline>` below.
- No store / event / window-label changes.

### `src/components/IsoOffice.tsx` (responsive + fill)
- Removed hardcoded `const COLS = 2`. Added `colsFor(W) = clamp(2, floor(W/220), 5)` (`COL_W=220`, `MAX_COLS=5`), recomputed **per frame** from `canvas.clientWidth` and reused in the click hit-test.
- `deskPos(slot, W, cols)` now takes COLS.
- Canvas fills the panel and scrolls only on overflow: wrapper is `flex:1; min-height:0; overflow-y:auto`; canvas inline `min-height: max(100%, ${contentH}px)`. `max()` is the key — few desks → fills the tall area (no void); many desks → grows past 100% and the wrapper scrolls. Nothing is ever clipped.
- Added a `ResizeObserver` (→ `wrapW` state) purely to compute `contentH` (rows × ROW_GAP) at the current width for that min-height. Draw loop untouched otherwise.
- `ROW_GAP 90→96`, `TOP 60→64` for a touch more breathing room in the larger area. Pluralized the header ("1 desk" / "N desks").
- **Employees / desks / bubbles / state colors / animations: untouched** per the brief.

### `src/components/SessionCard.tsx`
- Added optional `compact?: boolean` prop → adds `.compact` class. Compact drops the path footer (`.card-sub`) and trims meta to time + 🧠 + 🤖 (branch/path live on the desk label already). Full card unchanged when `compact` omitted.

### `src/styles.css`
- `.app-body` flex split: `.office-stage` `flex:3` (hero) | `.right` `flex:none; width:320px; min:300 max:360` (fixed rail).
- `.office` now `flex:1` column; `.office-canvas-wrap` dropped the `max-height:380px` cap → `flex:1; min-height:0; overflow-y:auto` (+ subtle border). `.office-canvas` gets `min-height:100%` fallback.
- New `.rail-list` (`max-height:55%`, bottom border), `.rail-head`, `.rail-cards` (scroll), `.rail-empty`.
- New `.card.compact` denser variant (tighter padding/gap, smaller title/status, muted status color).
- `.detail` already `flex:1` → naturally takes the rail remainder below the list.

## Layout rationale
- **Hero gets the area, metadata gets the rail.** Standard ops-console hierarchy: the live visual (what's happening) dominates; the list is a navigable index + the detail is on-demand depth.
- **Fixed-width rail (320px), flex hero.** Rail content is text at a known comfortable width; the hero should absorb all extra width. Verified: at a 1100px window the stage measured **780px** and the rail **320px** (780+320=1100); at 800px → 480/320. Rail never bloats.
- **Responsive desk columns** keep desks from getting lost behind huge horizontal gaps as the hero widens (2 cols narrow → up to 5 cols wide), centered per-column.
- **Compact cards** because the desk already carries rich identity (project, +subagents, state glyphs, live bubble) — the rail just needs a clickable index + quick state scan.

## Verification
- `tsc --noEmit`: 0 errors.
- Headless-Chrome screenshot of a DOM/CSS harness (real `styles.css`, mock sessions) at 800px and 1100px viewports. Confirmed: office fills full width+height of main (no void), `max(100%,…)` fills with few desks, rail = 320px with compact cards (green-glow selected / amber needs-input / grey idle), list-over-detail split clean, theme custom properties intact.
- Office canvas itself is JS/Tauri-driven so it renders empty in a plain browser — only the layout shell was screenshot-verified. The canvas internals (responsive COLS, drawWorker) are type-checked and logic-reviewed; recommend a quick eyeball in the running Tauri app.

## Files touched
- `src/App.tsx`
- `src/components/IsoOffice.tsx`
- `src/components/SessionCard.tsx`
- `src/styles.css`

## Follow-ups / unresolved
- **Live-app eyeball:** confirm responsive COLS + fill-height look right with real sessions in the Tauri window (couldn't run the canvas headless — Tauri `invoke` absent in browser).
- **`.rail-list` 55% cap:** with a short list the boundary can look like the last card is clipped (it's actually the scroll edge). If undesirable, switch to `flex: 0 1 auto` sized-to-content with a px cap, or make the rail a single scroll region (list + detail together). Left as-is — KISS; scrolls correctly.
- **Very wide windows (5 desks/row):** if users routinely run >1300px, consider raising `MAX_COLS` to 6 — trivial constant bump.
