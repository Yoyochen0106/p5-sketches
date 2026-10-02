import test from 'node:test';
import assert from 'node:assert/strict';
import { fourierFit, fourierPartial } from '../../lib/fourier.js';
import { getFunction } from '../../lib/functions.js';
import * as C from '../../lib/complex.js';
import { close, closeC } from './helpers.js';

const PI = Math.PI;

test('square wave: b_k = 4/(pi k) for odd k, zero otherwise; a_k = 0', () => {
  const fit = fourierFit(getFunction('square').f, { period: 1, N: 15 });
  close(fit.a0, 0, 1e-12);
  for (let k = 1; k <= 15; k++) {
    close(fit.b[k - 1], k % 2 ? 4 / (PI * k) : 0, 2e-3, `b${k}`);
    close(fit.a[k - 1], 0, 1e-9, `a${k}`);
  }
  assert.equal(fit.N, 15);
  assert.equal(fit.period, 1);
  assert.equal(fit.x0, 0);
  assert.equal(fit.a.length, 15);
});

test('sawtooth: b_k = 2 (-1)^(k+1) / (pi k)', () => {
  const fit = fourierFit(getFunction('saw').f, { period: 1, N: 12 });
  for (let k = 1; k <= 12; k++) {
    close(fit.b[k - 1], (2 * (k % 2 ? 1 : -1)) / (PI * k), 2e-3, `b${k}`);
    close(fit.a[k - 1], 0, 1e-9);
  }
});

test('triangle wave: a_k = 8/(pi k)^2 for odd k', () => {
  const fit = fourierFit(getFunction('tri').f, { period: 1, N: 12 });
  close(fit.a0, 0, 1e-9);
  for (let k = 1; k <= 12; k++) {
    close(fit.a[k - 1], k % 2 ? 8 / (PI * k) ** 2 : 0, 1e-7, `a${k}`);
    close(fit.b[k - 1], 0, 1e-9);
  }
});

test('definition: a0/2 is the mean; exact for trigonometric polynomials; x0 shift', () => {
  const T = 3;
  const g = (x) => 2 + 0.5 * Math.cos((2 * PI * 2 * (x - 0.7)) / T) - 1.5 * Math.sin((2 * PI * x) / T + 0.3);
  const fit = fourierFit(g, { period: T, x0: 0.7, N: 4, samples: 256 });
  close(fit.a0, 4, 1e-13);
  // -1.5 sin(w(x-x0) + w x0 + 0.3) with w x0 = 2 pi 0.7 / 3
  const ph = (2 * PI * 0.7) / T + 0.3;
  close(fit.a[1], 0.5, 1e-13);
  close(fit.a[0], -1.5 * Math.sin(ph), 1e-13);
  close(fit.b[0], -1.5 * Math.cos(ph), 1e-13);
  for (const x of [-1, 0.2, 2.9, 10]) close(fit.evalReal(x), g(x), 1e-12);
});

test('evalReal is periodic and evalComplex agrees with evalReal on the real axis', () => {
  const fit = fourierFit(getFunction('legacy').f, { period: 1, N: 3 });
  for (const x of [0.13, 0.5, 0.77]) {
    close(fit.evalReal(x), fit.evalReal(x + 1), 1e-12);
    closeC(fit.evalComplex([x, 0]), [fit.evalReal(x), 0], 1e-12);
    close(fit.evalReal(x), getFunction('legacy').f(x), 1e-12); // legacy is exactly 2 harmonics
  }
  // complex evaluation of a pure cosine: cos(2 pi z)
  const c = fourierFit((x) => Math.cos(2 * PI * x), { period: 1, N: 1 });
  const z = [0.2, 0.3];
  closeC(c.evalComplex(z), C.cos(C.scale(z, 2 * PI)), 1e-12);
  closeC(c.evalComplex(0.25), [0, 0], 1e-12);
});

test('fourierPartial truncates without refitting', () => {
  const fit = fourierFit(getFunction('square').f, { period: 1, N: 20 });
  const p = fourierPartial(fit, 3);
  assert.equal(p.N, 3);
  assert.equal(p.a.length, 3);
  assert.equal(p.b.length, 3);
  assert.deepEqual(p.b, fit.b.slice(0, 3));
  assert.equal(p.a0, fit.a0);
  const x = 0.2;
  const manual = fit.a0 / 2 + [1, 2, 3].reduce((s, k) =>
    s + fit.a[k - 1] * Math.cos(2 * PI * k * x) + fit.b[k - 1] * Math.sin(2 * PI * k * x), 0);
  close(p.evalReal(x), manual, 1e-13);
  assert.equal(fourierPartial(fit, 0).evalReal(0.3), fit.a0 / 2);
  assert.equal(fourierPartial(fit, 99).N, 20);
  // successive partial sums converge to the function at a smooth point
  const e = (n) => Math.abs(fourierPartial(fit, n).evalReal(0.25) - 1);
  assert.ok(e(19) < e(3));
  closeC(fourierPartial(fit, 3).evalComplex([x, 0]), [p.evalReal(x), 0], 1e-12);
});

test('Gibbs overshoot of the square wave approaches ~1.179', () => {
  const fit = fourierFit(getFunction('square').f, { period: 1, N: 99, samples: 8192 });
  let m = 0;
  for (let i = 0; i < 2000; i++) m = Math.max(m, fit.evalReal(i * 0.25 / 2000));
  assert.ok(m > 1.15 && m < 1.2, `max = ${m}`);
});
