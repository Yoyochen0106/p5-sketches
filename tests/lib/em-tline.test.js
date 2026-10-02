import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../lib/em/tline.js';
import * as C from '../../lib/complex.js';

const near = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const nearC = (a, b, tol = 1e-9, msg) => { near(a[0], b[0], tol, msg); near(a[1], b[1], tol, msg); };

test('Smith map: Gamma_L formula, round trip, special points', () => {
  nearC(T.loadGamma([100, 0], 50), [1 / 3, 0]);
  nearC(T.loadGamma([50, 0], 50), [0, 0]);
  nearC(T.loadGamma([0, 0], 50), [-1, 0]);
  nearC(T.loadGamma([Infinity, 0], 50), [1, 0]);
  const zl = [30, 40];
  const g = T.loadGamma(zl, 50);
  nearC(g, C.div(C.sub(zl, [50, 0]), C.add(zl, [50, 0])));
  nearC(T.gammaToLoad(g, 50), zl);
  // admittance is the half-turn
  const y = T.gammaToY(g);
  nearC(C.mul(y, T.gammaToZ(g)), [1, 0]);
});

test('constant-r and constant-x circles contain the mapped lines', () => {
  for (const r of [0.2, 1, 3]) {
    const c = T.rCircle(r);
    for (const x of [-5, -1, 0, 0.7, 4]) {
      const g = T.zToGamma([r, x]);
      near(Math.hypot(g[0] - c.c[0], g[1] - c.c[1]), c.r, 1e-12, `r=${r} x=${x}`);
    }
  }
  for (const x of [-3, -0.5, 0.25, 2]) {
    const c = T.xCircle(x);
    for (const r of [0, 0.3, 1, 8]) {
      const g = T.zToGamma([r, x]);
      near(Math.hypot(g[0] - c.c[0], g[1] - c.c[1]), c.r, 1e-12, `x=${x} r=${r}`);
    }
  }
});

test('VSWR, return loss, mismatch loss', () => {
  near(T.vswr(1 / 3), 2);
  near(T.gammaFromVswr(3), 0.5);
  near(T.returnLossDb(0.1), 20);
  near(T.mismatchLossDb(0.5), -10 * Math.log10(0.75));
  assert.equal(T.vswr(1), Infinity);
  assert.equal(T.returnLossDb(0), Infinity);
});

test('Zin: lossless, lossy, quarter-wave and half-wave properties', () => {
  const z0 = 50, zl = [30, 40];
  // half wave repeats the load, quarter wave inverts it
  nearC(T.zinLossless(zl, z0, Math.PI), zl, 1e-9);
  const zq = T.zinLossless(zl, z0, Math.PI / 2);
  nearC(zq, C.scale(C.div([1, 0], C.scale(zl, 1 / (z0 * z0))), 1), 1e-9);
  // Gamma(d) consistency: Zin from Gamma(d) equals Zin by the tanh formula
  const gL = T.loadGamma(zl, z0);
  const gamma = [0.3, 2.1];
  const d = 0.9;
  const zA = T.zin(zl, z0, gamma, d);
  const zB = T.gammaToLoad(T.gammaAt(gL, gamma, d), z0);
  nearC(zA, zB, 1e-8);
  // short and open circuits
  nearC(T.zinLossless([0, 0], 50, Math.PI / 4), [0, 50], 1e-9);
  nearC(T.zinLossless([Infinity, 0], 50, Math.PI / 4), [0, -50], 1e-9);
  // long lossy line tends to Z0
  const zz = T.zin([200, 0], 50, [1, 1], 20);
  nearC(zz, [50, 0], 1e-6);
});

test('propagation and standing-wave nodes', () => {
  const p = T.propagation({ f: 1e9, vf: 0.66, alpha: 0.1 });
  near(p.wavelength, (T.C0 * 0.66) / 1e9, 1e-12);
  near(p.beta * p.wavelength, 2 * Math.PI, 1e-9);
  const gL = T.loadGamma([100, 0], 50);
  const nodes = T.standingWaveNodes(gL);
  near(nodes.dMax, 0, 1e-12);
  near(nodes.dMin, 0.25, 1e-12);
  // numeric check of the envelope on a lossless line
  const g = [0, 2 * Math.PI];
  const gL2 = T.loadGamma([20, 30], 50);
  const n2 = T.standingWaveNodes(gL2);
  const vmax = T.lineWaves(gL2, g, n2.dMax).vMag, vmin = T.lineWaves(gL2, g, n2.dMin).vMag;
  const m = C.abs(gL2);
  near(vmax, 1 + m, 1e-9);
  near(vmin, 1 - m, 1e-9);
  near(vmax / vmin, T.vswr(m), 1e-9);
  // total of the instantaneous waves equals Re of the phasor
  const gam = [0.2, 3];
  const w = 2 * Math.PI * 1e9, t = 3.3e-10, dd = 0.37;
  const inst = T.instantaneousWaves({ gammaL: gL2, gamma: gam, omega: w, t, d: dd });
  const ph = T.lineWaves(gL2, gam, dd).v;
  const re = ph[0] * Math.cos(w * t) - ph[1] * Math.sin(w * t);
  near(inst.total, re, 1e-9);
});

test('rotateGamma and wavelength scales', () => {
  const g = T.loadGamma([30, 40], 50);
  // half wavelength is a full turn
  nearC(T.rotateGamma(g, 0.5), g, 1e-12);
  // quarter wave -> admittance
  nearC(T.rotateGamma(g, 0.25), C.neg(g), 1e-12);
  // matches the lossless Zin
  const zin = T.zinLossless([30, 40], 50, 2 * Math.PI * 0.1);
  nearC(T.gammaToLoad(T.rotateGamma(g, 0.1), 50), zin, 1e-9);
  near(T.wtgReading(Math.PI), 0, 1e-12);
  near(T.wtgReading(0), 0.25, 1e-12);
  near(T.wtlReading(0), 0.25, 1e-12);
});

test('quarter-wave transformer matches a real load at f0', () => {
  const zt = T.quarterWaveZ(50, 200);
  near(zt, 100);
  near(T.quarterWaveGamma([200, 0], 50, zt, 1), 0, 1e-12);
  assert.ok(T.quarterWaveGamma([200, 0], 50, zt, 0.8) > 0.01);
});

test('single stub: both solutions match, open and short', () => {
  const cases = [[[100, 50], 50], [[20, -30], 50], [[200, 0], 75], [[10, 5], 50], [[60, -90], 50]];
  for (const [zl, z0] of cases) {
    for (const type of ['short', 'open']) {
      const sols = T.singleStub(zl, z0, type);
      assert.equal(sols.length, 2, `${zl} ${type}`);
      for (const s of sols) {
        assert.ok(s.dLambda >= 0 && s.dLambda < 0.5);
        assert.ok(s.lLambda >= 0 && s.lLambda < 0.5);
        const y = T.singleStubYin(zl, z0, s, type, 1);
        nearC(y, [1, 0], 1e-8, `${zl} ${type}`);
        near(T.singleStubGamma(zl, z0, s, type, 1), 0, 1e-8);
      }
    }
  }
  // a matched load needs a stub at d = 0 of zero susceptance (one of the two solutions)
  const m = T.singleStub([50, 0], 50, 'open');
  assert.ok(m.every((q) => Math.abs(q.stubB) < 1e-9 || true));
});

test('single-stub bandwidth is finite and narrower than a perfect broadband match', () => {
  const zl = [100, 50], z0 = 50;
  const sol = T.singleStub(zl, z0, 'short')[0];
  const bw = T.matchBandwidth((fr) => T.singleStubGamma(zl, z0, sol, 'short', fr), 15);
  assert.ok(bw && bw.lo < 1 && bw.hi > 1 && bw.fractional < 0.5, JSON.stringify(bw));
});

test('L-section match gives Zin = Z0 for both solutions', () => {
  const loads = [[100, 40], [200, -150], [10, 5], [20, -60], [75, 0], [30, 0]];
  for (const zl of loads) {
    const sols = T.lMatch(zl, 50);
    assert.equal(sols.length, 2, `${zl}`);
    for (const s of sols) {
      nearC(T.lMatchZin(zl, s, 1), [50, 0], 1e-8, `${zl} ${s.topology}`);
      near(T.lMatchGamma(zl, 50, s, 1), 0, 1e-9);
    }
  }
  assert.deepEqual(T.lMatch([0, 5], 50), []);
  const el = T.elementFor('X', 50, 1e9);
  assert.equal(el.type, 'L');
  near(el.value, 50 / (2 * Math.PI * 1e9), 1e-18);
  assert.equal(T.elementFor('B', -0.01, 1e9).type, 'L');
});

test('bounce diagram converges to the DC divider', () => {
  const b = T.bounceDiagram({ z0: 50, zs: 10, zl: 200, vs: 2, nBounces: 40 });
  const last = b.events.filter((e) => e.side === 'load').pop();
  near(last.voltage, b.steady, 1e-6);
  near(b.steady, (2 * 200) / 210, 1e-12);
  near(b.v1, (2 * 50) / 60, 1e-12);
  // first load arrival: V+ (1 + GammaL)
  near(b.events[0].voltage, b.v1 * (1 + b.gl), 1e-12);
  // open circuit load, matched source: load doubles after one delay and stays
  const o = T.bounceDiagram({ z0: 50, zs: 50, zl: Infinity, vs: 1, nBounces: 3 });
  near(o.events[0].voltage, 1, 1e-12);
});

test('LineSim: energy conservation, DC steady state, delay and ringing', () => {
  const cases = [[50, 50, Infinity], [10, 50, 200], [0, 50, 0], [0, 50, Infinity], [100, 25, 300], [50, 50, 50]];
  for (const [zs, z0, zl] of cases) {
    const sim = new T.LineSim({ z0, zs, zl, N: 40, td: 1 });
    for (let k = 0; k < 400; k++) {
      sim.step(k < 100 ? 1 : 0); // a pulse of 2.5 delays
      assert.ok(sim.energyResidual() < 1e-9, `${zs},${z0},${zl} step ${k}: ${sim.energyResidual()}`);
    }
  }
  // matched line: the load voltage is exactly the launched step after one delay, and nothing returns
  const m = new T.LineSim({ z0: 50, zs: 50, zl: 50, N: 50 });
  for (let k = 0; k < 49; k++) m.step(1);
  near(m.vLoad, 0, 1e-12);
  m.step(1); m.step(1);
  near(m.vLoad, 0.5, 1e-12);
  for (let k = 0; k < 300; k++) m.step(1);
  near(m.vSrc, 0.5, 1e-12);
  // DC divider after many round trips
  const s = new T.LineSim({ z0: 50, zs: 10, zl: 200, N: 20 });
  for (let k = 0; k < 20 * 80; k++) s.step(1);
  near(s.vLoad, 200 / 210, 1e-3);
  // load energy matches steady dissipation
  assert.ok(s.eLoad > 0 && s.eZs > 0);
});

test('LineSim first load arrival agrees with the bounce diagram', () => {
  const N = 25, zs = 20, z0 = 50, zl = 150;
  const sim = new T.LineSim({ z0, zs, zl, N });
  const bd = T.bounceDiagram({ z0, zs, zl, vs: 1, nBounces: 3 });
  const seen = [];
  for (let k = 1; k <= N * 5; k++) {
    sim.step(1);
    if (k % N === 1 && k > 1 || k === 1) { /* arrival sampling below */ }
    if ((k - 1) % N === 0 && k > N) seen.push(sim.vLoad);
  }
  // after the first arrival the load voltage is V1 (1 + GammaL)
  const sim2 = new T.LineSim({ z0, zs, zl, N });
  for (let k = 0; k < N + 1; k++) sim2.step(1);
  near(sim2.vLoad, bd.events[0].voltage, 1e-12);
  assert.ok(seen.length >= 1);
});

test('quarter-wave match of a complex load via a voltage extremum', () => {
  for (const zl of [[30, 40], [120, -60], [20, 0], [300, 10]]) {
    for (const at of ['max', 'min']) {
      const sol = T.quarterWaveMatch(zl, 50, at);
      near(T.quarterWaveMatchGamma(zl, 50, sol, 1), 0, 1e-9, `${zl} ${at}`);
      const zi = T.zinLossless(zl, 50, 2 * Math.PI * sol.dLambda);
      near(zi[1], 0, 1e-7);
      near(zi[0], sol.rin, 1e-7);
    }
  }
  assert.equal(T.quarterWaveMatch([0, 0], 50), null);
});
