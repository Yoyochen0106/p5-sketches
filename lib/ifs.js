// Iterated function systems (pure maths, no p5 / DOM).
//
// An affine map is { a, b, c, d, e, f, p? }:  (x, y) -> (a x + b y + e, c x + d y + f), p = selection weight.
//
//   IFS_PRESETS                      Sierpinski, Barnsley fern, Koch, Heighway dragon, twindragon, Levy C, maple leaf
//   makeRng(seed)                    deterministic uniform [0, 1) generator (mulberry32)
//   compileMaps(maps)                typed-array form of a map list (coefficients + cumulative weights)
//   createChaosState(seed)           state of the chaos game (point, last map index, rng state)
//   runChaos(sys, state, n, grid)    n chaos-game iterations, optionally accumulated into a DensityGrid
//   DensityGrid                      w x h histogram (Uint32 counts + last-map tag) over a rectangular view
//   boundingView / viewForRect       bounding box of the attractor and a view with a given aspect ratio
//   contractionRatios                sqrt(|det|) of every map (the similarity ratio of a similarity map)
//   similarityDimension(ratios)      Moran equation sum r_i^s = 1
//   boxCountDimension(grid)          box-counting dimension estimate of the plotted set

/** Deterministic generator returning uniform numbers in [0, 1). */
export function makeRng(seed = 1) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const det = (m) => m.a * m.d - m.b * m.c;

/** Map z -> lambda z + t for complex lambda = (lr, li), t = (tr, ti). */
export const complexMap = (lr, li, tr, ti, p) => ({ a: lr, b: -li, c: li, d: lr, e: tr, f: ti, ...(p === undefined ? {} : { p }) });

const S3 = Math.sqrt(3);

function kochMaps() {
    const c60 = 0.5, s60 = S3 / 2;
    return [
        complexMap(1 / 3, 0, 0, 0),
        complexMap(c60 / 3, s60 / 3, 1 / 3, 0),
        complexMap(c60 / 3, -s60 / 3, 0.5, S3 / 6),
        complexMap(1 / 3, 0, 2 / 3, 0),
    ];
}

/** Classic systems. */
export const IFS_PRESETS = [
    {
        id: 'sierpinski', label: 'Sierpinski triangle',
        maps: [complexMap(0.5, 0, 0, 0), complexMap(0.5, 0, 0.5, 0), complexMap(0.5, 0, 0.25, S3 / 4)],
    },
    {
        id: 'fern', label: 'Barnsley fern',
        maps: [
            { a: 0, b: 0, c: 0, d: 0.16, e: 0, f: 0, p: 0.01 },
            { a: 0.85, b: 0.04, c: -0.04, d: 0.85, e: 0, f: 1.6, p: 0.85 },
            { a: 0.2, b: -0.26, c: 0.23, d: 0.22, e: 0, f: 1.6, p: 0.07 },
            { a: -0.15, b: 0.28, c: 0.26, d: 0.24, e: 0, f: 0.44, p: 0.07 },
        ],
    },
    { id: 'koch', label: 'Koch curve', maps: kochMaps() },
    {
        id: 'heighway', label: 'Heighway dragon',
        maps: [complexMap(0.5, 0.5, 0, 0), complexMap(-0.5, 0.5, 1, 0)],
    },
    {
        id: 'twindragon', label: 'Twindragon',
        maps: [complexMap(0.5, 0.5, 0, 0), complexMap(0.5, 0.5, 0.5, 0.5)],
    },
    {
        id: 'levy', label: 'Levy C curve',
        maps: [complexMap(0.5, 0.5, 0, 0), complexMap(0.5, -0.5, 0.5, 0.5)],
    },
    {
        id: 'maple', label: 'Maple leaf',
        maps: [
            { a: 0.14, b: 0.01, c: 0, d: 0.51, e: -0.08, f: -1.31, p: 0.25 },
            { a: 0.43, b: 0.52, c: -0.45, d: 0.5, e: 1.49, f: -0.75, p: 0.25 },
            { a: 0.45, b: -0.49, c: 0.47, d: 0.47, e: -1.62, f: -0.74, p: 0.25 },
            { a: 0.49, b: 0, c: 0, d: 0.51, e: 0.02, f: 1.62, p: 0.25 },
        ],
    },
];

export const getIfsPreset = (id) => IFS_PRESETS.find((q) => q.id === id) || IFS_PRESETS[0];

/** Deep copy of a map list (plain objects). */
export const cloneMaps = (maps) => maps.map((m) => ({ ...m }));

/**
 * Typed-array form of a map list. Weights default to |det| (the natural measure for similarities);
 * if every weight is zero the maps are chosen uniformly.
 * @returns {{k, coef: Float64Array, cum: Float64Array}}
 */
export function compileMaps(maps) {
    const k = maps.length;
    const coef = new Float64Array(6 * k);
    const w = new Float64Array(k);
    let sum = 0;
    maps.forEach((m, i) => {
        coef.set([m.a, m.b, m.c, m.d, m.e, m.f], 6 * i);
        const p = Number.isFinite(m.p) && m.p > 0 ? m.p : Math.abs(det(m));
        w[i] = Number.isFinite(p) ? p : 0;
        sum += w[i];
    });
    const cum = new Float64Array(k);
    let acc = 0;
    for (let i = 0; i < k; i++) {
        acc += sum > 0 ? w[i] / sum : 1 / k;
        cum[i] = acc;
    }
    if (k) cum[k - 1] = 1;
    return { k, coef, cum };
}

/** Chaos-game state: current point, last map index and the generator state (all plain numbers). */
export function createChaosState(seed = 1, x = 0, y = 0) {
    return { x, y, idx: 0, s: seed >>> 0, skip: 24 };
}

/** Histogram of points over a rectangular view; row 0 is the top (largest y). */
export class DensityGrid {
    constructor(w, h, view) {
        this.w = w;
        this.h = h;
        this.counts = new Uint32Array(w * h);
        this.tag = new Uint8Array(w * h);
        this.inView = 0;
        this.outside = 0;
        this.version = 0; // bumped on every change (images are only rebuilt when it moves)
        this.setView(view);
    }

    setView(view) {
        this.view = { ...view };
        this.sx = this.w / (view.xmax - view.xmin);
        this.sy = this.h / (view.ymax - view.ymin);
        this.clear();
    }

    clear() {
        this.counts.fill(0);
        this.tag.fill(0);
        this.inView = 0;
        this.outside = 0;
        this.version++;
    }

    /** Total number of points plotted so far (conserved: inView + outside). */
    get total() { return this.inView + this.outside; }

    maxCount() {
        let m = 0;
        const c = this.counts;
        for (let i = 0; i < c.length; i++) if (c[i] > m) m = c[i];
        return m;
    }

    plot(x, y, tag = 0) {
        const fx = (x - this.view.xmin) * this.sx;
        const fy = (this.view.ymax - y) * this.sy;
        if (fx >= 0 && fx < this.w && fy >= 0 && fy < this.h) {
            const i = (fy | 0) * this.w + (fx | 0);
            this.counts[i]++;
            this.tag[i] = tag;
            this.inView++;
        } else {
            this.outside++;
        }
        this.version++;
    }
}

/**
 * n iterations of the chaos game (the first `state.skip` points are not plotted). Returns the number of
 * iterations done. Diverging points are reset to the origin.
 */
export function runChaos(sys, state, n, grid = null) {
    const { k, coef, cum } = sys;
    if (!k) return 0;
    let { x, y, idx, s, skip } = state;
    const counts = grid ? grid.counts : null;
    const tags = grid ? grid.tag : null;
    const gw = grid ? grid.w : 0;
    const gh = grid ? grid.h : 0;
    const xmin = grid ? grid.view.xmin : 0, ymax = grid ? grid.view.ymax : 0;
    const sx = grid ? grid.sx : 0, sy = grid ? grid.sy : 0;
    let inView = 0, outside = 0;
    for (let it = 0; it < n; it++) {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        let j = 0;
        while (j < k - 1 && u >= cum[j]) j++;
        const o = 6 * j;
        const nx = coef[o] * x + coef[o + 1] * y + coef[o + 4];
        y = coef[o + 2] * x + coef[o + 3] * y + coef[o + 5];
        x = nx;
        idx = j;
        if (x - x !== 0 || y - y !== 0 || x > 1e12 || x < -1e12 || y > 1e12 || y < -1e12) { x = 0; y = 0; continue; }
        if (skip > 0) { skip--; continue; }
        if (counts) {
            const fx = (x - xmin) * sx, fy = (ymax - y) * sy;
            if (fx >= 0 && fx < gw && fy >= 0 && fy < gh) {
                const i = (fy | 0) * gw + (fx | 0);
                counts[i]++;
                tags[i] = j;
                inView++;
            } else {
                outside++;
            }
        }
    }
    state.x = x; state.y = y; state.idx = idx; state.s = s; state.skip = skip;
    if (grid) { grid.inView += inView; grid.outside += outside; grid.version++; }
    return n;
}

/** Bounding box { xmin, xmax, ymin, ymax } of a short run of the chaos game. */
export function boundingView(maps, { n = 20000, seed = 7 } = {}) {
    const sys = compileMaps(maps);
    const st = createChaosState(seed);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    runChaos(sys, st, 50); // settle
    for (let i = 0; i < n; i++) {
        runChaos(sys, st, 1);
        if (st.x < xmin) xmin = st.x;
        if (st.x > xmax) xmax = st.x;
        if (st.y < ymin) ymin = st.y;
        if (st.y > ymax) ymax = st.y;
    }
    if (!Number.isFinite(xmin + xmax + ymin + ymax)) return { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
    return { xmin, xmax, ymin, ymax };
}

/** Expands a bounding box to the aspect ratio w : h of a drawing rectangle, with a relative padding. */
export function viewForRect(box, w, h, pad = 0.06) {
    let bw = Math.max(box.xmax - box.xmin, 1e-9), bh = Math.max(box.ymax - box.ymin, 1e-9);
    const cx = (box.xmin + box.xmax) / 2, cy = (box.ymin + box.ymax) / 2;
    bw *= 1 + 2 * pad; bh *= 1 + 2 * pad;
    const aspect = w / Math.max(1, h);
    if (bw / bh < aspect) bw = bh * aspect; else bh = bw / aspect;
    return { xmin: cx - bw / 2, xmax: cx + bw / 2, ymin: cy - bh / 2, ymax: cy + bh / 2 };
}

/** sqrt(|det|) of each map: the contraction ratio when the map is a similarity. */
export const contractionRatios = (maps) => maps.map((m) => Math.sqrt(Math.abs(det(m))));

/** True if the linear part of the map is a similarity (rotation or reflection times a scale). */
export function isSimilarity(m, tol = 1e-9) {
    const rotation = Math.abs(m.a - m.d) < tol && Math.abs(m.b + m.c) < tol;
    const reflection = Math.abs(m.a + m.d) < tol && Math.abs(m.b - m.c) < tol;
    return rotation || reflection;
}

/**
 * Similarity (Moran) dimension: the s with sum r_i^s = 1. NaN if some ratio is not in (0, 1).
 * Exactly the Hausdorff dimension for an open-set-condition system of similarities.
 */
export function similarityDimension(ratios) {
    const k = ratios.length;
    if (!k || ratios.some((r) => !(r > 0) || !(r < 1))) return NaN;
    if (k === 1) return 0;
    const f = (s) => ratios.reduce((acc, r) => acc + Math.pow(r, s), 0) - 1;
    let lo = 0, hi = Math.log(k) / -Math.log(Math.max(...ratios));
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Box-counting dimension of the occupied pixels of a DensityGrid: counts the boxes of side 2^k pixels
 * that contain a point, for k in [kmin, kmax], and fits log N against log(1/size).
 */
export function boxCountDimension(grid, { kmin = 1, kmax } = {}) {
    const { w, h, counts } = grid;
    const top = kmax === undefined ? Math.max(kmin + 2, Math.floor(Math.log2(Math.min(w, h))) - 6) : kmax;
    const samples = [];
    for (let k = kmin; k <= top; k++) {
        const s = 1 << k;
        const bw = Math.ceil(w / s), bh = Math.ceil(h / s);
        const occ = new Uint8Array(bw * bh);
        for (let y = 0; y < h; y++) {
            const row = y * w, brow = (y >> k) * bw;
            for (let x = 0; x < w; x++) if (counts[row + x]) occ[brow + (x >> k)] = 1;
        }
        let n = 0;
        for (let i = 0; i < occ.length; i++) n += occ[i];
        if (n > 0) samples.push({ size: s, count: n });
    }
    if (samples.length < 2) return { dimension: NaN, r2: NaN, samples };
    const xs = samples.map((q) => Math.log(1 / q.size)), ys = samples.map((q) => Math.log(q.count));
    const m = samples.length;
    const mx = xs.reduce((a, b) => a + b, 0) / m, my = ys.reduce((a, b) => a + b, 0) / m;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < m; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    return { dimension: sxy / sxx, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1, samples };
}
