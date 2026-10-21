#!/bin/bash
# Start Avaris2 CS from the source folder (Linux, headless) with Chrome DevTools Protocol on port 9333,
# so Playwright tests can drive it.  ELECTRON = Electron 33.2.1 for Linux (unzipped electron-v33.2.1-linux-x64.zip).
P=$(cd "$(dirname "$0")/.." && pwd)
ELECTRON=${ELECTRON:-$HOME/electron-linux/electron}
if ! pgrep -x Xvfb >/dev/null; then Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 & sleep 1; fi
export DISPLAY=${DISPLAY:-:99}
cd "$P/app" && "$ELECTRON" --no-sandbox --disable-gpu --remote-debugging-port=9333 . "$@" > /tmp/avaris2cs-electron.log 2>&1 &
sleep 4; curl -s localhost:9333/json/list | head -c 200; echo
