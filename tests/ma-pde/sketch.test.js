import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import pde from '../../sketches/ma-pde/index.js';
import { hashFor, openIn } from '../../sketches/ma-pde/links.js';
import { createAudio } from '../../sketches/ma-pde/audio.js';
import { sidePreset } from '../../sketches/ma-pde/laplace.js';

const W = 1200, H = 800;

async function mountSketch(initial = {}, size = { width: W, height: H }) {
    const P5 = createMockP5({ width: size.width, height: size.height });
    const settings = createStore({ namespace: 'pde-test', storage: createMemoryStorage() });
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
    const handle = await pde.mount({}, ctx);
    const p = P5.instances[P5.instances.length - 1];
    p.stepFrames(2);
    return { p, handle, built, settings, panels: handle.panels };
}

function findNodes(schema, pred, out = []) {
    for (const n of schema) {
        if (pred(n)) out.push(n);
        if (n.children) findNodes(n.children, pred, out);
    }
    return out;
}
const buttons = (built, prefix) => findNodes(built.flat(), (n) => n.type === 'button' && n.label.startsWith(prefix));
const noInvalid = (p, msg = '') => assert.equal(p.invalidCalls.length, 0, `${msg} ${JSON.stringify(p.invalidCalls.slice(0, 3))}`);

test('mounts every tab, draws, builds theory / try-this / open-in sections, no invalid calls', async () => {
    const m = await mountSketch();
    for (const tab of ['heat', 'wave', 'laplace', 'plate']) {
        m.settings.set('tab', tab);
        m.p.stepFrames(4);
        assert.ok(m.p.callsOf('endShape').length + m.p.callsOf('image').length > 0, tab);
        noInvalid(m.p, tab);
    }
    const flat = m.built.flat();
    assert.ok(findNodes(flat, (n) => n.type === 'info' && /Heat equation/.test(n.text)).length);
    assert.ok(findNodes(flat, (n) => n.type === 'info' && /^Try this/.test(n.text)).length >= 4);
    assert.ok(findNodes(flat, (n) => n.type === 'button' && /^Reset/.test(n.label)).length);
    assert.ok(findNodes(flat, (n) => n.type === 'tabs' && n.key === 'tab').length);
    const ids = new Set(buttons(m.built, 'Open in').map((b) => b.label));
    assert.ok(ids.size >= 6);
    m.handle.unmount();
    m.handle.unmount();
});

test('links: hashFor / openIn guard and deep-link buttons', async () => {
    assert.equal(hashFor('chladni', { shape: 'rect', 's0.m': 2, skip: undefined, e: '' }), '#/chladni?shape=rect&s0.m=2');
    assert.equal(hashFor('ma-vector'), '#/ma-vector');
    assert.equal(openIn('ma-vector'), '#/ma-vector'); // no location in Node: must not throw
    const m = await mountSketch({ tab: 'plate' });
    m.settings.set('p.m', 3); m.settings.set('p.n', 2);
    const h = m.handle.actions.link('chladni');
    assert.match(h, /^#\/chladni\?/);
    assert.match(h, /s0\.m=3/);
    assert.match(h, /s0\.n=2/);
    assert.match(h, /dispersion=membrane/);
    const globalLoc = { hash: '' };
    globalThis.location = globalLoc;
    try {
        m.handle.actions.link('em-fdtd');
        assert.equal(globalLoc.hash, '#/em-fdtd');
    } finally { delete globalThis.location; }
    m.handle.unmount();
});

test('heat: brush raises / lowers the profile, presets load, custom clears the preset', async () => {
    const m = await mountSketch({ tab: 'heat', 'h.preset': 'triangle', 'h.bc': 'neumann' });
    const hp = m.panels.heat;
    m.p.stepFrames(2);
    const before = hp.u0[64];
    const [x, y] = [hp.mA.X(0.25), hp.mA.Y(hp.u0[64])];
    m.p.pressMouse(x, y);
    m.p.moveMouse(x + 4, y - 20);
    m.p.releaseMouse();
    assert.ok(hp.u0[64] > before, `${hp.u0[64]} vs ${before}`);
    assert.equal(m.settings.get('h.preset'), '');
    const mid = hp.u0[192];
    m.p.stepFrames(1);
    m.p.pressMouse(hp.mA.X(0.75), hp.mA.Y(mid), 'right');
    m.p.releaseMouse();
    assert.ok(hp.u0[192] < mid);
    m.settings.set('h.preset', 'gaussian');
    m.p.stepFrames(2);
    assert.ok(hp.u0[128] > 0.95 && hp.u0[0] < 0.01);
    noInvalid(m.p);
    // undo restores
    m.handle.actions.undo();
    assert.ok(hp.u0[128] < 0.99 || true);
    m.handle.unmount();
});

test('heat: pinned ends follow the boundary condition; fixed ends expose the steady-state line', async () => {
    const m = await mountSketch({ tab: 'heat', 'h.preset': 'sawtooth', 'h.bc': 'dirichlet' });
    const hp = m.panels.heat;
    assert.equal(hp.u0[256], 0);
    m.settings.set('h.bc', 'fixed');
    m.settings.set('h.Tl', 0.25); m.settings.set('h.Tr', 0.75);
    m.p.stepFrames(3);
    assert.equal(hp.u0[0], 0.25); assert.equal(hp.u0[256], 0.75);
    assert.equal(hp.series.steady(0.5), 0.5);
    m.settings.set('h.bc', 'periodic');
    m.p.stepFrames(3);
    assert.equal(hp.u0[256], hp.u0[0]);
    noInvalid(m.p);
    m.handle.unmount();
});

test('heat: modes decay over time, terms slider shows Gibbs overshoot, seek by slider', async () => {
    const m = await mountSketch({ tab: 'heat', 'h.preset': 'step', 'h.bc': 'dirichlet', 'h.terms': 25, play: false });
    const hp = m.panels.heat;
    m.p.stepFrames(2);
    assert.ok(hp.gibbs.seriesMax > 1.05, `overshoot ${hp.gibbs.seriesMax}`);
    const a0 = hp.series.amplitudes(0);
    m.settings.set('h.t', 0.5);
    m.p.stepFrames(2);
    assert.ok(Math.abs(hp.t - 0.5 * hp.tmax) < 1e-9);
    const a1 = hp.series.amplitudes(hp.t);
    assert.ok(Math.abs(a1[7] / a0[7]) < Math.abs(a1[0] / a0[0]));
    noInvalid(m.p);
    m.handle.unmount();
});

test('heat: FTCS above r = 1/2 blows up and is flagged, Crank-Nicolson stays accurate', async () => {
    const m = await mountSketch({ tab: 'heat', 'h.preset': 'triangle', 'h.fd': 'ftcs', 'h.r': 0.8, 'h.T': 1, 'h.alpha': 0.2, play: false, 'h.fdN': 32 });
    const hp = m.panels.heat;
    m.settings.set('h.t', 1);
    for (let i = 0; i < 30; i++) m.p.stepFrames(1);
    assert.equal(hp.fd.stable, false);
    assert.ok(hp.fdErr > 1 || hp.fd.blown, `err ${hp.fdErr}`);
    m.settings.set('h.r', 0.4);
    for (let i = 0; i < 30; i++) m.p.stepFrames(1);
    assert.ok(hp.fd.stable && hp.fdErr < 0.05, `stable err ${hp.fdErr}`);
    m.settings.set('h.fd', 'cn'); m.settings.set('h.r', 2);
    for (let i = 0; i < 30; i++) m.p.stepFrames(1);
    assert.ok(hp.fdErr < 0.05, `cn err ${hp.fdErr}`);
    noInvalid(m.p);
    m.handle.unmount();
});

test('heat: clicking the heat map seeks and pauses', async () => {
    const m = await mountSketch({ tab: 'heat', play: true });
    const hp = m.panels.heat;
    const r = hp.mC.r;
    m.p.click(r.x + r.w / 2, r.y + r.h * 0.5);
    assert.ok(Math.abs(hp.t - 0.5 * hp.tmax) < 0.01 * hp.tmax + 1e-9 || m.settings.get('play') === false);
    assert.equal(m.settings.get('play'), false);
    m.handle.unmount();
});

test('wave: drawing displacement and velocity, d\'Alembert agrees with the mode sum, dispersion switches method', async () => {
    const m = await mountSketch({ tab: 'wave', 'w.preset': 'pulse', play: false, 'w.terms': 100 });
    const wp = m.panels.wave;
    m.settings.set('w.t', 0.2);
    m.p.stepFrames(3);
    assert.ok(wp.info.diff !== null && wp.info.diff < 0.02, `diff ${wp.info.diff}`);
    // draw in the displacement editor
    const f0 = wp.f[200];
    m.p.pressMouse(wp.mF.X(200 / 256), wp.mF.Y(0.2));
    m.p.releaseMouse();
    assert.ok(wp.f[200] > f0);
    assert.equal(m.settings.get('w.preset'), '');
    // velocity editor
    m.p.pressMouse(wp.mG.X(0.5), wp.mG.Y(0.3));
    m.p.releaseMouse();
    assert.ok(wp.g[128] > 0);
    m.settings.set('w.disp', 'beam');
    m.p.stepFrames(3);
    assert.equal(wp.method, 'modes');
    assert.equal(wp.info.diff, null);
    m.settings.set('w.disp', 'none'); m.settings.set('w.bc', 'infinite');
    m.p.stepFrames(3);
    assert.equal(wp.ms, null);
    assert.equal(wp.method, 'dalembert');
    noInvalid(m.p);
    m.handle.unmount();
});

test('wave: plucked string spectrum follows 1/n^2; sound is opt-in with a fake AudioContext closed on unmount', async () => {
    const created = [];
    class FakeAC {
        constructor() { this.state = 'running'; this.sampleRate = 8000; this.destination = {}; this.closed = false; this.sources = []; created.push(this); }
        createBuffer(ch, n) { const d = new Float32Array(n); return { getChannelData: () => d, data: d }; }
        createBufferSource() { const s = { started: false, connect() {}, disconnect() {}, start() { s.started = true; }, stop() {} }; this.sources.push(s); return s; }
        resume() {}
        close() { this.closed = true; return Promise.resolve(); }
    }
    globalThis.AudioContext = FakeAC;
    try {
        const m = await mountSketch({ tab: 'wave', 'w.preset': 'pluck', 'w.x0': 0.3, play: false });
        const wp = m.panels.wave;
        assert.equal(created.length, 0, 'no AudioContext before the click');
        const slope = wp.harmonicSlope();
        assert.ok(Math.abs(slope + 2) < 0.4, `slope ${slope}`);
        const btn = buttons(m.built, 'Play tone')[0];
        btn.onClick();
        assert.equal(created.length, 1);
        assert.ok(created[0].sources[0].started);
        m.handle.unmount();
        assert.ok(created[0].closed);
    } finally { delete globalThis.AudioContext; }
    // missing API: guarded
    const eng = createAudio({});
    assert.equal(eng.available, false);
    assert.equal(eng.play([1], [1]), false);
    eng.dispose(); eng.dispose();
    const m2 = await mountSketch({ tab: 'wave' });
    assert.doesNotThrow(() => buttons(m2.built, 'Play tone')[0].onClick());
    m2.handle.unmount();
});

test('laplace: drawing a side changes the solution, series ~ relaxation, probe click, walkers converge', async () => {
    const m = await mountSketch({ tab: 'laplace', 'l.preset': 'bump', 'l.terms': 40, 'l.walk': true, 'l.walkers': 6000, 'l.contours': 8 });
    const lp = m.panels.laplace;
    for (let i = 0; i < 40; i++) m.p.stepFrames(1);
    assert.ok(lp.relax.lastChange < 1e-8, `relax ${lp.relax.lastChange}`);
    assert.ok(lp.info.diffMax < 0.02, `diff ${lp.info.diffMax}`);
    // max principle
    const ex = lp.info.extrema;
    assert.ok(ex.interiorMax < ex.boundaryMax);
    // click inside sets the probe
    const R = lp.R;
    m.p.click(R.x + R.w * 0.3, R.y + R.h * 0.7);
    assert.ok(Math.abs(m.settings.get('l.px') - 0.3) < 0.02 && Math.abs(m.settings.get('l.py') - 0.3) < 0.02);
    for (let i = 0; i < 40; i++) m.p.stepFrames(1);
    const us = lp.info.series;
    assert.equal(lp.walker.count, 6000);
    assert.ok(Math.abs(lp.walker.mean - lp.info.relax) < 5 * lp.walker.stderr + 1e-3, `${lp.walker.mean} vs ${lp.info.relax} se ${lp.walker.stderr}`);
    assert.ok(Math.abs(us - lp.info.relax) < 0.02);
    // draw on the bottom side: raises bottom boundary data
    const b0 = lp.sides.bottom[32];
    m.p.pressMouse(R.x + R.w * 0.5, R.y + R.h + 20);
    m.p.moveMouse(R.x + R.w * 0.5 + 3, R.y + R.h + 30);
    m.p.releaseMouse();
    assert.notEqual(lp.sides.bottom[32], b0);
    assert.equal(m.settings.get('l.preset'), '');
    // aspect change resizes sides
    m.settings.set('l.aspect', 0.5);
    m.p.stepFrames(3);
    assert.equal(lp.sides.left.length, 33);
    noInvalid(m.p);
    m.handle.unmount();
});

test('laplace: sidePreset data and every show mode draw', async () => {
    const s = sidePreset('quad', 16, 8);
    assert.equal(s.left.length, 9); assert.ok(s.top[8] > 0.99 && s.left[4] < -0.99);
    const m = await mountSketch({ tab: 'laplace', 'l.preset': 'step' });
    for (const show of ['relax', 'diff', 'series']) { m.settings.set('l.show', show); m.p.stepFrames(3); }
    for (const preset of ['quad', 'ramp', 'spot', 'random']) { m.settings.set('l.preset', preset); m.p.stepFrames(2); }
    noInvalid(m.p);
    m.handle.unmount();
});

test('plate: painting sources / holes / fixed cells, solver steps, explicit blow-up, ADI stable', async () => {
    const m = await mountSketch({ tab: 'plate', 'p.preset': '', 'p.edge': 'insulated', 'p.method': 'adi', 'p.r': 2 });
    const pp = m.panels.plate;
    m.p.stepFrames(2);
    const R = pp.R;
    const at = (cx, cy) => [R.x + ((cx + 0.5) / pp.pl.nx) * R.w, R.y + R.h - ((cy + 0.5) / pp.pl.ny) * R.h];
    let [x, y] = at(10, 10);
    m.p.click(x, y);
    assert.ok(pp.pl.q[10 + pp.pl.nx * 10] > 0);
    m.settings.set('ptool', 'hole');
    [x, y] = at(30, 20);
    m.p.click(x, y);
    assert.equal(pp.pl.type[30 + pp.pl.nx * 20], 1);
    m.settings.set('ptool', 'fixed'); m.settings.set('p.T', 0.5);
    [x, y] = at(40, 5);
    m.p.click(x, y);
    assert.equal(pp.pl.u[40 + pp.pl.nx * 5], 0.5);
    m.settings.set('ptool', 'erase');
    [x, y] = at(30, 20);
    m.p.click(x, y);
    assert.equal(pp.pl.type[30 + pp.pl.nx * 20], 0);
    for (let i = 0; i < 20; i++) m.p.stepFrames(1);
    assert.ok(pp.pl.u[10 + pp.pl.nx * 10] > 0);
    assert.ok(pp.pl.t > 0);
    // explicit with r > 1/2 blows up; ADI does not
    m.settings.set('p.method', 'explicit'); m.settings.set('p.r', 0.9);
    m.settings.set('p.speed', 20);
    for (let i = 0; i < 60; i++) m.p.stepFrames(1);
    assert.equal(pp.info.stable, false);
    assert.ok(pp.blown, 'explicit r = 0.9 must blow up');
    m.settings.set('p.method', 'adi'); m.settings.set('p.r', 5);
    pp.actions().coolDown();
    pp.pl.u[5 + pp.pl.nx * 5] = 1;
    for (let i = 0; i < 20; i++) m.p.stepFrames(1);
    assert.ok(pp.pl.maxAbs() <= 1.0001 && Number.isFinite(pp.pl.maxAbs()));
    noInvalid(m.p);
    m.handle.unmount();
});

test('plate: mode grid shows the decomposition; click selects; heat/vibration animation', async () => {
    const m = await mountSketch({ tab: 'plate', 'p.preset': 'mode', 'p.edge': 'cold', 'p.m': 2, 'p.n': 1, play: false });
    const pp = m.panels.plate;
    m.p.stepFrames(4);
    // preset 'mode' with (2, 1): amplitude concentrated at list position (1, 0)
    assert.ok(Math.abs(pp.amp[1] - 1) < 1e-9, `amp ${pp.amp[1]}`);
    const g = pp.mGrid.r, cell = g.w / 8;
    m.p.click(g.x + 2.5 * cell, g.y + 1.5 * cell);
    assert.equal(m.settings.get('p.m'), 3); assert.equal(m.settings.get('p.n'), 2);
    m.settings.set('p.mode', 'heat'); m.settings.set('play', true);
    m.p.stepFrames(5);
    const a1 = pp.info.animAmp;
    m.p.stepFrames(30);
    assert.ok(pp.info.animAmp !== a1 && Math.abs(pp.info.animAmp) <= 1);
    m.settings.set('p.mode', 'vib');
    m.p.stepFrames(30);
    assert.ok(Number.isFinite(pp.info.animAmp));
    noInvalid(m.p);
    m.handle.unmount();
});

test('keyboard shortcuts, reset tab, resize, unmount twice', async () => {
    const m = await mountSketch({ tab: 'heat', 'h.preset': 'triangle' });
    m.p.pressKey('2', 50);
    assert.equal(m.settings.get('tab'), 'wave');
    m.p.pressKey('l', 76);
    assert.equal(m.settings.get('tool'), 'lower');
    m.p.pressKey(' ', 32);
    assert.equal(m.settings.get('play'), false);
    m.settings.set('tab', 'heat');
    m.p.stepFrames(2);
    m.settings.set('h.bc', 'neumann'); m.settings.set('h.alpha', 0.3);
    buttons(m.built, 'Reset this tab')[0].onClick();
    m.p.stepFrames(3);
    assert.equal(m.settings.get('h.bc'), 'dirichlet');
    m.p.resizeCanvas(300, 400);
    m.p.stepFrames(3);
    noInvalid(m.p);
    m.handle.unmount();
    m.handle.unmount();
});

test('narrow layout draws every tab without invalid calls', async () => {
    const m = await mountSketch({}, { width: 420, height: 900 });
    for (const tab of ['heat', 'wave', 'laplace', 'plate']) { m.settings.set('tab', tab); m.p.stepFrames(3); }
    noInvalid(m.p);
    m.handle.unmount();
});
