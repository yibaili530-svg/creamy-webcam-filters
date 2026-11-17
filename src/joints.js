// Joint stream for the attractors: One Euro smoothing per joint axis, linear interpolation between the last
// two inference samples, and a constant-velocity lookahead of at most 50 ms with gain 0.5 (below 0.65).
// Samples older than 100 ms at render time are not extrapolated: the joint holds its last value.
// Particles never predict; they only follow these joints through springs.

import { OneEuro } from './one-euro.js';
import { POSE, POSE_GATE } from './config.js';

export const JOINT_IDS = [
  POSE.NOSE,
  // Eyes and ears: tracked only to size the figure when the shoulders are out of frame. Their filters are the same.
  POSE.L_EYE, POSE.R_EYE, POSE.L_EAR, POSE.R_EAR,
  POSE.L_SHOULDER, POSE.R_SHOULDER,
  POSE.L_ELBOW, POSE.R_ELBOW,
  POSE.L_WRIST, POSE.R_WRIST,
  POSE.L_HIP, POSE.R_HIP,
  POSE.L_KNEE, POSE.R_KNEE,
  POSE.L_ANKLE, POSE.R_ANKLE,
];

export const LOOKAHEAD_MAX_S = 0.05;
export const LOOKAHEAD_GAIN = 0.5;
export const PREDICT_MAX_AGE_S = 0.1;
/** A joint not seen for this long is treated as lost. Sized for slow devices: a pose sample can arrive about 1 s apart. */
export const LOST_AFTER_S = 1.5;

function makeJoint() {
  return {
    fx: new OneEuro({ minCutoff: 1.0, beta: 2.0 }),
    fy: new OneEuro({ minCutoff: 1.0, beta: 2.0 }),
    t0: 0, x0: 0, y0: 0, // previous sample
    t1: 0, x1: 0, y1: 0, // latest sample
    vx: 0, vy: 0,        // velocity of the last interval
    seen: false,         // has ever been visible
    lastSeen: -Infinity,
    visible: false,
  };
}

export function createJointTracker() {
  const joints = new Map(JOINT_IDS.map((id) => [id, makeJoint()]));

  /**
   * Feed one inference sample at `t` seconds (its arrival time, the same clock as `at` and `live`). Arrival is the
   * timeline because on a slow device the capture-to-display delay can exceed the lost threshold.
   */
  function push(t, pose) {
    for (const id of JOINT_IDS) {
      const j = joints.get(id);
      const p = pose?.[id];
      const ok = Boolean(p) && Number.isFinite(p.x) && p.v >= POSE_GATE && p.pr >= POSE_GATE;
      j.visible = ok;
      if (!ok) continue;
      const fx = j.fx.filter(t, p.x);
      const fy = j.fy.filter(t, p.y);
      if (!j.seen) {
        j.t0 = j.t1 = t;
        j.x0 = j.x1 = fx;
        j.y0 = j.y1 = fy;
        j.seen = true;
      } else {
        const dt = Math.max(1e-3, t - j.t1);
        j.t0 = j.t1;
        j.x0 = j.x1;
        j.y0 = j.y1;
        j.t1 = t;
        j.x1 = fx;
        j.y1 = fy;
        j.vx = (j.x1 - j.x0) / dt;
        j.vy = (j.y1 - j.y0) / dt;
      }
      j.lastSeen = t;
    }
  }

  /** Position of joint `id` at time `now` (seconds, arrival clock), in normalised frame coordinates. Null if never seen. */
  function at(id, now, out) {
    const j = joints.get(id);
    if (!j.seen) return null;
    let x;
    let y;
    if (now <= j.t1) {
      const span = Math.max(1e-3, j.t1 - j.t0);
      const s = Math.min(1, Math.max(0, (now - j.t0) / span));
      x = j.x0 + (j.x1 - j.x0) * s;
      y = j.y0 + (j.y1 - j.y0) * s;
    } else {
      const age = now - j.t1;
      x = j.x1;
      y = j.y1;
      if (age <= PREDICT_MAX_AGE_S) {
        const h = Math.min(age, LOOKAHEAD_MAX_S);
        x += LOOKAHEAD_GAIN * j.vx * h;
        y += LOOKAHEAD_GAIN * j.vy * h;
      }
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /** True when the joint has a sample inside LOST_AFTER_S of `now`. */
  function live(id, now) {
    return now - joints.get(id).lastSeen <= LOST_AFTER_S;
  }

  return { push, at, live, joints };
}
