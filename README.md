# Dots

A small, in-browser sketch: your webcam pose becomes a figure of soft and crisp
light dots that keep breathing even when you stand still. Only the body parts
the pose model can see are drawn. When a part is lost, the whole group fades
out together, so brief detection dropouts do not make the figure flicker.

Everything runs locally in your browser. The camera feed is never uploaded.

## How it works

I don't use a silhouette or segmentation model. The only detector is MediaPipe's
Pose Landmarker lite, which gives me a 33-point skeleton. The sense of a whole
body is something I build from that skeleton, so the dots read as volume rather
than as a stick figure.

Each orb is anchored to a point on the pose — along a limb, slightly off the
bone, or interpolated across the torso between the shoulders and hips. Sizes
are in shoulder widths (or an estimate from the ears or eyes if the shoulders
are out of frame), so the figure stays in proportion to the person. Overlapping
orbs fill out the head, chest, arms, and legs; most are soft, and a smaller
share of the small-to-medium ones stay crisp. A shader lets every orb breathe,
even when you stand still, each on its own rate and phase.

The joints are smoothed with a One Euro filter — heavier at rest, lighter when
you move — and a short constant-velocity lookahead of at most 50 ms. The orbs
follow those joints on springs, so the figure has a little weight instead of
snapping. Show and hide are decided per body part (head, torso, each arm, hand,
and leg), not orb by orb. A part has to stay detected for 280 ms before it
fades in as a group, and stay missing for 700 ms before it starts fading out
(the fade-out is a little slower than the fade-in, 650 ms versus 450 ms). Brief
dropouts keep the last smoothed pose.

That is the balance I wanted: the skeleton stays precise enough to follow you,
but I bias toward stability so a jittery landmark doesn't flicker the figure,
and I never pretend to have a pixel-accurate outline I don't have.

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
