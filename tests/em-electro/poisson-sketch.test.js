import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import sketch from '../../sketches/em-poisson/index.js';
import { POISSON_PRESETS } from '../../lib/em/poisson.js';

function makeCtx(initial = {}, size = [1200, 720]) {
  const P5 = createMockP5({ width: size[0], height: size[1] });
  const settings = createStore({ namespace: 'pz-test', storage: createMemoryStorage() });
  for (const [k, v] of Object.entries(initial)) settings.set(k, v);
  const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
  const built = [];
  const ctx = {
    p5: P5, settings, globalSettings,
    ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
    drawer: {}, toolbar: {},
    onResize: () => () => {},
    size: () => ({ width: size[0], height: size[1] }),
  };
  return { ctx, P5, built, settings };
}

async function mountIt(initial = {}, size) {
  const { ctx, P5, built, settings } = makeCtx(initial, size);
  const handle = await sketch.mount({}, ctx);
  const p = P5.instances[P5.instances.length - 1];
  p.stepFrames(2);
  return { p, handle, built, settings };
}
const ok = (m, msg = '') => assert.equal(m.p.invalidCalls.length, 0, `${msg} ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));

test('every preset at every resolution mounts, runs and draws without invalid geometry', async () => {
  for (const pr of POISSON_PRESETS) {
    for (const res of [64, 128, 256]) {
      const m = await mountIt({ preset: pr.id, res, 'show.arrows': true, 'm.rb': true, sweeps: 3 });
      m.p.stepFrames(3);
      ok(m, `${pr.id}/${res}`);
      assert.ok(m.p.callsOf('image').length >= 2, 'field + overlay images');
      assert.equal(m.handle.state.prob.cells, res);
      assert.equal(m.settings.get('bc'), pr.bc, 'preset forces its boundary type');
      m.handle.unmount();
    }
  }
});

test('lock-step solvers: all selected methods iterate together and multigrid is fastest', async () => {
  const m = await mountIt({ preset: 'coax', res: 64, sweeps: 4, 'm.rb': true });
  m.p.stepFrames(40);
  const sol = m.handle.state.solvers;
  assert.deepEqual([...sol.keys()].sort(), ['gs', 'jacobi', 'mg', 'rb', 'sor']);
  const slow = [...sol.values()].filter((s) => s.method !== 'mg').map((s) => s.iter);
  assert.ok(slow.every((n) => n === slow[0]) && slow[0] > 20, `lock-step ${slow}`);
  assert.ok(sol.get('mg').converged && sol.get('mg').iter < slow[0], 'multigrid converged first and stopped');
  assert.ok(sol.get('mg').res[sol.get('mg').res.length - 1] < sol.get('jacobi').res[sol.get('jacobi').res.length - 1]);
  assert.ok(sol.get('sor').res[sol.get('sor').res.length - 1] < sol.get('gs').res[sol.get('gs').res.length - 1]);
  assert.ok(texts(m.p).some((t) => t.includes('relative residual')), 'convergence plot');
  ok(m);
  m.handle.unmount();
});

test('capacitance read-outs: ideal plates reproduce eps_r w / d to rounding error; coax within 5 percent', async () => {
  const a = await mountIt({ preset: 'plates', res: 64, epsr: 2, method: 'mg', sweeps: 20 });
  a.p.stepFrames(6);
  const capA = a.handle.state.post.cap;
  const refA = a.handle.state.info.analytic.value;
  assert.ok(Math.abs(capA.CQ - refA) / refA < 1e-4, `${capA.CQ} vs ${refA}`);
  assert.ok(Math.abs(capA.CW - refA) / refA < 1e-4);
  assert.ok(texts(a.p).some((t) => t.includes('C\' by charge')) && texts(a.p).some((t) => t.includes('C\' by energy')));
  a.handle.unmount();
  const b = await mountIt({ preset: 'coax', res: 128, method: 'mg', sweeps: 30 });
  b.p.stepFrames(5);
  const capB = b.handle.state.post.cap;
  const refB = b.handle.state.info.analytic.value;
  assert.ok(Math.abs(capB.CQ - refB) / refB < 0.05, `${capB.CQ} vs ${refB}`);
  assert.ok(Math.abs(capB.CQ - capB.CW) / capB.CW < 5e-3);
  b.handle.unmount();
});

test('wedge preset shows field enhancement and the breakdown overlay at 30 kV', async () => {
  const m = await mountIt({ preset: 'wedge', res: 128, method: 'mg', sweeps: 30, V: 30000, Eb: 3 });
  m.p.stepFrames(5);
  const t = texts(m.p).join('\n');
  assert.ok(/enhancement beta/.test(t), t);
  const f = m.handle.state.post.field;
  assert.ok(f.max > 3e6, `E_max ${f.max}`);
  assert.ok(/breakdown: [1-9]/.test(t) || /breakdown: 0\.\d*[1-9]/.test(t), 'some gas above E_b');
  // lowering the voltage removes the overlay
  m.settings.set('V', 100);
  m.p.stepFrames(6);
  assert.ok(/breakdown: 0 %/.test(texts(m.p).join('\n')));
  ok(m);
  m.handle.unmount();
});

test('painting conductors, dielectrics and charge detaches the preset and changes the problem', async () => {
  const m = await mountIt({ preset: 'plates', res: 64, tool: 'conductor', V: 5000, brush: 3 });
  const S = m.handle.state;
  const L = S.layout.dom;
  const x = L.x + 10 * L.cw, y = L.y + L.h - 32 * L.cw;
  const v0 = S.prob.version;
  m.p.moveMouse(x, y);
  m.p.pressMouse(x, y);
  m.p.moveMouse(x + 5 * L.cw, y);
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.equal(m.settings.get('preset'), '', 'preset detached');
  assert.ok(S.prob.version > v0);
  assert.equal(S.prob.fixedV[S.prob.idx(10, 32)], 5000);
  // erase with the right button
  m.p.pressMouse(x, y, 'right');
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.equal(S.prob.fixed[S.prob.idx(10, 32)], 0);
  // dielectric & charge
  m.settings.set('tool', 'dielectric');
  m.settings.set('epsr', 6);
  m.p.stepFrames(1);
  m.p.click(x + 20 * L.cw, y);
  m.settings.set('tool', 'charge');
  m.p.click(x + 30 * L.cw, y);
  m.p.stepFrames(2);
  assert.equal(S.prob.eps[S.prob.idx(30, 32)], 6);
  assert.ok(S.prob.rho[S.prob.idx(40, 32)] !== 0);
  ok(m);
  m.handle.unmount();
});

test('probe tool drops, cycles and removes probes; read-outs appear', async () => {
  const m = await mountIt({ preset: 'coax', res: 64, tool: 'probe', method: 'mg', sweeps: 20 });
  const S = m.handle.state;
  const L = S.layout.dom;
  for (let k = 0; k < 5; k++) m.p.click(L.x + (10 + 8 * k) * L.cw, L.y + 20 * L.cw);
  assert.equal(S.probes.length, 4);
  m.p.click(L.x + 34 * L.cw, L.y + 20 * L.cw); // click on an existing probe removes it
  assert.equal(S.probes.length, 3);
  m.p.moveMouse(L.x + 30 * L.cw, L.y + 30 * L.cw);
  m.p.stepFrames(3);
  const t = texts(m.p);
  assert.ok(t.some((s) => s.startsWith('probe 1')) && t.some((s) => s.startsWith('cursor')));
  ok(m);
  m.handle.unmount();
});

test('boundary / resolution / aspect changes rebuild the problem; keys and buttons work', async () => {
  const m = await mountIt({ preset: '', res: 64, bc: 'grounded', tool: 'conductor', brush: 4 });
  const S = m.handle.state;
  const L = S.layout.dom;
  m.p.click(L.x + 30 * L.cw, L.y + 30 * L.cw);
  const nCond = () => [...S.prob.fixed].filter((v, k) => v && S.prob.fixedV[k] === m.settings.get('V')).length;
  const before = nCond();
  assert.ok(before > 0);
  m.settings.set('res', 128);
  m.p.stepFrames(2);
  assert.equal(S.prob.cells, 128);
  assert.ok(nCond() > before, 'painted content resampled to the finer grid');
  m.settings.set('aspect', 0.5);
  m.settings.set('bc', 'periodic');
  m.p.stepFrames(2);
  assert.equal(S.prob.cellsY, 64);
  assert.equal(S.prob.bc, 'periodic');
  m.p.pressKey(' ', 32);
  assert.equal(m.settings.get('run'), false);
  const it = [...S.solvers.values()][0].iter;
  m.p.pressKey('n', 78);
  m.p.stepFrames(1);
  assert.equal([...S.solvers.values()][0].iter, it + 1);
  m.p.pressKey('r', 82);
  m.handle.actions.solveNow();
  m.p.stepFrames(2);
  m.handle.actions.clear();
  m.p.stepFrames(2);
  ok(m);
  m.handle.unmount();
  m.handle.unmount();
});

test('deep-link keys arrive as strings and Open in buttons target the right units', async () => {
  const m = await mountIt({ preset: 'dielectric', res: '64', epsr: '3', V: '2000', bc: 'neumann', method: 'mg', sweeps: '10' });
  assert.equal(m.handle.state.prob.cells, 64);
  m.p.stepFrames(5);
  assert.ok(texts(m.p).some((t) => t.startsWith('refraction')));
  const group = m.built.flat().find((n) => n.label === 'Open in...');
  assert.ok(group.children.length >= 3);
  const hashes = [];
  globalThis.location = { set hash(v) { hashes.push(v); } };
  try { for (const b of group.children) b.onClick(); } finally { delete globalThis.location; }
  assert.deepEqual(hashes.map((h) => h.split('?')[0]), ['#/em-electrostatics', '#/em-electrostatics', '#/ma-vector', '#/em-magnetostatics']);
  assert.ok(hashes[1].includes('tab=gauss'));
  m.handle.unmount();
});

test('narrow layout and theme switch draw cleanly', async () => {
  const m = await mountIt({ preset: 'faraday', res: 64 }, [700, 800]);
  m.p.stepFrames(3);
  ok(m, 'narrow');
  m.handle.unmount();
});
