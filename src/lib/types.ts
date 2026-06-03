// Mirrors the Rust serde types in src-tauri/src/model.rs (camelCase wire format).

export type SessionState = "running" | "needsInput" | "idle";

export interface SessionSnapshot {
  id: string;
  projectPath: string;
  projectSlug?: string | null;
  title?: string | null;
  branch?: string | null;
  version?: string | null;
  state: SessionState;
  currentStatus: string;
  startedAt?: string | null;
  lastActivity?: string | null;
  lastActivityUnix?: number | null;
  latestPrompt?: string | null;
  decisionCount: number;
  subagentCount: number;
  pendingBackgroundAgents: number;
  lineCount: number;
  costUsd: number;
  contextUsedTokens: number;
  contextLimit: number;
  model?: string | null;
}

export type DecisionKind =
  | "userPrompt"
  | "questionAnswered"
  | "prOpened"
  | "subagentSpawned"
  | "skillInvoked"
  | "commit"
  | "fileWrite"
  | "planApproved"
  | "awaySummary";

export interface DecisionEvent {
  kind: DecisionKind;
  timestamp?: string | null;
  summary: string;
  detail?: string | null;
  refId?: string | null;
}

export interface Settings {
  autoPopup: boolean;
  snoozed: boolean;
  summaryModel: string;
}
