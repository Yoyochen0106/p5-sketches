import test from 'node:test';
import assert from 'node:assert/strict';
import { dwt, idwt, wavedec, waverec, keepLargest, waveletApprox, waveletFunction } from '../../../lib/wavelets/dwt.js';
import { FAMILIES, getFamily } from '../../../lib/wavelets/families.js';
import { close, rng } from '../helpers.js';

const randomSignal = (n, seed) => {
  const r = rng(seed);
  return Float64Array.from({ length: n }, () => 2 * r() - 1);
};
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const energy = (a) => a.reduce((s, v) => s + v * v, 0);

test('one-level perfect reconstruction for every family (random signals, several lengths)', () => {
  for (const f of FAMILIES) {
    // include lengths shorter than the filter (periodic wrap-around)
    for (const n of [2, 4, 6, 16, 50, 128]) {
      const x = randomSignal(n, n * 31 + f.length);
      const { approx, detail } = dwt(x, f);
      assert.equal(approx.length, n / 2);
      assert.equal(detail.length, n / 2);
      const y = idwt(approx, detail, f);
      assert.equal(y.length, n);
      const tol = f.kind === 'orthogonal' ? 1e-9 : 1e-9;
      assert.ok(maxDiff(x, y) < tol, `${f.id} n=${n}: ${maxDiff(x, y)}`);
    }
  }
});

test('multi-level perfect reconstruction for every family, family given by id or object', () => {
  for (const f of FAMILIES) {
    const x = randomSignal(256, 7);
    for (const level of [1, 3, 6]) {
      const dec = wavedec(x, f, level);
      assert.equal(dec.details.length, level);
      assert.ok(maxDiff(x, waverec(dec, f)) < 1e-9, `${f.id} level ${level}`);
    }
    assert.ok(maxDiff(x, waverec(wavedec(x, f.id, 4), f.id)) < 1e-9);
  }
});

test('wavedec output shape: details finest first, approx at coarsest scale', () => {
  const dec = wavedec(randomSignal(64, 1), 'db2', 3);
  assert.deepEqual(dec.details.map((d) => d.length), [32, 16, 8]);
  assert.equal(dec.approx.length, 8);
  assert.equal(wavedec(randomSignal(8, 1), 'haar', 0).approx.length, 8);
  assert.throws(() => wavedec(randomSignal(24, 1), 'haar', 4), RangeError);
  assert.throws(() => dwt(randomSignal(7, 1), 'haar'), RangeError);
  assert.throws(() => dwt([], 'haar'), RangeError);
});

test('orthogonal families preserve energy (Parseval) and are orthogonal transforms', () => {
  for (const f of FAMILIES.filter((g) => g.kind === 'orthogonal')) {
    const x = randomSignal(128, 11);
    const dec = wavedec(x, f, 4);
    const e = energy(dec.approx) + dec.details.reduce((s, d) => s + energy(d), 0);
    close(e, energy(x), 1e-12, f.id);
  }
});

test('Haar transform has the textbook form', () => {
  const x = [1, 3, 5, 11, -2, 4, 0, 6];
  const { approx, detail } = dwt(x, 'haar');
  const s = Math.SQRT1_2;
  [(1 + 3) * s, (5 + 11) * s, (-2 + 4) * s, (0 + 6) * s].forEach((v, i) => close(approx[i], v, 1e-14));
  [(1 - 3) * s, (5 - 11) * s, (-2 - 4) * s, (0 - 6) * s].forEach((v, i) => close(detail[i], v, 1e-14));
  // constant signal: all detail coefficients vanish, approx = sqrt2 * c
  const c = dwt(new Float64Array(16).fill(3), 'db4');
  c.detail.forEach((v) => assert.ok(Math.abs(v) < 1e-13));
  c.approx.forEach((v) => close(v, 3 * Math.SQRT2, 1e-13));
});

test('vanishing moments: details of polynomials vanish away from the wrap-around', () => {
  const n = 64;
  for (const [id, deg] of [['db2', 1], ['db3', 2], ['db5', 4], ['sym4', 3], ['coif2', 3], ['bior2.2', 1], ['bior3.3', 2]]) {
    const f = getFamily(id);
    const x = Float64Array.from({ length: n }, (_, i) => ((i - 20) / 30) ** deg);
    const { detail } = dwt(x, f);
    // coefficients whose filter support does not touch the wrap-around
    const interior = Array.from(detail).slice(Math.ceil(f.length / 2) + 1, n / 2 - Math.ceil(f.length / 2) - 1);
    assert.ok(interior.length > 4);
    assert.ok(Math.max(...interior.map(Math.abs)) < 1e-10, `${id} deg ${deg}`);
  }
  // and a polynomial one degree higher does NOT vanish
  const x = Float64Array.from({ length: n }, (_, i) => ((i - 20) / 30) ** 2);
  const { detail } = dwt(x, 'db2');
  assert.ok(Math.max(...Array.from(detail).slice(5, 25).map(Math.abs)) > 1e-5);
});

test('shift covariance: shifting the input by 2 shifts the coefficients by 1', () => {
  const x = randomSignal(32, 5);
  const shifted = Float64Array.from({ length: 32 }, (_, i) => x[(i - 2 + 32) % 32]);
  const a = dwt(x, 'sym5');
  const b = dwt(shifted, 'sym5');
  for (let n = 0; n < 16; n++) {
    close(b.approx[n], a.approx[(n - 1 + 16) % 16], 1e-13);
    close(b.detail[n], a.detail[(n - 1 + 16) % 16], 1e-13);
  }
});

test('keepLargest keeps exactly the k largest magnitudes without mutating the input', () => {
  const dec = wavedec(randomSignal(64, 3), 'db3', 3);
  const all = [...dec.approx, ...dec.details.flatMap((d) => Array.from(d))];
  const before = JSON.stringify([Array.from(dec.approx), dec.details.map((d) => Array.from(d))]);
  for (const k of [0, 1, 5, 20, 64, 100]) {
    const kept = keepLargest(dec, k);
    const flat = [...kept.approx, ...kept.details.flatMap((d) => Array.from(d))];
    const nz = flat.filter((v) => v !== 0);
    assert.equal(nz.length, Math.min(k, 64));
    const sortedMags = all.map(Math.abs).sort((a, b) => b - a);
    const minKept = nz.length ? Math.min(...nz.map(Math.abs)) : Infinity;
    if (k > 0 && k < 64) assert.ok(minKept >= sortedMags[k - 1] - 1e-15);
    assert.deepEqual(kept.details.map((d) => d.length), dec.details.map((d) => d.length));
    // kept coefficients keep their positions and values
    kept.details.forEach((d, l) => d.forEach((v, i) => { if (v !== 0) assert.equal(v, dec.details[l][i]); }));
    kept.approx.forEach((v, i) => { if (v !== 0) assert.equal(v, dec.approx[i]); });
  }
  assert.equal(JSON.stringify([Array.from(dec.approx), dec.details.map((d) => Array.from(d))]), before);
  assert.deepEqual(waverec(keepLargest(dec, 1000), 'db3'), waverec(dec, 'db3'));
  // approximation error decreases with k and equals the discarded energy (orthogonal)
  const x = randomSignal(64, 3);
  const d2 = wavedec(x, 'db3', 3);
  let prev = Infinity;
  for (const k of [2, 8, 24, 48, 64]) {
    const kept = keepLargest(d2, k);
    const err = energy(Float64Array.from(x, (v, i) => v - waverec(kept, 'db3')[i]));
    assert.ok(err <= prev + 1e-12);
    prev = err;
  }
  assert.ok(prev < 1e-18);
});

test('waveletApprox: full reconstruction, sparse approximation, interpolation and clamping', () => {
  const f = (x) => Math.sin(2 * Math.PI * x) + 0.3 * Math.cos(6 * Math.PI * x);
  const full = waveletApprox(f, { family: 'db4', level: 5, x0: 0, x1: 1, samples: 512 });
  assert.equal(full.x.length, 512);
  assert.equal(full.totalCount, 512);
  assert.equal(full.keptCount, 512);
  assert.equal(full.x[0], 0);
  close(full.x[511], 1, 1e-14);
  for (let i = 0; i < 512; i += 17) close(full.y[i], f(full.x[i]), 1e-9);
  // interpolation exact at nodes, linear between, clamped outside
  close(full.evalReal(full.x[100]), full.y[100], 1e-13);
  close(full.evalReal((full.x[100] + full.x[101]) / 2), (full.y[100] + full.y[101]) / 2, 1e-13);
  assert.equal(full.evalReal(-5), full.y[0]);
  assert.equal(full.evalReal(9), full.y[511]);
  assert.equal(full.dec.details.length, 5);

  const err = (r) => { let m = 0; for (let i = 0; i < r.x.length; i++) m = Math.max(m, Math.abs(r.y[i] - f(r.x[i]))); return m; };
  const e = [8, 16, 32, 64].map((keep) => err(waveletApprox(f, { family: 'sym6', level: 5, x0: 0, x1: 1, samples: 512, keep })));
  for (let i = 1; i < e.length; i++) assert.ok(e[i] <= e[i - 1] + 1e-12, `errors ${e}`);
  assert.ok(e[3] < 0.05);
  const sparse = waveletApprox(f, { family: 'sym6', level: 5, x0: 0, x1: 1, samples: 512, keep: 16 });
  assert.equal(sparse.keptCount, 16);
  assert.equal(sparse.totalCount, 512);
  const nonzero = [...sparse.dec.approx, ...sparse.dec.details.flatMap((d) => Array.from(d))].filter((v) => v !== 0).length;
  assert.equal(nonzero, 16);
  assert.equal(waveletApprox(f, { family: 'haar', level: 3, x0: 0, x1: 1, keep: 5000 }).keptCount, 1024);
});

test('waveletApprox adjusts sample count and level so the transform is valid', () => {
  const r = waveletApprox((x) => x, { family: 'haar', level: 4, x0: -1, x1: 1, samples: 100 });
  assert.equal(r.x.length % 16, 0);
  assert.ok(r.x.length <= 100 && r.x.length >= 96);
  const tiny = waveletApprox((x) => x, { family: 'haar', level: 10, x0: 0, x1: 1, samples: 16 });
  assert.equal(tiny.x.length, 16);
  assert.ok(tiny.dec.details.length <= 3);
  assert.ok(maxDiff(tiny.y, tiny.x) < 1e-12);
});

test('waveletFunction: Haar, db2 closed form values, normalisation and orthogonality', () => {
  const haar = waveletFunction('haar', { iterations: 6 });
  assert.equal(haar.x.length, 65);
  assert.equal(haar.phi.length, 65);
  assert.equal(haar.psi.length, 65);
  for (let i = 0; i < 64; i++) {
    close(haar.phi[i], 1, 1e-14);
    close(haar.psi[i], i < 32 ? 1 : -1, 1e-14); // Haar wavelet: +1 then -1
  }

  const db2 = waveletFunction('db2', { iterations: 10 });
  const s3 = Math.sqrt(3);
  close(db2.phi[db2.x.indexOf(1)], (1 + s3) / 2, 1e-10);
  close(db2.phi[db2.x.indexOf(2)], (1 - s3) / 2, 1e-10);
  close(db2.phi[0], 0, 1e-12);

  const integral = (a, dx) => a.reduce((s, v) => s + v, 0) * dx;
  for (const id of ['db2', 'db6', 'sym5', 'coif2', 'haar']) {
    const w = waveletFunction(id, { iterations: 9 });
    const dx = w.x[1] - w.x[0];
    close(integral(w.phi, dx), 1, 1e-6, `${id} int phi`);
    assert.ok(Math.abs(integral(w.psi, dx)) < 1e-6, `${id} int psi`);
    close(integral(w.phi.map((v) => v * v), dx), 1, 2e-3, `${id} |phi|^2`);
    close(integral(w.psi.map((v) => v * v), dx), 1, 2e-3, `${id} |psi|^2`);
    // psi orthogonal to phi
    close(integral(w.phi.map((v, i) => v * w.psi[i]), dx), 0, 2e-3, `${id} <phi,psi>`);
    // phi orthogonal to its integer translates
    const n1 = Math.round(1 / dx);
    const ip = w.phi.reduce((s, v, i) => s + (i + n1 < w.phi.length ? v * w.phi[i + n1] : 0), 0) * dx;
    assert.ok(Math.abs(ip) < 2e-3, `${id} <phi, phi(.-1)> = ${ip}`);
    assert.equal(w.x[0], 0);
    close(w.x[w.x.length - 1], getFamily(id).length - 1, 1e-12);
  }
});

test('waveletFunction: biorthogonal analysis/synthesis functions are dual', () => {
  const f = getFamily('bior2.2');
  const syn = waveletFunction(f, { iterations: 9 });
  const ana = waveletFunction(f, { iterations: 9, kind: 'dec' });
  assert.equal(syn.phi.length, ana.phi.length);
  const dx = syn.x[1];
  const n = Math.round(1 / dx);
  const ip = (a, b, shift) => {
    let s = 0;
    for (let i = 0; i + shift < a.length; i++) s += a[i] * b[i + shift];
    return s * dx;
  };
  close(ip(syn.phi, ana.phi, 0), 1, 3e-2);
  assert.ok(Math.abs(ip(syn.phi, ana.phi, n)) < 3e-2);
  // dual wavelet and scaling function are orthogonal on the other side
  assert.ok(Math.abs(ip(syn.psi, ana.phi, 0)) < 3e-2);
  assert.ok(Math.abs(ip(syn.phi, ana.psi, 0)) < 3e-2);
});
