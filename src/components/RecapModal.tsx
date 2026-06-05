import { useEffect, useRef, useState } from "react";
import type { SessionSnapshot } from "../lib/types";
import { buildRecap } from "../lib/recap-data";
import { drawRecapCard } from "../lib/recap-draw";
import { saveRecapPng } from "../lib/tauri-events";

interface Props {
  open: boolean;
  sessions: SessionSnapshot[];
  streak: number;
  onClose: () => void;
}

// A shareable daily "StandUp Recap" card. Rendered to a canvas (pixel-office
// style) so it exports straight to PNG / clipboard — or just screenshot it.
export default function RecapModal({ open, sessions, streak, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (open && canvasRef.current) {
      drawRecapCard(canvasRef.current, buildRecap(sessions, streak));
      setStatus("");
    }
  }, [open, sessions, streak]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const copyImage = () => {
    canvasRef.current?.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setStatus("Copied to clipboard!");
      } catch {
        setStatus("Couldn't copy — screenshot it (⌘⇧4)");
      }
    }, "image/png");
  };

  const saveImage = () => {
    canvasRef.current?.toBlob(async (blob) => {
      if (!blob) return;
      try {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        const day = new Date().toISOString().slice(0, 10);
        const path = await saveRecapPng(`claude-standup-${day}.png`, bytes);
        setStatus(`Saved to ${path}`);
      } catch {
        setStatus("Couldn't save — screenshot it (⌘⇧4)");
      }
    }, "image/png");
  };

  return (
    <div className="recap-overlay" onClick={onClose}>
      <div className="recap-modal" onClick={(e) => e.stopPropagation()}>
        <canvas ref={canvasRef} className="recap-canvas" />
        <div className="recap-actions">
          <button onClick={copyImage}>Copy image</button>
          <button onClick={saveImage}>Save .png</button>
          <button className="recap-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="recap-status">{status || "Tip: screenshot it (⌘⇧4) to share anywhere"}</div>
      </div>
    </div>
  );
}
