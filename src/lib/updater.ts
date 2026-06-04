import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// Check GitHub Releases for a newer signed build; if found, confirm → download +
// install → relaunch. `silent` suppresses the up-to-date / error dialogs (used for
// the quiet check on launch); the Settings button passes silent=false.
export async function checkForUpdate(opts?: { silent?: boolean }): Promise<void> {
  const silent = opts?.silent ?? false;
  try {
    const update = await check();
    if (!update) {
      if (!silent) window.alert("You're on the latest version.");
      return;
    }
    const ok = window.confirm(
      `Update available: ${update.version}\n\n${update.body ?? ""}\n\nInstall and relaunch now?`,
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    if (!silent) window.alert(`Update check failed: ${String(e)}`);
    // On the launch auto-check, stay quiet (e.g. offline, or no release yet).
  }
}
