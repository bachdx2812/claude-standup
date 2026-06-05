// Animated menubar "pet": a bold pixel face drawn into the tray icon that
// reflects the aggregate state — blinks/bobs green while running, turns amber
// with a red alert corner when a session needs you, grey at rest. Pure flavour.
//
// Drawn procedurally to a 32px NON-template RGBA icon (so its colours show), and
// swapped on a 500ms loop that reads live counts mirrored into AppState. The
// face FILLS the icon at high contrast so it reads at tiny menubar size.

use crate::app_state::AppState;
use std::sync::atomic::Ordering::Relaxed;
use std::time::Duration;
use tauri::image::Image;
use tauri::AppHandle;

const PX: u32 = 32;

/// `kind`: 0 rest (grey) · 1 running (green, blinks) · 2 needs-you (amber + dot).
fn render_frame(kind: u8, bob: bool) -> Vec<u8> {
    let big = PX as usize;
    let mut out = vec![0u8; big * big * 4];
    let body = match kind {
        1 => [52, 211, 153, 255],   // green
        2 => [251, 191, 36, 255],   // amber
        _ => [148, 163, 184, 255],  // slate
    };
    let put = |out: &mut [u8], x: usize, y: usize, c: [u8; 4]| {
        if x < big && y < big {
            let i = (y * big + x) * 4;
            out[i..i + 4].copy_from_slice(&c);
        }
    };

    // Chunky rounded face filling most of the icon (~22px), high contrast.
    for y in 4..28 {
        for x in 5..27 {
            let corner = (x < 8 || x > 23) && (y < 7 || y > 24);
            if corner {
                continue;
            }
            put(&mut out, x, y, body);
        }
    }
    // Eyes (dark). Running blink: eyes shrink on alternate frames.
    let dark = [20, 24, 33, 255];
    let eye_h = if kind == 1 && bob { 2 } else { 4 };
    for dy in 0..eye_h {
        for dx in 0..3 {
            put(&mut out, 11 + dx, 13 + dy, dark);
            put(&mut out, 18 + dx, 13 + dy, dark);
        }
    }
    // Needs-you: a red alert block in the top-right corner.
    if kind == 2 {
        for y in 2..9 {
            for x in 21..29 {
                put(&mut out, x, y, [248, 113, 113, 255]);
            }
        }
    }
    out
}

/// Spawn the tray-icon animation loop (reads live counts from `AppState`).
pub fn spawn(app: AppHandle, state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mut bob = false;
        let mut last: Option<(u8, bool)> = None;
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            bob = !bob;
            let needs = state.needs.load(Relaxed);
            let active = state.active.load(Relaxed);
            let kind = if needs > 0 {
                2
            } else if active > 0 {
                1
            } else {
                0
            };
            let key = (kind, kind == 1 && bob);
            if last == Some(key) {
                continue; // only running actually animates (blink)
            }
            last = Some(key);
            if let Some(tray) = app.tray_by_id("monitor-tray") {
                let rgba = render_frame(kind, bob);
                let _ = tray.set_icon(Some(Image::new(&rgba, PX, PX)));
                let _ = tray.set_icon_as_template(false);
            }
        }
    });
}
