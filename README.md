# KytyPS5 Web

Live: https://shubin123.github.io/kytyps5_web/
Backend: https://github.com/Shubin123/kytyps5_emscripten
Frontend: https://github.com/Shubin123/kytyps5_web

**Status:** experimental. River City Girls (PPSA04075, Unity/IL2CPP) runs from boot through its intro movies to the title screen, menus and first stage, with a controller or the keyboard. The emulator draws in software (an RDNA shader interpreter and a multi-threaded rasterizer), so it is slow: about two seconds per frame in the browser. Movies play as black frames for their length (there is no video decoder).

Keyboard: arrow keys move, Z or Enter is Cross, X Circle, A Square, S Triangle, Q/E L1/R1, 1/3 L2/R2, Escape Options, Tab Create. A connected gamepad works too.

## Hosted site

The [Pages workflow](.github/workflows/pages.yml) builds the WASM runtime from `kytyps5_emscripten` and deploys `web/` on every push to `main` (re-run it manually after backend changes). GitHub Pages can't send COOP/COEP headers, so `coi-serviceworker.js` adds them to enable `SharedArrayBuffer`.

Pick a game folder, or any folder containing one. The boot files, modules and game data are copied into the emulator's in-memory file system; large media (`.resS`, `.bank`, videos) is read in 1 MB chunks only when the game asks for it. Nothing leaves the browser.

Debug parameters: `?watch=<hex,...>` logs when execution reaches those addresses, `?watchmem=<hex,...>` logs the instructions that change those quadwords, and `?press=frame:buttons:frames,...` holds buttons (the bits in `web/input.js`, e.g. 1 Cross, 0x200 Options) for some frames once the game has presented that many.

Test the hosted site with a local game folder:

```bash
node tests/pages.mjs https://shubin123.github.io/kytyps5_web/ /path/to/game [canvas.png]
# River City Girls: title, file, mode and character select, then walk into the first fight and attack,
# with screenshots along the way (the frame numbers can drift a little between machines):
SHOTS=60,150,270,460,520,560 RUN_MS=3000000 node tests/pages.mjs \
  "https://shubin123.github.io/kytyps5_web/?press=90:0x200:4,130:1:3,170:0x2000:3,190:0x2000:3,210:0x2000:3,230:0x8000:3,250:1:3,290:1:3,330:1:3,370:1:3,410:1:3,450:1:3,470:0x8000:50,530:1:3,545:0x4:3,553:0x4:3,561:0x4:3" \
  /path/to/game shot.png
```

## Overview

Browser frontend and test harness for the **KytyPS5** PlayStation 5 emulator WebAssembly port. Provides game loading, DualSense/keyboard input mapping, Web Audio output, and a diagnostics dashboard.

The core C++ emulator engine compiled to WebAssembly is maintained in the sibling repository [`kytyps5_emscripten`](https://github.com/Shubin123/kytyps5_emscripten).

## Architecture

- **Graphics**: the emulator renders the game's frames in software; WebGL2 shows them on the canvas.
- **Audio**: Web Audio API with AudioWorklet-based PCM streaming at 48 kHz.
- **Input**: Gamepad API (DualSense standard mapping) with keyboard fallback.
- **Filesystem**: Emscripten MEMFS for game files mounted from local disk.
- **Threading**: SharedArrayBuffer + pthreads for multi-threaded emulation.

## Quick Start

```bash
# Build the WASM runtime first:
cd ../kytyps5_emscripten
bash tools/web/build.sh

# Sync runtime artifacts:
cd ../kytyps5_web
npm run sync

# Start dev server:
npm start
# Open http://localhost:8080, then select a PS5 game folder.
```

## Credits

- **Kyty** by InoriRus — upstream PS5 emulator.
- **WebAssembly port** (WASM build, software GPU, browser runtime) by Shubin123.
- **Emscripten** and its contributors.

## Upstream Provenance

- Upstream Source: https://github.com/InoriRus/Kyty
- Tracking branch: `main`
