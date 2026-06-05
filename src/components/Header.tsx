import { useEffect, useRef, useState } from "react";
import { fetchSettings, setAutoPopup, snoozePopups } from "../lib/tauri-events";
import { contextColor, fmtDuration, fmtTokensPerMin, formatCost } from "../lib/format";
import type { BillingBlock } from "../lib/types";
import { t, type Lang } from "../lib/i18n";
import { useLang } from "../store/lang-store";
import { checkForUpdate, type UpdateStatus } from "../lib/updater";
import { getVersion } from "@tauri-apps/api/app";

interface HeaderProps {
  running: number;
  needs: number;
  windowHours: number;
  onWindowChange: (h: number) => void;
  /** Sum of cost across the currently-visible sessions. */
  totalCost: number;
  /** Highest context-window usage % among visible sessions (null if none). */
  maxContextPct: number | null;
  /** Daily-use streak (consecutive days). */
  streak: number;
  /** USD spent today across all sessions (delta-tracked). */
  todayCost: number;
  /** Current account-wide 5h billing block (null when none/inactive). */
  block: BillingBlock | null;
  /** Open the shareable daily recap card. */
  onOpenRecap: () => void;
}

export default function Header({
  running,
  needs,
  windowHours,
  onWindowChange,
  totalCost,
  maxContextPct,
  streak,
  todayCost,
  block,
  onOpenRecap,
}: HeaderProps) {
  const [autoPopup, setAuto] = useState(true);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [upd, setUpd] = useState<UpdateStatus>("");
  const { lang, setLang } = useLang();
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Close the settings popover on a click outside it (or the gear).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || gearRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    fetchSettings()
      .then((s) => setAuto(s.autoPopup))
      .catch(() => {});
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const toggleAuto = () => {
    const next = !autoPopup;
    setAuto(next);
    setAutoPopup(next).catch(() => {});
  };

  return (
    <header className="app-header">
      <span className="brand-dot" />
      <h1>Claude StandUp</h1>
      {totalCost > 0 && (
        <span className="usage-pill" title="Total Claude usage across visible sessions">
          Σ {formatCost(totalCost)}
          {maxContextPct !== null && (
            <span className="usage-ctx" style={{ color: contextColor(maxContextPct) }}>
              {" "}
              · {maxContextPct}%
            </span>
          )}
        </span>
      )}
      <span className={`status-chip${running > 0 ? " running" : ""}`}>
        {running > 0 ? `● ${running} ${t("runningShort")}` : t("idleShort")}
      </span>
      {needs > 0 && (
        <span className="status-chip needs">
          🔔 {needs} {t("needYou")}
        </span>
      )}
      {streak >= 2 && (
        <span className="status-chip streak" title={`${streak}-day streak`}>
          🔥 {streak}
        </span>
      )}
      {todayCost > 0 && (
        <span className="status-chip today" title="Claude spend today">
          {formatCost(todayCost)} {t("today")}
        </span>
      )}
      {block?.active && block.tokens > 0 && (
        <span
          className="status-chip block"
          title={`5h usage block · ${formatCost(block.costUsd)} spent · resets ${new Date(
            block.endUnix * 1000,
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Claude Code activity only (no plan limit)`}
        >
          ⏳ {fmtDuration(block.resetsInSecs)} · {fmtTokensPerMin(block.burnTokensPerMin)}
        </span>
      )}
      <button className="recap-btn" onClick={onOpenRecap} title="Daily recap card — shareable">
        📸
      </button>
      <button
        ref={gearRef}
        className="gear"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
      >
        ⚙
      </button>
      {open && (
        <div className="settings-pop" ref={popRef}>
          <label className="settings-field">
            <span>{t("showWithin")}</span>
            <select
              value={windowHours}
              onChange={(e) => onWindowChange(Number(e.target.value))}
            >
              <option value={1}>{t("hour1")}</option>
              <option value={3}>{t("hour3")}</option>
              <option value={12}>{t("hour12")}</option>
              <option value={24}>{t("hour24")}</option>
            </select>
          </label>
          <label className="settings-field">
            <span>{t("language")}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="en">English</option>
              <option value="vi">Tiếng Việt</option>
            </select>
          </label>
          <label className="settings-row">
            <input type="checkbox" checked={autoPopup} onChange={toggleAuto} />
            {t("autoPopup")}
          </label>
          <button
            className="snooze"
            onClick={() => {
              snoozePopups(60).catch(() => {});
              setOpen(false);
            }}
          >
            {t("snooze1h")}
          </button>

          <div className="settings-divider" />
          <button
            className="snooze"
            disabled={upd === "checking"}
            onClick={() => checkForUpdate(setUpd)}
          >
            {t("checkUpdates")}
          </button>
          {upd && (
            <div className="update-status">
              {upd === "checking"
                ? t("updChecking")
                : upd === "uptodate"
                  ? t("updUpToDate")
                  : t("updError")}
            </div>
          )}
          <div className="app-version">Claude StandUp v{version}</div>
        </div>
      )}
    </header>
  );
}
