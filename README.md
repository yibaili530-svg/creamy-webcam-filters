# Dots

A small, in-browser sketch: your webcam pose becomes a figure of soft and crisp
light dots that keep breathing even when you stand still. Only the body parts
the pose model can see are drawn. When a part is lost, the whole group fades
out together, so brief detection dropouts do not make the figure flicker.

Everything runs locally in your browser. The camera feed is never uploaded.

## How to build this

### The idea

Read the webcam, find 33 skeleton points with a pose model, then grow a body by spreading soft light dots along the bones. Keep it steady when the detector jitters, and let every dot breathe so the figure feels alive even when you stand still.

### What you need to know

- **Camera:** `navigator.mediaDevices.getUserMedia` for the webcam stream.
- **Pose detection:** MediaPipe Pose Landmarker (lite). It returns 33 landmarks per person, each with a visibility and presence score. This is the only model: no segmentation, no outline.
- **Web Worker:** inference runs off the main thread, with one frame in flight at a time, so drawing never waits for the model.
- **Smoothing:** a One Euro filter per joint smooths heavily at rest and lightly when you move.
- **WebGL2:** all dots are drawn in one instanced call. A fragment shader paints each one as a soft or crisp round orb.
- **Vite** for the dev server and build.

```
camera.js ──frames──▶ pose-client.js ──▶ pose-worker.js (Pose Landmarker)
                                              │ 33 landmarks + scores
                                              ▼
           visibility.js ◀── joints.js (one-euro.js smoothing)
     (which body parts to show)               │
                                              ▼
                                  particles.js (dots on the bones)
                                              │
                                              ▼
                                  renderer.js (WebGL2 soft orbs)
```

### How to code it

1. **Get frames.** Open the camera (`camera.js`) and send each frame as an `ImageBitmap` to a worker (`pose-client.js`).
2. **Detect the pose.** In the worker, run Pose Landmarker and post the landmarks back (`pose-worker.js`).
3. **Smooth the joints.** Filter each joint with a One Euro filter and interpolate between samples (`one-euro.js`, `joints.js`).
4. **Decide what to show.** Group joints into body parts (head, torso, arms, hands, legs). Fade a part in or out as a whole, only after it has been seen or missing for a moment (`visibility.js`).
5. **Grow the body.** Anchor a few overlapping dots to points along each limb and across the torso. Size them by shoulder width, and let them follow on springs (`particles.js`).
6. **Draw.** Upload the dots as instances. In the shader, give each one a soft feather (a few small ones stay crisp) and a breathing rhythm in size, colour and softness (`renderer.js`).

### Or ask your AI to build it

```text
Build a browser webcam sketch with Vite and WebGL2. Use only MediaPipe Pose Landmarker lite
(33 keypoints) in a Web Worker: no segmentation. Turn the skeleton into a body made of
overlapping soft light dots anchored along each limb and across the torso, sized relative to
shoulder width. Smooth joints with a One Euro filter. Show or hide whole body parts (head, torso,
arms, hands, legs) as groups, with a short debounce, so detection jitter never makes it flicker.
Most dots are soft and feathered, and a few small ones are crisp. Every dot breathes in size,
colour and softness on its own rhythm. Saturated colours on an empty gradient background.
H toggles the on-screen info and B toggles a dark background.
```

Build it in steps. Start with plain dots on the 33 joints and get them steady, then add the body volume, then tune stability and style. Check each step on camera before moving on.

## Run locally

You need Node.js 18 or newer, and a browser with WebGL2.

```bash
npm install
npm run dev
```

Then open the URL Vite prints, usually http://localhost:5173.

The camera only works on `localhost` or over HTTPS. The first visit downloads a
MediaPipe pose model and asks for camera permission.

To build a static production bundle:

```bash
npm run build
```

The output is written to `dist/`. You can preview it with `npm run preview`.

## How to use

1. Allow the camera when the browser asks.
2. Stand where your body is visible. The dots follow your pose; parts that are
   out of frame stay hidden.
3. If no person is found, a default standing figure is shown.

### Controls

| Control | What it does |
| --- | --- |
| `H`, or the **Info H** button | Show or hide the on-screen info and status text |
| `B`, or the **Dark B** button | Switch between the light and dark gradient backgrounds |

You can also set the starting state in the URL:

- `?hud=0` — start with the on-screen info hidden
- `?bg=dark` — start on the dark background
- `?fixture=1` — demo mode, using a synthetic moving figure instead of the camera (useful if you have no webcam)

These can be combined, for example `/?fixture=1&bg=dark`.

## Requirements

- A webcam, or demo mode with `?fixture=1`
- A browser that supports WebGL2
- Camera access on localhost or HTTPS
