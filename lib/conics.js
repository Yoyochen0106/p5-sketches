// Conics in the projective plane and Poncelet chains (pure maths, no p5/DOM).
//
// A conic is a symmetric 3x3 matrix M (array of 3 rows) with  [x y 1] M [x y 1]^T = 0.
// "Ellipse parameters" are { cx, cy, a, b, rot }: centre, semi-axes, rotation (radians, ccw).
//
// Poncelet chain: from P0 on the outer conic C draw the tangent to the inner conic D with D on the
// left of the directed line, intersect it again with C to get P1, and so on (counter-clockwise).

const TAU = 2 * Math.PI;
const EPS = 1e-12;

// ---------- small matrix helpers ----------

const mulMV = (M, v) => [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const transpose = (M) => M[0].map((_, j) => M.map((row) => row[j]));
const mulMM = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));

/** Determinant of a 3x3 matrix. */
export function det3(M) {
    return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
        - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
        + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
}

/** Determinant of a square matrix (Gaussian elimination, partial pivoting). Empty matrix -> 1. */
export function detN(A) {
    const n = A.length;
    const M = A.map((r) => r.slice());
    let d = 1;
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        if (M[piv][c] === 0) return 0;
        if (piv !== c) { [M[piv], M[c]] = [M[c], M[piv]]; d = -d; }
        d *= M[c][c];
        for (let r = c + 1; r < n; r++) {
            const f = M[r][c] / M[c][c];
            for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
        }
    }
    return d;
}

// ---------- constructors ----------

/** Conic Ax^2 + Bxy + Cy^2 + Dx + Ey + F = 0. */
export function conicFromGeneral(A, B, C, D, E, F) {
    return [[A, B / 2, D / 2], [B / 2, C, E / 2], [D / 2, E / 2, F]];
}

/** Matrix of a conic given in local coordinates after rotation by rot and translation to (cx, cy). */
function placed(M0, cx, cy, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    // local = R^T (world - c)  =>  local_h = T world_h
    const T = [[c, s, -(c * cx + s * cy)], [-s, c, s * cx - c * cy], [0, 0, 1]];
    return mulMM(transpose(T), mulMM(M0, T));
}

export const conicFromCircle = (cx, cy, r) => conicFromEllipse(cx, cy, r, r, 0);

export function conicFromEllipse(cx, cy, a, b, rot = 0) {
    return placed([[1 / (a * a), 0, 0], [0, 1 / (b * b), 0], [0, 0, -1]], cx, cy, rot);
}

export const conicFromEllipseParams = (e) => conicFromEllipse(e.cx, e.cy, e.a, e.b, e.rot || 0);

/** x'^2/a^2 - y'^2/b^2 = 1 in the local frame. */
export function conicFromHyperbola(cx, cy, a, b, rot = 0) {
    return placed([[1 / (a * a), 0, 0], [0, -1 / (b * b), 0], [0, 0, -1]], cx, cy, rot);
}

/** Parabola x'^2 = 4 f y' with vertex (cx, cy), axis along the rotated y axis. */
export function conicFromParabola(cx, cy, f, rot = 0) {
    return placed([[1, 0, 0], [0, 0, -2 * f], [0, -2 * f, 0]], cx, cy, rot);
}

/** Value of the quadratic form at (x, y). */
export function evalConic(M, x, y) {
    const v = [x, y, 1];
    return dot3(v, mulMV(M, v));
}

/** Centre of a central conic, or null for a parabola / degenerate case. */
export function conicCentre(M) {
    const d = M[0][0] * M[1][1] - M[0][1] * M[0][1];
    const scale = Math.abs(M[0][0]) + Math.abs(M[1][1]) + Math.abs(M[0][1]);
    if (!(Math.abs(d) > 1e-12 * scale * scale)) return null;
    const rx = -M[0][2], ry = -M[1][2];
    return [(rx * M[1][1] - M[0][1] * ry) / d, (M[0][0] * ry - M[0][1] * rx) / d];
}

// ---------- ellipse parametrisation ----------

/** Point of the ellipse at eccentric angle t. */
export function ellipsePoint(e, t) {
    const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0);
    const u = e.a * Math.cos(t), v = e.b * Math.sin(t);
    return [e.cx + c * u - s * v, e.cy + s * u + c * v];
}

/** Eccentric angle in (-pi, pi] of the point of the ellipse nearest (radially) to (x, y). */
export function ellipseAngle(e, x, y) {
    const c = Math.cos(e.rot || 0), s = Math.sin(e.rot || 0);
    const dx = x - e.cx, dy = y - e.cy;
    return Math.atan2((-s * dx + c * dy) / e.b, (c * dx + s * dy) / e.a);
}

// ---------- lines and conics ----------

/** Intersections of the line through P with direction d (both 2-vectors) with the conic: parameters t. */
function lineParams(M, P, d) {
    const ph = [P[0], P[1], 1], dh = [d[0], d[1], 0];
    const Md = mulMV(M, dh);
    const al = dot3(dh, Md), be = dot3(ph, Md), ga = dot3(ph, mulMV(M, ph));
    const scale = Math.abs(al) + Math.abs(be) + Math.abs(ga);
    if (!(scale > 0) || !Number.isFinite(scale)) return [];
    if (Math.abs(al) < 1e-13 * scale) {
        if (Math.abs(be) < 1e-13 * scale) return [];
        return [-ga / (2 * be)];
    }
    const disc = be * be - al * ga;
    if (disc < 0) {
        if (disc > -1e-13 * scale * scale) return [-be / al]; // tangent up to rounding
        return [];
    }
    const sq = Math.sqrt(disc);
    const q = -(be + (be >= 0 ? sq : -sq));
    const t1 = q / al, t2 = Math.abs(q) > 0 ? ga / q : t1;
    return t1 <= t2 ? [t1, t2] : [t2, t1];
}

/** Intersection points of a line (a x + b y + c = 0) with a conic (0, 1 or 2 points). */
export function lineConicIntersect(M, line) {
    const [a, b, c] = line;
    const n2 = a * a + b * b;
    if (!(n2 > 0)) return [];
    const Q = [-c * a / n2, -c * b / n2];
    const d = [-b / Math.sqrt(n2), a / Math.sqrt(n2)];
    return lineParams(M, Q, d).map((t) => [Q[0] + t * d[0], Q[1] + t * d[1]]);
}

/** Polar line of point P with respect to the conic, as [a, b, c]. */
export function polarLine(M, P) {
    return mulMV(M, [P[0], P[1], 1]);
}

/**
 * Points of tangency of the tangents from P to the conic (pole / polar). Empty when P is inside
 * (no real tangents); one point when P lies on the conic.
 */
export function tangentPointsFrom(M, P) {
    return lineConicIntersect(M, polarLine(M, P));
}

/** Second intersection of the line P->Q (P on the conic) with the conic; null if parallel to an asymptote. */
export function secondIntersection(M, P, Q) {
    const d = [Q[0] - P[0], Q[1] - P[1]];
    const dh = [d[0], d[1], 0];
    const al = dot3(dh, mulMV(M, dh));
    const be = dot3([P[0], P[1], 1], mulMV(M, dh));
    const scale = Math.abs(al) + Math.abs(be);
    if (!(scale > 0) || Math.abs(al) < 1e-14 * scale) return null;
    const t = -2 * be / al;
    const R = [P[0] + t * d[0], P[1] + t * d[1]];
    return Number.isFinite(R[0] + R[1]) ? R : null;
}

// ---------- Poncelet chain ----------

/**
 * One Poncelet step from P on C: tangent to D with D on the left of the directed line, second
 * intersection with C. `ref` is a point inside D (default: its centre).
 * Returns { Q, T } (next vertex, point of tangency) or null when no real tangent exists.
 */
export function ponceletStep(C, D, P, ref = conicCentre(D)) {
    if (!ref) return null;
    const ts = tangentPointsFrom(D, P);
    if (ts.length < 2) return null;
    const left = (T) => (T[0] - P[0]) * (ref[1] - P[1]) - (T[1] - P[1]) * (ref[0] - P[0]);
    const T = left(ts[0]) > left(ts[1]) ? ts[0] : ts[1];
    if (!(Math.hypot(T[0] - P[0], T[1] - P[1]) > EPS)) return null;
    const Q = secondIntersection(C, P, T);
    return Q ? { Q, T } : null;
}

/** Chain of n steps from P0: { ok, pts: [P0..Pn], touches } (pts truncated at the failing step if !ok). */
export function ponceletChain(C, D, P0, n, ref = conicCentre(D)) {
    const pts = [P0], touches = [];
    for (let k = 0; k < n; k++) {
        const s = ponceletStep(C, D, pts[k], ref);
        if (!s) return { ok: false, pts, touches };
        pts.push(s.Q);
        touches.push(s.T);
    }
    return { ok: true, pts, touches };
}

/**
 * Numerical closure of the n-step chain starting at eccentric angle t0 of the outer ellipse.
 * Returns { ok, residual (|Pn-P0| / outer size), winding (accumulated angle / 2pi), pts, touches }.
 */
export function chainClosure(outer, inner, t0, n) {
    const C = conicFromEllipseParams(outer), D = conicFromEllipseParams(inner);
    const P0 = ellipsePoint(outer, t0);
    const ch = ponceletChain(C, D, P0, n);
    const size = Math.max(outer.a, outer.b);
    if (!ch.ok) return { ok: false, residual: NaN, winding: NaN, pts: ch.pts, touches: ch.touches };
    const Pn = ch.pts[n];
    let total = 0;
    let prev = t0;
    for (let k = 1; k <= n; k++) {
        const th = ellipseAngle(outer, ch.pts[k][0], ch.pts[k][1]);
        let inc = (((th - prev) % TAU) + TAU) % TAU;
        if (inc < 1e-12) inc = TAU;
        total += inc;
        prev = th;
    }
    return {
        ok: true,
        residual: Math.hypot(Pn[0] - P0[0], Pn[1] - P0[1]) / size,
        winding: total / TAU,
        pts: ch.pts,
        touches: ch.touches,
    };
}

/** Signed residual: accumulated angle around the outer ellipse minus 2 pi m (NaN if the chain fails). */
export function windingResidual(outer, inner, t0, n, m = 1) {
    const r = chainClosure(outer, inner, t0, n);
    return r.ok ? (r.winding - m) * TAU : NaN;
}

/** True if the chain closes after n steps: |Pn - P0| / size <= tol. */
export function isClosed(outer, inner, t0, n, tol = 1e-6) {
    const r = chainClosure(outer, inner, t0, n);
    return r.ok && r.residual <= tol;
}

/** Smallest k in [kmin, kmax] with a closed chain (and its winding number), or null. */
export function closedAfter(outer, inner, t0, kmax = 60, tol = 1e-6, kmin = 3) {
    const C = conicFromEllipseParams(outer), D = conicFromEllipseParams(inner);
    const P0 = ellipsePoint(outer, t0);
    const size = Math.max(outer.a, outer.b);
    const ch = ponceletChain(C, D, P0, kmax);
    for (let k = kmin; k < ch.pts.length; k++) {
        const P = ch.pts[k];
        if (Math.hypot(P[0] - P0[0], P[1] - P0[1]) / size <= tol) {
            return { n: k, winding: Math.round(chainClosure(outer, inner, t0, k).winding) };
        }
    }
    return null;
}

/** Rotation number estimate: accumulated angle / (2 pi N) over N steps (NaN if the chain fails). */
export function rotationNumber(outer, inner, t0 = 0, N = 120) {
    const r = chainClosure(outer, inner, t0, N);
    return r.ok ? r.winding / N : NaN;
}

/** True if every sampled point of the inner ellipse is strictly inside the outer one. */
export function innerInside(outer, inner, samples = 96) {
    const C = conicFromEllipseParams(outer);
    for (let i = 0; i < samples; i++) {
        const P = ellipsePoint(inner, (i / samples) * TAU);
        if (!(evalConic(C, P[0], P[1]) < 0)) return false;
    }
    return true;
}

// ---------- Cayley's criterion ----------

/** Coefficient polynomial of det(t C + D), degree 3 (index = power of t). */
function detPencil(C, D) {
    // det is cubic: evaluate at four points and solve the Vandermonde system exactly via Newton form.
    const ts = [0, 1, -1, 2];
    const ys = ts.map((t) => det3(C.map((row, i) => row.map((v, j) => t * v + D[i][j]))));
    // p(t) = c0 + c1 t + c2 t^2 + c3 t^3
    const c0 = ys[0];
    const s = (ys[1] + ys[2]) / 2; // c0 + c2
    const c2 = s - c0;
    const o = (ys[1] - ys[2]) / 2; // c1 + c3
    const c3 = (ys[3] - c0 - 2 * o - 4 * c2) / 6; // y(2) = c0 + 2(c1) + 4c2 + 8c3, c1 = o - c3
    // y(2) = c0 + 2(o - c3) + 4 c2 + 8 c3 = c0 + 2o + 4c2 + 6c3
    const c1 = o - c3;
    return [c0, c1, c2, c3];
}

const normalise = (M) => {
    const d = det3(M);
    const k = Math.cbrt(Math.abs(d));
    return k > 0 && Number.isFinite(k) ? M.map((r) => r.map((v) => v / k)) : M;
};

/**
 * Taylor coefficients A_0..A_count of sqrt(det(t C + D)) (C = outer, D = inner conic matrices; both are
 * scaled to |det| = 1 and the sign fixed so A_0 > 0, which only rescales the criteria). NaN if D is degenerate.
 */
export function cayleyCoefficients(C, D, count = 24) {
    const p = detPencil(normalise(C), normalise(D));
    const sg = p[0] < 0 ? -1 : 1;
    const q = p.map((v) => sg * v);
    if (!(q[0] > 0)) return new Array(count + 1).fill(NaN);
    const s = [Math.sqrt(q[0])];
    for (let k = 1; k <= count; k++) {
        let acc = k < q.length ? q[k] : 0;
        for (let j = 1; j < k; j++) acc -= s[j] * s[k - j];
        s.push(acc / (2 * s[0]));
    }
    return s;
}

/**
 * Cayley determinant whose vanishing is equivalent to closure after n steps (n >= 3):
 *  n = 2m+1: det [A_{i+j}]_{i,j=1..m};   n = 2m: det [A_{i+j+1}]_{i,j=1..m-1}.
 */
export function cayleyDeterminant(C, D, n) {
    const m = Math.floor(n / 2);
    const A = cayleyCoefficients(C, D, n + 2);
    const size = n % 2 ? m : m - 1;
    const off = n % 2 ? 0 : 1;
    const H = [];
    for (let i = 1; i <= size; i++) {
        const row = [];
        for (let j = 1; j <= size; j++) row.push(A[i + j + off]);
        H.push(row);
    }
    return detN(H);
}

/** Cayley determinants for n = 3..nmax: [{ n, value }]. */
export function cayleyTable(C, D, nmax = 12) {
    const out = [];
    for (let n = 3; n <= nmax; n++) out.push({ n, value: cayleyDeterminant(C, D, n) });
    return out;
}

// ---------- classical circle results ----------

/** Euler: a triangle exists iff d^2 = R^2 - 2Rr. Returns { lhs: d^2, rhs: R^2 - 2Rr, defect }. */
export function eulerCheck(R, r, d) {
    const lhs = d * d, rhs = R * R - 2 * R * r;
    return { lhs, rhs, defect: lhs - rhs };
}

/** Fuss: bicentric quadrilateral iff 1/(R-d)^2 + 1/(R+d)^2 = 1/r^2 (returns the difference). */
export function fussQuadrilateralDefect(R, r, d) {
    return 1 / ((R - d) * (R - d)) + 1 / ((R + d) * (R + d)) - 1 / (r * r);
}

// ---------- solver ----------

/** Copy of `inner` with parameter `param` ('scale' | 'offset') set to value v. */
export function adjustInner(outer, inner, param, v) {
    if (param === 'offset') {
        let ux = inner.cx - outer.cx, uy = inner.cy - outer.cy;
        const h = Math.hypot(ux, uy);
        if (h > 1e-9) { ux /= h; uy /= h; } else { ux = 1; uy = 0; }
        return { ...inner, cx: inner.cx + v * ux, cy: inner.cy + v * uy };
    }
    return { ...inner, a: inner.a * v, b: inner.b * v };
}

/**
 * Adjust one parameter of the inner ellipse so the chain closes after n steps with winding number m.
 * param: 'scale' (multiply both semi-axes; value 1 = current) or 'offset' (shift the centre along the
 * line from the outer centre; value 0 = current). The closure residual is scanned for sign changes and
 * the root nearest the current value is refined by Illinois (regula falsi) iterations.
 * Returns { ok, value, inner, residual, iterations } (inner = adjusted copy; residual = |Pn-P0|/size).
 */
export function solveClosure(outer, inner, { n = 3, m = 1, param = 'scale', t0 = 0, samples = 400 } = {}) {
    const fail = { ok: false, value: param === 'offset' ? 0 : 1, inner: { ...inner }, residual: NaN, iterations: 0 };
    if (!(n >= 3) || !(m >= 1) || 2 * m >= n) return fail;
    const f = (v) => windingResidual(outer, adjustInner(outer, inner, param, v), t0, n, m);
    const valid = (v) => innerInside(outer, adjustInner(outer, inner, param, v), 360);
    const size = Math.max(outer.a, outer.b);
    // Largest admissible excursion (inner conic still inside the outer one) found by bisection.
    const limit = (vin, vout) => {
        if (valid(vout)) return vout;
        for (let i = 0; i < 50; i++) {
            const mid = (vin + vout) / 2;
            if (valid(mid)) vin = mid; else vout = mid;
        }
        return vin;
    };
    // Sample segments [from, to] densest at `to`, the contact end where high-n solutions hide.
    const segs = [];
    if (param === 'offset') {
        const span = 1.6 * size;
        if (valid(0)) segs.push([0, limit(0, span)], [0, limit(0, -span)]);
        else segs.push([-span, span]);
    } else {
        const hi = 1.1 * size / Math.max(inner.a, inner.b, 1e-9);
        if (valid(0.01)) segs.push([0.01, limit(0.01, hi)]);
        else segs.push([0.01, hi]);
    }
    const cur = param === 'offset' ? 0 : 1;
    let best = null;
    for (const [s, e] of segs) {
        // Half uniform, half geometric samples towards the contact end (rotation number ~ 1/log there).
        const ws = [];
        for (let i = 0; i <= samples; i++) {
            const u = i / samples;
            ws.push(i % 2 ? 1 - 10 ** (-12 * u) : u);
        }
        ws.sort((x, y) => x - y);
        const vs = ws.map((w) => s + (e - s) * w);
        const fs = vs.map(f);
        for (let i = 0; i < vs.length - 1; i++) {
            let a = vs[i], b = vs[i + 1], fa = fs[i], fb = fs[i + 1];
            if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) continue;
            let it = 0, side = 0;
            for (; it < 100; it++) {
                const c = fa === fb ? (a + b) / 2 : (a * fb - b * fa) / (fb - fa);
                const fc = f(c);
                if (!Number.isFinite(fc)) { b = (a + b) / 2; fb = f(b); continue; }
                if (Math.abs(fc) < 1e-14 || Math.abs(b - a) < 1e-15 * Math.max(1, Math.abs(c))) { a = b = c; fa = fb = fc; break; }
                if (fc * fb > 0) { b = c; fb = fc; if (side === -1) fa /= 2; side = -1; } else { a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
            }
            const v = Math.abs(fa) < Math.abs(fb) ? a : b;
            if (!(Math.abs(f(v)) < 1e-6)) continue; // jump rather than a root
            const dist = Math.abs(v - cur);
            if (!best || dist < best.dist) best = { v, dist, it };
        }
    }
    if (!best) return fail;
    const solved = adjustInner(outer, inner, param, best.v);
    const r = chainClosure(outer, solved, t0, n);
    return { ok: r.ok && r.residual < 1e-7, value: best.v, inner: solved, residual: r.residual, iterations: best.it };
}
