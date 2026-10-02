// 2D Fourier tools for square power-of-two grids stored row-major (index = y * n + x).
//
// Layouts: fft2 / ifft2 work on the "natural" layout (DC at index 0). Masks and display
// spectra use the CENTRED layout (fftshift: DC at (n/2, n/2)). applyMask() takes a natural
// spectrum plus a centred mask and does the index mapping internally.

import { fft, ifft, isPowerOfTwo } from './fft.js';

function checkGrid(re, im, n) {
    if (!isPowerOfTwo(n)) throw new Error(`fourier2d: n=${n} is not a power of two`);
    if (re.length !== n * n || im.length !== n * n) throw new Error('fourier2d: array length must be n*n');
}

function transform2(re, im, n, inverse) {
    checkGrid(re, im, n);
    const rr = new Float64Array(n), ri = new Float64Array(n);
    const op = inverse ? ifft : fft;
    for (let y = 0; y < n; y++) { // rows
        for (let x = 0; x < n; x++) { rr[x] = re[y * n + x]; ri[x] = im[y * n + x]; }
        op(rr, ri);
        for (let x = 0; x < n; x++) { re[y * n + x] = rr[x]; im[y * n + x] = ri[x]; }
    }
    for (let x = 0; x < n; x++) { // columns
        for (let y = 0; y < n; y++) { rr[y] = re[y * n + x]; ri[y] = im[y * n + x]; }
        op(rr, ri);
        for (let y = 0; y < n; y++) { re[y * n + x] = rr[y]; im[y * n + x] = ri[y]; }
    }
    return { re, im };
}

/** In-place 2D forward FFT (unscaled). */
export function fft2(re, im, n) { return transform2(re, im, n, false); }

/** In-place 2D inverse FFT, scaled by 1/n^2. */
export function ifft2(re, im, n) { return transform2(re, im, n, true); }

/** Swap quadrants so DC moves to (n/2, n/2). Returns a new array; for even n it is its own inverse. */
export function fftshift(data, n) {
    const out = new data.constructor(data.length);
    const h = n >> 1;
    for (let y = 0; y < n; y++) {
        const sy = (y + h) % n;
        for (let x = 0; x < n; x++) out[sy * n + ((x + h) % n)] = data[y * n + x];
    }
    return out;
}

/** |F| for each bin (natural layout in, natural layout out). */
export function magnitude(re, im) {
    const out = new Float64Array(re.length);
    for (let i = 0; i < re.length; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
}

/** Centred, normalised log-magnitude in [0, 1]: log(1+|F|) / log(1+max|F|). Input is a natural spectrum. */
export function logSpectrum(re, im, n) {
    const mag = fftshift(magnitude(re, im), n);
    let max = 0;
    for (const v of mag) if (v > max) max = v;
    const out = new Float64Array(mag.length);
    if (max <= 0) return out;
    const d = Math.log1p(max);
    for (let i = 0; i < mag.length; i++) out[i] = Math.log1p(mag[i]) / d;
    return out;
}

/** Forward transform of a real image (not modified). Returns the natural-layout spectrum. */
export function forwardImage(data, n) {
    const re = Float64Array.from(data);
    const im = new Float64Array(n * n);
    return fft2(re, im, n);
}

/** Centred mask keeping |fx| <= K and |fy| <= K. K=0 keeps only DC. */
export function lowpassSquare(n, K) {
    const mask = new Uint8Array(n * n);
    const h = n >> 1;
    for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
            if (Math.abs(u - h) <= K && Math.abs(v - h) <= K) mask[v * n + u] = 1;
        }
    }
    return mask;
}

/** Centred mask keeping fx^2 + fy^2 <= r^2. */
export function lowpassDisc(n, r) {
    const mask = new Uint8Array(n * n);
    const h = n >> 1;
    const r2 = r * r;
    for (let v = 0; v < n; v++) {
        for (let u = 0; u < n; u++) {
            const fx = u - h, fy = v - h;
            if (fx * fx + fy * fy <= r2 + 1e-9) mask[v * n + u] = 1;
        }
    }
    return mask;
}

/**
 * Centred mask keeping the K bins with the largest magnitude of a natural spectrum.
 * Ties break towards lower frequency radius, then index, so the result is deterministic.
 */
export function keepTopK(re, im, n, K) {
    const total = n * n;
    const mask = new Uint8Array(total);
    const k = Math.max(0, Math.min(total, Math.floor(K)));
    if (k === 0) return mask;
    const h = n >> 1;
    const mag = new Float64Array(total);
    const rad = new Float64Array(total);
    const idx = new Array(total);
    for (let i = 0; i < total; i++) {
        mag[i] = Math.round(Math.hypot(re[i], im[i]) * 1e9) / 1e9; // quantise so conjugate pairs tie exactly
        const x = i % n, y = (i - x) / n;
        const fx = x < h ? x : x - n, fy = y < h ? y : y - n; // signed frequency of natural bin
        rad[i] = fx * fx + fy * fy;
        idx[i] = i;
    }
    idx.sort((a, b) => (mag[b] - mag[a]) || (rad[a] - rad[b]) || (a - b));
    for (let j = 0; j < k; j++) {
        const i = idx[j];
        const x = i % n, y = (i - x) / n;
        mask[((y + h) % n) * n + ((x + h) % n)] = 1;
    }
    return mask;
}

/** Number of kept bins in a mask. */
export function maskCount(mask) {
    let c = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) c++;
    return c;
}

/** Copy of a natural spectrum with all bins outside the (centred) mask zeroed. */
export function applyMask(re, im, n, mask) {
    checkGrid(re, im, n);
    const outRe = new Float64Array(n * n), outIm = new Float64Array(n * n);
    const h = n >> 1;
    for (let y = 0; y < n; y++) {
        const sy = (y + h) % n;
        for (let x = 0; x < n; x++) {
            if (mask[sy * n + ((x + h) % n)]) {
                outRe[y * n + x] = re[y * n + x];
                outIm[y * n + x] = im[y * n + x];
            }
        }
    }
    return { re: outRe, im: outIm };
}

/** Inverse transform of the masked spectrum; returns the real part as Float64Array(n*n). */
export function reconstruct(re, im, n, mask) {
    const m = applyMask(re, im, n, mask);
    ifft2(m.re, m.im, n);
    return m.re;
}

/** Root mean squared difference of two equally long arrays. */
export function rmse(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s / Math.max(1, a.length));
}

/** PSNR in dB for the given peak value; Infinity for identical inputs. */
export function psnr(a, b, peak = 1) {
    const e = rmse(a, b);
    if (e < 1e-12) return Infinity;
    return 20 * Math.log10(peak / e);
}
