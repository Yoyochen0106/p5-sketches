// Parametric surfaces r(u, v) with analytic derivatives, differential geometry (fundamental forms,
// Gaussian / mean / principal curvatures, Christoffel symbols) and a coloured mesh generator.
// Pure functions: no DOM, no p5.
//
// CONVENTIONS
//   * A surface S has { id, label, params, domain {u0,u1,v0,v1}, periodicU, periodicV, poleV0, poleV1,
//     eval(u, v) -> { r, ru, rv, ruu, ruv, rvv } } where every entry is a 3-vector.
//   * The unit normal is n = ru x rv / |ru x rv|. L = n.ruu, M = n.ruv, N = n.rvv (second fundamental form).
//     Curvatures are signed with respect to n: kappa = II(t,t) / I(t,t). The sphere (parametrised with an
//     OUTWARD normal) therefore has K = +1/R^2 and H = (k1 + k2)/2 = -1/R.
//   * poleV0 / poleV1 mark a v-edge that collapses to a point (sphere / ellipsoid poles). Geometry queries
//     clamp v a hair inside the domain there, so K, H and normals stay finite at the pole itself.
//   * Surfaces of revolution use u = angle (periodic), v = profile parameter.

const TAU = Math.PI * 2;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Natural cubic spline (for user profile curves)

/** Natural cubic spline through ys at t = 0..n-1. Returns f(t) -> [value, d1, d2] (C2 inside). */
export function naturalSpline(ys) {
  const n = ys.length;
  const M = new Float64Array(n);
  if (n > 2) {
    const c = new Float64Array(n), d = new Float64Array(n);
    // solve tridiagonal (1, 4, 1) M = 6 * second differences, with M0 = M(n-1) = 0
    for (let i = 1; i < n - 1; i++) {
      const rhs = 6 * (ys[i + 1] - 2 * ys[i] + ys[i - 1]);
      const denom = 4 - (i > 1 ? c[i - 1] : 0);
      c[i] = 1 / denom;
      d[i] = (rhs - (i > 1 ? d[i - 1] : 0)) / denom;
    }
    for (let i = n - 2; i >= 1; i--) M[i] = d[i] - c[i] * M[i + 1];
  }
  return (t) => {
    const i = clamp(Math.floor(t), 0, Math.max(0, n - 2));
    const x = t - i;
    const y0 = ys[i], y1 = n > 1 ? ys[i + 1] : ys[i], m0 = M[i], m1 = n > 1 ? M[i + 1] : 0;
    const a = 1 - x;
    return [
      y0 * a + y1 * x + ((a * a * a - a) * m0 + (x * x * x - x) * m1) / 6,
      y1 - y0 + ((-3 * a * a + 1) * m0 + (3 * x * x - 1) * m1) / 6,
      m0 * a + m1 * x,
    ];
  };
}

// ---------------------------------------------------------------------------------------------
// Builders

/**
 * Surface of revolution r = (rho(v) cos u, rho(v) sin u, z(v)). prof(v) -> [rho, rho', rho'', z, z', z''].
 */
function revolution(id, label, params, domain, prof, extra = {}) {
  return {
    id, label, params, periodicU: true, periodicV: false, poleV0: false, poleV1: false, revolution: true,
    domain: { u0: 0, u1: TAU, ...domain }, profile: prof, ...extra,
    eval(u, v) {
      const [p, p1, p2, z, z1, z2] = prof(v);
      const c = Math.cos(u), s = Math.sin(u);
      return {
        r: [p * c, p * s, z], ru: [-p * s, p * c, 0], rv: [p1 * c, p1 * s, z1],
        ruu: [-p * c, -p * s, 0], ruv: [-p1 * s, p1 * c, 0], rvv: [p2 * c, p2 * s, z2],
      };
    },
    rho: (v) => prof(v)[0],
  };
}

/** Graph-like or free-form surface from an eval function. */
function free(id, label, params, domain, ev, extra = {}) {
  return {
    id, label, params, periodicU: false, periodicV: false, poleV0: false, poleV1: false, revolution: false,
    domain, eval: ev, ...extra,
  };
}

/** Preset profile curves [rho, z] for the 'revolve' surface (control points of a natural spline). */
export const PROFILES = [
  { label: 'vase', pts: [[0.55, -1.0], [0.8, -0.6], [0.5, -0.1], [0.35, 0.3], [0.55, 0.7], [0.75, 1.0]] },
  { label: 'dumbbell', pts: [[0.25, -1.2], [0.7, -0.9], [0.35, -0.4], [0.2, 0], [0.35, 0.4], [0.7, 0.9], [0.25, 1.2]] },
  { label: 'ripples', pts: [[0.6, -1.2], [0.9, -0.8], [0.5, -0.4], [0.9, 0], [0.5, 0.4], [0.9, 0.8], [0.6, 1.2]] },
  { label: 'bottle', pts: [[0.2, -1.3], [0.75, -1.1], [0.85, -0.4], [0.6, 0.3], [0.2, 0.7], [0.2, 1.3]] },
];

/**
 * Catalogue: id, label, parameter specs { key, label, min, max, step, def } and a factory.
 * Use createSurface(id, params) to build one.
 */
export const SURFACE_DEFS = [
  {
    id: 'sphere', label: 'Sphere', params: [{ key: 'R', label: 'radius R', min: 0.3, max: 2.5, step: 0.05, def: 1 }],
    make: ({ R }) => revolution('sphere', 'Sphere', { R }, { v0: 0, v1: Math.PI }, (v) => [
      R * Math.sin(v), R * Math.cos(v), -R * Math.sin(v), -R * Math.cos(v), R * Math.sin(v), R * Math.cos(v)],
    { poleV0: true, poleV1: true }),
  },
  {
    id: 'ellipsoid', label: 'Ellipsoid',
    params: [
      { key: 'a', label: 'semi-axis a (x)', min: 0.4, max: 2.2, step: 0.05, def: 1.4 },
      { key: 'b', label: 'semi-axis b (y)', min: 0.4, max: 2.2, step: 0.05, def: 1 },
      { key: 'c', label: 'semi-axis c (z)', min: 0.4, max: 2.2, step: 0.05, def: 0.7 },
    ],
    make: ({ a, b, c }) => free('ellipsoid', 'Ellipsoid', { a, b, c }, { u0: 0, u1: TAU, v0: 0, v1: Math.PI }, (u, v) => {
      const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      return {
        r: [a * sv * cu, b * sv * su, -c * cv],
        ru: [-a * sv * su, b * sv * cu, 0],
        rv: [a * cv * cu, b * cv * su, c * sv],
        ruu: [-a * sv * cu, -b * sv * su, 0],
        ruv: [-a * cv * su, b * cv * cu, 0],
        rvv: [-a * sv * cu, -b * sv * su, c * cv],
      };
    }, { periodicU: true, poleV0: true, poleV1: true }),
  },
  {
    id: 'torus', label: 'Torus',
    params: [
      { key: 'R', label: 'major radius R', min: 0.8, max: 3, step: 0.05, def: 1.5 },
      { key: 'r', label: 'minor radius r', min: 0.2, max: 1.2, step: 0.05, def: 0.6 },
    ],
    make: ({ R, r }) => revolution('torus', 'Torus', { R, r }, { v0: 0, v1: TAU }, (v) => [
      R + r * Math.cos(v), -r * Math.sin(v), -r * Math.cos(v), r * Math.sin(v), r * Math.cos(v), -r * Math.sin(v)],
    { periodicV: true }),
  },
  {
    id: 'saddle', label: 'Saddle (hyperbolic paraboloid)', params: [{ key: 'a', label: 'curvature a', min: 0.1, max: 1.5, step: 0.05, def: 0.5 }],
    make: ({ a }) => free('saddle', 'Saddle', { a }, { u0: -1.3, u1: 1.3, v0: -1.3, v1: 1.3 }, (u, v) => ({
      r: [u, v, a * (u * u - v * v)], ru: [1, 0, 2 * a * u], rv: [0, 1, -2 * a * v],
      ruu: [0, 0, 2 * a], ruv: [0, 0, 0], rvv: [0, 0, -2 * a],
    })),
  },
  {
    id: 'catenoid', label: 'Catenoid (minimal)', params: [{ key: 'a', label: 'neck radius a', min: 0.3, max: 1.5, step: 0.05, def: 0.7 }],
    make: ({ a }) => revolution('catenoid', 'Catenoid', { a }, { v0: -1.3, v1: 1.3 }, (v) => [
      a * Math.cosh(v / a), Math.sinh(v / a), Math.cosh(v / a) / a, v, 1, 0]),
  },
  {
    id: 'helicoid', label: 'Helicoid (minimal)', params: [{ key: 'c', label: 'pitch c', min: 0.1, max: 1, step: 0.05, def: 0.35 }],
    make: ({ c }) => free('helicoid', 'Helicoid', { c }, { u0: -2 * Math.PI, u1: 2 * Math.PI, v0: -1.5, v1: 1.5 }, (u, v) => {
      const cu = Math.cos(u), su = Math.sin(u);
      return {
        r: [v * cu, v * su, c * u], ru: [-v * su, v * cu, c], rv: [cu, su, 0],
        ruu: [-v * cu, -v * su, 0], ruv: [-su, cu, 0], rvv: [0, 0, 0],
      };
    }),
  },
  {
    id: 'pseudosphere', label: 'Pseudosphere (K = -1/a^2)', params: [{ key: 'a', label: 'radius a', min: 0.5, max: 1.6, step: 0.05, def: 1 }],
    make: ({ a }) => revolution('pseudosphere', 'Pseudosphere', { a }, { v0: 0.03, v1: 3.6 }, (v) => {
      const sech = 1 / Math.cosh(v), th = Math.tanh(v);
      // rho = a sech v, z = a (v - tanh v)
      return [
        a * sech, -a * sech * th, a * sech * (th * th - sech * sech),
        a * (v - th), a * th * th, 2 * a * th * sech * sech,
      ];
    }),
  },
  {
    id: 'bump', label: 'Gaussian bump', params: [
      { key: 'h', label: 'height h', min: 0.2, max: 2, step: 0.05, def: 1 },
      { key: 's', label: 'width s', min: 0.25, max: 1.2, step: 0.05, def: 0.55 },
    ],
    make: ({ h, s }) => free('bump', 'Gaussian bump', { h, s }, { u0: -2, u1: 2, v0: -2, v1: 2 }, (u, v) => {
      const s2 = s * s, f = h * Math.exp(-(u * u + v * v) / (2 * s2));
      return {
        r: [u, v, f], ru: [1, 0, -u / s2 * f], rv: [0, 1, -v / s2 * f],
        ruu: [0, 0, (u * u / (s2 * s2) - 1 / s2) * f], ruv: [0, 0, u * v / (s2 * s2) * f], rvv: [0, 0, (v * v / (s2 * s2) - 1 / s2) * f],
      };
    }),
  },
  {
    id: 'cylinder', label: 'Cylinder', params: [
      { key: 'R', label: 'radius R', min: 0.3, max: 2, step: 0.05, def: 0.9 },
      { key: 'h', label: 'height', min: 0.5, max: 4, step: 0.1, def: 2.4 },
    ],
    make: ({ R, h }) => revolution('cylinder', 'Cylinder', { R, h }, { v0: -h / 2, v1: h / 2 }, (v) => [R, 0, 0, v, 1, 0]),
  },
  {
    id: 'cone', label: 'Cone', params: [{ key: 'k', label: 'slope dz/drho', min: 0.2, max: 3, step: 0.05, def: 0.9 }],
    make: ({ k }) => revolution('cone', 'Cone', { k }, { v0: 0.05, v1: 1.5 }, (v) => [v, 1, 0, k * v - 0.6, k, 0]),
  },
  {
    id: 'enneper', label: 'Enneper (minimal)', params: [{ key: 'w', label: 'extent', min: 0.6, max: 1.8, step: 0.05, def: 1.3 }],
    make: ({ w }) => free('enneper', 'Enneper surface', { w }, { u0: -w, u1: w, v0: -w, v1: w }, (u, v) => ({
      r: [u - u * u * u / 3 + u * v * v, v - v * v * v / 3 + v * u * u, u * u - v * v],
      ru: [1 - u * u + v * v, 2 * u * v, 2 * u],
      rv: [2 * u * v, 1 - v * v + u * u, -2 * v],
      ruu: [-2 * u, 2 * v, 2], ruv: [2 * v, 2 * u, 0], rvv: [2 * u, -2 * v, -2],
    })),
  },
  {
    id: 'revolve', label: 'Surface of revolution (profile)', params: [
      { key: 'shape', label: 'profile (0 vase, 1 dumbbell, 2 ripples, 3 bottle)', min: 0, max: PROFILES.length - 1, step: 1, def: 0 },
    ],
    make: ({ shape }, extra = {}) => {
      const pts = extra.profile || PROFILES[clamp(Math.round(shape), 0, PROFILES.length - 1)].pts;
      const fr = naturalSpline(pts.map((q) => q[0])), fz = naturalSpline(pts.map((q) => q[1]));
      const MIN_RHO = 0.04;
      return revolution('revolve', 'Revolved profile', { shape }, { v0: 0, v1: pts.length - 1 }, (v) => {
        const a = fr(v), b = fz(v);
        // rho is kept away from the axis so the surface stays regular
        return a[0] >= MIN_RHO ? [a[0], a[1], a[2], b[0], b[1], b[2]] : [MIN_RHO, 0, 0, b[0], b[1], b[2]];
      });
    },
  },
];

const DEFS = new Map(SURFACE_DEFS.map((d) => [d.id, d]));

/** Builds a surface by catalogue id. Missing or invalid params fall back to defaults; values are clamped. */
export function createSurface(id, params = {}, extra = {}) {
  const def = DEFS.get(id);
  if (!def) throw new Error(`unknown surface "${id}"`);
  const p = {};
  for (const spec of def.params) {
    const raw = Number(params[spec.key]);
    p[spec.key] = Number.isFinite(raw) ? clamp(raw, spec.min, spec.max) : spec.def;
  }
  const S = def.make(p, extra);
  S.defId = id;
  return S;
}

/** The surface param span used as a length scale for visual aids (max bounding-box extent). */
export function surfaceExtent(S, n = 12) {
  const { u0, u1, v0, v1 } = S.domain;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const r = S.eval(u0 + (u1 - u0) * i / n, clampV(S, v0 + (v1 - v0) * j / n)).r;
      for (let k = 0; k < 3; k++) { if (r[k] < lo[k]) lo[k] = r[k]; if (r[k] > hi[k]) hi[k] = r[k]; }
    }
  }
  return { min: lo, max: hi, size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
}

// ---------------------------------------------------------------------------------------------
// Pole handling and domain helpers

/** Clamps v a hair inside pole edges so the metric is non-degenerate. */
export function clampV(S, v) {
  const { v0, v1 } = S.domain;
  const d = 1e-5 * (v1 - v0);
  if (S.poleV0 && v < v0 + d) return v0 + d;
  if (S.poleV1 && v > v1 - d) return v1 - d;
  return v;
}

/** Wraps periodic coordinates into the base domain and clamps the others. */
export function wrapUV(S, u, v) {
  const { u0, u1, v0, v1 } = S.domain;
  let uu = u, vv = v;
  if (S.periodicU) { const s = u1 - u0; uu = u0 + ((((u - u0) % s) + s) % s); } else uu = clamp(u, u0, u1);
  if (S.periodicV) { const s = v1 - v0; vv = v0 + ((((v - v0) % s) + s) % s); } else vv = clamp(v, v0, v1);
  return [uu, vv];
}

// ---------------------------------------------------------------------------------------------
// Local geometry

/**
 * Full local geometry at (u, v): r, ru, rv, n, E, F, G, L, M, N, W (area element), K, H, k1 >= k2 (principal
 * curvatures), inverse metric gu = [g11, g12, g22] and `gamma` = [G111, G112, G122, G211, G212, G222]
 * where Gamma^k_ij = g^{kl} (r_ij . r_l) (analytic: needs only second derivatives).
 */
export function localGeometry(S, u, v) {
  const vc = clampV(S, v);
  const d = S.eval(u, vc);
  const { ru, rv, ruu, ruv, rvv } = d;
  const E = dot(ru, ru), F = dot(ru, rv), G = dot(rv, rv);
  const cr = cross(ru, rv);
  const W = Math.hypot(cr[0], cr[1], cr[2]);
  const n = W > 0 ? [cr[0] / W, cr[1] / W, cr[2] / W] : [0, 0, 1];
  const L = dot(n, ruu), M = dot(n, ruv), N = dot(n, rvv);
  const det = E * G - F * F;
  const K = det > 0 ? (L * N - M * M) / det : 0;
  const H = det > 0 ? (E * N - 2 * F * M + G * L) / (2 * det) : 0;
  const disc = Math.sqrt(Math.max(0, H * H - K));
  const gi = det > 0 ? [G / det, -F / det, E / det] : [0, 0, 0];
  const a1 = [dot(ruu, ru), dot(ruu, rv)], a2 = [dot(ruv, ru), dot(ruv, rv)], a3 = [dot(rvv, ru), dot(rvv, rv)];
  const gam = (a) => [gi[0] * a[0] + gi[1] * a[1], gi[1] * a[0] + gi[2] * a[1]];
  const c11 = gam(a1), c12 = gam(a2), c22 = gam(a3);
  return {
    u, v: vc, r: d.r, ru, rv, ruu, ruv, rvv, n, E, F, G, L, M, N, W, K, H, k1: H + disc, k2: H - disc, gi,
    gamma: [c11[0], c12[0], c22[0], c11[1], c12[1], c22[1]],
  };
}

/** Christoffel symbols [G111, G112, G122, G211, G212, G222] at (u, v). Lean version of localGeometry().gamma. */
export function christoffel(S, u, v) {
  const d = S.eval(u, clampV(S, v));
  const { ru, rv, ruu, ruv, rvv } = d;
  const E = dot(ru, ru), F = dot(ru, rv), G = dot(rv, rv);
  const det = E * G - F * F;
  if (!(det > 0)) return [0, 0, 0, 0, 0, 0];
  const g0 = G / det, g1 = -F / det, g2 = E / det;
  const a1 = dot(ruu, ru), a2 = dot(ruu, rv), b1 = dot(ruv, ru), b2 = dot(ruv, rv), c1 = dot(rvv, ru), c2 = dot(rvv, rv);
  return [g0 * a1 + g1 * a2, g0 * b1 + g1 * b2, g0 * c1 + g1 * c2, g1 * a1 + g2 * a2, g1 * b1 + g2 * b2, g1 * c1 + g2 * c2];
}

/**
 * Christoffel symbols from a numerically differentiated metric (central differences, step h):
 * the independent fallback / cross-check for `christoffel`.
 */
export function christoffelNumeric(S, u, v, h = 1e-5) {
  const g = (uu, vv) => { const q = localGeometry(S, uu, vv); return [q.E, q.F, q.G]; };
  const idx = (i, j) => (i === j ? (i === 0 ? 0 : 2) : 1);
  const gu = g(u + h, v), gl = g(u - h, v), gvp = g(u, v + h), gvm = g(u, v - h);
  const dg = [0, 1].map((k) => (k === 0 ? gu.map((x, i) => (x - gl[i]) / (2 * h)) : gvp.map((x, i) => (x - gvm[i]) / (2 * h))));
  const loc = localGeometry(S, u, v);
  const gi = [[loc.gi[0], loc.gi[1]], [loc.gi[1], loc.gi[2]]];
  const out = [];
  for (const k of [0, 1]) {
    for (const [i, j] of [[0, 0], [0, 1], [1, 1]]) {
      let s = 0;
      for (const l of [0, 1]) s += gi[k][l] * (dg[i][idx(j, l)] + dg[j][idx(i, l)] - dg[l][idx(i, j)]);
      out.push(s / 2);
    }
  }
  return out;
}

/**
 * Principal curvatures and directions at (u, v). d1, d2 are parameter-space vectors normalised in the
 * metric (|d|_g = 1), t1, t2 the matching unit 3D tangents. `umbilic` is true when k1 ~ k2.
 */
export function principalDirections(S, u, v) {
  const q = localGeometry(S, u, v);
  const [g11, g12, g22] = q.gi;
  // shape operator in the (ru, rv) basis: columns = I^-1 II
  const a = g11 * q.L + g12 * q.M, b = g11 * q.M + g12 * q.N;
  const c = g12 * q.L + g22 * q.M, d = g12 * q.M + g22 * q.N;
  const umbilic = Math.abs(q.k1 - q.k2) < 1e-7 * (1 + Math.abs(q.k1) + Math.abs(q.k2));
  const vec = (k) => {
    if (umbilic) return [1, 0];
    const x1 = [b, k - a], x2 = [k - d, c];
    const x = Math.hypot(...x1) >= Math.hypot(...x2) ? x1 : x2;
    return Math.hypot(x[0], x[1]) > 0 ? x : [1, 0];
  };
  const norm = (x) => {
    const l = Math.sqrt(q.E * x[0] * x[0] + 2 * q.F * x[0] * x[1] + q.G * x[1] * x[1]);
    return l > 0 ? [x[0] / l, x[1] / l] : [1, 0];
  };
  const d1 = norm(vec(q.k1)), d2 = umbilic ? norm([-q.F * 1 - q.G * 0, q.E]) : norm(vec(q.k2));
  const lift = (x) => [q.ru[0] * x[0] + q.rv[0] * x[1], q.ru[1] * x[0] + q.rv[1] * x[1], q.ru[2] * x[0] + q.rv[2] * x[1]];
  return { k1: q.k1, k2: q.k2, K: q.K, H: q.H, d1, d2, t1: lift(d1), t2: lift(d2), n: q.n, r: q.r, umbilic };
}

/**
 * Dupin indicatrix k1 x^2 + k2 y^2 = +-c in the tangent plane (x, y along the principal directions),
 * scaled so the larger semi-axis is `radius`. Returns { type, curves } with curves = arrays of 3D points
 * (already offset by `lift` along the normal). type: 'circle' | 'ellipse' | 'hyperbola' | 'parabolic' | 'planar'.
 */
export function dupinIndicatrix(S, u, v, { radius = 0.3, samples = 72, lift = 0 } = {}) {
  const pd = principalDirections(S, u, v);
  const { k1, k2 } = pd;
  const eps = 1e-9;
  const to3 = (x, y) => [
    pd.r[0] + pd.t1[0] * x + pd.t2[0] * y + pd.n[0] * lift,
    pd.r[1] + pd.t1[1] * x + pd.t2[1] * y + pd.n[1] * lift,
    pd.r[2] + pd.t1[2] * x + pd.t2[2] * y + pd.n[2] * lift,
  ];
  const a1 = Math.abs(k1), a2 = Math.abs(k2);
  const kmax = Math.max(a1, a2);
  if (kmax < eps) return { type: 'planar', curves: [], k1, k2, pd };
  const curves = [];
  if (k1 * k2 > eps * eps && Math.min(a1, a2) > 1e-6 * kmax) {
    // ellipse: semi-axes sqrt(c / |k|); larger one = radius  =>  c = min|k| radius^2
    const c = Math.min(a1, a2) * radius * radius;
    const ax = Math.sqrt(c / a1), ay = Math.sqrt(c / a2);
    const pts = [];
    for (let i = 0; i <= samples; i++) { const t = (i / samples) * TAU; pts.push(to3(ax * Math.cos(t), ay * Math.sin(t))); }
    curves.push(pts);
    return { type: Math.abs(k1 - k2) < 1e-7 * kmax ? 'circle' : 'ellipse', curves, k1, k2, pd };
  }
  if (k1 * k2 < -eps * eps && Math.min(a1, a2) > 1e-6 * kmax) {
    // hyperbolas k1 x^2 + k2 y^2 = +-c, truncated to |p| <= 2 radius
    const c = Math.min(a1, a2) * radius * radius;
    const R = 2 * radius;
    for (const sgn of [1, -1]) {
      // branch along the axis whose curvature has the sign of sgn*c
      const along1 = Math.sign(k1) === sgn; // k1 x^2 dominates: x = +-sqrt((sgn c - k2 y^2)/k1)
      for (const side of [1, -1]) {
        const pts = [];
        for (let i = -samples; i <= samples; i++) {
          const w = (i / samples) * R;
          const num = (sgn * c - (along1 ? k2 : k1) * w * w) / (along1 ? k1 : k2);
          if (!(num >= 0)) continue;
          const s = side * Math.sqrt(num);
          const x = along1 ? s : w, y = along1 ? w : s;
          if (x * x + y * y <= R * R) pts.push(to3(x, y));
        }
        if (pts.length > 1) curves.push(pts);
      }
    }
    return { type: 'hyperbola', curves, k1, k2, pd };
  }
  // parabolic point: one curvature ~ 0 -> two parallel lines k x^2 = +-c
  const kk = a1 >= a2 ? k1 : k2;
  const c = Math.abs(kk) * radius * radius;
  const ax = Math.sqrt(c / Math.abs(kk));
  const lineAlongY = a1 >= a2; // curved direction is x (t1) when |k1| is the big one
  for (const side of [1, -1]) {
    const pts = [];
    for (let i = -8; i <= 8; i++) {
      const w = (i / 8) * 2 * radius;
      pts.push(lineAlongY ? to3(side * ax, w) : to3(w, side * ax));
    }
    curves.push(pts);
  }
  return { type: 'parabolic', curves, k1, k2, pd };
}

// ---------------------------------------------------------------------------------------------
// Projection of a 3D point to (u, v)

/** Gauss-Newton closest point: refines (u, v) so that r(u, v) is nearest to `point`. Returns { u, v, dist }. */
export function projectToSurface(S, point, u, v, iterations = 8) {
  let uu = u, vv = v;
  for (let it = 0; it < iterations; it++) {
    const q = localGeometry(S, uu, vv);
    const d = [point[0] - q.r[0], point[1] - q.r[1], point[2] - q.r[2]];
    const bu = dot(q.ru, d), bv = dot(q.rv, d);
    const det = q.E * q.G - q.F * q.F;
    if (!(det > 1e-20)) break;
    let du = (q.G * bu - q.F * bv) / det, dv = (q.E * bv - q.F * bu) / det;
    const m = Math.max(Math.abs(du), Math.abs(dv));
    if (m > 0.5) { du *= 0.5 / m; dv *= 0.5 / m; }
    uu += du; vv += dv;
    const { u0, u1, v0, v1 } = S.domain;
    if (!S.periodicU) uu = clamp(uu, u0, u1);
    if (!S.periodicV) vv = clamp(vv, v0, v1);
    if (m < 1e-12) break;
  }
  const r = S.eval(uu, clampV(S, vv)).r;
  return { u: uu, v: vv, dist: Math.hypot(point[0] - r[0], point[1] - r[1], point[2] - r[2]) };
}

/**
 * Refines a ray / mesh hit to the exact surface: Newton on r(u, v) = origin + t dir, starting from (u, v, t).
 * Returns { u, v, t, ok }; when Newton does not converge the start values are returned with ok = false.
 */
export function intersectRay(S, ray, u, v, t, iterations = 12) {
  let uu = u, vv = v, tt = t;
  const o = ray.origin, d = ray.dir;
  for (let it = 0; it < iterations; it++) {
    const e = S.eval(uu, clampV(S, vv));
    const f = [e.r[0] - o[0] - tt * d[0], e.r[1] - o[1] - tt * d[1], e.r[2] - o[2] - tt * d[2]];
    if (Math.hypot(f[0], f[1], f[2]) < 1e-12) return { u: uu, v: vv, t: tt, ok: true };
    // solve [ru rv -d] x = -f by Cramer's rule
    const a = e.ru, b = e.rv, c = [-d[0], -d[1], -d[2]];
    const det = dot(a, cross(b, c));
    if (!(Math.abs(det) > 1e-14)) break;
    const rhs = [-f[0], -f[1], -f[2]];
    let du = dot(rhs, cross(b, c)) / det, dv = dot(a, cross(rhs, c)) / det, dt = dot(a, cross(b, rhs)) / det;
    const m = Math.max(Math.abs(du), Math.abs(dv));
    if (m > 0.3) { du *= 0.3 / m; dv *= 0.3 / m; dt *= 0.3 / m; }
    uu += du; vv += dv; tt += dt;
    if (!Number.isFinite(uu + vv + tt)) break;
    const { u0, u1, v0, v1 } = S.domain;
    if ((!S.periodicU && (uu < u0 - 1e-9 || uu > u1 + 1e-9)) || (!S.periodicV && (vv < v0 - 1e-9 || vv > v1 + 1e-9))) break;
  }
  const e = S.eval(uu, clampV(S, vv));
  const err = Math.hypot(e.r[0] - o[0] - tt * d[0], e.r[1] - o[1] - tt * d[1], e.r[2] - o[2] - tt * d[2]);
  return err < 1e-9 ? { u: uu, v: vv, t: tt, ok: true } : { u, v, t, ok: false };
}

// ---------------------------------------------------------------------------------------------
// Mesh

/**
 * Triangle mesh over the whole domain in the same format as lib/marching.js plus per-vertex data:
 * { positions, normals, indices, vertexCount, triangleCount, uv, K, H, nu, nv } (Float32 / Uint32).
 * Seam vertices are duplicated (not welded), so uv interpolation inside a triangle is always valid.
 * Triangles are counter-clockwise about the surface normal n = ru x rv.
 */
export function meshSurface(S, { nu = 64, nv = 48 } = {}) {
  nu = clamp(Math.round(nu), 2, 400); nv = clamp(Math.round(nv), 2, 400);
  const { u0, u1, v0, v1 } = S.domain;
  const V = (nu + 1) * (nv + 1);
  const positions = new Float32Array(V * 3), normals = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  const K = new Float32Array(V), H = new Float32Array(V);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = u0 + ((u1 - u0) * i) / nu, v = v0 + ((v1 - v0) * j) / nv;
      const q = localGeometry(S, u, v);
      const k = j * (nu + 1) + i;
      // the pole vertex itself sits exactly on the axis; use the unclamped position
      const r = S.poleV0 && j === 0 ? S.eval(u, v0).r : S.poleV1 && j === nv ? S.eval(u, v1).r : q.r;
      positions.set(r, k * 3);
      normals.set(q.n, k * 3);
      uv[k * 2] = u; uv[k * 2 + 1] = v;
      K[k] = Number.isFinite(q.K) ? q.K : 0;
      H[k] = Number.isFinite(q.H) ? q.H : 0;
    }
  }
  const indices = new Uint32Array(nu * nv * 6);
  let t = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      indices[t++] = a; indices[t++] = b; indices[t++] = c;
      indices[t++] = a; indices[t++] = c; indices[t++] = d;
    }
  }
  return { positions, normals, indices, vertexCount: V, triangleCount: nu * nv * 2, uv, K, H, nu, nv };
}

/** Robust symmetric colour scale: the p-quantile of |values| (min `floor`). */
export function symmetricScale(values, p = 0.95, floor = 1e-9) {
  const a = Array.from(values, (x) => Math.abs(x)).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return floor;
  return Math.max(floor, a[Math.min(a.length - 1, Math.floor(p * a.length))]);
}
