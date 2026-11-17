// Synthetic moving person, drawn to a canvas. It is fed to the same pose worker as the camera, so the pose
// pipeline is real; only the pixels are synthetic. Walking and a waving arm, so the frames differ.
//
// The figure is drawn in a 1280x720 frame (the camera size). Coordinates below are in frame-height units with
// the origin at the frame centre, y down.
//
// Modes (?fixtureMode=...):
//   full       the whole figure (default)
//   headhands  drawn as the full figure so the detector locks a person; fixtureKeep then passes only the
//              head (eyes, ears, nose) and the wrists and elbows to the dots. The body is drawn but never reported.
//   half       upper body: head, shoulders, arms, torso. No legs. Arms drawn thicker so the detector reads the elbows.
//   fade       full figure, except the left arm is taken away from FADE_OFF_S to FADE_ON_S (fixture clock).

import { POSE } from './config.js';

export const FIXTURE_W = 1280;
export const FIXTURE_H = 720;
export const FIXTURE_MODES = ['full', 'headhands', 'half', 'fade'];
// The fade window sits after the pose has settled (about 12 to 13 s on the fixture clock), so it is captured.
export const FADE_OFF_S = 20;
export const FADE_ON_S = 28;
const HALF_ARM_SCALE = 1.45;
const SKIN = '#2b2f3d';
const BG = '#d8d6d0';
const FULL_ZOOM = 0.82;

function pt(ux, uy) {
  return { x: FIXTURE_W / 2 + ux * FIXTURE_H, y: FIXTURE_H / 2 + uy * FIXTURE_H };
}

/** Joints of the fixture figure at time `t` (seconds), in pixel coordinates of the fixture canvas. */
export function fixtureJoints(t) {
  const walk = Math.sin(t * 2.2);
  const sway = 0.02 * Math.sin(t * 1.1);
  const bob = 0.01 * Math.abs(walk);
  const hipY = 0.10 + bob;
  const hipL = [-0.05 + sway, hipY];
  const hipR = [0.05 + sway, hipY];
  const shY = hipY - 0.30;
  const shL = [-0.08 + sway, shY];
  const shR = [0.08 + sway, shY];
  const legSwing = 0.32 * walk;
  const kneeL = [hipL[0] + 0.22 * Math.sin(legSwing), hipL[1] + 0.22 * Math.cos(legSwing) ];
  const ankleL = [kneeL[0] + 0.22 * Math.sin(legSwing * 0.4 - 0.15), kneeL[1] + 0.22 * Math.cos(legSwing * 0.4 - 0.15)];
  const kneeR = [hipR[0] + 0.22 * Math.sin(-legSwing), hipR[1] + 0.22 * Math.cos(-legSwing)];
  const ankleR = [kneeR[0] + 0.22 * Math.sin(-legSwing * 0.4 - 0.15), kneeR[1] + 0.22 * Math.cos(-legSwing * 0.4 - 0.15)];
  // Left arm hangs and swings; right arm waves up and down.
  const armL = 0.25 * Math.sin(t * 2.2 + Math.PI);
  const elbowL = [shL[0] + 0.15 * Math.sin(armL), shL[1] + 0.15 * Math.cos(armL)];
  const wristL = [elbowL[0] + 0.14 * Math.sin(armL * 0.6), elbowL[1] + 0.14 * Math.cos(armL * 0.6)];
  const waveR = -1.1 + 0.6 * Math.sin(t * 3.0);
  const elbowR = [shR[0] + 0.15 * Math.sin(0.8), shR[1] + 0.15 * Math.cos(0.8)];
  const wristR = [elbowR[0] + 0.14 * Math.sin(waveR), elbowR[1] + 0.14 * Math.cos(waveR)];
  const nose = [sway * 1.2, shY - 0.20];
  return {
    nose: pt(...nose),
    shL: pt(...shL), shR: pt(...shR),
    elbowL: pt(...elbowL), elbowR: pt(...elbowR),
    wristL: pt(...wristL), wristR: pt(...wristR),
    hipL: pt(...hipL), hipR: pt(...hipR),
    kneeL: pt(...kneeL), kneeR: pt(...kneeR),
    ankleL: pt(...ankleL), ankleR: pt(...ankleR),
  };
}

/**
 * Default standing figure for when no person is detected: the fixture's joints at rest (t = 0, no walk, no sway),
 * keyed by MediaPipe index and converted to the tracker's world units (frame height = 1, y down).
 */
export function restJointsWorld() {
  const j = fixtureJoints(0);
  const w = (p) => ({ x: p.x / FIXTURE_H, y: p.y / FIXTURE_H });
  return {
    [POSE.NOSE]: w(j.nose),
    [POSE.L_SHOULDER]: w(j.shL), [POSE.R_SHOULDER]: w(j.shR),
    [POSE.L_ELBOW]: w(j.elbowL), [POSE.R_ELBOW]: w(j.elbowR),
    [POSE.L_WRIST]: w(j.wristL), [POSE.R_WRIST]: w(j.wristR),
    [POSE.L_HIP]: w(j.hipL), [POSE.R_HIP]: w(j.hipR),
    [POSE.L_KNEE]: w(j.kneeL), [POSE.R_KNEE]: w(j.kneeR),
    [POSE.L_ANKLE]: w(j.ankleL), [POSE.R_ANKLE]: w(j.ankleR),
  };
}

/**
 * MediaPipe indices of the joints the fixture draws at time `t` in `mode`. Pose results for other indices are
 * masked to not-visible (see maskPose), so a guess for the empty part of the frame never reaches the dots.
 */
export function fixtureKeep(mode, t) {
  const all = [POSE.NOSE, POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST,
    POSE.L_HIP, POSE.R_HIP, POSE.L_KNEE, POSE.R_KNEE, POSE.L_ANKLE, POSE.R_ANKLE];
  // Eyes and ears size the figure (see sizeFrom in main.js); nose, elbows and wrists carry the head and hands.
  if (mode === 'headhands') {
    return new Set([POSE.NOSE, POSE.L_EYE, POSE.R_EYE, POSE.L_EAR, POSE.R_EAR,
      POSE.L_ELBOW, POSE.R_ELBOW, POSE.L_WRIST, POSE.R_WRIST]);
  }
  if (mode === 'half') return new Set(all.filter((i) => i <= POSE.R_HIP));
  if (mode === 'fade' && t >= FADE_OFF_S && t < FADE_ON_S) {
    return new Set(all.filter((i) => i !== POSE.L_ELBOW && i !== POSE.L_WRIST));
  }
  return new Set(all);
}

function limb(ctx, a, b, width) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Draws the figure into `ctx` (a 1280x720 2D context) at time `t` (seconds) in `mode`. */
export function drawFixture(ctx, t, mode = 'full') {
  const j = fixtureJoints(t);
  const legs = mode !== 'half';
  const armW = mode === 'half' ? HALF_ARM_SCALE : 1;
  const leftArmGone = mode === 'fade' && t >= FADE_OFF_S && t < FADE_ON_S;
  ctx.save();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, FIXTURE_W, FIXTURE_H);
  ctx.strokeStyle = SKIN;
  ctx.fillStyle = SKIN;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Every mode is drawn at the same framing as the full figure: a cropped body (1.3x zoom) leaves the detector
  // with low elbow and wrist scores, so the hands never pass PART_HI. The feet land inside the frame.
  {
    const ox = FIXTURE_W / 2;
    const oy = FIXTURE_H / 2;
    ctx.translate(ox, oy);
    ctx.scale(FULL_ZOOM, FULL_ZOOM);
    ctx.translate(-ox, -oy);
  }

  // Limbs first, so the torso covers their roots.
  if (!leftArmGone) limb(ctx, j.shL, j.elbowL, 0.07 * armW * FIXTURE_H);
  if (!leftArmGone) limb(ctx, j.elbowL, j.wristL, 0.055 * armW * FIXTURE_H);
  limb(ctx, j.shR, j.elbowR, 0.07 * armW * FIXTURE_H);
  limb(ctx, j.elbowR, j.wristR, 0.055 * armW * FIXTURE_H);
  // Palms: a round hand at each wrist. The detector scores bare wrists very low, so the hand gives it a shape to find.
  for (const w of [j.wristL, j.wristR]) {
    ctx.beginPath();
    ctx.arc(w.x, w.y, 0.05 * FIXTURE_H, 0, Math.PI * 2);
    ctx.fill();
  }
  if (legs) {
    limb(ctx, j.hipL, j.kneeL, 0.10 * FIXTURE_H);
    limb(ctx, j.kneeL, j.ankleL, 0.07 * FIXTURE_H);
    limb(ctx, j.hipR, j.kneeR, 0.10 * FIXTURE_H);
    limb(ctx, j.kneeR, j.ankleR, 0.07 * FIXTURE_H);
  }

  // Torso: shoulders to hips, with a little width.
  ctx.lineWidth = 0.14 * FIXTURE_H;
  ctx.beginPath();
  ctx.moveTo(j.shL.x, j.shL.y);
  ctx.lineTo(j.shR.x, j.shR.y);
  ctx.lineTo(j.hipR.x, j.hipR.y);
  ctx.lineTo(j.hipL.x, j.hipL.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Head.
  ctx.beginPath();
  ctx.ellipse(j.nose.x, j.nose.y - 0.02 * FIXTURE_H, 0.06 * FIXTURE_H, 0.075 * FIXTURE_H, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return j;
}
