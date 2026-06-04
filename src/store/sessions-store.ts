// Reactive session store. The Rust watcher pushes full snapshot lists; the view
// decides filtering/visibility.

import { create } from "zustand";
import type { SessionSnapshot } from "../lib/types";

interface SessionsStore {
  sessions: SessionSnapshot[];
  setSessions: (next: SessionSnapshot[]) => void;
}

export const useSessions = create<SessionsStore>((set) => ({
  sessions: [],
  setSessions: (next) => set({ sessions: next }),
}));
