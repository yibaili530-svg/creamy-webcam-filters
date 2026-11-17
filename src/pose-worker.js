// Module worker: runs pose_landmarker_lite off the main thread. Frames arrive as ImageBitmaps (transferred).
//
// Protocol
//   main -> worker: { type: 'init', loader, wasm, model } | { type: 'infer', id, bitmap, capturedAt } | { type: 'close' }
//                   loader: wasm loader JS text; wasm: ArrayBuffer of the binary; model: ArrayBuffer of the .task file
//                   (all three fetched by the page, so the worker makes no network requests)
//   worker -> main: { type: 'ready', delegate } | { type: 'failed', message }
//                   { type: 'result', id, capturedAt, ms, pose } where pose is 33 {x, y, v, pr} or null
//                   { type: 'error', id, message }

import * as tasks from '@mediapipe/tasks-vision';

let landmarker = null;

/**
 * A module worker has no importScripts, so MediaPipe loads the wasm loader with import(). That path
 * leaves ModuleFactory unset for the first create, and MediaPipe clears it after each create. Wrapping
 * the loader in a fresh blob URL per create (indirect eval, classic sloppy script) avoids both problems.
 */
function loaderPerCreate(loaderText) {
  const source = `const factory = (0, eval)(${JSON.stringify(`${loaderText}\n;ModuleFactory`)});\nself.ModuleFactory = factory;\n`;
  let previousUrl = null;
  return () => {
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    previousUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    return previousUrl;
  };
}

async function init({ loader, wasm, model }) {
  // Both files arrive from the page. Blob URLs keep MediaPipe from fetching the same-origin paths itself.
  const wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
  const freshLoader = loaderPerCreate(loader);
  let lastError = null;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      const set = { wasmLoaderPath: freshLoader(), wasmBinaryPath };
      landmarker = await tasks.PoseLandmarker.createFromOptions(set, {
        baseOptions: { modelAssetBuffer: new Uint8Array(model), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      // Warm-up on a blank frame so a broken delegate fails here, not on the first real frame.
      const probe = await createImageBitmap(new ImageData(64, 64));
      try {
        landmarker.detectForVideo(probe, performance.now());
      } finally {
        probe.close();
      }
      self.postMessage({ type: 'ready', delegate });
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[pose-worker] ${delegate} delegate failed`, err);
    }
  }
  throw lastError ?? new Error('no pose delegate');
}

function infer({ id, bitmap, capturedAt }) {
  const t0 = performance.now();
  try {
    if (!landmarker) throw new Error('pose worker is not initialised');
    const res = landmarker.detectForVideo(bitmap, t0);
    const lm = res.landmarks?.[0] ?? null;
    // Plain numbers only: the result crosses the thread boundary by structured clone.
    const pose = lm ? lm.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 0, pr: p.presence ?? 1 })) : null;
    self.postMessage({ type: 'result', id, capturedAt, ms: performance.now() - t0, pose });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: String(err?.message ?? err) });
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init(msg);
    } catch (err) {
      self.postMessage({ type: 'failed', message: String(err?.message ?? err) });
    }
  } else if (msg.type === 'infer') {
    infer(msg);
  } else if (msg.type === 'close') {
    landmarker?.close();
    landmarker = null;
    self.close();
  }
};
