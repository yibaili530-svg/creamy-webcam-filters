// Persistent particles, drawn as soft overlapping balls. Positions live in "world" units: the camera frame's
// height is 1, x runs 0 .. FRAME_ASPECT. Screen mapping is done per frame so the figure stays round on any viewport.
//
// Two roles:
//   MAJOR   (MAJOR_SPECS.length, about 31) the figure. Each ball is bound to a point on a body part (torso,
//           head, upper and lower arm, thigh and shin). Parts get 2 to 4 balls that overlap and interpenetrate,
//           so the figure reads as one soft organism, not a stack of joint blocks.
//   AMBIENT (the rest) drift in the window and are never drawn. Nothing else is drawn: no minor specks.

import { DOT_PALETTE, FRAME_ASPECT, POSE, STAGE_FILL, PART_FADE_IN_S, PART_FADE_OUT_S, BODY_PART_NAMES } from './config.js';

export const KIND = { AMBIENT: 0, MAJOR: 2 };

export const PARTICLE_COUNT = 1600;

// ---- Body anchors. Each takes the joint map J and the shoulder width sw (world units), and writes into `o`.
// Returns false when a joint it needs is missing.

/** Tags an anchor with the joints it reads, so a ball is shown only when all of them are visible. */
const withNeeds = (needs, fn) => {
  fn.needs = needs;
  return fn;
};

/**
 * A point on the segment a -> b at fraction `t`, pushed `side` shoulder widths along the bone's normal and
 * `along` shoulder widths along the bone. Side and along give the balls a little scatter across the limb.
 */
const seg = (a, b, t, side = 0, along = 0) => withNeeds([a, b], (J, sw, o) => {
  const A = J[a];
  const B = J[b];
  if (!A || !B) return false;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.max(1e-4, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  o.x = A.x + dx * t + (-uy * side + ux * along) * sw;
  o.y = A.y + dy * t + (ux * side + uy * along) * sw;
  return true;
});

/** A point inside the torso quad: s across the shoulder line (0 left .. 1 right), t from shoulders (0) to hips (1). */
const torso = (s, t) => withNeeds([POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP], (J, sw, o) => {
  const ls = J[POSE.L_SHOULDER];
  const rs = J[POSE.R_SHOULDER];
  const lh = J[POSE.L_HIP];
  const rh = J[POSE.R_HIP];
  if (!ls || !rs || !lh || !rh) return false;
  const tx = ls.x + (rs.x - ls.x) * s;
  const ty = ls.y + (rs.y - ls.y) * s;
  const bx = lh.x + (rh.x - lh.x) * s;
  const by = lh.y + (rh.y - lh.y) * s;
  o.x = tx + (bx - tx) * t;
  o.y = ty + (by - ty) * t;
  return true;
});

/** Head: an offset (in shoulder widths) from the nose. */
const head = (dx, dy) => withNeeds([POSE.NOSE], (J, sw, o) => {
  const n = J[POSE.NOSE];
  if (!n) return false;
  o.x = n.x + dx * sw;
  o.y = n.y + dy * sw;
  return true;
});

/** Hand: at the wrist only, so a hand still shows when the shoulders and elbows are out of frame. */
const hand = (id) => withNeeds([id], (J, sw, o) => {
  const w = J[id];
  if (!w) return false;
  o.x = w.x;
  o.y = w.y;
  return true;
});

/** The neck: halfway between the nose and the shoulder midpoint. */
const neck = withNeeds([POSE.NOSE, POSE.L_SHOULDER, POSE.R_SHOULDER], (J, sw, o) => {
  const n = J[POSE.NOSE];
  const ls = J[POSE.L_SHOULDER];
  const rs = J[POSE.R_SHOULDER];
  if (!n || !ls || !rs) return false;
  o.x = (n.x + (ls.x + rs.x) / 2) / 2;
  o.y = (n.y + (ls.y + rs.y) / 2) / 2;
  return true;
});

/**
 * The figure. `r` is the ball's sprite radius in shoulder widths. `group` names the liveness group (see
 * computeBallVisibility) that gates it. Torso balls overlap heavily so the shoulders and waist melt together.
 */
export const MAJOR_SPECS = [
  // Head: a large crown, a jaw, and a neck ball. The shoulder-line balls at the end of the head group sit on the
  // shoulders, so the head melts into them instead of stopping at a clean neck.
  { group: 'head', r: 0.30, pos: head(0, -0.13), hue: 0 },    // teal crown
  { group: 'head', r: 0.24, pos: head(0.05, 0.02), hue: 1 },  // orange cheek
  { group: 'head', r: 0.20, pos: head(-0.06, 0.10), hue: 7 }, // cream jaw
  { group: 'torso', r: 0.18, pos: neck, hue: 3 },             // blue neck, with the torso so it is not a stray ball
  { group: 'torso', r: 0.22, pos: torso(0.20, 0), hue: 4 },   // magenta, on the left shoulder
  { group: 'torso', r: 0.22, pos: torso(0.80, 0), hue: 2 },   // red, on the right shoulder
  // Torso: a wide shoulder band, a centre ball, and a hip pair. Balls overlap only at their edges, so the
  // hues stay distinct instead of mixing into one muddy patch.
  { group: 'torso', r: 0.30, pos: torso(0.14, 0.10) },
  { group: 'torso', r: 0.30, pos: torso(0.86, 0.10) },
  { group: 'torso', r: 0.40, pos: torso(0.50, 0.45) },
  { group: 'torso', r: 0.28, pos: torso(0.28, 0.92) },
  { group: 'torso', r: 0.28, pos: torso(0.72, 0.92) },
  { group: 'torso', r: 0.26, pos: torso(0.30, 0.62) },
  { group: 'torso', r: 0.26, pos: torso(0.70, 0.62) },
  // Left arm: deltoid, two upper-arm balls on either side of the bone, forearm, wrist.
  { group: 'armL', r: 0.26, pos: seg(POSE.L_SHOULDER, POSE.L_ELBOW, 0.0, 0, 0) },
  // Outer and inner upper-arm balls, both sides of the bone, so the arm reads wider and reaches out and down.
  { group: 'armL', r: 0.22, pos: seg(POSE.L_SHOULDER, POSE.L_ELBOW, 0.5, 0.13, 0) },
  { group: 'armL', r: 0.22, pos: seg(POSE.L_SHOULDER, POSE.L_ELBOW, 0.5, -0.13, 0) },
  { group: 'armL', r: 0.20, pos: seg(POSE.L_ELBOW, POSE.L_WRIST, 0.25, 0.01, 0) },
  { group: 'armL', r: 0.18, pos: seg(POSE.L_ELBOW, POSE.L_WRIST, 0.70, -0.01, 0) },
  { group: 'armL', r: 0.20, pos: seg(POSE.L_ELBOW, POSE.L_WRIST, 0.0, 0, 0) },
  { group: 'armL', r: 0.16, pos: seg(POSE.L_ELBOW, POSE.L_WRIST, 1.0, 0, 0) },
  { group: 'handL', r: 0.20, pos: hand(POSE.L_WRIST) },
  // Right arm.
  { group: 'armR', r: 0.26, pos: seg(POSE.R_SHOULDER, POSE.R_ELBOW, 0.0, 0, 0) },
  { group: 'armR', r: 0.22, pos: seg(POSE.R_SHOULDER, POSE.R_ELBOW, 0.5, 0.13, 0) },
  { group: 'armR', r: 0.22, pos: seg(POSE.R_SHOULDER, POSE.R_ELBOW, 0.5, -0.13, 0) },
  { group: 'armR', r: 0.20, pos: seg(POSE.R_ELBOW, POSE.R_WRIST, 0.25, -0.01, 0) },
  { group: 'armR', r: 0.18, pos: seg(POSE.R_ELBOW, POSE.R_WRIST, 0.70, 0.01, 0) },
  { group: 'armR', r: 0.20, pos: seg(POSE.R_ELBOW, POSE.R_WRIST, 0.0, 0, 0) },
  { group: 'armR', r: 0.16, pos: seg(POSE.R_ELBOW, POSE.R_WRIST, 1.0, 0, 0) },
  { group: 'handR', r: 0.20, pos: hand(POSE.R_WRIST) },
  // Legs: thigh (two balls), shin (two balls).
  { group: 'legL', r: 0.30, pos: seg(POSE.L_HIP, POSE.L_KNEE, 0.25, 0, 0) },
  { group: 'legL', r: 0.27, pos: seg(POSE.L_HIP, POSE.L_KNEE, 0.7, 0.01, 0) },
  { group: 'legL', r: 0.22, pos: seg(POSE.L_KNEE, POSE.L_ANKLE, 0.3, 0, 0) },
  { group: 'legL', r: 0.20, pos: seg(POSE.L_KNEE, POSE.L_ANKLE, 0.8, 0, 0) },
  { group: 'legL', r: 0.25, pos: seg(POSE.L_HIP, POSE.L_KNEE, 0.45, -0.03, 0) },
  { group: 'legL', r: 0.21, pos: seg(POSE.L_KNEE, POSE.L_ANKLE, 0.55, 0.02, 0) },
  { group: 'legR', r: 0.30, pos: seg(POSE.R_HIP, POSE.R_KNEE, 0.25, 0, 0) },
  { group: 'legR', r: 0.27, pos: seg(POSE.R_HIP, POSE.R_KNEE, 0.7, -0.01, 0) },
  { group: 'legR', r: 0.22, pos: seg(POSE.R_KNEE, POSE.R_ANKLE, 0.3, 0, 0) },
  { group: 'legR', r: 0.20, pos: seg(POSE.R_KNEE, POSE.R_ANKLE, 0.8, 0, 0) },
  { group: 'legR', r: 0.25, pos: seg(POSE.R_HIP, POSE.R_KNEE, 0.45, 0.03, 0) },
  { group: 'legR', r: 0.21, pos: seg(POSE.R_KNEE, POSE.R_ANKLE, 0.55, -0.02, 0) },
];

const SPEC_COUNT = MAJOR_SPECS.length;

// Spring and damping. k is stiffness (1/s²); damping 2·0.9·sqrt(k) keeps motion slightly under critical.
// Balls are stiff enough that the figure reads at once and the arms follow the wrist, soft enough to keep weight.
const K_MAJOR = 90;
const K_LOST = 6;
const K_AMBIENT = 2;
const ATTACH_RATE = 1.5;   // per second: body attach eases in and out over ~0.7 s
const SCALE_RATE = 3;      // per second: the shoulder-width scale eases toward the measured value
const SCALE_DEFAULT = 0.16;
// Per-ball scatter, in shoulder widths. Fixed for life, so the layout is stable but no two balls sit on a grid.
const JITTER = 0.025;

function rand(seedBase) {
  // Deterministic per index, so a reload gives the same layout.
  let s = (seedBase * 2654435761) >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function createParticles(count = PARTICLE_COUNT, seed = 7) {
  const r = rand(seed);
  const p = {
    count,
    x: new Float32Array(count), y: new Float32Array(count),
    vx: new Float32Array(count), vy: new Float32Array(count),
    tx: new Float32Array(count), ty: new Float32Array(count), // last body target, reused while a joint is missing
    hx: new Float32Array(count), hy: new Float32Array(count), // ambient home, in [0,1]² of the visible window
    kind: new Uint8Array(count),
    spec: new Uint8Array(count),  // MAJOR: index into MAJOR_SPECS
    jx: new Float32Array(count), jy: new Float32Array(count), // fixed scatter, shoulder widths
    light: new Float32Array(count),
    phase: new Float32Array(count),
    seed: new Float32Array(count),  // fixed per ball, in [0,1): drives the shader's breathing, hue drift and dropout
    wgt: new Float32Array(count),   // MAJOR: eased visibility weight 0..1, shared by every ball in a part
    tv: new Uint8Array(count),      // MAJOR: visibility target this frame (1 = shown), set from the part, not per ball
    partProg: Object.fromEntries(BODY_PART_NAMES.map((n) => [n, 0])), // linear 0..1 progress per part; wgt = ease(this)
    g1: new Float32Array(count), g2: new Float32Array(count),
    rel: new Float32Array(count), // radius, in shoulder widths
    col: new Float32Array(count * 3),
    attach: 0,
    scale: SCALE_DEFAULT,
    ox: 0.5 * FRAME_ASPECT, oy: 0.5, // figure centre: where body balls grow out of
  };
  for (let i = 0; i < count; i++) {
    const kind = i < SPEC_COUNT ? KIND.MAJOR : KIND.AMBIENT;
    p.kind[i] = kind;
    p.spec[i] = i < SPEC_COUNT ? i : 0;
    p.light[i] = r();
    p.phase[i] = r() * Math.PI * 2;
    // Golden-ratio spread: neighbouring indices get far-apart seeds, so their breathing is not in step.
    p.seed[i] = (i * 0.618034 + 0.137) % 1;
    // Box-Muller pair: two independent normal draws per particle, fixed for life.
    const u1 = Math.max(1e-6, r());
    const u2 = r();
    const mag = Math.sqrt(-2 * Math.log(u1));
    p.g1[i] = mag * Math.cos(2 * Math.PI * u2);
    p.g2[i] = mag * Math.sin(2 * Math.PI * u2);
    p.jx[i] = JITTER * (2 * r() - 1);
    p.jy[i] = JITTER * (2 * r() - 1);
    const shade = 0.8 + 0.2 * p.light[i];
    // Stride 3 over the ten colours: neighbouring balls take different hues, so the parts stay countable.
    const hue = kind === KIND.MAJOR ? MAJOR_SPECS[p.spec[i]].hue : undefined;
    const pal = DOT_PALETTE[hue ?? (i * 3) % DOT_PALETTE.length];
    if (kind === KIND.MAJOR) p.rel[i] = MAJOR_SPECS[p.spec[i]].r * (0.92 + 0.16 * p.light[i]);
    p.col[i * 3] = pal[0] * shade;
    p.col[i * 3 + 1] = pal[1] * shade;
    p.col[i * 3 + 2] = pal[2] * shade;
    p.hx[i] = r();
    p.hy[i] = r();
    p.x[i] = p.hx[i];
    p.y[i] = p.hy[i];
    // Until a ball has a target, it waits at the figure centre, never at the origin (the old corner stray).
    p.tx[i] = p.ox;
    p.ty[i] = p.oy;
  }
  return p;
}

/**
 * Visible window in world units for the current viewport. `S` is pixels per world unit, `W`, `H` are the
 * canvas size in pixels. The frame is centred, so the window is centred at (FRAME_ASPECT/2, 0.5).
 */
export function stageMapping(W, H) {
  const S = H * STAGE_FILL;
  return { S, W, H, cx: FRAME_ASPECT / 2, cy: 0.5, hw: W / 2 / S, hh: H / 2 / S };
}

/**
 * Body target in world units for ball i, from this frame's joints, written to `out`. Returns the liveness of
 * its group, or null when a joint it needs is missing (the caller then keeps the last target).
 */
function bodyTarget(i, p, J, out) {
  const spec = MAJOR_SPECS[p.spec[i]];
  if (!spec.pos(J, p.scale, out)) return false;
  // Fixed scatter, then a slow wobble so the mass never looks frozen.
  out.x += (p.jx[i] + 0.01 * Math.sin(p.phase[i])) * p.scale;
  out.y += (p.jy[i] + 0.01 * Math.cos(p.phase[i] * 1.3)) * p.scale;
  return true;
}

/**
 * Which balls may be shown this frame. Every ball in a part shares the same target, taken from the
 * part-level debounce (`partShown(group)`). Writes p.tv. Missing joints keep the last smoothed target.
 */
export function computeBallVisibility(p, partShown) {
  for (let i = 0; i < SPEC_COUNT; i++) {
    p.tv[i] = partShown(MAJOR_SPECS[i].group) ? 1 : 0;
  }
}

/**
 * Sets the weight (and the part's fade progress) to 0 at once for every hidden part. Used on the frame a
 * person first replaces the default figure: the default figure's missing legs must not fade out slowly.
 */
export function snapHiddenBalls(p) {
  const keep = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, false]));
  for (let i = 0; i < SPEC_COUNT; i++) {
    if (p.tv[i] === 0) p.wgt[i] = 0;
    else keep[MAJOR_SPECS[i].group] = true;
  }
  for (const name of BODY_PART_NAMES) {
    if (!keep[name]) p.partProg[name] = 0;
  }
}

/** Smoothstep, so a mid-way reverse eases through the same curve without a snap. */
function easePart(x) {
  return x * x * (3 - 2 * x);
}

/**
 * One physics step. `J` and `groups` come from the current frame. Ambient particles drift in the visible
 * window. Body balls spring to their target, blended toward the figure centre by `attach` so they ease in and out.
 * A group that lost its joints lowers stiffness and keeps its last target, so its balls drift instead of snapping.
 */
export function stepParticles(p, dt, t, J, frame, view) {
  const h = Math.min(dt, 1 / 30);
  const bt = { x: 0, y: 0 };
  // Attach grows the figure out of its centre once at start; it does not turn off when a person leaves,
  // because a missing part is handled by its visibility weight instead.
  p.attach = Math.min(1, p.attach + ATTACH_RATE * h);
  if (frame.sizeRef !== null) {
    const target = Math.min(0.6, Math.max(0.05, frame.sizeRef));
    p.scale += (target - p.scale) * Math.min(1, SCALE_RATE * h);
  }
  if (frame.centre) {
    // Centre of the visible joints. Body balls attach from here, so the figure grows out of itself.
    p.ox = frame.centre.x;
    p.oy = frame.centre.y;
  }
  // One progress value per part: all of that part's balls share it, so they appear and disappear together.
  const wantPart = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, 0]));
  for (let i = 0; i < SPEC_COUNT; i++) {
    if (p.tv[i]) wantPart[MAJOR_SPECS[i].group] = 1;
  }
  for (const name of BODY_PART_NAMES) {
    const target = wantPart[name];
    const cur = p.partProg[name];
    if (target > cur) p.partProg[name] = Math.min(1, cur + h / PART_FADE_IN_S);
    else if (target < cur) p.partProg[name] = Math.max(0, cur - h / PART_FADE_OUT_S);
  }
  const left = view.cx - view.hw;
  const top = view.cy - view.hh;
  for (let i = 0; i < p.count; i++) {
    const ambX = left + p.hx[i] * 2 * view.hw;
    const ambY = top + p.hy[i] * 2 * view.hh;
    let tx = ambX + 0.015 * Math.sin(t * 0.7 + p.phase[i]);
    let ty = ambY + 0.015 * Math.cos(t * 0.6 + p.g2[i]);
    let k = K_AMBIENT;
    if (p.kind[i] === KIND.MAJOR) {
      const placed = bodyTarget(i, p, J, bt);
      if (placed) {
        p.tx[i] = bt.x;
        p.ty[i] = bt.y;
      }
      // Shared eased weight. Size never follows raw landmark confidence; only this fade and shader breathing.
      p.wgt[i] = easePart(p.partProg[MAJOR_SPECS[p.spec[i]].group]);
      tx = p.ox + (p.tx[i] - p.ox) * p.attach;
      ty = p.oy + (p.ty[i] - p.oy) * p.attach;
      // Hold the last target while the part is still visible or fading; do not drift during a brief dropout.
      k = p.wgt[i] > 0.02 ? K_MAJOR : K_LOST;
    }
    const c = 2 * 0.9 * Math.sqrt(k);
    // Slow noise keeps the figure alive; lost balls get more of it, so they drift instead of freezing.
    const amp = k === K_LOST ? 0.3 : 0.12;
    const nx = amp * Math.sin(t * 1.3 + p.phase[i] * 2.0);
    const ny = amp * Math.cos(t * 1.1 + p.g1[i]);
    p.vx[i] += (k * (tx - p.x[i]) - c * p.vx[i] + nx) * h;
    p.vy[i] += (k * (ty - p.y[i]) - c * p.vy[i] + ny) * h;
    p.x[i] += p.vx[i] * h;
    p.y[i] += p.vy[i] * h;
  }
}

/**
 * Writes per-instance data for the renderer, 8 floats each: centre x, y (px), radius (px), colour r, g, b, depth (0..1),
 * seed. Only the figure's balls are written, and only while attached: nothing else is drawn. Breathing, hue drift and
 * dropout are evaluated in the shader from `seed` and time, so no per-ball trig runs here. Returns the count.
 */
export const INSTANCE_FLOATS = 8;

export function fillInstances(p, view, out) {
  const { S, W, H, cx, cy } = view;
  let n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.kind[i] !== KIND.MAJOR) continue;
    // Radius: shoulder-width scale × role radius × body attach × the part's fade weight (not raw visibility).
    const radius = p.rel[i] * p.scale * p.attach * p.wgt[i];
    if (radius * S < 0.5) continue;
    const o = n * INSTANCE_FLOATS;
    out[o] = W / 2 + (p.x[i] - cx) * S;
    out[o + 1] = H / 2 + (p.y[i] - cy) * S;
    out[o + 2] = radius * S;
    out[o + 3] = p.col[i * 3];
    out[o + 4] = p.col[i * 3 + 1];
    out[o + 5] = p.col[i * 3 + 2];
    // Depth from the per-particle `light` (fixed for life): larger means nearer, so it covers the balls behind.
    out[o + 6] = 0.55 + 0.45 * p.light[i];
    out[o + 7] = p.seed[i];
    n++;
  }
  return n;
}
