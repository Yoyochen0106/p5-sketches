// Deep links to related units ("Open in..."). Ids come from the course table; unknown targets just show the menu.

import { unitHash } from './common.js';

const sgn = (v) => (v < 0 ? '-' : '+');
const num = (v) => +Math.abs(v).toFixed(4);

/** (z - a) factor text for a real root a. */
const lin = (a) => (Math.abs(a) < 1e-9 ? 'z' : `(z ${sgn(-a)} ${num(a)})`);

/** ((z - a)^2 + b^2) factor text for a conjugate pair a +- bi. */
const quad = (a, b) => `((z ${sgn(-a)} ${num(a)})^2 + ${num(b)}^2)`;

/**
 * Formula in z (for the Conformal Maps unit) of K * prod(z - zeros) / prod(z - poles) where each item is
 * { z: [re, im], pair: bool } (pair = the conjugate is a root too). Returns null if the roots are not conjugate-closed.
 */
export function exprFromItems(zeros, poles, K = 1) {
    const side = (items) => {
        const parts = [];
        for (const q of items) {
            if (q.pair) parts.push(quad(q.z[0], q.z[1]));
            else if (Math.abs(q.z[1]) < 1e-9) parts.push(lin(q.z[0]));
            else return null;
        }
        return parts.length ? parts.join('*') : '1';
    };
    const n = side(zeros);
    const d = side(poles);
    if (n === null || d === null) return null;
    return `${+K.toFixed(4)}*${n}/(${d})`;
}

/** Hash for the link, falling back to a preset when no formula is available. */
export function conformalLink(expr) {
    return expr ? unitHash('conformal', { preset: 'custom', expr }) : unitHash('conformal', { preset: 'poly' });
}

/** Plant keys shared by the control units. */
export function plantParams({ num, den, K, delay }) {
    const out = { num, den };
    if (K !== undefined) out.K = K;
    if (delay) out.delay = delay;
    return out;
}

export const LINKS = {
    ctFreq: (p) => unitHash('ct-freq', plantParams(p)),
    ctResponse: (p) => unitHash('ct-response', plantParams(p)),
    maLaplace: (p) => unitHash('ma-laplace', plantParams(p)),
    maVector: () => unitHash('ma-vector', {}),
};
