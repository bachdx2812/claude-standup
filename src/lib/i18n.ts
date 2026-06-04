// Tiny in-house i18n for UI chrome — no framework (YAGNI). Data (statuses,
// summaries, key-decision text, prompts) is NOT translated. `t()` reads the
// module-level language; React re-renders via the lang store (App subscribes,
// re-rendering the tree), and the canvas picks the language up on its next frame.

export type Lang = "en" | "vi";

const en = {
  sessions: "Sessions",
  noneActive: "None active.",
  emptyTitle: "No active sessions right now.",
  emptyHint: "Start Claude Code in any project — it'll appear here.",
  keyDecisions: "Key Decisions",
  loading: "Loading…",
  noDecisions: "No key decisions captured yet.",
  summary: "Summary",
  summarizing: "summarizing…",
  generating: "Generating summary…",
  running: "Running",
  needsInput: "Needs Input",
  idle: "Idle",
  runningShort: "running",
  needYou: "need you",
  idleShort: "idle",
  boss: "BOSS",
  you: "(you)",
  checking: "CHECKING",
  office: "Office",
  desk: "desk",
  desks: "desks",
  showWithin: "Show sessions active within",
  hour1: "1 hour",
  hour3: "3 hours",
  hour12: "12 hours",
  hour24: "24 hours",
  autoPopup: "Auto-popup on activity",
  snooze1h: "Snooze popups 1h",
  summaryModel: "Summary model (optional)",
  summaryModelPlaceholder: "blank = Claude default",
  language: "Language",
  checkUpdates: "Check for updates",
  updChecking: "Checking…",
  updUpToDate: "You're up to date.",
  updError: "Check failed.",
};

type Dict = typeof en;
export type TKey = keyof Dict;

const vi: Dict = {
  sessions: "Phiên",
  noneActive: "Không có phiên nào.",
  emptyTitle: "Chưa có phiên nào đang hoạt động.",
  emptyHint: "Mở Claude Code ở dự án bất kỳ — nó sẽ hiện ở đây.",
  keyDecisions: "Quyết định chính",
  loading: "Đang tải…",
  noDecisions: "Chưa ghi nhận quyết định nào.",
  summary: "Tóm tắt",
  summarizing: "đang tóm tắt…",
  generating: "Đang tạo tóm tắt…",
  running: "Đang chạy",
  needsInput: "Cần nhập",
  idle: "Nghỉ",
  runningShort: "đang chạy",
  needYou: "cần bạn",
  idleShort: "nghỉ",
  boss: "SẾP",
  you: "(bạn)",
  checking: "ĐANG XEM",
  office: "Văn phòng",
  desk: "bàn",
  desks: "bàn",
  showWithin: "Hiện phiên hoạt động trong",
  hour1: "1 giờ",
  hour3: "3 giờ",
  hour12: "12 giờ",
  hour24: "24 giờ",
  autoPopup: "Tự bật khi có hoạt động",
  snooze1h: "Tạm ẩn 1 giờ",
  summaryModel: "Model tóm tắt (tuỳ chọn)",
  summaryModelPlaceholder: "để trống = mặc định Claude",
  language: "Ngôn ngữ",
  checkUpdates: "Kiểm tra cập nhật",
  updChecking: "Đang kiểm tra…",
  updUpToDate: "Đã là bản mới nhất.",
  updError: "Kiểm tra thất bại.",
};

const dicts: Record<Lang, Dict> = { en, vi };

function detectLang(): Lang {
  const saved = localStorage.getItem("cm.lang");
  if (saved === "en" || saved === "vi") return saved;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("vi")
    ? "vi"
    : "en";
}

let current: Lang = detectLang();

export function getLang(): Lang {
  return current;
}

export function setLangModule(l: Lang): void {
  current = l;
  localStorage.setItem("cm.lang", l);
}

export function t(key: TKey): string {
  return dicts[current][key] ?? en[key];
}
