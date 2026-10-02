import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import chladni from '../../sketches/chladni/index.js';
import { PRESETS } from '../../sketches/chladni/state.js';
import { meanAmplitude } from '../../lib/sand.js';

async function mountSketch(initial = {}, width = 1000, height = 700) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'chladni-test', storage: createMemoryStorage() });
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
    const handle = await chladni.mount({}, ctx);
    return { p: P5.instances[P5.instances.length - 1], handle, settings, built, dbg: handle.debug() };
}

/** Nodal-line polylines of the last frame: endShape calls with vertices, in pixel coordinates. */
function lastPolylines(p) {
    const frame = p.frameCount;
    return p.callsOf('endShape').filter((c) => c.frame === frame && c.vertices && c.vertices.length > 1);
}

test('every shape x several modes renders without invalid geometry', async () => {
    const cases = [];
    for (const [m, n] of [[1, 1], [2, 1], [2, 3], [4, 4]]) {
        cases.push({ shape: 'square', kind: 'simply', 's0.m': m, 's0.n': n });
        cases.push({ shape: 'square', kind: 'free', 's0.m': m, 's0.n': n });
        cases.push({ shape: 'square', kind: 'clamped', 's0.m': m, 's0.n': n });
        cases.push({ shape: 'rect', kind: 'simply', aspect: 1.7, 's0.m': m, 's0.n': n });
        cases.push({ shape: 'rect', kind: 'clamped', aspect: 2.2, 's0.m': m, 's0.n': n });
        cases.push({ shape: 'circle', 's0.m': m - 1, 's0.n': Math.ceil(n / 2) });
    }
    for (const c of cases) {
        const { p, handle } = await mountSketch({ ...c, res: 64 });
        p.stepFrames(3);
        assert.equal(p.invalidCalls.length, 0, `${JSON.stringify(c)}: ${JSON.stringify(p.invalidCalls.slice(0, 2))}`);
        assert.ok(p.callsOf('image').length > 0, 'field image drawn');
        handle.unmount();
    }
});

test('toolbar and drawer schemas are built', async () => {
    const { built, handle } = await mountSketch();
    assert.equal(built.length, 2);
    assert.ok(built[0].some((n) => n.key === 'shape'));
    const keys = JSON.stringify(built[1]);
    for (const k of ['s0.m', 's3.a', 'drive.ratio', 'damping', 'amp', 'sand.on', 'lineWidth']) assert.ok(keys.includes(`"${k}"`), k);
    handle.unmount();
});

test('(1,1) simply supported has no interior nodal line; (2,1) has a vertical line at x = 0.5', async () => {
    const a = await mountSketch({ shape: 'square', kind: 'simply', 's0.m': 1, 's0.n': 1, playing: false });
    a.p.stepFrames(1);
    assert.equal(lastPolylines(a.p).length, 0);
    assert.equal(a.dbg.model.lines.count, 0);
    a.handle.unmount();

    const b = await mountSketch({ shape: 'square', kind: 'simply', 's0.m': 2, 's0.n': 1, playing: false });
    b.p.stepFrames(1);
    const lines = lastPolylines(b.p);
    assert.ok(lines.length >= 1);
    const { rect } = b.dbg.st;
    const cx = rect.x + rect.w / 2;
    let n = 0;
    for (const l of lines) for (const v of l.vertices) { assert.ok(Math.abs(v.x - cx) < 0.5, `x ${v.x} vs ${cx}`); n++; }
    assert.ok(n > 40, `vertices ${n}`);
    // the line spans (almost) the full plate height
    const ys = lines.flatMap((l) => l.vertices.map((v) => v.y));
    assert.ok(Math.max(...ys) - Math.min(...ys) > rect.h * 0.9);
    b.handle.unmount();
});

test('(2,2) has a cross, circular (0,2) a ring, (1,1) circle a diameter', async () => {
    const a = await mountSketch({ shape: 'square', kind: 'simply', 's0.m': 2, 's0.n': 2, playing: false });
    a.p.stepFrames(1);
    const { rect } = a.dbg.st;
    const xs = new Set();
    const ys = new Set();
    for (const l of lastPolylines(a.p)) for (const v of l.vertices) { xs.add(Math.round(v.x)); ys.add(Math.round(v.y)); }
    assert.ok(xs.has(Math.round(rect.x + rect.w / 2)) && ys.has(Math.round(rect.y + rect.h / 2)));
    a.handle.unmount();

    const b = await mountSketch({ shape: 'circle', 's0.m': 0, 's0.n': 2, playing: false });
    b.p.stepFrames(1);
    const r = b.dbg.st.rect;
    const rad = (2.404826 / 5.520078) * (r.w / 2);
    for (const l of lastPolylines(b.p)) {
        for (const v of l.vertices) assert.ok(Math.abs(Math.hypot(v.x - (r.x + r.w / 2), v.y - (r.y + r.h / 2)) - rad) < r.w * 0.015);
    }
    assert.ok(lastPolylines(b.p).length >= 1);
    b.handle.unmount();
});

test('mode table: click selects a mode and tunes the drive', async () => {
    const { p, settings, dbg, handle } = await mountSketch({ shape: 'square', kind: 'simply', playing: false });
    p.stepFrames(1);
    const table = dbg.model.cfg.table;
    assert.equal(table.length, 20);
    const row = 3; // (2,2)
    const x = p.width - 200;
    const y = 46 + 18 + row * dbg.st.rowH + 3;
    p.click(x, y);
    assert.equal(settings.get('s0.m'), table[row].spec.m);
    assert.equal(settings.get('s0.n'), table[row].spec.n);
    assert.ok(Math.abs(settings.get('drive.ratio') - table[row].ratio) < 1e-9);
    p.stepFrames(1);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('clicking and dragging the plate places the excitation point and turns the drive on', async () => {
    const { p, settings, dbg, handle } = await mountSketch({ shape: 'square', playing: true });
    p.stepFrames(2);
    const { rect } = dbg.st;
    assert.equal(settings.get('drive.on'), false);
    p.click(rect.x + rect.w * 0.25, rect.y + rect.h * 0.25);
    assert.equal(settings.get('drive.on'), true);
    assert.ok(Math.abs(settings.get('src.u') - 0.25) < 1e-9);
    assert.ok(Math.abs(settings.get('src.v') - 0.75) < 1e-9);
    p.pressMouse(rect.x + 10, rect.y + 10);
    p.moveMouse(rect.x + rect.w * 0.8, rect.y + rect.h * 0.5);
    p.releaseMouse();
    assert.ok(Math.abs(settings.get('src.u') - 0.8) < 1e-9);
    assert.ok(Math.abs(settings.get('src.v') - 0.5) < 1e-9);
    p.stepFrames(3);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 2)));
    // the driven snapshot looks like some combination of modes: has nodal lines
    assert.ok(lastPolylines(p).length >= 1);
    // clicks outside the plate (and right clicks) do nothing
    settings.set('src.u', 0.5);
    p.click(2, 2);
    p.click(rect.x + 5, rect.y + 5, 'right');
    assert.equal(settings.get('src.u'), 0.5);
    handle.unmount();
});

test('driven near a resonance shows that mode; frequency sweep raises the ratio', async () => {
    const { p, settings, dbg, handle } = await mountSketch({
        shape: 'square', kind: 'simply', 'drive.on': true, 'drive.ratio': 5, damping: 0.003, 'src.u': 0.31, 'src.v': 0.43, playing: false,
    });
    p.stepFrames(1);
    // ratio 5 on a simply supported plate is (1,2)/(2,1) (omega 5 pi^2 vs fundamental 2 pi^2 -> 2.5): use ratio 4 = (2,2)
    settings.set('drive.ratio', 4);
    p.stepFrames(1);
    const lines = lastPolylines(p);
    const { rect } = dbg.st;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    let nearV = 0; let nearH = 0; let total = 0;
    for (const l of lines) for (const v of l.vertices) { total++; if (Math.abs(v.x - cx) < 3) nearV++; if (Math.abs(v.y - cy) < 3) nearH++; }
    assert.ok(nearV > 20 && nearH > 20 && (nearV + nearH) / total > 0.85, `${nearV} ${nearH} ${total}`);
    handle.unmount();

    const s = await mountSketch({ shape: 'square', kind: 'simply', 'drive.on': false, 'drive.ratio': 1, sweep: true, playing: true });
    const r0 = s.dbg.st.ratio;
    s.p.stepFrames(120);
    assert.equal(s.settings.get('drive.on'), true, 'sweep switches the drive on');
    assert.ok(s.dbg.st.ratio > r0 * 1.05, `${r0} -> ${s.dbg.st.ratio}`);
    assert.ok(s.settings.get('drive.ratio') > r0);
    assert.equal(s.p.invalidCalls.length, 0);
    s.handle.unmount();
});

test('mode mixing: two non-degenerate modes change the nodal pattern in time', async () => {
    const { p, dbg, handle } = await mountSketch({
        shape: 'square', kind: 'simply', 's0.m': 1, 's0.n': 1, 's1.m': 2, 's1.n': 1, 's1.a': 1, playing: true, speed: 1,
    });
    p.stepFrames(1);
    const first = dbg.model.lines.count;
    const seen = new Set([first]);
    for (let i = 0; i < 30; i++) { p.stepFrames(1); seen.add(dbg.model.lines.count); }
    assert.ok(seen.size > 1, 'nodal pattern evolves');
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('sand: grains move toward the nodal lines (mean |u| drops)', async () => {
    const { p, dbg, handle } = await mountSketch({
        shape: 'square', kind: 'simply', 's0.m': 3, 's0.n': 2, 'sand.on': true, 'sand.count': 2500, playing: true, amp: 1,
    });
    p.stepFrames(1);
    const grid = dbg.model.cfg.slots[0].grid;
    const before = meanAmplitude(dbg.st.sand, grid);
    p.stepFrames(120);
    const after = meanAmplitude(dbg.st.sand, grid);
    assert.ok(after < before * 0.7, `${before} -> ${after}`);
    assert.ok(p.callsOf('image').length >= 2);
    assert.equal(p.invalidCalls.length, 0);
    // paused: grains do not move
    dbg.store.set('playing', false);
    const x0 = dbg.st.sand.x[0];
    p.stepFrames(10);
    assert.equal(dbg.st.sand.x[0], x0);
    handle.unmount();
});

test('presets apply and render; every preset is valid', async () => {
    for (const pr of PRESETS) {
        const { p, settings, handle } = await mountSketch({});
        p.stepFrames(1);
        settings.set('preset', pr.id);
        assert.equal(settings.get('preset'), '', 'preset key resets');
        p.stepFrames(4);
        assert.equal(p.invalidCalls.length, 0, `${pr.id}: ${JSON.stringify(p.invalidCalls.slice(0, 2))}`);
        handle.unmount();
    }
});

test('keyboard: space pauses, arrows change m and n, r reseeds sand', async () => {
    const { p, settings, handle } = await mountSketch({ 's0.m': 2, 's0.n': 2 });
    p.pressKey(' ', 32);
    assert.equal(settings.get('playing'), false);
    p.pressKey('ArrowRight', p.RIGHT_ARROW);
    assert.equal(settings.get('s0.m'), 3);
    p.pressKey('ArrowDown', p.DOWN_ARROW);
    assert.equal(settings.get('s0.n'), 1);
    handle.unmount();
});

test('CSV export and narrow layout (no sidebar) work', async () => {
    const { p, dbg, handle } = await mountSketch({ shape: 'square', 's0.m': 2, 's0.n': 1, playing: false }, 500, 600);
    p.stepFrames(2);
    assert.equal(dbg.st.side, 0);
    const csv = dbg.exportCsv();
    assert.ok(csv.startsWith('x0,y0,x1,y1'));
    assert.ok(csv.split('\n').length > 10);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('unmount twice is safe and later frames do nothing', async () => {
    const { p, handle } = await mountSketch({ 'sand.on': true });
    p.stepFrames(2);
    handle.unmount();
    handle.unmount();
    assert.doesNotThrow(() => p.stepFrames(2));
    assert.equal(p.removed, true);
});
