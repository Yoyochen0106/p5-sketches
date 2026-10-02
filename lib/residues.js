// Complex integration & residues: rational functions with poles of any order (optionally times an entire
// factor e^{k z}), exact residues by the derivative formula (via Taylor series arithmetic), adaptive
// Gauss-Legendre contour integrals, winding numbers, the argument principle (image curves, Nyquist), the classic
// real integrals by contour methods, Laurent coefficients and Bromwich (inverse Laplace) integrals.
// Pure functions on [re, im] tuples: no p5 / DOM.

import * as C from './complex.js';
import { polyFromRoots, polyRoots } from './conformal.js';

export const TWO_PI = 2 * Math.PI;
const isFin = (z) => Number.isFinite(z[0]) && Number.isFinite(z[1]);
const cx = (re, im = 0) => [re, im];
/** 1 / (2 pi i) as a complex number. */
const INV_2PI_I = [0, -1 / TWO_PI];

// ---------------------------------------------------------------------------------------------
// Polynomial / power-series helpers (ascending complex coefficients)

/** Product of two ascending polynomials. */
export function polyMul(a, b) {
    const out = Array.from({ length: a.length + b.length - 1 }, () => [0, 0]);
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            const t = C.mul(a[i], b[j]);
            out[i + j][0] += t[0];
            out[i + j][1] += t[1];
        }
    }
    return out;
}

/** Sum of two ascending polynomials. */
export function polyAdd(a, b) {
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n }, (_, k) => C.add(a[k] || [0, 0], b[k] || [0, 0]));
}

/** Multiply every coefficient by a complex scalar. */
export const polyScale = (a, s) => a.map((c) => C.mul(c, s));

/** Coefficients of q(w) = poly(p + w) (Taylor expansion of the polynomial around p, exact). */
export function polyShift(coef, p) {
    const c = coef.map((z) => [z[0], z[1]]);
    const n = c.length - 1;
    for (let i = 0; i < n; i++) {
        for (let j = n - 1; j >= i; j--) {
            const t = C.mul(p, c[j + 1]);
            c[j] = [c[j][0] + t[0], c[j][1] + t[1]];
        }
    }
    return c;
}

/** First n coefficients of the product of two power series. */
export function seriesMul(a, b, n) {
    const out = Array.from({ length: n }, () => [0, 0]);
    for (let i = 0; i < Math.min(n, a.length); i++) {
        for (let j = 0; i + j < n && j < b.length; j++) {
            const t = C.mul(a[i], b[j]);
            out[i + j][0] += t[0];
            out[i + j][1] += t[1];
        }
    }
    return out;
}

/** First n coefficients of the quotient a / b of two power series (b[0] != 0). */
export function seriesDiv(a, b, n) {
    const q = [];
    for (let k = 0; k < n; k++) {
        let s = a[k] || [0, 0];
        for (let j = 1; j <= k && j < b.length; j++) s = C.sub(s, C.mul(b[j], q[k - j]));
        q.push(C.div(s, b[0]));
    }
    return q;
}

/** Taylor coefficients (about 0) of e^{a w}, n terms. */
export function expSeries(a, n) {
    const out = [];
    let t = [1, 0];
    for (let j = 0; j < n; j++) {
        out.push(t);
        t = C.scale(C.mul(t, a), 1 / (j + 1));
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Rational functions with multiple poles:  f(z) = num(z) * e^{expk z} / prod (z - p_j)^{m_j}

/**
 * @param {{num?: number[][], poles?: {z:number[], m:number}[], expk?: number[]}} spec
 *   num: ascending complex coefficients; poles: positions with orders (positions must be distinct);
 *   expk: complex k of the entire factor e^{k z}.
 */
export function makeRational({ num = [[1, 0]], poles = [], expk = [0, 0] } = {}) {
    return { num: num.map((c) => [c[0], c[1]]), poles: poles.map((q) => ({ z: [q.z[0], q.z[1]], m: Math.max(1, q.m | 0) })), expk: [expk[0], expk[1]] };
}

/** Value f(z); poles give [Infinity, Infinity]. */
export function evalRational(r, z) {
    let n = [0, 0];
    for (let k = r.num.length - 1; k >= 0; k--) n = C.add(C.mul(n, z), r.num[k]);
    let d = [1, 0];
    for (const q of r.poles) {
        const w = C.sub(z, q.z);
        d = C.mul(d, q.m === 1 ? w : C.powInt(w, q.m));
    }
    if (d[0] === 0 && d[1] === 0) return [Infinity, Infinity];
    let v = C.div(n, d);
    if (r.expk[0] !== 0 || r.expk[1] !== 0) v = C.mul(v, C.exp(C.mul(r.expk, z)));
    return v;
}

/**
 * f = zero-factor * sum_j c_j / (z - p_j)^{m_j}, optionally times e^{expk z}. Terms may share a position (the
 * pole order is then the largest). Returns a rational object (see makeRational).
 */
export function fromPartialFractions(terms, zeros = [], expk = [0, 0]) {
    const merged = [];
    for (const t of terms) {
        const hit = merged.find((q) => C.abs(C.sub(q.z, t.z)) < 1e-9);
        if (hit) hit.m = Math.max(hit.m, t.m);
        else merged.push({ z: t.z, m: t.m });
    }
    let num = [[0, 0]];
    for (const t of terms) {
        let prod = [t.c];
        for (const q of merged) {
            const same = C.abs(C.sub(q.z, t.z)) < 1e-9;
            const e = q.m - (same ? t.m : 0);
            for (let k = 0; k < e; k++) prod = polyMul(prod, [C.neg(q.z), [1, 0]]);
        }
        num = polyAdd(num, prod);
    }
    if (zeros.length) num = polyMul(num, polyFromRoots(zeros));
    return makeRational({ num, poles: merged, expk });
}

/** gain * prod(z - zeros) / prod (z - p)^m. `poles` is [{z, m}]. */
export function fromFactored({ zeros = [], poles = [], gain = [1, 0], expk = [0, 0] }) {
    const num = polyScale(zeros.length ? polyFromRoots(zeros) : [[1, 0]], gain);
    return makeRational({ num, poles, expk });
}

/** Cluster nearly equal roots into [{z, m}] (arithmetic mean of each cluster). */
export function groupRoots(roots, tol = 2e-4) {
    const groups = [];
    for (const z of roots) {
        const g = groups.find((q) => C.abs(C.sub(q.z, z)) < tol * Math.max(1, C.abs(z)));
        if (g) {
            g.z = [(g.z[0] * g.m + z[0]) / (g.m + 1), (g.z[1] * g.m + z[1]) / (g.m + 1)];
            g.m += 1;
        } else groups.push({ z: [z[0], z[1]], m: 1 });
    }
    return groups;
}

/** Parse "1,2,1" into numbers (highest power first); null if invalid or empty. */
export function parseCoefs(text) {
    const parts = String(text === undefined || text === null ? '' : text).split(/[,\s]+/).filter((s) => s.length);
    const v = parts.map(Number);
    return v.length && v.every(Number.isFinite) ? v : null;
}

/** Rational function K * num(s) / den(s) from real coefficient lists (highest power first). */
export function rationalFromCoefs(numHigh, denHigh, K = 1) {
    const toAsc = (a) => a.slice().reverse().map((v) => [v, 0]);
    let den = toAsc(denHigh);
    while (den.length > 1 && den[den.length - 1][0] === 0) den.pop();
    const lead = den[den.length - 1];
    const poles = groupRoots(polyRoots(den));
    const num = polyScale(toAsc(numHigh), C.div([K, 0], lead));
    return makeRational({ num, poles });
}

/** Residue of f at pole index k by the derivative formula Res = g^{(m-1)}(p) / (m-1)!, g = (z-p)^m f. */
export function residueAt(r, k) {
    const { z: p, m } = r.poles[k];
    let D = [[1, 0]];
    r.poles.forEach((q, j) => {
        if (j === k) return;
        for (let i = 0; i < q.m; i++) D = polyMul(D, [C.neg(q.z), [1, 0]]);
    });
    const Ds = polyShift(D, p);
    if (C.abs(Ds[0]) === 0) return [NaN, NaN];
    const Ns = polyShift(r.num, p);
    let g = seriesMul(Ns, expSeries(r.expk, m), m);
    g = seriesDiv(g, Ds, m);
    let res = g[m - 1];
    if (r.expk[0] !== 0 || r.expk[1] !== 0) res = C.mul(res, C.exp(C.mul(r.expk, p)));
    return res;
}

/** Residues at all poles of r (same order as r.poles). */
export const residues = (r) => r.poles.map((_, k) => residueAt(r, k));

/** Numerical residue (1/2 pi i) oint f dz on a small circle (trapezoid rule). */
export function residueNumeric(f, z0, rho = 1e-3, n = 128) {
    let s = [0, 0];
    for (let k = 0; k < n; k++) {
        const th = (TWO_PI * k) / n;
        const e = C.fromPolar(rho, th);
        s = C.add(s, C.mul(f(C.add(z0, e)), e));
    }
    return C.scale(s, 1 / n);
}

// ---------------------------------------------------------------------------------------------
// Gauss-Legendre and adaptive contour integration

const GL_ORDER = 10;
const GL = (() => {
    const n = GL_ORDER;
    const x = new Array(n);
    const w = new Array(n);
    for (let i = 0; i < n; i++) {
        let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
        let dp = 1;
        for (let it = 0; it < 100; it++) {
            let p1 = 1;
            let p2 = 0;
            for (let j = 0; j < n; j++) {
                const p3 = p2;
                p2 = p1;
                p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
            }
            dp = (n * (z * p1 - p2)) / (z * z - 1);
            const dz = p1 / dp;
            z -= dz;
            if (Math.abs(dz) < 1e-15) break;
        }
        x[i] = z;
        w[i] = 2 / ((1 - z * z) * dp * dp);
    }
    return { x, w };
})();

/** Gauss-Legendre nodes / weights on [-1, 1] (order 10). */
export const gaussLegendre = () => ({ x: GL.x.slice(), w: GL.w.slice() });

function glPanel(F, a, b) {
    const h = (b - a) / 2;
    const m = (a + b) / 2;
    let re = 0;
    let im = 0;
    let mag = 0;
    for (let i = 0; i < GL_ORDER; i++) {
        const v = F(m + h * GL.x[i]);
        re += GL.w[i] * v[0];
        im += GL.w[i] * v[1];
        mag += GL.w[i] * Math.hypot(v[0], v[1]);
    }
    return [re * h, im * h, Math.abs(mag * h)];
}

/**
 * Adaptive Gauss-Legendre quadrature of a complex-valued F(t) on [a, b] (interval bisection with an error
 * estimate from the 1 vs 2 panel comparison). Returns { value, err, evals, ok }; ok = false when a sample is
 * not finite or the depth / evaluation budget was exhausted.
 */
export function integrateAdaptive(F, a, b, { tol = 1e-10, maxDepth = 18, maxEvals = 80000 } = {}) {
    let evals = 0;
    let bad = false;
    const G = (t) => {
        evals++;
        const v = F(t);
        if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) bad = true;
        return v && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : [0, 0];
    };
    const len = b - a;
    if (!(Math.abs(len) > 0)) return { value: [0, 0], err: 0, evals: 0, ok: true };
    const stack = [{ a, b, I: glPanel(G, a, b), d: 0 }];
    let total = [0, 0];
    let err = 0;
    let exhausted = false;
    while (stack.length) {
        const s = stack.pop();
        const m = (s.a + s.b) / 2;
        const L = glPanel(G, s.a, m);
        const R = glPanel(G, m, s.b);
        const sum = [L[0] + R[0], L[1] + R[1]];
        const noise = 5e-13 * (L[2] + R[2]);
        const e = Math.hypot(sum[0] - s.I[0], sum[1] - s.I[1]);
        // absolute share of the tolerance, but never demand more than the round-off floor of the piece
        const tolSeg = Math.max((tol * Math.abs(s.b - s.a)) / Math.abs(len), noise);
        if (e <= tolSeg || s.d >= maxDepth || evals >= maxEvals) {
            if (e > tolSeg) exhausted = true;
            total = [total[0] + sum[0], total[1] + sum[1]];
            err += e;
        } else {
            stack.push({ a: s.a, b: m, I: L, d: s.d + 1 });
            stack.push({ a: m, b: s.b, I: R, d: s.d + 1 });
        }
    }
    return { value: bad ? [NaN, NaN] : total, err, evals, ok: !bad && !exhausted };
}

// ---------------------------------------------------------------------------------------------
// Contours: { kind: 'circle', c, r } | { kind: 'poly', pts } (closed polygon / free-drawn loop)

/** Parametrised pieces { z(t), dz(t), t0, t1 } of a closed contour (circle -> `arcs` arcs). */
export function contourSegments(contour, arcs = 8) {
    const segs = [];
    if (contour.kind === 'circle') {
        const { c, r } = contour;
        for (let k = 0; k < arcs; k++) {
            segs.push({
                t0: (TWO_PI * k) / arcs, t1: (TWO_PI * (k + 1)) / arcs,
                z: (t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)],
                dz: (t) => [-r * Math.sin(t), r * Math.cos(t)],
            });
        }
        return segs;
    }
    const pts = contour.pts;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const d = [b[0] - a[0], b[1] - a[1]];
        segs.push({ t0: 0, t1: 1, z: (t) => [a[0] + d[0] * t, a[1] + d[1] * t], dz: () => d });
    }
    return segs;
}

/** Integrate f over a list of segments; the result carries evals and ok. */
export function integrateSegments(f, segs, opts = {}) {
    let value = [0, 0];
    let evals = 0;
    let ok = true;
    let err = 0;
    const tol = (opts.tol || 1e-10) / Math.max(1, segs.length);
    for (const s of segs) {
        const r = integrateAdaptive((t) => C.mul(f(s.z(t)), s.dz(t)), s.t0, s.t1, { ...opts, tol });
        value = C.add(value, r.value);
        evals += r.evals;
        err += r.err;
        ok = ok && r.ok;
    }
    return { value, evals, ok, err };
}

/** Contour integral oint f(z) dz (counter-clockwise for circles, vertex order for polygons). */
export const integrateContour = (f, contour, opts = {}) => integrateSegments(f, contourSegments(contour), opts);

/** Closed polyline of a contour (for drawing and winding tests). */
export function contourPolyline(contour, n = 128) {
    if (contour.kind === 'circle') {
        return Array.from({ length: n }, (_, k) => {
            const t = (TWO_PI * k) / n;
            return [contour.c[0] + contour.r * Math.cos(t), contour.c[1] + contour.r * Math.sin(t)];
        });
    }
    return contour.pts.map((q) => [q[0], q[1]]);
}

/** Winding number of a closed polyline (last point joined to the first) around z (crossing-number algorithm). */
export function windingOfPolyline(pts, z) {
    let wn = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const left = (b[0] - a[0]) * (z[1] - a[1]) - (z[0] - a[0]) * (b[1] - a[1]);
        if (a[1] <= z[1]) {
            if (b[1] > z[1] && left > 0) wn++;
        } else if (b[1] <= z[1] && left < 0) wn--;
    }
    return wn;
}

/** Winding number of a contour around z. */
export function windingNumber(contour, z) {
    if (contour.kind === 'circle') return Math.hypot(z[0] - contour.c[0], z[1] - contour.c[1]) < contour.r ? 1 : 0;
    return windingOfPolyline(contour.pts, z);
}

/** Distance from z to the contour curve. */
export function distanceToContour(contour, z) {
    if (contour.kind === 'circle') return Math.abs(Math.hypot(z[0] - contour.c[0], z[1] - contour.c[1]) - contour.r);
    const pts = contour.pts;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((z[0] - a[0]) * dx + (z[1] - a[1]) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(z[0] - a[0] - t * dx, z[1] - a[1] - t * dy));
    }
    return best;
}

/**
 * The residue theorem on a concrete contour: numerical oint f dz against 2 pi i sum w(C, p_k) Res_k.
 * Returns { integral, predicted, discrepancy, enclosed: [{k, w, res}], onContour, evals, ok }.
 */
export function residueTheorem(r, contour, opts = {}) {
    const res = residues(r);
    const enclosed = [];
    let sum = [0, 0];
    let onContour = false;
    r.poles.forEach((q, k) => {
        if (distanceToContour(contour, q.z) < 1e-6) onContour = true;
        const w = windingNumber(contour, q.z);
        if (w !== 0) {
            enclosed.push({ k, w, res: res[k] });
            sum = C.add(sum, C.scale(res[k], w));
        }
    });
    const predicted = C.mul([0, TWO_PI], sum);
    const num = integrateContour((z) => evalRational(r, z), contour, opts);
    return {
        integral: num.value, predicted, enclosed, onContour, evals: num.evals, ok: num.ok && !onContour,
        discrepancy: C.abs(C.sub(num.value, predicted)),
    };
}

/**
 * Cauchy's integral formula for derivatives: f^{(n)}(a) = n!/(2 pi i) oint f(z) / (z - a)^{n+1} dz.
 * Returns the recovered complex value (only valid when f is analytic inside the contour and a is inside).
 */
export function cauchyIntegral(g, a, contour, n = 0, opts = {}) {
    const integrand = (z) => C.div(g(z), C.powInt(C.sub(z, a), n + 1));
    const r = integrateContour(integrand, contour, opts);
    let fact = 1;
    for (let k = 2; k <= n; k++) fact *= k;
    return { value: C.scale(C.mul(r.value, INV_2PI_I), fact), evals: r.evals, ok: r.ok };
}

// ---------------------------------------------------------------------------------------------
// Argument principle

/**
 * Image of a closed polyline under f, refined adaptively so that the argument of f - center changes by less than
 * `maxStep` per step. Returns { pts: image points (closed, first point not repeated), zs: refined contour points,
 * turns: real winding number around `center`, winding: rounded winding number, nearCenter: min |f - center| }.
 */
export function traceImage(f, zpts, { center = [0, 0], maxStep = 0.2, maxPts = 40000, maxDepth = 24 } = {}) {
    const n = zpts.length;
    const zs = [];
    const ws = [];
    let total = 0;
    let nearCenter = Infinity;
    const val = (z) => {
        const v = f(z);
        return isFin(v) ? v : null;
    };
    const rel = (w) => [w[0] - center[0], w[1] - center[1]];
    const angStep = (u, v) => {
        let d = Math.atan2(v[1], v[0]) - Math.atan2(u[1], u[0]);
        while (d > Math.PI) d -= TWO_PI;
        while (d <= -Math.PI) d += TWO_PI;
        return d;
    };
    // recursive refinement of segment (za, wa) -> (zb, wb); emits points after za up to and including zb
    const seg = (za, wa, zb, wb, depth) => {
        const ua = rel(wa);
        const ub = rel(wb);
        const d = angStep(ua, ub);
        const la = Math.hypot(ua[0], ua[1]);
        const lb = Math.hypot(ub[0], ub[1]);
        const jump = la > 0 && lb > 0 ? Math.abs(Math.log(lb / la)) : 0;
        if ((Math.abs(d) > maxStep || jump > 0.7) && depth < maxDepth && zs.length < maxPts) {
            const zm = [(za[0] + zb[0]) / 2, (za[1] + zb[1]) / 2];
            const wm = val(zm);
            if (wm) {
                seg(za, wa, zm, wm, depth + 1);
                seg(zm, wm, zb, wb, depth + 1);
                return;
            }
        }
        total += d;
        nearCenter = Math.min(nearCenter, lb);
        zs.push(zb);
        ws.push(wb);
    };
    const first = val(zpts[0]);
    if (!first) return { pts: [], zs: [], turns: NaN, winding: NaN, nearCenter: 0 };
    zs.push(zpts[0]);
    ws.push(first);
    nearCenter = Math.hypot(first[0] - center[0], first[1] - center[1]);
    let prevZ = zpts[0];
    let prevW = first;
    for (let i = 1; i <= n; i++) {
        const z = zpts[i % n];
        const w = val(z);
        if (!w) return { pts: ws, zs, turns: NaN, winding: NaN, nearCenter: 0 };
        seg(prevZ, prevW, z, w, 0);
        prevZ = z;
        prevW = w;
    }
    zs.pop();
    ws.pop();
    const turns = total / TWO_PI;
    return { pts: ws, zs, turns, winding: Math.round(turns) || 0, nearCenter };
}

/** Expected (zeros - poles) inside a contour from the winding numbers of zeros / poles (given with multiplicity). */
export function zerosMinusPoles(zeros, poles, contour) {
    let N = 0;
    let P = 0;
    for (const z of zeros) N += windingNumber(contour, z.z || z) * (z.m || 1);
    for (const q of poles) P += windingNumber(contour, q.z || q) * (q.m || 1);
    return { zeros: N, poles: P, diff: N - P };
}

/** Closed polyline of a contour built for the argument principle (circle / polygon) with `n` samples per circle. */
export const argContourPoints = (contour, n = 160) => contourPolyline(contour, n);

/**
 * The Nyquist D contour (clockwise): up the imaginary axis from -jR to +jR (indenting to the right around
 * poles at j*w for each w in `axisPoles`, radius eps), then the big arc through +R back to -jR.
 */
export function dContour({ R = 20, eps = 0.05, axisPoles = [], nAxis = 240, nArc = 90, nInd = 24 } = {}) {
    const pts = [];
    const ws = Array.from(new Set(axisPoles.map((w) => +w.toFixed(9)))).sort((a, b) => a - b);
    const addLine = (y0, y1, n) => {
        for (let k = 0; k < n; k++) pts.push([0, y0 + ((y1 - y0) * k) / n]);
    };
    let y = -R;
    for (const w of ws) {
        const lo = w - eps;
        if (lo > y) addLine(y, lo, Math.max(2, Math.round((nAxis * (lo - y)) / (2 * R))));
        for (let k = 0; k <= nInd; k++) {
            const ph = -Math.PI / 2 + (Math.PI * k) / nInd;
            pts.push([eps * Math.cos(ph), w + eps * Math.sin(ph)]);
        }
        y = w + eps;
    }
    if (R > y) addLine(y, R, Math.max(2, Math.round((nAxis * (R - y)) / (2 * R))));
    for (let k = 0; k < nArc; k++) {
        const ph = Math.PI / 2 - (Math.PI * k) / nArc;
        pts.push([R * Math.cos(ph), R * Math.sin(ph)]);
    }
    return pts;
}

/** Open-loop transfer function L(s) = K num / den * e^{-s delay} from zeros / poles lists ([re,im] each, multiplicity by repetition). */
export function loopTransfer({ zeros = [], poles = [], K = 1, delay = 0 }) {
    return (s) => {
        let v = [K, 0];
        for (const z of zeros) v = C.mul(v, C.sub(s, z));
        for (const q of poles) v = C.div(v, C.sub(s, q));
        if (delay) v = C.mul(v, C.exp([-s[0] * delay, -s[1] * delay]));
        return v;
    };
}

/**
 * Nyquist criterion: encirclements of -1 by L(D). Returns { contour, image, W (counter-clockwise encirclements of
 * -1), P (open-loop poles with Re > 0), Z = P - W (closed-loop poles in the RHP), marginal, closedLoopRoots }.
 */
export function nyquist({ zeros = [], poles = [], K = 1, delay = 0 }, { R, eps = 0.05 } = {}) {
    const all = zeros.concat(poles);
    const scale = Math.max(1, ...all.map((q) => C.abs(q)));
    const Rr = R || 25 * scale;
    const axisPoles = poles.filter((q) => Math.abs(q[0]) < 1e-9).map((q) => q[1]);
    let e = eps;
    for (const q of all) {
        for (const w of axisPoles) {
            const d = Math.hypot(q[0], q[1] - w);
            if (d > 1e-9) e = Math.min(e, d / 3);
        }
    }
    const contour = dContour({ R: Rr, eps: e, axisPoles });
    const L = loopTransfer({ zeros, poles, K, delay });
    const tr = traceImage(L, contour, { center: [-1, 0], maxStep: 0.15 });
    const P = poles.filter((q) => q[0] > 1e-9).length;
    const W = tr.winding;
    // closed-loop poles: roots of den + K num (only without delay)
    let closedLoopRoots = null;
    if (!delay) {
        const den = polyFromRoots(poles);
        const num = polyScale(polyFromRoots(zeros), [K, 0]);
        closedLoopRoots = polyRoots(polyAdd(den, num));
    }
    return {
        contour, image: tr.pts, zs: tr.zs, W, P, Z: P - W, turns: tr.turns,
        marginal: tr.nearCenter < 1e-3, closedLoopRoots,
    };
}

// ---------------------------------------------------------------------------------------------
// Real integrals by contour methods

/** Contributions of a closed semicircle contour in the upper half plane: line, arc and total. */
export function semicircleContribs(f, R) {
    const line = integrateAdaptive((x) => f([x, 0]), -R, R, { tol: 1e-10 });
    const arc = integrateAdaptive((t) => C.mul(f([R * Math.cos(t), R * Math.sin(t)]), [-R * Math.sin(t), R * Math.cos(t)]), 0, Math.PI, { tol: 1e-10 });
    return { line: line.value, arc: arc.value, total: C.add(line.value, arc.value), ok: line.ok && arc.ok };
}

/** Same with a small clockwise indentation of radius eps above the origin (principal value on the line). */
export function indentedContribs(f, R, eps) {
    const l1 = integrateAdaptive((x) => f([x, 0]), -R, -eps, { tol: 1e-10 });
    const l2 = integrateAdaptive((x) => f([x, 0]), eps, R, { tol: 1e-10 });
    // small arc from -eps to +eps over the top: angle pi -> 0
    const small = integrateAdaptive((t) => C.mul(f([eps * Math.cos(t), eps * Math.sin(t)]), [-eps * Math.sin(t), eps * Math.cos(t)]), Math.PI, 0, { tol: 1e-10 });
    const arc = integrateAdaptive((t) => C.mul(f([R * Math.cos(t), R * Math.sin(t)]), [-R * Math.sin(t), R * Math.cos(t)]), 0, Math.PI, { tol: 1e-10 });
    const line = C.add(l1.value, l2.value);
    return {
        line, small: small.value, arc: arc.value, total: C.add(C.add(line, small.value), arc.value),
        ok: l1.ok && l2.ok && small.ok && arc.ok,
    };
}

const fromRootsOfUnity = (n, phase) => Array.from({ length: n }, (_, k) => C.fromPolar(1, phase + (TWO_PI * k) / n));

/**
 * The classic real integrals. rational(params) is the contour integrand as a rational object (with e^{kz} factor);
 * exact(params) the value of the integral over the whole real line (principal value); show: how to read the
 * answer ('re' | 'im' | 'abs' | 'c'); the real integrand is f(x) = Re / Im of the contour integrand.
 */
export const REAL_EXAMPLES = [
    {
        id: 'inv1', label: 'int dx/(1+x^2) = pi', params: {}, indent: false, show: 're',
        rational: () => makeRational({ num: [[1, 0]], poles: [{ z: [0, 1], m: 1 }, { z: [0, -1], m: 1 }] }),
        exact: () => [Math.PI, 0],
        integrand: 'f(z) = 1/(1+z^2)',
        note: 'Arc: |f| ~ 1/R^2 and length pi R, so the arc term is O(1/R).',
    },
    {
        id: 'cos', label: 'int cos(ax)/(1+x^2) dx = pi e^-a  (Jordan)', params: { a: 1 }, indent: false, show: 're',
        rational: ({ a }) => makeRational({ num: [[1, 0]], poles: [{ z: [0, 1], m: 1 }, { z: [0, -1], m: 1 }], expk: [0, a] }),
        exact: ({ a }) => [Math.PI * Math.exp(-a), 0],
        integrand: 'f(z) = e^{iaz}/(1+z^2)',
        note: "Jordan's lemma: |e^{iaz}| = e^{-a Im z} decays in the upper half plane, so the arc vanishes for a > 0.",
    },
    {
        id: 'xsin', label: 'int x sin(x)/(x^2+a^2) dx = pi e^-a', params: { a: 1 }, indent: false, show: 'im',
        rational: ({ a }) => makeRational({ num: [[0, 0], [1, 0]], poles: [{ z: [0, a], m: 1 }, { z: [0, -a], m: 1 }], expk: [0, 1] }),
        exact: ({ a }) => [0, Math.PI * Math.exp(-a)],
        integrand: 'f(z) = z e^{iz}/(z^2+a^2); Im f(x) = x sin x/(x^2+a^2)',
        note: 'Only Jordan (not absolute convergence) controls the arc: |z/(z^2+a^2)| ~ 1/R. Take the imaginary part.',
    },
    {
        id: 'quartic', label: 'int dx/(1+x^4) = pi/sqrt2', params: {}, indent: false, show: 're',
        rational: () => makeRational({
            num: [[1, 0]],
            poles: fromRootsOfUnity(4, Math.PI / 4).map((z) => ({ z, m: 1 })),
        }),
        exact: () => [Math.PI / Math.SQRT2, 0],
        integrand: 'f(z) = 1/(1+z^4)',
        note: 'Two poles enclosed (e^{i pi/4}, e^{3 i pi/4}); the arc decays like 1/R^3.',
    },
    {
        id: 'dbl', label: 'int x^2/(x^2+1)^2 dx = pi/2  (double poles)', params: {}, indent: false, show: 're',
        rational: () => makeRational({ num: [[0, 0], [0, 0], [1, 0]], poles: [{ z: [0, 1], m: 2 }, { z: [0, -1], m: 2 }] }),
        exact: () => [Math.PI / 2, 0],
        integrand: 'f(z) = z^2/(z^2+1)^2',
        note: 'A double pole at i: the residue needs the derivative formula.',
    },
    {
        id: 'sinc', label: 'int sin(x)/x dx = pi  (indented contour)', params: {}, indent: true, show: 'im',
        rational: () => makeRational({ num: [[1, 0]], poles: [{ z: [0, 0], m: 1 }], expk: [0, 1] }),
        exact: () => [0, Math.PI],
        integrand: 'f(z) = e^{iz}/z; PV oint = 0 because the pole is excluded',
        note: 'Small clockwise arc contributes -i pi Res = -i pi, the big arc vanishes (Jordan), so PV int e^{ix}/x dx = i pi.',
    },
    {
        id: 'ft', label: 'Fourier transform of a Lorentzian: int e^{iwx}/((x-b)^2+a^2) dx = (pi/a) e^{iwb - a w}', params: { a: 1, b: 0.5, w: 1.5 }, indent: false, show: 'c',
        rational: ({ a, b, w }) => makeRational({ num: [[1, 0]], poles: [{ z: [b, a], m: 1 }, { z: [b, -a], m: 1 }], expk: [0, w] }),
        exact: ({ a, b, w }) => C.scale(C.exp([-a * w, w * b]), Math.PI / a),
        integrand: 'f(z) = e^{iwz}/((z-b)^2 + a^2)',
        note: 'Poles at b +- i a; for w > 0 close in the upper half plane and pick up the pole b + i a.',
    },
];

/** Look up an example by id. */
export const realExample = (id) => REAL_EXAMPLES.find((e) => e.id === id) || REAL_EXAMPLES[0];

/** Numerical contributions of the example at contour radius R (line / small arc / big arc / total) and the residue prediction. */
export function evalRealExample(ex, params, R, eps = 0.05) {
    const r = ex.rational(params);
    const f = (z) => evalRational(r, z);
    const c = ex.indent ? indentedContribs(f, R, eps) : { ...semicircleContribs(f, R), small: [0, 0] };
    const res = residues(r);
    let sum = [0, 0];
    r.poles.forEach((q, k) => {
        if (q.z[1] > 1e-9 && C.abs(q.z) < R) sum = C.add(sum, res[k]);
    });
    return { ...c, predicted: C.mul([0, TWO_PI], sum), exact: ex.exact(params), rational: r };
}

/** Value of a complex number shown according to the example's `show` mode. */
export function realPart(ex, v) {
    return ex.show === 'im' ? v[1] : ex.show === 'c' ? C.abs(v) : v[0];
}

/**
 * Real integral of a rational function R(x) (deg den >= deg num + 2, no poles on the real line) times optional e^{i a x},
 * a >= 0, as 2 pi i sum of residues over the upper half plane (a > 0 needs only deg den >= deg num + 1).
 */
export function realIntegralByResidues(r, a = 0) {
    const rr = makeRational({ num: r.num, poles: r.poles, expk: [r.expk[0], r.expk[1] + a] });
    const res = residues(rr);
    let sum = [0, 0];
    r.poles.forEach((q, k) => {
        if (q.z[1] > 1e-12) sum = C.add(sum, res[k]);
    });
    return C.mul([0, TWO_PI], sum);
}

// ---------------------------------------------------------------------------------------------
// Laurent series

/** Laurent coefficients a_n = (1/2 pi i) oint f (z-c)^{-n-1} dz for n in [nMin, nMax] on the circle |z-c| = r (trapezoid rule). */
export function laurentCoefficients(f, c, r, nMin, nMax, N = 1024) {
    const vals = new Array(N);
    for (let k = 0; k < N; k++) {
        const th = (TWO_PI * k) / N;
        vals[k] = f([c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)]);
    }
    const out = [];
    for (let n = nMin; n <= nMax; n++) {
        let s = [0, 0];
        for (let k = 0; k < N; k++) {
            const ph = (-TWO_PI * n * k) / N;
            s = C.add(s, C.mul(vals[k], [Math.cos(ph), Math.sin(ph)]));
        }
        out.push(C.scale(s, Math.pow(r, -n) / N));
    }
    return out;
}

/** Sum a_n (z-c)^n for n = nMin.. . */
export function laurentEval(coefs, nMin, c, z) {
    const w = C.sub(z, c);
    let s = [0, 0];
    coefs.forEach((a, i) => {
        s = C.add(s, C.mul(a, C.powInt(w, nMin + i)));
    });
    return s;
}

/** Annulus (rin, rout) around c that contains radius r and is free of singularities. */
export function annulusOf(singularities, c, r) {
    let rin = 0;
    let rout = Infinity;
    for (const s of singularities) {
        const d = C.abs(C.sub(s, c));
        if (d < r) rin = Math.max(rin, d);
        else if (d > r) rout = Math.min(rout, d);
    }
    return { rin, rout };
}

/** Functions for the Laurent viewer: f and a finite list of singularities. */
export const LAURENT_FUNCS = [
    {
        id: 'zz1', label: '1/(z(z-1))', f: (z) => C.div([1, 0], C.mul(z, C.sub(z, [1, 0]))),
        sing: [[0, 0], [1, 0]], defaultCenter: [0, 0],
    },
    {
        id: 'exp1z', label: 'e^{1/z}', f: (z) => C.exp(C.div([1, 0], z)), sing: [[0, 0]], defaultCenter: [0, 0],
    },
    {
        id: 'sinz', label: 'sin(z)/z^4', f: (z) => C.div(C.sin(z), C.powInt(z, 4)), sing: [[0, 0]], defaultCenter: [0, 0],
    },
    {
        id: 'twopole', label: '1/((z-1)(z+2)) around 1', f: (z) => C.div([1, 0], C.mul(C.sub(z, [1, 0]), C.add(z, [2, 0]))),
        sing: [[1, 0], [-2, 0]], defaultCenter: [1, 0],
    },
    {
        id: 'cot', label: 'cot(z)', f: (z) => C.div(C.cos(z), C.sin(z)),
        sing: [-3, -2, -1, 0, 1, 2, 3].map((k) => [k * Math.PI, 0]), defaultCenter: [0, 0],
    },
    {
        id: 'zexp', label: 'z e^{1/z^2}', f: (z) => C.mul(z, C.exp(C.div([1, 0], C.mul(z, z)))), sing: [[0, 0]], defaultCenter: [0, 0],
    },
];

export const laurentFunc = (id) => LAURENT_FUNCS.find((q) => q.id === id) || LAURENT_FUNCS[0];

// ---------------------------------------------------------------------------------------------
// Inverse Laplace transform by residues / the Bromwich integral

/** f(t) = sum Res[F(s) e^{st}] (real part) over all poles of F; t is a real time. */
export function inverseLaplaceResidues(F, t) {
    const r = makeRational({ num: F.num, poles: F.poles, expk: [t, 0] });
    let s = [0, 0];
    residues(r).forEach((v) => { s = C.add(s, v); });
    return s[0];
}

/**
 * Bromwich integral (1/2 pi i) int_{c-iR}^{c+iR} F(s) e^{st} ds, closed to the left by an arc: returns
 * { line, arc, total, residueSum } (total = residueSum when the arc encloses all poles left of Re s = c).
 */
export function bromwich(F, t, c, R) {
    const f = (s) => C.mul(evalRational(F, s), C.exp([s[0] * t, s[1] * t]));
    const line = integrateAdaptive((y) => C.scale(f([c, y]), 1 / TWO_PI), -R, R, { tol: 1e-10 });
    const arc = integrateAdaptive((ph) => {
        const s = [c + R * Math.cos(ph), R * Math.sin(ph)];
        return C.mul(C.mul(f(s), [-R * Math.sin(ph), R * Math.cos(ph)]), INV_2PI_I);
    }, Math.PI / 2, (3 * Math.PI) / 2, { tol: 1e-10 });
    const res = residues(makeRational({ num: F.num, poles: F.poles, expk: [t, 0] }));
    let residueSum = [0, 0];
    F.poles.forEach((q, k) => {
        if (q.z[0] < c && Math.hypot(q.z[0] - c, q.z[1]) < R) residueSum = C.add(residueSum, res[k]);
    });
    return { line: line.value, arc: arc.value, total: C.add(line.value, arc.value), residueSum, ok: line.ok && arc.ok };
}

// ---------------------------------------------------------------------------------------------
// Branch cuts

/** Argument of z measured so that the cut is the ray at angle `phi`: arg in (phi - 2 pi, phi]. */
export function argWithCut(z, phi) {
    let a = Math.atan2(z[1], z[0]);
    while (a > phi) a -= TWO_PI;
    while (a <= phi - TWO_PI) a += TWO_PI;
    return a;
}

/** sqrt(z) with the cut along the ray at angle phi (default: the negative real axis). */
export function sqrtCut(z, phi = Math.PI) {
    const r = Math.sqrt(C.abs(z));
    const a = argWithCut(z, phi) / 2;
    return [r * Math.cos(a), r * Math.sin(a)];
}

/** log(z) with the cut along the ray at angle phi. */
export function logCut(z, phi = Math.PI) {
    return [Math.log(C.abs(z)), argWithCut(z, phi)];
}

/**
 * Integral of a cut function g(z, phi) round a circle (counter-clockwise, starting just after the cut), splitting the
 * circle exactly where it crosses the cut so every piece is smooth. Returns { value, crossings }.
 */
export function circleIntegralWithCut(g, c, r, phi) {
    // angles (about the circle centre) at which the circle crosses the cut ray; found by scanning + bisection
    const side = (th) => {
        const z = [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)];
        const a = argWithCut(z, phi);
        return a;
    };
    const n = 720;
    const cuts = [];
    let prev = side(0);
    for (let k = 1; k <= n; k++) {
        const cur = side((TWO_PI * k) / n);
        if (Math.abs(cur - prev) > Math.PI) {
            let lo = (TWO_PI * (k - 1)) / n;
            let hi = (TWO_PI * k) / n;
            const loSide = Math.abs(side(lo) - prev) < 1;
            for (let it = 0; it < 60; it++) {
                const mid = (lo + hi) / 2;
                const same = Math.abs(side(mid) - prev) < 1;
                if (same === loSide) lo = mid; else hi = mid;
            }
            cuts.push((lo + hi) / 2);
        }
        prev = cur;
    }
    // the start point itself may lie on the cut: compare the two sides of angle 0
    const wraps = Math.abs(side(1e-9) - side(TWO_PI - 1e-9)) > Math.PI;
    const breaks = [0, ...cuts, TWO_PI].sort((a, b) => a - b);
    let value = [0, 0];
    for (let i = 0; i + 1 < breaks.length; i++) {
        const lo = breaks[i];
        const hi = breaks[i + 1];
        if (hi - lo < 1e-13) continue;
        const pad = 1e-12;
        const F = (t) => C.mul(g([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)], phi), [-r * Math.sin(t), r * Math.cos(t)]);
        const q = integrateAdaptive(F, lo + pad, hi - pad, { tol: 1e-10, maxDepth: 12 });
        value = C.add(value, q.value);
    }
    return { value, crossings: cuts.length + (wraps ? 1 : 0) };
}

// ---------------------------------------------------------------------------------------------
// Deformation (homotopy) of contours

/** Star-shaped loop sample: point at parameter th of the circle (c, r) tilted into an ellipse of axis ratio q rotated by rot. */
export function ellipsePoint(c, r, th, q = 1, rot = 0) {
    const x = r * Math.cos(th);
    const y = r * q * Math.sin(th);
    return [c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot)];
}

/** Polygon contour (n vertices) of the linear homotopy (1 - s) A(th) + s B(th) between two parametrised loops. */
export function homotopyContour(A, B, s, n = 96) {
    const pts = [];
    for (let k = 0; k < n; k++) {
        const th = (TWO_PI * k) / n;
        const a = A(th);
        const b = B(th);
        pts.push([(1 - s) * a[0] + s * b[0], (1 - s) * a[1] + s * b[1]]);
    }
    return { kind: 'poly', pts };
}
