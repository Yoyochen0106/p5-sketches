import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../lib/complex.js';
import { closeC, close } from './helpers.js';

test('basic arithmetic', () => {
  closeC(C.add([1, 2], [3, -4]), [4, -2]);
  closeC(C.sub([1, 2], [3, -4]), [-2, 6]);
  closeC(C.mul([1, 2], [3, 4]), [-5, 10]);
  closeC(C.div([-5, 10], [3, 4]), [1, 2]);
  closeC(C.div([1, 0], [0, 1]), [0, -1]);
  closeC(C.div([1, 1], [1e-200, 3e-200]), [4e199, -2e199], 1e-12);
  closeC(C.scale([1, -2], 3), [3, -6]);
  closeC(C.neg([1, -2]), [-1, 2]);
  closeC(C.conj([1, -2]), [1, 2]);
  close(C.abs([3, 4]), 5);
  close(C.arg([0, 1]), Math.PI / 2);
  closeC(C.fromPolar(2, Math.PI), [-2, 0]);
  assert.deepEqual(C.ONE, [1, 0]);
  assert.deepEqual(C.ZERO, [0, 0]);
  assert.deepEqual(C.I, [0, 1]);
});

test('exp / log', () => {
  closeC(C.exp([0, Math.PI]), [-1, 0], 1e-15);
  closeC(C.exp([1, 0]), [Math.E, 0]);
  closeC(C.log([-1, 0]), [0, Math.PI]);
  const z = [0.3, -1.7];
  closeC(C.log(C.exp(z)), z);
  closeC(C.exp(C.log(z)), z);
});

test('sqrt principal branch', () => {
  closeC(C.sqrt([-4, 0]), [0, 2]);
  closeC(C.sqrt([0, 2]), [1, 1]);
  closeC(C.sqrt([3, -4]), [2, -1]);
  closeC(C.sqrt([-3, -4]), [1, -2]);
  closeC(C.sqrt([0, 0]), [0, 0]);
  for (const z of [[1, 2], [-3, 0.5], [-0.1, -7], [5, 0]]) {
    const s = C.sqrt(z);
    closeC(C.mul(s, s), z);
    assert.ok(s[0] >= 0);
  }
});

test('pow / powInt', () => {
  closeC(C.powInt([1, 1], 4), [-4, 0]);
  closeC(C.powInt([0, 1], 3), [0, -1]);
  closeC(C.powInt([2, 0], -3), [0.125, 0]);
  closeC(C.powInt([1.5, -2], 0), [1, 0]);
  closeC(C.pow([-8, 0], [1 / 3, 0]), [1, Math.sqrt(3)], 1e-12);
  closeC(C.pow([0, 1], [0, 1]), [Math.exp(-Math.PI / 2), 0]); // i^i
  closeC(C.pow([2, 0], [10, 0]), [1024, 0]);
  closeC(C.pow([0, 0], [2, 0]), [0, 0]);
  closeC(C.pow([0, 0], [0, 0]), [1, 0]);
});

test('trig and hyperbolic identities', () => {
  for (const z of [[0.4, 0.7], [-1.2, 0.3], [2, -1.5]]) {
    const s = C.sin(z), c = C.cos(z);
    closeC(C.add(C.mul(s, s), C.mul(c, c)), [1, 0]);
    const sh = C.sinh(z), ch = C.cosh(z);
    closeC(C.sub(C.mul(ch, ch), C.mul(sh, sh)), [1, 0]);
    closeC(C.tan(z), C.div(s, c));
    closeC(C.tanh(z), C.div(sh, ch));
    // sin(iz) = i sinh(z)
    closeC(C.sin(C.mul(C.I, z)), C.mul(C.I, sh));
    closeC(C.cos(C.mul(C.I, z)), ch);
    // atan(tan z) = z for |Re z| < pi/2
    if (Math.abs(z[0]) < Math.PI / 2) closeC(C.atan(C.tan(z)), z, 1e-11);
  }
  closeC(C.sin([0, 1]), [0, Math.sinh(1)]);
  closeC(C.tan([0.5, 0]), [Math.tan(0.5), 0]);
  closeC(C.tanh([0.5, 0]), [Math.tanh(0.5), 0]);
});

test('tan/tanh saturate without NaN for huge arguments', () => {
  closeC(C.tan([1, 500]), [0, 1]);
  closeC(C.tanh([500, 1]), [1, 0]);
  closeC(C.tanh([-500, 1]), [-1, 0]);
});

test('atan values and branch cuts', () => {
  closeC(C.atan([1, 0]), [Math.PI / 4, 0]);
  closeC(C.atan([0, 0.5]), [0, Math.atanh(0.5)]);
  closeC(C.atan([2, 1]), [1.1780972450961724, 0.1732867951399863]);
  // branch cut on the imaginary axis |Im| > 1: limit from the right is +pi/2
  closeC(C.atan([1e-12, 2]), [Math.PI / 2, Math.atanh(0.5)], 1e-9);
});
