import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTf, tf, evalJw } from '../../lib/ctrl/tf.js';
import { step, secondOrderStep } from '../../lib/ctrl/response.js';
import { secondOrder } from '../../lib/ctrl/tf.js';
import { c2d, zPoles, zZeros, isStableZ, dcGainZ, evalZ, freqResponseZ, stepResponseZ, impulseResponseZ, simulateDifference,
  differenceCoefficients, formatDifferenceEquation, sToZ, zToS, mapS, imagAxisImage, dampingLineToZ, sigmaLineToZ, wnArcToZ, zPoleSpecs,
  aliasFrequency, sampleSine, tustinWarp, tustinUnwarp, nyquistFrequency, tfz, seriesZ, feedbackZ, polesToZ, spectralRadius } from '../../lib/ctrl/discretize.js';
import { close } from './helpers.js';

test('ZOH step invariance: discrete step response equals the continuous samples', () => {
  const Ts = 0.1;
  for (const G of [parseTf('1/(s+1)'), parseTf('(s+3)/(s^2+3s+2)'), secondOrder(0.4, 3), parseTf('1/(s(s+2))'), parseTf('2/(s^2+1)')]) {
    const Hd = c2d(G, Ts, 'zoh');
    const r = step(G, { dt: Ts, n: 60 });
    const d = stepResponseZ(Hd, 61);
    for (let k = 0; k <= 60; k += 5) close(d.y[k], r.y[k], 1e-8, `k=${k}`);
  }
  // first-order closed form: y[k] = 1 - exp(-k Ts)
  const H = c2d(parseTf('1/(s+1)'), 0.5);
  close(H.den[1], -Math.exp(-0.5), 1e-12); close(H.num[H.num.length - 1], 1 - Math.exp(-0.5), 1e-12);
  close(dcGainZ(H), 1, 1e-12);
});

test('ZOH of a delayed plant adds whole-sample delay', () => {
  const H = c2d(tf([1], [1, 1], 0.3), 0.1);
  assert.equal(H.den.length, 2 + 3);
  const y = stepResponseZ(H, 12).y;
  close(y[3], 0, 1e-12); assert.ok(y[4] > 0.05);
});

test('Tustin maps the imaginary axis onto the unit circle and warps frequency by tan', () => {
  const Ts = 0.2;
  for (const w of [0.1, 1, 5, 12]) {
    const z = mapS([0, w], Ts, 'tustin');
    close(Math.hypot(...z), 1, 1e-12);
  }
  // left half plane -> inside, right half plane -> outside
  assert.ok(Math.hypot(...mapS([-1, 3], Ts, 'tustin')) < 1);
  assert.ok(Math.hypot(...mapS([1, 3], Ts, 'tustin')) > 1);
  const G = parseTf('(s+2)/(s^2+3s+5)');
  const H = c2d(G, Ts, 'tustin');
  for (const wd of [0.3, 2, 8]) {
    const wa = tustinWarp(wd, Ts);
    const a = freqResponseZ(H, wd), b = evalJw(G, wa);
    close(a[0], b[0], 1e-9); close(a[1], b[1], 1e-9);
    close(tustinUnwarp(wa, Ts), wd, 1e-12);
  }
  // prewarp: exact match at wc
  const Hp = c2d(G, Ts, 'tustin', { wc: 3 });
  const a = freqResponseZ(Hp, 3), b = evalJw(G, 3);
  close(a[0], b[0], 1e-9); close(a[1], b[1], 1e-9);
  // image of the imaginary axis of the exact map is also the unit circle
  assert.ok(imagAxisImage(Ts, 'exact').every((z) => Math.abs(Math.hypot(...z) - 1) < 1e-12));
});

test('Euler methods: forward can destabilise, backward cannot; DC gains preserved', () => {
  const G = parseTf('10/(s+10)');
  const Ts = 0.3;
  const f = c2d(G, Ts, 'forward'), b = c2d(G, Ts, 'backward');
  close(zPoles(f)[0][0], 1 - 10 * Ts, 1e-12); assert.ok(!isStableZ(f));
  close(zPoles(b)[0][0], 1 / (1 + 10 * Ts), 1e-12); assert.ok(isStableZ(b));
  close(dcGainZ(f), 1, 1e-12); close(dcGainZ(b), 1, 1e-12);
  assert.ok(isStableZ(c2d(G, Ts, 'zoh')) && isStableZ(c2d(G, Ts, 'tustin')));
  assert.equal(c2d(G, Ts, 'tustin').num.length, 2); // bilinear adds a zero at -1
  close(zZeros(c2d(G, Ts, 'tustin'))[0][0], -1, 1e-12);
});

test('pole-zero matching: poles at e^{pTs}, extra zeros at -1, DC gain matched', () => {
  const G = parseTf('(s+2)/((s+1)(s+5)(s+8))');
  const Ts = 0.05;
  const H = c2d(G, Ts, 'matched');
  const zp = zPoles(H).map((p) => p[0]).sort((a, c) => a - c);
  [-8, -5, -1].map((s) => Math.exp(s * Ts)).sort((a, c) => a - c).forEach((v, i) => close(zp[i], v, 1e-9));
  const zz = zZeros(H);
  assert.equal(zz.filter((z) => Math.abs(z[0] + 1) < 1e-6).length, 1); // n-m-1 = 1 zero at -1
  close(dcGainZ(H), 2 / 40, 1e-9);
});

test('z-plane mapping: spirals, circles, specs, aliasing', () => {
  const Ts = 0.1;
  const z = sToZ([-2, 5], Ts);
  const s = zToS(z, Ts);
  close(s[0], -2, 1e-12); close(s[1], 5, 1e-12);
  const spec = zPoleSpecs(z, Ts);
  close(spec.zeta, 2 / Math.hypot(2, 5), 1e-12); close(spec.wn, Math.hypot(2, 5), 1e-12);
  // damping line: log spiral, |z| = exp(-zeta wn Ts), arg = wd Ts
  const line = dampingLineToZ(0.5, Ts, { n: 20 });
  line.forEach((p, i) => { const wn = i * (Math.PI / (Ts * Math.sqrt(0.75))) / 20; close(Math.hypot(...p), Math.exp(-0.5 * wn * Ts), 1e-12); });
  close(Math.atan2(line[20][1], line[20][0]), Math.PI, 1e-9);
  sigmaLineToZ(1, Ts).forEach((p) => close(Math.hypot(...p), Math.exp(-0.1), 1e-12));
  assert.equal(wnArcToZ(3, Ts).length, 61);
  close(aliasFrequency(9, 10), 1); close(aliasFrequency(4, 10), 4); close(aliasFrequency(26, 10), 4);
  const x = sampleSine(9, 10, 40), y = sampleSine(-1, 10, 40);
  for (let k = 0; k < 40; k++) close(x[k], y[k], 1e-9);
  close(nyquistFrequency(0.01), 50);
  assert.equal(polesToZ([[-1, 0]], 0.1).length, 1);
});

test('difference equations: coefficients, text, simulation, series and feedback', () => {
  const H = tfz([0.5], [1, -0.5], 1);
  const { a, b } = differenceCoefficients(H);
  assert.deepEqual(a, [1, -0.5]); assert.deepEqual(b, [0, 0.5]);
  assert.equal(formatDifferenceEquation(H), 'y[k] = 0.5 u[k-1] + 0.5 y[k-1]');
  const imp = impulseResponseZ(H, 6).y;
  [0, 0.5, 0.25, 0.125].forEach((v, i) => close(imp[i], v, 1e-12));
  const y = simulateDifference(H, new Float64Array(30).fill(1));
  close(y[29], 1 - 0.5 ** 29, 1e-9);
  close(evalZ(H, [1, 0])[0], 1, 1e-12);
  const L = seriesZ(tfz([1], [1, -1], 0.1), tfz([0.1], [1], 0.1)); // 0.1/(z-1)
  const T = feedbackZ(L); // 0.1/(z-0.9)
  close(zPoles(T)[0][0], 0.9, 1e-12);
  close(spectralRadius(T), 0.9, 1e-12);
});
