// Preset shapes: closed curves in normalised [-1, 1] coordinates (y points down, like the screen)
// and 2D rasters with values in [0, 1]. Pure functions, no p5.

const TAU = Math.PI * 2;

function param(count, fn) {
    return Array.from({ length: count }, (_, i) => fn((TAU * i) / count, i / count));
}

/** Polyline through the given vertices, sampled densely along its edges (closed). */
function polygon(verts, perEdge = 40) {
    const out = [];
    for (let i = 0; i < verts.length; i++) {
        const a = verts[i], b = verts[(i + 1) % verts.length];
        for (let j = 0; j < perEdge; j++) {
            const f = j / perEdge;
            out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        }
    }
    return out;
}

function star() {
    const v = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 0.95 : 0.4;
        v.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    return polygon(v, 30);
}

function spiral() {
    const n = 600;
    return Array.from({ length: n }, (_, i) => {
        const s = i / n;
        const r = 0.95 * (1 - Math.abs(1 - 2 * s));
        const a = 3 * TAU * s;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
}

function signature() {
    const n = 500;
    return Array.from({ length: n }, (_, i) => {
        const s = i / (n - 1);
        const env = Math.exp(-1.2 * s);
        return {
            x: -0.95 + 1.9 * s + 0.12 * Math.sin(TAU * 4 * s),
            y: 0.55 * env * Math.sin(TAU * 2.5 * s) + 0.18 * Math.sin(TAU * 7 * s + 1) * (1 - s * 0.5),
        };
    });
}

/** Curve presets: id -> { label, points() }. */
export const CURVE_PRESETS = [
    { id: 'circle', label: 'circle', points: () => param(256, (t) => ({ x: 0.9 * Math.cos(t), y: 0.9 * Math.sin(t) })) },
    {
        id: 'heart', label: 'heart',
        points: () => param(400, (t) => ({
            x: (16 * Math.sin(t) ** 3) / 17.5,
            y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17.5 + 0.05,
        })),
    },
    { id: 'star', label: 'star', points: star },
    {
        id: 'trefoil', label: 'trefoil',
        points: () => param(400, (t) => ({ x: (Math.sin(t) + 2 * Math.sin(2 * t)) / 3.1, y: (Math.cos(t) - 2 * Math.cos(3 * t)) / 3.1 })),
    },
    {
        id: 'square', label: 'square',
        points: () => polygon([{ x: -0.8, y: -0.8 }, { x: 0.8, y: -0.8 }, { x: 0.8, y: 0.8 }, { x: -0.8, y: 0.8 }], 60),
    },
    { id: 'eight', label: 'figure eight', points: () => param(400, (t) => ({ x: 0.95 * Math.sin(t), y: 0.9 * Math.sin(2 * t) / 2 })) },
    { id: 'spiral', label: 'spiral in-out', points: spiral },
    { id: 'signature', label: 'signature wave', points: signature },
];

export function getCurvePreset(id) {
    return CURVE_PRESETS.find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------------------------
// Rasters

function lcg(seed) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function fromFn(n, fn) {
    const out = new Float64Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = fn((x + 0.5) / n, (y + 0.5) / n, x, y);
    return out;
}

/** Distance from (px,py) to the segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Hand-drawn capital A, used when no text rasteriser is available. */
export function glyphA(n) {
    return fromFn(n, (u, v) => {
        const w = 0.055;
        const d = Math.min(
            segDist(u, v, 0.5, 0.12, 0.2, 0.88),
            segDist(u, v, 0.5, 0.12, 0.8, 0.88),
            segDist(u, v, 0.31, 0.64, 0.69, 0.64),
        );
        return Math.max(0, Math.min(1, (w - d) / (1 / n) + 0.5));
    });
}

let noiseCounter = 1;

/** Raster presets (all but 'text', which needs p5, see textPreset). id -> { label, make(n) }. */
export const RASTER_PRESETS = [
    { id: 'disc', label: 'disc', make: (n) => fromFn(n, (u, v) => (Math.hypot(u - 0.5, v - 0.5) <= 0.3 ? 1 : 0)) },
    {
        id: 'ring', label: 'ring',
        make: (n) => fromFn(n, (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5); return r <= 0.38 && r >= 0.25 ? 1 : 0; }),
    },
    { id: 'square', label: 'square', make: (n) => fromFn(n, (u, v) => (Math.abs(u - 0.5) <= 0.25 && Math.abs(v - 0.5) <= 0.25 ? 1 : 0)) },
    {
        id: 'checker', label: 'checker',
        make: (n) => { const c = Math.max(1, n >> 3); return fromFn(n, (u, v, x, y) => ((Math.floor(x / c) + Math.floor(y / c)) % 2 ? 1 : 0)); },
    },
    { id: 'gradient', label: 'gradient', make: (n) => fromFn(n, (u, v) => (u + v) / 2) },
    {
        id: 'cross', label: 'cross',
        make: (n) => fromFn(n, (u, v) => (Math.abs(u - 0.5) <= 0.07 || Math.abs(v - 0.5) <= 0.07 ? 1 : 0) * (Math.abs(u - 0.5) <= 0.4 && Math.abs(v - 0.5) <= 0.4 ? 1 : 0)),
    },
    { id: 'text', label: "text 'A'", make: (n) => glyphA(n) },
    {
        id: 'noise', label: 'noise',
        make: (n) => { const r = lcg(1234 + 7919 * noiseCounter++); return fromFn(n, () => r()); },
    },
];

export function getRasterPreset(id) {
    return RASTER_PRESETS.find((p) => p.id === id) || null;
}

/**
 * Rasterise the letter 'A' with a p5 offscreen graphics when available; any failure (or an
 * empty result, as under the mock) falls back to the hand-drawn glyph.
 */
export function textPreset(p, n) {
    try {
        const g = p.createGraphics(n, n);
        if (g.pixelDensity) g.pixelDensity(1);
        g.background(0);
        g.noStroke();
        g.fill(255);
        if (g.textAlign) g.textAlign(p.CENTER, p.CENTER);
        g.textSize(n * 0.85);
        g.text('A', n / 2, n / 2 + n * 0.04);
        g.loadPixels();
        const out = new Float64Array(n * n);
        let sum = 0;
        if (g.pixels && g.pixels.length >= n * n * 4) {
            for (let i = 0; i < n * n; i++) { out[i] = g.pixels[i * 4] / 255; sum += out[i]; }
        }
        if (g.remove) g.remove();
        if (sum > 0.01 * n * n) return out;
    } catch { /* fall through to the geometric glyph */ }
    return glyphA(n);
}
