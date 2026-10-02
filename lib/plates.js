// Vibrating plates: analytic eigenmodes, Bessel functions, mode superposition, point-driven response
// and nodal-line extraction. Pure functions, no DOM / p5.
//
// DOMAINS (physical units, plate height is always 1)
//   square / rect : x in [0, aspect], y in [0, 1]      (square = rect with aspect 1)
//   circle        : unit disc, x, y in [-1, 1]
//
// MODE FAMILIES (spec.kind, rectangles only)
//   'simply'  simply supported edges, exact:   sin(m pi x / a) sin(n pi y)            m, n >= 1
//   'free'    free-edge-like, Chladni style:   cos(m pi x / a) cos(n pi y). For a square and m != n the degenerate
//             pair is combined as cos(n pi x) cos(m pi y) -/+ cos(m pi x) cos(n pi y)  (spec.phase 0 / 1 = minus / plus),
//             the classic Chladni figures. This is the Neumann (free membrane) family, an approximation of a free plate.
//   'clamped' product of clamped-clamped beam functions (Rayleigh-Ritz style approximation), m, n >= 1.
//   circle    J_m(j_{m,n} r) cos(m theta) (spec.phase 1: sin), exact for a clamped membrane; also used as the
//             nodal-pattern approximation for a circular plate.
//
// EIGENVALUE: mode.lambda is the squared wavenumber k^2 (units 1 / length^2), e.g. pi^2 (m^2/a^2 + n^2).
// DISPERSION: omega = sqrt(lambda) = k for a membrane (wave equation), omega = lambda = k^2 for a thin plate
// (Kirchhoff plate: omega = sqrt(D / rho h) k^2). Frequencies are in arbitrary units; only ratios matter.
//
// Time evolution:  u(x, y, t) = sum_k a_k phi_k(x, y) cos(omega_k t).

const PI = Math.PI;

// ---------------------------------------------------------------------------------------------
// Bessel functions
// ---------------------------------------------------------------------------------------------

/**
 * Bessel function of the first kind J_n(x), integer order n >= 0, any real x. Uses Miller's downward
 * recurrence normalised with J_0 + 2 sum J_2k = 1 (stable for every x, accurate to ~1e-14).
 */
export function besselJ(n, x) {
  n = Math.abs(Math.trunc(n));
  if (!Number.isFinite(x)) return NaN;
  if (x < 0) return (n % 2 ? -1 : 1) * besselJ(n, -x);
  if (x === 0) return n === 0 ? 1 : 0;
  const big = Math.max(n, x);
  const M = 2 * Math.ceil((big + 20 + Math.sqrt(40 * big)) / 2);
  let jp1 = 0;
  let j = 1e-30;
  let sum = 0;
  let res = 0;
  for (let k = M; k >= 1; k--) {
    const jm1 = (2 * k / x) * j - jp1; // J_{k-1}
    jp1 = j;
    j = jm1;
    const order = k - 1;
    if (order === n) res = j;
    if (order % 2 === 0) sum += order === 0 ? j : 2 * j;
    if (Math.abs(j) > 1e250) {
      j *= 1e-250; jp1 *= 1e-250; sum *= 1e-250; res *= 1e-250;
    }
  }
  return res / sum;
}

const zeroCache = new Map();

/**
 * First `count` positive zeros j_{n,1..count} of J_n (ascending). Known values: j_{0,1} = 2.404826,
 * j_{1,1} = 3.831706, j_{2,1} = 5.135622, j_{0,2} = 5.520078.
 */
export function besselZeros(n, count) {
  n = Math.abs(Math.trunc(n));
  let list = zeroCache.get(n);
  if (!list) { list = []; zeroCache.set(n, list); }
  if (list.length >= count) return list.slice(0, count);
  const h = 0.1;
  let x = list.length ? list[list.length - 1] + h : Math.max(h, n * 0.5);
  let fx = besselJ(n, x);
  while (list.length < count && x < 1e4) {
    const x2 = x + h;
    const f2 = besselJ(n, x2);
    if (fx * f2 < 0) {
      let a = x;
      let b = x2;
      let fa = fx;
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (a + b);
        const fm = besselJ(n, mid);
        if (fa * fm <= 0) b = mid; else { a = mid; fa = fm; }
      }
      list.push(0.5 * (a + b));
    }
    x = x2;
    fx = f2;
  }
  return list.slice(0, count);
}

// ---------------------------------------------------------------------------------------------
// Clamped-clamped beam functions (for the 'clamped' rectangular family)
// ---------------------------------------------------------------------------------------------

const beamCache = new Map();

/** beta_m * L, m = 1, 2, ... : roots of cos(b) cosh(b) = 1 (4.7300, 7.8532, 10.9956, ...). */
export function beamBeta(m) {
  m = Math.max(1, Math.trunc(m));
  if (beamCache.has(m)) return beamCache.get(m);
  let b = (2 * m + 1) * PI / 2;
  for (let it = 0; it < 60; it++) {
    // g = cos b - 1/cosh b has the same roots as cos b cosh b - 1 and stays finite for large b
    const ch = Math.cosh(b);
    const g = Math.cos(b) - 1 / ch;
    const dg = -Math.sin(b) + Math.sinh(b) / (ch * ch);
    const step = g / dg;
    b -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  beamCache.set(m, b);
  return b;
}

/** Clamped-clamped beam mode shape at s in [0, 1], order m >= 1 (bounded, max |value| ~ 2). */
export function beamShape(m, s) {
  const b = beamBeta(m);
  const omSigma = (Math.cos(b) - Math.sin(b) - Math.exp(-b)) / (Math.sinh(b) - Math.sin(b)); // 1 - sigma
  const sigma = 1 - omSigma;
  // cosh(bs) - sigma sinh(bs) = ((1 - sigma)/2) e^{bs} + ((1 + sigma)/2) e^{-bs}, evaluated without overflow
  const grow = 0.5 * omSigma * Math.exp(b * (s - 1)) * Math.exp(b);
  return grow + 0.5 * (1 + sigma) * Math.exp(-b * s) - Math.cos(b * s) + sigma * Math.sin(b * s);
}

// ---------------------------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------------------------

/** Dispersion: omega from the eigenvalue lambda = k^2. 'membrane': omega = k, 'plate': omega = k^2. */
export function modeOmega(lambda, dispersion = 'plate') {
  return dispersion === 'membrane' ? Math.sqrt(lambda) : lambda;
}

function clampInt(v, lo, hi) {
  v = Math.trunc(Number.isFinite(v) ? v : lo);
  return Math.max(lo, Math.min(hi, v));
}

/** Fill in defaults / clamp indices so that every spec describes a valid mode. */
export function normalizeSpec(spec = {}) {
  const shape = spec.shape === 'circle' ? 'circle' : spec.shape === 'rect' ? 'rect' : 'square';
  const kind = shape === 'circle' ? 'membrane' : (['simply', 'free', 'clamped'].includes(spec.kind) ? spec.kind : 'simply');
  let aspect = Number.isFinite(spec.aspect) ? spec.aspect : 1;
  aspect = shape === 'rect' ? Math.max(0.25, Math.min(4, aspect)) : 1;
  const free = kind === 'free';
  const circle = shape === 'circle';
  const m = clampInt(spec.m ?? 1, circle || free ? 0 : 1, 40);
  const n = clampInt(spec.n ?? 1, circle ? 1 : free ? 0 : 1, 40);
  return { shape, kind, aspect, m, n, phase: spec.phase ? 1 : 0 };
}

/**
 * Build a mode from a spec { shape: 'square'|'rect'|'circle', kind, m, n, aspect, phase }.
 * Returns { spec, lambda, phi(x, y), bounds, inside(x, y), label, rigid }.
 * `rigid` is true for the zero-frequency free mode (m = n = 0).
 */
export function makeMode(rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const { shape, kind, aspect: a, m, n, phase } = spec;
  if (shape === 'circle') {
    const k = besselZeros(m, n)[n - 1];
    const ang = phase ? Math.sin : Math.cos;
    return {
      spec, lambda: k * k, rigid: false,
      bounds: { xmin: -1, xmax: 1, ymin: -1, ymax: 1 },
      inside: (x, y) => x * x + y * y <= 1,
      phi: (x, y) => {
        const r = Math.hypot(x, y);
        if (r > 1) return 0;
        const f = m === 0 ? (phase ? 0 : 1) : ang(m * Math.atan2(y, x));
        return besselJ(m, k * r) * f;
      },
      label: `J${m}(${k.toFixed(3)} r)${m ? ` ${phase ? 'sin' : 'cos'}(${m}θ)` : ''}`,
    };
  }
  const bounds = { xmin: 0, xmax: a, ymin: 0, ymax: 1 };
  const inside = (x, y) => x >= 0 && x <= a && y >= 0 && y <= 1;
  if (kind === 'simply') {
    return {
      spec, bounds, inside, rigid: false,
      lambda: PI * PI * (m * m / (a * a) + n * n),
      phi: (x, y) => Math.sin(m * PI * x / a) * Math.sin(n * PI * y),
      label: `sin(${m}πx) sin(${n}πy)`,
    };
  }
  if (kind === 'free') {
    const combine = shape === 'square' && m !== n;
    const sign = phase ? 1 : -1;
    return {
      spec, bounds, inside, rigid: m === 0 && n === 0,
      lambda: PI * PI * (m * m / (a * a) + n * n),
      phi: combine
        ? (x, y) => Math.cos(n * PI * x) * Math.cos(m * PI * y) + sign * Math.cos(m * PI * x) * Math.cos(n * PI * y)
        : (x, y) => Math.cos(m * PI * x / a) * Math.cos(n * PI * y),
      label: combine
        ? `cos(${n}πx)cos(${m}πy) ${phase ? '+' : '−'} cos(${m}πx)cos(${n}πy)`
        : `cos(${m}πx) cos(${n}πy)`,
    };
  }
  const bm = beamBeta(m);
  const bn = beamBeta(n);
  return {
    spec, bounds, inside, rigid: false,
    lambda: (bm / a) ** 2 + bn * bn,
    phi: (x, y) => beamShape(m, x / a) * beamShape(n, y),
    label: `beam${m}(x) beam${n}(y)`,
  };
}

/**
 * The lowest `count` modes of a plate sorted by frequency (ties broken by indices).
 * shapeSpec: { shape, kind, aspect }. Returns [{ spec, lambda, omega, ratio, index }], ratio = omega / omega_first.
 * The rigid-body free mode is skipped. For circles only the cos(m theta) member of each degenerate pair is listed;
 * for the free square both Chladni combinations (phase 0 / 1) of each m != n pair are listed.
 */
export function listModes(shapeSpec, count = 20, dispersion = 'plate') {
  const base = normalizeSpec(shapeSpec);
  const maxIdx = Math.min(40, Math.ceil(Math.sqrt(count) * 3) + 4);
  const circle = base.shape === 'circle';
  const freeSquare = base.shape === 'square' && base.kind === 'free';
  const lo = base.kind === 'free' ? 0 : 1;
  const items = [];
  const add = (spec) => items.push({ spec: makeMode(spec).spec, lambda: makeMode(spec).lambda });
  for (let m = circle ? 0 : lo; m <= maxIdx; m++) {
    for (let n = circle ? 1 : (freeSquare ? m : lo); n <= maxIdx; n++) {
      if (!circle && base.kind === 'free' && m === 0 && n === 0) continue;
      if (circle && (n > Math.ceil(count / 2) + 2 || m > count)) continue;
      add({ ...base, m, n, phase: 0 });
      if (freeSquare && m !== n) add({ ...base, m, n, phase: 1 });
    }
  }
  items.sort((p, q) => p.lambda - q.lambda || p.spec.m - q.spec.m || p.spec.n - q.spec.n || p.spec.phase - q.spec.phase);
  const out = items.slice(0, count).map((it, index) => ({ ...it, index, omega: modeOmega(it.lambda, dispersion) }));
  const w0 = out.length ? out[0].omega : 1;
  for (const o of out) o.ratio = o.omega / w0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------------------------

/**
 * Sample a mode on an (nx+1) x (ny+1) lattice over its bounds (x fastest, row j = y_min + j dy), normalised
 * so that max |value| = 1. Points outside a circular plate are 0. Returns { values: Float32Array, nx, ny, bounds }.
 */
export function sampleMode(mode, res = 96) {
  const b = mode.bounds;
  const w = b.xmax - b.xmin;
  const h = b.ymax - b.ymin;
  const nx = Math.max(2, Math.round(w >= h ? res : res * w / h));
  const ny = Math.max(2, Math.round(h > w ? res : res * h / w));
  const values = new Float32Array((nx + 1) * (ny + 1));
  let mx = 0;
  for (let j = 0; j <= ny; j++) {
    const y = b.ymin + (j / ny) * h;
    for (let i = 0; i <= nx; i++) {
      const x = b.xmin + (i / nx) * w;
      let v = mode.inside(x, y) ? mode.phi(x, y) : 0;
      if (!Number.isFinite(v)) v = 0;
      values[i + (nx + 1) * j] = v;
      if (Math.abs(v) > mx) mx = Math.abs(v);
    }
  }
  if (mx > 0) for (let i = 0; i < values.length; i++) values[i] /= mx;
  return { values, nx, ny, bounds: { xmin: b.xmin, xmax: b.xmax, ymin: b.ymin, ymax: b.ymax } };
}

/** Bilinear interpolation of a grid at (x, y); clamps to the grid. */
export function bilinear(grid, x, y) {
  const { values, nx, ny, bounds: b } = grid;
  let fx = ((x - b.xmin) / (b.xmax - b.xmin)) * nx;
  let fy = ((y - b.ymin) / (b.ymax - b.ymin)) * ny;
  fx = fx < 0 ? 0 : fx > nx ? nx : fx;
  fy = fy < 0 ? 0 : fy > ny ? ny : fy;
  const i = Math.min(nx - 1, Math.floor(fx));
  const j = Math.min(ny - 1, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const s = nx + 1;
  const p = i + s * j;
  return (values[p] * (1 - tx) + values[p + 1] * tx) * (1 - ty) + (values[p + s] * (1 - tx) + values[p + s + 1] * tx) * ty;
}

function targetGrid(g0, out) {
  const n = g0.values.length;
  const res = out && out.values && out.values.length === n ? out : { values: new Float32Array(n) };
  res.nx = g0.nx; res.ny = g0.ny; res.bounds = g0.bounds;
  res.values.fill(0);
  return res;
}

/**
 * u = sum_k weights[k] * grids[k] (all grids share a lattice). For time evolution pass
 * weights[k] = a_k * cos(omega_k t). Writes into `out` when it has the right size.
 */
export function combine(grids, weights, out) {
  const res = targetGrid(grids[0], out);
  const v = res.values;
  const n = v.length;
  for (let k = 0; k < grids.length; k++) {
    const w = weights[k];
    if (!w) continue;
    const gv = grids[k].values;
    for (let i = 0; i < n; i++) v[i] += w * gv[i];
  }
  return res;
}

/** RMS envelope sqrt(sum (a_k phi_k)^2): the time-averaged vibration amplitude of an incoherent mixture. */
export function envelope(grids, amps, out) {
  const res = targetGrid(grids[0], out);
  const v = res.values;
  const n = v.length;
  for (let k = 0; k < grids.length; k++) {
    const w = amps[k];
    if (!w) continue;
    const gv = grids[k].values;
    for (let i = 0; i < n; i++) v[i] += (w * gv[i]) ** 2;
  }
  for (let i = 0; i < n; i++) v[i] = Math.sqrt(v[i]);
  return res;
}

/** Largest |value| of a grid. */
export function maxAbs(grid) {
  let m = 0;
  const v = grid.values;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > m) m = a; }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Driven response
// ---------------------------------------------------------------------------------------------

/**
 * Complex modal coefficients of a point-driven damped plate at drive frequency `omega`:
 *   c_k = phi_k(source) / (omega_k^2 - omega^2 + i gamma omega).
 * Returns { re: Float64Array, im: Float64Array }. The displacement is Re[ sum_k c_k phi_k(x, y) e^{i omega t} ].
 */
export function drivenCoefficients(omegas, phiSource, omega, gamma) {
  const n = omegas.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const dr = omegas[k] * omegas[k] - omega * omega;
    const di = gamma * omega;
    const den = dr * dr + di * di;
    if (!(den > 0) || !Number.isFinite(den)) continue;
    re[k] = (phiSource[k] * dr) / den;
    im[k] = (-phiSource[k] * di) / den;
  }
  return { re, im };
}

/** |sum_k c_k phi_k(observer)|: steady-state response amplitude at one point (for resonance curves). */
export function responseAmplitude(omegas, phiSource, phiObserver, omega, gamma) {
  const { re, im } = drivenCoefficients(omegas, phiSource, omega, gamma);
  let sr = 0;
  let si = 0;
  for (let k = 0; k < re.length; k++) { sr += re[k] * phiObserver[k]; si += im[k] * phiObserver[k]; }
  return Math.hypot(sr, si);
}

/**
 * Driven steady-state field on a lattice. Returns { A, B, theta, re, im }: A, B are the grids of Re / Im of
 * sum_k c_k phi_k, so u(t) = A cos(omega t) - B sin(omega t); theta rotates the dominant coefficient to be real,
 * so the peak-displacement snapshot is u_theta = A cos(theta) - B sin(theta).
 */
export function drivenField(grids, omegas, phiSource, omega, gamma) {
  const { re, im } = drivenCoefficients(omegas, phiSource, omega, gamma);
  let dom = 0;
  for (let k = 1; k < re.length; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[dom], im[dom])) dom = k;
  const A = combine(grids, Array.from(re));
  const B = combine(grids, Array.from(im));
  const theta = re.length ? -Math.atan2(im[dom], re[dom]) : 0;
  return { A, B, theta, re, im };
}

// ---------------------------------------------------------------------------------------------
// Nodal lines
// ---------------------------------------------------------------------------------------------

/**
 * Zero level set of a signed grid via `marching` (= marchingSquares from lib/marching.js, passed in).
 * Lattice values with |v| <= snap * max|v| are treated as exactly 0 (removes rounding noise on supported
 * or clamped edges), segments lying along the plate boundary are dropped, and for circles so are segments
 * reaching outside the disc. With `trimBoundary` (plates whose edge is itself a node: simply supported, clamped,
 * circular) every segment with an endpoint on the boundary is dropped too: those are discretisation stubs
 * of the exact-zero edge values (the visible gap is at most one cell). Returns { segments: Float64Array [x0,y0,x1,y1,...], count }.
 */
export function nodalLines(grid, marching, opts = {}) {
  const { circle = false, snap = 1e-9, trimBoundary = false } = opts;
  const v = grid.values;
  const mx = maxAbs(grid);
  if (!(mx > 0)) return { segments: new Float64Array(0), count: 0 };
  const thr = snap * mx;
  const work = { values: new Float32Array(v.length), nx: grid.nx, ny: grid.ny, bounds: grid.bounds };
  for (let i = 0; i < v.length; i++) work.values[i] = Math.abs(v[i]) <= thr ? 0 : v[i];
  const res = marching(work, { level: 0 });
  const b = grid.bounds;
  const tolX = 1e-7 * (b.xmax - b.xmin);
  const tolY = 1e-7 * (b.ymax - b.ymin);
  const out = new Float64Array(res.count * 4);
  const s = res.segments;
  let c = 0;
  const onSide = (x, y, side) => {
    if (side === 0) return Math.abs(x - b.xmin) < tolX;
    if (side === 1) return Math.abs(x - b.xmax) < tolX;
    if (side === 2) return Math.abs(y - b.ymin) < tolY;
    return Math.abs(y - b.ymax) < tolY;
  };
  for (let k = 0; k < res.count; k++) {
    const x0 = s[4 * k];
    const y0 = s[4 * k + 1];
    const x1 = s[4 * k + 2];
    const y1 = s[4 * k + 3];
    if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
    if (circle) {
      const lim = trimBoundary ? 1 - 1e-6 : 1 + 1e-9;
      if (x0 * x0 + y0 * y0 > lim * lim || x1 * x1 + y1 * y1 > lim * lim) continue;
    } else if (trimBoundary) {
      let touches = false;
      for (let side = 0; side < 4; side++) if (onSide(x0, y0, side) || onSide(x1, y1, side)) touches = true;
      if (touches) continue;
    } else {
      let along = false;
      for (let side = 0; side < 4; side++) if (onSide(x0, y0, side) && onSide(x1, y1, side)) along = true;
      if (along) continue;
    }
    out[4 * c] = x0; out[4 * c + 1] = y0; out[4 * c + 2] = x1; out[4 * c + 3] = y1;
    c++;
  }
  return { segments: out.subarray(0, 4 * c), count: c };
}

/** CSV text ("x0,y0,x1,y1" per line, header included) for a nodal-line segment list. */
export function segmentsToCsv(lines) {
  const rows = ['x0,y0,x1,y1'];
  const s = lines.segments;
  for (let k = 0; k < lines.count; k++) rows.push(`${s[4 * k]},${s[4 * k + 1]},${s[4 * k + 2]},${s[4 * k + 3]}`);
  return rows.join('\n');
}

/**
 * Join an unordered segment list into polylines by matching shared endpoints (to ~1e-7 of `scale`).
 * Returns an array of Float64Array [x0,y0,x1,y1,...]; a closed loop repeats its first point at the end.
 * Zero-length segments are ignored. Drawing polylines needs about half as many vertex calls as raw segments.
 */
export function chainSegments(lines, scale = 1) {
  const s = lines.segments;
  const q = 1e7 / (scale || 1);
  const key = (x, y) => `${Math.round(x * q)},${Math.round(y * q)}`;
  const n = lines.count;
  const ends = new Map();
  const keys = new Array(n);
  const live = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const ka = key(s[4 * k], s[4 * k + 1]);
    const kb = key(s[4 * k + 2], s[4 * k + 3]);
    keys[k] = [ka, kb];
    if (ka === kb) continue;
    live[k] = 1;
    for (const kk of keys[k]) {
      const list = ends.get(kk);
      if (list) list.push(k); else ends.set(kk, [k]);
    }
  }
  const takeNext = (k0) => {
    const list = ends.get(k0);
    if (!list) return -1;
    while (list.length) {
      const k = list.pop();
      if (live[k]) return k;
    }
    return -1;
  };
  const out = [];
  for (let k0 = 0; k0 < n; k0++) {
    if (!live[k0]) continue;
    live[k0] = 0;
    const pts = [s[4 * k0], s[4 * k0 + 1], s[4 * k0 + 2], s[4 * k0 + 3]];
    let tail = keys[k0][1];
    for (;;) {
      const k = takeNext(tail);
      if (k < 0) break;
      live[k] = 0;
      const fwd = keys[k][0] === tail;
      pts.push(fwd ? s[4 * k + 2] : s[4 * k], fwd ? s[4 * k + 3] : s[4 * k + 1]);
      tail = fwd ? keys[k][1] : keys[k][0];
    }
    let head = keys[k0][0];
    const front = [];
    for (;;) {
      const k = takeNext(head);
      if (k < 0) break;
      live[k] = 0;
      const fwd = keys[k][1] === head;
      front.push(fwd ? s[4 * k] : s[4 * k + 2], fwd ? s[4 * k + 1] : s[4 * k + 3]);
      head = fwd ? keys[k][0] : keys[k][1];
    }
    const rev = [];
    for (let i = front.length - 2; i >= 0; i -= 2) rev.push(front[i], front[i + 1]);
    out.push(Float64Array.from([...rev, ...pts]));
  }
  return out;
}
