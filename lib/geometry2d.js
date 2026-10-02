// Pure 2D geometry for circles, homothety centres and common tangents (no DOM, no p5).
//
//   circle      { x, y, r }
//   line        { nx, ny, d }  with unit normal (nx, ny): the set  nx*X + ny*Y = d
//   point       [x, y]

const EPS = 1e-12;

// ---------- vectors ----------
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const norm = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const perp = (a) => [-a[1], a[0]];
/** Unit vector, or null for a (near-)zero or non-finite vector. */
export function unit(a) {
    const n = norm(a);
    return n > 0 && Number.isFinite(n) ? [a[0] / n, a[1] / n] : null;
}
export const center = (c) => [c.x, c.y];

// ---------- homothety centres ----------

/**
 * Centres of the two homotheties mapping c1 onto c2.
 * external (positive ratio, the "exsimilicenter"): null when r1 == r2 (point at infinity, see
 * externalDirection) or when the circles coincide.  internal (negative ratio): null when the circles
 * coincide (or r1 + r2 == 0).
 */
export function homothetyCenters(c1, c2) {
    const tol = EPS * Math.max(1, Math.abs(c1.r), Math.abs(c2.r));
    const coincident = Math.abs(c1.r - c2.r) <= tol && Math.hypot(c1.x - c2.x, c1.y - c2.y) <= tol;
    let external = null;
    if (Math.abs(c1.r - c2.r) > tol) {
        const k = c1.r - c2.r;
        external = [(c1.r * c2.x - c2.r * c1.x) / k, (c1.r * c2.y - c2.r * c1.y) / k];
    }
    let internal = null;
    const s = c1.r + c2.r;
    if (!coincident && Math.abs(s) > tol) internal = [(c1.r * c2.x + c2.r * c1.x) / s, (c1.r * c2.y + c2.r * c1.y) / s];
    return { external, internal };
}

/** Direction (unit vector) of the external homothety centre at infinity when r1 == r2, else null. */
export function externalDirection(c1, c2) {
    const tol = EPS * Math.max(1, Math.abs(c1.r), Math.abs(c2.r));
    if (Math.abs(c1.r - c2.r) > tol) return null;
    return unit([c2.x - c1.x, c2.y - c1.y]);
}

// ---------- lines ----------

/** Line through two distinct points, or null. */
export function lineThrough(p, q) {
    const u = unit(sub(q, p));
    if (!u) return null;
    const nx = -u[1], ny = u[0];
    return { nx, ny, d: nx * p[0] + ny * p[1] };
}

/** Line through p with direction dir. */
export function lineFromPointDir(p, dir) {
    const u = unit(dir);
    if (!u) return null;
    return { nx: -u[1], ny: u[0], d: -u[1] * p[0] + u[0] * p[1] };
}

/** Intersection of two lines, or null when (nearly) parallel. */
export function lineIntersection(l1, l2) {
    const det = l1.nx * l2.ny - l1.ny * l2.nx;
    if (Math.abs(det) < 1e-14) return null;
    return [(l1.d * l2.ny - l2.d * l1.ny) / det, (l1.nx * l2.d - l2.nx * l1.d) / det];
}

/** Signed distance of a point from a line. */
export const lineDistance = (l, p) => l.nx * p[0] + l.ny * p[1] - l.d;

/** Radical axis of two circles, or null for concentric circles. */
export function radicalAxis(c1, c2) {
    const L = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    if (!(L > 0)) return null;
    const rhs = (c2.x * c2.x + c2.y * c2.y - c1.x * c1.x - c1.y * c1.y - c2.r * c2.r + c1.r * c1.r) / 2;
    return { nx: (c2.x - c1.x) / L, ny: (c2.y - c1.y) / L, d: rhs / L };
}

// ---------- collinearity ----------

/** Signed area of triangle pqr. */
export function signedArea(p, q, r) {
    return 0.5 * cross(sub(q, p), sub(r, p));
}

/**
 * Scale-free collinearity measure: twice the triangle area over the squared longest side.
 * 0 for collinear or coincident points, at most sqrt(3)/2 (equilateral).
 */
export function collinearityResidual(p, q, r) {
    const m = Math.max(dist(p, q), dist(q, r), dist(p, r));
    if (!(m > 0) || !Number.isFinite(m)) return 0;
    return Math.abs(2 * signedArea(p, q, r)) / (m * m);
}

/**
 * Total-least-squares line through points: { line, point (centroid), dir, rms } or null for < 2
 * distinct points.
 */
export function fitLine(points) {
    const n = points.length;
    if (n < 2) return null;
    let mx = 0, my = 0;
    for (const p of points) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of points) {
        const dx = p[0] - mx, dy = p[1] - my;
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (!(sxx + syy > 0) || !Number.isFinite(sxx + syy)) return null;
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dir = [Math.cos(theta), Math.sin(theta)];
    const line = lineFromPointDir([mx, my], dir);
    let ss = 0;
    for (const p of points) ss += lineDistance(line, p) ** 2;
    return { line, point: [mx, my], dir, rms: Math.sqrt(ss / n) };
}

// ---------- common tangents ----------

/**
 * Real common tangent lines of two circles. Each entry:
 *   { kind: 'external' | 'internal', line, p1, p2 }
 * p1 / p2 are the points of tangency on c1 / c2. Only REAL tangents are returned (0 to 4);
 * coincident or concentric circles have none; a double tangent (touching case) is returned once.
 */
export function commonTangents(c1, c2) {
    const D = [c2.x - c1.x, c2.y - c1.y];
    const L = norm(D);
    const tol = EPS * Math.max(1, Math.abs(c1.r), Math.abs(c2.r), L);
    if (!(L > tol)) return [];
    const u = [D[0] / L, D[1] / L];
    const v = perp(u);
    const out = [];
    for (const kind of ['external', 'internal']) {
        const a = (kind === 'external' ? c2.r - c1.r : -(c1.r + c2.r)) / L;
        const b2 = 1 - a * a;
        if (b2 < -1e-12) continue;
        const b = Math.sqrt(Math.max(0, b2));
        const signs = b < 1e-7 ? [1] : [1, -1];
        for (const s of signs) {
            const n = [a * u[0] + s * b * v[0], a * u[1] + s * b * v[1]];
            const d = n[0] * c1.x + n[1] * c1.y - c1.r;
            const p1 = [c1.x - c1.r * n[0], c1.y - c1.r * n[1]];
            const k = kind === 'external' ? -1 : 1;
            const p2 = [c2.x + k * c2.r * n[0], c2.y + k * c2.r * n[1]];
            out.push({ kind, line: { nx: n[0], ny: n[1], d }, p1, p2 });
        }
    }
    return out;
}

// ---------- Monge configuration ----------

/** Pairs of three circles in a fixed order. */
export const PAIRS = [[0, 1], [0, 2], [1, 2]];

/**
 * All homothety data of three circles. Returns
 *   { E: [e12, e13, e23], I: [i12, i13, i23], dir: [d12, d13, d23] }
 * where E[k] is a point or null (null when radii are equal; then dir[k] is the direction at infinity).
 */
export function mongeData(circles) {
    const E = [], I = [], dir = [];
    for (const [i, j] of PAIRS) {
        const h = homothetyCenters(circles[i], circles[j]);
        E.push(h.external);
        I.push(h.internal);
        dir.push(h.external ? null : externalDirection(circles[i], circles[j]));
    }
    return { E, I, dir };
}

/**
 * The Monge line through the finite exsimilicenters: { line, residual, rms } or null when fewer than two
 * are finite (all radii equal: the line is at infinity). With one exsimilicenter at infinity the line
 * through the other two is parallel to that direction.
 */
export function mongeLine(data) {
    const pts = data.E.filter(Boolean);
    if (pts.length < 2) return null;
    const fit = fitLine(pts);
    if (!fit) return null;
    const residual = pts.length === 3 ? collinearityResidual(pts[0], pts[1], pts[2]) : 0;
    return { line: fit.line, residual, rms: fit.rms };
}

/**
 * The four classic collinear triples: the three exsimilicenters, and each exsimilicenter with the two
 * insimilicenters of the other pairs. Each entry is { name, pts: [point|null x 3] }.
 */
export function collinearTriples(data) {
    const { E, I } = data;
    return [
        { name: 'E12 E13 E23', pts: [E[0], E[1], E[2]] },
        { name: 'E12 I13 I23', pts: [E[0], I[1], I[2]] },
        { name: 'E13 I12 I23', pts: [E[1], I[0], I[2]] },
        { name: 'E23 I12 I13', pts: [E[2], I[0], I[1]] },
    ];
}

// ---------- clipping ----------

/** Clip an infinite line to the rectangle [x0,x1]x[y0,y1]; returns [p, q] or null. */
export function clipLine(line, x0, x1, y0, y1) {
    const p = [line.nx * line.d, line.ny * line.d];
    const dx = -line.ny, dy = line.nx;
    let tmin = -Infinity, tmax = Infinity;
    const slab = (pos, dd, lo, hi) => {
        if (Math.abs(dd) < 1e-300) return pos >= lo && pos <= hi;
        let t0 = (lo - pos) / dd, t1 = (hi - pos) / dd;
        if (t0 > t1) [t0, t1] = [t1, t0];
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
        return true;
    };
    if (!slab(p[0], dx, x0, x1) || !slab(p[1], dy, y0, y1)) return null;
    if (!(tmin <= tmax) || !Number.isFinite(tmin) || !Number.isFinite(tmax)) return null;
    return [[p[0] + tmin * dx, p[1] + tmin * dy], [p[0] + tmax * dx, p[1] + tmax * dy]];
}
