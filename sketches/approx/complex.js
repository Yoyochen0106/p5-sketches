// Complex panel: domain colouring of f / approximations / errors, plus wavelet views
// (continuous scalogram and the dyadic DWT coefficient map) for methods that have no
// analytic continuation.

import { domainColor, errorColor, renderField, viridis, hslToRgb } from '../../lib/domaincolor.js';
import { cwt, getContinuous } from '../../lib/wavelets/cwt.js';
import { niceTicks, fmtTick } from './view.js';
import { withClip } from './real.js';

const FONT = 'Consolas, ui-monospace, Menlo, monospace';

export const COMPLEX_SOURCES = [
    { value: 'f', label: 'f(z)', needs: 'analytic' },
    { value: 'taylor', label: 'Taylor Tₙ(z)', needs: 'analytic' },
    { value: 'pade', label: 'Padé [L/M](z)', needs: 'analytic' },
    { value: 'fourier', label: 'Fourier Sₙ(z)', needs: 'fit' },
    { value: 'interp', label: 'Interpolant pₙ(z)', needs: 'fit' },
    { value: 'err-taylor', label: 'error: Taylor', needs: 'analytic' },
    { value: 'err-pade', label: 'error: Padé', needs: 'analytic' },
    { value: 'err-fourier', label: 'error: Fourier', needs: 'analytic' },
    { value: 'err-interp', label: 'error: Interpolant', needs: 'analytic' },
    { value: 'scalogram', label: 'wavelet: scalogram (CWT)', needs: 'real' },
    { value: 'dwtmap', label: 'wavelet: DWT coefficient map', needs: 'real' },
];

/** Pick the source that can actually be shown for this function. */
export function resolveSource(scene) {
    let src = scene.get('cplx.source');
    const def = COMPLEX_SOURCES.find((s) => s.value === src) || COMPLEX_SOURCES[0];
    if (def.needs === 'analytic' && !scene.func.analytic) src = 'scalogram';
    return src;
}

function sourceFn(scene, src) {
    const { func } = scene;
    if (src === 'f') return { fn: (re, im) => func.fc([re, im]), color: domainColor };
    const [kind, method] = src.startsWith('err-') ? ['err', src.slice(4)] : ['val', src];
    const fit = scene.fit(method);
    if (!fit || !fit.complex) return null;
    if (kind === 'val') return { fn: (re, im) => fit.complex([re, im]), color: domainColor };
    return {
        fn: (re, im) => {
            const e = func.fc([re, im]);
            const g = fit.complex([re, im]);
            return Math.log10(Math.hypot(e[0] - g[0], e[1] - g[1]) + 1e-300);
        },
        color: errorColor,
    };
}

/** Cached p5.Image holder keyed by a signature string. */
class ImageSlot {
    constructor() {
        this.key = '';
        this.img = null;
    }

    get(p, key, w, h, paint) {
        if (this.img && this.key === key && this.img.width === w && this.img.height === h) return this.img;
        if (!this.img || this.img.width !== w || this.img.height !== h) this.img = p.createImage(w, h);
        const buf = paint(w, h);
        this.img.loadPixels();
        if (this.img.pixels.set) this.img.pixels.set(buf);
        else for (let i = 0; i < buf.length; i++) this.img.pixels[i] = buf[i];
        this.img.updatePixels();
        this.key = key;
        return this.img;
    }
}

const slots = { main: new ImageSlot(), inset: new ImageSlot(), cwt: new ImageSlot(), dwt: new ImageSlot() };

/** Drop cached images (call when a new p5 instance is mounted). */
export function resetSlots() {
    for (const s of Object.values(slots)) {
        s.key = '';
        s.img = null;
    }
}

function viewKey(v) {
    return [v.xmin, v.xmax, v.ymin, v.ymax].map((n) => n.toPrecision(7)).join(',');
}

function drawDomain(p, scene, vp, src) {
    const r = vp.rect;
    const block = scene.get('block');
    const w = Math.max(8, Math.ceil(r.w / block));
    const h = Math.max(8, Math.ceil(r.h / block));
    const sf = sourceFn(scene, src);
    if (!sf) return false;
    const key = [src, scene.sig(src), viewKey(vp), w, h].join('|');
    const img = slots.main.get(p, key, w, h, (ww, hh) => renderField(ww, hh, vp, sf.fn, sf.color));
    p.image(img, r.x, r.y, r.w, r.h);

    if (scene.get('cplx.inset') && src !== 'f' && scene.func.analytic) {
        const iw = Math.max(40, Math.min(150, Math.round(r.w * 0.28)));
        const ih = Math.round(iw * r.h / r.w);
        const fsf = sourceFn(scene, 'f');
        const small = Math.max(8, Math.round(iw / 2));
        const smallH = Math.max(8, Math.round(ih / 2));
        const ikey = ['f', scene.func.id, scene.func.expr || '', viewKey(vp), small, smallH].join('|');
        const iimg = slots.inset.get(p, ikey, small, smallH, (ww, hh) => renderField(ww, hh, vp, fsf.fn, fsf.color));
        const ix = r.x + r.w - iw - 8;
        const iy = r.y + r.h - ih - 8;
        p.image(iimg, ix, iy, iw, ih);
        p.noFill();
        p.stroke(scene.pal.fg);
        p.strokeWeight(1);
        p.rect(ix, iy, iw, ih);
        p.noStroke();
        p.fill(scene.pal.fg);
        p.textFont(FONT);
        p.textSize(10);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.text('f(z)', ix + 3, iy - 2);
    }
    return true;
}

function outlinedMark(p, x, y, kind, color) {
    p.noFill();
    p.strokeWeight(3);
    p.stroke(255);
    mark(p, x, y, kind);
    p.strokeWeight(1.5);
    p.stroke(color);
    mark(p, x, y, kind);
}

function mark(p, x, y, kind) {
    const s = 5;
    if (kind === 'x') {
        p.line(x - s, y - s, x + s, y + s);
        p.line(x - s, y + s, x + s, y - s);
    } else {
        p.circle(x, y, 2 * s);
    }
}

function drawOverlays(p, scene, vp, src) {
    const { pal, func, a } = scene;
    if (!scene.get('cplx.overlay')) return;
    const r = vp.rect;
    withClip(p, r, () => {
        // axes
        p.strokeWeight(1);
        p.stroke(255, 255, 255, 90);
        if (vp.ymin < 0 && vp.ymax > 0) p.line(r.x, vp.toY(0), r.x + r.w, vp.toY(0));
        if (vp.xmin < 0 && vp.xmax > 0) p.line(vp.toX(0), r.y, vp.toX(0), r.y + r.h);
        // convergence circle of the Taylor series
        const R = scene.radius;
        if (scene.fits.taylor || src === 'taylor' || src === 'err-taylor') {
            if (R !== undefined && Number.isFinite(R)) {
                const cx = vp.toX(a[0]);
                const cy = vp.toY(a[1]);
                const rx = R * r.w / (vp.xmax - vp.xmin);
                const ry = R * r.h / (vp.ymax - vp.ymin);
                if (rx < 1e5 && ry < 1e5) {
                    p.noFill();
                    p.stroke(255);
                    p.strokeWeight(1.5);
                    const ctx = p.drawingContext;
                    if (ctx && ctx.setLineDash) ctx.setLineDash([6, 5]);
                    p.ellipse(cx, cy, 2 * rx, 2 * ry);
                    if (ctx && ctx.setLineDash) ctx.setLineDash([]);
                }
            }
        }
        if (func.analytic) {
            for (const s of func.singularities || []) {
                if (s[0] >= vp.xmin && s[0] <= vp.xmax && s[1] >= vp.ymin && s[1] <= vp.ymax) {
                    outlinedMark(p, vp.toX(s[0]), vp.toY(s[1]), 'x', '#000000');
                }
            }
        }
        const pd = scene.fits.pade;
        if (pd && (src === 'pade' || src === 'err-pade')) {
            for (const z of pd.poles) outlinedMark(p, vp.toX(z[0]), vp.toY(z[1]), 'o', '#000000');
            p.fill(255);
            p.stroke(0);
            for (const z of pd.zeros) p.circle(vp.toX(z[0]), vp.toY(z[1]), 6);
        }
        // expansion centre
        p.fill(pal.accent);
        p.stroke(255);
        p.strokeWeight(1.5);
        p.circle(vp.toX(a[0]), vp.toY(a[1]), 10);
    });
}

function drawTicks(p, scene, vp) {
    const r = vp.rect;
    p.textFont(FONT);
    p.textSize(10);
    p.noStroke();
    p.fill(255);
    p.textAlign(p.CENTER, p.TOP);
    for (const x of niceTicks(vp.xmin, vp.xmax, Math.max(3, r.w / 90))) {
        if (Math.abs(x) < 1e-12) continue;
        p.text(fmtTick(x), vp.toX(x), r.y + r.h - 14);
    }
    p.textAlign(p.LEFT, p.CENTER);
    for (const y of niceTicks(vp.ymin, vp.ymax, Math.max(3, r.h / 60))) {
        if (Math.abs(y) < 1e-12) continue;
        p.text(fmtTick(y) + 'i', r.x + 4, vp.toY(y));
    }
}

// ---------- wavelet views ----------

function drawScalogram(p, scene, rect, xr) {
    const wl = getContinuous(scene.get('cplx.cwt'));
    if (!wl) return false;
    const n = Math.max(64, Math.min(384, Math.round(rect.w / 2)));
    const nScales = Math.max(24, Math.min(64, Math.round(rect.h / 6)));
    // quantise the window so small pans reuse the cached transform
    const q = (xr.x1 - xr.x0) / 16;
    xr = { x0: Math.round(xr.x0 / q) * q, x1: Math.round(xr.x1 / q) * q };
    const dt = (xr.x1 - xr.x0) / (n - 1);
    const key = ['cwt', scene.func.id, scene.func.expr || '', wl.id, xr.x0, xr.x1, n, nScales].join('|');
    const img = slots.cwt.get(p, key, n, nScales, () => {
        const sig = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            const y = scene.func.f(xr.x0 + i * dt);
            sig[i] = Number.isFinite(y) ? Math.max(-1e3, Math.min(1e3, y)) : 0;
        }
        // cwt() scales are measured in samples
        const smin = 2;
        const smax = n / 3;
        const scales = [];
        for (let k = 0; k < nScales; k++) scales.push(smin * Math.pow(smax / smin, k / (nScales - 1)));
        const res = cwt(sig, { wavelet: wl, scales, dt });
        const out = new Uint8ClampedArray(n * nScales * 4);
        let mx = 0;
        for (let i = 0; i < res.mag.length; i++) if (Number.isFinite(res.mag[i])) mx = Math.max(mx, res.mag[i]);
        for (let s = 0; s < nScales; s++) {
            const row = s; // small scales on top
            for (let i = 0; i < n; i++) {
                const idx = s * n + i;
                const t = mx > 0 ? res.mag[idx] / mx : 0;
                let c;
                if (res.im) c = hslToRgb(Math.atan2(res.im[idx], res.re[idx]) / (2 * Math.PI), 0.9, 0.08 + 0.8 * Math.sqrt(t));
                else c = viridis(Math.sqrt(t));
                const o = (row * n + i) * 4;
                out[o] = c[0];
                out[o + 1] = c[1];
                out[o + 2] = c[2];
                out[o + 3] = 255;
            }
        }
        return out;
    });
    p.image(img, rect.x, rect.y, rect.w, rect.h);
    p.noStroke();
    p.fill(255);
    p.textFont(FONT);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.text(`CWT |W(a,b)|  ${wl.name || wl.id}   x: ${fmtTick(xr.x0)}…${fmtTick(xr.x1)}   scale ↑ = finer`, rect.x + 6, rect.y + 4);
    return true;
}

function drawDwtMap(p, scene, rect) {
    const wv = scene.fit('wavelet');
    if (!wv) return false;
    const dec = wv.result.dec;
    const rows = [...dec.details, dec.approx]; // finest detail first, approximation last
    const W = rows[0].length;
    const H = rows.length;
    const key = ['dwt', scene.func.id, scene.func.expr || '', scene.get('wavelet.family'), scene.get('wavelet.level'),
        scene.get('wavelet.keepPct'), scene.get('wavelet.samples'), wv.window.join(',')].join('|');
    const img = slots.dwt.get(p, key, W, H, () => {
        const out = new Uint8ClampedArray(W * H * 4);
        let mx = 0;
        for (const row of rows) for (const v of row) if (Number.isFinite(v)) mx = Math.max(mx, Math.abs(v));
        for (let j = 0; j < H; j++) {
            const row = rows[j];
            const rep = W / row.length;
            for (let i = 0; i < W; i++) {
                const v = Math.abs(row[Math.min(row.length - 1, Math.floor(i / rep))]);
                const t = v > 0 && mx > 0 ? Math.max(0, 1 + Math.log10(v / mx) / 6) : 0;
                const c = v > 0 ? viridis(t) : [20, 20, 24];
                const o = (j * W + i) * 4;
                out[o] = c[0];
                out[o + 1] = c[1];
                out[o + 2] = c[2];
                out[o + 3] = 255;
            }
        }
        return out;
    });
    const ctx = p.drawingContext;
    if (ctx) ctx.imageSmoothingEnabled = false;
    p.image(img, rect.x, rect.y, rect.w, rect.h);
    if (ctx) ctx.imageSmoothingEnabled = true;
    p.noStroke();
    p.fill(255);
    p.textFont(FONT);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.text(`DWT coefficients (dark = discarded)  ${wv.family.id}  rows: d\u2081 \u2026 d\u2c7c, a\u2c7c`, rect.x + 6, rect.y + 4);
    return true;
}

/** Draws the complex panel into `vp.rect`; `realView` supplies the x range for the wavelet views. */
export function drawComplexPanel(p, scene, vp, realView) {
    const { pal } = scene;
    const r = vp.rect;
    p.noStroke();
    p.fill(pal.panel);
    p.rect(r.x, r.y, r.w, r.h);
    const src = resolveSource(scene);
    let ok = false;
    withClip(p, r, () => {
        if (src === 'scalogram') ok = drawScalogram(p, scene, r, { x0: realView.xmin, x1: realView.xmax });
        else if (src === 'dwtmap') ok = drawDwtMap(p, scene, r);
        else {
            ok = drawDomain(p, scene, vp, src);
            if (ok) {
                drawOverlays(p, scene, vp, src);
                drawTicks(p, scene, vp);
            }
        }
    });
    p.noStroke();
    p.fill(255);
    p.textFont(FONT);
    p.textSize(11);
    p.textAlign(p.LEFT, p.TOP);
    if (!ok) {
        p.fill(pal.muted);
        p.text('Nothing to show for this source.', r.x + 10, r.y + 10);
    } else if (src !== 'scalogram' && src !== 'dwtmap') {
        const label = (COMPLEX_SOURCES.find((s) => s.value === src) || {}).label || src;
        p.fill(255);
        p.text(label, r.x + 8, r.y + 6);
    }
    p.noFill();
    p.stroke(pal.border);
    p.rect(r.x, r.y, r.w, r.h);
    return src;
}
