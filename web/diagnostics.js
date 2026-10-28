const $ = (sel) => document.querySelector(sel);

export class Diagnostics {
  constructor() {
    this._frameStart = 0;
    this._frameTimes = [];
    this._lastUpdate = 0;
    this._frameCount = 0;
    this._fpsSmoothed = 0;
  }

  frameBegin(timestamp) {
    this._frameStart = timestamp;
  }

  frameEnd() {
    const now = performance.now();
    const dt = now - this._frameStart;
    this._frameTimes.push(dt);
    if (this._frameTimes.length > 120) this._frameTimes.shift();
    this._frameCount++;
  }

  update() {
    const now = performance.now();
    if (now - this._lastUpdate < 500) return;
    this._lastUpdate = now;

    const recent = this._frameTimes.slice(-60);
    if (!recent.length) return;

    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const fps = avg > 0 ? Math.round(1000 / avg) : 0;

    this._fpsSmoothed = this._fpsSmoothed * 0.7 + fps * 0.3;
    const displayFps = Math.round(this._fpsSmoothed);
    const displayMs = avg.toFixed(1);

    const fpsText = $('#fps-text');
    const frameText = $('#frame-time-text');
    if (fpsText) fpsText.textContent = `${displayFps} FPS`;
    if (frameText) frameText.textContent = `${displayMs} ms`;

    const diagFps = $('#diag-fps');
    const diagFt = $('#diag-frametime');
    const diagHeap = $('#diag-heap');
    const diagThreads = $('#diag-threads');
    const diagDraws = $('#diag-draws');

    if (diagFps) diagFps.textContent = String(displayFps);
    if (diagFt) diagFt.textContent = `${displayMs} ms`;

    if (diagHeap && typeof Module !== 'undefined' && Module.HEAPU8) {
      const mb = (Module.HEAPU8.length / 1048576).toFixed(0);
      diagHeap.textContent = `${mb} MB`;
    }

    if (diagThreads) {
      diagThreads.textContent = typeof PThread !== 'undefined' && PThread.runningWorkers
        ? String(PThread.runningWorkers.length)
        : '--';
    }

    if (diagDraws) diagDraws.textContent = '--';
  }
}
