/**
 * Frequency-domain analysis of transfer functions: Bode, Nichols, Nyquist (with the full Nyquist D-contour:
 * indentations around poles on the imaginary axis and the arc at infinity), stability margins, bandwidth, resonant
 * peak, sensitivity functions and the Nyquist stability verdict Z = N + P.
 *
 * A transport delay is evaluated EXACTLY as e^{-jwT} (magnitude 1, phase -wT). Use tf.js withPade()/padeDelay() when a
 * rational approximation is needed (e.g. for feedback algebra or root locus).
 * Frequencies are rad/s; phases in degrees (unwrapped, continuous in w); magnitudes in dB (20 log10 |G|) and linear.
 * Complex values are [re, im].
 */
import { evalTf, tfPoles, tfZeros, padeDelay, withPade, tf, polyAdd, limitAtZero, countRhpPoles, toTf } from './tf.js';

export { padeDelay, withPade };

const TWO_PI = 2 * Math.PI;
const DEG = 180 / Math.PI;
const cabs = (z) => Math.hypot(z[0], z[1]);
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

/** n points log-spaced from a to b (inclusive). */
export function logspace(a, b, n) {
  const out = new Array(n);
  const la = Math.log10(a), lb = Math.log10(b);
  for (let i = 0; i < n; i++) out[i] = 10 ** (la + ((lb - la) * i) / Math.max(1, n - 1));
  return out;
}

/** G(jw) as [re, im]. Accepts a TF or a function w -> [re,im]. */
export function freqResponse(G, w) {
  return typeof G === 'function' ? G(w) : evalTf(G, [0, w]);
}

/** Characteristic frequency scale and a default [wMin, wMax] range from the nonzero poles/zeros (and the delay). */
export function defaultFreqRange(G) {
  const mags = [...tfPoles(G), ...tfZeros(G)].map(cabs).filter((m) => m > 1e-8);
  let lo = 1, hi = 1;
  if (mags.length) { lo = Math.min(...mags); hi = Math.max(...mags); }
  if (G.delay > 0) hi = Math.max(hi, 2 / G.delay);
  const wMin = Math.max(1e-6, lo / 100), wMax = Math.min(1e7, Math.max(hi * 100, wMin * 1e3));
  return { wMin, wMax, scale: Math.sqrt(lo * hi) };
}

/** Principal arg in radians of a complex number. */
const argOf = (z) => Math.atan2(z[1], z[0]);

/**
 * Continuous (unwrapped) phase in degrees of G(jw) over a frequency vector (ascending). The cycle is fixed at the
 * first sample from the nominal low-frequency asymptote (-90 deg per pole at the origin); the delay contributes -w T exactly.
 */
export function unwrappedPhaseDeg(G, ws) {
  const Gr = { num: G.num, den: G.den, delay: 0 };
  const ph = new Array(ws.length);
  let prev = 0;
  for (let i = 0; i < ws.length; i++) {
    let a = argOf(evalTf(Gr, [0, ws[i]]));
    if (i === 0) {
      const net = trailingZeros(Gr.den) - trailingZeros(Gr.num);
      const target = -Math.PI / 2 * net;
      a += TWO_PI * Math.round((target - a) / TWO_PI);
    } else {
      a += TWO_PI * Math.round((prev - a) / TWO_PI);
    }
    prev = a;
    ph[i] = a;
  }
  return ph.map((a, i) => (a - ws[i] * (G.delay || 0)) * DEG);
}
/** Number of trailing (lowest-power) zero coefficients = multiplicity of the root at s = 0. */
function trailingZeros(p) {
  const mx = Math.max(...p.map(Math.abs));
  if (mx === 0) return 0;
  let k = 0;
  for (let i = p.length - 1; i > 0 && Math.abs(p[i]) <= 1e-12 * mx; i--) k++;
  return k;
}

/**
 * Bode data. Returns {w, mag, magDb, phaseDeg} (typed arrays).
 * @param {{wMin?:number, wMax?:number, n?:number, w?:number[]}} opts log grid (default n = 400) or explicit w.
 */
export function bode(G, opts = {}) {
  const r = defaultFreqRange(G);
  const w = opts.w ? Float64Array.from(opts.w) : Float64Array.from(logspace(opts.wMin ?? r.wMin, opts.wMax ?? r.wMax, opts.n ?? 400));
  const mag = new Float64Array(w.length), magDb = new Float64Array(w.length);
  for (let i = 0; i < w.length; i++) {
    mag[i] = cabs(evalTf(G, [0, w[i]]));
    magDb[i] = 20 * Math.log10(Math.max(mag[i], 1e-300));
  }
  return { w, mag, magDb, phaseDeg: Float64Array.from(unwrappedPhaseDeg(G, w)) };
}

/** Nichols chart data: loop gain in dB against loop phase in degrees. */
export const nichols = (G, opts) => bode(G, opts);

// ------------------------------------------------------------------ Nyquist

/**
 * Adaptive frequency sampling on [a, b]: log-spaced start, then bisect intervals where f(w) (a complex value)
 * turns by > maxTurn rad or jumps by more than maxJump relative to its size.
 */
function adaptiveGrid(f, a, b, { n = 120, maxTurn = 0.12, maxJump = 0.08, maxPts = 4000, includeZero = false } = {}) {
  let ws = logspace(a, b, n);
  if (includeZero) ws = [0, ...ws];
  let vals = ws.map(f);
  for (let pass = 0; pass < 14 && ws.length < maxPts; pass++) {
    const nw = [ws[0]], nv = [vals[0]];
    let added = false;
    for (let i = 0; i + 1 < ws.length; i++) {
      const A = vals[i], B = vals[i + 1];
      const aA = Math.abs(argOf(cdiv(B, A)));
      const jump = cabs([B[0] - A[0], B[1] - A[1]]) / (1 + Math.min(cabs(A), cabs(B)));
      const rel = ws[i + 1] - ws[i] > 1e-12 * ws[i + 1];
      if (rel && (aA > maxTurn || jump > maxJump) && ws.length + nw.length < maxPts * 2) {
        const mid = ws[i] > 0 ? Math.sqrt(ws[i] * ws[i + 1]) : ws[i + 1] / 2;
        nw.push(mid); nv.push(f(mid)); added = true;
      }
      nw.push(ws[i + 1]); nv.push(vals[i + 1]);
    }
    ws = nw; vals = nv;
    if (!added) break;
  }
  return { w: ws, v: vals };
}

/**
 * The Nyquist D-contour image of G (or of K*G). Returns
 * { w, re, im      : the plain branch w >= 0 (what is usually drawn; mirror it with im -> -im),
 *   path           : [{s, L, kind}] the CLOSED image of the contour traversed upwards along the jw axis
 *                    (kind 'neg' | 'indent' | 'pos' | 'arc'),
 *   imagPoles      : poles of G on the imaginary axis (omitted from the enclosed region by right-hand indentations),
 *   eps, R }
 * Indentations are semicircles of radius eps into the right half plane; the arc at infinity has radius R and runs
 * clockwise from +jR to -jR. Valid for proper G (delay allowed unless the relative degree is 0).
 */
export function nyquistContour(G, opts = {}) {
  const K = opts.K ?? 1;
  const r = defaultFreqRange(G);
  const scale = r.scale;
  const eps = opts.eps ?? 1e-4 * Math.max(scale, 1e-3);
  const R = opts.wMax ?? r.wMax;
  const wLo = opts.wMin ?? Math.max(1e-4 * scale, 1e-9);
  const L = (s) => { const v = evalTf(G, s); return [K * v[0], K * v[1]]; };
  const jwPoles = tfPoles(G).filter((p) => Math.abs(p[0]) < 1e-7 * Math.max(1, cabs(p)) && p[1] >= -1e-9)
    .map((p) => Math.max(0, p[1])).sort((a, b) => a - b);
  const uniq = jwPoles.filter((w, i) => i === 0 || w - jwPoles[i - 1] > 1e-9);
  const atOrigin = uniq.length > 0 && uniq[0] <= 1e-9;
  const path = []; // upper half (s from 0 to +jR) as {s, L, kind}
  const wList = [], reList = [], imList = [];
  const addPoint = (s, kind) => path.push({ s, L: L(s), kind });
  const rest = uniq.filter((w) => w > 1e-9);
  const bounds = [];
  let a = atOrigin ? eps : 0;
  for (const w of rest) { bounds.push([a, w - eps]); a = w + eps; }
  bounds.push([a, R]);
  const arcPts = (center, θ0, θ1, m = 24) => {
    const out = [];
    for (let i = 0; i <= m; i++) { const th = θ0 + ((θ1 - θ0) * i) / m; out.push([eps * Math.cos(th), center + eps * Math.sin(th)]); }
    return out;
  };
  if (atOrigin) for (const s of arcPts(0, 0, Math.PI / 2, 24)) addPoint(s, 'indent');
  let first = true;
  bounds.forEach(([lo, hi], idx) => {
    if (hi <= lo * (1 + 1e-9) && lo > 0) { if (idx < rest.length) for (const s of arcPts(rest[idx], -Math.PI / 2, Math.PI / 2, 40)) addPoint(s, 'indent'); first = false; return; }
    const g = adaptiveGrid((w) => { const v = L([0, w]); return [1 + v[0], v[1]]; },
      first && !atOrigin && lo === 0 ? wLo : Math.max(lo, wLo * 1e-3 || 1e-12), hi,
      { includeZero: first && !atOrigin });
    for (const w of g.w) { addPoint([0, w], 'pos'); wList.push(w); }
    first = false;
    if (idx < rest.length) for (const s of arcPts(rest[idx], -Math.PI / 2, Math.PI / 2, 40)) addPoint(s, 'indent');
  });
  for (const p of path) if (p.kind === 'pos') { reList.push(p.L[0]); imList.push(p.L[1]); }
  // assemble the closed path: lower (mirror, reversed), upper, arc at infinity
  const lower = path.slice().reverse().map((p) => ({ s: [p.s[0], -p.s[1]], L: [p.L[0], -p.L[1]], kind: p.kind === 'pos' ? 'neg' : p.kind }));
  lower.pop(); // the point at s = 0 (or theta = 0 of the origin indentation) is shared
  const arc = [];
  const M = 60;
  for (let i = 1; i < M; i++) {
    const ph = Math.PI / 2 - (Math.PI * i) / M;
    const s = [R * Math.cos(ph), R * Math.sin(ph)];
    arc.push({ s, L: L(s), kind: 'arc' });
  }
  return { w: wList, re: reList, im: imList, path: [...lower, ...path, ...arc], imagPoles: uniq, eps, R };
}

/** Plain Nyquist branch w >= 0: {w, re, im}. */
export function nyquist(G, opts = {}) {
  const c = nyquistContour(G, opts);
  return { w: c.w, re: c.re, im: c.im };
}

/** Total change of arg(z) along a polyline of complex values, in turns (counterclockwise positive). */
export function windingNumber(points, center = [0, 0]) {
  let tot = 0;
  for (let i = 0; i < points.length; i++) {
    const A = points[i], B = points[(i + 1) % points.length];
    const a = [A[0] - center[0], A[1] - center[1]], b = [B[0] - center[0], B[1] - center[1]];
    tot += argOf(cdiv(b, a));
  }
  return tot / TWO_PI;
}

/**
 * Nyquist stability test of the unity-feedback loop 1 + K L(s):
 * N = clockwise encirclements of -1/K by L along the D-contour (winding of 1+KL around 0, negated),
 * P = open-loop poles in the open RHP, Z = N + P = closed-loop RHP poles.
 * `marginal` is true when the curve passes within 1e-3 of -1 (poles on the jw axis: the verdict is unreliable).
 */
export function nyquistAnalysis(L, opts = {}) {
  const K = opts.K ?? 1;
  const c = nyquistContour(L, { ...opts, K });
  const f = c.path.map((p) => [1 + p.L[0], p.L[1]]);
  const winding = windingNumber(f);
  const N = Math.round(-winding) || 0;
  const P = countRhpPoles(L);
  let dmin = Infinity;
  for (const v of f) dmin = Math.min(dmin, cabs(v));
  return { N, P, Z: N + P, windingRaw: -winding, stable: N + P === 0, marginal: dmin < 1e-3, minDistance: dmin, contour: c };
}

// ------------------------------------------------------------------ margins & crossovers

function bisect(f, a, b, it = 80) {
  let fa = f(a);
  for (let i = 0; i < it; i++) {
    const m = 0.5 * (a + b), fm = f(m);
    if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else b = m;
  }
  return 0.5 * (a + b);
}
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Frequencies where |G(jw)| = level (default 1) – ascending list. */
export function gainCrossovers(G, level = 1, opts = {}) {
  const r = defaultFreqRange(G);
  const ws = logspace(opts.wMin ?? r.wMin / 10, opts.wMax ?? r.wMax, opts.n ?? 4000);
  const f = (w) => Math.log(cabs(evalTf(G, [0, w])) / level);
  const out = [];
  let prev = f(ws[0]);
  for (let i = 1; i < ws.length; i++) {
    const cur = f(ws[i]);
    if (Number.isFinite(prev) && Number.isFinite(cur) && (prev < 0) !== (cur < 0)) out.push(bisect(f, ws[i - 1], ws[i]));
    prev = cur;
  }
  return out;
}

/** Frequencies where the phase crosses -180 deg (mod 360): Im G(jw) = 0 with Re G(jw) < 0. */
export function phaseCrossovers(G, opts = {}) {
  const r = defaultFreqRange(G);
  const ws = logspace(opts.wMin ?? r.wMin / 10, opts.wMax ?? r.wMax, opts.n ?? 4000);
  const im = (w) => evalTf(G, [0, w])[1];
  const out = [];
  let prev = im(ws[0]);
  for (let i = 1; i < ws.length; i++) {
    const cur = im(ws[i]);
    if ((prev < 0) !== (cur < 0) && Number.isFinite(prev) && Number.isFinite(cur)) {
      const w = bisect(im, ws[i - 1], ws[i]);
      if (evalTf(G, [0, w])[0] < 0) out.push(w);
    }
    prev = cur;
  }
  return out;
}

/**
 * Gain and phase margins of the loop L(s) (negative unity feedback).
 * @returns {{gm:number, gmDb:number, wpc:number, pm:number, wgc:number, delayMargin:number,
 *            gainCrossovers:number[], phaseCrossovers:number[], pms:number[], gms:number[], stable:boolean}}
 *  gm: factor by which the gain can grow before instability (1/|L(j wpc)|, Infinity if no phase crossover),
 *  pm: degrees of additional lag tolerated at wgc (180 + phase). Where several crossovers exist the margin closest to
 *  instability is reported (smallest |pm|, gm closest to 1). `stable` = gm > 1 and pm > 0 (valid for open-loop-stable L).
 */
export function margins(L, opts = {}) {
  const wg = gainCrossovers(L, 1, opts), wp = phaseCrossovers(L, opts);
  const pms = wg.map((w) => {
    const ph = unwrappedPhaseDeg(L, [w])[0]; // single point: cycle from nominal asymptote; only used mod 360
    return wrap180(ph + 180);
  });
  const gms = wp.map((w) => 1 / cabs(evalTf(L, [0, w])));
  let ip = -1;
  pms.forEach((v, i) => { if (ip < 0 || Math.abs(v) < Math.abs(pms[ip])) ip = i; });
  let ig = -1;
  gms.forEach((v, i) => { if (ig < 0 || Math.abs(Math.log(v)) < Math.abs(Math.log(gms[ig]))) ig = i; });
  const gm = ig >= 0 ? gms[ig] : Infinity;
  const pm = ip >= 0 ? pms[ip] : Infinity;
  const wgc = ip >= 0 ? wg[ip] : NaN;
  return {
    gm, gmDb: 20 * Math.log10(gm), wpc: ig >= 0 ? wp[ig] : NaN,
    pm, wgc, delayMargin: ip >= 0 && pm > 0 ? ((pm * Math.PI) / 180) / wgc : NaN,
    gainCrossovers: wg, phaseCrossovers: wp, pms, gms,
    stable: gm > 1 && pm > 0,
  };
}

// ------------------------------------------------------------------ closed-loop frequency functions

/** Sensitivity S(jw) = 1/(1+L). */
export function sensitivityResponse(L, w) {
  const v = freqResponse(L, w);
  return cdiv([1, 0], [1 + v[0], v[1]]);
}
/** Complementary sensitivity T(jw) = L/(1+L). */
export function complementaryResponse(L, w) {
  const v = freqResponse(L, w);
  return cdiv(v, [1 + v[0], v[1]]);
}
/** S(s) and T(s) as rational TFs (delay approximated by Pade of the given order). */
export function sensitivityTfs(L, padeOrder = 4) {
  const Lr = withPade(toTf(L), padeOrder);
  const den = polyAdd(Lr.den, Lr.num);
  return { S: tf(Lr.den, den), T: tf(Lr.num, den) };
}

/** Maximum of |f(w)| over a log grid with golden-section refinement. Returns {w, value, index}. */
function peakOf(f, ws) {
  const v = ws.map(f);
  let k = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[k]) k = i;
  if (k === 0 || k === ws.length - 1) return { w: ws[k], value: v[k], interior: false };
  let a = ws[k - 1], b = ws[k + 1];
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  for (let i = 0; i < 80; i++) {
    if (f(c) > f(d)) b = d; else a = c;
    c = b - g * (b - a); d = a + g * (b - a);
  }
  const w = 0.5 * (a + b);
  return { w, value: f(w), interior: true };
}

/**
 * Peak of |G(jw)| (resonance). Returns {Mr, MrDb, wr, interior, peakRatio}: interior is false when the maximum sits at
 * an end of the grid (no resonance); peakRatio = Mr / |G(~0)| (the usual Mp for a lowpass).
 */
export function resonantPeak(G, opts = {}) {
  const r = typeof G === 'function' ? { wMin: 1e-3, wMax: 1e3 } : defaultFreqRange(G);
  const ws = logspace(opts.wMin ?? r.wMin, opts.wMax ?? r.wMax, opts.n ?? 2000);
  const f = (w) => cabs(freqResponse(G, w));
  const p = peakOf(f, ws);
  const f0 = f(ws[0]);
  return { Mr: p.value, MrDb: 20 * Math.log10(p.value), wr: p.w, interior: p.interior, peakRatio: p.value / f0 };
}

/** Closed-loop resonant peak Mr of T = L/(1+L). */
export function closedLoopPeak(L, opts = {}) {
  const r = defaultFreqRange(L);
  return resonantPeak((w) => complementaryResponse(L, w), { wMin: r.wMin, wMax: r.wMax, ...opts });
}

/** Peaks of |S| and |T| and the vector (stability) margin 1 / Ms = min |1 + L(jw)|. */
export function sensitivityPeaks(L, opts = {}) {
  const r = defaultFreqRange(L);
  const ws = logspace(opts.wMin ?? r.wMin, opts.wMax ?? r.wMax, opts.n ?? 3000);
  const ps = peakOf((w) => cabs(sensitivityResponse(L, w)), ws);
  const pt = peakOf((w) => cabs(complementaryResponse(L, w)), ws);
  return { Ms: ps.value, wMs: ps.w, Mt: pt.value, wMt: pt.w, vectorMargin: 1 / ps.value };
}

/**
 * -3 dB bandwidth: first frequency where |G(jw)| falls to |G(0)| / sqrt(2) (levelDb option, default -3.0103 dB).
 * G may be a TF or a function w -> [re,im]. The reference is the DC gain (or the lowest-frequency magnitude).
 * NaN if the magnitude never drops that far.
 */
export function bandwidth(G, opts = {}) {
  const r = typeof G === 'function' ? { wMin: 1e-3, wMax: 1e3 } : defaultFreqRange(G);
  const ws = logspace(opts.wMin ?? r.wMin / 10, opts.wMax ?? r.wMax, opts.n ?? 3000);
  const f = (w) => cabs(freqResponse(G, w));
  let ref = typeof G !== 'function' ? Math.abs(limitAtZero(G, 0)) : f(ws[0]);
  if (!Number.isFinite(ref) || ref === 0) ref = f(ws[0]);
  const target = ref * 10 ** ((opts.levelDb ?? -10 * Math.log10(2)) / 20);
  const g = (w) => f(w) - target;
  for (let i = 1; i < ws.length; i++) if (g(ws[i - 1]) > 0 && g(ws[i]) <= 0) return bisect(g, ws[i - 1], ws[i]);
  return NaN;
}

/** Closed-loop bandwidth of unity-feedback L (of T = L/(1+L)). */
export function closedLoopBandwidth(L, opts = {}) {
  const r = defaultFreqRange(L);
  return bandwidth((w) => complementaryResponse(L, w), { wMin: r.wMin / 10, wMax: r.wMax, ...opts });
}

/** Closed-form second-order resonance: Mr = 1/(2 zeta sqrt(1-zeta^2)) at wr = wn sqrt(1-2 zeta^2) (zeta < 0.707). */
export function secondOrderResonance(zeta, wn) {
  if (zeta >= Math.SQRT1_2) return { Mr: 1, wr: 0 };
  return { Mr: 1 / (2 * zeta * Math.sqrt(1 - zeta * zeta)), wr: wn * Math.sqrt(1 - 2 * zeta * zeta) };
}
