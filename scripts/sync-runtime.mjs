import { copyFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.resolve(
  process.argv[2] || fileURLToPath(new URL('../../kytyps5_emscripten/build-web/bin/', import.meta.url))
);
const destination = fileURLToPath(new URL('../web/runtime/', import.meta.url));

await mkdir(destination, { recursive: true });

try {
  const files = await readdir(source);
  let count = 0;
  for (const file of files) {
    if (/^kytyps5\.(wasm|js|data|worker\.js)$/.test(file)) {
      await copyFile(path.join(source, file), path.join(destination, file));
      count++;
    }
  }

  const manifest = {
    syncedAt: new Date().toISOString(),
    source,
    files: count,
  };
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Synced ${count} runtime files from ${source} to ${destination}`);
} catch (err) {
  console.warn(`Note: Could not sync from ${source}: ${err.message}`);
  console.warn('Build the emscripten project first: cd ../kytyps5_emscripten && bash tools/web/build.sh');
}
