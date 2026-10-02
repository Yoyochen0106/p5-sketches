/**
 * Control Systems core library (barrel). One import for the shared model layer of the ct-* and ma-laplace units:
 *
 *   import { tf, parseTf, step, stepInfo, bode, margins, rootLocus, simulateLoop, c2d, getPlant } from '../../lib/ctrl/index.js';
 *
 * Modules (each documented at the top of its file):
 *   tf.js         polynomials, transfer functions {num, den, delay}, series/parallel/feedback, poles/zeros, parse/format, Pade
 *   routh.js      Routh array (special cases), parametric stability range of K, jw-axis crossings
 *   ss.js         state space {A,B,C,D}, tf2ss/ss2tf, simulate (exact ZOH/FOH), rk4, Ackermann, controllability
 *   response.js   step/impulse/ramp/sine/arbitrary responses, stepInfo specs, error constants, second-order formulas
 *   freq.js       Bode, Nichols, Nyquist (D-contour) + encirclement verdict, margins, bandwidth, Mr, S and T
 *   rootlocus.js  traced branches, asymptotes, real-axis segments, break points, jw crossings, angles, K for a point/damping
 *   pid.js        PID forms, discrete controller (filter, weighting, anti-windup, saturation), loop simulator, tuning rules
 *   discretize.js c2d (zoh, tustin, euler, matched), z-domain TFs, difference equations, z-plane maps, aliasing
 *   plants.js     catalogue of named plants (tf, ss, nonlinear models, view hints)
 * Complex numbers are [re, im]; polynomials have the highest power first; angles in degrees unless noted.
 */
export * from './tf.js';
export * from './routh.js';
export * from './ss.js';
export * from './response.js';
export * from './freq.js';
export * from './rootlocus.js';
export * from './pid.js';
export * from './discretize.js';
export * from './plants.js';
