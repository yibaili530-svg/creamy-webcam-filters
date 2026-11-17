# Dots

A small, in-browser sketch: your webcam pose becomes a figure of soft and crisp
light dots that keep breathing even when you stand still. Only the body parts
the pose model can see are drawn. When a part is lost, the whole group fades
out together, so brief detection dropouts do not make the figure flicker.

Everything runs locally in your browser. The camera feed is never uploaded.

## How it works

- **Skeleton only, no silhouette model.** The only detector is MediaPipe Pose Landmarker lite (33 keypoints). I don't fake a pixel-accurate outline; the whole-body feel is built from the skeleton.
- **Volume from the skeleton.** Each orb is anchored along a limb, slightly off the bone, or across the torso between shoulders and hips. Overlapping orbs fill out the head, chest, arms and legs, so it reads as a body, not a stick figure.
- **Sized to the person.** Orb sizes are in shoulder widths (estimated from the ears or eyes when the shoulders are out of frame), so the figure keeps its proportions at any distance.
- **Smooth, with a little weight.** Joints go through a One Euro filter (heavier at rest, lighter when moving) with at most 50 ms of lookahead, and orbs follow them on springs instead of snapping.
- **Stable over twitchy.** Body parts (head, torso, each arm, hand and leg) appear and disappear as groups: a part must be detected for 280 ms to fade in (450 ms) and missing for 700 ms to fade out (650 ms). Brief dropouts keep the last pose, so a jittery landmark never flickers the figure.
- **Alive when still.** Most orbs are soft, a few small-to-medium ones stay crisp, and every orb breathes in size, colour and softness on its own rhythm.

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
