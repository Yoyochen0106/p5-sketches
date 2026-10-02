// Pure maths for the Conformal Maps sketch (no p5 / DOM). Complex numbers are [re, im].
//
//   derivative(def, z)          f'(z) of a def(A, x) definition (exact, via a 1st order series)
//   angleBetweenImages(F,..)    numerical check that a map preserves the angle between two directions
//   moebiusFrom3 / applyMoebius / moebiusDerivative / crossRatio / circleFrom3Points / moebiusCircle
//   polyFromRoots / evalPoly / polyRoots / criticalPoints
//   joukowskiStreamline         streamline of the potential flow past the Joukowski circle
//   sampleCurve                 adaptive polyline of a parametric curve, broken at poles and branch cuts
//   gridLines                   rectangular / polar coordinate grid as parametric lines
//   breakPolyline               split a sampled point list at non-finite values and huge jumps
import * as C from './complex.js';
import { complexAlg, seriesAlg, seriesVariable } from './algebra.js';

const TWO_PI = 2 * Math.PI;
const isFin = (z) => Number.isFinite(z[0]) && Number.isFinite(z[1]);

/** f'(z) for f given as def(A, x) (exact first-order series arithmetic). Returns [NaN, NaN] at singularities. */
export function derivative(def, z) {
    try {
        if (!isFin(def(complexAlg, z))) return [NaN, NaN]; // pole
        const s = def(seriesAlg(1, z), seriesVariable(1, z));
        return isFin(s[1]) ? s[1] : [NaN, NaN];
    } catch {
        return [NaN, NaN];
    }
}

/**
 * Angle (radians, in (-pi, pi]) from the image of direction d1 to the image of direction d2 at z0, measured with
 * secants of length h: arg((F(z0 + h d2) - F(z0)) / (F(z0 + h d1) - F(z0))). A conformal map gives arg(d2 / d1).
 */
export function angleBetweenImages(F, z0, d1, d2, h = 1e-5) {
    const w0 = F(z0);
    const a = C.sub(F(C.add(z0, C.scale(d1, h))), w0);
    const b = C.sub(F(C.add(z0, C.scale(d2, h))), w0);
    if (!isFin(a) || !isFin(b) || C.abs(a) === 0 || C.abs(b) === 0) return NaN;
    return C.arg(C.div(b, a));
}

/** Image of the circle |z - z0| = rho under F: sample points and the spread of their distance from the centroid. */
export function circleImage(F, z0, rho, n = 64) {
    const pts = [];
    for (let k = 0; k < n; k++) pts.push(F(C.add(z0, C.fromPolar(rho, (TWO_PI * k) / n))));
    if (!pts.every(isFin)) return { pts, center: null, roundness: NaN };
    let cx = 0;
    let cy = 0;
    for (const q of pts) { cx += q[0]; cy += q[1]; }
    cx /= n; cy /= n;
    const d = pts.map((q) => Math.hypot(q[0] - cx, q[1] - cy));
    const lo = Math.min(...d);
    const hi = Math.max(...d);
    return { pts, center: [cx, cy], roundness: lo > 0 ? hi / lo : Infinity };
}

// ---------------------------------------------------------------------------------------------
// Moebius transformations: w = (a z + b) / (c z + d), stored as [a, b, c, d]

const det2 = (m) => C.sub(C.mul(m[0], m[3]), C.mul(m[1], m[2]));

/** Moebius map sending the three distinct points zs[i] to ws[i]; null if the points are not distinct. */
export function moebiusFrom3(zs, ws) {
    const dist = (p) => p.every((q, i) => p.every((r, j) => i === j || C.abs(C.sub(q, r)) > 1e-12));
    if (!dist(zs) || !dist(ws)) return null;
    // T(z) maps (z1, z2, z3) -> (0, 1, inf):  (z - z1)(z2 - z3) / ((z - z3)(z2 - z1))
    const T = (p) => {
        const [z1, z2, z3] = p;
        return [C.mul(C.sub(z2, z3), [1, 0]), C.neg(C.mul(z1, C.sub(z2, z3))), C.sub(z2, z1), C.neg(C.mul(z3, C.sub(z2, z1)))];
    };
    const mul = (m, n) => [
        C.add(C.mul(m[0], n[0]), C.mul(m[1], n[2])), C.add(C.mul(m[0], n[1]), C.mul(m[1], n[3])),
        C.add(C.mul(m[2], n[0]), C.mul(m[3], n[2])), C.add(C.mul(m[2], n[1]), C.mul(m[3], n[3])),
    ];
    const Tz = T(zs);
    const Tw = T(ws);
    const adj = [Tw[3], C.neg(Tw[1]), C.neg(Tw[2]), Tw[0]]; // inverse (up to scale)
    const m = mul(adj, Tz);
    return m.every(isFin) && C.abs(det2(m)) > 0 ? m : null;
}

/** Apply a Moebius map; z = infinity is not representable, a pole gives [Infinity, Infinity]. */
export function applyMoebius(m, z) {
    const den = C.add(C.mul(m[2], z), m[3]);
    if (den[0] === 0 && den[1] === 0) return [Infinity, Infinity];
    return C.div(C.add(C.mul(m[0], z), m[1]), den);
}

/** w'(z) = det / (c z + d)^2 */
export function moebiusDerivative(m, z) {
    const den = C.add(C.mul(m[2], z), m[3]);
    return C.div(det2(m), C.mul(den, den));
}

/** Cross-ratio (z1, z2; z3, z4) = (z1 - z3)(z2 - z4) / ((z1 - z4)(z2 - z3)); invariant under Moebius maps. */
export function crossRatio(z1, z2, z3, z4) {
    return C.div(C.mul(C.sub(z1, z3), C.sub(z2, z4)), C.mul(C.sub(z1, z4), C.sub(z2, z3)));
}

/**
 * Circle through three points: { c: [x, y], r } or, for (nearly) collinear points, { line: true, p, dir }.
 */
export function circleFrom3Points(a, b, c) {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    const scale = Math.max(1, Math.hypot(a[0], a[1]), Math.hypot(b[0], b[1]), Math.hypot(c[0], c[1]));
    if (Math.abs(d) < 1e-12 * scale * scale) {
        const dir = C.sub(c, a);
        const n = C.abs(dir) || 1;
        return { line: true, p: a, dir: [dir[0] / n, dir[1] / n] };
    }
    const sa = a[0] * a[0] + a[1] * a[1];
    const sb = b[0] * b[0] + b[1] * b[1];
    const sc = c[0] * c[0] + c[1] * c[1];
    const ux = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
    const uy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
    return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
}

/** Image of the circle (centre c, radius r) under a Moebius map, as a circle or line (from three image points). */
export function moebiusCircle(m, c, r) {
    const p = [0, 2.0943951023931953, 4.1887902047863905].map((t) => applyMoebius(m, C.add(c, C.fromPolar(r, t))));
    return p.every(isFin) ? circleFrom3Points(p[0], p[1], p[2]) : null;
}

// ---------------------------------------------------------------------------------------------
// Polynomials given by their roots

/** Coefficients [c0, c1, ..., cn] (ascending) of prod (z - r_i). */
export function polyFromRoots(roots) {
    let c = [[1, 0]];
    for (const r of roots) {
        const next = Array.from({ length: c.length + 1 }, () => [0, 0]);
        for (let k = 0; k < c.length; k++) {
            next[k + 1] = C.add(next[k + 1], c[k]);
            next[k] = C.sub(next[k], C.mul(r, c[k]));
        }
        c = next;
    }
    return c;
}

/** Horner evaluation of ascending coefficients: returns { p, dp }. */
export function evalPoly(coef, z) {
    let p = [0, 0];
    let dp = [0, 0];
    for (let k = coef.length - 1; k >= 0; k--) {
        dp = C.add(C.mul(dp, z), p);
        p = C.add(C.mul(p, z), coef[k]);
    }
    return { p, dp };
}

/** Roots of a polynomial with ascending complex coefficients (Durand-Kerner iteration). */
export function polyRoots(coef) {
    let n = coef.length - 1;
    while (n > 0 && C.abs(coef[n]) === 0) n--;
    if (n < 1) return [];
    const lead = coef[n];
    const a = coef.slice(0, n + 1).map((c) => C.div(c, lead));
    const rad = 1 + Math.max(...a.slice(0, n).map(C.abs));
    const r = Array.from({ length: n }, (_, k) => C.fromPolar(rad * 0.5 + 0.1, 0.4 + (TWO_PI * k) / n));
    for (let it = 0; it < 500; it++) {
        let worst = 0;
        for (let i = 0; i < n; i++) {
            let den = [1, 0];
            for (let j = 0; j < n; j++) if (j !== i) den = C.mul(den, C.sub(r[i], r[j]));
            if (C.abs(den) === 0) den = [1e-12, 0];
            const step = C.div(evalPoly(a, r[i]).p, den);
            r[i] = C.sub(r[i], step);
            worst = Math.max(worst, C.abs(step));
        }
        if (worst < 1e-14 * rad) break;
    }
    return r;
}

/** Critical points of the polynomial with the given roots: the zeros of p'. */
export function criticalPoints(roots) {
    const coef = polyFromRoots(roots);
    const d = coef.slice(1).map((c, k) => C.scale(c, k + 1));
    return polyRoots(d);
}

// ---------------------------------------------------------------------------------------------
// Joukowski flow

/**
 * Streamline psi = k of the uniform flow past the circle |z - c| = r (no circulation), as a curve t in [0, 1] -> z
 * running left to right out to distance `reach` from the centre. Apply z + 1/z to it for the flow past the airfoil.
 */
export function joukowskiStreamline(c, r, k, reach = 8) {
    if (k === 0) return (t) => C.add(c, C.fromPolar(r, Math.PI * (1 - t)));
    const sgn = Math.sign(k);
    const R = Math.max(reach, 2 * r);
    const th0 = Math.asin(Math.min(0.999, (Math.abs(k) * R) / (R * R - r * r) + 1e-6));
    return (t) => {
        const th = th0 + (Math.PI - 2 * th0) * (1 - t);
        const s = Math.sin(th);
        const q = Math.abs(k) / s;
        const rho = (q + Math.sqrt(q * q + 4 * r * r)) / 2;
        return C.add(c, [rho * Math.cos(th), sgn * rho * s]);
    };
}

// ---------------------------------------------------------------------------------------------
// Curve sampling

/**
 * Split a list of points at non-finite values, points beyond `limit` of the origin and jumps longer than `jump`.
 * Returns an array of polylines (each with >= 2 points).
 */
export function breakPolyline(pts, jump = Infinity, limit = Infinity) {
    const out = [];
    let cur = [];
    const ok = (q) => q && isFin(q) && Math.abs(q[0]) < limit && Math.abs(q[1]) < limit;
    for (const q of pts) {
        if (!ok(q)) {
            if (cur.length > 1) out.push(cur);
            cur = [];
        } else {
            if (cur.length && Math.hypot(q[0] - cur[cur.length - 1][0], q[1] - cur[cur.length - 1][1]) > jump) {
                if (cur.length > 1) out.push(cur);
                cur = [];
            }
            cur.push(q);
        }
    }
    if (cur.length > 1) out.push(cur);
    return out;
}

/**
 * Adaptive sampling of fn(t) -> [x, y] for t in [t0, t1]. `box` = { xmin, xmax, ymin, ymax } is the visible region:
 * segments far outside it are not refined. Intervals are bisected where the curve bends (midpoint far from the
 * chord) or where finite/non-finite values meet; leaf segments longer than 0.3 of the box (poles, branch cuts)
 * and points far outside the box break the polyline. Returns an array of polylines.
 */
export function sampleCurve(fn, t0, t1, { box, n = 48, maxDepth = 10, maxEvals = 6000 } = {}) {
    const b = box || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    const span = Math.max(b.xmax - b.xmin, b.ymax - b.ymin) || 1;
    const cx = (b.xmin + b.xmax) / 2;
    const cy = (b.ymin + b.ymax) / 2;
    const big = 50 * span;
    const tol = span * 5e-4;
    const jump = span * 0.3;
    let evals = 0;
    const ev = (t) => {
        evals++;
        let q;
        try { q = fn(t); } catch { return null; }
        return q && isFin(q) && Math.abs(q[0] - cx) < big && Math.abs(q[1] - cy) < big ? q : null;
    };
    const out = [];
    let cur = [];
    const flush = () => {
        if (cur.length > 1) out.push(cur);
        cur = [];
    };
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const nearView = (...ps) => {
        const m = 0.5 * span;
        let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
        for (const q of ps) {
            lx = Math.min(lx, q[0]); hx = Math.max(hx, q[0]);
            ly = Math.min(ly, q[1]); hy = Math.max(hy, q[1]);
        }
        return hx > b.xmin - m && lx < b.xmax + m && hy > b.ymin - m && ly < b.ymax + m;
    };

    function walk(ta, pa, tb, pb, depth) {
        if (!pa && !pb) { flush(); return; }
        const canSplit = depth < maxDepth && evals < maxEvals;
        if (pa && pb) {
            let split = false;
            if (canSplit && nearView(pa, pb)) {
                const pm = ev((ta + tb) / 2);
                if (!pm) split = true;
                else {
                    const L = dist(pa, pb);
                    const dev = L > 0
                        ? Math.abs((pb[0] - pa[0]) * (pa[1] - pm[1]) - (pa[0] - pm[0]) * (pb[1] - pa[1])) / L
                        : dist(pa, pm);
                    split = dev > tol || L > jump;
                }
            }
            if (split) {
                const tm = (ta + tb) / 2;
                const pm = ev(tm);
                walk(ta, pa, tm, pm, depth + 1);
                walk(tm, pm, tb, pb, depth + 1);
                return;
            }
            if (dist(pa, pb) > jump && nearView(pa, pb)) { flush(); cur.push(pb); } else cur.push(pb);
            return;
        }
        // exactly one end is valid: bisect to get close to the boundary of the valid region
        if (canSplit && nearView(pa || pb, pa || pb)) {
            const tm = (ta + tb) / 2;
            const pm = ev(tm);
            walk(ta, pa, tm, pm, depth + 1);
            walk(tm, pm, tb, pb, depth + 1);
            return;
        }
        if (pa) flush();
        else cur = [pb];
    }

    let tPrev = t0;
    let pPrev = ev(t0);
    if (pPrev) cur.push(pPrev);
    for (let i = 1; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const p = ev(t);
        walk(tPrev, pPrev, t, p, 0);
        tPrev = t;
        pPrev = p;
    }
    flush();
    return out;
}

// ---------------------------------------------------------------------------------------------
// Coordinate grids

function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}

/**
 * Coordinate grid over the domain view ({ xmin, xmax, ymin, ymax }) as parametric lines
 * { fam, kind, value, t0, t1, at(t) -> [x, y] }. fam 0: Re = const or |z| = const; fam 1: Im = const or arg z = const.
 * kind: 'rect' | 'polar' | 'both'; density = about this many lines across the smaller side of the view.
 */
export function gridLines(kind, density, view) {
    const lines = [];
    const n = Math.max(2, Math.min(80, density));
    const w = view.xmax - view.xmin;
    const h = view.ymax - view.ymin;
    if (!(w > 0) || !(h > 0)) return lines;
    if (kind === 'rect' || kind === 'both') {
        const step = niceStep(Math.min(w, h) / n);
        const x0 = Math.ceil(view.xmin / step - 1e-9);
        for (let i = x0; i * step <= view.xmax + 1e-9 * step; i++) {
            const x = i * step;
            lines.push({ fam: 0, kind: 'rect', value: x, t0: view.ymin, t1: view.ymax, at: (t) => [x, t] });
        }
        const y0 = Math.ceil(view.ymin / step - 1e-9);
        for (let j = y0; j * step <= view.ymax + 1e-9 * step; j++) {
            const y = j * step;
            lines.push({ fam: 1, kind: 'rect', value: y, t0: view.xmin, t1: view.xmax, at: (t) => [t, y] });
        }
    }
    if (kind === 'polar' || kind === 'both') {
        const R = Math.max(
            Math.hypot(view.xmin, view.ymin), Math.hypot(view.xmin, view.ymax),
            Math.hypot(view.xmax, view.ymin), Math.hypot(view.xmax, view.ymax),
        );
        const step = niceStep(Math.min(w, h) / n);
        const count = Math.min(200, Math.floor(R / step));
        for (let k = 1; k <= count; k++) {
            const r = k * step;
            lines.push({ fam: 0, kind: 'polar', value: r, t0: 0, t1: TWO_PI, at: (t) => [r * Math.cos(t), r * Math.sin(t)] });
        }
        const K = 4 * Math.max(1, Math.round(n / 6));
        for (let k = 0; k < K; k++) {
            const th = (TWO_PI * k) / K;
            lines.push({ fam: 1, kind: 'polar', value: th, t0: 0, t1: R, at: (t) => [t * Math.cos(th), t * Math.sin(th)] });
        }
    }
    return lines;
}
