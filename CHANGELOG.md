# Changelog

Versions are `vX.YY.Z`: X = major (breaking restructure), YY = minor (new sketch or feature), Z = patch (fixes).
Tags are created on `main` after `npm test` passes.

## v0.2.0
- New sketch: Impulse Response Lab (terrain-style signal editor, Wiener / least-squares / non-negative deconvolution,
  time and frequency views of x, y, h, minimum-phase filter painting).

## v0.1.0
First tagged release.
- App shell: hash router, persisted settings (localStorage + URL hash), schema-driven settings drawer (`d`), main menu.
- Sketches: Function Approximation Lab, Marching Squares & Cubes, Fourier Painter, Chladni Plates, Conformal Maps,
  Monge's Theorem, Equal-Area Transformations, Hello demo.
- Pure math library (`lib/`) and a recording mock p5 for headless tests (`npm test`).
- Not yet verified in a real browser.
