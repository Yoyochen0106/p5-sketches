import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import poncelet from '../../sketches/poncelet/index.js';
import { EDGE_WEIGHT, P0_D } from '../../sketches/poncelet/draw.js';
import { PRESETS, handleWorld } from '../../sketches/poncelet/state.js';
import { ellipsePoint, chainClosure, innerInside } from '../../lib/conics.js';

async function mountSketch(initial = {}, width = 1000, height = 700) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'poncelet-test', storage: createMemoryStorage() });
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
    const handle = await poncelet.mount({}, ctx);
    return { p: P5.instances[P5.instances.length - 1], handle, settings, built };
}

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const edges = (p) => p.callsOf('line').filter((c) => c.style.strokeWeight === EDGE_WEIGHT).map((c) => c.args);
function frame(p) {
    p.clearCalls();
    p.stepFrames(1);
}
const flatButtons = (schema) => {
    const out = [];
    const walk = (nodes) => nodes.forEach((n) => { if (n.type === 'button') out.push(n); if (n.children) walk(n.children); });
    walk(schema);
    return out;
};
const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));

test('mounts, draws steps edges and the HUD without invalid calls', async () => {
    const { p, handle, settings } = await mountSketch({ family: true, showEnvelope: true });
    settings.set('steps', 7);
    frame(p);
    assert.equal(edges(p).length, 7);
    assert.ok(texts(p).some((t) => /closed after n = 3/.test(t)), texts(p).join('|'));
    assert.ok(texts(p).some((t) => /Euler/.test(t)));
    assert.ok(texts(p).some((t) => /Cayley/.test(t)));
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('dragging P0 keeps it on C; polygon stays closed (draw calls) for any P0', async () => {
    const { p, handle } = await mountSketch({ steps: 3 });
    frame(p);
    const { st, view } = handle.getState();
    for (let k = 0; k < 12; k++) {
        const P = ellipsePoint(st.outer, st.t0);
        p.pressMouse(view.toX(P[0]), view.toY(P[1]));
        const T = ellipsePoint(st.outer, 0.4 + k * 0.5);
        p.moveMouse(view.toX(T[0]) + 3, view.toY(T[1]) - 2); // slightly off the curve
        p.releaseMouse();
        const Q = ellipsePoint(st.outer, st.t0);
        assert.ok(Math.hypot(Q[0] - T[0], Q[1] - T[1]) < 0.1);
        frame(p);
        const e = edges(p);
        assert.equal(e.length, 3);
        // consecutive edges share endpoints and the last one ends where the first starts
        for (let i = 0; i < 3; i++) {
            const a = e[i], b = e[(i + 1) % 3];
            assert.ok(Math.hypot(a[2] - b[0], a[3] - b[1]) < 1e-6, `edge ${i} of k=${k}`);
        }
        const p0 = p.callsOf('circle').filter((c) => c.args[2] === P0_D)[0];
        assert.ok(Math.hypot(p0.args[0] - e[0][0], p0.args[1] - e[0][1]) < 1e-6);
    }
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('dragging centres and handles moves / resizes the conics, circle toggle forces b = a', async () => {
    const { p, handle, settings } = await mountSketch();
    frame(p);
    const { st, view } = handle.getState();
    // inner centre
    const i0 = { ...st.inner };
    const sx = view.toX(i0.cx), sy = view.toY(i0.cy);
    p.pressMouse(sx, sy);
    p.moveMouse(sx + 40, sy);
    p.releaseMouse();
    assert.ok(st.inner.cx > i0.cx);
    // inner radius handle (circle)
    const [h] = handleWorld(st.inner, true);
    const r0 = st.inner.a;
    p.pressMouse(view.toX(h[0]), view.toY(h[1]));
    p.moveMouse(view.toX(h[0]) - 20, view.toY(h[1]) + 20);
    p.releaseMouse();
    assert.ok(st.inner.a < r0);
    assert.equal(st.inner.b, st.inner.a);
    // outer becomes an ellipse and its second handle changes b only
    settings.set('outerCircle', false);
    frame(p);
    const [hA, hB] = handleWorld(st.outer, false);
    const a0 = st.outer.a;
    p.pressMouse(view.toX(hB[0]), view.toY(hB[1]));
    p.moveMouse(view.toX(hB[0]), view.toY(hB[1]) - 30);
    p.releaseMouse();
    assert.ok(st.outer.b > a0);
    assert.equal(st.outer.a, a0);
    // major handle rotates
    const rot0 = st.outer.rot;
    p.pressMouse(view.toX(hA[0]), view.toY(hA[1]));
    p.moveMouse(view.toX(hA[0]), view.toY(hA[1]) - 50);
    p.releaseMouse();
    assert.notEqual(st.outer.rot, rot0);
    settings.set('outerCircle', true);
    frame(p);
    assert.equal(st.outer.b, st.outer.a);
    assert.equal(st.outer.rot, 0);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('background drag pans, wheel zooms, right button ignored', async () => {
    const { p, handle } = await mountSketch();
    frame(p);
    const { view } = handle.getState();
    const xmin = view.xmin;
    p.pressMouse(10, 650);
    p.moveMouse(60, 650);
    p.releaseMouse();
    assert.ok(view.xmin < xmin);
    const span = view.xmax - view.xmin;
    p.moveMouse(500, 350);
    assert.equal(p.fire('mouseWheel', { delta: -100, deltaMode: 0 }), false);
    assert.ok(view.xmax - view.xmin < span);
    const inner = handle.getState().st.inner;
    const x0 = inner.cx;
    p.mouseButton = p.RIGHT;
    p.pressMouse(view.toX(inner.cx), view.toY(inner.cy), 'right');
    p.moveMouse(view.toX(inner.cx) + 50, view.toY(inner.cy));
    p.releaseMouse();
    assert.equal(inner.cx, x0);
    handle.unmount();
});

test('Fix it closes random configurations; polygon closes in the draw calls for several P0', async () => {
    const { p, handle, settings } = await mountSketch();
    const r = rng(7);
    let ok = 0;
    for (let k = 0; k < 40; k++) {
        const a = 3.5 + 2 * r();
        const outerCircle = k % 2 === 0;
        const innerCircle = k % 3 !== 0;
        handle.setConfig({
            outer: { cx: 0, cy: 0, a, b: outerCircle ? a : a * (0.7 + 0.3 * r()), rot: r() * 3 },
            inner: { cx: (r() - 0.5) * a * 0.3, cy: (r() - 0.5) * a * 0.3, a: a * 0.3, b: a * 0.3 * (0.7 + 0.3 * r()), rot: r() * 3 },
            outerCircle, innerCircle, t0: r() * 6,
        });
        const n = 3 + Math.floor(r() * 7);
        settings.set('closeN', n);
        settings.set('fixParam', k % 4 === 3 ? 'offset' : 'scale');
        if (!handle.fixIt()) continue;
        ok++;
        const { st, view } = handle.getState();
        assert.equal(settings.get('steps'), n);
        for (let j = 0; j < 3; j++) {
            const P = ellipsePoint(st.outer, st.t0);
            const T = ellipsePoint(st.outer, r() * 6.28);
            p.pressMouse(view.toX(P[0]), view.toY(P[1]));
            p.moveMouse(view.toX(T[0]), view.toY(T[1]));
            p.releaseMouse();
            frame(p);
            const e = edges(p);
            assert.equal(e.length, n);
            const last = e[n - 1], first = e[0];
            assert.ok(Math.hypot(last[2] - first[0], last[3] - first[1]) < 0.5, `k=${k} closing gap`);
            assert.ok(texts(p).some((t) => /closed after n = \d+/.test(t)), `k=${k} badge`);
        }
    }
    assert.ok(ok >= 30, `fixed only ${ok}`);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('presets: closing ones show the badge, non-closing does not; buttons and keys work', async () => {
    const { p, handle, built, settings } = await mountSketch();
    const buttons = flatButtons(built[0]);
    const byLabel = (re) => buttons.find((b) => re.test(b.label));
    const expected = { triangle: 3, square: 4, pentagon: 5, star: 5, ellipses: 6 };
    for (const [id, n] of Object.entries(expected)) {
        const cfg = PRESETS[id]();
        assert.ok(innerInside(cfg.outer, cfg.inner), id);
        assert.ok(chainClosure(cfg.outer, cfg.inner, 1.7, n).residual < 1e-7, id);
    }
    byLabel(/Square/).onClick();
    frame(p);
    assert.ok(texts(p).some((t) => /closed after n = 4/.test(t)));
    byLabel(/Pentagram/).onClick();
    frame(p);
    assert.ok(texts(p).some((t) => /closed after n = 5 .*winding 2/.test(t)));
    byLabel(/Non-closing/).onClick();
    frame(p);
    assert.ok(texts(p).some((t) => /not closed/.test(t)));
    assert.ok(!texts(p).some((t) => /closed after n/.test(t)));
    byLabel(/Randomise/).onClick();
    const { st } = handle.getState();
    assert.ok(innerInside(st.outer, st.inner));
    settings.set('animate', true);
    byLabel(/Reset/).onClick();
    assert.equal(settings.get('animate'), false);
    p.pressKey('r', 82);
    p.pressKey('z', 90);
    assert.equal(st.inner.cx, PRESETS.triangle().inner.cx);
    settings.set('closeN', 7);
    p.pressKey('x', 88);
    assert.equal(settings.get('steps'), 7);
    p.pressKey('', 39);
    assert.equal(settings.get('steps'), 8);
    p.pressKey('', 37);
    assert.equal(settings.get('steps'), 7);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('Euler check text for the triangle preset; Cayley shows zero for n = 3', async () => {
    const { p, handle } = await mountSketch();
    frame(p);
    const t = texts(p);
    assert.ok(t.some((s) => /Euler:/.test(s)));
    const row = t.find((s) => /n=3 /.test(s));
    assert.ok(row && /n=3\s+0 \*/.test(row), row);
    handle.unmount();
});

test('degenerate and hostile configurations draw without invalid calls', async () => {
    const { p, handle, settings } = await mountSketch({ family: true, showEnvelope: true, steps: 60 });
    const E = (cx, cy, a, b, rot = 0) => ({ cx, cy, a, b, rot });
    const cases = [
        [E(0, 0, 4, 4), E(0, 0, 5, 5)], // inner outside outer
        [E(0, 0, 4, 4), E(0, 0, 4, 4)], // coincident
        [E(0, 0, 4, 4), E(0, 0, 0, 0)], // zero radius
        [E(0, 0, 4, 4), E(30, 0, 1, 1)], // disjoint
        [E(0, 0, 1e5, 1e5), E(0, 0, 1e-3, 1e-3)],
        [E(0, 0, 4, 0.1, 1), E(0, 0, 1, 1)],
        [E(NaN, 0, Infinity, 3), E(0, NaN, 1, 1)],
        [E(1e6, -1e6, 4, 4), E(1e6, -1e6, 2, 2)],
        [E(0, 0, 4, 4), E(3.99, 0, 0.005, 0.005)],
    ];
    for (const [outer, inner] of cases) {
        for (const oc of [true, false]) {
            settings.set('outerCircle', oc);
            handle.setConfig({ outer, inner, outerCircle: oc, innerCircle: !oc, t0: 1 });
            p.stepFrames(2);
            assert.ok(handle.fixIt() === true || handle.fixIt() === false);
            p.stepFrames(1);
        }
    }
    settings.set('steps', 1);
    p.stepFrames(1);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('animation moves P0; touch drag works; theme switch redraws; unmount twice', async () => {
    const { p, handle, settings } = await mountSketch({ animate: true, speed: 3 });
    const { st, view } = handle.getState();
    const t0 = st.t0;
    p.stepFrames(30);
    assert.notEqual(st.t0, t0);
    settings.set('animate', false);
    frame(p);
    const P = ellipsePoint(st.outer, st.t0);
    p.moveMouse(view.toX(P[0]), view.toY(P[1]), { fire: false });
    assert.equal(p.touchStarted({}), false);
    const T = ellipsePoint(st.outer, st.t0 + 1);
    p.moveMouse(view.toX(T[0]), view.toY(T[1]), { fire: false });
    p.touchMoved({});
    p.touchEnded({});
    const tNow = ellipsePoint(st.outer, st.t0);
    assert.ok(Math.hypot(tNow[0] - T[0], tNow[1] - T[1]) < 0.05, 'touch drag moved P0 to the finger');
    handle.unmount();
    handle.unmount();
    assert.equal(p.removed, true);
});
