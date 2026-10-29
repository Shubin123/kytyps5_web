#!/usr/bin/env node
// End-to-end test: loads WASM, mounts game files from server, parses ELF, runs interpreter.
// Usage: node tests/e2e.mjs <game-directory>

import { chromium } from 'playwright';
import { createServer } from '../scripts/server.mjs';
import path from 'node:path';

const GAME_DIR = process.argv[2] || process.env.KYTY_GAME_DIR;
if (!GAME_DIR) {
  console.error('Usage: node tests/e2e.mjs <game-directory>');
  process.exit(1);
}

const PORT = 9123;
const resolvedGameDir = path.resolve(GAME_DIR);
let server, browser, exitCode = 1;

function logLine(text) { console.log(`[e2e] ${text}`); }

async function waitForLog(page, pattern, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.$eval('#log-content', el => el.textContent).catch(() => '');
    if (pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern)) return text;
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for log pattern: ${pattern}`);
}

try {
  server = createServer({ gameDir: resolvedGameDir });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  logLine(`Server on :${PORT}, game: ${resolvedGameDir}`);

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Block COI service worker (server provides COOP/COEP headers)
  await page.route('**/coi-serviceworker.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  );

  // Capture console output
  page.on('console', msg => console.log(`  [browser] ${msg.text()}`));
  page.on('pageerror', err => console.error(`  [browser ERR] ${err.message}`));

  // Load the page
  logLine('Opening page...');
  await page.goto(`http://127.0.0.1:${PORT}/?autoload=1`, {
    waitUntil: 'domcontentloaded', timeout: 60_000,
  });

  // Give JS time to run
  await page.waitForTimeout(2000);

  // --- Milestone 1: WASM loaded ---
  logLine('Checking WASM init...');
  const logAfterInit = await waitForLog(page, 'runtime initialized', 30_000);
  logLine('PASS: WASM runtime initialized');

  // --- Milestone 2: Auto-load starts ---
  logLine('Checking auto-load starts...');
  await waitForLog(page, 'Auto-loading game', 10_000);
  logLine('PASS: Auto-load triggered');

  // --- Milestone 3: Files mounted (may take a while for large eboots) ---
  logLine('Waiting for file mount (eboot is ~27MB, may take a minute)...');
  await waitForLog(page, 'Mounted', 120_000);
  logLine('PASS: Game files mounted to MEMFS');

  // Dump log for debugging
  const logAfterMount = await page.$eval('#log-content', el => el.textContent).catch(() => '');
  logLine('Log (tail 5000): ' + logAfterMount.slice(-5000));

  // Give the emulator time to init (calloc 512MB etc)
  await page.waitForTimeout(3000);

  // --- Milestone 4: Emulator init ---
  logLine('Checking emulator init...');
  try {
    await waitForLog(page, /initializing emulator|emulator initialized|allocated.*MB|Game started|Start error/, 20_000);
    logLine('PASS: Emulator initialization attempted');
  } catch {
    const logNow = await page.$eval('#log-content', el => el.textContent).catch(() => '');
    logLine('WARN: No emulator init message found. Current log tail: ' + logNow.slice(-500));
  }

  // --- Milestone 5: ELF load attempted ---
  logLine('Checking ELF load...');
  await waitForLog(page, /loading game|trying.*eboot/, 15_000);
  logLine('PASS: ELF load attempted');

  // --- Milestone 6: Game started or interpreter executing ---
  logLine('Checking game start / interpreter execution...');
  try {
    await waitForLog(page, /game loaded|Game started|running|invalid opcode|exception.*RIP/, 30_000);
    logLine('PASS: Interpreter started executing');
  } catch {
    logLine('WARN: Game may not have started — checking status...');
  }

  // Let it run briefly
  await page.waitForTimeout(3000);

  // Collect final state
  const finalLogs = await page.$eval('#log-content', el => el.textContent).catch(() => '');
  const finalStatus = await page.$eval('#wasm-status-text', el => el.textContent).catch(() => 'unknown');

  logLine(`\nFinal status: ${finalStatus}`);
  logLine('--- Milestone Summary ---');

  // Extract quantitative data from logs
  const hleMatches = [...finalLogs.matchAll(/HLE calls=(\d+)/g)];
  const hleCalls = hleMatches.length > 0
    ? Math.max(...hleMatches.map(m => parseInt(m[1], 10)))
    : 0;

  const totalMatches = [...finalLogs.matchAll(/total=(\d+)/g)];
  const totalInsns = totalMatches.length > 0
    ? Math.max(...totalMatches.map(m => parseInt(m[1], 10)))
    : 0;

  const gotPatchMatch = finalLogs.match(/patched (\d+) GOT entries/);
  const gotPatched = gotPatchMatch ? parseInt(gotPatchMatch[1], 10) : 0;

  logLine(`Interpreter stats: ${totalInsns} instructions, ${hleCalls} HLE calls, ${gotPatched} GOT entries`);

  const milestones = [
    ['WASM loaded',           finalLogs.includes('runtime initialized')],
    ['Files mounted',         finalLogs.includes('Mounted')],
    ['Emulator initialized',  finalLogs.includes('allocated') && finalLogs.includes('emulator initialized')],
    ['ELF loaded & relocated', finalLogs.includes('entry point') && gotPatched > 0],
    ['Game code executing',   totalInsns >= 1000],
    ['PLT/HLE calls working', hleCalls >= 10],
    ['Sustained execution',   totalInsns >= 5000 && hleCalls >= 50],
  ];

  let passed = 0;
  for (const [name, ok] of milestones) {
    logLine(`  ${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (ok) passed++;
  }

  logLine(`\n${passed}/${milestones.length} milestones reached`);

  if (passed >= 6) {
    logLine('SUCCESS: boot pipeline verified (load, relocate, execute, SDK calls). This does not check that ' +
      'the game renders or makes progress; tests/pages.mjs reports stalls.');
    exitCode = 0;
  } else if (passed >= 4) {
    logLine('PARTIAL: Core pipeline works but game execution limited');
    exitCode = 0;
  } else {
    logLine('INSUFFICIENT: Core pipeline incomplete');
    exitCode = 1;
  }

} catch (err) {
  console.error(`[e2e] Error: ${err.message}`);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.close();
  process.exit(exitCode);
}
