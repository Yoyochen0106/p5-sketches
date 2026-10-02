import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import sketch from '../../sketches/em-electrostatics/index.js';
import { gaussResult } from '../../sketches/em-electrostatics/gauss-tab.js';
import { particleReadout } from '../../sketches/em-electrostatics/scene.js';
import { unitHash } from '../../sketches/em-electrostatics/link.js';

function makeCtx(initial = {}, size = [1100, 700]) {
  const P5 = createMockP5({ width: size[0], height: size[1] });
  const settings = createStore({ namespace: 'es-test', storage: createMemoryStorage() });
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

async function mountIt(initial = {}) {
  const { ctx, P5, built, settings } = makeCtx(initial);
  const handle = await sketch.mount({}, ctx);
  const p = P5.instances[P5.instances.length - 1];
  p.stepFrames(2);
  return { p, handle, built, settings };
}

const ok = (m, msg = '') => assert.equal(m.p.invalidCalls.length, 0, `${msg} ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);

test('charges tab: every preset draws with all layers on', async () => {
  for (const preset of ['dipole', 'quadrupole', 'like', 'ring', 'lines', 'plates']) {
    for (const map of ['none', 'E', 'V']) {
      const m = await mountIt({ preset, map, arrows: true, equiLog: map === 'V', farField: true });
      m.p.moveMouse(500, 300);
      m.p.stepFrames(2);
      ok(m, `${preset}/${map}`);
      assert.ok(m.p.callsOf('endShape').length > 10, 'field lines and contours drawn');
      if (map !== 'none') assert.ok(m.p.callsOf('image').length > 0);
      m.handle.unmount();
    }
  }
});

test('preset change swaps the charges and law; deep link charges override the preset', async () => {
  const m = await mountIt({ preset: 'quadrupole' });
  assert.equal(m.handle.state.charges.length, 3);
  m.settings.set('preset', 'lines');
  m.p.stepFrames(2);
  assert.equal(m.handle.state.charges.length, 2);
  assert.equal(m.settings.get('law'), '2d');
  m.handle.unmount();
  const d = await mountIt({ charges: '0,0,2;3,1,-1.5;-2,2,1', preset: 'dipole' });
  assert.equal(d.handle.state.charges.length, 3);
  assert.equal(d.handle.state.charges[1].q, -1.5);
  d.handle.unmount();
});

test('add / remove tools, dragging a charge and persistence into the charges setting', async () => {
  const m = await mountIt({ preset: 'dipole', tool: 'add', newQ: 2 });
  const n0 = m.handle.state.charges.length;
  m.p.click(550, 150);
  assert.equal(m.handle.state.charges.length, n0 + 1);
  assert.equal(m.handle.state.charges[n0].q, 2);
  assert.equal(m.settings.get('preset'), '', 'editing detaches the preset');
  m.settings.set('tool', 'remove');
  const c = m.handle.state.charges[n0];
  m.p.click(m.handle.state.view.toX(c.x), m.handle.state.view.toY(c.y));
  assert.equal(m.handle.state.charges.length, n0);
  // drag
  m.settings.set('tool', 'move');
  const c0 = { ...m.handle.state.charges[0] };
  const sx = m.handle.state.view.toX(c0.x), sy = m.handle.state.view.toY(c0.y);
  m.p.moveMouse(sx, sy);
  m.p.pressMouse(sx, sy);
  m.p.moveMouse(sx + 80, sy - 40);
  m.p.releaseMouse();
  assert.ok(m.handle.state.charges[0].x > c0.x + 0.1, 'charge moved right');
  m.p.stepFrames(25);
  assert.ok(String(m.settings.get('charges')).split(';').length === n0, 'persisted');
  ok(m);
  m.handle.unmount();
});

test('wheel over a charge changes q, elsewhere zooms; keys flip and delete', async () => {
  const m = await mountIt({ preset: 'dipole' });
  const S = m.handle.state;
  const c = S.charges[0];
  const q0 = c.q;
  m.p.moveMouse(S.view.toX(c.x), S.view.toY(c.y));
  m.p.fire('mouseWheel', { deltaY: 100, deltaMode: 0 });
  assert.ok(S.charges[0].q < q0);
  const span = S.view.xmax - S.view.xmin;
  m.p.moveMouse(300, 600);
  m.p.fire('mouseWheel', { deltaY: -200, deltaMode: 0 });
  assert.ok(S.view.xmax - S.view.xmin < span);
  m.p.moveMouse(S.view.toX(S.charges[1].x), S.view.toY(S.charges[1].y));
  const q1 = S.charges[1].q;
  m.p.pressKey('f', 70);
  assert.equal(S.charges[1].q, -q1);
  m.p.pressKey('Delete', 46);
  assert.equal(S.charges.length, 1);
  m.p.stepFrames(2);
  ok(m);
  m.handle.unmount();
});

test('test charge conserves energy and draws a trail', async () => {
  const m = await mountIt({ preset: 'dipole', tool: 'test', pq: 1, pm: 1, pspeed: 20 });
  const S = m.handle.state;
  m.p.moveMouse(600, 200);
  m.p.pressMouse(600, 200);
  m.p.moveMouse(640, 230);
  m.p.releaseMouse();
  assert.ok(S.particle);
  const E0 = S.particle.E0;
  m.p.stepFrames(60);
  assert.ok(S.particle.trail.length > 10);
  assert.ok(Number.isFinite(E0));
  const rd = particleReadout(S);
  assert.ok(Math.abs(rd.drift) < 5e-3, `energy drift ${rd.drift}`);
  assert.ok(Math.hypot(rd.x - 0, rd.y - 0) > 0);
  ok(m);
  const texts = m.p.callsOf('text').map((c) => String(c.args[0]));
  assert.ok(texts.some((t) => t.includes('drift')), 'energy read-out');
  m.handle.unmount();
});

test('gauss tab: numerical flux equals enclosed charge for circle, rectangle, polygon; flux jumps when a charge crosses', async () => {
  for (const kind of ['circle', 'rect', 'poly']) {
    const m = await mountIt({ tab: 'gauss', 'gauss.kind': kind, charges: '0,0,1.5;1,0.2,-0.5;5,5,2' });
    const S = m.handle.state;
    m.p.stepFrames(2);
    const r = gaussResult(S);
    assert.ok(Math.abs(r.flux - r.enclosed) < 1e-5, `${kind}: ${r.flux} vs ${r.enclosed}`);
    ok(m, kind);
    m.handle.unmount();
  }
  const m = await mountIt({ tab: 'gauss', 'gauss.kind': 'circle', charges: '0,0,1;40,0,1' });
  const S = m.handle.state;
  const g = S.gauss;
  const before = gaussResult(S).flux;
  // move the far charge inside the circle
  S.charges[1].x = g.circle.cx + 0.3 * g.circle.r;
  S.charges[1].y = g.circle.cy;
  S.chVer++;
  const after = gaussResult(S).flux;
  assert.ok(Math.abs(after - before - 1) < 1e-6, `${before} -> ${after}`);
  m.handle.unmount();
});

test('gauss tab: handles, interior drag, free-hand polygon and sweep', async () => {
  const m = await mountIt({ tab: 'gauss', 'gauss.kind': 'circle', charges: '0,0,1' });
  const S = m.handle.state;
  const g = S.gauss;
  const v = S.view;
  const hx = v.toX(g.circle.cx + g.circle.r), hy = v.toY(g.circle.cy);
  const r0 = g.circle.r;
  m.p.moveMouse(hx, hy);
  m.p.pressMouse(hx, hy);
  m.p.moveMouse(hx + 60, hy);
  m.p.releaseMouse();
  assert.ok(g.circle.r > r0);
  // free hand
  m.handle.actions.armDraw();
  assert.equal(m.settings.get('gauss.kind'), 'poly');
  m.p.stepFrames(1);
  m.p.moveMouse(300, 300);
  m.p.pressMouse(300, 300);
  for (let k = 1; k <= 12; k++) m.p.moveMouse(300 + 40 * Math.cos(k / 2), 300 + 40 * Math.sin(k / 2));
  m.p.releaseMouse();
  assert.ok(S.gauss.poly.pts.length >= 3);
  m.p.stepFrames(2);
  // sweep
  m.settings.set('gauss.sweep', true);
  const x0 = S.charges[0].x;
  m.p.stepFrames(30);
  assert.notEqual(S.charges[0].x, x0);
  const h = S.gauss.hist;
  assert.ok(h.flux.length > 5);
  m.settings.set('gauss.sweep', false);
  m.p.stepFrames(2);
  ok(m);
  m.handle.unmount();
});

test('continuous tab: every distribution draws; both profiles', async () => {
  for (const kind of ['rod', 'ring', 'disk', 'ball', 'gauss']) {
    for (const profile of ['axis', 'radial']) {
      const m = await mountIt({ tab: 'continuous', 'cont.kind': kind, 'cont.profile': profile, 'cont.res': 24 });
      m.p.moveMouse(500, 200);
      m.p.stepFrames(2);
      ok(m, `${kind}/${profile}`);
      assert.ok(m.p.callsOf('image').length > 0);
      m.handle.unmount();
    }
  }
});

test('tab switching, resize, url-style string settings, links and unmount twice', async () => {
  const m = await mountIt({ tab: 'charges', soft: '0.1', lines: 'true', perUnit: '6' });
  for (const tab of ['gauss', 'continuous', 'charges']) {
    m.settings.set('tab', tab);
    m.p.stepFrames(2);
    ok(m, tab);
  }
  assert.ok(m.built.length > 0);
  assert.equal(unitHash('em-poisson', { preset: 'plates', n: 3 }), '#/em-poisson?preset=plates&n=3');
  const group = m.built.flat().find((n) => n.label === 'Open in...');
  assert.ok(group && group.children.length >= 3);
  const hashes = [];
  globalThis.location = { set hash(v) { hashes.push(v); } };
  try { for (const b of group.children) b.onClick(); } finally { delete globalThis.location; }
  assert.deepEqual(hashes.map((h) => h.split('?')[0]), ['#/em-poisson', '#/em-poisson', '#/ma-vector', '#/em-magnetostatics']);
  m.handle.unmount();
  m.handle.unmount();
});
