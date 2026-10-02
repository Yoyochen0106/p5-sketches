import test from 'node:test';
import assert from 'node:assert/strict';
import { tf, parseTf, secondOrder, polyRoots, evalJw, polyFromRoots } from '../../lib/ctrl/tf.js';
import { tf2ss, ss2tf, ss, simulate, rk4, ackermann, isControllable, ssPoles, c2dSs, observerGain, stateFeedback } from '../../lib/ctrl/ss.js';
import { step, impulse, ramp, sine, lsim, stepInfo, stepSpecs, secondOrderStep, secondOrderFormulas, errorConstants, zetaFromOvershoot, poleSpecs, autoTimeSpan, sampledInput } from '../../lib/ctrl/response.js';
import { close, rng } from './helpers.js';

test('second-order step: overshoot = exp(-pi zeta/sqrt(1-zeta^2)), peak time pi/wd, settling ~ 4/(zeta wn)', () => {
  for (const [zeta, wn] of [[0.2, 3], [0.5, 2], [0.7, 5], [0.9, 1]]) {
    const G = secondOrder(zeta, wn);
    const r = step(G, { tEnd: 12 / (zeta * wn), n: 6000 });
    const info = stepInfo(r.t, r.y, { final: 1 });
    const f = secondOrderFormulas(zeta, wn);
    close(info.overshootPct, 100 * Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta)), 1e-4, `os zeta=${zeta}`);
    close(info.peakTime, Math.PI / (wn * Math.sqrt(1 - zeta * zeta)), 1e-4);
    close(info.riseTime, f.riseTime, 2e-3);
    // measured settling lies below the envelope bound and near the 4/(zeta wn) rule
    assert.ok(info.settling2 <= f.settling2Exact * 1.001);
    assert.ok(Math.abs(info.settling2 - 4 / (zeta * wn)) / (4 / (zeta * wn)) < 0.35, `ts zeta=${zeta}`);
    assert.ok(Math.abs(info.settling5 - 3 / (zeta * wn)) / (3 / (zeta * wn)) < 0.5);
  }
});

test('ZOH step invariance: sampled step response equals the closed form at the sample instants', () => {
  for (const zeta of [0.3, 1, 2]) {
    const G = secondOrder(zeta, 2);
    const r = step(G, { tEnd: 6, n: 120 });
    for (let k = 0; k < r.t.length; k += 7) close(r.y[k], secondOrderStep(zeta, 2, r.t[k]), 1e-9, `zeta ${zeta} k ${k}`);
  }
});

test('impulse, ramp, sine and initial-condition responses of 1/(s+1)', () => {
  const G = parseTf('1/(s+1)');
  const h = impulse(G, { tEnd: 5, n: 500 });
  close(h.y[100], Math.exp(-h.t[100]), 1e-9);
  const rp = ramp(G, { tEnd: 5, n: 500 });
  close(rp.y[250], rp.t[250] - 1 + Math.exp(-rp.t[250]), 1e-9);
  const w = 3;
  const sn = sine(G, w, { tEnd: 20, n: 4000 });
  const mag = Math.hypot(...evalJw(G, w));
  let peak = 0;
  for (let k = 3000; k < sn.y.length; k++) peak = Math.max(peak, Math.abs(sn.y[k]));
  close(peak, mag, 2e-3);
  const free = lsim(G, () => 0, { tEnd: 3, n: 300, x0: [1] });
  close(free.y[100], Math.exp(-1), 1e-9);
  const arb = sampledInput(G, Array.from({ length: 501 }, (_, k) => (k * 0.01 < 1 ? 1 : 0)), 0.01);
  close(arb.y[100 - 1], 1 - Math.exp(-0.99), 1e-9);
});

test('transport delay shifts the response', () => {
  const G = tf([1], [1, 1], 1);
  const r = step(G, { tEnd: 6, n: 600 });
  close(r.y[50], 0, 1e-12);
  close(r.y[300], 1 - Math.exp(-(r.t[300] - 1)), 1e-9);
  const i = impulse(G, { tEnd: 6, n: 600 });
  close(i.y[300], Math.exp(-(i.t[300] - 1)), 1e-9);
});

test('step specs of a first-order lag and non-minimum-phase undershoot', () => {
  const sp = stepSpecs(parseTf('1/(s+1)'), { tEnd: 12, n: 6000 });
  close(sp.riseTime, Math.log(9), 1e-3);
  close(sp.settling2, -Math.log(0.02), 1e-3);
  close(sp.settling5, -Math.log(0.05), 1e-3);
  close(sp.overshootPct, 0, 1e-9);
  assert.ok(Number.isNaN(sp.peakTime));
  const nmp = stepSpecs(parseTf('(1-s)/(s^2+3s+2)'), { tEnd: 15, n: 3000 });
  assert.ok(nmp.undershootPct > 10);
  close(nmp.yss, 0.5, 1e-9);
});

test('steady-state error constants', () => {
  const e = errorConstants(parseTf('10/(s(s+2))'));
  assert.equal(e.type, 1); assert.equal(e.Kp, Infinity); close(e.Kv, 5); assert.equal(e.Ka, 0);
  close(e.essRamp, 0.2); assert.equal(e.essStep, 0); assert.equal(e.essParabola, Infinity);
  const e0 = errorConstants(parseTf('4/(s+1)'));
  close(e0.Kp, 4); close(e0.essStep, 0.2); assert.equal(e0.essRamp, Infinity);
  // closed-loop check: ramp tracking error of the unity feedback loop tends to 1/Kv
  const T = parseTf('10/(s^2+2s+10)');
  const r = ramp(T, { tEnd: 15, n: 3000 });
  close(r.t[3000] - r.y[3000], 0.2, 1e-3);
});

test('helpers: zeta from overshoot, pole specs, auto span', () => {
  close(zetaFromOvershoot(100 * Math.exp(-Math.PI * 0.4 / Math.sqrt(1 - 0.16))), 0.4, 1e-12);
  const s = poleSpecs([-3, 4]);
  close(s.wn, 5); close(s.zeta, 0.6); close(s.wd, 4);
  assert.ok(autoTimeSpan(parseTf('1/(s+0.1)')) >= 50);
  assert.ok(Number.isFinite(autoTimeSpan(parseTf('1/(s-1)'))));
  assert.ok(autoTimeSpan(parseTf('1/(s^2+1)')) > 20);
});

test('tf2ss -> ss2tf round trip (controllable and observable) on random TFs', () => {
  const rand = rng(5);
  for (let t = 0; t < 40; t++) {
    const n = 1 + Math.floor(rand() * 4), m = Math.floor(rand() * (n + 1));
    const den = [1, ...Array.from({ length: n }, () => (rand() - 0.5) * 6)];
    const num = Array.from({ length: m + 1 }, () => (rand() - 0.5) * 4 || 1);
    const G = tf(num, den);
    for (const form of ['controllable', 'observable']) {
      const R = ss2tf(tf2ss(G, form));
      const w = 0.7 + rand();
      const a = evalJw(G, w), b = evalJw(R, w);
      close(a[0], b[0], 1e-8); close(a[1], b[1], 1e-8);
      R.den.forEach((c, i) => close(c, G.den[i], 1e-9));
    }
  }
  assert.throws(() => tf2ss(tf([1, 0, 0], [1, 1])));
});

test('state space: poles = TF poles, controllability, Ackermann, observer, RK4 vs exact', () => {
  const G = parseTf('1/(s^2+3s+2)');
  const S = tf2ss(G);
  assert.ok(isControllable(S));
  const ev = ssPoles(S).map((p) => p[0]).sort((a, b) => a - b);
  close(ev[0], -2, 1e-8); close(ev[1], -1, 1e-8);
  const K = ackermann(S, [-4, -5]);
  const cl = ssPoles(stateFeedback(S, K)).map((p) => p[0]).sort((a, b) => a - b);
  close(cl[0], -5, 1e-8); close(cl[1], -4, 1e-8);
  const L = observerGain(S, [-6, -7]);
  const A_LC = S.A.map((r, i) => r.map((v, j) => v - L[i][0] * S.C[0][j]));
  const e2 = ssPoles(ss(A_LC, [0, 1], [1, 0])).map((p) => p[0]).sort((a, b) => a - b);
  close(e2[0], -7, 1e-8); close(e2[1], -6, 1e-8);
  // RK4 on the same linear dynamics matches the exact ZOH simulation
  const f = (x, u) => [x[1], -2 * x[0] - 3 * x[1] + u];
  const rk = rk4(f, [0, 0], 1, { tEnd: 4, dt: 0.01, substeps: 4 });
  const ex = simulate(S, () => 1, { dt: 0.01, n: 400 });
  close(rk.y[400], ex.y[400], 1e-9);
  const d = c2dSs(S, 0.1);
  assert.equal(d.Ad.length, 2);
  const mimo = simulate(ss([[-1]], [[1, 2]], [[1]], [[0, 0]]), () => [1, 1], { dt: 0.1, n: 50 });
  close(mimo.y[50], 3 * (1 - Math.exp(-5)), 1e-9);
  assert.equal(polyRoots(polyFromRoots([-1, -2])).length, 2);
});
