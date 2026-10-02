// Image mode: 2D spectrum analysis (cached) and drawing of the four views
// (original, reconstruction, log-magnitude spectrum, error).

import {
    forwardImage, logSpectrum, lowpassSquare, lowpassDisc, keepTopK, maskCount, reconstruct, rmse, psnr,
} from '../../lib/fourier2d.js';
import { GAP } from './state.js';

export const MASK_MODES = [
    { value: 'square', label: 'low-pass square' },
    { value: 'disc', label: 'low-pass disc' },
    { value: 'topk', label: 'top-K magnitudes' },
    { value: 'paint', label: 'painted mask' },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Cached forward transform, mask and reconstruction for the current raster / settings. */
export class ImageModel {
    constructor() {
        this._spec = null;
        this._res = null;
    }

    spectrum(raster) {
        const key = `${raster.n}|${raster.version}`;
        if (!this._spec || this._spec.key !== key) {
            const { re, im } = forwardImage(raster.data, raster.n);
            this._spec = { key, re, im, log: logSpectrum(re, im, raster.n) };
        }
        return this._spec;
    }

    /** Centred mask for the selected mode. */
    mask(get, raster, paint) {
        const n = raster.n;
        const mode = get('img.mode');
        if (mode === 'paint') return paint.data;
        if (mode === 'disc') return lowpassDisc(n, get('img.radius'));
        if (mode === 'topk') {
            const s = this.spectrum(raster);
            return keepTopK(s.re, s.im, n, get('img.top'));
        }
        return lowpassSquare(n, Math.min(n >> 1, get('img.K')));
    }

    /** Everything the views need; cached on (raster version, mask inputs). */
    result(get, raster, paint) {
        const mode = get('img.mode');
        const param = mode === 'square' ? get('img.K') : mode === 'disc' ? get('img.radius') : mode === 'topk' ? get('img.top') : paint.version;
        const key = `${raster.n}|${raster.version}|${mode}|${param}|${mode === 'paint' ? paint.n : ''}`;
        if (this._res && this._res.key === key) return this._res;
        const n = raster.n;
        const spec = this.spectrum(raster);
        const mask = this.mask(get, raster, paint);
        const raw = reconstruct(spec.re, spec.im, n, mask);
        const rec = Float64Array.from(raw, clamp01);
        const err = new Float64Array(n * n);
        let maxErr = 0;
        for (let i = 0; i < err.length; i++) {
            err[i] = Math.abs(rec[i] - raster.data[i]);
            if (err[i] > maxErr) maxErr = err[i];
        }
        const kept = maskCount(mask);
        this._res = {
            key, mask, rec, err, maxErr, kept, total: n * n,
            rmse: rmse(rec, raster.data), psnr: psnr(rec, raster.data, 1), log: spec.log,
        };
        return this._res;
    }
}

/** Four (or three) square cells laid out in the best-fitting grid. */
export function imageLayout(w, h, showError) {
    const count = showError ? 4 : 3;
    const metricsH = 44, labelH = 18;
    const availW = w - GAP, availH = h - GAP - metricsH;
    let best = null;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const s = Math.floor(Math.min((availW - GAP * cols) / cols, (availH - (GAP + labelH) * rows) / rows));
        if (!best || s > best.s) best = { cols, rows, s };
    }
    const s = Math.max(16, best.s);
    const names = ['orig', 'recon', 'spec', 'err'].slice(0, count);
    const totalW = best.cols * s + (best.cols - 1) * GAP;
    const totalH = best.rows * (s + labelH) + (best.rows - 1) * GAP;
    const x0 = Math.max(GAP, (w - totalW) / 2), y0 = Math.max(GAP, (h - metricsH - totalH) / 2);
    const cells = {};
    names.forEach((name, i) => {
        const c = i % best.cols, r = Math.floor(i / best.cols);
        cells[name] = { x: x0 + c * (s + GAP), y: y0 + r * (s + labelH + GAP) + labelH, s, name };
    });
    return { cells, metrics: { x: GAP, y: h - metricsH, w: w - 2 * GAP, h: metricsH - 4 } };
}

/** Grid cell (float, may be out of range) under a pixel for a given cell and grid size. */
export function cellAt(cell, n, mx, my) {
    return { u: ((mx - cell.x) / cell.s) * n, v: ((my - cell.y) / cell.s) * n };
}

export function hitCell(layout, mx, my) {
    for (const c of Object.values(layout.cells)) {
        if (mx >= c.x && mx < c.x + c.s && my >= c.y && my < c.y + c.s) return c.name;
    }
    return null;
}

/** p5.Image cache: rewrites pixels only when `key` changes. */
export class ImageCache {
    constructor() { this.map = new Map(); }

    get(p, name, n, key, colorAt) {
        let e = this.map.get(name);
        if (!e || e.n !== n) {
            e = { img: p.createImage(n, n), n, key: null };
            this.map.set(name, e);
        }
        if (e.key !== key) {
            e.key = key;
            e.img.loadPixels();
            const px = e.img.pixels;
            for (let i = 0; i < n * n; i++) {
                const c = colorAt(i);
                px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
            }
            e.img.updatePixels();
        }
        return e.img;
    }
}

const gray = (v) => { const g = Math.round(clamp01(v) * 255); return [g, g, g]; };
const heat = (v) => {
    const t = clamp01(v);
    return [Math.round(255 * clamp01(t * 2)), Math.round(255 * clamp01((t - 0.5) * 2)), Math.round(255 * clamp01(0.3 - t) * 2)];
};

function cellFrame(p, pal, cell, label) {
    p.noFill();
    p.stroke(pal.border);
    p.strokeWeight(1);
    p.rect(cell.x - 0.5, cell.y - 0.5, cell.s + 1, cell.s + 1);
    p.noStroke();
    p.fill(pal.muted);
    p.textFont('Consolas, ui-monospace, monospace');
    p.textSize(11);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(label, cell.x, cell.y - 3);
}

/** Draw the four views plus metrics. sc = { raster, paint, model, cache, pal, get, mouse }. */
export function drawImages(p, sc, layout) {
    const { raster, paint, pal, get } = sc;
    const n = raster.n;
    const res = sc.model.result(get, raster, paint);
    if (p.noSmooth) p.noSmooth();
    const rkey = `${raster.n}|${raster.version}`;
    const mkey = `${res.key}`;
    const { cells } = layout;

    p.noStroke();
    p.fill(pal.panel);
    p.rect(0, 0, p.width, p.height);

    const orig = sc.cache.get(p, 'orig', n, rkey, (i) => gray(raster.data[i]));
    p.image(orig, cells.orig.x, cells.orig.y, cells.orig.s, cells.orig.s);
    cellFrame(p, pal, cells.orig, `original ${n}x${n}  (paint here: ${get('img.tool')})`);

    const rec = sc.cache.get(p, 'recon', n, mkey, (i) => gray(res.rec[i]));
    p.image(rec, cells.recon.x, cells.recon.y, cells.recon.s, cells.recon.s);
    cellFrame(p, pal, cells.recon, 'reconstruction');

    const h = n >> 1;
    const spec = sc.cache.get(p, 'spec', n, `${mkey}|${paint.version}`, (i) => {
        const keep = res.mask[i];
        const v = res.log[i];
        if (keep) return [Math.round(60 + 195 * v), Math.round(60 + 195 * v), Math.round(70 + 185 * v)];
        return [Math.round(110 * v + 25), Math.round(30 * v + 10), Math.round(30 * v + 10)];
    });
    p.image(spec, cells.spec.x, cells.spec.y, cells.spec.s, cells.spec.s);
    cellFrame(p, pal, cells.spec, 'log |F| centred (bright = kept; paint the mask here)');
    // axes through DC
    const sx = cells.spec.x + ((h + 0.5) / n) * cells.spec.s, sy = cells.spec.y + ((h + 0.5) / n) * cells.spec.s;
    p.stroke(255, 255, 255, 40);
    p.strokeWeight(1);
    p.line(sx, cells.spec.y, sx, cells.spec.y + cells.spec.s);
    p.line(cells.spec.x, sy, cells.spec.x + cells.spec.s, sy);

    if (cells.err) {
        const err = sc.cache.get(p, 'err', n, mkey, (i) => heat(res.maxErr > 1e-12 ? res.err[i] / res.maxErr : 0));
        p.image(err, cells.err.x, cells.err.y, cells.err.s, cells.err.s);
        cellFrame(p, pal, cells.err, `|error| (scaled to max ${res.maxErr.toFixed(3)})`);
    }

    // brush cursor
    const m = sc.mouse;
    if (m) {
        const target = hitCell(layout, m.x, m.y);
        const radius = target === 'orig' ? get('img.size') : target === 'spec' ? get('img.maskSize') + 0.5 : 0;
        if (radius > 0) {
            const c = cells[target];
            p.noFill();
            p.stroke(255, 200, 80);
            p.strokeWeight(1);
            const d = Math.max(4, ((radius * 2) / n) * c.s);
            p.ellipse(m.x, m.y, d, d);
        }
    }

    const mt = layout.metrics;
    p.noStroke();
    p.fill(pal.fg);
    p.textFont('Consolas, ui-monospace, monospace');
    p.textSize(12);
    p.textAlign(p.LEFT, p.TOP);
    const psnrTxt = Number.isFinite(res.psnr) ? `${res.psnr.toFixed(2)} dB` : 'inf (exact)';
    const ratio = res.kept > 0 ? (res.total / res.kept).toFixed(1) : 'inf';
    const modeLabel = (MASK_MODES.find((x) => x.value === get('img.mode')) || {}).label;
    p.text(`${modeLabel}   kept ${res.kept}/${res.total} (${((100 * res.kept) / res.total).toFixed(2)}%)   compression ${ratio}:1`, mt.x, mt.y);
    p.text(`RMSE ${res.rmse.toFixed(4)}   PSNR ${psnrTxt}`, mt.x, mt.y + 16);
}
