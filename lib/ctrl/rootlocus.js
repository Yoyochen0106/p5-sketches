/**
 * Root locus of the unity-feedback loop 1 + K L(s) = 0, L = N(s)/D(s) (a delay-free TF; use withPade() first).
 * Characteristic polynomial: D(s) + K N(s). Positive locus K in [0, inf); pass {negative:true} for K in (-inf, 0]
 * (the 0-degree / complementary locus).
 *
 *  - rootLocus(L, opts)         branches traced by continuation with adaptive K steps (assignment-matched roots)
 *  - asymptotes, realAxisSegments, breakawayPoints, imaginaryAxisCrossings, angleOfDeparture / angleOfArrival
 *  - polesAtK, gainAtPoint (magnitude + angle criteria), gainForDamping, gainForWn, gainForRealPart
 *  - analyzeLocus(L): everything above in one object (what a root-locus plot needs).
 * Complex numbers are [re, im]; angles are in degrees unless the name says rad.
 */
import { tfPoles, tfZeros, polyAdd, polyScale, polyMul, polyDeriv, polyRoots, polyEval, polyEvalC, evalTf, polyDegree, polyTrim } from './tf.js';
import { jwCrossingsK } from './routh.js';

const cabs = (z) => Math.hypot(z[0], z[1]);
const DEG = 180 / Math.PI;
const wrap180 = (d) => { let x = ((d % 360) + 360) % 360; if (x > 180) x -= 360; return x === -180 ? 180 : x; };

/** Characteristic polynomial D + sgn*K*N for a given gain. */
export function charPolyAtK(L, K) {
  return polyAdd(L.den, polyScale(L.num, K));
}
/** Closed-loop poles at gain K (roots of D + K N), as [re,im] pairs. */
export function polesAtK(L, K) {
  return polyRoots(charPolyAtK(L, K));
}

/** Characteristic length scale of the pole/zero pattern (>= 1e-3). */
function patternScale(L) {
  const mags = [...tfPoles(L), ...tfZeros(L)].map(cabs);
  let s = Math.max(...mags, 0);
  const cr = jwCrossingsK(L.num, L.den).filter((c) => c.K > 0).map((c) => c.w);
  s = Math.max(s, ...cr, 0);
  return s > 1e-9 ? s : 1;
}

// ------------------------------------------------------------------ assignment (Hungarian algorithm)

/** Minimum-cost assignment on a square cost matrix; returns col index for each row. */
function hungarian(cost) {
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity), used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const ans = new Array(n);
  for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
  return ans;
}

/**
 * Trace the closed-loop poles of 1 + K L(s) = 0 from K = 0 to large K.
 * Roots are computed independently at each K (polynomial root finder) and matched to the previous positions by an
 * optimal assignment; K steps adapt so that no root moves by more than `stepFraction` of the pattern scale, and are
 * halved whenever the matching is ambiguous (two roots closer than twice their displacement, e.g. near breakaway).
 * @param {{negative?:boolean, kMax?:number, rMax?:number, stepFraction?:number, maxPoints?:number}} opts
 * @returns {{K:Float64Array, branches:Array<Array<[number,number]>>, n:number, poles, zeros, scale:number,
 *            kEnd:number, truncated:boolean}} branches[b][i] is the position of branch b at K[i] (K is the magnitude |K|).
 */
export function rootLocus(L, opts = {}) {
  const sgn = opts.negative ? -1 : 1;
  const D = L.den, N = L.num;
  const n = polyDegree(D);
  const scale = patternScale(L);
  const rMax = opts.rMax ?? 12 * scale;
  const kMax = opts.kMax ?? 1e14;
  const stepFraction = opts.stepFraction ?? 0.02;
  const maxPoints = opts.maxPoints ?? 4000;
  const zeros = tfZeros(L);
  const poly = (K) => polyAdd(D, polyScale(N, sgn * K));
  const poles = polyRoots(D);
  const Ks = [0];
  let cur = poles.map((p) => p.slice());
  const branches = cur.map((p) => [p.slice()]);
  if (n === 0) return { K: Float64Array.from(Ks), branches, n, poles, zeros, scale, kEnd: 0, truncated: false };
  // initial step from the sensitivity ds/dK at the poles
  let dK = Infinity;
  const dD = polyDeriv(D);
  for (const pp of poles) {
    const sens = cabs(polyEvalC(N, pp)) / Math.max(1e-300, cabs(polyEvalC(dD, pp)));
    if (sens > 0) dK = Math.min(dK, (stepFraction * scale) / sens);
  }
  if (!Number.isFinite(dK) || dK <= 0) dK = 1e-6 * scale ** Math.max(1, n);
  let K = 0, truncated = false, rejects = 0;
  const done = (rts) => rts.every((r) => cabs(r) > rMax || zeros.some((z) => cabs([r[0] - z[0], r[1] - z[1]]) < 1e-4 * scale));
  while (Ks.length < maxPoints) {
    if (K >= kMax) { truncated = true; break; }
    const Kn = K + dK;
    const rts = polyRoots(poly(Kn));
    if (rts.length !== n) { // order drop: a root escapes to infinity at this gain (deg N = deg D)
      if (dK > 1e-12 * Math.max(1, K)) { dK /= 2; if (++rejects > 80) { truncated = true; break; } continue; }
      truncated = true; break;
    }
    const cost = cur.map((a) => rts.map((b) => cabs([a[0] - b[0], a[1] - b[1]])));
    const asg = hungarian(cost);
    const next = asg.map((j) => rts[j]);
    let maxDisp = 0, ambiguous = false;
    for (let i = 0; i < n; i++) {
      const disp = cost[i][asg[i]];
      maxDisp = Math.max(maxDisp, disp);
      let sep = Infinity;
      for (let j = 0; j < n; j++) if (j !== i) sep = Math.min(sep, cabs([cur[i][0] - cur[j][0], cur[i][1] - cur[j][1]]));
      if (disp > 0.6 * sep && disp > 1e-3 * scale) ambiguous = true;
    }
    const tooBig = maxDisp > 2 * stepFraction * scale;
    if ((tooBig || ambiguous) && dK > 1e-13 * Math.max(1, K)) { dK /= 2; if (++rejects > 400) { truncated = true; break; } continue; }
    rejects = 0;
    K = Kn; cur = next;
    Ks.push(K);
    next.forEach((r, i) => branches[i].push([r[0], r[1]]));
    const ratio = (stepFraction * scale) / Math.max(maxDisp, 1e-300);
    dK *= Math.min(2.5, Math.max(0.5, 0.9 * ratio));
    if (done(cur)) break;
  }
  return { K: Float64Array.from(Ks), branches, n, poles, zeros, scale, kEnd: K, truncated };
}

// ------------------------------------------------------------------ geometry of the locus

/**
 * Asymptotes of the locus: n - m of them leave at angles (2q+1) 180/(n-m) (K>0) or 2q 180/(n-m) (K<0), meeting the
 * real axis at the centroid sigma = (sum poles - sum zeros)/(n-m). Returns {count, angles (deg), centroid}.
 */
export function asymptotes(L, opts = {}) {
  const nm = polyDegree(L.den) - polyDegree(L.num);
  if (nm < 1) return { count: 0, angles: [], centroid: NaN };
  const sp = tfPoles(L).reduce((s, p) => s + p[0], 0), sz = tfZeros(L).reduce((s, z) => s + z[0], 0);
  const angles = [];
  for (let q = 0; q < nm; q++) angles.push(wrap180(opts.negative ? (360 * q) / nm : (180 * (2 * q + 1)) / nm));
  angles.sort((a, b) => a - b);
  return { count: nm, angles, centroid: (sp - sz) / nm };
}

/**
 * Real-axis parts of the locus: intervals [lo, hi] (lo may be -Infinity, hi may be Infinity) where the number of real
 * poles + zeros to the right is odd (K > 0) or even (K < 0).
 */
export function realAxisSegments(L, opts = {}) {
  const isReal = (z) => Math.abs(z[1]) < 1e-9 * Math.max(1, Math.abs(z[0]));
  const pts = [...tfPoles(L), ...tfZeros(L)].filter(isReal).map((z) => z[0]).sort((a, b) => b - a);
  const want = opts.negative ? 0 : 1;
  const bounds = [Infinity, ...pts, -Infinity];
  const segs = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const hi = bounds[i], lo = bounds[i + 1];
    if (hi - lo <= 1e-12) continue; // coincident
    // i = number of real poles/zeros (with multiplicity) to the right of this interval
    if (i % 2 === want) segs.push([lo, hi]);
  }
  // merge touching
  const merged = [];
  for (const sg of segs.sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last[1] - sg[0]) < 1e-12) last[1] = sg[1]; else merged.push(sg.slice());
  }
  return merged;
}

/**
 * Real-axis break-away / break-in points: real roots of dK/ds = 0, i.e. D'N - D N' = 0, lying on the locus
 * (K = -D(s)/N(s) >= 0 for the positive locus). Returns [{s, K, kind: 'breakaway'|'break-in'}] sorted by s.
 * A local MAXIMUM of K(s) along the axis is a break-away (branches leave the axis), a local minimum is a break-in.
 * A multiple open-loop pole (K = 0) is reported as a break-away of its branches.
 */
export function breakawayPoints(L, opts = {}) {
  const sgn = opts.negative ? -1 : 1;
  const { num: N, den: D } = L;
  const Q = polyTrim(polyAdd(polyMul(polyDeriv(D), N), polyScale(polyMul(D, polyDeriv(N)), -1)), 0);
  if (Q.length < 2) return [];
  const scale = patternScale(L);
  const Kf = (s) => sgn * (-polyEval(D, s) / polyEval(N, s));
  const out = [];
  for (const r of polyRoots(Q)) {
    if (Math.abs(r[1]) > 1e-7 * Math.max(1, Math.abs(r[0]))) continue;
    const s = r[0];
    const nv = polyEval(N, s);
    if (Math.abs(nv) < 1e-12) continue;
    const K = Kf(s);
    const h = 1e-4 * Math.max(scale, Math.abs(s));
    if (Math.abs(K) < 1e-9 * Math.max(1, ...D.map(Math.abs))) {
      // multiple open-loop pole: D'(s) = 0 too
      if (Math.abs(polyEval(polyDeriv(D), s)) < 1e-7 * Math.max(1, ...D.map(Math.abs))) out.push({ s, K: 0, kind: 'breakaway' });
      continue;
    }
    if (K < 0) continue;
    const a = Kf(s - h), b = Kf(s + h);
    const tol = 1e-12 * Math.max(1, Math.abs(K));
    if (a < K - tol && b < K - tol) out.push({ s, K, kind: 'breakaway' });
    else if (a > K + tol && b > K + tol) out.push({ s, K, kind: 'break-in' });
  }
  return out.sort((x, y) => x.s - y.s).filter((p, i, arr) => i === 0 || Math.abs(p.s - arr[i - 1].s) > 1e-9);
}

/**
 * Imaginary-axis crossings of the locus with the critical gains (from the Routh/jw-axis analysis in routh.js):
 * [{K, w}] with K > 0 for the positive locus (K as a magnitude for the negative locus), w >= 0 (w = 0: crossing at the origin).
 */
export function imaginaryAxisCrossings(L, opts = {}) {
  const all = jwCrossingsK(L.num, L.den);
  return all.filter((c) => (opts.negative ? c.K < 0 : c.K > 0)).map((c) => ({ K: Math.abs(c.K), w: c.w })).sort((a, b) => a.K - b.K);
}

/** Critical gain: smallest positive K at which a closed-loop pole reaches the imaginary axis (Infinity if none). */
export function criticalGain(L) {
  const c = imaginaryAxisCrossings(L);
  return c.length ? c[0].K : Infinity;
}

const rootsNear = (list, z, tol = 1e-6) => list.filter((r) => cabs([r[0] - z[0], r[1] - z[1]]) <= tol * Math.max(1, cabs(z)));

/**
 * Angle of departure (degrees) of the locus from a pole p (K > 0): phi = 180(2q+1) - sum_{j != p} arg(p - p_j) + sum_i arg(p - z_i),
 * divided over the multiplicity mu of the pole: (phi + 360 q) / mu. Returns the list of departure angles (mu of them).
 */
export function angleOfDeparture(L, p, opts = {}) {
  const poles = tfPoles(L), zeros = tfZeros(L);
  const same = rootsNear(poles, p);
  const mu = Math.max(1, same.length);
  let phi = opts.negative ? 0 : 180;
  for (const q of poles) if (!same.includes(q)) phi -= Math.atan2(p[1] - q[1], p[0] - q[0]) * DEG;
  for (const z of zeros) phi += Math.atan2(p[1] - z[1], p[0] - z[0]) * DEG;
  return Array.from({ length: mu }, (_, q) => wrap180((phi + 360 * q) / mu));
}
/**
 * Angle of arrival (degrees) at a zero z (K > 0): phi = 180(2q+1) + sum_i arg(z - p_i) - sum_{j != z} arg(z - z_j) (over multiplicity).
 */
export function angleOfArrival(L, z, opts = {}) {
  const poles = tfPoles(L), zeros = tfZeros(L);
  const same = rootsNear(zeros, z);
  const mu = Math.max(1, same.length);
  let phi = opts.negative ? 0 : 180;
  for (const q of poles) phi += Math.atan2(z[1] - q[1], z[0] - q[0]) * DEG;
  for (const w of zeros) if (!same.includes(w)) phi -= Math.atan2(z[1] - w[1], z[0] - w[0]) * DEG;
  return Array.from({ length: mu }, (_, q) => wrap180((phi + 360 * q) / mu));
}

// ------------------------------------------------------------------ criteria at a point

/**
 * Magnitude and angle criteria at a test point s: K = |D(s)| / |N(s)| and the angle of L(s) compared with 180 deg.
 * onLocus is true when the angle error is below tolDeg (default 1) and the implied K is positive.
 * @returns {{K:number, Kcomplex:[number,number], angleDeg:number, angleError:number, onLocus:boolean}}
 */
export function gainAtPoint(L, s, opts = {}) {
  const v = evalTf(L, s);
  const mag = cabs(v);
  const ang = Math.atan2(v[1], v[0]) * DEG;
  const target = opts.negative ? 0 : 180;
  const err = wrap180(ang - target);
  const Kc = (() => { const d = v[0] * v[0] + v[1] * v[1]; return [-v[0] / d, v[1] / d]; })();
  return { K: 1 / mag, Kcomplex: Kc, angleDeg: ang, angleError: err, onLocus: Math.abs(err) <= (opts.tolDeg ?? 1) };
}

/**
 * Where the locus crosses a parametrised curve s(t), t in [t0, t1]: roots of Im L(s(t)) = 0 with Re L(s(t)) < 0
 * (K = -1/L real and positive). Returns [{t, s, K}] sorted by K.
 */
export function locusCrossings(L, curve, t0, t1, opts = {}) {
  const n = opts.n ?? 3000;
  const logT = opts.log ?? false;
  const tOf = (i) => (logT ? t0 * (t1 / t0) ** (i / n) : t0 + ((t1 - t0) * i) / n);
  const sgn = opts.negative ? -1 : 1;
  const f = (t) => { const v = evalTf(L, curve(t)); return sgn * v[1] / (1 + cabs(v)); };
  const out = [];
  let tp = tOf(0), fp = f(tp);
  for (let i = 1; i <= n; i++) {
    const tc = tOf(i), fc = f(tc);
    if (Number.isFinite(fp) && Number.isFinite(fc) && fp !== fc && (fp < 0) !== (fc < 0)) {
      let a = tp, b = tc, fa = fp;
      for (let k = 0; k < 70; k++) {
        const m = 0.5 * (a + b), fm = f(m);
        if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
      }
      const t = 0.5 * (a + b);
      const s = curve(t);
      const v = evalTf(L, s);
      if (sgn * v[0] < 0 && Math.abs(v[0]) > 1e-14) {
        const K = Math.abs(1 / v[0]);
        if (Number.isFinite(K) && Math.abs(v[1]) < 1e-6 * Math.abs(v[0]) + 1e-12) out.push({ t, s, K });
      }
    }
    tp = tc; fp = fc;
  }
  return out.sort((a, b) => a.K - b.K);
}

/**
 * Gains K at which the locus crosses the constant-damping ray s = r e^{j(pi - acos(zeta))} (upper half plane).
 * Returns [{s, K, wn, zeta}] sorted by K (the conjugate pole is at conj(s)). Not defined for zeta >= 1 (returns []).
 */
export function gainForDamping(L, zeta, opts = {}) {
  if (!(zeta >= 0 && zeta < 1)) return [];
  const th = Math.PI - Math.acos(zeta);
  const sc = patternScale(L);
  const cs = Math.cos(th), sn = Math.sin(th);
  return locusCrossings(L, (r) => [r * cs, r * sn], 1e-3 * sc, 1e3 * sc, { ...opts, log: true })
    .map((c) => ({ s: c.s, K: c.K, wn: cabs(c.s), zeta }));
}
/** Gains at which the locus crosses the circle |s| = wn in the upper half plane. */
export function gainForWn(L, wn, opts = {}) {
  return locusCrossings(L, (th) => [wn * Math.cos(th), wn * Math.sin(th)], 1e-6, Math.PI - 1e-6, opts)
    .map((c) => ({ s: c.s, K: c.K, wn, zeta: -c.s[0] / wn }));
}
/** Gains at which the locus crosses the vertical line Re s = -sigma (upper half plane; settling-time design). */
export function gainForRealPart(L, sigma, opts = {}) {
  const sc = patternScale(L);
  return locusCrossings(L, (y) => [-sigma, y], 1e-6 * sc, 1e3 * sc, { ...opts, log: true })
    .map((c) => ({ s: c.s, K: c.K, sigma }));
}

/**
 * Everything a root-locus plot needs for L: the traced branches plus poles/zeros, asymptotes, real-axis segments,
 * break points, jw crossings with critical gain, and departure / arrival angles of the complex poles / zeros.
 */
export function analyzeLocus(L, opts = {}) {
  const poles = tfPoles(L), zeros = tfZeros(L);
  const complex = (z) => Math.abs(z[1]) > 1e-9 * Math.max(1, Math.abs(z[0]));
  return {
    locus: rootLocus(L, opts), poles, zeros,
    asymptotes: asymptotes(L, opts), segments: realAxisSegments(L, opts),
    breakaways: breakawayPoints(L, opts), crossings: imaginaryAxisCrossings(L, opts),
    criticalGain: criticalGain(L),
    departures: poles.filter((p) => complex(p) && p[1] > 0).map((p) => ({ pole: p, angles: angleOfDeparture(L, p, opts) })),
    arrivals: zeros.filter((z) => complex(z) && z[1] > 0).map((z) => ({ zero: z, angles: angleOfArrival(L, z, opts) })),
  };
}
