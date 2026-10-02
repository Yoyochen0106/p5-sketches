import test from 'node:test';
import assert from 'node:assert/strict';
import * as ps from '../../lib/em/poisson.js';

const presetOf = (id) => ps.POISSON_PRESETS.find((p) => p.id === id);
function build(id, cells = 64, extra = {}) {
  const pr = presetOf(id);
  const prob = new ps.PoissonProblem({ cells, aspect: pr.aspect, bc: pr.bc });
  const info = pr.make(prob, { V: 1, epsr: pr.defaultEpsr || 1, ...extra });
  prob.commit();
  return { prob, info, pr };
}

test('grounded box with uniform source matches the series solution', () => {
  const prob = new ps.PoissonProblem({ cells: 64, bc: 'grounded', width: 1 });
  prob.rho.fill(1);
  prob.commit();
  const { phi, residual } = ps.solve(prob, { tol: 1e-12, maxCycles: 40 });
  assert.ok(residual < 1e-10);
  // -lap phi = 1 on the unit square, centre value 0.0736713...
  const c = phi[prob.idx(32, 32)];
  assert.ok(Math.abs(c - 0.07367135) < 2e-4, `centre ${c}`);
});

test('1-D parallel plates: both capacitance methods equal eps_r w / d exactly', () => {
  for (const epsr of [1, 3]) {
    const { prob, info } = build('plates', 64, { epsr });
    const { phi } = ps.solve(prob, { tol: 1e-12, maxCycles: 60 });
    const c = ps.capacitance(prob, phi);
    assert.ok(Math.abs(c.CQ - info.analytic.value) / info.analytic.value < 1e-6, `CQ ${c.CQ} vs ${info.analytic.value}`);
    assert.ok(Math.abs(c.CW - info.analytic.value) / info.analytic.value < 1e-6, `CW ${c.CW}`);
    // uniform field between the plates
    const f = ps.fieldFromPhi(prob, phi);
    const mid = f.ey[32 + prob.nx * 32];
    assert.ok(Math.abs(Math.abs(mid) * prob.h - (1 / (0.5 * prob.cells))) < 0.2 / prob.cells);
  }
});

test('coax: C by charge and by energy agree and match 2 pi / ln(b/a) within a few percent', () => {
  const { prob, info } = build('coax', 128);
  const { phi } = ps.solve(prob, { tol: 1e-11, maxCycles: 80 });
  const c = ps.capacitance(prob, phi);
  const ref = info.analytic.value;
  assert.ok(Math.abs(c.CQ - ref) / ref < 0.05, `CQ ${c.CQ} vs ${ref}`);
  assert.ok(Math.abs(c.CW - ref) / ref < 0.05, `CW ${c.CW} vs ${ref}`);
  assert.ok(Math.abs(c.CQ - c.CW) / c.CW < 2e-3, `methods ${c.CQ} ${c.CW}`);
  // potential between the cylinders follows the log law
  const r = 0.2;
  const i = Math.round((0.5 + r) * prob.cells), j = Math.round(0.5 * prob.cells);
  const exact = ps.coaxPotential(r, 0.1, 0.36, 1);
  assert.ok(Math.abs(phi[prob.idx(i, j)] - exact) < 0.03);
});

test('finite plate over a floor: ideal formula underestimates; charge and energy agree', () => {
  const { prob, info } = build('plates-finite', 128);
  const { phi } = ps.solve(prob, { tol: 1e-11, maxCycles: 80 });
  const c = ps.capacitance(prob, phi);
  assert.ok(c.CQ > info.analytic.value);
  assert.ok(Math.abs(c.CQ - c.CW) / c.CW < 2e-3);
});

test('Neumann box energy/charge consistency with a conductor touching the wall', () => {
  const prob = new ps.PoissonProblem({ cells: 64, bc: 'neumann' });
  ps.stamp(prob, 'conductor', 0, 20, 6, 1);
  ps.stamp(prob, 'conductor', 64, 50, 6, -1);
  prob.commit();
  const { phi } = ps.solve(prob, { tol: 1e-12, maxCycles: 80 });
  const c = ps.capacitance(prob, phi);
  assert.ok(Math.abs(c.CQ - c.CW) / c.CW < 1e-5, `${c.CQ} ${c.CW}`);
  assert.ok(Math.abs(c.groups[0].Q + c.groups[1].Q) < 1e-6 * Math.abs(c.groups[0].Q));
});

test('all five solvers converge to the same field; ordering of convergence speed', () => {
  const { prob } = build('coax', 64);
  const ref = ps.solve(prob, { tol: 1e-12, maxCycles: 80 }).phi;
  const iters = {};
  for (const m of ps.METHODS) {
    const s = new ps.Solver(prob, m.id, { tol: 1e-7, maxIter: 20000 });
    s.step(20000);
    iters[m.id] = s.iter;
    assert.ok(s.converged, `${m.id} did not converge (${s.res[s.res.length - 1]})`);
    let err = 0;
    for (let k = 0; k < prob.size; k++) err = Math.max(err, Math.abs(s.phi[k] - ref[k]));
    assert.ok(err < 1e-4, `${m.id} error ${err}`);
  }
  assert.ok(iters.mg < 30, `mg ${iters.mg}`);
  assert.ok(iters.sor < iters.gs && iters.gs < iters.jacobi, JSON.stringify(iters));
  assert.ok(iters.gs < 0.65 * iters.jacobi);
  assert.ok(Math.abs(iters.sor - iters.rb) < 0.25 * iters.sor + 5, JSON.stringify(iters));
});

test('optimal omega formula', () => {
  const w = ps.optimalOmega(65, 65);
  assert.ok(Math.abs(w - 2 / (1 + Math.sin(Math.PI / 64))) < 1e-9);
  assert.ok(w > 1.9 && w < 2);
});

test('multigrid convergence factor is grid independent', () => {
  const rates = [];
  for (const cells of [64, 128]) {
    const { prob } = build('coax', cells);
    const s = new ps.Solver(prob, 'mg', { tol: 1e-12, maxIter: 12 });
    s.step(8);
    rates.push(Math.pow(s.res[s.res.length - 1], 1 / s.iter));
  }
  assert.ok(rates[0] < 0.3 && rates[1] < 0.3, JSON.stringify(rates));
});

test('periodic box: neutral charge gives a zero-mean potential that satisfies the equation', () => {
  const prob = new ps.PoissonProblem({ cells: 64, bc: 'periodic', width: 1 });
  for (let j = 0; j < prob.ny; j++) for (let i = 0; i < prob.nx; i++) {
    prob.rho[prob.idx(i, j)] = Math.cos(2 * Math.PI * i / 64) * Math.cos(2 * Math.PI * j / 64);
  }
  prob.commit();
  const { phi, residual } = ps.solve(prob, { tol: 1e-12, maxCycles: 60 });
  assert.ok(residual < 1e-8, `res ${residual}`);
  // continuous solution: phi = rho / (8 pi^2) (+ constant)
  const a = phi[prob.idx(0, 0)] - phi[prob.idx(32, 0)];
  const exact = 2 / (8 * Math.PI * Math.PI);
  assert.ok(Math.abs(a - exact) / exact < 5e-3, `${a} vs ${exact}`);
});

test('wedge electrode concentrates the field at the tip', () => {
  const { prob, info } = build('wedge', 128);
  const { phi } = ps.solve(prob, { tol: 1e-10, maxCycles: 80 });
  const f = ps.fieldFromPhi(prob, phi);
  const Eavg = 1 / (info.gap * prob.width);
  assert.ok(f.max / Eavg > 2, `enhancement ${f.max / Eavg}`);
  assert.ok(Math.abs(f.maxI - 64) <= 3 && Math.abs(f.maxJ - 0.375 * 128) <= 4, `max at ${f.maxI},${f.maxJ}`);
});

test('Faraday cage: field inside the closed shell is far weaker than outside; a slot lets it leak', () => {
  const ratio = (id) => {
    const { prob, info } = build(id, 128);
    const { phi } = ps.solve(prob, { tol: 1e-10, maxCycles: 80 });
    const f = ps.fieldFromPhi(prob, phi);
    const ins = ps.sampleField(prob, f.mag, info.check.inside[0], info.check.inside[1]);
    const out = ps.sampleField(prob, f.mag, info.check.outside[0], info.check.outside[1]);
    return ins / out;
  };
  const closed = ratio('faraday'), open = ratio('faraday-open');
  assert.ok(closed < 0.02, `closed ${closed}`);
  assert.ok(open > 5 * closed, `open ${open}`);
});

test('dielectric interface obeys tan(theta1)/tan(theta2) = eps1/eps2', () => {
  const { prob, info } = build('dielectric', 256);
  const { phi } = ps.solve(prob, { tol: 1e-11, maxCycles: 80 });
  const f = ps.fieldFromPhi(prob, phi);
  const c = info.check;
  const r = ps.refractionCheck(prob, f, c.u, c.v, c.nu, c.nv, c.epsA, c.epsB, 0.02);
  assert.ok(r.thetaA > r.thetaB);
  assert.ok(Math.abs(r.ratio - r.expected) / r.expected < 0.2, `ratio ${r.ratio} expected ${r.expected}`);
});

test('conductor surface charge: total induced charge balances the free charge (grounded box)', () => {
  const prob = new ps.PoissonProblem({ cells: 64, bc: 'grounded', width: 0.1 });
  ps.stamp(prob, 'charge', 32, 32, 4, 1e6);
  prob.commit();
  const { phi } = ps.solve(prob, { tol: 1e-12, maxCycles: 60 });
  const q = ps.nodeCharges(prob, phi);
  let sum = 0;
  for (const v of q) sum += v;
  const free = ps.freeCharge(prob);
  assert.ok(Math.abs(sum + free) < 2e-3 * Math.abs(free), `${sum} + ${free}`);
});

test('stamp / resample / presets run at every supported resolution', () => {
  for (const cells of [64, 128, 256]) {
    for (const pr of ps.POISSON_PRESETS) {
      const prob = new ps.PoissonProblem({ cells, aspect: pr.aspect, bc: pr.bc });
      pr.make(prob, { V: 1, epsr: pr.defaultEpsr || 2, rho: 1, rhoNorm: 1e6 });
      prob.commit();
      const s = new ps.Solver(prob, 'mg');
      s.step(2);
      assert.ok(Number.isFinite(s.residual));
    }
  }
  const a = new ps.PoissonProblem({ cells: 64 });
  ps.stamp(a, 'conductor', 32, 32, 5, 3);
  a.commit();
  const b = new ps.PoissonProblem({ cells: 128 });
  ps.resampleInto(b, a);
  b.commit();
  assert.equal(b.fixedV[b.idx(64, 64)], 3);
});
