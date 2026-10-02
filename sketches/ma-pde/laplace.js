// Laplace tab: lap(u) = 0 on a rectangle with Dirichlet data drawn on each of the four sides.
// Separation-of-variables series (sinh/sinh ratios) versus SOR relaxation; maximum principle;
// random-walk (harmonic measure) estimate of the value at a clicked point.

import {
    laplaceSeries, LaplaceRelax, fieldExtrema, RandomWalkEstimator, mulberry32,
} from '../../lib/pde.js';
import { marchingSquares } from '../../lib/marching.js';
import { resample } from '../impulse/brush.js';
import {
    panel, axes, polyline, label, makeMap, paintScalar, LUTS, colorBar, splitRect, clamp, fin, inRect, fmtNum, dashed, bars,
} from './draw.js';
import { Undo, dab, strokeTo } from './edit.js';

export const NX = 64;
const BAND = 46; // pixels of margin for the side profiles
const SIDE_SCALE = 1.2; // |value| represented by the band height
const SIDES = ['bottom', 'top', 'left', 'right'];

/** Side arrays for a preset on an nx x ny grid. */
export function sidePreset(name, nx, ny, seed = 1) {
    const s = { bottom: new Float64Array(nx + 1), top: new Float64Array(nx + 1), left: new Float64Array(ny + 1), right: new Float64Array(ny + 1) };
    const sx = (i) => Math.sin((Math.PI * i) / nx), sy = (j) => Math.sin((Math.PI * j) / ny);
    if (name === 'bump') for (let i = 0; i <= nx; i++) s.top[i] = sx(i);
    else if (name === 'quad') {
        for (let i = 0; i <= nx; i++) { s.top[i] = sx(i); s.bottom[i] = sx(i); }
        for (let j = 0; j <= ny; j++) { s.left[j] = -sy(j); s.right[j] = -sy(j); }
    } else if (name === 'ramp') {
        for (let i = 0; i <= nx; i++) { s.top[i] = i / nx; s.bottom[i] = i / nx; }
        s.right.fill(1);
    } else if (name === 'step') {
        for (let i = 0; i <= nx; i++) s.top[i] = i === 0 || i === nx ? 0 : i < nx / 2 ? 1 : -1;
    } else if (name === 'spot') {
        for (let i = 0; i <= nx; i++) s.top[i] = Math.exp(-((((i / nx) - 0.5) / 0.08) ** 2));
    } else if (name === 'random') {
        const rng = mulberry32(seed);
        for (const k of SIDES) {
            const arr = s[k], n = arr.length - 1;
            let mx = 1e-9;
            for (let m = 1; m <= 5; m++) {
                const a = (rng() * 2 - 1) / m;
                for (let i = 0; i <= n; i++) arr[i] += a * Math.sin((m * Math.PI * i) / n);
            }
            for (let i = 0; i <= n; i++) mx = Math.max(mx, Math.abs(arr[i]));
            for (let i = 0; i <= n; i++) arr[i] /= mx;
        }
    }
    return s;
}

export class LaplacePanel {
    constructor(env) {
        this.env = env;
        this.ny = NX;
        this.sides = sidePreset('bump', NX, NX);
        this.undo = new Undo();
        this.ver = 0;
        this.lastPreset = null;
        this.lastAspect = null;
        this.serKey = '';
        this.series = null;
        this.relax = null;
        this.walker = null;
        this.walkKey = '';
        this.stroke = null;
        this.hover = null;
        this.contourKey = '';
        this.contours = [];
        this.diff = null;
        this.info = {};
        this.R = { x: 60, y: 60, w: 200, h: 200 };
    }

    num(k) { return Number(this.env.get(k)); }
    get b() { return this.ny / NX; }

    arrays() { return { bottom: this.sides.bottom, top: this.sides.top, left: this.sides.left, right: this.sides.right }; }

    sync() {
        const get = (k) => this.env.get(k);
        const aspect = [0.5, 0.75, 1, 1.5, 2].reduce((best, v) => (Math.abs(v - this.num('l.aspect')) < Math.abs(best - this.num('l.aspect')) ? v : best), 1);
        const ny = Math.round(NX * aspect);
        const preset = get('l.preset');
        if (this.lastAspect === null || ny !== this.ny) {
            const old = this.sides, had = this.lastAspect !== null;
            this.ny = ny;
            this.lastAspect = aspect;
            if (had) this.sides = { bottom: old.bottom, top: old.top, left: resample(old.left, ny + 1), right: resample(old.right, ny + 1) };
            if (!had || preset) this.sides = sidePreset(preset || 'bump', NX, ny, this.num('l.seed') || 1);
            this.ver++;
            this.undo.clear();
            this.lastPreset = preset;
        } else if (preset !== this.lastPreset) {
            this.lastPreset = preset;
            if (preset) {
                this.undo.push(this.arrays());
                this.sides = sidePreset(preset, NX, this.ny, this.num('l.seed') || 1);
                this.ver++;
            }
        }
        const terms = clamp(Math.round(this.num('l.terms')) || 1, 1, 60);
        const key = `${this.ver}|${this.ny}|${terms}`;
        if (key !== this.serKey) {
            this.serKey = key;
            const s = this.sides;
            this.series = laplaceSeries({ a: 1, b: this.b, nx: NX, ny: this.ny, bottom: s.bottom, top: s.top, left: s.left, right: s.right, terms });
            this.diffKey = '';
        }
        const rkey = `${this.ver}|${this.ny}`;
        if (rkey !== this.relaxKey) {
            this.relaxKey = rkey;
            const s = this.sides;
            this.relax = new LaplaceRelax({ a: 1, b: this.b, nx: NX, ny: this.ny, bottom: s.bottom, top: s.top, left: s.left, right: s.right });
            this.walkKey = '';
        }
    }

    get probe() {
        return [clamp(Math.round(this.num('l.px') * NX), 1, NX - 1), clamp(Math.round(this.num('l.py') * this.ny), 1, this.ny - 1)];
    }

    update(dt) {
        const rel = this.relax;
        if (rel && rel.lastChange > 1e-9 && rel.iterations < 6000) {
            const t0 = Date.now();
            for (let k = 0; k < 60 && Date.now() - t0 < 8; k++) { if (rel.sweep() < 1e-9) break; }
        }
        if (this.env.get('l.walk')) {
            const [pi, pj] = this.probe;
            const key = `${this.relaxKey}|${pi}|${pj}|${this.env.get('l.seed')}`;
            if (key !== this.walkKey || !this.walker) {
                this.walkKey = key;
                const s = this.sides;
                this.walker = new RandomWalkEstimator({ nx: NX, ny: this.ny, bottom: s.bottom, top: s.top, left: s.left, right: s.right, seed: this.num('l.seed') || 1 });
                this.walker.setStart(pi, pj);
            }
            const target = clamp(Math.round(this.num('l.walkers')) || 1000, 100, 20000);
            if (this.walker.count < target) this.walker.run(Math.min(target - this.walker.count, 600));
        } else this.walker = null;
        if (this.stroke && this.env.mouseDown() && !this.stroke.moved) {
            const s = this.stroke;
            dab(s.arr, s.lastIdx, s.lastVal, s.sign, this.brushParams(s.arr.length), Math.min(1, dt * 60) * 0.5);
            this.afterEdit();
        }
        if (this.stroke) this.stroke.moved = false;
    }

    displayGrid() {
        const show = this.env.get('l.show');
        if (show === 'relax') return this.relax.v;
        if (show === 'diff') {
            const k = `${this.serKey}|${this.relax.iterations}`;
            if (k !== this.diffKey) {
                this.diffKey = k;
                if (!this.diff || this.diff.length !== this.series.length) this.diff = new Float64Array(this.series.length);
                for (let i = 0; i < this.diff.length; i++) this.diff[i] = Math.abs(this.series[i] - this.relax.v[i]);
            }
            return this.diff;
        }
        return this.series;
    }

    // ---------- editing ----------
    brushParams(n) {
        return {
            tool: this.env.get('tool'),
            radius: Math.max(0.5, (this.num('radius') / 100) * n),
            soft: this.num('soft'),
            amount: this.num('strength') * 0.08 * SIDE_SCALE / 1.2,
        };
    }

    /** Which side's band contains the pixel, with sample index and value. */
    sideAt(x, y) {
        const R = this.R, s = BAND / SIDE_SCALE, near = 14;
        const inX = x >= R.x - 2 && x <= R.x + R.w + 2, inY = y >= R.y - 2 && y <= R.y + R.h + 2;
        if (inX && y > R.y + R.h - near && y < R.y + R.h + BAND + 6) return { side: 'bottom', idx: clamp(((x - R.x) / R.w) * NX, 0, NX), val: (y - (R.y + R.h)) / s };
        if (inX && y < R.y + near && y > R.y - BAND - 6) return { side: 'top', idx: clamp(((x - R.x) / R.w) * NX, 0, NX), val: (R.y - y) / s };
        if (inY && x < R.x + near && x > R.x - BAND - 6) return { side: 'left', idx: clamp(((R.y + R.h - y) / R.h) * this.ny, 0, this.ny), val: (R.x - x) / s };
        if (inY && x > R.x + R.w - near && x < R.x + R.w + BAND + 6) return { side: 'right', idx: clamp(((R.y + R.h - y) / R.h) * this.ny, 0, this.ny), val: (x - (R.x + R.w)) / s };
        return null;
    }

    afterEdit() {
        this.ver++;
        if (this.env.get('l.preset') !== '') this.env.set('l.preset', '');
        this.lastPreset = '';
    }

    press(x, y, o = {}) {
        const hit = this.sideAt(x, y);
        if (hit) {
            this.undo.push(this.arrays());
            const arr = this.sides[hit.side];
            const val = clamp(hit.val, -SIDE_SCALE, SIDE_SCALE);
            this.stroke = { side: hit.side, arr, sign: o.right ? -1 : 1, lastIdx: hit.idx, lastVal: val, moved: true };
            const params = this.brushParams(arr.length);
            if (params.tool === 'line') strokeTo(arr, this.stroke, hit.idx, val, params);
            else dab(arr, hit.idx, val, this.stroke.sign, params, 1);
            this.afterEdit();
            return true;
        }
        const R = this.R;
        if (inRect(R, x, y)) {
            this.env.set('l.px', Math.round(clamp((x - R.x) / R.w, 0.03, 0.97) * 1000) / 1000);
            this.env.set('l.py', Math.round(clamp(1 - (y - R.y) / R.h, 0.03, 0.97) * 1000) / 1000);
            this.walkKey = '';
            return true;
        }
        return false;
    }

    drag(x, y) {
        this.hoverAt(x, y);
        const s = this.stroke;
        if (!s) return;
        s.moved = true;
        const hit = this.sideAt(x, y);
        // keep editing the side under the stroke, projecting the pointer onto it
        const R = this.R, sc = BAND / SIDE_SCALE;
        let idx, val;
        if (s.side === 'bottom' || s.side === 'top') {
            idx = clamp(((x - R.x) / R.w) * NX, 0, NX);
            val = s.side === 'bottom' ? (y - (R.y + R.h)) / sc : (R.y - y) / sc;
        } else {
            idx = clamp(((R.y + R.h - y) / R.h) * this.ny, 0, this.ny);
            val = s.side === 'left' ? (R.x - x) / sc : (x - (R.x + R.w)) / sc;
        }
        void hit;
        strokeTo(s.arr, s, idx, clamp(val, -SIDE_SCALE, SIDE_SCALE), this.brushParams(s.arr.length));
        this.afterEdit();
    }

    release() { const had = !!this.stroke; this.stroke = null; return had; }
    hoverAt(x, y) { const h = this.sideAt(x, y); this.hover = h ? { x, y, side: h.side } : null; }

    actions() {
        return {
            undo: () => { if (this.undo.undo(this.arrays())) this.afterEdit(); },
            redo: () => { if (this.undo.redo(this.arrays())) this.afterEdit(); },
            clear: () => { this.undo.push(this.arrays()); for (const k of SIDES) this.sides[k].fill(0); this.afterEdit(); },
            reseed: () => { this.env.set('l.seed', (this.num('l.seed') || 1) + 1); this.walkKey = ''; },
            randomize: () => { this.env.set('l.seed', (this.num('l.seed') || 1) + 1); this.undo.push(this.arrays()); this.sides = sidePreset('random', NX, this.ny, this.num('l.seed')); this.env.set('l.preset', 'random'); this.lastPreset = 'random'; this.ver++; },
        };
    }

    // ---------- drawing ----------
    draw(rect) {
        const { p, pal } = this.env;
        const narrow = rect.w < 640;
        let main, side1, side2;
        if (narrow) [main, side1, side2] = [{ ...rect, h: rect.h * 0.5 }, { x: rect.x, y: rect.y + rect.h * 0.5 + 6, w: rect.w, h: rect.h * 0.25 - 6 }, { x: rect.x, y: rect.y + rect.h * 0.75 + 6, w: rect.w, h: rect.h * 0.25 - 6 }];
        else {
            const wl = Math.round(rect.w * 0.6);
            main = { x: rect.x, y: rect.y, w: wl, h: rect.h };
            const [a, b] = splitRect({ x: rect.x + wl + 6, y: rect.y, w: rect.w - wl - 6, h: rect.h }, 1, 2);
            side1 = a; side2 = b;
        }
        this.drawMain(p, pal, main);
        this.drawCompare(p, pal, side1);
        if (this.env.get('l.walk')) this.drawWalk(p, pal, side2); else this.drawSlice(p, pal, side2);
    }

    drawMain(p, pal, r) {
        panel(p, pal, r, 'u(x, y): lap u = 0   (draw the four boundary profiles; click inside to probe)', { l: 0, t: 18, r: 0, b: 0 });
        const b = this.b;
        const availW = r.w - 2 * BAND - 16, availH = r.h - 2 * BAND - 50;
        const scale = Math.max(20, Math.min(availW / 1, availH / b));
        const W = scale, H = scale * b;
        const R = this.R = { x: r.x + (r.w - W) / 2, y: r.y + 24 + BAND + (availH - H) / 2 + 4, w: W, h: H };
        const grid = this.displayGrid();
        const sd = this.sides;
        let bm = 0.3;
        for (const k of SIDES) for (let i = 0; i < sd[k].length; i++) bm = Math.max(bm, Math.abs(sd[k][i]));
        const show = this.env.get('l.show');
        const lut = show === 'diff' ? LUTS.heat : LUTS.diverging;
        let lo = -bm, hi = bm;
        if (show === 'diff') { lo = 0; hi = 0; for (let i = 0; i < grid.length; i++) hi = Math.max(hi, grid[i]); hi = Math.max(hi, 1e-6); }
        const sx = NX + 1, ny = this.ny;
        const key = `${show}|${this.serKey}|${this.relax.iterations}|${lo}|${hi}`;
        const img = this.env.images.get(p, 'laplace', key, sx, ny + 1, (px, w, h) => {
            paintScalar(px, w, h, (i, j) => grid[i + sx * (ny - j)], lut, lo, hi);
        });
        p.image(img, R.x, R.y, R.w, R.h);
        // equipotentials
        const nlev = clamp(Math.round(this.num('l.contours')) || 0, 0, 30);
        if (nlev > 0 && show !== 'diff') {
            const ck = `${key}|${nlev}`;
            if (ck !== this.contourKey) {
                this.contourKey = ck;
                this.contours = [];
                const src = { values: grid, nx: NX, ny, bounds: { xmin: 0, xmax: 1, ymin: 0, ymax: b } };
                for (let k = 1; k <= nlev; k++) {
                    const level = -bm + ((2 * bm) * k) / (nlev + 1);
                    this.contours.push({ level, seg: marchingSquares(src, { level }) });
                }
            }
            p.strokeWeight(1);
            for (const c of this.contours) {
                const seg = c.seg.segments;
                p.stroke(Math.abs(c.level) < 1e-9 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.45)');
                for (let i = 0; i < c.seg.count; i++) {
                    p.line(R.x + seg[i * 4] * W, R.y + H - (seg[i * 4 + 1] / b) * H, R.x + seg[i * 4 + 2] * W, R.y + H - (seg[i * 4 + 3] / b) * H);
                }
            }
        }
        p.noFill(); p.stroke(pal.axis); p.strokeWeight(1); p.rect(R.x, R.y, R.w, R.h);
        // side profiles
        const sc = BAND / SIDE_SCALE;
        const prof = (arr, f, color) => {
            const n = arr.length - 1;
            p.noFill(); p.stroke(color); p.strokeWeight(2);
            p.beginShape();
            for (let i = 0; i <= n; i++) { const [x, y] = f(i / n, arr[i] * sc); p.vertex(x, y); }
            p.endShape();
        };
        prof(sd.bottom, (t, v) => [R.x + t * W, R.y + H + v], '#4aa3ff');
        prof(sd.top, (t, v) => [R.x + t * W, R.y - v], '#ff9f43');
        prof(sd.left, (t, v) => [R.x - v, R.y + H - t * H], '#2ecc71');
        prof(sd.right, (t, v) => [R.x + W + v, R.y + H - t * H], '#c77dff');
        label(p, pal, 'u = f_top(x)', R.x + W / 2, R.y - BAND - 12, { size: 10, align: 'center', color: '#ff9f43' });
        label(p, pal, 'u = f_bottom(x)', R.x + W / 2, R.y + H + BAND + 2, { size: 10, align: 'center', color: '#4aa3ff' });
        label(p, pal, 'g_left(y)', R.x - BAND, R.y - 12, { size: 10, color: '#2ecc71' });
        label(p, pal, 'g_right(y)', R.x + W + BAND, R.y - 12, { size: 10, color: '#c77dff', align: 'right' });
        if (this.hover) {
            const rr = this.brushParams(NX).radius / NX * (this.hover.side === 'left' || this.hover.side === 'right' ? H : W);
            p.noFill(); p.stroke(pal.muted); p.strokeWeight(1);
            p.circle(this.hover.x, this.hover.y, rr * 2);
        }
        // maximum principle
        const ex = fieldExtrema(this.series, NX, ny);
        const mark = (ij, color, up) => {
            const x = R.x + (ij[0] / NX) * W, y = R.y + H - (ij[1] / ny) * H;
            p.noStroke(); p.fill(color);
            if (up) p.triangle(x, y - 6, x - 5, y + 4, x + 5, y + 4); else p.triangle(x, y + 6, x - 5, y - 4, x + 5, y - 4);
        };
        if (show !== 'diff') { mark(ex.argMax, '#ff4d4f', true); mark(ex.argMin, '#4aa3ff', false); }
        // probe
        const [pi, pj] = this.probe;
        const qx = R.x + (pi / NX) * W, qy = R.y + H - (pj / ny) * H;
        p.noFill(); p.stroke(255); p.strokeWeight(2); p.circle(qx, qy, 11);
        p.stroke(0); p.strokeWeight(1); p.circle(qx, qy, 15);
        const k = pi + sx * pj;
        const us = this.series[k], ur = this.relax.v[k];
        this.info = { series: us, relax: ur, extrema: ex, iterations: this.relax.iterations, residual: this.relax.lastChange, probe: [pi, pj] };
        label(p, pal, `u(P) series = ${fmtNum(us)}   relaxation = ${fmtNum(ur)}${this.walker ? `   walkers = ${fmtNum(this.walker.mean)} +/- ${fmtNum(this.walker.stderr)}` : ''}`, r.x + 8, r.y + r.h - 32, { size: 10, color: pal.fg });
        label(p, pal, `maximum principle: boundary max ${fmtNum(ex.boundaryMax)} (red), min ${fmtNum(ex.boundaryMin)} (blue);  interior within (${fmtNum(ex.interiorMin)}, ${fmtNum(ex.interiorMax)})`, r.x + 8, r.y + r.h - 18, { size: 10 });
        colorBar(p, pal, { x: r.x + r.w - 20, y: r.y + 30, w: 8, h: 60 }, lut, lo, hi);
    }

    drawCompare(p, pal, r) {
        const inner = panel(p, pal, r, 'series vs relaxation', { l: 8, t: 20, r: 8, b: 8 });
        const rel = this.relax;
        let md = 0, sum = 0;
        const a = this.series, bb = rel.v;
        for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - bb[i]); md = Math.max(md, d); sum += d * d; }
        const rms = Math.sqrt(sum / a.length);
        this.info.diffMax = md;
        const terms = clamp(Math.round(this.num('l.terms')) || 1, 1, 60);
        const lines = [
            `series: ${terms} terms per side,  u = sum sin(n pi x/a) [A_n sinh(n pi (b-y)/a) + B_n sinh(n pi y/a)] / sinh(n pi b/a) + the same in y`,
            `relaxation: SOR sweeps = ${rel.iterations},  last update = ${rel.lastChange < 1e-3 ? rel.lastChange.toExponential(1) : fmtNum(rel.lastChange)}`,
            `max |series - relaxation| = ${fmtNum(md)},  rms = ${fmtNum(rms)}`,
            'differences concentrate at corners where the data are discontinuous (Gibbs) and shrink with more terms',
            `view: ${this.env.get('l.show')} (series / relaxation / difference in the drawer)`,
        ];
        lines.forEach((t, i) => label(p, pal, t, inner.x, inner.y + 4 + i * 16, { size: 10, color: i === 2 ? pal.fg : pal.muted }));
        // convergence bar of the relaxation
        const frac = clamp(Math.log10(Math.max(1e-12, rel.lastChange)) / -9, 0, 1);
        p.noStroke(); p.fill(pal.grid); p.rect(inner.x, inner.y + 92, inner.w - 4, 8);
        p.fill(rel.lastChange < 1e-9 ? '#2ecc71' : '#ff9f43'); p.rect(inner.x, inner.y + 92, (inner.w - 4) * frac, 8);
        label(p, pal, 'relaxation convergence (update size 1 -> 1e-9)', inner.x, inner.y + 104, { size: 9 });
    }

    drawSlice(p, pal, r) {
        const inner = panel(p, pal, r, 'horizontal slice through the probe and the maximum principle band', { l: 40, t: 20, r: 10, b: 24 });
        const ex = this.info.extrema || fieldExtrema(this.series, NX, this.ny);
        const span = (ex.boundaryMax - ex.boundaryMin) || 1;
        const m = makeMap(inner, 0, 1, ex.boundaryMin - 0.15 * span, ex.boundaryMax + 0.15 * span);
        p.noStroke(); p.fill(pal.dark ? 'rgba(46,204,113,0.12)' : 'rgba(46,204,113,0.18)');
        p.rect(inner.x, m.Y(ex.boundaryMax), inner.w, m.Y(ex.boundaryMin) - m.Y(ex.boundaryMax));
        axes(p, pal, m, { xlabel: 'x / a', ylabel: 'u', yticks: 3 });
        const pj = this.probe[1], sx = NX + 1;
        polyline(p, m, NX + 1, (i) => i / NX, (i) => this.series[i + sx * pj], pal.accent, 2);
        polyline(p, m, NX + 1, (i) => i / NX, (i) => this.relax.v[i + sx * pj], '#4aa3ff', 1.2);
        label(p, pal, `y = ${fmtNum((pj / this.ny) * this.b)}  series (red), relaxation (blue); green band = [boundary min, boundary max]`, inner.x, inner.y + inner.h + 14, { size: 9 });
    }

    drawWalk(p, pal, r) {
        const inner = panel(p, pal, r, 'random walkers: harmonic measure of the boundary seen from P', { l: 40, t: 20, r: 10, b: 38 });
        const w = this.walker;
        if (!w) return;
        const P = w.perimeter;
        const bins = 64;
        const h = new Float64Array(bins);
        for (let i = 0; i < P; i++) h[Math.min(bins - 1, Math.floor((i / P) * bins))] += w.hist[i];
        let mx = 1e-9;
        for (let i = 0; i < bins; i++) { h[i] /= Math.max(1, w.count); mx = Math.max(mx, h[i]); }
        const m = makeMap(inner, 0, 1, 0, mx * 1.15);
        axes(p, pal, m, { xticks: 4, yticks: 3, xlabel: 'perimeter position', ylabel: 'hit fraction' });
        bars(p, m, h, { color: '#4aa3ff' });
        const ex = this.series[this.probe[0] + (NX + 1) * this.probe[1]];
        const sh = w.sideHits;
        label(p, pal, `N = ${w.count} walkers:  u(P) ~ mean boundary value = ${fmtNum(w.mean)} +/- ${fmtNum(w.stderr)}  (series ${fmtNum(ex)}; error ~ 1/sqrt(N))`, r.x + 8, r.y + r.h - 33, { size: 10, color: pal.fg });
        label(p, pal, `hits: bottom ${fmtNum(sh.bottom / Math.max(1, w.count))}, right ${fmtNum(sh.right / Math.max(1, w.count))}, top ${fmtNum(sh.top / Math.max(1, w.count))}, left ${fmtNum(sh.left / Math.max(1, w.count))}   (order along the axis: bottom, right, top, left)`, r.x + 8, r.y + r.h - 19, { size: 9 });
        this.info.walk = { mean: w.mean, stderr: w.stderr, count: w.count };
    }
}

export { fin, dashed };
