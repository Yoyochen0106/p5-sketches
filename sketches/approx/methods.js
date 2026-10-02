// Approximation methods. Each method turns the current function + parameters into a "fit":
//   { info, real(x), complex?(z), ... }
// `env` = { func, a: [re, im], get(key), view: {x0, x1}, cache: Map }.
// A method returns null when it cannot apply (e.g. Taylor of a non-analytic function).

import { hornerReal, hornerComplex } from '../../lib/poly.js';
import { pade, evalRational, evalRationalReal, poles, zeros } from '../../lib/pade.js';
import { fourierFit, fourierPartial } from '../../lib/fourier.js';
import { applyWindow, measureOvershoot, JUMP_POINTS } from '../../lib/fourier-windows.js';
import { interpolate, maxError, lebesgueConstant } from '../../lib/interp.js';
import { FAMILIES, getFamily } from '../../lib/wavelets/families.js';
import { waveletApprox, waveletFunction } from '../../lib/wavelets/dwt.js';
import { METHOD_COLORS } from './palette.js';

const isRealCenter = (a) => a[1] === 0;

/** Small LRU-ish memo: returns cache[key] or computes and stores it. */
function memo(cache, key, compute, limit = 24) {
    if (cache.has(key)) {
        const v = cache.get(key);
        cache.delete(key);
        cache.set(key, v);
        return v;
    }
    const v = compute();
    cache.set(key, v);
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return v;
}

/** Taylor coefficients about `a`, memoised on (function, centre, order). */
export function taylorCoefs(env, n) {
    const { func, a, cache } = env;
    return memo(cache, `tc|${func.id}|${a[0]}|${a[1]}|${n}`, () => func.taylor(a, n), 64);
}

export const taylor = {
    id: 'taylor',
    name: 'Taylor',
    color: METHOD_COLORS.taylor,
    needsAnalytic: true,
    fit(env) {
        const { func, a } = env;
        if (!func.analytic) return null;
        const n = env.get('taylor.order');
        const coefs = taylorCoefs(env, n);
        const real = isRealCenter(a)
            ? (x) => hornerReal(coefs, x - a[0])
            : (x) => hornerComplex(coefs, [x - a[0], -a[1]])[0];
        return {
            info: `Taylor  n=${n}`,
            coefs,
            order: n,
            center: a,
            real,
            complex: (z) => hornerComplex(coefs, [z[0] - a[0], z[1] - a[1]]),
        };
    },
};

export const padeMethod = {
    id: 'pade',
    name: 'Padé',
    color: METHOD_COLORS.pade,
    needsAnalytic: true,
    fit(env) {
        const { func, a } = env;
        if (!func.analytic) return null;
        const L = env.get('pade.L');
        const M = env.get('pade.M');
        const coefs = taylorCoefs(env, L + M);
        const r = pade(coefs, L, M);
        const shift = (p) => [p[0] + a[0], p[1] + a[1]];
        const real = isRealCenter(a)
            ? (x) => evalRationalReal(r, x - a[0])
            : (x) => evalRational(r, [x - a[0], -a[1]])[0];
        return {
            info: `Padé  [${r.L}/${r.M}]`,
            rational: r,
            real,
            complex: (z) => evalRational(r, [z[0] - a[0], z[1] - a[1]]),
            poles: poles(r).map(shift),
            zeros: zeros(r).map(shift),
        };
    },
};

const FOURIER_MAX_N = 128;

/** Fourier period: user value, else the function's own period, else the fit window width. */
export function fourierPeriod(env) {
    const user = env.get('fourier.period');
    if (user > 0) return user;
    if (env.func.period) return env.func.period;
    return 2 * Math.PI;
}

/** Measured overshoot at the first jump of f (square / saw / step) for the displayed (possibly windowed) sum. */
function fourierGibbs(env, part, period, N, win) {
    const { func, cache } = env;
    const xj = JUMP_POINTS[func.id];
    if (xj === undefined) return null;
    const reach = Math.min(period, func.period || period) / 4;
    const o = memo(cache, `gb|${func.id}|${period}|${N}|${win}`, () => measureOvershoot(part.evalReal, func.f, xj, reach));
    return o ? { ...o, xj, reach } : null;
}

export const fourier = {
    id: 'fourier',
    name: 'Fourier',
    color: METHOD_COLORS.fourier,
    needsAnalytic: false,
    fit(env) {
        const { func, cache } = env;
        const period = fourierPeriod(env);
        const x0 = -period / 2;
        const full = memo(cache, `ff|${func.id}|${period}`, () =>
            fourierFit(func.f, { period, x0, N: FOURIER_MAX_N, samples: 4096 }));
        const N = Math.min(env.get('fourier.N'), FOURIER_MAX_N);
        const win = env.get('fourier.window') || 'none';
        const plain = fourierPartial(full, N);
        const part = win === 'none' ? plain : applyWindow(plain, win);
        const gibbs = fourierGibbs(env, part, period, N, win);
        return {
            info: `Fourier  N=${N}  T=${+period.toPrecision(4)}${win === 'none' ? '' : `  ${win}`}`,
            lines: gibbs ? [`overshoot ${(gibbs.overshoot * 100).toFixed(2)}% of jump  (plain Gibbs 8.95%)`] : [],
            gibbs,
            window: win,
            fit: part,
            period,
            x0,
            real: (x) => part.evalReal(x),
            complex: (z) => part.evalComplex(z),
        };
    },
};

export const INTERP_MAX_N = 80;

/** Interpolation window: the (quantised) visible x range, or [a - W, a + W] around the expansion point. */
export function interpWindow(env) {
    if (env.get('interp.window') === 'center') {
        const W = Math.max(1e-6, env.get('interp.W'));
        return [env.a[0] - W, env.a[0] + W];
    }
    const span = Math.max(1e-9, env.view.x1 - env.view.x0);
    const step = span / 16;
    const lo = quantize(env.view.x0, step);
    let hi = quantize(env.view.x1, step);
    if (!(hi > lo)) hi = lo + step;
    return [lo, hi];
}

export const interp = {
    id: 'interp',
    name: 'Interpolation',
    color: METHOD_COLORS.interp,
    needsAnalytic: false,
    fit(env) {
        const { func, cache } = env;
        const n = Math.min(INTERP_MAX_N, Math.max(0, Math.round(env.get('interp.n'))));
        const family = env.get('interp.family');
        const [lo, hi] = interpWindow(env);
        const build = (fam) => memo(cache, `if|${func.id}|${fam}|${n}|${lo}|${hi}`, () => {
            const p = interpolate(func.f, { family: fam, n, a: lo, b: hi });
            return { p, err: maxError(func.f, p, lo, hi), leb: lebesgueConstant(p) };
        });
        const r = build(family);
        const cmp = env.get('interp.compare') && family !== 'chebyshev' ? build('chebyshev') : null;
        const fmtErr = Number.isFinite(r.err) ? r.err.toExponential(2) : '?';
        return {
            info: `Interpolation  n=${n}  ${family}`,
            lines: [`max |f−p| = ${fmtErr} on [${+lo.toPrecision(3)}, ${+hi.toPrecision(3)}]   Λ ≈ ${r.leb < 1e4 ? r.leb.toFixed(2) : r.leb.toExponential(2)}`],
            interpolant: r.p,
            nodes: r.p.xs.map((x, i) => [x, r.p.fs[i]]),
            window: [lo, hi],
            maxErr: r.err,
            lebesgue: r.leb,
            compare: cmp ? { real: (x) => cmp.p.evalReal(x) } : null,
            real: (x) => r.p.evalReal(x),
            complex: (z) => r.p.evalComplex(z),
        };
    },
};

export function waveletFamilyOptions() {
    return FAMILIES.map((f) => ({ value: f.id, label: f.name || f.id }));
}

/** Round a window edge so small pans do not trigger a refit every frame. */
function quantize(v, step) {
    return Math.round(v / step) * step;
}

export const wavelet = {
    id: 'wavelet',
    name: 'Wavelet',
    color: METHOD_COLORS.wavelet,
    needsAnalytic: false,
    fit(env) {
        const { func, cache, view } = env;
        const familyId = env.get('wavelet.family');
        const family = getFamily(familyId);
        if (!family) return null;
        const span = view.x1 - view.x0;
        const step = span / 16;
        const x0 = quantize(view.x0 - span * 0.1, step);
        const x1 = quantize(view.x1 + span * 0.1, step);
        const samples = env.get('wavelet.samples');
        const level = env.get('wavelet.level');
        const pct = env.get('wavelet.keepPct');
        const keep = pct >= 100 ? null : Math.max(1, Math.round(samples * pct / 100));
        const key = `wf|${func.id}|${familyId}|${x0}|${x1}|${samples}|${level}|${keep}`;
        // singularities / NaN would poison the whole transform: clamp and zero them
        const safe = (x) => {
            const y = func.f(x);
            return Number.isFinite(y) ? Math.max(-1e3, Math.min(1e3, y)) : 0;
        };
        const res = memo(cache, key, () => waveletApprox(safe, { family, level, x0, x1, samples, keep }));
        return {
            info: `Wavelet  ${family.id}  J=${level}  keep ${res.keptCount}/${res.totalCount}`,
            result: res,
            family,
            window: [x0, x1],
            real: (x) => res.evalReal(x),
        };
    },
};

/** Scaling / wavelet function samples for the mother-wavelet inset. */
export function motherWavelet(env) {
    const family = getFamily(env.get('wavelet.family'));
    if (!family) return null;
    return memo(env.cache, `mw|${family.id}`, () => ({ family, ...waveletFunction(family, { iterations: 8 }) }));
}

export const METHODS = [taylor, padeMethod, fourier, wavelet, interp];
export const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));
