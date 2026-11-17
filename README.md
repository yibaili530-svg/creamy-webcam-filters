# Dots

A small, in-browser sketch: your webcam pose becomes a figure of soft and crisp
light dots that keep breathing even when you stand still. Only the body parts
the pose model can see are drawn. When a part is lost, the whole group fades
out together, so brief detection dropouts do not make the figure flicker.

Everything runs locally in your browser. The camera feed is never uploaded.

## How it works

The hard part was finding the balance between a precise skeleton and something that reads as a whole body. Here is how I approached it:

- **Start from the skeleton only.** The only model is MediaPipe Pose Landmarker lite, which gives 33 body keypoints. There is no segmentation or outline model, so the figure never tries to trace your exact edges.
- **Grow a body around the bones.** Instead of drawing a stick figure, I spread soft light dots along each limb and across the torso. Where they overlap, they fill out into a head, chest, arms and legs, so the skeleton disappears and a body shape takes its place.
- **Let whole body parts come and go together.** The head, torso, arms and legs each appear or fade as one group, and only after they have been seen (or missing) for a moment. A jittery keypoint therefore never makes the figure flicker.
- **Keep it alive.** Every dot breathes slowly in size, colour and softness on its own rhythm, so the figure feels organic even when you stand still.

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
