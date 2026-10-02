// Catalogue of demo functions. Analytic ones are written ONCE as def(A, x) and evaluated over any
// algebra from algebra.js (real, complex, truncated Taylor series).
//
// Entry fields: id, label, analytic, def(A,x), f(x), fc(z), taylor(a,n), singularities, radius(a),
// period, view. Non-analytic entries have only f, singularities = [], radius() = 0, no def/fc/taylor.
// Complex numbers are [re, im].
import { realAlg, complexAlg, seriesAlg, seriesVariable } from './algebra.js';

const PI = Math.PI;
const asComplex = (a) => (Array.isArray(a) ? a : [a, 0]);
const dist = (a, s) => Math.hypot(a[0] - s[0], a[1] - s[1]);

function analytic(id, label, def, opts) {
  const {
    singularities = [], period = null, view, f, fc, taylor, radius,
  } = opts;
  const entry = {
    id, label, analytic: true, def, singularities, period, view,
    f: f || ((x) => def(realAlg, x)),
    fc: fc || ((z) => def(complexAlg, asComplex(z))),
    /** n+1 complex Taylor coefficients about a (number or [re, im]); coefficient k = f^(k)(a)/k!. */
    taylor: taylor || ((a, n) => def(seriesAlg(n, a), seriesVariable(n, a))),
    /** Convergence radius of the Taylor series about a: distance to the nearest singularity. */
    radius: radius || ((a) => {
      const c = asComplex(a);
      let r = Infinity;
      for (const s of singularities) r = Math.min(r, dist(c, s));
      return r;
    }),
  };
  return entry;
}

function nonAnalytic(id, label, f, { period = null, view }) {
  return {
    id, label, analytic: false, f, singularities: [], radius: () => 0, period, view,
  };
}

const frac = (x) => x - Math.floor(x);

// Poles of tanh: i*pi*(m + 1/2), listed for m = -4..3. Radius uses the full infinite family.
const tanhPoles = [];
for (let m = -4; m <= 3; m++) tanhPoles.push([0, PI * (m + 0.5)]);

// sinc Taylor series at 0 in closed form: (-1)^k x^(2k) / (2k+1)!
function sincTaylor0(n) {
  const out = Array.from({ length: n + 1 }, () => [0, 0]);
  let fact = 1;
  for (let k = 0; 2 * k <= n; k++) {
    if (k > 0) fact *= (2 * k) * (2 * k + 1);
    out[2 * k] = [(k % 2 ? -1 : 1) / fact, 0];
  }
  return out;
}

const sincDef = (A, x) => A.div(A.sin(x), x);

export const FUNCTIONS = [
  analytic('sin', 'sin(x)', (A, x) => A.sin(x), {
    period: 2 * PI, view: { xmin: -2 * PI, xmax: 2 * PI, ymin: -1.6, ymax: 1.6 },
  }),
  analytic('cos', 'cos(x)', (A, x) => A.cos(x), {
    period: 2 * PI, view: { xmin: -2 * PI, xmax: 2 * PI, ymin: -1.6, ymax: 1.6 },
  }),
  analytic('exp', 'exp(x)', (A, x) => A.exp(x), {
    view: { xmin: -4, xmax: 4, ymin: -1, ymax: 10 },
  }),
  analytic('ln1p', 'ln(1+x)', (A, x) => A.log(A.add(A.one, x)), {
    f: (x) => Math.log1p(x),
    singularities: [[-1, 0]], view: { xmin: -0.95, xmax: 3, ymin: -3, ymax: 2 },
  }),
  analytic('geom', '1/(1-x)', (A, x) => A.div(A.one, A.sub(A.one, x)), {
    singularities: [[1, 0]], view: { xmin: -3, xmax: 3, ymin: -4, ymax: 4 },
  }),
  analytic('lorentz', '1/(1+x^2)', (A, x) => A.div(A.one, A.add(A.one, A.mul(x, x))), {
    singularities: [[0, 1], [0, -1]], view: { xmin: -3, xmax: 3, ymin: -0.5, ymax: 1.3 },
  }),
  analytic('runge', '1/(1+25x^2)', (A, x) =>
    A.div(A.one, A.add(A.one, A.mul(A.const(25), A.mul(x, x)))), {
    singularities: [[0, 0.2], [0, -0.2]], view: { xmin: -1, xmax: 1, ymin: -0.3, ymax: 1.3 },
  }),
  analytic('atan', 'atan(x)', (A, x) => A.atan(x), {
    singularities: [[0, 1], [0, -1]], view: { xmin: -4, xmax: 4, ymin: -2, ymax: 2 },
  }),
  analytic('sqrt1p', 'sqrt(1+x)', (A, x) => A.sqrt(A.add(A.one, x)), {
    singularities: [[-1, 0]], view: { xmin: -1, xmax: 4, ymin: -0.5, ymax: 2.5 },
  }),
  analytic('tanh', 'tanh(x)', (A, x) => A.tanh(x), {
    singularities: tanhPoles,
    radius: (a) => {
      const [re, im] = asComplex(a);
      const m = Math.round(im / PI - 0.5);
      return Math.hypot(re, im - PI * (m + 0.5));
    },
    view: { xmin: -4, xmax: 4, ymin: -1.5, ymax: 1.5 },
  }),
  analytic('sinc', 'sin(x)/x', sincDef, {
    f: (x) => (x === 0 ? 1 : Math.sin(x) / x),
    fc: (z) => {
      const c = asComplex(z);
      return c[0] === 0 && c[1] === 0 ? [1, 0] : complexAlg.div(complexAlg.sin(c), c);
    },
    taylor: (a, n) => {
      const c = asComplex(a);
      if (c[0] === 0 && c[1] === 0) return sincTaylor0(n);
      return sincDef(seriesAlg(n, c), seriesVariable(n, c));
    },
    period: null, view: { xmin: -4 * PI, xmax: 4 * PI, ymin: -0.5, ymax: 1.2 },
  }),
  analytic('gauss', 'exp(-x^2)', (A, x) => A.exp(A.neg(A.mul(x, x))), {
    view: { xmin: -3, xmax: 3, ymin: -0.3, ymax: 1.3 },
  }),
  analytic('legacy', '0.5 sin(2πx) + 0.5 sin(4πx)', (A, x) =>
    A.add(
      A.mul(A.const(0.5), A.sin(A.mul(A.const(2 * PI), x))),
      A.mul(A.const(0.5), A.sin(A.mul(A.const(4 * PI), x))),
    ), {
    period: 1, view: { xmin: -1, xmax: 1, ymin: -1.3, ymax: 1.3 },
  }),
  // The author's "composed sine": 0.5 sin(pi x) + 0.5 sin(2 pi x), period 2.
  analytic('composed', '0.5 sin(πx) + 0.5 sin(2πx)', (A, x) =>
    A.add(
      A.mul(A.const(0.5), A.sin(A.mul(A.const(PI), x))),
      A.mul(A.const(0.5), A.sin(A.mul(A.const(2 * PI), x))),
    ), {
    period: 2, view: { xmin: -5, xmax: 5, ymin: -2, ymax: 2 },
  }),
  // sin(x^2) is entire, so it is flagged analytic (Taylor/complex work); it is still hard for Taylor.
  analytic('chirp', 'sin(x^2)', (A, x) => A.sin(A.mul(x, x)), {
    view: { xmin: -6, xmax: 6, ymin: -1.5, ymax: 1.5 },
  }),
  // sin(1/(x+1.2)): essential singularity at -1.2, analytic elsewhere.
  analytic('doppler', 'sin(1/(x+1.2))', (A, x) => A.sin(A.div(A.one, A.add(x, A.const(1.2)))), {
    singularities: [[-1.2, 0]], view: { xmin: -1.1, xmax: 3, ymin: -1.5, ymax: 1.5 },
  }),

  nonAnalytic('abs', '|x|', (x) => Math.abs(x), {
    view: { xmin: -2, xmax: 2, ymin: -0.3, ymax: 2.2 },
  }),
  nonAnalytic('square', 'square wave', (x) => {
    const s = Math.sin(2 * PI * x);
    return s > 0 ? 1 : s < 0 ? -1 : 0;
  }, { period: 1, view: { xmin: -1, xmax: 1, ymin: -1.5, ymax: 1.5 } }),
  // Odd sawtooth, 2x on (-1/2, 1/2), period 1.
  nonAnalytic('saw', 'sawtooth', (x) => 2 * frac(x + 0.5) - 1, {
    period: 1, view: { xmin: -1, xmax: 1, ymin: -1.5, ymax: 1.5 },
  }),
  // Even triangle wave, 1 - 4|x| on [-1/2, 1/2], period 1.
  nonAnalytic('tri', 'triangle wave', (x) => 1 - 4 * Math.abs(frac(x + 0.5) - 0.5), {
    period: 1, view: { xmin: -1, xmax: 1, ymin: -1.5, ymax: 1.5 },
  }),
  // Smooth (C-infinity) compact bump on (-1, 1), peak value 1; not analytic at +-1.
  nonAnalytic('bump', 'smooth bump', (x) => (Math.abs(x) >= 1 ? 0 : Math.exp(1 - 1 / (1 - x * x))), {
    view: { xmin: -2, xmax: 2, ymin: -0.3, ymax: 1.3 },
  }),
  // smoothstep 3t^2 - 2t^3 on [0,1], mirrored to period 2: C^1 only, the second derivative jumps at the joins.
  nonAnalytic('mirror', 'mirrored 3x²−2x³', (x) => {
    let t = ((x % 2) + 2) % 2;
    if (t > 1) t = 2 - t;
    return 3 * t * t - 2 * t * t * t;
  }, { period: 2, view: { xmin: -3, xmax: 3, ymin: -0.4, ymax: 1.4 } }),
  nonAnalytic('step', 'step', (x) => (x < 0 ? 0 : 1), {
    view: { xmin: -2, xmax: 2, ymin: -0.3, ymax: 1.3 },
  }),
];

/** Look up a function entry by id (undefined if unknown). */
export const getFunction = (id) => FUNCTIONS.find((f) => f.id === id);
