# KytyPS5 Web

Live: https://shubin123.github.io/kytyps5_web/
Backend: https://github.com/Shubin123/kytyps5_emscripten
Frontend: https://github.com/Shubin123/kytyps5_web

**Status:** experimental. River City Girls (PPSA04075, Unity/IL2CPP) boots through Unity and IL2CPP start-up in the x86-64 interpreter and starts loading its first scene, with its job, loading, graphics and FMOD audio threads running. Nothing is drawn yet (the GPU is a stand-in that only executes synchronization packets), so the canvas stays black, and the interpreter is far too slow (about 7 million guest instructions per second) to reach the title screen in reasonable time.

## Hosted site

The [Pages workflow](.github/workflows/pages.yml) builds the WASM runtime from `kytyps5_emscripten` and deploys `web/` on every push to `main` (re-run it manually after backend changes). GitHub Pages can't send COOP/COEP headers, so `coi-serviceworker.js` adds them to enable `SharedArrayBuffer`.

Pick a game folder, or any folder containing one. The boot files, modules and game data are copied into the emulator's in-memory file system; large media (`.resS`, `.bank`, videos) is read in 1 MB chunks only when the game asks for it. Nothing leaves the browser.

Debug parameters: `?watch=<hex,...>` logs when execution reaches those addresses and `?watchmem=<hex,...>` logs the instructions that change those quadwords.

Test the hosted site with a local game folder:

```bash
node tests/pages.mjs https://shubin123.github.io/kytyps5_web/ /path/to/game [canvas.png]
```

## Overview

Browser frontend and test harness for the **KytyPS5** PlayStation 5 emulator WebAssembly port. Provides game loading, DualSense/keyboard input mapping, Web Audio output, and a diagnostics dashboard.

The core C++ emulator engine compiled to WebAssembly is maintained in the sibling repository [`kytyps5_emscripten`](https://github.com/Shubin123/kytyps5_emscripten).

## Architecture

- **Graphics**: WebGL2 / WebGPU rendering of PS5 GNM GPU command output.
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
- **WebAssembly port** (WASM build, WebGL renderer, browser runtime) by Shubin123.
- **Emscripten** and its contributors.

## Upstream Provenance

- Upstream Source: https://github.com/InoriRus/Kyty
- Tracking branch: `main`
