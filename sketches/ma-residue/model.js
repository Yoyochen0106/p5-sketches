// Editable models shared by the tabs: a rational function given by draggable poles / zeros, and a draggable
// closed contour (circle, polygon or free-drawn loop). Both serialise to short strings for the settings store.

import { fromPartialFractions } from '../../lib/residues.js';
import { parseRows, rowsToText, TAU } from './common.js';

export const MAX_POLES = 6;
export const MAX_ZEROS = 4;

const figureEight = (n = 80) => Array.from({ length: n }, (_, k) => {
    const t = (TAU * k) / n;
    return [1.9 * Math.sin(t), 1.1 * Math.sin(t) * Math.cos(t) + 0.0];
});
const blob = (cx, cy, r, n = 48) => Array.from({ length: n }, (_, k) => {
    const t = (TAU * k) / n;
    const rr = r * (1 + 0.18 * Math.sin(3 * t) + 0.1 * Math.cos(5 * t));
    return [cx + rr * Math.cos(t), cy + rr * Math.sin(t)];
});

/** Presets of the residue-theorem tab: poles rows "x,y,m,cr,ci", zeros "x,y", optional e^{k z} factor and a contour. */
export const RESIDUE_PRESETS = [
    {
        id: 'two', label: 'Two simple poles, both enclosed',
        caption: 'f = 1/(z+1) + 2/(z-1): the circle encloses both poles, so the integral is 2 pi i (1 + 2).',
        poles: '-1,0,1,1,0;1,0,1,2,0', zeros: '', expk: 0, contour: { kind: 'circle', c: [0, 0], r: 2.2 },
    },
    {
        id: 'inout', label: 'Poles inside and outside',
        caption: 'Only the poles inside the contour count: drag the circle or the poles across each other and watch the jump.',
        poles: '-1.2,0.4,1,1,0.5;1.1,-0.6,1,0.5,-1;0.2,2.4,1,1.5,0;-2.2,-1.8,1,1,1', zeros: '', expk: 0,
        contour: { kind: 'circle', c: [0, 0], r: 1.8 },
    },
    {
        id: 'double', label: 'Double pole with e^z',
        caption: 'f = e^z (1/(z-p)^2 + 1/(z+1)): a double pole has Res = d/dz[e^z] at p = e^p, found by the derivative formula.',
        poles: '0.5,0.3,2,1,0;-1.2,-0.4,1,1,0', zeros: '', expk: 1, contour: { kind: 'circle', c: [0, 0], r: 2.4 },
    },
    {
        id: 'triple', label: 'Triple pole and two zeros',
        caption: 'f = (z-a)(z-b)/(z-p)^3: the residue is (1/2) d^2/dz^2 [(z-a)(z-b)] = 1. Without the zeros c/(z-p)^3 has residue 0.',
        poles: '0,0,3,1,0;2,1,1,1,0', zeros: '0.4,0;-0.3,0.6', expk: 0, contour: { kind: 'poly', pts: [[-1.2, -1.1], [1.3, -1.2], [1.1, 1.4], [-1.0, 1.2]] },
    },
    {
        id: 'pent', label: 'Five poles, polygon contour',
        caption: 'The winding-number test decides which poles count; drag a vertex (or a mid-edge diamond to add one) to cut poles out.',
        poles: '1.5,0,1,1,0;0.46,1.43,1,0,1;-1.21,0.88,1,1,1;-1.21,-0.88,1,-1,0;0.46,-1.43,1,0.5,0.5', zeros: '', expk: 0,
        contour: { kind: 'poly', pts: [[-2.3, -2], [2.4, -1.7], [2.2, 1.9], [-1.8, 2.2]] },
    },
    {
        id: 'eight', label: 'Figure-eight loop (winding +1 / -1)',
        caption: 'A free-drawn loop winds +1 round one pole and -1 round the other: the integral is 2 pi i (Res1 - Res2).',
        poles: '-1,0.25,1,1,0;1,-0.2,1,2,0', zeros: '', expk: 0, contour: { kind: 'free', pts: figureEight() },
    },
    {
        id: 'blob', label: 'Free-drawn blob around a double pole',
        caption: 'Any closed curve works: only the winding number around each pole matters, not the shape.',
        poles: '0.2,0.1,2,1,1;2.2,1.4,1,1,0', zeros: '0.7,-0.2', expk: 0.5, contour: { kind: 'free', pts: blob(0.1, 0, 1.3) },
    },
];

/** Poles / zeros of f(z) = Z(z) e^{k z} sum_j c_j / (z - p_j)^{m_j}. */
export class Model {
    constructor() {
        this.poles = [];
        this.zeros = [];
        this.expk = 0;
        this.sel = 0;
        this.version = 0;
    }

    load(get) {
        this.poles = parseRows(get('poles'), 5).slice(0, MAX_POLES).map((r) => ({
            z: [r[0], r[1]], m: Math.max(1, Math.min(3, Math.round(r[2]))), c: [r[3], r[4]],
        }));
        this.zeros = parseRows(get('zeros'), 2).slice(0, MAX_ZEROS).map((r) => [r[0], r[1]]);
        this.expk = Number(get('expk')) || 0;
        this.sel = Math.max(0, Math.min(Math.max(0, this.poles.length - 1), Math.round(Number(get('sel')) || 0)));
        this.version++;
    }

    save(set) {
        set('poles', rowsToText(this.poles.map((q) => [q.z[0], q.z[1], q.m, q.c[0], q.c[1]])));
        set('zeros', rowsToText(this.zeros));
        set('expk', +this.expk.toFixed(3));
        set('sel', this.sel);
    }

    setRows(poles, zeros, expk) {
        this.poles = parseRows(poles, 5).map((r) => ({ z: [r[0], r[1]], m: r[2], c: [r[3], r[4]] }));
        this.zeros = parseRows(zeros, 2).map((r) => [r[0], r[1]]);
        this.expk = expk;
        this.sel = 0;
        this.version++;
    }

    touch() { this.version++; }

    /** The rational object of lib/residues.js (poles at coincident positions are merged by the library). */
    rational() {
        const terms = this.poles.map((q) => ({ z: q.z, m: q.m, c: q.c }));
        if (!terms.length) terms.push({ z: [0, 0], m: 1, c: [0, 0] });
        return fromPartialFractions(terms, this.zeros, [this.expk, 0]);
    }

    addPole(z) {
        if (this.poles.length >= MAX_POLES) return false;
        this.poles.push({ z: z.slice(), m: 1, c: [1, 0] });
        this.sel = this.poles.length - 1;
        this.version++;
        return true;
    }

    removePole() {
        if (this.poles.length <= 0) return false;
        this.poles.pop();
        this.sel = Math.min(this.sel, Math.max(0, this.poles.length - 1));
        this.version++;
        return true;
    }

    addZero(z) {
        if (this.zeros.length >= MAX_ZEROS) return false;
        this.zeros.push(z.slice());
        this.version++;
        return true;
    }

    removeZero() {
        if (!this.zeros.length) return false;
        this.zeros.pop();
        this.version++;
        return true;
    }

    /** Draggable handles of the poles and zeros in the given panel. */
    handles(panel, onChange, enclosed = null) {
        const hs = [];
        this.poles.forEach((q, i) => {
            hs.push({
                panel, x: q.z[0], y: q.z[1], shape: 'dot', size: 6.5,
                color: enclosed ? (enclosed.has(i) ? '#ff6b6b' : '#8b93a1') : '#ff6b6b',
                label: `p${i + 1}${q.m > 1 ? ` (m=${q.m})` : ''}`,
                onPress: () => { this.sel = i; onChange(true); },
                set: (z) => { q.z = z; this.version++; onChange(); },
            });
        });
        this.zeros.forEach((q, i) => {
            hs.push({
                panel, x: q[0], y: q[1], shape: 'diamond', size: 5, color: '#4dabf7', label: `z${i + 1}`,
                set: (z) => { this.zeros[i] = z; this.version++; onChange(); },
            });
        });
        return hs;
    }
}

/** A draggable closed contour. `keys` maps field names to setting keys. */
export class ContourEditor {
    constructor(keys, defaults = {}) {
        this.keys = keys;
        this.kind = 'circle';
        this.c = defaults.c ? defaults.c.slice() : [0, 0];
        this.r = defaults.r || 2;
        this.pts = [];
        this.version = 0;
    }

    load(get) {
        const k = this.keys;
        const kind = get(k.kind);
        this.kind = kind === 'poly' || kind === 'free' ? kind : 'circle';
        this.c = [Number(get(k.cx)) || 0, Number(get(k.cy)) || 0];
        this.r = Math.max(0.05, Number(get(k.r)) || 1);
        this.pts = parseRows(get(k.pts), 2).map((r) => [r[0], r[1]]);
        if (this.kind !== 'circle' && this.pts.length < 3) this.pts = this.defaultPoly();
        this.version++;
    }

    save(set) {
        const k = this.keys;
        set(k.kind, this.kind);
        set(k.cx, +this.c[0].toFixed(4));
        set(k.cy, +this.c[1].toFixed(4));
        set(k.r, +this.r.toFixed(4));
        set(k.pts, this.kind === 'circle' ? '' : rowsToText(this.pts));
    }

    /** Replace the contour (used by presets). */
    assign(spec) {
        this.kind = spec.kind;
        if (spec.c) this.c = spec.c.slice();
        if (spec.r) this.r = spec.r;
        this.pts = spec.pts ? spec.pts.map((q) => q.slice()) : [];
        if (this.kind !== 'circle' && this.pts.length < 3) this.pts = this.defaultPoly();
        this.version++;
    }

    defaultPoly() {
        const n = 5;
        return Array.from({ length: n }, (_, k) => [this.c[0] + this.r * Math.cos((TAU * k) / n + 0.3), this.c[1] + this.r * Math.sin((TAU * k) / n + 0.3)]);
    }

    setKind(kind) {
        if (kind === this.kind) return;
        if (this.kind === 'circle') this.pts = kind === 'poly' ? this.defaultPoly() : this.freeFromCircle();
        else if (kind === 'free' && this.kind === 'poly') this.pts = this.pts.slice();
        this.kind = kind;
        this.version++;
    }

    freeFromCircle() {
        return Array.from({ length: 40 }, (_, k) => {
            const t = (TAU * k) / 40;
            const rr = this.r * (1 + 0.12 * Math.sin(3 * t));
            return [this.c[0] + rr * Math.cos(t), this.c[1] + rr * Math.sin(t)];
        });
    }

    /** The contour object understood by lib/residues.js. */
    contour() {
        return this.kind === 'circle' ? { kind: 'circle', c: this.c, r: this.r } : { kind: 'poly', pts: this.pts };
    }

    centroid() {
        let x = 0;
        let y = 0;
        for (const q of this.pts) { x += q[0]; y += q[1]; }
        const n = Math.max(1, this.pts.length);
        return [x / n, y / n];
    }

    addVertex() {
        if (this.kind !== 'poly') return;
        let best = 0;
        let bl = -1;
        this.pts.forEach((a, i) => {
            const b = this.pts[(i + 1) % this.pts.length];
            const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L > bl) { bl = L; best = i; }
        });
        const a = this.pts[best];
        const b = this.pts[(best + 1) % this.pts.length];
        this.pts.splice(best + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        this.version++;
    }

    removeVertex() {
        if (this.kind !== 'poly' || this.pts.length <= 3) return;
        this.pts.pop();
        this.version++;
    }

    reverse() {
        if (this.kind === 'circle') return;
        this.pts.reverse();
        this.version++;
    }

    handles(panel, onChange) {
        const hs = [];
        const bump = (final) => { this.version++; onChange(final); };
        if (this.kind === 'circle') {
            hs.push({
                panel, x: this.c[0], y: this.c[1], shape: 'square', size: 5.5, color: '#ffd43b', label: 'contour',
                set: (z) => { this.c = z; bump(); },
            });
            const ang = 0.55;
            hs.push({
                panel, x: this.c[0] + this.r * Math.cos(ang), y: this.c[1] + this.r * Math.sin(ang), shape: 'dot', size: 6, color: '#ffd43b',
                set: (z) => { this.r = Math.max(0.05, Math.hypot(z[0] - this.c[0], z[1] - this.c[1])); bump(); },
            });
            return hs;
        }
        const g = this.centroid();
        hs.push({
            panel, x: g[0], y: g[1], shape: 'square', size: 5, color: '#ffd43b', label: 'move',
            set: (z) => {
                const dx = z[0] - g[0];
                const dy = z[1] - g[1];
                this.pts = this.pts.map((q) => [q[0] + dx, q[1] + dy]);
                bump();
            },
        });
        if (this.kind === 'poly') {
            this.pts.forEach((q, i) => {
                hs.push({ panel, x: q[0], y: q[1], shape: 'dot', size: 6, color: '#ffd43b', set: (z) => { this.pts[i] = z; bump(); } });
                const nx = this.pts[(i + 1) % this.pts.length];
                let inserted = -1;
                hs.push({
                    panel, x: (q[0] + nx[0]) / 2, y: (q[1] + nx[1]) / 2, shape: 'diamond', size: 3.5, color: '#c9a227',
                    set: (z) => {
                        if (inserted < 0) {
                            this.pts.splice(i + 1, 0, z);
                            inserted = i + 1;
                        } else this.pts[inserted] = z;
                        bump();
                    },
                });
            });
        }
        return hs;
    }

    /** Background drag that draws a new free loop (only in 'free' mode). */
    startDraw(z, px, py, vp) {
        if (this.kind !== 'free') return null;
        this.pts = [z];
        this.version++;
        let lx = px;
        let ly = py;
        return {
            move: (zz, x, y) => {
                if (Math.hypot(x - lx, y - ly) < 4 || this.pts.length >= 400) return;
                lx = x;
                ly = y;
                this.pts.push(zz);
                this.version++;
            },
            end: () => {
                if (this.pts.length < 3) this.pts = this.freeFromCircle();
                this.version++;
            },
            vp,
        };
    }
}
