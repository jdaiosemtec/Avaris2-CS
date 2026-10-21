# Avaris2 CS — notes for Claude

Read `DEVELOPER_GUIDE.md` (Chinese, complete file-by-file guide) before changing code. Short version:

- Electron 33.2.1 desktop app for Windows. `app/main.js` (main process, IPC `window.host.*` via `preload.js`),
  `app/renderer/index.html` + `js/*.js` (plain JS, global `window.AV`, no build step), `app/outreader.js` (.out reader).
- Engine: EPA SWMM 5.2.4 + Avaris changes in `engine/src` (C, OpenMP) → `app/engine/{win,linux}/avaris_engine`.
- Version lives in `app/package.json`. Release loop: implement → test (Playwright over CDP: `tests/launch_dev.sh`,
  `tests/e2e_smoke.py`) → bump version → add a line to `VERSIONS.md` → `./build.sh` (→ `dist/Avaris2CS-Setup-<ver>.exe`)
  → `git commit` + `git tag v<ver>` → send the installer → reply to the user **in Chinese**, saying honestly what was
  verified (the Windows UI itself is never seen; only Linux Electron + Playwright).
- Every model change goes through `app.exec({label, do, undo, changes})` / `app.setProps` (undo + audit history).
- Never write sections EPA SWMM / Avaris DS do not know into the .inp; extensions are `;;@OSEM …` comment lines or
  side files (`.ini`, `.prj`, `.flags.json`, `.mesh2d.json`, `.osemhist.json`).
- Units follow Flow Units (CFS/GPM/MGD = US ft, CMS/LPS/MLD = SI m).
- New renderer file → add a `<script>` in `index.html` in dependency order.
- User preferences: ArcGIS Pro–style ribbon/UI; show an HTML prototype for confirmation before larger UI changes;
  keep dialogs tidy. Do NOT update the user guide (HTML manual) unless the user asks. Licensing is on (phase 1, `licence.js`); licences are issued with `tools/licence-manager` (OSEMTEC only), never inside the app.
