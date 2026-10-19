# Math Manipulatives

A collection of hands-on math tools in one page. Plain HTML, CSS and JavaScript on canvas; no build dependencies or backend.

## Tools

### Function Grapher
A graphing calculator in the spirit of Desmos, built for learners.

- Type `y = 2x + 1`, `x^2 + y^2 = 9`, `(cos(t), sin(t))`, `r = cos(3θ)`, `x = y^2`, points `(2, 3)`, or plain calculations.
- New letters can become sliders with one click; sliders can be dragged or animated. Points made of sliders, like `(a, b)`, can be dragged on the graph.
- Each row shows the expression as it was understood (pretty-printed) and a plain-language description: slope and intercept for lines, vertex for parabolas, symmetry and period for curves.
- Clicking a graph lists its key points: roots, y-intercept, peaks, valleys and intersections with other graphs.
- Seven step-by-step lessons: lines, parabolas, sine waves, exponentials, circles three ways, a square wave from sines (Fourier series) and polar roses.
- Friendly error messages ("A “(” is never closed.", "Did you mean sin?"), a syntax guide, degree mode, pan, zoom, pinch and PNG export.

### Fourier Circle Studio
Explore epicycles: rotating circles chained tip to tail.

- **Build with Circles**: tune radius, signed frequency, phase and on/off for each circle. Presets include ellipse, cardioid, roses and a seven-fold rosette.
- **Circle layout**: one chain in the complex plane, or separate panels of left-right (x) and up-down (y) circles that draw into their own drawing panel, giving Lissajous figures.
- **Trace a Drawing**: draw an outline or pick a built-in one. It is resampled to 512 evenly spaced points (closing segment included), transformed with a DFT and rebuilt from circles sorted by size.
- **Trace a real object**: upload, drop or paste a photo of an object on a plain background; the app finds its outer edge (Otsu threshold, gap closing, largest object, boundary trace) and converts it to circles.

## Source layout

```
src/base.css              shared design tokens and components
src/suite/                collection shell: head, navigation, home page, shared helpers, router
src/grapher/              Function Grapher markup, styles and script
src/fourier/              Fourier Circle Studio markup and script
scripts/build.py          assembles everything into one page
```

## Build and run

```sh
./scripts/build.sh    # writes index.html, dist/index.html and build/artifact.html
```

Open `index.html` in a browser. Links like `index.html#grapher` and `index.html#fourier` open a tool directly.

## Deploy to Cloudflare

`wrangler.toml` deploys `dist/` as a Cloudflare Workers static site named `fourier-studio`.

```sh
export CLOUDFLARE_API_TOKEN=...   # token with "Edit Cloudflare Workers" permission
export CLOUDFLARE_ACCOUNT_ID=...
npm run deploy
```
