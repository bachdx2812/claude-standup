import { useEffect, useState } from "react";
import { fetchSettings, setAutoPopup, setSummaryModel, snoozePopups } from "../lib/tauri-events";
import { contextColor, formatCost } from "../lib/format";

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

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setAuto(s.autoPopup);
        setModel(s.summaryModel);
      })
      .catch(() => {});
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
        {running > 0 ? `● ${running} running` : "idle"}
        {needs > 0 ? ` · 🔔 ${needs} need you` : ""}
      </span>
      <button className="gear" onClick={() => setOpen((o) => !o)} title="Settings">
        ⚙
      </button>
      {open && (
        <div className="settings-pop">
          <label className="settings-field">
            <span>Show sessions active within</span>
            <select
              value={windowHours}
              onChange={(e) => onWindowChange(Number(e.target.value))}
            >
              <option value={1}>1 hour</option>
              <option value={3}>3 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
            </select>
          </label>
          <label className="settings-row">
            <input type="checkbox" checked={autoPopup} onChange={toggleAuto} />
            Auto-popup on activity
          </label>
          <button
            className="snooze"
            onClick={() => {
              snoozePopups(60).catch(() => {});
              setOpen(false);
            }}
          >
            Snooze popups 1h
          </button>

          <div className="settings-divider" />

          <label className="settings-field">
            <span>Summary model (optional)</span>
            <input
              placeholder="blank = Claude default"
              value={model}
              onChange={(e) => onModel(e.target.value)}
            />
          </label>
          <div className="disclosure">
            Summaries run the local <code>claude -p</code> (your Claude login) — no API key.
          </div>
        </div>
      )}
    </header>
  );
}
