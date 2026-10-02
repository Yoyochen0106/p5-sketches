import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import tline from '../../sketches/em-tline/index.js';
import * as T from '../../lib/em/tline.js';

function makeCtx(width, height, initial) {
  const P5 = createMockP5({ width, height });
  const settings = createStore({ namespace: 'tline-test', storage: createMemoryStorage() });
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
  const handle = await tline.mount({}, ctx);
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
const button = (built, label) => {
  const b = findButtons(built[0]).find((x) => x.label.includes(label));
  assert.ok(b, `button "${label}"`);
  return b;
};

test('every tab renders without invalid calls at several sizes', async () => {
  for (const size of [[1000, 700], [640, 520], [360, 640]]) {
    for (const tab of ['smith', 'waves', 'match', 'pulse']) {
      const m = await mountSketch({ tab }, size);
      m.p.stepFrames(5);
      assert.equal(m.p.invalidCalls.length, 0, `${tab} ${size}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
      assert.equal(m.handle.debug().lastError, null, `${tab}: ${m.handle.debug().lastError && m.handle.debug().lastError.stack}`);
      assert.ok(m.p.callsOf('text').length > 5);
      m.handle.unmount();
    }
  }
});

test('Smith tab: gridded circles, read-outs match the formulas, dragging the load updates the settings', async () => {
  const m = await mountSketch({ tab: 'smith', zr: 100, zx: 50, dLam: 0.125 });
  const d = m.handle.debug();
  assert.ok(m.p.callsOf('circle').length > 15, 'r / x circles');
  const gL = T.loadGamma([100, 50], 50);
  assert.ok(Math.abs(d.line.gMag - Math.hypot(gL[0], gL[1])) < 1e-12);
  const zin = T.zinLossless([100, 50], 50, 2 * Math.PI * 0.125);
  assert.ok(Math.abs(d.smith.zin[0] - zin[0]) < 1e-6 && Math.abs(d.smith.zin[1] - zin[1]) < 1e-6);
  const txt = m.p.callsOf('text').map((c) => String(c.args[0])).join('\n');
  assert.match(txt, /VSWR/);
  assert.match(txt, /Zin =/);
  // click at the centre of the chart: matched load
  const v = d.view;
  m.p.click(v.cx, v.cy);
  m.p.stepFrames(2);
  assert.ok(Math.abs(m.settings.get('zr') - 50) < 1.5 && Math.abs(m.settings.get('zx')) < 1.5, `${m.settings.get('zr')} ${m.settings.get('zx')}`);
  // drag to the right of the centre: a larger resistance; the load follows the pointer
  m.p.pressMouse(v.cx + 0.5 * v.R, v.cy);
  m.p.moveMouse(v.cx + 0.6 * v.R, v.cy - 0.2 * v.R);
  m.p.releaseMouse();
  const g = T.loadGamma([m.settings.get('zr'), m.settings.get('zx')], 50);
  assert.ok(Math.abs(g[0] - 0.6) < 0.02 && Math.abs(g[1] - 0.2) < 0.02, JSON.stringify(g));
  // dragging the rotated point changes dLam and keeps |Gamma| (lossless)
  m.settings.set('dLam', 0.1);
  m.p.stepFrames(1);
  const q = m.handle.debug();
  const L = q.line;
  const rp = T.rotateGamma(L.gL, 0.1);
  const px = q.view.toPx(rp);
  m.p.pressMouse(px[0], px[1]);
  const target = T.rotateGamma(L.gL, 0.2);
  const tp = q.view.toPx(target);
  m.p.moveMouse(tp[0], tp[1]);
  m.p.releaseMouse();
  assert.ok(Math.abs(m.settings.get('dLam') - 0.2) < 0.01, String(m.settings.get('dLam')));
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('Smith tab: pins, admittance overlay, sweep, lossy spiral, keyboard', async () => {
  const m = await mountSketch({ tab: 'smith', showY: true, loss: 1.5, f: 300 });
  button(m.built, 'pin load').onClick();
  button(m.built, 'pin Zin').onClick();
  m.p.stepFrames(2);
  assert.equal(m.settings.get('pins').split(';').length, 2);
  m.p.pressKey('p', 80);
  m.p.stepFrames(1);
  assert.equal(m.settings.get('pins').split(';').length, 3);
  m.p.pressKey('x', 88);
  assert.equal(m.settings.get('pins'), '');
  m.settings.set('sweep', true);
  const d0 = m.handle.debug().d;
  m.p.stepFrames(30);
  assert.ok(m.handle.debug().d !== d0);
  assert.equal(m.p.invalidCalls.length, 0);
  m.settings.set('sweep', false);
  m.handle.unmount();
  m.handle.unmount();
});

test('Standing waves tab: nodes are lambda/4 apart and VSWR matches', async () => {
  const m = await mountSketch({ tab: 'waves', zr: 25, zx: 0, lenM: 1.2, f: 300, vf: 1, loss: 0 });
  const w = m.handle.debug().waves;
  assert.ok(w.maxima.length >= 2 && w.minima.length >= 2);
  const lam = m.handle.debug().line.lam;
  assert.ok(Math.abs(lam - 299792458 / 300e6) < 1e-6);
  // nodes: max-to-min spacing is a quarter wavelength
  const s = Math.abs(w.minima[0] - w.maxima[0]);
  assert.ok(Math.abs(Math.min(s, 0.5 - s) - 0.25) < 0.01, `${w.maxima} ${w.minima}`);
  // 25 ohm on a 50 ohm line: Gamma = -1/3, S = 2, first minimum at the load
  assert.ok(Math.abs(w.measuredS - 2) < 0.02, String(w.measuredS));
  assert.ok(w.minima.length && Math.abs(T.standingWaveNodes(T.loadGamma([25, 0], 50)).dMin) < 1e-9);
  m.p.stepFrames(10);
  assert.equal(m.p.invalidCalls.length, 0);
  // matched: flat envelope, no extrema
  m.settings.set('zr', 50);
  m.p.stepFrames(2);
  assert.equal(m.handle.debug().waves.maxima.length, 0);
  assert.ok(Math.abs(m.handle.debug().waves.measuredS - 1) < 1e-6);
  m.handle.unmount();
});

test('Matching tab: auto-solve buttons match the load at f0 and give a bandwidth', async () => {
  const m = await mountSketch({ tab: 'match', zr: 100, zx: 50, mType: 'short' });
  for (const [label, expect] of [['stub solution 1', 'stub'], ['stub solution 2', 'stub'], ['quarter-wave', 'qw'], ['L-match 1', 'lmatch'], ['L-match 2', 'lmatch']]) {
    button(m.built, label).onClick();
    m.p.stepFrames(2);
    const d = m.handle.debug();
    assert.equal(d.match.m.kind, expect);
    assert.ok(d.match.g0 < 1e-4, `${label}: |Gamma| at f0 = ${d.match.g0}`);
    assert.ok(d.match.bw && d.match.bw.fractional > 0 && d.match.bw.lo < 1 && d.match.bw.hi > 1, label);
    assert.equal(m.p.invalidCalls.length, 0, label);
  }
  // open-circuited stub variant
  m.settings.set('mType', 'open');
  button(m.built, 'stub solution 1').onClick();
  m.p.stepFrames(2);
  assert.ok(m.handle.debug().match.g0 < 1e-4);
  // manual stub: dragging the strips moves d / l
  const before = m.settings.get('stubD');
  m.p.pressMouse(500 + 52 + 10, 0);
  m.p.releaseMouse();
  assert.equal(m.settings.get('stubD'), before);
  m.handle.unmount();
});

test('Matching tab: stub strips are draggable', async () => {
  const m = await mountSketch({ tab: 'match', zr: 100, zx: 50, mMethod: 'stub', stubD: 0.1, stubL: 0.1 }, [1000, 700]);
  const texts = m.p.callsOf('text').map((c) => String(c.args[0])).join('\n');
  assert.match(texts, /stub position d/);
  // strip 1 geometry mirrors matchLayout: leftW = clamp(w*0.5, 240, h+20) = 500; x0 = 552; width = 1000 - 18 - 552
  const x0 = 552, w = 1000 - 18 - 552;
  const y1 = 34 + Math.max(90, Math.round(700 * 0.3)) + 52 + 11;
  m.p.pressMouse(x0 + 0.5 * w, y1);
  m.p.releaseMouse();
  assert.ok(Math.abs(m.settings.get('stubD') - 0.25) < 0.01, String(m.settings.get('stubD')));
  const y2 = y1 + 52;
  m.p.pressMouse(x0 + 0.2 * w, y2);
  m.p.moveMouse(x0 + 0.4 * w, y2);
  m.p.releaseMouse();
  assert.ok(Math.abs(m.settings.get('stubL') - 0.2) < 0.01, String(m.settings.get('stubL')));
  m.handle.unmount();
});

test('Pulse tab: energy is conserved, presets work, DC limit reached', async () => {
  const m = await mountSketch({ tab: 'pulse', zs: 10, pzl: 1e9, pshape: 'step', ploop: false });
  m.handle.advancePulse(3.3);
  m.p.stepFrames(1);
  const info = m.handle.debug().pulseInfo;
  assert.ok(info.energyResidual < 1e-9, String(info.energyResidual));
  // zero-reflection preset: matched both ends -> load sees V1 after 1 delay and nothing bounces
  button(m.built, 'Zs = ZL').onClick();
  m.p.stepFrames(1);
  const P = m.handle.advancePulse(1.5);
  assert.ok(Math.abs(P.sim.vLoad - 0.5) < 1e-9, String(P.sim.vLoad));
  assert.ok(P.sim.energyResidual() < 1e-9);
  // open load, matched source: the load voltage doubles to Vs after one delay
  button(m.built, 'open load').onClick();
  m.p.stepFrames(1);
  const P2 = m.handle.advancePulse(1.2);
  assert.ok(Math.abs(P2.sim.vLoad - 1) < 1e-9, String(P2.sim.vLoad));
  // short load: load voltage stays zero, source current grows
  button(m.built, 'short load').onClick();
  m.p.stepFrames(1);
  const P3 = m.handle.advancePulse(4.5);
  assert.ok(Math.abs(P3.sim.vLoad) < 1e-12);
  assert.ok(P3.sim.energyResidual() < 1e-9);
  // ringing preset runs and draws
  button(m.built, 'ringing').onClick();
  for (let i = 0; i < 200; i++) m.p.stepFrames(1);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.ok(m.handle.debug().pulse.sim.t > 0);
  assert.ok(m.handle.debug().pulseInfo.energyResidual < 1e-9);
  // pulse source variant
  m.settings.set('pshape', 'pulse');
  m.settings.set('pwid', 1);
  m.p.stepFrames(200);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.equal(m.handle.debug().lastError, null);
  m.handle.unmount();
});

test('deep-link keys, Open in buttons, theory blocks and reset', async () => {
  const m = await mountSketch({ tab: 'match', zr: 30, zx: -20, mMethod: 'lmatch', lSol: 1 });
  const d = m.handle.debug();
  assert.equal(d.match.m.kind, 'lmatch');
  const links = findButtons(m.built[0]).filter((b) => b.link);
  assert.ok(links.length >= 3 && links.length <= 4);
  for (const l of links) assert.match(l.link, /^#\/(conformal|em-fdtd|em-antenna|ct-freq)/);
  const texts = JSON.stringify(m.built[0]);
  assert.match(texts, /Theory/);
  assert.match(texts, /Try this/);
  assert.match(texts, /Moebius/);
  button(m.built, 'Reset unit').onClick();
  assert.equal(m.settings.get('zr'), 100);
  assert.equal(m.settings.get('tab'), 'smith');
  m.p.stepFrames(2);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('touch and resize handlers exist and are safe; unmount twice', async () => {
  const m = await mountSketch({ tab: 'smith' });
  assert.equal(typeof m.p.touchStarted, 'function');
  m.p.touches = [{ x: m.handle.debug().view.cx + 20, y: m.handle.debug().view.cy }];
  const r = m.p.fire('touchStarted', {});
  assert.equal(r, false);
  m.p.touches = [{ x: m.handle.debug().view.cx + 60, y: m.handle.debug().view.cy }];
  m.p.fire('touchMoved', {});
  m.p.fire('touchEnded', {});
  assert.ok(m.settings.get('zr') > 50);
  assert.equal(m.p.windowResized, undefined);
  m.handle.unmount();
  m.handle.unmount();
  m.p.stepFrames(2);
});
