// PlateModel: turns the sketch settings into displacement / envelope grids and nodal lines.
// Mode grids are cached; per frame only cheap linear combinations are evaluated.

import {
    makeMode, listModes, sampleMode, modeOmega, combine, envelope, maxAbs, nodalLines,
    drivenField, normalizeSpec,
} from '../../lib/plates.js';
import { marchingSquares } from '../../lib/marching.js';
import { SLOTS } from './state.js';

const DRIVE_MODES = 24;
const TWO_PI = Math.PI * 2;

export class PlateModel {
    constructor() {
        this.entries = new Map();   // mode key -> { mode, grid }
        this.lists = new Map();     // shape key -> listModes result
        this.u = null;              // displacement grid at the current time (scaled to roughly [-1, 1])
        this.env = null;            // vibration amplitude grid (for the sand)
        this.nodalGrid = null;
        this.lines = { segments: new Float64Array(0), count: 0 };
        this._nodalKey = '';
        this._driven = null;
        this._drivenKey = '';
        this.cfg = null;
    }

    entry(spec, res) {
        const s = normalizeSpec(spec);
        const key = `${s.shape}|${s.kind}|${s.aspect}|${s.m}|${s.n}|${s.phase}|${res}`;
        let e = this.entries.get(key);
        if (!e) {
            if (this.entries.size > 160) this.entries.clear();
            const mode = makeMode(s);
            e = { key, mode, grid: sampleMode(mode, res) };
            this.entries.set(key, e);
        }
        return e;
    }

    modeList(base, dispersion, count = 20) {
        const key = `${base.shape}|${base.kind}|${base.aspect}|${dispersion}|${count}`;
        let l = this.lists.get(key);
        if (!l) { l = listModes(base, count, dispersion); this.lists.set(key, l); }
        return l;
    }

    /** Read the settings (get(key)) into a configuration; cheap when nothing changed apart from the numbers. */
    configure(get) {
        const shape = get('shape');
        const base = normalizeSpec({ shape, kind: get('kind'), aspect: get('aspect'), phase: get('phase') });
        const dispersion = get('dispersion') === 'membrane' ? 'membrane' : 'plate';
        const res = Math.max(24, Math.min(240, Math.round(get('res') || 96)));
        const table = this.modeList(base, dispersion, 20);
        const omegaRef = table[0].omega;
        const slots = [];
        for (let i = 0; i < SLOTS; i++) {
            const e = this.entry({ ...base, m: get(`s${i}.m`), n: get(`s${i}.n`) }, res);
            const omega = modeOmega(e.mode.lambda, dispersion);
            slots.push({ i, mode: e.mode, grid: e.grid, key: e.key, amp: Number(get(`s${i}.a`)) || 0, omega, ratio: omega / omegaRef });
        }
        const active = slots.filter((s) => s.amp !== 0);
        const grid0 = slots[0].grid;
        const circle = base.shape === 'circle';
        this.cfg = {
            base, dispersion, res, table, omegaRef, slots, active, circle,
            bounds: grid0.bounds, nx: grid0.nx, ny: grid0.ny,
            inside: slots[0].mode.inside,
            drive: !!get('drive.on'),
            ratio: Number(get('drive.ratio')) || 1,
            damping: Math.max(1e-4, Number(get('damping')) || 0.02),
            amp: Number(get('amp')) || 1,
            src: this._source(get, grid0.bounds, circle),
            trim: base.kind !== 'free',
        };
        return this.cfg;
    }

    _source(get, b, circle) {
        const u = Math.max(0, Math.min(1, Number(get('src.u'))));
        const v = Math.max(0, Math.min(1, Number(get('src.v'))));
        let x = b.xmin + u * (b.xmax - b.xmin);
        let y = b.ymin + v * (b.ymax - b.ymin);
        if (circle) {
            const r = Math.hypot(x, y);
            if (r > 0.97) { x *= 0.97 / r; y *= 0.97 / r; }
        }
        return { x, y, u, v };
    }

    /** Domain coordinates -> unit-box coordinates (inverse of the source mapping). */
    toUnit(x, y) {
        const b = this.cfg.bounds;
        return { u: (x - b.xmin) / (b.xmax - b.xmin), v: (y - b.ymin) / (b.ymax - b.ymin) };
    }

    /**
     * Evaluate the fields at time `t` (in periods of the fundamental). Updates this.u / env / lines.
     * Returns { scale } where values of this.u are already divided by it and multiplied by cfg.amp.
     */
    evaluate(t) {
        const c = this.cfg;
        const n = c.slots[0].grid.values.length;
        if (!this.u || this.u.values.length !== n) {
            this.u = { values: new Float32Array(n), nx: c.nx, ny: c.ny, bounds: c.bounds };
        }
        this.u.nx = c.nx; this.u.ny = c.ny; this.u.bounds = c.bounds;
        let nodalSource;
        let nodalKey;
        if (c.drive) {
            const d = this._drivenState();
            const phi = TWO_PI * t + d.theta;
            const cs = Math.cos(phi) / d.scale * c.amp;
            const sn = Math.sin(phi) / d.scale * c.amp;
            const A = d.A.values;
            const B = d.B.values;
            const out = this.u.values;
            for (let i = 0; i < n; i++) out[i] = A[i] * cs - B[i] * sn;
            this.env = d.env;
            nodalSource = d.snapshot;
            nodalKey = `D|${this._drivenKey}`;
        } else {
            const act = c.active;
            const scale = act.reduce((s, a) => s + Math.abs(a.amp), 0) || 1;
            const grids = act.map((a) => a.grid);
            const w = act.map((a) => (a.amp / scale) * c.amp * Math.cos(TWO_PI * a.ratio * t));
            if (act.length) combine(grids, w, this.u); else this.u.values.fill(0);
            this._envM = act.length ? envelope(grids, act.map((a) => a.amp / scale), this._envM) : { ...this.u, values: new Float32Array(n) };
            this.env = this._envM;
            const multi = act.length > 1;
            const wn = act.map((a) => a.amp * (multi ? Math.cos(TWO_PI * a.ratio * t) : 1));
            nodalSource = act.length ? (this._nodalM = combine(grids, wn, this._nodalM)) : null;
            nodalKey = `M|${act.map((a) => `${a.key}:${a.amp}`).join(',')}|${multi ? t.toFixed(3) : 0}`;
        }
        const fullKey = `${nodalKey}|${c.res}|${c.trim}`;
        if (fullKey !== this._nodalKey) {
            this._nodalKey = fullKey;
            this.nodalGrid = nodalSource || this.nodalGrid;
            this.lines = nodalSource
                ? nodalLines(nodalSource, marchingSquares, { circle: c.circle, trimBoundary: c.trim })
                : { segments: new Float64Array(0), count: 0 };
        }
        return this.u;
    }

    _drivenState() {
        const c = this.cfg;
        const key = `${c.base.shape}|${c.base.kind}|${c.base.aspect}|${c.dispersion}|${c.res}|${c.ratio.toFixed(5)}|${c.damping}|${c.src.x.toFixed(4)},${c.src.y.toFixed(4)}`;
        if (key === this._drivenKey && this._driven) return this._driven;
        const table = this.modeList(c.base, c.dispersion, DRIVE_MODES);
        const entries = table.map((row) => this.entry({ ...c.base, m: row.spec.m, n: row.spec.n, phase: row.spec.phase }, c.res));
        const omegas = table.map((row) => row.omega);
        const phiSrc = entries.map((e) => e.mode.phi(c.src.x, c.src.y));
        const omega = c.ratio * c.omegaRef;
        const f = drivenField(entries.map((e) => e.grid), omegas, phiSrc, omega, c.damping * c.omegaRef);
        const env = envelope([f.A, f.B], [1, 1]);
        const scale = maxAbs(env) || 1;
        const snapshot = combine([f.A, f.B], [Math.cos(f.theta), -Math.sin(f.theta)]);
        this._driven = { ...f, env, scale, snapshot };
        // the envelope used by the sand is relative to the display scale
        for (let i = 0; i < env.values.length; i++) env.values[i] /= scale;
        this._drivenKey = key;
        return this._driven;
    }
}
