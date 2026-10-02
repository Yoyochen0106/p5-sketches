import test from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTIONS, getFunction } from '../../lib/functions.js';
import { hornerComplex } from '../../lib/poly.js';
import * as C from '../../lib/complex.js';
import { close, closeC } from './helpers.js';

const REQUIRED = ['sin', 'cos', 'exp', 'ln1p', 'geom', 'lorentz', 'runge', 'atan', 'sqrt1p', 'tanh', 'sinc',
  'gauss', 'legacy', 'abs', 'square', 'saw', 'tri', 'bump', 'step', 'chirp'];

test('catalogue contains all required ids with unique ids and well-formed entries', () => {
  const ids = FUNCTIONS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of REQUIRED) assert.ok(getFunction(id), `missing ${id}`);
  assert.equal(getFunction('nope'), undefined);
  assert.ok(ids.some((id) => id === 'doppler'));
  for (const f of FUNCTIONS) {
    assert.equal(typeof f.label, 'string');
    assert.equal(typeof f.analytic, 'boolean');
    assert.equal(typeof f.f, 'function');
    assert.ok(Array.isArray(f.singularities));
    assert.equal(typeof f.radius, 'function');
    assert.ok(f.period === null || f.period > 0);
    assert.ok(f.view.xmin < f.view.xmax && f.view.ymin < f.view.ymax);
    if (f.analytic) {
      for (const k of ['def', 'fc', 'taylor']) assert.equal(typeof f[k], 'function', `${f.id}.${k}`);
    } else {
      assert.equal(f.def, undefined);
      assert.equal(f.taylor, undefined);
      assert.equal(f.radius(0.3), 0);
    }
  }
});

test('real f agrees with the complex fc on the real axis', () => {
  for (const f of FUNCTIONS.filter((g) => g.analytic)) {
    for (const x of [-0.7, -0.2, 0.31, 0.9]) {
      const real = f.f(x);
      const z = f.fc([x, 0]);
      close(z[0], real, 1e-12, `${f.id}(${x})`);
      assert.ok(Math.abs(z[1]) < 1e-12, `${f.id} imaginary part ${z[1]}`);
    }
  }
});

test('taylor() accepts a number or a complex centre and has n+1 coefficients', () => {
  const f = getFunction('exp');
  assert.equal(f.taylor(0.5, 7).length, 8);
  assert.deepEqual(f.taylor(0.5, 3), f.taylor([0.5, 0], 3));
  closeC(f.taylor([0, 2], 0)[0], C.exp([0, 2]));
});

test('Taylor polynomial converges to fc inside the disc of convergence', () => {
  const centers = [0, 0.4, [0.3, 0.2], [-0.2, 0.5], [0.5, -0.4]];
  for (const f of FUNCTIONS.filter((g) => g.analytic)) {
    for (const a of centers) {
      const R = f.radius(a);
      if (!(R > 0.05)) continue; // centre too close to a singularity for a meaningful check
      const r = Math.min(0.4 * R, 0.5);
      const t = f.taylor(a, 40);
      for (const th of [0.3, 1.9, 3.5, 5.0]) {
        const d = C.fromPolar(r, th);
        const exact = f.fc(C.add(Array.isArray(a) ? a : [a, 0], d));
        const approx = hornerComplex(t, d);
        closeC(approx, exact, 1e-9, `${f.id} a=${a} th=${th}`);
      }
    }
  }
});

test('closed-form coefficients at 0 (order 10)', () => {
  const n = 10;
  const re = (id, a = 0) => getFunction(id).taylor(a, n).map((z) => z[0]);
  const expect = (id, arr, tol = 1e-15) =>
    re(id).forEach((v, k) => close(v, arr[k], tol, `${id}[${k}]`));
  const fact = [1]; for (let k = 1; k <= n + 1; k++) fact.push(fact[k - 1] * k);
  expect('sin', fact.map((f, k) => (k % 2 ? ((k - 1) / 2 % 2 ? -1 : 1) / f : 0)));
  expect('exp', fact.map((f) => 1 / f));
  expect('gauss', fact.map((f, k) => (k % 2 ? 0 : (k / 2 % 2 ? -1 : 1) / fact[k / 2])));
  expect("sinc", fact.slice(0, n + 1).map((f, k) => (k % 2 ? 0 : (k / 2 % 2 ? -1 : 1) / fact[k + 1])));
  expect('lorentz', fact.map((f, k) => (k % 2 ? 0 : (k / 2 % 2 ? -1 : 1))));
  expect('runge', fact.map((f, k) => (k % 2 ? 0 : (k / 2 % 2 ? -1 : 1) * 25 ** (k / 2))), 1e-9);
  expect('ln1p', fact.map((f, k) => (k ? (k % 2 ? 1 : -1) / k : 0)));
  expect('geom', fact.map(() => 1));
  expect('atan', fact.map((f, k) => (k % 2 ? ((k - 1) / 2 % 2 ? -1 : 1) / k : 0)));
  expect('tanh', [0, 1, 0, -1 / 3, 0, 2 / 15, 0, -17 / 315, 0, 62 / 2835, 0]);
  // legacy: 0.5 sin(2 pi x) + 0.5 sin(4 pi x)
  const leg = getFunction('legacy').taylor(0, 5).map((z) => z[0]);
  close(leg[1], 0.5 * 2 * Math.PI + 0.5 * 4 * Math.PI, 1e-13);
  close(leg[3], (-0.5 * (2 * Math.PI) ** 3 - 0.5 * (4 * Math.PI) ** 3) / 6, 1e-12);
});

test('sinc: closed form at 0 and generic series at nonzero centres agree with fc', () => {
  const sinc = getFunction('sinc');
  closeC(sinc.fc([0, 0]), [1, 0]);
  assert.equal(sinc.f(0), 1);
  const t = sinc.taylor(0, 40);
  close(t[40][0], 1 / 41 / 40 / 39 / 38 / 37 / 36 / 35 / 34 / 33 / 32 / 31 / 30 / 29 / 28 / 27 / 26 / 25 / 24 / 23 / 22 / 21 / 20 / 19 / 18 / 17 / 16 / 15 / 14 / 13 / 12 / 11 / 10 / 9 / 8 / 7 / 6 / 5 / 4 / 3 / 2, 1e-12);
  // ln(1+x) coefficients about a real centre: (-1)^(k+1) / (k (1+a)^k)
  const a = 1.5;
  const l = getFunction('ln1p').taylor(a, 12);
  close(l[0][0], Math.log(1 + a));
  for (let k = 1; k <= 12; k++) close(l[k][0], ((k % 2 ? 1 : -1) / k) / (1 + a) ** k, 1e-13);
});

test('singularity and radius data', () => {
  const R = (id, a) => getFunction(id).radius(a);
  close(R('lorentz', 0), 1);
  close(R('lorentz', 0.5), Math.sqrt(1.25));
  close(R('lorentz', [0, 0.5]), 0.5);
  close(R('lorentz', [0.3, 4]), Math.hypot(0.3, 3));
  close(R('runge', 0), 0.2);
  close(R('runge', 0.1), Math.hypot(0.1, 0.2));
  close(R('atan', 0), 1);
  close(R('geom', 0), 1);
  close(R('geom', -1), 2);
  close(R('geom', [1, 1]), 1);
  close(R('ln1p', 0), 1);
  close(R('ln1p', 2), 3);
  close(R('sqrt1p', 0.5), 1.5);
  close(R('tanh', 0), Math.PI / 2);
  close(R('tanh', [0, 3]), Math.abs(3 - Math.PI / 2));
  close(R('tanh', [1, 5]), Math.hypot(1, 5 - 1.5 * Math.PI));
  close(R('tanh', [0, 20]), Math.abs(20 - 6.5 * Math.PI)); // far from the listed poles: still exact
  close(R('doppler', 0), 1.2);
  for (const id of ['sin', 'cos', 'exp', 'sinc', 'gauss', 'legacy', 'chirp']) {
    assert.equal(R(id, 1.3), Infinity);
    assert.deepEqual(getFunction(id).singularities, []);
  }
  // tanh lists a symmetric family of poles at i*pi*(m + 1/2)
  const poles = getFunction('tanh').singularities;
  assert.ok(poles.length >= 8);
  for (const p of poles) close(Math.cos(p[1]), 0, 1e-12);
  assert.ok(poles.some((p) => Math.abs(p[1] - Math.PI / 2) < 1e-12));
  assert.ok(poles.some((p) => Math.abs(p[1] + Math.PI / 2) < 1e-12));
});

test('listed singularities really blow up (poles) or are branch points', () => {
  for (const id of ['geom', 'lorentz', 'runge', 'tanh']) {
    const f = getFunction(id);
    for (const s of f.singularities) {
      const v = f.fc(C.add(s, [1e-7, 1e-7]));
      assert.ok(C.abs(v) > 1e5, `${id} near ${s}: ${v}`);
    }
  }
  const ln = getFunction('ln1p');
  assert.ok(C.abs(ln.fc([-1 + 1e-12, 0])) > 20);
  assert.ok(C.abs(getFunction('sqrt1p').fc([-1 + 1e-12, 0])) < 1e-5);
  assert.ok(C.abs(getFunction('atan').fc([1e-9, 1 - 1e-9])) > 10);
});

test('empirical radius via coefficient growth |c_n|^(1/n) -> 1/R', () => {
  const n = 80;
  for (const [id, a] of [['lorentz', 0.5], ['atan', 0], ['geom', [0.2, 0.3]], ['runge', 0.1], ['tanh', 0], ['ln1p', 1]]) {
    const f = getFunction(id);
    const t = f.taylor(a, n);
    let best = 0;
    for (let k = n - 5; k <= n; k++) best = Math.max(best, C.abs(t[k]) ** (1 / k));
    // limsup estimate: loose tolerance (algebraic prefactors decay like k^(-p/k))
    const est = 1 / best;
    const R = f.radius(a);
    assert.ok(Math.abs(est - R) / R < 0.12, `${id}: estimated ${est}, radius ${R}`);
  }
});

test('non-analytic functions: values, periods, ranges', () => {
  const sq = getFunction('square'), saw = getFunction('saw'), tri = getFunction('tri');
  for (const g of [sq, saw, tri]) assert.equal(g.period, 1);
  assert.equal(sq.f(0.25), 1);
  assert.equal(sq.f(0.75), -1);
  assert.equal(sq.f(1.25), 1);
  assert.equal(sq.f(-0.25), -1);
  close(saw.f(0.25), 0.5);
  close(saw.f(-0.25), -0.5);
  close(saw.f(1.25), 0.5);
  close(tri.f(0), 1);
  close(tri.f(0.5), -1);
  close(tri.f(0.25), 0);
  close(tri.f(-0.25), 0);
  close(tri.f(1), 1);
  for (let i = 0; i < 400; i++) {
    const x = -2 + i * 0.01013;
    for (const g of [sq, saw, tri]) assert.ok(Math.abs(g.f(x)) <= 1 + 1e-12);
  }
  const bump = getFunction('bump');
  close(bump.f(0), 1);
  assert.equal(bump.f(1), 0);
  assert.equal(bump.f(-1.5), 0);
  assert.ok(bump.f(0.99) < 1e-20 || bump.f(0.99) >= 0);
  const step = getFunction('step');
  assert.equal(step.f(-1e-9), 0);
  assert.equal(step.f(0), 1);
  assert.equal(getFunction('abs').f(-3), 3);
  close(getFunction('chirp').f(2), Math.sin(4));
  close(getFunction('legacy').f(0.25), 0.5 * Math.sin(Math.PI / 2) + 0.5 * Math.sin(Math.PI));
  close(getFunction('legacy').f(1.3), getFunction('legacy').f(0.3), 1e-12);
  close(getFunction('sin').period, 2 * Math.PI);
  assert.equal(getFunction('exp').period, null);
});
