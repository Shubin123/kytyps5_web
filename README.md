# KytyPS5 Web

Backend: https://github.com/Shubin123/kytyps5_emscripten
Frontend: https://github.com/Shubin123/kytyps5_web

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
