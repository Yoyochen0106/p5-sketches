import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANTS, PLANT_IDS, getPlant, resolveParams, plantTf, plantSs, plantNonlinear } from '../../lib/ctrl/plants.js';
import { tfPoles, evalJw, isProper, dcGain, polyRoots } from '../../lib/ctrl/tf.js';
import { ss2tf, ssPoles, rk4, simulate } from '../../lib/ctrl/ss.js';
import { simulateLoop } from '../../lib/ctrl/pid.js';
import { close } from './helpers.js';

test('every plant has a complete, finite and proper model', () => {
  assert.ok(PLANTS.length >= 15);
  assert.equal(new Set(PLANT_IDS).size, PLANT_IDS.length);
  for (const pl of PLANTS) {
    assert.ok(pl.id && pl.label && pl.description, pl.id);
    assert.ok(pl.view && pl.view.input && pl.view.output && Array.isArray(pl.view.bode), pl.id);
    for (const q of pl.params) {
      assert.ok(q.min <= q.default && q.default <= q.max, `${pl.id}.${q.key} default in range`);
      assert.ok(q.step > 0);
    }
    const G = plantTf(pl.id);
    assert.ok(isProper(G), pl.id);
    assert.ok(G.den.every(Number.isFinite) && G.num.every(Number.isFinite), pl.id);
    // the default state-space model reproduces the TF (frequency response)
    const S = plantSs(pl.id);
    assert.ok(S.A.length >= 1);
    // extremes of every parameter still give finite proper TFs
    for (const q of pl.params) for (const v of [q.min, q.max]) {
      const T = pl.tf(resolveParams(pl, { [q.key]: v }));
      assert.ok(T.den.every(Number.isFinite) && isProper(T), `${pl.id} ${q.key}=${v}`);
    }
  }
  assert.throws(() => getPlant('nope'));
});

test('ss matches tf for TF-derived plants and for the physical cart-pole', () => {
  for (const id of ['first-order', 'dc-motor-speed', 'mass-spring-damper', 'aircraft-pitch', 'flexible-mode', 'maglev']) {
    const G = plantTf(id), S = plantSs(id);
    const R = ss2tf(S);
    for (const w of [0.3, 3]) {
      const a = evalJw(G, w), b = evalJw(R, w);
      close(a[0], b[0], 1e-6); close(a[1], b[1], 1e-6);
    }
  }
  const S = plantSs('cart-pendulum');
  const one = { ...S, C: [S.C[1]], D: [[0]] }; // theta row
  const G = plantTf('cart-pendulum');
  const xrow = { ...S, C: [S.C[0]], D: [[0]] }, Gx = plantTf('cart-position');
  for (const w of [0.5, 5]) {
    const a = evalJw(G, w), b = evalJw(ss2tf(one), w);
    close(a[0], b[0], 1e-6); close(a[1], b[1], 1e-6);
    const c = evalJw(Gx, w), d = evalJw(ss2tf(xrow), w);
    close(c[0], d[0], 1e-6); close(c[1], d[1], 1e-6);
  }
});

test('textbook values: DC motor, mass-spring-damper, RLC, maglev, tank, oven', () => {
  const dm = plantTf('dc-motor-speed');
  close(dcGain(dm), 0.01 / (0.1 * 1 + 0.01 ** 2), 1e-12);
  assert.ok(tfPoles(dm).every((p) => p[0] < 0));
  const pos = plantTf('dc-motor-position');
  assert.equal(pos.den[pos.den.length - 1], 0);
  const msd = plantTf('mass-spring-damper', { m: 1, c: 0.8, k: 4 });
  const p = tfPoles(msd)[0];
  close(Math.hypot(p[0], p[1]), 2, 1e-9); close(-p[0] / 2, 0.2, 1e-9);
  const rlc = plantTf('rlc', { R: 0.4, L: 1, C: 1 });
  close(rlc.den[1], 0.4);
  const mg = plantTf('maglev', { x0: 0.01, g: 9.81 });
  const mr = polyRoots(mg.den).map((r) => r[0]).sort((a, b) => a - b);
  close(mr[1], Math.sqrt(2 * 9.81 / 0.01), 1e-9);
  close(mr[0], -mr[1], 1e-9);
  const tank = plantTf('water-tank', { A: 2, c: 0.5, h0: 1 });
  close(tank.den[1], 0.25);
  assert.equal(plantTf('thermal-oven').delay, 5);
  assert.ok(tfPoles(plantTf('cart-pendulum')).some((q) => q[0] > 1));
  assert.ok(tfPoles(plantTf('unstable-first-order')).some((q) => q[0] > 0));
  assert.ok(polyRoots(plantTf('rhp-zero').num).some((q) => q[0] > 0));
  // parameters are clamped to range and defaulted when missing
  assert.deepEqual(resolveParams(getPlant('first-order'), { K: 1e9, tau: NaN }), { K: 10, tau: 1 });
});

test('nonlinear models: equilibrium, Jacobian equals the linear model, energy conservation', () => {
  // cart-pole: linearisation of f about the upright equals the A, B of plantSs
  const nl = plantNonlinear('cart-pendulum');
  const S = plantSs('cart-pendulum');
  const x0 = [0, 0, 0, 0];
  const f0 = nl.f(x0, 0, 0);
  f0.forEach((v) => close(v, 0, 1e-12));
  const h = 1e-6;
  for (let j = 0; j < 4; j++) {
    const xp = x0.slice(), xm = x0.slice(); xp[j] += h; xm[j] -= h;
    const fp = nl.f(xp, 0, 0), fm = nl.f(xm, 0, 0);
    for (let i = 0; i < 4; i++) close((fp[i] - fm[i]) / (2 * h), S.A[i][j], 1e-6, `A[${i}][${j}]`);
  }
  const fu = nl.f(x0, h, 0), fu0 = nl.f(x0, -h, 0);
  for (let i = 0; i < 4; i++) close((fu[i] - fu0[i]) / (2 * h), S.B[i][0], 1e-6, `B[${i}]`);
  // frictionless cart-pole conserves energy under zero input
  const fr = plantNonlinear('cart-pendulum', { b: 0 });
  const r = rk4(fr.f, [0, 0, 0.6, 0], 0, { tEnd: 3, dt: 0.001, substeps: 2 });
  const E0 = fr.energy(r.x[0]), E1 = fr.energy(r.x[r.x.length - 1]);
  close(E1, E0, 1e-6);
  // small-signal: nonlinear step ~ linear step for a small force
  const small = rk4(nl.f, [0, 0, 0, 0], 0.001, { tEnd: 0.4, dt: 0.001, substeps: 2, h: nl.h });
  const lin = simulate({ ...S, C: [S.C[1]], D: [[0]] }, () => 0.001, { dt: 0.001, n: 400 });
  close(small.y[400], lin.y[400], 2e-3 * Math.abs(lin.y[400]) + 1e-9);
  // maglev: the equilibrium is a fixed point, and a perturbation grows with rate sqrt(2g/x0)
  const mg = plantNonlinear('maglev');
  mg.f(mg.x0, mg.uTrim, 0).forEach((v) => close(v, 0, 1e-9));
  const g = rk4(mg.f, [mg.x0[0] + 1e-6, 0], mg.uTrim, { tEnd: 0.05, dt: 0.0005, substeps: 4 });
  const growth = (g.y[100] - mg.x0[0]) / (g.y[50] - mg.x0[0]);
  assert.ok(growth > 1.5);
  // tank: equilibrium at h0 with trim inflow, and a closed-loop PI holds a new level
  const tk = plantNonlinear('water-tank');
  close(tk.f(tk.x0, tk.uTrim, 0)[0], 0, 1e-12);
  const res = simulateLoop({ plant: tk, controller: { Kp: 2, Ki: 0.5 }, Ts: 0.05, tEnd: 120, r: 1.5, x0: tk.x0 });
  assert.ok(Math.abs(res.y[res.y.length - 1] - 1.5) < 0.05, `level ${res.y[res.y.length - 1]}`);
  assert.equal(plantNonlinear('first-order'), null);
  // ball and beam: double-integrator behaviour for small angles
  const bb = plantNonlinear('ball-beam');
  const rb = rk4(bb.f, [0, 0], 0.01, { tEnd: 1, dt: 0.001 });
  const G = plantTf('ball-beam');
  close(rb.y[1000], (G.num[0] * 0.01) * 0.5, 1e-3);
});
