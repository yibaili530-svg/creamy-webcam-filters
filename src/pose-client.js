// Main-thread side of the pose worker. One frame in flight at a time: the next frame is submitted
// as soon as the previous result lands, so inference runs back to back without a queue building up.

import { POSE_MODEL_URL } from './config.js';

export function createPoseClient({ onReady, onFailed, onResult, onError }) {
  const worker = new Worker(new URL('./pose-worker.js', import.meta.url), { type: 'module' });
  let nextId = 1;
  let inFlight = null;

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'ready') onReady(msg);
    else if (msg.type === 'failed') onFailed(msg.message);
    else if (msg.type === 'result') {
      if (inFlight === msg.id) inFlight = null;
      onResult(msg);
    } else if (msg.type === 'error') {
      if (inFlight === msg.id) inFlight = null;
      onError(msg.message);
    }
  };
  worker.onerror = (e) => onFailed(e.message || 'worker error');

  return {
    async init() {
      // The page fetches the wasm pair, not the worker: same-origin requests from the page carry the Deployment
      // Protection cookie, and a worker fetch may not. Trailing slash, so the file names are appended, not replaced.
      const base = new URL('mediapipe/wasm/', document.baseURI).href;
      try {
        const [loaderRes, wasmRes] = await Promise.all([
          fetch(`${base}vision_wasm_internal.js`, { credentials: 'include' }),
          fetch(`${base}vision_wasm_internal.wasm`, { credentials: 'include' }),
        ]);
        if (!loaderRes.ok) throw new Error(`wasm loader HTTP ${loaderRes.status}`);
        if (!wasmRes.ok) throw new Error(`wasm binary HTTP ${wasmRes.status}`);
        const loader = await loaderRes.text();
        const wasm = await wasmRes.arrayBuffer();
        // A login or SSO page answers 200 with HTML; catch it here with a readable reason.
        if (!loader.includes('ModuleFactory')) throw new Error('wasm loader is not JavaScript (SSO or HTML page?)');
        if (new Uint8Array(wasm, 0, 4).join() !== '0,97,115,109') throw new Error('wasm binary is not WebAssembly (SSO or HTML page?)');
        // The model is fetched here too, without credentials. MediaPipe's own model fetch sends credentials, and the
        // model host answers with a wildcard CORS origin, so that request fails with "Failed to fetch".
        const modelRes = await fetch(POSE_MODEL_URL, { credentials: 'omit' });
        if (!modelRes.ok) throw new Error(`pose model HTTP ${modelRes.status}`);
        const model = await modelRes.arrayBuffer();
        worker.postMessage({ type: 'init', loader, wasm, model }, [wasm, model]);
      } catch (err) {
        onFailed(String(err?.message ?? err));
      }
    },
    busy: () => inFlight !== null,
    /** Hands a bitmap to the worker (transferred). Returns false and closes the bitmap when busy. */
    submit(bitmap, capturedAt) {
      if (inFlight !== null) {
        bitmap.close();
        return false;
      }
      inFlight = nextId++;
      worker.postMessage({ type: 'infer', id: inFlight, bitmap, capturedAt }, [bitmap]);
      return true;
    },
  };
}
