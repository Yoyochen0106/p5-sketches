// Wraps a user-typed expression (a generic `def(A, x)`) into a function record
// compatible with lib/functions.js entries.

import { realAlg, complexAlg, seriesAlg, seriesVariable } from '../../lib/algebra.js';

/** Root-test radius estimate: R = 1 / limsup |c_k|^(1/k), using the upper half of the coefficients. */
export function estimateRadius(coefs) {
    let best = Infinity;
    for (let k = Math.max(2, Math.floor(coefs.length / 2)); k < coefs.length; k++) {
        const m = Math.hypot(coefs[k][0], coefs[k][1]);
        if (m > 1e-13) best = Math.min(best, Math.pow(m, -1 / k));
    }
    return best;
}

export function makeCustom(def, text) {
    const asC = (a) => (Array.isArray(a) ? a : [a, 0]);
    const fn = {
        id: 'custom',
        label: text,
        expr: text,
        analytic: true,
        def,
        f: (x) => def(realAlg, x),
        fc: (z) => def(complexAlg, z),
        taylor(a, n) {
            const c = asC(a);
            return def(seriesAlg(n, c), seriesVariable(n, c));
        },
        singularities: [],
        period: null,
        view: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
        estimatedRadius: true,
        radius(a) {
            return estimateRadius(fn.taylor(a, 40));
        },
    };
    try {
        const z = fn.fc([0.3, 0.2]);
        const t = fn.taylor([0.3, 0], 4);
        if (!Number.isFinite(z[0]) || !t.every((c) => Number.isFinite(c[0]))) throw new Error('not analytic here');
    } catch {
        fn.analytic = false;
        delete fn.fc;
        delete fn.taylor;
    }
    return fn;
}
