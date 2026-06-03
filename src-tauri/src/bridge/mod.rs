// Bridge layer: connects the Rust core to the OS shell (tray, notifications,
// window) and the web frontend (events + commands).

pub mod commands;
pub mod events;
pub mod popup;
pub mod tray;
