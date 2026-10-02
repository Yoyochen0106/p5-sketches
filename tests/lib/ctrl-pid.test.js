import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTf, tf, evalJw, isStable, tfFeedback, dcGain } from '../../lib/ctrl/tf.js';
import { step } from '../../lib/ctrl/response.js';
import { pidTf, pidFromStandard, pidToStandard, createPid, simulateLoop, loopStepInfo, performanceIndices, makeGaussian, fitFopdt,
  reactionCurve, fopdtOfTf, zieglerNicholsStep, zieglerNicholsUltimate, ultimateFromTf, cohenCoon, imcLambda, simc, serialToIdeal,
  pidOpenLoop, toPidParams, derivativeFilter } from '../../lib/ctrl/pid.js';
import { margins } from '../../lib/ctrl/freq.js';
import { close } from './helpers.js';

test('PID forms and transfer function', () => {
  const p = pidFromStandard({ Kp: 2, Ti: 4, Td: 0.5 });
  close(p.Ki, 0.5); close(p.Kd, 1);
  const s = pidToStandard(p);
  close(s.Ti, 4); close(s.Td, 0.5);
  const C = pidTf({ Kp: 2, Ki: 0.5, Kd: 1 });
  // (Kd s^2 + Kp s + Ki) / s at s = j: Kp + Kd j - Ki j
  const v = evalJw(C, 1);
  close(v[0], 2); close(v[1], 1 - 0.5);
  // PI, P, PD shapes
  assert.deepEqual(pidTf({ Kp: 3 }).num, [3]);
  assert.deepEqual(pidTf({ Kp: 3, Ki: 1 }).den, [1, 0]);
  // filtered derivative: Kd s/(Tf s + 1) high-frequency gain Kd/Tf
  const F = pidTf({ Kp: 1, Ki: 0, Kd: 2, Tf: 0.1 });
  const hf = evalJw(F, 1e6);
  close(hf[0], 1 + 20, 1e-4);
  close(derivativeFilter({ Kp: 2, Kd: 1, N: 10 }), 0.05);
  const L = pidOpenLoop({ Kp: 1, Ki: 1 }, parseTf('1/(s+1)'));
  assert.equal(L.den.length, 3);
});

test('discrete controller: P-only step, derivative on measurement (no kick), saturation flags', () => {
  const c = createPid({ Kp: 2, b: 1 }, 0.1);
  let r = c.update(1, 0);
  close(r.u, 2);
  const d = createPid({ Kp: 0, Kd: 1, Tf: 0 }, 0.1);
  d.update(1, 0);
  r = d.update(1, 0.5); // y jumps by 0.5 -> D = -Kd * dy / Ts = -5
  close(r.D, -5);
  // setpoint step with c = 0 gives no derivative kick
  const e = createPid({ Kp: 0, Kd: 1 }, 0.1);
  e.update(0, 0);
  close(e.update(1, 0).D, 0);
  const s = createPid({ Kp: 10, umax: 1 }, 0.1);
  const o = s.update(1, 0);
  assert.equal(o.u, 1); assert.ok(o.saturated); close(o.uUnsat, 10);
  // setpoint weighting b
  close(createPid({ Kp: 2, b: 0.5 }, 0.1).update(1, 0).P, 1);
});

test('closed-loop simulation matches the analytic closed-loop step response', () => {
  const G = parseTf('1/(s+1)');
  const Ts = 0.001;
  const res = simulateLoop({ plant: G, controller: { Kp: 4 }, Ts, tEnd: 3, r: 1 });
  // P-control of 1/(s+1) with Kp=4: y -> 4/5 (1 - exp(-5t)) (small discretisation lag from the one-sample delay)
  const k = 1000;
  close(res.y[k], 0.8 * (1 - Math.exp(-5 * res.t[k])), 5e-3);
  close(res.indices.IAE > 0 ? 1 : 0, 1);
  // compare to the continuous closed loop
  const T = tfFeedback(pidOpenLoop({ Kp: 4 }, G));
  close(dcGain(T), 0.8, 1e-12);
  const ref = step(T, { dt: Ts, n: 3000 });
  close(res.y[2000], ref.y[2000], 5e-3);
});

test('delay, noise, load disturbance and nonlinear plants', () => {
  const Ts = 0.01;
  const d = simulateLoop({ plant: tf([1], [1, 1], 0.5), controller: { Kp: 0 }, Ts, tEnd: 5, r: 1, dLoad: 1 });
  // open loop with load step = plant step delayed by 0.5 s
  close(d.y[40], 0, 1e-9); assert.ok(d.y[200] > 0.5);
  const n1 = simulateLoop({ plant: parseTf('1/(s+1)'), controller: { Kp: 1 }, Ts, tEnd: 5, r: 0, noise: { sigma: 0.1, seed: 4 } });
  const n2 = simulateLoop({ plant: parseTf('1/(s+1)'), controller: { Kp: 1 }, Ts, tEnd: 5, r: 0, noise: { sigma: 0.1, seed: 4 } });
  assert.deepEqual(Array.from(n1.ym), Array.from(n2.ym)); // deterministic
  assert.ok(Math.max(...n1.ym.map(Math.abs)) > 0.05);
  const g = makeGaussian(7);
  let m = 0, v = 0;
  const M = 20000;
  for (let i = 0; i < M; i++) { const x = g(); m += x; v += x * x; }
  assert.ok(Math.abs(m / M) < 0.03 && Math.abs(v / M - 1) < 0.05);
  // nonlinear plant x' = -x^3 + u, regulated to r = 0.5 by PI
  const nl = simulateLoop({ plant: { f: (x, u) => [-(x[0] ** 3) + u], x0: [0] }, controller: { Kp: 2, Ki: 2 }, Ts: 0.01, tEnd: 20, r: 0.5 });
  close(nl.y[2000], 0.5, 1e-3);
  // arbitrary controller function
  const cf = simulateLoop({ plant: parseTf('1/(s+1)'), controller: (r, y) => 3 * (r - y), Ts: 0.01, tEnd: 3, r: 1 });
  close(cf.y[300], 0.75, 0.02);
});

test('anti-windup beats a plain integrator on a saturated plant', () => {
  const G = parseTf('1/((s+1)(0.5s+1))');
  const base = { plant: G, controller: { Kp: 4, Ki: 4 }, Ts: 0.01, tEnd: 20, r: 0.9, umin: -1, umax: 1 };
  const plain = simulateLoop({ ...base, antiwindup: 'none' });
  const clamp = simulateLoop({ ...base, antiwindup: 'clamp' });
  const back = simulateLoop({ ...base, antiwindup: 'backcalc' });
  assert.ok(plain.saturated.some((v) => v === 1));
  const ip = loopStepInfo(plain), ic = loopStepInfo(clamp), ib = loopStepInfo(back);
  assert.ok(clamp.indices.IAE < 0.75 * plain.indices.IAE, `IAE ${clamp.indices.IAE} vs ${plain.indices.IAE}`);
  assert.ok(back.indices.IAE < 0.75 * plain.indices.IAE);
  assert.ok(ic.overshootPct < ip.overshootPct && ib.overshootPct < ip.overshootPct);
  assert.ok(ic.settling2 < ip.settling2);
  // outputs never exceed the actuator limits
  assert.ok(Math.max(...clamp.u) <= 1 && Math.min(...clamp.u) >= -1);
});

test('performance indices of a decaying error', () => {
  const t = Float64Array.from({ length: 20001 }, (_, k) => k * 0.001);
  const e = t.map((x) => Math.exp(-x));
  const idx = performanceIndices(t, e);
  close(idx.IAE, 1 - Math.exp(-20), 1e-6);
  close(idx.ISE, 0.5 * (1 - Math.exp(-40)), 1e-6);
  close(idx.ITAE, 1, 1e-4);
});

test('FOPDT identification and reaction-curve Ziegler-Nichols', () => {
  const K = 2, T = 3, L = 1;
  const t = Float64Array.from({ length: 4001 }, (_, k) => k * 0.005);
  const y = t.map((x) => (x < L ? 0 : K * (1 - Math.exp(-(x - L) / T))));
  const f = fitFopdt(t, y, { amp: 1, final: K });
  close(f.K, K, 1e-9); close(f.T, T, 2e-3); close(f.L, L, 2e-3);
  const rc = reactionCurve(t, y, { final: K });
  close(rc.L, L, 0.02); close(rc.R, K / T, 0.01); close(rc.T, T, 0.02);
  const pid = zieglerNicholsStep({ K, T, L });
  close(pid.Kp, 1.2 * T / (K * L), 1e-12); close(pid.Ti, 2 * L); close(pid.Td, 0.5 * L);
  close(zieglerNicholsStep({ K, T, L }, 'PI').Kp, 0.9 * T / (K * L), 1e-12);
  close(zieglerNicholsStep({ K, T, L }, 'P').Kp, T / (K * L), 1e-12);
  // from a transfer function with delay
  const fo = fopdtOfTf(tf([2], [3, 1], 1));
  close(fo.K, 2, 1e-3); close(fo.T, 3, 5e-3); close(fo.L, 1, 5e-3);
});

test('Ziegler-Nichols ultimate-cycle tuning on 1/(s+1)^3 (Ku = 8, Pu = 2 pi / sqrt 3)', () => {
  const G = parseTf('1/(s+1)^3');
  const u = ultimateFromTf(G);
  close(u.Ku, 8, 1e-9); close(u.wu, Math.sqrt(3), 1e-9); close(u.Pu, 2 * Math.PI / Math.sqrt(3), 1e-9);
  const pid = zieglerNicholsUltimate(u, 'PID');
  close(pid.Kp, 4.8, 1e-9); close(pid.Ti, u.Pu / 2); close(pid.Td, u.Pu / 8);
  close(pid.Ki, 4.8 / pid.Ti); close(pid.Kd, 4.8 * pid.Td);
  close(zieglerNicholsUltimate(u, 'PI').Kp, 3.6, 1e-9);
  close(zieglerNicholsUltimate(u, 'P').Kp, 4, 1e-9);
  // the tuned loop is stable with the classic "quarter-decay" style overshoot, and P at 0.5 Ku has gain margin 2
  const L = pidOpenLoop(toPidParams(pid, { Tf: pid.Td / 10 }), G);
  assert.ok(margins(L).stable);
  const m = margins(tf([4], [1, 3, 3, 1]));
  close(m.gm, 2, 1e-8);
  const res = simulateLoop({ plant: G, controller: toPidParams(pid, { Tf: pid.Td / 10 }), Ts: 0.01, tEnd: 40, r: 1 });
  const info = loopStepInfo(res);
  assert.ok(info.overshootPct > 25 && info.overshootPct < 70);
  // ultimate gain with delay: 1/(s+1) e^{-s}: phase crossover where -atan(w) - w = -pi
  const ud = ultimateFromTf(tf([1], [1, 1], 1));
  close(Math.atan(ud.wu) + ud.wu, Math.PI, 1e-8);
  close(ud.Ku, Math.sqrt(1 + ud.wu * ud.wu), 1e-8);
  assert.equal(ultimateFromTf(parseTf('1/(s+1)')), null);
});

test('Cohen-Coon, IMC and SIMC rules', () => {
  const m = { K: 2, T: 4, L: 1 };
  const cc = cohenCoon(m, 'PID');
  close(cc.Kp, (4 / (2 * 1)) * (4 / 3 + 0.25 / 4), 1e-12);
  close(cc.Ti, (1 * (32 + 6 * 0.25)) / (13 + 8 * 0.25), 1e-12);
  close(cc.Td, (4 * 1) / (11 + 2 * 0.25), 1e-12);
  close(cohenCoon(m, 'PI').Kp, 2 * (0.9 + 0.25 / 12), 1e-12);
  const im = imcLambda(m, 2, 'PI');
  close(im.Kp, 4 / (2 * 3), 1e-12); close(im.Ti, 4);
  const ip = imcLambda(m, 2, 'PID');
  close(ip.Kp, 4.5 / (2 * 2.5), 1e-12); close(ip.Ti, 4.5); close(ip.Td, 4 / 9, 1e-12);
  const sm = simc(m, 1, 'PI');
  close(sm.Kp, 4 / (2 * 2), 1e-12); close(sm.Ti, Math.min(4, 8));
  const sp = simc({ K: 2, T: 4, L: 1, T2: 0.5 }, 1, 'PID');
  const ideal = serialToIdeal({ Kc: 1, Ti: 4, Td: 0.5 });
  close(sp.Kp, ideal.Kp, 1e-12); close(sp.Td, ideal.Td, 1e-12);
  // SIMC PI on its own FOPDT model gives a well damped loop with the requested speed
  const plant = tf([2], [4, 1], 1);
  const res = simulateLoop({ plant, controller: toPidParams(sm), Ts: 0.01, tEnd: 60, r: 1 });
  const info = loopStepInfo(res);
  assert.ok(info.overshootPct < 15, `os ${info.overshootPct}`);
  assert.ok(info.settling2 < 25);
  assert.ok(isStable(tf([1], [1, 1])));
});
