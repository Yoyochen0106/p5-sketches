// Equal-area transformations of polygons (pure maths, no p5 / DOM).
//
// Points are plain {x, y} objects in a y-up coordinate system. Polygons are arrays of points
// (implicitly closed). The one move used everywhere is the SHEAR: a vertex slides along the line
// through it parallel to the chord joining its two neighbours. The chord (base) and its distance
// to the vertex (height) do not change, so the area does not change either.
//
// Exports:
//   geometry     signedArea, area, centroid, slideConstraint, projectOnLine, slideVertex, isSimple
//   reduction    reduceStep, reduceToTriangle
//   quadrature   triangleToRectangle, rectangleToSquare, quadratureSteps, areaOf
//   lattice      gcd, isLatticePolygon, primitiveStep, latticePoints, pickInfo
//   helpers      clipLineToBox, easeInOut, label

const EPS = 1e-9;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const mid = (a, b) => lerp(a, b, 0.5);
const unit = (a) => {
    const l = len(a);
    return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
const perp = (a) => ({ x: -a.y, y: a.x });
const copy = (poly) => poly.map((v) => ({ x: v.x, y: v.y }));

/** Vertex label A, B, C, ... (wraps after Z). */
export function label(i) {
    return String.fromCharCode(65 + (((i % 26) + 26) % 26));
}

/** Smooth ease in/out on [0, 1]. */
export function easeInOut(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------------------------
// Basic geometry

/** Shoelace signed area: positive for counter-clockwise polygons (y up). */
export function signedArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        s += a.x * b.y - b.x * a.y;
    }
    return s / 2;
}

/** Absolute area. */
export function area(poly) {
    return Math.abs(signedArea(poly));
}

/** Area centroid; falls back to the vertex mean for degenerate polygons. */
export function centroid(poly) {
    const A = signedArea(poly);
    if (Math.abs(A) < 1e-12) {
        const n = Math.max(1, poly.length);
        return { x: poly.reduce((s, v) => s + v.x, 0) / n, y: poly.reduce((s, v) => s + v.y, 0) / n };
    }
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const f = a.x * b.y - b.x * a.y;
        cx += (a.x + b.x) * f;
        cy += (a.y + b.y) * f;
    }
    return { x: cx / (6 * A), y: cy / (6 * A) };
}

/**
 * The line along which vertex i may slide without changing the area: it passes through the vertex
 * and is parallel to the chord between its neighbours (for a triangle: the opposite side).
 * @returns {{point: {x,y}, dir: {x,y}}} dir is a unit vector
 */
export function slideConstraint(poly, i) {
    const n = poly.length;
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    return { point: { x: poly[i].x, y: poly[i].y }, dir: unit(sub(next, prev)) };
}

/** Orthogonal projection of q onto a {point, dir} line. */
export function projectOnLine(line, q) {
    const t = dot(sub(q, line.point), line.dir);
    return add(line.point, mul(line.dir, t));
}

/** New polygon where vertex i has slid to the projection of `target` on its constraint line. */
export function slideVertex(poly, i, target) {
    const out = copy(poly);
    out[i] = projectOnLine(slideConstraint(poly, i), target);
    return out;
}

/** Parameter interval [t0, t1] of line.point + t*line.dir inside the box, or null. */
export function clipLineToBox(line, box) {
    let t0 = -Infinity;
    let t1 = Infinity;
    const axes = [
        [line.point.x, line.dir.x, box.xmin, box.xmax],
        [line.point.y, line.dir.y, box.ymin, box.ymax],
    ];
    for (const [p0, d, lo, hi] of axes) {
        if (Math.abs(d) < 1e-12) {
            if (p0 < lo || p0 > hi) return null;
        } else {
            let a = (lo - p0) / d;
            let b = (hi - p0) / d;
            if (a > b) [a, b] = [b, a];
            t0 = Math.max(t0, a);
            t1 = Math.min(t1, b);
        }
    }
    return t0 <= t1 ? [t0, t1] : null;
}

function orient(a, b, c) {
    return cross(sub(b, a), sub(c, a));
}

function onSegment(a, b, p, tol) {
    return p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol
        && p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol;
}

/** Closed segments ab and cd share at least one point (touching counts). */
function segmentsTouch(a, b, c, d, tol) {
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    const s = (v) => (Math.abs(v) <= tol ? 0 : Math.sign(v));
    const [s1, s2, s3, s4] = [s(o1), s(o2), s(o3), s(o4)];
    if (s1 !== s2 && s3 !== s4 && s1 * s2 <= 0 && s3 * s4 <= 0) {
        if (s1 !== 0 || s2 !== 0 || s3 !== 0 || s4 !== 0) return true;
    }
    if (s1 === 0 && onSegment(a, b, c, tol)) return true;
    if (s2 === 0 && onSegment(a, b, d, tol)) return true;
    if (s3 === 0 && onSegment(c, d, a, tol)) return true;
    if (s4 === 0 && onSegment(c, d, b, tol)) return true;
    return false;
}

/**
 * True when the closed polygon does not cross or touch itself (adjacent edges may only meet in
 * their shared vertex; a fold-back along the same line counts as touching).
 */
export function isSimple(poly) {
    const n = poly.length;
    if (n < 3) return false;
    let scale = 0;
    for (const v of poly) scale = Math.max(scale, Math.abs(v.x), Math.abs(v.y));
    const tol = EPS * Math.max(1, scale * scale);
    for (let i = 0; i < n; i++) {
        if (len(sub(poly[(i + 1) % n], poly[i])) < 1e-12) return false;
    }
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            const c = poly[j];
            const d = poly[(j + 1) % n];
            const adjacent = j === i + 1 || (i === 0 && j === n - 1);
            if (adjacent) {
                // shared vertex: b == c (j = i + 1) or a == d (wrap-around)
                const shared = j === i + 1 ? b : a;
                const e1 = j === i + 1 ? a : b;
                const e2 = j === i + 1 ? d : c;
                const u = sub(e1, shared);
                const w = sub(e2, shared);
                if (Math.abs(cross(u, w)) <= tol && dot(u, w) > 0) return false; // fold-back
            } else if (segmentsTouch(a, b, c, d, tol)) {
                return false;
            }
        }
    }
    return true;
}

// ---------------------------------------------------------------------------------------------
// Reducing a polygon vertex by vertex

function polygonScale(poly) {
    let s = 1e-9;
    for (const v of poly) s = Math.max(s, Math.abs(v.x), Math.abs(v.y));
    return s;
}

function without(poly, k) {
    return poly.filter((_, idx) => idx !== k);
}

/**
 * Remove one vertex without changing the area.
 *
 * Vertex i slides along the line parallel to the chord (i-1, i+1) until it lies on the line of
 * the edge (i-2, i-1) ["back"] or (i+1, i+2) ["forward"]; the neighbour that is now collinear
 * (i-1 resp. i+1) is redundant and is dropped. Every candidate (i, direction) is scored by the
 * length of the slide; candidates are ranked: (1) result simple and the whole slide keeps the
 * polygon simple, (2) result simple, (3) anything with equal area. Convex and concave polygons
 * are handled the same way. A vertex that is already collinear with its neighbours is simply
 * dropped (no motion).
 *
 * Limits: input should be a simple polygon with >= 4 vertices. For non-simple input the area is
 * still preserved (it is the signed shoelace area) but no simplicity guarantee is made. When all
 * guide lines are parallel (degenerate, e.g. zero-area input) the function throws.
 *
 * @returns {{polygon, before, slid, moved:{index,from,to}, removed:number, movedIndexAfter:number,
 *   guide:{point,dir}, target:{a,b}|null, rationale:string, simple:boolean, pathSimple:boolean}}
 */
export function reduceStep(poly) {
    const n = poly.length;
    if (n <= 3) throw new Error('reduceStep: polygon already has 3 or fewer vertices');
    const scale = polygonScale(poly);
    const A0 = signedArea(poly);
    const tolA = 1e-9 * scale * scale;

    // 1. a vertex that is already collinear with its neighbours can just be dropped
    for (let i = 0; i < n; i++) {
        const a = poly[(i - 1 + n) % n];
        const b = poly[(i + 1) % n];
        if (Math.abs(orient(a, b, poly[i])) <= 1e-12 * scale * scale) {
            const polygon = without(poly, i);
            return {
                polygon, before: copy(poly), slid: copy(poly),
                moved: { index: i, from: { ...poly[i] }, to: { ...poly[i] } },
                removed: i, movedIndexAfter: -1,
                guide: slideConstraint(poly, i), target: null,
                rationale: `Vertex ${label(i)} already lies on the line through its neighbours, so it is simply dropped.`,
                simple: isSimple(polygon), pathSimple: true,
            };
        }
    }

    // 2. enumerate candidates
    let best = null;
    for (let i = 0; i < n; i++) {
        const V = poly[i];
        const prev = poly[(i - 1 + n) % n];
        const next = poly[(i + 1) % n];
        const chord = sub(next, prev);
        if (len(chord) < 1e-12) continue;
        const dir = unit(chord);
        for (const side of ['back', 'forward']) {
            const iq1 = side === 'back' ? (i - 2 + n) % n : (i + 1) % n;
            const iq2 = side === 'back' ? (i - 1 + n) % n : (i + 2) % n;
            const removed = side === 'back' ? iq2 : iq1;
            const q1 = poly[iq1];
            const q2 = poly[iq2];
            const d2 = sub(q2, q1);
            const denom = cross(d2, dir);
            if (Math.abs(denom) < 1e-9 * len(d2)) continue; // parallel: never meets
            const t = -cross(d2, sub(V, q1)) / denom;
            if (!Number.isFinite(t)) continue;
            const to = add(V, mul(dir, t));
            const slid = copy(poly);
            slid[i] = to;
            const polygon = without(slid, removed);
            if (Math.abs(signedArea(polygon) - A0) > Math.max(tolA, 1e-9 * Math.abs(A0))) continue;
            const simple = isSimple(polygon);
            let pathSimple = simple;
            for (let k = 1; k <= 7 && pathSimple; k++) {
                const mid1 = copy(poly);
                mid1[i] = add(V, mul(dir, (t * k) / 8));
                pathSimple = isSimple(mid1);
            }
            const tier = simple && pathSimple ? 0 : simple ? 1 : 2;
            const cost = Math.abs(t);
            if (!best || tier < best.tier || (tier === best.tier && cost < best.cost - 1e-12)) {
                best = {
                    tier, cost, i, side, removed, from: { ...V }, to, slid, polygon, dir,
                    target: { a: { ...q1 }, b: { ...q2 } }, simple, pathSimple,
                    prevIndex: (i - 1 + n) % n, nextIndex: (i + 1) % n,
                };
            }
        }
    }
    if (!best) throw new Error('reduceStep: no area-preserving reduction found (degenerate polygon)');

    const movedIndexAfter = best.i - (best.removed < best.i ? 1 : 0);
    const q1 = label(best.side === 'back' ? (best.i - 2 + n) % n : (best.i + 1) % n);
    const q2 = label(best.side === 'back' ? (best.i - 1 + n) % n : (best.i + 2) % n);
    const rationale = `Slide ${label(best.i)} parallel to ${label(best.prevIndex)}${label(best.nextIndex)} `
        + `(same base and height, so the same area) until it lies on line ${q1}${q2}; `
        + `then ${label(best.removed)} is redundant and is dropped.`;
    return {
        polygon: best.polygon, before: copy(poly), slid: copy(best.slid),
        moved: { index: best.i, from: best.from, to: { ...best.to } },
        removed: best.removed, movedIndexAfter,
        guide: { point: best.from, dir: best.dir }, target: best.target,
        rationale, simple: best.simple, pathSimple: best.pathSimple,
    };
}

/** All reduction steps from the polygon down to a triangle (empty for triangles). */
export function reduceToTriangle(poly) {
    const steps = [];
    let cur = poly;
    let guard = poly.length + 2;
    while (cur.length > 3 && guard-- > 0) {
        const s = reduceStep(cur);
        steps.push(s);
        cur = s.polygon;
    }
    return steps;
}

// ---------------------------------------------------------------------------------------------
// Quadrature: triangle -> rectangle -> square
//
// A step is { id, caption, at(t) }. at(t), t in [0, 1], returns a draw list:
//   polygons [{pts, role: 'body'|'piece'|'preview'|'ghost', alpha?, name?}]
//   lines    [{a, b, role}]       points [{p, label}]
//   arcs     [{c, r, u, n, a0, a1}]   (points c + r (cos a u + sin a n))
// Role 'body' / 'piece' polygons make up the shape whose area must stay constant.

/** Sum of alpha-weighted areas of the 'body' and 'piece' polygons of a draw list. */
export function areaOf(list) {
    let s = 0;
    for (const pg of list.polygons) {
        if (pg.role === 'body' || pg.role === 'piece') s += (pg.alpha === undefined ? 1 : pg.alpha) * area(pg.pts);
    }
    return s;
}

function rotateAbout(p, c, ang) {
    const co = Math.cos(ang);
    const si = Math.sin(ang);
    const d = sub(p, c);
    return { x: c.x + d.x * co - d.y * si, y: c.y + d.x * si + d.y * co };
}

/** Orders the triangle so that P-Q is the longest side and returns the frame (u along PQ, n up). */
function triangleFrame(tri) {
    let best = 0;
    let bl = -1;
    for (let k = 0; k < 3; k++) {
        const l = len(sub(tri[(k + 1) % 3], tri[k]));
        if (l > bl) { bl = l; best = k; }
    }
    const P = tri[best];
    const Q = tri[(best + 1) % 3];
    const R = tri[(best + 2) % 3];
    const u = unit(sub(Q, P));
    let n = perp(u);
    if (dot(n, sub(R, P)) < 0) n = mul(n, -1);
    return { P, Q, R, u, n, b: len(sub(Q, P)), h: Math.abs(dot(sub(R, P), n)) };
}

/**
 * Triangle -> parallelogram (cut along the midline, half-turn of the top piece about the midpoint
 * of a side) -> rectangle (shear along the base-parallel line; base kept, height h/2).
 */
export function triangleToRectangle(tri) {
    const { P, Q, R, n, h } = triangleFrame(tri);
    const M = mid(P, R);
    const N = mid(Q, R);
    const Mp = add(Q, mul(sub(R, P), 0.5)); // M after the half-turn about N
    const half = h / 2;
    const Mr = add(P, mul(n, half));
    const Mpr = add(Q, mul(n, half));
    const pts = (...ps) => ps.map((p) => ({ x: p.x, y: p.y }));
    const rect = pts(P, Q, Mpr, Mr);
    return [
        {
            id: 'midline',
            caption: 'Cut the triangle along its midline MN (parallel to the base, half the height).',
            at(t) {
                return {
                    polygons: [{ pts: pts(P, Q, R), role: 'body', name: 'triangle' }],
                    lines: [{ a: M, b: lerp(M, N, t), role: 'construction' }],
                    points: [{ p: P, label: 'A' }, { p: Q, label: 'B' }, { p: R, label: 'C' }, { p: M, label: 'M' }, { p: N, label: t >= 1 ? 'N' : '' }],
                    arcs: [],
                };
            },
        },
        {
            id: 'half-turn',
            caption: 'Rotate the small top triangle by a half-turn about N: it lands beside the trapezoid and forms a parallelogram of the same area.',
            at(t) {
                const ang = Math.PI * t;
                const top = pts(R, M, N).map((p) => rotateAbout(p, N, ang));
                return {
                    polygons: [
                        { pts: pts(P, Q, N, M), role: 'body', name: 'trapezoid' },
                        { pts: top, role: 'piece', name: 'top' },
                    ],
                    lines: [{ a: M, b: N, role: 'construction' }],
                    points: [{ p: P, label: 'A' }, { p: Q, label: 'B' }, { p: N, label: 'N' }, { p: rotateAbout(M, N, ang), label: "M'" }, { p: top[0], label: t >= 1 ? '' : "C'" }],
                    arcs: [],
                };
            },
            result: pts(P, Q, Mp, M),
        },
        {
            id: 'shear',
            caption: 'Shear the parallelogram along the line through its top edge: base and height are unchanged, so the area is too. Stop when the sides are vertical.',
            at(t) {
                const a = lerp(Mp, Mpr, t);
                const b = lerp(M, Mr, t);
                const dirTop = unit(sub(Mp, M));
                return {
                    polygons: [{ pts: pts(P, Q, a, b), role: 'body', name: 'parallelogram' }],
                    lines: [{ a: sub(M, mul(dirTop, 2)), b: add(Mp, mul(dirTop, 2)), role: 'guide' }],
                    points: [{ p: P, label: 'A' }, { p: Q, label: 'B' }, { p: a, label: '' }, { p: b, label: '' }],
                    arcs: [],
                };
            },
            result: rect,
        },
    ].map((s, k, all) => ({ ...s, result: s.result || (k === 0 ? pts(P, Q, R) : rect), final: k === all.length - 1 }));
}

/**
 * Rectangle -> square of the same area. Classic construction: extend the base AB by the height to
 * E, draw the semicircle on AE, erect the perpendicular at B; it meets the circle at F with
 * BF^2 = AB * BE (altitude theorem), so the square on BF has the rectangle's area.
 * @param rect four corners A, B, C, D in order (AB the base, BC the height side)
 */
export function rectangleToSquare(rect) {
    const [A, B, , D] = rect;
    const u = unit(sub(B, A));
    let n = perp(u);
    if (dot(n, sub(D, A)) < 0) n = mul(n, -1);
    const a = len(sub(B, A));
    const b = Math.abs(dot(sub(D, A), n));
    const E = add(B, mul(u, b));
    const O = mid(A, E);
    const r = (a + b) / 2;
    const s = Math.sqrt(a * b);
    const F = add(B, mul(n, s));
    const pts = (...ps) => ps.map((p) => ({ x: p.x, y: p.y }));
    const rectPts = pts(rect[0], rect[1], rect[2], rect[3]);
    const squareAtB = pts(B, add(B, mul(u, s)), add(add(B, mul(u, s)), mul(n, s)), F);
    const cRect = centroid(rectPts);
    const cSq = centroid(squareAtB);
    const shift = sub(cRect, cSq);
    const squareFinal = squareAtB.map((p) => add(p, shift));
    const basePts = [{ p: A, label: 'A' }, { p: B, label: 'B' }];
    const body = () => ({ pts: rectPts, role: 'body', name: 'rectangle' });
    return [
        {
            id: 'extend',
            caption: 'Extend the base AB by the height of the rectangle: BE = BC.',
            at(t) {
                return {
                    polygons: [body()],
                    lines: [{ a: B, b: lerp(B, E, t), role: 'construction' }],
                    points: [...basePts, { p: rect[2], label: 'C' }, ...(t >= 1 ? [{ p: E, label: 'E' }] : [])],
                    arcs: [],
                };
            },
        },
        {
            id: 'semicircle',
            caption: 'Draw the semicircle on the diameter AE.',
            at(t) {
                return {
                    polygons: [body()],
                    lines: [{ a: B, b: E, role: 'construction' }],
                    points: [...basePts, { p: E, label: 'E' }, { p: O, label: 'O' }],
                    arcs: [{ c: O, r, u, n, a0: Math.PI, a1: Math.PI * (1 - t) }],
                };
            },
        },
        {
            id: 'perpendicular',
            caption: 'Erect the perpendicular at B. It meets the semicircle at F, and BF squared equals AB times BE (altitude theorem).',
            at(t) {
                return {
                    polygons: [body()],
                    lines: [{ a: B, b: E, role: 'construction' }, { a: B, b: lerp(B, F, t), role: 'height' }],
                    points: [...basePts, { p: E, label: 'E' }, ...(t >= 1 ? [{ p: F, label: 'F' }] : [])],
                    arcs: [{ c: O, r, u, n, a0: Math.PI, a1: 0 }],
                };
            },
        },
        {
            id: 'square',
            caption: 'Build the square on BF. Its side is the geometric mean of the rectangle sides.',
            at(t) {
                const grown = squareAtB.map((p) => lerp(B, p, t));
                return {
                    polygons: [body(), { pts: grown, role: 'preview', name: 'square' }],
                    lines: [{ a: B, b: E, role: 'construction' }, { a: B, b: F, role: 'height' }],
                    points: [...basePts, { p: E, label: 'E' }, { p: F, label: 'F' }],
                    arcs: [{ c: O, r, u, n, a0: Math.PI, a1: 0 }],
                };
            },
        },
        {
            id: 'swap',
            caption: 'Rectangle and square have the same area: the square has side sqrt(area).',
            at(t) {
                const sq = squareAtB.map((p) => add(p, mul(shift, t)));
                return {
                    polygons: [
                        { pts: rectPts, role: 'body', alpha: 1 - t, name: 'rectangle' },
                        { pts: sq, role: 'body', alpha: t, name: 'square' },
                    ],
                    lines: [], points: [], arcs: [],
                };
            },
            result: squareFinal,
        },
    ].map((st, k, all) => ({
        ...st,
        result: st.result || squareAtB,
        final: k === all.length - 1,
        info: { a, b, side: s, E, F, O, r },
    }));
}

/** Triangle -> rectangle -> square as one list of steps. */
export function quadratureSteps(tri) {
    const first = triangleToRectangle(tri);
    const rect = first[first.length - 1].result;
    return [...first.map((s) => ({ ...s, final: false })), ...rectangleToSquare(rect)];
}

// ---------------------------------------------------------------------------------------------
// Lattice / Pick

/** Greatest common divisor of two integers (non-negative result). */
export function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a;
}

const nearInt = (v) => Math.abs(v - Math.round(v)) < 1e-9;

/** True when every vertex has integer coordinates. */
export function isLatticePolygon(poly) {
    return poly.every((v) => nearInt(v.x) && nearInt(v.y));
}

/**
 * Smallest integer step (dx, dy) along the slide line of vertex i (the chord of its neighbours),
 * or null when the chord has no lattice direction (non-lattice neighbours or zero length).
 */
export function primitiveStep(poly, i) {
    const n = poly.length;
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    const dx = Math.round(next.x - prev.x);
    const dy = Math.round(next.y - prev.y);
    if (!nearInt(next.x - prev.x) || !nearInt(next.y - prev.y)) return null;
    const g = gcd(dx, dy);
    return g === 0 ? null : { x: dx / g, y: dy / g };
}

function pointInPolygonStrict(poly, p) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function onBoundary(poly, p) {
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (Math.abs(orient(a, b, p)) < 1e-9 && onSegment(a, b, p, 1e-9)) return true;
    }
    return false;
}

/** Integer points on the boundary and strictly inside a lattice polygon. */
export function latticePoints(poly) {
    const boundary = [];
    const interior = [];
    if (!poly.length) return { boundary, interior };
    const xs = poly.map((v) => Math.round(v.x));
    const ys = poly.map((v) => Math.round(v.y));
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 40000) return { boundary, interior };
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            const p = { x, y };
            if (onBoundary(poly, p)) boundary.push(p);
            else if (pointInPolygonStrict(poly, p)) interior.push(p);
        }
    }
    return { boundary, interior };
}

/**
 * Pick's theorem for a simple lattice polygon: A = I + B/2 - 1.
 * Returns null for non-lattice polygons. `boundary` is computed from gcds of the edge vectors.
 */
export function pickInfo(poly) {
    if (!poly.length || !isLatticePolygon(poly)) return null;
    let B = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        B += gcd(b.x - a.x, b.y - a.y);
    }
    const twiceArea = Math.round(2 * area(poly));
    const I = (twiceArea - B + 2) / 2;
    return { boundary: B, interior: I, area: twiceArea / 2 };
}
