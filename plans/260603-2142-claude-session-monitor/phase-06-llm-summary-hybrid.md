# Phase 06 — Hybrid LLM session summary (OpenAI)

**Context:** [plan.md](plan.md)
**Priority:** P0 (v1) · **Status:** planned · **v1:** yes · **Serves goal 2 (don't-forget, richer)**
**Provider:** OpenAI · **Key:** supplied by user later (feature degrades gracefully until then)

## Overview
The "hybrid" half of the decisions feature: heuristic timeline is always-on (phase-03); this adds an **on-demand "Summarize session"** action that sends the session's decision timeline + key transcript excerpts to the **OpenAI API** and returns a short narrative recap ("what this session set out to do, what it decided, where it is"). Opt-in, per-session, never automatic. No key yet → button disabled with a clear "set OpenAI key" hint.

## Key insights
- **OpenAI Chat Completions:** `POST https://api.openai.com/v1/chat/completions`, header `Authorization: Bearer <OPENAI_API_KEY>`, body `{model, messages:[{role,content}], max_completion_tokens}`. Response text = `choices[0].message.content`. Streaming via SSE (`data:` chunks, `choices[0].delta.content`, terminated by `data: [DONE]`).
- **Model:** make it a **config string** (default a small/cheap model, e.g. `gpt-4o-mini`); **confirm the exact current model id when the key is supplied** (catalog drifts) — don't hardcode-assume availability. Cheap model = default for fast summaries; allow override.
- **Key storage (dev):** read from `OPENAI_API_KEY` env OR a `0600` config file in `app_data_dir`. **Keychain (`keyring`) deferred** to when the app is signed (phase-07) — unsigned-build Keychain is unreliable.
- Streaming optional via SSE → push tokens to UI with `tauri::ipc::Channel`. v1 can start **non-streaming** (single response) for simplicity; add streaming as enhancement.
- **Privacy:** only feature with off-device egress → explicit, disclosed, minimal-send (heuristic decision summaries + small excerpts, NOT the raw 100MB transcript).

## Requirements
**Functional:** "Summarize session" button in DecisionTimeline → Rust `summarize_session(session_id)` → builds compact prompt (title + decisions timeline + last away_summary + recent prompts, capped ~6–8k tokens) → calls OpenAI → returns narrative; display + cache per session (invalidate when new decisions appear). Settings: OpenAI key entry + model picker + enable/disable. Without a key: button disabled + hint.
**Non-functional:** never block UI (async command); hard cap input size; graceful errors (no key / 401 / 429 / offline) surfaced in UI; cost-aware (default cheap model, on-demand only).

## Architecture
```
llm/openai.rs   : Client{ key, model } → summarize(prompt) -> Result<String>  (reqwest, Bearer)
llm/key_store.rs: get/set key — dev: env OR config file (0600); Keychain hook for phase-07
llm/prompt.rs   : build_summary_prompt(snapshot, decisions, excerpts) -> messages  (size-capped)
bridge/commands.rs (+) : summarize_session, set_openai_key, get_llm_settings, set_llm_settings
src/components/DecisionTimeline.tsx (+) : Summarize button + render + loading/error states
src/components/Settings.tsx (+)         : key + model + enable toggle (shared w/ phase-07)
```

## Privacy guardrails (mandatory)
- Feature **off by default**; first use shows one-time disclosure: "This sends selected session content to OpenAI's API."
- Send heuristic-derived summaries + minimal excerpts, **not** raw transcripts. Show a token/size estimate before sending.
- Never send other sessions' data. Never auto-summarize.

## Related code files
**Create:** `src-tauri/src/llm/{mod,openai,key_store,prompt}.rs`, `src-tauri/src/settings.rs` (if not yet)
**Modify:** `src-tauri/src/bridge/commands.rs` (LLM commands), `src/components/DecisionTimeline.tsx` (button+render), `src/components/Settings.tsx` (key/model UI)

## Implementation steps
1. `key_store.rs`: resolve key — `std::env::var("OPENAI_API_KEY")` → else config file in `app_data_dir` (perms `0600`). `set_openai_key` writes config. Leave a `keychain` feature-gate stub for phase-07.
2. `prompt.rs`: assemble size-capped `messages` from `SessionSnapshot` + `Vec<DecisionEvent>` + last `away_summary` + recent user prompts. Hard truncate to budget. System message = "Summarize this Claude Code session: goal, key decisions, current state. Be concise."
3. `openai.rs`: reqwest POST to chat/completions with `Authorization: Bearer`; parse `choices[0].message.content`; map errors (401 no/invalid key, 429 rate-limit, network) to typed errors. Non-streaming first; SSE + `Channel` streaming as enhancement.
4. `commands.rs`: `summarize_session` (async, off-thread), `set_openai_key`, `get/set_llm_settings`; cache result in registry keyed by `(session_id, decision_count)`.
5. Frontend: Summarize button (disabled w/o key, hint to Settings), loading spinner, error toast, render narrative; Settings panel for key + model + enable + disclosure.
6. Test: mock OpenAI for unit; manual real call once key provided; verify cache invalidation on new decision; verify no-key/offline/429 graceful paths.

## Todo
- [ ] key_store: env + config-file (0600); Keychain stub for phase-07
- [ ] size-capped summary prompt builder (messages)
- [ ] reqwest OpenAI chat/completions client + typed errors
- [ ] `summarize_session` + key/settings commands + cache
- [ ] Summarize button + render + loading/error UI (disabled w/o key)
- [ ] one-time privacy disclosure + size estimate
- [ ] streaming (SSE + Channel) — enhancement
- [ ] tests (mock + manual once key supplied)

## Success criteria
With a key set, clicking Summarize returns a coherent recap within a few seconds; result cached until new decisions; **without a key the app works fully and the button is cleanly disabled with a hint**; no-key/offline/rate-limit handled gracefully; disclosure shown once; only the selected session's minimal data is sent.

## Risks
- Model id drift → model is config; confirm exact id when key arrives. Default cheap model.
- Token cost surprise → default small model, on-demand only, show estimate.
- Key handling in dev (no Keychain) → config file `0600` + never logged/committed; Keychain when signed.
- Privacy → strict minimal-send + explicit opt-in.

## Security
Only feature with egress. Key from env/`0600` config in dev (never plaintext logs/repo), Keychain later. TLS via reqwest. Minimal, disclosed, opt-in data send. React escapes API response on render.

## Next steps
→ phase-07: signing enables Keychain; settings UI consolidated; local-build polish.
