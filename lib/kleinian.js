// Moebius groups and their limit sets (pure maths, no p5 / DOM). Complex numbers are [re, im].
//
// A Moebius map is [a, b, c, d] (four complex numbers): z -> (a z + b) / (c z + d), the same storage as
// lib/conformal.js.
//
//   Algebra:    mobius, identity, compose, inverse, normalise, det, trace, classify, fixedPoints,
//               attractingFixedPoint, isIdentity, applyToCircle
//   Groups:     schottkyGroup(pairs), groupFromGenerators(mats), schottkyCheck, packGroup
//               letters of a group: { m, inv (index of the inverse letter), from, to } where `from` / `to` are
//               circles { c, r }; for Schottky groups letter j maps the exterior of `from` onto the disc `to`
//   Limit sets: enumerateWords (reduced words, size cutoff), createGroupChaos / groupChaos (random walk),
//               orbitTree (orbit of a point over reduced words)
//   Recipes:    grandmasRecipe(ta, tb), maskitGroup(mu), rileyGroup(rho), solveTab
//   Apollonian: descartesCurvature, apollonianGasket, apollonianDualCircles, inversionChaos
//   Sphere:     toSphere, fromSphere, circleOnSphere, isGreatCircle
import * as C from './complex.js';
import { applyMoebius, circleFrom3Points, moebiusCircle } from './conformal.js';
import { makeRng } from './ifs.js';

const TWO_PI = 2 * Math.PI;
const isFin = (z) => Number.isFinite(z[0]) && Number.isFinite(z[1]);

// ---------------------------------------------------------------------------------------------
// Moebius algebra

export const mobius = (a, b, c, d) => [a, b, c, d];
export const identity = () => [[1, 0], [0, 0], [0, 0], [1, 0]];

export const det = (m) => C.sub(C.mul(m[0], m[3]), C.mul(m[1], m[2]));
export const trace = (m) => C.add(m[0], m[3]);

/** Matrix product m n: the map "apply n first, then m". */
export function compose(m, n) {
    return [
        C.add(C.mul(m[0], n[0]), C.mul(m[1], n[2])), C.add(C.mul(m[0], n[1]), C.mul(m[1], n[3])),
        C.add(C.mul(m[2], n[0]), C.mul(m[3], n[2])), C.add(C.mul(m[2], n[1]), C.mul(m[3], n[3])),
    ];
}

/** Inverse map (adjugate matrix; for det 1 it is the exact inverse matrix). */
export const inverse = (m) => [m[3], C.neg(m[1]), C.neg(m[2]), m[0]];

/** Scales the matrix to det = 1 (determined up to sign). Returns null for a singular matrix. */
export function normalise(m) {
    const d = det(m);
    if (C.abs(d) < 1e-300) return null;
    const s = C.sqrt(d);
    return m.map((q) => C.div(q, s));
}

export const applyMobius = applyMoebius;

export function isIdentity(m, tol = 1e-9) {
    const n = normalise(m);
    if (!n) return false;
    return C.abs(n[1]) < tol && C.abs(n[2]) < tol && C.abs(C.sub(n[0], n[3])) < tol;
}

/**
 * 'identity' | 'elliptic' | 'parabolic' | 'hyperbolic' | 'loxodromic' from the trace of the det-1 matrix:
 * real trace with |tr| < 2 elliptic, |tr| = 2 parabolic, |tr| > 2 hyperbolic, non-real trace loxodromic.
 */
export function classify(m, tol = 1e-7) {
    const n = normalise(m);
    if (!n) return 'degenerate';
    if (isIdentity(m, tol)) return 'identity';
    const t = trace(n);
    if (Math.abs(t[1]) > tol * Math.max(1, Math.abs(t[0]))) return 'loxodromic';
    const a = Math.abs(t[0]);
    if (Math.abs(a - 2) <= tol) return 'parabolic';
    return a < 2 ? 'elliptic' : 'hyperbolic';
}

/** Fixed points as complex numbers; the point at infinity is `null`. */
export function fixedPoints(m, tol = 1e-12) {
    const [a, b, c, d] = m;
    const scale = Math.max(C.abs(a), C.abs(b), C.abs(c), C.abs(d), 1e-300);
    const dm = C.sub(d, a);
    if (C.abs(c) < tol * scale) {
        if (C.abs(dm) < tol * scale) return [null]; // translation (or identity): only infinity
        return [null, C.div(b, dm)];
    }
    const disc = C.add(C.mul(dm, dm), C.scale(C.mul(b, c), 4));
    const sq = C.sqrt(disc);
    const den = C.scale(c, 2);
    const z1 = C.div(C.sub(C.neg(dm), C.neg(sq)), den);
    const z2 = C.div(C.sub(C.neg(dm), sq), den);
    if (C.abs(sq) < 1e-9 * scale) return [z1];
    return [z1, z2];
}

/** |m'(z)| at a finite fixed point z (the multiplier modulus); Infinity at a pole. */
export function multiplierAt(m, z) {
    const den = C.add(C.mul(m[2], z), m[3]);
    const dd = C.abs(den);
    return dd < 1e-300 ? Infinity : C.abs(det(m)) / (dd * dd);
}

/**
 * The attracting fixed point of a hyperbolic / loxodromic map (the one with multiplier < 1), the unique fixed
 * point of a parabolic map, null otherwise. Infinity is returned as null as well, see `attractingIsInfinity`.
 */
export function attractingFixedPoint(m) {
    const n = normalise(m);
    if (!n) return null;
    const cls = classify(n);
    if (cls === 'elliptic' || cls === 'identity' || cls === 'degenerate') return null;
    const fp = fixedPoints(n);
    if (fp.length === 1) return fp[0];
    // a fixed point at infinity has multiplier a^-2 ... for c = 0 the finite one has multiplier |d/a|^2 reversed
    if (fp[0] === null || fp[1] === null) {
        const fin = fp[0] === null ? fp[1] : fp[0];
        const mult = multiplierAt(n, fin);
        return mult < 1 ? fin : null;
    }
    return multiplierAt(n, fp[0]) < multiplierAt(n, fp[1]) ? fp[0] : fp[1];
}

/** Image of a circle { c, r } under a map: a circle { c, r } or a line { line: true, ... }. */
export function applyToCircle(m, circle) {
    return moebiusCircle(m, circle.c, circle.r);
}

// ---------------------------------------------------------------------------------------------
// Groups

/**
 * Letter j of a group: matrix m, index of the inverse letter, and the two circles it pairs.
 * `discs` (Schottky) are the images A_j = `to` of every letter.
 */
function makeLetter(m, inv, from, to) {
    return { m, inv, from, to };
}

/**
 * Schottky group from circle pairs. pairs[k] = { c1: [x, y], r1, c2: [x, y], r2, theta = 0 }.
 * Generator g_k(z) = c2 + r1 r2 e^{i theta} / (z - c1) maps the exterior of circle 1 onto the disc of circle 2
 * (it is the inversion in circle 1 followed by an orientation reversing similarity onto circle 2).
 * Letters 2k = g_k and 2k + 1 = g_k^-1.
 */
export function schottkyGroup(pairs) {
    const letters = [];
    pairs.forEach((q, k) => {
        const theta = q.theta || 0;
        const c1 = q.c1, c2 = q.c2;
        const kk = C.fromPolar(q.r1 * q.r2, theta);
        const g = normalise([c2, C.sub(kk, C.mul(c1, c2)), [1, 0], C.neg(c1)]);
        const f1 = { c: c1, r: q.r1 }, f2 = { c: c2, r: q.r2 };
        letters.push(makeLetter(g, 2 * k + 1, f1, f2));
        letters.push(makeLetter(normalise(inverse(g)), 2 * k, f2, f1));
    });
    return { kind: 'schottky', letters, discs: letters.map((l) => l.to), pairs };
}

/** Group freely generated by the given matrices (letters g_0, g_0^-1, g_1, ...). from / to = isometric circles. */
export function groupFromGenerators(mats) {
    const letters = [];
    mats.forEach((raw, k) => {
        const g = normalise(raw);
        const gi = normalise(inverse(g));
        const iso = (m, centre) => {
            const cabs = C.abs(m[2]);
            if (cabs < 1e-12) return { c: [0, 0], r: 0 };
            return { c: centre(m), r: 1 / cabs };
        };
        const fromG = iso(g, (m) => C.neg(C.div(m[3], m[2])));
        const toG = iso(g, (m) => C.div(m[0], m[2]));
        letters.push(makeLetter(g, 2 * k + 1, fromG, toG));
        letters.push(makeLetter(gi, 2 * k, toG, fromG));
    });
    return { kind: 'general', letters, discs: null };
}

/** Ping-pong check of a Schottky group: all 2n discs pairwise disjoint. { ok, minGap, residual } */
export function schottkyCheck(group) {
    const D = group.letters.map((l) => l.to);
    let minGap = Infinity;
    for (let i = 0; i < D.length; i++) {
        for (let j = i + 1; j < D.length; j++) {
            const gap = C.abs(C.sub(D[i].c, D[j].c)) - D[i].r - D[j].r;
            if (gap < minGap) minGap = gap;
        }
    }
    // each letter must map its `from` circle onto its `to` circle
    let residual = 0;
    for (const l of group.letters) {
        for (let t = 0; t < 3; t++) {
            const z = C.add(l.from.c, C.fromPolar(l.from.r, 1 + t * 2.1));
            const w = applyMoebius(l.m, z);
            residual = Math.max(residual, Math.abs(C.abs(C.sub(w, l.to.c)) - l.to.r));
        }
    }
    return { ok: minGap > 0 && residual < 1e-7, minGap, residual };
}

/** Flat typed-array form of a group for the hot loops. */
export function packGroup(group) {
    const L = group.letters.length;
    const coef = new Float64Array(8 * L);
    const inv = new Uint8Array(L);
    group.letters.forEach((l, j) => {
        for (let q = 0; q < 4; q++) { coef[8 * j + 2 * q] = l.m[q][0]; coef[8 * j + 2 * q + 1] = l.m[q][1]; }
        inv[j] = l.inv;
    });
    return { L, coef, inv };
}

// ---------------------------------------------------------------------------------------------
// Limit sets

/** Image of the disc (cx, cy, r) under the det-1 matrix given by 8 numbers at coef[o..o+7]. Returns [cx, cy, r]. */
function discImage(w, cx, cy, r, out) {
    const ar = w[0], ai = w[1], br = w[2], bi = w[3], cr = w[4], ci = w[5], dr = w[6], di = w[7];
    const c2 = cr * cr + ci * ci;
    if (c2 < 1e-24) {
        // affine map z -> (a z + b) / d
        const d2 = dr * dr + di * di;
        const ex = ar * cx - ai * cy + br, ey = ar * cy + ai * cx + bi;
        out[0] = (ex * dr + ey * di) / d2;
        out[1] = (ey * dr - ex * di) / d2;
        out[2] = Math.sqrt((ar * ar + ai * ai) / d2) * r;
        return out;
    }
    // pole p = -d / c
    const px = -(dr * cr + di * ci) / c2, py = -(di * cr - dr * ci) / c2;
    const ux = cx - px, uy = cy - py;
    const den = ux * ux + uy * uy - r * r;
    // 1 / (z - p) maps the circle to centre conj(u) / den, radius r / |den|
    const mx = ux / den, my = -uy / den;
    // W(z) = a/c - 1 / (c^2 (z - p)),  K = -1 / c^2
    const c2x = cr * cr - ci * ci, c2y = 2 * cr * ci; // c^2
    const c4 = c2x * c2x + c2y * c2y;
    const kx = -c2x / c4, ky = c2y / c4;
    const acx = (ar * cr + ai * ci) / c2, acy = (ai * cr - ar * ci) / c2; // a / c
    out[0] = acx + kx * mx - ky * my;
    out[1] = acy + kx * my + ky * mx;
    out[2] = (r / Math.abs(den)) / Math.sqrt(c4);
    return out;
}

/**
 * Reduced words of a group up to length maxDepth, breadth first, with pruning by size: the image of the
 * letter's disc (Schottky) or 1 / |c|^2 (general) below minSize makes the node a leaf. Every leaf contributes
 * the attracting fixed point of its word, a limit point.
 * @returns {{points: Float64Array, first: Uint8Array, last: Uint8Array, count, truncated, depth}}
 */
export function enumerateWords(group, { maxDepth = 8, minSize = 1e-3, maxNodes = 100000 } = {}) {
    const P = packGroup(group);
    const { L, coef, inv } = P;
    const discs = group.discs;
    const cap = Math.max(L + 1, maxNodes);
    let cur = { w: new Float64Array(8 * cap), last: new Int8Array(cap), first: new Int8Array(cap), n: 0 };
    let nxt = { w: new Float64Array(8 * cap), last: new Int8Array(cap), first: new Int8Array(cap), n: 0 };
    cur.w.set([1, 0, 0, 0, 0, 0, 1, 0]);
    cur.last[0] = -1; cur.first[0] = -1; cur.n = 1;
    const leaves = [];
    const tmp = [0, 0, 0];
    const sizeOf = (w, last) => {
        if (last < 0) return Infinity;
        if (discs) {
            const dsc = discs[last];
            return discImage(w, dsc.c[0], dsc.c[1], dsc.r, tmp)[2];
        }
        const c2 = w[4] * w[4] + w[5] * w[5];
        return c2 < 1e-24 ? Infinity : 1 / c2;
    };
    let truncated = false;
    let depth = 0;
    for (let level = 0; level < maxDepth && cur.n; level++) {
        nxt.n = 0;
        for (let i = 0; i < cur.n; i++) {
            const w = cur.w.subarray(8 * i, 8 * i + 8);
            const last = cur.last[i];
            if (last >= 0 && sizeOf(w, last) < minSize) { leaves.push([w.slice(), cur.first[i], last]); continue; }
            if (nxt.n + L > cap) { truncated = true; leaves.push([w.slice(), cur.first[i], last]); continue; }
            for (let j = 0; j < L; j++) {
                if (last >= 0 && j === inv[last]) continue;
                const o = 8 * j, q = 8 * nxt.n;
                // child = w * g_j
                for (let e = 0; e < 2; e++) { // rows
                    const r0 = e * 4;
                    const w0r = w[r0], w0i = w[r0 + 1], w1r = w[r0 + 2], w1i = w[r0 + 3];
                    for (let f = 0; f < 2; f++) { // columns
                        const g0r = coef[o + f * 2], g0i = coef[o + f * 2 + 1], g1r = coef[o + 4 + f * 2], g1i = coef[o + 5 + f * 2];
                        nxt.w[q + r0 + f * 2] = w0r * g0r - w0i * g0i + w1r * g1r - w1i * g1i;
                        nxt.w[q + r0 + f * 2 + 1] = w0r * g0i + w0i * g0r + w1r * g1i + w1i * g1r;
                    }
                }
                nxt.last[nxt.n] = j;
                nxt.first[nxt.n] = last < 0 ? j : cur.first[i];
                nxt.n++;
            }
        }
        [cur, nxt] = [nxt, cur];
        depth = level + 1;
        if (truncated) break;
    }
    for (let i = 0; i < cur.n; i++) leaves.push([cur.w.slice(8 * i, 8 * i + 8), cur.first[i], cur.last[i]]);
    const points = new Float64Array(2 * leaves.length);
    const first = new Uint8Array(leaves.length);
    const lastArr = new Uint8Array(leaves.length);
    let m = 0;
    for (const [w, f, l] of leaves) {
        if (l < 0) continue;
        const mat = [[w[0], w[1]], [w[2], w[3]], [w[4], w[5]], [w[6], w[7]]];
        let z = attractingFixedPoint(mat);
        if (!z || !isFin(z)) {
            if (discs) {
                const dsc = discs[l];
                const o3 = discImage(w, dsc.c[0], dsc.c[1], dsc.r, tmp);
                z = [o3[0], o3[1]];
            } else {
                z = applyMoebius(mat, [0, 0]);
            }
        }
        if (!isFin(z)) continue;
        points[2 * m] = z[0]; points[2 * m + 1] = z[1];
        first[m] = f; lastArr[m] = l;
        m++;
    }
    return { points: points.subarray(0, 2 * m), first: first.subarray(0, m), last: lastArr.subarray(0, m), count: m, truncated, depth };
}

/** Random-walk (chaos game) state for a group. */
export function createGroupChaos(seed = 1, z0 = [0.31, 0.17]) {
    return { x: z0[0], y: z0[1], last: -1, s: seed >>> 0, skip: 40, z0: z0.slice() };
}

/**
 * n steps of the random walk z -> g_j(z) with j uniform among the letters that are not the inverse of the
 * previous one (random reduced words). Writes the points to out[2i], out[2i + 1] and the letter to tags[i]
 * (when given). Points that blow up restart the walk. Returns how many valid points were written.
 */
export function groupChaos(packed, state, n, out, tags = null) {
    const { L, coef, inv } = packed;
    let { x, y, last, s, skip } = state;
    let m = 0;
    for (let it = 0; it < n; it++) {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        let j = last < 0 ? Math.floor(u * L) : Math.floor(u * (L - 1));
        if (last >= 0 && j >= inv[last]) j++;
        if (j >= L) j = L - 1;
        const o = 8 * j;
        const nr = coef[o] * x - coef[o + 1] * y + coef[o + 2];
        const ni = coef[o] * y + coef[o + 1] * x + coef[o + 3];
        const dr = coef[o + 4] * x - coef[o + 5] * y + coef[o + 6];
        const di = coef[o + 4] * y + coef[o + 5] * x + coef[o + 7];
        const d2 = dr * dr + di * di;
        let nx = (nr * dr + ni * di) / d2, ny = (ni * dr - nr * di) / d2;
        last = j;
        if (!(d2 > 1e-300) || nx - nx !== 0 || ny - ny !== 0 || nx > 1e9 || nx < -1e9 || ny > 1e9 || ny < -1e9) {
            nx = state.z0[0]; ny = state.z0[1]; last = -1; skip = 40;
            x = nx; y = ny;
            continue;
        }
        x = nx; y = ny;
        if (skip > 0) { skip--; continue; }
        out[2 * m] = x; out[2 * m + 1] = y;
        if (tags) tags[m] = j;
        m++;
    }
    state.x = x; state.y = y; state.last = last; state.s = s; state.skip = skip;
    return m;
}

/**
 * Orbit of the point z0 over all reduced words of length <= depth (breadth first, at most maxPoints).
 * @returns {{pts: Float64Array, parent: Int32Array, letter: Int8Array, level: Uint8Array, count}}
 */
export function orbitTree(group, z0, depth = 3, maxPoints = 500) {
    const L = group.letters.length;
    const pts = new Float64Array(2 * maxPoints), parent = new Int32Array(maxPoints).fill(-1);
    const letter = new Int8Array(maxPoints).fill(-1), level = new Uint8Array(maxPoints);
    const mats = [identity()];
    pts[0] = z0[0]; pts[1] = z0[1];
    let n = 1;
    for (let head = 0; head < n && n < maxPoints; head++) {
        if (level[head] >= depth) continue;
        for (let j = 0; j < L && n < maxPoints; j++) {
            if (letter[head] >= 0 && j === group.letters[letter[head]].inv) continue;
            // word = g_j * previous word  (the walk applies new letters on the left)
            const m = compose(group.letters[j].m, mats[head]);
            const w = applyMoebius(m, z0);
            if (!isFin(w) || Math.abs(w[0]) > 1e7 || Math.abs(w[1]) > 1e7) continue;
            mats[n] = m; pts[2 * n] = w[0]; pts[2 * n + 1] = w[1];
            parent[n] = head; letter[n] = j; level[n] = level[head] + 1;
            n++;
        }
    }
    return { pts: pts.subarray(0, 2 * n), parent: parent.subarray(0, n), letter: letter.subarray(0, n), level: level.subarray(0, n), count: n };
}

// ---------------------------------------------------------------------------------------------
// Two generator recipes (Mumford, Series, Wright: Indra's Pearls)

/** The two roots of tab^2 - ta tb tab + ta^2 + tb^2 = 0; the parabolic commutator tr[a, b] = -2 solved for tr(ab). */
export function solveTab(ta, tb, branch = -1) {
    const p = C.mul(ta, tb);
    const disc = C.sub(C.mul(p, p), C.scale(C.add(C.mul(ta, ta), C.mul(tb, tb)), 4));
    return C.scale(C.add(p, branch < 0 ? C.neg(C.sqrt(disc)) : C.sqrt(disc)), 0.5);
}

/**
 * Grandma's recipe: generators a, b with tr a = ta, tr b = tb and tr[a, b] = -2 (the commutator is parabolic).
 * @returns {{a, b, tab, z0}} or null at degenerate parameters
 */
export function grandmasRecipe(ta, tb, branch = -1) {
    const I = [0, 1];
    const tab = solveTab(ta, tb, branch);
    const two = [2, 0];
    const z0den = C.add(C.sub(C.mul(tb, tab), C.scale(ta, 2)), C.mul(C.scale(I, 2), tab));
    if (C.abs(z0den) < 1e-12) return null;
    const z0 = C.div(C.mul(C.sub(tab, two), tb), z0den);
    const e1 = C.add(C.sub(C.mul(ta, tab), C.scale(tb, 2)), C.scale(I, 4)); // ta tab - 2 tb + 4i
    const e2 = C.sub(C.sub(C.mul(ta, tab), C.scale(tb, 2)), C.scale(I, 4)); // ta tab - 2 tb - 4i
    const d1 = C.mul(C.add(C.scale(tab, 2), [4, 0]), z0);
    const d2 = C.sub(C.scale(tab, 2), [4, 0]);
    if (C.abs(d1) < 1e-12 || C.abs(d2) < 1e-12) return null;
    const a = [C.scale(ta, 0.5), C.div(e1, d1), C.div(C.mul(e2, z0), d2), C.scale(ta, 0.5)];
    const b = [C.scale(C.sub(tb, C.scale(I, 2)), 0.5), C.scale(tb, 0.5), C.scale(tb, 0.5), C.scale(C.add(tb, C.scale(I, 2)), 0.5)];
    if (![...a, ...b].every(isFin)) return null;
    return { a, b, tab, z0 };
}

/** Maskit slice: b parabolic (tr b = 2), tr a = mu, parabolic commutator. */
export const maskitGroup = (mu) => grandmasRecipe(mu, [2, 0]);

/** Riley slice: a = [[1, 1], [0, 1]], b = [[1, 0], [rho, 1]] (both parabolic). */
export function rileyGroup(rho) {
    return { a: [[1, 0], [1, 0], [0, 0], [1, 0]], b: [[1, 0], [0, 0], rho, [1, 0]] };
}

/** tr(a b a^-1 b^-1) */
export function commutatorTrace(a, b) {
    return trace(compose(compose(a, b), compose(inverse(a), inverse(b))));
}

// ---------------------------------------------------------------------------------------------
// Apollonian gasket

/** Both solutions k4 of Descartes' theorem (k1 + k2 + k3 + k4)^2 = 2 (k1^2 + k2^2 + k3^2 + k4^2). */
export function descartesCurvature(k1, k2, k3) {
    const s = k1 + k2 + k3;
    const q = 2 * Math.sqrt(Math.max(0, k1 * k2 + k2 * k3 + k3 * k1));
    return [s + q, s - q];
}

/** The standard start: the unit circle (curvature -1) with two circles of radius 1/2 and one of radius 1/3. */
export const APOLLONIAN_START = [
    { k: -1, c: [0, 0] }, { k: 2, c: [0.5, 0] }, { k: 2, c: [-0.5, 0] }, { k: 3, c: [0, 2 / 3] },
].map((q) => ({ ...q, r: 1 / Math.abs(q.k) }));

/**
 * Apollonian gasket by the Descartes recursion: replacing one circle of a mutually tangent quadruple by the
 * other circle tangent to the remaining three gives k' = 2 (k1 + k2 + k3) - k and (k' z') = 2 sum(k_i z_i) - k z.
 * Circles with radius below minRadius are not generated or expanded.
 * @returns {{circles: {k, c, r}[], quads: number[][]}} quads: index quadruples of mutually tangent circles
 */
export function apollonianGasket({ depth = 5, minRadius = 0, maxCircles = 20000, start = APOLLONIAN_START } = {}) {
    const circles = start.map((q) => ({ k: q.k, c: q.c.slice(), r: 1 / Math.abs(q.k) }));
    const quads = [[0, 1, 2, 3]];
    const stack = [];
    const spawn = (quad, skip, d) => {
        for (let i = 0; i < 4; i++) {
            if (i === skip) continue;
            if (circles.length >= maxCircles) return;
            const rest = quad.filter((_, t) => t !== i).map((t) => circles[t]);
            const old = circles[quad[i]];
            const k = 2 * (rest[0].k + rest[1].k + rest[2].k) - old.k;
            if (!(Math.abs(k) > 1e-12)) continue;
            const kz = [0, 1].map((e) => 2 * (rest[0].k * rest[0].c[e] + rest[1].k * rest[1].c[e] + rest[2].k * rest[2].c[e]) - old.k * old.c[e]);
            const r = 1 / Math.abs(k);
            if (r < minRadius) continue;
            circles.push({ k, c: [kz[0] / k, kz[1] / k], r });
            const nq = quad.slice();
            nq[i] = circles.length - 1;
            quads.push(nq);
            if (d > 1) stack.push([nq, i, d - 1]);
        }
    };
    spawn([0, 1, 2, 3], -1, depth);
    while (stack.length) {
        const [q, skip, d] = stack.pop();
        spawn(q, skip, d);
    }
    return { circles, quads };
}

/** Circles { c, r } (or lines { line, p, dir }) through the three tangent points of the other three circles, one per start circle. */
export function apollonianDualCircles(start = APOLLONIAN_START) {
    const tang = (p, q) => C.scale(C.add(C.scale(p.c, p.k), C.scale(q.c, q.k)), 1 / (p.k + q.k));
    return start.map((_, j) => {
        const o = start.filter((__, i) => i !== j);
        return circleFrom3Points(tang(o[0], o[1]), tang(o[1], o[2]), tang(o[0], o[2])); // a circle { c, r } or a line
    });
}

/** Inversion of the point z in a circle { c, r } (reflection when `circle` is a line { line, p, dir }). */
export function invertInCircle(circle, z) {
    if (circle.line) {
        const dx = z[0] - circle.p[0], dy = z[1] - circle.p[1];
        const along = dx * circle.dir[0] + dy * circle.dir[1];
        return [2 * (circle.p[0] + along * circle.dir[0]) - z[0], 2 * (circle.p[1] + along * circle.dir[1]) - z[1]];
    }
    const dx = z[0] - circle.c[0], dy = z[1] - circle.c[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-300) return [Infinity, Infinity];
    const k = (circle.r * circle.r) / d2;
    return [circle.c[0] + dx * k, circle.c[1] + dy * k];
}

/**
 * Chaos game for the reflection group generated by the inversions in the dual circles (a set of circles,
 * default: those of the standard gasket); its limit set is the gasket. Returns Float64Array(2 n) of points.
 */
export function inversionChaos(circles, n, { seed = 1, burn = 40 } = {}) {
    const rng = makeRng(seed);
    const m = circles.length;
    const out = new Float64Array(2 * n);
    const tag = new Uint8Array(n);
    let z = [0.1, 0.2], last = -1, count = 0;
    for (let i = 0; i < n + burn; i++) {
        let j = Math.floor(rng() * (last < 0 ? m : m - 1));
        if (last >= 0 && j >= last) j++;
        z = invertInCircle(circles[j], z);
        last = j;
        if (!isFin(z)) { z = [0.1, 0.2]; last = -1; continue; }
        if (i >= burn) { out[2 * count] = z[0]; out[2 * count + 1] = z[1]; tag[count] = j; count++; }
    }
    return { points: out.subarray(0, 2 * count), tags: tag.subarray(0, count), count };
}

// ---------------------------------------------------------------------------------------------
// Riemann sphere

/** Inverse stereographic projection of the plane onto the unit sphere (infinity -> north pole). */
export function toSphere(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [0, 0, 1];
    const r2 = x * x + y * y, d = 1 + r2;
    return [(2 * x) / d, (2 * y) / d, (r2 - 1) / d];
}

/** Stereographic projection from the north pole; the pole itself gives [Infinity, Infinity]. */
export function fromSphere(p) {
    const d = 1 - p[2];
    if (Math.abs(d) < 1e-15) return [Infinity, Infinity];
    return [p[0] / d, p[1] / d];
}

/** True if the plane circle (c, r) corresponds to a great circle of the sphere: |c|^2 = 1 + r^2. */
export function isGreatCircle(circle, tol = 1e-6) {
    if (circle.line) return Math.abs(circle.p[0] * circle.dir[1] - circle.p[1] * circle.dir[0]) < tol; // line through the origin
    return Math.abs(circle.c[0] ** 2 + circle.c[1] ** 2 - 1 - circle.r ** 2) < tol * Math.max(1, circle.r ** 2);
}

/** n + 1 points (Float64Array, 3 per point, closed) of the circle (c, r) or line on the sphere. */
export function circleOnSphere(circle, n = 96) {
    const out = new Float64Array(3 * (n + 1));
    const L = circle.line ? 1 + Math.hypot(circle.p[0], circle.p[1]) : 0;
    for (let i = 0; i <= n; i++) {
        const t = (TWO_PI * (i % n)) / n;
        let p;
        if (circle.line) {
            // p + s dir with s = L tan(phi / 2), phi in (-pi, pi): sweeps the whole line, the end point is infinity
            const phi = t - Math.PI;
            const s = i % n === 0 ? Infinity : L * Math.tan(phi / 2);
            p = Number.isFinite(s) ? toSphere(circle.p[0] + s * circle.dir[0], circle.p[1] + s * circle.dir[1]) : [0, 0, 1];
        } else {
            p = toSphere(circle.c[0] + circle.r * Math.cos(t), circle.c[1] + circle.r * Math.sin(t));
        }
        out[3 * i] = p[0]; out[3 * i + 1] = p[1]; out[3 * i + 2] = p[2];
    }
    return out;
}
