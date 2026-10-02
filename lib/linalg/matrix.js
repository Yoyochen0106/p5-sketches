/**
 * Dense matrix types for the linear-algebra library.
 *
 * CANONICAL TYPE: `Matrix` = { rows, cols, data: Float64Array } stored row-major.
 * Nested arrays ([[1,2],[3,4]]) are accepted by every public function (via `asMatrix`)
 * and are produced by `Matrix#toArray()`. Plain vectors are `number[]` (or Float64Array);
 * functions that return vectors return plain `number[]`.
 *
 * Complex values are `[re, im]` pairs (see lib/complex.js). Complex matrices use `CMatrix`
 * (separate `re` / `im` Float64Arrays) and appear only where stated (eigenvectors, funm).
 */

const isNum = (x) => typeof x === 'number';

export class Matrix {
  /** @param {number} rows @param {number} cols @param {ArrayLike<number>} [data] row-major, copied if not a Float64Array */
  constructor(rows, cols, data) {
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 0 || cols < 0) throw new RangeError('Matrix: bad shape');
    this.rows = rows;
    this.cols = cols;
    if (data === undefined) this.data = new Float64Array(rows * cols);
    else {
      if (data.length !== rows * cols) throw new RangeError(`Matrix: data length ${data.length} != ${rows}x${cols}`);
      this.data = data instanceof Float64Array ? data : Float64Array.from(data);
    }
  }

  /** Build from nested arrays (or copy a Matrix). All rows must have equal length. */
  static from(a) {
    if (a instanceof Matrix) return a.clone();
    if (!Array.isArray(a) || (a.length > 0 && !Array.isArray(a[0]) && !ArrayBuffer.isView(a[0]))) {
      throw new TypeError('Matrix.from expects nested arrays; use Matrix.column / Matrix.row for vectors');
    }
    const rows = a.length, cols = rows ? a[0].length : 0;
    const m = new Matrix(rows, cols);
    for (let i = 0; i < rows; i++) {
      if (a[i].length !== cols) throw new RangeError('Matrix.from: ragged rows');
      for (let j = 0; j < cols; j++) m.data[i * cols + j] = a[i][j];
    }
    return m;
  }
  static zeros(rows, cols = rows) { return new Matrix(rows, cols); }
  static ones(rows, cols = rows) { return new Matrix(rows, cols, new Float64Array(rows * cols).fill(1)); }
  static identity(n) { const m = new Matrix(n, n); for (let i = 0; i < n; i++) m.data[i * n + i] = 1; return m; }
  /** Diagonal matrix from a vector (rectangular if rows/cols are given). */
  static diag(v, rows = v.length, cols = rows) {
    const m = new Matrix(rows, cols);
    for (let i = 0; i < Math.min(v.length, rows, cols); i++) m.data[i * cols + i] = v[i];
    return m;
  }
  /** n x 1 column vector. */
  static column(v) { return new Matrix(v.length, 1, Float64Array.from(v)); }
  /** 1 x n row vector. */
  static row(v) { return new Matrix(1, v.length, Float64Array.from(v)); }
  /** Matrix with entries f(i, j). */
  static fromFunction(rows, cols, f) {
    const m = new Matrix(rows, cols);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) m.data[i * cols + j] = f(i, j);
    return m;
  }
  /** Pseudo-random matrix with entries in [-1,1); `rand` returns numbers in [0,1) (default Math.random). */
  static random(rows, cols = rows, rand = Math.random) {
    return Matrix.fromFunction(rows, cols, () => 2 * rand() - 1);
  }
  /** Parse the deep-link format "a,b;c,d" (row-major, ';' between rows). Returns null if malformed. */
  static parse(str) {
    if (typeof str !== 'string' || !str.trim()) return null;
    const rows = str.split(';').map((r) => r.split(',').map((t) => (t.trim() === '' ? NaN : Number(t.trim()))));
    const cols = rows[0].length;
    for (const r of rows) if (r.length !== cols || r.some((v) => !Number.isFinite(v))) return null;
    return Matrix.from(rows);
  }
  /** Inverse of `parse`; numbers are printed with up to `digits` significant digits. */
  toString(digits = 6) {
    const out = [];
    for (let i = 0; i < this.rows; i++) {
      const r = [];
      for (let j = 0; j < this.cols; j++) r.push(String(+this.data[i * this.cols + j].toPrecision(digits)));
      out.push(r.join(','));
    }
    return out.join(';');
  }

  get(i, j) { return this.data[i * this.cols + j]; }
  set(i, j, v) { this.data[i * this.cols + j] = v; return this; }
  clone() { return new Matrix(this.rows, this.cols, this.data.slice()); }
  get isSquare() { return this.rows === this.cols; }
  /** Nested array copy. */
  toArray() {
    const out = [];
    for (let i = 0; i < this.rows; i++) out.push(Array.from(this.data.subarray(i * this.cols, (i + 1) * this.cols)));
    return out;
  }
  rowVec(i) { return Array.from(this.data.subarray(i * this.cols, (i + 1) * this.cols)); }
  colVec(j) { const o = new Array(this.rows); for (let i = 0; i < this.rows; i++) o[i] = this.data[i * this.cols + j]; return o; }
  diagVec() { const n = Math.min(this.rows, this.cols); const o = new Array(n); for (let i = 0; i < n; i++) o[i] = this.data[i * this.cols + i]; return o; }
  /** Sub-block rows [r0,r1) x cols [c0,c1). */
  block(r0, r1, c0, c1) {
    const m = new Matrix(r1 - r0, c1 - c0);
    for (let i = r0; i < r1; i++) for (let j = c0; j < c1; j++) m.data[(i - r0) * m.cols + (j - c0)] = this.data[i * this.cols + j];
    return m;
  }
  /** Copy of this matrix with `B` pasted at (r0, c0). */
  withBlock(r0, c0, B) {
    const m = this.clone();
    for (let i = 0; i < B.rows; i++) for (let j = 0; j < B.cols; j++) m.data[(r0 + i) * m.cols + c0 + j] = B.data[i * B.cols + j];
    return m;
  }
  /** Selected columns as a new matrix. */
  selectCols(idx) { return Matrix.fromFunction(this.rows, idx.length, (i, j) => this.data[i * this.cols + idx[j]]); }

  transpose() {
    const m = new Matrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) m.data[j * this.rows + i] = this.data[i * this.cols + j];
    return m;
  }
  get T() { return this.transpose(); }
  add(B) { return zip(this, asMatrix(B), (a, b) => a + b); }
  sub(B) { return zip(this, asMatrix(B), (a, b) => a - b); }
  scale(s) { const m = this.clone(); for (let i = 0; i < m.data.length; i++) m.data[i] *= s; return m; }
  neg() { return this.scale(-1); }
  mul(B) {
    B = asMatrix(B);
    if (this.cols !== B.rows) throw new RangeError(`mul: ${this.rows}x${this.cols} * ${B.rows}x${B.cols}`);
    const n = this.rows, k = this.cols, p = B.cols, out = new Matrix(n, p), a = this.data, b = B.data, c = out.data;
    for (let i = 0; i < n; i++) {
      for (let l = 0; l < k; l++) {
        const v = a[i * k + l];
        if (v === 0) continue;
        for (let j = 0; j < p; j++) c[i * p + j] += v * b[l * p + j];
      }
    }
    return out;
  }
  /** Matrix-vector product; returns number[]. */
  matvec(v) {
    if (v.length !== this.cols) throw new RangeError('matvec: length mismatch');
    const out = new Array(this.rows);
    for (let i = 0; i < this.rows; i++) {
      let s = 0;
      for (let j = 0; j < this.cols; j++) s += this.data[i * this.cols + j] * v[j];
      out[i] = s;
    }
    return out;
  }
  trace() { let s = 0; for (let i = 0; i < Math.min(this.rows, this.cols); i++) s += this.data[i * this.cols + i]; return s; }
  /** Max column sum. */
  norm1() { let m = 0; for (let j = 0; j < this.cols; j++) { let s = 0; for (let i = 0; i < this.rows; i++) s += Math.abs(this.data[i * this.cols + j]); m = Math.max(m, s); } return m; }
  /** Max row sum. */
  normInf() { let m = 0; for (let i = 0; i < this.rows; i++) { let s = 0; for (let j = 0; j < this.cols; j++) s += Math.abs(this.data[i * this.cols + j]); m = Math.max(m, s); } return m; }
  normFro() { let s = 0; for (let i = 0; i < this.data.length; i++) s += this.data[i] * this.data[i]; return Math.sqrt(s); }
  maxAbs() { let m = 0; for (let i = 0; i < this.data.length; i++) m = Math.max(m, Math.abs(this.data[i])); return m; }
  isSymmetric(tol = 1e-12) {
    if (!this.isSquare) return false;
    const s = Math.max(1, this.maxAbs());
    for (let i = 0; i < this.rows; i++) for (let j = i + 1; j < this.cols; j++) if (Math.abs(this.data[i * this.cols + j] - this.data[j * this.cols + i]) > tol * s) return false;
    return true;
  }
  /** (A + A^T) / 2 */
  symmetrized() { return this.add(this.transpose()).scale(0.5); }
  isFinite() { for (let i = 0; i < this.data.length; i++) if (!Number.isFinite(this.data[i])) return false; return true; }
}

function zip(A, B, f) {
  if (A.rows !== B.rows || A.cols !== B.cols) throw new RangeError(`shape mismatch ${A.rows}x${A.cols} vs ${B.rows}x${B.cols}`);
  const m = new Matrix(A.rows, A.cols);
  for (let i = 0; i < m.data.length; i++) m.data[i] = f(A.data[i], B.data[i]);
  return m;
}

/** Coerce a Matrix or nested array into a Matrix (Matrix instances are returned as-is, NOT copied). */
export function asMatrix(x) { return x instanceof Matrix ? x : Matrix.from(x); }
/** Coerce a vector-like (array / typed array / n x 1 or 1 x n Matrix) into a number[]. */
export function asVec(x) {
  if (x instanceof Matrix) {
    if (x.cols !== 1 && x.rows !== 1) throw new RangeError('asVec: not a vector');
    return Array.from(x.data);
  }
  return Array.from(x);
}
export const isMatrixLike = (x) => x instanceof Matrix || (Array.isArray(x) && x.length > 0 && !isNum(x[0]));

// Free-function API (accept nested arrays too).
export const add = (A, B) => asMatrix(A).add(B);
export const sub = (A, B) => asMatrix(A).sub(B);
export const mul = (A, B) => asMatrix(A).mul(B);
export const scale = (A, s) => asMatrix(A).scale(s);
export const transpose = (A) => asMatrix(A).transpose();
export const trace = (A) => asMatrix(A).trace();
export const matvec = (A, v) => asMatrix(A).matvec(asVec(v));
export const identity = (n) => Matrix.identity(n);
export const zeros = (r, c) => Matrix.zeros(r, c);
export const diag = (v, r, c) => Matrix.diag(v, r, c);
export const norm1 = (A) => asMatrix(A).norm1();
export const normInf = (A) => asMatrix(A).normInf();
export const normFro = (A) => asMatrix(A).normFro();

/** Vector helpers (number[]). */
export const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
export const norm2 = (a) => Math.sqrt(dot(a, a));
export const vecSub = (a, b) => Array.from(a, (v, i) => v - b[i]);
export const vecAdd = (a, b) => Array.from(a, (v, i) => v + b[i]);
export const vecScale = (a, s) => Array.from(a, (v) => v * s);

/** Horizontal concatenation [A B]. */
export function hcat(...Ms) {
  Ms = Ms.map(asMatrix);
  const r = Ms[0].rows, c = Ms.reduce((s, m) => s + m.cols, 0), out = new Matrix(r, c);
  let off = 0;
  for (const m of Ms) {
    if (m.rows !== r) throw new RangeError('hcat: row mismatch');
    for (let i = 0; i < r; i++) for (let j = 0; j < m.cols; j++) out.data[i * c + off + j] = m.data[i * m.cols + j];
    off += m.cols;
  }
  return out;
}
/** Vertical concatenation [A; B]. */
export function vcat(...Ms) {
  Ms = Ms.map(asMatrix);
  const c = Ms[0].cols, r = Ms.reduce((s, m) => s + m.rows, 0), out = new Matrix(r, c);
  let off = 0;
  for (const m of Ms) { if (m.cols !== c) throw new RangeError('vcat: col mismatch'); out.data.set(m.data, off * c); off += m.rows; }
  return out;
}
/** Block matrix from a 2D array of blocks. */
export function blocks(rowsOfBlocks) { return vcat(...rowsOfBlocks.map((r) => hcat(...r))); }
/** Kronecker product. */
export function kron(A, B) {
  A = asMatrix(A); B = asMatrix(B);
  const out = new Matrix(A.rows * B.rows, A.cols * B.cols);
  for (let i = 0; i < A.rows; i++) for (let j = 0; j < A.cols; j++) {
    const a = A.data[i * A.cols + j];
    if (a === 0) continue;
    for (let k = 0; k < B.rows; k++) for (let l = 0; l < B.cols; l++) out.data[(i * B.rows + k) * out.cols + j * B.cols + l] = a * B.data[k * B.cols + l];
  }
  return out;
}

/** Max entrywise |A - B|, handy in tests and residual read-outs. */
export function maxDiff(A, B) {
  A = asMatrix(A); B = asMatrix(B);
  let m = 0;
  for (let i = 0; i < A.data.length; i++) m = Math.max(m, Math.abs(A.data[i] - B.data[i]));
  return m;
}

function swap(a, i, j) { const t = a[i]; a[i] = a[j]; a[j] = t; }

/**
 * Complex dense matrix: entry (i,j) = re[i*cols+j] + i*im[i*cols+j].
 * Used for eigenvectors and complex matrix functions.
 */
export class CMatrix {
  constructor(rows, cols, re, im) {
    this.rows = rows; this.cols = cols;
    this.re = re || new Float64Array(rows * cols);
    this.im = im || new Float64Array(rows * cols);
  }
  static fromReal(A) { A = asMatrix(A); return new CMatrix(A.rows, A.cols, A.data.slice(), new Float64Array(A.data.length)); }
  static identity(n) { const m = new CMatrix(n, n); for (let i = 0; i < n; i++) m.re[i * n + i] = 1; return m; }
  clone() { return new CMatrix(this.rows, this.cols, this.re.slice(), this.im.slice()); }
  get(i, j) { return [this.re[i * this.cols + j], this.im[i * this.cols + j]]; }
  set(i, j, z) { this.re[i * this.cols + j] = z[0]; this.im[i * this.cols + j] = z[1]; return this; }
  /** Column j as an array of [re, im]. */
  colVec(j) { const o = []; for (let i = 0; i < this.rows; i++) o.push(this.get(i, j)); return o; }
  realPart() { return new Matrix(this.rows, this.cols, this.re.slice()); }
  imagPart() { return new Matrix(this.rows, this.cols, this.im.slice()); }
  /** Largest |imag| entry (to check that a result is real). */
  maxImag() { let m = 0; for (let i = 0; i < this.im.length; i++) m = Math.max(m, Math.abs(this.im[i])); return m; }
  /** Nested array of [re, im] pairs. */
  toArray() { const o = []; for (let i = 0; i < this.rows; i++) { const r = []; for (let j = 0; j < this.cols; j++) r.push(this.get(i, j)); o.push(r); } return o; }
  conjTranspose() {
    const m = new CMatrix(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) {
      m.re[j * this.rows + i] = this.re[i * this.cols + j];
      m.im[j * this.rows + i] = -this.im[i * this.cols + j];
    }
    return m;
  }
  mul(B) {
    if (this.cols !== B.rows) throw new RangeError('CMatrix.mul: shape mismatch');
    const n = this.rows, k = this.cols, p = B.cols, out = new CMatrix(n, p);
    for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) {
      const ar = this.re[i * k + l], ai = this.im[i * k + l];
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < p; j++) {
        const br = B.re[l * p + j], bi = B.im[l * p + j];
        out.re[i * p + j] += ar * br - ai * bi;
        out.im[i * p + j] += ar * bi + ai * br;
      }
    }
    return out;
  }
  /** Solve this * X = B (Gaussian elimination, partial pivoting). Throws if singular. */
  solve(B) {
    const n = this.rows;
    if (n !== this.cols || B.rows !== n) throw new RangeError('CMatrix.solve: shape mismatch');
    const Ar = this.re.slice(), Ai = this.im.slice(), p = B.cols, Xr = B.re.slice(), Xi = B.im.slice();
    for (let k = 0; k < n; k++) {
      let piv = k, best = Math.hypot(Ar[k * n + k], Ai[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.hypot(Ar[i * n + k], Ai[i * n + k]); if (v > best) { best = v; piv = i; } }
      if (!(best > 0)) throw new Error('CMatrix.solve: singular matrix');
      if (piv !== k) {
        for (let j = 0; j < n; j++) { swap(Ar, k * n + j, piv * n + j); swap(Ai, k * n + j, piv * n + j); }
        for (let j = 0; j < p; j++) { swap(Xr, k * p + j, piv * p + j); swap(Xi, k * p + j, piv * p + j); }
      }
      const dr = Ar[k * n + k], di = Ai[k * n + k], dd = dr * dr + di * di;
      for (let i = k + 1; i < n; i++) {
        const er = Ar[i * n + k], ei = Ai[i * n + k];
        if (er === 0 && ei === 0) continue;
        const fr = (er * dr + ei * di) / dd, fi = (ei * dr - er * di) / dd;
        for (let j = k; j < n; j++) {
          const ur = Ar[k * n + j], ui = Ai[k * n + j];
          Ar[i * n + j] -= fr * ur - fi * ui; Ai[i * n + j] -= fr * ui + fi * ur;
        }
        for (let j = 0; j < p; j++) {
          const ur = Xr[k * p + j], ui = Xi[k * p + j];
          Xr[i * p + j] -= fr * ur - fi * ui; Xi[i * p + j] -= fr * ui + fi * ur;
        }
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const dr = Ar[k * n + k], di = Ai[k * n + k], dd = dr * dr + di * di;
      for (let j = 0; j < p; j++) {
        let sr = Xr[k * p + j], si = Xi[k * p + j];
        for (let l = k + 1; l < n; l++) {
          const ur = Ar[k * n + l], ui = Ai[k * n + l], xr = Xr[l * p + j], xi = Xi[l * p + j];
          sr -= ur * xr - ui * xi; si -= ur * xi + ui * xr;
        }
        Xr[k * p + j] = (sr * dr + si * di) / dd; Xi[k * p + j] = (si * dr - sr * di) / dd;
      }
    }
    return new CMatrix(n, p, Xr, Xi);
  }
  inverse() { return this.solve(CMatrix.identity(this.rows)); }
}
