// Discrete wavelet transform with periodic extension.
//
// One level (N = signal length, must be even; L = filter length; indices mod N):
//   approx[n] = sum_k dec_lo[k] x[2n + 1 - k]        detail[n] = sum_k dec_hi[k] x[2n + 1 - k]
//   x[m]      = sum_n approx[n] rec_lo[j] + detail[n] rec_hi[j],   j = m + L - 2 - 2n   (0 <= j < L)
// i.e. filter-and-decimate analysis, upsample-and-filter synthesis. For the families in
// families.js this reconstructs the input exactly (up to rounding), orthogonal or biorthogonal.
import { getFamily } from './families.js';

const resolve = (family) => (typeof family === 'string' ? getFamily(family) : family);

const mod = (i, n) => ((i % n) + n) % n;

function analyse(x, f, N) {
  const L = f.length;
  const half = N / 2;
  const approx = new Float64Array(half);
  const detail = new Float64Array(half);
  for (let n = 0; n < half; n++) {
    let a = 0;
    let d = 0;
    for (let k = 0; k < L; k++) {
      const v = x[mod(2 * n + 1 - k, N)];
      a += f.dec_lo[k] * v;
      d += f.dec_hi[k] * v;
    }
    approx[n] = a;
    detail[n] = d;
  }
  return { approx, detail };
}

/** One-level DWT of an even-length signal (periodic extension). `family` is a family object or id. */
export function dwt(signal, family) {
  const f = resolve(family);
  const N = signal.length;
  if (N < 2 || N % 2) throw new RangeError('dwt needs an even signal length');
  return analyse(signal, f, N);
}

/** Inverse of dwt(): returns a Float64Array of length 2 * approx.length. */
export function idwt(approx, detail, family) {
  const f = resolve(family);
  const half = approx.length;
  const N = 2 * half;
  const L = f.length;
  const x = new Float64Array(N);
  for (let n = 0; n < half; n++) {
    const a = approx[n];
    const d = detail[n];
    for (let j = 0; j < L; j++) {
      x[mod(2 * n + 2 - L + j, N)] += a * f.rec_lo[j] + d * f.rec_hi[j];
    }
  }
  return x;
}

/**
 * Multi-level decomposition: { approx, details: [d_1 (finest), ..., d_level] }.
 * Signal length must be divisible by 2^level.
 */
export function wavedec(signal, family, level) {
  const f = resolve(family);
  if (!(level >= 0) || signal.length % 2 ** level !== 0) {
    throw new RangeError(`signal length ${signal.length} is not divisible by 2^${level}`);
  }
  let cur = Float64Array.from(signal);
  const details = [];
  for (let l = 0; l < level; l++) {
    const { approx, detail } = analyse(cur, f, cur.length);
    details.push(detail);
    cur = approx;
  }
  return { approx: cur, details };
}

/** Inverse of wavedec(). */
export function waverec(dec, family) {
  const f = resolve(family);
  let cur = dec.approx;
  for (let l = dec.details.length - 1; l >= 0; l--) cur = idwt(cur, dec.details[l], f);
  return Float64Array.from(cur);
}

/**
 * Keep the k coefficients of largest magnitude (across approx and all details) and zero the rest.
 * Returns a new decomposition; ties are broken in favour of the coarsest coefficients.
 */
export function keepLargest(dec, k) {
  const arrays = [dec.approx, ...dec.details.slice().reverse()]; // coarse -> fine
  const entries = [];
  arrays.forEach((arr, a) => arr.forEach((v, i) => entries.push({ a, i, m: Math.abs(v) })));
  const keep = Math.max(0, Math.min(Math.floor(k), entries.length));
  entries.sort((p, q) => q.m - p.m || p.a - q.a || p.i - q.i);
  const out = arrays.map((arr) => new Float64Array(arr.length));
  for (let e = 0; e < keep; e++) out[entries[e].a][entries[e].i] = arrays[entries[e].a][entries[e].i];
  const approx = out[0];
  const details = out.slice(1).reverse();
  return { approx, details };
}

/**
 * Wavelet approximation of f on [x0, x1]: sample f at `samples` equispaced points (endpoints
 * included; samples is rounded down to a multiple of 2^level), decompose, optionally keep only the
 * `keep` largest coefficients, reconstruct. Returns { x, y, evalReal(x) (linear interpolation,
 * clamped outside [x0, x1]), keptCount, totalCount, dec }.
 */
export function waveletApprox(f, { family, level, x0, x1, samples = 1024, keep = null }) {
  const fam = resolve(family);
  let lev = level === undefined ? 4 : level;
  let n = samples;
  while (lev > 0 && n / 2 ** lev < 2) lev--; // keep at least two samples at the coarsest scale
  const unit = 2 ** lev;
  n = Math.max(unit * 2, Math.floor(n / unit) * unit);
  const x = new Float64Array(n);
  const y0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = x0 + ((x1 - x0) * i) / (n - 1);
    y0[i] = f(x[i]);
  }
  let dec = wavedec(y0, fam, lev);
  const totalCount = n;
  let keptCount = totalCount;
  if (keep !== null && keep !== undefined) {
    keptCount = Math.max(0, Math.min(Math.floor(keep), totalCount));
    dec = keepLargest(dec, keptCount);
  }
  const y = waverec(dec, fam);
  const evalReal = (t) => {
    if (!(t > x[0])) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    const u = ((t - x[0]) / (x[n - 1] - x[0])) * (n - 1);
    const i = Math.min(n - 2, Math.floor(u));
    const w = u - i;
    return y[i] * (1 - w) + y[i + 1] * w;
  };
  return { x, y, evalReal, keptCount, totalCount, dec };
}

/**
 * Cascade algorithm for drawing the scaling function and mother wavelet of a family.
 * Returns { x, phi, psi } (equal-length Float64Arrays on the dyadic grid x = m / 2^iterations,
 * support [0, L - 1]). By default the synthesis (reconstruction) functions are produced:
 *   phi(t) = sqrt2 sum_k rec_lo[k] phi(2t - k),   psi(t) = sqrt2 sum_k rec_hi[k] phi(2t - k).
 * With { kind: 'dec' } the analysis functions are produced (same recursion with the time-reversed
 * decomposition filters), which differ from the synthesis ones only for biorthogonal families.
 */
export function waveletFunction(family, { iterations = 8, kind = 'rec' } = {}) {
  const f = resolve(family);
  const J = Math.max(1, Math.floor(iterations));
  const L = f.length;
  const h = kind === 'dec' ? Array.from(f.dec_lo).reverse() : Array.from(f.rec_lo);
  const g = kind === 'dec' ? Array.from(f.dec_hi).reverse() : Array.from(f.rec_hi);
  const phi0 = integerValues(h) || deltaStart(h);
  // Dyadic refinement: phi(q / 2^(j+1)) = sqrt2 sum_m h_m phi((q - m 2^j) / 2^j) for odd q.
  const refine = (prev, j) => {
    const next = new Float64Array((L - 1) * 2 ** (j + 1) + 1);
    for (let q = 0; q < next.length; q++) {
      if (q % 2 === 0) { next[q] = prev[q / 2]; continue; }
      let s = 0;
      for (let m = 0; m < L; m++) {
        const p = q - m * 2 ** j;
        if (p >= 0 && p < prev.length) s += h[m] * prev[p];
      }
      next[q] = SQRT2 * s;
    }
    return next;
  };
  let coarse = phi0;
  for (let j = 0; j < J - 1; j++) coarse = refine(coarse, j); // phi on grid 2^-(J-1)
  const phi = refine(coarse, J - 1); // grid 2^-J
  const size = phi.length;
  const psi = new Float64Array(size);
  for (let m = 0; m < size; m++) {
    let s = 0;
    for (let k = 0; k < L; k++) {
      const p = m - k * 2 ** (J - 1);
      if (p >= 0 && p < coarse.length) s += g[k] * coarse[p];
    }
    psi[m] = SQRT2 * s;
  }
  const x = new Float64Array(size);
  for (let m = 0; m < size; m++) x[m] = m / 2 ** J;
  return { x, phi, psi };
}

/**
 * phi at the integers 0..L-1: the eigenvector of M[i][j] = sqrt2 h[2i - j] for eigenvalue 1 with
 * sum 1. Returns null if that eigenvector is not unique (e.g. Haar, where phi jumps at the integers).
 */
function integerValues(h) {
  const L = h.length;
  const A = Array.from({ length: L }, (_, i) => {
    const row = Array.from({ length: L }, (_, j) => {
      const idx = 2 * i - j;
      return (idx >= 0 && idx < L ? SQRT2 * h[idx] : 0) - (i === j ? 1 : 0);
    });
    return i === L - 1 ? [...row.map(() => 1), 1] : [...row, 0];
  });
  for (let c = 0; c < L; c++) {
    let p = c;
    for (let r = c + 1; r < L; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < L; r++) {
      const m = A[r][c] / A[c][c];
      for (let k = c; k <= L; k++) A[r][k] -= m * A[c][k];
    }
  }
  const x = new Float64Array(L);
  for (let r = L - 1; r >= 0; r--) {
    let s = A[r][L];
    for (let c = r + 1; c < L; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Fallback start (Haar-like cases): phi(k) = 1 at k = 0 and 0 elsewhere. */
function deltaStart(h) {
  const v = new Float64Array(h.length);
  v[0] = 1;
  return v;
}

const SQRT2 = Math.SQRT2;
