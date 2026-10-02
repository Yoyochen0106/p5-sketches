/**
 * lib/linalg.js -- dense linear algebra for the engineering-math and control courses (pure, Node-testable).
 *
 * Canonical type: `Matrix` (row-major Float64Array). Every function also accepts nested arrays.
 * Vectors are plain number[]; complex numbers are [re, im]; complex matrices are `CMatrix`.
 *
 *   matrix.js   Matrix, CMatrix, add/sub/mul/scale/transpose/trace/matvec, norms, hcat/vcat/blocks/kron
 *   decomp.js   lu, luSolve, solve, inverse, det, cholesky, choleskySolve, qr, lstsq, gramSchmidt
 *   eigen.js    hessenberg, schur (real), eigvals, eig (complex values + vectors), eigSym (Jacobi)
 *   svd.js      svd (thin/full), singularValues, rank, cond, pinv, lowRank, nullspace/rowspace/colspace, polar
 *   matfun.js   expm, expmIntegral, discretize (ZOH, Van Loan), discretizeNoise, funm, matrixPower, sqrtm,
 *               charPoly (Faddeev-LeVerrier), polyRootsHigh, polyFromRoots, companion, jordanForm
 *   control.js  sylvester, lyap, dlyap, care, dare, lqr, dlqr, ctrb, obsv, ranks, gramians, acker, observerGain
 *   small.js    eig2x2, classify2x2, svd2x2, polar2x2, areaScale, det3/inv3/cross3, eigSym3Values,
 *               solveTridiagonal, solveCyclicTridiagonal, conjugateGradient
 */
export * from './linalg/matrix.js';
export * from './linalg/decomp.js';
export * from './linalg/eigen.js';
export * from './linalg/svd.js';
export * from './linalg/matfun.js';
export * from './linalg/control.js';
export * from './linalg/small.js';
