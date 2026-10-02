// Plate 2D tab: heat equation on a rectangular plate with paintable heat sources, fixed-temperature
// regions and insulated holes; explicit and ADI solvers; product-mode decomposition; and a
// single-mode animation comparing exponential decay (heat) with oscillation (vibration).

import {
    PlateHeat, CELL_NORMAL, CELL_HOLE, CELL_FIXED, plateModeAmplitudes, plateModeField, rectEigen,
} from '../../lib/pde.js';
import { marchingSquares } from '../../lib/marching.js';
import {
    panel, axes, polyline, label, makeMap, paintScalar, LUTS, colorBar, clamp, fin, inRect, fmtNum, dashed,
} from './draw.js';

export const NM = 8; // mode grid is NM x NM
const BASE_NX = 48;

function presetInto(pl, name, env) {
    const { nx, ny } = pl;
    pl.u.fill(0); pl.q.fill(0); pl.type.fill(CELL_NORMAL); pl.fixedT.fill(0);
    pl.t = 0; pl.steps = 0;
    const cell = (i, j) => i + nx * j;
    if (name === 'spot') {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const dx = (i + 0.5) / nx - 0.5, dy = ((j + 0.5) / ny - 0.5) * (pl.b / pl.a);
            pl.u[cell(i, j)] = Math.exp(-(dx * dx + dy * dy) / (2 * 0.08 * 0.08));
        }
    } else if (name === 'bar') {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (Math.abs((j + 0.5) / ny - 0.5) < 0.1 && i > nx * 0.15 && i < nx * 0.85) pl.u[cell(i, j)] = 1;
    } else if (name === 'hole') {
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const x = (i + 0.5) / nx, y = (j + 0.5) / ny;
            if (Math.abs(x - 0.55) < 0.1 && Math.abs(y - 0.5) < 0.22) pl.type[cell(i, j)] = CELL_HOLE;
            if (Math.hypot((x - 0.2) * pl.a, (y - 0.5) * pl.b) < 0.07) pl.q[cell(i, j)] = Number(env.get('p.q')) || 4;
        }
        env.set('p.edge', 'insulated');
        pl.edge = 'insulated';
    } else if (name === 'gradient') {
        for (let j = 0; j < ny; j++) { pl.type[cell(0, j)] = CELL_FIXED; pl.fixedT[cell(0, j)] = 1; pl.type[cell(nx - 1, j)] = CELL_FIXED; pl.fixedT[cell(nx - 1, j)] = 0; }
        env.set('p.edge', 'insulated');
        pl.edge = 'insulated';
    } else if (name === 'mode') {
        const cold = pl.edge === 'cold';
        const m = Number(env.get('p.m')) - (cold ? 1 : 0), n = Number(env.get('p.n')) - (cold ? 1 : 0);
        plateModeField(pl.u, nx, ny, Math.max(0, m), Math.max(0, n), 1, pl.edge);
    }
    pl.applyFixed();
}

export class PlatePanel {
    constructor(env) {
        this.env = env;
        this.pl = null;
        this.key = '';
        this.lastPreset = null;
        this.stroke = null;
        this.hover = null;
        this.hist = [];
        this.amp = new Float64Array(NM * NM);
        this.ampFrame = 0;
        this.modeT = 0;
        this.modeBuf = null;
        this.undoStack = [];
        this.blown = false;
        this.info = {};
        this.R = { x: 0, y: 0, w: 10, h: 10 };
        this.mGrid = null;
    }

    num(k) { return Number(this.env.get(k)); }
    get aspect() { return clamp(this.num('p.aspect') || 0.75, 0.4, 2.5); }

    sync() {
        const get = (k) => this.env.get(k);
        const nx = BASE_NX, ny = Math.max(8, Math.round(BASE_NX * this.aspect));
        const key = `${nx}x${ny}`;
        let fresh = false;
        if (key !== this.key || !this.pl) {
            this.key = key;
            this.pl = new PlateHeat({
                nx, ny, a: 1, b: ny / nx, alpha: this.num('p.alpha') || 0.3, edge: get('p.edge'), method: get('p.method'), r: this.num('p.r') || 0.4,
            });
            this.hist = []; this.blown = false; this.undoStack.length = 0;
            fresh = true;
        }
        const pl = this.pl;
        pl.edge = get('p.edge');
        pl.method = get('p.method');
        const alpha = Math.max(1e-3, this.num('p.alpha') || 0.3);
        const r = clamp(this.num('p.r') || 0.4, 0.01, 8);
        if (alpha !== pl.alpha || r !== pl.r) { pl.alpha = alpha; pl.setR(r); }
        const preset = get('p.preset');
        if (fresh || preset !== this.lastPreset) {
            this.lastPreset = preset;
            if (preset || fresh) presetInto(pl, preset || 'spot', this.env);
            this.hist = []; this.blown = false;
        }
    }

    reset() { presetInto(this.pl, this.env.get('p.preset') || 'spot', this.env); this.hist = []; this.blown = false; }

    snapshot() {
        const pl = this.pl;
        this.undoStack.push({ u: pl.u.slice(), type: pl.type.slice(), fixedT: pl.fixedT.slice(), q: pl.q.slice() });
        if (this.undoStack.length > 20) this.undoStack.shift();
    }

    // ---------- painting ----------
    cellAt(x, y) {
        const R = this.R;
        return [clamp(Math.floor(((x - R.x) / R.w) * this.pl.nx), 0, this.pl.nx - 1), clamp(Math.floor((1 - (y - R.y) / R.h) * this.pl.ny), 0, this.pl.ny - 1)];
    }

    paint(ci, cj, erase) {
        const pl = this.pl, rad = Math.max(0.5, this.num('pradius') || 3);
        const tool = erase ? 'erase' : this.env.get('ptool');
        const q = Number(this.env.get('p.q')) || 4, T = Number(this.env.get('p.T'));
        for (let j = Math.max(0, Math.floor(cj - rad)); j <= Math.min(pl.ny - 1, Math.ceil(cj + rad)); j++) {
            for (let i = Math.max(0, Math.floor(ci - rad)); i <= Math.min(pl.nx - 1, Math.ceil(ci + rad)); i++) {
                if (Math.hypot(i - ci, j - cj) > rad) continue;
                const k = i + pl.nx * j;
                if (tool === 'source') { if (pl.type[k] === CELL_NORMAL) pl.q[k] = q; } else if (tool === 'sink') { if (pl.type[k] === CELL_NORMAL) pl.q[k] = -q; } else if (tool === 'fixed') { pl.type[k] = CELL_FIXED; pl.fixedT[k] = T; pl.q[k] = 0; } else if (tool === 'hole') { pl.type[k] = CELL_HOLE; pl.q[k] = 0; pl.u[k] = 0; } else if (tool === 'erase') { pl.type[k] = CELL_NORMAL; pl.q[k] = 0; }
            }
        }
        pl.applyFixed();
        if (this.env.get('p.preset') !== '') { this.env.set('p.preset', ''); this.lastPreset = ''; }
    }

    press(x, y, o = {}) {
        if (this.mGrid && inRect(this.mGrid.r, x, y)) {
            const g = this.mGrid;
            const mi = clamp(Math.floor(((x - g.r.x) / g.r.w) * NM), 0, NM - 1), ni = clamp(Math.floor(((y - g.r.y) / g.r.h) * NM), 0, NM - 1);
            const cold = this.pl.edge === 'cold';
            this.env.set('p.m', mi + (cold ? 1 : 0));
            this.env.set('p.n', ni + (cold ? 1 : 0));
            return true;
        }
        if (inRect(this.R, x, y)) {
            this.snapshot();
            const [ci, cj] = this.cellAt(x, y);
            this.stroke = { erase: !!o.right, last: [ci, cj] };
            this.paint(ci, cj, this.stroke.erase);
            return true;
        }
        return false;
    }

    drag(x, y) {
        this.hoverAt(x, y);
        const s = this.stroke;
        if (!s) return;
        const [ci, cj] = this.cellAt(x, y);
        const steps = Math.max(1, Math.ceil(Math.hypot(ci - s.last[0], cj - s.last[1])));
        for (let k = 1; k <= steps; k++) this.paint(s.last[0] + ((ci - s.last[0]) * k) / steps, s.last[1] + ((cj - s.last[1]) * k) / steps, s.erase);
        s.last = [ci, cj];
    }

    release() { const had = !!this.stroke; this.stroke = null; return had; }
    hoverAt(x, y) { this.hover = inRect(this.R, x, y) ? { x, y } : null; }

    actions() {
        return {
            undo: () => {
                const s = this.undoStack.pop();
                if (!s) return;
                this.pl.u.set(s.u); this.pl.type.set(s.type); this.pl.fixedT.set(s.fixedT); this.pl.q.set(s.q);
            },
            redo: () => {},
            clear: () => {
                this.snapshot();
                const pl = this.pl;
                pl.u.fill(0); pl.q.fill(0); pl.type.fill(CELL_NORMAL); pl.fixedT.fill(0);
                this.hist = []; this.blown = false;
                this.env.set('p.preset', ''); this.lastPreset = '';
            },
            coolDown: () => { this.snapshot(); const pl = this.pl; for (let k = 0; k < pl.u.length; k++) if (pl.type[k] === CELL_NORMAL) pl.u[k] = 0; this.hist = []; this.blown = false; },
            restart: () => { this.reset(); },
        };
    }

    // ---------- simulation ----------
    update(dt) {
        const env = this.env, pl = this.pl;
        const mode = env.get('p.mode');
        if (mode !== 'off') {
            if (env.get('play')) this.modeT += dt * (Number(env.get('speed')) || 1);
            return;
        }
        if (env.get('play') && !this.blown) {
            const n = clamp(Math.round(this.num('p.speed')) || 1, 1, 40);
            const t0 = Date.now();
            for (let k = 0; k < n && Date.now() - t0 < 10; k++) {
                pl.step();
                if (!(pl.maxAbs() < 1e8)) { this.blown = true; break; }
            }
        }
        this.ampFrame++;
        if (this.ampFrame % 3 === 0 || this.hist.length === 0) {
            const cold = pl.edge === 'cold';
            this.amp = plateModeAmplitudes(pl.u, pl.nx, pl.ny, pl.a, pl.b, NM, NM, pl.edge);
            const m = Math.max(0, this.num('p.m') - (cold ? 1 : 0)), n = Math.max(0, this.num('p.n') - (cold ? 1 : 0));
            if (!this.blown || this.hist.length === 0) {
                this.hist.push({ t: pl.t, content: fin(pl.content()), max: fin(pl.maxAbs()), mode: fin(this.amp[Math.min(NM - 1, m) + NM * Math.min(NM - 1, n)]) });
                if (this.hist.length > 600) this.hist.shift();
            }
        }
    }

    modeInfo() {
        const pl = this.pl, cold = pl.edge === 'cold';
        const m = clamp(Math.round(this.num('p.m')), cold ? 1 : 0, NM - (cold ? 0 : 1)), n = clamp(Math.round(this.num('p.n')), cold ? 1 : 0, NM - (cold ? 0 : 1));
        const lam = rectEigen(m, n, pl.a, pl.b);
        return { m, n, lam, rate: pl.alpha * lam, omega: Math.sqrt(lam), mi: m - (cold ? 1 : 0), ni: n - (cold ? 1 : 0) };
    }

    // ---------- drawing ----------
    draw(rect) {
        const { p, pal } = this.env;
        const narrow = rect.w < 640;
        let main, a, b;
        if (narrow) { main = { ...rect, h: rect.h * 0.5 }; a = { x: rect.x, y: rect.y + rect.h * 0.5 + 6, w: rect.w, h: rect.h * 0.25 - 6 }; b = { x: rect.x, y: rect.y + rect.h * 0.75 + 6, w: rect.w, h: rect.h * 0.25 - 6 }; } else {
            const wl = Math.round(rect.w * 0.58);
            main = { x: rect.x, y: rect.y, w: wl, h: rect.h };
            const wr = rect.w - wl - 6, hh = (rect.h - 6) / 2;
            a = { x: rect.x + wl + 6, y: rect.y, w: wr, h: hh };
            b = { x: rect.x + wl + 6, y: rect.y + hh + 6, w: wr, h: hh };
        }
        this.drawMain(p, pal, main);
        this.drawModes(p, pal, a);
        this.drawHistory(p, pal, b);
    }

    drawMain(p, pal, r) {
        const pl = this.pl, env = this.env;
        const mode = env.get('p.mode');
        panel(p, pal, r, mode === 'off' ? 'T(x, y, t):  T_t = alpha lap T + q    (paint with the tool buttons; right button erases)' : `single mode (${this.modeInfo().m}, ${this.modeInfo().n}): ${mode === 'heat' ? 'heat  exp(-alpha lambda t)' : 'vibration  cos(omega t)'}`, { l: 0, t: 18, r: 0, b: 0 });
        const asp = pl.b / pl.a;
        const availW = r.w - 70, availH = r.h - 64;
        const W = Math.max(20, Math.min(availW, availH / asp)), H = W * asp;
        const R = this.R = { x: r.x + (r.w - 70 - W) / 2 + 12, y: r.y + 26 + (availH - H) / 2, w: W, h: H };
        const lut = mode === 'vib' ? LUTS.diverging : LUTS.heat;
        let lo, hi, field = pl.u;
        const mi = this.modeInfo();
        if (mode !== 'off') {
            if (!this.modeBuf || this.modeBuf.length !== pl.u.length) this.modeBuf = new Float64Array(pl.u.length);
            let amp;
            if (mode === 'heat') amp = Math.exp(-((this.modeT * 0.5) % 3)); // decay over 3 e-folds, then repeat
            else amp = Math.cos(mi.omega * this.modeT * 0.5);
            plateModeField(this.modeBuf, pl.nx, pl.ny, mi.mi, mi.ni, amp, pl.edge);
            field = this.modeBuf;
            lo = mode === 'vib' ? -1 : 0; hi = 1;
            this.info.animAmp = amp;
        } else {
            lo = 0; hi = Math.max(1, this.num('p.T') || 1);
            let mn = 0;
            for (let k = 0; k < pl.u.length; k++) { if (pl.type[k] === CELL_HOLE) continue; hi = Math.max(hi, pl.u[k]); mn = Math.min(mn, pl.u[k]); }
            lo = mn;
        }
        const nx = pl.nx, ny = pl.ny;
        const f = field;
        const key = `${mode}|${pl.t}|${pl.steps}|${this.modeT}|${lo}|${hi}|${nx}x${ny}|${f === pl.u ? this.cellSig() : ''}`;
        const img = env.images.get(this.env.p, 'plate', key, nx, ny, (px, w, h) => {
            paintScalar(px, w, h, (i, j) => f[i + nx * (ny - 1 - j)], lut, lo, hi);
            if (mode === 'off') {
                for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                    const k = i + nx * (ny - 1 - j), o = (i + w * j) * 4;
                    if (pl.type[k] === CELL_HOLE) { px[o] = 24; px[o + 1] = 26; px[o + 2] = 32; px[o + 3] = 255; } else if (pl.type[k] === CELL_FIXED) { px[o] = Math.min(255, px[o] * 0.7 + 90); px[o + 1] = Math.min(255, px[o + 1] * 0.7 + 90); px[o + 2] = Math.min(255, px[o + 2] * 0.7 + 90); }
                }
            }
        });
        p.image(img, R.x, R.y, R.w, R.h);
        const cw = R.w / nx, ch = R.h / ny;
        if (mode === 'off') {
            p.noFill(); p.strokeWeight(1);
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
                const k = i + nx * j;
                const x = R.x + (i + 0.5) * cw, y = R.y + R.h - (j + 0.5) * ch;
                if (pl.q[k] !== 0) { p.stroke(pl.q[k] > 0 ? '#2ecc71' : '#4aa3ff'); p.point(x, y); } else if (pl.type[k] === CELL_FIXED) { p.stroke(255, 255, 255, 140); p.point(x, y); }
            }
        } else {
            // nodal lines of the chosen mode
            const grid = new Float64Array((nx + 1) * (ny + 1));
            const cold = pl.edge === 'cold';
            const km = mi.m, kn = mi.n;
            for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
                const fx = cold ? Math.sin((km * Math.PI * i) / nx) : Math.cos((km * Math.PI * i) / nx);
                const fy = cold ? Math.sin((kn * Math.PI * j) / ny) : Math.cos((kn * Math.PI * j) / ny);
                grid[i + (nx + 1) * j] = fx * fy;
            }
            const seg = marchingSquares({ values: grid, nx, ny, bounds: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 } }, { level: 0 });
            p.stroke(255, 255, 255, 200); p.strokeWeight(1.5);
            for (let i = 0; i < seg.count; i++) p.line(R.x + seg.segments[i * 4] * R.w, R.y + R.h - seg.segments[i * 4 + 1] * R.h, R.x + seg.segments[i * 4 + 2] * R.w, R.y + R.h - seg.segments[i * 4 + 3] * R.h);
        }
        p.noFill(); p.stroke(pal.axis); p.strokeWeight(1); p.rect(R.x, R.y, R.w, R.h);
        if (pl.edge === 'cold') { p.stroke('#4aa3ff'); p.strokeWeight(3); p.rect(R.x - 1.5, R.y - 1.5, R.w + 3, R.h + 3); }
        if (this.hover && mode === 'off') {
            const rad = (this.num('pradius') || 3) * cw;
            p.noFill(); p.stroke(255, 255, 255, 200); p.strokeWeight(1); p.circle(this.hover.x, this.hover.y, rad * 2);
        }
        colorBar(p, pal, { x: R.x + R.w + 10, y: R.y, w: 8, h: R.h }, lut, lo, hi);
        const limit = pl.method === 'explicit' ? (pl.r <= 0.5 ? `r = ${fmtNum(pl.r)} <= 1/2 stable` : `r = ${fmtNum(pl.r)} > 1/2 UNSTABLE`) : `ADI r = ${fmtNum(pl.r)} (unconditionally stable)`;
        this.info = { ...this.info, r: pl.r, stable: pl.method !== 'explicit' || pl.r <= 0.5, blown: this.blown, t: pl.t, content: pl.content(), maxT: pl.maxAbs() };
        label(p, pal, `t = ${fmtNum(pl.t)}   heat content = ${fmtNum(pl.content())}   max T = ${fmtNum(pl.maxAbs())}`, r.x + 8, r.y + r.h - 32, { size: 10, color: pal.fg });
        label(p, pal, `${pl.method === 'explicit' ? 'explicit FTCS' : 'Peaceman-Rachford ADI'}: ${limit};  edge: ${pl.edge === 'cold' ? 'T = 0 (blue frame)' : 'insulated'}`, r.x + 8, r.y + r.h - 18, { size: 10, color: this.info.stable ? pal.muted : '#ff4d4f' });
        if (this.blown) label(p, pal, 'explicit scheme blew up: reduce r or switch to ADI', R.x + R.w / 2, R.y + R.h / 2, { size: 13, align: 'center', color: '#ff4d4f' });
    }

    cellSig() {
        // cheap signature of the painted layout and field (changes when the user paints)
        const pl = this.pl;
        let s = 0;
        for (let k = 0; k < pl.type.length; k++) s += pl.type[k] * 3 + (pl.q[k] !== 0 ? 1 : 0) + pl.u[k] * 0.37;
        return Math.round(s * 1000);
    }

    drawModes(p, pal, r) {
        const pl = this.pl, cold = pl.edge === 'cold';
        const inner = panel(p, pal, r, `product modes ${cold ? 'sin' : 'cos'}(m pi x/a) ${cold ? 'sin' : 'cos'}(n pi y/b):  amplitudes (click to choose)`, { l: 30, t: 20, r: 10, b: 54 });
        const cell = Math.min(inner.w / NM, inner.h / NM);
        const g = { x: inner.x, y: inner.y, w: cell * NM, h: cell * NM };
        this.mGrid = { r: g };
        let mx = 1e-9;
        for (let k = 0; k < this.amp.length; k++) mx = Math.max(mx, Math.abs(this.amp[k]));
        const lut = LUTS.diverging;
        p.noStroke();
        for (let ni = 0; ni < NM; ni++) for (let mi = 0; mi < NM; mi++) {
            const v = this.amp[mi + NM * ni] / mx;
            const k = Math.round((v * 0.5 + 0.5) * 255) * 3;
            p.fill(lut[k], lut[k + 1], lut[k + 2]);
            p.rect(g.x + mi * cell, g.y + ni * cell, cell - 1, cell - 1);
        }
        const mi = this.modeInfo();
        p.noFill(); p.stroke(255); p.strokeWeight(2);
        p.rect(g.x + mi.mi * cell, g.y + mi.ni * cell, cell - 1, cell - 1);
        for (let i = 0; i < NM; i++) {
            const lab = String(i + (cold ? 1 : 0));
            label(p, pal, lab, g.x + (i + 0.5) * cell, g.y + g.h + 2, { size: 9, align: 'center' });
            label(p, pal, lab, g.x - 4, g.y + (i + 0.5) * cell, { size: 9, align: 'right', valign: 'middle' });
        }
        label(p, pal, 'm', g.x + g.w + 4, g.y + g.h - 6, { size: 10 });
        label(p, pal, 'n', g.x - 24, g.y - 2, { size: 10 });
        const amp = this.amp[Math.min(NM - 1, Math.max(0, mi.mi)) + NM * Math.min(NM - 1, Math.max(0, mi.ni))];
        label(p, pal, `mode (${mi.m}, ${mi.n}): lambda = pi^2 (m^2/a^2 + n^2/b^2) = ${fmtNum(mi.lam)}`, r.x + 8, r.y + r.h - 46, { size: 10, color: pal.fg });
        label(p, pal, `heat: amplitude ~ exp(-alpha lambda t),  rate alpha lambda = ${fmtNum(mi.rate)}`, r.x + 8, r.y + r.h - 32, { size: 10 });
        label(p, pal, `vibration: amplitude ~ cos(omega t),  omega = c sqrt(lambda) = ${fmtNum(mi.omega)} c   (same shape, different time law)`, r.x + 8, r.y + r.h - 18, { size: 10 });
        this.info.modeAmp = amp;
    }

    drawHistory(p, pal, r) {
        const inner = panel(p, pal, r, 'history: max T (orange), heat content (green), selected mode amplitude (red) vs exp(-alpha lambda t) (dashed)', { l: 40, t: 20, r: 10, b: 22 });
        const h = this.hist;
        if (h.length < 2) return;
        const t0 = h[0].t, t1 = Math.max(h[h.length - 1].t, t0 + 1e-6);
        let mx = 1e-9, mn = 0;
        for (const e of h) { mx = Math.max(mx, e.max, e.content, Math.abs(e.mode)); mn = Math.min(mn, e.content, e.mode); }
        const m = makeMap(inner, t0, t1, mn, mx * 1.1);
        axes(p, pal, m, { xlabel: 't', xticks: 3, yticks: 3 });
        polyline(p, m, h.length, (i) => h[i].t, (i) => h[i].max, '#ff9f43', 1.5);
        polyline(p, m, h.length, (i) => h[i].t, (i) => h[i].content, '#2ecc71', 1.5);
        polyline(p, m, h.length, (i) => h[i].t, (i) => h[i].mode, pal.accent, 1.8);
        const mi = this.modeInfo();
        const a0 = h[0].mode;
        p.stroke(pal.fg); p.strokeWeight(1);
        let prev = null;
        for (let i = 0; i < h.length; i += Math.max(1, Math.floor(h.length / 40))) {
            const x = m.X(h[i].t), y = clamp(m.Y(a0 * Math.exp(-mi.rate * (h[i].t - t0))), inner.y, inner.y + inner.h);
            if (prev && (i / Math.max(1, Math.floor(h.length / 40))) % 2 === 0) p.line(prev[0], prev[1], x, y);
            prev = [x, y];
        }
        void dashed;
    }
}
