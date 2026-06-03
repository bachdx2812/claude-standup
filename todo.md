# TODO

Planned work for Claude StandUp.

- [ ] **App logo** — design an icon and wire it up (`.icns` / dock / window),
      replacing the placeholder `app-icon.png`.
- [ ] **Settings, persistence & local-build polish** — round out the settings
      surface, persist preferences reliably, and tidy local build/packaging
      (phase 07).
- [ ] **Auto-update** — in-app updates via the Tauri updater against GitHub
      Releases (signed update manifest).
- [ ] **Performance tuning** — profile the canvas render loop and transcript
      tailing; throttle redraws when idle, cap work per frame, and speed up
      large-transcript parsing.
