// Animated menubar "pet": a tiny pixel worker drawn into the tray icon that
// reflects the aggregate state — bobs while running (green), turns amber with an
// alert dot when a session needs you, sits grey at rest. Pure flavour.
//
// We render a small char-grid to RGBA (2× = 32px) and swap the tray icon on a
// slow timer. The icon is NON-template so its colours show in the menubar.

use crate::app_state::AppState;
use std::sync::atomic::Ordering::Relaxed;
use std::time::Duration;
use tauri::image::Image;
use tauri::AppHandle;

const GRID: u32 = 16; // logical art size
const SCALE: u32 = 2; // → 32px icon
const PX: u32 = GRID * SCALE;

// Head DOWN (rows 2–7) and HEAD UP (rows 1–6) — alternating gives a typing bob.
#[rustfmt::skip]
const DOWN: [&str; 16] = [
    "................", "................",
    "......HHHH......", ".....HHHHHH.....",
    ".....HHHHHH.....", ".....HHHHHH.....",
    "......HHHH......", ".......NN.......",
    ".....SSSSSS.....", "....SSSSSSSS....",
    "....SSSSSSSS....", "....SSSSSSSS....",
    "....SSSSSSSS....", "................",
    "................", "................",
];
#[rustfmt::skip]
const UP: [&str; 16] = [
    "................",
    "......HHHH......", ".....HHHHHH.....",
    ".....HHHHHH.....", ".....HHHHHH.....",
    "......HHHH......", ".......NN.......",
    "................",
    ".....SSSSSS.....", "....SSSSSSSS....",
    "....SSSSSSSS....", "....SSSSSSSS....",
    "....SSSSSSSS....",
    "................", "................", "................",
];

fn color_for(ch: u8, shirt: [u8; 4]) -> [u8; 4] {
    match ch {
        b'H' => [42, 31, 23, 255],   // hair
        b'N' => [232, 185, 140, 255], // skin (neck)
        b'S' => shirt,
        _ => [0, 0, 0, 0],
    }
}

/// `kind`: 0 rest (grey) · 1 running (green, bobs) · 2 needs-you (amber + dot).
fn render_frame(kind: u8, bob: bool) -> Vec<u8> {
    let grid = if kind == 1 && bob { &UP } else { &DOWN };
    let shirt = match kind {
        1 => [52, 211, 153, 255],
        2 => [251, 191, 36, 255],
        _ => [100, 116, 139, 255],
    };
    let big = PX as usize;
    let mut out = vec![0u8; big * big * 4];
    for (ry, row) in grid.iter().enumerate() {
        for (rx, ch) in row.bytes().enumerate() {
            let mut col = color_for(ch, shirt);
            // Needs-you: a red notification dot in the top-right corner.
            if kind == 2 && ry <= 2 && (12..=14).contains(&rx) {
                col = [248, 113, 113, 255];
            }
            if col[3] == 0 {
                continue;
            }
            for dy in 0..SCALE as usize {
                for dx in 0..SCALE as usize {
                    let px = rx * SCALE as usize + dx;
                    let py = ry * SCALE as usize + dy;
                    let i = (py * big + px) * 4;
                    out[i..i + 4].copy_from_slice(&col);
                }
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
                continue; // nothing to redraw (only running actually animates)
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
