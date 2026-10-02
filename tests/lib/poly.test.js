import test from 'node:test';
import assert from 'node:assert/strict';
import { hornerReal, hornerComplex, realCoefs } from '../../lib/poly.js';
import { close, closeC } from './helpers.js';

test('hornerReal evaluates using real parts', () => {
  // 1 + 2x + 3x^2 at x = 2 -> 17
  assert.equal(hornerReal([[1, 0], [2, 0], [3, 0]], 2), 17);
  assert.equal(hornerReal([[1, 5], [2, 7]], 3), 7); // imaginary parts ignored
  assert.equal(hornerReal([], 3), 0);
  assert.equal(hornerReal([[4, 0]], 100), 4);
  assert.equal(hornerReal([3, 2, 1], 1), 6); // bare numbers tolerated
});

test('hornerComplex matches direct evaluation', () => {
  const coefs = [[1, 1], [0, -2], [3, 0.5], [-1, 4]];
  const z = [0.7, -1.3];
  let direct = [0, 0];
  let zp = [1, 0];
  for (const c of coefs) {
    direct = [direct[0] + c[0] * zp[0] - c[1] * zp[1], direct[1] + c[0] * zp[1] + c[1] * zp[0]];
    zp = [zp[0] * z[0] - zp[1] * z[1], zp[0] * z[1] + zp[1] * z[0]];
  }
  closeC(hornerComplex(coefs, z), direct, 1e-14);
  closeC(hornerComplex(coefs, 2), hornerComplex(coefs, [2, 0]));
  closeC(hornerComplex([], [1, 1]), [0, 0]);
  // (1 + z)^2 at z = i -> 2i
  closeC(hornerComplex([[1, 0], [2, 0], [1, 0]], [0, 1]), [0, 2]);
});

test('realCoefs extracts real parts', () => {
  assert.deepEqual(realCoefs([[1, 2], [3, 4]]), [1, 3]);
  assert.deepEqual(realCoefs([]), []);
  close(hornerReal(realCoefs([[1, 0], [1, 0]]), 4), 5);
});
