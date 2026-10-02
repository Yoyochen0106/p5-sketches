import test from 'node:test';
import assert from 'node:assert/strict';
import { fourierFit, fourierPartial } from '../../lib/fourier.js';
import {
  WINDOWS, windowFactors, applyWindow, measureOvershoot, GIBBS_FRACTION,
} from '../../lib/fourier-windows.js';
import { getFunction } from '../../lib/functions.js';
import { close } from './helpers.js';

const square = getFunction('square').f;

function squareFit(N) {
  return fourierPartial(fourierFit(square, { period: 1, x0: -0.5, N: 128, samples: 4096 }), N);
}

test('factor shapes: sigma_0 = 1, length N + 1, in [0, 1], monotone-ish for the smooth windows', () => {
  for (const { id } of WINDOWS) {
    const s = windowFactors(id, 20);
    assert.equal(s.length, 21);
    close(s[0], 1, 1e-12, id);
    for (const v of s) assert.ok(v > -0.3 && v <= 1 + 1e-12, `${id}: ${v}`);
  }
  assert.deepEqual(windowFactors('none', 3), [1, 1, 1, 1]);
  assert.throws(() => windowFactors('bogus', 4));
  assert.deepEqual(windowFactors('fejer', 0), [1]);
});

test('Fejer weights are 1 - k/(N+1); others match their formulas', () => {
  const N = 9;
  windowFactors('fejer', N).forEach((v, k) => close(v, 1 - k / (N + 1), 1e-15));
  windowFactors('lanczos', N).forEach((v, k) => close(v, k ? Math.sin((Math.PI * k) / (N + 1)) / ((Math.PI * k) / (N + 1)) : 1, 1e-15));
  windowFactors('hann', N).forEach((v, k) => close(v, 0.5 * (1 + Math.cos((Math.PI * k) / (N + 1))), 1e-15));
  windowFactors('raisedcos', N).forEach((v, k) => close(v, 0.54 + 0.46 * Math.cos((Math.PI * k) / (N + 1)), 1e-15));
  // Jackson: decreasing from 1 to a small positive value
  const j = windowFactors('jackson', 30);
  for (let k = 1; k < j.length; k++) assert.ok(j[k] < j[k - 1] && j[k] > 0);
});

test('applyWindow keeps the shape of the fit and scales the coefficients', () => {
  const fit = squareFit(11);
  const w = applyWindow(fit, 'fejer');
  for (const key of ['a0', 'a', 'b', 'period', 'x0', 'N', 'evalReal', 'evalComplex']) assert.ok(key in w, key);
  assert.equal(w.a.length, fit.a.length);
  close(w.a0, fit.a0, 1e-15);
  w.b.forEach((v, i) => close(v, fit.b[i] * (1 - (i + 1) / 12), 1e-14));
  // 'none' reproduces the original evaluation
  const same = applyWindow(fit, 'none');
  for (const x of [-0.4, -0.1, 0.13, 0.31]) close(same.evalReal(x), fit.evalReal(x), 1e-13);
  // complex agrees with real on the real line
  const z = w.evalComplex([0.21, 0]);
  close(z[0], w.evalReal(0.21), 1e-10);
  close(z[1], 0, 1e-10);
  // fit is not mutated
  assert.equal(fit.b[0], fourierPartial(fourierFit(square, { period: 1, x0: -0.5, N: 128, samples: 4096 }), 11).b[0]);
});

test('Fejer (Cesaro mean): positive kernel, no overshoot for the square wave; values stay within [-1, 1]', () => {
  const w = applyWindow(squareFit(60), 'fejer');
  let m = 0;
  for (let i = 0; i <= 4000; i++) m = Math.max(m, Math.abs(w.evalReal(-0.5 + i / 4000)));
  assert.ok(m <= 1 + 1e-9, `max |S| = ${m}`);
  const o = measureOvershoot((x) => w.evalReal(x), square, 0, 0.25);
  assert.ok(o.overshoot < 1e-6, `overshoot ${o.overshoot}`);
  // Jackson is a positive kernel as well
  const j = applyWindow(squareFit(60), 'jackson');
  const oj = measureOvershoot((x) => j.evalReal(x), square, 0, 0.25);
  assert.ok(oj.overshoot < 1e-4, `jackson overshoot ${oj.overshoot}`);
});

test('Gibbs: unwindowed partial sum overshoots by ~8.95 % of the jump for large N', () => {
  close(GIBBS_FRACTION, 0.0894898722, 1e-8);
  for (const N of [40, 100]) {
    const fit = squareFit(N);
    const o = measureOvershoot((x) => fit.evalReal(x), square, 0, 0.25);
    assert.equal(o.jump, 2);
    assert.ok(Math.abs(o.overshoot - 0.0895) < 0.003, `N=${N}: ${o.overshoot}`);
    close(o.level, 1 + GIBBS_FRACTION * 2, 1e-12);
  }
  // the sawtooth jumps at +-1/2; the step function (non-periodic, 2 pi window) at 0
  const saw = getFunction('saw').f;
  const sawFit = fourierPartial(fourierFit(saw, { period: 1, x0: -0.5, N: 128 }), 100);
  const os = measureOvershoot((x) => sawFit.evalReal(x), saw, 0.5, 0.25);
  assert.ok(Math.abs(os.overshoot - 0.0895) < 0.004, `saw ${os.overshoot}`);
  const step = getFunction('step').f;
  const stepFit = fourierPartial(fourierFit(step, { period: 2 * Math.PI, x0: -Math.PI, N: 128 }), 100);
  const ot = measureOvershoot((x) => stepFit.evalReal(x), step, 0, 0.5);
  assert.ok(Math.abs(ot.overshoot - 0.0895) < 0.004, `step ${ot.overshoot}`);
});

test('windows reduce the overshoot; continuous functions report no jump', () => {
  const fit = squareFit(60);
  const base = measureOvershoot((x) => fit.evalReal(x), square, 0, 0.25).overshoot;
  for (const name of ['fejer', 'lanczos', 'hann', 'jackson', 'raisedcos']) {
    const w = applyWindow(fit, name);
    const o = measureOvershoot((x) => w.evalReal(x), square, 0, 0.25).overshoot;
    assert.ok(o < base, `${name}: ${o} vs ${base}`);
  }
  assert.equal(measureOvershoot((x) => x, (x) => x, 0, 0.2), null);
});
