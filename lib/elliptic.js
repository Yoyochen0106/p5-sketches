// Elliptic curves: real curves y^2 = x^3 + a x + b (chord-and-tangent group law with construction
// geometry), curves over F_p (enumeration, orders, group structure, discrete logs) and complex
// uniformisation by the Weierstrass p-function of the lattice Z + tau Z.
//
// Conventions
//   * The identity (point at infinity, "O") is the frozen object INF = { inf: true }; affine points are { x, y }.
//   * A line is { type: 'vertical', x } or { type: 'slope', m, c } (y = m x + c).
//   * addReal / addFp return { result, kind, line, third }:
//       kind  'identity' | 'vertical' (P = -Q, result O) | 'tangent' (P = Q) | 'chord'
//       third the third intersection R' of the line with the curve (INF for vertical lines);
//             the sum is the reflection of R' in the x axis.
//   * Complex numbers are [re, im] pairs (see lib/complex.js).

import * as C from './complex.js';

export const INF = Object.freeze({ inf: true });

/** True for the identity element (or a missing point). */
export const isInf = (P) => !P || P.inf === true;

// ======================================================================================
// (a) Real curves
// ======================================================================================

const REL_EPS = 1e-9;

/** Value of x^3 + a x + b. */
export const cubic = (a, b, x) => ((x * x) + a) * x + b;

/** Residual y^2 - (x^3 + a x + b) of a point (0 on the curve). */
export const residual = (a, b, P) => P.y * P.y - cubic(a, b, P.x);

/** Discriminant -16 (4 a^3 + 27 b^2); the curve is singular iff it is 0. */
export function discriminant(a, b) {
    return -16 * (4 * a * a * a + 27 * b * b);
}

/** Classify the curve: 'smooth', 'node' (a < 0) or 'cusp' (a = b = 0). Tolerance for dragged parameters. */
export function classify(a, b, eps = REL_EPS) {
    const d = 4 * a * a * a + 27 * b * b;
    const scale = 1 + Math.abs(a) ** 3 + b * b;
    if (Math.abs(d) > eps * scale) return 'smooth';
    return Math.abs(a) < 1e-6 && Math.abs(b) < 1e-6 ? 'cusp' : 'node';
}

/** Position of (a, b) w.r.t. the cusp curve: sign of -discriminant (>0: one real component pair rules, see components). */
export const isSingular = (a, b, eps) => classify(a, b, eps) !== 'smooth';

/** Double root s of x^3 + a x + b for singular curves (node: s = -3b/(2a), cusp: 0). */
export function singularX(a, b) {
    const k = classify(a, b);
    if (k === 'smooth') return null;
    return k === 'cusp' ? 0 : -3 * b / (2 * a);
}

/**
 * Distinct real roots of x^3 + a x + b in increasing order, as [{ x, mult }].
 * Singular curves use the exact factorisation (x - s)^2 (x + 2 s).
 */
export function realRoots(a, b) {
    const kind = classify(a, b);
    if (kind === 'cusp') return [{ x: 0, mult: 3 }];
    if (kind === 'node') {
        const s = singularX(a, b);
        return [{ x: s, mult: 2 }, { x: -2 * s, mult: 1 }].sort((u, v) => u.x - v.x);
    }
    const D = (b / 2) ** 2 + (a / 3) ** 3; // > 0: one real root
    let roots;
    if (D > 0) {
        const sq = Math.sqrt(D);
        roots = [Math.cbrt(-b / 2 + sq) + Math.cbrt(-b / 2 - sq)];
    } else {
        const r = 2 * Math.sqrt(-a / 3);
        const cosArg = Math.max(-1, Math.min(1, (3 * b) / (a * r)));
        const phi = Math.acos(cosArg) / 3;
        roots = [0, 1, 2].map((k) => r * Math.cos(phi - (2 * Math.PI * k) / 3)).sort((u, v) => u - v);
    }
    // polish with Newton so that y = 0 is exact to machine precision
    roots = roots.map((x0) => {
        let x = x0;
        for (let i = 0; i < 4; i++) {
            const d = 3 * x * x + a;
            if (Math.abs(d) < 1e-14) break;
            x -= cubic(a, b, x) / d;
        }
        return x;
    });
    return roots.map((x) => ({ x, mult: 1 }));
}

/** Number of connected real components of a smooth curve (1 or 2); 0 for singular curves. */
export function components(a, b) {
    if (classify(a, b) !== 'smooth') return 0;
    return 4 * a * a * a + 27 * b * b < 0 ? 2 : 1;
}

/** The real 2-torsion points (r, 0) (without O). A smooth curve has 1 or 3 of them. */
export function twoTorsion(a, b) {
    return realRoots(a, b).map((r) => ({ x: r.x, y: 0 }));
}

/** -P. */
export const negReal = (P) => (isInf(P) ? INF : { x: P.x, y: P.y === 0 ? 0 : -P.y });

const sameX = (P, Q) => Math.abs(P.x - Q.x) <= REL_EPS * (1 + Math.abs(P.x));
const nearZeroY = (P, scale = 1) => Math.abs(P.y) <= REL_EPS * (scale + Math.abs(P.x) ** 1.5);

/** Chord-and-tangent addition with the full construction. See the file header for the result shape. */
export function addReal(a, b, P, Q) {
    if (isInf(P)) return { result: isInf(Q) ? INF : Q, kind: 'identity', line: null, third: INF };
    if (isInf(Q)) return { result: P, kind: 'identity', line: null, third: INF };
    let m;
    if (sameX(P, Q)) {
        const opposite = Math.abs(P.y + Q.y) <= REL_EPS * (1 + Math.abs(P.y));
        if (opposite || nearZeroY(P)) {
            return { result: INF, kind: 'vertical', line: { type: 'vertical', x: P.x }, third: INF };
        }
        m = (3 * P.x * P.x + a) / (2 * P.y);
        return finishSlope(P, P, m, 'tangent');
    }
    m = (Q.y - P.y) / (Q.x - P.x);
    return finishSlope(P, Q, m, 'chord');
}

function finishSlope(P, Q, m, kind) {
    const x3 = m * m - P.x - Q.x;
    const y3 = m * (x3 - P.x) + P.y; // third intersection R'
    return {
        result: { x: x3, y: -y3 },
        kind,
        line: { type: 'slope', m, c: P.y - m * P.x },
        third: { x: x3, y: y3 },
    };
}

/** P + Q (plain result). */
export const sumReal = (a, b, P, Q) => addReal(a, b, P, Q).result;

/**
 * Left-to-right double-and-add for any group given by add(P, Q) and neg(P).
 * Returns { result, steps } where steps = [{ op: 'double' | 'add', value }] in execution order.
 */
export function scalarMul(add, neg, P, n) {
    n = Math.trunc(n);
    const steps = [];
    if (n === 0 || isInf(P)) return { result: INF, steps };
    const base = n < 0 ? neg(P) : P;
    const bits = Math.abs(n).toString(2);
    let acc = INF;
    for (let i = 0; i < bits.length; i++) {
        if (i > 0) {
            acc = add(acc, acc);
            steps.push({ op: 'double', value: acc });
        }
        if (bits[i] === '1') {
            acc = add(acc, base);
            if (i > 0) steps.push({ op: 'add', value: acc });
            else steps.push({ op: 'init', value: acc });
        }
    }
    return { result: acc, steps };
}

/** n P on a real curve with the double-and-add trace. */
export function scalarMulReal(a, b, P, n) {
    return scalarMul((u, v) => sumReal(a, b, u, v), negReal, P, n);
}

/**
 * The multiples P, 2P, 3P, ... as [{ n, point }]; stops after the first O (included) or after `max` entries.
 */
export function multiplesReal(a, b, P, max = 24) {
    const out = [];
    let acc = P;
    for (let n = 1; n <= max; n++) {
        out.push({ n, point: acc });
        if (isInf(acc)) break;
        acc = sumReal(a, b, acc, P);
    }
    return out;
}

/** Order of P when it is at most `max` (torsion), else null. */
export function orderReal(a, b, P, max = 24) {
    if (isInf(P)) return 1;
    const m = multiplesReal(a, b, P, max);
    const last = m[m.length - 1];
    return isInf(last.point) ? last.n : null;
}

function polyline(pts, extra) {
    return { pts, closed: false, isolated: false, ...extra };
}

/**
 * Sample the real curve as polylines covering x <= xmax. Returns [{ pts: [[x, y], ...], closed, isolated }].
 * Smooth curves give an optional oval (closed) and one unbounded branch; singular curves give a single
 * branch crossing itself (node) or touching a cusp, plus an isolated point for the acnode.
 */
export function samplePolylines(a, b, xmax, n = 240) {
    const out = [];
    const kind = classify(a, b);
    const roots = realRoots(a, b);
    // start of the unbounded branch: right-most root (smooth) or the simple root -2s (singular)
    const r = kind === 'smooth' ? roots[roots.length - 1].x : -2 * singularX(a, b);
    const f = (x) => Math.max(0, cubic(a, b, x));

    if (kind === 'smooth' && roots.length === 3) {
        const [r1, r2] = [roots[0].x, roots[1].x];
        const m = (r1 + r2) / 2, h = (r2 - r1) / 2;
        const pts = [];
        const N = Math.max(40, n >> 1);
        for (let i = 0; i < N; i++) {
            const th = (2 * Math.PI * i) / N;
            const x = m - h * Math.cos(th);
            pts.push([x, (Math.sin(th) >= 0 ? 1 : -1) * Math.sqrt(f(x))]);
        }
        out.push(polyline(pts, { closed: true }));
    }
    if (kind === 'node' && singularX(a, b) < 0) {
        out.push(polyline([[singularX(a, b), 0]], { isolated: true }));
    }
    if (Number.isFinite(xmax) && xmax > r) {
        const T = Math.sqrt(xmax - r);
        const s = kind === 'smooth' ? null : singularX(a, b);
        const pts = [];
        const N = n | 1;
        for (let i = 0; i < N; i++) {
            const t = -T + (2 * T * i) / (N - 1);
            const x = r + t * t;
            // x^3 + a x + b = (x - r)(x^2 + r x + a + r^2) = t^2 g(x); y = t sqrt(g), analytic through t = 0
            const y = s === null
                ? t * Math.sqrt(Math.max(0, x * x + r * x + a + r * r))
                : t * (x - s);
            pts.push([x, y]);
        }
        out.push(polyline(pts));
    }
    return out;
}

/**
 * Nearest point on the real curve to (px, py), or null for an empty/degenerate curve.
 * Returns { x, y, dist }. `polylines` may be given to reuse a sampling made with samplePolylines.
 */
export function closestPoint(a, b, px, py, polylines) {
    const roots = realRoots(a, b);
    const r = roots[roots.length - 1].x;
    const lines = polylines || samplePolylines(a, b, Math.max(px, r) + 1 + Math.cbrt(2 * py * py) + Math.sqrt(Math.abs(a)));
    let best = null, bd = Infinity, bi = -1, bl = null;
    for (const L of lines) {
        L.pts.forEach((q, i) => {
            const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
            if (d < bd) { bd = d; best = q; bi = i; bl = L; }
        });
    }
    if (!best) return null;
    // start from the nearest sample (refined on the two adjacent segments), then do closest-point iterations:
    // slide along the tangent towards (px, py) and Newton-correct back onto F = y^2 - x^3 - a x - b = 0
    let [x, y] = best;
    const nb = [];
    const k = bl.pts.length;
    if (!bl.isolated) {
        if (bi > 0 || bl.closed) nb.push(bl.pts[(bi - 1 + k) % k]);
        if (bi < k - 1 || bl.closed) nb.push(bl.pts[(bi + 1) % k]);
    }
    let bs = bd;
    for (const q of nb) {
        const dx = q[0] - best[0], dy = q[1] - best[1];
        const L2 = dx * dx + dy * dy;
        if (L2 <= 0) continue;
        const t = Math.max(0, Math.min(1, ((px - best[0]) * dx + (py - best[1]) * dy) / L2));
        const sx = best[0] + t * dx, sy = best[1] + t * dy;
        const d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bs) { bs = d; x = sx; y = sy; }
    }
    const project = () => {
        for (let i = 0; i < 6; i++) {
            const F = y * y - cubic(a, b, x);
            const gx = -(3 * x * x + a), gy = 2 * y;
            const g2 = gx * gx + gy * gy;
            if (!(g2 > 1e-24)) return false;
            x -= (F * gx) / g2;
            y -= (F * gy) / g2;
            if (Math.abs(F) < 1e-15) break;
        }
        return true;
    };
    project();
    if (!bl.isolated) {
        for (let it = 0; it < 30; it++) {
            const gx = -(3 * x * x + a), gy = 2 * y;
            const gl = Math.hypot(gx, gy);
            if (!(gl > 1e-12)) break;
            const tx = -gy / gl, ty = gx / gl;
            const s = (px - x) * tx + (py - y) * ty;
            if (Math.abs(s) < 1e-13) break;
            const ox = x, oy = y;
            x += s * tx; y += s * ty;
            if (!project() || (x - px) ** 2 + (y - py) ** 2 > (ox - px) ** 2 + (oy - py) ** 2 + 1e-12) { x = ox; y = oy; break; }
        }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || (x - px) ** 2 + (y - py) ** 2 > bd) [x, y] = best;
    return { x, y, dist: Math.hypot(x - px, y - py) };
}

/** A point on the curve with the given x and the sign of `sign` (null if x is in a gap). */
export function pointAtX(a, b, x, sign = 1) {
    const v = cubic(a, b, x);
    if (v < 0) return null;
    return { x, y: (sign < 0 ? -1 : 1) * Math.sqrt(v) };
}

// ======================================================================================
// (b) Finite fields F_p
// ======================================================================================

/** Trial-division primality test. */
export function isPrime(n) {
    if (!Number.isInteger(n) || n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
}

/** a mod p in [0, p). */
export const mod = (a, p) => ((a % p) + p) % p;

/** Modular inverse by the extended Euclid algorithm; null if gcd(a, p) != 1. */
export function modInv(a, p) {
    a = mod(a, p);
    let [r0, r1, s0, s1] = [p, a, 0, 1];
    while (r1 !== 0) {
        const q = Math.floor(r0 / r1);
        [r0, r1] = [r1, r0 - q * r1];
        [s0, s1] = [s1, s0 - q * s1];
    }
    return r0 === 1 ? mod(s0, p) : null;
}

/** Curve descriptor: { a, b, p } with a, b reduced mod p. */
export const curveFp = (a, b, p) => ({ a: mod(a, p), b: mod(b, p), p });

/** True when 4 a^3 + 27 b^2 = 0 (mod p), i.e. the cubic has a repeated root. */
export function isSingularFp(c) {
    const { a, b, p } = c;
    return mod(4 * mod(a * a * a, p) + 27 * mod(b * b, p), p) === 0;
}

/** Is P on the curve? */
export function onCurveFp(c, P) {
    if (isInf(P)) return true;
    const { a, b, p } = c;
    return mod(P.y * P.y - (P.x * P.x * P.x + a * P.x + b), p) === 0;
}

/** All affine points (x, y) of the curve, sorted by x then y. */
export function pointsFp(c) {
    const { a, b, p } = c;
    const roots = new Map();
    for (let y = 0; y < p; y++) {
        const s = (y * y) % p;
        if (!roots.has(s)) roots.set(s, []);
        roots.get(s).push(y);
    }
    const out = [];
    for (let x = 0; x < p; x++) {
        const rhs = mod(((x * x) % p) * x + a * x + b, p);
        const ys = roots.get(rhs);
        if (ys) for (const y of ys) out.push({ x, y });
    }
    return out;
}

/** Group order #E(F_p) = affine points + 1. */
export const groupOrderFp = (c, pts = pointsFp(c)) => pts.length + 1;

/** Hasse interval [lo, hi] for #E. */
export function hasseInterval(p) {
    const s = 2 * Math.sqrt(p);
    return [Math.ceil(p + 1 - s - 1e-9), Math.floor(p + 1 + s + 1e-9)];
}

/** |#E - (p + 1)| <= 2 sqrt(p). */
export function hasseOk(n, p) {
    return Math.abs(n - (p + 1)) <= 2 * Math.sqrt(p) + 1e-9;
}

/** -P. */
export const negFp = (c, P) => (isInf(P) ? INF : { x: P.x, y: mod(-P.y, c.p) });

/** Addition on E(F_p) with the (wrapped) construction. */
export function addFp(c, P, Q) {
    const { a, p } = c;
    if (isInf(P)) return { result: isInf(Q) ? INF : Q, kind: 'identity', line: null, third: INF };
    if (isInf(Q)) return { result: P, kind: 'identity', line: null, third: INF };
    let m, kind;
    if (P.x === Q.x) {
        if (mod(P.y + Q.y, p) === 0) {
            return { result: INF, kind: 'vertical', line: { type: 'vertical', x: P.x }, third: INF };
        }
        m = mod((3 * P.x * P.x + a) * modInv(2 * P.y, p), p);
        kind = 'tangent';
    } else {
        m = mod((Q.y - P.y) * modInv(Q.x - P.x, p), p);
        kind = 'chord';
    }
    const x3 = mod(m * m - P.x - Q.x, p);
    const y3 = mod(m * (x3 - P.x) + P.y, p);
    return {
        result: { x: x3, y: mod(-y3, p) },
        kind,
        line: { type: 'slope', m, c: mod(P.y - m * P.x, p) },
        third: { x: x3, y: y3 },
    };
}

/** P + Q (plain result). */
export const sumFp = (c, P, Q) => addFp(c, P, Q).result;

/** n P on E(F_p) with the double-and-add trace. */
export function scalarMulFp(c, P, n) {
    return scalarMul((u, v) => sumFp(c, u, v), (u) => negFp(c, u), P, n);
}

/** Multiples P, 2P, ..., up to and including the first O. */
export function multiplesFp(c, P, max = Infinity) {
    const out = [];
    let acc = P;
    for (let n = 1; n <= max; n++) {
        out.push({ n, point: acc });
        if (isInf(acc)) break;
        acc = sumFp(c, acc, P);
    }
    return out;
}

/** Order of P by walking the multiples (slow for big orders; see orderFromGroupFp). */
export function orderFp(c, P) {
    if (isInf(P)) return 1;
    const m = multiplesFp(c, P);
    return m[m.length - 1].n;
}

/** Order of P given the group order N: the smallest divisor d of N with dP = O. */
export function orderFromGroupFp(c, P, N) {
    if (isInf(P)) return 1;
    const divs = [];
    for (let d = 1; d * d <= N; d++) if (N % d === 0) { divs.push(d); if (d * d !== N) divs.push(N / d); }
    divs.sort((u, v) => u - v);
    for (const d of divs) if (isInf(scalarMulFp(c, P, d).result)) return d;
    return N;
}

const gcd = (u, v) => (v === 0 ? u : gcd(v, u % v));

/**
 * Group structure Z_n1 x Z_n2 with n1 | n2 (n1 = 1 for cyclic groups).
 * Returns { order, exponent, invariants: [n1, n2], cyclic, orders: Map<"x,y", order> }.
 */
export function groupStructureFp(c, pts = pointsFp(c)) {
    const N = pts.length + 1;
    const orders = new Map();
    let exp = 1;
    for (const P of pts) {
        const o = orderFromGroupFp(c, P, N);
        orders.set(`${P.x},${P.y}`, o);
        exp = (exp / gcd(exp, o)) * o;
    }
    return { order: N, exponent: exp, invariants: [N / exp, exp], cyclic: N / exp === 1, orders };
}

/** Points whose order equals the group order (empty unless the group is cyclic). */
export function generatorsFp(c, pts = pointsFp(c)) {
    const N = pts.length + 1;
    return pts.filter((P) => orderFromGroupFp(c, P, N) === N);
}

/** A point of maximal order (ties: first). Null for an empty point set. */
export function maxOrderPointFp(c, pts = pointsFp(c)) {
    const N = pts.length + 1;
    let best = null, bo = 0;
    for (const P of pts) {
        const o = orderFromGroupFp(c, P, N);
        if (o > bo) { bo = o; best = P; }
    }
    return best ? { point: best, order: bo } : null;
}

/** The cyclic subgroup <P> as a list of points (without O). */
export function subgroupFp(c, P) {
    return multiplesFp(c, P).filter((m) => !isInf(m.point)).map((m) => m.point);
}

/** Discrete-log table: Map "x,y" -> k with k G = (x, y), 1 <= k < ord(G). O is stored under "O" -> ord. */
export function dlogTableFp(c, G) {
    const t = new Map();
    for (const m of multiplesFp(c, G)) {
        if (isInf(m.point)) t.set('O', m.n);
        else t.set(`${m.point.x},${m.point.y}`, m.n);
    }
    return t;
}

/** Smallest k >= 1 with k G = Q, or null if Q is not in <G>. */
export function dlogFp(c, G, Q) {
    const t = dlogTableFp(c, G);
    const v = t.get(isInf(Q) ? 'O' : `${Q.x},${Q.y}`);
    return v === undefined ? null : v;
}

/** The points of the line (wrapped modulo p) as [x, y] pairs. */
export function lineDotsFp(line, p) {
    const out = [];
    if (!line) return out;
    if (line.type === 'vertical') {
        for (let y = 0; y < p; y++) out.push([line.x, y]);
    } else {
        for (let x = 0; x < p; x++) out.push([x, mod(line.m * x + line.c, p)]);
    }
    return out;
}

// ======================================================================================
// (c) Complex uniformisation
// ======================================================================================

const PI = Math.PI;

/** Number of q-series terms needed for |q|^n < 1e-20-ish. */
function qTerms(tau) {
    const t = Math.max(tau[1], 1e-3);
    return Math.min(4000, Math.ceil(46 / (2 * PI * t)) + 3);
}

/** e^{2 pi i tau} */
const nome = (tau) => C.exp([-2 * PI * tau[1], 2 * PI * tau[0]]);

/** Eisenstein series E4, E6 of tau (Im tau > 0), as complex numbers. */
export function eisenstein(tau) {
    const q = nome(tau);
    const N = qTerms(tau);
    let s3 = [0, 0], s5 = [0, 0];
    let qn = [1, 0];
    for (let n = 1; n <= N; n++) {
        qn = C.mul(qn, q);
        // sigma_3(n), sigma_5(n) via the q^n / (1 - q^n)^k Lambert form is cheaper: use direct divisor sums
        let d3 = 0, d5 = 0;
        for (let d = 1; d * d <= n; d++) {
            if (n % d !== 0) continue;
            const e = n / d;
            d3 += d ** 3; d5 += d ** 5;
            if (e !== d) { d3 += e ** 3; d5 += e ** 5; }
        }
        s3 = C.add(s3, C.scale(qn, d3));
        s5 = C.add(s5, C.scale(qn, d5));
        if (C.abs(qn) * d5 < 1e-30 && n > 8) break;
    }
    return { E4: C.add([1, 0], C.scale(s3, 240)), E6: C.sub([1, 0], C.scale(s5, 504)) };
}

/** Weierstrass invariants g2 = 60 G4, g3 = 140 G6 of the lattice Z + tau Z (complex). */
export function latticeInvariants(tau) {
    const { E4, E6 } = eisenstein(tau);
    return { g2: C.scale(E4, (4 * PI ** 4) / 3), g3: C.scale(E6, (8 * PI ** 6) / 27) };
}

/** Real-curve coefficients of y'^2 = x^3 + a x + b, y' = y/2, for y^2 = 4x^3 - g2 x - g3 (complex a, b). */
export function curveCoefficients(tau) {
    const { g2, g3 } = latticeInvariants(tau);
    return { a: C.scale(g2, -0.25), b: C.scale(g3, -0.25), g2, g3 };
}

/** Reduce z modulo Z + tau Z to the centred cell Im in [-t/2, t/2], Re in [-1/2, 1/2]. Returns { z, m, n }. */
export function reduceCell(z, tau) {
    const n = Math.round(z[1] / tau[1]);
    let w = C.sub(z, C.scale(tau, n));
    const m = Math.round(w[0]);
    w = [w[0] - m, w[1]];
    return { z: w, m, n };
}

/**
 * Weierstrass p(z) and p'(z) for the lattice Z + tau Z via the q-expansion. Returns { wp, dwp } (complex),
 * or null at a lattice point (pole). Works best for Im tau >= 0.1.
 */
export function wpPair(z, tau) {
    const { z: w } = reduceCell(z, tau);
    if (C.abs(w) < 1e-12) return null;
    const q = nome(tau);
    const u = C.exp([-2 * PI * w[1], 2 * PI * w[0]]); // e^{2 pi i w}
    const uInv = C.div([1, 0], u);
    const piw = C.scale(w, PI);
    const sn = C.sin(piw), cs = C.cos(piw);
    const sn2 = C.mul(sn, sn);
    const sn3 = C.mul(sn2, sn);
    let wp = C.add(C.scale(C.div([1, 0], sn2), PI * PI), [-PI * PI / 3, 0]);
    let dwp = C.scale(C.div(cs, sn3), -2 * PI ** 3);
    let sum = [0, 0], dsum = [0, 0];
    let qn = [1, 0];
    const N = qTerms(tau);
    const L = (v) => C.div(v, C.mul(C.sub([1, 0], v), C.sub([1, 0], v))); // v / (1 - v)^2
    const DL = (v) => { // v (1 + v) / (1 - v)^3
        const o = C.sub([1, 0], v);
        return C.div(C.mul(v, C.add([1, 0], v)), C.mul(C.mul(o, o), o));
    };
    for (let n = 1; n <= N; n++) {
        qn = C.mul(qn, q);
        const v = C.mul(qn, u), v2 = C.mul(qn, uInv);
        sum = C.add(sum, C.sub(C.add(L(v), L(v2)), C.scale(L(qn), 2)));
        dsum = C.add(dsum, C.scale(C.sub(DL(v), DL(v2)), 2 * PI));
        if (C.abs(qn) < 1e-18 && n > 3) break;
    }
    // (2 pi i)^2 = -4 pi^2 ; d/dz brings 2 pi i for the first term of each pair
    wp = C.add(wp, C.scale(sum, -4 * PI * PI));
    dwp = C.add(dwp, C.mul(C.scale(dsum, -4 * PI * PI), [0, 1]));
    return { wp, dwp };
}

/** Weierstrass p-function (complex) or null at poles. */
export function wp(z, tau) {
    const r = wpPair(z, tau);
    return r ? r.wp : null;
}

/** Derivative of the Weierstrass p-function (complex) or null at poles. */
export function wpPrime(z, tau) {
    const r = wpPair(z, tau);
    return r ? r.dwp : null;
}

/** Laurent series p(z) = z^-2 + sum c_k z^(2k-2) valid for |z| < shortest lattice vector (0 < |z|). */
export function wpLaurent(z, tau, terms = 14) {
    const { g2, g3 } = latticeInvariants(tau);
    const c = [];
    c[2] = C.scale(g2, 1 / 20);
    c[3] = C.scale(g3, 1 / 28);
    for (let n = 4; n <= terms; n++) {
        let s = [0, 0];
        for (let k = 2; k <= n - 2; k++) s = C.add(s, C.mul(c[k], c[n - k]));
        c[n] = C.scale(s, 3 / ((2 * n + 1) * (n - 3)));
    }
    const z2 = C.mul(z, z);
    let res = C.div([1, 0], z2);
    let zp = [1, 0];
    for (let k = 2; k <= terms; k++) {
        zp = k === 2 ? z2 : C.mul(zp, z2);
        res = C.add(res, C.mul(c[k], zp));
    }
    return res;
}

/** z -> (p(z), p'(z)) on y^2 = 4x^3 - g2 x - g3, as complex pairs { x, y }; null at lattice points. */
export function uniformize(z, tau) {
    const r = wpPair(z, tau);
    return r ? { x: r.wp, y: r.dwp } : null;
}

/** Affine point of the plot curve y'^2 = x^3 + a x + b (y' = p'/2) for real data; null at poles. */
export function uniformizeReal(z, tau) {
    const r = wpPair(z, tau);
    return r ? { x: r.wp[0], y: r.dwp[0] / 2 } : null;
}

/** True when g2, g3 are real (Re tau is 0 or 1/2 mod 1), so the curve has a real section. */
export function hasRealSection(tau, tol = 1e-9) {
    const { g2, g3 } = latticeInvariants(tau);
    return Math.abs(g2[1]) <= tol * (1 + Math.abs(g2[0])) && Math.abs(g3[1]) <= tol * (1 + Math.abs(g3[0]));
}
