// Iterative radix-2 complex FFT on separate re / im Float64Arrays.
//
// Only power-of-two lengths are supported (documented design choice: every caller in this
// project resamples to 2^k points, so Bluestein is unnecessary). Conventions:
//   forward:  X[k] = sum_n x[n] exp(-2 pi i k n / N)        (unscaled)
//   inverse:  x[n] = (1/N) sum_k X[k] exp(+2 pi i k n / N)  (scaled, so ifft(fft(x)) = x)

/** True for 1, 2, 4, 8, ... */
export function isPowerOfTwo(n) {
    return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

/** Smallest power of two >= n (n >= 1). */
export function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

function checkArgs(re, im) {
    if (!re || !im || re.length !== im.length) throw new Error('fft: re and im must have equal length');
    if (!isPowerOfTwo(re.length)) throw new Error(`fft: length ${re.length} is not a power of two`);
}

/** In-place transform; `sign` = -1 forward, +1 inverse (inverse is NOT scaled here). */
function transform(re, im, sign) {
    checkArgs(re, im);
    const n = re.length;
    // bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1;
        const ang = (sign * 2 * Math.PI) / len;
        for (let k = 0; k < half; k++) {
            const wr = Math.cos(ang * k);
            const wi = Math.sin(ang * k);
            for (let i = k; i < n; i += len) {
                const j = i + half;
                const xr = re[j] * wr - im[j] * wi;
                const xi = re[j] * wi + im[j] * wr;
                re[j] = re[i] - xr; im[j] = im[i] - xi;
                re[i] += xr; im[i] += xi;
            }
        }
    }
}

/** In-place forward FFT. Returns { re, im } (the same arrays). */
export function fft(re, im) {
    transform(re, im, -1);
    return { re, im };
}

/** In-place inverse FFT, scaled by 1/N. */
export function ifft(re, im) {
    transform(re, im, +1);
    const s = 1 / re.length;
    for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; }
    return { re, im };
}

/** Naive O(N^2) DFT (any length) used to cross-check the FFT in tests. Not in-place. */
export function dft(re, im, inverse = false) {
    const n = re.length;
    const outRe = new Float64Array(n);
    const outIm = new Float64Array(n);
    const sign = inverse ? 1 : -1;
    for (let k = 0; k < n; k++) {
        let sr = 0, si = 0;
        for (let t = 0; t < n; t++) {
            const a = (sign * 2 * Math.PI * ((k * t) % n)) / n;
            const c = Math.cos(a), s = Math.sin(a);
            sr += re[t] * c - im[t] * s;
            si += re[t] * s + im[t] * c;
        }
        outRe[k] = inverse ? sr / n : sr;
        outIm[k] = inverse ? si / n : si;
    }
    return { re: outRe, im: outIm };
}
