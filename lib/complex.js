// Complex arithmetic on plain [re, im] tuples. All functions use principal branches.

export const ONE = [1, 0];
export const ZERO = [0, 0];
export const I = [0, 1];

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
/** Multiply by a real scalar. */
export const scale = (z, s) => [z[0] * s, z[1] * s];
export const neg = (z) => [-z[0], -z[1]];
export const conj = (z) => [z[0], -z[1]];
export const abs = (z) => Math.hypot(z[0], z[1]);
/** Principal argument in (-pi, pi]. */
export const arg = (z) => Math.atan2(z[1], z[0]);
export const fromPolar = (r, t) => [r * Math.cos(t), r * Math.sin(t)];

/** Division using Smith's algorithm (robust against overflow). */
export function div(a, b) {
  const [c, d] = b;
  if (c === 0 && d === 0) return [a[0] / 0, a[1] / 0 || 0];
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c;
    const den = c + d * r;
    return [(a[0] + a[1] * r) / den, (a[1] - a[0] * r) / den];
  }
  const r = c / d;
  const den = c * r + d;
  return [(a[0] * r + a[1]) / den, (a[1] * r - a[0]) / den];
}

export const exp = (z) => {
  const e = Math.exp(z[0]);
  return z[1] === 0 ? [e, 0] : [e * Math.cos(z[1]), e * Math.sin(z[1])];
};

/** Principal logarithm (log 0 = -Infinity). */
export const log = (z) => [Math.log(Math.hypot(z[0], z[1])), Math.atan2(z[1], z[0])];

/** Principal square root (Re >= 0). */
export function sqrt(z) {
  const [x, y] = z;
  if (x === 0 && y === 0) return [0, 0];
  const m = Math.hypot(x, y);
  if (x >= 0) {
    const t = Math.sqrt((m + x) / 2);
    return [t, y / (2 * t)];
  }
  const t = Math.sqrt((m - x) / 2);
  return [Math.abs(y) / (2 * t), y < 0 ? -t : t];
}

/** z^w for complex w, principal branch: exp(w log z). 0^w = 0 (w != 0), 0^0 = 1. */
export function pow(z, w) {
  if (z[0] === 0 && z[1] === 0) return w[0] === 0 && w[1] === 0 ? [1, 0] : [0, 0];
  if (w[1] === 0 && Number.isInteger(w[0]) && Math.abs(w[0]) <= 1024) return powInt(z, w[0]);
  return exp(mul(w, log(z)));
}

/** z^n for integer n (exact repeated squaring, negative n allowed). */
export function powInt(z, n) {
  if (n < 0) return div(ONE, powInt(z, -n));
  let result = [1, 0];
  let base = z;
  let k = n;
  while (k > 0) {
    if (k & 1) result = mul(result, base);
    k = Math.floor(k / 2);
    if (k > 0) base = mul(base, base);
  }
  return result;
}

export const sin = (z) =>
  z[1] === 0 ? [Math.sin(z[0]), 0] : [Math.sin(z[0]) * Math.cosh(z[1]), Math.cos(z[0]) * Math.sinh(z[1])];
export const cos = (z) =>
  z[1] === 0 ? [Math.cos(z[0]), 0] : [Math.cos(z[0]) * Math.cosh(z[1]), -Math.sin(z[0]) * Math.sinh(z[1])];
export const sinh = (z) =>
  z[1] === 0 ? [Math.sinh(z[0]), 0] : [Math.sinh(z[0]) * Math.cos(z[1]), Math.cosh(z[0]) * Math.sin(z[1])];
export const cosh = (z) =>
  z[1] === 0 ? [Math.cosh(z[0]), 0] : [Math.cosh(z[0]) * Math.cos(z[1]), Math.sinh(z[0]) * Math.sin(z[1])];

/** tan(x+iy) = (sin 2x + i sinh 2y) / (cos 2x + cosh 2y), with large-|y| saturation. */
export function tan(z) {
  const [x, y] = z;
  if (y === 0) return [Math.tan(x), 0];
  if (Math.abs(y) > 20) return [0, Math.sign(y)];
  const den = Math.cos(2 * x) + Math.cosh(2 * y);
  return [Math.sin(2 * x) / den, Math.sinh(2 * y) / den];
}

/** tanh(x+iy) = (sinh 2x + i sin 2y) / (cosh 2x + cos 2y), with large-|x| saturation. */
export function tanh(z) {
  const [x, y] = z;
  if (y === 0) return [Math.tanh(x), 0];
  if (Math.abs(x) > 20) return [Math.sign(x), 0];
  const den = Math.cosh(2 * x) + Math.cos(2 * y);
  return [Math.sinh(2 * x) / den, Math.sin(2 * y) / den];
}

/** Principal arctangent: (i/2)(log(1 - iz) - log(1 + iz)); branch cuts on the imaginary axis |Im| > 1. */
export function atan(z) {
  if (z[1] === 0) return [Math.atan(z[0]), 0];
  const iz = [-z[1], z[0]];
  const d = sub(log(sub(ONE, iz)), log(add(ONE, iz)));
  return [-d[1] / 2, d[0] / 2];
}
