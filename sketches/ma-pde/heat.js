// Heat tab: u_t = alpha u_xx on [0, L] (L = 1). Draw the initial profile, watch the eigenfunction
// series evolve (each mode decays as exp(-alpha k^2 t)), compare finite-difference schemes.

import { heatSeries, HeatFD, profile, FTCS_LIMIT, trapz, maxDiff } from '../../lib/pde.js';
import {
    panel, axes, polyline, bars, label, dashed, makeMap, paintScalar, LUTS, colorBar, splitRect, clamp, fin, inRect, fmtNum,
} from './draw.js';
import { Undo, dab, strokeTo } from './edit.js';

export const NS = 257; // samples of the drawn profile
const NMODES = 100;
const HM_W = 129, HM_H = 96;
const NBARS = 24;

const BC_TEXT = {
    dirichlet: 'u(0,t) = u(L,t) = 0',
    neumann: 'u_x(0,t) = u_x(L,t) = 0',
    mixed: 'u(0,t) = 0,  u_x(L,t) = 0',
    periodic: 'u(0,t) = u(L,t),  u_x(0,t) = u_x(L,t)',
    fixed: 'u(0,t) = T0,  u(L,t) = T1',
};
const BASIS_TEXT = {
    dirichlet: 'sin(n pi x/L)', fixed: 'steady line + sin(n pi x/L)', neumann: 'cos(n pi x/L)',
    mixed: 'sin((n-1/2) pi x/L)', periodic: '1, cos(2n pi x/L), sin(2n pi x/L)',
};

export class HeatPanel {
    constructor(env) {
        this.env = env;
        this.u0 = new Float64Array(NS);
        this.undo = new Undo();
        this.ver = 0;
        this.t = 0;
        this.hold = 0;
        this.lastPreset = null;
        this.lastPin = '';
        this.lastSeek = null;
        this.series = null;
        this.serKey = '';
        this.hmKey = '';
        this.fd = null;
        this.fdKey = '';
        this.errHist = [];
        this.stroke = null;
        this.hover = null;
        this.cur = new Float64Array(NS);
        this.tmp = new Float64Array(NS);
        this.hm = new Float64Array(HM_W * HM_H);
        this.energy = new Float64Array(HM_H);
        this.content = new Float64Array(HM_H);
        this.yr = [-0.2, 1.2];
        this.tau = 1;
        this.tmax = 1;
        this.info = {};
        this.rects = {};
    }

    num(k) { return Number(this.env.get(k)); }

    // ---------- model ----------
    pin() {
        const bc = this.env.get('h.bc'), u = this.u0;
        if (bc === 'dirichlet' || bc === 'mixed') u[0] = 0;
        if (bc === 'dirichlet') u[NS - 1] = 0;
        if (bc === 'fixed') { u[0] = this.num('h.Tl'); u[NS - 1] = this.num('h.Tr'); }
        if (bc === 'periodic') u[NS - 1] = u[0];
    }

    load(name) {
        if (!name) return;
        this.undo.push({ u0: this.u0 });
        this.u0.set(profile(name, NS, this.num('h.seed') || 1));
        this.pin();
        this.ver++;
        this.t = 0;
        this.errHist = [];
    }

    sync() {
        const get = (k) => this.env.get(k);
        const preset = get('h.preset');
        if (preset !== this.lastPreset) {
            const first = this.lastPreset === null;
            this.lastPreset = preset;
            if (preset) { if (first) { this.u0.set(profile(preset, NS, this.num('h.seed') || 1)); this.pin(); this.ver++; } else this.load(preset); }
            else if (first) { this.u0.set(profile('step', NS)); this.ver++; }
        }
        const pinKey = `${get('h.bc')}|${get('h.Tl')}|${get('h.Tr')}`;
        if (pinKey !== this.lastPin) { this.lastPin = pinKey; this.pin(); this.ver++; this.errHist = []; }
        const alpha = Math.max(1e-4, this.num('h.alpha') || 0.1);
        const key = `${pinKey}|${alpha}|${this.ver}`;
        if (key !== this.serKey) {
            this.serKey = key;
            this.series = heatSeries({
                bc: get('h.bc'), L: 1, alpha, u0: this.u0, Tl: this.num('h.Tl'), Tr: this.num('h.Tr'), count: NMODES,
            });
            const m = this.series.modes.find((q) => q.k > 0);
            this.tau = 1 / (alpha * m.k * m.k);
            this.hmKey = '';
            this.fdKey = '';
            this.errHist = [];
        }
        this.tmax = Math.max(1e-6, (Number(get('h.T')) || 1.5) * this.tau);
        const seek = this.num('h.t');
        if (this.lastSeek === null) this.lastSeek = seek;
        else if (seek !== this.lastSeek) { this.lastSeek = seek; this.t = clamp(seek, 0, 1) * this.tmax; }
        const terms = clamp(Math.round(this.num('h.terms')) || 1, 1, NMODES);
        const hmKey = `${this.serKey}|${terms}|${this.tmax}`;
        if (hmKey !== this.hmKey) { this.hmKey = hmKey; this.computeMap(terms); }
    }

    computeMap(terms) {
        const s = this.series;
        const row = new Float64Array(HM_W);
        let lo = Infinity, hi = -Infinity;
        for (let r = 0; r < HM_H; r++) {
            s.evaluate((this.tmax * r) / (HM_H - 1), HM_W, row, terms);
            let e = 0;
            for (let i = 0; i < HM_W; i++) { const v = row[i]; this.hm[r * HM_W + i] = v; e += v * v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
            this.energy[r] = e / (HM_W - 1);
            this.content[r] = trapz(row, 1 / (HM_W - 1));
        }
        const e0 = this.energy[0] > 1e-12 ? this.energy[0] : 1;
        for (let r = 0; r < HM_H; r++) this.energy[r] /= e0;
        this.hmRange = [Math.min(lo, 0), Math.max(hi, lo + 1e-9)];
        const u0 = this.u0;
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < NS; i++) { mn = Math.min(mn, u0[i]); mx = Math.max(mx, u0[i]); }
        s.evaluate(0, NS, this.tmp, terms);
        let tm = -Infinity, tl = Infinity;
        for (let i = 0; i < NS; i++) { tm = Math.max(tm, this.tmp[i]); tl = Math.min(tl, this.tmp[i]); }
        mn = Math.min(mn, tl, s.steady(0.5), 0); mx = Math.max(mx, tm, s.steady(0.5), 0.2);
        const pad = 0.12 * (mx - mn || 1);
        this.yr = [mn - pad, mx + pad];
        this.gibbs = { dataMax: Math.max(...u0), seriesMax: tm, terms };
    }

    // ---------- time stepping ----------
    update(dt) {
        const env = this.env;
        if (env.get('play')) {
            this.t += dt * (Number(env.get('speed')) || 1) * (this.tmax / 6);
            if (this.t >= this.tmax) {
                this.t = this.tmax;
                this.hold += dt;
                if (this.hold > 1) { this.t = 0; this.hold = 0; }
            } else this.hold = 0;
        }
        this.t = clamp(fin(this.t), 0, this.tmax);
        const terms = clamp(Math.round(this.num('h.terms')) || 1, 1, NMODES);
        this.series.evaluate(this.t, NS, this.cur, terms);
        this.updateFD(terms);
        if (this.stroke && env.mouseDown() && !this.stroke.moved) {
            const params = this.brushParams();
            dab(this.u0, this.stroke.lastIdx, this.stroke.lastVal, this.stroke.sign, params, Math.min(1, dt * 60) * 0.5);
            this.afterEdit();
        }
        if (this.stroke) this.stroke.moved = false;
    }

    updateFD(terms) {
        const mode = this.env.get('h.fd');
        if (mode === 'off') { this.fd = null; this.fdKey = ''; return; }
        const N = clamp(Math.round(this.num('h.fdN')) || 32, 8, 256);
        const r = clamp(this.num('h.r') || 0.4, 0.01, 4);
        const key = `${this.serKey}|${mode}|${N}|${r}`;
        if (key !== this.fdKey || (this.fd && this.fd.t > this.t + this.fd.dt)) {
            this.fdKey = key;
            this.fd = new HeatFD({
                bc: this.env.get('h.bc'), N, L: 1, alpha: Math.max(1e-4, this.num('h.alpha')), r, method: mode,
                u0: this.u0, Tl: this.num('h.Tl'), Tr: this.num('h.Tr'),
            });
            this.fd.blown = false;
            this.errHist = [];
            this.stride = Math.max(1, Math.floor(this.tmax / this.fd.dt / 400));
            this.fdBuf = new Float64Array(N + 1);
        }
        const fd = this.fd;
        let guard = 0;
        while (fd.t + fd.dt <= this.t + 1e-12 && guard < 4000 && !fd.blown) {
            fd.step();
            guard++;
            if (!(fd.maxAbs() < 1e150)) { fd.blown = true; break; }
            if (fd.steps % this.stride === 0) {
                this.series.evaluate(fd.t, fd.N + 1, this.fdBuf, terms);
                this.errHist.push([fd.t, maxDiff(fd.u, this.fdBuf)]);
            }
        }
        this.series.evaluate(fd.t, fd.N + 1, this.fdBuf, terms);
        this.fdErr = fd.blown ? Infinity : maxDiff(fd.u, this.fdBuf);
    }

    // ---------- editing ----------
    brushParams() {
        const span = this.yr[1] - this.yr[0];
        return {
            tool: this.env.get('tool'),
            radius: Math.max(0.5, (this.num('radius') / 100) * NS),
            soft: this.num('soft'),
            amount: this.num('strength') * 0.08 * span / 1.4,
        };
    }

    pointer(x, y) {
        const m = this.mA;
        const idx = clamp(((m.invX(x) - m.x0) / (m.x1 - m.x0)) * (NS - 1), 0, NS - 1);
        return { idx, val: clamp(m.invY(y), this.yr[0], this.yr[1]) };
    }

    afterEdit() {
        this.pin();
        this.ver++;
        if (this.env.get('h.preset') !== '') { this.env.set('h.preset', ''); }
        this.lastPreset = '';
    }

    press(x, y, o = {}) {
        if (this.mA && inRect(this.mA.r, x, y)) {
            this.undo.push({ u0: this.u0 });
            const { idx, val } = this.pointer(x, y);
            this.stroke = { sign: o.right ? -1 : 1, lastIdx: idx, lastVal: val, moved: true };
            const params = this.brushParams();
            if (params.tool === 'line') strokeTo(this.u0, this.stroke, idx, val, params);
            else dab(this.u0, idx, val, this.stroke.sign, params, 1);
            this.afterEdit();
            return true;
        }
        if (this.mC && inRect(this.mC.r, x, y)) { this.seekY(y); this.seeking = true; return true; }
        return false;
    }

    seekY(y) {
        const f = clamp((y - this.mC.r.y) / this.mC.r.h, 0, 1);
        this.t = f * this.tmax;
        if (this.env.get('play')) this.env.set('play', false);
    }

    drag(x, y) {
        if (this.seeking) { this.seekY(y); return; }
        this.moveHover(x, y);
        const s = this.stroke;
        if (!s) return;
        s.moved = true;
        const { idx, val } = this.pointer(x, y);
        strokeTo(this.u0, s, idx, val, this.brushParams());
        this.afterEdit();
    }

    release() { const had = !!(this.stroke || this.seeking); this.stroke = null; this.seeking = false; return had; }

    moveHover(x, y) { this.hover = this.mA && inRect(this.mA.r, x, y) ? { x, y } : null; }
    hoverAt(x, y) { this.moveHover(x, y); }

    actions() {
        return {
            undo: () => { if (this.undo.undo({ u0: this.u0 })) { this.afterEdit(); } },
            redo: () => { if (this.undo.redo({ u0: this.u0 })) { this.afterEdit(); } },
            clear: () => { this.undo.push({ u0: this.u0 }); this.u0.fill(0); this.afterEdit(); },
            restart: () => { this.t = 0; this.hold = 0; },
            randomize: () => { this.env.set('h.seed', (this.num('h.seed') || 1) + 1); this.env.set('h.preset', 'random'); this.lastPreset = 'random'; this.load('random'); },
        };
    }

    // ---------- drawing ----------
    draw(rect) {
        const { p, pal } = this.env;
        const narrow = rect.w < 640;
        const [a, b, c, d] = narrow ? splitRect(rect, 1, 4) : splitRect(rect, 2, 2);
        this.drawProfile(p, pal, a);
        this.drawSpectrum(p, pal, b);
        this.drawMap(p, pal, c);
        this.drawDiag(p, pal, d);
    }

    drawProfile(p, pal, r) {
        const env = this.env, s = this.series;
        const bc = env.get('h.bc');
        const inner = panel(p, pal, r, 'u(x, t)   series (solid)   initial (grey)   steady state (dotted)', { l: 40, t: 20, r: 10, b: 38 });
        const m = this.mA = makeMap(inner, 0, 1, this.yr[0], this.yr[1]);
        axes(p, pal, m, { xlabel: 'x / L', ylabel: 'temperature u' });
        const xs = (i) => i / (NS - 1);
        polyline(p, m, NS, xs, (i) => this.u0[i], pal.axis, 1.2);
        const st = s.steady(0.5);
        if (bc === 'fixed') dashed(p, m.X(0), m.Y(this.num('h.Tl')), m.X(1), m.Y(this.num('h.Tr')), pal.muted, 3, 3);
        else dashed(p, m.X(0), m.Y(st), m.X(1), m.Y(st), pal.muted, 3, 3);
        polyline(p, m, NS, xs, (i) => this.cur[i], pal.accent, 2.2);
        if (this.fd) {
            const fd = this.fd;
            polyline(p, m, fd.N + 1, (i) => i / fd.N, (i) => fd.u[i], fd.blown ? '#ff4d4f' : '#4aa3ff', 1.4);
        }
        if (this.hover && !this.stroke) {
            const rr = this.brushParams().radius / (NS - 1) * inner.w;
            p.noFill(); p.stroke(pal.muted); p.strokeWeight(1);
            p.circle(this.hover.x, this.hover.y, rr * 2);
        }
        // boundary glyphs
        const glyph = (x, kind) => {
            p.strokeWeight(2);
            p.stroke(kind === 'D' ? '#ffd166' : '#2ecc71');
            if (kind === 'D') p.line(m.X(x), inner.y, m.X(x), inner.y + inner.h);
            else for (let k = 0; k < 6; k++) { const yy = inner.y + ((k + 0.5) / 6) * inner.h; p.line(m.X(x), yy, m.X(x) + (x === 0 ? 5 : -5), yy); }
        };
        if (bc !== 'periodic') {
            glyph(0, bc === 'neumann' ? 'N' : 'D');
            glyph(1, bc === 'dirichlet' || bc === 'fixed' ? 'D' : 'N');
        }
        const tt = this.t;
        const info = this.info = {
            t: tt, tau: this.tau, tmax: this.tmax, terms: this.gibbs ? this.gibbs.terms : 0,
            fdErr: this.fd ? this.fdErr : null, stable: this.fd ? this.fd.stable : null,
            r: this.fd ? this.fd.r : null, blown: this.fd ? !!this.fd.blown : false,
            content: trapz(this.cur, 1 / (NS - 1)),
        };
        label(p, pal, `t = ${fmtNum(tt)}  (${fmtNum(tt / this.tau)} tau, tau = 1/(alpha k1^2) = ${fmtNum(this.tau)})   int u dx = ${fmtNum(info.content)}`, r.x + 8, r.y + r.h - 33, { size: 10, color: pal.fg });
        label(p, pal, `u_t = alpha u_xx,  ${BC_TEXT[bc]},  basis: ${BASIS_TEXT[bc]}`, r.x + 8, r.y + r.h - 19, { size: 10 });
        if (this.fd) {
            const fd = this.fd;
            const ok = fd.stable;
            const txt = `${{ ftcs: 'FTCS', be: 'backward Euler', cn: 'Crank-Nicolson' }[fd.method]}: r = alpha dt/dx^2 = ${fmtNum(fd.r)} ${fd.method === 'ftcs' ? (ok ? '<= 1/2  stable' : '> 1/2  UNSTABLE') : '(unconditionally stable)'}   max|FD - series| = ${fd.blown ? 'overflow' : fmtNum(this.fdErr)}`;
            label(p, pal, txt, r.x + r.w - 8, r.y + 5, { size: 10, color: ok ? '#4aa3ff' : '#ff4d4f', align: 'right' });
        }
        const g = this.gibbs;
        if (g && g.terms < NMODES && this.t < 1e-9) {
            label(p, pal, `Gibbs: ${g.terms} terms overshoot to ${fmtNum(g.seriesMax)} (data max ${fmtNum(g.dataMax)})`, r.x + r.w - 8, r.y + 19, { size: 10, align: 'right', color: pal.accent });
        }
    }

    drawSpectrum(p, pal, r) {
        const s = this.series;
        const terms = clamp(Math.round(this.num('h.terms')) || 1, 1, NMODES);
        const inner = panel(p, pal, r, 'mode amplitudes  a_n(t) = c_n exp(-alpha k_n^2 t)   (bar = now, tick = t = 0)', { l: 40, t: 20, r: 10, b: 38 });
        const a = s.amplitudes(this.t, NBARS);
        const ghost = s.coefs.slice(0, NBARS);
        let mx = 1e-9;
        for (let j = 0; j < NBARS; j++) mx = Math.max(mx, Math.abs(s.coefs[j]));
        const m = makeMap(inner, 0, NBARS, -mx * 1.1, mx * 1.1);
        axes(p, pal, m, { xticks: 0, ylabel: 'coefficient', grid: true });
        bars(p, m, a, { color: pal.accent, ghost, ghostColor: pal.fg, dim: terms, dimColor: pal.axis });
        const basis0 = s.kind === 'cos' || s.kind === 'periodic' ? 0 : 1;
        for (let j = 0; j < NBARS; j += (NBARS > 12 ? 2 : 1)) {
            const idx = s.kind === 'periodic' ? Math.ceil(j / 2) : j + basis0 - (s.kind === 'sinhalf' ? 0.5 : 0);
            label(p, pal, s.kind === 'periodic' ? (j === 0 ? '0' : `${idx}${j % 2 ? 'c' : 's'}`) : fmtNum(idx), inner.x + ((j + 0.5) / NBARS) * inner.w, inner.y + inner.h + 3, { size: 9, align: 'center' });
        }
        label(p, pal, 'mode number n', r.x + r.w - 8, r.y + r.h - 18, { size: 10, align: 'right' });
        const rate = (j) => s.decayRate(j);
        const jj = Math.min(NBARS - 1, 4);
        label(p, pal, `e-fold time of mode ${jj + 1 - (basis0 === 0 ? 1 : 0)}: ${fmtNum(1 / Math.max(1e-12, rate(jj)))}  vs mode 1: ${fmtNum(1 / Math.max(1e-12, rate(basis0 === 0 ? 1 : 0)))}   (ratio ~ n^2: high modes die first)`, r.x + 8, r.y + r.h - 18, { size: 10 });
        if (terms < NBARS) label(p, pal, `grey: beyond the ${terms} terms kept`, inner.x + inner.w, inner.y + 4, { size: 9, align: 'right' });
    }

    drawMap(p, pal, r) {
        const inner = panel(p, pal, r, 'space-time heat map  u(x, t)   (click to seek)', { l: 40, t: 20, r: 38, b: 24 });
        const lut = LUTS.heat;
        const [lo, hi] = this.hmRange || [0, 1];
        const img = this.env.images.get(p, 'heat-map', `${this.hmKey}|${lo}|${hi}`, HM_W, HM_H, (px, w, h) => {
            paintScalar(px, w, h, (i, j) => this.hm[j * HM_W + i], lut, lo, hi);
        });
        p.image(img, inner.x, inner.y, inner.w, inner.h);
        const m = this.mC = makeMap(inner, 0, 1, this.tmax, 0);
        p.noFill(); p.stroke(pal.axis); p.rect(inner.x, inner.y, inner.w, inner.h);
        const ty = inner.y + (this.t / this.tmax) * inner.h;
        p.stroke(255, 255, 255, 220); p.strokeWeight(1.5); p.line(inner.x, ty, inner.x + inner.w, ty);
        label(p, pal, 'x / L', inner.x + inner.w, inner.y + inner.h + 4, { size: 10, align: 'right' });
        label(p, pal, '0', inner.x - 4, inner.y, { size: 10, align: 'right' });
        label(p, pal, `t = ${fmtNum(this.tmax)}`, inner.x - 4, inner.y + inner.h, { size: 10, align: 'right', valign: 'bottom' });
        label(p, pal, 't', inner.x - 4, inner.y + inner.h / 2, { size: 10, align: 'right', valign: 'middle' });
        colorBar(p, pal, { x: inner.x + inner.w + 6, y: inner.y, w: 8, h: inner.h }, lut, lo, hi);
    }

    drawDiag(p, pal, r) {
        const half = (r.h - 6) / 2;
        const r1 = { x: r.x, y: r.y, w: r.w, h: half + 4 }, r2 = { x: r.x, y: r.y + half + 6, w: r.w, h: half - 6 + 4 };
        // top: energy and heat content versus time (from the series)
        let inner = panel(p, pal, r1, 'heat content Q(t) = int u dx (green)  and  energy E(t) = int u^2 dx (orange), normalised', { l: 40, t: 18, r: 10, b: 18 });
        const q0 = Math.abs(this.content[0]) > 1e-9 ? this.content[0] : 1;
        const qn = (i) => this.content[i] / q0;
        let lo = 0, hi = 1;
        for (let i = 0; i < HM_H; i++) { lo = Math.min(lo, qn(i), this.energy[i]); hi = Math.max(hi, qn(i), this.energy[i]); }
        const m = makeMap(inner, 0, this.tmax, lo - 0.05, hi + 0.05);
        axes(p, pal, m, { xlabel: 't', xticks: 4, yticks: 3 });
        polyline(p, m, HM_H, (i) => (this.tmax * i) / (HM_H - 1), qn, '#2ecc71', 1.8);
        polyline(p, m, HM_H, (i) => (this.tmax * i) / (HM_H - 1), (i) => this.energy[i], '#ff9f43', 1.8);
        p.stroke(pal.fg); p.strokeWeight(1); p.line(m.X(this.t), inner.y, m.X(this.t), inner.y + inner.h);
        // bottom: FD error history (log scale)
        inner = panel(p, pal, r2, 'finite-difference error  max|FD - series|  (log10)', { l: 40, t: 18, r: 10, b: 18 });
        const m2 = makeMap(inner, 0, this.tmax, -8, 4);
        axes(p, pal, m2, { xlabel: 't', xticks: 4, yticks: 3, fmtY: (v) => `1e${Math.round(v)}` });
        if (!this.fd) label(p, pal, 'choose a finite-difference scheme in the drawer', inner.x + 6, inner.y + 6, { size: 10 });
        else {
            const h = this.errHist;
            polyline(p, m2, h.length, (i) => h[i][0], (i) => Math.log10(Math.max(1e-12, Math.min(1e12, h[i][1]))), this.fd.blown || !this.fd.stable ? '#ff4d4f' : '#4aa3ff', 1.8);
            if (this.fd.blown) label(p, pal, 'overflow: scheme unstable', inner.x + inner.w - 6, inner.y + 6, { size: 10, align: 'right', color: '#ff4d4f' });
        }
    }
}

export { FTCS_LIMIT };
