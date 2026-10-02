// Small drawing helpers shared by the three tabs of the elliptic-curve sketch.

import { niceTicks, fmtTick } from '../approx/view.js';

export const okPx = (v) => Number.isFinite(v) && Math.abs(v) < 1e6;

const COLORS = {
    dark: {
        curve: '#4aa3ff', P: '#ff9f43', Q: '#2ecc71', R: '#ff4d6d', third: '#c77dff',
        line: '#f1c40f', trail: '#ff5fa2', torsion: '#9fb4ff', wrap: '#6ad1c9',
    },
    light: {
        curve: '#1565c0', P: '#d9730d', Q: '#1b8a4b', R: '#d6004a', third: '#7b1fa2',
        line: '#b58900', trail: '#c2185b', torsion: '#3f51b5', wrap: '#00897b',
    },
};

/** Named colours for the current theme. */
export const colorsFor = (dark) => COLORS[dark ? 'dark' : 'light'];

/** A p5 colour with the given alpha (0-255). */
export function withAlpha(p, col, a) {
    const c = p.color(col);
    c.setAlpha(a);
    return c;
}

/** Linear mix of two #rrggbb colours, as #rrggbb. */
export function mixHex(a, b, t) {
    const pa = parseHex(a), pb = parseHex(b);
    const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
    return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(h) {
    const s = String(h).replace('#', '');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) || 0);
}

/** Run fn with a dash pattern (if the canvas supports it). */
export function dashed(p, pattern, fn) {
    p.push();
    if (p.drawingContext && p.drawingContext.setLineDash) p.drawingContext.setLineDash(pattern);
    fn();
    p.pop();
}

/** Run fn clipped to a screen rectangle (uses push/pop so p5's cached style stays in sync). */
export function clipped(p, r, fn) {
    p.push();
    const c = p.drawingContext;
    if (c && c.beginPath && c.rect && c.clip) {
        c.beginPath();
        c.rect(r.x, r.y, r.w, r.h);
        c.clip();
    }
    fn();
    p.pop();
}

/** Clip y = m x + c (or x = const) to the view rectangle. Returns [[x1, y1], [x2, y2]] in world units or null. */
export function clipWorldLine(view, line) {
    const ylo = Math.min(view.ymin, view.ymax), yhi = Math.max(view.ymin, view.ymax);
    if (!line) return null;
    if (line.type === 'vertical') {
        if (!(line.x >= view.xmin && line.x <= view.xmax)) return null;
        return [[line.x, ylo], [line.x, yhi]];
    }
    const { m, c } = line;
    if (!Number.isFinite(m) || !Number.isFinite(c)) return null;
    let lo = view.xmin, hi = view.xmax;
    if (Math.abs(m) < 1e-12) {
        if (c < ylo || c > yhi) return null;
    } else {
        const xa = (ylo - c) / m, xb = (yhi - c) / m;
        lo = Math.max(lo, Math.min(xa, xb));
        hi = Math.min(hi, Math.max(xa, xb));
    }
    if (!(lo < hi)) return null;
    return [[lo, m * lo + c], [hi, m * hi + c]];
}

/**
 * Draw a world-space line, growing from `from` (world point on the line) to full length as t goes 0 -> 1.
 * Returns true if something was drawn.
 */
export function drawWorldLine(p, view, line, t = 1, from = null) {
    const seg = clipWorldLine(view, line);
    if (!seg || t <= 0) return false;
    let [a, b] = seg;
    if (t < 1) {
        const c = from || [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        a = [c[0] + (a[0] - c[0]) * t, c[1] + (a[1] - c[1]) * t];
        b = [c[0] + (b[0] - c[0]) * t, c[1] + (b[1] - c[1]) * t];
    }
    const x1 = view.toX(a[0]), y1 = view.toY(a[1]), x2 = view.toX(b[0]), y2 = view.toY(b[1]);
    if (![x1, y1, x2, y2].every(okPx)) return false;
    p.line(x1, y1, x2, y2);
    return true;
}

/** Straight arrow with a small head. */
export function arrow(p, x1, y1, x2, y2, head = 8) {
    if (![x1, y1, x2, y2].every(okPx)) return;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len, uy = dy / len;
    const h = Math.min(head, len * 0.6);
    p.line(x1, y1, x2, y2);
    p.line(x2, y2, x2 - ux * h - uy * h * 0.5, y2 - uy * h + ux * h * 0.5);
    p.line(x2, y2, x2 - ux * h + uy * h * 0.5, y2 - uy * h - ux * h * 0.5);
}

/** Text label with a colour; (x, y) is the top-left corner. */
export function label(p, str, x, y, col, size = 12) {
    if (!okPx(x) || !okPx(y)) return;
    p.noStroke();
    p.fill(col);
    p.textSize(size);
    p.textAlign(p.LEFT, p.TOP);
    p.text(str, x, y);
}

/** A dot with optional ring; styles are set here. */
export function dot(p, x, y, d, fill, ring = null, ringW = 2) {
    if (!okPx(x) || !okPx(y)) return;
    if (ring) { p.stroke(ring); p.strokeWeight(ringW); } else p.noStroke();
    if (fill) p.fill(fill); else p.noFill();
    p.circle(x, y, d);
}

/** Grid, axes and tick labels for a Viewport. */
export function drawGridAxes(p, view, pal, { labels = true } = {}) {
    const r = view.rect;
    p.strokeWeight(1);
    p.stroke(pal.grid);
    const xt = niceTicks(view.xmin, view.xmax, 10), yt = niceTicks(view.ymin, view.ymax, 8);
    for (const x of xt) if (x !== 0) p.line(view.toX(x), r.y, view.toX(x), r.y + r.h);
    for (const y of yt) if (y !== 0) p.line(r.x, view.toY(y), r.x + r.w, view.toY(y));
    p.stroke(pal.axis);
    if (0 >= view.xmin && 0 <= view.xmax) p.line(view.toX(0), r.y, view.toX(0), r.y + r.h);
    if (0 >= view.ymin && 0 <= view.ymax) p.line(r.x, view.toY(0), r.x + r.w, view.toY(0));
    if (!labels) return;
    p.noStroke();
    p.fill(pal.muted);
    p.textSize(10);
    p.textAlign(p.CENTER, p.TOP);
    const ay = Math.min(Math.max(view.toY(0), r.y + 2), r.y + r.h - 14);
    for (const x of xt) if (x !== 0) p.text(fmtTick(x), view.toX(x), ay + 3);
    p.textAlign(p.LEFT, p.CENTER);
    const ax = Math.min(Math.max(view.toX(0), r.x + 2), r.x + r.w - 30);
    for (const y of yt) if (y !== 0) p.text(fmtTick(y), ax + 4, view.toY(y));
}

/** Draw polylines (from lib samplePolylines) through a Viewport, breaking runs at off-screen/invalid vertices. */
export function drawPolylines(p, view, lines, dotColor = '#ffffff') {
    p.noFill();
    for (const L of lines) {
        if (L.isolated) {
            const [x, y] = L.pts[0];
            const sx = view.toX(x), sy = view.toY(y);
            if (okPx(sx) && okPx(sy)) { p.push(); p.fill(dotColor); p.noStroke(); p.circle(sx, sy, 7); p.pop(); }
            continue;
        }
        let run = [];
        const flush = (close) => {
            if (run.length > 1) {
                p.beginShape();
                for (const [sx, sy] of run) p.vertex(sx, sy);
                p.endShape(close ? p.CLOSE : undefined);
            }
            run = [];
        };
        let allOk = true;
        for (const [x, y] of L.pts) {
            const sx = view.toX(x), sy = view.toY(y);
            if (okPx(sx) && okPx(sy)) run.push([sx, sy]);
            else { allOk = false; flush(false); }
        }
        flush(L.closed && allOk);
    }
}

/** Word-wrapped text block. */
export function paragraph(p, str, x, y, w, h, col, size = 12) {
    p.noStroke();
    p.fill(col);
    p.textSize(size);
    p.textAlign(p.LEFT, p.TOP);
    p.text(str, x, y, w, h);
}

/** Format a number compactly. */
export function num(v, d = 3) {
    if (!Number.isFinite(v)) return '?';
    if (Math.abs(v) < 5e-10) return '0';
    return String(+v.toPrecision(d + 1));
}

/** Format a complex number [re, im]. */
export function cnum(z, d = 3) {
    if (!z) return '∞';
    const re = num(z[0], d), im = num(Math.abs(z[1]), d);
    return `${re} ${z[1] < 0 ? '−' : '+'} ${im}i`;
}

/** Screen-space distance from (px, py) to (x, y), Infinity for invalid values. */
export const dist2 = (px, py, x, y) => (okPx(x) && okPx(y) ? Math.hypot(px - x, py - y) : Infinity);
