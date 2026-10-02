import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import antenna from '../../sketches/em-antenna/index.js';
import * as A from '../../lib/em/array.js';

function makeCtx(width, height, initial) {
  const P5 = createMockP5({ width, height });
  const settings = createStore({ namespace: 'ant-test', storage: createMemoryStorage() });
  for (const [k, v] of Object.entries(initial)) settings.set(k, v);
  const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
  const built = [];
  const ctx = {
    p5: P5, settings, globalSettings,
    ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
    drawer: {}, toolbar: {},
    onResize: () => () => {},
    size: () => ({ width, height }),
  };
  return { ctx, P5, built, settings };
}

async function mountSketch(initial = {}, size = [1000, 700]) {
  const { ctx, P5, built, settings } = makeCtx(size[0], size[1], initial);
  const handle = await antenna.mount({}, ctx);
  const p = P5.instances[P5.instances.length - 1];
  p.stepFrames(2);
  return { p, handle, built, settings };
}

function findButtons(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === 'button') out.push(n);
    if (n.children) findButtons(n.children, out);
  }
  return out;
}
const press = (m, label) => {
  const b = findButtons(m.built[0]).find((x) => x.label.includes(label));
  assert.ok(b, `button "${label}"`);
  b.onClick();
  m.p.stepFrames(2);
};
const deg = (r) => (r * 180) / Math.PI;

test('every tab renders at several sizes without invalid calls', async () => {
  for (const size of [[1000, 700], [640, 520], [360, 640]]) {
    for (const tab of ['linear', 'planar', 'element']) {
      const m = await mountSketch({ tab }, size);
      m.p.stepFrames(4);
      assert.equal(m.p.invalidCalls.length, 0, `${tab} ${size}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
      assert.equal(m.handle.debug().lastError, null, `${tab}: ${m.handle.debug().lastError && m.handle.debug().lastError.stack}`);
      assert.ok(m.p.callsOf('text').length > 5);
      m.handle.unmount();
    }
  }
});

test('linear tab: pattern, DFT identity and read-outs for the default uniform array', async () => {
  const m = await mountSketch({ tab: 'linear', N: 10, d: 0.5, steer: 90, taper: 'uniform' });
  const { D, lay } = m.handle.debug().linear;
  assert.ok(Math.abs(deg(D.analysis.mainTheta) - 90) < 0.3);
  assert.ok(Math.abs(D.analysis.sllDb + 13) < 0.6);
  assert.ok(Math.abs(D.analysis.directivity - 10) < 0.4);
  // the plotted spectrum is the same function as the array factor
  for (let k = 0; k < D.spec.psi.length; k += 97) assert.ok(Math.abs(D.spec.mag[k] - A.afMag(D.w, D.spec.psi[k])) < 1e-8);
  const t = m.p.callsOf('text').map((c) => String(c.args[0])).join('\n');
  assert.match(t, /HPBW/);
  assert.match(t, /directivity/);
  assert.match(t, /FFT of the weights/);
  assert.ok(m.p.callsOf('endShape').length >= 3, 'curves');
  assert.ok(lay.polar.R > 20);
  m.handle.unmount();
});

test('dragging bars edits the weights (terrain brush) and the pattern responds', async () => {
  const m = await mountSketch({ tab: 'linear', N: 12, d: 0.5, steer: 90, taper: 'uniform', brush: 1 });
  const lay = m.handle.debug().linear.lay;
  const before = m.handle.debug().linear.D.analysis.sllDb;
  const bx = (n) => lay.bars.x + ((n + 0.5) / 12) * lay.bars.w;
  const by = (v) => lay.bars.y + lay.bars.h * (1 - v / 1.05);
  // paint a bell: edges low, centre high
  m.p.pressMouse(bx(0), by(0.05));
  for (let n = 1; n < 12; n++) {
    const v = 0.05 + 0.95 * Math.exp(-(((n - 5.5) / 3) ** 2));
    m.p.moveMouse(bx(n), by(v));
  }
  m.p.stepFrames(1);
  const live = m.handle.debug();
  assert.ok(live.wEdit, 'editing live');
  assert.ok(live.linear.D.analysis.sllDb < before - 4, `${live.linear.D.analysis.sllDb} vs ${before}`);
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.equal(m.settings.get('taper'), 'custom');
  const w = m.settings.get('w').split(',').map(Number);
  assert.equal(w.length, 12);
  assert.ok(w[5] > 0.8 && w[0] < 0.4, m.settings.get('w'));
  const after = m.handle.debug().linear.D;
  assert.ok(after.analysis.sllDb < before - 4);
  assert.ok(after.analysis.hpbw > 0);
  // double click returns to uniform
  m.p.fire('doubleClicked', {});
  assert.equal(m.settings.get('taper'), 'uniform');
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('dragging in the polar plot steers the beam; presets give the textbook results', async () => {
  const m = await mountSketch({ tab: 'linear', N: 10, d: 0.5, steer: 90, taper: 'uniform' });
  const P = m.handle.debug().linear.lay.polar;
  const t = (60 * Math.PI) / 180;
  m.p.pressMouse(P.cx + 0.6 * P.R * Math.sin(t), P.cy - 0.6 * P.R * Math.cos(t));
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.ok(Math.abs(m.settings.get('steer') - 60) < 0.2, String(m.settings.get('steer')));
  assert.ok(Math.abs(deg(m.handle.debug().linear.D.analysis.mainTheta) - 60) < 0.6);

  press(m, 'Dolph-Chebyshev');
  assert.ok(Math.abs(m.handle.debug().linear.D.analysis.sllDb + 30) < 0.4, String(m.handle.debug().linear.D.analysis.sllDb));
  press(m, 'binomial');
  assert.equal(m.handle.debug().linear.D.analysis.sllDb, -Infinity);
  press(m, 'grating lobes');
  assert.ok(m.handle.debug().linear.D.analysis.grating.length >= 1);
  assert.match(m.p.callsOf('text').map((c) => String(c.args[0])).join('\n'), /grating lobe/);
  press(m, 'end-fire');
  const an = m.handle.debug().linear.D.analysis;
  assert.ok(deg(an.mainTheta) < 1 || deg(an.mainTheta) > 179);
  press(m, 'thinned');
  assert.equal(m.settings.get('taper'), 'custom');
  const w = m.handle.debug().linear.D.w;
  assert.equal(w.length, 16);
  assert.ok(Array.from(w).some((v) => v === 0) && Array.from(w).some((v) => v === 1));
  press(m, 'Taylor');
  assert.ok(Math.abs(m.handle.debug().linear.D.analysis.sllDb + 35) < 1.5);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('beam sweep animation moves the steering angle and stops on unmount', async () => {
  const m = await mountSketch({ tab: 'linear', scan: true, scanSpeed: 3 });
  const a = m.handle.debug().linear.D.steerDeg;
  m.p.stepFrames(40);
  const b = m.handle.debug().linear.D.steerDeg;
  assert.ok(Math.abs(a - b) > 1, `${a} ${b}`);
  assert.equal(m.p.invalidCalls.length, 0);
  m.settings.set('scan', false);
  assert.ok(Math.abs(m.settings.get('steer') - m.handle.debug().scanDeg) < 0.2);
  m.handle.unmount();
  m.handle.unmount();
});

test('planar tab: 3D pattern mesh drawn, steering moves the peak, camera orbit and zoom work', async () => {
  const m = await mountSketch({ tab: 'planar', Nx: 8, Ny: 8, pth: 30, pph: 45, prender: 'flat' });
  const d = m.handle.debug();
  assert.ok(m.p.callsOf('triangle').length > 500, `${m.p.callsOf('triangle').length}`);
  assert.ok(Math.abs(deg(d.planar.peakTheta) - 30) < 3, String(deg(d.planar.peakTheta)));
  assert.ok(Math.abs(deg(d.planar.peakPhi) - 45) < 5);
  assert.ok(d.planar.D > 30);
  const yaw = d.cam.yaw;
  m.p.pressMouse(300, 300);
  m.p.moveMouse(380, 330);
  m.p.releaseMouse();
  m.p.stepFrames(2);
  assert.ok(m.handle.debug().cam.yaw !== yaw);
  const dist = m.handle.debug().cam.distance;
  m.p.moveMouse(300, 300);
  const r = m.p.fire('mouseWheel', { deltaY: -120, deltaMode: 0 });
  assert.equal(r, false);
  assert.ok(m.handle.debug().cam.distance < dist);
  press(m, 'pencil beam');
  assert.ok(m.handle.debug().planar.Nx === 10);
  press(m, 'dx = dy');
  assert.equal(m.handle.debug().planar.dx, 1);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.equal(m.handle.debug().lastError, null);
  // the surface is cached: camera moves do not rebuild the mesh
  const key = m.handle.debug().planar.key;
  m.p.moveMouse(300, 300);
  m.p.pressMouse(300, 300);
  m.p.moveMouse(320, 310);
  m.p.releaseMouse();
  assert.equal(m.handle.debug().planar.key, key);
  m.handle.unmount();
});

test('element tab: directivities of the element patterns', async () => {
  const m = await mountSketch({ tab: 'element', N: 8, d: 1, elem: 'short' });
  const t = m.handle.debug().element.table;
  const D = Object.fromEntries(t.map((e) => [e.id, e.D]));
  assert.ok(Math.abs(D.iso - 1) < 0.01 && Math.abs(D.short - 1.5) < 0.01 && Math.abs(D.half - 1.641) < 0.01 && Math.abs(D.patch - 6) < 0.05, JSON.stringify(D));
  const txt = m.p.callsOf('text').map((c) => String(c.args[0])).join('\n');
  assert.match(txt, /pattern multiplication/);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('deep-link keys, Open in buttons, theory, reset, touch', async () => {
  const m = await mountSketch({ tab: 'linear', N: 6, taper: 'hamming' });
  const links = findButtons(m.built[0]).filter((b) => b.link);
  assert.ok(links.length >= 3 && links.length <= 4);
  for (const l of links) assert.match(l.link, /^#\/(em-fdtd|fourier2d|impulse|em-tline|conformal|ma-pde)/);
  const s = JSON.stringify(m.built[0]);
  assert.match(s, /Theory/);
  assert.match(s, /Try this/);
  assert.match(s, /DFT|Fourier/);
  assert.equal(m.handle.debug().linear.D.N, 6);
  // touch painting a bar
  const lay = m.handle.debug().linear.lay;
  m.p.touches = [{ x: lay.bars.x + lay.bars.w * 0.5, y: lay.bars.y + lay.bars.h * 0.5 }];
  assert.equal(m.p.fire('touchStarted', {}), false);
  m.p.fire('touchEnded', {});
  assert.equal(m.settings.get('taper'), 'custom');
  press(m, 'Reset unit');
  assert.equal(m.settings.get('N'), 10);
  assert.equal(m.settings.get('taper'), 'uniform');
  assert.equal(m.p.windowResized, undefined);
  m.handle.unmount();
  m.handle.unmount();
});
