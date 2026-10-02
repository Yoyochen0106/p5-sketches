// Input-signal presets and system (impulse response) presets for the Impulse Response Lab.
// Every generator takes the sample count n and scales its features with n, so shapes look alike at
// N = 128 ... 1024.

const f64 = (n) => new Float64Array(n);

/** Small deterministic PRNG (LCG) so "noise" presets and measurement noise are reproducible. */
export function makeRng(seed = 1) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/** Standard normal samples from a seed. */
export function gaussianNoise(n, seed = 1) {
    const r = makeRng(seed);
    const out = f64(n);
    for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    return out;
}

const at = (n, frac) => Math.max(0, Math.min(n - 1, Math.round(frac * n)));
const hann = (m, len) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (m + 0.5)) / len);

export const X_PRESETS = [
    { id: 'impulse', label: 'Impulse', make: (n) => { const x = f64(n); x[0] = 1; return x; } },
    { id: 'step', label: 'Step', make: (n) => new Float64Array(n).fill(1) },
    {
        id: 'rect', label: 'Rectangular pulse', make: (n) => {
            const x = f64(n);
            for (let i = at(n, 0.03); i < at(n, 0.2); i++) x[i] = 1;
            return x;
        },
    },
    {
        id: 'gauss', label: 'Gaussian pulse', make: (n) => {
            const x = f64(n), c = 0.15 * n, s = 0.04 * n;
            for (let i = 0; i < n; i++) x[i] = Math.exp(-0.5 * ((i - c) / s) ** 2);
            return x;
        },
    },
    {
        id: 'burst', label: 'Sine burst', make: (n) => {
            const x = f64(n), len = Math.round(0.25 * n), i0 = at(n, 0.02);
            for (let m = 0; m < len && i0 + m < n; m++) x[i0 + m] = hann(m, len) * Math.sin((2 * Math.PI * 8 * m) / len);
            return x;
        },
    },
    {
        id: 'chirp', label: 'Chirp', make: (n) => {
            const x = f64(n), len = Math.round(0.3 * n), i0 = at(n, 0.01);
            const f0 = 0.01, f1 = 0.3; // cycles per sample, linear sweep
            for (let m = 0; m < len && i0 + m < n; m++) {
                const ph = 2 * Math.PI * (f0 * m + ((f1 - f0) * m * m) / (2 * len));
                x[i0 + m] = hann(m, len) * Math.sin(ph);
            }
            return x;
        },
    },
    {
        id: 'noise', label: 'Noise burst', make: (n) => {
            const x = f64(n), len = Math.round(0.25 * n), g = gaussianNoise(len, 7);
            for (let m = 0; m < len; m++) x[m] = 0.5 * g[m] * hann(m, len) * 1.6;
            return x;
        },
    },
    {
        id: 'two', label: 'Two impulses', make: (n) => {
            const x = f64(n);
            x[at(n, 0.05)] = 1;
            x[at(n, 0.17)] = -0.6;
            return x;
        },
    },
];

function lowpass(n, tau) {
    const a = Math.exp(-1 / tau), h = f64(n);
    for (let k = 0; k < n; k++) h[k] = (1 - a) * a ** k;
    return h;
}

/** Echo with a delay (fraction of n) and gain; extra parameters come from the sketch sliders. */
export function echoKernel(n, delayFrac = 0.12, gain = 0.6) {
    const h = f64(n);
    h[0] = 1;
    h[Math.max(1, Math.min(n - 1, Math.round(delayFrac * n)))] += gain;
    return h;
}

export const SYSTEM_PRESETS = [
    { id: 'lowpass', label: 'Low-pass (RC)', make: (n) => lowpass(n, 0.04 * n) },
    {
        id: 'highpass', label: 'High-pass', make: (n) => {
            const h = lowpass(n, 0.04 * n);
            for (let k = 0; k < n; k++) h[k] = -h[k];
            h[0] += 1;
            return h;
        },
    },
    {
        id: 'moving', label: 'Moving average', make: (n) => {
            const h = f64(n), w = Math.max(2, Math.round(0.06 * n));
            for (let k = 0; k < w; k++) h[k] = 1 / w;
            return h;
        },
    },
    { id: 'echo', label: 'Echo (delay / gain)', make: (n, o = {}) => echoKernel(n, o.delay ?? 0.12, o.gain ?? 0.6) },
    {
        id: 'ring', label: 'Resonant ring-down', make: (n) => {
            const h = f64(n), tau = 0.08 * n, w = (2 * Math.PI * 12) / n;
            for (let k = 0; k < n; k++) h[k] = 0.4 * Math.exp(-k / tau) * Math.sin(w * k);
            return h;
        },
    },
    {
        id: 'comb', label: 'Comb filter', make: (n) => {
            const h = f64(n), d = Math.max(2, Math.round(0.08 * n));
            for (let m = 0; m * d < n; m++) h[m * d] = 0.7 ** m;
            return h;
        },
    },
    { id: 'diff', label: 'Differentiator', make: (n) => { const h = f64(n); h[0] = 1; h[1] = -1; return h; } },
    {
        id: 'allpass', label: 'All-pass', make: (n) => {
            const a = 0.7, h = f64(n);
            h[0] = -a;
            for (let k = 1; k < n; k++) h[k] = (1 - a * a) * a ** (k - 1);
            return h;
        },
    },
    {
        id: 'bandpass', label: 'Band-pass', make: (n) => {
            const len = Math.max(8, Math.round(0.2 * n)), c = (len - 1) / 2, h = f64(n);
            const f1 = 0.08, f2 = 0.16; // cycles per sample (band edges)
            const sinc = (v) => (Math.abs(v) < 1e-12 ? 1 : Math.sin(Math.PI * v) / (Math.PI * v));
            for (let k = 0; k < len && k < n; k++) {
                const m = k - c;
                h[k] = hann(k, len) * (2 * f2 * sinc(2 * f2 * m) - 2 * f1 * sinc(2 * f1 * m));
            }
            return h;
        },
    },
];

export const getXPreset = (id) => X_PRESETS.find((p) => p.id === id) || null;
export const getSystemPreset = (id) => SYSTEM_PRESETS.find((p) => p.id === id) || null;
