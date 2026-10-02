// Raster painter (grayscale image on an n x n grid) and the paintable frequency mask.
// Pure data structures with a `version` counter that bumps on every change (cache keys).

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Brush weight at distance d: 1 inside r*hardness, smooth falloff to 0 at r. */
export function brushWeight(d, r, hardness) {
    if (d > r) return 0;
    const core = r * clamp01(hardness);
    if (d <= core) return 1;
    return clamp01((r - d) / Math.max(1e-9, r - core));
}

/** Visit points along a segment every `step` units (including both endpoints). */
function along(x0, y0, x1, y1, step, fn) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= k; i++) fn(x0 + ((x1 - x0) * i) / k, y0 + ((y1 - y0) * i) / k);
}

export class RasterPainter {
    constructor(n = 64) {
        this.n = n;
        this.data = new Float64Array(n * n);
        this.version = 0;
    }

    /** Replace contents with an n x n Float64Array (copied, clamped to [0,1]). */
    load(n, data) {
        this.n = n;
        this.data = Float64Array.from(data, clamp01);
        this.version++;
    }

    /** Nearest-neighbour resize to a new grid size. */
    resize(n) {
        if (n === this.n) return;
        const out = new Float64Array(n * n);
        for (let y = 0; y < n; y++) {
            const sy = Math.min(this.n - 1, Math.floor(((y + 0.5) * this.n) / n));
            for (let x = 0; x < n; x++) {
                const sx = Math.min(this.n - 1, Math.floor(((x + 0.5) * this.n) / n));
                out[y * n + x] = this.data[sy * this.n + sx];
            }
        }
        this.n = n;
        this.data = out;
        this.version++;
    }

    /** One brush dab centred at cell coordinates (cx, cy) (cell centres are at .5). */
    dab(cx, cy, r, hardness, erase) {
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        const n = this.n;
        const rad = Math.max(0.5, r);
        const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(n - 1, Math.ceil(cx + rad));
        const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(n - 1, Math.ceil(cy + rad));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const w = brushWeight(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), rad, hardness);
                if (w <= 0) continue;
                const i = y * n + x;
                this.data[i] = erase ? this.data[i] * (1 - w) : this.data[i] + (1 - this.data[i]) * w;
            }
        }
        this.version++;
    }

    /** Brush stroke from (x0,y0) to (x1,y1) in cell coordinates. */
    stroke(x0, y0, x1, y1, r, hardness, erase) {
        along(x0, y0, x1, y1, 0.5, (x, y) => this.dab(x, y, r, hardness, erase));
    }

    fill(v = 1) { this.data.fill(clamp01(v)); this.version++; }
    clear() { this.fill(0); }
    invert() { for (let i = 0; i < this.data.length; i++) this.data[i] = 1 - this.data[i]; this.version++; }
}

export class MaskPainter {
    constructor(n = 64) {
        this.n = n;
        this.data = new Uint8Array(n * n);
        this.version = 0;
    }

    /** Replace with a copy of a centred mask. */
    load(n, mask) {
        this.n = n;
        this.data = Uint8Array.from(mask, (v) => (v ? 1 : 0));
        this.version++;
    }

    resize(n) {
        if (n === this.n) return;
        const out = new Uint8Array(n * n);
        // map by signed frequency so low frequencies stay low frequencies
        const oh = this.n >> 1, nh = n >> 1;
        for (let v = 0; v < n; v++) {
            for (let u = 0; u < n; u++) {
                const fx = u - nh, fy = v - nh;
                const su = fx + oh, sv = fy + oh;
                if (su >= 0 && su < this.n && sv >= 0 && sv < this.n) out[v * n + u] = this.data[sv * this.n + su];
            }
        }
        this.n = n;
        this.data = out;
        this.version++;
    }

    fillAll(value) { this.data.fill(value ? 1 : 0); this.version++; }

    /**
     * Paint a disc of radius r (in bins) around centred cell (u, v), also at the conjugate-symmetric
     * position so the kept spectrum stays Hermitian (the reconstruction stays real).
     */
    paint(u, v, r, keep) {
        if (!Number.isFinite(u) || !Number.isFinite(v)) return;
        const n = this.n;
        const val = keep ? 1 : 0;
        const rad = Math.max(0, r);
        const set = (a, b) => {
            if (a < 0 || b < 0 || a >= n || b >= n) return;
            this.data[b * n + a] = val;
            this.data[((n - b) % n) * n + ((n - a) % n)] = val;
        };
        const iu = Math.floor(u), iv = Math.floor(v);
        for (let b = iv - Math.ceil(rad); b <= iv + Math.ceil(rad); b++) {
            for (let a = iu - Math.ceil(rad); a <= iu + Math.ceil(rad); a++) {
                if (Math.hypot(a - iu, b - iv) <= rad + 1e-9) set(a, b);
            }
        }
        this.version++;
    }

    /** Paint along a segment in centred cell coordinates. */
    stroke(u0, v0, u1, v1, r, keep) {
        along(u0, v0, u1, v1, 0.5, (u, v) => this.paint(u, v, r, keep));
    }
}
