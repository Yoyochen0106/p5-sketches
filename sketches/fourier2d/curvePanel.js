// Curve mode: model (DFT of the drawn loop, harmonic selection) and drawing of the epicycles,
// ghost / partial-sum curves, trace and the spectrum bar chart.

import { dftPath, evaluate, epicycleChain, rmsError } from '../../lib/epicycles.js';
import { GAP } from './state.js';

const finite = (...v) => v.every(Number.isFinite);

export class CurveModel {
    constructor() {
        this.key = '';
        this.version = 0; // bumps whenever path / coefficients / selection change
        this.path = [];
        this.coefs = [];
        this.rank = new Map();
        this.overrides = new Map(); // k -> explicit on/off chosen by clicking the spectrum
        this._eff = null;
        this._partial = null;
        this._err = null;
    }

    /** Recompute from the pen when its inputs changed. Returns true when something changed. */
    update(pen, N, smooth, order) {
        const key = `${pen.version}|${N}|${smooth}|${order}`;
        if (key === this.key) return false;
        const sameLoop = this.key.split('|').slice(0, 3).join('|') === key.split('|').slice(0, 3).join('|');
        this.key = key;
        this.path = pen.loop(N, smooth);
        this.coefs = this.path.length ? dftPath(this.path, order) : [];
        this.rank = new Map(this.coefs.map((c, i) => [c.k, i]));
        if (!sameLoop || !this.coefs.length) this.overrides.clear();
        this.version++;
        return true;
    }

    isKept(k, K) {
        if (this.overrides.has(k)) return this.overrides.get(k);
        const r = this.rank.get(k);
        return r !== undefined && r < K;
    }

    /** Click on a spectrum bar: flip that harmonic relative to its current state. */
    toggle(k, K) {
        if (!this.rank.has(k)) return;
        this.overrides.set(k, !this.isKept(k, K));
        this.version++;
    }

    /** Coefficients actually summed (first K in order, adjusted by clicked overrides). */
    effective(K) {
        const key = `${this.version}|${K}`;
        if (!this._eff || this._eff.key !== key) {
            this._eff = { key, list: this.coefs.filter((c) => this.isKept(c.k, K)) };
        }
        return this._eff.list;
    }

    /** RMS distance between the partial sum and the (resampled, smoothed) drawn loop. */
    rms(K) {
        const key = `${this.version}|${K}`;
        if (!this._err || this._err.key !== key) {
            const eff = this.effective(K);
            this._err = { key, value: this.path.length ? rmsError(eff, eff.length, this.path) : 0 };
        }
        return this._err.value;
    }

    /** M samples of the partial-sum curve over one loop. */
    partial(K, M = 512) {
        const key = `${this.version}|${K}|${M}`;
        if (!this._partial || this._partial.key !== key) {
            const eff = this.effective(K);
            const pts = [];
            for (let i = 0; i < M; i++) pts.push(evaluate(eff, eff.length, i / M));
            this._partial = { key, pts };
        }
        return this._partial.pts;
    }
}

/** Layout of the curve view: drawing area, spectrum strip and the unit-to-pixel mapping. */
export function curveLayout(w, h, showSpectrum) {
    const specH = showSpectrum ? Math.min(Math.round(h * 0.3), 200) : 0;
    const main = { x: GAP, y: GAP, w: w - 2 * GAP, h: h - 2 * GAP - (specH ? specH + GAP : 0) };
    const spec = specH ? { x: GAP, y: h - GAP - specH, w: w - 2 * GAP, h: specH } : null;
    const S = Math.max(10, Math.min(main.w, main.h) / 2 * 0.9);
    return { main, spec, cx: main.x + main.w / 2, cy: main.y + main.h / 2, S };
}

export const toScreen = (L, pt) => ({ x: L.cx + pt.x * L.S, y: L.cy + pt.y * L.S });
export const fromScreen = (L, x, y) => ({ x: (x - L.cx) / L.S, y: (y - L.cy) / L.S });
export const inRect = (r, x, y) => !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

function polyline(p, pts, L, close) {
    p.beginShape();
    for (const q of pts) {
        const s = toScreen(L, q);
        if (finite(s.x, s.y)) p.vertex(s.x, s.y);
    }
    p.endShape(close ? p.CLOSE : undefined);
}

function withAlpha(p, hex, a) {
    const c = p.color(hex);
    c.setAlpha(a);
    return c;
}

/** Number of spectrum bars on each side of k = 0. */
export function spectrumWindow(N, range) {
    return Math.max(1, Math.min(N / 2, Math.floor(range)));
}

/** Frequency index k under pixel x in the spectrum strip (null if outside the chart). */
export function spectrumHit(L, N, range, mx, my) {
    if (!L.spec || !inRect(L.spec, mx, my)) return null;
    const W = spectrumWindow(N, range);
    const bw = (L.spec.w - 16) / (2 * W + 1);
    const i = Math.floor((mx - (L.spec.x + 8)) / bw);
    if (i < 0 || i > 2 * W) return null;
    const k = i - W;
    return k < -N / 2 || k >= N / 2 ? null : k;
}

function drawSpectrum(p, sc, L) {
    const { model, pal, K, N, range } = sc;
    const r = L.spec;
    p.noStroke();
    p.fill(pal.panel);
    p.rect(r.x, r.y, r.w, r.h, 4);
    const W = spectrumWindow(N, range);
    const bw = (r.w - 16) / (2 * W + 1);
    const top = r.y + 18, base = r.y + r.h - 16, ph = base - top;
    let max = 1e-12;
    for (const c of model.coefs) if (c.k !== 0 && Math.abs(c.k) <= W && c.amp > max) max = c.amp;
    const byK = new Map(model.coefs.map((c) => [c.k, c]));
    for (let k = -W; k <= W; k++) {
        const c = byK.get(k);
        if (!c) continue;
        const bh = Math.min(ph, (c.amp / max) * ph * 0.95);
        if (!finite(bh)) continue;
        const x = r.x + 8 + (k + W) * bw;
        const kept = model.isKept(k, K);
        const forced = model.overrides.has(k);
        if (kept) { p.noStroke(); p.fill(pal.accent); } else if (forced) { p.noFill(); p.stroke('#ff6b6b'); p.strokeWeight(1); } else { p.noStroke(); p.fill(pal.axis); }
        p.rect(x + 0.5, base - Math.max(1, bh), Math.max(1, bw - 1), Math.max(1, bh));
    }
    p.stroke(pal.axis);
    p.strokeWeight(1);
    p.line(r.x + 8, base + 0.5, r.x + r.w - 8, base + 0.5);
    p.noStroke();
    p.fill(pal.muted);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.text('|c_k| vs k  (click a bar to toggle that harmonic)', r.x + 8, r.y + 4);
    p.textAlign(p.CENTER, p.TOP);
    p.text('0', r.x + 8 + (W + 0.5) * bw, base + 2);
    p.textAlign(p.LEFT, p.TOP);
    p.text(String(-W), r.x + 8, base + 2);
    p.textAlign(p.RIGHT, p.TOP);
    p.text(String(W), r.x + r.w - 8, base + 2);
}

/**
 * Draw the whole curve view. sc = { pen, model, pal, get(key), t, K, N, range, width, height }.
 */
export function drawCurve(p, sc, L) {
    const { pen, model, pal } = sc;
    const get = sc.get;
    p.noStroke();
    p.fill(pal.panel);
    p.rect(L.main.x, L.main.y, L.main.w, L.main.h, 4);

    const drawing = pen.active;
    const have = model.path.length > 0 && !drawing;

    // raw strokes while drawing (and as a hint of what was drawn)
    if (drawing || !have) {
        p.noFill();
        p.stroke(pal.fg);
        p.strokeWeight(2);
        for (const s of pen.strokes) {
            if (s.length < 2) continue;
            polyline(p, s, L, false);
        }
        if (!pen.strokes.length) {
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(14);
            p.textAlign(p.CENTER, p.CENTER);
            p.text('Draw a shape with the mouse (several strokes are joined into one loop) or pick a preset', L.cx, L.cy);
        }
    }

    if (have) {
        const eff = model.effective(sc.K);
        const cnt = eff.length;
        if (get('curve.ghost')) {
            p.noFill();
            p.stroke(withAlpha(p, pal.fg, 70));
            p.strokeWeight(1.5);
            polyline(p, model.path, L, true);
        }
        if (get('curve.partial')) {
            p.noFill();
            p.stroke(withAlpha(p, '#2ecc71', 90));
            p.strokeWeight(1.5);
            polyline(p, model.partial(sc.K), L, true);
        }
        const chain = epicycleChain(eff, cnt, sc.t);
        const circleCol = withAlpha(p, pal.fg, 55);
        const armCol = withAlpha(p, '#ffb347', 200);
        let drawn = 0;
        for (const c of chain) {
            const s = toScreen(L, { x: c.cx, y: c.cy });
            const rr = c.r * L.S;
            if (!finite(s.x, s.y, rr) || rr < 0.6 || drawn > 300) continue;
            drawn++;
            if (get('curve.circles')) {
                p.noFill();
                p.stroke(circleCol);
                p.strokeWeight(1);
                p.ellipse(s.x, s.y, rr * 2, rr * 2);
            }
            if (get('curve.arrows')) {
                p.stroke(armCol);
                p.strokeWeight(1.2);
                p.line(s.x, s.y, s.x + rr * Math.cos(c.angle), s.y + rr * Math.sin(c.angle));
            }
        }
        if (get('curve.trace')) {
            // path traced so far: the partial sum from t = 0 up to the current time
            const steps = Math.max(2, Math.min(600, Math.floor(sc.t * 600)));
            p.noFill();
            p.stroke('#2ecc71');
            p.strokeWeight(2.5);
            p.beginShape();
            for (let i = 0; i <= steps; i++) {
                const q = evaluate(eff, cnt, (sc.t * i) / steps);
                const s = toScreen(L, q);
                if (finite(s.x, s.y)) p.vertex(s.x, s.y);
            }
            p.endShape();
        }
        const tip = toScreen(L, evaluate(eff, cnt, sc.t));
        if (finite(tip.x, tip.y)) {
            p.noStroke();
            p.fill('#2ecc71');
            p.ellipse(tip.x, tip.y, 8, 8);
        }

        const err = model.rms(sc.K);
        p.noStroke();
        p.fill(pal.fg);
        p.textFont('Consolas, ui-monospace, monospace');
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        const orderTxt = get('curve.order') === 'amp' ? 'largest amplitude first' : 'lowest |k| first';
        p.text(`K = ${cnt} of ${sc.N} harmonics (${orderTxt})   RMS error = ${err.toFixed(4)} (${(err * 100).toFixed(2)}% of half-width)`, L.main.x + 10, L.main.y + 8);
    }

    if (L.spec) drawSpectrum(p, sc, L);
}
