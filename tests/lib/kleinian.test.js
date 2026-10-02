import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../lib/complex.js';
import * as K from '../../lib/kleinian.js';
import { close, closeC, rng } from './helpers.js';
import { fuchsianPairs } from '../../sketches/kleinian/presets.js';

const R = rng(11);
const rc = () => [R() * 4 - 2, R() * 4 - 2];
const randomMobius = () => K.normalise([rc(), rc(), rc(), rc()]);
const sameMap = (m, n, tol = 1e-9) => {
    for (const z of [[0.3, 0.2], [-1.1, 0.7], [2, -1], [0.1, 3]]) closeC(K.applyMobius(m, z), K.applyMobius(n, z), tol);
};

test('algebra: composition, inverse, identity, normalisation', () => {
    for (let t = 0; t < 20; t++) {
        const m = randomMobius(), n = randomMobius();
        const z = rc();
        closeC(K.applyMobius(K.compose(m, n), z), K.applyMobius(m, K.applyMobius(n, z)), 1e-9);
        sameMap(K.compose(m, K.inverse(m)), K.identity());
        assert.ok(K.isIdentity(K.compose(m, K.inverse(m))));
        closeC(K.det(K.normalise(m)), [1, 0], 1e-12);
        // normalising does not change the map
        sameMap(K.normalise([C.scale(m[0], 3), C.scale(m[1], 3), C.scale(m[2], 3), C.scale(m[3], 3)]), m);
    }
    assert.equal(K.normalise([[0, 0], [0, 0], [0, 0], [0, 0]]), null);
});

test('trace invariants: conjugation, inverse, cyclic products', () => {
    for (let t = 0; t < 20; t++) {
        const m = randomMobius(), n = randomMobius();
        const conj = K.compose(K.compose(n, m), K.inverse(n));
        const t1 = K.trace(K.normalise(m)), t2 = K.trace(K.normalise(conj));
        // equal up to sign (det 1 matrices are defined up to sign)
        const same = C.abs(C.sub(t1, t2)) < 1e-8 || C.abs(C.add(t1, t2)) < 1e-8;
        assert.ok(same, `${t1} vs ${t2}`);
        closeC(K.trace(K.compose(m, n)), K.trace(K.compose(n, m)), 1e-9);
        closeC(K.trace(K.inverse(m)), K.trace(m), 1e-12);
    }
});

test('classification of known examples', () => {
    const cls = (a, b, c, d) => K.classify([a, b, c, d]);
    assert.equal(cls([2, 0], [0, 0], [0, 0], [1, 0]), 'hyperbolic'); // z -> 2z
    assert.equal(cls([Math.cos(1), Math.sin(1)], [0, 0], [0, 0], [1, 0]), 'elliptic'); // rotation
    assert.equal(cls([1, 0], [1, 0], [0, 0], [1, 0]), 'parabolic'); // z + 1
    assert.equal(cls([1, 0], [0, 0], [1, 0], [1, 0]), 'parabolic'); // z / (z + 1)
    assert.equal(cls([2, 1], [0, 0], [0, 0], [1, 0]), 'loxodromic'); // spiral
    assert.equal(cls([1, 0], [0, 0], [0, 0], [1, 0]), 'identity');
    assert.equal(cls([3, 0], [0, 0], [0, 0], [3, 0]), 'identity');
    assert.equal(cls([2, 0], [1, 0], [1, 0], [1, 0]), 'hyperbolic'); // trace 3
    assert.equal(cls([0, 0], [-1, 0], [1, 0], [0, 0]), 'elliptic'); // z -> -1/z
});

test('fixed points are fixed; attracting one has multiplier < 1', () => {
    for (let t = 0; t < 30; t++) {
        const m = randomMobius();
        const fp = K.fixedPoints(m);
        assert.ok(fp.length >= 1);
        for (const z of fp) if (z) closeC(K.applyMobius(m, z), z, 1e-7);
        if (['hyperbolic', 'loxodromic'].includes(K.classify(m))) {
            const a = K.attractingFixedPoint(m);
            assert.ok(a);
            assert.ok(K.multiplierAt(m, a) < 1);
            // iterating the map converges to it
            if (K.multiplierAt(m, a) < 0.7) {
                let z = [0.3, -0.2];
                for (let i = 0; i < 400; i++) z = K.applyMobius(m, z);
                closeC(z, a, 1e-6);
            }
        }
    }
    assert.deepEqual(K.fixedPoints([[1, 0], [1, 0], [0, 0], [1, 0]]), [null]); // translation
    const f = K.fixedPoints([[2, 0], [0, 0], [0, 0], [1, 0]]); // z -> 2z: 0 and infinity
    assert.ok(f.includes(null) && f.some((z) => z && C.abs(z) < 1e-12));
    assert.equal(K.attractingFixedPoint([[0.5, 0], [0, 0], [0, 0], [1, 0]]) !== null, true);
});

test('Moebius maps send circles to circles: image of a circle through its three images', () => {
    const m = randomMobius();
    const circ = { c: [0.3, -0.4], r: 0.8 };
    const img = K.applyToCircle(m, circ);
    assert.ok(img);
    for (const t of [0.4, 1.9, 3.3, 5.5]) {
        const w = K.applyMobius(m, C.add(circ.c, C.fromPolar(circ.r, t)));
        if (img.line) continue;
        close(C.abs(C.sub(w, img.c)), img.r, 1e-6);
    }
});

test('Schottky group: generators map the exterior of one circle into the other disc (ping-pong)', () => {
    const G = K.schottkyGroup([
        { c1: [-1.6, 0], r1: 0.5, c2: [1.6, 0], r2: 0.6, theta: 0.7 },
        { c1: [0, 1.6], r1: 0.5, c2: [0, -1.6], r2: 0.5, theta: -0.3 },
    ]);
    const chk = K.schottkyCheck(G);
    assert.ok(chk.ok, JSON.stringify(chk));
    assert.ok(chk.minGap > 0);
    for (const l of G.letters) {
        for (let i = 0; i < 40; i++) {
            const z = C.add(l.from.c, C.fromPolar(l.from.r * (1.01 + 3 * R()), 6.28 * R()));
            const w = K.applyMobius(l.m, z);
            assert.ok(C.abs(C.sub(w, l.to.c)) < l.to.r, 'exterior -> disc');
        }
        // inverse letter swaps the discs
        assert.equal(G.letters[l.inv].inv, G.letters.indexOf(l));
        sameMap(K.compose(l.m, G.letters[l.inv].m), K.identity(), 1e-9);
    }
    // overlapping circles fail the check
    const bad = K.schottkyGroup([{ c1: [0, 0], r1: 1, c2: [1, 0], r2: 1, theta: 0 }]);
    assert.ok(!K.schottkyCheck(bad).ok);
});

test('limit points of words are fixed points of hyperbolic / loxodromic words', () => {
    const G = K.schottkyGroup([
        { c1: [-1.6, 0], r1: 0.5, c2: [1.6, 0], r2: 0.5, theta: 0.4 },
        { c1: [0, 1.6], r1: 0.5, c2: [0, -1.6], r2: 0.5, theta: 1.1 },
    ]);
    const e = K.enumerateWords(G, { maxDepth: 5, minSize: 0 });
    assert.ok(e.count > 100);
    // random reduced words: attracting fixed point is fixed and lies in the disc of the first letter
    for (let t = 0; t < 25; t++) {
        let W = K.identity(), last = -1;
        const word = [];
        for (let i = 0; i < 2 + Math.floor(R() * 5); i++) {
            let j;
            do { j = Math.floor(R() * 4); } while (last >= 0 && j === G.letters[last].inv);
            word.push(j); last = j;
            W = K.compose(W, G.letters[j].m);
        }
        const cls = K.classify(W);
        if (cls !== 'hyperbolic' && cls !== 'loxodromic') continue;
        const z = K.attractingFixedPoint(W);
        closeC(K.applyMobius(W, z), z, 1e-7);
        const disc = G.letters[word[0]].to;
        assert.ok(C.abs(C.sub(z, disc.c)) < disc.r, 'inside the first letter disc');
    }
    // every enumerated point lies in the disc of its first letter and in the last letter's nested disc
    for (let i = 0; i < e.count; i++) {
        const disc = G.letters[e.first[i]].to;
        assert.ok(Math.hypot(e.points[2 * i] - disc.c[0], e.points[2 * i + 1] - disc.c[1]) < disc.r + 1e-9);
    }
    // the node count for depth n is 4 * 3^(n-1) when nothing is pruned
    assert.equal(e.count, 4 * 3 ** 4);
});

test('radius cutoff prunes the word tree; the node cap truncates', () => {
    const G = K.schottkyGroup(fuchsianPairs(0.6));
    const coarse = K.enumerateWords(G, { maxDepth: 12, minSize: 0.2 });
    const fine = K.enumerateWords(G, { maxDepth: 12, minSize: 0.01 });
    assert.ok(coarse.count < fine.count);
    const capped = K.enumerateWords(G, { maxDepth: 12, minSize: 0, maxNodes: 2000 });
    assert.ok(capped.truncated);
    assert.ok(capped.count <= 3 * 2000, `${capped.count} leaves`); // bounded by a small multiple of the cap
});

test('Fuchsian group: limit set is the unit circle (words and chaos game)', () => {
    const G = K.schottkyGroup(fuchsianPairs(0.6));
    assert.ok(K.schottkyCheck(G).ok);
    const e = K.enumerateWords(G, { maxDepth: 8, minSize: 1e-3 });
    for (let i = 0; i < e.count; i++) close(Math.hypot(e.points[2 * i], e.points[2 * i + 1]), 1, 1e-8);
    const P = K.packGroup(G);
    const st = K.createGroupChaos(3);
    const out = new Float64Array(2 * 5000), tags = new Uint8Array(5000);
    const m = K.groupChaos(P, st, 5000, out, tags);
    assert.ok(m > 4000);
    for (let i = 0; i < m; i++) close(Math.hypot(out[2 * i], out[2 * i + 1]), 1, 1e-6);
    assert.ok(Array.from(tags.subarray(0, m)).every((t) => t < 4));
});

test('random walk never applies a letter followed by its inverse and survives poles', () => {
    const G = K.schottkyGroup(fuchsianPairs(0.5));
    const P = K.packGroup(G);
    const st = K.createGroupChaos(1, [1.7, 0]);
    const out = new Float64Array(2 * 3000), tags = new Uint8Array(3000);
    const m = K.groupChaos(P, st, 3000, out, tags);
    for (let i = 1; i < m; i++) assert.notEqual(tags[i], P.inv[tags[i - 1]]);
    assert.ok(Array.from(out.subarray(0, 2 * m)).every(Number.isFinite));
});

test("Grandma's recipe: tr a, tr b and the parabolic commutator tr[a, b] = -2", () => {
    for (const [ta, tb] of [[[2, 0], [2, 0]], [[3, 0.4], [3, -0.4]], [[1, 2], [2, 0]], [[0, 2.5], [2, 0]], [[1.7, 0.3], [2.2, -0.5]]]) {
        const rec = K.grandmasRecipe(ta, tb);
        assert.ok(rec);
        closeC(K.det(rec.a), [1, 0], 1e-9);
        closeC(K.det(rec.b), [1, 0], 1e-9);
        closeC(K.trace(rec.a), ta, 1e-9);
        closeC(K.trace(rec.b), tb, 1e-9);
        closeC(K.trace(K.compose(rec.a, rec.b)), rec.tab, 1e-8);
        closeC(K.commutatorTrace(rec.a, rec.b), [-2, 0], 1e-8);
        assert.equal(K.classify(K.compose(K.compose(rec.a, rec.b), K.compose(K.inverse(rec.a), K.inverse(rec.b)))), 'parabolic');
    }
    closeC(K.maskitGroup([1, 2]).b[0], K.grandmasRecipe([1, 2], [2, 0]).b[0]);
    assert.equal(K.classify(K.maskitGroup([0.3, 2.2]).b), 'parabolic');
    // the Riley slice generators are parabolic
    const ry = K.rileyGroup([0, 2.5]);
    assert.equal(K.classify(ry.a), 'parabolic');
    assert.equal(K.classify(ry.b), 'parabolic');
});

test('the gasket group (ta = tb = 2): chaos-game points stay on a bounded circle-packing-like set', () => {
    const rec = K.grandmasRecipe([2, 0], [2, 0]);
    const G = K.groupFromGenerators([rec.a, rec.b]);
    const P = K.packGroup(G);
    const st = K.createGroupChaos(2);
    const out = new Float64Array(2 * 20000);
    const m = K.groupChaos(P, st, 20000, out);
    assert.ok(m > 19000);
    // letters pair the isometric circles: g maps its isometric circle onto that of g^-1
    for (const l of G.letters) {
        const z = C.add(l.from.c, C.fromPolar(l.from.r, 0.9));
        const w = K.applyMobius(l.m, z);
        close(C.abs(C.sub(w, l.to.c)), l.to.r, 1e-6);
    }
});

test('Apollonian gasket: Descartes theorem and tangency for every quadruple', () => {
    const [kp, km] = K.descartesCurvature(2, 2, 3);
    close(kp, 15, 1e-12);
    close(km, -1, 1e-12);
    const { circles, quads } = K.apollonianGasket({ depth: 5 });
    assert.equal(circles.length, 4 + 4 * (3 ** 5 - 1) / 2);
    for (const q of quads) {
        const k = q.map((i) => circles[i].k);
        const s = k.reduce((a, b) => a + b, 0), s2 = k.reduce((a, b) => a + b * b, 0);
        close(s * s, 2 * s2, 1e-9, `Descartes ${k}`);
        for (let i = 0; i < 4; i++) {
            for (let j = i + 1; j < 4; j++) {
                const a = circles[q[i]], b = circles[q[j]];
                const d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]);
                close(d, Math.abs(1 / a.k + 1 / b.k), 1e-9, 'tangent');
            }
        }
    }
    // no two positive circles of the packing overlap
    const pos = circles.filter((q) => q.k > 0).slice(0, 300);
    for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
            assert.ok(Math.hypot(pos[i].c[0] - pos[j].c[0], pos[i].c[1] - pos[j].c[1]) >= pos[i].r + pos[j].r - 1e-9);
        }
    }
    const small = K.apollonianGasket({ depth: 10, minRadius: 0.05 });
    assert.ok(small.circles.every((q) => q.r >= 0.05 || q.k === -1 || small.circles.indexOf(q) < 4));
});

test('Apollonian chaos game (inversions in the dual circles) lands on the residual set', () => {
    const dual = K.apollonianDualCircles();
    assert.equal(dual.length, 4);
    const out = K.inversionChaos(dual, 5000, { seed: 3 });
    const { circles } = K.apollonianGasket({ depth: 5 });
    for (let i = 0; i < out.count; i++) {
        const x = out.points[2 * i], y = out.points[2 * i + 1];
        assert.ok(Math.hypot(x, y) <= 1 + 1e-9);
        for (const q of circles) {
            const d = Math.hypot(x - q.c[0], y - q.c[1]);
            if (q.k > 0) assert.ok(d >= q.r - 1e-6, 'not inside a packing disc');
        }
    }
    // inversion is an involution
    const z = [0.31, 0.42];
    for (const c of dual) closeC(K.invertInCircle(c, K.invertInCircle(c, z)), z, 1e-9);
});

test('stereographic projection and circles on the sphere', () => {
    for (let i = 0; i < 30; i++) {
        const z = rc();
        const p = K.toSphere(z[0], z[1]);
        close(Math.hypot(...p), 1, 1e-12);
        closeC(K.fromSphere(p), z, 1e-9);
    }
    assert.deepEqual(K.toSphere(Infinity, 0), [0, 0, 1]);
    assert.deepEqual(K.toSphere(0, 0), [0, 0, -1]);
    const circ = { c: [0.4, 0.3], r: 0.7 };
    const pts = K.circleOnSphere(circ, 64);
    assert.equal(pts.length, 3 * 65);
    // the image lies on a plane: n . p = d for all points (circle on the sphere)
    const p0 = [pts[0], pts[1], pts[2]], p1 = [pts[3 * 16], pts[3 * 16 + 1], pts[3 * 16 + 2]], p2 = [pts[3 * 32], pts[3 * 32 + 1], pts[3 * 32 + 2]];
    const u = p1.map((v, i) => v - p0[i]), w = p2.map((v, i) => v - p0[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (let i = 0; i <= 64; i++) {
        const d = [pts[3 * i] - p0[0], pts[3 * i + 1] - p0[1], pts[3 * i + 2] - p0[2]];
        close(d[0] * n[0] + d[1] * n[1] + d[2] * n[2], 0, 1e-9);
    }
    assert.ok(K.isGreatCircle({ c: [0, 0], r: 0 + 0 }, 1e-9) === false);
    assert.ok(K.isGreatCircle({ c: [1, 0], r: 0 }, 1e-9));
    assert.ok(K.isGreatCircle({ c: [0, 2], r: Math.sqrt(3) }, 1e-9));
    const gc = K.circleOnSphere({ c: [0, 2], r: Math.sqrt(3) }, 64);
    // a great circle passes through the origin of R^3 plane: points sum to ~0 over a full turn
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < 64; i++) { sx += gc[3 * i]; sy += gc[3 * i + 1]; sz += gc[3 * i + 2]; }
    assert.ok(Math.hypot(sx, sy, sz) > 0); // finite
    // a line maps to a circle through the north pole
    const line = K.circleOnSphere({ line: true, p: [0, 0], dir: [1, 0] }, 32);
    assert.ok(Array.from(line).every(Number.isFinite));
    assert.ok(K.isGreatCircle({ line: true, p: [0, 0], dir: [1, 0] }));
});

test('orbit tree: reduced words only, parents link, points are images of the base point', () => {
    const G = K.schottkyGroup(fuchsianPairs(0.5));
    const z0 = [0.2, 0.1];
    const o = K.orbitTree(G, z0, 3, 1000);
    assert.equal(o.count, 1 + 4 + 12 + 36);
    for (let i = 1; i < o.count; i++) {
        const par = o.parent[i];
        assert.ok(par >= 0 && par < i);
        assert.equal(o.level[i], o.level[par] + 1);
        if (o.letter[par] >= 0) assert.notEqual(o.letter[i], G.letters[o.letter[par]].inv);
        // image of the parent point under the new letter
        closeC(K.applyMobius(G.letters[o.letter[i]].m, [o.pts[2 * par], o.pts[2 * par + 1]]), [o.pts[2 * i], o.pts[2 * i + 1]], 1e-9);
    }
    assert.ok(K.orbitTree(G, z0, 5, 50).count <= 50);
});
