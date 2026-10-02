import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTINUOUS, getContinuous, cwt } from '../../../lib/wavelets/cwt.js';
import { close } from '../helpers.js';

const IDS = ['morlet', 'cmorlet', 'mexh', 'gaus1', 'gaus2', 'gaus3', 'gaus4', 'paul', 'shannon',
  'cgau1', 'cgau2', 'haar-cont', 'dog'];

function integrate(f, [a, b], h = 1e-3) {
  const n = Math.round((b - a) / h);
  let re = 0, im = 0, sq = 0;
  for (let i = 0; i <= n; i++) {
    const v = f(a + i * h), w = i === 0 || i === n ? 0.5 : 1;
    const r = Array.isArray(v) ? v[0] : v, m = Array.isArray(v) ? v[1] : 0;
    re += w * r; im += w * m; sq += w * (r * r + m * m);
  }
  return { re: re * h, im: im * h, l2: sq * h };
}

test('registry has all required wavelets with consistent shape', () => {
  for (const id of IDS) {
    const w = getContinuous(id);
    assert.equal(w.id, id);
    assert.equal(typeof w.name, 'string');
    assert.equal(typeof w.complex, 'boolean');
    assert.ok(w.support[0] < w.support[1]);
    assert.ok(w.centerFreq > 0);
    const v = w.psi(0.3);
    assert.equal(Array.isArray(v), w.complex);
    if (w.complex) assert.equal(v.length, 2);
  }
  assert.equal(CONTINUOUS.length, new Set(CONTINUOUS.map((c) => c.id)).size);
  assert.throws(() => getContinuous('nope'));
});

test('psi known values', () => {
  close(getContinuous('mexh').psi(0), 2 / (Math.sqrt(3) * Math.pow(Math.PI, 0.25)), 1e-14);
  close(getContinuous('mexh').psi(1), 0, 1e-14);
  close(getContinuous('morlet').psi(0), 1, 1e-14);
  const c = getContinuous('cmorlet').psi(0);
  close(c[0], Math.pow(2 / (Math.PI * 1.5), 0.25), 1e-14);
  close(c[1], 0, 1e-14);
  const sh = getContinuous('shannon').psi(0);
  close(sh[0], 1, 1e-14);
  const h = getContinuous('haar-cont');
  assert.deepEqual([h.psi(0.25), h.psi(0.75), h.psi(1.5), h.psi(-0.1)], [1, -1, 0, 0]);
  // gaus1 is -2t e^{-t^2} up to normalisation: odd, zero at 0
  close(getContinuous('gaus1').psi(0), 0, 1e-14);
  assert.ok(getContinuous('gaus2').psi(0) < 0 || getContinuous('gaus2').psi(0) > 0);
});

test('unit L2 norm', () => {
  for (const id of ['mexh', 'gaus1', 'gaus2', 'gaus3', 'gaus4', 'cgau1', 'cgau2', 'cmorlet', 'dog', 'haar-cont']) {
    const w = getContinuous(id);
    close(integrate(w.psi, w.support).l2, 1, 2e-3, id);
  }
  const sh = getContinuous('shannon');
  close(integrate(sh.psi, [-400, 400], 2e-3).l2, 1, 5e-3, 'shannon');
  close(integrate(getContinuous('paul').psi, [-300, 300], 5e-3).l2, 1, 5e-3, 'paul');
});

test('admissible wavelets have zero mean', () => {
  const tols = { dog: 1e-5, 'haar-cont': 2e-3, mexh: 1e-4, morlet: 1e-4, cmorlet: 1e-4, shannon: 2e-2, paul: 2e-2 };
  for (const id of IDS) {
    const w = getContinuous(id);
    const wide = id === 'paul' ? [-300, 300] : id === 'shannon' ? [-400, 400] : w.support;
    const r = integrate(w.psi, wide, id === 'paul' || id === 'shannon' ? 5e-3 : 1e-3);
    const tol = tols[id] ?? 1e-6;
    assert.ok(Math.abs(r.re) < tol && Math.abs(r.im) < tol, `${id} mean ${r.re},${r.im}`);
  }
});

test('centerFreq matches the spectral peak of psi', () => {
  for (const id of ['morlet', 'cmorlet', 'mexh', 'gaus1', 'gaus3', 'cgau1', 'cgau2', 'dog', 'paul']) {
    const w = getContinuous(id);
    const wide = id === 'paul' ? [-200, 200] : w.support;
    let best = 0, bf = 0;
    for (let f = 0.02; f < 3; f += 0.01) {
      const re = integrate((t) => { const v = w.psi(t); const [r, i] = w.complex ? v : [v, 0]; return [r * Math.cos(2 * Math.PI * f * t) + i * Math.sin(2 * Math.PI * f * t), i * Math.cos(2 * Math.PI * f * t) - r * Math.sin(2 * Math.PI * f * t)]; }, wide, 0.01);
      const m = Math.hypot(re.re, re.im);
      if (m > best) { best = m; bf = f; }
    }
    assert.ok(Math.abs(bf - w.centerFreq) < 0.03, `${id}: peak ${bf} vs ${w.centerFreq}`);
  }
});

function argmaxScale(res, lo, hi) {
  const n = res.n;
  let best = -1, bi = 0;
  for (let s = 0; s < res.scales.length; s++) {
    let e = 0;
    for (let j = lo; j < hi; j++) e += res.mag[s * n + j] ** 2;
    if (e > best) { best = e; bi = s; }
  }
  return res.scales[bi];
}

test('pure sinusoid peaks at scale centerFreq/(f dt)', () => {
  const n = 512, dt = 0.01, f = 4;
  const x = Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i * dt));
  const scales = Array.from({ length: 64 }, (_, i) => 2 ** (i / 8 - 1) * 4 / 8 * 2); // 1 .. ~230 geometric
  for (const id of ['morlet', 'mexh', 'cmorlet']) {
    const w = getContinuous(id);
    const res = cwt(x, { wavelet: id, scales, dt });
    const expected = w.centerFreq / (f * dt);
    const got = argmaxScale(res, 150, 362);
    assert.ok(Math.abs(Math.log(got / expected)) < 0.12, `${id}: expected ${expected}, got ${got}`);
  }
});

test('output layout, real vs complex, speed', () => {
  const n = 512, scales = Array.from({ length: 64 }, (_, i) => 1 + i);
  const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 7));
  const t0 = performance.now();
  const r = cwt(x, { wavelet: 'cmorlet', scales });
  const r2 = cwt(x, { wavelet: getContinuous('mexh'), scales });
  const el = performance.now() - t0;
  assert.ok(el < 1000, `took ${el} ms`);
  assert.equal(r.n, n);
  assert.deepEqual(r.scales, scales);
  assert.ok(r.re instanceof Float32Array && r.im instanceof Float32Array && r.mag instanceof Float32Array);
  assert.equal(r.re.length, 64 * n);
  assert.equal(r2.im, null);
  assert.equal(r2.mag.length, 64 * n);
  for (let i = 0; i < r.mag.length; i += 997) close(r.mag[i], Math.hypot(r.re[i], r.im[i]), 1e-5);
});

test('delta localisation (mexh) and step localisation (gaus1)', () => {
  const n = 256, scales = [2, 4, 8, 16];
  const d = new Float64Array(n); d[100] = 1;
  const rd = cwt(d, { wavelet: 'mexh', scales });
  const st = new Float64Array(n).fill(0, 0, 128).fill(1, 128);
  const rs = cwt(st, { wavelet: 'gaus1', scales });
  for (let s = 0; s < scales.length; s++) {
    let bj = 0, bv = -1, cj = 0, cv = -1;
    for (let j = 40; j < 216; j++) {
      if (rd.mag[s * n + j] > bv) { bv = rd.mag[s * n + j]; bj = j; }
      if (rs.mag[s * n + j] > cv) { cv = rs.mag[s * n + j]; cj = j; }
    }
    assert.equal(bj, 100);
    assert.ok(Math.abs(cj - 128) <= 1, `step peak at ${cj}`);
  }
  // delta response equals scaled conj(psi) exactly: W(a, b) = psi((100-b)/a)/sqrt(a)
  const a = 4, w = getContinuous('mexh');
  close(rd.re[1 * n + 98], w.psi(2 / a) / Math.sqrt(a), 1e-5);
});

test('complex wavelet phase advances 2 pi f dt per sample', () => {
  const n = 512, dt = 0.01, f = 5;
  const x = Float64Array.from({ length: n }, (_, i) => Math.cos(2 * Math.PI * f * i * dt));
  for (const id of ['cmorlet', 'paul']) {
    const w = getContinuous(id);
    const a = w.centerFreq / (f * dt);
    const res = cwt(x, { wavelet: id, scales: [a], dt });
    for (const j of [200, 250, 300]) {
      const p0 = Math.atan2(res.im[j], res.re[j]);
      const p1 = Math.atan2(res.im[j + 1], res.re[j + 1]);
      let d = p1 - p0;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      close(d, 2 * Math.PI * f * dt, 0.05, `${id} phase step`);
    }
  }
});
