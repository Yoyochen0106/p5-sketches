import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/elliptic.js';
import { close, closeC, rng } from './helpers.js';

const { INF } = E;

const cabs = (z) => Math.hypot(z[0], z[1]);
const mulc = (u, v) => [u[0] * v[0] - u[1] * v[1], u[0] * v[1] + u[1] * v[0]];
const sub = (u, v) => [u[0] - v[0], u[1] - v[1]];
const scl = (u, s) => [u[0] * s, u[1] * s];
const divc = (u, v) => {
    const d = v[0] * v[0] + v[1] * v[1];
    return [(u[0] * v[0] + u[1] * v[1]) / d, (u[1] * v[0] - u[0] * v[1]) / d];
};

function randomPoint(a, b, r, range = 6) {
    for (let i = 0; i < 1000; i++) {
        const x = (r() - 0.5) * 2 * range;
        const P = E.pointAtX(a, b, x, r() < 0.5 ? 1 : -1);
        if (P) return P;
    }
    throw new Error('no point');
}

const same = (P, Q, tol = 1e-7) => (E.isInf(P) ? E.isInf(Q) : !E.isInf(Q) && Math.abs(P.x - Q.x) < tol && Math.abs(P.y - Q.y) < tol);

test('discriminant and classification', () => {
    close(E.discriminant(-1, 0), -16 * -4);
    assert.equal(E.classify(-1, 0), 'smooth');
    assert.equal(E.classify(0, 0), 'cusp');
    assert.equal(E.classify(-3, 2), 'node');
    assert.equal(E.classify(-3, -2), 'node');
    assert.equal(E.classify(0, 1), 'smooth');
    assert.equal(E.components(-1, 0), 2);
    assert.equal(E.components(0, 1), 1);
    assert.equal(E.components(-3, 2), 0);
    close(E.singularX(-3, 2), 1);
    close(E.singularX(-3, -2), -1);
});

test('real roots and 2-torsion', () => {
    const t = E.twoTorsion(-1, 0);
    assert.deepEqual(t.map((p) => Math.round(p.x)), [-1, 0, 1]);
    assert.equal(E.twoTorsion(0, 1).length, 1);
    close(E.twoTorsion(0, 1)[0].x, -1);
    const r = rng(3);
    for (let i = 0; i < 100; i++) {
        const a = (r() - 0.5) * 8, b = (r() - 0.5) * 8;
        for (const q of E.twoTorsion(a, b)) close(E.cubic(a, b, q.x), 0, 1e-9);
        if (E.classify(a, b) === 'smooth') assert.equal(E.twoTorsion(a, b).length, E.components(a, b) === 2 ? 3 : 1);
    }
});

test('group law: identity, inverse, commutativity, associativity on random points', () => {
    const r = rng(7);
    let n = 0;
    for (let k = 0; k < 60; k++) {
        const a = (r() - 0.5) * 6, b = (r() - 0.5) * 6;
        if (E.classify(a, b) !== 'smooth') continue;
        const [P, Q, R] = [randomPoint(a, b, r), randomPoint(a, b, r), randomPoint(a, b, r)];
        assert.ok(same(E.sumReal(a, b, P, INF), P));
        assert.ok(E.isInf(E.sumReal(a, b, P, E.negReal(P))));
        assert.ok(same(E.sumReal(a, b, P, Q), E.sumReal(a, b, Q, P)));
        const S = E.sumReal(a, b, P, Q);
        assert.ok(Math.abs(E.residual(a, b, S)) < 1e-6 * (1 + Math.abs(S.x) ** 3), 'sum on curve');
        const l = E.sumReal(a, b, S, R), rr = E.sumReal(a, b, P, E.sumReal(a, b, Q, R));
        assert.ok(same(l, rr, 1e-5 * (1 + Math.abs(l.x ?? 0))), `assoc ${JSON.stringify([l, rr])}`);
        n++;
    }
    assert.ok(n > 40);
});

test('construction geometry: chord, tangent, vertical', () => {
    const a = -2, b = 3;
    const P = E.pointAtX(a, b, 0.5), Q = E.pointAtX(a, b, 2, -1);
    const A = E.addReal(a, b, P, Q);
    assert.equal(A.kind, 'chord');
    for (const X of [P, Q, A.third]) close(X.y, A.line.m * X.x + A.line.c, 1e-9);
    close(E.residual(a, b, A.third), 0, 1e-9);
    assert.deepEqual([A.result.x, A.result.y], [A.third.x, -A.third.y]);
    const T = E.addReal(a, b, P, P);
    assert.equal(T.kind, 'tangent');
    close(T.line.m, (3 * P.x * P.x + a) / (2 * P.y));
    close(E.residual(a, b, T.third), 0, 1e-9);
    const V = E.addReal(a, b, P, E.negReal(P));
    assert.equal(V.kind, 'vertical');
    assert.ok(E.isInf(V.result) && E.isInf(V.third));
    assert.equal(V.line.type, 'vertical');
    const t = E.twoTorsion(a, b)[0];
    assert.ok(E.isInf(E.sumReal(a, b, t, t)));
    assert.equal(E.addReal(a, b, INF, INF).kind, 'identity');
});

test('y^2 = x^3 - x has torsion Z2 x Z2', () => {
    const [A, B, C] = E.twoTorsion(-1, 0);
    assert.ok(same(E.sumReal(-1, 0, A, B), C));
    assert.ok(same(E.sumReal(-1, 0, B, C), A));
    assert.ok(E.isInf(E.sumReal(-1, 0, A, A)));
    assert.equal(E.orderReal(-1, 0, A), 2);
});

test('y^2 = x^3 + 1: (2, 3) has order 6 with the known multiples', () => {
    const P = { x: 2, y: 3 };
    const m = E.multiplesReal(0, 1, P);
    assert.equal(m.length, 6);
    assert.ok(same(m[1].point, { x: 0, y: 1 }));
    assert.ok(same(m[2].point, { x: -1, y: 0 }));
    assert.ok(same(m[3].point, { x: 0, y: -1 }));
    assert.ok(same(m[4].point, { x: 2, y: -3 }));
    assert.ok(E.isInf(m[5].point));
    assert.equal(E.orderReal(0, 1, P), 6);
    assert.equal(E.orderReal(0, 1, E.pointAtX(0, 1, 5.5), 12), null);
});

test('scalar multiplication matches repeated addition, trace is double-and-add', () => {
    const a = -1.5, b = 2.2;
    const P = E.pointAtX(a, b, 1.3);
    let acc = INF;
    for (let n = 0; n <= 20; n++) {
        const { result, steps } = E.scalarMulReal(a, b, P, n);
        assert.ok(same(result, acc, 1e-5 * (1 + Math.abs(acc.x || 0))), `n=${n}`);
        if (n > 0) {
            const bits = n.toString(2);
            const ones = [...bits].filter((c) => c === '1').length;
            assert.equal(steps.filter((s) => s.op === 'double').length, bits.length - 1);
            assert.equal(steps.length, bits.length - 1 + ones);
        }
        acc = E.sumReal(a, b, acc, P);
    }
    assert.ok(same(E.scalarMulReal(a, b, P, -3).result, E.negReal(E.scalarMulReal(a, b, P, 3).result), 1e-6));
});

test('sampling: components, points on the curve, singular shapes', () => {
    const smooth = E.samplePolylines(-3, 1, 5);
    assert.equal(smooth.length, 2);
    assert.ok(smooth[0].closed);
    for (const L of smooth) for (const [x, y] of L.pts) close(y * y, E.cubic(-3, 1, x), 1e-9);
    assert.equal(E.samplePolylines(0, 1, 5).length, 1);
    const node = E.samplePolylines(-3, 2, 4);
    assert.equal(node.length, 1);
    for (const [x, y] of node[0].pts) close(y * y, E.cubic(-3, 2, x), 1e-9);
    assert.ok(E.samplePolylines(-3, -2, 4).some((L) => L.isolated));
    for (const [x, y] of E.samplePolylines(0, 0, 4)[0].pts) close(y * y, x ** 3, 1e-9);
    assert.deepEqual(E.samplePolylines(0, 1, -5), []);
});

test('closestPoint lands on the curve and is near the optimum', () => {
    const r = rng(11);
    for (let i = 0; i < 80; i++) {
        const a = (r() - 0.5) * 6, b = (r() - 0.5) * 6;
        const px = (r() - 0.5) * 10, py = (r() - 0.5) * 10;
        const c = E.closestPoint(a, b, px, py);
        assert.ok(c);
        assert.ok(Math.abs(E.residual(a, b, c)) < 1e-8 * (1 + Math.abs(c.x) ** 3), `residual ${E.residual(a, b, c)}`);
        let best = Infinity;
        for (const L of E.samplePolylines(a, b, Math.max(px, 10) + 2 * Math.cbrt(py * py))) for (const q of L.pts) best = Math.min(best, Math.hypot(q[0] - px, q[1] - py));
        assert.ok(c.dist <= best + 1e-3, `${c.dist} vs ${best}`);
    }
});

// ---------------- finite fields ----------------

function bruteCount(a, b, p) {
    let n = 1;
    for (let x = 0; x < p; x++) for (let y = 0; y < p; y++) if ((y * y - (x * x * x + a * x + b)) % p === 0) n++;
    return n;
}

test('modInv and primes', () => {
    for (const p of [5, 7, 97, 1999]) for (let a = 1; a < p; a += Math.max(1, p >> 5)) assert.equal((a * E.modInv(a, p)) % p, 1);
    assert.equal(E.modInv(0, 7), null);
    assert.equal(E.modInv(6, 9), null);
    assert.ok(E.isPrime(1999) && !E.isPrime(1001) && !E.isPrime(1));
});

test('point counts match brute force and Hasse', () => {
    const r = rng(5);
    const primes = [5, 7, 11, 13, 17, 23, 31, 97, 101, 211];
    let checked = 0;
    for (const p of primes) {
        for (let k = 0; k < 6; k++) {
            const c = E.curveFp(Math.floor(r() * p), Math.floor(r() * p), p);
            if (E.isSingularFp(c)) continue;
            const N = E.groupOrderFp(c);
            assert.equal(N, bruteCount(c.a, c.b, p), `p=${p} a=${c.a} b=${c.b}`);
            assert.ok(E.hasseOk(N, p));
            const [lo, hi] = E.hasseInterval(p);
            assert.ok(N >= lo && N <= hi);
            checked++;
        }
    }
    assert.ok(checked > 40);
    assert.equal(E.groupOrderFp(E.curveFp(2, 2, 17)), 19);
    assert.equal(E.groupOrderFp(E.curveFp(0, 7, 223)) % 21, 0);
});

test('finite group axioms, orders divide #E, scalar multiplication', () => {
    const r = rng(9);
    for (const [a, b, p] of [[2, 2, 17], [0, 7, 223], [1, 1, 101], [3, 8, 1999]]) {
        const c = E.curveFp(a, b, p);
        const pts = E.pointsFp(c);
        const N = pts.length + 1;
        for (const P of pts.slice(0, 5)) assert.ok(E.onCurveFp(c, P));
        for (let k = 0; k < 25; k++) {
            const P = pts[Math.floor(r() * pts.length)], Q = pts[Math.floor(r() * pts.length)], R = pts[Math.floor(r() * pts.length)];
            assert.deepEqual(E.sumFp(c, P, Q), E.sumFp(c, Q, P));
            assert.deepEqual(E.sumFp(c, E.sumFp(c, P, Q), R), E.sumFp(c, P, E.sumFp(c, Q, R)));
            assert.ok(E.isInf(E.sumFp(c, P, E.negFp(c, P))));
            assert.ok(E.onCurveFp(c, E.sumFp(c, P, Q)));
            const o = E.orderFromGroupFp(c, P, N);
            assert.equal(N % o, 0);
            assert.ok(E.isInf(E.scalarMulFp(c, P, o).result));
            if (p < 300) assert.equal(E.orderFp(c, P), o);
            assert.ok(E.isInf(E.scalarMulFp(c, P, N).result));
        }
    }
});

test('(47, 71) on y^2 = x^3 + 7 over F_223 has order 21', () => {
    const c = E.curveFp(0, 7, 223);
    const P = { x: 47, y: 71 };
    assert.ok(E.onCurveFp(c, P));
    assert.equal(E.orderFp(c, P), 21);
    assert.deepEqual(E.scalarMulFp(c, P, 2).result, { x: 36, y: 111 });
    assert.equal(E.subgroupFp(c, P).length, 20);
});

test('group structure: cyclic and non-cyclic cases, generators, dlog', () => {
    const c = E.curveFp(-1, 0, 13);
    const s = E.groupStructureFp(c);
    assert.equal(s.order, E.groupOrderFp(c));
    assert.equal(s.invariants[0] * s.invariants[1], s.order);
    assert.equal(s.invariants[1] % s.invariants[0], 0);
    assert.ok(s.invariants[0] % 2 === 0, 'Z2 x Z_2k for full 2-torsion');
    assert.equal(E.generatorsFp(c).length, 0);
    const cyc = E.curveFp(2, 2, 17); // #E = 19, cyclic
    const sc = E.groupStructureFp(cyc);
    assert.ok(sc.cyclic && sc.exponent === 19);
    const gens = E.generatorsFp(cyc);
    assert.equal(gens.length, 18);
    const G = gens[0];
    const table = E.dlogTableFp(cyc, G);
    assert.equal(table.get('O'), 19);
    for (let k = 1; k < 19; k++) {
        const Q = E.scalarMulFp(cyc, G, k).result;
        assert.equal(E.dlogFp(cyc, G, Q), k);
    }
    assert.equal(E.dlogFp(E.curveFp(0, 7, 223), { x: 47, y: 71 }, { x: 1, y: 1 }), null);
    assert.equal(E.maxOrderPointFp(c).order, s.exponent);
});

test('wrapped line dots and mirror symmetry', () => {
    const c = E.curveFp(2, 2, 17);
    const pts = E.pointsFp(c);
    const P = pts[0], Q = pts.find((q) => q.x !== P.x);
    const A = E.addFp(c, P, Q);
    const dots = E.lineDotsFp(A.line, 17);
    assert.equal(dots.length, 17);
    for (const X of [P, Q, A.third]) assert.ok(dots.some(([x, y]) => x === X.x && y === X.y));
    assert.equal(E.addFp(c, P, E.negFp(c, P)).kind, 'vertical');
    assert.equal(E.lineDotsFp({ type: 'vertical', x: 3 }, 17).length, 17);
    for (const X of pts) assert.ok(E.onCurveFp(c, E.negFp(c, X)));
});

// ---------------- complex uniformisation ----------------

test('g2, g3 for tau = i match the known values', () => {
    const { g2, g3 } = E.latticeInvariants([0, 1]);
    const gam = 3.625609908221908; // Gamma(1/4)
    close(g2[0], gam ** 8 / (16 * Math.PI ** 2), 1e-9);
    close(g2[0], 189.07272, 1e-7);
    assert.ok(Math.abs(g2[1]) < 1e-9);
    assert.ok(Math.abs(g3[0]) < 1e-8 && Math.abs(g3[1]) < 1e-8);
    const rho = [-0.5, Math.sqrt(3) / 2];
    assert.ok(cabs(E.latticeInvariants(rho).g2) < 1e-7);
    const t = [0.17, 0.83];
    const A = E.latticeInvariants(t), B = E.latticeInvariants([1.17, 0.83]);
    closeC(A.g2, B.g2, 1e-9);
    closeC(A.g3, B.g3, 1e-9);
});

test('p satisfies p\'^2 = 4p^3 - g2 p - g3 and matches the Laurent series near 0', () => {
    const r = rng(21);
    for (const tau of [[0, 1], [0.3, 0.9], [0.5, 1.4], [-0.2, 0.6], [0, 0.35]]) {
        const { g2, g3 } = E.latticeInvariants(tau);
        for (let k = 0; k < 10; k++) {
            const z = [(r() - 0.5) * 3, (r() - 0.5) * 3 * tau[1]];
            const { wp, dwp } = E.wpPair(z, tau);
            const lhs = mulc(dwp, dwp);
            const rhs = sub(sub(scl(mulc(mulc(wp, wp), wp), 4), mulc(g2, wp)), g3);
            assert.ok(cabs(sub(lhs, rhs)) < 1e-7 * (1 + cabs(lhs)), `tau=${tau} z=${z}: ${cabs(sub(lhs, rhs))}`);
        }
        const z = [0.04, 0.03];
        closeC(E.wp(z, tau), E.wpLaurent(z, tau), 1e-9, 'laurent');
    }
    assert.equal(E.wp([0, 0], [0, 1]), null);
    assert.equal(E.wp([3, 2], [0, 2]), null);
});

test('periodicity and oddness of p, p\'', () => {
    const tau = [0.2, 0.8], z = [0.31, 0.17];
    const A = E.wpPair(z, tau);
    const B = E.wpPair([z[0] + 1 + 0.2 * 2, z[1] + 0.8 * 2], tau);
    closeC(A.wp, B.wp, 1e-8);
    closeC(A.dwp, B.dwp, 1e-8);
    const N = E.wpPair([-z[0], -z[1]], tau);
    closeC(N.wp, A.wp, 1e-9);
    closeC(N.dwp, scl(A.dwp, -1), 1e-9);
});

test('addition law consistency: p(z1+z2) from the chord formula to 1e-6', () => {
    const r = rng(33);
    for (const tau of [[0, 1], [0.5, 0.9], [0.23, 1.1], [0, 0.5]]) {
        for (let k = 0; k < 10; k++) {
            const z1 = [(r() - 0.5) * 2, (r() - 0.5) * 2 * tau[1]], z2 = [(r() - 0.5) * 2, (r() - 0.5) * 2 * tau[1]];
            const A = E.wpPair(z1, tau), B = E.wpPair(z2, tau), S = E.wpPair([z1[0] + z2[0], z1[1] + z2[1]], tau);
            const lam = divc(sub(A.dwp, B.dwp), sub(A.wp, B.wp));
            const x3 = sub(sub(scl(mulc(lam, lam), 0.25), A.wp), B.wp);
            assert.ok(cabs(sub(x3, S.wp)) < 1e-6 * (1 + cabs(S.wp)), `tau=${tau}: ${cabs(sub(x3, S.wp))}`);
        }
    }
});

test('real section: z -> (p, p\'/2) is a group homomorphism onto the real curve', () => {
    const r = rng(41);
    for (const tau of [[0, 1], [0, 1.7], [0.5, 0.8]]) {
        assert.ok(E.hasRealSection(tau));
        const cc = E.curveCoefficients(tau);
        const a = cc.a[0], b = cc.b[0];
        for (let k = 0; k < 8; k++) {
            const z1 = [0.05 + 0.9 * r(), 0], z2 = [0.05 + 0.9 * r(), 0];
            if (Math.abs(z1[0] - z2[0]) < 1e-2 || Math.abs(z1[0] + z2[0] - 1) < 1e-2 || Math.abs(z1[0] + z2[0] - 2) < 1e-2) continue;
            const P = E.uniformizeReal(z1, tau), Q = E.uniformizeReal(z2, tau);
            const S = E.uniformizeReal([z1[0] + z2[0], 0], tau);
            const R = E.sumReal(a, b, P, Q);
            assert.ok(same(R, S, 1e-5 * (1 + Math.abs(S.x))), `${JSON.stringify([R, S])}`);
            assert.ok(Math.abs(E.residual(a, b, P)) < 1e-6 * (1 + Math.abs(P.x) ** 3));
        }
    }
    assert.ok(!E.hasRealSection([0.2, 1]));
    const e = E.uniformizeReal([0.5, 0], [0, 1]);
    close(e.y, 0, 1e-8);
    const cc = E.curveCoefficients([0, 1]);
    close(E.cubic(cc.a[0], cc.b[0], e.x), 0, 1e-6);
});
