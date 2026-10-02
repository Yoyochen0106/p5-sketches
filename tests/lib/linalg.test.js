import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../lib/linalg.js';
import { polyRoots } from '../../lib/pade.js';
import * as C from '../../lib/complex.js';
import { rng, close } from './helpers.js';

const { Matrix } = L;
const near = (A, B, tol, msg = '') => {
  const d = L.maxDiff(A, B);
  assert.ok(d <= tol, `${msg} max diff ${d} > ${tol}`);
};
const rand = (n, m = n, seed = 1) => Matrix.random(n, m, rng(seed));
const I = (n) => Matrix.identity(n);
const sortC = (zs) => zs.slice().sort((p, q) => Math.round(p[0] * 1e6) - Math.round(q[0] * 1e6) || p[1] - q[1]);
const closeSets = (a, b, tol) => {
  const x = sortC(a), y = sortC(b);
  assert.equal(x.length, y.length);
  x.forEach((z, i) => assert.ok(Math.hypot(z[0] - y[i][0], z[1] - y[i][1]) <= tol * Math.max(1, Math.hypot(...y[i])), `root ${i}: ${z} vs ${y[i]}`));
};

// ---------------------------------------------------------------- matrix basics
test('Matrix construction, parse / toString round trip, ops', () => {
  const A = Matrix.from([[1, 2], [3, 4]]);
  assert.deepEqual(A.toArray(), [[1, 2], [3, 4]]);
  assert.deepEqual(A.transpose().toArray(), [[1, 3], [2, 4]]);
  assert.deepEqual(A.mul([[0, 1], [1, 0]]).toArray(), [[2, 1], [4, 3]]);
  assert.deepEqual(L.matvec(A, [1, 1]), [3, 7]);
  assert.equal(A.trace(), 5);
  assert.deepEqual(L.add(A, A).toArray(), [[2, 4], [6, 8]]);
  assert.deepEqual(L.sub(A, A).toArray(), [[0, 0], [0, 0]]);
  assert.deepEqual(L.scale(A, 2).toArray(), [[2, 4], [6, 8]]);
  assert.deepEqual(Matrix.diag([1, 2]).toArray(), [[1, 0], [0, 2]]);
  assert.equal(A.toString(), '1,2;3,4');
  assert.deepEqual(Matrix.parse('1,2;3,4').toArray(), A.toArray());
  assert.equal(Matrix.parse('1,2;3'), null);
  assert.equal(Matrix.parse('a,b'), null);
  assert.equal(Matrix.parse(''), null);
  assert.throws(() => Matrix.from([1, 2, 3]));
  assert.throws(() => A.mul([[1, 2, 3]]));
  assert.equal(L.norm1(A), 6); assert.equal(L.normInf(A), 7);
  assert.deepEqual(L.kron([[1, 2]], [[1], [1]]).toArray(), [[1, 2], [1, 2]]);
  assert.deepEqual(L.blocks([[I(1), Matrix.zeros(1, 1)], [Matrix.zeros(1, 1), I(1).scale(2)]]).toArray(), [[1, 0], [0, 2]]);
});

// ---------------------------------------------------------------- LU / Cholesky / QR
test('LU: PA = LU, solve, inverse, determinant', () => {
  for (let n = 1; n <= 9; n++) {
    const A = rand(n, n, 10 + n), F = L.lu(A);
    const PA = Matrix.fromFunction(n, n, (i, j) => A.get(F.perm[i], j));
    near(PA, F.L.mul(F.U), 1e-13);
    const b = Array.from({ length: n }, (_, i) => i + 1), x = L.solve(A, b);
    const r = L.matvec(A, x).map((v, i) => v - b[i]);
    assert.ok(Math.max(...r.map(Math.abs)) < 1e-10);
    near(A.mul(L.inverse(A)), I(n), 1e-10);
  }
  close(L.det([[1, 2], [3, 4]]), -2, 1e-14);
  close(L.det([[2, 0, 0], [0, 3, 0], [0, 0, 4]]), 24, 1e-14);
  assert.equal(L.det([[1, 2], [2, 4]]), 0);
  assert.throws(() => L.inverse([[1, 2], [2, 4]]));
  const X = L.solve([[2, 0], [0, 4]], [[2, 4], [4, 8]]);
  assert.deepEqual(X.toArray(), [[1, 2], [1, 2]]);
});

test('Cholesky: L L^T = A, solve, rejects indefinite', () => {
  const B = rand(6, 6, 3), A = B.mul(B.transpose()).add(I(6).scale(0.5));
  const Lc = L.cholesky(A);
  near(Lc.mul(Lc.transpose()), A, 1e-13);
  const b = [1, 2, 3, 4, 5, 6], x = L.choleskySolve(Lc, b), y = L.solve(A, b);
  x.forEach((v, i) => close(v, y[i], 1e-10));
  assert.throws(() => L.cholesky([[1, 2], [2, 1]]));
  assert.equal(L.isPositiveDefinite([[2, 1], [1, 2]]), true);
  assert.equal(L.isPositiveDefinite([[1, 2], [2, 1]]), false);
});

test('Householder QR: A = QR, Q orthogonal, R triangular; thin variant', () => {
  for (const [m, n] of [[5, 5], [7, 4], [4, 7], [1, 1], [6, 1]]) {
    const A = rand(m, n, m * 10 + n), { Q, R } = L.qr(A);
    near(Q.mul(R), A, 1e-13);
    near(Q.transpose().mul(Q), I(m), 1e-13);
    for (let i = 1; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) assert.equal(R.get(i, j), 0);
    if (m > n) {
      const t = L.qr(A, { thin: true });
      assert.equal(t.Q.cols, n); assert.equal(t.R.rows, n);
      near(t.Q.mul(t.R), A, 1e-13);
    }
  }
});

test('least squares agrees with the normal equations and handles rank deficiency', () => {
  const A = rand(20, 4, 5), b = Array.from({ length: 20 }, (_, i) => Math.sin(i));
  const { x, residualNorm, method } = L.lstsq(A, b);
  assert.equal(method, 'qr');
  const At = A.transpose(), xn = L.solve(At.mul(A), At.matvec(b));
  x.forEach((v, i) => close(v, xn[i], 1e-10));
  const res = L.matvec(A, x).map((v, i) => v - b[i]);
  close(Math.hypot(...res), residualNorm, 1e-12);
  assert.ok(Math.abs(L.dot(At.matvec(res), [1, 1, 1, 1])) < 1e-10); // A^T r = 0
  // line fit y = 2x + 1 exactly
  const xs = [0, 1, 2, 3], F = xs.map((t) => [1, t]);
  const fit = L.lstsq(F, xs.map((t) => 2 * t + 1));
  close(fit.x[0], 1, 1e-12); close(fit.x[1], 2, 1e-12);
  // rank deficient -> minimum norm solution
  const D = [[1, 1], [1, 1], [1, 1]], r = L.lstsq(D, [2, 2, 2]);
  assert.equal(r.method, 'svd'); assert.equal(r.rank, 1);
  close(r.x[0], 1, 1e-12); close(r.x[1], 1, 1e-12);
  // underdetermined
  const u = L.lstsq([[1, 1, 0], [0, 1, 1]], [1, 1]);
  assert.ok(u.residualNorm < 1e-12);
});

test('Gram-Schmidt: classical & modified reproduce A = QR and expose steps', () => {
  const A = rand(6, 4, 21);
  for (const modified of [false, true]) {
    const g = L.gramSchmidt(A, { modified });
    near(g.Q.mul(g.R), A, 1e-12);
    near(g.Q.transpose().mul(g.Q), I(4), 1e-12);
    assert.equal(g.rank, 4);
    assert.equal(g.steps.length, 4);
    assert.equal(g.steps[0].projections.length, 0);
    assert.equal(g.steps[3].projections.length, 3);
    const s = g.steps[2];
    // residual = original - sum of projection vectors (classical) ; last "after" = residual
    assert.deepEqual(s.projections[s.projections.length - 1].after, s.residual);
    close(s.norm, Math.hypot(...s.residual), 1e-14);
  }
  // CGS vs the first-step identity and dependent columns
  const dep = L.gramSchmidt([[1, 2, 3], [1, 2, 3], [0, 0, 1]]);
  assert.equal(dep.rank, 2); assert.equal(dep.steps[1].dependent, true);
  // modified GS is more orthogonal on a Lauchli-type matrix
  const e = 1e-8, Lm = [[1, 1, 1], [e, 0, 0], [0, e, 0], [0, 0, e]];
  const orth = (g) => L.maxDiff(g.Q.transpose().mul(g.Q), I(3));
  assert.ok(orth(L.gramSchmidt(Lm, { modified: true })) < orth(L.gramSchmidt(Lm, { modified: false })));
});

// ---------------------------------------------------------------- eigenvalues
function checkEig(A, tol = 1e-9) {
  const n = A.rows, { values, vectors } = L.eig(A);
  const Ac = L.CMatrix.fromReal(A), AV = Ac.mul(vectors);
  for (let k = 0; k < n; k++) {
    const [lr, li] = values[k];
    let worst = 0, nrm = 0;
    for (let i = 0; i < n; i++) {
      const vr = vectors.re[i * n + k], vi = vectors.im[i * n + k];
      worst = Math.max(worst, Math.hypot(AV.re[i * n + k] - (lr * vr - li * vi), AV.im[i * n + k] - (lr * vi + li * vr)));
      nrm += vr * vr + vi * vi;
    }
    close(Math.sqrt(nrm), 1, 1e-12);
    assert.ok(worst <= tol * Math.max(1, A.normFro()), `eigpair ${k}: residual ${worst}`);
  }
  return values;
}

test('eig: A v = lambda v for random real matrices (complex pairs included)', () => {
  for (let n = 1; n <= 14; n++) {
    const A = rand(n, n, 100 + n);
    const vals = checkEig(A);
    const tr = vals.reduce((s, z) => s + z[0], 0), dt = vals.reduce((p, z) => C.mul(p, z), [1, 0]);
    close(tr, A.trace(), 1e-10);
    close(dt[0], L.det(A), 1e-8); assert.ok(Math.abs(dt[1]) < 1e-8 * Math.max(1, Math.abs(dt[0])));
  }
  // conjugate pairs are exact conjugates
  const vals = L.eigvals(rand(8, 8, 77));
  for (const z of vals) if (z[1] > 0) assert.ok(vals.some((w) => w[0] === z[0] && w[1] === -z[1]));
});

test('eig: known spectra (rotation, triangular, defective, zero)', () => {
  closeSets(L.eigvals([[0, -1], [1, 0]]), [[0, 1], [0, -1]], 1e-14);
  closeSets(L.eigvals([[1, 2, 3], [0, 4, 5], [0, 0, 6]]), [[1, 0], [4, 0], [6, 0]], 1e-13);
  closeSets(L.eigvals([[2, 1], [0, 2]]), [[2, 0], [2, 0]], 1e-14);
  closeSets(L.eigvals(Matrix.zeros(4, 4)), [[0, 0], [0, 0], [0, 0], [0, 0]], 1e-14);
  closeSets(L.eigvals([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]), [[-1, 0], [-2, 0], [-3, 0]], 1e-10);
  checkEig(Matrix.from([[0, -3], [3, 0]]));
  checkEig(Matrix.from([[1, 2, 0], [-2, 1, 0], [0, 0, 5]]));
});

test('eig: companion matrices agree with polynomial roots', () => {
  const polys = [[1, -6, 11, -6], [1, 0, 0, 0, -1], [2, 3, -5, 1, 7, -4], [1, 0, 1], [1, 2, 3, 4, 5, 6, 7]];
  for (const p of polys) {
    const roots = polyRoots(p.slice().reverse());
    closeSets(L.eigvals(L.companion(p)), roots, 1e-8);
    closeSets(L.polyRootsHigh(p), roots, 1e-12);
  }
});

test('eigSym: orthonormal vectors, tridiagonal spectrum 2 - 2cos(k pi/(n+1))', () => {
  const n = 12, T = Matrix.fromFunction(n, n, (i, j) => (i === j ? 2 : Math.abs(i - j) === 1 ? -1 : 0));
  const { values, vectors } = L.eigSym(T);
  values.forEach((v, k) => close(v, 2 - 2 * Math.cos(((k + 1) * Math.PI) / (n + 1)), 1e-13));
  near(vectors.transpose().mul(vectors), I(n), 1e-13);
  near(vectors.mul(Matrix.diag(values)).mul(vectors.transpose()), T, 1e-13);
  const B = rand(9, 9, 4), S = B.add(B.transpose()), e = L.eigSym(S);
  near(e.vectors.mul(Matrix.diag(e.values)).mul(e.vectors.transpose()), S, 1e-12);
  for (let i = 1; i < 9; i++) assert.ok(e.values[i] >= e.values[i - 1]);
  closeSets(L.eigvals(S), e.values.map((v) => [v, 0]), 1e-10);
  // repeated eigenvalue: identity-like
  const rep = L.eigSym([[2, 0, 0], [0, 2, 0], [0, 0, 5]]);
  assert.deepEqual(rep.values, [2, 2, 5]);
});

test('Schur & Hessenberg reconstructions', () => {
  for (const n of [2, 3, 5, 9]) {
    const A = rand(n, n, 40 + n), { T, Q } = L.schur(A);
    near(Q.mul(T).mul(Q.transpose()), A, 1e-12);
    near(Q.transpose().mul(Q), I(n), 1e-13);
    for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) assert.equal(T.get(i, j), 0);
    // 2x2 blocks must be genuine complex pairs: no two consecutive nonzero subdiagonals
    for (let i = 1; i < n - 1; i++) assert.ok(T.get(i, i - 1) === 0 || T.get(i + 1, i) === 0);
    const { H, Q: Qh } = L.hessenberg(A);
    near(Qh.mul(H).mul(Qh.transpose()), A, 1e-13);
    for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) assert.equal(H.get(i, j), 0);
  }
});

// ---------------------------------------------------------------- SVD
test('SVD: reconstruction (tall, wide, square, thin and full), descending sigma', () => {
  for (const [m, n] of [[6, 6], [8, 3], [3, 8], [1, 4], [5, 1], [2, 2]]) {
    const A = rand(m, n, m * 7 + n);
    for (const full of [false, true]) {
      const { U, S, V } = L.svd(A, { full });
      const k = Math.min(m, n);
      assert.equal(S.length, k);
      assert.equal(U.rows, m); assert.equal(V.rows, n);
      assert.equal(U.cols, full ? m : k); assert.equal(V.cols, full ? n : k);
      near(U.transpose().mul(U), I(U.cols), 1e-13); near(V.transpose().mul(V), I(V.cols), 1e-13);
      near(U.mul(Matrix.diag(S, U.cols, V.cols)).mul(V.transpose()), A, 1e-13);
      for (let i = 1; i < k; i++) assert.ok(S[i] <= S[i - 1] && S[i] >= 0);
    }
  }
});

test('SVD: known singular values', () => {
  const s = L.svd([[3, 0], [0, 4]]).S; close(s[0], 4, 1e-14); close(s[1], 3, 1e-14);
  const r = L.svd([[1, 1], [1, 1]]).S; close(r[0], 2, 1e-14); assert.ok(r[1] < 1e-15);
  const phi = (1 + Math.sqrt(5)) / 2, f = L.svd([[1, 1], [1, 0]]).S; close(f[0], phi, 1e-14); close(f[1], 1 / phi, 1e-14);
  const Z = L.svd(Matrix.zeros(3, 2), { full: true });
  assert.deepEqual(Z.S, [0, 0]); near(Z.U.transpose().mul(Z.U), I(3), 1e-14);
  // orthogonal matrix: all sigma = 1
  const Q = L.qr(rand(5, 5, 3)).Q;
  L.svd(Q).S.forEach((v) => close(v, 1, 1e-13));
  // sigma^2 = eig(A^T A)
  const A = rand(6, 4, 9), ev = L.eigSym(A.transpose().mul(A)).values.slice().reverse();
  L.svd(A).S.forEach((v, i) => close(v * v, ev[i], 1e-12));
});

test('rank, nullspace, rowspace, pinv, cond, low-rank approximation', () => {
  const A = Matrix.from([[1, 2, 3], [2, 4, 6], [1, 0, 1]]);
  assert.equal(L.rank(A), 2);
  const N = L.nullspace(A); assert.equal(N.cols, 1);
  assert.ok(A.mul(N).maxAbs() < 1e-13);
  const Rs = L.rowspace(A); assert.equal(Rs.cols, 2);
  const Cs = L.colspace(A); assert.equal(Cs.cols, 2);
  assert.equal(L.leftNullspace(A).cols, 1);
  // Moore-Penrose conditions
  const B = rand(5, 3, 8), P = L.pinv(B);
  near(B.mul(P).mul(B), B, 1e-12); near(P.mul(B).mul(P), P, 1e-12);
  near(B.mul(P), B.mul(P).transpose(), 1e-12);
  near(L.pinv(A).mul(A).mul(L.pinv(A)), L.pinv(A), 1e-12);
  assert.equal(L.cond(I(4)), 1); assert.equal(L.cond(A), Infinity);
  const W = rand(7, 6, 14), { A: A2, S, error2, errorFro } = L.lowRank(W, 2);
  assert.equal(L.rank(A2), 2);
  close(L.svd(W.sub(A2)).S[0], S[2], 1e-12); close(error2, S[2], 1e-14);
  close(W.sub(A2).normFro(), errorFro, 1e-12);
  near(L.lowRank(W, 6).A, W, 1e-13);
  // polar: A = Q P, Q orthogonal, P SPD
  const { Q, P: Pp } = L.polar(rand(4, 4, 6));
  near(Q.transpose().mul(Q), I(4), 1e-13);
  assert.ok(Pp.isSymmetric(1e-13));
});

test('Hilbert matrix: ill-conditioned sanity', () => {
  const hilb = (n) => Matrix.fromFunction(n, n, (i, j) => 1 / (i + j + 1));
  close(L.cond(hilb(4)) / 15513.738738929, 1, 1e-6);
  const c8 = L.cond(hilb(8));
  assert.ok(c8 > 1.4e10 && c8 < 1.6e10, `cond(H8) = ${c8}`);
  assert.equal(L.rank(hilb(5)), 5);
  const n = 8, H = hilb(n), xTrue = Array.from({ length: n }, (_, i) => i + 1), b = H.matvec(xTrue);
  const x = L.solve(H, b); // accuracy limited by cond ~1e10: relative error well under 1e-4 but residual tiny
  const resid = H.matvec(x).map((v, i) => v - b[i]);
  assert.ok(Math.max(...resid.map(Math.abs)) < 1e-12);
  assert.ok(Math.max(...x.map((v, i) => Math.abs(v - xTrue[i]))) < 1e-3);
  const Lc = L.cholesky(hilb(8)); near(Lc.mul(Lc.transpose()), hilb(8), 1e-15);
  const Hi = L.inverse(hilb(5));
  close(Hi.get(0, 0), 25, 1e-9); close(Hi.get(4, 4), 44100, 1e-9);
});

// ---------------------------------------------------------------- matrix functions
test('expm: identities, rotation generator, nilpotent, diagonal, large norm', () => {
  for (const n of [1, 2, 4, 7]) {
    const A = rand(n, n, 200 + n).scale(3);
    near(L.expm(A).mul(L.expm(A.neg())), I(n), 1e-10);
    near(L.expm(A.scale(2)), L.expm(A).mul(L.expm(A)), 1e-8 * Math.max(1, L.expm(A.scale(2)).maxAbs()));
  }
  const th = 0.7, E = L.expm([[0, -th], [th, 0]]);
  near(E, L.rotation2(th), 1e-14);
  near(L.expm([[0, 1], [0, 0]]), Matrix.from([[1, 1], [0, 1]]), 1e-15);
  const D = L.expm(Matrix.diag([1, -2, 0.5]));
  [Math.E, Math.exp(-2), Math.exp(0.5)].forEach((v, i) => close(D.get(i, i), v, 1e-14));
  near(L.expm(Matrix.zeros(3, 3)), I(3), 0);
  // big norm requires scaling & squaring: rotation by 100 rad
  near(L.expm([[0, -100], [100, 0]]), L.rotation2(100), 1e-11);
  close(L.expm([[50]]).get(0, 0) / Math.exp(50), 1, 1e-12);
  // det(expm A) = exp(trace A)
  const A = rand(5, 5, 33); close(L.det(L.expm(A)), Math.exp(A.trace()), 1e-10);
});

test('expm via eigen decomposition (diagonalizable) matches Pade; funm / powers / sqrt', () => {
  for (const n of [2, 3, 5, 8]) {
    const A = rand(n, n, 300 + n);
    near(L.expmEig(A), L.expm(A), 1e-8, `n=${n}`);
  }
  const A = Matrix.from([[2, 1], [1, 3]]);
  const S = L.sqrtm(A);
  near(S.mul(S), A, 1e-12);
  near(L.matrixPower(A, 5), A.mul(A).mul(A).mul(A).mul(A), 1e-10);
  near(L.matrixPower(A, -2), L.inverse(A.mul(A)), 1e-12);
  near(L.matrixPower(A, 0), I(2), 0);
  const Ps = L.matrixPower(rand(3, 3, 5), 7); assert.equal(Ps.rows, 3);
  near(L.funm(Matrix.from([[0, -1], [1, 0]]), C.exp), L.rotation2(1), 1e-13);
  near(L.funm(A, (z) => [z[0] * z[0], z[1]]), A.mul(A), 1e-12);
  // sin^2 + cos^2 = I
  const B = rand(4, 4, 12), s = L.funm(B, C.sin), c = L.funm(B, C.cos);
  near(s.mul(s).add(c.mul(c)), I(4), 1e-9);
  const cm = L.funm(Matrix.from([[0, -1], [1, 0]]), C.exp, { complex: true });
  assert.ok(cm.maxImag() < 1e-14);
});

test('discretisation: ZOH (Ad, Bd) and Van Loan noise integral', () => {
  const dt = 0.1;
  const { Ad, Bd } = L.discretize([[0, 1], [0, 0]], [[0], [1]], dt); // double integrator
  near(Ad, Matrix.from([[1, dt], [0, 1]]), 1e-14);
  near(Bd, Matrix.from([[dt * dt / 2], [dt]]), 1e-14);
  const a = -2, d1 = L.discretize([[a]], [[3]], 0.5);
  close(d1.Ad.get(0, 0), Math.exp(-1), 1e-14); close(d1.Bd.get(0, 0), (3 / a) * (Math.exp(a * 0.5) - 1), 1e-14);
  close(L.expmIntegral([[a]], 0.5).get(0, 0), (Math.exp(a * 0.5) - 1) / a, 1e-14);
  // scalar noise: Qd = q (e^{2 a dt} - 1) / (2a)
  const nz = L.discretizeNoise([[a]], [[2]], 0.5);
  close(nz.Qd.get(0, 0), (2 * (Math.exp(2 * a * 0.5) - 1)) / (2 * a), 1e-13);
  // double integrator white-acceleration noise: Qd = q [[dt^3/3, dt^2/2],[dt^2/2, dt]]
  const dn = L.discretizeNoise([[0, 1], [0, 0]], [[0, 0], [0, 1]], dt);
  near(dn.Qd, Matrix.from([[dt ** 3 / 3, dt ** 2 / 2], [dt ** 2 / 2, dt]]), 1e-15);
  // semigroup: two half steps = one step
  const A = rand(3, 3, 8), B = rand(3, 2, 9), h = L.discretize(A, B, 0.2), f = L.discretize(A, B, 0.4);
  near(h.Ad.mul(h.Ad), f.Ad, 1e-13);
  near(h.Ad.mul(h.Bd).add(h.Bd), f.Bd, 1e-13);
});

test('characteristic polynomial (Faddeev-LeVerrier) and Jordan structure', () => {
  assert.deepEqual(L.charPoly([[2, 0], [0, 3]]).map((v) => Math.abs(v) < 1e-14 ? 0 : v), [1, -5, 6]);
  const cp = L.charPoly([[0, 1, 0], [0, 0, 1], [-6, -11, -6]]);
  [1, 6, 11, 6].forEach((v, i) => close(cp[i], v, 1e-13));
  const A = rand(5, 5, 6), p = L.charPoly(A);
  close(p[1], -A.trace(), 1e-13); close(p[5], -L.det(A), 1e-10); // (-1)^n det with n=5
  near(L.polyvalm(p, A), Matrix.zeros(5, 5), 1e-9); // Cayley-Hamilton
  closeSets(L.eigvalsFromCharPoly([[1, 2], [3, 4]]), L.eigvals([[1, 2], [3, 4]]), 1e-12);
  assert.deepEqual(L.polyFromRoots([1, 2, 3]).map((v) => Math.round(v)), [1, -6, 11, -6]);
  close(L.polyFromRoots([[0, 1], [0, -1]])[2], 1, 1e-15);

  let J = L.jordanForm([[2, 1], [0, 2]]);
  assert.equal(J.defective, true); assert.deepEqual(J.blocks[0].sizes, [2]); assert.equal(J.blocks[0].geometric, 1);
  J = L.jordanForm([[2, 0], [0, 2]]);
  assert.equal(J.diagonalizable, true); assert.deepEqual(J.blocks[0].sizes, [1, 1]);
  J = L.jordanForm([[2, 1, 0], [0, 2, 0], [0, 0, 2]]);
  assert.deepEqual(J.blocks[0].sizes, [2, 1]);
  J = L.jordanForm([[3, 1, 0], [0, 3, 1], [0, 0, 3]]);
  assert.deepEqual(J.blocks[0].sizes, [3]);
  J = L.jordanForm([[1, 0, 0], [0, 2, 0], [0, 0, 3]]);
  assert.equal(J.blocks.length, 3); assert.equal(J.defective, false);
  J = L.jordanForm([[0, -1], [1, 0]]);
  assert.equal(J.blocks.length, 1); assert.equal(J.diagonalizable, true);
  // similarity transform of a Jordan block still detected
  const S = Matrix.from([[1, 2, 0], [0, 1, 1], [1, 0, 1]]), Jb = Matrix.from([[-1, 1, 0], [0, -1, 0], [0, 0, 4]]);
  J = L.jordanForm(S.mul(Jb).mul(L.inverse(S)));
  const m1 = J.blocks.find((b) => Math.abs(b.value[0] + 1) < 1e-3);
  assert.deepEqual(m1.sizes, [2]);
});

// ---------------------------------------------------------------- Lyapunov / Riccati / control
test('Lyapunov equations: residuals, Gramians, known scalar solutions', () => {
  const A = Matrix.from([[-1, 2, 0], [0, -3, 1], [-1, 0, -2]]), Q = I(3);
  const X = L.lyap(A, Q);
  assert.ok(L.lyapResidual(A, X, Q) < 1e-12);
  assert.ok(X.isSymmetric(1e-12)); assert.ok(L.isPositiveDefinite(X));
  close(L.lyap([[-2]], [[4]]).get(0, 0), 1, 1e-14); // -2x -2x + 4 = 0
  const S = rand(4, 4, 70).scale(0.2), Qd = I(4), Xd = L.dlyap(S, Qd);
  assert.ok(L.dlyapResidual(S, Xd, Qd) < 1e-12);
  close(L.dlyap([[0.5]], [[3]]).get(0, 0), 4, 1e-14);
  const Ss = L.sylvester([[1, 2], [0, 3]], [[4]], [[5], [6]]);
  near(Matrix.from([[1, 2], [0, 3]]).mul(Ss).add(Ss.mul([[4]])), Matrix.from([[5], [6]]), 1e-13);
  // Gramian of x' = -x + u: W = 1/2
  close(L.gramianC([[-1]], [[1]]).get(0, 0), 0.5, 1e-14);
  close(L.gramianO([[-1]], [[2]]).get(0, 0), 2, 1e-14);
  // n = 8 stays tight
  const A8 = rand(8, 8, 71).sub(I(8).scale(4)), Q8 = I(8), X8 = L.lyap(A8, Q8);
  assert.ok(L.lyapResidual(A8, X8, Q8) < 1e-11);
});

const pendulum = () => {
  const M = 0.5, m = 0.2, b = 0.1, Ip = 0.006, g = 9.8, l = 0.3, p = Ip * (M + m) + M * m * l * l;
  return {
    A: Matrix.from([[0, 1, 0, 0], [0, -(Ip + m * l * l) * b / p, (m * m * g * l * l) / p, 0], [0, 0, 0, 1], [0, -(m * l * b) / p, (m * g * l * (M + m)) / p, 0]]),
    B: Matrix.column([0, (Ip + m * l * l) / p, 0, (m * l) / p]),
  };
};

test('CARE: closed forms and residuals (double integrator, scalar, pendulum, random)', () => {
  // scalar: a=1, b=1, q=1, r=1 -> p^2 - 2p - 1 = 0 -> p = 1 + sqrt(2)
  const s = L.care([[1]], [[1]], [[1]], [[1]]);
  close(s.P.get(0, 0), 1 + Math.SQRT2, 1e-12); close(s.K.get(0, 0), 1 + Math.SQRT2, 1e-12);
  assert.ok(s.poles[0][0] < 0);
  // double integrator, Q = I, R = 1 -> P = [[sqrt3, 1],[1, sqrt3]]
  const d = L.care([[0, 1], [0, 0]], [[0], [1]], I(2), [[1]]);
  near(d.P, Matrix.from([[Math.sqrt(3), 1], [1, Math.sqrt(3)]]), 1e-12);
  assert.ok(d.residual < 1e-12);
  // inverted pendulum on a cart (open loop unstable)
  const { A, B } = pendulum();
  assert.ok(L.eigvals(A).some((z) => z[0] > 1));
  for (const [qs, r] of [[[1, 0, 1, 0], 1], [[10, 0, 100, 0], 0.1], [[1000, 1, 1000, 1], 1], [[1, 1, 1, 1], 100]]) {
    const out = L.lqr(A, B, Matrix.diag(qs), [[r]]);
    assert.ok(out.residual < 1e-9, `residual ${out.residual}`);
    out.poles.forEach((z) => assert.ok(z[0] < 0));
    assert.ok(L.isPositiveDefinite(out.P));
    assert.equal(out.K.rows, 1); assert.equal(out.K.cols, 4);
  }
  // random stabilizable systems, MIMO
  for (let seed = 1; seed <= 6; seed++) {
    const n = 2 + (seed % 4), m = 1 + (seed % 2), Ar = rand(n, n, 500 + seed).scale(2), Br = rand(n, m, 600 + seed);
    const Qr = Matrix.diag(Array.from({ length: n }, (_, i) => 1 + i)), Rr = Matrix.diag(Array.from({ length: m }, (_, i) => 1 + i));
    if (!L.isControllable(Ar, Br)) continue;
    const out = L.care(Ar, Br, Qr, Rr);
    assert.ok(out.residual < 1e-9, `seed ${seed}: residual ${out.residual}`);
    out.poles.forEach((z) => assert.ok(z[0] < 0));
  }
});

test('DARE: scalar closed form, residuals, stabilising gain', () => {
  // scalar a=1,b=1,q=1,r=1: x^2 - x - 1 = 0 -> golden ratio
  const g = L.dare([[1]], [[1]], [[1]], [[1]]);
  close(g.P.get(0, 0), (1 + Math.sqrt(5)) / 2, 1e-12);
  assert.ok(Math.abs(g.poles[0][0]) < 1);
  const { A, B } = pendulum(), { Ad, Bd } = L.discretize(A, B, 0.02);
  const out = L.dlqr(Ad, Bd, Matrix.diag([10, 0, 100, 0]), [[1]]);
  assert.ok(out.residual < 1e-9, `residual ${out.residual}`);
  out.poles.forEach((z) => assert.ok(Math.hypot(z[0], z[1]) < 1));
  // matches the finite-horizon Riccati recursion run to convergence
  let P = Matrix.diag([10, 0, 100, 0]);
  const Q = Matrix.diag([10, 0, 100, 0]);
  for (let k = 0; k < 20000; k++) {
    const BtP = Bd.transpose().mul(P), K = L.solve(Matrix.from([[1]]).add(BtP.mul(Bd)), BtP.mul(Ad));
    const Pn = Ad.transpose().mul(P).mul(Ad).sub(Ad.transpose().mul(P).mul(Bd).mul(K)).add(Q);
    if (L.maxDiff(Pn, P) < 1e-13 * Pn.maxAbs()) { P = Pn; break; }
    P = Pn;
  }
  near(out.P, P, 1e-6 * out.P.maxAbs());
  for (let seed = 1; seed <= 5; seed++) {
    const n = 2 + (seed % 3), Ar = rand(n, n, 800 + seed), Br = rand(n, 1, 900 + seed);
    const o = L.dare(Ar, Br, I(n), [[1]]);
    assert.ok(o.residual < 1e-9, `seed ${seed}: ${o.residual}`);
    o.poles.forEach((z) => assert.ok(Math.hypot(z[0], z[1]) < 1));
  }
});

test('controllability / observability matrices and pole placement', () => {
  const { A, B } = pendulum();
  assert.equal(L.ctrbRank(A, B), 4);
  assert.deepEqual(L.ctrb([[0, 1], [0, 0]], [[0], [1]]).toArray(), [[0, 1], [1, 0]]);
  assert.deepEqual(L.obsv([[0, 1], [0, 0]], [[1, 0]]).toArray(), [[1, 0], [0, 1]]);
  assert.equal(L.obsvRank(A, [[1, 0, 0, 0]]), 4); // cart position alone observes the full state
  assert.equal(L.obsvRank([[1, 0], [0, 2]], [[1, 0]]), 1);
  assert.equal(L.isObservable(A, [[1, 0, 0, 0], [0, 0, 1, 0]]), true);
  assert.equal(L.isControllable([[1, 0], [0, 1]], [[1], [0]]), false);
  const K = L.acker(A, B, [-2, -3, [-1, 1], [-1, -1]]);
  closeSets(L.eigvals(A.sub(B.mul(K))), [[-2, 0], [-3, 0], [-1, 1], [-1, -1]], 1e-6);
  const Lg = L.observerGain(A, [[1, 0, 0, 0]], [-5, -6, -7, -8]);
  assert.equal(Lg.rows, 4);
  closeSets(L.eigvals(A.sub(Lg.mul([[1, 0, 0, 0]]))), [[-5, 0], [-6, 0], [-7, 0], [-8, 0]], 1e-5);
});

// ---------------------------------------------------------------- small closed forms and solvers
test('2x2 helpers: eigenvalues, classification, SVD angles, polar, area scale', () => {
  let e = L.eig2x2(2, 1, 1, 2);
  close(e.values[0][0], 3, 1e-14); close(e.values[1][0], 1, 1e-14); assert.equal(e.kind, 'real');
  e = L.eig2x2(0, -2, 2, 0);
  assert.equal(e.kind, 'complex'); close(e.values[0][1], 2, 1e-14); close(e.values[1][1], -2, 1e-14);
  e = L.eig2x2(2, 1, 0, 2); assert.equal(e.defective, true); assert.equal(e.kind, 'repeated');
  assert.equal(L.eig2x2(2, 0, 0, 2).defective, false);
  // A v = lambda v for random 2x2
  const r = rng(5);
  for (let t = 0; t < 50; t++) {
    const [a, b, c, d] = [r() * 4 - 2, r() * 4 - 2, r() * 4 - 2, r() * 4 - 2], ee = L.eig2x2(a, b, c, d);
    ee.values.forEach((lam, k) => {
      const v = ee.vectors[k];
      const Av = [[a * v[0][0] + b * v[1][0], a * v[0][1] + b * v[1][1]], [c * v[0][0] + d * v[1][0], c * v[0][1] + d * v[1][1]]];
      const lv = [C.mul(lam, v[0]), C.mul(lam, v[1])];
      assert.ok(Math.hypot(Av[0][0] - lv[0][0], Av[0][1] - lv[0][1], Av[1][0] - lv[1][0], Av[1][1] - lv[1][1]) < 1e-12);
    });
    closeSets(ee.values, L.eigvals([[a, b], [c, d]]), 1e-12);
    // SVD angles reconstruct A, including det < 0
    const s = L.svd2x2(a, b, c, d);
    const rec = s.U.mul(Matrix.diag([s.s1, s.sign * s.s2])).mul(s.V.transpose());
    near(rec, Matrix.from([[a, b], [c, d]]), 1e-12);
    const ref = L.svd([[a, b], [c, d]]).S;
    close(s.s1, ref[0], 1e-12); close(s.s2, ref[1], 1e-12);
    close(s.s1 * s.s2, L.areaScale([[a, b], [c, d]]), 1e-12);
    // polar
    const p = L.polar2x2(a, b, c, d);
    near(p.Q.mul(p.P), Matrix.from([[a, b], [c, d]]), 1e-12);
    near(p.Q.transpose().mul(p.Q), I(2), 1e-12);
    assert.ok(p.P.isSymmetric(1e-12));
    assert.equal(p.reflection, a * d - b * c < 0);
  }
  assert.equal(L.classify2x2(-1, 0, 0, -2), 'stable node');
  assert.equal(L.classify2x2(1, 0, 0, 2), 'unstable node');
  assert.equal(L.classify2x2(1, 0, 0, -1), 'saddle');
  assert.equal(L.classify2x2(0, 1, -1, 0), 'center');
  assert.equal(L.classify2x2(-1, 1, -1, -1), 'stable spiral');
  assert.equal(L.classify2x2(1, 1, -1, 1), 'unstable spiral');
  assert.equal(L.classify2x2(-1, 1, 0, -1), 'stable degenerate node');
  assert.equal(L.classify2x2(-1, 0, 0, -1), 'stable star');
  assert.equal(L.classify2x2(0, 0, 0, -1), 'line of equilibria');
  close(L.areaScale([[2, 0], [0, -3]]), 6, 1e-15);
});

test('3x3 helpers', () => {
  const A = rand(3, 3, 17);
  close(L.det3(A), L.det(A), 1e-13);
  near(A.mul(L.inv3(A)), I(3), 1e-12);
  assert.throws(() => L.inv3([[1, 2, 3], [2, 4, 6], [0, 0, 1]]));
  assert.deepEqual(L.cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  const S = A.add(A.transpose()), ev = L.eigSym3Values(S), ref = L.eigSym(S).values;
  ev.forEach((v, i) => close(v, ref[i], 1e-12));
  assert.deepEqual(L.eigSym3Values(Matrix.diag([3, 1, 2])), [1, 2, 3]);
});

test('tridiagonal (Thomas), cyclic tridiagonal, conjugate gradient', () => {
  const n = 50, sub = new Array(n).fill(-1), diag = new Array(n).fill(2.5), sup = new Array(n).fill(-1);
  const T = Matrix.fromFunction(n, n, (i, j) => (i === j ? 2.5 : Math.abs(i - j) === 1 ? -1 : 0));
  const b = Array.from({ length: n }, (_, i) => Math.cos(i)), x = L.solveTridiagonal(sub, diag, sup, b);
  const y = L.solve(T, b);
  x.forEach((v, i) => close(v, y[i], 1e-12));
  // cyclic
  const Cc = T.clone(); Cc.set(0, n - 1, -1); Cc.set(n - 1, 0, -1);
  const xc = L.solveCyclicTridiagonal(sub, diag, sup, b), yc = L.solve(Cc, b);
  xc.forEach((v, i) => close(v, yc[i], 1e-11));
  // CG on SPD
  const B = rand(30, 30, 99), A = B.mul(B.transpose()).add(I(30).scale(2)), rhs = Array.from({ length: 30 }, (_, i) => i - 10);
  const cg = L.conjugateGradient(A, rhs, { tol: 1e-12 });
  assert.ok(cg.converged); assert.ok(cg.iterations <= 60);
  const ref = L.solve(A, rhs);
  cg.x.forEach((v, i) => close(v, ref[i], 1e-8));
  assert.ok(cg.history[cg.history.length - 1] < cg.history[0]);
  const pc = L.conjugateGradient(T, b, { tol: 1e-12, precondition: true });
  assert.ok(pc.converged);
  const fn = L.conjugateGradient((v) => T.matvec(v), b, { tol: 1e-12 });
  fn.x.forEach((v, i) => close(v, y[i], 1e-9));
  // 1-D Poisson converges in <= n iterations (exact arithmetic)
  assert.ok(L.conjugateGradient(T, b, { tol: 1e-10 }).iterations <= n);
});

// ---------------------------------------------------------------- performance
test('performance sanity: n = 100', () => {
  const n = 100, A = rand(n, n, 2024), t0 = Date.now();
  const lap = (label, f, limit) => {
    const t = Date.now();
    const out = f();
    const dt = Date.now() - t;
    assert.ok(dt < limit, `${label} took ${dt} ms`);
    return out;
  };
  const x = lap('solve', () => L.solve(A, new Array(n).fill(1)), 2000);
  assert.ok(Math.max(...L.matvec(A, x).map((v) => Math.abs(v - 1))) < 1e-6);
  const { Q, R } = lap('qr', () => L.qr(A), 3000);
  near(Q.mul(R), A, 1e-11);
  const e = lap('eig', () => L.eig(A), 8000);
  assert.equal(e.values.length, n);
  const s = lap('svd', () => L.svd(A), 8000);
  near(s.U.mul(Matrix.diag(s.S)).mul(s.V.transpose()), A, 1e-11);
  const E = lap('expm', () => L.expm(A.scale(0.1)), 3000);
  near(E.mul(L.expm(A.scale(-0.1))), I(n), 1e-8);
  const Sy = A.add(A.transpose()), es = lap('eigSym', () => L.eigSym(Sy), 8000);
  near(es.vectors.mul(Matrix.diag(es.values)).mul(es.vectors.transpose()), Sy, 1e-10);
  assert.ok(Date.now() - t0 < 30000);
});
