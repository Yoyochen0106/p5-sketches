// Colour mappings for complex-plane and heat-map visualisations.
// Pure functions: no p5 / DOM dependency, so they can be unit-tested in Node.

const TWO_PI = 2 * Math.PI;

/** HSL (all 0..1) -> [r, g, b] in 0..255. */
export function hslToRgb(h, s, l) {
    h = ((h % 1) + 1) % 1;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h * 6;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = l - c / 2;
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Classic "domain colouring": hue = arg(w), brightness grows with |w|
 * (zeros are dark, poles are bright) and a faint ring pattern marks every
 * doubling of |w|. Non-finite values (poles / overflow) are drawn white.
 */
export function domainColor(re, im) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return [255, 255, 255];
    const mag = Math.hypot(re, im);
    const hue = Math.atan2(im, re) / TWO_PI;
    const lm = Math.log2(mag + 1e-300);
    const ring = lm - Math.floor(lm);
    const b = Math.pow(mag, 0.35) / (1 + Math.pow(mag, 0.35));
    const l = Math.min(0.95, Math.max(0.05, 0.12 + 0.76 * b + 0.06 * (ring - 0.5)));
    return hslToRgb(hue, 0.9, l);
}

const VIRIDIS = [
    [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
    [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37],
];

/** Viridis-like colour map, t in 0..1 -> [r, g, b]. */
export function viridis(t) {
    if (!(t > 0)) t = 0;
    if (t > 1) t = 1;
    const f = t * (VIRIDIS.length - 1);
    const i = Math.min(VIRIDIS.length - 2, Math.floor(f));
    const u = f - i;
    const a = VIRIDIS[i], b = VIRIDIS[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

/**
 * Error heat map. `log10err` is log10 of an absolute error; the range
 * [lo, hi] (default -10..1) is stretched over the palette, tiny errors are
 * dark purple and huge errors are yellow. Non-finite values are white.
 */
export function errorColor(log10err, lo = -10, hi = 1) {
    if (Number.isNaN(log10err) || log10err === Infinity) return [255, 255, 255];
    return viridis((log10err - lo) / (hi - lo));
}

/**
 * Fill an RGBA buffer by sampling `fn` on a w*h pixel grid covering `view`
 * ({xmin, xmax, ymin, ymax}; y grows upwards). `fn(re, im)` returns either a
 * complex [re, im] (use with domainColor) or a number (use with a scalar colour
 * function); `colorFn` turns that value into [r, g, b].
 */
export function renderField(w, h, view, fn, colorFn, out = new Uint8ClampedArray(w * h * 4)) {
    const dx = (view.xmax - view.xmin) / w;
    const dy = (view.ymax - view.ymin) / h;
    let k = 0;
    for (let j = 0; j < h; j++) {
        const im = view.ymax - (j + 0.5) * dy;
        for (let i = 0; i < w; i++) {
            const re = view.xmin + (i + 0.5) * dx;
            const v = fn(re, im);
            const c = Array.isArray(v) ? colorFn(v[0], v[1]) : colorFn(v);
            out[k++] = c[0];
            out[k++] = c[1];
            out[k++] = c[2];
            out[k++] = 255;
        }
    }
    return out;
}
