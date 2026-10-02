import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../lib/em/array.js';

const near = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const deg = (r) => (r * 180) / Math.PI;

test('element patterns and their known directivities', () => {
  near(A.elementPattern('short', Math.PI / 2), 1);
  near(A.elementPattern('short', 0), 0);
  near(A.elementPattern('half', Math.PI / 2), 1);
  near(A.elementPattern('half', 0.0), 0);
  near(A.elementPattern('patch', 0), 1);
  near(A.elementPattern('patch', Math.PI * 0.6), 0);
  near(A.elementPattern('iso', 1.234), 1);
  // numeric directivity of a single element: D = 2 F^2max / int F^2 sin
  for (const [type, D] of [['iso', 1], ['short', 1.5], ['half', 1.6409]]) {
    const n = 4000;
    const theta = new Float64Array(n + 1), mag = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) { theta[i] = (Math.PI * i) / n; mag[i] = A.elementPattern(type, theta[i]); }
    near(A.directivityFromSamples({ theta, mag }).directivity, D, 2e-3, type);
  }
});

test('array factor is the DFT of the weights', () => {
  const w = A.chebyshevWeights(9, 25);
  const { psi, mag } = A.weightSpectrum(w, 256);
  for (let k = 0; k < 256; k += 7) near(mag[k], A.afMag(w, psi[k]), 1e-9);
  // Parseval: sum |W(psi_k)|^2 / M = sum w^2
  let e = 0;
  for (let k = 0; k < mag.length; k++) e += mag[k] * mag[k];
  near(e / mag.length, w.reduce((s, v) => s + v * v, 0), 1e-9);
  // peak of a uniform array is N at psi = 0
  near(A.afMag(A.uniformWeights(8), 0), 8);
});

test('uniform array: nulls at 2 pi m / N, HPBW and directivity of the broadside array', () => {
  const N = 8, d = 0.5;
  const w = A.uniformWeights(N);
  const nulls = A.uniformNulls(N, d, 0);
  assert.equal(nulls.length, 8); // includes the two end-fire nulls at theta = 0 and 180 deg
  for (const th of nulls) near(A.afMag(w, A.psiOf(d, th, 0)), 0, 1e-9);
  const S = A.sampleLinear(w, d, 0, 'iso', 3600);
  const an = A.analyzePattern(S);
  near(deg(an.mainTheta), 90, 0.1);
  // first sidelobe of a uniform array is -13.26 dB
  let best = 0;
  for (let k = 0; k <= 4000; k++) best = Math.max(best, Math.abs(Math.sin((N * ((2 + 2 * k / 4000) * Math.PI / N)) / 2) / (N * Math.sin(((2 + 2 * k / 4000) * Math.PI / N) / 2))));
  near(an.sllDb, 20 * Math.log10(best), 0.05);
  assert.ok(an.sllDb < -12.5 && an.sllDb > -13.3);
  // broadside HPBW ~ 0.886 lambda/(N d) rad (large N): within 6%
  const approx = (0.886 / (N * d)) * (180 / Math.PI);
  assert.ok(Math.abs(deg(an.hpbw) - approx) / approx < 0.06, `${deg(an.hpbw)} vs ${approx}`);
  // directivity ~ 2 N d for a broadside array of isotropic elements (d = lambda/2 -> N)
  near(an.directivity, N, 0.25);
  assert.equal(an.grating.length, 0);
});

test('steering: main beam lands on theta0, end-fire needs beta = -k d', () => {
  const N = 10, d = 0.5, w = A.uniformWeights(N);
  for (const t0 of [60, 75, 120]) {
    const b = A.steeringBeta(d, (t0 * Math.PI) / 180);
    const an = A.analyzePattern(A.sampleLinear(w, d, b, 'iso', 1800));
    near(deg(an.mainTheta), t0, 0.15, `theta0=${t0}`);
  }
  near(A.steeringBeta(0.5, 0), -Math.PI);
  const an = A.analyzePattern(A.sampleLinear(w, d, A.steeringBeta(d, 0), 'iso', 1800));
  near(deg(an.mainTheta), 0, 0.15);
  assert.equal(an.hpbwEdge, true);
});

test('grating lobes appear for d > lambda/2 and match the closed form', () => {
  const g1 = A.gratingAngles(0.5, 0);
  assert.equal(g1.length, 1);
  near(deg(g1[0].theta), 90, 1e-9);
  const g2 = A.gratingAngles(1.0, 0);
  assert.ok(g2.length >= 3); // broadside + two at 0 and 180 deg
  const w = A.uniformWeights(8);
  const an = A.analyzePattern(A.sampleLinear(w, 1.0, 0, 'iso', 3600));
  assert.ok(an.grating.length >= 1, 'a grating lobe equals the main lobe');
  near(A.maxSpacingNoGrating(Math.PI / 2), 1);
  near(A.maxSpacingNoGrating(0), 0.5);
  // steering to 40 degrees with d = 0.6 lambda: d > 1/(1+cos40) = 0.566 -> a grating lobe appears
  const b = A.steeringBeta(0.6, (40 * Math.PI) / 180);
  assert.ok(A.gratingAngles(0.6, b).length >= 2);
  const b2 = A.steeringBeta(0.5, (40 * Math.PI) / 180);
  assert.equal(A.gratingAngles(0.5, b2).length, 1);
});

test('Dolph-Chebyshev weights give the requested sidelobe level', () => {
  for (const [N, sll] of [[8, 30], [9, 30], [12, 40], [15, 25], [16, 35]]) {
    const w = A.chebyshevWeights(N, sll);
    assert.equal(w.length, N);
    for (let i = 0; i < N; i++) near(w[i], w[N - 1 - i], 1e-9, 'symmetric');
    near(Math.max(...w), 1);
    const an = A.analyzePattern(A.sampleLinear(w, 0.5, 0, 'iso', 7200));
    near(an.sllDb, -sll, 0.15, `N=${N} sll=${sll}`);
  }
});

test('binomial weights have no sidelobes for d = lambda/2; Taylor ~ requested SLL; windows are symmetric', () => {
  const b = A.binomialWeights(7);
  near(b[3], 1);
  near(b[0], 1 / 20, 1e-12);
  const an = A.analyzePattern(A.sampleLinear(b, 0.5, 0, 'iso', 3600));
  assert.equal(an.sllDb, -Infinity);
  const t = A.taylorWeights(20, 30, 5);
  const at = A.analyzePattern(A.sampleLinear(t, 0.5, 0, 'iso', 7200));
  assert.ok(Math.abs(at.sllDb + 30) < 1.5, `${at.sllDb}`);
  for (const k of ['hamming', 'hann', 'blackman', 'triangular', 'cosine']) {
    const w = A.windowWeights(k, 11);
    near(w[0], w[10], 1e-12);
    near(w[5], 1, 1e-12);
  }
  // tapering lowers sidelobes and widens the beam compared to uniform
  const u = A.analyzePattern(A.sampleLinear(A.uniformWeights(16), 0.5, 0, 'iso', 3600));
  const h = A.analyzePattern(A.sampleLinear(A.windowWeights('hamming', 16), 0.5, 0, 'iso', 3600));
  assert.ok(h.sllDb < u.sllDb - 15 && h.hpbw > u.hpbw);
  assert.equal(A.weightsFor('chebyshev', 6, 30).length, 6);
  assert.equal(A.weightsFor('nope', 4)[0], 1);
});

test('planar array: separable AF, steering and 3D mesh', () => {
  const wx = A.uniformWeights(6), wy = A.uniformWeights(6);
  const th0 = 0.6, ph0 = 0.9;
  const { bx, by } = A.planarSteering(0.5, 0.5, th0, ph0);
  near(A.planarAF(wx, wy, 0.5, 0.5, bx, by, th0, ph0), 36, 1e-9);
  // separability
  const th = 1.1, ph = 2.3;
  near(A.planarAF(wx, wy, 0.5, 0.5, 0, 0, th, ph), A.afMag(wx, Math.PI * Math.sin(th) * Math.cos(ph)) * A.afMag(wy, Math.PI * Math.sin(th) * Math.sin(ph)), 1e-9);
  const S = A.samplePlanar({ wx, wy, dx: 0.5, dy: 0.5, bx: 0, by: 0, elem: 'iso', nTheta: 90, nPhi: 180 });
  near(S.max, 36, 1e-6);
  // a 6x6 half-wave spaced array looking along z (full sphere, iso elements): D ~ pi * N (about 4 pi A / lambda^2 / 2)
  assert.ok(S.directivity > 20 && S.directivity < 80, `${S.directivity}`);
  const mesh = A.patternMesh(S, -40);
  assert.equal(mesh.positions.length, (91) * (181) * 3);
  assert.equal(mesh.indices.length, 90 * 180 * 6);
  assert.ok(Number.isFinite(mesh.positions.reduce((s, v) => s + v, 0)));
  // peak radius is 1 on the axis
  near(mesh.positions[2], 1, 1e-6);
});
