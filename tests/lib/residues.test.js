import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../lib/complex.js';
import * as R from '../../lib/residues.js';

const near = (a, b, tol = 1e-8, msg = '') => assert.ok(C.abs(C.sub(a, b)) <= tol * Math.max(1, C.abs(b)), `${msg} got ${a} want ${b}`);

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('residues of known functions', () => {
    // 1/(z^2+1) at +-i
    const r1 = R.makeRational({ poles: [{ z: [0, 1], m: 1 }, { z: [0, -1], m: 1 }] });
    near(R.residueAt(r1, 0), [0, -0.5]);
    near(R.residueAt(r1, 1), [0, 0.5]);
    // e^z / z^3 at 0 = 1/2
    const r2 = R.makeRational({ poles: [{ z: [0, 0], m: 3 }], expk: [1, 0] });
    near(R.residueAt(r2, 0), [0.5, 0]);
    // z/(z-1)^2 at 1 = 1
    const r3 = R.makeRational({ num: [[0, 0], [1, 0]], poles: [{ z: [1, 0], m: 2 }] });
    near(R.residueAt(r3, 0), [1, 0]);
    // (z^2+1)/(z-1)^3 at 1 = 1
    const r4 = R.makeRational({ num: [[1, 0], [0, 0], [1, 0]], poles: [{ z: [1, 0], m: 3 }] });
    near(R.residueAt(r4, 0), [1, 0]);
    // z^2/(z^2+1)^2 at +-i: -i/4 and +i/4
    const r5 = R.makeRational({ num: [[0, 0], [0, 0], [1, 0]], poles: [{ z: [0, 1], m: 2 }, { z: [0, -1], m: 2 }] });
    near(R.residueAt(r5, 0), [0, -0.25]);
    near(R.residueAt(r5, 1), [0, 0.25]);
    // numerical residue agrees
    near(R.residueNumeric((z) => R.evalRational(r5, z), [0, 1], 0.2), [0, -0.25], 1e-9);
});

test('partial fractions: simple poles have residue c, higher orders 0 unless modified', () => {
    const terms = [{ z: [1, 0], m: 1, c: [2, 1] }, { z: [-1, 1], m: 3, c: [1, -1] }, { z: [0, -2], m: 2, c: [0.5, 0] }];
    const r = R.fromPartialFractions(terms);
    const res = R.residues(r);
    near(res[0], [2, 1]);
    near(res[1], [0, 0], 1e-8);
    near(res[2], [0, 0], 1e-8);
    const z = [0.3, 0.7];
    let s = [0, 0];
    for (const t of terms) s = C.add(s, C.div(t.c, C.powInt(C.sub(z, t.z), t.m)));
    near(R.evalRational(r, z), s, 1e-10);
    // with e^{z}: Res of c e^z/(z-p)^3 is c e^p / 2
    const r2 = R.fromPartialFractions([{ z: [0.5, 0.5], m: 3, c: [1, 0] }], [], [1, 0]);
    near(R.residueAt(r2, 0), C.scale(C.exp([0.5, 0.5]), 0.5));
});

test('Gauss-Legendre nodes integrate polynomials exactly', () => {
    const { x, w } = R.gaussLegendre();
    assert.equal(x.length, 10);
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 2) < 1e-13);
    const r = R.integrateAdaptive((t) => [t ** 7 + t ** 4, 0], 0, 2);
    assert.ok(Math.abs(r.value[0] - (2 ** 8 / 8 + 2 ** 5 / 5)) < 1e-9);
    assert.ok(r.ok);
});

function randomRational(rand, nPoles) {
    const poles = [];
    const terms = [];
    for (let i = 0; i < nPoles; i++) {
        const z = [(rand() - 0.5) * 4, (rand() - 0.5) * 4];
        if (poles.some((q) => C.abs(C.sub(q, z)) < 0.5)) { i--; continue; }
        poles.push(z);
        terms.push({ z, m: 1 + Math.floor(rand() * 3), c: [rand() * 2 - 1, rand() * 2 - 1] });
    }
    const zeros = rand() < 0.5 ? [] : [[rand() - 0.5, rand() - 0.5]];
    return R.fromPartialFractions(terms, zeros, [rand() < 0.5 ? 0 : 0.7, 0]);
}

test('numerical contour integral = 2 pi i sum of enclosed residues (random circles and polygons)', () => {
    const rand = rng(7);
    let tested = 0;
    for (let trial = 0; trial < 40; trial++) {
        const r = randomRational(rand, 2 + Math.floor(rand() * 4));
        let contour;
        if (trial % 2 === 0) contour = { kind: 'circle', c: [(rand() - 0.5) * 2, (rand() - 0.5) * 2], r: 0.5 + rand() * 2.5 };
        else {
            const n = 3 + Math.floor(rand() * 5);
            const c = [(rand() - 0.5) * 2, (rand() - 0.5) * 2];
            const pts = [];
            for (let k = 0; k < n; k++) pts.push(C.add(c, C.fromPolar(1 + rand() * 2, (2 * Math.PI * k) / n + rand() * 0.3)));
            contour = { kind: 'poly', pts };
        }
        if (r.poles.some((q) => R.distanceToContour(contour, q.z) < 0.1)) continue;
        const out = R.residueTheorem(r, contour, { tol: 1e-10 });
        assert.ok(out.ok, `trial ${trial}`);
        assert.ok(out.discrepancy < 1e-6 * Math.max(1, C.abs(out.predicted)), `trial ${trial}: ${out.discrepancy}`);
        tested++;
    }
    assert.ok(tested >= 20, `tested ${tested}`);
});

test('winding numbers: circle, polygon, figure-eight and reversed loop', () => {
    const sq = { kind: 'poly', pts: [[-1, -1], [1, -1], [1, 1], [-1, 1]] };
    assert.equal(R.windingNumber(sq, [0, 0]), 1);
    assert.equal(R.windingNumber(sq, [2, 0]), 0);
    const rev = { kind: 'poly', pts: sq.pts.slice().reverse() };
    assert.equal(R.windingNumber(rev, [0, 0]), -1);
    const twice = { kind: 'poly', pts: Array.from({ length: 16 }, (_, k) => C.fromPolar(1, (2 * Math.PI * k) / 8)) };
    assert.equal(R.windingNumber(twice, [0, 0]), 2);
    const eight = [];
    for (let k = 0; k < 200; k++) {
        const t = (2 * Math.PI * k) / 200;
        eight.push([Math.sin(t), Math.sin(t) * Math.cos(t)]);
    }
    const w1 = R.windingOfPolyline(eight, [0.5, 0.2]);
    const w2 = R.windingOfPolyline(eight, [-0.5, 0.2]);
    assert.equal(w1 + w2, 0);
    assert.equal(Math.abs(w1), 1);
    assert.equal(R.windingNumber({ kind: 'circle', c: [1, 1], r: 1 }, [1.5, 1]), 1);
    const r = R.makeRational({ poles: [{ z: [0, 0], m: 1 }] });
    const out = R.residueTheorem(r, twice);
    near(out.integral, [0, 4 * Math.PI], 1e-9);
    near(out.predicted, [0, 4 * Math.PI], 1e-12);
});

test("Cauchy's integral formula recovers values and derivatives; analytic region gives zero", () => {
    const g = (z) => C.exp(z);
    const contour = { kind: 'circle', c: [0, 0], r: 2 };
    const a = [0.4, -0.3];
    for (let n = 0; n <= 3; n++) near(R.cauchyIntegral(g, a, contour, n).value, g(a), 1e-9, `n=${n}`);
    near(R.cauchyIntegral((z) => C.sin(z), a, contour, 1).value, C.cos(a), 1e-9);
    const zero = R.integrateContour((z) => C.mul(C.exp(z), C.sin(z)), { kind: 'poly', pts: [[-1, -1], [2, 0], [1, 2]] });
    assert.ok(C.abs(zero.value) < 1e-9);
});

test('argument principle on polynomials with random zeros', () => {
    const rand = rng(11);
    let tested = 0;
    for (let trial = 0; trial < 30; trial++) {
        const n = 2 + Math.floor(rand() * 5);
        const zeros = Array.from({ length: n }, () => [(rand() - 0.5) * 4, (rand() - 0.5) * 4]);
        const r = R.fromFactored({ zeros });
        const f = (z) => R.evalRational(r, z);
        const contour = { kind: 'circle', c: [rand() - 0.5, rand() - 0.5], r: 0.8 + rand() * 1.8 };
        if (zeros.some((z) => R.distanceToContour(contour, z) < 0.08)) continue;
        const inside = zeros.filter((z) => R.windingNumber(contour, z) === 1).length;
        const tr = R.traceImage(f, R.contourPolyline(contour, 200));
        assert.equal(tr.winding, inside, `trial ${trial}`);
        assert.ok(Math.abs(tr.turns - inside) < 0.05);
        assert.equal(R.zerosMinusPoles(zeros, [], contour).diff, inside);
        tested++;
    }
    assert.ok(tested >= 15);
});

test('argument principle with poles: N - P', () => {
    const zeros = [[0.5, 0], [-0.4, 0.3]];
    const poles = [{ z: [0, 0.2], m: 2 }, { z: [3, 3], m: 1 }];
    const r = R.fromFactored({ zeros, poles });
    const f = (z) => R.evalRational(r, z);
    const tr = R.traceImage(f, R.contourPolyline({ kind: 'circle', c: [0, 0], r: 1 }, 300));
    assert.equal(tr.winding, 0);
    const tr2 = R.traceImage(f, R.contourPolyline({ kind: 'circle', c: [0, 0], r: 0.35 }, 300));
    assert.equal(tr2.winding, -2);
});

test('Nyquist criterion agrees with the closed-loop pole count', () => {
    const poles = [[-1, 0], [-1, 0], [-1, 0]];
    for (const [K, Z] of [[4, 0], [7, 0], [9, 2], [20, 2]]) {
        const out = R.nyquist({ zeros: [], poles, K });
        assert.equal(out.P, 0);
        assert.equal(out.Z, Z, `K=${K}`);
        const rhp = out.closedLoopRoots.filter((q) => q[0] > 1e-6).length;
        assert.equal(rhp, Z, `K=${K} roots`);
    }
    const o1 = R.nyquist({ zeros: [], poles: [[1, 0]], K: 3 });
    assert.equal(o1.P, 1);
    assert.equal(o1.W, 1);
    assert.equal(o1.Z, 0);
    assert.equal(R.nyquist({ zeros: [], poles: [[1, 0]], K: 0.5 }).Z, 1);
    const o3 = R.nyquist({ zeros: [], poles: [[0, 0], [-1, 0]], K: 5 });
    assert.equal(o3.Z, 0);
    assert.equal(o3.W, 0);
    assert.ok(R.nyquist({ zeros: [], poles: [[-1, 0]], K: 3, delay: 3 }).Z > 0);
    const rand = rng(5);
    let tested = 0;
    for (let t = 0; t < 12; t++) {
        const a = [(rand() - 0.7) * 2, 1 + rand()];
        const ps = [[-(0.3 + rand() * 2), 0], a, [a[0], -a[1]]];
        const K = 0.2 + rand() * 8;
        const out = R.nyquist({ zeros: [[-(0.5 + rand()), 0]], poles: ps, K });
        if (out.marginal) continue;
        const rhp = out.closedLoopRoots.filter((q) => q[0] > 1e-7).length;
        assert.equal(out.Z, rhp, `random ${t}`);
        tested++;
    }
    assert.ok(tested >= 8);
});

test('real integrals evaluated by residues match closed forms', () => {
    for (const ex of R.REAL_EXAMPLES) {
        const params = ex.params;
        const exact = ex.exact(params);
        if (!ex.indent) {
            const pred = R.evalRealExample(ex, params, 60);
            near(pred.predicted, exact, 1e-9, ex.id);
        }
        const big = R.evalRealExample(ex, params, 300, 1e-3);
        if (ex.id === 'sinc') near(big.line, [0, Math.PI], 2e-2, ex.id);
        else {
            near(big.total, big.predicted, 1e-6, `${ex.id} total`);
            const tol = ['inv1', 'xsin', 'dbl'].includes(ex.id) ? 2e-2 : 1e-3;
            near(R.realPart(ex, big.line) === 0 ? [0, 0] : big.line, exact, tol, `${ex.id} line`);
        }
    }
    const inv = R.evalRealExample(R.realExample('inv1'), {}, 1000);
    assert.ok(C.abs(inv.arc) < 4e-3 && C.abs(inv.arc) > 1e-3, `arc ${inv.arc}`);
    assert.ok(C.abs(R.evalRealExample(R.realExample('cos'), { a: 2 }, 500).arc) < 1e-3);
    const r = R.fromFactored({ poles: [{ z: [0, 1], m: 1 }, { z: [0, -1], m: 1 }, { z: [0, 2], m: 1 }, { z: [0, -2], m: 1 }], zeros: [[0, 0], [0, 0]] });
    near(R.realIntegralByResidues(r), [Math.PI / 3, 0], 1e-10);
    const lor = R.makeRational({ poles: [{ z: [0, 1], m: 1 }, { z: [0, -1], m: 1 }] });
    near(R.realIntegralByResidues(lor, 2), [Math.PI * Math.exp(-2), 0], 1e-10);
});

test('sinc: indented contour pieces', () => {
    const out = R.evalRealExample(R.realExample('sinc'), {}, 300, 1e-3);
    near(out.small, [0, -Math.PI], 2e-3);
    assert.ok(C.abs(out.total) < 5e-3, `total ${out.total}`);
    near(out.line, [0, Math.PI], 5e-3);
});

test('Laurent coefficients of 1/(z(z-1)) in both annuli', () => {
    const f = (z) => C.div([1, 0], C.mul(z, C.sub(z, [1, 0])));
    R.laurentCoefficients(f, [0, 0], 0.5, -4, 4).forEach((a, i) => {
        const n = i - 4;
        near(a, n >= -1 ? [-1, 0] : [0, 0], 1e-9, `inner n=${n}`);
    });
    R.laurentCoefficients(f, [0, 0], 2, -5, 3).forEach((a, i) => {
        const n = i - 5;
        near(a, n <= -2 ? [1, 0] : [0, 0], 1e-9, `outer n=${n}`);
    });
    R.laurentCoefficients(f, [1, 0], 0.5, -3, 3).forEach((a, i) => {
        const n = i - 3;
        near(a, n < -1 ? [0, 0] : [Math.pow(-1, n + 1), 0], 1e-9, `around 1 n=${n}`);
    });
    const e = R.laurentCoefficients((z) => C.exp(C.div([1, 0], z)), [0, 0], 1, -4, 2);
    near(e[0], [1 / 24, 0], 1e-10);
    near(e[3], [1, 0], 1e-10);
    near(e[4], [1, 0], 1e-10);
    near(e[5], [0, 0], 1e-10);
    const co = R.laurentCoefficients(f, [0, 0], 0.5, -3, 60);
    near(R.laurentEval(co, -3, [0, 0], [0.3, 0.2]), f([0.3, 0.2]), 1e-9);
    assert.deepEqual(R.annulusOf([[0, 0], [1, 0]], [0, 0], 2), { rin: 1, rout: Infinity });
    assert.deepEqual(R.annulusOf([[0, 0], [1, 0]], [0, 0], 0.5), { rin: 0, rout: 1 });
});

test('inverse Laplace by residues and the Bromwich contour', () => {
    const F = R.rationalFromCoefs([1], [1, 3, 2]);
    for (const t of [0.3, 1, 2.5]) {
        assert.ok(Math.abs(R.inverseLaplaceResidues(F, t) - (Math.exp(-t) - Math.exp(-2 * t))) < 1e-9);
    }
    const F2 = R.rationalFromCoefs([1], [1, 0, 1]);
    assert.ok(Math.abs(R.inverseLaplaceResidues(F2, 1.3) - Math.sin(1.3)) < 1e-9);
    const F3 = R.rationalFromCoefs([1], [1, 2, 1]);
    assert.equal(F3.poles.length, 1);
    assert.equal(F3.poles[0].m, 2);
    assert.ok(Math.abs(R.inverseLaplaceResidues(F3, 1.5) - 1.5 * Math.exp(-1.5)) < 1e-6);
    const b = R.bromwich(F, 1.2, 0.5, 40);
    near(b.total, [Math.exp(-1.2) - Math.exp(-2.4), 0], 1e-7);
    near(b.residueSum, b.total, 1e-7);
    assert.ok(C.abs(b.arc) < 0.05);
    near(b.line, [Math.exp(-1.2) - Math.exp(-2.4), 0], 5e-2);
    assert.deepEqual(R.parseCoefs('1, 2,1'), [1, 2, 1]);
    assert.equal(R.parseCoefs('a,b'), null);
});

test('branch cuts: monodromy of sqrt, cut placement', () => {
    const phi = Math.PI;
    near(R.sqrtCut([-4, 1e-9], phi), [0, 2], 1e-6);
    near(R.sqrtCut([-4, -1e-9], phi), [0, -2], 1e-6);
    const sq = R.circleIntegralWithCut((z, ph) => R.sqrtCut(z, ph), [0, 0], 1, Math.PI);
    near(sq.value, [0, -4 / 3], 1e-8);
    assert.equal(sq.crossings, 1);
    near(R.circleIntegralWithCut((z, ph) => R.sqrtCut(z, ph), [2, 0], 1, Math.PI).value, [0, 0], 1e-9);
    const cross = R.circleIntegralWithCut((z, ph) => R.sqrtCut(z, ph), [-1.5, 0], 1, Math.PI);
    assert.equal(cross.crossings, 2);
    assert.ok(C.abs(cross.value) > 0.1);
    near(R.circleIntegralWithCut((z, ph) => R.sqrtCut(z, ph), [-1.5, 0], 1, Math.PI / 2).value, [0, 0], 1e-9);
    near(R.logCut([-1, 1e-12], phi), [0, Math.PI], 1e-9);
    near(R.logCut([-1, -1e-12], phi), [0, -Math.PI], 1e-9);
});

test('homotopy: integral constant until a pole is crossed, then jumps by 2 pi i Res', () => {
    const r = R.fromPartialFractions([{ z: [1.2, 0], m: 1, c: [1, 0] }, { z: [-1, 0.3], m: 1, c: [0, 2] }]);
    const A = (th) => R.ellipsePoint([0, 0], 3, th);
    const B = (th) => R.ellipsePoint([4, 0], 0.4, th);
    let last = null;
    let jumps = 0;
    for (let i = 0; i <= 60; i++) {
        const c = R.homotopyContour(A, B, i / 60);
        if (r.poles.some((q) => R.distanceToContour(c, q.z) < 0.03)) continue;
        const out = R.residueTheorem(r, c);
        assert.ok(out.discrepancy < 1e-6, `s=${i / 60}`);
        if (last && C.abs(C.sub(out.integral, last)) > 1e-6) jumps++;
        last = out.integral;
    }
    assert.ok(jumps >= 2 && jumps <= 4, `jumps ${jumps}`);
});
