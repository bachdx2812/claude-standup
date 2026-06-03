# Phase 05 — Mission Control UI (React + GSAP)

**Context:** [plan.md](plan.md) · visual style = Mission Control (chosen) · framework = React (chosen)
**Priority:** P0 · **Status:** planned · **v1:** yes · **Serves goals 1 & 2**

## Overview
The "fun, not dry text" layer. Build the **Mission Control dashboard** in **React + TypeScript + GSAP**: a grid of animated session cards + a global live activity stream + a compact radar of active sessions, with a detail panel showing the decisions timeline. Liveliness via GSAP (pulsing active state, sparkline, smooth enter/exit). Consumes phase-04 events/commands.

## Chosen reference layout
```
┌─ Claude Monitor ──────────────────────────  ●2 active ─┐
│ ┌─ sugar-rush ───────┐ ┌─ ubs ──────────────┐          │
│ │ ● Editing          │ │ ◐ Running npm test │  RADAR   │
│ │ grid-step.ts       │ │ idle 2m            │  · ·●·   │
│ │ ▁▂▅▇▅▂ active      │ │ ▁▁▂▁               │  ·●· ·   │
│ │ 🧠 3 decisions ▸   │ │ 🧠 1 decision ▸    │          │
│ └────────────────────┘ └────────────────────┘          │
│ live stream: 21:43 sugar-rush → Edit grid-step.ts       │
│              21:43 ubs → chose "Tauri" for "Stack"      │
└──────────────────────────────────────────────────────────┘
```

## Key insights
- Cards re-render on `sessions-update` (throttled). Key the list by `session_id`; let React diff. Animate only state transitions (GSAP), not every tick.
- "Fun" = motion + state color, not clutter: state dot (green pulse=active, amber=idle, grey=ended), current-tool line, activity sparkline (recent event density), decision count badge.
- Decisions timeline (detail panel) is the goal-2 payoff — fetch on card click via `get_decisions`.

## Tech choice (React)
- **Vite + React + TypeScript** (`@vitejs/plugin-react`). State store: **Zustand** (tiny, no boilerplate) for the sessions map; components subscribe with selectors to avoid over-render.
- **GSAP** for animation — drive via `useGSAP()` hook (`@gsap/react`) scoped to each card ref; animate transforms/opacity only.
- Radar/sparkline: **SVG** components first; **PixiJS optional** only if radar needs many nodes (you have `pixijs`+`gsap` skills). Don't reach for it unless SVG stutters.
- Style: dark "ops console" theme (CSS modules or plain CSS), monospace accents, restrained color.

## Requirements
**Functional:** session grid (sorted active→idle→ended); per-card {title, project, state dot, current_status, activity sparkline, decision badge}; global activity stream (latest N events); radar dot per session (stable position, brightness=activity); click card → detail panel (status, metadata, **decisions timeline**, subagent list); empty state ("No sessions yet — start Claude Code").
**Non-functional:** 60fps; GSAP enter/exit; no render storms (selector subscriptions + memo); readable at a glance; XSS-safe (React escapes by default — never `dangerouslySetInnerHTML` on transcript-derived text).

## Architecture
```
src/main.tsx                     : React root, mount <App/>
src/App.tsx                      : layout shell + header(active count) + grid/stream/radar + empty state
src/store/sessions-store.ts      : Zustand store; subscribes to sessions-update (rAF-batched)
src/lib/types.ts                 : SessionSnapshot / DecisionEvent (mirror Rust serde)
src/lib/tauri-events.ts          : listen/invoke wrappers (from phase-04)
src/lib/format.ts                : time-ago, truncate, state→color/icon
src/components/SessionCard.tsx    : card + useGSAP state animations + sparkline
src/components/ActivityStream.tsx : rolling global event feed
src/components/Radar.tsx          : SVG (or Pixi) active-session radar
src/components/DecisionTimeline.tsx : detail panel timeline
src/components/Sparkline.tsx      : small SVG activity sparkline
src/styles/*.css                  : ops-console theme
```
> Components in **PascalCase .tsx** (React convention). Non-component TS modules kebab-case.

## Implementation steps
1. Add React deps: `react`, `react-dom`, `@vitejs/plugin-react`, `zustand`, `gsap`, `@gsap/react`. Configure `vite.config.ts`.
2. `types.ts` mirroring Rust `SessionSnapshot`/`DecisionEvent`; `format.ts` helpers.
3. `sessions-store.ts`: Zustand store holding sessions map + recent activity ring; `onSessionsUpdate` → set state (rAF-batched). Selectors for grid + active count.
4. `App.tsx`: shell, header (active count), grid, stream, radar slot, empty state; route/panel for detail.
5. `SessionCard.tsx`: subscribe to one session via selector; `useGSAP` — pulse on active, animate sparkline, flash on new decision, fade enter/exit. Memo to prevent sibling re-render.
6. `ActivityStream.tsx`: subscribe to activity ring → render capped list with fade-in.
7. `Radar.tsx`: SVG dots keyed by session; brightness/size = activity (Pixi only if needed).
8. `DecisionTimeline.tsx`: on card click `fetchDecisions(id)` → vertical timeline with icon per `DecisionKind`; subagents + metadata.
9. Ops-console dark theme; verify 60fps with live sessions.

## Todo
- [ ] React+Vite+Zustand+GSAP deps + config
- [ ] types + format helpers
- [ ] Zustand store wired to `sessions-update` (rAF-batched, selectors)
- [ ] App shell + active-count header + empty state
- [ ] SessionCard with useGSAP animations + sparkline + decision badge
- [ ] ActivityStream feed
- [ ] Radar (SVG; Pixi only if needed)
- [ ] DecisionTimeline detail panel (`get_decisions`)
- [ ] ops-console dark theme, 60fps verified

## Success criteria
Live sessions render as animated React cards reflecting real state/status within ~1–2s; clicking a card shows its decisions timeline (incl. AskUserQuestion choices); active sessions pulse; activity stream scrolls real events; lively, not a dry table; smooth (no jank) with several sessions.

## Risks
- Over-render on frequent updates → Zustand selectors + `React.memo` + animate refs (not state) for motion.
- Over-animation → distraction; "calm mode" toggle (phase-07).
- Scope creep into game-y visuals → stay Mission Control for v1 (aquarium/factory deferred).

## Security
React auto-escapes; never `dangerouslySetInnerHTML` on session-derived strings. Renders only local session metadata.

## Next steps
→ phase-06 adds "Summarize session" (OpenAI) button to DecisionTimeline. → phase-07 settings/persistence.
