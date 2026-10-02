import test from 'node:test';
import assert from 'node:assert/strict';
import { fft, ifft, dft, isPowerOfTwo, nextPowerOfTwo } from '../../lib/fft.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

function lcg(seed) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

test('helpers: isPowerOfTwo / nextPowerOfTwo', () => {
    assert.ok([1, 2, 4, 1024].every(isPowerOfTwo));
    assert.ok([0, 3, 6, 1.5, -4].every((n) => !isPowerOfTwo(n)));
    assert.equal(nextPowerOfTwo(5), 8);
    assert.equal(nextPowerOfTwo(8), 8);
    assert.equal(nextPowerOfTwo(1), 1);
});

test('impulse -> flat spectrum', () => {
    const re = new Float64Array(16), im = new Float64Array(16);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < 16; k++) { close(re[k], 1); close(im[k], 0); }
});

test('shifted impulse -> pure phase ramp', () => {
    const N = 16;
    const re = new Float64Array(N), im = new Float64Array(N);
    re[3] = 1;
    fft(re, im);
    for (let k = 0; k < N; k++) {
        close(re[k], Math.cos((-2 * Math.PI * 3 * k) / N));
        close(im[k], Math.sin((-2 * Math.PI * 3 * k) / N));
    }
});

test('pure tone lands in exactly one bin with amplitude N', () => {
    const N = 64, f = 5;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) { re[n] = Math.cos((2 * Math.PI * f * n) / N); im[n] = Math.sin((2 * Math.PI * f * n) / N); }
    fft(re, im);
    for (let k = 0; k < N; k++) {
        close(re[k], k === f ? N : 0, 1e-8);
        close(im[k], 0, 1e-8);
    }
});

test('real cosine -> two conjugate bins of N/2', () => {
    const N = 32, f = 3;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let n = 0; n < N; n++) re[n] = Math.cos((2 * Math.PI * f * n) / N);
    fft(re, im);
    close(re[f], N / 2); close(re[N - f], N / 2);
    close(Math.hypot(re[0], im[0]), 0, 1e-9);
});

test('matches the naive DFT on random complex data (several sizes)', () => {
    const rnd = lcg(7);
    for (const N of [1, 2, 4, 8, 32, 128]) {
        const re = Float64Array.from({ length: N }, rnd), im = Float64Array.from({ length: N }, rnd);
        const ref = dft(re, im);
        const a = Float64Array.from(re), b = Float64Array.from(im);
        fft(a, b);
        for (let k = 0; k < N; k++) { close(a[k], ref.re[k], 1e-8, `N=${N} re`); close(b[k], ref.im[k], 1e-8, `N=${N} im`); }
    }
});

test('naive inverse DFT undoes the naive forward DFT (non power of two length)', () => {
    const rnd = lcg(3);
    const re = Float64Array.from({ length: 12 }, rnd), im = Float64Array.from({ length: 12 }, rnd);
    const f = dft(re, im);
    const g = dft(f.re, f.im, true);
    for (let i = 0; i < 12; i++) { close(g.re[i], re[i]); close(g.im[i], im[i]); }
});

test('round trip ifft(fft(x)) = x', () => {
    const rnd = lcg(11);
    const N = 256;
    const re = Float64Array.from({ length: N }, rnd), im = Float64Array.from({ length: N }, rnd);
    const a = Float64Array.from(re), b = Float64Array.from(im);
    fft(a, b); ifft(a, b);
    for (let i = 0; i < N; i++) { close(a[i], re[i], 1e-10); close(b[i], im[i], 1e-10); }
});

test('Parseval: sum |x|^2 = (1/N) sum |X|^2', () => {
    const rnd = lcg(5);
    const N = 128;
    const re = Float64Array.from({ length: N }, rnd), im = Float64Array.from({ length: N }, rnd);
    let e = 0;
    for (let i = 0; i < N; i++) e += re[i] * re[i] + im[i] * im[i];
    fft(re, im);
    let E = 0;
    for (let i = 0; i < N; i++) E += re[i] * re[i] + im[i] * im[i];
    close(E / N, e, 1e-8);
});

test('linearity', () => {
    const rnd = lcg(2);
    const N = 32;
    const x = Float64Array.from({ length: N }, rnd), y = Float64Array.from({ length: N }, rnd);
    const z = x.map((v, i) => 2 * v - 3 * y[i]);
    const zero = () => new Float64Array(N);
    const X = fft(Float64Array.from(x), zero()), Y = fft(Float64Array.from(y), zero()), Z = fft(z, zero());
    for (let k = 0; k < N; k++) { close(Z.re[k], 2 * X.re[k] - 3 * Y.re[k], 1e-9); close(Z.im[k], 2 * X.im[k] - 3 * Y.im[k], 1e-9); }
});

test('rejects non power of two and mismatched lengths', () => {
    assert.throws(() => fft(new Float64Array(6), new Float64Array(6)), /power of two/);
    assert.throws(() => fft(new Float64Array(4), new Float64Array(8)), /equal length/);
});
