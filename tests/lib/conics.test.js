import test from 'node:test';
import assert from 'node:assert/strict';
import {
    conicFromCircle, conicFromHyperbola, conicFromParabola, conicFromGeneral, evalConic, conicCentre,
    ellipsePoint, ellipseAngle, tangentPointsFrom, secondIntersection, lineConicIntersect, conicFromEllipseParams,
    chainClosure, isClosed, closedAfter, rotationNumber, innerInside, cayleyCoefficients, cayleyDeterminant, cayleyTable,
    eulerCheck, fussQuadrilateralDefect, solveClosure, adjustInner, detN,
} from '../../lib/conics.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} vs ${b}`);
function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const circ = (cx, cy, r) => ({ cx, cy, a: r, b: r, rot: 0 });

test('constructors: points lie on their conics', () => {
    const e = { cx: 1, cy: -2, a: 3, b: 1.5, rot: 0.7 };
    const M = conicFromEllipseParams(e);
    for (let t = 0; t < 6.3; t += 0.4) {
        const P = ellipsePoint(e, t);
        near(evalConic(M, P[0], P[1]), 0, 1e-12);
        near(Math.cos(ellipseAngle(e, ...P)), Math.cos(t), 1e-12);
    }
    near(evalConic(conicFromCircle(1, 2, 3), 4, 2), 0);
    near(evalConic(conicFromHyperbola(0, 0, 2, 1, 0), 2 * Math.cosh(0.5), Math.sinh(0.5)), 0, 1e-12);
    near(evalConic(conicFromParabola(1, 1, 0.5, 0), 1 + 2, 1 + 2), 0, 1e-12);
    near(evalConic(conicFromGeneral(1, 0, 1, 0, 0, -4), 2, 0), 0);
    const c = conicCentre(M);
    near(c[0], 1); near(c[1], -2);
    assert.equal(conicCentre(conicFromParabola(0, 0, 1, 0)), null);
});

test('tangents from external point, none from inside, line intersections', () => {
    const D = conicFromCircle(0, 0, 1);
    const ts = tangentPointsFrom(D, [3, 0]);
    assert.equal(ts.length, 2);
    for (const T of ts) { near(Math.hypot(...T), 1); near(T[0], 1 / 3); }
    assert.equal(tangentPointsFrom(D, [0.3, 0.2]).length, 0);
    assert.equal(lineConicIntersect(D, [0, 1, -2]).length, 0);
    assert.equal(lineConicIntersect(D, [1, 0, -0.5]).length, 2);
    const C = conicFromCircle(0, 0, 2);
    const Q = secondIntersection(C, [2, 0], [0, 2]);
    near(Q[0], 0); near(Q[1], 2);
    near(secondIntersection(C, [2, 0], [-1, 0])[0], -2);
});

test('concentric circles: regular polygons close, rotation number m/n', () => {
    for (let n = 3; n <= 12; n++) {
        const outer = circ(0, 0, 3), inner = circ(0, 0, 3 * Math.cos(Math.PI / n));
        const r = chainClosure(outer, inner, 0.3, n);
        assert.ok(r.ok && r.residual < 1e-9, `n=${n} ${r.residual}`);
        near(r.winding, 1, 1e-9);
        near(rotationNumber(outer, inner, 0.3, 120), 1 / n, 1e-9);
    }
    const star = chainClosure(circ(0, 0, 3), circ(0, 0, 3 * Math.cos(2 * Math.PI / 5)), 0, 5);
    assert.ok(star.residual < 1e-9);
    near(star.winding, 2, 1e-9);
});

test('non-real tangents are handled gracefully', () => {
    const outer = circ(0, 0, 2), inner = circ(0, 0, 3);
    const r = chainClosure(outer, inner, 0, 5);
    assert.equal(r.ok, false);
    assert.ok(Number.isNaN(r.residual));
    assert.equal(innerInside(outer, inner), false);
    assert.equal(isClosed(outer, inner, 0, 5), false);
    assert.equal(closedAfter(outer, inner, 0), null);
    assert.ok(Number.isNaN(rotationNumber(outer, inner)));
    assert.doesNotThrow(() => solveClosure(outer, inner, { n: 3 }));
});

test('Euler: triangle closes iff d^2 = R^2 - 2Rr; Cayley A2 vanishes exactly there', () => {
    const rnd = rng(5);
    for (let k = 0; k < 30; k++) {
        const R = 2 + 3 * rnd(), d = rnd() * R * 0.6, r = (R * R - d * d) / (2 * R);
        const outer = circ(0, 0, R), inner = circ(d, 0, r);
        assert.ok(innerInside(outer, inner));
        near(eulerCheck(R, r, d).defect, 0, 1e-12);
        for (const t0 of [0, 1.1, 4]) assert.ok(chainClosure(outer, inner, t0, 3).residual < 1e-9);
        const C = conicFromCircle(0, 0, R), D = conicFromCircle(d, 0, r);
        assert.ok(Math.abs(cayleyDeterminant(C, D, 3)) < 1e-9, `${cayleyDeterminant(C, D, 3)}`);
        const D2 = conicFromCircle(d, 0, r * 0.9);
        assert.ok(Math.abs(cayleyDeterminant(C, D2, 3)) > 1e-4);
        assert.ok(chainClosure(outer, circ(d, 0, r * 0.9), 0, 3).residual > 1e-3);
    }
});

test('Fuss quadrilateral condition agrees with closure and Cayley n=4', () => {
    const R = 3, d = 0.8;
    const r = 1 / Math.sqrt(1 / ((R - d) ** 2) + 1 / ((R + d) ** 2));
    near(fussQuadrilateralDefect(R, r, d), 0, 1e-12);
    const outer = circ(0, 0, R), inner = circ(d, 0, r);
    for (const t0 of [0, 2, 5]) assert.ok(chainClosure(outer, inner, t0, 4).residual < 1e-9);
    const C = conicFromCircle(0, 0, R), D = conicFromCircle(d, 0, r);
    assert.ok(Math.abs(cayleyDeterminant(C, D, 4)) < 1e-9);
    assert.ok(Math.abs(cayleyDeterminant(C, conicFromCircle(d, 0, r * 1.1), 4)) > 1e-5);
});

test('Cayley determinants vanish for solved pairs, n = 3..12, circles and ellipses', () => {
    const cases = [
        [circ(0, 0, 4), circ(0.7, 0.2, 1)],
        [{ cx: 0, cy: 0, a: 5, b: 4.4, rot: 0.4 }, { cx: 0.15, cy: -0.05, a: 1.2, b: 1.2, rot: 0 }],
        [{ cx: 1, cy: 1, a: 5, b: 4, rot: 1 }, { cx: 1.1, cy: 1.0, a: 1.2, b: 1, rot: 0.2 }],
    ];
    for (const [outer, inner] of cases) {
        for (let n = 3; n <= 12; n++) {
            const s = solveClosure(outer, inner, { n, param: 'scale', t0: 0.3 });
            assert.ok(s.ok, `n=${n} not solved`);
            const C = conicFromEllipseParams(outer), D = conicFromEllipseParams(s.inner);
            const v = cayleyTable(C, D, 12).find((q) => q.n === n).value;
            assert.ok(Math.abs(v) < 1e-7, `n=${n} cayley ${v}`);
        }
    }
});

test('Cayley coefficients: det(tC+D) is cubic so the sqrt series squares back', () => {
    const C = conicFromCircle(0, 0, 2), D = conicFromCircle(0.3, 0.1, 0.8);
    const A = cayleyCoefficients(C, D, 6);
    assert.ok(A[0] > 0 && A.every(Number.isFinite));
    const sq = (k) => A.slice(0, k + 1).reduce((s, v, j) => s + v * A[k - j], 0);
    assert.ok(Math.abs(sq(4)) < 1e-12 && Math.abs(sq(5)) < 1e-12);
    assert.equal(detN([]), 1);
});

test('solver: closes for many random configs and is independent of the start point', () => {
    const rnd = rng(11);
    let solved = 0;
    for (let k = 0; k < 120; k++) {
        const a = 3 + 3 * rnd(), outer = { cx: 0, cy: 0, a, b: a * (k % 2 ? 1 : 0.5 + 0.5 * rnd()), rot: rnd() * 3 };
        const inner = { cx: (rnd() - 0.5) * a * 0.4, cy: (rnd() - 0.5) * a * 0.4, a: a * 0.25, b: a * 0.25 * (k % 3 ? 1 : 0.6), rot: rnd() * 3 };
        const n = 3 + Math.floor(rnd() * 10);
        const param = k % 4 === 3 ? 'offset' : 'scale';
        const s = solveClosure(outer, inner, { n, param, t0: rnd() * 6 });
        if (!s.ok) continue;
        solved++;
        for (let j = 0; j < 4; j++) {
            const r = chainClosure(outer, s.inner, rnd() * 6.28, n);
            assert.ok(r.ok && r.residual < 1e-6, `k=${k} n=${n} ${param} residual ${r.residual}`);
        }
        const nm = closedAfter(outer, s.inner, 0.1, 60, 1e-6);
        assert.ok(nm && nm.n <= n && n % nm.n === 0, `closed after ${nm && nm.n}`);
    }
    assert.ok(solved > 80, `solved only ${solved}`);
});

test('solver supports stars (m = 2) and rejects impossible requests', () => {
    const outer = circ(0, 0, 4), inner = circ(0.5, 0, 1);
    const s = solveClosure(outer, inner, { n: 5, m: 2 });
    assert.ok(s.ok);
    near(chainClosure(outer, s.inner, 1, 5).winding, 2, 1e-6);
    assert.equal(solveClosure(outer, inner, { n: 4, m: 2 }).ok, false);
    assert.equal(solveClosure(outer, inner, { n: 2 }).ok, false);
    near(adjustInner(outer, circ(1, 0, 1), 'offset', 0.5).cx, 1.5);
});
