#!/usr/bin/env node
// Boots a game the way a user does on the hosted site: pick a folder, let it run, report what happened.
// Usage: node tests/pages.mjs <site-url> <game-folder> [screenshot.png]
// Env: RUN_MS (how long to run), LOG_OUT (file to save the full emulator log to)

import { writeFileSync } from 'node:fs';
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
  if (process.env.LOG_OUT) writeFileSync(process.env.LOG_OUT, log);
  const frames = [...log.matchAll(/frame (\d+): executed (\d+) insns, total=(\d+), RIP=(0x[0-9a-f]+), HLE calls=(\d+)/g)]
    .map(m => ({ n: +m[1], insns: +m[2], total: +m[3], rip: m[4], hle: +m[5] }));
  const last = frames[frames.length - 1];
  const halted = log.match(/.*(halting|halted at|game exited|abort\(\)|stack-protector|pure virtual).*/)?.[0];
  const unimpl = new Set([...log.matchAll(/Unimpl[^\n\[]*/g)].map(m => m[0].replace(/ at RIP=\S+/, '')));
  const reached = [...log.matchAll(/first call: (\S+)( \(not implemented)?/g)].map(m => m[1] + (m[2] ? '*' : ''));
  const gameLines = [...log.matchAll(/\[game\] ([^\n]*)/g)].map(m => m[1].replace(/\[\d+:\d+:\d+ [AP]M\].*$/, ''));
  const opens = [...log.matchAll(/\[hle\] open (\S+) -> (\w+)/g)].map(m => `${m[1]} (${m[2]})`);
  const threads = [...log.matchAll(/\[threads\] created (.+?) \(entry/g)].map(m => m[1]);
  const allBlocked = log.match(/\[threads\] every thread is blocked:[^\n]*/)?.[0];
  const fps = await page.$eval('#fps-text', el => el.textContent).catch(() => '?');

  console.log('\n--- report ---');
  console.log(`frames logged:        ${frames.length}${last ? ` (last frame ${last.n})` : ''}`);
  console.log(`instructions:         ${last?.total ?? 0}`);
  console.log(`SDK calls:            ${last?.hle ?? 0}`);
  console.log(`frame rate:           ${fps}`);
  console.log(`halted:               ${halted ?? 'no'}`);
  console.log(`unimplemented VEX:    ${unimpl.size ? [...unimpl].join('; ') : 'none logged'}`);
  console.log(`SDK functions reached: ${reached.length} (${reached.filter(n => n.endsWith('*')).length} still stubs, marked *)`);
  console.log(`  in order: ${reached.join(', ')}`);
  console.log(`threads created:      ${threads.length ? threads.join(', ') : 'none'}`);
  if (allBlocked) console.log(`deadlock:             ${allBlocked.replace(/^\[threads\] /, '')}`);
  console.log(`files opened:         ${opens.length ? opens.slice(0, 20).join(', ') : 'none'}`);
  const displayBuffers = log.match(/\[gpu\] registered [^\n\[]*/)?.[0];
  const flips = Math.max(0, ...[...log.matchAll(/\[gpu\] flip #(\d+)/g)].map(m => +m[1]));
  const draws = /\[gpu\] draw\/dispatch packets/.test(log);
  console.log(`display buffers:      ${displayBuffers ? displayBuffers.replace('[gpu] ', '') : 'none registered'}`);
  console.log(`flips (logged):       ${flips}${draws ? ' (draw packets reached; not rendered yet)' : ''}`);
  const watches = [...log.matchAll(/\[watch\] ([^\n]*)/g)].map(m => m[1].replace(/\[\d+:\d+:\d+ [AP]M\].*$/, ''));
  if (watches.length) console.log(`watch hits:\n  ${watches.join('\n  ')}`);
  console.log(`game output (${gameLines.length} lines):`);
  for (const l of gameLines.slice(0, 25)) console.log(`  | ${l}`);

  let stuck = false;
  if (frames.length >= 4) {
    const tail = frames.slice(-8);
    const ripSet = new Set(tail.map(f => f.rip));
    const deltas = tail.slice(1).map((f, i) => f.hle - tail[i].hle);
    const perCall = deltas.map((d, i) => (d ? tail[i + 1].insns / d : Infinity));
    const steady = perCall.every(p => Math.abs(p - perCall[0]) / perCall[0] < 0.01);
    const codeRips = tail.map(f => parseInt(f.rip, 16)).filter(r => r < 0x20000000);
    const window = codeRips.length ? Math.max(...codeRips) - Math.min(...codeRips) : Infinity;
    console.log(`last ${tail.length} frames:        RIPs ${[...ripSet].join(', ')}`);
    console.log(`                      ${deltas[0] ?? 0} HLE calls per ${tail[1].insns} insns per frame`);
    if (deltas.every(d => d === 0) && window < 256) {
      stuck = true;
      console.log(`loop check:           STUCK — spinning in a ${window}-byte code window with no SDK calls`);
    } else if (steady && ripSet.size <= 8) {
      stuck = true;
      console.log(`loop check:           STUCK — every frame repeats one ~${Math.round(perCall[0])}-instruction loop` +
        ' around a single SDK call');
    } else {
      console.log('loop check:           execution varies between frames');
    }
  }

  if (shot) {
    await page.locator('#canvas').screenshot({ path: shot });
    console.log(`canvas screenshot:    ${shot}`);
  }

  exitCode = halted || stuck || !last ? 1 : 0;
} catch (err) {
  console.error(`FAIL: ${err.message}`);
} finally {
  await browser.close();
  process.exit(exitCode);
}
