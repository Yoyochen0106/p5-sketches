// Chladni sand: grains do a random walk whose hop probability is proportional to the local vibration
// amplitude, so they stop (and accumulate) where the plate does not move: on the nodal lines.
// Deterministic (seeded mulberry32), typed arrays, no DOM.

import { bilinear } from './plates.js';

/** Hard cap on the number of grains. */
export const MAX_GRAINS = 8000;

function nextRandom(sand) {
  let a = (sand.rng = (sand.rng + 0x6d2b79f5) >>> 0);
  a = Math.imul(a ^ (a >>> 15), a | 1);
  a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}

/**
 * Scatter `count` grains uniformly (rejection sampling) over the plate.
 * bounds: { xmin, xmax, ymin, ymax }; inside(x, y) -> boolean. Returns { n, x, y (Float32Array), rng }.
 */
export function createSand({ count = 2000, seed = 1, bounds, inside }) {
  const n = Math.max(0, Math.min(MAX_GRAINS, Math.floor(count)));
  const sand = { n, x: new Float32Array(n), y: new Float32Array(n), rng: seed >>> 0 };
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 100; tries++) {
      const x = bounds.xmin + nextRandom(sand) * (bounds.xmax - bounds.xmin);
      const y = bounds.ymin + nextRandom(sand) * (bounds.ymax - bounds.ymin);
      if (inside(x, y)) { sand.x[i] = x; sand.y[i] = y; break; }
    }
  }
  return sand;
}

/**
 * Advance every grain `steps` times. `amp` is a grid of vibration amplitude (|value| is used). A grain
 * hops with probability min(1, mobility * |amp| / max|amp|) by a random vector of length ~ stepSize (in
 * plate units), only if the target lies inside the plate. The stationary density ~ 1 / amplitude, which
 * concentrates on the nodal lines.
 */
export function stepSand(sand, amp, inside, { steps = 1, stepSize = 0.01, mobility = 3, ampMax } = {}) {
  const v = amp.values;
  let mx = ampMax;
  if (mx === undefined) {
    mx = 0;
    for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > mx) mx = a; }
  }
  if (!(mx > 0)) return sand;
  const inv = mobility / mx;
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < sand.n; i++) {
      const x = sand.x[i];
      const y = sand.y[i];
      const p = Math.abs(bilinear(amp, x, y)) * inv;
      const hop = nextRandom(sand) < p;
      const ang = nextRandom(sand) * 2 * Math.PI;
      const len = stepSize * (0.5 + nextRandom(sand));
      if (!hop) continue;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      if (inside(nx, ny)) { sand.x[i] = nx; sand.y[i] = ny; }
    }
  }
  return sand;
}

/** Mean |u| (bilinear) over the grain positions. */
export function meanAmplitude(sand, grid) {
  if (!sand.n) return 0;
  let s = 0;
  for (let i = 0; i < sand.n; i++) s += Math.abs(bilinear(grid, sand.x[i], sand.y[i]));
  return s / sand.n;
}
