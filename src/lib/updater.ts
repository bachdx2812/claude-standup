import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "" | "checking" | "uptodate" | "error";

// Check GitHub Releases for a newer signed build. Progress is reported via
// `onStatus` (for inline UI — no menu-closing, no native "up to date" popup);
// when an update is found it confirms, downloads, installs, and relaunches.
export async function checkForUpdate(onStatus?: (s: UpdateStatus) => void): Promise<void> {
  const status = onStatus ?? (() => {});
  try {
    status("checking");
    const update = await check();
    if (!update) {
      status("uptodate");
      return;
    }
    status("");
    const ok = window.confirm(
      `Update available: ${update.version}\n\n${update.body ?? ""}\n\nInstall and relaunch now?`,
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    status("error");
    console.error("update check failed:", e);
  }
}
