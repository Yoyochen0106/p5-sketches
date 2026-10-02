/**
 * Catalogue of named plants for the Control Systems units.
 *
 * Every entry:
 *   { id, label, description, tags[], params: [{key, label, unit, min, max, step, default, log?}], defaults,
 *     tf(p)          -> TF {num, den, delay}   (linear model about the operating point; p = parameter values),
 *     ss(p)          -> state-space {A,B,C,D,delay} (physical states where meaningful),
 *     nonlinear?(p)  -> {f(x,u,t), h(x,u), x0, uTrim, stateLabels, ...} for simulateLoop / rk4,
 *     view: { input, output, tSpan (s, null = auto), stepAmp, bode: [wMin, wMax], gainRange: [Kmin, Kmax],
 *             unstable?, anim?: {kind, ...geometry notes} } }
 *
 * Look entries up with getPlant(id); plantTf(id, overrides) / plantSs / plantNonlinear fill in defaults and clamp to the
 * declared ranges. Parameter keys are plain camelCase so they can double as deep-link settings.
 * Units are SI unless stated.
 */
import { tf, polyMul } from './tf.js';
import { tf2ss, ss } from './ss.js';
import { minv } from './_mat.js';

const par = (key, label, unit, def, min, max, step, extra = {}) => ({ key, label, unit, default: def, min, max, step, ...extra });

const defaultsOf = (params) => Object.fromEntries(params.map((q) => [q.key, q.default]));

function def(entry) {
  const defaults = defaultsOf(entry.params);
  const e = { tags: [], ...entry, defaults };
  if (!e.ss) e.ss = (p) => tf2ss(e.tf(p));
  return e;
}

// ---------------------------------------------------------------- cart-pole (shared by tf / ss / nonlinear)

function cartPoleMatrices(p) {
  const { M, m, b, l, I, g } = p;
  const Mm = [[M + m, m * l], [m * l, I + m * l * l]];
  const Mi = minv(Mm);
  // [xdd, thdd] = Mi * ([u - b xd, m g l th])
  const A = [[0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0]];
  const B = [[0], [0], [0], [0]];
  A[1][1] = -b * Mi[0][0]; A[1][2] = m * g * l * Mi[0][1]; B[1][0] = Mi[0][0];
  A[3][1] = -b * Mi[1][0]; A[3][2] = m * g * l * Mi[1][1]; B[3][0] = Mi[1][0];
  return { A, B };
}

// ---------------------------------------------------------------- the catalogue

export const PLANTS = [
  def({
    id: 'first-order', label: 'First-order lag',
    description: 'G(s) = K / (tau s + 1): a single energy store (RC filter, thermal mass, tank). Step response is 1 - exp(-t/tau).',
    tags: ['basic'],
    params: [par('K', 'DC gain', '', 1, 0.1, 10, 0.1), par('tau', 'Time constant', 's', 1, 0.05, 20, 0.05, { log: true })],
    tf: (p) => tf([p.K], [p.tau, 1]),
    view: { input: { label: 'u', unit: '' }, output: { label: 'y', unit: '' }, tSpan: null, stepAmp: 1, bode: [0.01, 100], gainRange: [0.1, 100] },
  }),
  def({
    id: 'second-order', label: 'Second-order system',
    description: 'G(s) = K wn^2 / (s^2 + 2 zeta wn s + wn^2): the canonical oscillator. Overshoot exp(-pi zeta / sqrt(1-zeta^2)), settling ~ 4/(zeta wn).',
    tags: ['basic'],
    params: [par('K', 'DC gain', '', 1, 0.1, 10, 0.1), par('zeta', 'Damping ratio', '', 0.4, 0.02, 3, 0.01), par('wn', 'Natural frequency', 'rad/s', 2, 0.2, 20, 0.1, { log: true })],
    tf: (p) => tf([p.K * p.wn * p.wn], [1, 2 * p.zeta * p.wn, p.wn * p.wn]),
    view: { input: { label: 'u', unit: '' }, output: { label: 'y', unit: '' }, tSpan: null, stepAmp: 1, bode: [0.05, 200], gainRange: [0.1, 100] },
  }),
  def({
    id: 'dc-motor-speed', label: 'DC motor (voltage to speed)',
    description: 'Armature-controlled DC motor: omega/V = Km / ((J s + b)(L s + R) + Km^2). Two real poles for the default parameters (electrical pole is much faster than the mechanical one).',
    tags: ['electromechanical'],
    params: [
      par('J', 'Rotor inertia', 'kg m^2', 0.01, 0.001, 0.1, 0.001, { log: true }), par('b', 'Viscous friction', 'N m s', 0.1, 0.001, 1, 0.001, { log: true }),
      par('Km', 'Motor constant (Kt = Ke)', 'N m/A', 0.01, 0.001, 0.2, 0.001, { log: true }), par('R', 'Armature resistance', 'ohm', 1, 0.1, 10, 0.1), par('L', 'Armature inductance', 'H', 0.5, 0.001, 1, 0.001, { log: true }),
    ],
    tf: (p) => tf([p.Km], addPoly(polyMul([p.J, p.b], [p.L, p.R]), [p.Km * p.Km])),
    view: { input: { label: 'V', unit: 'V' }, output: { label: 'omega', unit: 'rad/s' }, tSpan: null, stepAmp: 1, bode: [0.01, 1000], gainRange: [1, 1e4] },
  }),
  def({
    id: 'dc-motor-position', label: 'DC motor (voltage to position)',
    description: 'theta/V = Km / (s ((J s + b)(L s + R) + Km^2)): the speed model followed by an integrator (type 1 plant).',
    tags: ['electromechanical', 'type1'],
    params: [
      par('J', 'Rotor inertia', 'kg m^2', 0.01, 0.001, 0.1, 0.001, { log: true }), par('b', 'Viscous friction', 'N m s', 0.1, 0.001, 1, 0.001, { log: true }),
      par('Km', 'Motor constant', 'N m/A', 0.01, 0.001, 0.2, 0.001, { log: true }), par('R', 'Armature resistance', 'ohm', 1, 0.1, 10, 0.1), par('L', 'Armature inductance', 'H', 0.5, 0.001, 1, 0.001, { log: true }),
    ],
    tf: (p) => tf([p.Km], [...addPoly(polyMul([p.J, p.b], [p.L, p.R]), [p.Km * p.Km]), 0]),
    view: { input: { label: 'V', unit: 'V' }, output: { label: 'theta', unit: 'rad' }, tSpan: null, stepAmp: 1, bode: [0.01, 1000], gainRange: [1, 1e4] },
  }),
  def({
    id: 'mass-spring-damper', label: 'Mass-spring-damper',
    description: 'x/F = 1 / (m s^2 + c s + k). Natural frequency sqrt(k/m), damping ratio c / (2 sqrt(k m)).',
    tags: ['mechanical'],
    params: [par('m', 'Mass', 'kg', 1, 0.1, 10, 0.1), par('c', 'Damping', 'N s/m', 0.8, 0, 10, 0.05), par('k', 'Stiffness', 'N/m', 4, 0.1, 100, 0.1, { log: true })],
    tf: (p) => tf([1], [p.m, p.c, p.k]),
    view: { input: { label: 'F', unit: 'N' }, output: { label: 'x', unit: 'm' }, tSpan: null, stepAmp: 1, bode: [0.05, 100], gainRange: [0.1, 1000],
      anim: { kind: 'mass-spring-damper', note: 'block of width ~ sqrt(m) on a wall-mounted spring (rest length 1) + dashpot; x measured from rest' } },
  }),
  def({
    id: 'rlc', label: 'Series RLC circuit',
    description: 'Capacitor voltage over source voltage: Vc/Vs = 1 / (L C s^2 + R C s + 1). wn = 1/sqrt(LC), zeta = (R/2) sqrt(C/L).',
    tags: ['electrical'],
    params: [par('R', 'Resistance', 'ohm', 0.4, 0, 10, 0.05), par('L', 'Inductance', 'H', 1, 0.1, 10, 0.1), par('C', 'Capacitance', 'F', 1, 0.1, 10, 0.1)],
    tf: (p) => tf([1], [p.L * p.C, p.R * p.C, 1]),
    view: { input: { label: 'Vs', unit: 'V' }, output: { label: 'Vc', unit: 'V' }, tSpan: null, stepAmp: 1, bode: [0.05, 50], gainRange: [0.1, 100] },
  }),
  def({
    id: 'thermal-oven', label: 'Thermal oven with transport delay',
    description: 'G(s) = K e^{-L s} / (tau s + 1): heater power to temperature with a sensing delay. Dead time limits the usable loop bandwidth (L/tau ratio decides PID tuning).',
    tags: ['process', 'delay'],
    params: [par('K', 'Gain', 'degC/W', 2, 0.2, 10, 0.1), par('tau', 'Time constant', 's', 30, 2, 200, 1, { log: true }), par('delay', 'Dead time', 's', 5, 0, 40, 0.5)],
    tf: (p) => tf([p.K], [p.tau, 1], p.delay),
    view: { input: { label: 'P', unit: 'W' }, output: { label: 'T', unit: 'degC' }, tSpan: null, stepAmp: 1, bode: [0.001, 10], gainRange: [0.01, 50] },
  }),
  def({
    id: 'cart-pendulum', label: 'Inverted pendulum on a cart (linearised)',
    description: 'Force on the cart to pole angle about the upright equilibrium (theta > 0 leans toward +x, so a positive push gives negative theta). Open-loop unstable (real pole at +sqrt(...)); the 4-state model [x, x\', theta, theta\'] feeds pole placement / LQR. Nonlinear model available via plantNonlinear().',
    tags: ['mechanical', 'unstable', 'nonlinear'],
    params: [
      par('M', 'Cart mass', 'kg', 0.5, 0.1, 5, 0.05), par('m', 'Pendulum mass', 'kg', 0.2, 0.02, 2, 0.01), par('b', 'Cart friction', 'N s/m', 0.1, 0, 2, 0.01),
      par('l', 'Pivot to centre of mass', 'm', 0.3, 0.05, 1, 0.01), par('I', 'Pendulum inertia about CoM', 'kg m^2', 0.006, 0.0005, 0.1, 0.0005), par('g', 'Gravity', 'm/s^2', 9.81, 1, 25, 0.01),
    ],
    tf: (p) => {
      const q = (p.M + p.m) * (p.I + p.m * p.l * p.l) - (p.m * p.l) ** 2;
      const den = [1, (p.b * (p.I + p.m * p.l * p.l)) / q, (-(p.M + p.m) * p.m * p.g * p.l) / q, (-p.b * p.m * p.g * p.l) / q];
      return tf([-(p.m * p.l) / q, 0], den); // theta/F (one s cancelled); a push to +x tips the pole toward -theta
    },
    ss: (p) => { const { A, B } = cartPoleMatrices(p); return ss(A, B, [[1, 0, 0, 0], [0, 0, 1, 0]], [[0], [0]]); },
    nonlinear: (p) => cartPoleNonlinear(p),
    view: { input: { label: 'F', unit: 'N' }, output: { label: 'theta', unit: 'rad' }, tSpan: 3, stepAmp: 0.1, bode: [0.1, 100], gainRange: [0.1, 1000], unstable: true,
      anim: { kind: 'cart-pole', states: ['x', 'xdot', 'theta', 'thetadot'], note: 'cart centre at x; pole COM at (x + l sin theta, l cos theta), tip at (x + 2 l sin theta, 2 l cos theta); theta = 0 is upright, positive leans toward +x' } },
  }),
  def({
    id: 'cart-position', label: 'Cart position (pendulum plant, x output)',
    description: 'Same cart-pole as above but the output is the cart position x: X/F = ((I+ml^2)s^2 - m g l) / (q s (...)): a non-minimum-phase-like pair of real zeros and an unstable pole.',
    tags: ['mechanical', 'unstable'],
    params: [
      par('M', 'Cart mass', 'kg', 0.5, 0.1, 5, 0.05), par('m', 'Pendulum mass', 'kg', 0.2, 0.02, 2, 0.01), par('b', 'Cart friction', 'N s/m', 0.1, 0, 2, 0.01),
      par('l', 'Pivot to centre of mass', 'm', 0.3, 0.05, 1, 0.01), par('I', 'Pendulum inertia about CoM', 'kg m^2', 0.006, 0.0005, 0.1, 0.0005), par('g', 'Gravity', 'm/s^2', 9.81, 1, 25, 0.01),
    ],
    tf: (p) => {
      const q = (p.M + p.m) * (p.I + p.m * p.l * p.l) - (p.m * p.l) ** 2;
      const den = [1, (p.b * (p.I + p.m * p.l * p.l)) / q, (-(p.M + p.m) * p.m * p.g * p.l) / q, (-p.b * p.m * p.g * p.l) / q];
      return tf([(p.I + p.m * p.l * p.l) / q, 0, (-p.m * p.g * p.l) / q], [...den, 0]);
    },
    ss: (p) => { const { A, B } = cartPoleMatrices(p); return ss(A, B, [[1, 0, 0, 0]], [[0]]); },
    view: { input: { label: 'F', unit: 'N' }, output: { label: 'x', unit: 'm' }, tSpan: 3, stepAmp: 0.1, bode: [0.1, 100], gainRange: [0.1, 1000], unstable: true },
  }),
  def({
    id: 'ball-beam', label: 'Ball and beam',
    description: 'Ball position r over servo angle theta: R/Theta = -(m g d / L) / ((J/R^2 + m) s^2): a double integrator with negative gain (lever arm d, beam length L).',
    tags: ['mechanical', 'type2'],
    params: [
      par('m', 'Ball mass', 'kg', 0.11, 0.01, 1, 0.01), par('Rb', 'Ball radius', 'm', 0.015, 0.005, 0.05, 0.001), par('g', 'Gravity', 'm/s^2', 9.8, 1, 25, 0.1),
      par('Lb', 'Beam length', 'm', 1, 0.2, 3, 0.05), par('d', 'Lever arm offset', 'm', 0.03, 0.005, 0.2, 0.005), par('J', 'Ball inertia', 'kg m^2', 9.99e-6, 1e-7, 1e-4, 1e-7, { log: true }),
    ],
    tf: (p) => tf([-(p.m * p.g * p.d) / p.Lb / (p.J / (p.Rb * p.Rb) + p.m)], [1, 0, 0]),
    nonlinear: (p) => ({
      // beam angle alpha = d theta / L (servo angle theta is the input); centripetal term neglected
      f: (x, u) => [x[1], (-p.m * p.g * Math.sin((p.d * u) / p.Lb)) / (p.m + p.J / (p.Rb * p.Rb))],
      h: (x) => x[0], x0: [0, 0], uTrim: 0, stateLabels: ['r (m)', 'r\' (m/s)'],
    }),
    view: { input: { label: 'theta', unit: 'rad' }, output: { label: 'r', unit: 'm' }, tSpan: 5, stepAmp: 0.25, bode: [0.1, 100], gainRange: [1, 1000],
      anim: { kind: 'ball-beam', note: 'beam pivots at its centre; tilt alpha = d theta / L; ball at distance r from the pivot along the beam' } },
  }),
  def({
    id: 'maglev', label: 'Magnetic levitation (unstable)',
    description: 'Ball suspended by an electromagnet: m x\'\' = m g - k i^2 / x^2. Linearised about the gap x0: G(s) = -(2 g / i0) / (s^2 - 2 g / x0), poles at +-sqrt(2 g / x0): one unstable pole that sets the minimum bandwidth.',
    tags: ['electromechanical', 'unstable', 'nonlinear'],
    params: [par('x0', 'Equilibrium gap', 'm', 0.01, 0.002, 0.05, 0.001, { log: true }), par('i0', 'Equilibrium current', 'A', 1, 0.2, 5, 0.05), par('m', 'Ball mass', 'kg', 0.05, 0.005, 0.5, 0.005), par('g', 'Gravity', 'm/s^2', 9.81, 1, 25, 0.01)],
    tf: (p) => tf([-(2 * p.g) / p.i0], [1, 0, -(2 * p.g) / p.x0]),
    nonlinear: (p) => {
      const k = (p.m * p.g * p.x0 * p.x0) / (p.i0 * p.i0);
      return { f: (x, u) => [x[1], p.g - (k / p.m) * (u * u) / (x[0] * x[0])], h: (x) => x[0], x0: [p.x0, 0], uTrim: p.i0, stateLabels: ['gap x (m)', 'x\' (m/s)'] };
    },
    view: { input: { label: 'di', unit: 'A' }, output: { label: 'dx', unit: 'm' }, tSpan: 0.5, stepAmp: 0.01, bode: [1, 1000], gainRange: [0.01, 1000], unstable: true,
      anim: { kind: 'maglev', note: 'ball hangs below the coil at gap x (increasing downward); equilibrium x0 at current i0' } },
  }),
  def({
    id: 'water-tank', label: 'Water tank (linearised)',
    description: 'A dh/dt = q_in - c sqrt(h). About the level h0 the outflow slope is k = c / (2 sqrt(h0)), so G(s) = 1 / (A s + k): a first-order lag whose time constant A/k depends on the operating level.',
    tags: ['process', 'nonlinear'],
    params: [par('A', 'Tank area', 'm^2', 2, 0.2, 10, 0.1), par('c', 'Outflow coefficient', 'm^2.5/s', 0.5, 0.05, 2, 0.01), par('h0', 'Operating level', 'm', 1, 0.1, 4, 0.05)],
    tf: (p) => tf([1], [p.A, p.c / (2 * Math.sqrt(p.h0))]),
    nonlinear: (p) => ({ f: (x, u) => [(u - p.c * Math.sqrt(Math.max(0, x[0]))) / p.A], h: (x) => x[0], x0: [p.h0], uTrim: p.c * Math.sqrt(p.h0), stateLabels: ['level h (m)'] }),
    view: { input: { label: 'dq', unit: 'm^3/s' }, output: { label: 'dh', unit: 'm' }, tSpan: null, stepAmp: 0.1, bode: [0.01, 10], gainRange: [0.1, 100],
      anim: { kind: 'tank', note: 'rectangle of area A filled to level h; inflow arrow at the top, outflow valve at the bottom' } },
  }),
  def({
    id: 'two-tanks', label: 'Two tanks in series',
    description: 'G(s) = K / ((tau1 s + 1)(tau2 s + 1)): two non-interacting lags, overdamped, no overshoot; classic process-control example.',
    tags: ['process'],
    params: [par('K', 'DC gain', '', 1, 0.1, 10, 0.1), par('tau1', 'Time constant 1', 's', 4, 0.2, 40, 0.1, { log: true }), par('tau2', 'Time constant 2', 's', 1.5, 0.2, 40, 0.1, { log: true })],
    tf: (p) => tf([p.K], polyMul([p.tau1, 1], [p.tau2, 1])),
    view: { input: { label: 'u', unit: '' }, output: { label: 'y', unit: '' }, tSpan: null, stepAmp: 1, bode: [0.005, 20], gainRange: [0.1, 100] },
  }),
  def({
    id: 'aircraft-pitch', label: 'Aircraft pitch',
    description: 'Elevator deflection to pitch angle (short-period + phugoid-free model): theta/delta = (b1 s + b0) / (s^3 + a2 s^2 + a1 s). Type-1 with a lightly damped pair at about 0.9 rad/s.',
    tags: ['aerospace', 'type1'],
    params: [par('b1', 'Numerator s', '', 1.151, 0.2, 4, 0.01), par('b0', 'Numerator const', '', 0.1774, 0.02, 1, 0.001), par('a2', 'Denominator s^2', '', 0.739, 0.1, 3, 0.001), par('a1', 'Denominator s', '', 0.921, 0.1, 4, 0.001)],
    tf: (p) => tf([p.b1, p.b0], [1, p.a2, p.a1, 0]),
    view: { input: { label: 'delta_e', unit: 'rad' }, output: { label: 'theta', unit: 'rad' }, tSpan: 15, stepAmp: 0.2, bode: [0.01, 100], gainRange: [0.1, 100],
      anim: { kind: 'aircraft', note: 'side view; fuselage rotated by theta about the centre of gravity, elevator trailing edge deflected by delta_e' } },
  }),
  def({
    id: 'satellite', label: 'Satellite attitude (double integrator)',
    description: 'theta/T = 1 / (J s^2): no damping, no restoring torque. Proportional control alone gives pure oscillation; a PD (lead) term is essential.',
    tags: ['aerospace', 'type2', 'nonlinear'],
    params: [par('J', 'Moment of inertia', 'kg m^2', 1, 0.1, 20, 0.1)],
    tf: (p) => tf([1 / p.J], [1, 0, 0]),
    nonlinear: (p) => ({ f: (x, u) => [x[1], u / p.J], h: (x) => x[0], x0: [0, 0], uTrim: 0, stateLabels: ['theta (rad)', 'omega (rad/s)'] }),
    view: { input: { label: 'T', unit: 'N m' }, output: { label: 'theta', unit: 'rad' }, tSpan: 10, stepAmp: 1, bode: [0.01, 100], gainRange: [0.01, 100],
      anim: { kind: 'satellite', note: 'body rectangle with two solar panels rotated by theta' } },
  }),
  def({
    id: 'flexible-mode', label: 'Two-mass flexible mode',
    description: 'Force on mass 1, position of mass 2 through a spring k and damper c: G = (c s + k) / (m1 m2 s^4 + (m1+m2) c s^3 + (m1+m2) k s^2). A rigid-body double integrator plus a lightly damped resonance at sqrt(k (m1+m2)/(m1 m2)); a high-gain loop excites it.',
    tags: ['mechanical', 'type2', 'resonant'],
    params: [par('m1', 'Mass 1', 'kg', 1, 0.1, 10, 0.1), par('m2', 'Mass 2', 'kg', 1, 0.1, 10, 0.1), par('k', 'Spring', 'N/m', 50, 1, 500, 1, { log: true }), par('c', 'Damper', 'N s/m', 0.1, 0, 5, 0.01)],
    tf: (p) => tf([p.c, p.k], [p.m1 * p.m2, (p.m1 + p.m2) * p.c, (p.m1 + p.m2) * p.k, 0, 0]),
    view: { input: { label: 'F', unit: 'N' }, output: { label: 'x2', unit: 'm' }, tSpan: null, stepAmp: 1, bode: [0.1, 100], gainRange: [0.1, 1000],
      anim: { kind: 'two-mass', note: 'two blocks joined by spring + damper; force acts on block 1, block 2 position is measured' } },
  }),
  def({
    id: 'unstable-first-order', label: 'Unstable first-order plant',
    description: 'G(s) = K / (tau s - 1): one RHP pole at 1/tau. Needs a minimum loop gain (K Kp > 1) to be stabilised; ideal for Nyquist/root-locus encirclement demos.',
    tags: ['basic', 'unstable'],
    params: [par('K', 'Gain', '', 1, 0.1, 10, 0.1), par('tau', 'Time constant', 's', 1, 0.1, 10, 0.05)],
    tf: (p) => tf([p.K], [p.tau, -1]),
    view: { input: { label: 'u', unit: '' }, output: { label: 'y', unit: '' }, tSpan: 5, stepAmp: 0.1, bode: [0.01, 100], gainRange: [0.1, 100], unstable: true },
  }),
  def({
    id: 'rhp-zero', label: 'Non-minimum-phase (RHP zero)',
    description: 'G(s) = K (1 - s/z) / (tau s + 1)^2: the step response first moves the wrong way (undershoot); the RHP zero caps the achievable bandwidth near z/2.',
    tags: ['basic', 'non-minimum-phase'],
    params: [par('K', 'DC gain', '', 1, 0.1, 10, 0.1), par('z', 'RHP zero', 'rad/s', 2, 0.2, 20, 0.1, { log: true }), par('tau', 'Lag time constant', 's', 0.5, 0.05, 5, 0.05)],
    tf: (p) => tf([-p.K / p.z, p.K], polyMul([p.tau, 1], [p.tau, 1])),
    view: { input: { label: 'u', unit: '' }, output: { label: 'y', unit: '' }, tSpan: null, stepAmp: 1, bode: [0.02, 100], gainRange: [0.1, 100] },
  }),
];

function addPoly(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n).fill(0);
  a.forEach((v, i) => { out[n - a.length + i] += v; });
  b.forEach((v, i) => { out[n - b.length + i] += v; });
  return out;
}

/** Nonlinear cart-pole model (states [x, x', theta, theta']; input force; theta = 0 upright). */
function cartPoleNonlinear(p) {
  const { M, m, b, l, I, g } = p;
  return {
    f: (x, u) => {
      const th = x[2], w = x[3], c = Math.cos(th), s = Math.sin(th);
      const a11 = M + m, a12 = m * l * c, a22 = I + m * l * l;
      const r1 = u - b * x[1] + m * l * w * w * s, r2 = m * g * l * s;
      const det = a11 * a22 - a12 * a12;
      return [x[1], (a22 * r1 - a12 * r2) / det, w, (a11 * r2 - a12 * r1) / det];
    },
    h: (x) => x[2],
    x0: [0, 0, 0.1, 0], uTrim: 0, stateLabels: ['x (m)', 'x\' (m/s)', 'theta (rad)', 'theta\' (rad/s)'],
    // total mechanical energy (for plots / checks): kinetic of cart + pole + potential
    energy: (x) => {
      const th = x[2], w = x[3];
      const vx = x[1] + l * Math.cos(th) * w, vy = -l * Math.sin(th) * w;
      return 0.5 * M * x[1] ** 2 + 0.5 * m * (vx * vx + vy * vy) + 0.5 * I * w * w + m * g * l * Math.cos(th);
    },
  };
}

// ---------------------------------------------------------------- lookup helpers

export const PLANT_IDS = PLANTS.map((q) => q.id);

/** Plant entry by id (throws for unknown ids). */
export function getPlant(id) {
  const p = PLANTS.find((q) => q.id === id);
  if (!p) throw new Error(`unknown plant '${id}'`);
  return p;
}

/** Defaults overlaid with `overrides`, clamped to each parameter's [min, max]; unknown keys are ignored. */
export function resolveParams(plant, overrides = {}) {
  const out = {};
  for (const q of plant.params) {
    let v = overrides[q.key];
    v = typeof v === 'number' && Number.isFinite(v) ? v : q.default;
    out[q.key] = Math.min(q.max, Math.max(q.min, v));
  }
  return out;
}

/** Transfer function of a plant (default parameters unless overridden). */
export const plantTf = (id, overrides) => { const pl = getPlant(id); return pl.tf(resolveParams(pl, overrides)); };
/** State-space model of a plant. */
export const plantSs = (id, overrides) => { const pl = getPlant(id); return pl.ss(resolveParams(pl, overrides)); };
/** Nonlinear model {f, h, x0, uTrim, stateLabels}, or null when the plant has none. */
export const plantNonlinear = (id, overrides) => { const pl = getPlant(id); return pl.nonlinear ? pl.nonlinear(resolveParams(pl, overrides)) : null; };
