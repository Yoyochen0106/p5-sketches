/**
 * Control-oriented linear algebra: Sylvester / Lyapunov equations, algebraic Riccati equations (LQR),
 * controllability / observability, pole placement.
 *
 * METHODS
 *  - sylvester / lyap / dlyap: Kronecker vectorisation + LU. Cost O((n m)^3): intended for n <= ~30
 *    (the demos use n <= 8). Exact up to LU round-off.
 *  - care: continuous ARE  A'P + P A - P B R^-1 B' P + Q = 0.  The Hamiltonian H = [[A, -G],[-Q, -A']], G = B R^-1 B',
 *    has its stable invariant subspace spanned by [I; P]. We compute S = sign(H) with the determinant-scaled Newton
 *    iteration Z <- (Z/d + d Z^-1)/2, then solve the (overdetermined, consistent) system
 *    [S12; S22 + I] P = -[S11 + I; S21] by Householder least squares, symmetrise, and finish with a few
 *    Newton-Kleinman steps (each one a Lyapunov solve for the closed loop A - G P) to reach round-off residuals.
 *    Requires (A,B) stabilizable and (Q^(1/2),A) detectable (no imaginary-axis Hamiltonian eigenvalues).
 *  - dare: discrete ARE  A'XA - X - A'XB (R + B'XB)^-1 B'XA + Q = 0 by the structure-preserving doubling
 *    algorithm (quadratically convergent, does not need A invertible).
 */
import { Matrix, asMatrix, hcat, vcat, kron, blocks } from './matrix.js';
import { lu, luSolve, solve, lstsq } from './decomp.js';
import { eigvals } from './eigen.js';
import { rank } from './svd.js';
import { polyvalm, polyFromRoots } from './matfun.js';

const MAX_KRON = 30;

const vecCol = (X) => { const o = new Float64Array(X.rows * X.cols); for (let j = 0; j < X.cols; j++) for (let i = 0; i < X.rows; i++) o[j * X.rows + i] = X.data[i * X.cols + j]; return o; };
const unvecCol = (v, r, c) => { const X = new Matrix(r, c); for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) X.data[i * c + j] = v[j * r + i]; return X; };

/** Solve the Sylvester equation A X + X B = C (A: n x n, B: m x m, C: n x m) by Kronecker vectorisation. */
export function sylvester(A, B, Cm) {
  A = asMatrix(A); B = asMatrix(B); Cm = asMatrix(Cm);
  const n = A.rows, m = B.rows;
  if (n * m > MAX_KRON * MAX_KRON) throw new RangeError('sylvester: problem too large for the Kronecker solver');
  const K = kron(Matrix.identity(m), A).add(kron(B.transpose(), Matrix.identity(n)));
  const x = solve(K, Array.from(vecCol(Cm)));
  return unvecCol(x, n, m);
}

/** Continuous Lyapunov equation  A X + X A' + Q = 0  (X = int_0^inf e^{At} Q e^{A't} dt for stable A). */
export function lyap(A, Q) {
  A = asMatrix(A); Q = asMatrix(Q);
  return sylvester(A, A.transpose(), Q.scale(-1));
}
/** Discrete Lyapunov equation  X = A X A' + Q  (X = sum_k A^k Q (A')^k for Schur-stable A). */
export function dlyap(A, Q) {
  A = asMatrix(A); Q = asMatrix(Q);
  const n = A.rows;
  if (n * n > MAX_KRON * MAX_KRON) throw new RangeError('dlyap: problem too large for the Kronecker solver');
  const K = Matrix.identity(n * n).sub(kron(A, A));
  return unvecCol(solve(K, Array.from(vecCol(Q))), n, n);
}
/** Residual ||A X + X A' + Q||_F of the continuous Lyapunov equation. */
export const lyapResidual = (A, X, Q) => asMatrix(A).mul(X).add(asMatrix(X).mul(asMatrix(A).transpose())).add(Q).normFro();
/** Residual ||A X A' - X + Q||_F of the discrete Lyapunov equation. */
export const dlyapResidual = (A, X, Q) => asMatrix(A).mul(X).mul(asMatrix(A).transpose()).sub(X).add(Q).normFro();

/** Residual ||A'P + PA - P B R^-1 B' P + Q||_F of the continuous ARE. */
export function careResidual(A, B, Q, R, P) {
  A = asMatrix(A); B = asMatrix(B); P = asMatrix(P);
  const G = B.mul(luSolve(lu(R), B.transpose()));
  return A.transpose().mul(P).add(P.mul(A)).sub(P.mul(G).mul(P)).add(Q).normFro();
}
/** Residual ||A'XA - X - A'XB (R + B'XB)^-1 B'XA + Q||_F of the discrete ARE. */
export function dareResidual(A, B, Q, R, X) {
  A = asMatrix(A); B = asMatrix(B); X = asMatrix(X);
  const BtX = B.transpose().mul(X);
  const M = asMatrix(R).add(BtX.mul(B));
  const AtXB = A.transpose().mul(X).mul(B);
  return A.transpose().mul(X).mul(A).sub(X).sub(AtXB.mul(luSolve(lu(M), BtX.mul(A)))).add(Q).normFro();
}

/** Sign function of a matrix without imaginary-axis eigenvalues (determinant-scaled Newton iteration). */
export function signMatrix(H, { maxIter = 100, tol = 1e-13 } = {}) {
  H = asMatrix(H);
  const N = H.rows, I = Matrix.identity(N);
  let Z = H.clone();
  for (let it = 0; it < maxIter; it++) {
    const F = lu(Z);
    if (F.singular) throw new Error('signMatrix: matrix has an eigenvalue on the imaginary axis');
    let logdet = 0;
    for (let i = 0; i < N; i++) logdet += Math.log(Math.abs(F.packed.data[i * N + i]));
    const d = Math.exp(logdet / N);
    const Zi = luSolve(F, I);
    const Zn = Z.scale(0.5 / d).add(Zi.scale(0.5 * d));
    const diff = Zn.sub(Z).norm1();
    Z = Zn;
    if (!Z.isFinite()) throw new Error('signMatrix: iteration diverged');
    if (diff <= tol * Z.norm1()) return Z;
  }
  return Z;
}

/**
 * Solve the continuous algebraic Riccati equation (see file header for the method).
 * @returns {{P: Matrix, K: Matrix, poles: number[][], residual: number}}  K = R^-1 B' P (u = -K x); poles of A - B K.
 */
export function care(A, B, Q, R) {
  A = asMatrix(A); B = asMatrix(B); Q = asMatrix(Q); R = asMatrix(R);
  const n = A.rows;
  const Rinv = luSolve(lu(R), Matrix.identity(R.rows));
  const G = B.mul(Rinv).mul(B.transpose());
  const H = blocks([[A, G.neg()], [Q.neg(), A.transpose().neg()]]);
  const S = signMatrix(H);
  const S11 = S.block(0, n, 0, n), S12 = S.block(0, n, n, 2 * n), S21 = S.block(n, 2 * n, 0, n), S22 = S.block(n, 2 * n, n, 2 * n);
  const lhs = vcat(S12, S22.add(Matrix.identity(n)));
  const rhs = vcat(S11.add(Matrix.identity(n)), S21).neg();
  let P = lstsq(lhs, rhs).x.symmetrized();
  if (n <= MAX_KRON) { // Newton-Kleinman polishing
    for (let it = 0; it < 6; it++) {
      const Res = A.transpose().mul(P).add(P.mul(A)).sub(P.mul(G).mul(P)).add(Q);
      if (Res.normFro() <= 1e-15 * (1 + P.normFro() * Math.max(1, A.normFro()))) break;
      const Ak = A.sub(G.mul(P));
      P = P.add(lyap(Ak.transpose(), Res)).symmetrized();
    }
  }
  const K = Rinv.mul(B.transpose()).mul(P);
  return { P, K, poles: eigvals(A.sub(B.mul(K))), residual: careResidual(A, B, Q, R, P) };
}

/**
 * Solve the discrete algebraic Riccati equation by structured doubling.
 * @returns {{P: Matrix, K: Matrix, poles: number[][], residual: number}}  K = (R + B'PB)^-1 B'PA (u[k] = -K x[k]).
 */
export function dare(A, B, Q, R, { maxIter = 100, tol = 1e-15 } = {}) {
  A = asMatrix(A); B = asMatrix(B); Q = asMatrix(Q); R = asMatrix(R);
  const n = A.rows, I = Matrix.identity(n);
  let Ak = A.clone(), Gk = B.mul(luSolve(lu(R), B.transpose())), Hk = Q.clone();
  for (let it = 0; it < maxIter; it++) {
    const W = I.add(Gk.mul(Hk));
    const F = lu(W);
    if (F.singular) throw new Error('dare: doubling iteration hit a singular matrix');
    const WiA = luSolve(F, Ak);                 // W^-1 A_k
    const WiG = luSolve(F, Gk);                 // W^-1 G_k
    const Hn = Hk.add(Ak.transpose().mul(Hk).mul(WiA));
    const Gn = Gk.add(Ak.mul(WiG).mul(Ak.transpose()));
    Ak = Ak.mul(WiA);
    Gk = Gn.symmetrized();
    const diff = Hn.sub(Hk).normFro();
    Hk = Hn.symmetrized();
    if (!Hk.isFinite()) throw new Error('dare: iteration diverged (system not stabilizable?)');
    if (diff <= tol * Math.max(1, Hk.normFro())) break;
  }
  const P = Hk;
  const BtP = B.transpose().mul(P);
  const K = luSolve(lu(R.add(BtP.mul(B))), BtP.mul(A));
  return { P, K, poles: eigvals(A.sub(B.mul(K))), residual: dareResidual(A, B, Q, R, P) };
}

/** Continuous LQR: minimise int x'Qx + u'Ru. Returns {K, P, poles, residual}. */
export const lqr = care;
/** Discrete LQR: minimise sum x'Qx + u'Ru. Returns {K, P, poles, residual}. */
export const dlqr = dare;

/** Controllability matrix [B, AB, ..., A^(n-1) B]. */
export function ctrb(A, B) {
  A = asMatrix(A); B = asMatrix(B);
  const parts = [B];
  for (let k = 1; k < A.rows; k++) parts.push(A.mul(parts[k - 1]));
  return hcat(...parts);
}
/** Observability matrix [C; CA; ...; C A^(n-1)]. */
export function obsv(A, Cm) {
  A = asMatrix(A); Cm = asMatrix(Cm);
  const parts = [Cm];
  for (let k = 1; k < A.rows; k++) parts.push(parts[k - 1].mul(A));
  return vcat(...parts);
}
export const ctrbRank = (A, B, tol) => rank(ctrb(A, B), tol);
export const obsvRank = (A, Cm, tol) => rank(obsv(A, Cm), tol);
export const isControllable = (A, B, tol) => ctrbRank(A, B, tol) === asMatrix(A).rows;
export const isObservable = (A, Cm, tol) => obsvRank(A, Cm, tol) === asMatrix(A).rows;
/** Controllability Gramian of a stable continuous system: A W + W A' + B B' = 0. */
export const gramianC = (A, B) => lyap(A, asMatrix(B).mul(asMatrix(B).transpose()));
/** Observability Gramian of a stable continuous system: A' W + W A + C' C = 0. */
export const gramianO = (A, Cm) => lyap(asMatrix(A).transpose(), asMatrix(Cm).transpose().mul(asMatrix(Cm)));

/**
 * Ackermann pole placement for a single-input system: returns the 1 x n gain K such that the eigenvalues of
 * A - B K are `poles` (real numbers or [re, im] pairs closed under conjugation). Numerically fragile for n > ~8.
 */
export function acker(A, B, poles) {
  A = asMatrix(A); B = asMatrix(B);
  const n = A.rows;
  if (B.cols !== 1) throw new RangeError('acker: single input only');
  if (poles.length !== n) throw new RangeError('acker: need n poles');
  const Wc = ctrb(A, B);
  if (rank(Wc) < n) throw new Error('acker: system is not controllable');
  const phi = polyvalm(polyFromRoots(poles), A);
  const e = new Array(n).fill(0); e[n - 1] = 1;
  const y = solve(Wc.transpose(), e);
  return Matrix.row(y).mul(phi);
}
/** Observer gain L (n x 1) placing the eigenvalues of A - L C for a single-output system. */
export function observerGain(A, Cm, poles) {
  return acker(asMatrix(A).transpose(), asMatrix(Cm).transpose(), poles).transpose();
}
