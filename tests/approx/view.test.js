import test from 'node:test';
import assert from 'node:assert/strict';
import { Viewport, niceTicks, fmtTick } from '../../sketches/approx/view.js';

test('coordinate round trip and y orientation', () => {
    const v = new Viewport(-2, 2, -1, 1).setRect(10, 20, 400, 200);
    assert.equal(v.toX(-2), 10);
    assert.equal(v.toX(2), 410);
    assert.equal(v.toY(1), 20);
    assert.equal(v.toY(-1), 220);
    assert.ok(Math.abs(v.fromX(v.toX(0.7)) - 0.7) < 1e-12);
    assert.ok(Math.abs(v.fromY(v.toY(-0.3)) + 0.3) < 1e-12);
});

test('zoomAt keeps the anchor fixed and refuses degenerate spans', () => {
    const v = new Viewport(-2, 2, -1, 1).setRect(0, 0, 400, 200);
    const x = v.fromX(100), y = v.fromY(50);
    v.zoomAt(100, 50, 0.5);
    assert.ok(Math.abs(v.fromX(100) - x) < 1e-12 && Math.abs(v.fromY(50) - y) < 1e-12);
    for (let i = 0; i < 200; i++) v.zoomAt(100, 50, 0.1);
    assert.ok(v.xmax - v.xmin > 1e-10 && Number.isFinite(v.xmin));
    for (let i = 0; i < 400; i++) v.zoomAt(100, 50, 10);
    assert.ok(v.xmax - v.xmin < 1e10 && Number.isFinite(v.xmax));
});

test('lockAspect makes pixels square, panPx moves the view', () => {
    const v = new Viewport(-2, 2, -9, 9).setRect(0, 0, 400, 200).lockAspect();
    assert.ok(Math.abs((v.xmax - v.xmin) / 400 - (v.ymax - v.ymin) / 200) < 1e-12);
    const x0 = v.xmin;
    v.panPx(40, 0);
    assert.ok(v.xmin < x0);
});

test('niceTicks / fmtTick', () => {
    assert.deepEqual(niceTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
    assert.deepEqual(niceTicks(0, 0, 5), []);
    assert.equal(fmtTick(0), '0');
    assert.equal(fmtTick(0.5), '0.5');
    assert.equal(fmtTick(1e6), '1e+6');
});
