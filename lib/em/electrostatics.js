// Electrostatics in the plane: point/line charges, fields, potentials, field-line tracing, Gauss flux
// by quadrature, charged test particles and axisymmetric continuous distributions.
// Pure functions, no DOM, no p5.
//
// UNITS: dimensionless with eps0 = 1 (multiply E by 1/eps0 to taste).
//   law '3d' : 2D slice of the 3D Coulomb law.  E = q r / (4 pi (r^2+s^2)^(3/2)),  V = q / (4 pi sqrt(r^2+s^2))
//   law '2d' : true 2D world = infinite parallel line charges (q is charge PER UNIT LENGTH).
//              E = q r / (2 pi (r^2+s^2)),   V = -q ln(sqrt(r^2+s^2)) / (2 pi)   (reference radius 1)
//   s is the Plummer softening length (0 = exact).
// GAUSS CONVENTION: for the 2D law the flux of E through a closed curve (per unit length) is exactly
// Q_enclosed / eps0.  For the 3D-slice law a closed CURVE is not a closed surface, so Gauss' law
// does not hold for it - that is why the Gauss tab always uses the 2D law.

export const EPS0_SI = 8.8541878128e-12;
const TWO_PI = 2 * Math.PI;
const FOUR_PI = 4 * Math.PI;

/** @typedef {{x:number,y:number,q:number}} Charge */

/** Electric field [Ex, Ey] at (x, y) of point/line charges. `out` may be a reusable length-2 array. */
export function fieldAt(charges, x, y, law = '3d', soft = 0, out = [0, 0]) {
  let ex = 0, ey = 0;
  const s2 = soft * soft;
  const is3 = law !== '2d';
  for (let i = 0; i < charges.length; i++) {
    const c = charges[i];
    const dx = x - c.x, dy = y - c.y;
    const r2 = dx * dx + dy * dy + s2;
    if (r2 < 1e-24) continue;
    const f = is3 ? c.q / (FOUR_PI * r2 * Math.sqrt(r2)) : c.q / (TWO_PI * r2);
    ex += f * dx;
    ey += f * dy;
  }
  out[0] = ex;
  out[1] = ey;
  return out;
}

/** Electric potential at (x, y). */
export function potentialAt(charges, x, y, law = '3d', soft = 0) {
  let v = 0;
  const s2 = soft * soft;
  const is3 = law !== '2d';
  for (let i = 0; i < charges.length; i++) {
    const c = charges[i];
    const dx = x - c.x, dy = y - c.y;
    const r2 = dx * dx + dy * dy + s2;
    if (r2 < 1e-24) continue;
    v += is3 ? c.q / (FOUR_PI * Math.sqrt(r2)) : -c.q * Math.log(r2) / (2 * TWO_PI);
  }
  return v;
}

/** Sum of the charges. */
export function totalCharge(charges) {
  let q = 0;
  for (const c of charges) q += c.q;
  return q;
}

/**
 * Sample V, Ex, Ey and |E| on a regular lattice of (nx+1) x (ny+1) points over `b`
 * (x fastest, row 0 at ymin; same layout as lib/marching.js). Returns Float32Arrays.
 */
export function fieldGrid(charges, b, nx, ny, law = '3d', soft = 0) {
  const n = (nx + 1) * (ny + 1);
  const v = new Float32Array(n), ex = new Float32Array(n), ey = new Float32Array(n), mag = new Float32Array(n);
  const e = [0, 0];
  for (let j = 0; j <= ny; j++) {
    const y = b.ymin + (b.ymax - b.ymin) * j / ny;
    for (let i = 0; i <= nx; i++) {
      const x = b.xmin + (b.xmax - b.xmin) * i / nx;
      const k = i + (nx + 1) * j;
      fieldAt(charges, x, y, law, soft, e);
      ex[k] = e[0];
      ey[k] = e[1];
      mag[k] = Math.hypot(e[0], e[1]);
      v[k] = potentialAt(charges, x, y, law, soft);
    }
  }
  return { v, ex, ey, mag, nx, ny, bounds: b };
}

/** Percentile (0..1) of the finite values of an array (copy + sort; use on subsampled data). */
export function percentile(arr, p) {
  const a = [];
  for (let i = 0; i < arr.length; i++) if (Number.isFinite(arr[i])) a.push(arr[i]);
  if (!a.length) return 0;
  a.sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / mag;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * mag;
}

/**
 * Choose equipotential levels for a sampled potential.
 * linear: multiples of a step anchored at 0 (so the zero line shows when V changes sign).
 * log: +/- v0 * ratio^k between the 10th and 97th percentile of |V| (plus 0 if V changes sign).
 * Robust against the 1/r spikes at the charges by using percentiles.
 */
export function equipotentialLevels(values, count = 14, log = false) {
  const n = Math.max(2, Math.round(count));
  const lo = percentile(values, 0.03), hi = percentile(values, 0.97);
  if (!(hi > lo)) return [];
  const mixed = lo < 0 && hi > 0;
  const out = [];
  if (!log) {
    const step = niceStep((hi - lo) / n);
    for (let k = Math.ceil(lo / step); k * step <= hi; k++) out.push(+(k * step).toPrecision(12));
    return out;
  }
  const absV = Array.from(values, Math.abs);
  const vmax = percentile(absV, 0.97);
  const vmin = Math.max(percentile(absV, 0.1), vmax * 1e-4);
  if (!(vmax > vmin)) return [];
  const per = mixed ? Math.max(1, Math.floor(n / 2)) : n;
  const ratio = Math.pow(vmax / vmin, 1 / Math.max(1, per - 1));
  for (let k = 0; k < per; k++) {
    const m = vmin * Math.pow(ratio, k);
    if (mixed) out.push(-m, m);
    else out.push(hi <= 0 ? -m : m);
  }
  if (mixed) out.push(0);
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Field lines
// ---------------------------------------------------------------------------------------------

/**
 * Seed points for field lines: around each charge, count proportional to |q| (at least minPer).
 * Positive charges start lines that follow E (dir +1); negative charges start lines traced backwards (dir -1).
 */
export function fieldLineSeeds(charges, perUnit = 8, r0 = 0.12, minPer = 4, maxPer = 64) {
  const seeds = [];
  charges.forEach((c, idx) => {
    if (!c.q) return;
    const n = Math.min(maxPer, Math.max(minPer, Math.round(perUnit * Math.abs(c.q))));
    const phase = 0.5 * Math.PI / n + idx * 0.37;
    for (let k = 0; k < n; k++) {
      const a = phase + TWO_PI * k / n;
      seeds.push({ x: c.x + r0 * Math.cos(a), y: c.y + r0 * Math.sin(a), charge: idx, dir: c.q > 0 ? 1 : -1 });
    }
  });
  return seeds;
}

/**
 * Trace a field line with RK4 along the unit tangent dir*E/|E| (arc-length parametrisation).
 * Stops when it comes within `stopRadius` of a charge, leaves `bounds`, hits a null point or exhausts maxSteps.
 * Returns { pts: Float64Array [x0,y0,x1,y1,...], end: 'charge'|'bounds'|'null'|'max', endCharge }.
 */
export function traceFieldLine(charges, x0, y0, dir = 1, opts = {}) {
  const { law = "3d", soft = 0, maxSteps = 900, bounds = null, stopRadius = 0.07, skip = -1 } = opts;
  let step = opts.step || 0.08;
  const pts = [x0, y0];
  let x = x0, y = y0;
  const e = [0, 0];
  const tangent = (px, py) => {
    fieldAt(charges, px, py, law, soft, e);
    const m = Math.hypot(e[0], e[1]);
    if (!(m > 1e-12)) return null;
    return [dir * e[0] / m, dir * e[1] / m];
  };
  let end = 'max', endCharge = -1;
  const full = step;
  const minStep = opts.minStep || full / 10;
  for (let n = 0; n < maxSteps; n++) {
    if (opts.adaptive) {
      // shrink the step near charges where the field lines bend quickly
      let dmin = Infinity;
      for (let i = 0; i < charges.length; i++) {
        const d = Math.hypot(x - charges[i].x, y - charges[i].y);
        if (d < dmin) dmin = d;
      }
      step = Math.min(full, Math.max(minStep, 0.35 * dmin));
    }
    const k1 = tangent(x, y);
    if (!k1) { end = 'null'; break; }
    const k2 = tangent(x + 0.5 * step * k1[0], y + 0.5 * step * k1[1]);
    const k3 = k2 && tangent(x + 0.5 * step * k2[0], y + 0.5 * step * k2[1]);
    const k4 = k3 && tangent(x + step * k3[0], y + step * k3[1]);
    if (!k2 || !k3 || !k4) { end = 'null'; break; }
    x += step * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    y += step * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { end = 'null'; break; }
    pts.push(x, y);
    let hit = -1;
    for (let i = 0; i < charges.length; i++) {
      if (i === skip && n < 20) continue;
      if (Math.hypot(x - charges[i].x, y - charges[i].y) < stopRadius && charges[i].q !== 0) { hit = i; break; }
    }
    if (hit >= 0) { end = 'charge'; endCharge = hit; break; }
    if (bounds && (x < bounds.xmin || x > bounds.xmax || y < bounds.ymin || y > bounds.ymax)) { end = 'bounds'; break; }
  }
  return { pts: Float64Array.from(pts), end, endCharge };
}

/** All field lines of a configuration. */
export function traceAll(charges, opts = {}) {
  const { perUnit = 8, seedRadius = 0.12, stopRadius = 0.07 } = opts;
  const lines = [];
  for (const s of fieldLineSeeds(charges, perUnit, seedRadius)) {
    const t = traceFieldLine(charges, s.x, s.y, s.dir, { ...opts, stopRadius, skip: s.charge });
    t.charge = s.charge;
    t.dir = s.dir;
    lines.push(t);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Energy, multipoles
// ---------------------------------------------------------------------------------------------

/** Pairwise potential energy of a point-charge configuration (self energies excluded). */
export function systemEnergy(charges, law = '3d', soft = 0) {
  let w = 0;
  const s2 = soft * soft;
  for (let i = 0; i < charges.length; i++) {
    for (let j = i + 1; j < charges.length; j++) {
      const dx = charges[i].x - charges[j].x, dy = charges[i].y - charges[j].y;
      const r2 = dx * dx + dy * dy + s2;
      if (r2 < 1e-24) continue;
      const u = law === '2d' ? -Math.log(r2) / (2 * TWO_PI) : 1 / (FOUR_PI * Math.sqrt(r2));
      w += charges[i].q * charges[j].q * u;
    }
  }
  return w;
}

/** Net charge Q, dipole moment p = sum q (r - c) about c (default: |q|-weighted centre), and that centre. */
export function dipoleMoment(charges, about = null) {
  let Q = 0, wx = 0, wy = 0, w = 0;
  for (const c of charges) { Q += c.q; wx += Math.abs(c.q) * c.x; wy += Math.abs(c.q) * c.y; w += Math.abs(c.q); }
  const cx = about ? about.x : (w ? wx / w : 0), cy = about ? about.y : (w ? wy / w : 0);
  let px = 0, py = 0;
  for (const c of charges) { px += c.q * (c.x - cx); py += c.q * (c.y - cy); }
  return { Q, px, py, cx, cy, p: Math.hypot(px, py) };
}

/** Monopole + dipole approximation of V at (x, y) about centre (cx, cy). Returns { mono, dip, total }. */
export function farFieldPotential(charges, x, y, law = '3d', centre = null) {
  const d = dipoleMoment(charges, centre);
  const dx = x - d.cx, dy = y - d.cy;
  const r2 = dx * dx + dy * dy;
  const r = Math.sqrt(r2);
  if (r < 1e-12) return { mono: 0, dip: 0, total: 0, ...d };
  const pr = d.px * dx + d.py * dy;
  const mono = law === '2d' ? -d.Q * Math.log(r) / TWO_PI : d.Q / (FOUR_PI * r);
  const dip = law === '2d' ? pr / (TWO_PI * r2) : pr / (FOUR_PI * r2 * r);
  return { mono, dip, total: mono + dip, ...d };
}

// ---------------------------------------------------------------------------------------------
// Test particle (RK4, Plummer softening)
// ---------------------------------------------------------------------------------------------

/** One RK4 step of a test charge qt, mass m in the field of fixed charges. state = [x, y, vx, vy]. */
export function stepParticle(state, charges, qt, m, dt, law = '3d', soft = 0.05) {
  const e = [0, 0];
  const k = qt / m;
  const f = (s) => {
    fieldAt(charges, s[0], s[1], law, soft, e);
    return [s[2], s[3], k * e[0], k * e[1]];
  };
  const add = (s, d, h) => [s[0] + h * d[0], s[1] + h * d[1], s[2] + h * d[2], s[3] + h * d[3]];
  const a = f(state), b = f(add(state, a, dt / 2)), c = f(add(state, b, dt / 2)), d = f(add(state, c, dt));
  return [0, 1, 2, 3].map((i) => state[i] + dt * (a[i] + 2 * b[i] + 2 * c[i] + d[i]) / 6);
}

/** Total energy (kinetic + q V) of a test charge. */
export function particleEnergy(state, charges, qt, m, law = '3d', soft = 0.05) {
  return 0.5 * m * (state[2] * state[2] + state[3] * state[3]) + qt * potentialAt(charges, state[0], state[1], law, soft);
}

// ---------------------------------------------------------------------------------------------
// Gauss' law by quadrature
// ---------------------------------------------------------------------------------------------

// 5-point Gauss-Legendre nodes/weights on [-1, 1]
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.9061798459386640, 0.9061798459386640];
const GL_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

/** Signed area of a polygon given as [{x,y}] (positive when counter-clockwise). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Polygon approximating a circle (counter-clockwise). */
export function circlePolygon(cx, cy, r, n = 96) {
  const out = [];
  for (let k = 0; k < n; k++) out.push({ x: cx + r * Math.cos(TWO_PI * k / n), y: cy + r * Math.sin(TWO_PI * k / n) });
  return out;
}

/** Rectangle as a counter-clockwise polygon. */
export function rectPolygon(x0, y0, x1, y1) {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  return [{ x: xa, y: ya }, { x: xb, y: ya }, { x: xb, y: yb }, { x: xa, y: yb }];
}

function minDistToCharges(charges, x, y) {
  let m = Infinity;
  for (const c of charges) m = Math.min(m, Math.hypot(x - c.x, y - c.y));
  return m;
}

/**
 * Flux of E through a closed polygon (outward), by composite 5-point Gauss-Legendre per edge
 * with panels refined near charges. Also returns the enclosed charge and its index list.
 * { flux, enclosed, enclosedIdx } ; with the 2D law flux === enclosed / eps0 (eps0 = 1).
 */
export function polygonFlux(charges, poly, law = '2d', soft = 0) {
  const sign = polygonArea(poly) >= 0 ? 1 : -1; // outward normal = right of travel for CCW
  let flux = 0;
  const e = [0, 0];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const nx = sign * ey / len, ny = -sign * ex / len;
    const dmin = Math.max(1e-3, minDistToCharges(charges, (a.x + b.x) / 2, (a.y + b.y) / 2) - len / 2);
    const panels = Math.min(160, Math.max(1, Math.ceil(len / Math.max(1e-3, 0.7 * dmin))));
    for (let p = 0; p < panels; p++) {
      const t0 = p / panels, t1 = (p + 1) / panels;
      for (let g = 0; g < 5; g++) {
        const t = t0 + (t1 - t0) * (GL_X[g] + 1) / 2;
        fieldAt(charges, a.x + ex * t, a.y + ey * t, law, soft, e);
        flux += GL_W[g] * (t1 - t0) / 2 * len * (e[0] * nx + e[1] * ny);
      }
    }
  }
  let enclosed = 0;
  const enclosedIdx = [];
  charges.forEach((c, i) => { if (pointInPolygon(poly, c.x, c.y)) { enclosed += c.q; enclosedIdx.push(i); } });
  return { flux, enclosed, enclosedIdx };
}

/** Flux through a circle by Gauss-Legendre in the angle (exact parametrisation, no polygon error). */
export function circleFlux(charges, cx, cy, r, law = '2d', soft = 0) {
  let flux = 0;
  let dmin = Infinity;
  for (const c of charges) dmin = Math.min(dmin, Math.abs(Math.hypot(c.x - cx, c.y - cy) - r));
  const panels = Math.min(400, Math.max(16, Math.ceil(TWO_PI * r / Math.max(1e-3, 0.7 * Math.max(dmin, 1e-3)) / 2)));
  const e = [0, 0];
  for (let p = 0; p < panels; p++) {
    const t0 = TWO_PI * p / panels, t1 = TWO_PI * (p + 1) / panels;
    for (let g = 0; g < 5; g++) {
      const t = t0 + (t1 - t0) * (GL_X[g] + 1) / 2;
      const nx = Math.cos(t), ny = Math.sin(t);
      fieldAt(charges, cx + r * nx, cy + r * ny, law, soft, e);
      flux += GL_W[g] * (t1 - t0) / 2 * r * (e[0] * nx + e[1] * ny);
    }
  }
  let enclosed = 0;
  const enclosedIdx = [];
  charges.forEach((c, i) => { if (Math.hypot(c.x - cx, c.y - cy) < r) { enclosed += c.q; enclosedIdx.push(i); } });
  return { flux, enclosed, enclosedIdx };
}

/** n evenly spaced samples along a polygon boundary with outward normal and E.n (local flux density). */
export function boundarySamples(charges, poly, n = 48, law = '2d', soft = 0) {
  const sign = polygonArea(poly) >= 0 ? 1 : -1;
  const lens = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    lens.push(Math.hypot(b.x - a.x, b.y - a.y));
    total += lens[i];
  }
  const out = [];
  if (!(total > 1e-12)) return out;
  const e = [0, 0];
  let edge = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const s = (k + 0.5) * total / n;
    while (edge < poly.length - 1 && acc + lens[edge] < s) { acc += lens[edge]; edge++; }
    const a = poly[edge], b = poly[(edge + 1) % poly.length];
    const t = lens[edge] > 0 ? (s - acc) / lens[edge] : 0;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    const nx = lens[edge] ? sign * (b.y - a.y) / lens[edge] : 0, ny = lens[edge] ? -sign * (b.x - a.x) / lens[edge] : 0;
    fieldAt(charges, x, y, law, soft, e);
    out.push({ x, y, nx, ny, En: e[0] * nx + e[1] * ny });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Axisymmetric continuous distributions (3D Coulomb law)
// ---------------------------------------------------------------------------------------------
// A distribution is a list of rings (rho, z, dq) about the z axis, Float64Array triplets. The field is
// evaluated in the half-plane through the axis: position (x, z) where x may be negative (the mirror half-plane).

/** erf (Abramowitz & Stegun 7.1.26, |error| < 1.5e-7). */
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export const DIST_KINDS = ['rod', 'ring', 'disk', 'ball', 'gauss'];

/**
 * Discretise a distribution into rings. kind: rod (length `size` on the z axis), ring (radius size),
 * disk (radius size), ball (uniform, radius size), gauss (sigma = size, truncated at 5 sigma).
 * Q is the total charge (normalised exactly), n the resolution.
 */
export function makeRings(kind, { Q = 1, size = 1, n = 40 } = {}) {
  const rings = [];
  const push = (rho, z, w) => rings.push(rho, z, w);
  if (kind === 'rod') {
    for (let k = 0; k < n; k++) push(0, -size / 2 + size * (k + 0.5) / n, 1);
  } else if (kind === 'ring') {
    push(size, 0, 1);
  } else if (kind === 'disk') {
    for (let k = 0; k < n; k++) { const r = size * (k + 0.5) / n; push(r, 0, r); }
  } else if (kind === 'ball' || kind === 'gauss') {
    const R = kind === 'ball' ? size : 5 * size;
    const nr = Math.max(6, Math.round(n / 3)), nz = Math.max(8, 2 * nr);
    for (let a = 0; a < nr; a++) {
      const r = R * (a + 0.5) / nr;
      for (let b = 0; b < nz; b++) {
        const z = -R + 2 * R * (b + 0.5) / nz;
        const d2 = r * r + z * z;
        let w = r;
        if (kind === 'ball') { if (d2 > R * R) continue; } else w *= Math.exp(-d2 / (2 * size * size));
        push(r, z, w);
      }
    }
  } else throw new Error(`makeRings: unknown kind ${kind}`);
  let sum = 0;
  for (let i = 2; i < rings.length; i += 3) sum += rings[i];
  const out = new Float64Array(rings.length);
  for (let i = 0; i < rings.length; i += 3) {
    out[i] = rings[i];
    out[i + 1] = rings[i + 1];
    out[i + 2] = sum > 0 ? Q * rings[i + 2] / sum : 0;
  }
  return out;
}

/** { Ex, Ez, V } of a ring list at the half-plane point (x, z), integrating over the azimuth numerically. */
export function ringsFieldAt(rings, x, z, nphi = 24) {
  let ex = 0, ez = 0, v = 0;
  for (let i = 0; i < rings.length; i += 3) {
    const rho = rings[i], z0 = rings[i + 1], dq = rings[i + 2];
    const dz = z - z0;
    if (rho < 1e-12) {
      const r2 = x * x + dz * dz;
      if (r2 < 1e-18) continue;
      const r = Math.sqrt(r2);
      v += dq / (FOUR_PI * r);
      ex += dq * x / (FOUR_PI * r2 * r);
      ez += dq * dz / (FOUR_PI * r2 * r);
      continue;
    }
    // symmetric about the half-plane: integrate azimuth over [0, pi] (midpoint rule) and double
    const nh = Math.max(4, nphi >> 1);
    let sx = 0, sz = 0, sv = 0;
    for (let k = 0; k < nh; k++) {
      const ph = Math.PI * (k + 0.5) / nh;
      const dx = x - rho * Math.cos(ph), dy = rho * Math.sin(ph);
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < 1e-18) continue;
      const r = Math.sqrt(r2);
      sv += 1 / r;
      sx += dx / (r2 * r);
      sz += dz / (r2 * r);
    }
    const f = dq / (FOUR_PI * nh);
    v += f * sv;
    ex += f * sx;
    ez += f * sz;
  }
  return { Ex: ex, Ez: ez, V: v };
}

/** Exact quadrature of the on-axis field E_z(z) of a ring list (no azimuth sampling needed). */
export function ringsAxisField(rings, z) {
  let ez = 0;
  for (let i = 0; i < rings.length; i += 3) {
    const rho = rings[i], dz = z - rings[i + 1], dq = rings[i + 2];
    const r2 = rho * rho + dz * dz;
    if (r2 < 1e-18) continue;
    ez += dq * dz / (FOUR_PI * r2 * Math.sqrt(r2));
  }
  return ez;
}

/** Closed-form radial field E_rho(x) in the mid plane z = 0 where known (rod, ball, gauss), else NaN. */
export function analyticRadialField(kind, { Q = 1, size = 1 }, x) {
  const r = Math.abs(x), s = Math.sign(x) || 1;
  if (kind === 'rod') return r < 1e-12 ? NaN : s * Q / (FOUR_PI * r * Math.sqrt(r * r + size * size / 4));
  if (kind === 'ball') return r < 1e-12 ? 0 : s * (r >= size ? Q / (FOUR_PI * r * r) : Q * r / (FOUR_PI * size * size * size));
  if (kind === 'gauss') {
    if (r < 1e-12) return 0;
    const f = erf(r / (Math.SQRT2 * size)) - Math.sqrt(2 / Math.PI) * (r / size) * Math.exp(-r * r / (2 * size * size));
    return s * Q * f / (FOUR_PI * r * r);
  }
  return NaN;
}

/** Closed-form on-axis field E_z(z) of the continuous distributions (NaN where undefined). */
export function analyticAxisField(kind, { Q = 1, size = 1 }, z) {
  const a = size;
  if (kind === 'rod') {
    if (Math.abs(z) <= a / 2) return NaN;
    return (Q / a) / FOUR_PI * (1 / (z - a / 2) - 1 / (z + a / 2));
  }
  if (kind === 'ring') return Q * z / (FOUR_PI * Math.pow(z * z + a * a, 1.5));
  if (kind === 'disk') {
    const sigma = Q / (Math.PI * a * a);
    return sigma / 2 * Math.sign(z) * (1 - Math.abs(z) / Math.sqrt(z * z + a * a));
  }
  return analyticRadialField(kind, { Q, size }, z);
}

/** Point-charge field magnitude Q / (4 pi r^2): the far-field reference for any distribution. */
export function monopoleField(Q, r) {
  return r > 0 ? Q / (FOUR_PI * r * r) : NaN;
}

/** Net charge of a ring list. */
export function ringsCharge(rings) {
  let q = 0;
  for (let i = 2; i < rings.length; i += 3) q += rings[i];
  return q;
}

// ---------------------------------------------------------------------------------------------
// Presets for the Charges tab
// ---------------------------------------------------------------------------------------------

export const CHARGE_PRESETS = [
  { id: 'dipole', label: 'Dipole', law: '3d', make: () => [{ x: -1, y: 0, q: 1 }, { x: 1, y: 0, q: -1 }] },
  {
    id: 'quadrupole', label: 'Linear quadrupole', law: '3d',
    make: () => [{ x: -1.6, y: 0, q: 1 }, { x: 0, y: 0, q: -2 }, { x: 1.6, y: 0, q: 1 }],
  },
  { id: 'like', label: 'Two like charges', law: '3d', make: () => [{ x: -1.2, y: 0, q: 1 }, { x: 1.2, y: 0, q: 1 }] },
  {
    id: 'ring', label: 'Ring of 8 charges', law: '3d',
    make: () => Array.from({ length: 8 }, (_, k) => ({ x: 2 * Math.cos(Math.PI * k / 4), y: 2 * Math.sin(Math.PI * k / 4), q: 0.5 })),
  },
  {
    id: 'lines', label: 'Parallel line charges (2D law)', law: '2d',
    make: () => [{ x: -1.2, y: 0, q: 1 }, { x: 1.2, y: 0, q: -1 }],
  },
  {
    id: 'plates', label: 'Capacitor plates (rows of charge)', law: '3d',
    make: () => {
      const out = [];
      for (let k = 0; k < 9; k++) { const x = -3.2 + 0.8 * k; out.push({ x, y: 1, q: 0.35 }, { x, y: -1, q: -0.35 }); }
      return out;
    },
  },
];

/** Serialise charges to "x,y,q;x,y,q" (deep-link / settings format). */
export function formatCharges(charges) {
  return charges.map((c) => [c.x, c.y, c.q].map((v) => +v.toFixed(3)).join(',')).join(';');
}

/** Parse the format of formatCharges; invalid entries are dropped. */
export function parseCharges(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const part of text.split(';')) {
    const v = part.split(',').map(Number);
    if (v.length === 3 && v.every(Number.isFinite) && out.length < 60) out.push({ x: v[0], y: v[1], q: v[2] });
  }
  return out;
}
