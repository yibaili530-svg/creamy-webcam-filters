// Copies the MediaPipe wasm loader pair into public/ so it is served locally. Copies only; the source is left alone.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = resolve(root, 'public/mediapipe/wasm');

if (!existsSync(from)) {
  console.warn(`[copy-wasm] ${from} not found; skipped`);
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) cpSync(resolve(from, f), resolve(to, f));
console.log(`[copy-wasm] copied to ${to}`);
