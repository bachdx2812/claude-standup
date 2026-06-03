// Reactive session store. The Rust watcher pushes full snapshot lists; we keep
// them and index by id. Filtering/visibility is decided in the view.

import { create } from "zustand";
import type { SessionSnapshot } from "../lib/types";

interface SessionsStore {
  sessions: SessionSnapshot[];
  byId: Record<string, SessionSnapshot>;
  setSessions: (next: SessionSnapshot[]) => void;
}

export const useSessions = create<SessionsStore>((set) => ({
  sessions: [],
  byId: {},
  setSessions: (next) =>
    set({ sessions: next, byId: Object.fromEntries(next.map((s) => [s.id, s])) }),
}));
