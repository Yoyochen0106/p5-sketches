// Layout, hit-testing and drawing of the 3 x 2 plot grid (rows x, y, h; time | frequency).
// Polylines are cached per plot and rebuilt only when their inputs (data version, rect, view,
// ranges, display options) change.

import { toDb } from '../../lib/deconv.js';

export const SIG_COLORS = { x: '#4aa3ff', y: '#ff9f43', h: '#2ecc71' };
const OVERLAY = { truth: '#ffd166', recon: '#e8e8e8', resid: '#ff4d4f', delay: '#c77dff' };
const TITLES = { x: 'x(t)  input', y: 'y(t)  output', h: 'h(t)  impulse response' };
const SIGS = ['x', 'y', 'h'];

// ---------- formatting & ticks ----------

/** 3 significant digits without trailing zeros. */
export function fmtNum(v) {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
    return String(Number(v.toPrecision(3)));
}

/** Value with an SI prefix and unit, e.g. fmtSI(0.0125, 's') = "12.5 ms". */
export function fmtSI(v, unit) {
    if (!Number.isFinite(v)) return '-';
    if (v === 0) return `0 ${unit}`;
    const a = Math.abs(v);
    const table = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n']];
    for (const [f, pre] of table) if (a >= f * 0.9995) return `${fmtNum(v / f)} ${pre}${unit}`;
    return `${v.toExponential(1)} ${unit}`;
}

/** "Nice" tick positions covering [lo, hi] (about `count` of them, inside the interval). */
export function niceTicks(lo, hi, count = 4) {
    if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    const raw = (hi - lo) / Math.max(1, count);
    const e = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / e;
    const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
}

// ---------- layout ----------

const inset = (r, l, t, rr, b) => ({ x: r.x + l, y: r.y + t, w: Math.max(1, r.w - l - rr), h: Math.max(1, r.h - t - b) });
export const inRect = (r, x, y) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/**
 * Plot rectangles for a canvas of W x H. Each signal gets { time, mag, ph } (outer rects, `.in`
 * holds the inner plotting area). Wide: 2 columns; narrow: everything stacked without scrolling.
 */
export function gridLayout(W, H) {
    const pad = 6, top = 20, narrow = W < 640 || W < H * 0.9;
    const gl = narrow ? 34 : 46;
    const out = { narrow, top, plots: {}, W, H };
    const areaH = Math.max(60, H - top - pad);
    const rowH = areaH / 3;
    SIGS.forEach((s, r) => {
        const y0 = top + r * rowH;
        let time, mag, ph;
        if (!narrow) {
            const colW = (W - 3 * pad) / 2;
            const cellH = rowH - pad;
            time = { x: pad, y: y0, w: colW, h: cellH };
            const fx = 2 * pad + colW;
            mag = { x: fx, y: y0, w: colW, h: cellH * 0.6 };
            ph = { x: fx, y: y0 + cellH * 0.6, w: colW, h: cellH * 0.4 };
        } else {
            const cellH = rowH - pad;
            const w = W - 2 * pad;
            time = { x: pad, y: y0, w, h: cellH * 0.4 };
            mag = { x: pad, y: y0 + cellH * 0.4, w: w * 0.5, h: cellH * 0.6 };
            ph = { x: pad + w * 0.5, y: y0 + cellH * 0.4, w: w * 0.5, h: cellH * 0.6 };
        }
        const gt = 13, gb = narrow ? 11 : 13, gr = 5;
        time.in = inset(time, gl, gt, gr, gb);
        mag.in = inset(mag, gl, gt, gr, narrow ? gb : 2);
        ph.in = inset(ph, narrow ? gl : gl, narrow ? gt : 2, narrow ? 24 : 40, gb);
        out.plots[s] = { time, mag, ph };
    });
    return out;
}

/** Which plot is under (x, y)? -> { sig, kind: 'time' | 'mag' | 'ph' } or null. */
export function hitPlot(layout, x, y) {
    for (const s of SIGS) {
        for (const kind of ['time', 'mag', 'ph']) {
            if (inRect(layout.plots[s][kind], x, y)) return { sig: s, kind };
        }
    }
    return null;
}

// ---------- ranges ----------

/** Magnitude axis range for a signal: { lo, hi, db }. */
export function magRange(mag, dbMode, dbRange) {
    let top = 0;
    for (let k = 0; k < mag.length; k++) if (mag[k] > top) top = mag[k];
    if (!dbMode) return { lo: 0, hi: top > 0 ? top * 1.08 : 1, db: false };
    const topDb = top > 0 ? Math.ceil((20 * Math.log10(top)) / 10) * 10 : 0;
    return { lo: topDb - dbRange, hi: topDb, db: true };
}

function finiteRange(a, padFrac = 0.08, minSpan = 1e-9) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i])) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
    if (!Number.isFinite(lo)) return { lo: -1, hi: 1 };
    const span = Math.max(hi - lo, minSpan);
    const mid = (hi + lo) / 2;
    return { lo: mid - span * (0.5 + padFrac), hi: mid + span * (0.5 + padFrac) };
}

// ---------- drawing primitives ----------

function clipped(p, r, fn) {
    p.push();
    const c = p.drawingContext;
    c.beginPath();
    c.rect(r.x, r.y, r.w, r.h);
    c.clip();
    fn();
    p.pop();
}

const clampPx = (v) => Math.max(-1e5, Math.min(1e5, v));

/** Draw runs of a flat [x0, y0, x1, y1, ...] array; NaN y values break the line. */
function strokeRuns(p, pts) {
    let open = false;
    for (let i = 0; i < pts.length; i += 2) {
        const y = pts[i + 1];
        if (!Number.isFinite(y)) {
            if (open) { p.endShape(); open = false; }
            continue;
        }
        if (!open) { p.beginShape(); open = true; }
        p.vertex(pts[i], y);
    }
    if (open) p.endShape();
}

function dashed(p, on) {
    const c = p.drawingContext;
    if (c && typeof c.setLineDash === 'function') c.setLineDash(on ? [5, 4] : []);
}

function label(p, pal, str, x, y, align = 'left', color = null) {
    p.noStroke();
    p.fill(color || pal.muted);
    p.textAlign(align === 'right' ? p.RIGHT : align === 'center' ? p.CENTER : p.LEFT, p.TOP);
    p.text(str, x, y);
}

// ---------- the renderer ----------

/**
 * Plot cache + drawing. `S` (state) fields: p, pal, model, layout, view {a, b} (sample indices),
 * fs, active, hover {idx} | null, opts { magDb, dbRange, phase 'wrapped'|'unwrapped', groupDelay,
 * recon (bool), brush {radiusIdx} | null }.
 */
export class PlotRenderer {
    constructor() {
        this.cache = new Map();
        this.ranges = {}; // sig -> magnitude range, for hit-testing / painting
        this.stats = { builds: 0 };
    }

    memo(id, key, build) {
        const c = this.cache.get(id);
        if (c && c.key === key) return c.val;
        const val = build();
        this.stats.builds++;
        this.cache.set(id, { key, val });
        return val;
    }

    drawAll(S) {
        const { p, pal, layout } = S;
        for (const s of SIGS) {
            this.drawTime(S, s);
            this.drawMag(S, s);
            this.drawPhase(S, s);
        }
        this.drawHeader(S);
        void p; void pal; void layout;
    }

    drawHeader(S) {
        const { p, pal, model, opts } = S;
        const m = model.metrics;
        const parts = [
            `N=${model.n}`,
            `fs=${fmtSI(S.fs, 'Hz')}`,
            `derived: ${opts.derived}`,
            `${opts.methodLabel}  lambda=1e${opts.lambdaLog}`,
            `residual ${(m.residual * 100).toFixed(m.residual < 0.001 ? 4 : 2)}%`,
            `min|X| ${fmtNum(m.condMin)}  cond ${Number.isFinite(m.condRatio) ? fmtNum(m.condRatio) : 'inf'}`,
        ];
        p.textSize(11);
        label(p, pal, parts.join('   '), 8, 4);
    }

    frame(S, r, sig, kind) {
        const { p, pal } = S;
        const act = S.active === sig && kind === 'time';
        p.noFill();
        p.stroke(act ? SIG_COLORS[sig] : pal.border);
        p.strokeWeight(act ? 1.5 : 1);
        p.rect(r.in.x, r.in.y, r.in.w, r.in.h);
    }

    // ----- time domain -----
    drawTime(S, sig) {
        const { p, pal, model, layout, view, fs } = S;
        const R = layout.plots[sig].time, I = R.in;
        const a = view.a, b = view.b;
        const scale = model.scale[sig];
        const xOf = (i) => I.x + ((i - a) / (b - a)) * I.w;
        const yOf = (v) => I.y + I.h / 2 - (v / scale) * (I.h / 2);
        p.textSize(10);
        this.frame(S, R, sig, 'time');
        // grid + labels
        p.stroke(pal.grid); p.strokeWeight(1);
        p.line(I.x, yOf(0), I.x + I.w, yOf(0));
        const dt = 1 / fs;
        const ticks = niceTicks(a * dt, b * dt, S.layout.narrow ? 3 : 5);
        for (const t of ticks) {
            const x = xOf(t / dt);
            p.stroke(pal.grid);
            p.line(x, I.y, x, I.y + I.h);
            label(p, pal, fmtSI(t, 's'), x, I.y + I.h + 1, 'center');
        }
        label(p, pal, fmtNum(scale), I.x - 3, I.y, 'right');
        label(p, pal, fmtNum(-scale), I.x - 3, I.y + I.h - 9, 'right');
        label(p, pal, '0', I.x - 3, yOf(0) - 4, 'right');
        label(p, pal, TITLES[sig], I.x + 2, R.y + 1, 'left', SIG_COLORS[sig]);

        const ver = model.ver[sig];
        const geo = `${I.x}|${I.y}|${I.w}|${I.h}|${a}|${b}|${scale}`;
        const line = this.memo(`t:${sig}`, `${ver}|${geo}`, () => this.seriesPoints(model[sig], a, b, xOf, yOf));
        clipped(p, I, () => {
            p.noFill();
            if (S.opts.truthOverlay && sig === 'h' && model.truth) {
                p.stroke(OVERLAY.truth); p.strokeWeight(1.2); dashed(p, true);
                const t = this.memo('t:truth', `${model.truthVer}|${geo}`, () => this.seriesPoints(model.truth, a, b, xOf, yOf));
                strokeRuns(p, t);
                dashed(p, false);
            }
            if (sig === 'y' && S.opts.recon && S.opts.derived !== 'y') {
                const rk = `${model.ver.x}|${model.ver.h}|${model.ver.y}|${geo}`;
                const rec = this.memo('t:recon', rk, () => this.seriesPoints(model.recon, a, b, xOf, yOf));
                const res = this.memo('t:resid', rk, () => {
                    const d = new Float64Array(model.n);
                    for (let i = 0; i < d.length; i++) d[i] = model.y[i] - model.recon[i];
                    return this.seriesPoints(d, a, b, xOf, yOf);
                });
                p.stroke(OVERLAY.resid); p.strokeWeight(1);
                strokeRuns(p, res);
                p.stroke(OVERLAY.recon); p.strokeWeight(1.2); dashed(p, true);
                strokeRuns(p, rec);
                dashed(p, false);
            }
            p.stroke(SIG_COLORS[sig]); p.strokeWeight(1.8);
            strokeRuns(p, line);
            const sp = I.w / Math.max(1, b - a);
            if (sp > 6) {
                p.noStroke(); p.fill(SIG_COLORS[sig]);
                for (let i = Math.max(0, Math.ceil(a)); i <= Math.min(model.n - 1, Math.floor(b)); i++) p.circle(xOf(i), clampPx(yOf(model[sig][i])), 4);
            }
            this.drawCrosshair(S, sig, 'time', xOf, yOf);
            this.drawBrush(S, sig, xOf, I);
        });
    }

    seriesPoints(arr, a, b, xOf, yOf) {
        const out = [];
        const i0 = Math.max(0, Math.floor(a) - 1), i1 = Math.min(arr.length - 1, Math.ceil(b) + 1);
        for (let i = i0; i <= i1; i++) out.push(xOf(i), Number.isFinite(arr[i]) ? clampPx(yOf(arr[i])) : NaN);
        return out;
    }

    drawBrush(S, sig, xOf, I) {
        const br = S.opts.brush;
        if (!br || !S.hover || S.hover.sig !== sig) return;
        const { p, pal } = S;
        const x0 = xOf(S.hover.idx - br.radiusIdx), x1 = xOf(S.hover.idx + br.radiusIdx);
        p.stroke(pal.fg); p.strokeWeight(1); p.noFill();
        p.line(x0, I.y, x0, I.y + I.h);
        p.line(x1, I.y, x1, I.y + I.h);
    }

    drawCrosshair(S, sig, kind, xOf, yOf) {
        const h = S.hover;
        if (!h) return;
        const { p, pal, model } = S;
        const R = S.layout.plots[sig][kind], I = R.in;
        const idx = h.idx;
        const x = xOf(idx);
        if (!Number.isFinite(x)) return;
        p.stroke(pal.fg); p.strokeWeight(1); dashed(p, true);
        p.line(x, I.y, x, I.y + I.h);
        dashed(p, false);
        if (kind === 'time' && idx >= 0 && idx < model.n) {
            const v = model[sig][idx];
            const y = clampPx(yOf(v));
            p.noStroke(); p.fill(SIG_COLORS[sig]);
            p.circle(x, y, 6);
            p.textSize(10);
            label(p, pal, `i=${idx}  t=${fmtSI(idx / S.fs, 's')}  ${fmtNum(v)}`, I.x + I.w - 3, I.y + 2, 'right', pal.fg);
        }
    }

    // ----- frequency domain: magnitude -----
    drawMag(S, sig) {
        const { p, pal, model, layout, fs } = S;
        const R = layout.plots[sig].mag, I = R.in;
        const N = model.n;
        const spec = model.spectrum(sig);
        const rng = magRange(spec.mag, S.opts.magDb, S.opts.dbRange);
        this.ranges[sig] = rng;
        const xOf = (k) => I.x + (k / N) * I.w;
        const yOf = (v) => I.y + I.h - ((v - rng.lo) / (rng.hi - rng.lo)) * I.h;
        p.textSize(10);
        this.frame(S, R, sig, 'mag');
        const df = fs / (2 * N);
        const fticks = niceTicks(0, (N * df), layout.narrow ? 2 : 4);
        for (const f of fticks) {
            const x = xOf(f / df);
            p.stroke(pal.grid); p.strokeWeight(1);
            p.line(x, I.y, x, I.y + I.h);
            label(p, pal, fmtSI(f, 'Hz'), x, I.y + I.h + 1, 'center');
        }
        for (const v of niceTicks(rng.lo, rng.hi, 3)) {
            const y = yOf(v);
            p.stroke(pal.grid); p.strokeWeight(1);
            p.line(I.x, y, I.x + I.w, y);
            label(p, pal, rng.db ? `${fmtNum(v)}` : fmtNum(v), I.x - 3, y - 5, 'right');
        }
        label(p, pal, `|${sig === 'h' ? 'H' : sig.toUpperCase()}(f)|${rng.db ? ' dB' : ''}`, I.x + 2, R.y + 1, 'left', SIG_COLORS[sig]);
        const geo = `${I.x}|${I.y}|${I.w}|${I.h}|${rng.lo}|${rng.hi}|${S.opts.magDb}`;
        const line = this.memo(`m:${sig}`, `${model.ver[sig]}|${model.n}|${geo}`, () => {
            const src = rng.db ? toDb(spec.mag, rng.lo - 20) : spec.mag;
            const out = [];
            for (let k = 0; k < src.length; k++) out.push(xOf(k), clampPx(yOf(src[k])));
            return out;
        });
        clipped(p, I, () => {
            p.noFill();
            if (S.opts.truthOverlay && sig === 'h' && model.truth) {
                const ts = model.truthSpectrum();
                const tl = this.memo('m:truth', `${model.truthVer}|${geo}`, () => {
                    const src = rng.db ? toDb(ts.mag, rng.lo - 20) : ts.mag;
                    const out = [];
                    for (let k = 0; k < src.length; k++) out.push(xOf(k), clampPx(yOf(src[k])));
                    return out;
                });
                p.stroke(OVERLAY.truth); p.strokeWeight(1.2); dashed(p, true);
                strokeRuns(p, tl);
                dashed(p, false);
            }
            p.stroke(SIG_COLORS[sig]); p.strokeWeight(1.6);
            strokeRuns(p, line);
            this.drawCrosshair(S, sig, 'mag', xOf, yOf);
            if (S.hover && S.hover.sig === sig && S.hover.kind === 'mag') {
                const k = Math.max(0, Math.min(N, S.hover.idx));
                const v = spec.mag[k];
                label(p, pal, `f=${fmtSI(k * df, 'Hz')}  ${rng.db ? `${fmtNum(20 * Math.log10(Math.max(v, 1e-12)))} dB` : fmtNum(v)}`, I.x + I.w - 3, I.y + 2, 'right', pal.fg);
            }
        });
    }

    // ----- frequency domain: phase / group delay -----
    drawPhase(S, sig) {
        const { p, pal, model, layout, fs } = S;
        const R = layout.plots[sig].ph, I = R.in;
        const N = model.n;
        const spec = model.spectrum(sig);
        const unwrapped = S.opts.phase === 'unwrapped';
        const data = unwrapped ? spec.unwrapped : spec.phase;
        const rng = unwrapped ? finiteRange(data) : { lo: -Math.PI, hi: Math.PI };
        const xOf = (k) => I.x + (k / N) * I.w;
        const yOf = (v) => I.y + I.h - ((v - rng.lo) / (rng.hi - rng.lo)) * I.h;
        p.textSize(10);
        this.frame(S, R, sig, 'ph');
        const ticks = unwrapped ? niceTicks(rng.lo, rng.hi, 3) : [-Math.PI, 0, Math.PI];
        for (const v of ticks) {
            const y = yOf(v);
            p.stroke(pal.grid); p.strokeWeight(1);
            p.line(I.x, y, I.x + I.w, y);
            label(p, pal, unwrapped ? `${fmtNum(v)}` : (v === 0 ? '0' : v > 0 ? 'pi' : '-pi'), I.x - 3, y - 5, 'right');
        }
        label(p, pal, unwrapped ? 'phase (unwrapped, rad)' : 'phase (wrapped)', I.x + 2, R.y + 1, 'left', SIG_COLORS[sig]);
        const geo = `${I.x}|${I.y}|${I.w}|${I.h}|${rng.lo}|${rng.hi}|${unwrapped}`;
        const line = this.memo(`p:${sig}`, `${model.ver[sig]}|${model.n}|${geo}`, () => {
            const out = [];
            for (let k = 0; k < data.length; k++) out.push(xOf(k), Number.isFinite(data[k]) ? clampPx(yOf(data[k])) : NaN);
            return out;
        });
        let gd = null, grng = null;
        if (S.opts.groupDelay) {
            grng = finiteRange(spec.delay, 0.1, 1e-6);
            const gy = (v) => I.y + I.h - ((v - grng.lo) / (grng.hi - grng.lo)) * I.h;
            gd = this.memo(`g:${sig}`, `${model.ver[sig]}|${model.n}|${I.x}|${I.y}|${I.w}|${I.h}|${grng.lo}|${grng.hi}`, () => {
                const out = [];
                for (let k = 0; k < spec.delay.length; k++) out.push(xOf(k), Number.isFinite(spec.delay[k]) ? clampPx(gy(spec.delay[k])) : NaN);
                return out;
            });
            label(p, pal, fmtSI(grng.hi / fs, 's'), I.x + I.w + 2, I.y, 'left', OVERLAY.delay);
            label(p, pal, fmtSI(grng.lo / fs, 's'), I.x + I.w + 2, I.y + I.h - 9, 'left', OVERLAY.delay);
            label(p, pal, 'group delay', I.x + I.w - 3, R.y + 1, 'right', OVERLAY.delay);
        }
        clipped(p, I, () => {
            p.noFill();
            p.stroke(SIG_COLORS[sig]); p.strokeWeight(1.4);
            strokeRuns(p, line);
            if (gd) { p.stroke(OVERLAY.delay); p.strokeWeight(1.2); strokeRuns(p, gd); }
            this.drawCrosshair(S, sig, 'ph', xOf, yOf);
        });
    }
}

/** Sample index <-> screen helpers for the time plots (shared view). */
export function timeIndexAt(I, view, px) {
    return view.a + ((px - I.x) / I.w) * (view.b - view.a);
}

export function timeValueAt(I, scale, py) {
    return ((I.y + I.h / 2 - py) / (I.h / 2)) * scale;
}

/** Frequency-bin index (0..N on the 2N-point grid) at pixel px. */
export function binAt(I, N, px) {
    return ((px - I.x) / I.w) * N;
}

/** Magnitude value (linear) at pixel py for a magnitude range. */
export function magValueAt(I, rng, py) {
    const v = rng.lo + ((I.y + I.h - py) / I.h) * (rng.hi - rng.lo);
    return rng.db ? Math.pow(10, v / 20) : Math.max(0, v);
}
