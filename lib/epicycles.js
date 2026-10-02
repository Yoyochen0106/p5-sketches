// Epicycles: a closed planar curve z(t) = x + iy, t in [0,1), expanded as
//   z(t) = sum_k c_k exp(2 pi i k t)
// with c_k from the DFT of N uniform samples. Points are {x, y} objects.

import { fft, isPowerOfTwo } from './fft.js';

const TAU = 2 * Math.PI;

/**
 * Resample a closed polyline (the last point connects back to the first) to N points
 * equally spaced by arc length, starting at points[0]. Degenerate input (zero length)
 * yields N copies of the single point; empty input yields [].
 */
export function resampleClosedPath(points, N) {
    if (!points || points.length === 0 || N < 1) return [];
    const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => ({ x: p.x, y: p.y }));
    if (pts.length === 0) return [];
    const m = pts.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
        const a = pts[i], b = pts[(i + 1) % m];
        cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    const total = cum[m];
    const out = [];
    if (total < 1e-12) {
        for (let i = 0; i < N; i++) out.push({ x: pts[0].x, y: pts[0].y });
        return out;
    }
    let seg = 0;
    for (let i = 0; i < N; i++) {
        const target = (total * i) / N;
        while (seg < m - 1 && cum[seg + 1] <= target) seg++;
        const a = pts[seg], b = pts[(seg + 1) % m];
        const len = cum[seg + 1] - cum[seg];
        const f = len > 0 ? (target - cum[seg]) / len : 0;
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    return out;
}

/** Circular smoothing of a closed point list: `passes` iterations of the [1 2 1]/4 kernel. */
export function smoothClosed(points, passes) {
    let cur = points.map((p) => ({ x: p.x, y: p.y }));
    const n = cur.length;
    if (n < 3) return cur;
    for (let it = 0; it < passes; it++) {
        const prev = cur;
        cur = prev.map((p, i) => {
            const a = prev[(i + n - 1) % n], b = prev[(i + 1) % n];
            return { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
        });
    }
    return cur;
}

/** Order the coefficients: 'freq' = 0, +1, -1, +2, -2, ...; 'amp' = largest amplitude first. */
export function sortCoefs(coefs, order = 'freq') {
    const arr = coefs.slice();
    if (order === 'amp') {
        arr.sort((a, b) => (b.amp - a.amp) || (Math.abs(a.k) - Math.abs(b.k)) || (b.k - a.k));
    } else {
        arr.sort((a, b) => (Math.abs(a.k) - Math.abs(b.k)) || (b.k - a.k));
    }
    return arr;
}

/**
 * DFT of an N-point closed path (N a power of two). Returns coefficient records
 * { k, re, im, amp, phase } with k the signed frequency in [-N/2, N/2-1], c_k = X[k mod N] / N,
 * sorted by `order` ('freq' or 'amp').
 */
export function dftPath(points, order = 'freq') {
    const N = points.length;
    if (!isPowerOfTwo(N)) throw new Error('dftPath: path length must be a power of two');
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = points[i].x; im[i] = points[i].y; }
    fft(re, im);
    const coefs = [];
    for (let j = 0; j < N; j++) {
        const k = j < N / 2 ? j : j - N;
        const cr = re[j] / N, ci = im[j] / N;
        coefs.push({ k, re: cr, im: ci, amp: Math.hypot(cr, ci), phase: Math.atan2(ci, cr) });
    }
    return sortCoefs(coefs, order);
}

/** Sum of the first K coefficients at parameter t (t in [0,1) is one loop). Returns {x, y}. */
export function evaluate(coefs, K, t) {
    const n = Math.max(0, Math.min(coefs.length, Math.floor(K)));
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
        const c = coefs[i];
        const a = TAU * c.k * t;
        const co = Math.cos(a), si = Math.sin(a);
        x += c.re * co - c.im * si;
        y += c.re * si + c.im * co;
    }
    return { x, y };
}

/**
 * Chain of rotating circles for the first K coefficients at time t. Entry i has centre (cx, cy),
 * radius r = |c_i| and current angle (arg c_i + 2 pi k t); its tip (cx + r cos, cy + r sin) is
 * the centre of the next entry. The last tip equals evaluate(coefs, K, t).
 */
export function epicycleChain(coefs, K, t) {
    const n = Math.max(0, Math.min(coefs.length, Math.floor(K)));
    const chain = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
        const c = coefs[i];
        const angle = Math.atan2(c.im, c.re) + TAU * c.k * t;
        chain.push({ cx, cy, r: c.amp, angle, k: c.k });
        cx += c.amp * Math.cos(angle);
        cy += c.amp * Math.sin(angle);
    }
    return chain;
}

/**
 * RMS distance between the K-term curve and an N-point path sampled at t = i / N
 * (the same parametrisation dftPath used).
 */
export function rmsError(coefs, K, path) {
    const N = path.length;
    if (N === 0) return 0;
    let s = 0;
    for (let i = 0; i < N; i++) {
        const q = evaluate(coefs, K, i / N);
        const dx = q.x - path[i].x, dy = q.y - path[i].y;
        s += dx * dx + dy * dy;
    }
    return Math.sqrt(s / N);
}
