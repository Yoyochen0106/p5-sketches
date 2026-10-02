// Approximation methods. Each method turns the current function + parameters into a "fit":
//   { info, real(x), complex?(z), ... }
// `env` = { func, a: [re, im], get(key), view: {x0, x1}, cache: Map }.
// A method returns null when it cannot apply (e.g. Taylor of a non-analytic function).

import { hornerReal, hornerComplex } from '../../lib/poly.js';
import { pade, evalRational, evalRationalReal, poles, zeros } from '../../lib/pade.js';
import { fourierFit, fourierPartial } from '../../lib/fourier.js';
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
        const part = fourierPartial(full, N);
        return {
            info: `Fourier  N=${N}  T=${+period.toPrecision(4)}`,
            fit: part,
            period,
            x0,
            real: (x) => part.evalReal(x),
            complex: (z) => part.evalComplex(z),
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
        const res = memo(cache, key, () => waveletApprox(func.f, { family, level, x0, x1, samples, keep }));
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

export const METHODS = [taylor, padeMethod, fourier, wavelet];
export const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));
