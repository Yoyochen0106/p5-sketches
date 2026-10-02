import test from 'node:test';
import assert from 'node:assert/strict';
import { routhArray, stabilityRangeK, jwCrossingsK, routhAtK } from '../../lib/ctrl/routh.js';
import { polyFromRoots, polyRoots } from '../../lib/ctrl/tf.js';
import { close, rng } from './helpers.js';

test('Routh table of s^3 + 2s^2 + 3s + 1 (stable) and s^3 + s^2 + 2s + 8 (two RHP roots)', () => {
  const a = routhArray([1, 2, 3, 1]);
  assert.ok(a.stable); assert.equal(a.rhp, 0);
  close(a.rows[2][0], 2.5);
  const b = routhArray([1, 1, 2, 8]);
  assert.equal(b.rhp, 2); assert.ok(!b.stable);
});

test('zero in the first column: s^4 + s^3 + 2s^2 + 2s + 3 has 2 RHP roots', () => {
  const r = routhArray([1, 1, 2, 2, 3]);
  assert.ok(r.zeroInFirstColumn);
  assert.equal(r.rhp, 2);
});

test('zero row: roots on the jw axis are counted from the auxiliary polynomial', () => {
  const p = polyFromRoots([[0, 1], [0, -1], -1, -2]);
  const r = routhArray(p);
  assert.ok(r.zeroRow || r.zeroInFirstColumn);
  assert.equal(r.rhp, 0); assert.equal(r.imag, 2); assert.equal(r.lhp, 2);
  assert.ok(r.marginal && !r.stable);
  const q = polyFromRoots([[0, 2], [0, -2], [-1, 1], [-1, -1], 1]);
  const rq = routhArray(q);
  assert.equal(rq.rhp, 1); assert.equal(rq.imag, 2);
});

test('Routh agrees with root finding on random polynomials', () => {
  const rand = rng(11);
  for (let trial = 0; trial < 300; trial++) {
    const nPairs = Math.floor(rand() * 3), nReal = 1 + Math.floor(rand() * 3);
    const roots = [];
    for (let i = 0; i < nReal; i++) { let x = (rand() - 0.5) * 6; if (Math.abs(x) < 0.2) x += 0.5; roots.push(x); }
    for (let i = 0; i < nPairs; i++) {
      let re = (rand() - 0.5) * 4; if (Math.abs(re) < 0.2) re += 0.4;
      const im = 0.3 + rand() * 3;
      roots.push([re, im], [re, -im]);
    }
    const p = polyFromRoots(roots, 0.5 + rand());
    const expected = roots.filter((r) => (Array.isArray(r) ? r[0] : r) > 0).length;
    const got = routhArray(p).rhp;
    assert.equal(got, expected, `trial ${trial}: ${JSON.stringify(roots)}`);
    assert.equal(got, polyRoots(p).filter((r) => r[0] > 0).length);
  }
});

test('stability range of K for K/(s(s+1)(s+5)): 0 < K < 30, crossing at w = sqrt(5)', () => {
  const num = [1], den = [1, 6, 5, 0];
  const res = stabilityRangeK(num, den);
  assert.equal(res.intervals.length, 1);
  close(res.intervals[0][0], 0, 1e-9); close(res.intervals[0][1], 30, 1e-9);
  close(res.kMax, 30, 1e-9);
  const c = res.critical.find((x) => x.K > 1);
  close(c.K, 30, 1e-9); close(c.w, Math.sqrt(5), 1e-9);
  const t = routhAtK(num, den, 30);
  assert.ok(t.zeroRow); assert.equal(t.imag, 2);
  assert.ok(routhAtK(num, den, 20).stable);
  assert.equal(routhAtK(num, den, 40).rhp, 2);
});

test('parametric range with zeros and order drop', () => {
  const res = stabilityRangeK([1, 2], [1, 1, 1]); // s^2 + (1+K)s + 1 + 2K
  assert.equal(res.intervals.length, 1);
  close(res.intervals[0][0], -0.5, 1e-9); assert.equal(res.intervals[0][1], Infinity);
  const r2 = stabilityRangeK([1], [1, -1]); // s - 1 + K
  close(r2.intervals[0][0], 1, 1e-9);
  assert.ok(jwCrossingsK([1], [1, 2, 2, 1, 0]).length >= 1);
});
