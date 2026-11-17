// Entry point. Source: the camera (getUserMedia) by default, or the synthetic fixture with ?fixture=1.
// Both feed the same pose worker. Inference runs back to back (one frame in flight); the render loop runs on
// rAF and only reads the joint tracker, so drawing never waits for inference.
//
// Parts: orbs appear and disappear per body part (head, torso, each arm, each hand, each leg). A part must
// stay detected for PART_ON_HOLD_S before it fades in as a whole, and stay missing for PART_OFF_HOLD_S
// before it fades out (slower than the fade-in). Brief dropouts hold the last smoothed pose. The default
// standing figure is used only when no person has been seen for PERSON_HOLD_S (or before the pose model is
// ready, or when the camera fails).

import { FRAME_ASPECT, BG_TOP, BG_BOT, BG_DARK_TOP, BG_DARK_BOT, POSE, PART_FADE_IN_S, PART_FADE_OUT_S, PART_ON_HOLD_S, PART_OFF_HOLD_S, PERSON_HOLD_S, EAR_TO_SHOULDER, EYE_TO_SHOULDER } from './config.js';
import { openCamera, cameraMessage } from './camera.js';
import { createPoseClient } from './pose-client.js';
import { createJointTracker, JOINT_IDS } from './joints.js';
import {
  createParticles, stepParticles, fillInstances, computeBallVisibility, snapHiddenBalls, stageMapping, PARTICLE_COUNT,
  INSTANCE_FLOATS,
} from './particles.js';
import { createRenderer } from './renderer.js';
import { drawFixture, restJointsWorld, fixtureKeep, FIXTURE_MODES, FIXTURE_W, FIXTURE_H } from './fixture.js';
import { createVisibility, maskPose } from './visibility.js';

const params = new URLSearchParams(location.search);
const useFixture = params.get('fixture') === '1';
const fixtureMode = FIXTURE_MODES.includes(params.get('fixtureMode')) ? params.get('fixtureMode') : 'full';
const showNoticeText = params.get('notice') !== '0';
// UI (HUD and notice text) is shown unless ?hud=0; H toggles it. Dark ground: ?bg=dark or B toggles it. Both instant.
let uiVisible = params.get('hud') !== '0';
let dark = params.get('bg') === 'dark';

const canvas = document.getElementById('gl');
const hud = document.getElementById('hud');
const notice = document.getElementById('notice');
const video = document.getElementById('cam');
const btnUi = document.getElementById('btn-ui');
const btnBg = document.getElementById('btn-bg');

function showNotice(text) {
  notice.textContent = text;
  notice.hidden = false;
}

function applyUi() {
  hud.hidden = !uiVisible;
  if (!uiVisible) notice.hidden = true;
  btnUi.textContent = uiVisible ? 'Hide info H' : 'Info H';
  btnUi.setAttribute('aria-pressed', String(!uiVisible));
}

function applyBg() {
  document.body.classList.toggle('dark', dark);
  btnBg.textContent = dark ? 'Light B' : 'Dark B';
  btnBg.setAttribute('aria-pressed', String(dark));
}

function toggleUi() {
  uiVisible = !uiVisible;
  applyUi();
  updateNotice(); // after module init, so the notice text is current when shown again
}

function toggleBg() {
  dark = !dark;
  applyBg();
}

btnUi.addEventListener('click', toggleUi);
btnBg.addEventListener('click', toggleBg);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'h') toggleUi();
  else if (k === 'b') toggleBg();
});
applyUi();
applyBg();

// Default figure, in world units, drawn whenever no person is tracked. Same particles, same look as a live pose.
const REST = restJointsWorld();

// Failures stay on screen until they clear: the camera or the pose model can each block the live figure.
const problem = { camera: null, pose: null };

const stats = {
  source: useFixture ? 'fixture' : 'camera',
  delegate: null,
  renderer: null,
  poseMs: null,
  poseLive: false,
  present: false,
  partial: false,
  unseen: [],
  visibleBalls: 0,
  poseCount: 0,
  fps: 0,
  e2eMs: null,
  frames: 0,
  error: null,
};
const e2eSamples = [];
let shownCapturedAt = -1;

let renderer;
try {
  renderer = createRenderer(canvas);
  stats.renderer = renderer.rendererName;
} catch (err) {
  showNotice(`WebGL2 is not available: ${err.message}`);
  throw err;
}

const particles = createParticles(PARTICLE_COUNT);
const tracker = createJointTracker();
const visibility = createVisibility(JOINT_IDS);
const instances = new Float32Array(PARTICLE_COUNT * INSTANCE_FLOATS);
const mirror = !useFixture; // the camera image is shown as a selfie: x is mirrored
const lastSample = { capturedAt: -1, at: 0 };
let lastPresentAt = -Infinity; // last time any joint was seen on (for the hold before falling back to the default figure)
let wasPresent = false;
let ballVisibleCount = 0;
let lastRawPose = null; // debug: the last pose result as the page sees it
const forearm = {}; // wrist id -> last forearm direction (unit) and length, for inferring a weak wrist from the elbow

// Fixture: a 1280x720 canvas with the figure drawn each time it is sent.
const fixtureCanvas = document.createElement('canvas');
fixtureCanvas.width = FIXTURE_W;
fixtureCanvas.height = FIXTURE_H;
const fixtureCtx = fixtureCanvas.getContext('2d');
const fixtureT0 = performance.now() / 1000;
/** Fixture clock in seconds from page load of the fixture: what the fixture draws and what the masks use. */
const fixtureClock = (nowMs) => nowMs / 1000 - fixtureT0;

let ready = false;
let submitting = false;

function sourceReady() {
  if (useFixture) return true;
  return video.readyState >= 2 && video.videoWidth > 0;
}

/** Map pose landmarks into the tracker's convention: mirrored for the selfie camera. */
function mapPose(pose) {
  if (!mirror) return pose;
  return pose.map((p) => ({ ...p, x: 1 - p.x }));
}

/** One line of status: the first problem, else what is still loading, else what is visible. Null hides the notice. */
function updateNotice() {
  let text = null;
  if (problem.camera) text = `${problem.camera} Showing the default standing figure for now.`;
  else if (problem.pose) text = `The pose model failed to load: ${problem.pose}. Showing the default standing figure.`;
  else if (!ready) text = 'Loading the pose model…';
  else if (!useFixture && !sourceReady()) text = 'Opening the camera…';
  else if (stats.poseCount === 0) text = 'Waiting for the first pose…';
  else if (!stats.present) text = 'No person detected. Showing the default standing figure.';
  else if (stats.partial) text = 'Only part of the body is visible; only those parts are drawn.';
  if (text === null || !showNoticeText || !uiVisible) notice.hidden = true;
  else showNotice(text);
}

const client = createPoseClient({
  onReady({ delegate }) {
    ready = true;
    stats.delegate = delegate;
    updateNotice();
    pump();
  },
  onFailed(message) {
    problem.pose = message;
    stats.error = `The pose model failed to load: ${message}`;
    updateNotice();
  },
  onResult({ capturedAt, ms, pose: raw }) {
    stats.poseMs = ms;
    stats.poseCount++;
    // Fixture only: joints the fixture does not draw are reported as not visible (never a guess for empty space).
    const pose = useFixture ? maskPose(raw, fixtureKeep(fixtureMode, fixtureClock(capturedAt))) : raw;
    visibility.update(pose, performance.now() / 1000);
    lastRawPose = pose;
    // The joint timeline runs on arrival: liveness and interpolation follow when samples land.
    // Capture time is kept only for the end-to-end figure.
    tracker.push(performance.now() / 1000, pose ? mapPose(pose) : null);
    lastSample.capturedAt = capturedAt;
    lastSample.at = performance.now();
    pump();
  },
  onError(message) {
    stats.error = `Pose inference error: ${message}`;
    pump();
  },
});

/** Sends one frame if the worker is free. The capture time is when the frame is taken. */
async function pump() {
  if (!ready || submitting || client.busy() || !sourceReady()) return;
  submitting = true;
  try {
    let capturedAt = performance.now();
    if (useFixture) {
      drawFixture(fixtureCtx, fixtureClock(capturedAt), fixtureMode);
      capturedAt = performance.now();
    }
    const bitmap = await createImageBitmap(useFixture ? fixtureCanvas : video);
    client.submit(bitmap, capturedAt);
  } catch (err) {
    stats.error = `Could not capture a frame: ${err.message}`;
  } finally {
    submitting = false;
  }
}

client.init();

// Camera. An error keeps the dots running (ambient cloud) and points at the fixture.
if (!useFixture) {
  openCamera(video)
    .then(() => {
      stats.source = 'camera';
      stats.error = null;
      problem.camera = null;
      updateNotice();
    })
    .catch((err) => {
      stats.source = 'none';
      const kind = err.kind ?? 'other';
      stats.error = `${kind}: ${err.name ?? ''} ${err.message ?? ''}`.trim();
      problem.camera = cameraMessage(kind);
      updateNotice();
    });
}

// Fallback pump for the case where the worker is idle and no frame was sent (e.g. camera not yet playing).
setInterval(pump, 100);

let lastT = performance.now() / 1000;
let lastJoints = null; // last frame's world joints, for the debug probe
let fpsAcc = 0;
let fpsN = 0;
let hudAt = 0;

function currentView() {
  const { W, H } = renderer.size();
  return stageMapping(W, H);
}

/** Shoulder width in world units from whichever pair is visible: shoulders, else ears, else eyes. Null if none. */
function sizeFrom(Jl) {
  const d = (a, b) => (Jl[a] && Jl[b] ? Math.hypot(Jl[a].x - Jl[b].x, Jl[a].y - Jl[b].y) : null);
  const sh = d(POSE.L_SHOULDER, POSE.R_SHOULDER);
  if (sh !== null) return sh;
  const ear = d(POSE.L_EAR, POSE.R_EAR);
  if (ear !== null) return ear * EAR_TO_SHOULDER;
  const eye = d(POSE.L_EYE, POSE.R_EYE);
  if (eye !== null) return eye * EYE_TO_SHOULDER;
  return null;
}

/** Centre of the visible torso joints, or of all visible joints when the torso is not in frame. Null if none. */
function centreFrom(Jl) {
  const torso = [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP].filter((id) => Jl[id]);
  const ids = torso.length >= 2 ? torso : Object.keys(Jl).map(Number);
  if (ids.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const id of ids) {
    x += Jl[id].x;
    y += Jl[id].y;
  }
  return { x: x / ids.length, y: y / ids.length };
}

// Body joints that make a whole figure. Used for the notice only; each ball is still gated by its own joints.
const CORE_IDS = [POSE.NOSE, POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP];
const LEG_IDS = [POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
const BODY_IDS = [POSE.NOSE, POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST,
  POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];

function frame(nowMs) {
  const t = nowMs / 1000;
  const dt = Math.max(1e-3, t - lastT);
  lastT = t;

  const cssW = Math.round(window.innerWidth * dpr());
  const cssH = Math.round(window.innerHeight * dpr());
  renderer.resize(cssW, cssH);
  const view = currentView();

  // Joints in world units (frame height = 1, width = FRAME_ASPECT). `seen` is the per-joint visibility state
  // with hysteresis, and it must also be current (inside LOST_AFTER_S) to count.
  const J = {};
  const tmp = { x: 0, y: 0 };
  for (const id of JOINT_IDS) {
    const pos = tracker.at(id, t, tmp);
    if (pos) J[id] = { x: pos.x * FRAME_ASPECT, y: pos.y };
  }
  // Weak wrist, good elbow: the wrist sits at the elbow along the last forearm direction seen at this wrist.
  const inferred = new Set();
  for (const [e, w] of [[POSE.L_ELBOW, POSE.L_WRIST], [POSE.R_ELBOW, POSE.R_WRIST]]) {
    if (visibility.isOn(w) && J[w] && J[e]) {
      const dx = J[w].x - J[e].x;
      const dy = J[w].y - J[e].y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) forearm[w] = { ux: dx / len, uy: dy / len, len };
    } else if (!visibility.isOn(w) && visibility.isOn(e) && forearm[w] && J[e] && tracker.live(e, t)) {
      const f = forearm[w];
      J[w] = { x: J[e].x + f.ux * f.len, y: J[e].y + f.uy * f.len };
      inferred.add(w);
    }
  }
  const seen = (id) => (visibility.isOn(id) || inferred.has(id)) && tracker.live(id, t) && Boolean(J[id]);
  const anySeen = JOINT_IDS.some(seen);
  if (anySeen) lastPresentAt = t;
  const present = t - lastPresentAt < PERSON_HOLD_S;

  // Positions and sizes for this frame. With no person, the default standing figure stands in for the whole body.
  let Jf = J;
  let Jl = {};
  if (present) {
    // Every frame with a person, each part's balls share that part's debounced presence. A frame with no
    // parts shown yet (within the person hold) hides every ball, so the figure never falls back to a stale body.
    computeBallVisibility(particles, (group) => visibility.isPartShown(group));
    // On the frame a person replaces the default figure, parts that are not shown yet are hidden at once.
    if (!wasPresent) snapHiddenBalls(particles);
    for (const id of JOINT_IDS) if (seen(id)) Jl[id] = J[id];
  } else {
    Jf = REST;
    Jl = REST;
    particles.tv.fill(1);
  }
  const sizeRef = sizeFrom(Jl);
  const centre = centreFrom(Jl);
  stats.present = present;
  stats.unseen = present ? BODY_IDS.filter((id) => !seen(id)) : [];
  // Partial = the head or torso is out of view, or both legs mostly are, or much of the body is missing.
  stats.partial = present && (
    CORE_IDS.some((id) => !seen(id)) ||
    LEG_IDS.filter((id) => !seen(id)).length >= 3 ||
    stats.unseen.length >= 6
  );
  wasPresent = present;
  lastJoints = { J: Jf, view };
  // The figure is always attached: with no person it is the default standing figure, and balls fade by visibility.
  stepParticles(particles, dt, t, Jf, { sizeRef, centre }, view);
  const count = fillInstances(particles, view, instances);
  ballVisibleCount = count;
  renderer.draw(instances, count, dark ? BG_DARK_TOP : BG_TOP, dark ? BG_DARK_BOT : BG_BOT, t, dark);

  // Latency: capture -> the first frame that shows this sample. Counted once per sample.
  if (lastSample.capturedAt >= 0 && lastSample.capturedAt !== shownCapturedAt) {
    shownCapturedAt = lastSample.capturedAt;
    const e2e = nowMs - lastSample.capturedAt;
    e2eSamples.push(e2e);
    if (e2eSamples.length > 30) e2eSamples.shift();
  }
  if (e2eSamples.length) {
    stats.e2eMs = e2eSamples.reduce((a, b) => a + b, 0) / e2eSamples.length;
  }
  stats.poseLive = visibility.anyOn() && performance.now() - lastSample.at <= 1000;

  stats.frames++;
  fpsAcc += 1 / dt;
  fpsN++;
  if (nowMs - hudAt > 250) {
    stats.fps = fpsAcc / fpsN;
    fpsAcc = 0;
    fpsN = 0;
    hudAt = nowMs;
    stats.visibleBalls = ballVisibleCount;
    updateNotice();
    if (uiVisible) renderHud();
  }
  requestAnimationFrame(frame);
}

function dpr() {
  return Math.min(window.devicePixelRatio || 1, 1.5);
}

function renderHud() {
  const pose = stats.poseMs === null ? '—' : `${stats.poseMs.toFixed(1)} ms`;
  const e2e = stats.e2eMs === null ? '—' : `${stats.e2eMs.toFixed(0)} ms`;
  const person = !stats.present ? 'none (default figure)' : stats.partial ? `partial, ${stats.visibleBalls} balls` : 'full';
  hud.textContent = [
    `source  ${stats.source}${useFixture ? `/${fixtureMode}` : ''}${stats.error ? `  (${stats.error})` : ''}`,
    `pose    ${pose}  delegate ${stats.delegate ?? '—'}  ${stats.poseLive ? 'live' : 'none'}`,
    `person  ${person}`,
    `fps     ${stats.fps.toFixed(0)}`,
    `e2e     ${e2e}  (capture→display, avg 30)`,
    `gl      ${stats.renderer ?? '—'}`,
  ].join('\n');
}

window.__dots = {
  get stats() {
    return {
      source: stats.source,
      fixtureMode: useFixture ? fixtureMode : null,
      delegate: stats.delegate,
      renderer: stats.renderer,
      poseMs: stats.poseMs,
      poseCount: stats.poseCount,
      poseLive: stats.poseLive,
      present: stats.present,
      partial: stats.partial,
      unseen: stats.unseen,
      visibleBalls: stats.visibleBalls,
      fps: stats.fps,
      e2eMs: stats.e2eMs,
      frames: stats.frames,
      error: stats.error,
      particles: PARTICLE_COUNT,
      fixtureClock: useFixture ? fixtureClock(performance.now()) : null,
      partFadeInS: PART_FADE_IN_S,
      partFadeOutS: PART_FADE_OUT_S,
      partOnHoldS: PART_ON_HOLD_S,
      partOffHoldS: PART_OFF_HOLD_S,
    };
  },
};

/** Debug probe: mean screen position of body particles against the mean of the live joints, in pixels. */
function probe() {
  const { J, view } = lastJoints ?? { J: {}, view: currentView() };
  const toPx = (x, y) => [view.W / 2 + (x - view.cx) * view.S, view.H / 2 + (y - view.cy) * view.S];
  const jp = Object.values(J).map((p) => toPx(p.x, p.y));
  const body = [];
  for (let i = 0; i < particles.count; i++) {
    if (particles.kind[i] !== 0 && particles.wgt[i] > 0.5) body.push(toPx(particles.x[i], particles.y[i]));
  }
  const mean = (a) => a.reduce((acc, p) => [acc[0] + p[0] / a.length, acc[1] + p[1] / a.length], [0, 0]);
  return { joints: jp.length, jointMean: jp.length ? mean(jp) : null, bodyMean: body.length ? mean(body) : null, attach: particles.attach, scale: particles.scale, W: view.W, H: view.H };
}

window.__dots.probe = probe;
window.__dots.rawScores = () => (lastRawPose ?? []).map((p, i) => (p ? [i, +p.v.toFixed(2), +p.pr.toFixed(2)] : null)).filter((x) => x && [0, 11, 12, 13, 14, 15, 16, 23, 24].includes(x[0]));
// Debug: per-ball visibility target and weight, for the first MAJOR balls (read-only).
window.__dots.balls = () => ({
  tv: Array.from(particles.tv.subarray(0, 40)),
  wgt: Array.from(particles.wgt.subarray(0, 40)).map((v) => Number(v.toFixed(3))),
  partProg: { ...particles.partProg },
  attach: particles.attach,
  scale: particles.scale,
});
window.__dots.parts = () => visibility.partsDebug(performance.now() / 1000);
requestAnimationFrame(frame);
