// Headless Chrome + CDP driver. Usage: node drive.mjs <mode: fixture|camera> <outdir> [frames=4] [gapMs=900]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Optional 5th argument: extra query, e.g. "&fixtureMode=headhands" (fixture only).
const [mode = 'fixture', outDir = '/tmp/dots-shots/out', frameCount = '4', gapMs = '900', extraQuery = ''] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const PORT = 9333;
const profile = `/tmp/dots-cdp-${process.pid}`;
const base = process.env.DOTS_URL ?? 'http://127.0.0.1:5188';
const url = `${base}/${mode === 'fixture' ? `?fixture=1&hud=0${extraQuery}` : '?hud=1'}`;
const flags = [
  '--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--enable-webgl', '--window-size=960,1280',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required',
];
if (mode === 'camera') flags.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream');
const chrome = spawn('/usr/bin/google-chrome', [...flags, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`)).json(); } catch { await sleep(500); }
  }
  throw new Error(`CDP ${path} unreachable`);
}

const list = await getJson('/json/list');
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method === 'Runtime.consoleAPICalled') logs.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  else if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 1280, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

// Wait for the first live pose (fixture) or for the camera to start.
const deadline = Date.now() + (mode === "camera" ? 40_000 : 150_000);
let stats = null;
let lastScale = 0;
while (Date.now() < deadline) {
  await sleep(1000);
  stats = await evalJs('JSON.stringify(window.__dots ? window.__dots.stats : null)');
  const s = stats ? JSON.parse(stats) : null;
  // Also wait for the figure to form (body attach near 1), so frame 0 is a complete figure, not the grow-in.
  const pr = mode === 'fixture' ? JSON.parse((await evalJs('JSON.stringify(window.__dots.probe())')) ?? '{}') : { attach: 1, scale: 0 };
  // Settled = attached, and shoulder-width scale no longer moving (it eases in over about 1 s after attach).
  const settled = pr.attach >= 0.98 && lastScale > 0 && Math.abs(pr.scale - lastScale) < 0.005 * lastScale;
  lastScale = pr.scale;
  // Partial fixtures: wait until the page reports the person as present, so the shot is never the default figure.
  const wantPresent = extraQuery.includes('fixtureMode=') && !extraQuery.includes('fixtureMode=full') && !extraQuery.includes('fixtureMode=fade');
  if (s && s.poseLive && s.poseCount >= 12 && s.fps > 0 && settled && (!wantPresent || s.present)) break;
  if (mode === 'camera' && s && s.source === 'none') break;
}
const shots = [];
for (let i = 0; i < Number(frameCount); i++) {
  if (i > 0) await sleep(Number(gapMs));
  const s = JSON.parse(await evalJs('JSON.stringify(window.__dots.stats)'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(outDir, `frame${i}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  shots.push({ file, stats: s });
  console.log(`frame ${i}: poseLive=${s.poseLive} poseCount=${s.poseCount} poseMs=${s.poseMs?.toFixed?.(1)} fps=${s.fps?.toFixed?.(1)} e2e=${s.e2eMs?.toFixed?.(0)} delegate=${s.delegate} gl=${s.renderer} source=${s.source} err=${s.error}`);
}
const hudText = await evalJs("document.getElementById('hud')?.textContent ?? ''");
const noticeText = await evalJs("document.getElementById('notice')?.hidden === false ? document.getElementById('notice').textContent : ''");
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ mode, shots, hudText, noticeText, logs: logs.slice(-40) }, null, 2));
console.log('HUD:\n' + hudText);
console.log('NOTICE: ' + noticeText);
console.log('console tail:', logs.slice(-8).join(' | '));
ws.close();
chrome.kill('SIGTERM');
await sleep(500);
