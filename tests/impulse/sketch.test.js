import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import impulse from '../../sketches/impulse/index.js';
import { X_PRESETS, SYSTEM_PRESETS } from '../../sketches/impulse/presets.js';
import { gridLayout } from '../../sketches/impulse/plots.js';

const W = 1200, H = 800;

async function mountSketch(initial = {}, size = { width: W, height: H }) {
    const P5 = createMockP5({ width: size.width, height: size.height });
    const settings = createStore({ namespace: 'imp-test', storage: createMemoryStorage() });
    const base = { 'preset.x': '', 'preset.sys': '', n: 128, method: 'ls', lambda: -12, ...initial };
    for (const [k, v] of Object.entries(base)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'g-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => size,
    };
    const handle = await impulse.mount({}, ctx);
    const p = P5.instances[P5.instances.length - 1];
    p.stepFrames(1);
    const layout = () => gridLayout(p.width, p.height);
    // pixel of (sample index, value) in the time plot of sig, for the default (unzoomed) view
    const px = (sig, i, v = 0) => {
        const I = layout().plots[sig].time.in;
        const n = handle.model.n;
        return [I.x + (i / (n - 1)) * I.w, I.y + I.h / 2 - (v / handle.model.scale[sig]) * (I.h / 2)];
    };
    return { p, handle, built, settings, model: handle.model, px, layout };
}

function findNode(schema, pred) {
    for (const n of schema) {
        if (pred(n)) return n;
        if (n.children) { const r = findNode(n.children, pred); if (r) return r; }
    }
    return null;
}
const button = (built, label) => findNode(built.flat(), (n) => n.type === 'button' && n.label.startsWith(label));
const noInvalid = (p, msg = '') => assert.equal(p.invalidCalls.length, 0, `${msg} ${JSON.stringify(p.invalidCalls.slice(0, 3))}`);
const argmax = (a, from = 0) => { let b = from; for (let i = from; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };

test('mounts, draws six plots, builds drawer + tool tabs, no invalid calls', async () => {
    const m = await mountSketch({ 'preset.x': 'gauss', 'preset.sys': 'echo', method: 'wiener', lambda: -5 });
    m.p.stepFrames(3);
    noInvalid(m.p);
    assert.ok(m.p.callsOf('endShape').length >= 6);
    assert.ok(findNode(m.built.flat(), (n) => n.type === 'tabs' && n.key === 'tool'));
    assert.ok(findNode(m.built.flat(), (n) => n.type === 'info' && /right button/.test(n.text)));
    // echo preset: h recovered with peaks at 0 and at the delay
    assert.ok(Math.abs(argmax(m.model.h, 3) - Math.round(0.12 * 128)) <= 1);
    m.handle.unmount();
});

test('left-drag raises, right-drag lowers samples under the brush', async () => {
    const m = await mountSketch();
    m.p.stepFrames(1);
    const [x0, y0] = m.px('x', 60);
    const [x1] = m.px('x', 70);
    m.p.pressMouse(x0, y0);
    m.p.moveMouse(x1, y0);
    m.p.releaseMouse();
    const x = m.model.x;
    assert.ok(x[65] > 0, `raised ${x[65]}`);
    assert.equal(x[5], 0);
    assert.equal(x[120], 0);
    m.p.stepFrames(1);
    const [rx, ry] = m.px('y', 30);
    m.p.pressMouse(rx, ry, 'right');
    m.p.moveMouse(rx + 10, ry);
    m.p.releaseMouse();
    assert.ok(m.model.y[32] < 0, `lowered ${m.model.y[32]}`);
    assert.equal(m.settings.get('active'), 'y');
    noInvalid(m.p);
    m.handle.unmount();
});

test('undo / redo via button and keys; clear', async () => {
    const m = await mountSketch();
    m.p.stepFrames(1);
    const [x0, y0] = m.px('x', 40);
    m.p.pressMouse(x0, y0); m.p.releaseMouse();
    assert.ok(m.model.x[40] > 0);
    button(m.built, 'Undo').onClick();
    assert.equal(Math.max(...m.model.x), 0);
    button(m.built, 'Redo').onClick();
    assert.ok(m.model.x[40] > 0);
    m.p.pressKey('z', 90);
    assert.equal(Math.max(...m.model.x), 0);
    m.p.pressKey('Z', 90);
    assert.ok(m.model.x[40] > 0);
    m.p.pressKey('c', 67);
    assert.equal(Math.max(...m.model.x), 0);
    m.p.pressKey('z', 90);
    assert.ok(m.model.x[40] > 0);
    m.handle.unmount();
});

test('tools: line, mirror, flatten, smooth', async () => {
    const m = await mountSketch({ tool: 'line' });
    m.p.stepFrames(1);
    const [a, b] = [m.px('x', 20, 1), m.px('x', 40, 0.5)];
    m.p.pressMouse(a[0], a[1]);
    m.p.moveMouse(b[0], b[1]);
    m.p.releaseMouse();
    assert.ok(Math.abs(m.model.x[20] - 1) < 0.1);
    assert.ok(Math.abs(m.model.x[30] - 0.75) < 0.1, String(m.model.x[30]));
    assert.equal(m.model.x[50], 0);
    m.settings.set('mirror', true);
    m.settings.set('tool', 'raise');
    m.p.stepFrames(1);
    const [rx, ry] = m.px('y', 10);
    m.p.pressMouse(rx, ry); m.p.releaseMouse();
    assert.ok(m.model.y[10] > 0 && Math.abs(m.model.y[117] - m.model.y[10]) < 1e-9);
    m.settings.set('mirror', false);
    m.settings.set('tool', 'flatten');
    m.p.stepFrames(1);
    const before0 = m.model.x[30];
    const [fx, fy] = m.px('x', 30, 0);
    m.p.pressMouse(fx, fy, 'right'); m.p.releaseMouse();
    assert.ok(Math.abs(m.model.x[30]) < Math.abs(before0));
    m.settings.set('tool', 'raise');
    m.p.stepFrames(1);
    const [px0, py0] = m.px('x', 90);
    m.p.pressMouse(px0, py0); m.p.releaseMouse();
    const peak = Math.max(...m.model.x.subarray(80, 100));
    m.settings.set('tool', 'smooth');
    m.p.stepFrames(1);
    m.p.pressMouse(px0, py0); m.p.releaseMouse();
    assert.ok(Math.max(...m.model.x.subarray(80, 100)) < peak);
    m.handle.unmount();
});

test('drawn x = impulse and y = echo give h with its peak at the echo delay', async () => {
    const m = await mountSketch({ tool: 'line', method: 'ls', lambda: -12 });
    m.p.stepFrames(1);
    let [ix, iy] = m.px('x', 0, 1);
    m.p.pressMouse(ix, iy); m.p.releaseMouse();
    m.p.stepFrames(1);
    [ix, iy] = m.px('y', 0, 1);
    m.p.pressMouse(ix, iy); m.p.releaseMouse();
    m.p.stepFrames(1);
    [ix, iy] = m.px('y', 30, 0.5);
    m.p.pressMouse(ix, iy); m.p.releaseMouse();
    m.p.stepFrames(2);
    assert.equal(m.settings.get('derived'), 'h');
    const h = m.model.h;
    assert.ok(h[0] > 0.5);
    assert.equal(argmax(h, 5), 30);
    assert.ok(h[30] > 0.3 && h[30] <= 0.6, String(h[30]));
    assert.ok(m.model.metrics.residual < 1e-3);
    noInvalid(m.p);
    m.handle.unmount();
});

test('every input preset x every system preset renders and (noiseless, LS) reproduces y', async () => {
    const m = await mountSketch({ method: 'ls', lambda: -12 });
    for (const xp of X_PRESETS) {
        for (const sp of SYSTEM_PRESETS) {
            m.settings.set('preset.x', xp.id);
            m.settings.set('preset.sys', sp.id);
            m.p.stepFrames(2);
            assert.ok(m.model.metrics.residual < 1e-3, `${xp.id}/${sp.id}: residual ${m.model.metrics.residual}`);
            assert.ok(m.model.truth, 'truth kept');
        }
    }
    noInvalid(m.p);
    for (const method of ['wiener', 'nnls']) {
        m.settings.set('method', method);
        m.settings.set('lambda', -4);
        m.settings.set('magDb', true);
        m.settings.set('phase', 'unwrapped');
        m.settings.set('groupDelay', true);
        m.p.stepFrames(2);
        assert.ok(Number.isFinite(m.model.metrics.residual));
    }
    noInvalid(m.p);
    m.handle.unmount();
});

test('derived modes: solve y and solve x', async () => {
    const m = await mountSketch({ 'preset.x': 'burst', 'preset.sys': 'lowpass' });
    m.p.stepFrames(2);
    const yTrue = m.model.y.slice();
    m.settings.set('tool', 'raise');
    m.p.stepFrames(1);
    const [hx, hy] = m.px('h', 100, 0);
    m.p.pressMouse(hx, hy); m.p.releaseMouse();
    m.p.stepFrames(2);
    assert.equal(m.settings.get('derived'), 'y');
    assert.equal(m.settings.get('preset.sys'), '');
    assert.notDeepEqual(Array.from(m.model.y), Array.from(yTrue));
    m.settings.set('derived', 'x');
    m.p.stepFrames(2);
    assert.ok(m.model.x.every(Number.isFinite));
    assert.ok(m.model.metrics.residual < 1e-2);
    noInvalid(m.p);
    m.handle.unmount();
});

test('noise slider perturbs y; auto lambda moves lambda', async () => {
    const m = await mountSketch({ 'preset.x': 'noise', 'preset.sys': 'lowpass', method: 'wiener', lambda: -12 });
    m.p.stepFrames(2);
    const clean = m.model.y.slice();
    m.settings.set('noise', 10);
    m.p.stepFrames(2);
    const diff = m.model.y.reduce((s, v, i) => s + Math.abs(v - clean[i]), 0);
    assert.ok(diff > 0);
    button(m.built, 'Auto lambda').onClick();
    assert.ok(m.settings.get('lambda') > -12);
    m.handle.unmount();
});

test('painting |H| creates h (minimum phase) and switches to solve y', async () => {
    const m = await mountSketch({ 'preset.x': 'gauss', 'preset.sys': 'lowpass' });
    m.p.stepFrames(2);
    const hBefore = m.model.h.slice();
    const R = m.layout().plots.h.mag.in;
    m.p.pressMouse(R.x + R.w * 0.5, R.y + R.h * 0.2);
    m.p.moveMouse(R.x + R.w * 0.6, R.y + R.h * 0.2);
    m.p.releaseMouse();
    m.p.stepFrames(2);
    assert.equal(m.settings.get('derived'), 'y');
    assert.notDeepEqual(Array.from(m.model.h), Array.from(hBefore));
    assert.ok(m.model.h.every(Number.isFinite));
    noInvalid(m.p);
    m.handle.unmount();
});

test('tool switching via keys, signal selection keys, shared-view zoom, hover readout, idle frames are free', async () => {
    const m = await mountSketch({ 'preset.x': 'gauss' });
    for (const [k, t] of [['l', 'lower'], ['s', 'smooth'], ['f', 'flatten'], ['p', 'line'], ['r', 'raise']]) {
        m.p.pressKey(k, k.toUpperCase().charCodeAt(0));
        assert.equal(m.settings.get('tool'), t);
    }
    m.p.pressKey('2', 50);
    assert.equal(m.settings.get('active'), 'y');
    m.p.pressKey('m', 77);
    assert.equal(m.settings.get('mirror'), true);
    const [wx, wy] = m.px('x', 64);
    m.p.moveMouse(wx, wy);
    m.p.stepFrames(1);
    const r = m.p.fire('mouseWheel', { deltaY: -200, deltaMode: 0 });
    assert.equal(r, false);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(m.p.callsOf('endShape').length > 0, 'redrawn after zoom');
    m.p.moveMouse(wx + 3, wy);
    m.p.stepFrames(1);
    const texts = m.p.callsOf('text').map((c) => String(c.args[0]));
    assert.ok(texts.some((t) => /^i=\d+/.test(t)), texts.join('|'));
    m.p.stepFrames(1);
    m.p.clearCalls();
    m.p.stepFrames(5);
    assert.equal(m.p.callsOf('endShape').length, 0);
    m.p.pressKey('0', 48);
    noInvalid(m.p);
    m.handle.unmount();
});

test('N selector resamples, presets regenerate; settings persist, curves do not', async () => {
    const m = await mountSketch({ 'preset.x': 'gauss', 'preset.sys': 'echo' });
    m.settings.set('n', 512);
    m.p.stepFrames(2);
    assert.equal(m.model.n, 512);
    assert.equal(m.model.x.length, 512);
    assert.equal(argmax(m.model.h, 5), Math.round(0.12 * 512));
    const all = m.settings.all();
    for (const v of Object.values(all)) assert.ok(!(v instanceof Float64Array) && !Array.isArray(v));
    assert.equal(all.n, 512);
    noInvalid(m.p);
    m.handle.unmount();
});

test('narrow layout, context menu suppressed, unmount twice', async () => {
    const m = await mountSketch({ 'preset.x': 'gauss', 'preset.sys': 'echo' }, { width: 400, height: 700 });
    m.p.stepFrames(2);
    noInvalid(m.p);
    assert.ok(m.layout().narrow);
    const el = m.p.canvas.elt;
    assert.equal((el.listeners.contextmenu || []).length, 1);
    const ev = { preventDefault() { this.done = true; } };
    el.listeners.contextmenu[0](ev);
    assert.ok(ev.done);
    m.handle.unmount();
    assert.equal((el.listeners.contextmenu || []).length, 0);
    assert.doesNotThrow(() => m.handle.unmount());
});

test('touch edits with the active tool (no right button)', async () => {
    const m = await mountSketch({ tool: 'lower' });
    m.p.stepFrames(1);
    const [x0, y0] = m.px('x', 50);
    m.p.moveMouse(x0, y0, { fire: false });
    m.p.mouseIsPressed = true; m.p.mouseButton = 'left';
    const consumed = m.p.fire('touchStarted', {});
    assert.equal(consumed, false);
    m.p.fire('touchEnded', {});
    m.p.mouseIsPressed = false;
    assert.ok(m.model.x[50] < 0);
    m.handle.unmount();
});
