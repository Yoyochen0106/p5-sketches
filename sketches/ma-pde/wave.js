// Wave tab: u_tt = c^2 u_xx on [0, L] (L = 1). d'Alembert (two travelling half-waves, method of
// images) versus the normal-mode series, with damping and beam-like dispersion for contrast.

import {
    waveModeSum, dAlembert, pluckedProfile, struckProfile, makeModes, waveKind,
} from '../../lib/pde.js';
import {
    panel, axes, polyline, bars, label, dashed, makeMap, paintScalar, LUTS, colorBar, splitRect, clamp, fin, inRect, fmtNum,
} from './draw.js';
import { Undo, dab, strokeTo } from './edit.js';

export const NS = 257;
const NMODES = 100;
const SM_W = 129, SM_H = 96;
const NBARS = 20;
const SNAP_N = 385;

const BC_RULE = {
    fixed: 'fixed end: image is odd (sign flip on reflection)',
    free: 'free end: image is even (no sign flip)',
    fixedfree: 'fixed at 0 (flip), free at L (no flip): period 4L/c',
    infinite: 'no ends: two half-waves travel away unchanged',
};

export class WavePanel {
    constructor(env) {
        this.env = env;
        this.f = new Float64Array(NS);
        this.g = new Float64Array(NS);
        this.undo = new Undo();
        this.ver = 0;
        this.t = 0;
        this.lastPreset = null;
        this.lastPin = '';
        this.lastSeek = null;
        this.modelKey = '';
        this.mapKey = '';
        this.ms = null;
        this.dal = null;
        this.sm = new Float64Array(SM_W * SM_H);
        this.smMax = 1;
        this.stroke = null;
        this.hover = null;
        this.scaleF = 0.6;
        this.scaleG = 0.6;
        this.snap = new Float64Array(SNAP_N);
        this.msCur = new Float64Array(NS);
        this.info = {};
        this.period = 2;
        this.tmax = 4;
    }

    num(k) { return Number(this.env.get(k)); }

    get ideal() { return !this.finite || (this.num('w.gamma') === 0 && this.env.get('w.disp') === 'none'); }
    get finite() { return this.env.get('w.bc') !== 'infinite'; }
    /** Effective display method (d'Alembert only exists for the ideal string; modes only for a finite one). */
    get method() {
        const m = this.env.get('w.method');
        if (!this.finite) return 'dalembert';
        if (!this.ideal) return 'modes';
        return m === 'dalembert' || m === 'modes' ? m : 'both';
    }

    pin() {
        const bc = this.env.get('w.bc');
        for (const a of [this.f, this.g]) {
            if (bc === 'fixed') { a[0] = 0; a[NS - 1] = 0; } else if (bc === 'fixedfree') a[0] = 0;
            else if (bc === 'infinite') { a[0] = 0; a[NS - 1] = 0; }
        }
    }

    load(name) {
        const x0 = clamp(this.num('w.x0') || 0.3, 0.02, 0.98);
        const f = this.f, g = this.g;
        f.fill(0); g.fill(0);
        if (name === 'pluck') f.set(pluckedProfile(NS, 1, x0, 0.5));
        else if (name === 'strike') g.set(struckProfile(NS, 1, x0, 0.12, 1));
        else if (name === 'bow') g.fill(0.5);
        else if (name === 'pulse') for (let i = 0; i < NS; i++) f[i] = 0.6 * Math.exp(-((((i / (NS - 1)) - x0) / 0.06) ** 2));
        else if (name === 'mode3') {
            const kind = waveKind(this.env.get('w.bc')) || 'sin';
            const md = makeModes(kind, 1, 3)[2];
            for (let i = 0; i < NS; i++) f[i] = 0.5 * md.phi(i / (NS - 1));
        }
        this.pin();
        this.ver++;
        this.t = 0;
    }

    sync() {
        const get = (k) => this.env.get(k);
        const preset = get('w.preset');
        const pinKey = `${get('w.bc')}|${get('w.x0')}`;
        if (preset !== this.lastPreset) {
            const first = this.lastPreset === null;
            this.lastPreset = preset;
            if (preset) { if (!first) this.undo.push({ f: this.f, g: this.g }); this.load(preset); } else if (first) this.load('pluck');
        } else if (pinKey !== this.lastPin && preset) {
            this.load(preset); // bc or pluck position changed under a preset
        }
        if (pinKey !== this.lastPin) { this.lastPin = pinKey; this.pin(); this.ver++; }
        const c = Math.max(0.05, this.num('w.c') || 1);
        const gamma = Math.max(0, this.num('w.gamma') || 0);
        const disp = get('w.disp');
        const key = `${get('w.bc')}|${c}|${gamma}|${disp}|${this.ver}`;
        if (key !== this.modelKey) {
            this.modelKey = key;
            const bc = get('w.bc');
            this.ms = bc === 'infinite' ? null : waveModeSum({ bc, L: 1, c, f: this.f, g: this.g, count: NMODES, dispersion: disp, gamma });
            this.dal = bc === 'infinite' || (gamma === 0 && disp === 'none') ? dAlembert({ bc, L: 1, c, f: this.f, g: this.g }) : null;
            this.mapKey = '';
        }
        if (this.ms) {
            const j = this.ms.omega(0) > 1e-9 ? 0 : 1;
            this.period = (2 * Math.PI) / Math.max(1e-9, this.ms.omega(j));
        } else this.period = 2 / c;
        const T = Number(get('w.T')) || 2;
        this.tmax = Math.max(1e-6, T * this.period * (this.finite ? 1 : 0.75));
        const seek = this.num('w.t');
        if (this.lastSeek === null) this.lastSeek = seek;
        else if (seek !== this.lastSeek) { this.lastSeek = seek; this.t = clamp(seek, 0, 1) * this.tmax; }
        const terms = clamp(Math.round(this.num('w.terms')) || 1, 1, NMODES);
        const mk = `${this.modelKey}|${terms}|${this.tmax}|${this.method}`;
        if (mk !== this.mapKey) { this.mapKey = mk; this.computeMap(terms); }
        if (!this.stroke) {
            let mf = 0, mg = 0;
            for (let i = 0; i < NS; i++) { mf = Math.max(mf, Math.abs(this.f[i])); mg = Math.max(mg, Math.abs(this.g[i])); }
            this.scaleF = Math.max(0.6, 1.25 * mf);
            this.scaleG = Math.max(0.6, 1.25 * mg);
        }
    }

    window() { return this.finite ? [0, 1] : [-1, 2]; }
    snapWindow() { return this.finite && this.method === 'modes' ? [0, 1] : [-1, 2]; }

    computeMap(terms) {
        const [w0, w1] = this.window();
        const xs = new Float64Array(SM_W);
        for (let i = 0; i < SM_W; i++) xs[i] = w0 + ((w1 - w0) * i) / (SM_W - 1);
        let mx = 0;
        const row = new Float64Array(SM_W);
        for (let r = 0; r < SM_H; r++) {
            const t = (this.tmax * r) / (SM_H - 1);
            if (this.ms && (this.method !== 'dalembert' || !this.dal)) this.ms.evaluate(t, SM_W, row, terms);
            else if (this.dal) row.set(this.dal.at(t, xs).u);
            else row.fill(0);
            for (let i = 0; i < SM_W; i++) { const v = fin(row[i]); this.sm[r * SM_W + i] = v; mx = Math.max(mx, Math.abs(v)); }
        }
        this.smMax = Math.max(0.3, mx);
    }

    /** Partial amplitudes and frequency ratios for the harmonic-content display and the sound. */
    partials(n = NBARS) {
        const ms = this.ms;
        if (!ms) return { amps: [], ratios: [] };
        const amps = [], ratios = [];
        const w1 = ms.omega(ms.omega(0) > 1e-9 ? 0 : 1);
        for (let j = 0; j < Math.min(n, NMODES); j++) {
            const w = ms.omega(j);
            if (w < 1e-9) continue;
            amps.push(Math.hypot(ms.A[j], ms.B[j] / w));
            ratios.push(w / w1);
        }
        return { amps, ratios };
    }

    /** Least-squares slope of log|A_n| against log n over the n with significant amplitude. */
    harmonicSlope() {
        const ms = this.ms;
        if (!ms || this.env.get('w.bc') !== 'fixed') return null;
        const pts = [];
        let mx = 0;
        for (let j = 0; j < 12; j++) mx = Math.max(mx, Math.abs(ms.A[j]));
        for (let j = 0; j < 12; j++) if (Math.abs(ms.A[j]) > 1e-4 * mx && mx > 1e-9) pts.push([Math.log(j + 1), Math.log(Math.abs(ms.A[j]))]);
        if (pts.length < 3) return null;
        let sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
        const n = pts.length;
        const den = n * sxx - sx * sx;
        return Math.abs(den) < 1e-12 ? null : (n * sxy - sx * sy) / den;
    }

    // ---------- time ----------
    update(dt) {
        const env = this.env;
        if (env.get('play')) {
            this.t += dt * (Number(env.get('speed')) || 1) * (this.tmax / 8);
            if (this.t > this.tmax) this.t = 0;
        }
        this.t = clamp(fin(this.t), 0, this.tmax);
        if (this.stroke && env.mouseDown() && !this.stroke.moved) {
            const s = this.stroke;
            dab(s.arr, s.lastIdx, s.lastVal, s.sign, this.brushParams(s.which), Math.min(1, dt * 60) * 0.5);
            this.afterEdit();
        }
        if (this.stroke) this.stroke.moved = false;
    }

    // ---------- editing ----------
    brushParams(which) {
        const sc = which === 'g' ? this.scaleG : this.scaleF;
        return {
            tool: this.env.get('tool'),
            radius: Math.max(0.5, (this.num('radius') / 100) * NS),
            soft: this.num('soft'),
            amount: this.num('strength') * 0.08 * sc / 1.2,
        };
    }

    hit(x, y) {
        for (const which of ['f', 'g']) {
            const m = which === 'f' ? this.mF : this.mG;
            if (m && inRect(m.r, x, y)) return which;
        }
        return null;
    }

    pointer(which, x, y) {
        const m = which === 'f' ? this.mF : this.mG;
        const sc = which === 'f' ? this.scaleF : this.scaleG;
        return { idx: clamp(m.invX(x) * (NS - 1), 0, NS - 1), val: clamp(m.invY(y), -sc, sc) };
    }

    afterEdit() {
        this.pin();
        this.ver++;
        if (this.env.get('w.preset') !== '') this.env.set('w.preset', '');
        this.lastPreset = '';
    }

    press(x, y, o = {}) {
        const which = this.hit(x, y);
        if (which) {
            this.undo.push({ f: this.f, g: this.g });
            const arr = which === 'f' ? this.f : this.g;
            const { idx, val } = this.pointer(which, x, y);
            this.stroke = { which, arr, sign: o.right ? -1 : 1, lastIdx: idx, lastVal: val, moved: true };
            const params = this.brushParams(which);
            if (params.tool === 'line') strokeTo(arr, this.stroke, idx, val, params);
            else dab(arr, idx, val, this.stroke.sign, params, 1);
            this.afterEdit();
            return true;
        }
        if (this.mS && inRect(this.mS.r, x, y)) { this.seekY(y); this.seeking = true; return true; }
        return false;
    }

    seekY(y) {
        this.t = clamp((y - this.mS.r.y) / this.mS.r.h, 0, 1) * this.tmax;
        if (this.env.get('play')) this.env.set('play', false);
    }

    drag(x, y) {
        if (this.seeking) { this.seekY(y); return; }
        this.hoverAt(x, y);
        const s = this.stroke;
        if (!s) return;
        s.moved = true;
        const { idx, val } = this.pointer(s.which, x, y);
        strokeTo(s.arr, s, idx, val, this.brushParams(s.which));
        this.afterEdit();
    }

    release() { const had = !!(this.stroke || this.seeking); this.stroke = null; this.seeking = false; return had; }
    hoverAt(x, y) { const w = this.hit(x, y); this.hover = w ? { x, y, which: w } : null; }

    actions() {
        const arrs = () => ({ f: this.f, g: this.g });
        return {
            undo: () => { if (this.undo.undo(arrs())) this.afterEdit(); },
            redo: () => { if (this.undo.redo(arrs())) this.afterEdit(); },
            clear: () => { this.undo.push(arrs()); this.f.fill(0); this.g.fill(0); this.afterEdit(); },
            restart: () => { this.t = 0; },
            sound: () => {
                const { amps, ratios } = this.partials(NBARS * 2);
                if (!amps.length) return false;
                return this.env.audio.play(amps, ratios, this.num('w.f0') || 220);
            },
        };
    }

    // ---------- drawing ----------
    draw(rect) {
        const { p, pal } = this.env;
        const narrow = rect.w < 640;
        const [a, b, c, d] = narrow ? splitRect(rect, 1, 4) : splitRect(rect, 2, 2);
        this.drawSnapshot(p, pal, a);
        this.drawSpectrum(p, pal, b);
        this.drawData(p, pal, c);
        this.drawSpaceTime(p, pal, d);
    }

    drawSnapshot(p, pal, r) {
        const bc = this.env.get('w.bc'), c = Math.max(0.05, this.num('w.c') || 1);
        const terms = clamp(Math.round(this.num('w.terms')) || 1, 1, NMODES);
        const [w0, w1] = this.snapWindow();
        const inner = panel(p, pal, r, 'u(x, t)   total (solid)   right-going half (orange)   left-going half (blue)   images of f (grey)', { l: 40, t: 20, r: 10, b: 40 });
        const ymax = Math.max(0.6, this.smMax * 1.2);
        const m = this.mA = makeMap(inner, w0, w1, -ymax, ymax);
        if (w0 < 0) {
            p.noStroke();
            p.fill(pal.dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)');
            p.rect(m.X(0), inner.y, m.X(1) - m.X(0), inner.h);
        }
        axes(p, pal, m, { xlabel: 'x / L', ylabel: 'displacement u', xticks: 6 });
        const xs = (i) => w0 + ((w1 - w0) * i) / (SNAP_N - 1);
        const dalOn = this.dal && this.method !== 'modes';
        let diff = null;
        if (this.dal && w0 < 0) {
            dashed(p, m.X(0), inner.y, m.X(0), inner.y + inner.h, pal.axis, 4, 3);
            dashed(p, m.X(1), inner.y, m.X(1), inner.y + inner.h, pal.axis, 4, 3);
            polyline(p, m, SNAP_N, xs, (i) => this.dal.extendedF(xs(i)), pal.axis, 1);
        }
        if (dalOn) {
            const X = new Float64Array(SNAP_N);
            for (let i = 0; i < SNAP_N; i++) X[i] = xs(i);
            const res = this.dal.at(this.t, X);
            polyline(p, m, SNAP_N, xs, (i) => res.right[i], '#ff9f43', 1.4);
            polyline(p, m, SNAP_N, xs, (i) => res.left[i], '#4aa3ff', 1.4);
            polyline(p, m, SNAP_N, xs, (i) => res.u[i], pal.fg, 2.2);
            if (this.ms) {
                const X2 = Float64Array.from({ length: NS }, (_, i) => i / (NS - 1));
                const u2 = this.dal.at(this.t, X2).u;
                this.ms.evaluate(this.t, NS, this.msCur, terms);
                diff = 0;
                for (let i = 0; i < NS; i++) diff = Math.max(diff, Math.abs(u2[i] - this.msCur[i]));
            }
        }
        if (this.ms && this.method !== 'dalembert') {
            this.ms.evaluate(this.t, NS, this.msCur, terms);
            polyline(p, m, NS, (i) => i / (NS - 1), (i) => this.msCur[i], dalOn ? pal.accent : pal.fg, dalOn ? 1.3 : 2.2);
        }
        this.info = { t: this.t, period: this.period, tmax: this.tmax, diff, method: this.method, terms };
        label(p, pal, `t = ${fmtNum(this.t)}  (${fmtNum(this.t / this.period)} periods T = ${fmtNum(this.period)})   c = ${fmtNum(c)}${diff !== null ? `   max|d'Alembert - ${terms} modes| = ${fmtNum(diff)}` : ''}`, r.x + 8, r.y + r.h - 33, { size: 10, color: pal.fg });
        let note = `u_tt = c^2 u_xx   ${BC_RULE[bc]}`;
        if (!this.ideal) note = 'damping / dispersion present: d\'Alembert no longer holds, showing the mode sum';
        label(p, pal, note, r.x + 8, r.y + r.h - 19, { size: 10, color: this.ideal ? pal.muted : pal.accent });
    }

    drawSpectrum(p, pal, r) {
        const ms = this.ms;
        const inner = panel(p, pal, r, 'normal modes  a_n(t) cos/sin(omega_n t)   (bar = now, tick = envelope)', { l: 40, t: 20, r: 10, b: 38 });
        if (!ms) {
            label(p, pal, 'An infinite line has no discrete modes (continuous spectrum): use d\'Alembert.', inner.x + 6, inner.y + 10, { size: 11, color: pal.fg });
            return;
        }
        const a = ms.amplitudes(this.t, NBARS);
        const env = new Float64Array(NBARS);
        let mx = 1e-9;
        for (let j = 0; j < NBARS; j++) {
            const w = ms.omega(j);
            env[j] = w > 1e-9 ? Math.hypot(ms.A[j], ms.B[j] / w) : Math.abs(ms.A[j]);
            mx = Math.max(mx, env[j]);
        }
        const m = makeMap(inner, 0, NBARS, -mx * 1.1, mx * 1.1);
        axes(p, pal, m, { xticks: 0, ylabel: 'amplitude' });
        const terms = clamp(Math.round(this.num('w.terms')) || 1, 1, NMODES);
        bars(p, m, a, { color: pal.accent, ghost: env, ghostColor: pal.fg, dim: terms, dimColor: pal.axis });
        const slope = this.harmonicSlope();
        if (this.env.get('w.bc') === 'fixed') {
            const A1 = Math.abs(ms.A[0]) > 1e-9 ? ms.A[0] : env[0];
            p.noFill(); p.stroke('#2ecc71'); p.strokeWeight(1.2);
            p.beginShape();
            for (let j = 0; j < NBARS; j++) p.vertex(inner.x + ((j + 0.5) / NBARS) * inner.w, clamp(m.Y(Math.abs(A1) / ((j + 1) ** 2)), inner.y, inner.y + inner.h));
            p.endShape();
        }
        for (let j = 0; j < NBARS; j += 2) {
            const w1 = ms.omega(ms.omega(0) > 1e-9 ? 0 : 1);
            label(p, pal, `${j + (ms.kind === 'cos' ? 0 : 1)}`, inner.x + ((j + 0.5) / NBARS) * inner.w, inner.y + inner.h + 3, { size: 9, align: 'center' });
            if (j === 0) label(p, pal, `w/w1: ${fmtNum(ms.omega(j) / w1)}`, inner.x + 2, inner.y + inner.h + 14, { size: 9 });
        }
        const w = this.env.get('w.disp') === 'beam' ? 'omega_n = n^2 omega_1  (beam-like, dispersive)' : 'omega_n = n pi c / L  (harmonic)';
        label(p, pal, w + (slope !== null ? `    log-log slope of |A_n| = ${fmtNum(slope)}  (plucked: -2)` : ''), r.x + 8, r.y + r.h - 19, { size: 10 });
        label(p, pal, 'green line: 1/n^2 law of a plucked string', inner.x + inner.w, inner.y + 4, { size: 9, align: 'right', color: '#2ecc71' });
    }

    drawData(p, pal, r) {
        const half = (r.h - 6) / 2;
        const rf = { x: r.x, y: r.y, w: r.w, h: half + 3 }, rg = { x: r.x, y: r.y + half + 3, w: r.w, h: half + 3 };
        let inner = panel(p, pal, rf, 'initial displacement f(x)  (draw: left raise / right lower)', { l: 40, t: 18, r: 10, b: 18 });
        this.mF = makeMap(inner, 0, 1, -this.scaleF, this.scaleF);
        axes(p, pal, this.mF, { xlabel: 'x / L', yticks: 2, xticks: 4 });
        polyline(p, this.mF, NS, (i) => i / (NS - 1), (i) => this.f[i], '#2ecc71', 2);
        inner = panel(p, pal, rg, 'initial velocity g(x) = u_t(x, 0)', { l: 40, t: 18, r: 10, b: 18 });
        this.mG = makeMap(inner, 0, 1, -this.scaleG, this.scaleG);
        axes(p, pal, this.mG, { xlabel: 'x / L', yticks: 2, xticks: 4 });
        polyline(p, this.mG, NS, (i) => i / (NS - 1), (i) => this.g[i], '#c77dff', 2);
        if (this.hover) {
            const rr = this.brushParams(this.hover.which).radius / (NS - 1) * inner.w;
            p.noFill(); p.stroke(pal.muted); p.strokeWeight(1);
            p.circle(this.hover.x, this.hover.y, rr * 2);
        }
    }

    drawSpaceTime(p, pal, r) {
        const [w0, w1] = this.window();
        const inner = panel(p, pal, r, 'space-time diagram  u(x, t)   (click to seek)', { l: 40, t: 20, r: 38, b: 24 });
        const lut = LUTS.diverging;
        const mx = this.smMax;
        const img = this.env.images.get(p, 'space-time', `${this.mapKey}|${mx}`, SM_W, SM_H, (px, w, h) => {
            paintScalar(px, w, h, (i, j) => this.sm[j * SM_W + i], lut, -mx, mx);
        });
        p.image(img, inner.x, inner.y, inner.w, inner.h);
        this.mS = makeMap(inner, w0, w1, this.tmax, 0);
        p.noFill(); p.stroke(pal.axis); p.rect(inner.x, inner.y, inner.w, inner.h);
        const ty = inner.y + (this.t / this.tmax) * inner.h;
        p.stroke(255, 255, 255, 220); p.strokeWeight(1.5); p.line(inner.x, ty, inner.x + inner.w, ty);
        label(p, pal, 'x / L', inner.x + inner.w, inner.y + inner.h + 4, { size: 10, align: 'right' });
        label(p, pal, `t = ${fmtNum(this.tmax)}`, inner.x - 4, inner.y + inner.h, { size: 10, align: 'right', valign: 'bottom' });
        label(p, pal, 't', inner.x - 4, inner.y + inner.h / 2, { size: 10, align: 'right', valign: 'middle' });
        colorBar(p, pal, { x: inner.x + inner.w + 6, y: inner.y, w: 8, h: inner.h }, lut, -mx, mx);
    }
}
