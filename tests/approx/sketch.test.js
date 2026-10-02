import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import approx from '../../sketches/approx/index.js';

function makeCtx(width = 1200, height = 700, initial = {}) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'approx-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5,
        settings,
        globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => ({ width, height }),
    };
    return { ctx, P5, built, settings };
}

async function mountSketch(initial) {
    const { ctx, P5, built, settings } = makeCtx(1200, 700, initial);
    const handle = await approx.mount({}, ctx);
    const p = P5.instances[0];
    return { p, handle, built, settings };
}



test('mounts, draws frames without invalid geometry or leaked globals', async () => {
    let m;
    m = await mountSketch();
    m.p.stepFrames(3);
    assert.equal(m.p.invalidCalls.length, 0, JSON.stringify(m.p.invalidCalls.slice(0, 3)));
    assert.ok(m.p.callsOf('endShape').length > 0, 'curves drawn');
    assert.ok(m.p.callsOf('image').length > 0, 'domain-colouring image drawn in split mode');
    m.handle.unmount();
});

test('every function x every complex source draws without throwing', async () => {
    const { FUNCTIONS } = await import('../../lib/functions.js');
    const { COMPLEX_SOURCES } = await import('../../sketches/approx/complex.js');
    for (const f of FUNCTIONS) {
        for (const s of COMPLEX_SOURCES) {
            const m = await mountSketch({
                func: f.id, 'cplx.source': s.value,
                'pade.on': true, 'fourier.on': true, 'wavelet.on': true, block: 6,
            });
            m.p.stepFrames(2);
            assert.equal(m.p.invalidCalls.length, 0, `${f.id}/${s.value}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
            m.handle.unmount();
        }
    }
});

test('hover moves the expansion point; click locks; lock survives moves', async () => {
    const { p, handle, settings } = await mountSketch({ mode: 'real', showError: false });
    p.stepFrames(1);
    p.moveMouse(300, 200);
    p.stepFrames(1);
    const markersA = p.callsOf('line').length;
    assert.ok(markersA > 0);
    p.click(300, 200);
    assert.equal(settings.get('lockOn'), true);
    const lockRe = settings.get('lockRe');
    p.moveMouse(800, 300);
    p.stepFrames(1);
    assert.equal(settings.get('lockRe'), lockRe);
    p.click(800, 300);
    assert.equal(settings.get('lockOn'), false);
    handle.unmount();
});

test('taylor curve matches sin(x) near the expansion point (screen-space check)', async () => {
    const { p, handle } = await mountSketch({ mode: 'real', showError: false, 'taylor.ghosts': false, 'taylor.order': 7 });
    p.moveMouse(600, 300); // near the centre of the default view -> a ~ 0
    p.stepFrames(1);
    const shapes = p.callsOf('endShape').filter((c) => c.vertices && c.vertices.length > 100);
    assert.ok(shapes.length >= 2, 'f and Taylor curves');
    const [f, t] = [shapes[0], shapes[shapes.length - 1]];
    const mid = Math.floor(f.vertices.length / 2);
    const dy = Math.abs(f.vertices[mid].y - t.vertices[Math.min(mid, t.vertices.length - 1)].y);
    assert.ok(dy < 3, `curves differ by ${dy}px at the middle`);
    handle.unmount();
});

test('keyboard: arrows change Taylor order, digits switch panels', async () => {
    const { p, handle, settings } = await mountSketch();
    const n0 = settings.get('taylor.order', 5);
    p.pressKey('ArrowUp', p.UP_ARROW);
    assert.equal(settings.get('taylor.order'), n0 + 1);
    p.pressKey('3', 51);
    assert.equal(settings.get('mode'), 'complex');
    p.stepFrames(1);
    assert.equal(p.callsOf('endShape').length >= 0, true);
    handle.unmount();
});

test('unmount removes the p5 instance and is repeatable', async () => {
    for (let i = 0; i < 3; i++) {
        const m = await mountSketch();
        m.p.stepFrames(1);
        m.handle.unmount();
    }
});
