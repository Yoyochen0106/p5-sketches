// Shared drawing helpers for the PDE unit: axes, polylines, bars, colour maps, cached images.

import { fmtNum, niceTicks, inRect } from '../impulse/plots.js';

export { fmtNum, niceTicks, inRect };

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// ---------- colour maps ----------

function buildLut(stops) {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
        const t = (i / 255) * (stops.length - 1);
        const k = Math.min(stops.length - 2, Math.floor(t));
        const f = t - k;
        for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
    }
    return lut;
}

/** Sequential (temperature) and diverging (signed) look-up tables, 256 RGB entries each. */
export const LUTS = {
    heat: buildLut([[4, 4, 24], [60, 18, 110], [150, 40, 110], [225, 85, 55], [250, 175, 40], [252, 250, 190]]),
    diverging: buildLut([[40, 70, 190], [110, 150, 235], [235, 235, 235], [235, 140, 110], [185, 30, 40]]),
};

/** Index 0..255 of value v in [lo, hi]. */
export function lutIndex(v, lo, hi) {
    if (!Number.isFinite(v) || !(hi > lo)) return 0;
    return clamp(Math.round(((v - lo) / (hi - lo)) * 255), 0, 255);
}

// ---------- coordinate maps ----------

/** Linear data -> pixel maps for an inner rect and a data window. */
export function makeMap(r, x0, x1, y0, y1) {
    const sx = (x1 - x0) || 1, sy = (y1 - y0) || 1;
    return {
        r, x0, x1, y0, y1,
        X: (x) => r.x + ((x - x0) / sx) * r.w,
        Y: (y) => r.y + r.h - ((y - y0) / sy) * r.h,
        invX: (px) => x0 + ((px - r.x) / r.w) * sx,
        invY: (py) => y0 + ((r.y + r.h - py) / r.h) * sy,
    };
}

// ---------- primitives ----------

export function label(p, pal, str, x, y, { size = 11, color = null, align = 'left', valign = 'top' } = {}) {
    p.noStroke();
    p.fill(color || pal.muted);
    p.textSize(size);
    p.textAlign(align === 'right' ? p.RIGHT : align === 'center' ? p.CENTER : p.LEFT, valign === 'bottom' ? p.BOTTOM : valign === 'middle' ? p.CENTER : p.TOP);
    p.text(String(str), x, y);
}

/** Panel background, border and title. Returns the inner plotting rect. */
export function panel(p, pal, r, title, pad = { l: 40, t: 20, r: 10, b: 24 }) {
    p.noStroke();
    p.fill(pal.panel);
    p.rect(r.x, r.y, r.w, r.h, 4);
    p.noFill();
    p.stroke(pal.border);
    p.strokeWeight(1);
    p.rect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 4);
    if (title) label(p, pal, title, r.x + 8, r.y + 5, { size: 11, color: pal.fg });
    return { x: r.x + pad.l, y: r.y + pad.t, w: Math.max(10, r.w - pad.l - pad.r), h: Math.max(10, r.h - pad.t - pad.b) };
}

/** Axes box with ticks (about 4 per axis) and axis labels. */
export function axes(p, pal, m, { xlabel = '', ylabel = '', xticks = 4, yticks = 4, grid = true, fmtX = fmtNum, fmtY = fmtNum, noY = false } = {}) {
    const r = m.r;
    const xt = niceTicks(m.x0, m.x1, xticks);
    const yt = noY ? [] : niceTicks(m.y0, m.y1, yticks);
    p.strokeWeight(1);
    if (grid) {
        p.stroke(pal.grid);
        for (const v of xt) p.line(m.X(v), r.y, m.X(v), r.y + r.h);
        for (const v of yt) p.line(r.x, m.Y(v), r.x + r.w, m.Y(v));
    }
    if (m.y0 < 0 && m.y1 > 0) { p.stroke(pal.axis); p.line(r.x, m.Y(0), r.x + r.w, m.Y(0)); }
    p.noFill();
    p.stroke(pal.axis);
    p.rect(r.x, r.y, r.w, r.h);
    for (const v of xt) label(p, pal, fmtX(v), m.X(v), r.y + r.h + 3, { size: 10, align: 'center' });
    for (const v of yt) label(p, pal, fmtY(v), r.x - 4, m.Y(v), { size: 10, align: 'right', valign: 'middle' });
    if (xlabel) label(p, pal, xlabel, r.x + r.w, r.y + r.h + 14, { size: 10, align: 'right' });
    if (ylabel) label(p, pal, ylabel, r.x - 36, r.y - 14, { size: 10 });
}

/** Polyline through (xs(i), ys(i)), i = 0..n-1; y pixels are clamped so blow-ups stay near the panel. */
export function polyline(p, m, n, xs, ys, color, weight = 1.6) {
    if (n < 2) return;
    const r = m.r;
    const lo = r.y - 30, hi = r.y + r.h + 30;
    p.noFill();
    p.stroke(color);
    p.strokeWeight(weight);
    p.beginShape();
    for (let i = 0; i < n; i++) {
        const y = fin(ys(i), 0);
        p.vertex(m.X(xs(i)), clamp(m.Y(y), lo, hi));
    }
    p.endShape();
}

export function dashed(p, x0, y0, x1, y1, color, dash = 5, gap = 4, weight = 1) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!(len > 0)) return;
    p.stroke(color);
    p.strokeWeight(weight);
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let s = 0; s < len; s += dash + gap) {
        const e = Math.min(len, s + dash);
        p.line(x0 + ux * s, y0 + uy * s, x0 + ux * e, y0 + uy * e);
    }
}

/** Vertical bars of values vs index (signed about the zero line). */
export function bars(p, m, values, { color, ghost = null, ghostColor = null, dim = -1, dimColor = null, width = 0.7 } = {}) {
    const n = values.length;
    const bw = (m.r.w / n) * width;
    p.noStroke();
    for (let i = 0; i < n; i++) {
        const cx = m.r.x + ((i + 0.5) / n) * m.r.w;
        const v = fin(values[i]);
        const y0 = m.Y(0), y1 = clamp(m.Y(v), m.r.y, m.r.y + m.r.h);
        p.fill(dim >= 0 && i >= dim && dimColor ? dimColor : color);
        p.rect(cx - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
        if (ghost) {
            const g = clamp(m.Y(fin(ghost[i])), m.r.y, m.r.y + m.r.h);
            p.stroke(ghostColor || color);
            p.strokeWeight(1);
            p.line(cx - bw / 2 - 1, g, cx + bw / 2 + 1, g);
            p.noStroke();
        }
    }
}

// ---------- images ----------

/** One reusable p5.Image per name, refilled only when the key changes. */
export class ImageCache {
    constructor() { this.map = new Map(); }

    /** fill(pixels, w, h) writes RGBA bytes. Returns the image. */
    get(p, name, key, w, h, fill) {
        let e = this.map.get(name);
        if (!e || e.img.width !== w || e.img.height !== h) {
            e = { img: p.createImage(w, h), key: null };
            this.map.set(name, e);
        }
        if (e.key !== key) {
            e.img.loadPixels();
            fill(e.img.pixels, w, h);
            e.img.updatePixels();
            e.key = key;
        }
        return e.img;
    }

    invalidate(name) { const e = this.map.get(name); if (e) e.key = null; }
    clear() { this.map.clear(); }
}

/** Colour-map a scalar grid (row-major, row 0 at the top) into RGBA pixels. */
export function paintScalar(px, w, h, value, lut, lo, hi) {
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const k = lutIndex(value(i, j), lo, hi) * 3;
            const o = (i + w * j) * 4;
            px[o] = lut[k]; px[o + 1] = lut[k + 1]; px[o + 2] = lut[k + 2]; px[o + 3] = 255;
        }
    }
}

/** Draws a colour bar legend (vertical) at rect r. */
export function colorBar(p, pal, r, lut, lo, hi, unit = '') {
    for (let j = 0; j < r.h; j++) {
        const k = lutIndex(hi - ((hi - lo) * j) / Math.max(1, r.h - 1), lo, hi) * 3;
        p.stroke(lut[k], lut[k + 1], lut[k + 2]);
        p.line(r.x, r.y + j, r.x + r.w, r.y + j);
    }
    label(p, pal, fmtNum(hi) + unit, r.x + r.w + 3, r.y, { size: 9 });
    label(p, pal, fmtNum(lo) + unit, r.x + r.w + 3, r.y + r.h, { size: 9, valign: 'bottom' });
}

/** Splits a rect into a grid of cols x rows with a gap. */
export function splitRect(r, cols, rows, gap = 6) {
    const w = (r.w - gap * (cols - 1)) / cols, h = (r.h - gap * (rows - 1)) / rows;
    const out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) out.push({ x: r.x + i * (w + gap), y: r.y + j * (h + gap), w, h });
    return out;
}
