import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import sketch from '../../sketches/equal-area/index.js';
import { View, WORLD } from '../../sketches/equal-area/view.js';
import * as G from '../../lib/polygon-area.js';

const W = 1200;
const H = 700;

function makeCtx(initial = {}) {
    const P5 = createMockP5({ width: W, height: H });
    const settings = createStore({ namespace: 'ea-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => ({ width: W, height: H }),
    };
    return { ctx, P5, built, settings, globalSettings };
}

async function mountSketch(initial) {
    const c = makeCtx(initial);
    const handle = await sketch.mount({}, c.ctx);
    const p = c.P5.instances[0];
    const view = new View().fit(WORLD, W, H, { top: 110, bottom: 36, left: 18, right: 18 });
    return { ...c, handle, p, view, model: handle.model };
}

const screen = (view, pt) => view.toScreen(pt);

/** The "Area = ..." readout drawn in the last frame. */
function areaText(p) {
    p.clearCalls();
    p.stepFrames(1);
    const t = p.callsOf('text').map((c) => String(c.args[0])).find((s) => s.startsWith('Area = '));
    assert.ok(t, 'area readout is drawn');
    return t;
}

function dragVertex(m, i, dx, dy) {
    const v = m.model.shape()[i];
    const s = screen(m.view, v);
    m.p.pressMouse(s.x, s.y);
    const steps = 6;
    for (let k = 1; k <= steps; k++) {
        m.p.moveMouse(s.x + (dx * k) / steps, s.y + (dy * k) / steps);
        m.p.stepFrames(1);
    }
    m.p.releaseMouse();
}

test('mounts every tab and draws without invalid calls', async () => {
    const m = await mountSketch();
    for (const tab of ['triangle', 'polygon', 'quadrature']) {
        m.settings.set('tab', tab);
        m.p.stepFrames(3);
    }
    m.settings.set('tab', 'triangle');
    m.settings.set('second', true);
    m.settings.set('pick', true);
    m.p.stepFrames(3);
    assert.equal(m.p.invalidCalls.length, 0, JSON.stringify(m.p.invalidCalls.slice(0, 3)));
    assert.ok(m.p.callsOf('endShape').length > 0);
    assert.equal(m.built.length, 2, 'toolbar tabs and drawer panel built');
    m.handle.unmount();
});

test('dragging a vertex slides it along the parallel guide and the area readout is unchanged', async () => {
    const m = await mountSketch();
    const before = areaText(m.p);
    assert.equal(before, 'Area = 24.000');
    const c0 = { ...m.model.tri[2] };
    const ab = [m.model.tri[0], m.model.tri[1]];
    dragVertex(m, 2, 90, 60); // mouse also moves vertically: must be ignored
    const c1 = m.model.tri[2];
    assert.ok(Math.abs(c1.x - c0.x) > 0.5, 'vertex moved');
    assert.ok(Math.abs(c1.y - c0.y) < 1e-9, 'stays on the line parallel to AB');
    assert.deepEqual(m.model.tri.slice(0, 2), ab, 'other vertices untouched');
    assert.equal(areaText(m.p), before);
    // a slanted opposite side: vertex B of the "obtuse" preset
    m.settings.set('preset.triangle', 'obtuse');
    m.p.stepFrames(1);
    const text0 = areaText(m.p);
    const tri0 = m.model.tri.map((q) => ({ ...q }));
    const line = G.slideConstraint(tri0, 0);
    dragVertex(m, 0, 40, -30);
    const moved = m.model.tri[0];
    const d = { x: moved.x - tri0[0].x, y: moved.y - tri0[0].y };
    assert.ok(Math.hypot(d.x, d.y) > 0.1);
    assert.ok(Math.abs(d.x * line.dir.y - d.y * line.dir.x) < 1e-9, 'moved parallel to the opposite side');
    assert.equal(areaText(m.p), text0);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});

test('free mode: the vertex follows the mouse and the area readout changes', async () => {
    const m = await mountSketch({ constrained: false });
    const before = areaText(m.p);
    dragVertex(m, 2, 0, -80);
    assert.notEqual(areaText(m.p), before);
    assert.ok(Math.abs(m.model.tri[2].y - 9) > 1);
    m.handle.unmount();
});

test('snap-to-grid keeps lattice vertices and Pick reads off the area', async () => {
    const m = await mountSketch({ snap: true, pick: true });
    dragVertex(m, 2, 100, 0);
    const tri = m.model.tri;
    assert.ok(G.isLatticePolygon(tri));
    assert.equal(G.area(tri), 24);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const texts = m.p.callsOf('text').map((c) => String(c.args[0]));
    const pickLine = texts.find((s) => s.startsWith('Pick:'));
    assert.ok(pickLine && /= 24\.000$/.test(pickLine), pickLine);
    const info = G.pickInfo(tri);
    assert.equal(info.interior + info.boundary / 2 - 1, 24);
    m.handle.unmount();
});

test('second triangle shares the base and has the same area', async () => {
    const m = await mountSketch({ second: true });
    m.p.clearCalls();
    m.p.stepFrames(1);
    const texts = m.p.callsOf('text').map((c) => String(c.args[0]));
    assert.ok(texts.some((s) => s.startsWith('Second triangle') && s.endsWith('24.000')), texts.join('|'));
    // dragging the second apex keeps it on the guide
    const a2 = m.model.secondApex();
    const s = screen(m.view, a2);
    m.p.pressMouse(s.x, s.y);
    m.p.moveMouse(s.x + 50, s.y + 40);
    m.p.releaseMouse();
    assert.ok(Math.abs(m.model.secondApex().y - 9) < 1e-9);
    m.handle.unmount();
});

test('polygon tab: Play all reduces to a triangle within a bounded number of frames, area read-out constant', async () => {
    const m = await mountSketch({ tab: 'polygon', 'preset.polygon': 'star' });
    const start = areaText(m.p);
    assert.equal(m.model.poly.length, 8);
    const A0 = G.area(m.model.poly);
    m.model.startPlayAll();
    let frames = 0;
    const seen = new Set([start]);
    while (m.model.poly.length > 3 && frames < 60 * 40) {
        m.p.stepFrames(1);
        frames++;
        if (frames % 7 === 0) seen.add(areaText(m.p)); // areaText steps one frame
        assert.ok(Math.abs(G.area(m.model.displayPoly()) - A0) < 1e-8, 'displayed polygon keeps its area');
    }
    assert.equal(m.model.poly.length, 3);
    assert.ok(frames < 60 * 40, `finished after ${frames} frames`);
    assert.ok(frames > 60, 'the animation takes time');
    assert.equal(seen.size, 1, `area readout changed: ${[...seen]}`);
    assert.equal(m.model.playAll, false);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});

test('polygon tab: Reduce animates one step, undo restores, add/remove vertex respect 3..8', async () => {
    const m = await mountSketch({ tab: 'polygon' });
    m.p.stepFrames(1);
    const n0 = m.model.poly.length;
    assert.equal(m.model.reduce(), true);
    assert.equal(m.model.reduce(), false, 'busy while animating');
    m.p.stepFrames(20);
    const mid = m.model.displayPoly();
    assert.equal(mid.length, n0);
    assert.notDeepEqual(mid, m.model.anim.step.before);
    m.p.stepFrames(200);
    assert.equal(m.model.poly.length, n0 - 1);
    assert.equal(m.model.undo(), true);
    assert.equal(m.model.poly.length, n0);
    while (m.model.addVertex()) { /* fill up */ }
    assert.equal(m.model.poly.length, 8);
    while (m.model.removeVertex()) { /* drain */ }
    assert.equal(m.model.poly.length, 3);
    assert.equal(m.model.reduce(), false);
    m.handle.unmount();
});

test('polygon tab: dragging a vertex keeps the area; keys work', async () => {
    const m = await mountSketch({ tab: 'polygon' });
    const A0 = G.area(m.model.poly);
    dragVertex(m, 1, 60, -40);
    assert.ok(Math.abs(G.area(m.model.poly) - A0) < 1e-9);
    assert.equal(m.model.history.length, 1);
    m.p.pressKey('u');
    assert.ok(Math.abs(G.area(m.model.poly) - A0) < 1e-9);
    assert.equal(m.model.history.length, 0);
    m.p.pressKey('Enter', 13);
    assert.ok(m.model.anim);
    m.p.pressKey('n');
    assert.equal(m.model.anim, null);
    assert.equal(m.model.poly.length, 4);
    m.handle.unmount();
});

test('quadrature plays to the square; area constant; step/pause controls', async () => {
    const m = await mountSketch({ tab: 'quadrature' });
    const first = areaText(m.p);
    assert.equal(first, 'Area = 24.000');
    let frames = 0;
    const seen = new Set();
    while (!m.model.quadFrame().done && frames < 60 * 60) {
        m.p.stepFrames(1);
        frames++;
        if (frames % 11 === 0) seen.add(areaText(m.p));
    }
    assert.ok(m.model.quadFrame().done, `done after ${frames} frames`);
    assert.equal(m.model.quad.k, m.model.quad.steps.length - 1);
    assert.equal(seen.size, 1, [...seen].join('|'));
    const sq = m.model.quad.steps[m.model.quad.steps.length - 1].result;
    assert.ok(Math.abs(Math.hypot(sq[1].x - sq[0].x, sq[1].y - sq[0].y) - Math.sqrt(24)) < 1e-9);

    // pause freezes time; step moves one phase
    m.model.restartQuad();
    m.settings.set('paused', true);
    m.p.stepFrames(120);
    assert.equal(m.model.quad.t, 0);
    m.p.pressKey('n');
    assert.equal(m.model.quad.t, 1);
    m.p.pressKey('n');
    assert.equal(m.model.quad.k, 1);
    m.p.pressKey('b');
    assert.equal(m.model.quad.t, 0);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
});

test('speed setting scales playback', async () => {
    const slow = await mountSketch({ tab: 'quadrature', speed: 0.5 });
    const fast = await mountSketch({ tab: 'quadrature', speed: 3 });
    slow.p.stepFrames(60);
    fast.p.stepFrames(60);
    const prog = (m) => m.model.quad.k + m.model.quad.t;
    assert.ok(prog(fast) > prog(slow) * 3);
    slow.handle.unmount();
    fast.handle.unmount();
});

test('keyboard: tabs, ignore modified keys and focused inputs; shell key d is not used', async () => {
    const m = await mountSketch();
    m.p.pressKey('2');
    assert.equal(m.settings.get('tab'), 'polygon');
    m.p.pressKey('3');
    assert.equal(m.settings.get('tab'), 'quadrature');
    m.p.pressKey('1');
    assert.equal(m.settings.get('tab'), 'triangle');
    m.p.pressKey('c');
    assert.equal(m.settings.get('constrained'), false);
    m.p.key = '2';
    assert.equal(m.p.keyPressed({ ctrlKey: true }), true);
    assert.equal(m.settings.get('tab'), 'triangle');
    assert.equal(m.p.pressKey('d'), true, 'd is left to the shell');
    globalThis.document = { activeElement: { tagName: 'INPUT' } };
    try {
        m.p.pressKey('2');
        assert.equal(m.settings.get('tab'), 'triangle');
    } finally {
        delete globalThis.document;
    }
    m.handle.unmount();
});

test('events from other elements and right-click are ignored; touch handlers exist', async () => {
    const m = await mountSketch();
    const s = screen(m.view, m.model.tri[2]);
    m.p.canvas = { id: 'canvas' };
    m.p.moveMouse(s.x, s.y, { fire: false });
    m.p.mouseButton = 'left';
    m.p.mousePressed({ target: { id: 'other' } });
    assert.equal(m.model.drag, null);
    m.p.mouseButton = m.p.RIGHT;
    m.p.mousePressed({ target: m.p.canvas });
    assert.equal(m.model.drag, null);
    m.p.mouseButton = 'left';
    assert.equal(m.p.touchStarted({ target: m.p.canvas, type: 'touchstart' }), false, 'consumed -> preventDefault');
    assert.ok(m.model.drag);
    m.p.moveMouse(s.x + 30, s.y);
    assert.equal(m.p.touchMoved({}), false);
    assert.equal(m.p.touchEnded({}), false);
    assert.equal(m.model.drag, null);
    m.handle.unmount();
});

test('light theme, presets, reset and resize', async () => {
    const m = await mountSketch();
    m.globalSettings.set('theme', 'light');
    for (const id of ['acute', 'right', 'obtuse', 'flat', 'lattice']) {
        m.settings.set('preset.triangle', id);
        m.p.stepFrames(2);
        assert.equal(m.p.invalidCalls.length, 0, id);
    }
    dragVertex(m, 2, 50, 0);
    m.p.pressKey('r');
    assert.deepEqual(m.model.tri, m.model.triStart);
    m.settings.set('tab', 'polygon');
    for (const id of ['pentagon', 'arrow', 'hexagon', 'heptagon', 'star', 'quad']) {
        m.settings.set('preset.polygon', id);
        m.model.startPlayAll();
        m.p.stepFrames(60 * 30);
        assert.equal(m.model.poly.length, 3, id);
        assert.equal(m.p.invalidCalls.length, 0, id);
    }
    m.handle.unmount();
});

test('unmount twice is safe and late events do nothing', async () => {
    const m = await mountSketch();
    m.p.stepFrames(2);
    m.handle.unmount();
    m.handle.unmount();
    assert.doesNotThrow(() => m.p.stepFrames(2));
    assert.equal(m.p.removed, true);
});
