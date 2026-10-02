import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../lib/complex.js';
import { complexAlg } from '../../lib/algebra.js';
import {
    derivative, angleBetweenImages, circleImage, moebiusFrom3, applyMoebius, moebiusDerivative, crossRatio,
    circleFrom3Points, moebiusCircle, polyFromRoots, evalPoly, polyRoots, criticalPoints, joukowskiStreamline,
    sampleCurve, breakPolyline, gridLines,
} from '../../lib/conformal.js';
import { closeC, close } from './helpers.js';

const sq = (A, x) => A.mul(x, x);
const inv = (A, x) => A.div(A.const(1), x);
const BOX = { xmin: -4, xmax: 4, ymin: -4, ymax: 4 };

test('derivative matches analytic formulas', () => {
    closeC(derivative(sq, [1, 2]), [2, 4], 1e-12);
    closeC(derivative(inv, [0, 1]), C.neg(C.div([1, 0], C.mul([0, 1], [0, 1]))), 1e-12);
    closeC(derivative((A, x) => A.exp(x), [0.3, 0.4]), C.exp([0.3, 0.4]), 1e-12);
    closeC(derivative((A, x) => A.sin(x), [0.3, 0.4]), C.cos([0.3, 0.4]), 1e-12);
    assert.ok(Number.isNaN(derivative(inv, [0, 0])[0]));
});

test('conformal maps preserve the right angle; critical points double it', () => {
    const F = (z) => complexAlg.exp(z);
    close(angleBetweenImages(F, [0.3, 0.2], [1, 0], [0, 1]), Math.PI / 2, 1e-4);
    const G = (z) => C.mul(z, z);
    close(angleBetweenImages(G, [0, 0], [1, 0], [0, 1], 1e-3), Math.PI, 1e-9, 'angle doubling at z=0');
    close(angleBetweenImages(G, [1, 1], [1, 0], [0, 1]), Math.PI / 2, 1e-4);
    assert.ok(Number.isNaN(angleBetweenImages(() => [NaN, 0], [0, 0], [1, 0], [0, 1])));
});

test('image of a small circle is nearly a circle with centre near w0', () => {
    const F = (z) => C.sin(z);
    const r = circleImage(F, [0.5, 0.3], 0.01);
    assert.ok(r.roundness < 1.02, String(r.roundness));
    closeC(r.center, F([0.5, 0.3]), 1e-3);
});

test('moebius from 3 points maps them exactly, preserves cross-ratio and circles', () => {
    const zs = [[0, 0], [1, 0], [0, 2]];
    const ws = [[1, 1], [-1, 0.5], [3, -2]];
    const m = moebiusFrom3(zs, ws);
    for (let i = 0; i < 3; i++) closeC(applyMoebius(m, zs[i]), ws[i], 1e-12, `pt ${i}`);
    const p = [0.7, -0.3];
    const q = [-1.2, 0.8];
    const cr0 = crossRatio(zs[0], zs[1], p, q);
    closeC(crossRatio(applyMoebius(m, zs[0]), applyMoebius(m, zs[1]), applyMoebius(m, p), applyMoebius(m, q)), cr0, 1e-10);
    const circ = moebiusCircle(m, [0.2, 0.1], 0.7);
    assert.ok(circ.c && circ.r > 0);
    for (let k = 0; k < 20; k++) {
        const w = applyMoebius(m, C.add([0.2, 0.1], C.fromPolar(0.7, k * 0.3)));
        close(Math.hypot(w[0] - circ.c[0], w[1] - circ.c[1]), circ.r, 1e-9);
    }
    const h = 1e-6;
    const z = [0.4, 0.4];
    const fd = C.scale(C.sub(applyMoebius(m, C.add(z, [h, 0])), applyMoebius(m, z)), 1 / h);
    closeC(moebiusDerivative(m, z), fd, 1e-4);
    assert.equal(moebiusFrom3([[0, 0], [0, 0], [1, 1]], ws), null);
});

test('circle through 3 points and collinear fallback', () => {
    const c = circleFrom3Points([1, 0], [0, 1], [-1, 0]);
    closeC(c.c, [0, 0], 1e-12);
    close(c.r, 1, 1e-12);
    assert.ok(circleFrom3Points([0, 0], [1, 1], [2, 2]).line);
    const m = moebiusFrom3([[1, 0], [2, 0], [3, 0]], [[1, 0], [0.5, 0], [1 / 3, 0]]);
    closeC(applyMoebius(m, [4, 0]), [0.25, 0], 1e-12);
});

test('polynomial from roots, evaluation, root finding and critical points', () => {
    const roots = [[1, 0], [-1, 0], [0, 2], [0.5, -0.5]];
    const coef = polyFromRoots(roots);
    for (const r of roots) closeC(evalPoly(coef, r).p, [0, 0], 1e-12);
    const found = polyRoots(coef);
    for (const r of roots) assert.ok(found.some((f) => C.abs(C.sub(f, r)) < 1e-9));
    const crit = criticalPoints(roots);
    assert.equal(crit.length, 3);
    for (const c of crit) closeC(evalPoly(coef, c).dp, [0, 0], 1e-9);
    closeC(criticalPoints([[1, 0], [-1, 0]])[0], [0, 0], 1e-9);
});

test('joukowski streamlines stay outside the circle and satisfy psi = k', () => {
    const c = [-0.1, 0.1];
    const r = Math.hypot(1 - c[0], c[1]);
    for (const k of [0.3, -0.6, 1.5]) {
        const s = joukowskiStreamline(c, r, k);
        for (let i = 0; i <= 20; i++) {
            const d = C.sub(s(i / 20), c);
            assert.ok(C.abs(d) >= r - 1e-9);
            close(C.add(d, C.div([r * r, 0], d))[1], k, 1e-9);
        }
    }
    close(C.abs(C.sub(joukowskiStreamline(c, r, 0)(0.3), c)), r, 1e-12);
});

test('sampleCurve is adaptive and breaks at the pole of 1/z', () => {
    const polys = sampleCurve((t) => (t === 0 ? [Infinity, 0] : C.div([1, 0], [t, 0])), -2, 2, { box: BOX, n: 40 });
    assert.ok(polys.length >= 2, 'broken at the pole');
    for (const pl of polys) assert.ok(pl.every((q) => q[0] > 0) || pl.every((q) => q[0] < 0));
    const circ = sampleCurve((t) => [Math.cos(t), Math.sin(t)], 0, 2 * Math.PI, { box: BOX, n: 8 });
    assert.equal(circ.length, 1);
    assert.ok(circ[0].length > 20);
    for (const q of circ[0]) close(Math.hypot(q[0], q[1]), 1, 1e-12);
});

test('sampleCurve breaks at the log branch cut and survives NaN', () => {
    const polys = sampleCurve((t) => C.log([-1, t]), -1, 1, { box: BOX });
    assert.ok(polys.length >= 2);
    assert.ok(!polys.some((pl) => pl.some((q, i) => i && Math.abs(q[1] - pl[i - 1][1]) > 3)), 'no line across the cut');
    assert.deepEqual(sampleCurve(() => [NaN, NaN], 0, 1, { box: BOX }), []);
});

test('sampleCurve respects the evaluation budget', () => {
    let calls = 0;
    sampleCurve((t) => { calls++; return [Math.sin(1e4 * t), Math.cos(1e4 * t)]; }, 0, 1, { box: BOX, maxEvals: 2000 });
    assert.ok(calls < 4000, String(calls));
});

test('breakPolyline splits at NaN, huge values and jumps', () => {
    const pts = [[0, 0], [1, 0], [NaN, 0], [2, 0], [3, 0], [3, 100], [3, 101]];
    assert.equal(breakPolyline(pts, 10, 1e6).length, 3);
    assert.equal(breakPolyline([[0, 0], [1e9, 0]], Infinity, 1e6).length, 0);
});

test('gridLines: rectangular, polar, counts scale with density', () => {
    const view = { xmin: -3, xmax: 3, ymin: -2, ymax: 2 };
    const rect = gridLines('rect', 10, view);
    assert.ok(rect.some((l) => l.fam === 0) && rect.some((l) => l.fam === 1));
    for (const l of rect) {
        const a = l.at(l.t0);
        const b = l.at(l.t1);
        assert.ok(Number.isFinite(a[0] + a[1] + b[0] + b[1]));
    }
    const polar = gridLines('polar', 10, view);
    for (const l of polar.filter((q) => q.fam === 0)) close(Math.hypot(...l.at(1.0)), l.value, 1e-12);
    assert.equal(gridLines('both', 10, view).length, rect.length + polar.length);
    assert.ok(gridLines('rect', 30, view).length > rect.length);
    assert.deepEqual(gridLines('rect', 10, { xmin: 0, xmax: 0, ymin: 0, ymax: 1 }), []);
});
