import test from 'node:test';
import assert from 'node:assert/strict';
import {
    linearConvolve, circularConvolve, convolveTruncated, wienerDeconvolve, leastSquaresDeconvolve, deconvolve,
    solveTriple, residualNorm, conditionIndicators, autoLambda, lambdaFromRelative, unwrapPhase, toDb,
    analyse, groupDelay, minimumPhaseFromMagnitude, linearPhaseFromMagnitude,
} from '../../lib/deconv.js';

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const randSig = (n, seed) => { const r = rng(seed); return Float64Array.from({ length: n }, () => gauss(r)); };
const maxErr = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const l2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s); };

function echo(n, d, g) { const h = new Float64Array(n); h[0] = 1; h[d] += g; return h; }
function lowpass(n, a = 0.8) { return Float64Array.from({ length: n }, (_, k) => (1 - a) * a ** k); }
function resonance(n) { return Float64Array.from({ length: n }, (_, k) => Math.exp(-k / 8) * Math.sin(0.7 * k)); }

test('linearConvolve matches definition, FFT path matches direct', () => {
    const y = linearConvolve([1, 2, 3], [0, 1, 0.5]);
    assert.deepEqual(Array.from(y), [0, 1, 2.5, 4, 1.5]);
    const a = randSig(300, 1), b = randSig(200, 2);
    const fast = linearConvolve(a, b);
    const slow = new Float64Array(499);
    for (let i = 0; i < 300; i++) for (let j = 0; j < 200; j++) slow[i + j] += a[i] * b[j];
    assert.ok(maxErr(fast, slow) < 1e-10);
});

test('time-domain LS recovers echo / low-pass / resonance to 1e-9 (noiseless)', () => {
    for (const make of [() => echo(32, 9, 0.6), () => lowpass(32), () => resonance(32)]) {
        const h = make();
        const x = randSig(64, 3);
        const y = convolveTruncated(x, h, 64);
        const est = leastSquaresDeconvolve(y, x, { L: 32, lambda: 0 });
        assert.ok(maxErr(est, h) < 1e-9, String(maxErr(est, h)));
    }
});

test('CG solver agrees with Cholesky', () => {
    const h = resonance(40), x = randSig(80, 4);
    const y = convolveTruncated(x, h, 80);
    const a = leastSquaresDeconvolve(y, x, { L: 40, lambda: 1e-6, solver: 'cholesky' });
    const b = leastSquaresDeconvolve(y, x, { L: 40, lambda: 1e-6, solver: 'cg', maxIter: 400 });
    assert.ok(maxErr(a, b) < 1e-6, String(maxErr(a, b)));
});

test('frequency-domain Wiener with tiny lambda recovers h to ~1e-6', () => {
    for (const make of [() => echo(32, 9, 0.6), () => lowpass(32), () => resonance(32)]) {
        const h = make();
        const x = randSig(64, 5);
        const y = linearConvolve(x, h); // full length: nothing truncated
        const est = wienerDeconvolve(y, x, { L: 32, lambda: 1e-12 });
        assert.ok(maxErr(est, h) < 1e-6, String(maxErr(est, h)));
    }
});

test('impulse input gives h = y (both methods)', () => {
    const x = new Float64Array(64); x[0] = 1;
    const y = randSig(64, 6);
    assert.ok(maxErr(wienerDeconvolve(y, x, { L: 64 }), y) < 1e-12);
    assert.ok(maxErr(leastSquaresDeconvolve(y, x, { L: 64 }), y) < 1e-10);
});

test('noise robustness: error falls then rises with lambda', () => {
    const h = lowpass(48, 0.85);
    const x = linearConvolve(randSig(96, 7), lowpass(40, 0.92)).subarray(0, 96); // band-limited input: ill-conditioned
    const clean = linearConvolve(x, h);
    const r = rng(8);
    const y = clean.map((v) => v + 0.002 * gauss(r));
    const errs = [-12, -8, -4, -2, 0, 1, 2].map((e) => {
        const est = wienerDeconvolve(y, x, { L: 48, lambda: 10 ** e });
        return l2(est, h);
    });
    const best = errs.indexOf(Math.min(...errs));
    assert.ok(best > 0 && best < errs.length - 1, JSON.stringify(errs));
    assert.ok(errs[0] > errs[best] * 1.5 && errs[errs.length - 1] > errs[best] * 1.5);
    // the GCV pick beats the (almost) unregularised solve
    const g = autoLambda(y, x, { L: 48 });
    const auto = l2(wienerDeconvolve(y, x, { L: 48, lambda: g.lambda }), h);
    assert.ok(auto < errs[0] && g.rel > 1e-12, `${auto} ${errs[0]} ${g.rel}`);
});

test('non-negative LS respects h >= 0 and recovers a non-negative h', () => {
    const h2 = lowpass(32, 0.7);
    const hh = echo(32, 11, 0.7).map((v, i) => v + h2[i]);
    const x = randSig(64, 9);
    const r = rng(10);
    const y = convolveTruncated(x, hh, 64).map((v) => v + 0.02 * gauss(r));
    const est = leastSquaresDeconvolve(y, x, { L: 32, lambda: 1e-6, nonneg: true });
    assert.ok(Math.min(...est) >= 0);
    assert.ok(l2(est, hh) < 0.1, String(l2(est, hh)));
    const unc = leastSquaresDeconvolve(y, x, { L: 32, lambda: 0 });
    assert.ok(Math.min(...unc) < 0, 'unconstrained fit goes negative with noise');
});

test('circular wrap artefact when padding is disabled', () => {
    const h = echo(16, 5, 0.8);
    const x = randSig(64, 11);
    const y = linearConvolve(x, h); // 79 samples: the tail wraps without padding
    const padded = wienerDeconvolve(y, x, { L: 16, lambda: 1e-12 });
    const wrapped = wienerDeconvolve(y, x, { L: 16, lambda: 1e-12, pad: false });
    assert.ok(maxErr(padded, h) < 1e-6);
    assert.ok(maxErr(wrapped, h) > 0.05, String(maxErr(wrapped, h)));
    // circularConvolve really is the wrapped version of the linear one
    const hp = new Float64Array(64); hp.set(h);
    const c = circularConvolve(x, hp);
    const lin = linearConvolve(x, h);
    for (let i = 0; i < 15; i++) assert.ok(Math.abs(c[i] - (lin[i] + lin[i + 64])) < 1e-10);
});

test('truncate-to-support option and anti-causal lead', () => {
    const h = echo(32, 20, 0.5);
    const x = randSig(64, 12);
    const y = convolveTruncated(x, h, 64);
    const est = wienerDeconvolve(y, x, { L: 8, lambda: 1e-10 });
    assert.equal(est.length, 8);
    // lead: h[j] is the response at lag j - lead
    const hl = new Float64Array(16); hl[2] = 1; hl[5] = 0.5;
    const lead = 4;
    const yl = new Float64Array(64);
    for (let n = 0; n < 64; n++) for (let j = 0; j < 16; j++) { const m = n - (j - lead); if (m >= 0 && m < 64) yl[n] += hl[j] * x[m]; }
    const el = leastSquaresDeconvolve(yl, x, { L: 16, lead });
    assert.ok(maxErr(el, hl) < 1e-8, String(maxErr(el, hl)));
});

test('derived modes are consistent with convolution', () => {
    const n = 64;
    const x = randSig(n, 13), h = new Float64Array(n);
    h.set(echo(10, 4, 0.5));
    const y = solveTriple({ mode: 'y', x, h, y: null }).y;
    assert.ok(maxErr(y, convolveTruncated(x, h, n)) < 1e-12);
    const hs = solveTriple({ mode: 'h', x, y, method: 'ls', lambdaRel: 1e-14, L: 32 }).h;
    assert.ok(maxErr(hs, h) < 1e-7);
    const xs = solveTriple({ mode: 'x', y, h, method: 'ls', lambdaRel: 1e-14 }).x;
    assert.ok(maxErr(xs, x) < 1e-6, String(maxErr(xs, x)));
    assert.ok(residualNorm(x, hs, y) < 1e-8);
    assert.ok(residualNorm(xs, h, y) < 1e-8);
    const res = residualNorm(x, new Float64Array(n), y);
    assert.ok(Math.abs(res - 1) < 1e-12);
});

test('metrics and lambda helpers', () => {
    const x = new Float64Array(32); x[0] = 1;
    const c = conditionIndicators(x);
    assert.ok(Math.abs(c.min - 1) < 1e-12 && Math.abs(c.ratio - 1) < 1e-12);
    const x2 = Float64Array.from({ length: 32 }, (_, i) => (i < 8 ? 1 : 0));
    const c2 = conditionIndicators(x2, { band: [0.5, 1], lambda: 1 });
    assert.ok(c2.min < c2.max && c2.fracBelow > 0);
    assert.ok(Math.abs(lambdaFromRelative(x, 0.01) - 0.01) < 1e-12);
    assert.equal(deconvolve(x, x, { method: 'wiener', L: 4 }).length, 4);
});

test('unwrap, dB and group delay of a pure delay', () => {
    const un = unwrapPhase(Float64Array.from({ length: 50 }, (_, i) => Math.atan2(Math.sin(-0.9 * i), Math.cos(-0.9 * i))));
    for (let i = 0; i < 50; i++) assert.ok(Math.abs(un[i] + 0.9 * i) < 1e-9);
    assert.deepEqual(Array.from(toDb([1, 0.1, 0, NaN], -60)).map((v) => Math.round(v)), [0, -20, -60, -60]);
    const M = 128, d = 7;
    const x = new Float64Array(64); x[d] = 1;
    const a = analyse(x, M);
    for (let k = 0; k < a.delay.length; k++) assert.ok(Math.abs(a.delay[k] - d) < 1e-9);
    for (let k = 0; k < a.unwrapped.length; k++) assert.ok(Math.abs(a.unwrapped[k] + (2 * Math.PI * k * d) / M) < 1e-8);
    const gd = groupDelay(Float64Array.from([1, 0.5]), 64);
    assert.ok(gd[0] > 0 && gd[0] < 1);
});

test('minimum-phase / linear-phase reconstruction from magnitude', () => {
    const M = 256;
    const h = Float64Array.from({ length: M }, (_, k) => (k < 40 ? 0.8 ** k : 0));
    const { mag } = analyse(h, M);
    const hm = minimumPhaseFromMagnitude(mag, M);
    assert.ok(maxErr(hm, h) < 1e-6, String(maxErr(hm, h)));
    const lp = linearPhaseFromMagnitude(mag, M);
    const a = analyse(lp, M);
    assert.ok(maxErr(a.mag, mag) < 1e-9);
    assert.ok(Math.abs(a.delay[3] - M / 2) < 1e-6);
});
