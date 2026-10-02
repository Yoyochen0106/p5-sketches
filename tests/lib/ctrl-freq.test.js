import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTf, tf, polyRoots, polyFromRoots, polyAdd, polyScale, secondOrder, tfFeedback, evalJw } from '../../lib/ctrl/tf.js';
import { bode, nyquist, nyquistContour, nyquistAnalysis, margins, bandwidth, resonantPeak, closedLoopPeak, closedLoopBandwidth,
  sensitivityPeaks, sensitivityResponse, complementaryResponse, sensitivityTfs, secondOrderResonance, gainCrossovers, nichols, unwrappedPhaseDeg, padeDelay } from '../../lib/ctrl/freq.js';
import { close, rng } from './helpers.js';

test('Bode of 1/(s+1): corner is -3.01 dB and -45 deg; asymptotes -20 dB/decade, -90 deg', () => {
  const b = bode(parseTf('1/(s+1)'), { w: [0.001, 1, 1000] });
  close(b.magDb[1], -10 * Math.log10(2), 1e-12); close(b.phaseDeg[1], -45, 1e-12);
  close(b.magDb[2], -60, 1e-3); close(b.phaseDeg[2], -90, 1e-1);
  close(b.mag[0], 1, 1e-6);
});

test('phase unwrapping: integrators, RHP zero, delay, triple integrator cycle', () => {
  const g = bode(parseTf('1/(s^3)'), { wMin: 0.01, wMax: 100, n: 50 });
  close(g.phaseDeg[0], -270, 1e-9); close(g.phaseDeg[49], -270, 1e-9);
  const lag = bode(parseTf('1/(s+1)^3'), { wMin: 0.01, wMax: 1000, n: 400 });
  assert.ok(lag.phaseDeg[399] < -265 && lag.phaseDeg[399] > -270.5);
  for (let i = 1; i < 400; i++) assert.ok(lag.phaseDeg[i] <= lag.phaseDeg[i - 1] + 1e-9);
  const d = bode(tf([1], [1, 1], 0.5), { w: [2] });
  close(d.phaseDeg[0], -(Math.atan(2) + 1) * 180 / Math.PI, 1e-9);
  close(d.mag[0], 1 / Math.sqrt(5), 1e-12);
  const diff = bode(parseTf('s/(s+1)'), { w: [1e-4, 1] });
  close(diff.phaseDeg[0], 90, 0.1);
  const n = nichols(parseTf('1/(s+1)'), { n: 10 });
  assert.equal(n.magDb.length, 10);
  assert.ok(unwrappedPhaseDeg(parseTf('1/(s+1)'), [1])[0] < 0);
});

test('margins of K/(s(s+1)(s+5)): Kcrit = 30 at wcg = sqrt(5)', () => {
  const m30 = margins(parseTf('30/(s(s+1)(s+5))'));
  close(m30.gm, 1, 1e-8); close(m30.wpc, Math.sqrt(5), 1e-8);
  const m6 = margins(parseTf('5/(s(s+1)(s+5))'));
  close(m6.gm, 6, 1e-8); close(m6.gmDb, 20 * Math.log10(6), 1e-8);
  assert.ok(m6.pm > 0 && m6.stable);
  // phase margin consistent with the phase at the gain crossover
  const L = parseTf('5/(s(s+1)(s+5))');
  const ph = (Math.atan2(...[1, 0].map(() => 0)), 0);
  const v = evalJw(L, m6.wgc);
  close(Math.hypot(v[0], v[1]), 1, 1e-8);
  close(m6.pm, 180 + Math.atan2(v[1], v[0]) * 180 / Math.PI, 1e-6);
  assert.ok(ph === 0);
  const unstable = margins(parseTf('60/(s(s+1)(s+5))'));
  assert.ok(unstable.gm < 1 && unstable.pm < 0 && !unstable.stable);
  // delay margin: PM(rad)/wgc for a first-order loop 2/(s+... ) integrator: L = 1/s -> pm 90, wgc 1
  const mi = margins(parseTf('1/s'));
  close(mi.pm, 90, 1e-9); close(mi.wgc, 1, 1e-9); close(mi.delayMargin, Math.PI / 2, 1e-9);
  assert.equal(mi.gm, Infinity);
  // exact delay lowers the phase margin by w*T
  const md = margins(tf([1], [1, 0], 0.5));
  close(md.pm, 90 - 0.5 * 180 / Math.PI, 1e-8);
});

test('bandwidth and resonant peak of the canonical second-order system', () => {
  const zeta = 0.2, wn = 3;
  const G = secondOrder(zeta, wn);
  const pk = resonantPeak(G);
  const th = secondOrderResonance(zeta, wn);
  close(pk.Mr, th.Mr, 1e-9); close(pk.wr, th.wr, 1e-6);
  assert.ok(pk.interior);
  const bw = bandwidth(secondOrder(0.7, 1));
  close(bw, 1 * Math.sqrt(1 - 2 * 0.49 + Math.sqrt(4 * 0.49 * 0.49 - 4 * 0.49 + 2)), 1e-8);
  assert.ok(Number.isNaN(bandwidth(parseTf('1/(s^2+1)'), { wMax: 0.5 })));
  // closed loop of L = wn^2/(s(s+2 zeta wn)) is exactly the canonical second order system
  const L = tf([wn * wn], [1, 2 * zeta * wn, 0]);
  const cp = closedLoopPeak(L);
  close(cp.Mr, th.Mr, 1e-6);
  close(closedLoopBandwidth(secondOrderOpen(0.7, 1)), bw, 1e-6);
});
function secondOrderOpen(zeta, wn) { return tf([wn * wn], [1, 2 * zeta * wn, 0]); }

test('sensitivity functions: S + T = 1, peaks, rational versions agree', () => {
  const L = parseTf('5/(s(s+1)(s+5))');
  for (const w of [0.1, 1, 3]) {
    const S = sensitivityResponse(L, w), T = complementaryResponse(L, w);
    close(S[0] + T[0], 1, 1e-12); close(S[1] + T[1], 0, 1e-12);
  }
  const { S, T } = sensitivityTfs(L);
  const s1 = evalJw(S, 2), s2 = sensitivityResponse(L, 2);
  close(s1[0], s2[0], 1e-10); close(s1[1], s2[1], 1e-10);
  const p = sensitivityPeaks(L);
  assert.ok(p.Ms > 1 && p.vectorMargin < 1);
  // Ms bounds the margins: gm >= Ms/(Ms-1), pm >= 2 asin(1/(2Ms))
  const m = margins(L);
  assert.ok(m.gm >= p.Ms / (p.Ms - 1) - 1e-6);
  assert.ok(m.pm >= 2 * Math.asin(1 / (2 * p.Ms)) * 180 / Math.PI - 1e-6);
  assert.ok(T.den.length === 4);
});

test('Nyquist contour: indentation and infinite-arc closure for a type-1 loop', () => {
  const L = parseTf('1/(s(s+1))');
  const c = nyquistContour(L);
  const kinds = new Set(c.path.map((p) => p.kind));
  for (const k of ['neg', 'pos', 'indent', 'arc']) assert.ok(kinds.has(k), k);
  assert.deepEqual(c.imagPoles, [0]);
  // closed curve: first and last points are both close to the origin (L -> 0 at infinity)
  const first = c.path[0].L, last = c.path[c.path.length - 1].L;
  assert.ok(Math.hypot(...first) < 1e-4 && Math.hypot(...last) < 1e-4);
  // the indentation maps to a large clockwise arc of radius 1/eps
  const ind = c.path.filter((p) => p.kind === 'indent' && p.s[1] === Math.min(...c.path.filter((q) => q.kind === 'indent').map((q) => q.s[1])));
  assert.ok(ind.length >= 1);
  const big = c.path.filter((p) => p.kind === 'indent').map((p) => Math.hypot(...p.L));
  assert.ok(Math.max(...big) > 1 / c.eps * 0.9);
  const n = nyquist(L);
  assert.ok(n.w.length > 50);
  close(n.re[n.re.length - 1], 0, 1e-3);
});

test('Nyquist: type-1 loop K/(s(s+1)(s+5)) is stable below K = 30 and unstable above', () => {
  for (const [K, Z] of [[5, 0], [20, 0], [40, 2], [100, 2]]) {
    const a = nyquistAnalysis(parseTf('1/(s(s+1)(s+5))'), { K });
    assert.equal(a.P, 0); assert.equal(a.Z, Z, `K=${K}`);
    assert.equal(a.stable, Z === 0);
  }
  // open-loop unstable: L = K/(s-1): closed loop s - 1 + K stable iff K > 1: N = 1 (CCW => -1) then Z = 0
  const lo = nyquistAnalysis(parseTf('1/(s-1)'), { K: 3 });
  assert.equal(lo.P, 1); assert.equal(lo.N, -1); assert.equal(lo.Z, 0);
  const hi = nyquistAnalysis(parseTf('1/(s-1)'), { K: 0.5 });
  assert.equal(hi.N, 0); assert.equal(hi.Z, 1);
});

test('Nyquist encirclement count matches RHP closed-loop poles for random loops', () => {
  const rand = rng(21);
  let checked = 0;
  for (let t = 0; t < 120; t++) {
    const nz = Math.floor(rand() * 3), np = nz + 1 + Math.floor(rand() * 3);
    const zs = Array.from({ length: nz }, () => (rand() - 0.5) * 6);
    const ps = [];
    const nInt = rand() < 0.3 ? 1 : 0;
    for (let i = 0; i < nInt; i++) ps.push(0);
    while (ps.length < np) {
      if (np - ps.length >= 2 && rand() < 0.5) { const re = (rand() - 0.6) * 4, im = 0.3 + rand() * 2; ps.push([re, im], [re, -im]); }
      else ps.push((rand() - 0.6) * 6);
    }
    const num = polyFromRoots(zs, (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 6)), den = polyFromRoots(ps, 1);
    const L = tf(num, den);
    const cl = polyAdd(den, num);
    const roots = polyRoots(cl);
    // skip near-marginal cases (closed-loop pole within 0.05 of the jw axis) and poles too near the contour indentation
    if (roots.some((r) => Math.abs(r[0]) < 0.05)) continue;
    if (ps.some((p) => Array.isArray(p) ? Math.abs(p[0]) < 0.05 : (Math.abs(p) < 0.05 && p !== 0))) continue;
    const expected = roots.filter((r) => r[0] > 0).length;
    const a = nyquistAnalysis(L);
    assert.equal(a.Z, expected, `trial ${t}: poles ${JSON.stringify(ps)} zeros ${JSON.stringify(zs)} num ${num}`);
    checked++;
  }
  assert.ok(checked > 60, `checked ${checked}`);
});

test('Nyquist with an exact delay: 1/(s+1) e^{-sT} loses stability at the phase crossover', () => {
  const stableL = tf([1.5], [1, 1], 1);   // |L|<... gain crossover below phase crossover
  const unstableL = tf([6], [1, 1], 1);
  assert.ok(nyquistAnalysis(stableL).stable);
  assert.ok(!nyquistAnalysis(unstableL).stable);
  assert.equal(gainCrossovers(tf([6], [1, 1], 1)).length, 1);
  assert.ok(padeDelay(1, 3).den.length === 4);
  void tfFeedback; void secondOrder; void polyScale;
});
