// Geodesics, parallel transport, holonomy, geodesic triangles and Gauss-Bonnet integrals on the
// parametric surfaces of lib/surfaces.js. Pure functions: no DOM, no p5.
//
// CONVENTIONS
//   * Everything is in (u, v) chart coordinates. Periodic coordinates are NOT wrapped while integrating
//     (u keeps growing), so paths are continuous; wrap with wrapUV() only for display or picking.
//   * Directions at a point are angles theta in the orthonormal tangent frame e1 = ru/|ru|, e2 = n x e1
//     (counter-clockwise about n = ru x rv). Geodesics are unit speed: g(gamma', gamma') = 1.
//   * Pole edges (sphere / ellipsoid): a geodesic that overshoots a pole is mirrored (v reflected, u += pi),
//     which is exactly what a geodesic through the pole does. Other domain edges end the geodesic with
//     reason 'boundary'.

import {
  localGeometry, christoffel, clampV, wrapUV, surfaceExtent, principalDirections,
} from './surfaces.js';

const TAU = Math.PI * 2;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Tangent vectors

const vecToParam = (q, w) => {
  const a = dot(w, q.ru), b = dot(w, q.rv);
  return [q.gi[0] * a + q.gi[1] * b, q.gi[1] * a + q.gi[2] * b];
};
const paramToVec = (q, p) => [
  q.ru[0] * p[0] + q.rv[0] * p[1], q.ru[1] * p[0] + q.rv[1] * p[1], q.ru[2] * p[0] + q.rv[2] * p[1],
];

/** Orthonormal tangent frame at (u, v): { e1, e2, n, r, q } (q = localGeometry). */
export function tangentFrame(S, u, v) {
  const q = localGeometry(S, u, v);
  const l = Math.hypot(...q.ru);
  const e1 = l > 0 ? [q.ru[0] / l, q.ru[1] / l, q.ru[2] / l] : [1, 0, 0];
  return { e1, e2: cross(q.n, e1), n: q.n, r: q.r, q };
}

/** Parameter-space velocity (du, dv) of the unit tangent at angle theta in the frame at (u, v). */
export function directionParam(S, u, v, theta) {
  const f = tangentFrame(S, u, v);
  const c = Math.cos(theta), s = Math.sin(theta);
  const w = [c * f.e1[0] + s * f.e2[0], c * f.e1[1] + s * f.e2[1], c * f.e1[2] + s * f.e2[2]];
  return vecToParam(f.q, w);
}

/** Angle of the 3D tangent vector w in the frame at (u, v) (inverse of directionParam, up to scale). */
export function angleOfVector(S, u, v, w) {
  const f = tangentFrame(S, u, v);
  return Math.atan2(dot(w, f.e2), dot(w, f.e1));
}

/** Unit-length 3D tangent for a parameter velocity at (u, v). */
export function paramToUnit3(S, u, v, du, dv) {
  const w = paramToVec(localGeometry(S, u, v), [du, dv]);
  const l = Math.hypot(...w);
  return l > 0 ? [w[0] / l, w[1] / l, w[2] / l] : [0, 0, 0];
}

const gnorm = (q, du, dv) => Math.sqrt(Math.max(0, q.E * du * du + 2 * q.F * du * dv + q.G * dv * dv));

// ---------------------------------------------------------------------------------------------
// Geodesic ODE

function accel(S, u, v, du, dv) {
  const g = christoffel(S, u, v);
  return [-(g[0] * du * du + 2 * g[1] * du * dv + g[2] * dv * dv), -(g[3] * du * du + 2 * g[4] * du * dv + g[5] * dv * dv)];
}

function rk4(S, y, h) {
  const f = (s) => { const a = accel(S, s[0], s[1], s[2], s[3]); return [s[2], s[3], a[0], a[1]]; };
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k, a[3] + b[3] * k];
  const k1 = f(y), k2 = f(add(y, k1, h / 2)), k3 = f(add(y, k2, h / 2)), k4 = f(add(y, k3, h));
  return y.map((x, i) => x + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/**
 * Integrates the geodesic equation u'' = -Gamma(u', u') with RK4, advancing by exact arc length.
 * start: { u, v, du, dv } (any speed; it is normalised to 1 unless opts.normalize === false).
 * opts: length (arc length), samples (output intervals, default ceil(length / 0.05)), maxStep (cap on the
 *   parameter increment per RK4 step, default 0.02), normalize (renormalise the speed at every output
 *   point, default true).
 * Returns { points: [{ s, u, v, du, dv, x, y, z }], length (reached), reason: 'length' | 'boundary' | 'singular' }.
 */
export function integrateGeodesic(S, start, opts = {}) {
  const length = Math.max(0, Number(opts.length) || 0);
  const samples = Math.max(1, Math.round(opts.samples || Math.ceil(length / 0.05) || 1));
  const maxStep = opts.maxStep || 0.01;
  const normalize = opts.normalize !== false;
  const { u0, u1, v0, v1 } = S.domain;
  const span = v1 - v0, pe = 1e-5 * span;
  let y = [start.u, start.v, start.du, start.dv];
  if (normalize) {
    const sp = gnorm(localGeometry(S, y[0], y[1]), y[2], y[3]);
    if (!(sp > 0)) return { points: [], length: 0, reason: 'singular' };
    y[2] /= sp; y[3] /= sp;
  }
  const point = (s) => {
    const r = S.eval(y[0], clampV(S, y[1])).r;
    return { s, u: y[0], v: y[1], du: y[2], dv: y[3], x: r[0], y: r[1], z: r[2] };
  };
  const points = [point(0)];
  const ds = length / samples;
  let s = 0, reason = 'length';
  outer:
  for (let k = 1; k <= samples; k++) {
    let rem = ds;
    let guard = 0;
    while (rem > 1e-14) {
      if (++guard > 200000) { reason = 'singular'; break outer; }
      const speed = Math.max(Math.abs(y[2]), Math.abs(y[3]), 1e-9);
      let h = Math.min(rem, maxStep / speed);
      // approach poles geometrically: Gamma^u_uv ~ cot(v) varies too fast for one RK4 step otherwise
      if (S.poleV0 || S.poleV1) {
        const dist = Math.min(S.poleV0 ? y[1] - v0 : Infinity, S.poleV1 ? v1 - y[1] : Infinity);
        if (Math.abs(y[3]) > 1e-12) h = Math.min(h, Math.max(0.25 * dist, 0.5 * pe) / Math.abs(y[3]));
      }
      const y1 = rk4(S, y, h);
      if (!y1.every(Number.isFinite)) { reason = 'singular'; break outer; }
      // pole mirror
      if (S.poleV0 && y1[1] < v0) { y1[1] = Math.min(v1, 2 * v0 - y1[1]); y1[0] += Math.PI; y1[3] = -y1[3]; }
      else if (S.poleV1 && y1[1] > v1) { y1[1] = Math.max(v0, 2 * v1 - y1[1]); y1[0] += Math.PI; y1[3] = -y1[3]; }
      // hard boundaries
      let f = 2, edgeIdx = -1, edgeVal = 0;
      const chk = (i, lo, hi) => {
        let e = null;
        if (y1[i] < lo) e = lo; else if (y1[i] > hi) e = hi;
        if (e === null) return;
        const ff = clamp((e - y[i]) / (y1[i] - y[i]), 0, 1);
        if (ff < f) { f = ff; edgeIdx = i; edgeVal = e; }
      };
      if (!S.periodicU) chk(0, u0, u1);
      if (!S.periodicV) chk(1, S.poleV0 ? -Infinity : v0, S.poleV1 ? Infinity : v1);
      if (edgeIdx >= 0) {
        const yb = y.map((x, i) => x + f * (y1[i] - x));
        yb[edgeIdx] = edgeVal;
        y = yb;
        s += f * h;
        points.push(point(s));
        reason = 'boundary';
        break outer;
      }
      y = y1;
      rem -= h;
      s += h;
    }
    if (normalize) {
      const sp = gnorm(localGeometry(S, y[0], y[1]), y[2], y[3]);
      if (sp > 0 && Number.isFinite(sp)) { y[2] /= sp; y[3] /= sp; }
    }
    points.push(point(k === samples ? length : s));
  }
  return { points, length: points[points.length - 1].s, reason };
}

/**
 * Geodesic from (u, v) in direction theta (angle in the tangent frame) for the given arc length.
 * opts as for integrateGeodesic. Returns the same object plus { start: {u, v, theta} }.
 */
export function geodesicFrom(S, u, v, theta, length, opts = {}) {
  const d = directionParam(S, u, v, theta);
  const out = integrateGeodesic(S, { u, v, du: d[0], dv: d[1] }, { length, ...opts });
  out.start = { u, v, theta };
  return out;
}

/** Unit 3D tangent of a geodesic sample. */
export function sampleTangent(S, pt) {
  return paramToUnit3(S, pt.u, pt.v, pt.du, pt.dv);
}

/** Sum of segment lengths of a polyline of {x,y,z} points (3D chord length). */
export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  return s;
}

/** Conserved speed g(gamma', gamma') of a geodesic sample. */
export function speedOf(S, pt) {
  return gnorm(localGeometry(S, pt.u, pt.v), pt.du, pt.dv);
}

// ---------------------------------------------------------------------------------------------
// Shortest path by shooting

/**
 * Geodesics from P to Q ({u, v} each) by Gauss-Newton shooting on (initial angle, length).
 * opts: starts (initial angles tried, default 12; each with two length guesses), maxIter (30), maxLength (default 3 * extent + 2 * chord),
 *   maxStep (0.04). Returns { candidates: [{ theta, length, ratio }] sorted by length, best, ambiguous,
 *   chord, nearConjugate } where `ratio` = |d gamma / d theta| / length (1 = no focusing; small values mean
 *   the path is close to a conjugate point or the cut locus, so the shortest path is not unique / stable),
 *   `ambiguous` is true when the two shortest candidates differ by < 0.1 %.
 */
export function geodesicBetween(S, P, Q, opts = {}) {
  const starts = opts.starts || 12, maxIter = opts.maxIter || 30, maxStep = opts.maxStep || 0.04;
  const rq = S.eval(Q.u, clampV(S, Q.v)).r;
  const fr = tangentFrame(S, P.u, P.v);
  const chord = Math.hypot(rq[0] - fr.r[0], rq[1] - fr.r[1], rq[2] - fr.r[2]);
  if (chord < 1e-9) return { candidates: [{ theta: 0, length: 0, ratio: 1 }], best: { theta: 0, length: 0, ratio: 1 }, ambiguous: false, chord, nearConjugate: false };
  const maxLength = opts.maxLength || 3 * surfaceExtent(S, 8).size + 2 * chord;
  // straight-line guess in the chart (shortest wrap for periodic coordinates)
  let du = Q.u - P.u, dv = Q.v - P.v;
  const { u0, u1, v0, v1 } = S.domain;
  if (S.periodicU) { const sp = u1 - u0; du -= sp * Math.round(du / sp); }
  if (S.periodicV) { const sp = v1 - v0; dv -= sp * Math.round(dv / sp); }
  const w0 = paramToVec(fr.q, [du, dv]);
  const theta0 = Math.hypot(...w0) > 0 ? Math.atan2(dot(w0, fr.e2), dot(w0, fr.e1)) : 0;

  const end = (theta, length, step) => {
    const c = Math.cos(theta), sn = Math.sin(theta);
    const d = vecToParam(fr.q, [c * fr.e1[0] + sn * fr.e2[0], c * fr.e1[1] + sn * fr.e2[1], c * fr.e1[2] + sn * fr.e2[2]]);
    const g = integrateGeodesic(S, { u: P.u, v: P.v, du: d[0], dv: d[1] }, { length, samples: 1, maxStep: step });
    const e = g.points[g.points.length - 1];
    return { ok: g.reason === 'length', pos: [e.x, e.y, e.z], vel: paramToUnit3(S, e.u, e.v, e.du, e.dv) };
  };

  // Levenberg-Marquardt-damped Gauss-Newton on (theta, L); returns { ok, th, L, ratio }
  const newton = (th, L, step, tol, iters) => {
    let ratio = 1, prev = Infinity;
    for (let it = 0; it < iters; it++) {
      const f = end(th, L, step);
      if (!f.ok) return { ok: false };
      const res = [f.pos[0] - rq[0], f.pos[1] - rq[1], f.pos[2] - rq[2]];
      const rn = Math.hypot(...res);
      if (rn < tol) return { ok: true, th, L, ratio };
      if (it > 6 && rn > prev * 0.999 && rn > 1e-3) return { ok: false };
      prev = rn;
      const dth = 1e-6;
      const f2 = end(th + dth, L, step);
      if (!f2.ok) return { ok: false };
      const Ja = [(f2.pos[0] - f.pos[0]) / dth, (f2.pos[1] - f.pos[1]) / dth, (f2.pos[2] - f.pos[2]) / dth];
      ratio = Math.hypot(...Ja) / Math.max(L, 1e-9);
      const JL = f.vel;
      const A = dot(Ja, Ja) + 1e-9, B = dot(Ja, JL), C = dot(JL, JL) + 1e-9;
      const ra = -dot(Ja, res), rl = -dot(JL, res);
      const det = A * C - B * B;
      if (!(Math.abs(det) > 1e-18)) return { ok: false };
      let sa = (C * ra - B * rl) / det, sl = (A * rl - B * ra) / det;
      const m = Math.max(Math.abs(sa) / 0.6, Math.abs(sl) / (0.5 * L + 0.2), 1);
      sa /= m; sl /= m;
      th += sa; L += sl;
      if (L <= 1e-9) L = Math.max(1e-6, L - sl) * 0.5;
      if (L > maxLength) return { ok: false };
    }
    return { ok: false };
  };

  const found = [];
  for (let k = 0; k < starts * 2; k++) {
    // two length guesses per start angle: the straight chord, and a longer one that finds paths winding round the surface
    const c = newton(theta0 + (TAU * (k >> 1)) / starts, (k & 1) ? 2.2 * chord + 0.3 : chord * 1.02, maxStep, 1e-6 * Math.max(1, chord), maxIter);
    if (!c.ok) continue;
    const q = newton(c.th, c.L, 0.01, 1e-9 * Math.max(1, chord), 6);
    const sol = q.ok ? q : c;
    const key = (((sol.th % TAU) + TAU) % TAU);
    if (found.some((o) => Math.abs(o.length - sol.L) < 1e-4 * Math.max(1, sol.L) && (Math.abs(o.key - key) < 1e-3 || Math.abs(Math.abs(o.key - key) - TAU) < 1e-3))) continue;
    found.push({ theta: sol.th, key, length: sol.L, ratio: sol.ratio });
  }
  found.sort((a, b) => a.length - b.length);
  const candidates = found.map(({ theta, length, ratio }) => ({ theta, length, ratio }));
  const best = candidates[0] || null;
  const ambiguous = candidates.length > 1 && candidates[1].length - candidates[0].length < 1e-3 * candidates[0].length;
  return { candidates, best, ambiguous, chord, nearConjugate: !!best && best.ratio < 0.1 };
}

// ---------------------------------------------------------------------------------------------
// Parallel transport and holonomy

/**
 * Parallel transport of V0 = [V^u, V^v] along a chart path (array of {u,v} or [u,v]); consecutive points are joined
 * by straight chart segments (u', v' constant), each integrated by RK4 of dV^k/dt = -Gamma^k_ij u'^i V^j.
 * Returns { vectors: [[a, b]] at every path point, final }.
 */
export function parallelTransport(S, path, V0, opts = {}) {
  const maxStep = opts.maxStep || 0.02;
  const P = path.map((p) => (Array.isArray(p) ? p : [p.u, p.v]));
  const vectors = [V0.slice()];
  let V = V0.slice();
  const rhs = (u, v, a, b, du, dv) => {
    const g = christoffel(S, u, v);
    return [
      du, dv,
      -(g[0] * du * a + g[1] * (du * b + dv * a) + g[2] * dv * b),
      -(g[3] * du * a + g[4] * (du * b + dv * a) + g[5] * dv * b),
    ];
  };
  for (let i = 1; i < P.length; i++) {
    const du = P[i][0] - P[i - 1][0], dv = P[i][1] - P[i - 1][1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(du), Math.abs(dv)) / maxStep));
    const h = 1 / n;
    let y = [P[i - 1][0], P[i - 1][1], V[0], V[1]];
    for (let k = 0; k < n; k++) {
      const f = (s) => rhs(s[0], s[1], s[2], s[3], du, dv);
      const add = (a, b, c) => a.map((x, j) => x + b[j] * c);
      const k1 = f(y), k2 = f(add(y, k1, h / 2)), k3 = f(add(y, k2, h / 2)), k4 = f(add(y, k3, h));
      y = y.map((x, j) => x + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    V = [y[2], y[3]];
    vectors.push(V);
  }
  return { vectors, final: V };
}

/** Signed angle (about n) from tangent vector Va to Vb (both given in chart components) at (u, v). */
export function angleBetween(S, u, v, Va, Vb) {
  const q = localGeometry(S, u, v);
  const A = paramToVec(q, Va), B = paramToVec(q, Vb);
  return Math.atan2(dot(q.n, cross(A, B)), dot(A, B));
}

/**
 * Holonomy of the closed chart path (it is closed automatically): transports V0 around and returns
 * { angle (-pi, pi], vectors, vectors3d (transported vectors in R^3 at every path point), points3d, final }.
 * V0 defaults to the unit vector along e1.
 */
export function holonomy(S, path, V0 = null, opts = {}) {
  const P = path.map((p) => (Array.isArray(p) ? p : [p.u, p.v]));
  const first = P[0], last = P[P.length - 1];
  const rf = S.eval(first[0], clampV(S, first[1])).r, rl = S.eval(last[0], clampV(S, last[1])).r;
  if (Math.hypot(rf[0] - rl[0], rf[1] - rl[1], rf[2] - rl[2]) > 1e-9) P.push(first.slice());
  const f0 = tangentFrame(S, first[0], first[1]);
  const start = V0 || vecToParam(f0.q, f0.e1);
  const { vectors, final } = parallelTransport(S, P, start, opts);
  const angle = angleBetween(S, first[0], first[1], start, final);
  const vectors3d = vectors.map((V, i) => paramToVec(localGeometry(S, P[i][0], P[i][1]), V));
  const points3d = P.map((p) => S.eval(p[0], clampV(S, p[1])).r);
  return { angle, vectors, vectors3d, points3d, final, path: P };
}

/** Chart path of the circle v = const (u over one full period), n segments. */
export function parallelCircle(S, v, n = 240) {
  const { u0, u1 } = S.domain;
  const out = [];
  for (let i = 0; i <= n; i++) out.push([u0 + ((u1 - u0) * i) / n, v]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Integrals over regions

const GL6 = [
  [-0.9324695142031521, 0.1713244923791704], [-0.6612093864662645, 0.3607615730481386], [-0.2386191860831969, 0.4679139345726910],
  [0.2386191860831969, 0.4679139345726910], [0.6612093864662645, 0.3607615730481386], [0.9324695142031521, 0.1713244923791704],
];

/**
 * Integral of f(u, v) du dv over a simple polygon in the chart (vertices [u, v] or {u, v}), by exact
 * scan-line decomposition: Gauss-Legendre in u between vertex abscissae, and in v between edge crossings.
 */
export function integratePolygon(f, poly) {
  const P = poly.map((p) => (Array.isArray(p) ? p : [p.u, p.v]));
  const n = P.length;
  if (n < 3) return 0;
  const us = [...new Set(P.map((p) => p[0]))].sort((a, b) => a - b);
  let total = 0;
  for (let a = 0; a + 1 < us.length; a++) {
    const ua = us[a], ub = us[a + 1];
    if (ub - ua < 1e-13) continue;
    const mid = (ua + ub) / 2, half = (ub - ua) / 2;
    for (const [x, wx] of GL6) {
      const u = mid + half * x;
      const ys = [];
      for (let i = 0; i < n; i++) {
        const p = P[i], q = P[(i + 1) % n];
        if ((p[0] <= u && u < q[0]) || (q[0] <= u && u < p[0])) ys.push(p[1] + ((u - p[0]) / (q[0] - p[0])) * (q[1] - p[1]));
      }
      ys.sort((s, t) => s - t);
      let col = 0;
      for (let k = 0; k + 1 < ys.length; k += 2) {
        const vm = (ys[k] + ys[k + 1]) / 2, vh = (ys[k + 1] - ys[k]) / 2;
        for (const [y, wy] of GL6) col += wy * vh * f(u, vm + vh * y);
      }
      total += wx * half * col;
    }
  }
  return total;
}

/** Integrand K * W (curvature times area element) in chart coordinates. */
export function kDensity(S) {
  return (u, v) => { const q = localGeometry(S, u, v); return q.K * q.W; };
}

/** Integral of the Gaussian curvature over the chart polygon (Gauss-Bonnet side). */
export function integrateK(S, poly) { return integratePolygon(kDensity(S), poly); }

/** Area of the chart polygon on the surface. */
export function polygonArea(S, poly) { return integratePolygon((u, v) => localGeometry(S, u, v).W, poly); }

// ---------------------------------------------------------------------------------------------
// Geodesic triangles

/**
 * Geodesic triangle with vertex A and sides AB (initial angle theta, length lenAB) and AC (angle theta + alpha,
 * length lenAC); BC is the shortest geodesic found by shooting. Returns
 * { A, B, C, sides: { AB, AC, BC } (geodesic results), angles: [A, B, C], sum, excess, KIntegral, area, closed, lengths,
 *   polygon, between (geodesicBetween result) } or null if the third side cannot be found.
 * `closed` is false when the chart polygon does not close (the triangle wraps around a periodic direction or pole),
 * in which case KIntegral and area are NaN.
 */
export function geodesicTriangle(S, A, { theta = 0, alpha = 1, lenAB = 1, lenAC = 1, samples, between = {} } = {}) {
  const sm = (L) => samples || Math.max(12, Math.ceil(L / 0.03));
  const AB = geodesicFrom(S, A.u, A.v, theta, lenAB, { samples: sm(lenAB), maxStep: 0.01 });
  const AC = geodesicFrom(S, A.u, A.v, theta + alpha, lenAC, { samples: sm(lenAC), maxStep: 0.01 });
  if (AB.reason !== 'length' || AC.reason !== 'length') return null;
  const b = AB.points[AB.points.length - 1], c = AC.points[AC.points.length - 1];
  const bw = geodesicBetween(S, { u: b.u, v: b.v }, { u: c.u, v: c.v }, between);
  if (!bw.best) return null;
  const BC = geodesicFrom(S, b.u, b.v, bw.best.theta, bw.best.length, { samples: sm(bw.best.length), maxStep: 0.01 });
  const e = BC.points[BC.points.length - 1];
  const t = (pt) => sampleTangent(S, pt);
  const neg = (w) => [-w[0], -w[1], -w[2]];
  const ang = (x, y) => Math.acos(clamp(dot(x, y), -1, 1));
  const tAB1 = t(AB.points[0]), tAC1 = t(AC.points[0]);
  const aA = ang(tAB1, tAC1);
  const aB = ang(neg(t(b)), t(BC.points[0]));
  const aC = ang(neg(t(c)), neg(t(e)));
  const sum = aA + aB + aC;
  const closeGap = Math.hypot(e.u - c.u, e.v - c.v);
  const closed = closeGap < 1e-5;
  const polygon = [
    ...AB.points.map((p) => [p.u, p.v]),
    ...BC.points.slice(1).map((p) => [p.u, p.v]),
    ...AC.points.slice(0, -1).reverse().map((p) => [p.u, p.v]),
  ];
  return {
    A, B: { u: b.u, v: b.v }, C: { u: c.u, v: c.v }, sides: { AB, AC, BC }, angles: [aA, aB, aC], sum, excess: sum - Math.PI,
    KIntegral: closed ? integrateK(S, polygon) : NaN, area: closed ? polygonArea(S, polygon) : NaN, closed,
    lengths: [AB.length, BC.length, AC.length], polygon, between: bw,
  };
}

// ---------------------------------------------------------------------------------------------
// Lines of curvature

/**
 * Integrates a line of curvature (which = 1: direction of k1, 2: direction of k2) from (u, v) in both directions
 * with the midpoint rule. Stops at domain edges, at umbilics and after `length`.
 * Returns an array of {u, v, x, y, z}.
 */
export function curvatureLine(S, u, v, which = 1, { length = 3, step = 0.03 } = {}) {
  const { u0, u1, v0, v1 } = S.domain;
  // direction field sign-aligned with a reference direction (in the metric at (a, b))
  const field = (a, b, ref) => {
    const pd = principalDirections(S, a, b);
    if (pd.umbilic) return null;
    const d = which === 1 ? pd.d1 : pd.d2;
    if (!ref) return d;
    const q = localGeometry(S, a, b);
    const g = d[0] * ref[0] * q.E + (d[0] * ref[1] + d[1] * ref[0]) * q.F + d[1] * ref[1] * q.G;
    return g < 0 ? [-d[0], -d[1]] : d;
  };
  const half = (sign) => {
    const pts = [];
    const d0 = field(u, v, null);
    if (!d0) return pts;
    let cu = u, cv = v, prev = [sign * d0[0], sign * d0[1]];
    for (let s = 0; s < length; s += step) {
      const d1 = field(cu, cv, prev);
      if (!d1) break;
      const dm = field(cu + d1[0] * step / 2, cv + d1[1] * step / 2, d1);
      if (!dm) break;
      cu += dm[0] * step; cv += dm[1] * step;
      prev = dm;
      if (!Number.isFinite(cu + cv)) break;
      if ((!S.periodicU && (cu < u0 || cu > u1)) || (!S.periodicV && (cv < v0 || cv > v1))) break;
      if (S.poleV0 && cv < v0 + 1e-3 * (v1 - v0)) break;
      if (S.poleV1 && cv > v1 - 1e-3 * (v1 - v0)) break;
      const r = S.eval(cu, clampV(S, cv)).r;
      pts.push({ u: cu, v: cv, x: r[0], y: r[1], z: r[2] });
    }
    return pts;
  };
  const r0 = S.eval(u, clampV(S, v)).r;
  return [...half(-1).reverse(), { u, v, x: r0[0], y: r0[1], z: r0[2] }, ...half(1)];
}

export { wrapUV };
