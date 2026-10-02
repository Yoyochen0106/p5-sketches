import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_FAMILIES, nodes, baryWeights, genericWeights, interpolate, lebesgueConstant, lebesgueAsymptotic, maxError,
} from '../../lib/interp.js';
import { close } from './helpers.js';

const FAMS = NODE_FAMILIES.map((f) => f.id);
const runge = (x) => 1 / (1 + 25 * x * x);

test('exact for polynomials of degree <= n, every family', () => {
  const poly = (x) => 0.3 - 1.2 * x + 2 * x ** 2 - 0.7 * x ** 3 + 0.1 * x ** 5;
  for (const family of FAMS) {
    for (const n of [5, 8, 12]) {
      const p = interpolate(poly, { family, n, a: -1.5, b: 2.5 });
      for (let i = 0; i <= 40; i++) {
        const x = -1.5 + (4 * i) / 40;
        close(p.evalReal(x), poly(x), 1e-9, `${family} n=${n} x=${x}`);
      }
    }
  }
});

test('complex evaluation agrees with the real one and with a polynomial in the plane', () => {
  const p = interpolate((x) => x ** 3 - x, { family: 'chebyshev', n: 4, a: -1, b: 1 });
  const [re, im] = p.evalComplex([0.3, 0]);
  close(re, p.evalReal(0.3), 1e-12);
  close(im, 0, 1e-12);
  const z = [0.4, 0.7];
  const [zr, zi] = p.evalComplex(z);
  // z^3 - z for z = 0.4 + 0.7i
  const z2 = [z[0] * z[0] - z[1] * z[1], 2 * z[0] * z[1]];
  const z3 = [z2[0] * z[0] - z2[1] * z[1], z2[0] * z[1] + z2[1] * z[0]];
  close(zr, z3[0] - z[0], 1e-10);
  close(zi, z3[1] - z[1], 1e-10);
});

test('Chebyshev node formulas', () => {
  const n = 7;
  const first = nodes('chebyshev', n, -1, 1);
  const expect = Array.from({ length: n + 1 }, (_, j) => Math.cos(((2 * j + 1) * Math.PI) / (2 * n + 2))).reverse();
  first.forEach((x, j) => close(x, expect[j], 1e-14));
  const second = nodes('lobatto', n, -1, 1);
  const exp2 = Array.from({ length: n + 1 }, (_, j) => Math.cos((j * Math.PI) / n)).reverse();
  second.forEach((x, j) => close(x, exp2[j], 1e-14));
  assert.equal(second[0], -1);
  assert.equal(second[n], 1);
  const m = nodes('chebyshev', 3, 2, 6);
  assert.ok(m.every((x) => x > 2 && x < 6));
});

test('Legendre-Gauss nodes: symmetric roots of P_{n+1}; n=1 gives +-1/sqrt(3)', () => {
  const x = nodes('legendre', 1, -1, 1);
  close(x[0], -1 / Math.sqrt(3), 1e-14);
  close(x[1], 1 / Math.sqrt(3), 1e-14);
  const y = nodes('legendre', 9, -1, 1);
  y.forEach((v, i) => close(v, -y[y.length - 1 - i], 1e-13));
  // P_10 is even; integrates x^18 exactly with the matching Gauss rule? just check roots are sorted and inside
  for (let i = 1; i < y.length; i++) assert.ok(y[i] > y[i - 1]);
  assert.deepEqual(nodes('legendre', 0, 2, 4), [3]);
});

test('analytic barycentric weights match the generic formula up to a common factor', () => {
  for (const family of ['equispaced', 'chebyshev', 'lobatto']) {
    const n = 9;
    const w = baryWeights(family, n);
    const g = genericWeights(nodes(family, n, -1, 1));
    const r = g[0] / w[0];
    w.forEach((wi, j) => close(g[j], r * wi, 1e-9, `${family} j=${j}`));
  }
});

test('degenerate degree 0 and invalid input', () => {
  const p = interpolate((x) => x * x, { family: 'equispaced', n: 0, a: 0, b: 2 });
  close(p.evalReal(1.7), 1, 1e-14);
  assert.throws(() => nodes('nope', 3));
  assert.throws(() => interpolate(() => NaN, { family: 'equispaced', n: 3 }));
  assert.throws(() => interpolate((x) => x, { family: 'equispaced', n: 3, a: 1, b: 1 }));
});

test('Lebesgue constant: equispaced grows like 2^n/(e n log n), Chebyshev like (2/pi) log n', () => {
  for (const n of [10, 16, 20]) {
    const p = interpolate((x) => x, { family: 'equispaced', n });
    const L = lebesgueConstant(p);
    const est = lebesgueAsymptotic('equispaced', n);
    assert.ok(L / est > 0.6 && L / est < 1.6, `n=${n}: ${L} vs ${est}`);
  }
  const L10 = lebesgueConstant(interpolate((x) => x, { family: 'equispaced', n: 10 }));
  const L20 = lebesgueConstant(interpolate((x) => x, { family: 'equispaced', n: 20 }));
  assert.ok(L20 / L10 > 100, 'exponential growth');
  for (const family of ['chebyshev', 'lobatto']) {
    for (const n of [5, 10, 20, 40, 80]) {
      const L = lebesgueConstant(interpolate((x) => x, { family, n }));
      const est = lebesgueAsymptotic(family, n);
      assert.ok(Math.abs(L - est) < 0.35, `${family} n=${n}: ${L} vs ${est}`);
    }
  }
  const small = lebesgueConstant(interpolate((x) => x, { family: 'legendre', n: 20 }));
  assert.ok(small > 1 && small < 10);
});

test('Runge phenomenon: equispaced error blows up, Chebyshev converges', () => {
  const eq = [8, 12, 16, 20, 24].map((n) => maxError(runge, interpolate(runge, { family: 'equispaced', n }), -1, 1));
  const ch = [8, 12, 16, 20, 24].map((n) => maxError(runge, interpolate(runge, { family: 'chebyshev', n }), -1, 1));
  for (let i = 1; i < eq.length; i++) assert.ok(eq[i] > eq[i - 1], `equispaced grows: ${eq}`);
  assert.ok(eq[4] > 10, `n=24 error ${eq[4]}`);
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i] < ch[i - 1], `chebyshev shrinks: ${ch}`);
  assert.ok(ch[4] < 0.05, `chebyshev n=24 error ${ch[4]}`);
  // the equispaced blow-up lives near the ends
  const p = interpolate(runge, { family: 'equispaced', n: 20 });
  assert.ok(Math.abs(p.evalReal(0.95) - runge(0.95)) > 10 * Math.abs(p.evalReal(0.05) - runge(0.05)));
});

test('barycentric evaluation is stable at high degree (n = 100, Chebyshev)', () => {
  const f = (x) => Math.exp(x) * Math.sin(3 * x);
  const p = interpolate(f, { family: 'chebyshev', n: 100, a: -1, b: 1 });
  assert.ok(maxError(f, p, -1, 1, 500) < 1e-13);
});
