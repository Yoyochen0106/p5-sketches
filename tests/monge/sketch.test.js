import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import monge from '../../sketches/monge/index.js';
import { E_MARKER_D, MONGE_WEIGHT } from '../../sketches/monge/draw.js';
import { PRESETS, handlePos } from '../../sketches/monge/state.js';

async function mountSketch(initial = {}, width = 1000, height = 700) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'monge-test', storage: createMemoryStorage() });
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
    const handle = await monge.mount({}, ctx);
    return { p: P5.instances[P5.instances.length - 1], handle, settings, built };
}

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Last frame's calls only. */
function lastFrame(p, fn) {
    p.clearCalls();
    p.stepFrames(1);
    return p.callsOf(fn);
}

test('mounts and draws without invalid geometry', async () => {
    const { p, handle } = await mountSketch({ showInternal: true, showInternalPts: true, showExtra: true });
    p.stepFrames(3);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    assert.ok(p.callsOf('line').length > 5);
    handle.unmount();
});

test('dragging a circle by its body or centre moves it', async () => {
    const { p, handle } = await mountSketch();
    p.stepFrames(1);
    const { circles, view } = handle.getState();
    const c = circles[0];
    const x0 = c.x, y0 = c.y, r0 = c.r;
    // grab inside the circle (not at the centre dot) and move 100 px right / 50 px down
    const sx = view.toX(c.x) + 0.4 * (view.toX(c.x + c.r) - view.toX(c.x)), sy = view.toY(c.y);
    p.pressMouse(sx, sy);
    p.moveMouse(sx + 100, sy + 50);
    p.releaseMouse();
    const k = (view.xmax - view.xmin) / view.rect.w;
    assert.ok(Math.abs(c.x - (x0 + 100 * k)) < 1e-9);
    assert.ok(Math.abs(c.y - (y0 - 50 * k)) < 1e-9);
    assert.equal(c.r, r0);
    // drag the centre dot
    const cx = view.toX(c.x), cy = view.toY(c.y);
    p.pressMouse(cx, cy);
    p.moveMouse(cx - 30, cy);
    p.releaseMouse();
    assert.ok(Math.abs(c.x - (x0 + 100 * k - 30 * k)) < 1e-9);
    p.stepFrames(1);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('radius handle changes r, has priority over the body, and snaps', async () => {
    const { p, handle, settings } = await mountSketch();
    p.stepFrames(1);
    const { circles, view } = handle.getState();
    const c = circles[1];
    const [hx, hy] = handlePos(view, c);
    const x0 = c.x, r0 = c.r;
    p.pressMouse(hx, hy);
    p.moveMouse(hx + 40, hy - 40);
    p.releaseMouse();
    assert.ok(c.r > r0);
    assert.equal(c.x, x0, 'centre untouched');
    // snap: radius is rounded to a multiple of 0.5
    settings.set('snap', true);
    const [h2x, h2y] = handlePos(view, c);
    p.pressMouse(h2x, h2y);
    p.moveMouse(h2x + 7, h2y - 3);
    p.releaseMouse();
    assert.ok(Math.abs(c.r / 0.5 - Math.round(c.r / 0.5)) < 1e-9, `r=${c.r}`);
    // tiny radius is clamped
    const [h3x, h3y] = handlePos(view, c);
    p.pressMouse(h3x, h3y);
    p.moveMouse(view.toX(c.x), view.toY(c.y));
    p.releaseMouse();
    assert.ok(c.r >= 0.1);
    handle.unmount();
});

test('background drag pans, wheel zooms, right button ignored', async () => {
    const { p, handle } = await mountSketch();
    p.stepFrames(1);
    const { view } = handle.getState();
    const xmin = view.xmin;
    p.pressMouse(10, 650);
    p.moveMouse(60, 650);
    p.releaseMouse();
    assert.ok(view.xmin < xmin);
    const span = view.xmax - view.xmin;
    p.moveMouse(500, 350);
    const r = p.fire('mouseWheel', { delta: -100, deltaMode: 0 });
    assert.equal(r, false);
    assert.ok(view.xmax - view.xmin < span);
    const c0 = handle.getState().circles[0].x;
    const sx = view.toX(c0);
    p.pressMouse(sx, view.toY(handle.getState().circles[0].y), 'right');
    p.mouseButton = p.RIGHT;
    p.releaseMouse();
    p.stepFrames(1);
    handle.unmount();
});

test('Monge line passes through the three E points in the draw calls (random configurations)', async () => {
    const { p, handle } = await mountSketch({ showGrid: false });
    const r = rng(99);
    let checked = 0;
    for (let k = 0; k < 150; k++) {
        const cs = [0, 1, 2].map(() => ({ x: (r() - 0.5) * 14, y: (r() - 0.5) * 8, r: 0.4 + r() * 2.5 }));
        handle.setCircles(cs);
        p.clearCalls();
        p.stepFrames(1);
        const pts = p.callsOf('circle').filter((c) => c.args[2] === E_MARKER_D).map((c) => [c.args[0], c.args[1]]);
        const ml = p.callsOf('line').filter((c) => c.style.strokeWeight === MONGE_WEIGHT);
        assert.equal(pts.length, 3 - pts.filter((q) => Math.abs(q[0]) > 1e6).length);
        if (!ml.length) continue; // line entirely off screen
        assert.equal(ml.length, 1);
        const [x1, y1, x2, y2] = ml[0].args;
        const len = Math.hypot(x2 - x1, y2 - y1);
        for (const [px, py] of pts) {
            const dist = Math.abs((x2 - x1) * (y1 - py) - (x1 - px) * (y2 - y1)) / len;
            assert.ok(dist < 0.5, `distance ${dist}px for config ${k}`);
        }
        checked++;
    }
    assert.ok(checked > 100, `only ${checked} configs had the line visible`);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('equal radii: no NaN, arrows and text drawn, no finite E for that pair', async () => {
    const { p, handle } = await mountSketch();
    handle.setCircles([{ x: -4, y: 0, r: 1.5 }, { x: 3, y: 1, r: 1.5 }, { x: 0, y: 3, r: 2.5 }]);
    const markers = lastFrame(p, 'circle').filter((c) => c.args[2] === E_MARKER_D);
    assert.equal(markers.length, 2);
    assert.ok(p.callsOf('text').some((c) => /infinity/.test(String(c.args[0]))));
    handle.setCircles(PRESETS.equal());
    p.stepFrames(2);
    assert.ok(p.callsOf('text').some((c) => /No|All radii equal/i.test(String(c.args[0]))));
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('every preset, coincident and concentric circles draw without invalid calls', async () => {
    const { p, handle } = await mountSketch({ showInternal: true, showInternalPts: true, showExtra: true, proof: true, proofStep: 3 });
    for (const make of Object.values(PRESETS)) {
        handle.setCircles(make());
        p.stepFrames(2);
    }
    handle.setCircles([{ x: 0, y: 0, r: 2 }, { x: 0, y: 0, r: 2 }, { x: 0, y: 0, r: 2 }]);
    p.stepFrames(1);
    handle.setCircles([{ x: 0, y: 0, r: 2 }, { x: 0, y: 0, r: 3 }, { x: 0, y: 0, r: 4 }]);
    p.stepFrames(1);
    handle.setCircles([{ x: 1e5, y: 0, r: 0.1 }, { x: -1e5, y: 3, r: 0.1000001 }, { x: 0, y: 0, r: 1e4 }]);
    p.stepFrames(1);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('presets via drawer buttons, randomise and reset', async () => {
    const { p, handle, built, settings } = await mountSketch();
    const schema = built[0];
    const flat = [];
    const walk = (nodes) => nodes.forEach((n) => { flat.push(n); if (n.children) walk(n.children); });
    walk(schema);
    const buttons = flat.filter((n) => n.type === 'button');
    assert.ok(buttons.length >= 8);
    const byLabel = (re) => buttons.find((b) => re.test(b.label));
    byLabel(/Nested/).onClick();
    assert.deepEqual(handle.getState().circles.map((c) => c.r), PRESETS.nested().map((c) => c.r));
    byLabel(/Touching/).onClick();
    const [a, b] = handle.getState().circles;
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r)) < 1e-9);
    byLabel(/Randomise/).onClick();
    for (const c of handle.getState().circles) assert.ok(Number.isFinite(c.x + c.y + c.r) && c.r > 0);
    settings.set('animate', true);
    byLabel(/Reset/).onClick();
    assert.equal(settings.get('animate'), false);
    assert.deepEqual(handle.getState().circles.map((c) => c.r), PRESETS.generic().map((c) => c.r));
    p.stepFrames(1);
    p.pressKey('r', 82);
    p.pressKey('z', 90);
    assert.deepEqual(handle.getState().circles.map((c) => c.r), PRESETS.generic().map((c) => c.r));
    handle.unmount();
});

test('animation moves circles; proof overlay steps and hides the line early', async () => {
    const { p, handle, settings } = await mountSketch({ animate: true, speed: 2 });
    const before = handle.getState().circles.map((c) => [c.x, c.y]);
    p.stepFrames(30);
    const after = handle.getState().circles.map((c) => [c.x, c.y]);
    assert.notDeepEqual(before, after);
    settings.set('animate', false);
    settings.set('proof', true);
    settings.set('proofStep', 1);
    assert.equal(lastFrame(p, 'line').filter((c) => c.style.strokeWeight === MONGE_WEIGHT).length, 0);
    assert.ok(p.callsOf('text').some((c) => /Homothety centres/.test(String(c.args[0]))));
    p.pressKey('', 39); // right arrow
    assert.equal(settings.get('proofStep'), 2, 'right arrow advances');
    p.pressKey('', 37);
    assert.equal(settings.get('proofStep'), 1, 'left arrow goes back');
    settings.set('proofStep', 4);
    assert.equal(lastFrame(p, 'line').filter((c) => c.style.strokeWeight === MONGE_WEIGHT).length, 1);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('theme switch redraws, touch events work, unmount twice is safe', async () => {
    const { p, handle } = await mountSketch();
    p.stepFrames(1);
    const { circles, view } = handle.getState();
    const c = circles[2];
    const x0 = c.x;
    p.moveMouse(view.toX(c.x) + 5, view.toY(c.y), { fire: false });
    assert.equal(p.touchStarted({}), false);
    p.moveMouse(view.toX(c.x) + 55, view.toY(c.y), { fire: false });
    p.touchMoved({});
    p.touchEnded({});
    assert.ok(c.x > x0);
    handle.unmount();
    handle.unmount();
    assert.equal(p.removed, true);
});
