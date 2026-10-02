import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import iso from '../../sketches/iso/index.js';
import { CATALOGUE_2D, CATALOGUE_3D, PRESETS } from '../../sketches/iso/state.js';
import { levelFromU, uFromLevel } from '../../lib/iso-inspect.js';

function makeCtx(width = 1000, height = 700, initial = {}) {
  const P5 = createMockP5({ width, height });
  const settings = createStore({ namespace: 'iso-test', storage: createMemoryStorage() });
  for (const [k, v] of Object.entries(initial)) settings.set(k, v);
  const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
  const built = [];
  const ctx = {
    p5: P5,
    settings,
    globalSettings,
    ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
    drawer: {}, toolbar: {},
    onResize: () => () => {},
    size: () => ({ width, height }),
  };
  return { ctx, P5, built, settings };
}

async function mountSketch(initial = {}, size = [1000, 700]) {
  const { ctx, P5, built, settings } = makeCtx(size[0], size[1], initial);
  const handle = await iso.mount({}, ctx);
  const p = P5.instances[0];
  return { p, handle, built, settings };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));

test('2D mode renders every catalogue field at low resolution without invalid calls', async () => {
  for (const f of CATALOGUE_2D) {
    const m = await mountSketch({ mode: '2d', f2: f.id, res2: 12, bg: true, grad: true });
    m.p.stepFrames(2);
    assert.equal(m.p.invalidCalls.length, 0, `${f.id}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
    assert.equal(m.handle.debug().lastError, null, f.id);
    assert.ok(m.p.callsOf('endShape').length > 0, `${f.id} draws shapes`);
    m.handle.unmount();
  }
});

test('3D mode renders every catalogue field at low resolution without invalid calls', async () => {
  for (const f of CATALOGUE_3D) {
    for (const algo of ['classic', 'tetra']) {
      const m = await mountSketch({ mode: '3d', f3: f.id, res3: 10, algo });
      m.p.stepFrames(2);
      assert.equal(m.p.invalidCalls.length, 0, `${f.id}/${algo}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
      const d = m.handle.debug();
      assert.equal(d.lastError, null, `${f.id}/${algo}: ${d.lastError && d.lastError.stack}`);
      assert.ok(d.triangles >= 0 && d.holes.open >= 0);
      m.handle.unmount();
    }
  }
});

test('3D render modes, colour modes and helpers all draw cleanly', async () => {
  for (const render of ['flat', 'wire', 'both', 'points']) {
    for (const colorBy of ['height', 'normal', 'solid']) {
      const m = await mountSketch({ mode: '3d', f3: 'torus', res3: 14, render, colorBy, slice: true, sliceU: 0.6 });
      m.p.stepFrames(2);
      assert.equal(m.p.invalidCalls.length, 0, `${render}/${colorBy}`);
      m.handle.unmount();
    }
  }
  const m = await mountSketch({ mode: '3d', f3: 'noise3', algo: 'classic', res3: 16, box: false, axes: false, floor: false, holes: true });
  m.p.stepFrames(2);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.ok(m.handle.debug().holes.open > 0, 'classic cracks on noise');
  m.handle.unmount();
});

test('custom expressions: 2D with t, 3D, and invalid ones fall back with a message', async () => {
  const m = await mountSketch({ mode: '2d', f2: 'custom', expr2: 'sin(3*x) * cos(3*y) + 0.2 * t', res2: 20 });
  m.p.stepFrames(2);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.equal(m.handle.debug().lastError, null);
  m.handle.unmount();
  const m3 = await mountSketch({ mode: '3d', f3: 'custom', expr3: 'x^2 + y^2 + z^2 - 1.2', res3: 12 });
  m3.p.stepFrames(2);
  assert.ok(m3.handle.debug().triangles > 50);
  m3.handle.unmount();
  const bad = await mountSketch({ mode: '2d', f2: 'custom', expr2: 'sin(', res2: 10 });
  bad.p.stepFrames(1);
  assert.ok(texts(bad.p).some((t) => /expression error/.test(t)));
  assert.equal(bad.p.invalidCalls.length, 0);
  bad.handle.unmount();
});

test('the expression text boxes validate input', async () => {
  const m = await mountSketch();
  const schema = m.built.flat();
  const find = (key) => { let hit = null; const walk = (nodes) => nodes.forEach((n) => { if (n.key === key && n.type === 'text') hit = n; if (n.children) walk(n.children); }); walk(schema); return hit; };
  assert.equal(find('expr2').validate('sin(x) + t'), null);
  assert.match(find('expr2').validate('sin(x) + z'), /./);
  assert.match(find('expr3').validate('x + (y'), /./);
  assert.equal(find('expr3').validate('x*y*z'), null);
  m.handle.unmount();
});

test('changing the resolution and level sliders changes triangle counts', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 10, algo: 'tetra' });
  m.p.stepFrames(1);
  const t10 = m.handle.debug().triangles;
  m.settings.set('res3', 20);
  m.p.stepFrames(1);
  const t20 = m.handle.debug().triangles;
  assert.ok(t20 > t10 * 2, `${t10} -> ${t20}`);
  m.settings.set('lu3', 0.9);
  m.p.stepFrames(1);
  const big = m.handle.debug().triangles;
  assert.notEqual(big, t20);
  m.settings.set('algo', 'classic');
  m.p.stepFrames(1);
  assert.notEqual(m.handle.debug().triangles, big);
  m.handle.unmount();
});

test('triangle budget: a high resolution gyroid is limited and reported', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'gyroid', res3: 96, algo: 'tetra' });
  m.p.stepFrames(1);
  const d = m.handle.debug();
  assert.ok(d.triangles <= 60000, `${d.triangles}`);
  assert.equal(d.res.limited, true);
  assert.ok(texts(m.p).some((t) => /resolution limited/.test(t)));
  m.handle.unmount();
});

test('2D: changing resolution / level changes the segment count', async () => {
  const m = await mountSketch({ mode: '2d', f2: 'circle', res2: 8, contour: 'single' });
  m.p.stepFrames(1);
  const segs = () => Number(texts(m.p).find((t) => /segments/.test(t)).match(/(\d+) segments/)[1]);
  const a = segs();
  m.settings.set('res2', 40);
  m.p.clearCalls();
  m.p.stepFrames(1);
  assert.ok(segs() > a * 2);
  m.settings.set('lu2', 0.3);
  m.p.clearCalls();
  m.p.stepFrames(1);
  assert.ok(segs() > 0);
  m.handle.unmount();
});

test('cell inspector opens on click with the right case index for a known field', async () => {
  // circle x^2 + y^2 - 1 on [-2,2]^2, 4x4 cells of size 1: cell (1,1) = x in [-1,0], y in [-1,0] has case 4
  const m = await mountSketch({ mode: '2d', f2: 'circle', res2: 4, contour: 'single', bg: false });
  m.settings.set('lu2', uFromLevel(0, [-0.75 - 0.08 * 3.75, 3 + 0.08 * 3.75]));
  m.p.stepFrames(1);
  const d = m.handle.debug();
  assert.equal(d.level2, 0);
  const v = d.view;
  m.p.moveMouse(v.toX(-0.5), v.toY(-0.5));
  m.p.stepFrames(1);
  m.p.click(v.toX(-0.5), v.toY(-0.5));
  m.p.clearCalls();
  m.p.stepFrames(1);
  assert.deepEqual({ i: m.handle.debug().sel2.i, j: m.handle.debug().sel2.j }, { i: 1, j: 1 });
  const t = texts(m.p);
  assert.ok(t.includes('CELL INSPECTOR'));
  assert.ok(t.some((s) => /case 4 = 0b0100/.test(s)), t.join('|'));
  assert.ok(t.some((s) => /crossed edges/.test(s)));
  assert.equal(m.p.invalidCalls.length, 0);
  // clicking the same cell again closes it
  m.p.click(v.toX(-0.5), v.toY(-0.5));
  m.p.stepFrames(1);
  assert.equal(m.handle.debug().sel2, null);
  m.handle.unmount();
});

test('2D: dragging pans without selecting; wheel zoom is limited; toggles draw', async () => {
  const m = await mountSketch({ mode: '2d', f2: 'saddle', res2: 8, interp: false, disamb: false, grad: true, lattice: true });
  m.p.stepFrames(1);
  const v = m.handle.debug().view;
  const x0 = v.xmin;
  m.p.pressMouse(300, 300);
  m.p.moveMouse(380, 340);
  m.p.releaseMouse();
  m.p.stepFrames(1);
  assert.notEqual(v.xmin, x0);
  assert.equal(m.handle.debug().sel2, null);
  m.p.moveMouse(500, 350);
  for (let i = 0; i < 300; i++) m.p.fire('mouseWheel', { delta: -300, deltaMode: 0 });
  m.p.stepFrames(1);
  assert.ok(v.xmax - v.xmin > 4 / 700);
  for (let i = 0; i < 300; i++) m.p.fire('mouseWheel', { delta: 300, deltaMode: 1 });
  m.p.stepFrames(1);
  assert.ok(v.xmax - v.xmin < 4 * 13);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('level sweep and time animation advance the contour', async () => {
  const m = await mountSketch({ mode: '2d', f2: 'drift', res2: 30, sweep: true, animT: true });
  const l0 = (m.p.stepFrames(1), m.handle.debug().level2);
  m.p.stepFrames(60);
  const l1 = m.handle.debug().level2;
  assert.notEqual(l0, l1);
  assert.equal(m.p.invalidCalls.length, 0);
  m.settings.set('sweep', false);
  m.settings.set('animT', false);
  m.p.stepFrames(2);
  assert.ok(m.settings.get('time') > 0, 'time was committed to the store');
  m.handle.unmount();
});

test('hole detector reports 0 open edges for tetra on a sphere', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 16, algo: 'tetra' });
  m.p.stepFrames(1);
  const d = m.handle.debug();
  assert.equal(d.holes.open, 0);
  assert.ok(texts(m.p).some((t) => /no cracks/.test(t)));
  m.handle.unmount();
});

test('3D: clicking the mesh picks a cell and loads its case into the inspector', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 12, algo: 'classic', showCase: true });
  m.p.stepFrames(1);
  const d0 = m.handle.debug();
  const cx = d0.rect3.w / 2, cy = d0.rect3.h / 2 - 20;
  m.p.click(cx, cy);
  m.p.stepFrames(1);
  const d = m.handle.debug();
  assert.ok(d.sel3, 'a cell was picked');
  assert.ok(d.sel3.caseIdx > 0 && d.sel3.caseIdx < 255);
  assert.equal(m.settings.get('caseIdx'), d.sel3.caseIdx);
  const t = texts(m.p);
  assert.ok(t.includes('CUBE CASE INSPECTOR'));
  assert.ok(t.some((s) => new RegExp(`case ${d.sel3.caseIdx} = 0b`).test(s)));
  assert.ok(t.some((s) => /real samples/.test(s)));
  assert.equal(m.p.invalidCalls.length, 0);
  m.settings.set('caseIdx', 0b10000001);
  m.p.stepFrames(1);
  assert.ok(texts(m.p).some((s) => /generic case/.test(s)));
  m.handle.unmount();
});

test('cube case inspector draws every case 0..255 cleanly', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 8 });
  for (let c = 0; c < 256; c += 5) {
    m.settings.set('caseIdx', c);
    m.p.stepFrames(1);
  }
  m.settings.set('caseIdx', 255);
  m.p.stepFrames(1);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.equal(m.handle.debug().lastError, null);
  m.handle.unmount();
});

test('3D camera drag changes the draw order but not the mesh cache key', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'torus', res3: 16, algo: 'tetra' });
  m.p.stepFrames(1);
  const key = m.handle.debug().meshKey;
  const tri0 = m.p.callsOf('triangle').slice(0, 40).map((c) => c.args.map((a) => Math.round(a)).join(','));
  const d = m.handle.debug();
  const grids = d.drawCount;
  m.p.clearCalls();
  m.p.pressMouse(200, 200);
  m.p.moveMouse(330, 160);
  m.p.moveMouse(420, 120);
  m.p.releaseMouse();
  m.p.stepFrames(1);
  const tri1 = m.p.callsOf('triangle').slice(0, 40).map((c) => c.args.map((a) => Math.round(a)).join(','));
  assert.ok(tri1.length > 0);
  assert.notDeepEqual(tri1, tri0, 'triangle order / positions changed');
  assert.equal(m.handle.debug().meshKey, key);
  assert.equal(m.handle.debug().sel3, null, 'a drag does not pick');
  assert.ok(m.handle.debug().drawCount > grids);
  // an idle frame draws nothing new
  m.p.clearCalls();
  m.p.stepFrames(2);
  assert.equal(m.p.callsOf('triangle').length, 0);
  m.handle.unmount();
});

test('slice plane draws the 2D contour inset and clips the mesh', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 14, slice: true, sliceU: 0.5, sliceClip: true });
  m.p.stepFrames(1);
  const t = texts(m.p);
  assert.ok(t.some((s) => /same contour in 2D/.test(s)));
  const withClip = m.p.callsOf('triangle').length;
  m.settings.set('sliceClip', false);
  m.p.clearCalls();
  m.p.stepFrames(1);
  assert.ok(m.p.callsOf('triangle').length > withClip);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('export functions work on the live mesh', async () => {
  const m = await mountSketch({ mode: '3d', f3: 'sphere', res3: 10, algo: 'tetra' });
  m.p.stepFrames(1);
  const T = m.handle.debug().triangles;
  const stl = m.handle.exportMesh('stl');
  assert.equal(stl.length, 84 + 50 * T);
  const obj = m.handle.exportMesh('obj');
  assert.equal(obj.split('\n').filter((l) => l.startsWith('f ')).length, T);
  assert.ok(m.handle.exportMesh('stl-ascii').startsWith('solid sphere'));
  m.settings.set('lu3', 0);
  m.settings.set('f3', 'custom');
  m.settings.set('expr3', '5 + x');
  m.p.stepFrames(1);
  assert.equal(m.handle.exportMesh('stl') && true, true);
  m.handle.unmount();
});

test('every preset applies and renders', async () => {
  for (const pr of PRESETS) {
    const m = await mountSketch();
    m.p.stepFrames(1);
    m.handle.applyPreset(pr.id);
    m.p.stepFrames(2);
    const d = m.handle.debug();
    assert.equal(d.lastError, null, `${pr.id}: ${d.lastError && d.lastError.stack}`);
    assert.equal(m.p.invalidCalls.length, 0, `${pr.id}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
    assert.equal(m.settings.get('mode'), pr.mode);
    assert.ok(texts(m.p).some((s) => pr.caption.startsWith(s.trim().slice(0, 12)) && s.trim().length >= 12), `${pr.id}: caption drawn`);
    const level = pr.mode === '3d' ? d.level3 : d.level2;
    assert.ok(Math.abs(level - pr.level) < 0.02 * (1 + Math.abs(pr.level)) + 0.01, `${pr.id}: level ${level} vs ${pr.level}`);
    m.handle.unmount();
  }
});

test('keyboard: 1 / 2 switch mode; shortcuts with ctrl are left alone', async () => {
  const m = await mountSketch();
  m.p.pressKey('2', 50);
  assert.equal(m.settings.get('mode'), '3d');
  m.p.pressKey('1', 49);
  assert.equal(m.settings.get('mode'), '2d');
  m.p.key = '2';
  assert.equal(m.p.keyPressed({ ctrlKey: true }), true);
  assert.equal(m.settings.get('mode'), '2d');
  m.handle.unmount();
});

test('mode switching, theme change and resize keep drawing without errors', async () => {
  const { ctx, P5, settings } = makeCtx();
  let resize = null;
  ctx.onResize = (fn) => { resize = fn; return () => {}; };
  const handle = await iso.mount({}, ctx);
  const p = P5.instances[0];
  p.stepFrames(1);
  settings.set('mode', '3d');
  p.stepFrames(1);
  ctx.globalSettings.set('theme', 'light');
  p.stepFrames(1);
  resize({ width: 500, height: 400 });
  p.stepFrames(1);
  settings.set('mode', '2d');
  p.stepFrames(1);
  assert.equal(p.invalidCalls.length, 0);
  assert.equal(handle.debug().lastError, null);
  handle.unmount();
});

test('unmount twice is safe and late callbacks do nothing', async () => {
  const { ctx, P5 } = makeCtx();
  let resize = null;
  ctx.onResize = (fn) => { resize = fn; return () => {}; };
  const handle = await iso.mount({}, ctx);
  const p = P5.instances[0];
  p.stepFrames(1);
  handle.unmount();
  assert.doesNotThrow(() => handle.unmount());
  assert.doesNotThrow(() => { resize && resize({ width: 300, height: 300 }); p.stepFrames?.(1); });
});

test('level helpers used by presets stay consistent', () => {
  assert.equal(levelFromU(uFromLevel(10, [0, 100]), [0, 100]), 10);
});
