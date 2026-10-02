import test from 'node:test';
import assert from 'node:assert/strict';
import { pade, evalRational, evalRationalReal, polyRoots, poles, zeros } from '../../lib/pade.js';
import { getFunction } from '../../lib/functions.js';
import { hornerComplex } from '../../lib/poly.js';
import * as C from '../../lib/complex.js';
import { close, closeC } from './helpers.js';

const taylor = (id, a, n) => getFunction(id).taylor(a, n);
const sortByArg = (rs) => rs.slice().sort((p, q) => p[1] - q[1] || p[0] - q[0]);

test('[2/2] of exp is (1 + x/2 + x^2/12) / (1 - x/2 + x^2/12)', () => {
  const r = pade(taylor('exp', 0, 4), 2, 2);
  assert.equal(r.L, 2); assert.equal(r.M, 2);
  assert.deepEqual(r.den[0], [1, 0]);
  [1, 1 / 2, 1 / 12].forEach((v, k) => close(r.num[k][0], v, 1e-14));
  [1, -1 / 2, 1 / 12].forEach((v, k) => close(r.den[k][0], v, 1e-14));
  close(evalRationalReal(r, 0.5), (1 + 0.25 + 0.25 / 12) / (1 - 0.25 + 0.25 / 12), 1e-14);
  close(evalRationalReal(r, 0.5), Math.exp(0.5), 1e-4);
});

test('[1/1] of ln(1+x) is x / (1 + x/2) and [2/2] has the known form', () => {
  const r = pade(taylor('ln1p', 0, 2), 1, 1);
  close(r.num[0][0], 0, 1e-15); close(r.num[1][0], 1, 1e-14);
  close(r.den[1][0], 0.5, 1e-14);
  const r2 = pade(taylor('ln1p', 0, 4), 2, 2);
  // [2/2] = (6x + 3x^2) / (6 + 6x + x^2)  ->  x + x^2/2 / ... normalised: (x + x^2/2)/(1 + x + x^2/6)
  [0, 1, 0.5].forEach((v, k) => close(r2.num[k][0], v, 1e-13));
  [1, 1, 1 / 6].forEach((v, k) => close(r2.den[k][0], v, 1e-13));
});

test('Pade defining property: series of num/den matches the input to order L+M', () => {
  const t = taylor('tanh', 0, 14);
  const r = pade(t, 5, 6);
  // multiply den * series and compare with num through degree L+M
  const prod = Array.from({ length: 12 }, () => [0, 0]);
  for (let i = 0; i < r.den.length; i++) {
    for (let j = 0; j < 12 - i; j++) prod[i + j] = C.add(prod[i + j], C.mul(r.den[i], t[j]));
  }
  for (let k = 0; k <= 5 + r.M; k++) {
    closeC(prod[k], k < r.num.length ? r.num[k] : [0, 0], 1e-12, `k=${k}`);
  }
});

test('Pade of 1/(1+x^2) detects poles at +-i (and reduces singular M)', () => {
  const r = pade(taylor('lorentz', 0, 8), 2, 2);
  assert.equal(r.M, 2);
  const p = sortByArg(poles(r));
  closeC(p[0], [0, -1], 1e-12); closeC(p[1], [0, 1], 1e-12);
  // exact reproduction
  closeC(evalRational(r, [0.3, 0.4]), getFunction('lorentz').fc([0.3, 0.4]), 1e-13);
  // [3/3] is singular for this even function: M is reduced and the result is still exact
  const r33 = pade(taylor('lorentz', 0, 8), 3, 3);
  assert.equal(r33.M, 2);
  closeC(evalRational(r33, [0.3, 0.4]), getFunction('lorentz').fc([0.3, 0.4]), 1e-13);
  assert.equal(r33.den.length, 3);
});

test('Pade of tan has poles near +-pi/2 and +-3pi/2; zeros at 0 and +-pi', () => {
  const r = pade(taylor('tanh', 0, 16), 7, 8);
  const p = poles(r).filter((z) => Math.abs(z[0]) < 1e-6);
  const ims = p.map((z) => z[1]).sort((a, b) => a - b);
  // tanh has poles at i*pi*(m+1/2): +-1.5708, +-4.7124
  const nearest = ims.filter((v) => Math.abs(v) < 5);
  assert.equal(nearest.length, 4);
  close(nearest[0], -3 * Math.PI / 2, 5e-3);
  close(nearest[1], -Math.PI / 2, 1e-7);
  close(nearest[2], Math.PI / 2, 1e-7);
  close(nearest[3], 3 * Math.PI / 2, 5e-3);
  // zero at 0 and +-i pi
  const z = zeros(r);
  assert.ok(z.some((v) => C.abs(v) < 1e-8));
  assert.ok(z.some((v) => C.abs(C.sub(v, [0, Math.PI])) < 1e-3));
});

test('edge cases: M = 0 is the Taylor polynomial, L = 0, short input throws', () => {
  const t = taylor('exp', 0, 6);
  const r0 = pade(t, 4, 0);
  assert.equal(r0.M, 0);
  assert.deepEqual(r0.den, [[1, 0]]);
  r0.num.forEach((c, k) => closeC(c, t[k], 1e-15));
  assert.equal(r0.num.length, 5);
  const rl = pade(taylor('geom', 0, 6), 0, 3); // [0/3] of 1/(1-x) = 1/(1 - x)
  close(rl.num[0][0], 1);
  close(evalRationalReal(rl, 0.25), 1 / 0.75, 1e-13);
  assert.throws(() => pade(t.slice(0, 3), 2, 2), RangeError);
});

test('Pade works about a complex centre and in dz coordinates', () => {
  const a = [0.2, 0.3];
  const f = getFunction('lorentz');
  const r = pade(f.taylor(a, 10), 4, 4);
  const dz = [0.15, -0.1];
  closeC(evalRational(r, dz), f.fc(C.add(a, dz)), 1e-9);
  // poles reported relative to the centre: +-i - a
  const p = poles(r).filter((z) => C.abs(z) < 2);
  assert.ok(p.some((z) => C.abs(C.sub(z, C.sub([0, 1], a))) < 1e-8));
  assert.ok(p.some((z) => C.abs(C.sub(z, C.sub([0, -1], a))) < 1e-8));
});

test('polyRoots', () => {
  // (z-1)(z-2)(z-3)
  const r = polyRoots([[-6, 0], [11, 0], [-6, 0], [1, 0]]).map((z) => z[0]).sort((a, b) => a - b);
  [1, 2, 3].forEach((v, k) => close(r[k], v, 1e-10));
  // z^2 + 1
  const c = sortByArg(polyRoots([[1, 0], [0, 0], [1, 0]]));
  closeC(c[0], [0, -1], 1e-12); closeC(c[1], [0, 1], 1e-12);
  // roots at 0 and negligible leading coefficient
  const z0 = polyRoots([[0, 0], [0, 0], [1, 0], [0, 0]]);
  assert.equal(z0.length, 2);
  z0.forEach((z) => closeC(z, [0, 0], 1e-12));
  assert.deepEqual(polyRoots([[5, 0]]), []);
  assert.deepEqual(polyRoots([[0, 0]]), []);
  closeC(polyRoots([[2, 0], [4, 0]])[0], [-0.5, 0]);
  // degree 12 with known roots 1..12 scaled: Wilkinson-like check on residuals
  const rts = Array.from({ length: 8 }, (_, k) => [Math.cos(k), Math.sin(k)]);
  let p = [[1, 0]];
  for (const rt of rts) {
    const q = Array.from({ length: p.length + 1 }, () => [0, 0]);
    p.forEach((c0, k) => { q[k + 1] = C.add(q[k + 1], c0); q[k] = C.sub(q[k], C.mul(c0, rt)); });
    p = q;
  }
  const found = polyRoots(p);
  assert.equal(found.length, 8);
  for (const rt of rts) assert.ok(found.some((z) => C.abs(C.sub(z, rt)) < 1e-9), `missing ${rt}`);
  for (const z of found) assert.ok(C.abs(hornerComplex(p, z)) < 1e-9);
});
