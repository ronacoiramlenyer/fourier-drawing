# Fourier Circle Studio

An interactive page for exploring epicycles: rotating circles chained tip to tail whose sum traces a figure.

- **Build with Circles**: add, remove and tune circles (radius, signed frequency, phase, on/off). Includes presets: one circle, ellipse, cardioid, three-lobed curve (3-petal rose), flower (8-petal rose), seven-fold rosette.
- **Trace a Drawing**: draw an outline (mouse, pen or touch) or pick a heart, star, square or open spiral. The outline is resampled into 512 points evenly spaced along its length (the closing segment counts), transformed with a DFT, and reconstructed by circles sorted by magnitude. The constant offset c₀ is the fixed start of the chain.

Plain HTML, CSS and JavaScript on a canvas. No build step or dependencies.

## Run

Open `index.html` in a browser.

## Edit

The page source is `src/studio.html` (written as artifact page content). After editing it, regenerate the standalone page:

```sh
./scripts/build.sh
```
