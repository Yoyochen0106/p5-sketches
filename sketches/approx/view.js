// Viewport: maps between math coordinates and a screen rectangle, with zoom / pan helpers.

export class Viewport {
    constructor(xmin, xmax, ymin, ymax) {
        this.xmin = xmin;
        this.xmax = xmax;
        this.ymin = ymin;
        this.ymax = ymax;
        this.rect = { x: 0, y: 0, w: 1, h: 1 };
    }

    setRect(x, y, w, h) {
        this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
        return this;
    }

    set(xmin, xmax, ymin, ymax) {
        this.xmin = xmin;
        this.xmax = xmax;
        this.ymin = ymin;
        this.ymax = ymax;
        return this;
    }

    copyFrom(v) {
        return this.set(v.xmin, v.xmax, v.ymin, v.ymax);
    }

    toX(x) { return this.rect.x + (x - this.xmin) / (this.xmax - this.xmin) * this.rect.w; }
    toY(y) { return this.rect.y + (this.ymax - y) / (this.ymax - this.ymin) * this.rect.h; }
    fromX(px) { return this.xmin + (px - this.rect.x) / this.rect.w * (this.xmax - this.xmin); }
    fromY(py) { return this.ymax - (py - this.rect.y) / this.rect.h * (this.ymax - this.ymin); }

    contains(px, py) {
        const r = this.rect;
        return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
    }

    /** Scale the visible range by (fx, fy) (<1 zooms in) keeping the point under (px, py) fixed. */
    zoomAt(px, py, fx, fy = fx) {
        const cx = this.fromX(px), cy = this.fromY(py);
        this.xmin = cx + (this.xmin - cx) * fx;
        this.xmax = cx + (this.xmax - cx) * fx;
        this.ymin = cy + (this.ymin - cy) * fy;
        this.ymax = cy + (this.ymax - cy) * fy;
        return this;
    }

    /** Drag the view by a screen-space delta. */
    panPx(dx, dy) {
        const sx = (this.xmax - this.xmin) / this.rect.w;
        const sy = (this.ymax - this.ymin) / this.rect.h;
        this.xmin -= dx * sx;
        this.xmax -= dx * sx;
        this.ymin += dy * sy;
        this.ymax += dy * sy;
        return this;
    }

    /** Make one screen pixel span the same distance on both axes (keeps the y centre). */
    lockAspect() {
        const cy = (this.ymin + this.ymax) / 2;
        const half = (this.xmax - this.xmin) * this.rect.h / this.rect.w / 2;
        this.ymin = cy - half;
        this.ymax = cy + half;
        return this;
    }
}

/** "Nice" tick positions (1, 2, 5 x 10^k) covering [lo, hi] with roughly `count` ticks. */
export function niceTicks(lo, hi, count = 8) {
    const span = hi - lo;
    if (!(span > 0) || !Number.isFinite(span)) return [];
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    const ticks = [];
    const first = Math.ceil(lo / step - 1e-9);
    for (let i = first; i * step <= hi + step * 1e-9; i++) ticks.push(+(i * step).toPrecision(12));
    return ticks;
}

/** Compact tick label. */
export function fmtTick(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-3) return v.toExponential(0);
    return String(+v.toPrecision(6));
}
