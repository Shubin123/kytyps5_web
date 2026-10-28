import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../scripts/server.mjs';

const webDir = fileURLToPath(new URL('../web/', import.meta.url));
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}`);
    failed++;
  }
}

console.log('KytyPS5 Web smoke tests\n');

// Check required files exist
const requiredFiles = [
  'index.html', 'style.css', 'app.js', 'input.js', 'audio.js',
  'diagnostics.js', 'coi-serviceworker.js',
];
for (const f of requiredFiles) {
  try {
    await stat(path.join(webDir, f));
    assert(true, `${f} exists`);
  } catch {
    assert(false, `${f} exists`);
  }
}

// Check index.html has required elements
const html = await readFile(path.join(webDir, 'index.html'), 'utf-8');
assert(html.includes('canvas'), 'index.html contains canvas element');
assert(html.includes('coi-serviceworker.js'), 'index.html loads COI service worker');
assert(html.includes('app.js'), 'index.html loads app.js');
assert(html.includes('eboot.bin'), 'index.html mentions eboot.bin');

// Check server starts and serves files
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert(res.status === 200, 'Server serves index.html');
  assert(res.headers.get('cross-origin-opener-policy') === 'same-origin', 'COOP header set');
  assert(res.headers.get('cross-origin-embedder-policy') === 'require-corp', 'COEP header set');

  const cssRes = await fetch(`http://127.0.0.1:${port}/style.css`);
  assert(cssRes.status === 200, 'Server serves style.css');
  assert(cssRes.headers.get('content-type') === 'text/css', 'CSS content-type correct');

  const notFound = await fetch(`http://127.0.0.1:${port}/nonexistent`);
  assert(notFound.status === 404, 'Server returns 404 for missing files');
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
