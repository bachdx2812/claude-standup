// Thin wrappers over Tauri commands + the live `sessions-update` event.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DecisionEvent, SessionSnapshot, Settings } from "./types";

export const fetchSessions = (): Promise<SessionSnapshot[]> =>
  invoke<SessionSnapshot[]>("get_sessions");

export const fetchDecisions = (sessionId: string): Promise<DecisionEvent[]> =>
  invoke<DecisionEvent[]>("get_decisions", { sessionId });

export const fetchSettings = (): Promise<Settings> => invoke<Settings>("get_settings");

export const setAutoPopup = (enabled: boolean): Promise<void> =>
  invoke("set_auto_popup", { enabled });

export const snoozePopups = (minutes: number): Promise<void> =>
  invoke("snooze_popups", { minutes });

export const summarizeSession = (sessionId: string): Promise<string> =>
  invoke<string>("summarize_session", { sessionId });

/** Subscribe to live snapshot pushes from the Rust watcher. */
export const onSessionsUpdate = (
  cb: (sessions: SessionSnapshot[]) => void,
): Promise<UnlistenFn> =>
  listen<SessionSnapshot[]>("sessions-update", (e) => cb(e.payload));
