import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../lib/polygon-area.js';

// deterministic RNG
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Random simple (star-shaped, possibly concave) polygon with n vertices. */
function randomPolygon(n, r) {
    return Array.from({ length: n }, (_, k) => {
        const rad = 3 + r() * 5;
        const aa = ((k + 0.15 + r() * 0.7) / n) * Math.PI * 2;
        return { x: 10 + rad * Math.cos(aa), y: 7 + rad * Math.sin(aa) };
    });
}

const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('signed area, centroid', () => {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
    near(G.signedArea(sq), 4);
    near(G.signedArea([...sq].reverse()), -4);
    near(G.area([...sq].reverse()), 4);
    const c = G.centroid(sq);
    near(c.x, 1);
    near(c.y, 1);
    const tri = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 3 }];
    near(G.centroid(tri).x, 2);
    near(G.centroid(tri).y, 1);
});

test('slideConstraint: parallel to the chord of the neighbours, through the vertex', () => {
    const tri = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 3, y: 5 }];
    const l = G.slideConstraint(tri, 2);
    assert.deepEqual(l.point, { x: 3, y: 5 });
    near(Math.abs(l.dir.x), 1);
    near(l.dir.y, 0);
    const p = G.projectOnLine(l, { x: 7, y: 100 });
    near(p.x, 7);
    near(p.y, 5);
});

test('slideVertex preserves area for random polygons and every vertex', () => {
    const r = rng(1);
    for (let k = 0; k < 200; k++) {
        const n = 3 + Math.floor(r() * 6);
        const poly = randomPolygon(n, r);
        const A = G.signedArea(poly);
        const i = Math.floor(r() * n);
        const moved = G.slideVertex(poly, i, { x: r() * 40 - 10, y: r() * 40 - 10 });
        near(G.signedArea(moved), A, 1e-9, `n=${n} i=${i}`);
        assert.equal(moved.length, n);
    }
});

test('clipLineToBox', () => {
    const line = { point: { x: 5, y: 5 }, dir: { x: 1, y: 0 } };
    const [a, b] = G.clipLineToBox(line, { xmin: 0, xmax: 10, ymin: 0, ymax: 10 });
    near(a, -5);
    near(b, 5);
    assert.equal(G.clipLineToBox({ point: { x: 5, y: 50 }, dir: { x: 1, y: 0 } }, { xmin: 0, xmax: 10, ymin: 0, ymax: 10 }), null);
});

test('isSimple', () => {
    assert.equal(G.isSimple([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), true);
    assert.equal(G.isSimple([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }]), false); // bow-tie
    assert.equal(G.isSimple([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }]), false); // fold-back
    const concave = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 3, y: 2 }, { x: 0, y: 6 }];
    assert.equal(G.isSimple(concave), true);
});

test('reduceStep removes exactly one vertex and keeps the area (convex and concave)', () => {
    const convex = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 4 }, { x: 4, y: 7 }, { x: -1, y: 4 }];
    const concave = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6 }, { x: 3, y: 2 }, { x: 0, y: 6 }];
    for (const poly of [convex, concave]) {
        const s = G.reduceStep(poly);
        assert.equal(s.polygon.length, poly.length - 1);
        near(G.signedArea(s.polygon), G.signedArea(poly), 1e-9);
        assert.equal(s.slid.length, poly.length);
        near(G.signedArea(s.slid), G.signedArea(poly), 1e-9);
        assert.ok(s.rationale.length > 10);
        assert.equal(s.simple, true);
        // the moved vertex moved along the parallel line
        const line = G.slideConstraint(poly, s.moved.index);
        const d = { x: s.moved.to.x - s.moved.from.x, y: s.moved.to.y - s.moved.from.y };
        near(d.x * line.dir.y - d.y * line.dir.x, 0, 1e-9);
    }
});

test('reduceStep drops a vertex that is already collinear', () => {
    const poly = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }];
    const s = G.reduceStep(poly);
    assert.equal(s.polygon.length, 3);
    near(G.area(s.polygon), 6);
});

test('random pentagon..octagon reduce to a triangle with the same area', () => {
    const r = rng(7);
    let simpleSteps = 0;
    let total = 0;
    for (let k = 0; k < 300; k++) {
        const n = 5 + (k % 4);
        const poly = randomPolygon(n, r);
        assert.equal(G.isSimple(poly), true, 'test polygon must be simple');
        const A = G.signedArea(poly);
        const steps = G.reduceToTriangle(poly);
        assert.equal(steps.length, n - 3);
        assert.equal(steps[steps.length - 1].polygon.length, 3);
        let cur = poly;
        for (const s of steps) {
            near(G.signedArea(s.polygon), A, 1e-8, `n=${n}`);
            near(G.signedArea(s.slid), A, 1e-8);
            assert.equal(s.before.length, cur.length);
            cur = s.polygon;
            total++;
            if (s.simple) simpleSteps++;
        }
        for (const v of cur) assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
    }
    assert.ok(simpleSteps / total > 0.95, `only ${simpleSteps}/${total} steps kept the polygon simple`);
});

test('triangleToRectangle: every frame of every step has the same area; ends in a rectangle', () => {
    const r = rng(3);
    for (let k = 0; k < 40; k++) {
        const tri = [0, 1, 2].map(() => ({ x: r() * 10, y: r() * 10 }));
        const A = G.area(tri);
        if (A < 0.5) continue;
        const steps = G.triangleToRectangle(tri);
        assert.equal(steps.length, 3);
        for (const s of steps) {
            for (const t of [0, 0.25, 0.5, 0.75, 1]) near(G.areaOf(s.at(t)), A, 1e-9, `${s.id}@${t}`);
            assert.ok(s.caption.length > 5);
        }
        const rect = steps[2].result;
        near(G.area(rect), A, 1e-9);
        for (let i = 0; i < 4; i++) {
            const a = rect[i];
            const b = rect[(i + 1) % 4];
            const c = rect[(i + 2) % 4];
            near((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y), 0, 1e-8);
        }
        const par = steps[1].result;
        near(par[0].x + par[2].x, par[1].x + par[3].x, 1e-9);
        near(par[0].y + par[2].y, par[1].y + par[3].y, 1e-9);
        near(G.area(par), A, 1e-9);
    }
});

test('rectangleToSquare: square side is sqrt(area), F on the circle, areas conserved', () => {
    const rect = [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 4 }, { x: 1, y: 4 }];
    const A = G.area(rect);
    const steps = G.rectangleToSquare(rect);
    for (const s of steps) {
        for (const t of [0, 0.5, 1]) near(G.areaOf(s.at(t)), A, 1e-9, `${s.id}@${t}`);
    }
    const info = steps[0].info;
    near(info.side, Math.sqrt(A));
    near(Math.hypot(info.F.x - info.O.x, info.F.y - info.O.y), info.r, 1e-9);
    const sq = steps[steps.length - 1].result;
    near(G.area(sq), A, 1e-9);
    near(Math.hypot(sq[1].x - sq[0].x, sq[1].y - sq[0].y), Math.sqrt(A), 1e-9);
    const th = 0.7;
    const rot = rect.map((p) => ({ x: p.x * Math.cos(th) - p.y * Math.sin(th), y: p.x * Math.sin(th) + p.y * Math.cos(th) }));
    near(G.rectangleToSquare(rot)[0].info.side, Math.sqrt(A), 1e-9);
});

test('quadratureSteps chains triangle -> rectangle -> square with constant area', () => {
    const tri = [{ x: 4, y: 3 }, { x: 12, y: 3 }, { x: 9, y: 9 }];
    const steps = G.quadratureSteps(tri);
    assert.equal(steps.length, 8);
    for (const s of steps) for (const t of [0, 0.5, 1]) near(G.areaOf(s.at(t)), 24, 1e-9, `${s.id}@${t}`);
    near(G.area(steps[steps.length - 1].result), 24, 1e-9);
    assert.equal(steps.filter((s) => s.final).length, 1);
});

test("Pick's theorem and lattice points", () => {
    const tri = [{ x: 4, y: 3 }, { x: 12, y: 3 }, { x: 9, y: 9 }];
    const p = G.pickInfo(tri);
    assert.equal(p.area, 24);
    const pts = G.latticePoints(tri);
    assert.equal(pts.boundary.length, p.boundary);
    assert.equal(pts.interior.length, p.interior);
    near(pts.interior.length + pts.boundary.length / 2 - 1, 24);
    assert.equal(G.pickInfo([{ x: 0.5, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }]), null);
    assert.equal(G.gcd(12, -18), 6);
    assert.deepEqual(G.primitiveStep([{ x: 0, y: 0 }, { x: 4, y: 2 }, { x: 6, y: 6 }], 1), { x: 1, y: 1 });
});
