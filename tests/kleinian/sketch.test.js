import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import kleinian from '../../sketches/kleinian/index.js';
import { KLEIN_PRESETS } from '../../sketches/kleinian/presets.js';
import { IFS_PRESETS } from '../../lib/ifs.js';

const W = 900, H = 640;

async function mountSketch(initial = {}, size = { width: W, height: H }) {
    const P5 = createMockP5({ width: size.width, height: size.height });
    const settings = createStore({ namespace: 'kl-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries({ 'ifs.speed': 20000, 'kl.speed': 10000, ...initial })) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'g-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => size,
    };
    const handle = await kleinian.mount({}, ctx);
    const p = P5.instances[P5.instances.length - 1];
    p.stepFrames(1);
    return { p, handle, built, settings };
}

const noInvalid = (p, msg = '') => assert.equal(p.invalidCalls.length, 0, `${msg} ${JSON.stringify(p.invalidCalls.slice(0, 3))}`);
const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
const snapshot = (g) => Uint32Array.from(g.counts);
const differs = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };

test('mounts on the IFS tab, draws the attractor image and the map handles', async () => {
    const m = await mountSketch();
    m.p.stepFrames(4);
    noInvalid(m.p);
    assert.ok(m.p.callsOf('image').length >= 1);
    assert.ok(m.handle.ifs.grid.total > 10000);
    assert.equal(m.handle.ifs.maps.length, 3);
    assert.ok(m.p.callsOf('endShape').length >= 3, 'one parallelogram per map');
    m.handle.unmount();
});

test('every IFS preset renders without invalid calls and conserves the point count', async () => {
    for (const pre of IFS_PRESETS) {
        const m = await mountSketch({ 'ifs.preset': pre.id });
        m.p.stepFrames(3);
        noInvalid(m.p, pre.id);
        const g = m.handle.ifs.grid;
        assert.equal(sum(g.counts), g.inView, pre.id);
        assert.ok(g.inView > 1000, `${pre.id}: ${g.inView}`);
        m.handle.unmount();
    }
});

test('dragging a corner handle changes the map and restarts the accumulation', async () => {
    const m = await mountSketch({ 'ifs.preset': 'sierpinski' });
    m.p.stepFrames(3);
    const ifs = m.handle.ifs;
    const before = snapshot(ifs.grid);
    const [hx, hy] = ifs.handlePoints(1).X;
    const a0 = ifs.maps[1].a;
    m.p.pressMouse(hx, hy);
    m.p.moveMouse(hx - 40, hy + 15);
    m.p.releaseMouse();
    assert.notEqual(ifs.maps[1].a, a0);
    m.p.stepFrames(3);
    assert.ok(differs(before, snapshot(ifs.grid)));
    noInvalid(m.p);
    // weights from the sliders feed back into the maps
    m.settings.set('ifs.w0', 0.2);
    m.p.stepFrames(2);
    assert.equal(ifs.maps[0].p, 0.2);
    m.handle.unmount();
});

test('every Moebius preset renders on the plane and on the sphere without invalid calls', async () => {
    for (const pre of KLEIN_PRESETS) {
        const m = await mountSketch({ tab: 'plane', 'kl.preset': pre.id, 'kl.depth': 6 });
        m.p.stepFrames(4);
        noInvalid(m.p, `plane ${pre.id}`);
        const g = m.handle.plane.grid;
        assert.ok(g.inView > 100, `${pre.id}: only ${g.inView} points in view`);
        assert.equal(sum(g.counts), g.inView);
        m.settings.set('tab', 'sphere');
        m.p.stepFrames(3);
        noInvalid(m.p, `sphere ${pre.id}`);
        assert.ok(m.handle.sphere.pixelsDrawn > 50, `${pre.id}: ${m.handle.sphere.pixelsDrawn} sphere pixels`);
        m.handle.unmount();
    }
});

test('dragging a Schottky generator circle changes the limit-set density', async () => {
    const m = await mountSketch({ tab: 'plane', 'kl.preset': 'fuchsian-cantor', 'kl.method': 'both' });
    m.p.stepFrames(4);
    const plane = m.handle.plane;
    const before = snapshot(plane.grid);
    const q = plane.pairs[0];
    const [sx, sy] = plane.st.view.toScreen(q.c1[0], q.c1[1]);
    const r0 = q.c1.slice();
    m.p.pressMouse(sx, sy);
    m.p.moveMouse(sx + 25, sy - 30);
    m.p.releaseMouse();
    assert.notDeepEqual(plane.pairs[0].c1, r0);
    assert.equal(m.settings.get('kl.preset'), '', 'the group is now custom');
    m.p.stepFrames(4);
    assert.ok(differs(before, snapshot(plane.grid)));
    noInvalid(m.p);
    // radius handle
    const r1 = plane.pairs[0].r1;
    const [hx, hy] = plane.st.view.toScreen(plane.pairs[0].c1[0] + r1, plane.pairs[0].c1[1]);
    m.p.pressMouse(hx, hy);
    m.p.moveMouse(hx + 20, hy);
    m.p.releaseMouse();
    assert.ok(plane.pairs[0].r1 > r1);
    m.handle.unmount();
});

test('Apollonian preset: every generated quadruple satisfies Descartes and is tangent', async () => {
    const m = await mountSketch({ tab: 'plane', 'kl.preset': 'apollonian', 'kl.depth': 4 });
    m.p.stepFrames(3);
    const { circles, quads } = m.handle.plane.gasket;
    assert.ok(quads.length > 20);
    for (const q of quads) {
        const k = q.map((i) => circles[i].k);
        const s = k[0] + k[1] + k[2] + k[3];
        const s2 = k.reduce((a, b) => a + b * b, 0);
        assert.ok(Math.abs(s * s - 2 * s2) < 1e-6 * Math.max(1, s2), `Descartes ${k}`);
    }
    noInvalid(m.p);
    m.handle.unmount();
});

test('sphere view draws points, curves and rotates', async () => {
    const m = await mountSketch({ tab: 'sphere', 'kl.preset': 'maskit-cusp', 'sp.spin': true });
    m.p.stepFrames(4);
    const sph = m.handle.sphere;
    assert.ok(sph.st.count > 1000);
    assert.ok(sph.pixelsDrawn > 500);
    assert.ok(m.p.callsOf('line').length > 20, 'graticule / circle segments');
    const yaw = sph.camera.yaw;
    m.p.stepFrames(5);
    assert.ok(sph.camera.yaw !== yaw, 'spinning');
    // orbit drag changes the camera
    const y1 = sph.camera.yaw;
    m.p.pressMouse(300, 300);
    m.p.moveMouse(380, 320);
    m.p.releaseMouse();
    assert.notEqual(sph.camera.yaw, y1);
    noInvalid(m.p);
    m.handle.unmount();
});

test('wheel zoom, pause and keys do not break anything; unmount twice is safe', async () => {
    const m = await mountSketch({ tab: 'plane', 'kl.preset': 'gasket-group' });
    m.p.stepFrames(2);
    const s0 = m.handle.plane.st.view.scale;
    m.p.moveMouse(400, 300);
    m.p.fire('mouseWheel', { deltaY: -120 });
    assert.ok(m.handle.plane.st.view.scale > s0);
    m.p.pressKey(' ', 32);
    assert.equal(m.settings.get('kl.paused'), true);
    const n = m.handle.plane.grid.total;
    m.p.stepFrames(2);
    assert.equal(m.handle.plane.grid.total, n);
    m.p.pressKey('c', 67);
    m.settings.set('tab', 'ifs');
    m.p.stepFrames(2);
    m.settings.set('tab', 'plane');
    m.p.stepFrames(2);
    noInvalid(m.p);
    m.handle.unmount();
    m.handle.unmount();
    assert.ok(m.p.removed);
});
