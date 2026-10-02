import test from 'node:test';
import assert from 'node:assert/strict';
import { Pen } from '../../sketches/fourier2d/pen.js';
import { RasterPainter, MaskPainter, brushWeight } from '../../sketches/fourier2d/raster.js';
import {
    CURVE_PRESETS, RASTER_PRESETS, getCurvePreset, getRasterPreset, glyphA, textPreset,
} from '../../sketches/fourier2d/presets.js';
import { CurveModel, curveLayout, spectrumHit } from '../../sketches/fourier2d/curvePanel.js';
import { imageLayout, hitCell } from '../../sketches/fourier2d/imagePanel.js';
import { createMockP5 } from '../mock-p5.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('pen: strokes join into one closed loop resampled to N points', () => {
    const pen = new Pen();
    // two strokes forming a unit square outline: bottom+right, then top+left
    pen.begin({ x: 0, y: 0 }); pen.add({ x: 1, y: 0 }, 0); pen.add({ x: 1, y: 1 }, 0); pen.end();
    pen.begin({ x: 0, y: 1 }); pen.add({ x: 0, y: 0.5 }, 0); pen.end();
    const loop = pen.loop(16, 0);
    assert.equal(loop.length, 16);
    assert.deepEqual(loop[0], { x: 0, y: 0 });
    // perimeter: 1 + 1 + hypot(1,0) (1,1)->(0,1) + 0.5 + hypot(0,0.5) back to (0,0) = 1+1+1+0.5+0.5 = 4
    close(loop[4].x, 1); close(loop[4].y, 0);
    close(loop[8].x, 1); close(loop[8].y, 1);
    for (let i = 0; i < 16; i++) {
        const a = loop[i], b = loop[(i + 1) % 16];
        assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= 0.25 + 1e-9);
    }
});

test('pen: min distance, undo, clear, presets, degenerate loops', () => {
    const pen = new Pen();
    assert.deepEqual(pen.loop(8), []);
    pen.begin({ x: 0, y: 0 });
    assert.equal(pen.add({ x: 0.001, y: 0 }, 0.01), false);
    assert.equal(pen.add({ x: 0.5, y: 0 }, 0.01), true);
    assert.equal(pen.add({ x: NaN, y: 0 }), false);
    pen.end();
    assert.equal(pen.hasLoop(), true);
    pen.begin({ x: 1, y: 1 }); pen.end();
    assert.equal(pen.strokes.length, 2);
    pen.undo();
    assert.equal(pen.strokes.length, 1);
    pen.clear();
    assert.equal(pen.hasLoop(), false);
    pen.begin({ x: 0.2, y: 0.2 }); pen.end(); // a single dot is not a loop
    assert.equal(pen.hasLoop(), false);
    pen.setPreset(getCurvePreset('circle').points());
    assert.equal(pen.fromPreset, true);
    pen.begin({ x: 0, y: 0 }); // drawing over a preset replaces it
    assert.equal(pen.strokes.length, 1);
    assert.equal(pen.fromPreset, false);
    const v = pen.version;
    pen.undo();
    assert.ok(pen.version > v);
});

test('pen: smoothing keeps N points', () => {
    const pen = new Pen();
    pen.setPreset(getCurvePreset('square').points());
    assert.equal(pen.loop(64, 5).length, 64);
});

test('raster: dab, hardness falloff, erase, invert, resize', () => {
    const r = new RasterPainter(16);
    r.dab(8, 8, 3, 1, false);
    assert.equal(r.data[8 * 16 + 8], 1);
    assert.equal(r.data[0], 0);
    r.dab(8, 8, 3, 1, true);
    assert.equal(r.data[8 * 16 + 8], 0);
    const soft = new RasterPainter(16);
    soft.dab(8, 8, 4, 0, false);
    const centre = soft.data[8 * 16 + 8], edge = soft.data[8 * 16 + 11];
    assert.ok(centre > edge && edge > 0 && centre <= 1);
    close(brushWeight(0, 5, 0), 1); close(brushWeight(5, 5, 0), 0); close(brushWeight(6, 5, 0.5), 0);
    r.fill(1); r.invert();
    assert.ok(r.data.every((v) => v === 0));
    r.dab(NaN, 3, 2, 1, false); // ignored
    assert.ok(r.data.every((v) => v === 0));
    r.dab(2, 2, 2, 1, false);
    r.resize(32);
    assert.equal(r.n, 32);
    assert.equal(r.data[4 * 32 + 4], 1);
    assert.equal(r.data.length, 1024);
    r.dab(-50, -50, 3, 1, false); // fully outside: no crash
});

test('raster: stroke has no gaps', () => {
    const r = new RasterPainter(32);
    r.stroke(2, 16, 30, 16, 0.5, 1, false);
    for (let x = 2; x < 30; x++) assert.equal(r.data[16 * 32 + x], 1, `x=${x}`);
});

test('mask painter: paints conjugate-symmetric bins; resize maps frequencies', () => {
    const m = new MaskPainter(16);
    m.paint(8 + 3, 8 + 2, 0, true);
    assert.equal(m.data[(8 + 2) * 16 + 8 + 3], 1);
    assert.equal(m.data[(8 - 2) * 16 + 8 - 3], 1);
    m.paint(8 + 3, 8 + 2, 0, false);
    assert.equal(m.data.reduce((a, b) => a + b, 0), 0);
    m.paint(0, 0, 0, true); // Nyquist corner is its own mirror
    assert.equal(m.data[0], 1);
    m.fillAll(true);
    m.resize(32);
    assert.equal(m.data[16 * 32 + 16], 1); // DC kept
    assert.equal(m.data[0], 0); // outside the old frequency range
    m.load(32, new Uint8Array(1024).fill(1));
    assert.equal(m.data[5], 1);
});

test('presets: every curve preset gives finite points within the unit box', () => {
    for (const c of CURVE_PRESETS) {
        const pts = c.points();
        assert.ok(pts.length >= 100, c.id);
        for (const q of pts) {
            assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y), c.id);
            assert.ok(Math.abs(q.x) <= 1.05 && Math.abs(q.y) <= 1.05, `${c.id} ${q.x},${q.y}`);
        }
        const pen = new Pen();
        pen.setPreset(pts);
        assert.equal(pen.loop(256, 0).length, 256, c.id);
    }
    assert.equal(getCurvePreset('nope'), null);
});

test('presets: every raster preset gives values in [0,1] and is not blank/constant (except none)', () => {
    for (const n of [32, 64, 128]) {
        for (const r of RASTER_PRESETS) {
            const d = r.make(n);
            assert.equal(d.length, n * n, r.id);
            let min = 1, max = 0;
            for (const v of d) { assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), r.id); min = Math.min(min, v); max = Math.max(max, v); }
            assert.ok(max - min > 0.2, `${r.id} n=${n} is flat`);
        }
    }
    assert.equal(getRasterPreset('nope'), null);
    assert.ok(glyphA(64)[64 * 40 + 20] > 0.5 || glyphA(64).some((v) => v > 0.5));
});

test('textPreset degrades gracefully: no p5, throwing p5, blank mock graphics', () => {
    const n = 32;
    const ref = glyphA(n);
    assert.deepEqual(Array.from(textPreset({}, n)), Array.from(ref));
    assert.deepEqual(Array.from(textPreset({ createGraphics() { throw new Error('no'); } }, n)), Array.from(ref));
    const P5 = createMockP5({ width: 100, height: 100 });
    const p = new P5(() => {}, {});
    const out = textPreset(p, n);
    assert.equal(out.length, n * n);
    assert.ok(out.some((v) => v > 0.5));
    // a working rasteriser is used when it produces ink
    const fake = {
        CENTER: 'center',
        createGraphics: () => ({
            pixelDensity() {}, background() {}, noStroke() {}, fill() {}, textAlign() {}, textSize() {}, text() {}, remove() {},
            loadPixels() { this.pixels = new Uint8ClampedArray(n * n * 4).fill(255); },
        }),
    };
    assert.ok(textPreset(fake, n).every((v) => v === 1));
});

test('curve model: caching, order, toggling harmonics, error decreases with K', () => {
    const pen = new Pen();
    pen.setPreset(getCurvePreset('heart').points());
    const m = new CurveModel();
    assert.equal(m.update(pen, 256, 0, 'amp'), true);
    assert.equal(m.update(pen, 256, 0, 'amp'), false);
    assert.equal(m.coefs.length, 256);
    assert.equal(m.effective(10).length, 10);
    assert.ok(m.rms(40) < m.rms(5));
    close(m.rms(256), 0, 1e-9);
    const k0 = m.coefs[0].k;
    m.toggle(k0, 10);
    assert.equal(m.effective(10).length, 9);
    assert.equal(m.isKept(k0, 10), false);
    m.toggle(k0, 10);
    assert.equal(m.effective(10).length, 10);
    const outside = m.coefs[100].k; // not in the first 10: toggling forces it on
    m.toggle(outside, 10);
    assert.equal(m.effective(10).length, 11);
    m.update(pen, 256, 0, 'freq'); // reordering keeps the overrides
    assert.equal(m.overrides.size, 2);
    pen.clear();
    m.update(pen, 256, 0, 'freq');
    assert.equal(m.coefs.length, 0);
    assert.equal(m.rms(5), 0);
    assert.equal(m.partial(5, 8).length, 8);
});

test('layouts: curve spectrum hit-test and image cells do not overlap or leave the canvas', () => {
    const L = curveLayout(1000, 600, true);
    assert.ok(L.spec && L.main.y + L.main.h <= L.spec.y);
    const W = 40;
    const bw = (L.spec.w - 16) / (2 * W + 1);
    assert.equal(spectrumHit(L, 512, W, L.spec.x + 8 + (W + 0.5) * bw, L.spec.y + 20), 0);
    assert.equal(spectrumHit(L, 512, W, L.spec.x + 8 + (W + 2.5) * bw, L.spec.y + 20), 2);
    assert.equal(spectrumHit(L, 512, W, L.main.x + 10, L.main.y + 10), null);
    assert.equal(curveLayout(1000, 600, false).spec, null);
    for (const [w, h, err] of [[1200, 700, true], [400, 900, true], [900, 300, false], [200, 200, true]]) {
        const lay = imageLayout(w, h, err);
        const cells = Object.values(lay.cells);
        assert.equal(cells.length, err ? 4 : 3);
        for (const c of cells) {
            assert.ok(c.x >= 0 && c.y >= 0 && c.s >= 16, `${w}x${h}`);
        }
        for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
            const a = cells[i], b = cells[j];
            const overlap = a.x < b.x + b.s && b.x < a.x + a.s && a.y < b.y + b.s && b.y < a.y + a.s;
            assert.ok(!overlap, `${w}x${h} ${a.name}/${b.name}`);
        }
        assert.equal(hitCell(lay, cells[0].x + 1, cells[0].y + 1), cells[0].name);
        assert.equal(hitCell(lay, -5, -5), null);
    }
});
