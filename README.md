# Dots

A small, in-browser sketch: your webcam pose becomes a figure of soft and crisp
light dots that keep breathing even when you stand still. Only the body parts
the pose model can see are drawn. When a part is lost, the whole group fades
out together, so brief detection dropouts do not make the figure flicker.

Everything runs locally in your browser. The camera feed is never uploaded.

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
