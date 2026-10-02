import test from 'node:test';
import assert from 'node:assert/strict';
import { realAlg, complexAlg, seriesAlg, seriesVariable } from '../../lib/algebra.js';
import * as C from '../../lib/complex.js';
import { hornerComplex } from '../../lib/poly.js';
import { close, closeC } from './helpers.js';

const ser = (n, c, def) => def(seriesAlg(n, c), seriesVariable(n, c));
const reParts = (s) => s.map((z) => z[0]);
const fact = (k) => (k <= 1 ? 1 : k * fact(k - 1));

function assertCoefs(series, expected, tol = 1e-13, label = '') {
  assert.equal(series.length, expected.length, `${label} length`);
  expected.forEach((e, k) => {
    close(series[k][0], e, tol, `${label} coef ${k} re`);
    assert.ok(Math.abs(series[k][1]) <= tol, `${label} coef ${k} im = ${series[k][1]}`);
  });
}

const N = 10;
const range = Array.from({ length: N + 1 }, (_, k) => k);

test('seriesVariable', () => {
  assert.deepEqual(seriesVariable(3, 2), [[2, 0], [1, 0], [0, 0], [0, 0]]);
  assert.deepEqual(seriesVariable(2, [1, -1]), [[1, -1], [1, 0], [0, 0]]);
  assert.deepEqual(seriesVariable(0, 5), [[5, 0]]);
});

test('series of sin, cos, exp, sinh, cosh about 0 match closed forms (order 10)', () => {
  const sgn = (k) => (k % 2 ? -1 : 1);
  assertCoefs(ser(N, 0, (A, x) => A.sin(x)), range.map((k) => (k % 2 ? sgn((k - 1) / 2) / fact(k) : 0)), 1e-15, 'sin');
  assertCoefs(ser(N, 0, (A, x) => A.cos(x)), range.map((k) => (k % 2 ? 0 : sgn(k / 2) / fact(k))), 1e-15, 'cos');
  assertCoefs(ser(N, 0, (A, x) => A.exp(x)), range.map((k) => 1 / fact(k)), 1e-15, 'exp');
  assertCoefs(ser(N, 0, (A, x) => A.sinh(x)), range.map((k) => (k % 2 ? 1 / fact(k) : 0)), 1e-15, 'sinh');
  assertCoefs(ser(N, 0, (A, x) => A.cosh(x)), range.map((k) => (k % 2 ? 0 : 1 / fact(k))), 1e-15, 'cosh');
});

test('series of atan, 1/(1+x^2), ln(1+x), 1/(1-x), sqrt(1+x) about 0', () => {
  assertCoefs(ser(N, 0, (A, x) => A.atan(x)),
    range.map((k) => (k % 2 ? (((k - 1) / 2) % 2 ? -1 : 1) / k : 0)), 1e-15, 'atan');
  assertCoefs(ser(N, 0, (A, x) => A.div(A.one, A.add(A.one, A.mul(x, x)))),
    range.map((k) => (k % 2 ? 0 : (k / 2) % 2 ? -1 : 1)), 1e-15, 'lorentz');
  assertCoefs(ser(N, 0, (A, x) => A.log(A.add(A.one, x))),
    range.map((k) => (k === 0 ? 0 : (k % 2 ? 1 : -1) / k)), 1e-15, 'ln1p');
  assertCoefs(ser(N, 0, (A, x) => A.div(A.one, A.sub(A.one, x))), range.map(() => 1), 1e-15, 'geom');
  // binomial(1/2, k)
  const binom = [1];
  for (let k = 1; k <= N; k++) binom.push((binom[k - 1] * (0.5 - (k - 1))) / k);
  assertCoefs(ser(N, 0, (A, x) => A.sqrt(A.add(A.one, x))), binom, 1e-15, 'sqrt1p');
  assertCoefs(ser(N, 0, (A, x) => A.pow(A.add(A.one, x), -2)),
    range.map((k) => (k % 2 ? -1 : 1) * (k + 1)), 1e-15, '(1+x)^-2');
});

test('series of tanh and tan about 0 match Bernoulli-number closed forms', () => {
  const tanh = [0, 1, 0, -1 / 3, 0, 2 / 15, 0, -17 / 315, 0, 62 / 2835, 0];
  assertCoefs(ser(N, 0, (A, x) => A.tanh(x)), tanh, 1e-15, 'tanh');
  const tan = tanh.map((c, k) => (k % 4 === 3 ? -c : c)); // tan(x) = -i tanh(ix)
  assertCoefs(ser(N, 0, (A, x) => A.tan(x)), tan, 1e-15, 'tan');
  // tanh up to order 12 (adds -1382/155925)
  const t12 = ser(12, 0, (A, x) => A.tanh(x));
  close(t12[11][0], -1382 / 155925, 1e-15);
});

test('composite: exp(sin x) and sin(x)/x', () => {
  // exp(sin x) = 1 + x + x^2/2 - x^4/8 - x^5/15 - x^6/240 + x^7/90 + ...
  const s = ser(8, 0, (A, x) => A.exp(A.sin(x)));
  assertCoefs(s, [1, 1, 1 / 2, 0, -1 / 8, -1 / 15, -1 / 240, 1 / 90, 31 / 5760], 1e-15, 'exp(sin)');
  // sin(x)/x with exact leading-zero shift: only the top coefficient is lost (stays 0)
  const sinc = ser(8, 0, (A, x) => A.div(A.sin(x), x));
  assertCoefs(sinc.slice(0, 8), [1, 0, -1 / 6, 0, 1 / 120, 0, -1 / 5040, 0], 1e-15, 'sinc');
});

test('Taylor coefficients about a real nonzero centre match derivative formulas', () => {
  const a = 0.7;
  // sin: f^(k)(a)/k! = sin(a + k pi/2)/k!
  const s = ser(10, a, (A, x) => A.sin(x));
  for (let k = 0; k <= 10; k++) close(s[k][0], Math.sin(a + (k * Math.PI) / 2) / fact(k), 1e-14, `sin k=${k}`);
  // ln(x) about a: (-1)^(k+1) / (k a^k)
  const l = ser(10, a, (A, x) => A.log(x));
  close(l[0][0], Math.log(a));
  for (let k = 1; k <= 10; k++) close(l[k][0], ((k % 2 ? 1 : -1) / k) / a ** k, 1e-13, `log k=${k}`);
  // 1/(1+x^2) about a=0.5 via partial fractions: Re( 1/(i (x+i)... ) ) cross-check using geometric series of 1/(x-i)
  const lor = ser(10, 0.5, (A, x) => A.div(A.one, A.add(A.one, A.mul(x, x))));
  // 1/(1+x^2) = (1/(2i)) [1/(x-i) - 1/(x+i)];  1/(x-s) about a = -sum (x-a)^k/(s-a)^(k+1)
  for (let k = 0; k <= 10; k++) {
    const term = (s) => C.scale(C.powInt(C.sub(s, [0.5, 0]), -(k + 1)), -1);
    const val = C.mul([0, -0.5], C.sub(term([0, 1]), term([0, -1])));
    closeC(lor[k], val, 1e-13, `lorentz k=${k}`);
  }
});

test('series evaluate to the complex-algebra values at complex centres (n = 40)', () => {
  const defs = {
    sin: (A, x) => A.sin(x),
    exp: (A, x) => A.exp(x),
    tanh: (A, x) => A.tanh(A.mul(A.const(0.5), x)),
    atan: (A, x) => A.atan(x),
    gauss: (A, x) => A.exp(A.neg(A.mul(x, x))),
    ln: (A, x) => A.log(A.add(A.const(3), x)),
    sqrt: (A, x) => A.sqrt(A.add(A.const(3), x)),
    mix: (A, x) => A.div(A.exp(A.sin(x)), A.add(A.const(4), A.cos(x))),
    pow: (A, x) => A.pow(A.add(A.const(3), x), 1.5),
  };
  const centers = [[0.3, 0.4], [-0.5, 0.2], [0, 0], [0.1, -0.6]];
  const ds = [[0.1, 0.05], [-0.075, 0.12], [0.15, 0], [0, -0.15]]; // |d| <= 0.4 R for the tightest case (atan, R = 0.4)
  for (const [name, def] of Object.entries(defs)) {
    for (const c of centers) {
      const s = ser(40, c, def);
      for (const d of ds) {
        const approx = hornerComplex(s, d);
        const exact = def(complexAlg, C.add(c, d));
        closeC(approx, exact, 1e-9, `${name} at c=${c} d=${d}`);
      }
    }
  }
});

test('algebraic identities hold coefficient-wise', () => {
  const n = 25;
  const c = [0.3, -0.2];
  const A = seriesAlg(n, c);
  const x = seriesVariable(n, c);
  const same = (p, q, tol = 1e-12) => p.forEach((z, k) => closeC(z, q[k], tol, `k=${k}`));
  same(A.add(A.mul(A.sin(x), A.sin(x)), A.mul(A.cos(x), A.cos(x))), A.one);
  same(A.sub(A.mul(A.cosh(x), A.cosh(x)), A.mul(A.sinh(x), A.sinh(x))), A.one);
  same(A.exp(A.log(A.add(A.const(2), x))), A.add(A.const(2), x));
  same(A.log(A.exp(x)), x);
  same(A.mul(A.div(A.cos(x), A.add(A.const(5), x)), A.add(A.const(5), x)), A.cos(x));
  same(A.mul(A.sqrt(A.add(A.const(2), x)), A.sqrt(A.add(A.const(2), x))), A.add(A.const(2), x));
  same(A.tan(x), A.div(A.sin(x), A.cos(x)));
  same(A.sub(A.neg(x), A.neg(x)), A.zero);
  // d/dx tanh = 1 - tanh^2 : differentiate the coefficients
  const t = A.tanh(x);
  const dt = t.slice(1).map((z, k) => C.scale(z, k + 1));
  const rhs = A.sub(A.one, A.mul(t, t)).slice(0, n);
  same(dt, rhs, 1e-11);
  // d/dx atan = 1/(1+x^2)
  const at = A.atan(x);
  const dat = at.slice(1).map((z, k) => C.scale(z, k + 1));
  same(dat, A.div(A.one, A.add(A.one, A.mul(x, x))).slice(0, n), 1e-11);
});

test('numerical stability at n = 40 about 0', () => {
  const s = ser(40, 0, (A, x) => A.exp(A.sin(x)));
  const v = hornerComplex(s, [0.5, 0]);
  close(v[0], Math.exp(Math.sin(0.5)), 1e-14);
  const t = ser(40, 0, (A, x) => A.atan(x));
  close(hornerComplex(t, [0.5, 0])[0], Math.atan(0.5), 1e-14);
  const g = ser(40, 0, (A, x) => A.div(A.one, A.add(A.one, A.mul(A.const(25), A.mul(x, x)))));
  close(hornerComplex(g, [0.1, 0])[0], 1 / (1 + 0.25), 1e-12);
  for (const z of s) assert.ok(Number.isFinite(z[0]) && Number.isFinite(z[1]));
});

test('real and complex algebras agree with Math / complex.js', () => {
  const def = (A, x) => A.add(A.mul(A.sin(x), A.exp(A.neg(x))), A.sqrt(A.add(A.one, A.mul(x, x))));
  const r = def(realAlg, 0.8);
  close(r, Math.sin(0.8) * Math.exp(-0.8) + Math.sqrt(1 + 0.64), 1e-15);
  closeC(def(complexAlg, [0.8, 0]), [r, 0], 1e-14);
  assert.equal(realAlg.pow(2, 3), 8);
  closeC(complexAlg.pow([0, 1], 2), [-1, 0], 1e-15);
  assert.equal(realAlg.one, 1);
  assert.deepEqual(complexAlg.zero, [0, 0]);
  assert.deepEqual(complexAlg.const(2), [2, 0]);
  assert.equal(realAlg.abs(-2), 2);
});

test('seriesAlg order 0 and singular pow', () => {
  const A0 = seriesAlg(0, 1);
  assert.deepEqual(A0.exp(seriesVariable(0, 1)), [C.exp([1, 0])]);
  assert.deepEqual(A0.atan(seriesVariable(0, 1)), [[Math.PI / 4, 0]]);
  const sing = seriesAlg(3, -1).sqrt(seriesAlg(3, -1).add(seriesVariable(3, -1), seriesAlg(3, -1).one));
  assert.ok(Number.isNaN(sing[1][0]), 'sqrt at its branch point has no power series');
});
