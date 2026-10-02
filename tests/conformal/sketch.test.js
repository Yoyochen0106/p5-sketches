import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import conformal from '../../sketches/conformal/index.js';
import { PRESET_OPTIONS } from '../../sketches/conformal/maps.js';
import { applyMoebius } from '../../lib/conformal.js';

function makeCtx(width, height, initial) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'conf-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial || {})) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
    return {
        P5, settings,
        ctx: {
            p5: P5, settings, globalSettings,
            ui: { build: () => ({ destroy() {}, refresh() {}, el: null }) },
            drawer: {}, toolbar: {},
            onResize: () => () => {},
            size: () => ({ width, height }),
        },
    };
}

async function mountSketch(initial, w = 1200, h = 600) {
    const { ctx, P5, settings } = makeCtx(w, h, initial);
    const handle = await conformal.mount({}, ctx);
    return { p: P5.instances[0], handle, settings };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));

test('every preset renders without invalid calls and draws curves', async () => {
    for (const o of PRESET_OPTIONS) {
        for (const grid of ['rect', 'polar', 'both']) {
            const m = await mountSketch({ preset: o.value, grid, region: 'disk', bg: 'both', streams: true });
            m.p.stepFrames(2);
            assert.equal(m.p.invalidCalls.length, 0, `${o.value}/${grid}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
            assert.ok(m.p.callsOf('endShape').length > 10, o.value);
            assert.ok(m.p.callsOf('image').length >= 2, 'domain colouring images');
            assert.equal(m.handle.getState().error, null, o.value);
            m.handle.unmount();
        }
    }
});

test('stacked layout on narrow screens, extras do not break drawing', async () => {
    const m = await mountSketch({ preset: 'jouk', streams: true, 't': 0.5, draw: true }, 400, 800);
    m.p.stepFrames(2);
    assert.equal(m.p.invalidCalls.length, 0);
    assert.ok(m.p.callsOf('text').some((c) => /w-plane/.test(String(c.args[0]))));
    m.handle.unmount();
});

test('dragging z0 updates the readouts: |f\'| = 2|z| for z^2, right angle preserved', async () => {
    const m = await mountSketch({ preset: 'z2', z0re: 0.7, z0im: 0.5, probe: 0.01 });
    m.p.stepFrames(1);
    const s0 = m.handle.getState();
    assert.ok(Math.abs(s0.probe.mag - 2 * Math.hypot(0.7, 0.5)) < 1e-9);
    // find the z0 handle's pixel and drag it
    const h = s0.handles.find((q) => q.id === 'z0');
    assert.ok(h);
    // domain panel is the left panel: reconstruct pixel by probing the drawn circle centre (first filled circle of z0)
    const circles = m.p.callsOf('circle').filter((c) => c.args[2] === 10);
    const [cx, cy] = circles[0].args;
    m.p.pressMouse(cx, cy);
    m.p.moveMouse(cx + 40, cy - 30);
    m.p.releaseMouse();
    m.p.stepFrames(1);
    const s1 = m.handle.getState();
    const z = s1.probe.z0;
    assert.ok(Math.abs(z[0] - 0.7) > 0.05 || Math.abs(z[1] - 0.5) > 0.05, 'z0 moved');
    assert.ok(Math.abs(s1.probe.mag - 2 * Math.hypot(z[0], z[1])) < 1e-9);
    assert.ok(Math.abs(s1.probe.angleErr) < 1e-3, `angle error ${s1.probe.angleErr}`);
    assert.ok(Math.abs(s1.probe.roundness - 1) < 0.1, `roundness ${s1.probe.roundness}`);
    assert.ok(texts(m.p).some((t) => /\|f'\|/.test(t)));
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});

test('critical point: z0 snapped to 0 for z^2 doubles the angle', async () => {
    const m = await mountSketch({ preset: 'z2' });
    m.p.stepFrames(1);
    m.p.pressKey('c', 67);
    m.p.stepFrames(1);
    const pr = m.handle.getState().probe;
    assert.ok(pr.critical);
    assert.ok(Math.abs(pr.angle - Math.PI) < 1e-6, String(pr.angle));
    assert.ok(texts(m.p).some((t) => /not conformal/.test(t)));
    m.handle.unmount();
});

test('moebius: dragging a target keeps the map exact', async () => {
    const m = await mountSketch({ preset: 'moebius' });
    m.p.stepFrames(1);
    const sq = m.p.callsOf('rect').filter((c) => c.args[2] === 10 && c.args[3] === 10);
    assert.ok(sq.length >= 3, 'three target handles drawn');
    const [x, y] = [sq[0].args[0] + 5, sq[0].args[1] + 5];
    m.p.pressMouse(x, y);
    m.p.moveMouse(x - 30, y + 20);
    m.p.releaseMouse();
    m.p.stepFrames(1);
    const st = m.handle.getState();
    const { moebius } = st.map;
    assert.ok(moebius);
    for (let i = 0; i < 3; i++) {
        const w = applyMoebius(moebius, st.params.mob.z[i]);
        assert.ok(Math.hypot(w[0] - st.params.mob.w[i][0], w[1] - st.params.mob.w[i][1]) < 1e-9);
    }
    assert.ok(texts(m.p).some((t) => /cross-ratio/.test(t)));
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});

test('polynomial: critical points are marked; custom formula works; bad formula reports an error', async () => {
    const m = await mountSketch({ preset: 'poly', nroots: 4 });
    m.p.stepFrames(1);
    assert.equal(m.handle.getState().map.critical.length, 3);
    assert.ok(m.p.callsOf('quad').length >= 3);
    m.handle.unmount();

    const c = await mountSketch({ preset: 'custom', expr: 'z^2 + 1/z' });
    c.p.stepFrames(1);
    assert.equal(c.handle.getState().error, null);
    assert.ok(c.handle.getState().probe.mag > 0);
    c.handle.unmount();

    const bad = await mountSketch({ preset: 'custom', expr: '((' });
    bad.p.stepFrames(1);
    assert.ok(bad.handle.getState().error);
    assert.equal(bad.p.invalidCalls.length, 0);
    bad.handle.unmount();
});

test('free-hand curve is recorded and drawn; morph and play run; unmount twice is safe', async () => {
    const m = await mountSketch({ preset: 'exp', draw: true, t: 0.3, play: true });
    m.p.stepFrames(1);
    m.p.pressMouse(150, 200);
    for (let i = 1; i <= 10; i++) m.p.moveMouse(150 + i * 12, 200 + 20 * Math.sin(i));
    m.p.releaseMouse();
    m.p.stepFrames(3);
    assert.ok(m.handle.getState().curve.length > 5);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
    m.handle.unmount();
    assert.doesNotThrow(() => m.p.stepFrames(1));
});

test('wheel zooms and clicks without crashing on ignored targets', async () => {
    const m = await mountSketch({ preset: 'sqrt' });
    m.p.stepFrames(1);
    m.p.moveMouse(200, 300);
    m.p.fire('mouseWheel', { delta: -120, deltaMode: 0 });
    m.p.fire('mousePressed', { target: {} });
    m.p.stepFrames(1);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});
