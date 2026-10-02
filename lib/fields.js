// Catalogue of scalar fields for contour / isosurface demos.
//   FIELDS_2D: { id, label, f(x, y), bounds, level, levels }
//   FIELDS_3D: { id, label, f(x, y, z), bounds, level, levels }
// `level` is the default iso value, `levels` a suggested set for contour plots. All fields are
// finite everywhere (non-finite results are clamped to +/-1e6). Convention shared with
// lib/marching.js: the "inside" of a shape is where the field is LOWER than the level.

const HUGE = 1e6;

function finite(f) {
  return (...a) => {
    const v = f(...a);
    if (v !== v) return HUGE;
    return v > HUGE ? HUGE : v < -HUGE ? -HUGE : v;
  };
}

// ---- deterministic, seedable value noise -------------------------------------------------------

function hash3(seed, i, j, k) {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(i | 0, 0x85ebca6b) ^ Math.imul(j | 0, 0xc2b2ae35) ^ Math.imul(k | 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296; // [0, 1)
}
const smooth = (t) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1) on the integer lattice; noise2(seed) -> (x, y) => value. */
export function valueNoise2(seed = 1) {
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = smooth(x - i);
    const v = smooth(y - j);
    const a = hash3(seed, i, j, 0);
    const b = hash3(seed, i + 1, j, 0);
    const c = hash3(seed, i, j + 1, 0);
    const d = hash3(seed, i + 1, j + 1, 0);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** 3D value noise in [0, 1). */
export function valueNoise3(seed = 1) {
  return (x, y, z) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const k = Math.floor(z);
    const u = smooth(x - i);
    const v = smooth(y - j);
    const w = smooth(z - k);
    const h = (di, dj, dk) => hash3(seed, i + di, j + dj, k + dk);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v),
      w,
    );
  };
}

/** Fractional Brownian motion of the 2D noise, centred (mean ~ 0), roughly within +/-0.5. */
export function fbm2(seed = 1, octaves = 4) {
  const n = valueNoise2(seed);
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (n(x * fx + o * 17.3, y * fx - o * 9.1) - 0.5);
      norm += amp;
      amp *= 0.5;
      fx *= 2;
    }
    return sum / norm;
  };
}

/** Fractional Brownian motion of the 3D noise, centred, roughly within +/-0.5. */
export function fbm3(seed = 1, octaves = 4) {
  const n = valueNoise3(seed);
  return (x, y, z) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (n(x * fx + o * 17.3, y * fx - o * 9.1, z * fx + o * 5.7) - 0.5);
      norm += amp;
      amp *= 0.5;
      fx *= 2;
    }
    return sum / norm;
  };
}

// ---- 2D -----------------------------------------------------------------------------------------

const SQ2 = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };

function metaballs2(balls) {
  return (x, y) => {
    let s = 0;
    for (const [bx, by, r] of balls) s += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + 1e-3);
    return 1 - s; // inside (lower) where the summed influence exceeds 1
  };
}

function chladni(n, m) {
  return (x, y) => {
    const u = (x + 1) / 2;
    const v = (y + 1) / 2;
    return Math.cos(n * Math.PI * u) * Math.cos(m * Math.PI * v) - Math.cos(m * Math.PI * u) * Math.cos(n * Math.PI * v);
  };
}

function distToPolyline(points, closed) {
  const segs = [];
  for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
  if (closed) segs.push([points[points.length - 1], points[0]]);
  return (x, y) => {
    let best = Infinity;
    for (const [[ax, ay], [bx, by]] of segs) {
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    return best;
  };
}

const STAR = [0, 1, 2, 3, 4].map((k) => {
  const a = Math.PI / 2 + k * (4 * Math.PI / 5); // pentagram: every second vertex of a pentagon
  return [1.5 * Math.cos(a), 1.5 * Math.sin(a)];
});

function mandelSmooth(x, y) {
  let zr = 0;
  let zi = 0;
  const N = 48;
  for (let n = 0; n < N; n++) {
    const t = zr * zr - zi * zi + x;
    zi = 2 * zr * zi + y;
    zr = t;
    const m2 = zr * zr + zi * zi;
    if (m2 > 256) return n + 1 - Math.log2(Math.log(m2) / 2); // smooth iteration count
  }
  return N;
}

export const FIELDS_2D = [
  { id: 'circle', label: 'Circle x²+y²−1', f: (x, y) => x * x + y * y - 1, bounds: SQ2, level: 0, levels: [-0.75, -0.5, -0.25, 0, 0.5, 1, 2, 3] },
  {
    id: 'metaballs2', label: 'Two metaballs',
    f: metaballs2([[-0.6, 0, 0.7], [0.6, 0, 0.7]]), bounds: SQ2, level: 0, levels: [-3, -1.5, -0.5, 0, 0.5, 0.8],
  },
  {
    id: 'metaballs4', label: 'Four metaballs',
    f: metaballs2([[-0.8, -0.6, 0.55], [0.7, -0.7, 0.5], [0.1, 0.8, 0.6], [-0.2, -0.05, 0.35]]), bounds: SQ2, level: 0, levels: [-3, -1.5, -0.5, 0, 0.5, 0.8],
  },
  { id: 'saddle', label: 'Saddle x²−y²', f: (x, y) => x * x - y * y, bounds: SQ2, level: 0, levels: [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3] },
  {
    id: 'eggcrate', label: 'Egg crate sin x sin y', f: (x, y) => Math.sin(x) * Math.sin(y),
    bounds: { xmin: -2 * Math.PI, xmax: 2 * Math.PI, ymin: -2 * Math.PI, ymax: 2 * Math.PI }, level: 0, levels: [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9],
  },
  ...[[2, 3], [3, 5], [4, 7], [5, 8]].map(([n, m]) => ({
    id: `chladni${n}${m}`, label: `Chladni plate (${n},${m})`, f: chladni(n, m),
    bounds: { xmin: -1, xmax: 1, ymin: -1, ymax: 1 }, level: 0, levels: [-1, -0.5, 0, 0.5, 1],
  })),
  {
    id: 'himmelblau', label: 'Himmelblau', f: (x, y) => (x * x + y - 11) ** 2 + (x + y * y - 7) ** 2,
    bounds: { xmin: -5, xmax: 5, ymin: -5, ymax: 5 }, level: 10, levels: [1, 5, 10, 20, 50, 100, 200, 400],
  },
  {
    id: 'rosenbrock', label: 'Rosenbrock', f: (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2,
    bounds: { xmin: -2, xmax: 2, ymin: -1, ymax: 3 }, level: 10, levels: [0.5, 2, 5, 10, 30, 100, 300, 1000],
  },
  {
    id: 'noise2', label: 'Value-noise fBm', f: fbm2(7, 4), bounds: { xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, level: 0,
    levels: [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2],
  },
  {
    id: 'mandelbrot', label: 'Mandelbrot escape (smooth)', f: mandelSmooth,
    bounds: { xmin: -2.2, xmax: 0.8, ymin: -1.5, ymax: 1.5 }, level: 10, levels: [2, 4, 6, 8, 12, 16, 24, 32],
  },
  {
    id: 'star', label: 'Distance to a pentagram', f: distToPolyline(STAR, true), bounds: { xmin: -2, xmax: 2, ymin: -2, ymax: 2 }, level: 0.15,
    levels: [0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0],
  },
].map((d) => ({ ...d, dim: 2, f: finite(d.f) }));

// ---- 3D -----------------------------------------------------------------------------------------

const CUBE = (h) => ({ xmin: -h, xmax: h, ymin: -h, ymax: h, zmin: -h, zmax: h });

function metaballs3(balls) {
  return (x, y, z) => {
    let s = 0;
    for (const [bx, by, bz, r] of balls) s += (r * r) / ((x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2 + 1e-3);
    return 1 - s;
  };
}

/** Associated Legendre P_l^m(cos(theta)) magnitude helper (no Condon-Shortley phase needed). */
function legendre(l, m, ct) {
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  let pmm = 1;
  let f = 1;
  for (let i = 1; i <= m; i++) { pmm *= f * st; f += 2; }
  if (l === m) return pmm;
  let pm1 = ct * (2 * m + 1) * pmm;
  if (l === m + 1) return pm1;
  let pl = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pl = (ct * (2 * ll - 1) * pm1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pm1;
    pm1 = pl;
  }
  return pl;
}

/**
 * Star-shaped lobe surface r = scale * |Y_l^m(theta, phi)| / max|Y| (real harmonic), as the
 * implicit field f = r - radius(direction). Sphere at r=0 maps to -radius(0 direction) (finite).
 */
export function shLobe(l, m, scale = 1.3) {
  let peak = 1e-9;
  for (let i = 0; i <= 400; i++) peak = Math.max(peak, Math.abs(legendre(l, m, -1 + (2 * i) / 400)));
  return (x, y, z) => {
    const r = Math.sqrt(x * x + y * y + z * z);
    if (r < 1e-12) return 0;
    const phi = Math.atan2(y, x);
    const target = scale * Math.abs(legendre(l, m, z / r) * Math.cos(m * phi)) / peak;
    return r - target;
  };
}

/** Cheap power-8 Mandelbulb distance estimate; 0 inside, grows with distance outside. */
function mandelbulb(x0, y0, z0) {
  let x = x0;
  let y = y0;
  let z = z0;
  let dr = 1;
  let r = 0;
  for (let i = 0; i < 8; i++) {
    r = Math.sqrt(x * x + y * y + z * z);
    if (r > 2) break;
    const theta = Math.acos(Math.max(-1, Math.min(1, z / (r || 1)))) * 8;
    const phi = Math.atan2(y, x) * 8;
    dr = Math.pow(r, 7) * 8 * dr + 1;
    const zr = Math.pow(r, 8);
    x = zr * Math.sin(theta) * Math.cos(phi) + x0;
    y = zr * Math.sin(theta) * Math.sin(phi) + y0;
    z = zr * Math.cos(theta) + z0;
  }
  if (r <= 2) return 0;
  return 0.5 * Math.log(r) * r / dr;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const cheb4 = (t) => 8 * t ** 4 - 8 * t * t + 1;

export const FIELDS_3D = [
  { id: 'sphere', label: 'Sphere', f: (x, y, z) => x * x + y * y + z * z - 1, bounds: CUBE(1.5), level: 0, levels: [-0.75, -0.4, 0, 0.5, 1.2] },
  {
    id: 'torus', label: 'Torus', f: (x, y, z) => (x * x + y * y + z * z + 1 - 0.16) ** 2 - 4 * (x * x + y * y),
    bounds: CUBE(1.6), level: 0, levels: [-0.4, -0.2, 0, 0.5, 1.5],
  },
  {
    id: 'genus2', label: 'Genus-2 surface', // (x(x-1)^2(x-2)+y^2)^2 + z^2 = r^2, shifted so it is centred
    f: (x, y, z) => ((x + 1) * x * x * (x - 1) + y * y) ** 2 + z * z - 0.01,
    bounds: { xmin: -1.4, xmax: 1.4, ymin: -0.9, ymax: 0.9, zmin: -0.5, zmax: 0.5 }, level: 0, levels: [-0.005, 0, 0.01, 0.03],
  },
  {
    id: 'metaballs3', label: 'Metaballs',
    f: metaballs3([[-0.6, 0, 0, 0.7], [0.6, 0.1, 0, 0.7], [0, 0.7, 0.3, 0.55], [0, -0.5, -0.5, 0.5]]), bounds: CUBE(2), level: 0, levels: [-1, -0.3, 0, 0.3],
  },
  {
    id: 'gyroid', label: 'Gyroid', f: (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x),
    bounds: CUBE(Math.PI), level: 0, levels: [-0.8, -0.4, 0, 0.4, 0.8],
  },
  { id: 'schwarzP', label: 'Schwarz P', f: (x, y, z) => Math.cos(x) + Math.cos(y) + Math.cos(z), bounds: CUBE(Math.PI), level: 0, levels: [-1, -0.5, 0, 0.5, 1] },
  {
    id: 'schwarzD', label: 'Schwarz D',
    f: (x, y, z) => Math.sin(x) * Math.sin(y) * Math.sin(z) + Math.sin(x) * Math.cos(y) * Math.cos(z)
      + Math.cos(x) * Math.sin(y) * Math.cos(z) + Math.cos(x) * Math.cos(y) * Math.sin(z),
    bounds: CUBE(Math.PI), level: 0, levels: [-0.5, -0.25, 0, 0.25, 0.5],
  },
  {
    id: 'heart', label: 'Heart surface', // (x^2 + 9/4 y^2 + z^2 - 1)^3 - x^2 z^3 - 9/80 y^2 z^3
    f: (x, y, z) => (x * x + 2.25 * y * y + z * z - 1) ** 3 - x * x * z ** 3 - (9 / 80) * y * y * z ** 3,
    bounds: { xmin: -1.5, xmax: 1.5, ymin: -1.2, ymax: 1.2, zmin: -1.4, zmax: 1.6 }, level: 0, levels: [-0.1, -0.02, 0, 0.1],
  },
  {
    id: 'barth', label: 'Barth sextic', // 65 nodes, icosahedral symmetry
    f: (x, y, z) => -(4 * (PHI * PHI * x * x - y * y) * (PHI * PHI * y * y - z * z) * (PHI * PHI * z * z - x * x)
      - (1 + 2 * PHI) * (x * x + y * y + z * z - 1) ** 2),
    bounds: CUBE(1.7), level: 0, levels: [-0.5, -0.1, 0, 0.1, 0.5],
  },
  { id: 'cone', label: 'Double cone', f: (x, y, z) => x * x + y * y - z * z, bounds: CUBE(1.5), level: 0, levels: [-0.5, -0.1, 0, 0.1, 0.5] },
  { id: 'chmutov', label: 'Chmutov (T4)', f: (x, y, z) => cheb4(x) + cheb4(y) + cheb4(z), bounds: CUBE(1.15), level: 0, levels: [-1, -0.5, 0, 0.5, 1] },
  { id: 'noise3', label: 'Value-noise fBm', f: fbm3(5, 4), bounds: CUBE(2), level: 0, levels: [-0.15, -0.05, 0, 0.05, 0.15] },
  { id: 'sh42', label: 'Spherical harmonic |Y⁴₂|', f: shLobe(4, 2), bounds: CUBE(1.5), level: 0, levels: [-0.2, 0, 0.2] },
  { id: 'sh53', label: 'Spherical harmonic |Y⁵₃|', f: shLobe(5, 3), bounds: CUBE(1.5), level: 0, levels: [-0.2, 0, 0.2] },
  { id: 'mandelbulb', label: 'Mandelbulb (power 8)', f: mandelbulb, bounds: CUBE(1.3), level: 0.02, levels: [0.01, 0.02, 0.05, 0.1] },
].map((d) => ({ ...d, dim: 3, f: finite(d.f) }));

/** Look up a field by id in either catalogue (or undefined). */
export function getField(id) {
  return FIELDS_2D.find((d) => d.id === id) || FIELDS_3D.find((d) => d.id === id);
}
