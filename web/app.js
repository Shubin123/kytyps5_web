import { InputManager } from './input.js';
import { AudioManager } from './audio.js';
import { Diagnostics } from './diagnostics.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const dropZone = $('#drop-zone');
const badge = $('#wasm-badge');
const badgeText = $('#wasm-status-text');
const logContent = $('#log-content');

const state = {
  wasmReady: false,
  gameLoaded: false,
  running: false,
  Module: null,
};

const input = new InputManager(canvas);
const audio = new AudioManager();
const diag = new Diagnostics();

function log(msg, level = 'info') {
  const el = document.createElement('div');
  el.className = `log-${level}`;
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logContent.appendChild(el);
  logContent.scrollTop = logContent.scrollHeight;
  if (logContent.children.length > 2000) logContent.removeChild(logContent.firstChild);
}

function setStatus(cls, text) {
  badge.className = `status-badge ${cls}`;
  badgeText.textContent = text;
}

function checkCapabilities() {
  const issues = [];
  if (typeof SharedArrayBuffer === 'undefined') issues.push('SharedArrayBuffer');
  if (typeof WebAssembly === 'undefined') issues.push('WebAssembly');
  if (!navigator.gpu && !canvas.getContext('webgl2')) issues.push('WebGL2 or WebGPU');
  if (issues.length) {
    setStatus('error', `Missing: ${issues.join(', ')}`);
    log(`Browser missing required features: ${issues.join(', ')}`, 'error');
    return false;
  }
  return true;
}

async function initWasm() {
  if (!checkCapabilities()) return;
  setStatus('checking', 'Loading WASM...');
  log('Loading KytyPS5 WASM runtime...');

  try {
    const scriptUrl = 'runtime/kytyps5.js';
    const resp = await fetch(scriptUrl, { method: 'HEAD' });
    if (!resp.ok) {
      setStatus('error', 'Runtime not found');
      log('WASM runtime not found in runtime/. Run "npm run sync" first.', 'error');
      return;
    }

    // Load the Emscripten MODULARIZE script (it defines window.KytyPS5)
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = scriptUrl;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load kytyps5.js'));
      document.head.appendChild(s);
    });

    if (typeof KytyPS5 !== 'function') {
      throw new Error('KytyPS5 factory not found after loading script');
    }

    const Module = await KytyPS5({
      canvas,
      locateFile(path) {
        return `runtime/${path}`;
      },
      print(text) { log(text, 'info'); },
      printErr(text) { log(text, 'warn'); },
      onRuntimeInitialized() {
        state.wasmReady = true;
        setStatus('ready', 'WASM Ready');
        log('KytyPS5 runtime initialized.', 'success');
      },
    });

    state.Module = Module;
    if (state.wasmReady) {
      setStatus('ready', 'WASM Ready');
    }
  } catch (err) {
    setStatus('error', 'WASM load failed');
    log(`WASM load error: ${err.message}`, 'error');
  }
}

function stringToWasm(str) {
  const M = state.Module;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const ptr = M._malloc(bytes.length + 1);
  const heap = new Uint8Array(M.wasmMemory ? M.wasmMemory.buffer : M.HEAPU8.buffer);
  heap.set(bytes, ptr);
  heap[ptr + bytes.length] = 0;
  return ptr;
}

async function mountGameFiles(files) {
  const M = state.Module;
  if (!M || !M.FS) {
    log('WASM not ready, cannot mount files', 'error');
    return null;
  }

  const gameDir = '/game';
  try { M.FS.mkdir(gameDir); } catch {}

  const subdirs = ['Media', 'sce_module', 'sce_sys', 'fakelib', 'decrypted'];
  for (const d of subdirs) {
    try { M.FS.mkdir(`${gameDir}/${d}`); } catch {}
  }

  let ebootPath = null;
  let totalBytes = 0;
  let fileCount = 0;

  for (const { path: relPath, file } of files) {
    const fullPath = `${gameDir}/${relPath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (p) try { M.FS.mkdir(p); } catch {}
    }

    const data = new Uint8Array(await file.arrayBuffer());
    M.FS.writeFile(fullPath, data);
    totalBytes += data.length;
    fileCount++;

    if (relPath === 'eboot.bin' || relPath.endsWith('/eboot.bin')) {
      ebootPath = fullPath;
    }
  }

  log(`Mounted ${fileCount} files (${(totalBytes / 1048576).toFixed(1)} MB) to ${gameDir}`, 'success');
  return gameDir;
}

async function loadGameFromFolder() {
  if (!('showDirectoryPicker' in window)) {
    log('File System Access API not supported; use Chrome or Edge.', 'error');
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch {
    return;
  }

  log(`Reading folder: ${dirHandle.name}...`);
  setStatus('checking', 'Loading game...');

  const files = [];
  async function walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      if (name.startsWith('.')) continue;
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        files.push({ path: prefix ? `${prefix}/${name}` : name, file });
      } else {
        await walk(entry, prefix ? `${prefix}/${name}` : name);
      }
    }
  }
  await walk(dirHandle, '');

  const hasEboot = files.some(f =>
    f.path === 'eboot.bin' ||
    f.path === 'eboot.bin.esbak' ||
    f.path === 'decrypted/eboot.bin' ||
    f.path === 'decrypted/eboot.bin.esbak'
  );
  if (!hasEboot) {
    log('No eboot.bin found in the selected folder.', 'error');
    setStatus('error', 'Missing eboot.bin');
    return;
  }

  const paramFile = files.find(f =>
    f.path === 'sce_sys/param.json' ||
    f.path === 'decrypted/sce_sys/param.json'
  );
  if (paramFile) {
    try {
      const text = await paramFile.file.text();
      const param = JSON.parse(text);
      const title = param.localizedParameters?.['en-US']?.titleName || param.titleId || 'Unknown';
      const contentId = param.contentId || '';
      const ver = param.contentVersion || '';
      $('#game-info-content').innerHTML = `
        <p><strong>${title}</strong></p>
        <p class="muted">${contentId}</p>
        <p class="muted">v${ver}</p>
      `;
      log(`Game: ${title} (${param.titleId}) v${ver}`, 'info');
    } catch {}
  }

  const ebootPath = await mountGameFiles(files);
  if (!ebootPath) return;

  startGame(ebootPath);
}

async function loadEbootOnly() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bin';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    log(`Loading eboot: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
    setStatus('checking', 'Loading game...');

    const ebootPath = await mountGameFiles([{ path: 'eboot.bin', file }]);
    if (ebootPath) startGame(ebootPath);
  });
  input.click();
}

function startGame(gameDir) {
  const M = state.Module;
  if (!M) {
    log('WASM module not loaded.', 'error');
    return;
  }

  dropZone.classList.add('hidden');
  state.gameLoaded = true;
  canvas.focus();

  log('Initializing emulator...');

  try {
    if (M.ccall) {
      M.ccall('kyty_init', 'number', ['string'], ['{}']);
      M.ccall('kyty_load_game', 'number', ['string'], [gameDir]);
    } else if (M._kyty_init) {
      const cfgPtr = stringToWasm('{}');
      M._kyty_init(cfgPtr);
      M._free(cfgPtr);
      const pathPtr = stringToWasm(gameDir);
      M._kyty_load_game(pathPtr);
      M._free(pathPtr);
    }

    state.running = true;
    setStatus('running', 'Running');
    log('Game started.', 'success');
    audio.resume();
    requestAnimationFrame(frameLoop);
  } catch (err) {
    log(`Start error: ${err.message}`, 'error');
    setStatus('error', 'Start failed');
  }
}

function frameLoop(timestamp) {
  if (!state.running) return;

  const M = state.Module;
  diag.frameBegin(timestamp);

  try {
    const padState = input.poll();
    if (M.ccall) {
      M.ccall('kyty_input_values', null,
        ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
        [padState.buttons, padState.lx, padState.ly, padState.rx, padState.ry, padState.l2, padState.r2]);
    }

    if (M._kyty_frame) {
      M._kyty_frame();
    }
  } catch (err) {
    if (!frameLoop._errLogged) {
      log(`Frame error: ${err.message}`, 'warn');
      frameLoop._errLogged = true;
    }
  }

  diag.frameEnd();
  diag.update();

  requestAnimationFrame(frameLoop);
}

// --- UI wiring ---

$('#browse-folder-btn').addEventListener('click', loadGameFromFolder);
$('#browse-eboot-btn').addEventListener('click', loadEbootOnly);
$('#btn-clear-log').addEventListener('click', () => { logContent.innerHTML = ''; });

$('#btn-fullscreen').addEventListener('click', () => {
  const stage = $('#screen-stage');
  if (document.fullscreenElement) document.exitFullscreen();
  else stage.requestFullscreen().catch(() => {});
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'Enter') {
    e.preventDefault();
    $('#btn-fullscreen').click();
  }
});

// Layout menu
$('#btn-layout-menu').addEventListener('click', () => {
  const menu = $('#layout-menu');
  const backdrop = $('#layout-menu-backdrop');
  const show = menu.hidden;
  menu.hidden = !show;
  backdrop.hidden = !show;
  $('#btn-layout-menu').setAttribute('aria-expanded', String(show));
});
$('#btn-layout-menu-close').addEventListener('click', () => {
  $('#layout-menu').hidden = true;
  $('#layout-menu-backdrop').hidden = true;
  $('#btn-layout-menu').setAttribute('aria-expanded', 'false');
});
$('#layout-menu-backdrop').addEventListener('click', () => {
  $('#layout-menu').hidden = true;
  $('#layout-menu-backdrop').hidden = true;
  $('#btn-layout-menu').setAttribute('aria-expanded', 'false');
});

$('#layout-screen-width').addEventListener('input', (e) => {
  const v = e.target.value;
  $('#layout-screen-width-value').textContent = `${v}%`;
  $('.canvas-panel').style.flex = `0 0 ${v}%`;
  try { localStorage.setItem('kyty-screen-width', v); } catch {}
});

$('#volume-slider').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#volume-value').textContent = `${v}%`;
  audio.setVolume(v / 100);
  try { localStorage.setItem('kyty-volume', String(v)); } catch {}
});

$('#mute-toggle').addEventListener('change', (e) => {
  audio.setMuted(e.target.checked);
  try { localStorage.setItem('kyty-muted', String(e.target.checked)); } catch {}
});

$('#show-fps').addEventListener('change', (e) => {
  $('#fps-overlay').classList.toggle('hidden', !e.target.checked);
  try { localStorage.setItem('kyty-show-fps', String(e.target.checked)); } catch {}
});

$('#btn-controls-help').addEventListener('click', () => { $('#controls-dialog').showModal(); });
$('#btn-close-controls').addEventListener('click', () => { $('#controls-dialog').close(); });

// Restore settings
try {
  const sw = localStorage.getItem('kyty-screen-width');
  if (sw) { $('#layout-screen-width').value = sw; $('#layout-screen-width-value').textContent = `${sw}%`; $('.canvas-panel').style.flex = `0 0 ${sw}%`; }
  const vol = localStorage.getItem('kyty-volume');
  if (vol) { $('#volume-slider').value = vol; $('#volume-value').textContent = `${vol}%`; audio.setVolume(Number(vol) / 100); }
  const muted = localStorage.getItem('kyty-muted');
  if (muted === 'true') { $('#mute-toggle').checked = true; audio.setMuted(true); }
  const showFps = localStorage.getItem('kyty-show-fps');
  if (showFps === 'false') { $('#show-fps').checked = false; $('#fps-overlay').classList.add('hidden'); }
} catch {}

// Drag & drop
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  if (!e.dataTransfer?.items?.length) return;
  const item = e.dataTransfer.items[0];
  if (item.kind !== 'file') return;
  const handle = await item.getAsFileSystemHandle?.();
  if (handle?.kind === 'directory') {
    log(`Dropped folder: ${handle.name}`);
    // re-implement with the handle
    setStatus('checking', 'Loading game...');
    const files = [];
    async function walk(h, prefix) {
      for await (const [name, entry] of h.entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'file') {
          files.push({ path: prefix ? `${prefix}/${name}` : name, file: await entry.getFile() });
        } else {
          await walk(entry, prefix ? `${prefix}/${name}` : name);
        }
      }
    }
    await walk(handle, '');
    const hasEb = files.some(f =>
      f.path === 'eboot.bin' || f.path === 'eboot.bin.esbak' ||
      f.path === 'decrypted/eboot.bin' || f.path === 'decrypted/eboot.bin.esbak'
    );
    if (!hasEb) {
      log('No eboot.bin found.', 'error');
      setStatus('error', 'Missing eboot.bin');
      return;
    }
    const ebootPath = await mountGameFiles(files);
    if (ebootPath) startGame(ebootPath);
  } else {
    const file = item.getAsFile();
    if (file) {
      const ebootPath = await mountGameFiles([{ path: 'eboot.bin', file }]);
      if (ebootPath) startGame(ebootPath);
    }
  }
});

// Auto-load from server (for e2e testing: ?autoload=1 with --game flag on server)
async function autoLoadFromServer() {
  log('Auto-loading game from server...');
  setStatus('checking', 'Loading game...');

  try {
    const manifestResp = await fetch('/gamefiles.json');
    if (!manifestResp.ok) {
      log('No game manifest found on server (start server with --game <dir>)', 'error');
      return;
    }
    const manifest = await manifestResp.json();
    log(`Game manifest: ${manifest.length} files total`);

    const M = state.Module;
    if (!M || !M.FS) {
      log('WASM not ready for file mounting', 'error');
      return;
    }

    const gameDir = '/game';
    try { M.FS.mkdir(gameDir); } catch {}

    // Only fetch essential files for boot (eboot, param.json, sce_module/*.prx)
    const essential = manifest.filter(f =>
      f.path === 'eboot.bin' ||
      f.path === 'eboot.bin.esbak' ||
      f.path.startsWith('decrypted/eboot.bin') ||
      f.path === 'sce_sys/param.json' ||
      f.path.startsWith('decrypted/sce_sys/param.json') ||
      f.path.endsWith('.prx') ||
      f.path.endsWith('.sprx')
    );
    log(`Loading ${essential.length} essential files (of ${manifest.length} total)...`);

    let totalBytes = 0;
    let fileCount = 0;
    for (const entry of essential) {
      const fullPath = `${gameDir}/${entry.path}`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      const parts = dir.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/');
        if (p) try { M.FS.mkdir(p); } catch {}
      }

      log(`Fetching ${entry.path} (${(entry.size / 1024).toFixed(0)} KB)...`);
      const resp = await fetch(`/gamefiles/${entry.path}`);
      if (!resp.ok) { log(`Failed to fetch ${entry.path}: ${resp.status}`, 'warn'); continue; }
      const data = new Uint8Array(await resp.arrayBuffer());
      M.FS.writeFile(fullPath, data);
      totalBytes += data.length;
      fileCount++;
    }

    log(`Mounted ${fileCount} files (${(totalBytes / 1048576).toFixed(1)} MB)`, 'success');
    startGame(gameDir);
  } catch (err) {
    log(`Auto-load error: ${err.message}`, 'error');
    setStatus('error', 'Auto-load failed');
  }
}

// Init
log('KytyPS5 Web frontend starting...');
(async () => {
  await initWasm();
  const params = new URLSearchParams(location.search);
  if (params.has('autoload') && state.wasmReady) {
    await autoLoadFromServer();
  }
})();
