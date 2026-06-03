import { useRef, type CSSProperties } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { SessionSnapshot } from "../lib/types";
import { projectFolder, projectName, stateColor, stateLabel, timeAgo } from "../lib/format";

interface Props {
  s: SessionSnapshot;
  selected: boolean;
  onSelect: () => void;
  /** Denser variant for the narrow right rail (the office is the hero now). */
  compact?: boolean;
}

export default function SessionCard({ s, selected, onSelect, compact = false }: Props) {
  const ref = useRef<HTMLButtonElement>(null);

  // Entrance animation; CSS handles the per-state dot pulse.
  useGSAP(
    () => {
      gsap.from(ref.current, { opacity: 0, y: 10, duration: 0.35, ease: "power2.out" });
    },
    { scope: ref },
  );

  const style = { "--state": stateColor(s.state) } as CSSProperties;

  return (
    <button
      ref={ref}
      className={`card ${s.state}${selected ? " selected" : ""}${compact ? " compact" : ""}`}
      style={style}
      onClick={onSelect}
    >
      <div className="card-head">
        <span className={`dot ${s.state}`} />
        <span className="card-title">{projectName(s)}</span>
        <span className="card-state" style={{ color: stateColor(s.state) }}>
          {stateLabel(s.state)}
        </span>
      </div>
      <div className="card-status">{s.currentStatus}</div>
      {s.state === "running" && <div className="activity-bar" />}
      {/* Compact rail keeps it to title + status; the desk already carries the
          rich identity. Full card keeps the meta + path footer. */}
      {!compact && (
        <>
          <div className="card-meta">
            <span>{timeAgo(s.lastActivityUnix)}</span>
            {s.decisionCount > 0 && <span>🧠 {s.decisionCount}</span>}
            {s.subagentCount > 0 && <span>🤖 {s.subagentCount}</span>}
            {s.branch && s.branch !== "HEAD" && <span>⑂ {s.branch}</span>}
          </div>
          <div className="card-sub">{projectFolder(s)}</div>
        </>
      )}
      {compact && (
        <div className="card-meta">
          <span>{timeAgo(s.lastActivityUnix)}</span>
          {s.decisionCount > 0 && <span>🧠 {s.decisionCount}</span>}
          {s.subagentCount > 0 && <span>🤖 {s.subagentCount}</span>}
        </div>
      )}
    </button>
  );
}
