import test from 'node:test';
import assert from 'node:assert/strict';
import {
  besselJ, besselZeros, beamBeta, makeMode, listModes, sampleMode, combine, envelope, bilinear, maxAbs,
  modeOmega, chainSegments, drivenCoefficients, responseAmplitude, drivenField, nodalLines, segmentsToCsv,
} from '../../lib/plates.js';
import { createSand, stepSand, meanAmplitude, MAX_GRAINS } from '../../lib/sand.js';
import { marchingSquares } from '../../lib/marching.js';

const TB = { trimBoundary: true };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('besselJ matches known values and symmetries', () => {
  near(besselJ(0, 1), 0.7651976866, 1e-9);
  near(besselJ(1, 1), 0.4400505857, 1e-9);
  near(besselJ(3, 10), 0.0583793793, 1e-9);
  near(besselJ(0, 50), 0.0558123277, 1e-9);
  near(besselJ(2, 0), 0, 0);
  near(besselJ(0, 0), 1, 0);
  near(besselJ(1, -2), -besselJ(1, 2), 1e-14);
  near(besselJ(2, -2), besselJ(2, 2), 1e-14);
  // recurrence J_{n-1} + J_{n+1} = 2n/x J_n
  near(besselJ(4, 7.3) + besselJ(6, 7.3), (10 / 7.3) * besselJ(5, 7.3), 1e-12);
});

test('besselZeros reproduce tabulated zeros', () => {
  const z0 = besselZeros(0, 4);
  near(z0[0], 2.404826, 1e-6); near(z0[1], 5.520078, 1e-6); near(z0[2], 8.653728, 1e-6); near(z0[3], 11.791534, 1e-6);
  near(besselZeros(1, 1)[0], 3.831706, 1e-6);
  near(besselZeros(2, 2)[0], 5.135622, 1e-6);
  near(besselZeros(2, 2)[1], 8.417244, 1e-6);
  near(besselZeros(5, 1)[0], 8.771484, 1e-6);
  for (const x of besselZeros(3, 6)) near(besselJ(3, x), 0, 1e-9);
});

test('beam roots and shape: clamped ends', () => {
  near(beamBeta(1), 4.7300407, 1e-6);
  near(beamBeta(2), 7.8532046, 1e-6);
  near(beamBeta(3), 10.9956078, 1e-6);
  for (const m of [1, 2, 5, 12]) {
    const mode = makeMode({ shape: 'square', kind: 'clamped', m, n: 1 });
    near(mode.phi(0, 0.5), 0, 1e-6, `m=${m} left edge`);
    near(mode.phi(1, 0.5), 0, 1e-6, `m=${m} right edge`);
    assert.ok(Number.isFinite(mode.phi(0.37, 0.61)));
  }
});

test('simply supported square: eigenvalues and dispersion', () => {
  const m = makeMode({ shape: 'square', kind: 'simply', m: 2, n: 3 });
  near(m.lambda, Math.PI ** 2 * 13, 1e-9);
  near(m.phi(0.25, 0.5), Math.sin(Math.PI / 2) * Math.sin(1.5 * Math.PI), 1e-12);
  near(modeOmega(m.lambda, 'plate'), m.lambda, 0);
  near(modeOmega(m.lambda, 'membrane'), Math.sqrt(m.lambda), 1e-12);
  const rect = makeMode({ shape: 'rect', kind: 'simply', m: 2, n: 1, aspect: 2 });
  near(rect.lambda, Math.PI ** 2 * (1 + 1), 1e-9);
  assert.equal(rect.bounds.xmax, 2);
});

test('free square: Chladni combination is symmetric under swap and degenerate pairs share lambda', () => {
  const a = makeMode({ shape: 'square', kind: 'free', m: 1, n: 2, phase: 0 });
  const b = makeMode({ shape: 'square', kind: 'free', m: 1, n: 2, phase: 1 });
  near(a.lambda, b.lambda, 0);
  near(a.phi(0.2, 0.7), Math.cos(2 * Math.PI * 0.2) * Math.cos(Math.PI * 0.7) - Math.cos(Math.PI * 0.2) * Math.cos(2 * Math.PI * 0.7), 1e-12);
  // antisymmetric under x <-> y for the minus combination
  near(a.phi(0.2, 0.7), -a.phi(0.7, 0.2), 1e-12);
  near(b.phi(0.2, 0.7), b.phi(0.7, 0.2), 1e-12);
});

test('circular modes: eigenvalue is j_mn^2, rim is a node, angular dependence', () => {
  const m = makeMode({ shape: 'circle', m: 1, n: 1 });
  near(m.lambda, 3.831706 ** 2, 1e-4);
  near(m.phi(1, 0), 0, 1e-9);
  assert.equal(m.phi(2, 0), 0);
  near(m.phi(0.3, 0), -m.phi(-0.3, 0), 1e-12); // cos(theta) is odd
  const s = makeMode({ shape: 'circle', m: 2, n: 2, phase: 1 });
  near(s.phi(0.5, 0), 0, 1e-12); // sin(2 theta) = 0 on the x axis
});

test('listModes sorted by frequency with frequency ratios', () => {
  const l = listModes({ shape: 'square', kind: 'simply' }, 20, 'plate');
  assert.equal(l.length, 20);
  for (let i = 1; i < l.length; i++) assert.ok(l[i].omega >= l[i - 1].omega);
  assert.equal(l[0].spec.m, 1); assert.equal(l[0].spec.n, 1);
  near(l[0].ratio, 1, 1e-12);
  near(l[1].ratio, 5 / 2, 1e-9); // (1,2)/(2,1)
  near(l[3].ratio, 4, 1e-9); // (2,2)
  const mem = listModes({ shape: 'square', kind: 'simply' }, 3, 'membrane');
  near(mem[1].ratio, Math.sqrt(5 / 2), 1e-9);
  const c = listModes({ shape: 'circle' }, 6, 'membrane');
  near(c[0].ratio, 1, 1e-12);
  near(c[1].ratio, 3.831706 / 2.404826, 1e-5); // (1,1)
  near(c[2].ratio, 5.135622 / 2.404826, 1e-5); // (2,1)
  const f = listModes({ shape: 'square', kind: 'free' }, 6, 'plate');
  assert.ok(f.every((x) => !(x.spec.m === 0 && x.spec.n === 0)));
  assert.equal(listModes({ shape: 'rect', kind: 'clamped', aspect: 1.5 }, 20).length, 20);
});

test('sampleMode is normalised and mode grids combine linearly', () => {
  const g1 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 1, n: 1 }), 40);
  const g2 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 2, n: 1 }), 40);
  near(maxAbs(g1), 1, 1e-6);
  const u = combine([g1, g2], [0.5, 2]);
  const i = 7 + 41 * 11;
  near(u.values[i], 0.5 * g1.values[i] + 2 * g2.values[i], 1e-6);
  const e = envelope([g1, g2], [0.5, 2]);
  near(e.values[i], Math.hypot(0.5 * g1.values[i], 2 * g2.values[i]), 1e-6);
  near(bilinear(g1, 0.5, 0.5), 1, 1e-6);
});

test('time evolution u = sum a_k phi_k cos(omega_k t)', () => {
  const modes = [makeMode({ shape: 'square', kind: 'simply', m: 1, n: 1 }), makeMode({ shape: 'square', kind: 'simply', m: 2, n: 1 })];
  const grids = modes.map((m) => sampleMode(m, 32));
  const w = modes.map((m) => modeOmega(m.lambda, 'membrane'));
  const a = [1, 0.5];
  const at = (t) => combine(grids, a.map((ak, k) => ak * Math.cos(w[k] * t)));
  const u0 = at(0);
  near(u0.values[16 + 33 * 16], 1 + 0.5 * grids[1].values[16 + 33 * 16], 1e-6);
  const T = (2 * Math.PI) / w[0];
  const uq = at(T / 4); // mode 1 at a node in time
  near(uq.values[16 + 33 * 16], 0.5 * Math.cos(w[1] * T / 4) * grids[1].values[16 + 33 * 16], 1e-5);
});

test('nodal lines: (1,1) has no interior line, (2,1) a vertical line at x = 0.5', () => {
  const g11 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 1, n: 1 }), 64);
  assert.equal(nodalLines(g11, marchingSquares, TB).count, 0);
  const g21 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 2, n: 1 }), 64);
  const l = nodalLines(g21, marchingSquares, TB);
  assert.ok(l.count >= 60 && l.count <= 70, `count ${l.count}`);
  for (let k = 0; k < l.count; k++) {
    near(l.segments[4 * k], 0.5, 1e-6); near(l.segments[4 * k + 2], 0.5, 1e-6);
  }
  const g22 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 2, n: 2 }), 64);
  assert.ok(nodalLines(g22, marchingSquares, TB).count >= 120); // a cross
  const csv = segmentsToCsv(l);
  assert.equal(csv.split('\n').length, l.count + 1);
});

test('nodal lines of the circular (0,2) mode form a ring at r = j01/j02', () => {
  const g = sampleMode(makeMode({ shape: 'circle', m: 0, n: 2 }), 100);
  const l = nodalLines(g, marchingSquares, { circle: true, trimBoundary: true });
  assert.ok(l.count > 40);
  const r0 = 2.404826 / 5.520078;
  for (let k = 0; k < l.count; k++) near(Math.hypot(l.segments[4 * k], l.segments[4 * k + 1]), r0, 0.01);
});

test('driven response peaks at the plate resonances and respects nodal sources', () => {
  const list = listModes({ shape: 'square', kind: 'simply' }, 10, 'plate');
  const modes = list.map((l) => makeMode(l.spec));
  const omegas = modes.map((m) => modeOmega(m.lambda, 'plate'));
  const src = [0.3, 0.4];
  const obs = [0.37, 0.61];
  const ps = modes.map((m) => m.phi(...src));
  const po = modes.map((m) => m.phi(...obs));
  const gamma = 0.02 * omegas[0];
  // scan: local maxima of the amplitude curve
  const peaks = [];
  let prev = 0; let cur = 0; let next;
  const W0 = 0.5 * omegas[0]; const W1 = 1.05 * omegas[7];
  const N = 20000;
  for (let i = 0; i <= N; i++) {
    next = responseAmplitude(omegas, ps, po, W0 + ((W1 - W0) * i) / N, gamma);
    if (i >= 2 && cur > prev && cur > next) peaks.push(W0 + ((W1 - W0) * (i - 1)) / N);
    prev = cur; cur = next;
  }
  // every distinct mode frequency (below the scan end) with non-zero coupling shows a peak within 2% of omega_k
  for (let k = 0; k < 6; k++) {
    if (Math.abs(ps[k] * po[k]) < 0.05) continue;
    const hit = peaks.some((p) => Math.abs(p - omegas[k]) < 0.02 * omegas[k]);
    assert.ok(hit, `no peak near mode ${k} (omega ${omegas[k].toFixed(1)}), peaks ${peaks.map((p) => p.toFixed(1))}`);
  }
  // a source on the nodal line of mode (2,2) (x = 0.5) does not excite it: amplitude at omega_k stays small
  const k21 = list.findIndex((l) => l.spec.m === 2 && l.spec.n === 2); // non-degenerate, node at x = 0.5
  const psN = modes.map((m) => m.phi(0.5, 0.3));
  assert.ok(Math.abs(psN[k21]) < 1e-12);
  const sharp = 0.002 * omegas[0];
  const on = responseAmplitude(omegas, ps, po, omegas[k21], sharp);
  const off = responseAmplitude(omegas, psN, po, omegas[k21], sharp);
  assert.ok(on > 4 * off, `${on} vs ${off}`);
  near(drivenCoefficients(omegas, psN, omegas[k21], sharp).im[k21], 0, 1e-12);
  // on resonance the dominant coefficient is ~ phi/(gamma omega) and purely imaginary
  const c = drivenCoefficients(omegas, ps, omegas[k21], gamma);
  near(c.im[k21], -ps[k21] / (gamma * omegas[k21]), 1e-9 * Math.abs(c.im[k21]));
  near(c.re[k21], 0, 1e-9 * Math.abs(c.im[k21]));
});

test('drivenField: peak snapshot at resonance looks like the resonant mode', () => {
  const list = listModes({ shape: 'square', kind: 'simply' }, 6, 'plate');
  const modes = list.map((l) => makeMode(l.spec));
  const grids = modes.map((m) => sampleMode(m, 32));
  const omegas = modes.map((m) => m.lambda);
  const ps = modes.map((m) => m.phi(0.3, 0.4));
  const k = 3; // (2,2): not degenerate with another mode
  const f = drivenField(grids, omegas, ps, omegas[k], 0.01 * omegas[0]);
  const snap = combine([f.A, f.B], [Math.cos(f.theta), -Math.sin(f.theta)]);
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < snap.values.length; i++) {
    dot += snap.values[i] * grids[k].values[i]; na += snap.values[i] ** 2; nb += grids[k].values[i] ** 2;
  }
  assert.ok(Math.abs(dot) / Math.sqrt(na * nb) > 0.99);
});

test('sand: grains are deterministic, capped, and drift to low-amplitude regions', () => {
  const mode = makeMode({ shape: 'square', kind: 'simply', m: 3, n: 2 });
  const g = sampleMode(mode, 64);
  const amp = { ...g, values: g.values.map(Math.abs) };
  const mk = () => createSand({ count: 3000, seed: 7, bounds: mode.bounds, inside: mode.inside });
  const s1 = mk(); const s2 = mk();
  assert.deepEqual(Array.from(s1.x.slice(0, 5)), Array.from(s2.x.slice(0, 5)));
  assert.equal(createSand({ count: 1e9, seed: 1, bounds: mode.bounds, inside: mode.inside }).n, MAX_GRAINS);
  const before = meanAmplitude(s1, g);
  const opts = { steps: 200, stepSize: 0.015, mobility: 3 };
  stepSand(s1, amp, mode.inside, opts);
  stepSand(s2, amp, mode.inside, opts);
  const mid = meanAmplitude(s1, g);
  stepSand(s1, amp, mode.inside, { ...opts, steps: 600 });
  const after = meanAmplitude(s1, g);
  assert.ok(mid < before * 0.6, `${before} -> ${mid}`);
  assert.ok(after < mid, `${mid} -> ${after}`);
  assert.deepEqual(Array.from(s1.x.slice(0, 5)).length, 5);
  assert.deepEqual(Array.from(s2.x.slice(0, 5)), Array.from(stepSand(mk(), amp, mode.inside, opts).x.slice(0, 5)));
  for (let i = 0; i < s1.n; i++) assert.ok(mode.inside(s1.x[i], s1.y[i]));
});

test('chainSegments joins marching-squares output into few polylines', () => {
  const g = sampleMode(makeMode({ shape: 'circle', m: 0, n: 2 }), 80);
  const l = nodalLines(g, marchingSquares, { circle: true, trimBoundary: true });
  const chains = chainSegments(l, 2);
  assert.ok(chains.length >= 1 && chains.length <= 3, `chains ${chains.length}`);
  const g33 = sampleMode(makeMode({ shape: 'square', kind: 'simply', m: 3, n: 3 }), 60);
  const l2 = nodalLines(g33, marchingSquares, { trimBoundary: true });
  const total = chainSegments(l2, 1).reduce((a, c) => a + c.length / 2 - 1, 0);
  assert.equal(total, l2.count);
});

test('sand stays inside a circular plate', () => {
  const mode = makeMode({ shape: 'circle', m: 2, n: 1 });
  const g = sampleMode(mode, 64);
  const amp = { ...g, values: g.values.map(Math.abs) };
  const s = createSand({ count: 800, seed: 3, bounds: mode.bounds, inside: mode.inside });
  stepSand(s, amp, mode.inside, { steps: 150, stepSize: 0.03 });
  for (let i = 0; i < s.n; i++) assert.ok(s.x[i] ** 2 + s.y[i] ** 2 <= 1 + 1e-6);
});
