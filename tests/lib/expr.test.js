import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../../lib/expr.js';
import { realAlg, complexAlg, seriesAlg, seriesVariable } from '../../lib/algebra.js';
import { close } from './helpers.js';

const real = (s, x) => parseExpression(s)(realAlg, x);
const cplx = (s, z) => parseExpression(s)(complexAlg, z);
const ser = (s, n, c = 0) => parseExpression(s)(seriesAlg(n, c), seriesVariable(n, c));
const reCoefs = (s) => s.map((z) => z[0]);
const coefsClose = (got, want, tol = 1e-12) => {
  want.forEach((w, k) => {
    close(got[k][0], w, tol, `coef ${k}`);
    assert.ok(Math.abs(got[k][1]) <= tol, `im ${k}`);
  });
};

test('numbers and constants', () => {
  close(real('1e-3', 0), 0.001);
  close(real('.5 + 2.', 0), 2.5);
  close(real('pi', 0), Math.PI);
  close(real('e', 0), Math.E);
  close(real('2E2', 0), 200);
});

test('precedence and associativity', () => {
  close(real('-x^2', 3), -9);
  close(real('2^3^2', 0), 512);
  close(real('1+2*3', 0), 7);
  close(real('10-4-3', 0), 3);
  close(real('8/4/2', 0), 1);
  close(real('2^-1', 0), 0.5);
  close(real('-(x+1)^2', 2), -9);
  close(real('+x', 4), 4);
  close(real('--x', 4), 4);
});

test('implicit multiplication', () => {
  close(real('2x', 3), 6);
  close(real('2(x+1)', 3), 8);
  close(real('(x+1)(x-1)', 3), 8);
  close(real('x sin(x)', 2), 2 * Math.sin(2));
  close(real('2pi x', 1), 2 * Math.PI);
  close(real('3x^2', 2), 12);
  close(real('x(x+1)', 2), 6);
});

test('functions', () => {
  const x = 0.7;
  const cases = {
    'sin(x)': Math.sin, 'cos(x)': Math.cos, 'tan(x)': Math.tan, 'sinh(x)': Math.sinh,
    'cosh(x)': Math.cosh, 'tanh(x)': Math.tanh, 'exp(x)': Math.exp, 'ln(x)': Math.log,
    'log(x)': Math.log, 'sqrt(x)': Math.sqrt, 'atan(x)': Math.atan, 'abs(x)': Math.abs,
    'sec(x)': (v) => 1 / Math.cos(v), 'csc(x)': (v) => 1 / Math.sin(v), 'cot(x)': (v) => 1 / Math.tan(v),
    'asin(x)': Math.asin, 'acos(x)': Math.acos, 'asinh(x)': Math.asinh,
  };
  for (const [s, f] of Object.entries(cases)) close(real(s, x), f(x), 1e-12, s);
});

test('powers: integer, fractional, negative base, variable exponent', () => {
  close(real('x^3', -2), -8);
  close(real('x^-2', -2), 0.25);
  close(real('x^0', 5), 1);
  close(real('x^0.5', 4), 2);
  close(real('x^(1/2)', 9), 3);
  close(real('2^x', 3), 8, 1e-12);
  close(real('x^x', 2), 4, 1e-12);
  const z = cplx('x^2', [0, 1]);
  close(z[0], -1);
  close(z[1], 0);
});

test('complex algebra', () => {
  const z = cplx('exp(x)', [0, Math.PI]);
  close(z[0], -1, 1e-12);
  close(z[1], 0, 1e-12);
  const w = cplx('1/(1+x^2)', [2, 0]);
  close(w[0], 0.2);
});

test('series: known expansions', () => {
  const N = 8;
  coefsClose(ser('1/(1-x)', N), Array(N + 1).fill(1));
  coefsClose(ser('ln(1+x)', N), [0, 1, -1 / 2, 1 / 3, -1 / 4, 1 / 5, -1 / 6, 1 / 7, -1 / 8]);
  coefsClose(ser('exp(-x^2)', 6), [1, 0, -1, 0, 1 / 2, 0, -1 / 6]);
  coefsClose(ser('x^2*sin(x)', 6), [0, 0, 0, 1, 0, -1 / 6, 0]);
  coefsClose(ser('sin(x)/(1+x^2)', 7), [0, 1, 0, -1 - 1 / 6 + 0, 0, 0, 0, 0].map((_, k) => {
    // sin(x) * sum (-1)^j x^(2j): coefficient of x^(2m+1) = sum_{j+l=m} (-1)^j (-1)^l/(2l+1)!
    if (k % 2 === 0) return 0;
    const m = (k - 1) / 2;
    let s = 0;
    for (let l = 0; l <= m; l++) {
      let f = 1;
      for (let q = 2; q <= 2 * l + 1; q++) f *= q;
      s += ((-1) ** (m - l) * (-1) ** l) / f;
    }
    return s;
  }));
  coefsClose(ser('(1+x)^0.5', 4), [1, 0.5, -0.125, 0.0625, -0.0390625]);
  coefsClose(ser('2x(x+1)', 3), [0, 2, 2, 0]);
  // Expansion about a non-zero center: x^2 at 1 -> 1 + 2h + h^2
  coefsClose(ser('x^2', 3, 1), [1, 2, 1, 0]);
});

test('series agree with the real algebra pointwise', () => {
  const s = 'sin(x)/(1+x^2) + 3x*exp(-x)';
  const c = 0.3;
  const series = ser(s, 30, c);
  const h = 0.1;
  let v = 0;
  for (let k = series.length - 1; k >= 0; k--) v = v * h + series[k][0];
  close(v, real(s, c + h), 1e-12);
});

test('abs only in the real algebra', () => {
  close(real('abs(x)', -3), 3);
  assert.throws(() => cplx('abs(x)', [1, 0]), /abs/);
  assert.throws(() => ser('abs(x)', 3), /abs/);
});

test('errors carry positions and helpful messages', () => {
  assert.throws(() => parseExpression(''), /Empty/);
  assert.throws(() => parseExpression('1 +'), /position 4/);
  assert.throws(() => parseExpression('(1+2'), /Expected '\)'.*position 1/);
  assert.throws(() => parseExpression('1+2)'), /Unbalanced.*position 4/);
  assert.throws(() => parseExpression('foo(x)'), /Unknown identifier 'foo'.*position 1/);
  assert.throws(() => parseExpression('1 + y'), /Unknown identifier 'y'.*position 5/);
  assert.throws(() => parseExpression('sin x'), /must be followed by '\('/);
  assert.throws(() => parseExpression('2 $ 3'), /Unexpected character '\$'.*position 3/);
  assert.throws(() => parseExpression('2 3'), /Unexpected number/);
  assert.throws(() => parseExpression('x**2'), /Unexpected '\*'/);
  assert.throws(() => parseExpression('1.2.3'), /Unexpected number/);
  assert.throws(() => parseExpression('i'), /imaginary/);
});
