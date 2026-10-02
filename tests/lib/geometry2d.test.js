import test from 'node:test';
import assert from 'node:assert/strict';
import {
    homothetyCenters, externalDirection, commonTangents, lineThrough, lineIntersection, lineDistance,
    collinearityResidual, signedArea, fitLine, radicalAxis, mongeData, mongeLine, collinearTriples, clipLine, dist,
} from '../../lib/geometry2d.js';

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
const randCircle = (r) => ({ x: (r() - 0.5) * 20, y: (r() - 0.5) * 20, r: 0.3 + r() * 5 });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('homothety centres: basic values and degenerate cases', () => {
    const h = homothetyCenters({ x: 0, y: 0, r: 1 }, { x: 6, y: 0, r: 2 });
    near(h.external[0], -6, 1e-12); near(h.external[1], 0, 1e-12);
    near(h.internal[0], 2, 1e-12);
    const eq = homothetyCenters({ x: 0, y: 0, r: 1 }, { x: 3, y: 4, r: 1 });
    assert.equal(eq.external, null);
    assert.deepEqual(eq.internal, [1.5, 2]);
    const dir = externalDirection({ x: 0, y: 0, r: 1 }, { x: 3, y: 4, r: 1 });
    near(dir[0], 0.6, 1e-12); near(dir[1], 0.8, 1e-12);
    assert.equal(externalDirection({ x: 0, y: 0, r: 1 }, { x: 3, y: 4, r: 2 }), null);
    const same = homothetyCenters({ x: 1, y: 1, r: 2 }, { x: 1, y: 1, r: 2 });
    assert.equal(same.external, null); assert.equal(same.internal, null);
});

test('tangent counts for every configuration', () => {
    const cnt = (a, b, kind) => commonTangents(a, b).filter((t) => !kind || t.kind === kind).length;
    const A = { x: 0, y: 0, r: 2 };
    assert.equal(cnt(A, { x: 10, y: 0, r: 1 }), 4); // separate
    assert.equal(cnt(A, { x: 3, y: 0, r: 1 }, 'external'), 2); // externally tangent: 3 lines
    assert.equal(cnt(A, { x: 3, y: 0, r: 1 }), 3);
    assert.equal(cnt(A, { x: 2, y: 0, r: 1.5 }), 2); // intersecting
    assert.equal(cnt(A, { x: 1, y: 0, r: 1 }), 1); // internally tangent
    assert.equal(cnt(A, { x: 0.5, y: 0, r: 1 }), 0); // nested
    assert.equal(cnt(A, { x: 0, y: 0, r: 1 }), 0); // concentric
    assert.equal(cnt(A, A), 0); // coincident
    assert.equal(cnt({ x: 0, y: 0, r: 1 }, { x: 5, y: 0, r: 1 }), 4); // equal radii
    assert.equal(cnt({ x: 0, y: 0, r: 1 }, { x: 5, y: 0, r: 1 }, 'external'), 2);
});

test('tangent points lie on the circles and radii are perpendicular to the lines', () => {
    const r = rng(7);
    for (let k = 0; k < 500; k++) {
        const c1 = randCircle(r), c2 = randCircle(r);
        for (const t of commonTangents(c1, c2)) {
            near(dist(t.p1, [c1.x, c1.y]), c1.r, 1e-9 * (1 + c1.r), 'on c1');
            near(dist(t.p2, [c2.x, c2.y]), c2.r, 1e-9 * (1 + c2.r), 'on c2');
            near(lineDistance(t.line, t.p1), 0, 1e-9, 'p1 on line');
            near(lineDistance(t.line, t.p2), 0, 1e-9, 'p2 on line');
            const rad = [(t.p1[0] - c1.x) / c1.r, (t.p1[1] - c1.y) / c1.r];
            near(Math.abs(rad[0] * t.line.nx + rad[1] * t.line.ny), 1, 1e-9, 'perpendicular');
            near(Math.abs(lineDistance(t.line, [c2.x, c2.y])), c2.r, 1e-9 * (1 + c2.r));
        }
    }
});

test('external tangents meet at the exsimilicenter; internal at the insimilicenter', () => {
    const r = rng(11);
    let seen = 0;
    for (let k = 0; k < 300; k++) {
        const c1 = randCircle(r), c2 = randCircle(r);
        const h = homothetyCenters(c1, c2);
        for (const kind of ['external', 'internal']) {
            const ts = commonTangents(c1, c2).filter((t) => t.kind === kind);
            if (ts.length !== 2) continue;
            const p = lineIntersection(ts[0].line, ts[1].line);
            const e = kind === 'external' ? h.external : h.internal;
            assert.ok(p && e);
            near(p[0], e[0], 1e-6 * (1 + Math.abs(e[0])), kind);
            near(p[1], e[1], 1e-6 * (1 + Math.abs(e[1])), kind);
            seen++;
        }
    }
    assert.ok(seen > 100);
});

test('Monge: external centres collinear to 1e-9, plus the three mixed triples', () => {
    const r = rng(2024);
    let checked = 0;
    for (let k = 0; k < 2000; k++) {
        const cs = [randCircle(r), randCircle(r), randCircle(r)];
        const d = mongeData(cs);
        for (const tri of collinearTriples(d)) {
            if (tri.pts.some((q) => !q)) continue;
            const m = Math.max(...tri.pts.map((q) => Math.abs(q[0]) + Math.abs(q[1])));
            if (m > 1e5) continue; // nearly equal radii: precision loss is expected
            assert.ok(collinearityResidual(...tri.pts) < 1e-9, `${tri.name} ${collinearityResidual(...tri.pts)}`);
            checked++;
        }
        const ml = mongeLine(d);
        if (ml && ml.residual) assert.ok(ml.residual < 1e-6);
    }
    assert.ok(checked > 6000);
});

test('equal radii: external centre at infinity, Monge line parallel to the line of centres', () => {
    const cs = [{ x: 0, y: 0, r: 1 }, { x: 4, y: 1, r: 1 }, { x: 1, y: 5, r: 2.5 }];
    const d = mongeData(cs);
    assert.equal(d.E[0], null);
    assert.ok(d.dir[0]);
    const ml = mongeLine(d);
    const dirLine = [-ml.line.ny, ml.line.nx];
    near(Math.abs(dirLine[0] * d.dir[0][1] - dirLine[1] * d.dir[0][0]), 0, 1e-12);
    const same = mongeData([{ x: 0, y: 0, r: 1 }, { x: 4, y: 1, r: 1 }, { x: 1, y: 5, r: 1 }]);
    assert.equal(mongeLine(same), null);
    const t = collinearTriples(d)[2]; // E13 I12 I23
    assert.ok(collinearityResidual(...t.pts) < 1e-12);
});

test('lines, residual, area, fitLine, radical axis, clipLine', () => {
    const l = lineThrough([0, 0], [2, 2]);
    near(lineDistance(l, [5, 5]), 0, 1e-12);
    const m = lineThrough([0, 4], [4, 0]);
    const p = lineIntersection(l, m);
    near(p[0], 2, 1e-12); near(p[1], 2, 1e-12);
    assert.equal(lineIntersection(l, lineThrough([0, 1], [1, 2])), null);
    assert.equal(lineThrough([1, 1], [1, 1]), null);
    near(signedArea([0, 0], [1, 0], [0, 1]), 0.5, 1e-15);
    near(collinearityResidual([0, 0], [1, 1], [3, 3]), 0, 1e-15);
    near(collinearityResidual([0, 0], [1e6, 0], [0, 1e6]), collinearityResidual([0, 0], [1, 0], [0, 1]), 1e-12);
    assert.equal(collinearityResidual([1, 1], [1, 1], [1, 1]), 0);
    const f = fitLine([[0, 1], [1, 3], [2, 5], [3, 7]]);
    near(f.rms, 0, 1e-12);
    assert.equal(fitLine([[1, 1]]), null);
    const ra = radicalAxis({ x: 0, y: 0, r: 2 }, { x: 4, y: 0, r: 2 });
    near(lineDistance(ra, [2, 17]), 0, 1e-12);
    assert.equal(radicalAxis({ x: 1, y: 1, r: 2 }, { x: 1, y: 1, r: 3 }), null);
    const c = clipLine(lineThrough([0, 0], [1, 1]), -5, 5, -3, 3);
    near(Math.abs(c[1][0]), 3, 1e-12); near(c[0][0], -c[1][0], 1e-12);
    assert.equal(clipLine(lineThrough([0, 10], [1, 10]), -5, 5, -3, 3), null);
});
