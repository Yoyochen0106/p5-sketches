// Data model of the Impulse Response Lab: the three sampled signals x, y, h, undo history, the
// derived-signal solver (cached) and cached spectra. No p5, no DOM.

import {
    solveTriple, residualNorm, conditionIndicators, convolveTruncated, lambdaFromRelative, autoLambda,
    analyse, minimumPhaseFromMagnitude, linearPhaseFromMagnitude,
} from '../../lib/deconv.js';
import { resample } from './brush.js';
import { gaussianNoise } from './presets.js';

export const SIGNALS = ['x', 'y', 'h'];
export const SIZES = [128, 256, 512, 1024];
const UNDO_LIMIT = 60;

/** Smallest of 1, 2, 5 (times a power of ten) that is >= v. */
export function niceCeil(v) {
    if (!(v > 0) || !Number.isFinite(v)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

const maxAbs = (a) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };

export class ImpulseModel {
    constructor(n = 256) {
        this.ver = { x: 0, y: 0, h: 0 };
        this.truthVer = 0;
        this.meta = null; // preset ids at snapshot time, maintained by the sketch
        this.truth = null; // true system kernel when a system preset generated y
        this.noisePct = 0;
        this.scale = { x: 1, y: 1, h: 1 };
        this.undoStack = [];
        this.redoStack = [];
        this.metrics = { residual: 0, condMin: 1, condRatio: 1, fracBelow: 0 };
        this.recon = new Float64Array(n);
        this._solveKey = '';
        this._spec = {};
        this._setSize(n);
    }

    _setSize(n) {
        this.n = n;
        this.x = new Float64Array(n);
        this.y = new Float64Array(n);
        this.h = new Float64Array(n);
        this.recon = new Float64Array(n);
        this.noiseVec = gaussianNoise(n, 12345);
        this.yClean = new Float64Array(n);
        this._solveKey = '';
        this._spec = {};
        for (const s of SIGNALS) this.ver[s]++;
    }

    touch(name) {
        this.ver[name]++;
    }

    /** Replace a signal's samples (copy). */
    load(name, arr) {
        this[name].set(arr.length === this.n ? arr : resample(arr, this.n));
        this.touch(name);
    }

    /** Change N: resample all curves linearly (callers regenerate presets afterwards if they want). */
    resize(n) {
        if (n === this.n) return;
        const old = { x: this.x, y: this.y, h: this.h, truth: this.truth };
        this._setSize(n);
        for (const s of SIGNALS) this[s].set(resample(old[s], n));
        if (old.truth) { this.truth = resample(old.truth, n); this.truthVer++; }
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }

    // ---------- history ----------
    _snapshot() {
        return { meta: this.meta ? { ...this.meta } : null, n: this.n, x: this.x.slice(), y: this.y.slice(), h: this.h.slice(), truth: this.truth && this.truth.slice() };
    }

    _restore(s) {
        if (s.n !== this.n) return;
        for (const k of SIGNALS) { this[k].set(s[k]); this.touch(k); }
        this.truth = s.truth ? s.truth.slice() : null;
        this.meta = s.meta ? { ...s.meta } : null;
        this.truthVer++;
    }

    /** Call before an edit gesture. */
    pushUndo() {
        this.undoStack.push(this._snapshot());
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack.length = 0;
    }

    undo() {
        const s = this.undoStack.pop();
        if (!s) return false;
        this.redoStack.push(this._snapshot());
        this._restore(s);
        return true;
    }

    redo() {
        const s = this.redoStack.pop();
        if (!s) return false;
        this.undoStack.push(this._snapshot());
        this._restore(s);
        return true;
    }

    clear(name) {
        this.pushUndo();
        this[name].fill(0);
        this.touch(name);
    }

    // ---------- system presets: y = x * h_true + noise ----------
    setTruth(kernel) {
        this.truth = kernel ? Float64Array.from(kernel) : null;
        this.truthVer++;
        this.regenerateY();
    }

    setNoise(pct) {
        this.noisePct = Math.max(0, pct);
        if (this.truth) this.regenerateY();
    }

    /** y := x * truth + noise (std = noisePct % of the rms of the clean output). */
    regenerateY() {
        if (!this.truth) return;
        const clean = convolveTruncated(this.x, this.truth, this.n);
        let e = 0;
        for (let i = 0; i < clean.length; i++) e += clean[i] * clean[i];
        const sigma = (this.noisePct / 100) * Math.sqrt(e / this.n);
        for (let i = 0; i < this.n; i++) this.y[i] = clean[i] + sigma * this.noiseVec[i];
        this.yClean = clean;
        this.touch('y');
    }

    // ---------- solving ----------
    /**
     * Derive one signal from the other two. params: { derived 'h'|'y'|'x', method, lambdaLog (log10 of
     * the relative lambda), supportPct }. Cached on the source versions and the parameters.
     */
    solve(params) {
        const d = params.derived;
        const src = SIGNALS.filter((s) => s !== d);
        const key = [d, this.ver[src[0]], this.ver[src[1]], params.method, params.lambdaLog, params.supportPct, this.n].join('|');
        if (key === this._solveKey) return false;
        this._solveKey = key;
        const n = this.n;
        const L = Math.max(1, Math.round((n * params.supportPct) / 100));
        const lambdaRel = params.lambdaLog <= -12 ? 0 : 10 ** params.lambdaLog;
        const r = solveTriple({ mode: d, x: this.x, y: this.y, h: this.h, method: params.method, lambdaRel, L });
        this[d].set(r[d]);
        // the derived signal changes the key's own version, which is not part of the key
        this.ver[d]++;
        this.recon = convolveTruncated(this.x, this.h, n);
        const residual = residualNorm(this.x, this.h, this.y);
        const input = d === 'x' ? this.h : this.x;
        const lam = lambdaFromRelative(input, lambdaRel);
        const c = conditionIndicators(input, { lambda: lam });
        this.metrics = { residual, condMin: c.min, condRatio: c.ratio, fracBelow: c.fracBelow };
        return true;
    }

    /** GCV choice of log10(relative lambda) for the current sources; null if not applicable. */
    autoLambdaLog(params) {
        const L = Math.max(1, Math.round((this.n * params.supportPct) / 100));
        let g;
        if (params.derived === 'h') g = autoLambda(this.y, this.x, { L });
        else if (params.derived === 'x') g = autoLambda(this.y, this.h, { L: this.n });
        else return null;
        if (!(g.rel > 0)) return null;
        return Math.max(-12, Math.min(0, Math.round(Math.log10(g.rel) * 10) / 10));
    }

    // ---------- spectra ----------
    /** One-sided analysis (M = 2N, N+1 bins) of a signal; cached on the signal's version. */
    spectrum(name) {
        const c = this._spec[name];
        if (c && c.ver === this.ver[name] && c.n === this.n) return c.data;
        const data = analyse(this[name], 2 * this.n);
        this._spec[name] = { ver: this.ver[name], n: this.n, data };
        return data;
    }

    /** Spectrum of the true system kernel (null without a system preset). */
    truthSpectrum() {
        if (!this.truth) return null;
        if (!this._truthSpec || this._truthSpec.ver !== this.truthVer || this._truthSpec.n !== this.n) {
            this._truthSpec = { ver: this.truthVer, n: this.n, data: analyse(this.truth, 2 * this.n) };
        }
        return this._truthSpec.data;
    }

    /** Replace h by a response with the given one-sided magnitude (N/2+1 bins) and phase model. */
    setHFromMagnitude(mag, phaseModel) {
        const h = phaseModel === 'linear' ? linearPhaseFromMagnitude(mag, this.n) : minimumPhaseFromMagnitude(mag, this.n);
        this.h.set(h);
        this.touch('h');
    }

    /** One-sided magnitude of h on the N-point grid (N/2+1 bins), the editing baseline. */
    hMagnitudeBase() {
        return analyse(this.h, this.n).mag;
    }

    // ---------- vertical scales ----------
    /** Update the display range of each signal; `hold` = signal being edited (scale may only grow). */
    updateScales(hold = null) {
        for (const s of SIGNALS) {
            const m = maxAbs(this[s]);
            const auto = m > 0 ? niceCeil(m * 1.15) : 1;
            this.scale[s] = s === hold ? Math.max(this.scale[s], auto) : auto;
        }
    }
}
