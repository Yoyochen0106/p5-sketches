// Shared helpers for the Iterated Function Systems & Moebius Groups sketch: colours, density-grid images,
// pointer / wheel normalisation and a small 2D view transform.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export { clamp };

/** Distinct colours for maps / letters (index modulo length). */
export const TAG_COLORS = {
    dark: [[255, 99, 99], [99, 220, 130], [99, 160, 255], [255, 205, 80], [200, 120, 255], [80, 220, 220], [255, 140, 200], [170, 205, 90]],
    light: [[210, 40, 50], [30, 150, 70], [30, 90, 210], [200, 140, 0], [140, 50, 200], [0, 150, 160], [210, 60, 140], [100, 140, 20]],
};

export const hexToRgb = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    const n = m ? parseInt(m[1], 16) : 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const tagColors = (pal) => (pal.dark ? TAG_COLORS.dark : TAG_COLORS.light);

export const rgbCss = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

/** True for events that were not aimed at the canvas (UI overlays, the drawer, ...). */
export const offCanvas = (p, e) => !!(e && e.target && p.canvas && e.target !== p.canvas && e.target !== p.canvas.elt);

/** True when the primary button (or a touch) is pressed. */
export function isPrimary(p) {
    const b = p.mouseButton;
    if (b === undefined || b === null || b === '') return true;
    return b === p.LEFT || (typeof b === 'object' && !!b.left);
}

export function wheelDelta(e) {
    let d = Number(e && (e.deltaY !== undefined ? e.deltaY : e.delta)) || 0;
    if (e && e.deltaMode === 1) d *= 33;
    else if (e && e.deltaMode === 2) d *= 400;
    return clamp(d, -300, 300);
}

/** True while a form control has the keyboard focus. */
export function typing(key) {
    const el = globalThis.document && globalThis.document.activeElement;
    if (!el) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
    return /^(BUTTON|A)$/.test(el.tagName || '') && (key === ' ' || key === 'Enter');
}

/**
 * Plane <-> pixel transform: world point (cx, cy) at the centre of `rect`, `scale` pixels per unit
 * (y axis points up on screen).
 */
export class PlaneView {
    constructor(rect, cx = 0, cy = 0, scale = 100) {
        this.rect = rect; this.cx = cx; this.cy = cy; this.scale = scale;
    }

    toScreen(x, y) {
        return [this.rect.x + this.rect.w / 2 + (x - this.cx) * this.scale, this.rect.y + this.rect.h / 2 - (y - this.cy) * this.scale];
    }

    toWorld(px, py) {
        return [this.cx + (px - this.rect.x - this.rect.w / 2) / this.scale, this.cy - (py - this.rect.y - this.rect.h / 2) / this.scale];
    }

    /** The visible world rectangle as a DensityGrid view. */
    gridView() {
        const hw = this.rect.w / 2 / this.scale, hh = this.rect.h / 2 / this.scale;
        return { xmin: this.cx - hw, xmax: this.cx + hw, ymin: this.cy - hh, ymax: this.cy + hh };
    }

    /** Scales by `factor` around the world point under the pixel (px, py). */
    zoomAt(px, py, factor, minScale = 1e-3, maxScale = 1e9) {
        const [wx, wy] = this.toWorld(px, py);
        this.scale = clamp(this.scale * factor, minScale, maxScale);
        this.cx = wx - (px - this.rect.x - this.rect.w / 2) / this.scale;
        this.cy = wy + (py - this.rect.y - this.rect.h / 2) / this.scale;
    }

    pan(dx, dy) {
        this.cx -= dx / this.scale;
        this.cy += dy / this.scale;
    }
}

/**
 * Colours a DensityGrid into a p5.Image (same size as the grid).
 * mode 'tag': hue from the last map / letter, brightness from log density
 * mode 'density': single colour ramp from log density; mode 'flat': any hit is drawn in the foreground colour.
 */
export function gridToImage(grid, img, { mode = 'tag', bg, fg, colors, gamma = 0.55 }) {
    img.loadPixels();
    const px = img.pixels;
    const { counts, tag } = grid;
    const n = grid.w * grid.h;
    let max = 0;
    for (let i = 0; i < n; i++) if (counts[i] > max) max = counts[i];
    const lmax = Math.log1p(max) || 1;
    // brightness table indexed by the count (the counts are small integers almost everywhere)
    const tsize = Math.min(max, 16383) + 1;
    const table = new Float32Array(tsize);
    for (let c = 1; c < tsize; c++) table[c] = mode === 'flat' ? 1 : 0.18 + 0.82 * Math.pow(Math.log1p(c) / lmax, gamma);
    for (let i = 0; i < n; i++) {
        const c = counts[i];
        const o = i * 4;
        if (c === 0) {
            px[o] = bg[0]; px[o + 1] = bg[1]; px[o + 2] = bg[2]; px[o + 3] = 255;
            continue;
        }
        const v = c < tsize ? table[c] : 0.18 + 0.82 * Math.pow(Math.log1p(c) / lmax, gamma);
        const col = mode === 'tag' ? colors[tag[i] % colors.length] : fg;
        px[o] = bg[0] + (col[0] - bg[0]) * v;
        px[o + 1] = bg[1] + (col[1] - bg[1]) * v;
        px[o + 2] = bg[2] + (col[2] - bg[2]) * v;
        px[o + 3] = 255;
    }
    img.updatePixels();
}

/** Re-creates an image holder entry when the size changed. */
export function ensureImage(p, holder, w, h) {
    if (!holder.img || holder.w !== w || holder.h !== h) {
        holder.img = p.createImage(w, h);
        holder.w = w; holder.h = h;
        holder.version = -1;
    }
    return holder.img;
}

/** Draws an arrow from (x0, y0) to (x1, y1) with a head of `size` pixels. */
export function arrow(p, x0, y0, x1, y1, size = 8) {
    if (![x0, y0, x1, y1].every(Number.isFinite)) return;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d < 1) return;
    const ux = dx / d, uy = dy / d;
    p.line(x0, y0, x1, y1);
    p.line(x1, y1, x1 - size * (ux + 0.5 * uy), y1 - size * (uy - 0.5 * ux));
    p.line(x1, y1, x1 - size * (ux - 0.5 * uy), y1 - size * (uy + 0.5 * ux));
}

/** Runs fn with drawing clipped to rect = { x, y, w, h } (push / pop, never raw save / restore). */
export function withClip(p, rect, fn) {
    p.push();
    const c = p.drawingContext;
    c.beginPath();
    c.rect(rect.x, rect.y, rect.w, rect.h);
    c.clip();
    try { fn(); } finally { p.pop(); }
}
