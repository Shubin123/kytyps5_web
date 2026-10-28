import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bin': 'application/octet-stream',
  '.prx': 'application/octet-stream',
  '.sprx': 'application/octet-stream',
};

export function createServer({ isolation = true, gameDir = null } = {}) {
  return http.createServer(async (request, response) => {
    const headers = isolation ? {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-cache',
    } : { 'Cache-Control': 'no-cache' };

    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405, headers);
        response.end();
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      // Game file serving: /gamefiles/ prefix serves from the mounted game directory
      if (gameDir && pathname.startsWith('/gamefiles/')) {
        const relPath = pathname.slice('/gamefiles/'.length);
        const file = path.resolve(gameDir, relPath);
        if (!file.startsWith(path.resolve(gameDir))) {
          response.writeHead(403, headers);
          response.end();
          return;
        }
        const info = await stat(file);
        if (info.isDirectory()) {
          // List directory contents as JSON
          const entries = await readdir(file, { withFileTypes: true });
          const items = entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : 'file',
          }));
          const json = JSON.stringify(items);
          response.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
          response.end(json);
          return;
        }
        const data = await readFile(file);
        response.writeHead(200, {
          ...headers,
          'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
          'Content-Length': data.length,
        });
        response.end(request.method === 'HEAD' ? undefined : data);
        return;
      }

      // Game manifest: /gamefiles.json lists all files recursively
      if (gameDir && pathname === '/gamefiles.json') {
        const files = [];
        async function walk(dir, prefix) {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name.startsWith('.')) continue;
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) {
              await walk(path.join(dir, e.name), rel);
            } else {
              const info = await stat(path.join(dir, e.name));
              files.push({ path: rel, size: info.size });
            }
          }
        }
        await walk(gameDir, '');
        const json = JSON.stringify(files);
        response.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
        response.end(json);
        return;
      }

      const file = path.resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
      if (!file.startsWith(root)) {
        response.writeHead(403, headers);
        response.end();
        return;
      }
      const info = await stat(file);
      const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
      if (request.headers['if-none-match'] === etag) {
        response.writeHead(304, { ...headers, ETag: etag });
        response.end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, {
        ...headers,
        ETag: etag,
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Length': data.length,
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(404, headers);
      response.end('Not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const gameIdx = process.argv.indexOf('--game');
  const gameDir = gameIdx >= 0 ? path.resolve(process.argv[gameIdx + 1]) : (process.env.KYTY_GAME_DIR || null);
  const server = createServer({ gameDir });
  server.listen(port, '127.0.0.1', () => {
    console.log(`KytyPS5 Web: http://127.0.0.1:${server.address().port}`);
    if (gameDir) console.log(`Game directory: ${gameDir}`);
  });
}
