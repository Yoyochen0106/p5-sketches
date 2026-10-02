import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import fourier2d from '../../sketches/fourier2d/index.js';
import { CURVE_PRESETS, RASTER_PRESETS } from '../../sketches/fourier2d/presets.js';
import { MASK_MODES, imageLayout } from '../../sketches/fourier2d/imagePanel.js';
import { curveLayout } from '../../sketches/fourier2d/curvePanel.js';

const W = 1200, H = 700;

async function mountSketch(initial = {}) {
    const P5 = createMockP5({ width: W, height: H });
    const settings = createStore({ namespace: 'f2d-test', storage: createMemoryStorage() });
    // deterministic start: no animation, no smoothing unless a test asks for it
    const base = { 'curve.play': false, 'curve.smooth': 0, ...initial };
    for (const [k, v] of Object.entries(base)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'g-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => ({ width: W, height: H }),
    };
    const handle = await fourier2d.mount({}, ctx);
    return { p: P5.instances[P5.instances.length - 1], handle, built, settings };
}

function findNode(schema, pred) {
    for (const n of schema) {
        if (pred(n)) return n;
        if (n.children) { const r = findNode(n.children, pred); if (r) return r; }
    }
    return null;
}
const button = (built, label) => findNode(built.flat(), (n) => n.type === 'button' && n.label === label) || findNode(built.flat(), (n) => n.type === 'button' && n.label.startsWith(label));

function drag(p, pts) {
    p.pressMouse(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) p.moveMouse(x, y);
    p.releaseMouse();
}

const textsOf = (p) => p.callsOf('text').map((c) => String(c.args[0]));
const noInvalid = (p, msg = '') => assert.equal(p.invalidCalls.length, 0, `${msg} ${JSON.stringify(p.invalidCalls.slice(0, 3))}`);

test('mounts in both modes, draws, no invalid calls, shell UI built, info node present', async () => {
    const m = await mountSketch();
    m.p.stepFrames(3);
    noInvalid(m.p);
    assert.ok(m.p.callsOf('endShape').length > 0);
    assert.ok(findNode(m.built.flat(), (n) => n.type === 'info' && /Space/.test(n.text)), 'usage hint');
    m.settings.set('mode', 'image');
    m.p.clearCalls();
    m.p.stepFrames(2);
    assert.ok(m.p.callsOf('image').length >= 4, 'four views drawn');
    noInvalid(m.p);
    m.handle.unmount();
});

test('freehand strokes by mouse give the expected resampled loop (ghost curve)', async () => {
    const m = await mountSketch({ 'curve.preset': '', 'curve.N': 512, 'curve.K': 512 });
    m.p.stepFrames(1);
    // a rectangle drawn with three drags; the closing edge is implicit
    drag(m.p, [[400, 150], [700, 150], [700, 400]]);
    drag(m.p, [[400, 400]]);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const loops = m.p.callsOf('endShape').filter((c) => c.vertices.length === 512);
    assert.ok(loops.length >= 2, 'ghost + partial sum');
    const ghost = loops[0].vertices;
    // perimeter = 300 + 250 + 300 + 250 = 1100
    const at = (i) => [ghost[i].x, ghost[i].y];
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
    assert.ok(near(at(0), [400, 150]), JSON.stringify(at(0)));
    assert.ok(near(at(Math.round((512 * 300) / 1100)), [700, 150]) || Math.hypot(...[at(Math.round((512 * 300) / 1100))[0] - 700, at(Math.round((512 * 300) / 1100))[1] - 150]) < 3);
    assert.ok(near(at(128), [675, 150]) || Math.hypot(at(128)[0] - 675, at(128)[1] - 150) < 1);
    // arc-length uniform: consecutive vertex distances are (almost) all equal
    const d = ghost.map((v, i) => Math.hypot(ghost[(i + 1) % 512].x - v.x, ghost[(i + 1) % 512].y - v.y));
    assert.ok(Math.max(...d) <= (1100 / 512) + 1e-6);
    // with all 512 harmonics the partial-sum curve reproduces the drawn one
    const part = loops[1].vertices;
    for (let i = 0; i < 512; i += 37) {
        assert.ok(Math.hypot(part[i].x - ghost[i].x, part[i].y - ghost[i].y) < 1e-6);
    }
    // drawing detached the preset
    assert.equal(m.settings.get('curve.preset'), '');
    assert.ok(textsOf(m.p).some((t) => /RMS error = 0\.00/.test(t)));
    noInvalid(m.p);
    m.handle.unmount();
});

test('multiple strokes are joined: second stroke extends the same loop', async () => {
    const m = await mountSketch({ 'curve.preset': '', 'curve.K': 512 });
    m.p.stepFrames(1);
    drag(m.p, [[300, 200], [500, 200]]);
    drag(m.p, [[500, 350], [300, 350]]);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const ghost = m.p.callsOf('endShape').find((c) => c.vertices.length === 512).vertices;
    const ys = new Set(ghost.map((v) => Math.round(v.y)));
    assert.ok(ys.has(200) && ys.has(350));
    // total length = 200 + 150 + 200 + 150 (return edge)
    const perimeter = ghost.reduce((s, v, i) => s + Math.hypot(ghost[(i + 1) % 512].x - v.x, ghost[(i + 1) % 512].y - v.y), 0);
    assert.ok(Math.abs(perimeter - 700) < 3, perimeter);
    m.handle.unmount();
});

test('undo / clear / keyboard', async () => {
    const m = await mountSketch({ 'curve.preset': '' });
    m.p.stepFrames(1);
    drag(m.p, [[300, 200], [500, 200], [500, 300]]);
    drag(m.p, [[300, 300], [300, 250]]);
    m.p.stepFrames(1);
    button(m.built, 'Undo').onClick();
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(m.p.callsOf('endShape').some((c) => c.vertices.length === 512), 'one stroke still forms a loop');
    m.p.pressKey('c', 67); // clear
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(!m.p.callsOf('endShape').some((c) => c.vertices.length === 512));
    assert.ok(textsOf(m.p).some((t) => /Draw a shape/.test(t)));
    m.p.pressKey(' ', 32);
    assert.equal(m.settings.get('curve.play'), true);
    m.p.pressKey('2', 50);
    assert.equal(m.settings.get('mode'), 'image');
    m.p.pressKey('1', 49);
    assert.equal(m.settings.get('mode'), 'curve');
    noInvalid(m.p);
    m.handle.unmount();
});

test('slider / setting changes redraw; idle frames do not', async () => {
    const m = await mountSketch({ 'curve.K': 24 });
    m.p.stepFrames(2);
    m.p.clearCalls();
    m.p.stepFrames(2);
    assert.equal(m.p.callsOf('endShape').length, 0, 'no redraw when nothing changed and paused');
    m.settings.set('curve.K', 5);
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /K = 5 of/.test(t)), textsOf(m.p).join('|'));
    m.p.clearCalls();
    m.settings.set('curve.order', 'freq');
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /lowest \|k\| first/.test(t)));
    m.p.clearCalls();
    m.settings.set('curve.circles', false);
    m.settings.set('curve.arrows', false);
    m.p.stepFrames(1);
    assert.equal(m.p.callsOf('ellipse').filter((c) => c.args[2] > 12).length, 0, 'no circles drawn');
    noInvalid(m.p);
    m.handle.unmount();
});

test('playing advances the animation every frame', async () => {
    const m = await mountSketch({ 'curve.play': true, 'curve.trace': true });
    m.p.stepFrames(1);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const a = m.p.callsOf('endShape').at(-1).vertices.length;
    m.p.stepFrames(30);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const b = m.p.callsOf('endShape').at(-1).vertices.length;
    assert.ok(b > a, `trace grows ${a} -> ${b}`);
    noInvalid(m.p);
    m.handle.unmount();
});

test('clicking a spectrum bar toggles that harmonic', async () => {
    const m = await mountSketch({ 'curve.K': 24, 'curve.order': 'amp' });
    m.p.stepFrames(1);
    const L = curveLayout(W, H, true);
    const Wk = 40, bw = (L.spec.w - 16) / (2 * Wk + 1);
    const barX = (k) => L.spec.x + 8 + (k + Wk + 0.5) * bw;
    m.p.click(barX(1), L.spec.y + 40);
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /K = 23 of/.test(t)), textsOf(m.p).join('|'));
    m.p.click(barX(1), L.spec.y + 40);
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /K = 24 of/.test(t)));
    m.p.click(barX(-35), L.spec.y + 40); // a harmonic that is not among the 24 -> forced on
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /K = 25 of/.test(t)));
    noInvalid(m.p);
    m.handle.unmount();
});

test('every curve preset renders for every N', async () => {
    for (const N of [64, 512]) {
        const m = await mountSketch({ 'curve.N': N });
        for (const c of CURVE_PRESETS) {
            m.settings.set('curve.preset', c.id);
            m.p.clearCalls();
            m.p.stepFrames(2);
            assert.ok(m.p.callsOf('endShape').some((e) => e.vertices.length === N), `${c.id} N=${N}`);
            noInvalid(m.p, c.id);
        }
        m.handle.unmount();
    }
});

test('image mode: every raster preset x every mask mode x grid size renders', async () => {
    for (const n of [32, 64, 128]) {
        const m = await mountSketch({ mode: 'image', 'img.n': n });
        for (const r of RASTER_PRESETS) {
            m.settings.set('img.preset', r.id);
            for (const mm of MASK_MODES) {
                m.settings.set('img.mode', mm.value);
                m.p.clearCalls();
                m.p.stepFrames(1);
                assert.ok(m.p.callsOf('image').length >= 4, `${r.id}/${mm.value}/${n}`);
                assert.ok(textsOf(m.p).some((t) => /PSNR/.test(t)));
            }
            noInvalid(m.p, r.id);
        }
        m.handle.unmount();
    }
});

test('image mode: full mask is exact, DC-only is flat, metrics reflect the kept count', async () => {
    const m = await mountSketch({ mode: 'image', 'img.n': 32, 'img.mode': 'square', 'img.K': 16 });
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 1024\/1024/.test(t) && /compression 1\.0:1/.test(t)), textsOf(m.p).join('|'));
    assert.ok(textsOf(m.p).some((t) => /inf \(exact\)/.test(t)));
    m.settings.set('img.K', 0);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 1\/1024/.test(t)));
    m.settings.set('img.mode', 'topk');
    m.settings.set('img.top', 50);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 50\/1024/.test(t)));
    m.settings.set('img.mode', 'disc');
    m.settings.set('img.radius', 0);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 1\/1024/.test(t)));
    m.settings.set('img.error', false);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.equal(m.p.callsOf('image').length, 3);
    noInvalid(m.p);
    m.handle.unmount();
});

test('image mode: painting on the original and on the spectrum', async () => {
    const m = await mountSketch({ mode: 'image', 'img.n': 32, 'img.preset': 'ring', 'img.size': 2 });
    m.p.stepFrames(1);
    const lay = imageLayout(W, H, true);
    const o = lay.cells.orig, s = lay.cells.spec;
    button(m.built, 'Clear').onClick();
    assert.equal(m.settings.get('img.preset'), '');
    m.p.clearCalls();
    m.p.stepFrames(1);
    const origImg = () => m.p.callsOf('image')[0].args[0];
    assert.ok(origImg().pixels.every((v, i) => i % 4 === 3 || v === 0), 'cleared');
    drag(m.p, [[o.x + o.s * 0.25, o.y + o.s * 0.5], [o.x + o.s * 0.75, o.y + o.s * 0.5]]);
    m.p.clearCalls();
    m.p.stepFrames(1);
    const px = (x, y) => origImg().pixels[(y * 32 + x) * 4];
    assert.equal(px(16, 16), 255);
    assert.equal(px(10, 16), 255);
    assert.equal(px(16, 2), 0);
    // erase brush
    m.settings.set('img.tool', 'erase');
    m.p.click(o.x + o.s * 0.5, o.y + o.s * 0.5);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.equal(px(16, 16), 0);
    // paint the mask on the spectrum: switches to painted mask, starting from the current mode's mask
    m.settings.set('img.mode', 'square');
    m.settings.set('img.K', 1);
    m.settings.set('img.maskSize', 0);
    m.p.stepFrames(1);
    m.p.click(s.x + s.s * 0.5, s.y + s.s * 0.5); // DC, tool = keep
    assert.equal(m.settings.get('img.mode'), 'paint');
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /painted mask\s+kept 9\/1024/.test(t)), textsOf(m.p).join('|'));
    m.settings.set('img.maskTool', 'remove');
    m.settings.set('img.maskSize', 0);
    m.p.click(s.x + s.s * 0.5 + s.s / 32, s.y + s.s * 0.5); // fx = +1 -> removes it and its mirror
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 7\/1024/.test(t)), textsOf(m.p).join('|'));
    button(m.built, 'Mask: keep none').onClick();
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(textsOf(m.p).some((t) => /kept 0\/1024/.test(t) && /inf:1/.test(t)));
    button(m.built, 'Mask: keep all').onClick();
    m.p.stepFrames(1);
    button(m.built, 'Mask: copy').onClick();
    button(m.built, 'Fill').onClick();
    button(m.built, 'Invert').onClick();
    button(m.built, 'Noise').onClick();
    m.p.stepFrames(1);
    noInvalid(m.p);
    m.handle.unmount();
});

test('grid size changes keep working; ignoring right button and foreign targets', async () => {
    const m = await mountSketch({ mode: 'image', 'img.n': 64 });
    m.p.stepFrames(1);
    m.settings.set('img.n', 128);
    m.p.stepFrames(1);
    m.settings.set('img.n', 32);
    m.p.clearCalls();
    m.p.stepFrames(1);
    assert.ok(m.p.callsOf('image')[0].args[0].width === 32);
    const lay = imageLayout(W, H, true);
    const o = lay.cells.orig;
    button(m.built, 'Clear').onClick();
    m.p.pressMouse(o.x + 10, o.y + 10, 'right');
    m.p.releaseMouse();
    m.p.moveMouse(o.x + 20, o.y + 20, { fire: false });
    assert.equal(m.p.fire('mousePressed', { target: {} }), undefined);
    m.p.releaseMouse();
    m.p.clearCalls();
    m.settings.set('img.size', 3);
    m.p.stepFrames(1);
    assert.ok(m.p.callsOf('image')[0].args[0].pixels.every((v, i) => i % 4 === 3 || v === 0), 'nothing painted');
    noInvalid(m.p);
    m.handle.unmount();
});

test('touch handlers paint and return false when consumed', async () => {
    const m = await mountSketch({ 'curve.preset': '' });
    m.p.stepFrames(1);
    m.p.mouseX = 400; m.p.mouseY = 200; m.p.mouseButton = 'left';
    assert.equal(m.p.fire('touchStarted'), false);
    m.p.mouseX = 500; m.p.mouseY = 260;
    assert.equal(m.p.fire('touchMoved'), false);
    assert.equal(m.p.fire('touchEnded'), false);
    assert.equal(m.p.fire('touchEnded'), true);
    m.handle.unmount();
});

test('unmount twice is safe and late frames do nothing', async () => {
    const m = await mountSketch();
    m.p.stepFrames(1);
    m.handle.unmount();
    m.handle.unmount();
    m.p.stepFrames(2);
    noInvalid(m.p);
});

test('theme change redraws without errors (light palette)', async () => {
    const P5 = createMockP5({ width: W, height: H });
    const settings = createStore({ namespace: 'f2d-theme', storage: createMemoryStorage() });
    const globalSettings = createStore({ namespace: 'g-theme', storage: createMemoryStorage() });
    const ctx = {
        p5: P5, settings, globalSettings, ui: { build: () => ({ destroy() {} }) }, drawer: {}, toolbar: {},
        onResize: () => () => {}, size: () => ({ width: W, height: H }),
    };
    const h = await fourier2d.mount({}, ctx);
    const p = P5.instances[0];
    p.stepFrames(1);
    globalSettings.set('theme', 'light');
    p.stepFrames(1);
    noInvalid(p);
    h.unmount();
});
