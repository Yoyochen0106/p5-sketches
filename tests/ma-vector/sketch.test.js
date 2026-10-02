import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import sketch from '../../sketches/ma-vector/index.js';
import { PRESETS_2D, PRESETS_3D } from '../../lib/vectorcalc.js';

const W = 900, H = 640;

async function mountSketch(initial = {}, size = { width: W, height: H }) {
  const P5 = createMockP5({ width: size.width, height: size.height });
  const settings = createStore({ namespace: 'mv-test', storage: createMemoryStorage() });
  for (const [k, v] of Object.entries(initial)) settings.set(k, v);
  const globalSettings = createStore({ namespace: 'g-test', storage: createMemoryStorage() });
  const built = [];
  const ctx = {
    p5: P5, settings, globalSettings,
    ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
    drawer: {}, toolbar: {},
    onResize: () => () => {},
    size: () => size,
  };
  const handle = await sketch.mount({}, ctx);
  const p = P5.instances[P5.instances.length - 1];
  p.stepFrames(2);
  return { p, handle, built, settings };
}
const noInvalid = (p, msg = '') => assert.equal(p.invalidCalls.length, 0, `${msg} ${JSON.stringify(p.invalidCalls.slice(0, 3))}`);
const noError = (m, msg = '') => assert.equal(m.handle.debug().error, null, `${msg} ${m.handle.debug().error && m.handle.debug().error.stack}`);
const flat = (nodes) => nodes.flatMap((n) => (n.children ? [n, ...flat(n.children)] : [n]));
const allText = (p) => p.callsOf('text').map((c) => String(c.args[0])).join('\n');

test('every 2D preset renders with all layers on', async () => {
  for (const pr of PRESETS_2D) {
    const m = await mountSketch({ tab: 'field2', f2: pr.id, showLic: true, colorBy: 'curl' });
    m.p.stepFrames(3);
    noInvalid(m.p, pr.id); noError(m, pr.id);
    assert.ok(m.p.callsOf('triangle').length > 20, `${pr.id} arrows`);
    assert.ok(m.p.callsOf('image').length >= 2, `${pr.id} images`);
    m.handle.unmount();
  }
});

test('typed expression field, validation and colour modes', async () => {
  for (const colorBy of ['none', 'div', 'curl', 'mag']) {
    const m = await mountSketch({ tab: 'field2', src: 'expr', fx: 'x^2 - y^2', fy: '-2*x*y', colorBy, normalize: true });
    noInvalid(m.p, colorBy); noError(m, colorBy);
    const info = m.handle.debug().tabs.field2.probeInfo();
    assert.ok(Math.abs(info.div) < 1e-6 && Math.abs(info.curl) < 1e-6, 'harmonic field');
    m.handle.unmount();
  }
  const bad = await mountSketch({ tab: 'field2', src: 'expr', fx: 'x +', fy: 'y' });
  noInvalid(bad.p); noError(bad);
  assert.match(allText(bad.p), /expression error/);
  const fx = flat(bad.built.flat()).find((n) => n.key === 'fx');
  assert.ok(fx && fx.validate('x +') && fx.validate('x*y') === null);
  bad.handle.unmount();
});

test('probe drag updates the readouts and writes settings back', async () => {
  const m = await mountSketch({ tab: 'field2', f2: 'vortex' });
  const t = m.handle.debug().tabs.field2;
  const vp = t.debug().vp;
  m.p.pressMouse(vp.toX(1), vp.toY(0.6)); // probe default location
  m.p.moveMouse(vp.toX(-0.5), vp.toY(1.2));
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.ok(Math.abs(m.settings.get('px') - -0.5) < 0.05 && Math.abs(m.settings.get('py') - 1.2) < 0.05);
  const inf = t.probeInfo();
  assert.ok(Math.abs(inf.curl - 2) < 1e-9 && Math.abs(inf.div) < 1e-9);
  assert.equal(inf.eig.type, 'centre');
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('pan and wheel zoom change the view and keep drawing cleanly', async () => {
  const m = await mountSketch({ tab: 'field2', f2: 'saddle', showLic: true });
  const vp = m.handle.debug().tabs.field2.debug().vp;
  const x0 = vp.xmin;
  m.p.pressMouse(100, 100); m.p.moveMouse(160, 130); m.p.releaseMouse();
  assert.ok(vp.xmin < x0);
  const span = vp.xmax - vp.xmin;
  m.p.moveMouse(300, 300, { fire: false });
  m.p.fire('mouseWheel', { delta: -200, deltaY: -200, deltaMode: 0, preventDefault() {} });
  assert.ok(vp.xmax - vp.xmin < span);
  m.p.stepFrames(4);
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('Green tab: circle on a vortex, orientation, cells and agreement of the four numbers', async () => {
  const m = await mountSketch({ tab: 'green', f2: 'vortex', gshape: 'circle', gr: 1.5, gcells: 8 });
  const g = m.handle.debug().tabs.green.debug();
  const r = g.result;
  assert.ok(Math.abs(r.circulation - r.curlIntegral) < 1e-3 && Math.abs(r.flux - r.divIntegral) < 1e-3);
  assert.ok(Math.abs(r.circulation - 2 * r.area) < 1e-5);
  assert.ok(g.cells.cells.length > 10 && Math.abs(g.cells.sumCells - g.cells.boundaryCirc) < 1e-9);
  noInvalid(m.p); noError(m);
  m.settings.set('gorient', 'cw');
  m.p.stepFrames(2);
  const r2 = m.handle.debug().tabs.green.debug().result;
  assert.ok(r2.circulation < 0 && Math.abs(r2.flux - r2.divIntegral) < 1e-3);
  for (const shape of ['ellipse', 'rect', 'poly']) {
    m.settings.set('gshape', shape); m.settings.set('f2', 'lv');
    m.p.stepFrames(2);
    const q = m.handle.debug().tabs.green.debug().result;
    assert.ok(Math.abs(q.circulation - q.curlIntegral) < 1e-3, shape);
    assert.ok(Math.abs(q.flux - q.divIntegral) < 1e-3, shape);
  }
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('Green tab: dragging a size handle and drawing a free polygon', async () => {
  const m = await mountSketch({ tab: 'green', f2: 'source', gshape: 'circle', gr: 1.0, gcx: 0, gcy: 0 });
  const t = m.handle.debug().tabs.green;
  const [hx, hy] = t.debug().handlePx('size');
  m.p.pressMouse(hx, hy); m.p.moveMouse(hx + 60, hy); m.p.releaseMouse();
  assert.ok(m.settings.get('gr') > 1.1, `gr ${m.settings.get('gr')}`);
  m.settings.set('gshape', 'poly');
  m.p.stepFrames(2);
  m.p.pressMouse(200, 200);
  for (const [x, y] of [[260, 190], [320, 230], [340, 300], [280, 340], [210, 300]]) m.p.moveMouse(x, y);
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.ok(String(m.settings.get('gpoly')).split(';').length >= 3);
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('Green tab: path independence mode', async () => {
  const m = await mountSketch({ tab: 'green', gmode: 'path', f2: 'gradient' });
  const a = m.handle.debug().tabs.green.debug().path;
  assert.ok(Math.abs(a.i1 - a.i2) < 1e-6);
  m.settings.set('f2', 'vortex');
  m.p.stepFrames(2);
  const b = m.handle.debug().tabs.green.debug().path;
  assert.ok(Math.abs(b.i1 - b.i2) > 0.05);
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('3D tab: every preset draws, divergence theorem and Stokes numbers agree for smooth fields', async () => {
  for (const pr of PRESETS_3D) {
    for (const surf of ['sphere', 'cube', 'cylinder']) {
      const m = await mountSketch({ tab: 'field3', f3: pr.id, surf, slice: 'curl' });
      m.p.stepFrames(2);
      noInvalid(m.p, `${pr.id}/${surf}`); noError(m, `${pr.id}/${surf}`);
      const d = m.handle.debug().tabs.field3.debug();
      if (pr.id !== 'coulomb' && pr.id !== 'wire') {
        assert.ok(Math.abs(d.result.error) < 1e-4 * Math.max(1, Math.abs(d.result.flux)), `${pr.id}/${surf} div thm ${d.result.error}`);
        assert.ok(Math.abs(d.stokes.error) < 1e-4 * Math.max(1, Math.abs(d.stokes.circulation)), `${pr.id} Stokes ${d.stokes.error}`);
      }
      m.handle.unmount();
    }
  }
});

test('3D tab: Gauss law, typed field, slice modes, camera and handle drag', async () => {
  const m = await mountSketch({ tab: 'field3', f3: 'coulomb', surf: 'sphere', sx: 0, sy: 0, sz: 0, ssize: 1.2 });
  const d = m.handle.debug().tabs.field3.debug();
  assert.ok(Math.abs(d.result.flux - 4 * Math.PI) < 1e-3 && Math.abs(d.result.error) > 5, "flux 4 pi but the volume integral of div misses the delta function");
  for (const slice of ['none', 'div', 'curl', 'mag']) { m.settings.set('slice', slice); m.p.stepFrames(2); }
  noInvalid(m.p);
  const e = await mountSketch({ tab: 'field3', src3: 'expr', gx: 'x*y', gy: 'sin(z)', gz: 'x - z', showStream3: true });
  noInvalid(e.p); noError(e);
  const t = e.handle.debug().tabs.field3;
  const h = t.debug().handles.find((q) => q.id === 'surf');
  e.p.pressMouse(h.s.x, h.s.y); e.p.moveMouse(h.s.x + 40, h.s.y + 10); e.p.releaseMouse();
  e.p.stepFrames(2);
  assert.ok(e.settings.get('sx') !== 0.3 || e.settings.get('sy') !== 0, 'surface centre moved');
  const yaw = t.cam.yaw;
  e.p.pressMouse(30, 400); e.p.moveMouse(90, 380); e.p.releaseMouse();
  assert.notEqual(t.cam.yaw, yaw);
  e.p.stepFrames(2);
  noInvalid(e.p); noError(e);
  m.handle.unmount(); e.handle.unmount();
});

test('Potential tab: reconstruction for conservative and solenoidal fields, orthogonality', async () => {
  const m = await mountSketch({ tab: 'potential', f2: 'gradient' });
  m.p.stepFrames(2);
  const d = m.handle.debug().tabs.potential.debug();
  assert.ok(d.pot && d.errors.grad < 0.2 && d.errors.poisson < 0.2, JSON.stringify(d.errors));
  assert.ok(d.contours.length > 3);
  assert.match(allText(m.p), /curl-free/);
  assert.match(allText(m.p), /angle between the field line/);
  m.settings.set('f2', 'cells');
  m.p.stepFrames(2);
  assert.match(allText(m.p), /stream function/);
  m.settings.set('f2', 'swirl');
  m.p.stepFrames(2);
  assert.match(allText(m.p), /No scalar potential/);
  noInvalid(m.p); noError(m);
  m.handle.unmount();
});

test('Potential tab: Helmholtz decomposition panels and drawn blobs', async () => {
  const m = await mountSketch({ tab: 'potential', pmode: 'helmholtz', hsrc: 'field', f2: 'swirl', hn: 32 });
  let h = m.handle.debug().tabs.potential.debug().hel;
  assert.ok(h.rec < 1e-10 && h.maxCurlG < 1e-8 && h.maxDivS < 1e-8, `${h.rec} ${h.maxCurlG} ${h.maxDivS}`);
  m.settings.set('hsrc', 'drawn'); m.settings.set('blobs', ''); m.settings.set('blobKind', 'vortex');
  m.p.stepFrames(2);
  const panel = m.handle.debug().tabs.potential.debug().panels[0];
  m.p.click(panel.x + panel.w / 2, panel.y + panel.h / 2);
  assert.match(String(m.settings.get('blobs')), /vortex/);
  m.p.stepFrames(2);
  h = m.handle.debug().tabs.potential.debug().hel;
  assert.ok(h.energy[1] / h.energy[0] < 1e-6, 'a vortex has no curl-free part');
  m.settings.set('blobKind', 'source');
  m.p.click(panel.x + panel.w / 4, panel.y + panel.h / 4);
  m.p.stepFrames(2);
  noInvalid(m.p); noError(m);
  for (const hn of [64, 128]) { m.settings.set('hn', hn); m.p.stepFrames(2); noInvalid(m.p); }
  m.handle.unmount();
});

test('drawer schema, Open in links, deep links and reset', async () => {
  const m = await mountSketch({ tab: 'field2', f2: 'saddle', px: 0.5, py: 0.5 });
  const all = flat(m.built.flat());
  const open = all.find((n) => n.label === 'Open in...');
  assert.equal(open.children.length, 4);
  const calls = [];
  globalThis.location = { set hash(v) { calls.push(v); } };
  try {
    for (const c of open.children) c.onClick();
  } finally { delete globalThis.location; }
  assert.deepEqual(calls.map((c) => c.split('?')[0]), ['#/em-electrostatics', '#/em-magnetostatics', '#/ma-linalg', '#/ma-pde']);
  assert.match(calls[2], /A=1%2C0%3B0%2C-1/);
  assert.ok(all.some((n) => n.label === 'Theory') && all.some((n) => n.label === 'Try this'));
  all.find((n) => n.label === 'Reset').onClick();
  m.p.stepFrames(2);
  noInvalid(m.p);
  m.handle.unmount();
});

test('keyboard tab switching, small canvas and unmount twice', async () => {
  const m = await mountSketch({ tab: 'field2' }, { width: 320, height: 300 });
  for (const k of ['2', '3', '4', '1']) { m.p.pressKey(k); m.p.stepFrames(2); noInvalid(m.p, k); noError(m, k); }
  assert.equal(m.settings.get('tab'), 'field2');
  m.p.pressKey('2');
  assert.equal(m.settings.get('tab'), 'green');
  m.p.pressKey('r');
  m.handle.unmount();
  m.handle.unmount();
});
