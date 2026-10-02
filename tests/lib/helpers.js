import assert from 'node:assert/strict';

export function close(actual, expected, tol = 1e-12, msg = '') {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tol * scale, `${msg} expected ${expected}, got ${actual} (tol ${tol})`);
}

export function closeC(actual, expected, tol = 1e-12, msg = '') {
  const e = Array.isArray(expected) ? expected : [expected, 0];
  close(actual[0], e[0], tol, `${msg} re:`);
  close(actual[1], e[1], tol, `${msg} im:`);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
