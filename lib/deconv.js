// Convolution / deconvolution toolbox for the Impulse Response Lab. Pure math: no DOM, no p5.
//
// Model: y = x * h (linear convolution), signals indexed from 0, so h is causal by construction
// (h[k] = 0 for k < 0). When y is observed on a window shorter than the full convolution (the usual
// case in the lab, where x and y have the same N samples) the model is the TRUNCATED convolution
// y[n] = sum_{k<=n} h[k] x[n-k], n < len(y).
//
// Regularisation: every method takes an ABSOLUTE `lambda`. Use lambdaFromRelative(x, rel) to
// express it relative to max|X|^2 (the squared operator norm of the convolution with x).

import { fft, ifft, nextPowerOfTwo } from './fft.js';

const f64 = (n) => new Float64Array(n);

/** Linear convolution, length x.length + h.length - 1 (direct for small inputs, FFT otherwise). */
export function linearConvolve(x, h) {
    const nx = x.length, nh = h.length;
    if (nx === 0 || nh === 0) return f64(0);
    const n = nx + nh - 1;
    const out = f64(n);
    if (nx * nh <= 16384) {
        for (let i = 0; i < nx; i++) {
            const xi = x[i];
            if (xi === 0) continue;
            for (let j = 0; j < nh; j++) out[i + j] += xi * h[j];
        }
        return out;
    }
    const M = nextPowerOfTwo(n);
    const a = padTo(x, M), ai = f64(M), b = padTo(h, M), bi = f64(M);
    fft(a, ai); fft(b, bi);
    for (let k = 0; k < M; k++) {
        const r = a[k] * b[k] - ai[k] * bi[k];
        const i = a[k] * bi[k] + ai[k] * b[k];
        a[k] = r; ai[k] = i;
    }
    ifft(a, ai);
    out.set(a.subarray(0, n));
    return out;
}

/** First n samples of the linear convolution (zero-extended if the full result is shorter). */
export function convolveTruncated(x, h, n) {
    const full = linearConvolve(x, h);
    const out = f64(n);
    out.set(full.subarray(0, Math.min(n, full.length)));
    return out;
}

/** Circular convolution of two equal-length signals (direct O(N^2); used to demonstrate wrap-around). */
export function circularConvolve(x, h) {
    const n = x.length;
    const out = f64(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[(i + j) % n] += x[i] * h[j];
    return out;
}

function padTo(a, M) {
    const out = f64(M);
    out.set(a.length <= M ? a : a.subarray(0, M));
    return out;
}

/** Zero-padded (or folded when shorter than the signal) spectrum of a real signal. */
export function spectrum(x, M) {
    const re = f64(M), im = f64(M);
    for (let i = 0; i < x.length; i++) re[i % M] += x[i];
    fft(re, im);
    return { re, im };
}

/** Largest |X|^2 over a 2x zero-padded transform: the squared operator norm of "convolve with x". */
export function maxPower(x) {
    if (!x.length) return 0;
    const { re, im } = spectrum(x, nextPowerOfTwo(2 * x.length));
    let m = 0;
    for (let k = 0; k < re.length; k++) m = Math.max(m, re[k] * re[k] + im[k] * im[k]);
    return m;
}

/** Absolute lambda for a relative one: rel * max|X|^2 (rel = noise-to-signal power ratio). */
export function lambdaFromRelative(x, rel) {
    return Math.max(0, rel) * maxPower(x);
}

// ---------- (b) frequency-domain (Tikhonov / Wiener) deconvolution ----------

/**
 * Solve y = x * h for h by H = Y conj(X) / (|X|^2 + lambda).
 * opts: lambda (absolute, default 0), L (support length of the result, default y.length; samples
 * beyond L are discarded = "truncate to support"), pad (default true: FFT size is a power of two
 * >= len(x) + L - 1 so nothing wraps; false: size = nextPow2(max(len x, L)) and y is cropped to it,
 * i.e. the plain N-point circular analysis, which shows the wrap-around artefact).
 */
export function wienerDeconvolve(y, x, opts = {}) {
    const lambda = opts.lambda ?? 0;
    const L = Math.max(1, Math.floor(opts.L ?? y.length));
    const pad = opts.pad !== false;
    const need = pad ? Math.max(x.length + L - 1, y.length) : Math.max(x.length, L);
    const M = nextPowerOfTwo(Math.max(1, need));
    const X = spectrum(x, M), Y = spectrum(pad ? y : y.subarray(0, M), M);
    const re = f64(M), im = f64(M);
    for (let k = 0; k < M; k++) {
        const p = X.re[k] * X.re[k] + X.im[k] * X.im[k] + lambda;
        if (!(p > 0)) continue;
        // Y * conj(X)
        re[k] = (Y.re[k] * X.re[k] + Y.im[k] * X.im[k]) / p;
        im[k] = (Y.im[k] * X.re[k] - Y.re[k] * X.im[k]) / p;
    }
    ifft(re, im);
    const h = f64(L);
    h.set(re.subarray(0, Math.min(L, M)));
    return h;
}

// ---------- (c) time-domain regularised least squares ----------

/** Operator pair for T (y = T h, truncated convolution with x) and its adjoint, via the FFT. */
function makeOperator(xs, ny, L, lead = 0) {
    const R = ny + lead; // rows of the full convolution; the first `lead` are not observed
    const M = nextPowerOfTwo(Math.max(xs.length + L - 1, R, 2));
    const X = spectrum(xs, M);
    const ar = f64(M), ai = f64(M);
    const apply = (v) => {
        ar.fill(0); ai.fill(0);
        ar.set(v.subarray(0, Math.min(L, M)));
        fft(ar, ai);
        for (let k = 0; k < M; k++) {
            const r = ar[k] * X.re[k] - ai[k] * X.im[k];
            ai[k] = ar[k] * X.im[k] + ai[k] * X.re[k];
            ar[k] = r;
        }
        ifft(ar, ai);
        return ar.slice(lead, lead + ny);
    };
    const adjoint = (u) => {
        ar.fill(0); ai.fill(0);
        ar.set(u.subarray(0, ny), lead);
        fft(ar, ai);
        for (let k = 0; k < M; k++) {
            const r = ar[k] * X.re[k] + ai[k] * X.im[k];
            ai[k] = ai[k] * X.re[k] - ar[k] * X.im[k];
            ar[k] = r;
        }
        ifft(ar, ai);
        return ar.slice(0, L);
    };
    let peak = 0;
    for (let k = 0; k < M; k++) peak = Math.max(peak, X.re[k] * X.re[k] + X.im[k] * X.im[k]);
    return { apply, adjoint, norm2: peak };
}

/** Normal-equation matrix A = T^T T + lambda I (dense, symmetric) from cumulative lag products. */
function normalMatrix(xs, ny, L, lambda, lead = 0) {
    const A = new Array(L);
    for (let i = 0; i < L; i++) A[i] = f64(L);
    const nx = xs.length;
    const R = ny + lead;
    const cum = f64(R);
    for (let d = 0; d < L; d++) {
        let c = 0;
        for (let m = 0; m < R; m++) {
            c += m + d < nx ? xs[m] * xs[m + d] : 0;
            cum[m] = c;
        }
        for (let i = d; i < L; i++) {
            const hiIdx = R - 1 - i, loIdx = lead - i - 1;
            const v = hiIdx >= 0 ? cum[hiIdx] - (loIdx >= 0 ? cum[loIdx] : 0) : 0;
            A[i][i - d] = v;
            A[i - d][i] = v;
        }
    }
    for (let i = 0; i < L; i++) A[i][i] += lambda;
    return A;
}

/** In-place Cholesky solve of A h = b (A symmetric positive semi-definite; tiny jitter if needed). */
function choleskySolve(A, b) {
    const n = b.length;
    let dmax = 0;
    for (let i = 0; i < n; i++) dmax = Math.max(dmax, A[i][i]);
    const eps = Math.max(dmax * 1e-14, 1e-300);
    for (let j = 0; j < n; j++) {
        const Aj = A[j];
        let d = Aj[j];
        for (let k = 0; k < j; k++) d -= Aj[k] * Aj[k];
        d = Math.sqrt(d > eps ? d : eps);
        Aj[j] = d;
        for (let i = j + 1; i < n; i++) {
            const Ai = A[i];
            let s = Ai[j];
            for (let k = 0; k < j; k++) s -= Ai[k] * Aj[k];
            Ai[j] = s / d;
        }
    }
    const z = f64(n);
    for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= A[i][k] * z[k];
        z[i] = s / A[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = z[i];
        for (let k = i + 1; k < n; k++) s -= A[k][i] * z[k];
        z[i] = s / A[i][i];
    }
    return z;
}

/** Conjugate gradient on (T^T T + lambda I) h = b with FFT matvecs. */
function cgSolve(op, b, lambda, L, maxIter, tol) {
    const h = f64(L);
    const r = Float64Array.from(b);
    const p = Float64Array.from(r);
    let rs = 0;
    for (let i = 0; i < L; i++) rs += r[i] * r[i];
    const rs0 = rs;
    if (rs0 === 0) return h;
    for (let it = 0; it < maxIter && rs > tol * tol * rs0; it++) {
        const Ap = op.adjoint(op.apply(p));
        let pAp = 0;
        for (let i = 0; i < L; i++) { Ap[i] += lambda * p[i]; pAp += p[i] * Ap[i]; }
        if (!(pAp > 0)) break;
        const alpha = rs / pAp;
        let rsNew = 0;
        for (let i = 0; i < L; i++) { h[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; rsNew += r[i] * r[i]; }
        const beta = rsNew / rs;
        for (let i = 0; i < L; i++) p[i] = r[i] + beta * p[i];
        rs = rsNew;
    }
    return h;
}

/** Accelerated projected gradient (FISTA) for min ||T h - y||^2 + lambda ||h||^2, h >= 0. */
function nnlsSolve(op, y, lambda, L, h0, maxIter, tol) {
    const step = 1 / (op.norm2 * 1.02 + lambda + 1e-300);
    let h = Float64Array.from(h0);
    for (let i = 0; i < L; i++) if (h[i] < 0) h[i] = 0;
    let z = Float64Array.from(h);
    let t = 1;
    for (let it = 0; it < maxIter; it++) {
        const res = op.apply(z);
        for (let i = 0; i < res.length; i++) res[i] -= y[i];
        const g = op.adjoint(res);
        const hn = f64(L);
        let dn = 0, hh = 0;
        for (let i = 0; i < L; i++) {
            const v = z[i] - step * (g[i] + lambda * z[i]);
            hn[i] = v > 0 ? v : 0;
            const d = hn[i] - h[i];
            dn += d * d; hh += hn[i] * hn[i];
        }
        const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
        const mom = (t - 1) / tn;
        for (let i = 0; i < L; i++) z[i] = hn[i] + mom * (hn[i] - h[i]);
        h = hn; t = tn;
        if (dn <= tol * tol * (hh + 1e-300)) break;
    }
    return h;
}

/**
 * Regularised least squares for h of length L: min ||T h - y||^2 + lambda ||h||^2.
 * opts: lambda (absolute), L (default y.length), nonneg (projected FISTA), lead (number of
 * anti-causal lags allowed: h[j] is the response at lag j - lead; default 0 = causal),
 * solver ('auto' | 'cholesky' | 'cg'), maxIter, tol.
 */
export function leastSquaresDeconvolve(y, x, opts = {}) {
    const lambda = opts.lambda ?? 0;
    const ny = y.length;
    const L = Math.max(1, Math.floor(opts.L ?? ny));
    const lead = Math.max(0, Math.floor(opts.lead ?? 0));
    const xs = x;
    if (xs.length === 0) return f64(L);
    const op = makeOperator(xs, ny, L, lead);
    const b = op.adjoint(Float64Array.from(y));
    const solver = opts.solver ?? 'auto';
    const useChol = solver === 'cholesky' || (solver === 'auto' && L <= 384);
    let h;
    if (useChol) h = choleskySolve(normalMatrix(xs, ny, L, lambda, lead), b);
    else h = cgSolve(op, b, lambda, L, opts.maxIter ?? Math.min(2000, 4 * L), opts.tol ?? 1e-12);
    if (opts.nonneg) h = nnlsSolve(op, Float64Array.from(y), lambda, L, h, opts.maxIter ?? 300, opts.tol ?? 1e-10);
    return h;
}

// ---------- (d) solve-for-any-signal ----------

/** Dispatch on method: 'wiener' | 'ls' | 'nnls'. Returns the kernel k with y ~ x * k. */
export function deconvolve(y, x, opts = {}) {
    const method = opts.method ?? 'wiener';
    if (method === 'wiener') return wienerDeconvolve(y, x, opts);
    return leastSquaresDeconvolve(y, x, { ...opts, nonneg: method === 'nnls' || !!opts.nonneg });
}

/**
 * Complete the triple (x, y, h) of equal length n by deriving one signal.
 * mode 'h': h from x,y; 'y': y = (x*h)[0..n); 'x': x from y,h (same regularised deconvolution).
 * lambdaRel is relative to max|X|^2 of the INPUT of the deconvolution; L is the support of h.
 * Returns { x, y, h } (new arrays for the derived one, the others untouched).
 */
export function solveTriple({ mode = 'h', x, y, h, method = 'wiener', lambdaRel = 0, L, nonneg = false }) {
    const n = (x || y || h).length;
    if (mode === 'y') return { x, h, y: convolveTruncated(x, h, n) };
    if (mode === 'x') {
        const lam = lambdaFromRelative(h, lambdaRel);
        const nx = deconvolve(y, h, { method, lambda: lam, L: n, nonneg });
        return { x: nx, y, h };
    }
    const Ls = Math.max(1, Math.min(n, Math.floor(L ?? n)));
    const lam = lambdaFromRelative(x, lambdaRel);
    const hs = deconvolve(y, x, { method, lambda: lam, L: Ls, nonneg });
    const full = f64(n);
    full.set(hs);
    return { x, y, h: full };
}

// ---------- (e) metrics ----------

const norm = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s); };

/** Relative residual ||(x*h)[0..ny) - y|| / ||y|| (absolute norm when y is all zeros). */
export function residualNorm(x, h, y) {
    const rec = convolveTruncated(x, h, y.length);
    const d = f64(y.length);
    for (let i = 0; i < y.length; i++) d[i] = rec[i] - y[i];
    const ny = norm(y);
    return ny > 0 ? norm(d) / ny : norm(d);
}

/**
 * Conditioning indicators of deconvolving by x: max/min |X| over a band of the (2x padded) spectrum
 * (band = [lo, hi] as fractions of Nyquist, default the whole band) and the fraction of bins whose
 * |X|^2 lies below `lambda`.
 */
export function conditionIndicators(x, { band = [0, 1], lambda = 0 } = {}) {
    const M = nextPowerOfTwo(2 * Math.max(1, x.length));
    const { re, im } = spectrum(x, M);
    const half = M / 2;
    const k0 = Math.max(0, Math.floor(band[0] * half)), k1 = Math.min(half, Math.ceil(band[1] * half));
    let mn = Infinity, mx = 0, below = 0;
    for (let k = k0; k <= k1; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        const m = Math.sqrt(p);
        if (m < mn) mn = m;
        if (m > mx) mx = m;
        if (p < lambda) below++;
    }
    return { min: mn, max: mx, ratio: mn > 0 ? mx / mn : Infinity, fracBelow: below / (k1 - k0 + 1) };
}

// ---------- (f) automatic lambda ----------

/**
 * Generalised cross-validation choice of the Tikhonov parameter for y ~ x * h in the padded
 * frequency domain. Returns { lambda (absolute), rel (relative to max|X|^2), score }.
 */
export function autoLambda(y, x, opts = {}) {
    const L = Math.max(1, Math.floor(opts.L ?? y.length));
    const M = nextPowerOfTwo(Math.max(x.length + L - 1, y.length, 2));
    const X = spectrum(x, M), Y = spectrum(y, M);
    const px = f64(M), py = f64(M);
    let top = 0;
    for (let k = 0; k < M; k++) {
        px[k] = X.re[k] * X.re[k] + X.im[k] * X.im[k];
        py[k] = Y.re[k] * Y.re[k] + Y.im[k] * Y.im[k];
        top = Math.max(top, px[k]);
    }
    if (!(top > 0)) return { lambda: 0, rel: 0, score: Infinity };
    const lo = opts.minLog ?? -12, hi = opts.maxLog ?? 0, steps = opts.steps ?? 60;
    let best = { score: Infinity, rel: 10 ** lo };
    for (let s = 0; s <= steps; s++) {
        const rel = 10 ** (lo + ((hi - lo) * s) / steps);
        const lam = rel * top;
        let num = 0, tr = 0;
        for (let k = 0; k < M; k++) {
            const g = lam / (px[k] + lam); // 1 - filter factor
            num += g * g * py[k];
            tr += g;
        }
        const score = tr > 0 ? (M * num) / (tr * tr) : Infinity;
        if (score < best.score) best = { score, rel };
    }
    return { lambda: best.rel * top, rel: best.rel, score: best.score };
}

// ---------- (g) spectral helpers ----------

/** Phase unwrapping (jumps > pi are removed); NaN entries are skipped and left as NaN. */
export function unwrapPhase(phase) {
    const out = new Float64Array(phase.length);
    let offset = 0, prev = NaN;
    for (let i = 0; i < phase.length; i++) {
        const p = phase[i];
        if (!Number.isFinite(p)) { out[i] = NaN; continue; }
        if (Number.isFinite(prev)) {
            let d = p - prev;
            d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
            offset += d - (p - prev);
        }
        out[i] = p + offset;
        prev = p;
    }
    return out;
}

/** 20 log10(mag / ref), floored at floorDb (also for zero / invalid magnitudes). */
export function toDb(mag, floorDb = -120, ref = 1) {
    const out = new Float64Array(mag.length);
    for (let i = 0; i < mag.length; i++) {
        const v = mag[i] / ref;
        const d = v > 0 ? 20 * Math.log10(v) : floorDb;
        out[i] = Number.isFinite(d) ? Math.max(floorDb, d) : floorDb;
    }
    return out;
}

/**
 * One-sided spectrum (bins 0..M/2) of a real signal zero-padded to M: magnitude, wrapped phase
 * (NaN where the magnitude is below `tiny` * max), unwrapped phase and group delay in SAMPLES
 * (tau = -d phi / d omega = Re[ FFT(n x[n]) conj(X) ] / |X|^2, NaN where the magnitude is tiny).
 */
export function analyse(x, M, tiny = 1e-9) {
    const nb = M / 2 + 1;
    const X = spectrum(x, M);
    const nx = f64(M);
    for (let i = 0; i < Math.min(x.length, M); i++) nx[i] = i * x[i];
    const N1 = spectrum(nx, M);
    const mag = f64(nb), phase = f64(nb), delay = f64(nb);
    let top = 0;
    for (let k = 0; k < nb; k++) {
        mag[k] = Math.hypot(X.re[k], X.im[k]);
        if (mag[k] > top) top = mag[k];
    }
    const cut = top * tiny;
    for (let k = 0; k < nb; k++) {
        if (mag[k] > cut && mag[k] > 0) {
            phase[k] = Math.atan2(X.im[k], X.re[k]);
            delay[k] = (N1.re[k] * X.re[k] + N1.im[k] * X.im[k]) / (mag[k] * mag[k]);
        } else {
            phase[k] = NaN;
            delay[k] = NaN;
        }
    }
    return { mag, phase, unwrapped: unwrapPhase(phase), delay };
}

/** Group delay in samples for bins 0..M/2 (see analyse). */
export function groupDelay(x, M, tiny = 1e-9) {
    return analyse(x, M, tiny).delay;
}

// ---------- stretch: impulse response from a magnitude curve ----------

/**
 * Minimum-phase impulse response (length M) whose one-sided magnitude (M/2+1 bins) is `mag`,
 * via the real cepstrum (fold the cepstrum onto positive quefrencies, exponentiate).
 */
export function minimumPhaseFromMagnitude(mag, M) {
    const half = M / 2;
    if (mag.length !== half + 1) throw new Error('minimumPhaseFromMagnitude: mag must have M/2+1 bins');
    let top = 0;
    for (let k = 0; k <= half; k++) top = Math.max(top, mag[k]);
    if (!(top > 0)) return f64(M);
    const floor = top * 1e-8;
    const re = f64(M), im = f64(M);
    for (let k = 0; k <= half; k++) {
        const v = Math.log(Math.max(mag[k], floor));
        re[k] = v;
        if (k > 0 && k < half) re[M - k] = v;
    }
    ifft(re, im); // real cepstrum
    const cr = f64(M), ci = f64(M);
    cr[0] = re[0];
    for (let n = 1; n < half; n++) cr[n] = 2 * re[n];
    cr[half] = re[half];
    fft(cr, ci); // log spectrum of the minimum-phase system
    for (let k = 0; k < M; k++) {
        const e = Math.exp(cr[k]);
        const a = ci[k];
        cr[k] = e * Math.cos(a);
        ci[k] = e * Math.sin(a);
    }
    ifft(cr, ci);
    return cr;
}

/**
 * Linear-phase (symmetric) impulse response of length M with one-sided magnitude `mag`:
 * the zero-phase response shifted circularly by M/2 so it is causal.
 */
export function linearPhaseFromMagnitude(mag, M) {
    const half = M / 2;
    if (mag.length !== half + 1) throw new Error('linearPhaseFromMagnitude: mag must have M/2+1 bins');
    const re = f64(M), im = f64(M);
    for (let k = 0; k <= half; k++) {
        re[k] = mag[k];
        if (k > 0 && k < half) re[M - k] = mag[k];
    }
    ifft(re, im);
    const out = f64(M);
    for (let n = 0; n < M; n++) out[(n + half) % M] = re[n];
    return out;
}
