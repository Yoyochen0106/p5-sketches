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
| `sketches/registry.js` | `SKETCHES` (flat list of all sketches and planned course units) and `COURSES` (ordered unit ids per course). |
| `sketches/<id>/index.js` | One sketch: `export default { id, title, description, mount(container, ctx) }`. |
| `lib/` | Pure math, importable from the browser and Node: complex numbers, algebras, truncated power series (automatic differentiation), Pade, Fourier, wavelets, domain colouring. |
| `tests/` | `node:test` suites plus `tests/mock-p5.js`, a recording fake p5 used to test sketches headlessly. |

## Sketches

| Route | Sketch |
|---|---|
| `#/approx` | Function Approximation Lab (Taylor, Pade, Fourier + Gibbs windows, wavelets, interpolation, sonification; real + complex panels) |
| `#/iso` | Marching Squares & Cubes (cell / cube-case inspectors, crack detector, slice plane, STL/OBJ export) |
| `#/fourier2d` | Fourier Painter (epicycles for drawn curves, 2D FFT filtering of painted images) |
| `#/chladni` | Chladni Plates (eigenmodes, mode mixing, driven resonance, sand) |
| `#/conformal` | Conformal Maps (grids and angles under complex maps) |
| `#/monge` | Monge's Theorem (three draggable circles) |
| `#/equal-area` | Equal-Area Transformations (shear, polygon reduction, squaring) |
| `#/impulse` | Impulse Response Lab (draw input/output, recover h = deconvolution, time + frequency views) |
| `#/poncelet` | Poncelet's Porism (two conics, closing tangent polygons, Cayley / Euler criteria, closure solver) |
| `#/geodesics` | Surface Curvature & Geodesics (K / H colouring, geodesics, parallel transport, holonomy, Gauss-Bonnet) |
| `#/elliptic` | Elliptic Curve Group (chord-and-tangent over R, over F_p, and on the complex torus) |
| `#/kleinian` | IFS & Moebius Groups (chaos game fractals, Schottky / Kleinian limit sets, Riemann sphere) |
| `#/hello` | Demo of the sketch API |

Shortcuts: `d` toggles the settings drawer.

## Structure: home, courses, misc

- `#/` home page with two collapsible sections (state kept in the global settings): **Courses** (large cards with unit counts)
  and **Misc** (the stand-alone sketches).
- `#/course/<courseId>` course page: breadcrumb, ordered unit cards (description, prerequisites, related links, `planned` badge,
  visited check). `course` is a reserved id. Unknown routes show the home page.
- A sketch that belongs to a course gets `Course > Unit n/N`, Prev/Next (planned units are skipped) and a unit dropdown in the top bar.
  Any sketch with `related` entries gets a **Related** section at the bottom of the drawer.
- Registry entry: `{ id, title, description, load, group?: 'misc'|'course', course?, unit?, planned?, related?: [{id,label,why,params?}], prereqs?: [ids] }`.
  `planned: true` entries have no `load` and are shown as disabled cards. `COURSES = [{ id, title, description, accent, units: [ids] }]`.
- `ctx.link(id, params?)` returns `'#/id?k=v'`; `ctx.navigate(id, params?)` goes there (deep links open a sketch pre-configured
  through its settings keys). Visited units are stored in the global settings under `visited`.

## Adding a sketch

1. Create `sketches/<id>/index.js` exporting the object above (`ctx` gives you `p5`, a persisted
   `settings` store, `ui.build(schema, store, ctx.drawer)` for the settings drawer, `toolbar`, `onResize`).
2. Add one entry to `sketches/registry.js` (for a course unit also set `group: 'course'`, `course`, `unit`, and drop `planned`/add `load`).

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
