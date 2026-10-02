import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression, parseExpressionN, compileField } from '../../lib/expr.js';
import { realAlg, complexAlg } from '../../lib/algebra.js';
import { close } from './helpers.js';

test('parseExpressionN: three variables by default', () => {
  const def = parseExpressionN('x^2+y^2+z^2-1');
  close(def(realAlg, { x: 1, y: 0, z: 0 }), 0);
  close(def(realAlg, { x: 0.5, y: 0.5, z: 0.5 }), -0.25);
  close(parseExpressionN('sin(x)*cos(y)')(realAlg, { x: 0.3, y: 0.9 }), Math.sin(0.3) * Math.cos(0.9));
  close(parseExpressionN('2x y + 3z')(realAlg, { x: 1, y: 2, z: 3 }), 13); // implicit multiplication
  close(parseExpressionN('-x^2 + y')(realAlg, { x: 3, y: 1 }), -8);
});

test('parseExpressionN: custom variable names and other algebras', () => {
  const def = parseExpressionN('u*v + e', ['u', 'v']);
  close(def(realAlg, { u: 2, v: 5 }), 10 + Math.E);
  const c = parseExpressionN('x*y', ['x', 'y'])(complexAlg, { x: [0, 1], y: [0, 1] });
  close(c[0], -1);
  close(c[1], 0);
  // a variable may shadow a constant name
  close(parseExpressionN('e + 1', ['e'])(realAlg, { e: 4 }), 5);
});

test('parseExpressionN: unknown identifiers throw with a position', () => {
  assert.throws(() => parseExpressionN('x + w'), /Unknown identifier 'w' at position 5/);
  assert.throws(() => parseExpressionN('x + z', ['x', 'y']), /Unknown identifier 'z' at position 5/);
  assert.throws(() => parseExpressionN('foo(x)'), /Unknown identifier 'foo' at position 1/);
  assert.throws(() => parseExpressionN('x +'), /position 4|end of input/);
  assert.throws(() => parseExpressionN('x', ['1bad']), /identifier/);
});

test('parseExpressionN: constant folding of exponents still works with variables', () => {
  close(parseExpressionN('x^2 * y^3')(realAlg, { x: 3, y: 2 }), 72);
  close(parseExpressionN('x^(1/2)')(realAlg, { x: 9 }), 3);
  close(parseExpressionN('2^x')(realAlg, { x: 3 }), 8);
  close(parseExpressionN('x^y')(realAlg, { x: 2, y: 5 }), 32);
});

test('compileField: real-valued function of positional arguments', () => {
  const f3 = compileField('x^2+y^2+z^2-1');
  close(f3(1, 0, 0), 0);
  close(f3(0, 2, 0), 3);
  const f2 = compileField('sin(x)*cos(y)', ['x', 'y']);
  close(f2(0.3, 0.9), Math.sin(0.3) * Math.cos(0.9));
  const fz = compileField('z - x*y');
  close(fz(2, 3, 10), 4);
  assert.throws(() => compileField('x + q'), /Unknown identifier 'q'/);
  // reusable: successive calls do not leak state
  close(f3(0, 0, 0), -1);
});

test('single-variable parseExpression is unchanged and ignores y/z', () => {
  close(parseExpression('x^2 + 1')(realAlg, 3), 10);
  assert.throws(() => parseExpression('x + y'), /Unknown identifier 'y'/);
});
