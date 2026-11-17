// Shared constants. Joint indices mirror src/pose-capsules.js in the old project (MediaPipe 33-point topology).

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

/** A landmark is used only when visibility and presence both pass this gate. */
export const POSE_GATE = 0.5;

/**
 * Per-joint and per-part visibility with hysteresis (visibility and presence both). A joint or part
 * turns on at PART_HI and off only below PART_LO, so a score hovering near one threshold does not flicker.
 */
export const PART_HI = 0.6;
export const PART_LO = 0.35;
/** Wrists and palms score low on this model, so they use lower thresholds and hold their last state briefly. */
export const HAND_HI = 0.45;
export const HAND_LO = 0.2;
export const HAND_HOLD_S = 0.35;
/** A body part must stay raw-present this long before its orbs start to appear. */
export const PART_ON_HOLD_S = 0.28;
/** A body part must stay missing this long before its orbs start to fade out. Brief dropouts are ignored. */
export const PART_OFF_HOLD_S = 0.70;
/** Whole-part fade durations. Fade-out is slower than fade-in. Mid-way reversals continue from the current value. */
export const PART_FADE_IN_S = 0.45;
export const PART_FADE_OUT_S = 0.65;
/** A person counts as present for this long after the last joint was seen on, so a single missed sample does not swap in the default figure. */
export const PERSON_HOLD_S = 1.0;
/** Shoulder width ≈ 2.6 × ear-to-ear and ≈ 6 × eye-to-eye (adult proportions). Used only when the shoulders are not visible. */
export const EAR_TO_SHOULDER = 2.6;
export const EYE_TO_SHOULDER = 6.0;

export const POSE = {
  NOSE: 0,
  L_EYE: 2, R_EYE: 5,
  L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

/**
 * Landmarks that decide whether a body part is present. `min` is how many of `ids` must pass the
 * hysteresis gate (PART_HI / PART_LO, or the hand pair). Hands are gated on their own so a flickering
 * wrist does not blink the whole arm.
 */
export const BODY_PARTS = {
  head:  { ids: [POSE.NOSE], min: 1, hand: false },
  torso: { ids: [POSE.L_SHOULDER, POSE.R_SHOULDER, POSE.L_HIP, POSE.R_HIP], min: 3, hand: false },
  armL:  { ids: [POSE.L_SHOULDER, POSE.L_ELBOW, POSE.L_WRIST], min: 2, hand: false },
  armR:  { ids: [POSE.R_SHOULDER, POSE.R_ELBOW, POSE.R_WRIST], min: 2, hand: false },
  handL: { ids: [POSE.L_WRIST], min: 1, hand: true },
  handR: { ids: [POSE.R_WRIST], min: 1, hand: true },
  legL:  { ids: [POSE.L_HIP, POSE.L_KNEE, POSE.L_ANKLE], min: 2, hand: false },
  legR:  { ids: [POSE.R_HIP, POSE.R_KNEE, POSE.R_ANKLE], min: 2, hand: false },
};
export const BODY_PART_NAMES = Object.keys(BODY_PARTS);

/** Dots palette: the v2DotPal ten colours from shaders-v2.js (filter 3). */
export const DOT_PALETTE = [
  [0.10, 0.55, 0.50], // teal
  [0.95, 0.55, 0.18], // orange
  [0.90, 0.20, 0.25], // red
  [0.12, 0.35, 0.92], // blue
  [0.85, 0.18, 0.55], // magenta
  [0.92, 0.88, 0.18], // yellow
  [0.45, 0.30, 0.85], // violet
  [0.98, 0.90, 0.78], // cream
  [0.55, 0.88, 0.20], // lime
  [0.30, 0.62, 0.40], // green
];

/** Ground from v2Dots: sand at the top, grey lavender at the bottom. */
export const BG_TOP = [0.80, 0.74, 0.62];
export const BG_BOT = [0.60, 0.63, 0.72];
/** Dark variant: a near-black gradient, lavender-tinted at the top, deep navy at the bottom. Switched with B or ?bg=dark. */
export const BG_DARK_TOP = [0.11, 0.10, 0.15];
export const BG_DARK_BOT = [0.03, 0.04, 0.07];

/** Camera frames are 16:9; the stage maps the frame's height to the screen with this margin. */
export const FRAME_ASPECT = 16 / 9;
export const STAGE_FILL = 0.92;
