#!/usr/bin/env node
// Boots a game the way a user does on the hosted site: pick a folder, let it run, report what happened.
// Usage: node tests/pages.mjs <site-url> <game-folder> [screenshot.png]

import { chromium } from 'playwright';

const [url, folder, shot] = process.argv.slice(2);
if (!url || !folder) {
  console.error('Usage: node tests/pages.mjs <site-url> <game-folder> [screenshot.png]');
  process.exit(1);
}

const RUN_MS = Number(process.env.RUN_MS || 20_000);
const browser = await chromium.launch({ headless: true });
let exitCode = 1;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  page.on('pageerror', err => console.error(`[page error] ${err.message}`));
  const logText = () => page.$eval('#log-content', el => el.innerText).catch(() => '');
  const waitLog = async (re, ms) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const m = (await logText()).match(re);
      if (m) return m;
      await sleep(500);
    }
    throw new Error(`timed out waiting for ${re}`);
  };

  await page.goto(url, { waitUntil: 'load' });
  // coi-serviceworker reloads the page once to make it cross-origin isolated
  let isolated = false;
  for (let i = 0; i < 60 && !isolated; i++) {
    isolated = await page.evaluate(() => window.crossOriginIsolated).catch(() => false);
    if (!isolated) await sleep(500);
  }
  if (!isolated) throw new Error('page never became cross-origin isolated (SharedArrayBuffer unavailable)');
  console.log('cross-origin isolated: yes');

  await waitLog(/runtime initialized/, 60_000);
  console.log('WASM runtime: initialized');

  await page.setInputFiles('#folder-input', folder);
  console.log((await waitLog(/Game root: .*/, 120_000))[0]);
  console.log((await waitLog(/Mounted \d+ files.*/, 300_000))[0]);
  const started = await waitLog(/game loaded and running|failed to load any eboot|Start error.*/, 60_000);
  if (!/running/.test(started[0])) throw new Error(`boot failed: ${started[0]}`);
  console.log(`game started; running ${RUN_MS / 1000}s...`);

  await sleep(RUN_MS);

  const log = await logText();
  const frames = [...log.matchAll(/frame (\d+): executed (\d+) insns, total=(\d+), RIP=(0x[0-9a-f]+), HLE calls=(\d+)/g)]
    .map(m => ({ n: +m[1], insns: +m[2], total: +m[3], rip: m[4], hle: +m[5] }));
  const last = frames[frames.length - 1];
  const halted = log.match(/.*halting.*/)?.[0];
  const unimpl = new Set([...log.matchAll(/Unimpl[^\n\[]*/g)].map(m => m[0].replace(/ at RIP=\S+/, '')));
  const nids = new Set([...log.matchAll(/NID=(\S+)/g)].map(m => m[1]));
  const fps = await page.$eval('#fps-text', el => el.textContent).catch(() => '?');

  console.log('\n--- report ---');
  console.log(`frames logged:        ${frames.length}${last ? ` (last frame ${last.n})` : ''}`);
  console.log(`instructions:         ${last?.total ?? 0}`);
  console.log(`HLE calls:            ${last?.hle ?? 0} (distinct NIDs in first 100 calls: ${nids.size})`);
  console.log(`frame rate:           ${fps}`);
  console.log(`halted:               ${halted ?? 'no'}`);
  console.log(`unimplemented opcodes: ${unimpl.size ? [...unimpl].join('; ') : 'none logged'}`);

  if (frames.length >= 4) {
    const tail = frames.slice(-8);
    const ripSet = new Set(tail.map(f => f.rip));
    const deltas = tail.slice(1).map((f, i) => f.hle - tail[i].hle);
    const perCall = deltas.map((d, i) => (d ? tail[i + 1].insns / d : Infinity));
    const steady = perCall.every(p => Math.abs(p - perCall[0]) / perCall[0] < 0.01);
    console.log(`last ${tail.length} frames:        RIPs ${[...ripSet].join(', ')}`);
    console.log(`                      ${deltas[0] ?? 0} HLE calls per ${tail[1].insns} insns per frame`);
    if (steady && ripSet.size <= 8) {
      console.log(`loop check:           STUCK — every frame repeats one ~${Math.round(perCall[0])}-instruction loop` +
        ' around a single SDK call, which the stubs answer with 0');
    } else {
      console.log('loop check:           execution varies between frames');
    }
  }

  if (shot) {
    await page.locator('#canvas').screenshot({ path: shot });
    console.log(`canvas screenshot:    ${shot}`);
  }

  exitCode = halted || !last ? 1 : 0;
} catch (err) {
  console.error(`FAIL: ${err.message}`);
} finally {
  await browser.close();
  process.exit(exitCode);
}
