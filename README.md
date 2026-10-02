# p5-sketches

A small multi-sketch site built on p5.js (instance mode, no build step).

```
./server.sh            # python -m http.server 8000  ->  http://localhost:8000
npm test               # node --test "tests/**/*.test.js"  (no browser needed)
```

## Layout

| Path | What |
|---|---|
| `index.html`, `style.css` | App shell (menu page + sketch page with settings drawer). |
| `core/` | Router, persisted settings store (localStorage + URL hash), DOM UI builder, app lifecycle. |
| `sketches/registry.js` | List of sketches shown on the main menu. |
| `sketches/<id>/index.js` | One sketch: `export default { id, title, description, mount(container, ctx) }`. |
| `lib/` | Pure math, importable from the browser and Node: complex numbers, algebras, truncated power series (automatic differentiation), Pade, Fourier, wavelets, domain colouring. |
| `tests/` | `node:test` suites plus `tests/mock-p5.js`, a recording fake p5 used to test sketches headlessly. |

## Adding a sketch

1. Create `sketches/<id>/index.js` exporting the object above (`ctx` gives you `p5`, a persisted
   `settings` store, `ui.build(schema, store, ctx.drawer)` for the settings drawer, `toolbar`, `onResize`).
2. Add one line to `sketches/registry.js`.

## Sketch: Function Approximation Lab (`#/approx`)

Real panel and complex panel (domain colouring), switchable or side by side.

Approximations (each can be toggled independently and overlaid):

- **Taylor** to order 40 using exact truncated-power-series arithmetic (no numerical differentiation),
  lower-order ghosts, next-term error estimate, convergence radius from the known singularities.
- **Pade** `[L/M]` from the Taylor coefficients; poles / zeros are drawn in the complex plane.
- **Fourier** partial sums (period from the function or user supplied).
- **Wavelets**: discrete (Haar, Daubechies, Symlets, Coiflets, biorthogonal ...), with level and
  "keep the k largest coefficients" compression; the complex panel shows a CWT scalogram
  (Morlet, Mexican hat, Paul, ...) or the dyadic DWT coefficient map.

Controls: hover moves the expansion point *a*, click locks it, drag pans, wheel zooms,
up/down changes the Taylor order, `1 2 3` choose the panels, space animates, `F` fits the view, `M` cycles the complex view.
