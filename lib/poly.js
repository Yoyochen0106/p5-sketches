// Polynomial evaluation helpers. Coefficients are complex [re, im], lowest degree first.

/** Real parts of complex coefficients. */
export const realCoefs = (coefs) => coefs.map((c) => (Array.isArray(c) ? c[0] : c));

/** Horner evaluation of sum coefs[k] dx^k at real dx, using only real parts. Returns a number. */
export function hornerReal(coefs, dx) {
  let r = 0;
  for (let k = coefs.length - 1; k >= 0; k--) {
    const c = coefs[k];
    r = r * dx + (Array.isArray(c) ? c[0] : c);
  }
  return r;
}

/** Horner evaluation at complex dz. Returns [re, im]. */
export function hornerComplex(coefs, dz) {
  const [x, y] = Array.isArray(dz) ? dz : [dz, 0];
  let re = 0;
  let im = 0;
  for (let k = coefs.length - 1; k >= 0; k--) {
    const c = coefs[k];
    const cr = Array.isArray(c) ? c[0] : c;
    const ci = Array.isArray(c) ? c[1] : 0;
    const nr = re * x - im * y + cr;
    im = re * y + im * x + ci;
    re = nr;
  }
  return [re, im];
}
