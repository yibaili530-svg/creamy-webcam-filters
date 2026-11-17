// Visibility state from the raw pose samples. Per-joint hysteresis still decides which joints count as
// seen (for size, centre, and a weak wrist). Orb show/hide is decided per body part: hysteresis, then a
// time debounce, so a brief dropout does not blink the figure. Joint positions still come from the
// tracker (joints.js), which is unchanged.

import {
  PART_HI, PART_LO, HAND_HI, HAND_LO, HAND_HOLD_S,
  PART_ON_HOLD_S, PART_OFF_HOLD_S, BODY_PARTS, BODY_PART_NAMES, POSE,
} from './config.js';

const HANDS = new Set([POSE.L_WRIST, POSE.R_WRIST]);

function landmarkScore(pose, id) {
  const p = pose?.[id];
  return p && Number.isFinite(p.v) && Number.isFinite(p.pr) ? Math.min(p.v, p.pr) : 0;
}

export function createVisibility(ids) {
  const on = new Map(ids.map((id) => [id, false]));
  const lastOn = new Map(ids.map((id) => [id, -Infinity]));

  const raw = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, false]));
  const rawSince = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, 0]));
  const missSince = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, 0]));
  const shown = Object.fromEntries(BODY_PART_NAMES.map((n) => [n, false]));

  function partRawNow(pose, name, wasRaw) {
    const spec = BODY_PARTS[name];
    const hi = spec.hand ? HAND_HI : PART_HI;
    const lo = spec.hand ? HAND_LO : PART_LO;
    const gate = wasRaw ? lo : hi;
    let n = 0;
    for (const id of spec.ids) {
      if (landmarkScore(pose, id) >= gate) n++;
    }
    return n >= spec.min;
  }

  return {
    /**
     * Feeds one raw pose sample (33 entries of {v, pr}, or null when no person was found) at time `t` seconds.
     * Wrists use lower thresholds, and a wrist that was on stays on for HAND_HOLD_S after its score drops.
     * Body parts use the same score gate, then must stay present for PART_ON_HOLD_S before they appear, and
     * stay missing for PART_OFF_HOLD_S before they start fading.
     */
    update(pose, t = 0) {
      for (const id of ids) {
        const score = landmarkScore(pose, id);
        const was = on.get(id);
        const hand = HANDS.has(id);
        const hi = hand ? HAND_HI : PART_HI;
        const lo = hand ? HAND_LO : PART_LO;
        // Only a real detection refreshes the timer; a held state runs out HAND_HOLD_S after the last one.
        const real = was ? score >= lo : score >= hi;
        if (real) lastOn.set(id, t);
        const held = hand && was && t - lastOn.get(id) < HAND_HOLD_S;
        on.set(id, real || held);
      }

      for (const name of BODY_PART_NAMES) {
        const nowRaw = partRawNow(pose, name, raw[name]);
        if (nowRaw) {
          if (!raw[name]) rawSince[name] = t;
          raw[name] = true;
          if (!shown[name] && t - rawSince[name] >= PART_ON_HOLD_S) shown[name] = true;
        } else {
          if (raw[name]) missSince[name] = t;
          raw[name] = false;
          if (shown[name] && t - missSince[name] >= PART_OFF_HOLD_S) shown[name] = false;
        }
      }
    },
    isOn: (id) => on.get(id) === true,
    anyOn: () => ids.some((id) => on.get(id) === true),
    isPartShown: (name) => shown[name] === true,
    /** Debug: raw and shown flags plus how long the current raw/miss streak has lasted. */
    partsDebug(t = 0) {
      const out = {};
      for (const name of BODY_PART_NAMES) {
        out[name] = {
          raw: raw[name],
          shown: shown[name],
          rawFor: raw[name] ? t - rawSince[name] : 0,
          missFor: raw[name] ? 0 : (shown[name] || missSince[name] ? t - missSince[name] : 0),
        };
      }
      return out;
    },
  };
}

/**
 * Fixture only: zeroes visibility for joints the fixture did not draw (or is hiding on purpose), so MediaPipe's
 * guesses for the empty part of the frame never reach the dots. `keep` is the set of MediaPipe indices drawn now.
 */
export function maskPose(pose, keep) {
  if (!pose) return pose;
  return pose.map((p, i) => (keep.has(i) ? p : { ...p, v: 0, pr: 0 }));
}
