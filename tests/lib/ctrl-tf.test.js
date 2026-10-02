import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../lib/ctrl/tf.js';
import * as M from '../../lib/ctrl/_mat.js';
import { close } from './helpers.js';

const sortRe = (rs) => rs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('polynomial arithmetic', () => {
  assert.deepEqual(T.polyMul([1, 1], [1, -1]), [1, 0, -1]);
  assert.deepEqual(T.polyAdd([1, 0, 0], [2, 1]), [1, 2, 1]);
  assert.deepEqual(T.polySub([1, 1], [1, 1]), [0]);
  assert.deepEqual(T.polyDeriv([1, 2, 3]), [2, 2]);
  close(T.polyEval([1, 2, 1], 3), 16);
  const { q, r } = T.polyDivide([1, 3, 3, 1], [1, 1]);
  assert.deepEqual(q, [1, 2, 1]); assert.deepEqual(r, [0]);
  const p = T.polyFromRoots([-1, [-2, 3], [-2, -3]], 2);
  [2, 10, 34, 26].forEach((c, i) => close(p[i], c, 1e-12));
  const rs = sortRe(T.polyRoots([1, 6, 11, 6]));
  [-3, -2, -1].forEach((v, i) => { close(rs[i][0], v, 1e-9); close(rs[i][1], 0, 1e-9); });
});

test('series, parallel, feedback algebra', () => {
  const G = T.tf([1], [1, 1]);
  const H = T.tf([1], [1, 2]);
  const S = T.tfSeries(G, H);
  assert.deepEqual(S.den, [1, 3, 2]);
  const P = T.tfParallel(G, H);
  assert.deepEqual(P.num, [2, 3]); assert.deepEqual(P.den, [1, 3, 2]);
  const L = T.tf([1], [1, 1, 0]);
  const cl = T.tfFeedback(L);
  assert.deepEqual(cl.num, [1]); assert.deepEqual(cl.den, [1, 1, 1]);
  const clH = T.tfFeedback(T.tf([1], [1, 0]), T.tf([2]));
  assert.deepEqual(clH.den, [1, 2]); // 1/(s+2)
  assert.deepEqual(T.tfFeedback(L, 1, +1).den, [1, 1, -1]);
  assert.throws(() => T.tfFeedback(T.tf([1], [1, 1], 0.5)));
  close(T.tfSeries(T.tf([1], [1, 1], 0.5), T.tf([1], [1, 2], 0.25)).delay, 0.75);
});

test('poles, zeros, dc gain, degree, properness, stability', () => {
  const G = T.parseTf('(s+3)/(s^2+3s+2)');
  const z = T.tfZeros(G), p = sortRe(T.tfPoles(G));
  close(z[0][0], -3, 1e-12);
  close(p[0][0], -2, 1e-9); close(p[1][0], -1, 1e-9);
  close(T.dcGain(G), 1.5);
  assert.equal(T.relativeDegree(G), 1);
  assert.ok(T.isProper(G) && T.isStrictlyProper(G));
  assert.ok(!T.isProper(T.tf([1, 0, 0], [1, 1])));
  assert.ok(T.isProper(T.tf([2, 1], [1, 1])) && !T.isStrictlyProper(T.tf([2, 1], [1, 1])));
  assert.ok(T.isStable(G));
  assert.ok(!T.isStable(T.parseTf('1/(s-1)')));
  assert.ok(!T.isStable(T.parseTf('1/(s^2+1)')));
  assert.equal(T.dcGain(T.parseTf('1/(s(s+1))')), Infinity);
  assert.equal(T.dcGain(T.parseTf('s/(s+1)')), 0);
  assert.equal(T.systemType(T.parseTf('1/(s^2(s+1))')), 2);
  assert.equal(T.systemType(T.parseTf('1/(s+1)')), 0);
  close(T.limitAtZero(T.parseTf('2/(s(s+4))'), 1), 0.5);
});

test('evaluate H(s) incl. delay, second-order form', () => {
  const G = T.parseTf('1/(s+1)');
  const v = T.evalJw(G, 1);
  close(v[0], 0.5); close(v[1], -0.5);
  const D = T.tf([1], [1, 1], 2);
  const vd = T.evalJw(D, 1);
  close(Math.hypot(vd[0], vd[1]), Math.SQRT1_2);
  close(Math.atan2(vd[1], vd[0]), -Math.PI / 4 - 2 + 2 * Math.PI * 0, 1e-12);
  const so = T.secondOrder(0.5, 4, 2);
  close(so.num[0], 32); assert.deepEqual(so.den, [1, 4, 16]);
  const sp = T.secondOrderParams(so);
  close(sp.zeta, 0.5); close(sp.wn, 4); close(sp.K, 2);
});

test('minimal cancellation', () => {
  const G = T.tfSeries(T.parseTf('(s+1)/(s+2)'), T.parseTf('1/(s+1)'));
  const m = T.minreal(G);
  assert.equal(m.den.length, 2); close(m.den[1] / m.den[0], 2, 1e-6);
  const two = T.minreal(T.parseTf('(s+1)/(s^2+2s+1)'));
  assert.equal(two.den.length, 2);
  assert.equal(T.minreal(T.parseTf('(s+3)/((s+1)(s+2))')).den.length, 3);
});

test('parse and format round trip', () => {
  for (const s of ['(s+1)/(s^2+2s+1)', '5/(s(s+1)(s+5))', '2*(s+3)/(s^2+4)', '1/(0.5s+1)*exp(-2s)', '-s/(s-1)', '1/s(s+1)', 'e^(-0.3s)/(s+2)', '3', 's']) {
    const g = T.parseTf(s);
    const g2 = T.parseTf(T.formatTf(g));
    assert.deepEqual(g2.num.map((x) => +x.toFixed(9)), g.num.map((x) => +x.toFixed(9)), s);
    assert.deepEqual(g2.den.map((x) => +x.toFixed(9)), g.den.map((x) => +x.toFixed(9)), s);
    close(g2.delay, g.delay);
  }
  assert.deepEqual(T.parseTf('1/s(s+1)').den, [1, 1, 0]);
  close(T.parseTf('exp(-2s)/(s+1)').delay, 2);
  assert.equal(T.formatPoly([1, 2, 1]), 's^2 + 2s + 1');
  assert.equal(T.formatPoly([1, 0, -4]), 's^2 - 4');
  assert.throws(() => T.parseTf('1/(s+'));
  assert.throws(() => T.parseTf('foo/(s+1)'));
});

test('Pade delay approximation and withPade', () => {
  const P = T.padeDelay(1, 2);
  close(P.num[2] / P.den[2], 1, 1e-12);
  const v = T.evalJw(P, 0.5), e = T.evalJw(T.tf([1], [1], 1), 0.5);
  close(v[0], e[0], 1e-3); close(v[1], e[1], 1e-3);
  const G = T.withPade(T.tf([1], [1, 1], 0.5), 3);
  assert.equal(G.delay, 0); assert.equal(G.den.length, 5);
});

test('_mat: expm, det, charPoly, solve, zoh', () => {
  const R = M.expm([[0, -1], [1, 0]]);
  close(R[0][0], Math.cos(1), 1e-13); close(R[1][0], Math.sin(1), 1e-13);
  const big = M.expm([[-50, 0], [0, -1]]);
  close(big[1][1], Math.exp(-1), 1e-13);
  const A = [[2, 1], [1, 3]];
  close(M.mdet(A), 5);
  const cp = M.charPoly(A);
  [1, -5, 5].forEach((v, i) => close(cp[i], v));
  const x = M.msolve(A, [[1], [2]]);
  close(2 * x[0][0] + x[1][0], 1); close(x[0][0] + 3 * x[1][0], 2);
  const ev = sortRe(M.eigvals([[0, 1], [-2, -3]]));
  close(ev[0][0], -2, 1e-9); close(ev[1][0], -1, 1e-9);
  const { Ad, Bd } = M.zohMatrices([[-1]], [[1]], 0.5);
  close(Ad[0][0], Math.exp(-0.5)); close(Bd[0][0], 1 - Math.exp(-0.5));
});
