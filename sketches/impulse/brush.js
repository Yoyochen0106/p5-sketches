// Terrain-style brush operations on a sampled curve (Float64Array), in sample-index units.
// Pure functions: no p5, no DOM.

/**
 * Brush weight at distance d from the centre: 1 inside the hard core, cosine fall-off to 0 at the
 * radius. `soft` in [0, 1] is the fraction of the radius used by the fall-off.
 */
export function brushWeight(d, radius, soft) {
    if (!(radius > 0)) return d === 0 ? 1 : 0;
    const u = Math.abs(d) / radius;
    if (u >= 1) return 0;
    const core = 1 - Math.max(0, Math.min(1, soft));
    if (u <= core) return 1;
    return 0.5 * (1 + Math.cos((Math.PI * (u - core)) / (1 - core)));
}

function range(arr, c, radius) {
    return [Math.max(0, Math.ceil(c - radius)), Math.min(arr.length - 1, Math.floor(c + radius))];
}

/** Add `delta * weight` to every sample under the brush (delta < 0 lowers). */
export function raise(arr, c, radius, soft, delta) {
    const [a, b] = range(arr, c, radius);
    for (let i = a; i <= b; i++) arr[i] += delta * brushWeight(i - c, radius, soft);
}

/** Move samples toward `value` by `rate * weight` (rate 1 = hard flatten). */
export function flatten(arr, c, radius, soft, value, rate = 1) {
    const [a, b] = range(arr, c, radius);
    for (let i = a; i <= b; i++) arr[i] += Math.min(1, rate * brushWeight(i - c, radius, soft)) * (value - arr[i]);
}

/** Blend samples toward the local mean (box window of half-width ~radius/2) by `rate * weight`. */
export function smooth(arr, c, radius, soft, rate = 0.5) {
    const [a, b] = range(arr, c, radius);
    const hw = Math.max(1, Math.round(radius / 2));
    const avg = new Float64Array(b - a + 1);
    for (let i = a; i <= b; i++) {
        let s = 0, m = 0;
        for (let j = Math.max(0, i - hw); j <= Math.min(arr.length - 1, i + hw); j++) { s += arr[j]; m++; }
        avg[i - a] = s / m;
    }
    for (let i = a; i <= b; i++) arr[i] += Math.min(1, rate * brushWeight(i - c, radius, soft)) * (avg[i - a] - arr[i]);
}

/** Freehand line: samples between two (index, value) points are replaced by the straight segment. */
export function lineSegment(arr, i0, v0, i1, v1) {
    if (i1 < i0) { [i0, i1] = [i1, i0]; [v0, v1] = [v1, v0]; }
    const a = Math.max(0, Math.round(i0)), b = Math.min(arr.length - 1, Math.round(i1));
    for (let i = a; i <= b; i++) {
        const t = i1 > i0 ? (i - i0) / (i1 - i0) : 0;
        arr[i] = v0 + (v1 - v0) * Math.max(0, Math.min(1, t));
    }
}

/** Linear resampling of a curve to a new length (end points map to end points). */
export function resample(arr, n) {
    const out = new Float64Array(n);
    const m = arr.length;
    if (m === 0) return out;
    if (m === n) { out.set(arr); return out; }
    for (let i = 0; i < n; i++) {
        const t = n > 1 ? (i * (m - 1)) / (n - 1) : 0;
        const k = Math.min(m - 2 < 0 ? 0 : m - 2, Math.floor(t));
        const f = m > 1 ? t - k : 0;
        out[i] = m > 1 ? arr[k] * (1 - f) + arr[k + 1] * f : arr[0];
    }
    return out;
}
