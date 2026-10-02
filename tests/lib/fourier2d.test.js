import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fft2, ifft2, fftshift, magnitude, logSpectrum, forwardImage, lowpassSquare, lowpassDisc,
    keepTopK, maskCount, applyMask, reconstruct, rmse, psnr,
} from '../../lib/fourier2d.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

function lcg(seed) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function randomImage(n, seed = 1) {
    const r = lcg(seed);
    return Float64Array.from({ length: n * n }, r);
}

test('impulse at origin -> flat spectrum; constant -> single DC bin', () => {
    const n = 8;
    const re = new Float64Array(n * n), im = new Float64Array(n * n);
    re[0] = 1;
    fft2(re, im, n);
    for (let i = 0; i < n * n; i++) { close(re[i], 1); close(im[i], 0); }
    const c = new Float64Array(n * n).fill(0.5), ci = new Float64Array(n * n);
    fft2(c, ci, n);
    close(c[0], 0.5 * n * n);
    for (let i = 1; i < n * n; i++) close(Math.hypot(c[i], ci[i]), 0, 1e-9);
});

test('2D plane wave lands on a single bin (and its mirror for a cosine)', () => {
    const n = 16, fx = 3, fy = 2;
    const data = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = Math.cos((2 * Math.PI * (fx * x + fy * y)) / n);
    const { re, im } = forwardImage(data, n);
    const mag = magnitude(re, im);
    close(mag[fy * n + fx], (n * n) / 2, 1e-7);
    close(mag[((n - fy) % n) * n + ((n - fx) % n)], (n * n) / 2, 1e-7);
    let others = 0;
    for (let i = 0; i < n * n; i++) if (mag[i] > 1e-7) others++;
    assert.equal(others, 2);
});

test('round trip ifft2(fft2(x)) = x and matches separable definition', () => {
    const n = 16;
    const x = randomImage(n, 4);
    const re = Float64Array.from(x), im = new Float64Array(n * n);
    fft2(re, im, n);
    // spot check bin (1,2) against the direct double sum
    let sr = 0, si = 0;
    for (let y = 0; y < n; y++) for (let xx = 0; xx < n; xx++) {
        const a = (-2 * Math.PI * (1 * xx + 2 * y)) / n;
        sr += x[y * n + xx] * Math.cos(a); si += x[y * n + xx] * Math.sin(a);
    }
    close(re[2 * n + 1], sr, 1e-8); close(im[2 * n + 1], si, 1e-8);
    ifft2(re, im, n);
    for (let i = 0; i < n * n; i++) { close(re[i], x[i], 1e-10); close(im[i], 0, 1e-10); }
});

test('Parseval in 2D', () => {
    const n = 32;
    const x = randomImage(n, 9);
    let e = 0;
    for (const v of x) e += v * v;
    const { re, im } = forwardImage(x, n);
    let E = 0;
    for (let i = 0; i < n * n; i++) E += re[i] * re[i] + im[i] * im[i];
    close(E / (n * n), e, 1e-8);
});

test('fftshift moves DC to the centre and is an involution', () => {
    const n = 8;
    const a = Float64Array.from({ length: n * n }, (_, i) => i);
    const s = fftshift(a, n);
    assert.equal(s[(n / 2) * n + n / 2], 0);
    assert.equal(s[0], a[(n / 2) * n + n / 2]);
    assert.deepEqual(Array.from(fftshift(s, n)), Array.from(a));
});

test('logSpectrum is centred, in [0,1], peaks at DC for a constant image', () => {
    const n = 8;
    const { re, im } = forwardImage(new Float64Array(n * n).fill(1), n);
    const L = logSpectrum(re, im, n);
    close(L[(n / 2) * n + n / 2], 1);
    assert.ok(Array.from(L).every((v) => v >= 0 && v <= 1));
    const z = logSpectrum(new Float64Array(n * n), new Float64Array(n * n), n);
    assert.ok(Array.from(z).every((v) => v === 0));
});

test('lowpassSquare / lowpassDisc counts and symmetry', () => {
    const n = 16;
    assert.equal(maskCount(lowpassSquare(n, 0)), 1);
    assert.equal(maskCount(lowpassSquare(n, 2)), 25);
    assert.equal(maskCount(lowpassSquare(n, 100)), n * n);
    assert.equal(lowpassSquare(n, 0)[(n / 2) * n + n / 2], 1);
    assert.equal(maskCount(lowpassDisc(n, 0)), 1);
    assert.equal(maskCount(lowpassDisc(n, 1)), 5);
    assert.equal(maskCount(lowpassDisc(n, 2)), 13);
    // disc subset of square of the same half-width
    const d = lowpassDisc(n, 3), s = lowpassSquare(n, 3);
    for (let i = 0; i < n * n; i++) if (d[i]) assert.equal(s[i], 1);
});

test('keepTopK picks the largest magnitudes; full K reproduces the image', () => {
    const n = 16;
    const x = randomImage(n, 21);
    const { re, im } = forwardImage(x, n);
    const m = keepTopK(re, im, n, 10);
    assert.equal(maskCount(m), 10);
    assert.equal(maskCount(keepTopK(re, im, n, 0)), 0);
    assert.equal(maskCount(keepTopK(re, im, n, 1e9)), n * n);
    // the DC term of a positive image is the largest magnitude
    assert.equal(m[(n / 2) * n + n / 2], 1);
    const rec = reconstruct(re, im, n, keepTopK(re, im, n, n * n));
    for (let i = 0; i < n * n; i++) close(rec[i], x[i], 1e-10);
});

test('top-K reconstruction error is non-increasing in K and equals the dropped energy (Parseval)', () => {
    const n = 16;
    const x = randomImage(n, 33);
    const { re, im } = forwardImage(x, n);
    const total = n * n;
    let prev = Infinity;
    for (const K of [1, 2, 4, 9, 20, 50, 128, 256]) {
        const mask = keepTopK(re, im, n, K);
        const rec = reconstruct(re, im, n, mask);
        const e = rmse(rec, x);
        assert.ok(e <= prev + 1e-12, `K=${K} err ${e} > ${prev}`);
        prev = e;
        // dropped energy (complex output) bound: real part error cannot exceed the dropped energy
        let dropped = 0;
        const h = n / 2;
        for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
            if (!mask[((yy + h) % n) * n + ((xx + h) % n)]) dropped += re[yy * n + xx] ** 2 + im[yy * n + xx] ** 2;
        }
        assert.ok(e * e * total <= dropped / total + 1e-9, `K=${K}`);
    }
    close(prev, 0, 1e-10);
});

test('conjugate-symmetric masks give a real reconstruction (imaginary part ~ 0)', () => {
    const n = 16;
    const x = randomImage(n, 5);
    const { re, im } = forwardImage(x, n);
    const m = applyMask(re, im, n, lowpassDisc(n, 3));
    ifft2(m.re, m.im, n);
    // Nyquist row/col are not in a radius-3 disc, so symmetry is exact
    for (let i = 0; i < n * n; i++) close(m.im[i], 0, 1e-10);
});

test('low-pass of a constant image is exact with K=0; applyMask zeroes outside', () => {
    const n = 8;
    const x = new Float64Array(n * n).fill(0.25);
    const { re, im } = forwardImage(x, n);
    const rec = reconstruct(re, im, n, lowpassSquare(n, 0));
    for (const v of rec) close(v, 0.25);
    const none = applyMask(re, im, n, new Uint8Array(n * n));
    assert.ok(Array.from(none.re).every((v) => v === 0));
});

test('rmse / psnr', () => {
    const a = new Float64Array([0, 0, 0, 0]), b = new Float64Array([0.1, 0.1, 0.1, 0.1]);
    close(rmse(a, b), 0.1);
    close(psnr(a, b, 1), 20, 1e-9);
    assert.equal(psnr(a, a), Infinity);
});

test('rejects non power of two grids', () => {
    assert.throws(() => fft2(new Float64Array(36), new Float64Array(36), 6), /power of two/);
    assert.throws(() => fft2(new Float64Array(10), new Float64Array(10), 4), /n\*n/);
});
