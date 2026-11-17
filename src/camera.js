// Real getUserMedia path. Constraints follow the old camera.js: an explicit deviceId replaces facingMode
// (the two conflict), and both carry the 1280x720 size. Audio is never requested.

export const SIZE = { width: 1280, height: 720 };

/** Without a device id: front camera. With one: that exact device. Never both. */
export function buildConstraints(deviceId) {
  const video = deviceId ? { deviceId: { exact: deviceId }, ...SIZE } : { facingMode: 'user', ...SIZE };
  return { video, audio: false };
}

export function classifyCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError': return 'missing';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError': return 'overconstrained';
    case 'NotReadableError':
    case 'TrackStartError': return 'busy';
    default: return 'other';
  }
}

const MESSAGES = {
  denied: 'Camera permission was denied. Allow access and refresh, or preview with ?fixture=1.',
  missing: 'No camera was found. You can preview a synthetic figure with ?fixture=1.',
  overconstrained: 'The camera does not support 1280×720. You can preview with ?fixture=1.',
  busy: 'The camera is in use by another app. Close it and refresh, or preview with ?fixture=1.',
  insecure: 'The browser has no mediaDevices API (https or localhost is required). You can preview with ?fixture=1.',
  other: 'Could not open the camera. You can preview a synthetic figure with ?fixture=1.',
};

export function cameraMessage(kind) {
  return MESSAGES[kind] ?? MESSAGES.other;
}

/** Opens the camera into `video` and starts playback. Returns the stream; throws a classified error. */
export async function openCamera(video, deviceId = null) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('mediaDevices unavailable');
    err.kind = 'insecure';
    throw err;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(buildConstraints(deviceId));
  } catch (err) {
    err.kind = classifyCameraError(err);
    throw err;
  }
  video.srcObject = stream;
  await video.play();
  return stream;
}
