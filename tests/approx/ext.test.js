// Tests for the lab extensions: interpolation method, Gibbs controls, Listen section (MockP5, fake Web Audio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import approx from '../../sketches/approx/index.js';
import { FUNCTIONS } from '../../lib/functions.js';
import { NODE_FAMILIES } from '../../lib/interp.js';
import { WINDOWS } from '../../lib/fourier-windows.js';

function makeCtx(initial = {}) {
    const P5 = createMockP5({ width: 1200, height: 700 });
    const settings = createStore({ namespace: 'approx-ext', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-ext', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => ({ width: 1200, height: 700 }),
    };
    return { ctx, P5, built, settings };
}

async function mountSketch(initial) {
    const { ctx, P5, built, settings } = makeCtx(initial);
    const handle = await approx.mount({}, ctx);
    return { p: P5.instances[0], handle, built, settings };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));

// ---- fake audio ----------------------------------------------------------------------------------------------

function installFakeAudio() {
    const created = [];
    class Param {
        constructor(v = 1) { this.value = v; }
        cancelScheduledValues() {}
        setValueAtTime() {}
        linearRampToValueAtTime(v) { this.value = v; }
    }
    class Node { connect(n) { return n; } }
    class FakeAudioContext {
        constructor() {
            this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {};
            this.closed = 0; this.sources = []; this.gains = [];
            created.push(this);
        }
        createGain() { const g = Object.assign(new Node(), { gain: new Param(1) }); this.gains.push(g); return g; }
        createBufferSource() {
            const s = Object.assign(new Node(), { playbackRate: new Param(1), loop: false, buffer: null, started: false, stopped: null });
            s.start = () => { s.started = true; };
            s.stop = (t) => { s.stopped = t; };
            this.sources.push(s);
            return s;
        }
        createBuffer(c, l) { const d = new Float32Array(l); return { length: l, getChannelData: () => d }; }
        resume() { return Promise.resolve(); }
        close() { this.closed++; return Promise.resolve(); }
    }
    const prev = globalThis.AudioContext;
    globalThis.AudioContext = FakeAudioContext;
    return { created, restore() { if (prev === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = prev; } };
}

// ---- interpolation -------------------------------------------------------------------------------------------

test('interpolation: curve, n + 1 node dots, readouts; every family draws cleanly on Runge', async () => {
    for (const fam of NODE_FAMILIES) {
        const m = await mountSketch({
            func: 'runge', mode: 'real', 'taylor.on': false, 'interp.on': true, 'interp.n': 14, 'interp.family': fam.id,
        });
        m.p.stepFrames(2);
        assert.equal(m.p.invalidCalls.length, 0, `${fam.id}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
        const all = m.p.callsOf('circle').filter((c) => c.args[2] === 7);
        const last = Math.max(...all.map((c) => c.frame));
        const dots = all.filter((c) => c.frame === last);
        assert.equal(dots.length, 15, `${fam.id} node dots`);
        const t = texts(m.p);
        assert.ok(t.some((s) => s.startsWith('Interpolation  n=14')), 'info line');
        assert.ok(t.some((s) => /max \|f−p\| = .*Λ ≈/.test(s)), 'error + Lebesgue read-out');
        m.handle.unmount();
    }
});

test('Runge read-out: equispaced reports a much larger error and Lebesgue constant than Chebyshev', async () => {
    const grab = async (family) => {
        const m = await mountSketch({ func: 'runge', mode: 'real', 'taylor.on': false, 'interp.on': true, 'interp.n': 20, 'interp.family': family });
        m.p.stepFrames(1);
        const line = texts(m.p).find((s) => /max \|f−p\|/.test(s));
        m.handle.unmount();
        const [, err, leb] = /= ([\d.e+-]+) on .*Λ ≈ ([\d.e+]+)/.exec(line);
        return { err: Number(err), leb: Number(leb) };
    };
    const eq = await grab('equispaced');
    const ch = await grab('chebyshev');
    assert.ok(eq.err > 10 * ch.err, `${eq.err} vs ${ch.err}`);
    assert.ok(eq.leb > 1000 && ch.leb < 5, `${eq.leb} vs ${ch.leb}`);
});

test('interpolation: centre window, compare overlay, error strip and complex sources for every function', async () => {
    const m = await mountSketch({
        func: 'runge', mode: 'real', 'interp.on': true, 'interp.family': 'equispaced', 'interp.window': 'center',
        'interp.W': 0.5, 'interp.compare': true, showError: true,
    });
    m.p.stepFrames(2);
    assert.equal(m.p.invalidCalls.length, 0);
    assert.ok(texts(m.p).some((s) => s.includes('on [-0.5, 0.5]')));
    m.handle.unmount();
    for (const f of FUNCTIONS) {
        for (const src of ['interp', 'err-interp']) {
            const k = await mountSketch({ func: f.id, 'interp.on': true, 'interp.n': 9, 'cplx.source': src, block: 6 });
            k.p.stepFrames(2);
            assert.equal(k.p.invalidCalls.length, 0, `${f.id}/${src}: ${JSON.stringify(k.p.invalidCalls.slice(0, 2))}`);
            k.handle.unmount();
        }
    }
});

test('the drawer schema offers the interpolation group, summation windows and the Listen section', async () => {
    const { built, handle } = await mountSketch();
    const schema = built.find((b) => b.some((n) => n.label === 'Listen'));
    const group = (label) => schema.find((n) => n.type === 'group' && n.label === label);
    const interp = group('Polynomial interpolation');
    assert.equal(interp.enabledKey, 'interp.on');
    assert.deepEqual(interp.children.find((c) => c.key === 'interp.family').options.map((o) => o.value), NODE_FAMILIES.map((f) => f.id));
    const fourier = group('Fourier series');
    assert.deepEqual(fourier.children.find((c) => c.key === 'fourier.window').options.map((o) => o.value), WINDOWS.map((w) => w.id));
    const listen = group('Listen');
    const keys = listen.children.map((c) => c.key);
    for (const k of ['audio.playing', 'audio.freq', 'audio.volume', 'audio.mute.taylor', 'audio.solo.interp']) assert.ok(keys.includes(k), k);
    const freq = listen.children.find((c) => c.key === 'audio.freq');
    assert.deepEqual([freq.min, freq.max], [55, 880]);
    assert.ok(schema.at(-1).text.includes('P: play'), 'help text mentions the new shortcut');
    handle.unmount();
});

// ---- Gibbs ---------------------------------------------------------------------------------------------------

test('Gibbs: overshoot read-out about 8.9 % for the plain square-wave sum, near 0 with Fejer', async () => {
    const read = async (win) => {
        const m = await mountSketch({ func: 'square', mode: 'real', 'taylor.on': false, 'fourier.on': true, 'fourier.N': 60, 'fourier.window': win, showError: false });
        m.p.stepFrames(1);
        assert.equal(m.p.invalidCalls.length, 0);
        const line = texts(m.p).find((s) => s.startsWith('  overshoot'));
        const dashed = texts(m.p).includes('Gibbs 8.95 %');
        m.handle.unmount();
        return { pct: Number(/overshoot ([\d.]+)%/.exec(line)[1]), dashed };
    };
    const plain = await read('none');
    assert.ok(Math.abs(plain.pct - 8.95) < 0.6, `plain ${plain.pct}`);
    assert.ok(plain.dashed, 'theoretical line label drawn');
    const fejer = await read('fejer');
    assert.ok(fejer.pct < 0.1, `fejer ${fejer.pct}`);
});

test('Gibbs: smooth functions show no overshoot read-out; every window draws; gauge click and drag set N', async () => {
    const smooth = await mountSketch({ func: 'sin', mode: 'real', 'fourier.on': true });
    smooth.p.stepFrames(1);
    assert.ok(!texts(smooth.p).some((s) => s.includes('overshoot')));
    smooth.handle.unmount();
    for (const w of WINDOWS) {
        const m = await mountSketch({ func: 'saw', 'fourier.on': true, 'fourier.window': w.id, 'cplx.source': 'fourier', block: 6 });
        m.p.stepFrames(2);
        assert.equal(m.p.invalidCalls.length, 0, w.id);
        m.handle.unmount();
    }
    const { p, handle, settings } = await mountSketch({ func: 'square', mode: 'real', showError: false, 'fourier.on': true, 'fourier.N': 5 });
    p.stepFrames(1);
    // gauge: x = 8 + 10, y = 8 + 684 - 34, width 240
    p.click(18 + 120, 8 + 684 - 34 + 7);
    assert.equal(settings.get('fourier.N'), 64);
    assert.equal(settings.get('lockOn', false), false, 'gauge click does not lock the expansion point');
    p.pressMouse(18 + 60, 8 + 684 - 34 + 7);
    p.moveMouse(18 + 240, 8 + 684 - 34 + 7);
    p.releaseMouse();
    assert.equal(settings.get('fourier.N'), 128);
    p.stepFrames(1);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

// ---- Listen --------------------------------------------------------------------------------------------------

test('Listen: play via the store starts looping sources, mute/solo/volume are click-free, unmount closes the context', async () => {
    const audio = installFakeAudio();
    try {
        const { p, handle, settings } = await mountSketch({ 'pade.on': true, 'fourier.on': true });
        p.stepFrames(1);
        assert.equal(audio.created.length, 0, 'no AudioContext before a user gesture');
        settings.set('audio.playing', true);
        const ac = audio.created[0];
        assert.ok(ac, 'context created inside the click');
        assert.equal(ac.sources.length, 3, 'taylor + pade + fourier');
        assert.ok(ac.sources.every((s) => s.loop && s.started));
        settings.set('audio.solo.pade', true);
        assert.equal(ac.sources.length, 3, 'solo only re-gains');
        settings.set('audio.freq', 880);
        p.stepFrames(1);
        // parameter change of the approximation -> crossfade to a new generation
        settings.set('taylor.order', 9);
        p.stepFrames(1);
        assert.ok(ac.sources.length >= 3);
        settings.set('audio.playing', false);
        assert.ok(ac.sources.slice(0, 3).every((s) => s.stopped !== null), 'sources stop after the fade-out');
        handle.unmount();
        assert.equal(ac.closed, 1);
        handle.unmount();
        assert.equal(ac.closed, 1, 'double unmount is safe');
    } finally {
        audio.restore();
    }
});

test('Listen: P toggles playback, ignores Ctrl/Meta/Alt; unmount while playing closes the context', async () => {
    const audio = installFakeAudio();
    try {
        const { p, handle, settings } = await mountSketch();
        p.key = 'p'; p.keyCode = 80;
        assert.equal(p.keyPressed({ ctrlKey: true }), true);
        assert.equal(audio.created.length, 0);
        p.pressKey('p', 80);
        assert.equal(settings.get('audio.playing'), true);
        assert.equal(audio.created.length, 1);
        p.pressKey('P', 80);
        assert.equal(settings.get('audio.playing'), false);
        p.pressKey('p', 80);
        handle.unmount();
        assert.equal(audio.created[0].closed, 1);
    } finally {
        audio.restore();
    }
});

test('Listen: without Web Audio the toggle snaps back and the info line is visible; stale playing=true is reset', async () => {
    const prev = globalThis.AudioContext;
    delete globalThis.AudioContext;
    try {
        const { p, handle, settings, built } = await mountSketch({ 'audio.playing': true });
        assert.equal(settings.get('audio.playing'), false, 'never autoplays from persisted state');
        const listen = built.find((b) => b.some((n) => n.label === 'Listen')).find((n) => n.label === 'Listen');
        const info = listen.children.find((c) => c.type === 'info' && c.visibleIf);
        assert.equal(info.visibleIf(), true, 'info line shown when audio is missing');
        p.pressKey('p', 80);
        assert.equal(settings.get('audio.playing'), false);
        p.stepFrames(2);
        assert.equal(p.invalidCalls.length, 0);
        handle.unmount();
    } finally {
        if (prev !== undefined) globalThis.AudioContext = prev;
    }
});
