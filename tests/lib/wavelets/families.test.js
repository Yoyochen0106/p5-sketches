import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, getFamily } from '../../../lib/wavelets/families.js';
import { close } from '../helpers.js';

const SQRT2 = Math.SQRT2;
const BIOR = ['1.1', '1.3', '1.5', '2.2', '2.4', '2.6', '2.8', '3.1', '3.3', '3.5', '3.7', '3.9', '4.4', '5.5', '6.8'];
const REQUIRED = [
  'haar', 'db1',
  ...Array.from({ length: 9 }, (_, i) => `db${i + 2}`),
  ...Array.from({ length: 9 }, (_, i) => `sym${i + 2}`),
  ...Array.from({ length: 5 }, (_, i) => `coif${i + 1}`),
  ...BIOR.map((b) => `bior${b}`), ...BIOR.map((b) => `rbio${b}`),
];

const sum = (a) => a.reduce((s, v) => s + v, 0);
/** sum_k (-1)^k k^p f[k], scaled by centred index, relative to sum |terms| */
function altMoment(f, p) {
  const L = f.length;
  let s = 0;
  let ref = 0;
  for (let k = 0; k < L; k++) {
    const t = (k % 2 ? -1 : 1) * ((k - (L - 1) / 2) / L) ** p * f[k];
    s += t; ref += Math.abs(t);
  }
  return Math.abs(s) / Math.max(ref, 1e-300);
}
const moment = (f, p) => {
  // moment sum_k (k - c)^p f[k] relative to sum |terms|; centre c = L/2 keeps the numbers tame
  const L = f.length;
  let s = 0, ref = 0;
  for (let k = 0; k < L; k++) { const t = ((k - L / 2) / L) ** p * f[k]; s += t; ref += Math.abs(t); }
  return Math.abs(s) / ref;
};
/** Full (non-relative) alternating moment for moment-count detection: |sum (-1)^k k^p f[k]| / sum |k^p f[k]|. */
const orthoCorr = (h, m) => {
  let s = 0;
  for (let k = 0; k + 2 * m < h.length; k++) s += h[k] * h[k + 2 * m];
  return s;
};
function conv(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => { r[i + j] += x * y; }));
  return r;
}

test('all required ids exist; ids unique; aliases', () => {
  for (const id of REQUIRED) assert.ok(getFamily(id), `missing ${id}`);
  assert.equal(getFamily('db1'), getFamily('haar'));
  assert.equal(getFamily('nope'), undefined);
  const ids = FAMILIES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of FAMILIES) {
    assert.ok(['orthogonal', 'biorthogonal'].includes(f.kind), f.id);
    assert.equal(typeof f.name, 'string');
    assert.ok(Number.isInteger(f.order) && f.order >= 1);
    assert.ok(Number.isInteger(f.vanishingMoments) && f.vanishingMoments >= 1);
    for (const k of ['dec_lo', 'dec_hi', 'rec_lo', 'rec_hi']) {
      assert.ok(f[k] instanceof Float64Array, `${f.id}.${k}`);
      assert.equal(f[k].length, f.dec_lo.length);
      assert.ok(f[k].every(Number.isFinite));
    }
  }
});

test('every family: lowpass sums are sqrt(2), highpass sums are 0', () => {
  for (const f of FAMILIES) {
    close(sum(f.rec_lo), SQRT2, 1e-13, `${f.id} rec_lo`);
    close(sum(f.dec_lo), SQRT2, 1e-13, `${f.id} dec_lo`);
    assert.ok(Math.abs(sum(f.rec_hi)) < 1e-12, `${f.id} rec_hi sum`);
    assert.ok(Math.abs(sum(f.dec_hi)) < 1e-12, `${f.id} dec_hi sum`);
  }
});

test('orthogonal families: double-shift orthonormality and QMF relations', () => {
  for (const f of FAMILIES.filter((g) => g.kind === 'orthogonal')) {
    const h = Array.from(f.rec_lo);
    const L = h.length;
    close(orthoCorr(h, 0), 1, 1e-13, `${f.id} norm`);
    for (let m = 1; m < L / 2; m++) assert.ok(Math.abs(orthoCorr(h, m)) < 1e-13, `${f.id} shift ${m}: ${orthoCorr(h, m)}`);
    // highpass orthogonal to lowpass at all even shifts, and orthonormal itself
    const g = Array.from(f.rec_hi);
    close(orthoCorr(g, 0), 1, 1e-13, `${f.id} hi norm`);
    for (let m = -L / 2 + 1; m < L / 2; m++) {
      let s = 0;
      for (let k = 0; k < L; k++) { const j = k + 2 * m; if (j >= 0 && j < L) s += h[k] * g[j]; }
      assert.ok(Math.abs(s) < 1e-13, `${f.id} lo-hi shift ${m}`);
    }
    // decomposition filters are the time reversal of reconstruction filters
    assert.deepEqual(Array.from(f.dec_lo), h.slice().reverse());
    assert.deepEqual(Array.from(f.dec_hi), g.slice().reverse());
    assert.equal(f.length, L);
    assert.equal(f.vanishingMomentsRec, f.vanishingMoments);
  }
});

test('biorthogonal families: rec_lo * dec_lo is half-band (centre 1 at index L-1, zero at other odd lags)', () => {
  for (const f of FAMILIES.filter((g) => g.kind === 'biorthogonal')) {
    const L = f.length;
    const p = conv(Array.from(f.rec_lo), Array.from(f.dec_lo));
    close(p[L - 1], 1, 1e-12, `${f.id} centre`);
    p.forEach((v, j) => {
      if (j !== L - 1 && (j - (L - 1)) % 2 === 0) assert.ok(Math.abs(v) < 1e-11, `${f.id} p[${j}]=${v}`);
    });
    // linear phase: lowpass filters are symmetric about their centre
    // trim zero padding before testing symmetry
    const trim = (a) => {
      const arr = Array.from(a);
      while (arr.length && Math.abs(arr[0]) < 1e-15) arr.shift();
      while (arr.length && Math.abs(arr[arr.length - 1]) < 1e-15) arr.pop();
      return arr;
    };
    for (const a of [f.rec_lo, f.dec_lo]) {
      const t = trim(a);
      assert.ok(t.every((v, k) => Math.abs(v - t[t.length - 1 - k]) < 1e-12), `${f.id} symmetric`);
    }
  }
});

test('vanishing moments of the analysis (dec_hi) and synthesis (rec_hi) wavelets', () => {
  for (const f of FAMILIES) {
    const L = f.length;
    // centred, scaled moments sum_k ((k - c)/L)^p g[k], relative to sum |terms|
    const centred = (g, p) => {
      let s = 0, ref = 0;
      for (let k = 0; k < L; k++) { const w = ((k - (L - 1) / 2) / L) ** p * g[k]; s += w; ref += Math.abs(w); }
      return Math.abs(s) / Math.max(ref, 1e-300);
    };
    for (let p = 0; p < f.vanishingMoments; p++) assert.ok(centred(f.dec_hi, p) < 1e-8, `${f.id} dec_hi moment ${p}: ${centred(f.dec_hi, p)}`);
    for (let p = 0; p < f.vanishingMomentsRec; p++) assert.ok(centred(f.rec_hi, p) < 1e-8, `${f.id} rec_hi moment ${p}`);
    // the first non-vanishing moment is genuinely non-zero (the count is exact)
    assert.ok(centred(f.dec_hi, f.vanishingMoments) > 1e-6, `${f.id} dec_hi has more moments than claimed`);
    assert.ok(centred(f.rec_hi, f.vanishingMomentsRec) > 1e-6, `${f.id} rec_hi has more moments than claimed`);
  }
  assert.equal(getFamily('bior1.3').vanishingMoments, 1);
  assert.equal(getFamily('bior1.3').vanishingMomentsRec, 3);
  assert.equal(getFamily('rbio1.3').vanishingMoments, 3);
  assert.equal(getFamily('db7').vanishingMoments, 7);
  assert.equal(getFamily('coif3').vanishingMoments, 6);
  assert.equal(getFamily('db7').rec_lo.length, 14);
  assert.equal(getFamily('coif3').rec_lo.length, 18);
});

test('known filter values', () => {
  const s3 = Math.sqrt(3);
  const k = 4 * SQRT2;
  const db2 = getFamily('db2').rec_lo;
  [(1 + s3) / k, (3 + s3) / k, (3 - s3) / k, (1 - s3) / k].forEach((v, i) => close(db2[i], v, 1e-14));
  close(getFamily('db3').rec_lo[0], 0.3326705529500825, 1e-13);
  close(getFamily('db4').rec_lo[0], 0.2303778133088964, 1e-13);
  close(getFamily('db10').rec_lo[0], 0.0266700579005473, 1e-12);
  [0.0322231006040782, -0.0126039672622612, -0.0992195435769354, 0.2978577956055422, 0.8037387518052163,
    0.4976186676324578, -0.0296355276459541, -0.0757657147893407]
    .forEach((v, i) => close(getFamily('sym4').rec_lo[i], v, 1e-12, `sym4[${i}]`));
  assert.deepEqual(Array.from(getFamily('sym2').rec_lo), Array.from(getFamily('db2').rec_lo));
  assert.deepEqual(Array.from(getFamily('haar').rec_lo), [Math.SQRT1_2, Math.SQRT1_2]);
  const s7 = Math.sqrt(7);
  const c1 = [(1 - s7), (5 + s7), (14 + 2 * s7), (14 - 2 * s7), (1 - s7), (-3 + s7)].map((v) => v / (16 * SQRT2));
  getFamily('coif1').dec_lo.forEach((v, i) => close(v, c1[i], 1e-14, `coif1[${i}]`));
  const b13 = [-1, 1, 8, 8, 1, -1].map((v) => v / (8 * SQRT2));
  getFamily('bior1.3').dec_lo.forEach((v, i) => close(v, b13[i], 1e-14));
  Array.from(getFamily('bior1.3').rec_lo).forEach((v, i) => close(v, [0, 0, Math.SQRT1_2, Math.SQRT1_2, 0, 0][i], 1e-14));
  const b22 = [0, -0.125, 0.25, 0.75, 0.25, -0.125].map((v) => v * SQRT2);
  getFamily('bior2.2').dec_lo.forEach((v, i) => close(v, b22[i], 1e-14));
  // CDF 9/7 (bior4.4): analysis lowpass peak 0.852698679009, synthesis lowpass peak 0.788485616406
  close(Math.max(...getFamily('bior4.4').dec_lo), 0.8526986790094033, 1e-9);
  close(Math.max(...getFamily('bior4.4').rec_lo), 0.7884856164056651, 1e-9);
  // rbio swaps roles
  assert.deepEqual(Array.from(getFamily('rbio2.2').dec_lo), Array.from(getFamily('bior2.2').rec_lo));
  assert.deepEqual(Array.from(getFamily('rbio2.2').rec_lo), Array.from(getFamily('bior2.2').dec_lo));
});

test('coiflets: scaling-function moments vanish about the filter centre (Coifman condition)', () => {
  for (let N = 1; N <= 5; N++) {
    const f = getFamily(`coif${N}`);
    const h = f.rec_lo;
    const k0 = 4 * N - 1; // centre of mass of rec_lo
    close(sum(h.map((v, k) => k * v)) / sum(h), k0, 1e-12, `coif${N} centroid`);
    for (let p = 1; p < 2 * N; p++) {
      let s = 0;
      for (let k = 0; k < h.length; k++) s += ((k - k0) / h.length) ** p * h[k];
      assert.ok(Math.abs(s) < 1e-13, `coif${N} scaling moment ${p}: ${s}`);
    }
    // the (2N)-th vanishes too (by the symmetry of the construction); the (2N+1)-th does not
    let s = 0;
    for (let k = 0; k < h.length; k++) s += (k - k0) ** (2 * N + 1) * h[k];
    assert.ok(Math.abs(s) > 1e-2, `coif${N}`);
  }
});

test('symlets are more symmetric than Daubechies filters (flatter group delay), sym2/sym3 equal db2/db3', () => {
  const delayRange = (h) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 1; i <= 90; i++) {
      const w = (Math.PI * 0.8 * i) / 90; // passband region
      let nr = 0, ni = 0, dr = 0, di = 0;
      h.forEach((v, k) => {
        nr += k * v * Math.cos(k * w); ni -= k * v * Math.sin(k * w);
        dr += v * Math.cos(k * w); di -= v * Math.sin(k * w);
      });
      const tau = (nr * dr + ni * di) / (dr * dr + di * di);
      lo = Math.min(lo, tau); hi = Math.max(hi, tau);
    }
    return hi - lo;
  };
  for (let N = 4; N <= 10; N++) {
    const d = delayRange(getFamily(`db${N}`).rec_lo);
    const s = delayRange(getFamily(`sym${N}`).rec_lo);
    assert.ok(s < d * 0.5, `sym${N} delay range ${s} vs db${N} ${d}`);
  }
  for (const N of [2, 3]) {
    assert.deepEqual(Array.from(getFamily(`sym${N}`).rec_lo), Array.from(getFamily(`db${N}`).rec_lo));
  }
});

test('Daubechies filters are minimum phase (energy at the front)', () => {
  for (let N = 2; N <= 10; N++) {
    const h = getFamily(`db${N}`).rec_lo;
    let first = 0, second = 0;
    for (let k = 0; k < h.length; k++) (k < N ? (first += h[k] ** 2) : (second += h[k] ** 2));
    assert.ok(first > second, `db${N}`);
  }
});

test('helper sanity (moment functions detect a bad filter)', () => {
  const bad = [0.5, 0.5, 0.5, 0.5];
  assert.ok(altMoment(bad, 0) < 1e-12); // (1,-1,1,-1) sums to zero...
  assert.ok(altMoment(bad, 1) > 1e-3); // ...but the first moment does not vanish
  assert.ok(moment(bad, 1) >= 0);
});
