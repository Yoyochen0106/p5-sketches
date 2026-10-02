// Vector calculus toolkit (pure, no DOM / p5): differential operators, flow lines, line / area /
// surface / volume integrals, Green / divergence / Stokes theorem checks, scalar potentials and
// stream functions, and a periodic Helmholtz decomposition (FFT).
//
// Conventions
//   2D field  F(x, y) -> [Fx, Fy]            3D field F(x, y, z) -> [Fx, Fy, Fz]
//   "field object"  makeField2 / makeField3 wrap F and (optionally) an analytic Jacobian.
//   Polygons are arrays of [x, y]; orientation = sign of the signed area (CCW = +1).
//   div F = dFx/dx + dFy/dy,  curl F (2D scalar) = dFy/dx - dFx/dy.
//   Stream function psi of a divergence-free field: grad psi = (-Fy, Fx), i.e. F = (psi_y, -psi_x).

import { fft, ifft } from './fft.js';

const fin = (v) => (Number.isFinite(v) ? v : 0);

// ---------------------------------------------------------------------------------------------
// Quadrature

const glCache = new Map();

/** Gauss-Legendre nodes / weights on [-1, 1] for n points (cached): { x: Float64Array, w: Float64Array }. */
export function gaussLegendre(n) {
  n = Math.max(1, Math.round(n));
  if (glCache.has(n)) return glCache.get(n);
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 1;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 0; j < n; j++) {
        const p3 = p2; p2 = p1;
        p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * pp * pp);
  }
  const r = { x, w };
  glCache.set(n, r);
  return r;
}

// ---------------------------------------------------------------------------------------------
// Differential operators (central differences with step h; analytic when a Jacobian is supplied)

/** 2D Jacobian [[dFx/dx, dFx/dy], [dFy/dx, dFy/dy]] by central differences. */
export function jacobian2(F, x, y, h = 1e-4) {
  const a = F(x + h, y), b = F(x - h, y), c = F(x, y + h), d = F(x, y - h);
  const s = 1 / (2 * h);
  return [[fin((a[0] - b[0]) * s), fin((c[0] - d[0]) * s)], [fin((a[1] - b[1]) * s), fin((c[1] - d[1]) * s)]];
}
export function div2(F, x, y, h = 1e-4) { const J = jacobian2(F, x, y, h); return J[0][0] + J[1][1]; }
export function curl2(F, x, y, h = 1e-4) { const J = jacobian2(F, x, y, h); return J[1][0] - J[0][1]; }

/** 3x3 Jacobian J[i][j] = dF_i / dx_j by central differences. */
export function jacobian3(F, x, y, z, h = 1e-4) {
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const s = 1 / (2 * h);
  for (let j = 0; j < 3; j++) {
    const p = [x, y, z], m = [x, y, z];
    p[j] += h; m[j] -= h;
    const a = F(p[0], p[1], p[2]), b = F(m[0], m[1], m[2]);
    for (let i = 0; i < 3; i++) J[i][j] = fin((a[i] - b[i]) * s);
  }
  return J;
}
export function div3(F, x, y, z, h = 1e-4) { const J = jacobian3(F, x, y, z, h); return J[0][0] + J[1][1] + J[2][2]; }
/** curl F = (dFz/dy - dFy/dz, dFx/dz - dFz/dx, dFy/dx - dFx/dy). */
export function curl3(F, x, y, z, h = 1e-4) {
  const J = jacobian3(F, x, y, z, h);
  return [J[2][1] - J[1][2], J[0][2] - J[2][0], J[1][0] - J[0][1]];
}

/** Wraps a 2D field: { f, jac, div, curl, analytic }. `jac(x, y)` is optional (analytic Jacobian). */
export function makeField2(f, jac = null, h = 1e-4) {
  const J = jac || ((x, y, hh = h) => jacobian2(f, x, y, hh));
  return {
    f,
    analytic: !!jac,
    jac: (x, y, hh) => (jac ? jac(x, y) : J(x, y, hh)),
    div: (x, y, hh) => { const m = jac ? jac(x, y) : J(x, y, hh); return fin(m[0][0] + m[1][1]); },
    curl: (x, y, hh) => { const m = jac ? jac(x, y) : J(x, y, hh); return fin(m[1][0] - m[0][1]); },
  };
}

/** Wraps a 3D field: { f, jac, div, curl, analytic }. */
export function makeField3(f, jac = null, h = 1e-4) {
  const get = (x, y, z, hh) => (jac ? jac(x, y, z) : jacobian3(f, x, y, z, hh || h));
  return {
    f,
    analytic: !!jac,
    jac: get,
    div: (x, y, z, hh) => { const m = get(x, y, z, hh); return fin(m[0][0] + m[1][1] + m[2][2]); },
    curl: (x, y, z, hh) => { const m = get(x, y, z, hh); return [fin(m[2][1] - m[1][2]), fin(m[0][2] - m[2][0]), fin(m[1][0] - m[0][1])]; },
  };
}

// ---------------------------------------------------------------------------------------------
// Presets

/** 2D presets: { id, label, caption, f, jac? }. A missing `jac` means "numerical derivatives". */
export const PRESETS_2D = [
  { id: 'uniform', label: 'uniform flow', caption: 'Constant field (1, 0.3): div = curl = 0 everywhere.', f: () => [1, 0.3], jac: () => [[0, 0], [0, 0]] },
  { id: 'source', label: 'source', caption: 'F = (x, y): radial outflow, div = 2, curl = 0.', f: (x, y) => [x, y], jac: () => [[1, 0], [0, 1]] },
  { id: 'sink', label: 'sink', caption: 'F = (-x, -y): radial inflow, div = -2, curl = 0.', f: (x, y) => [-x, -y], jac: () => [[-1, 0], [0, -1]] },
  { id: 'vortex', label: 'rigid vortex', caption: 'F = (-y, x): rotation, div = 0, curl = 2 (a paddle wheel spins).', f: (x, y) => [-y, x], jac: () => [[0, -1], [1, 0]] },
  { id: 'saddle', label: 'saddle', caption: 'F = (x, -y): stretches in x, squeezes in y; div = 0, curl = 0.', f: (x, y) => [x, -y], jac: () => [[1, 0], [0, -1]] },
  {
    id: 'dipole', label: 'dipole (+/- charges)', caption: 'Field of charges +1 at (-1, 0) and -1 at (1, 0), softened core: div and curl vanish away from the charges.',
    f: (x, y) => {
      const e = 0.05;
      const a = (x + 1) ** 2 + y * y + e, b = (x - 1) ** 2 + y * y + e;
      return [(x + 1) / a - (x - 1) / b, y / a - y / b];
    },
  },
  { id: 'shear', label: 'shear', caption: 'F = (y, 0): layers slide past each other. div = 0 but curl = -1 (not irrotational!).', f: (x, y) => [y, 0], jac: () => [[0, 1], [0, 0]] },
  {
    id: 'lv', label: 'Lotka-Volterra', caption: 'F = (x(1 - y), y(x - 1)): predator-prey, fixed point (1, 1) is a centre, (0, 0) a saddle.',
    f: (x, y) => [x * (1 - y), y * (x - 1)], jac: (x, y) => [[1 - y, -x], [y, x - 1]],
  },
  { id: 'swirl', label: 'swirl + source', caption: 'F = (0.4x - y, x + 0.4y): a spiral; div = 0.8 and curl = 2 are both non-zero.', f: (x, y) => [0.4 * x - y, x + 0.4 * y], jac: () => [[0.4, -1], [1, 0.4]] },
  { id: 'gradient', label: 'gradient of x^2 y', caption: 'F = grad(x^2 y) = (2xy, x^2): conservative (curl = 0), div = 2y.', f: (x, y) => [2 * x * y, x * x], jac: (x, y) => [[2 * y, 2 * x], [2 * x, 0]] },
  {
    id: 'bump', label: 'gradient of a bump', caption: 'F = grad(exp(-r^2/2)): conservative, flows toward the hill top reversed (points inward).',
    f: (x, y) => { const e = Math.exp(-(x * x + y * y) / 2); return [-x * e, -y * e]; },
    jac: (x, y) => { const e = Math.exp(-(x * x + y * y) / 2); return [[(x * x - 1) * e, x * y * e], [x * y * e, (y * y - 1) * e]]; },
  },
  {
    id: 'cells', label: 'convection cells', caption: 'F = (sin x cos y, -cos x sin y), stream function sin x sin y: divergence-free, rotational cells.',
    f: (x, y) => [Math.sin(x) * Math.cos(y), -Math.cos(x) * Math.sin(y)],
    jac: (x, y) => [[Math.cos(x) * Math.cos(y), -Math.sin(x) * Math.sin(y)], [Math.sin(x) * Math.sin(y), -Math.cos(x) * Math.cos(y)]],
  },
];

/** 3D presets: { id, label, caption, f, jac? }. */
export const PRESETS_3D = [
  { id: 'radial', label: 'radial r', caption: 'F = (x, y, z): div = 3, curl = 0.', f: (x, y, z) => [x, y, z], jac: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { id: 'rotation', label: 'rotation about z', caption: 'F = (-y, x, 0): curl = (0, 0, 2), div = 0.', f: (x, y) => [-y, x, 0], jac: () => [[0, -1, 0], [1, 0, 0], [0, 0, 0]] },
  { id: 'screw', label: 'screw (rotation + lift)', caption: 'F = (-y, x, 0.5): helical streamlines, div = 0.', f: (x, y) => [-y, x, 0.5], jac: () => [[0, -1, 0], [1, 0, 0], [0, 0, 0]] },
  { id: 'saddle3', label: 'saddle (x, y, -2z)', caption: 'Divergence-free stagnation flow: div = 0, curl = 0.', f: (x, y, z) => [x, y, -2 * z], jac: () => [[1, 0, 0], [0, 1, 0], [0, 0, -2]] },
  { id: 'poly', label: 'x^2 y, y^2 z, z^2 x', caption: 'F = (x^2 y, y^2 z, z^2 x): div = 2(xy + yz + zx), non-trivial curl.', f: (x, y, z) => [x * x * y, y * y * z, z * z * x], jac: (x, y, z) => [[2 * x * y, x * x, 0], [0, 2 * y * z, y * y], [z * z, 0, 2 * z * x]] },
  {
    id: 'coulomb', label: 'point charge r/|r|^3', caption: 'Inverse-square field: div = 0 except at the origin, flux through any surface around the origin is 4 pi (Gauss). The divergence theorem needs the delta function there.',
    f: (x, y, z) => { const r2 = x * x + y * y + z * z + 1e-6; const k = 1 / (r2 * Math.sqrt(r2)); return [x * k, y * k, z * k]; },
  },
  {
    id: 'wire', label: 'wire (-y, x, 0)/rho^2', caption: 'Magnetic field of a straight current along z: curl = 0 off the axis but the circulation around the axis is 2 pi (Ampere).',
    f: (x, y) => { const r2 = x * x + y * y + 1e-6; return [-y / r2, x / r2, 0]; },
  },
  {
    id: 'abc', label: 'ABC flow (Beltrami)', caption: 'F = (sin z + cos y, sin x + cos z, sin y + cos x): curl F = F and div = 0.',
    f: (x, y, z) => [Math.sin(z) + Math.cos(y), Math.sin(x) + Math.cos(z), Math.sin(y) + Math.cos(x)],
    jac: (x, y, z) => [[0, -Math.sin(y), Math.cos(z)], [Math.cos(x), 0, -Math.sin(z)], [-Math.sin(x), Math.cos(y), 0]],
  },
  { id: 'swirl3', label: 'swirl + source', caption: 'F = (x - y, x + y, -z/2): expanding spiral with sinking axis; div = 1.5, curl = (0, 0, 2).', f: (x, y, z) => [x - y, x + y, -z / 2], jac: () => [[1, -1, 0], [1, 1, 0], [0, 0, -0.5]] },
];

// ---------------------------------------------------------------------------------------------
// Flow lines (RK4)

/**
 * RK4 integral curve of the field f(x, y) -> [Fx, Fy] parametrised by arc length (unit speed), so
 * step `h` is a length. Stops at the bounds { xmin, xmax, ymin, ymax }, at stagnation points
 * (|F| < minSpeed), or after maxSteps. Returns { pts: Float64Array [x0,y0,x1,y1,...], count, reason }.
 */
export function streamline2(f, x0, y0, opts = {}) {
  const { h = 0.05, maxSteps = 400, dir = 1, bounds = null, minSpeed = 1e-9 } = opts;
  const pts = new Float64Array((maxSteps + 1) * 2);
  let x = x0, y = y0, n = 0, reason = 'steps';
  const unit = (px, py) => {
    const v = f(px, py);
    const s = Math.hypot(v[0], v[1]);
    return s > minSpeed && Number.isFinite(s) ? [(dir * v[0]) / s, (dir * v[1]) / s] : null;
  };
  pts[0] = x; pts[1] = y; n = 1;
  for (let i = 0; i < maxSteps; i++) {
    const k1 = unit(x, y);
    if (!k1) { reason = 'stagnation'; break; }
    const k2 = unit(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1]);
    const k3 = k2 && unit(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1]);
    const k4 = k3 && unit(x + h * k3[0], y + h * k3[1]);
    if (!k4) { reason = 'stagnation'; break; }
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { reason = 'invalid'; break; }
    if (bounds && (x < bounds.xmin || x > bounds.xmax || y < bounds.ymin || y > bounds.ymax)) { reason = 'bounds'; break; }
    pts[n * 2] = x; pts[n * 2 + 1] = y; n++;
  }
  return { pts, count: n, reason };
}

/** 3D version of streamline2 (unit-speed RK4). Returns { pts: Float64Array xyz..., count, reason }. */
export function streamline3(f, x0, y0, z0, opts = {}) {
  const { h = 0.08, maxSteps = 300, dir = 1, bounds = null, minSpeed = 1e-9 } = opts;
  const pts = new Float64Array((maxSteps + 1) * 3);
  let x = x0, y = y0, z = z0, n = 1, reason = 'steps';
  const unit = (px, py, pz) => {
    const v = f(px, py, pz);
    const s = Math.hypot(v[0], v[1], v[2]);
    return s > minSpeed && Number.isFinite(s) ? [(dir * v[0]) / s, (dir * v[1]) / s, (dir * v[2]) / s] : null;
  };
  pts[0] = x; pts[1] = y; pts[2] = z;
  for (let i = 0; i < maxSteps; i++) {
    const k1 = unit(x, y, z);
    if (!k1) { reason = 'stagnation'; break; }
    const k2 = unit(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2]);
    const k3 = k2 && unit(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2]);
    const k4 = k3 && unit(x + h * k3[0], y + h * k3[1], z + h * k3[2]);
    if (!k4) { reason = 'stagnation'; break; }
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    if (![x, y, z].every(Number.isFinite)) { reason = 'invalid'; break; }
    if (bounds && (x < bounds.min[0] || x > bounds.max[0] || y < bounds.min[1] || y > bounds.max[1] || z < bounds.min[2] || z > bounds.max[2])) { reason = 'bounds'; break; }
    pts[n * 3] = x; pts[n * 3 + 1] = y; pts[n * 3 + 2] = z; n++;
  }
  return { pts, count: n, reason };
}

/**
 * Line-integral-convolution style texture: a deterministic white-noise image smeared along the
 * streamlines of f (box kernel of 2*steps+1 samples). Returns { lic, mag } Float32Arrays (nx*ny,
 * row 0 = ymax, i.e. image order); `lic` in [0, 1] (contrast stretched), `mag` = |F| per pixel.
 */
export function licField(f, bounds, nx, ny, opts = {}) {
  const { steps = 10, stepPx = 0.8, seed = 7 } = opts;
  const noise = new Float32Array(nx * ny);
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < noise.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    noise[i] = (s & 0xffff) / 65535;
  }
  const dx = (bounds.xmax - bounds.xmin) / nx, dy = (bounds.ymax - bounds.ymin) / ny;
  const lic = new Float32Array(nx * ny), mag = new Float32Array(nx * ny);
  const sample = (px, py) => {
    const i = Math.floor(px), j = Math.floor(py);
    return i >= 0 && j >= 0 && i < nx && j < ny ? noise[j * nx + i] : -1;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const wx = bounds.xmin + (i + 0.5) * dx, wy = bounds.ymax - (j + 0.5) * dy;
      const v0 = f(wx, wy);
      mag[j * nx + i] = fin(Math.hypot(v0[0], v0[1]));
      let sum = noise[j * nx + i], cnt = 1;
      for (const dir of [1, -1]) {
        let px = i + 0.5, py = j + 0.5;
        for (let k = 0; k < steps; k++) {
          const v = f(bounds.xmin + px * dx, bounds.ymax - py * dy);
          // direction in pixel space (x right, y down)
          const ux = v[0] / dx, uy = -v[1] / dy, m = Math.hypot(ux, uy);
          if (!(m > 1e-12) || !Number.isFinite(m)) break;
          px += (dir * stepPx * ux) / m;
          py += (dir * stepPx * uy) / m;
          const nv = sample(px, py);
          if (nv < 0) break;
          sum += nv; cnt++;
        }
      }
      lic[j * nx + i] = sum / cnt;
    }
  }
  // contrast stretch (box-filtered noise has a narrow distribution)
  let mean = 0;
  for (let i = 0; i < lic.length; i++) mean += lic[i];
  mean /= Math.max(1, lic.length);
  let varsum = 0;
  for (let i = 0; i < lic.length; i++) varsum += (lic[i] - mean) ** 2;
  const sd = Math.sqrt(varsum / Math.max(1, lic.length)) || 1;
  for (let i = 0; i < lic.length; i++) lic[i] = Math.min(1, Math.max(0, 0.5 + (0.5 * (lic[i] - mean)) / (2.2 * sd)));
  return { lic, mag };
}

// ---------------------------------------------------------------------------------------------
// Jacobian eigen-structure

/**
 * Eigen-analysis of a 2x2 matrix J: { tr, det, disc, l1: {re, im}, l2, v1, v2 (unit real eigenvectors
 * or null for complex), type }. type is one of 'saddle', 'stable node', 'unstable node', 'stable
 * spiral', 'unstable spiral', 'centre', 'degenerate node', 'singular'.
 */
export function eigen2(J) {
  const a = J[0][0], b = J[0][1], c = J[1][0], d = J[1][1];
  const tr = a + d, det = a * d - b * c, disc = tr * tr - 4 * det;
  const scale = Math.max(1e-12, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
  const tol = 1e-9 * scale * scale;
  let l1, l2, v1 = null, v2 = null, type;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    l1 = { re: (tr + s) / 2, im: 0 }; l2 = { re: (tr - s) / 2, im: 0 };
    const vec = (l) => {
      let v;
      if (Math.abs(b) > 1e-12) v = [b, l - a];
      else if (Math.abs(c) > 1e-12) v = [l - d, c];
      else v = Math.abs(l - a) <= Math.abs(l - d) ? [1, 0] : [0, 1];
      const m = Math.hypot(v[0], v[1]) || 1;
      return [v[0] / m, v[1] / m];
    };
    if (Math.abs(disc) < tol && Math.abs(b) + Math.abs(c) + Math.abs(a - d) < 1e-12) { v1 = [1, 0]; v2 = [0, 1]; } else {
      v1 = vec(l1.re);
      v2 = Math.abs(disc) < tol ? v1.slice() : vec(l2.re);
    }
    if (Math.abs(det) < tol) type = 'singular';
    else if (det < 0) type = 'saddle';
    else if (Math.abs(disc) < tol) type = 'degenerate node';
    else type = tr < 0 ? 'stable node' : 'unstable node';
  } else {
    const s = Math.sqrt(-disc) / 2;
    l1 = { re: tr / 2, im: s }; l2 = { re: tr / 2, im: -s };
    type = Math.abs(tr) < 1e-9 * scale ? 'centre' : tr < 0 ? 'stable spiral' : 'unstable spiral';
  }
  return { tr, det, disc, l1, l2, v1, v2, type };
}

// ---------------------------------------------------------------------------------------------
// Polygons: area, orientation, point-in-polygon, triangulation, shapes

/** Signed area (CCW positive). */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
/** +1 for counter-clockwise, -1 for clockwise, 0 for degenerate. */
export function polygonOrientation(pts) { const A = polygonArea(pts); return A > 1e-14 ? 1 : A < -1e-14 ? -1 : 0; }

export function pointInPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Circle as a polygon with n vertices, CCW. */
export function circlePolygon(cx, cy, r, n = 96) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
}
/** Ellipse (semi-axes a, b, rotation rot) as a CCW polygon. */
export function ellipsePolygon(cx, cy, a, b, rot = 0, n = 96) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n, x = a * Math.cos(t), y = b * Math.sin(t);
    return [cx + c * x - s * y, cy + s * x + c * y];
  });
}
/** Axis aligned rectangle [xmin..xmax] x [ymin..ymax], CCW, with `per` points per side. */
export function rectPolygon(x0, y0, x1, y1, per = 1) {
  const out = [];
  const side = (ax, ay, bx, by) => { for (let i = 0; i < per; i++) out.push([ax + ((bx - ax) * i) / per, ay + ((by - ay) * i) / per]); };
  side(x0, y0, x1, y0); side(x1, y0, x1, y1); side(x1, y1, x0, y1); side(x0, y1, x0, y0);
  return out;
}

/** Ear-clipping triangulation of a simple polygon. Returns an array of [i, j, k] index triples. */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  const orient = polygonArea(pts) >= 0 ? 1 : -1;
  const idx = Array.from({ length: n }, (_, i) => i);
  const tris = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inTri = (p, a, b, c) => {
    const d1 = cross(a, b, p) * orient, d2 = cross(b, c, p) * orient, d3 = cross(c, a, p) * orient;
    return d1 >= -1e-14 && d2 >= -1e-14 && d3 >= -1e-14;
  };
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) * orient <= 1e-14) continue; // reflex or degenerate
      let ear = true;
      for (const m of idx) {
        if (m === ia || m === ib || m === ic) continue;
        if (inTri(pts[m], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // numerically stuck: fan the remainder
      for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
      return tris;
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// 7-point Radon rule on a triangle (degree 5), barycentric coordinates.
const S15 = Math.sqrt(15);
const RADON = (() => {
  const a1 = (6 - S15) / 21, a2 = (6 + S15) / 21;
  const w0 = 9 / 40, w1 = (155 - S15) / 1200, w2 = (155 + S15) / 1200;
  return [
    [1 / 3, 1 / 3, w0],
    [1 - 2 * a1, a1, w1], [a1, 1 - 2 * a1, w1], [a1, a1, w1],
    [1 - 2 * a2, a2, w2], [a2, 1 - 2 * a2, w2], [a2, a2, w2],
  ];
})();

/** Integral of g(x, y) over the triangle (a, b, c), subdivided `depth` times (4^depth sub-triangles). */
export function integrateTriangle(g, a, b, c, depth = 1) {
  if (depth > 0) {
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    return integrateTriangle(g, a, ab, ca, depth - 1) + integrateTriangle(g, ab, b, bc, depth - 1)
      + integrateTriangle(g, ca, bc, c, depth - 1) + integrateTriangle(g, ab, bc, ca, depth - 1);
  }
  const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  let s = 0;
  for (const [l1, l2, w] of RADON) {
    const l3 = 1 - l1 - l2;
    s += w * fin(g(l1 * a[0] + l2 * b[0] + l3 * c[0], l1 * a[1] + l2 * b[1] + l3 * c[1]));
  }
  return s * area;
}

/** Integral of the scalar function g(x, y) over a simple polygon (any orientation). */
export function integratePolygon(g, pts, depth = 2) {
  let s = 0;
  for (const [i, j, k] of triangulate(pts)) s += integrateTriangle(g, pts[i], pts[j], pts[k], depth);
  return s;
}

/** Line integrals along a polyline (closed by default) with Gauss-Legendre on every edge. */
export function lineIntegrals(F, pts, opts = {}) {
  const { closed = true, order = 6 } = opts;
  const { x: gx, w: gw } = gaussLegendre(order);
  const n = pts.length, m = closed ? n : n - 1;
  let circ = 0, flux = 0, len = 0;
  for (let e = 0; e < m; e++) {
    const a = pts[e], b = pts[(e + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    len += Math.hypot(dx, dy);
    for (let q = 0; q < order; q++) {
      const t = (gx[q] + 1) / 2, w = gw[q] / 2;
      const v = F(a[0] + t * dx, a[1] + t * dy);
      circ += w * fin(v[0] * dx + v[1] * dy);
      flux += w * fin(v[0] * dy - v[1] * dx); // F . (dy, -dx): outward normal of a CCW curve
    }
  }
  return { circulation: circ, rawFlux: flux, length: len };
}

/** Circulation along an open polyline (a path integral of F . dr). */
export function pathIntegral2(F, pts, order = 6) { return lineIntegrals(F, pts, { closed: false, order }).circulation; }

/** Quadratic bump path from a to b, bulging sideways by `bulge` (fraction of the chord), n points. */
export function bumpPath(a, b, bulge = 0.4, n = 40) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const nx = -dy * bulge, ny = dx * bulge;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), w = 4 * t * (1 - t);
    return [a[0] + dx * t + nx * w, a[1] + dy * t + ny * w];
  });
}

/**
 * Green's theorem and the 2D divergence theorem on a polygon, all numerically:
 *   circulation  = closed integral F . dr (in the drawn orientation)
 *   curlIntegral = orientation * double integral of curl F        (equal, Green)
 *   flux         = outward flux of F through the boundary
 *   divIntegral  = double integral of div F                       (equal, divergence theorem)
 * Pass a field object from makeField2 (analytic derivatives are used when available).
 */
export function greenCheck(field, pts, opts = {}) {
  const { order = 6, depth = 2, h = 1e-4 } = opts;
  const o = polygonOrientation(pts) || 1;
  const li = lineIntegrals(field.f, pts, { order });
  const curlIntegral = o * integratePolygon((x, y) => field.curl(x, y, h), pts, depth);
  const divIntegral = integratePolygon((x, y) => field.div(x, y, h), pts, depth);
  const flux = o * li.rawFlux;
  return {
    orientation: o, area: Math.abs(polygonArea(pts)), perimeter: li.length,
    circulation: li.circulation, curlIntegral, circulationError: li.circulation - curlIntegral,
    flux, divIntegral, fluxError: flux - divIntegral,
  };
}

/**
 * "Cancellation of interior circulation": subdivides the bounding box of the polygon into an n x n
 * grid and keeps the cells whose centre is inside. Every kept cell has a circulation (CCW) of its own;
 * edges shared by two kept cells are traversed in opposite directions and cancel, so the sum of all
 * cell circulations equals the circulation along the exposed outer edges (a staircase boundary).
 * Returns { cells: [{i, j, x0, y0, x1, y1, circ}], exposed: [{x0,y0,x1,y1}], sumCells,
 * boundaryCirc, n, dx, dy }.
 */
export function cellCancellation(F, pts, n = 6, order = 4) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) inside[j * n + i] = pointInPolygon(pts, x0 + (i + 0.5) * dx, y0 + (j + 0.5) * dy) ? 1 : 0;
  const has = (i, j) => i >= 0 && j >= 0 && i < n && j < n && inside[j * n + i] === 1;
  const cells = [], exposed = [];
  let sumCells = 0, boundaryCirc = 0;
  const seg = (ax, ay, bx, by) => lineIntegrals(F, [[ax, ay], [bx, by]], { closed: false, order }).circulation;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (!has(i, j)) continue;
      const cx0 = x0 + i * dx, cy0 = y0 + j * dy, cx1 = cx0 + dx, cy1 = cy0 + dy;
      const bottom = seg(cx0, cy0, cx1, cy0), right = seg(cx1, cy0, cx1, cy1), top = seg(cx1, cy1, cx0, cy1), left = seg(cx0, cy1, cx0, cy0);
      const circ = bottom + right + top + left;
      cells.push({ i, j, x0: cx0, y0: cy0, x1: cx1, y1: cy1, circ });
      sumCells += circ;
      if (!has(i, j - 1)) { exposed.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy0 }); boundaryCirc += bottom; }
      if (!has(i + 1, j)) { exposed.push({ x0: cx1, y0: cy0, x1: cx1, y1: cy1 }); boundaryCirc += right; }
      if (!has(i, j + 1)) { exposed.push({ x0: cx1, y0: cy1, x1: cx0, y1: cy1 }); boundaryCirc += top; }
      if (!has(i - 1, j)) { exposed.push({ x0: cx0, y0: cy1, x1: cx0, y1: cy0 }); boundaryCirc += left; }
    }
  }
  return { cells, exposed, sumCells, boundaryCirc, n, dx, dy };
}

// ---------------------------------------------------------------------------------------------
// Scalar potential / stream function

/**
 * Potential of a (conservative) 2D field on an nx x ny node grid over `bounds`, by integrating F . dr
 * from `base` along an L-shaped path (x first, then y) with Gauss-Legendre. phi(base) = 0.
 * Returns { phi: Float64Array (j * nx + i, y increasing with j), nx, ny, bounds }.
 */
export function potentialFromField2(F, base, bounds, nx, ny, order = 6) {
  const { x: gx, w: gw } = gaussLegendre(order);
  const phi = new Float64Array(nx * ny);
  const dx = (bounds.xmax - bounds.xmin) / (nx - 1), dy = (bounds.ymax - bounds.ymin) / (ny - 1);
  const [bx, by] = base;
  const colA = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const x1 = bounds.xmin + i * dx, len = x1 - bx;
    let s = 0;
    for (let q = 0; q < order; q++) s += (gw[q] / 2) * len * fin(F(bx + ((gx[q] + 1) / 2) * len, by)[0]);
    colA[i] = s;
  }
  for (let j = 0; j < ny; j++) {
    const y1 = bounds.ymin + j * dy, len = y1 - by;
    for (let i = 0; i < nx; i++) {
      const x = bounds.xmin + i * dx;
      let s = colA[i];
      for (let q = 0; q < order; q++) s += (gw[q] / 2) * len * fin(F(x, by + ((gx[q] + 1) / 2) * len)[1]);
      phi[j * nx + i] = s;
    }
  }
  return { phi, nx, ny, bounds };
}

/** Stream function of a divergence-free field (psi_y = Fx, psi_x = -Fy), psi(base) = 0. */
export function streamFunction2(F, base, bounds, nx, ny, order = 6) {
  return potentialFromField2((x, y) => { const v = F(x, y); return [-v[1], v[0]]; }, base, bounds, nx, ny, order);
}

/** Max |grad phi - F| over interior nodes (central differences, O(h^2)): the "reconstruction error". */
export function potentialError(F, pot) {
  const { phi, nx, ny, bounds } = pot;
  const dx = (bounds.xmax - bounds.xmin) / (nx - 1), dy = (bounds.ymax - bounds.ymin) / (ny - 1);
  let err = 0;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const v = F(bounds.xmin + i * dx, bounds.ymin + j * dy);
      const gxv = (phi[j * nx + i + 1] - phi[j * nx + i - 1]) / (2 * dx);
      const gyv = (phi[(j + 1) * nx + i] - phi[(j - 1) * nx + i]) / (2 * dy);
      err = Math.max(err, Math.abs(gxv - v[0]), Math.abs(gyv - v[1]));
    }
  }
  return err;
}

/** Poisson check: max |Laplacian(phi) - div F| over interior nodes (5-point stencil). */
export function poissonResidual(field, pot) {
  const { phi, nx, ny, bounds } = pot;
  const dx = (bounds.xmax - bounds.xmin) / (nx - 1), dy = (bounds.ymax - bounds.ymin) / (ny - 1);
  let err = 0;
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const c = phi[j * nx + i];
      const lap = (phi[j * nx + i + 1] - 2 * c + phi[j * nx + i - 1]) / (dx * dx) + (phi[(j + 1) * nx + i] - 2 * c + phi[(j - 1) * nx + i]) / (dy * dy);
      err = Math.max(err, Math.abs(lap - field.div(bounds.xmin + i * dx, bounds.ymin + j * dy)));
    }
  }
  return err;
}

/**
 * Samples div and curl on a coarse grid over `bounds` and reports the field's character:
 * { maxDiv, maxCurl, scale, curlFree, divFree } (relative tolerance `tol` against max |Jacobian|).
 */
export function classifyField2(field, bounds, n = 13, tol = 1e-3) {
  let maxDiv = 0, maxCurl = 0, scale = 1e-12;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = bounds.xmin + ((bounds.xmax - bounds.xmin) * (i + 0.5)) / n, y = bounds.ymin + ((bounds.ymax - bounds.ymin) * (j + 0.5)) / n;
      const J = field.jac(x, y);
      const d = J[0][0] + J[1][1], c = J[1][0] - J[0][1];
      maxDiv = Math.max(maxDiv, Math.abs(d)); maxCurl = Math.max(maxCurl, Math.abs(c));
      scale = Math.max(scale, Math.abs(J[0][0]), Math.abs(J[0][1]), Math.abs(J[1][0]), Math.abs(J[1][1]));
    }
  }
  return { maxDiv, maxCurl, scale, curlFree: maxCurl < tol * scale, divFree: maxDiv < tol * scale };
}

// ---------------------------------------------------------------------------------------------
// Helmholtz decomposition on a periodic grid

/** In-place 2D FFT of an n x n grid (row-major). */
export function fft2(re, im, n, inverse = false) {
  const rr = new Float64Array(n), ri = new Float64Array(n);
  const tf = inverse ? ifft : fft;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) { rr[i] = re[j * n + i]; ri[i] = im[j * n + i]; }
    tf(rr, ri);
    for (let i = 0; i < n; i++) { re[j * n + i] = rr[i]; im[j * n + i] = ri[i]; }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) { rr[j] = re[j * n + i]; ri[j] = im[j * n + i]; }
    tf(rr, ri);
    for (let j = 0; j < n; j++) { re[j * n + i] = rr[j]; im[j * n + i] = ri[j]; }
  }
}

/** Samples f(x, y) -> [Fx, Fy] at n x n cell-start nodes of the square [x0, x0+L) x [y0, y0+L). */
export function gridFromField2(f, x0, y0, L, n) {
  const fx = new Float64Array(n * n), fy = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = f(x0 + (i * L) / n, y0 + (j * L) / n);
      fx[j * n + i] = fin(v[0]); fy[j * n + i] = fin(v[1]);
    }
  }
  return { fx, fy, n, L, x0, y0 };
}

/**
 * Helmholtz decomposition of a periodic field on an n x n grid (n power of two, period L):
 * F = grad(phi) + rot(psi) + mean, where the curl-free part is k (k . F^) / |k|^2 and the
 * divergence-free part the remainder (both in Fourier space). Returns
 * { gx, gy (curl-free), sx, sy (divergence-free), mx, my (mean / harmonic constant) }.
 */
export function helmholtz2(fx, fy, n, L = 2 * Math.PI) {
  const N = n * n;
  const ar = Float64Array.from(fx), ai = new Float64Array(N), br = Float64Array.from(fy), bi = new Float64Array(N);
  fft2(ar, ai, n); fft2(br, bi, n);
  const gar = new Float64Array(N), gai = new Float64Array(N), gbr = new Float64Array(N), gbi = new Float64Array(N);
  const sar = new Float64Array(N), sai = new Float64Array(N), sbr = new Float64Array(N), sbi = new Float64Array(N);
  // The Nyquist wavenumber is set to 0 (as in spectralDivCurl) so that "curl-free" and "divergence-free"
  // mean exactly the same thing for the projection and for the spectral derivatives.
  const kk = (m) => (m === n / 2 ? 0 : ((m <= n / 2 ? m : m - n) * 2 * Math.PI) / L);
  const mx = ar[0] / N, my = br[0] / N;
  for (let j = 0; j < n; j++) {
    const ky = kk(j);
    for (let i = 0; i < n; i++) {
      const k = j * n + i, kx = kk(i), k2 = kx * kx + ky * ky;
      if (k === 0) continue;
      let pr = 0, pi = 0;
      if (k2 > 0) {
        pr = (kx * ar[k] + ky * br[k]) / k2; pi = (kx * ai[k] + ky * bi[k]) / k2;
      }
      gar[k] = kx * pr; gai[k] = kx * pi; gbr[k] = ky * pr; gbi[k] = ky * pi;
      sar[k] = ar[k] - gar[k]; sai[k] = ai[k] - gai[k]; sbr[k] = br[k] - gbr[k]; sbi[k] = bi[k] - gbi[k];
    }
  }
  fft2(gar, gai, n, true); fft2(gbr, gbi, n, true); fft2(sar, sai, n, true); fft2(sbr, sbi, n, true);
  return { gx: gar, gy: gbr, sx: sar, sy: sbr, mx, my, n, L };
}

/** Spectral divergence and curl of a periodic grid field: { div, curl } Float64Arrays. */
export function spectralDivCurl(fx, fy, n, L = 2 * Math.PI) {
  const N = n * n;
  const ar = Float64Array.from(fx), ai = new Float64Array(N), br = Float64Array.from(fy), bi = new Float64Array(N);
  fft2(ar, ai, n); fft2(br, bi, n);
  const dr = new Float64Array(N), di = new Float64Array(N), cr = new Float64Array(N), ci = new Float64Array(N);
  const kk = (m) => (m === n / 2 ? 0 : ((m <= n / 2 ? m : m - n) * 2 * Math.PI) / L);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, kx = kk(i), ky = kk(j);
      // i k . F^ ; i (kx Fy - ky Fx)
      dr[k] = -(kx * ai[k] + ky * bi[k]); di[k] = kx * ar[k] + ky * br[k];
      cr[k] = -(kx * bi[k] - ky * ai[k]); ci[k] = kx * br[k] - ky * ar[k];
    }
  }
  fft2(dr, di, n, true); fft2(cr, ci, n, true);
  return { div: dr, curl: cr };
}

/** Field of a sum of Gaussian sources (a: div) and vortices (a: circulation sense), each {x, y, s, a, kind}. */
export function blobField2(blobs) {
  return (x, y) => {
    let fx = 0, fy = 0;
    for (const b of blobs) {
      const dx = x - b.x, dy = y - b.y, e = Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s)) * b.a;
      // grad of a Gaussian points toward the centre; "source" = outward = -grad(exp)
      if (b.kind === 'vortex') { fx += -dy * e / (b.s * b.s); fy += dx * e / (b.s * b.s); } else { fx += dx * e / (b.s * b.s); fy += dy * e / (b.s * b.s); }
    }
    return [fx, fy];
  };
}

// ---------------------------------------------------------------------------------------------
// 3D surfaces, volumes, Stokes

const rot3 = (n) => {
  // orthonormal frame (e1, e2, n)
  const m = Math.hypot(n[0], n[1], n[2]) || 1;
  const nn = [n[0] / m, n[1] / m, n[2] / m];
  const a = Math.abs(nn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = [nn[1] * a[2] - nn[2] * a[1], nn[2] * a[0] - nn[0] * a[2], nn[0] * a[1] - nn[1] * a[0]];
  const l = Math.hypot(...e1);
  e1 = e1.map((v) => v / l);
  const e2 = [nn[1] * e1[2] - nn[2] * e1[1], nn[2] * e1[0] - nn[0] * e1[2], nn[0] * e1[1] - nn[1] * e1[0]];
  return { e1, e2, n: nn };
};
export { rot3 as frameFromNormal };

/** Surface kinds: 'sphere' {R}, 'cube' {a: half side}, 'cylinder' {R, H: half height, axis z}. */
export function surfaceVolume(kind, size) {
  if (kind === 'sphere') return (4 / 3) * Math.PI * size.R ** 3;
  if (kind === 'cube') return (2 * size.a) ** 3;
  return Math.PI * size.R * size.R * 2 * size.H;
}
export function surfaceArea(kind, size) {
  if (kind === 'sphere') return 4 * Math.PI * size.R ** 2;
  if (kind === 'cube') return 6 * (2 * size.a) ** 2;
  return 2 * Math.PI * size.R * 2 * size.H + 2 * Math.PI * size.R ** 2;
}

/** Outward flux of F through the closed surface (centre c). n = quadrature order per direction. */
export function surfaceFlux(F, kind, c, size, n = 16) {
  const { x: gx, w: gw } = gaussLegendre(n);
  let flux = 0;
  if (kind === 'sphere') {
    const R = size.R, m = 2 * n;
    for (let a = 0; a < n; a++) {
      const u = gx[a], s = Math.sqrt(1 - u * u);
      for (let b = 0; b < m; b++) {
        const ph = ((b + 0.5) * 2 * Math.PI) / m, nx = s * Math.cos(ph), ny = s * Math.sin(ph), nz = u;
        const v = F(c[0] + R * nx, c[1] + R * ny, c[2] + R * nz);
        flux += gw[a] * ((2 * Math.PI) / m) * R * R * fin(v[0] * nx + v[1] * ny + v[2] * nz);
      }
    }
    return flux;
  }
  const faces = [];
  if (kind === 'cube') {
    const a = size.a;
    for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) faces.push({ ax, sg, h1: a, h2: a, off: a });
  }
  if (kind === 'cylinder') {
    // caps (ax = 2) as discs handled below
    const { R, H } = size;
    // side: phi uniform, z Gauss
    const m = 2 * n;
    for (let b = 0; b < m; b++) {
      const ph = ((b + 0.5) * 2 * Math.PI) / m, cx = Math.cos(ph), cy = Math.sin(ph);
      for (let q = 0; q < n; q++) {
        const v = F(c[0] + R * cx, c[1] + R * cy, c[2] + H * gx[q]);
        flux += gw[q] * H * ((2 * Math.PI) / m) * R * fin(v[0] * cx + v[1] * cy);
      }
    }
    for (const sg of [-1, 1]) {
      for (let q = 0; q < n; q++) {
        const r = (R * (gx[q] + 1)) / 2, wr = (gw[q] * R) / 2;
        for (let b = 0; b < m; b++) {
          const ph = ((b + 0.5) * 2 * Math.PI) / m;
          const v = F(c[0] + r * Math.cos(ph), c[1] + r * Math.sin(ph), c[2] + sg * H);
          flux += wr * r * ((2 * Math.PI) / m) * sg * fin(v[2]);
        }
      }
    }
    return flux;
  }
  for (const f of faces) {
    const t1 = (f.ax + 1) % 3, t2 = (f.ax + 2) % 3;
    for (let p = 0; p < n; p++) {
      for (let q = 0; q < n; q++) {
        const pt = [c[0], c[1], c[2]];
        pt[f.ax] += f.sg * f.off; pt[t1] += f.h1 * gx[p]; pt[t2] += f.h2 * gx[q];
        const v = F(pt[0], pt[1], pt[2]);
        flux += gw[p] * gw[q] * f.h1 * f.h2 * f.sg * fin(v[f.ax]);
      }
    }
  }
  return flux;
}

/** Volume integral of the scalar function g(x, y, z) over the solid bounded by the surface. */
export function volumeIntegral(g, kind, c, size, n = 14) {
  const { x: gx, w: gw } = gaussLegendre(n);
  let s = 0;
  if (kind === 'sphere') {
    const R = size.R, m = 2 * n;
    for (let i = 0; i < n; i++) {
      const r = (R * (gx[i] + 1)) / 2, wr = (gw[i] * R) / 2;
      for (let a = 0; a < n; a++) {
        const u = gx[a], sn = Math.sqrt(1 - u * u);
        for (let b = 0; b < m; b++) {
          const ph = ((b + 0.5) * 2 * Math.PI) / m;
          s += wr * r * r * gw[a] * ((2 * Math.PI) / m) * fin(g(c[0] + r * sn * Math.cos(ph), c[1] + r * sn * Math.sin(ph), c[2] + r * u));
        }
      }
    }
    return s;
  }
  if (kind === 'cube') {
    const a = size.a;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      s += gw[i] * gw[j] * gw[k] * a ** 3 * fin(g(c[0] + a * gx[i], c[1] + a * gx[j], c[2] + a * gx[k]));
    }
    return s;
  }
  const { R, H } = size, m = 2 * n;
  for (let i = 0; i < n; i++) {
    const r = (R * (gx[i] + 1)) / 2, wr = (gw[i] * R) / 2;
    for (let b = 0; b < m; b++) {
      const ph = ((b + 0.5) * 2 * Math.PI) / m;
      for (let k = 0; k < n; k++) {
        s += wr * r * ((2 * Math.PI) / m) * gw[k] * H * fin(g(c[0] + r * Math.cos(ph), c[1] + r * Math.sin(ph), c[2] + H * gx[k]));
      }
    }
  }
  return s;
}

/** Divergence theorem on a closed surface: { flux, divIntegral, volume, area, error }. */
export function divergenceTheorem3(field, kind, c, size, n = 14) {
  const flux = surfaceFlux(field.f, kind, c, size, n);
  const divIntegral = volumeIntegral((x, y, z) => field.div(x, y, z), kind, c, size, n);
  return { flux, divIntegral, volume: surfaceVolume(kind, size), area: surfaceArea(kind, size), error: flux - divIntegral };
}

/** Circle of radius r around centre c in the plane with normal nrm, N points, CCW seen from +nrm. */
export function circleLoop3(c, nrm, r, N = 128) {
  const { e1, e2 } = rot3(nrm);
  return Array.from({ length: N }, (_, i) => {
    const t = (2 * Math.PI * i) / N, ct = Math.cos(t), st = Math.sin(t);
    return [c[0] + r * (ct * e1[0] + st * e2[0]), c[1] + r * (ct * e1[1] + st * e2[1]), c[2] + r * (ct * e1[2] + st * e2[2])];
  });
}

/** Exact-ish circulation of F around the circle (parametric Gauss-Legendre per arc, not a polygon). */
export function circulation3Circle(F, c, nrm, r, order = 8, arcs = 16) {
  const { e1, e2 } = rot3(nrm);
  const { x: gx, w: gw } = gaussLegendre(order);
  let s = 0;
  for (let a = 0; a < arcs; a++) {
    const t0 = (2 * Math.PI * a) / arcs, t1 = (2 * Math.PI * (a + 1)) / arcs;
    for (let q = 0; q < order; q++) {
      const t = t0 + ((gx[q] + 1) / 2) * (t1 - t0), w = (gw[q] / 2) * (t1 - t0);
      const ct = Math.cos(t), st = Math.sin(t);
      const p = [c[0] + r * (ct * e1[0] + st * e2[0]), c[1] + r * (ct * e1[1] + st * e2[1]), c[2] + r * (ct * e1[2] + st * e2[2])];
      const tan = [r * (-st * e1[0] + ct * e2[0]), r * (-st * e1[1] + ct * e2[1]), r * (-st * e1[2] + ct * e2[2])];
      const v = F(p[0], p[1], p[2]);
      s += w * fin(v[0] * tan[0] + v[1] * tan[1] + v[2] * tan[2]);
    }
  }
  return s;
}

/**
 * Flux of curl F through a spanning surface of the circle (c, nrm, r): a flat disc (h = 0) or the
 * spherical cap with apex height h above (h > 0) / below (h < 0) the disc centre along nrm. The
 * surface normal is oriented consistently with the loop (right-hand rule about nrm), so by Stokes
 * the result must equal the circulation for every h.
 */
export function curlFluxThroughCap(curlF, c, nrm, r, h = 0, n = 14) {
  const { e1, e2, n: nn } = rot3(nrm);
  const { x: gx, w: gw } = gaussLegendre(n);
  const m = 2 * n;
  let s = 0;
  if (Math.abs(h) < 1e-9) {
    for (let i = 0; i < n; i++) {
      const rr = (r * (gx[i] + 1)) / 2, wr = (gw[i] * r) / 2;
      for (let b = 0; b < m; b++) {
        const ph = ((b + 0.5) * 2 * Math.PI) / m, ct = Math.cos(ph), st = Math.sin(ph);
        const v = curlF(c[0] + rr * (ct * e1[0] + st * e2[0]), c[1] + rr * (ct * e1[1] + st * e2[1]), c[2] + rr * (ct * e1[2] + st * e2[2]));
        s += wr * rr * ((2 * Math.PI) / m) * fin(v[0] * nn[0] + v[1] * nn[1] + v[2] * nn[2]);
      }
    }
    return s;
  }
  const sg = h > 0 ? 1 : -1, ah = Math.abs(h);
  const R = (r * r + ah * ah) / (2 * ah);
  const s0 = [c[0] + nn[0] * (h - sg * R), c[1] + nn[1] * (h - sg * R), c[2] + nn[2] * (h - sg * R)];
  const alphaMax = ah > r ? Math.PI - Math.asin(Math.min(1, r / R)) : Math.asin(Math.min(1, r / R));
  for (let i = 0; i < n; i++) {
    const beta = (alphaMax * (gx[i] + 1)) / 2, wb = (gw[i] * alphaMax) / 2;
    const sb = Math.sin(beta), cb = Math.cos(beta);
    for (let b = 0; b < m; b++) {
      const ph = ((b + 0.5) * 2 * Math.PI) / m, ct = Math.cos(ph), st = Math.sin(ph);
      const u = [sb * (ct * e1[0] + st * e2[0]) + cb * nn[0], sb * (ct * e1[1] + st * e2[1]) + cb * nn[1], sb * (ct * e1[2] + st * e2[2]) + cb * nn[2]];
      const v = curlF(s0[0] + sg * R * u[0], s0[1] + sg * R * u[1], s0[2] + sg * R * u[2]);
      s += wb * R * R * sb * ((2 * Math.PI) / m) * fin(v[0] * u[0] + v[1] * u[1] + v[2] * u[2]);
    }
  }
  return s;
}

/** Stokes check on a circular loop: { circulation, curlFlux, error }. */
export function stokes3(field, c, nrm, r, h = 0, n = 14) {
  const circulation = circulation3Circle(field.f, c, nrm, r);
  const curlFlux = curlFluxThroughCap((x, y, z) => field.curl(x, y, z), c, nrm, r, h, n);
  return { circulation, curlFlux, error: circulation - curlFlux };
}

/**
 * Point and unit normal on the surface spanning the circle (c, nrm, r) used by curlFluxThroughCap:
 * s in [0, 1] runs from the centre / apex (0) to the rim (1), phi in [0, 2 pi) is the angle around nrm.
 * h = 0 gives the flat disc, h != 0 the spherical cap with apex height h. Returns { p, n }.
 */
export function spanningSurfacePoint(c, nrm, r, h, s, phi) {
  const { e1, e2, n: nn } = rot3(nrm);
  const ct = Math.cos(phi), st = Math.sin(phi);
  if (Math.abs(h) < 1e-9) {
    const rr = r * s;
    return { p: [c[0] + rr * (ct * e1[0] + st * e2[0]), c[1] + rr * (ct * e1[1] + st * e2[1]), c[2] + rr * (ct * e1[2] + st * e2[2])], n: nn.slice() };
  }
  const sg = h > 0 ? 1 : -1, ah = Math.abs(h);
  const R = (r * r + ah * ah) / (2 * ah);
  const s0 = [c[0] + nn[0] * (h - sg * R), c[1] + nn[1] * (h - sg * R), c[2] + nn[2] * (h - sg * R)];
  const alphaMax = ah > r ? Math.PI - Math.asin(Math.min(1, r / R)) : Math.asin(Math.min(1, r / R));
  const beta = alphaMax * s, sb = Math.sin(beta), cb = Math.cos(beta);
  const u = [sb * (ct * e1[0] + st * e2[0]) + cb * nn[0], sb * (ct * e1[1] + st * e2[1]) + cb * nn[1], sb * (ct * e1[2] + st * e2[2]) + cb * nn[2]];
  return { p: [s0[0] + sg * R * u[0], s0[1] + sg * R * u[1], s0[2] + sg * R * u[2]], n: u };
}
