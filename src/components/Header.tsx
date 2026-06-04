import { useEffect, useRef, useState } from "react";
import { fetchSettings, setAutoPopup, setSummaryModel, snoozePopups } from "../lib/tauri-events";
import { contextColor, formatCost } from "../lib/format";
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
}

export default function Header({
  running,
  needs,
  windowHours,
  onWindowChange,
  totalCost,
  maxContextPct,
}: HeaderProps) {
  const [autoPopup, setAuto] = useState(true);
  const [model, setModel] = useState("");
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
      .then((s) => {
        setAuto(s.autoPopup);
        setModel(s.summaryModel);
      })
      .catch(() => {});
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const toggleAuto = () => {
    const next = !autoPopup;
    setAuto(next);
    setAutoPopup(next).catch(() => {});
  };

  const onModel = (v: string) => {
    setModel(v);
    setSummaryModel(v).catch(() => {});
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
      <span className={`active-badge${running > 0 ? " on" : ""}`}>
        {running > 0 ? `● ${running} ${t("runningShort")}` : t("idleShort")}
        {needs > 0 ? ` · 🔔 ${needs} ${t("needYou")}` : ""}
      </span>
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

          <label className="settings-field">
            <span>{t("summaryModel")}</span>
            <input
              placeholder={t("summaryModelPlaceholder")}
              value={model}
              onChange={(e) => onModel(e.target.value)}
            />
          </label>
          <div className="disclosure">
            Summaries run the local <code>claude -p</code> (your Claude login) — no API key.
          </div>

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
