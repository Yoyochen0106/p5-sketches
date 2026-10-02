import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gaussLegendre, jacobian2, div2, curl2, div3, curl3, makeField2, makeField3, PRESETS_2D, PRESETS_3D,
  streamline2, streamline3, licField, eigen2, polygonArea, polygonOrientation, pointInPolygon, circlePolygon, rectPolygon,
  triangulate, integratePolygon, lineIntegrals, pathIntegral2, bumpPath, greenCheck, cellCancellation,
  potentialFromField2, streamFunction2, potentialError, poissonResidual, classifyField2,
  helmholtz2, gridFromField2, spectralDivCurl, blobField2, surfaceFlux, volumeIntegral, divergenceTheorem3, surfaceVolume,
  circleLoop3, stokes3, circulation3Circle,
} from '../../lib/vectorcalc.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b} (eps ${eps})`);
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('Gauss-Legendre integrates polynomials exactly', () => {
  const { x, w } = gaussLegendre(5);
  let s = 0;
  for (let i = 0; i < 5; i++) s += w[i] * x[i] ** 8;
  close(s, 2 / 9, 1e-13);
  close(w.reduce((a, b) => a + b, 0), 2, 1e-13);
});

test('div / curl of known fields', () => {
  const r = (x, y) => [x, y], rot = (x, y) => [-y, x], g = (x, y) => [2 * x * y, x * x];
  close(div2(r, 0.3, -0.7), 2, 1e-8); close(curl2(r, 0.3, -0.7), 0, 1e-8);
  close(div2(rot, 1, 2), 0, 1e-8); close(curl2(rot, 1, 2), 2, 1e-8);
  close(div2(g, 0.4, 0.9), 1.8, 1e-7); close(curl2(g, 0.4, 0.9), 0, 1e-7);
  const r3 = (x, y, z) => [x, y, z];
  close(div3(r3, 1, 2, 3), 3, 1e-8);
  const c = curl3((x, y) => [-y, x, 0], 1, 2, 3);
  close(c[2], 2, 1e-8); close(c[0], 0, 1e-8);
  for (const p of PRESETS_2D.filter((q) => q.jac)) {
    const num = jacobian2(p.f, 0.37, -0.52);
    const an = p.jac(0.37, -0.52);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) close(num[i][j], an[i][j], 1e-6, `${p.id} J${i}${j}`);
  }
  for (const p of PRESETS_3D.filter((q) => q.jac)) {
    const f = makeField3(p.f), a = makeField3(p.f, p.jac);
    const x = [0.31, -0.42, 0.77];
    close(f.div(...x), a.div(...x), 1e-6, p.id);
    f.curl(...x).forEach((v, i) => close(v, a.curl(...x)[i], 1e-6, p.id));
  }
});

test('Green and divergence theorem agree to 1e-3 on random polygons', () => {
  const fields = [
    makeField2((x, y) => [x * x * y, Math.sin(x) + y * y], (x, y) => [[2 * x * y, x * x], [Math.cos(x), 2 * y]]),
    makeField2((x, y) => [-y + 0.3 * x, x + Math.cos(y)]),
    makeField2(PRESETS_2D.find((p) => p.id === 'lv').f),
  ];
  const rand = rng(11);
  for (let t = 0; t < 12; t++) {
    const n = 5 + Math.floor(rand() * 9);
    const angles = Array.from({ length: n }, (_, i) => ((i + 0.1 + 0.8 * rand()) / n) * 2 * Math.PI);
    const pts = angles.map((a) => { const r = 0.6 + rand() * 1.0; return [0.2 + r * Math.cos(a), -0.1 + r * Math.sin(a)]; });
    const rev = t % 2 ? pts.slice().reverse() : pts;
    for (const F of fields) {
      const g = greenCheck(F, rev);
      close(g.circulation, g.curlIntegral, 1e-3, `green t${t}`);
      close(g.flux, g.divIntegral, 1e-3, `div t${t}`);
    }
  }
});

test('polygon helpers: area, orientation, triangulation of a concave polygon', () => {
  const sq = rectPolygon(0, 0, 2, 3);
  close(polygonArea(sq), 6, 1e-12);
  assert.equal(polygonOrientation(sq.slice().reverse()), -1);
  const L = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  assert.equal(triangulate(L).length, 4);
  close(integratePolygon(() => 1, L), 3, 1e-12);
  assert.ok(pointInPolygon(L, 0.5, 1.5) && !pointInPolygon(L, 1.5, 1.5));
  close(integratePolygon((x) => x, circlePolygon(0, 0, 1, 256)), 0, 1e-12);
});

test('circulation of a rigid vortex equals 2 * area; flux of a source equals 2 * area', () => {
  const poly = circlePolygon(0.5, 0.2, 1.3, 200);
  const A = polygonArea(poly);
  close(lineIntegrals((x, y) => [-y, x], poly).circulation, 2 * A, 1e-9);
  close(lineIntegrals((x, y) => [x, y], poly).rawFlux, 2 * A, 1e-9);
});

test('cell cancellation: interior edges cancel exactly', () => {
  const F = (x, y) => [Math.sin(y) + x * y, Math.cos(x) * y];
  const c = cellCancellation(F, circlePolygon(0, 0, 1.2, 64), 7);
  assert.ok(c.cells.length > 10 && c.exposed.length > 8);
  close(c.sumCells, c.boundaryCirc, 1e-10);
  const rect = cellCancellation(F, rectPolygon(-1, -1, 1, 1), 5);
  close(rect.sumCells, lineIntegrals(F, rectPolygon(-1, -1, 1, 1, 5)).circulation, 1e-10);
});

test('path independence for conservative fields, dependence otherwise', () => {
  const a = [-1, 0.2], b = [1.2, 0.9];
  const g = PRESETS_2D.find((p) => p.id === 'gradient').f;
  close(pathIntegral2(g, [a, b]), pathIntegral2(g, bumpPath(a, b, 0.7)), 1e-7);
  close(pathIntegral2(g, [a, b]), 1.2 * 1.2 * 0.9 - 1 * 0.2, 1e-9); // phi = x^2 y
  const vtx = PRESETS_2D.find((p) => p.id === 'vortex').f;
  assert.ok(Math.abs(pathIntegral2(vtx, [a, b]) - pathIntegral2(vtx, bumpPath(a, b, 0.7))) > 0.1);
});

test('streamlines: rotation stays on a circle, saddle follows xy = const', () => {
  const s = streamline2((x, y) => [-y, x], 1, 0, { h: 0.05, maxSteps: 200 });
  for (let i = 0; i < s.count; i++) close(Math.hypot(s.pts[2 * i], s.pts[2 * i + 1]), 1, 1e-6);
  const t = streamline2((x, y) => [x, -y], 0.5, 2, { h: 0.02, maxSteps: 100 });
  for (let i = 0; i < t.count; i++) close(t.pts[2 * i] * t.pts[2 * i + 1], 1, 1e-6);
  assert.equal(streamline2(() => [0, 0], 0, 0).reason, 'stagnation');
  const u = streamline3((x, y) => [-y, x, 0.5], 1, 0, 0, { h: 0.05, maxSteps: 50 });
  assert.equal(u.count, 51);
  close(Math.hypot(u.pts[150], u.pts[151]), 1, 1e-6);
});

test('LIC texture is deterministic and finite', () => {
  const b = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
  const a = licField((x, y) => [-y, x], b, 24, 24);
  const c = licField((x, y) => [-y, x], b, 24, 24);
  assert.deepEqual(Array.from(a.lic), Array.from(c.lic));
  assert.ok(a.lic.every((v) => v >= 0 && v <= 1) && a.mag.every(Number.isFinite));
});

test('eigen-structure of the Jacobian', () => {
  assert.equal(eigen2([[1, 0], [0, -1]]).type, 'saddle');
  assert.equal(eigen2([[0, -1], [1, 0]]).type, 'centre');
  assert.equal(eigen2([[0.4, -1], [1, 0.4]]).type, 'unstable spiral');
  assert.equal(eigen2([[-1, 0], [0, -3]]).type, 'stable node');
  const e = eigen2([[2, 1], [1, 2]]);
  close(e.l1.re, 3, 1e-12); close(e.l2.re, 1, 1e-12);
  close(Math.abs(e.v1[0]), Math.SQRT1_2, 1e-12);
  const J = [[3, 1], [0, 2]], q = eigen2(J);
  close(J[0][0] * q.v2[0] + J[0][1] * q.v2[1], q.l2.re * q.v2[0], 1e-12);
});

test('3D divergence theorem: sphere, cube, cylinder', () => {
  const P = PRESETS_3D.find((p) => p.id === 'poly');
  const F = makeField3(P.f, P.jac);
  const c = [0.3, -0.2, 0.1];
  for (const [kind, size] of [['sphere', { R: 1.1 }], ['cube', { a: 0.9 }], ['cylinder', { R: 0.8, H: 1.2 }]]) {
    const r = divergenceTheorem3(F, kind, c, size, 12);
    close(r.flux, r.divIntegral, 1e-8, kind);
    close(volumeIntegral(() => 1, kind, c, size, 6), surfaceVolume(kind, size), 1e-9, kind);
  }
  const X = makeField3((x, y, z) => [x, y, z]);
  close(surfaceFlux(X.f, 'sphere', [0, 0, 0], { R: 2 }, 8), 3 * (4 / 3) * Math.PI * 8, 1e-9);
});

test('Gauss law: flux of r/|r|^3 is 4 pi when the origin is inside, 0 otherwise', () => {
  const f = PRESETS_3D.find((p) => p.id === 'coulomb').f;
  close(surfaceFlux(f, 'sphere', [0, 0, 0], { R: 1.5 }, 16), 4 * Math.PI, 1e-4);
  close(surfaceFlux(f, 'cube', [0.2, 0.1, -0.1], { a: 1 }, 16), 4 * Math.PI, 1e-3);
  close(surfaceFlux(f, 'sphere', [4, 0, 0], { R: 1 }, 16), 0, 1e-6);
});

test('Stokes in 3D: disc and spherical caps of both signs give the same flux', () => {
  const P = PRESETS_3D.find((p) => p.id === 'poly');
  const F = makeField3(P.f, P.jac);
  const c = [0.2, 0.1, -0.3], nrm = [0.3, -0.5, 0.8], r = 0.9;
  const circ = circulation3Circle(F.f, c, nrm, r);
  for (const h of [0, 0.3, 0.9, 1.6, -0.4, -1.2]) {
    const s = stokes3(F, c, nrm, r, h, 16);
    close(s.circulation, circ, 1e-12);
    close(s.curlFlux, s.circulation, 1e-6, `h=${h}`);
  }
  const rot = makeField3((x, y) => [-y, x, 0]);
  close(circulation3Circle(rot.f, [0, 0, 0], [0, 0, 1], 1.5), 2 * Math.PI * 1.5 * 1.5, 1e-10);
  assert.equal(circleLoop3([0, 0, 0], [0, 0, 1], 1, 8).length, 8);
});

test('potential reconstruction of a conservative field and its stream function', () => {
  const b = { xmin: -2, xmax: 2, ymin: -1.5, ymax: 1.5 };
  const g = PRESETS_2D.find((p) => p.id === 'gradient');
  const pot = potentialFromField2(g.f, [0, 0], b, 41, 31);
  let maxErr = 0;
  for (let j = 0; j < 31; j++) for (let i = 0; i < 41; i++) maxErr = Math.max(maxErr, Math.abs(pot.phi[j * 41 + i] - (b.xmin + i * 0.1) ** 2 * (b.ymin + j * 0.1)));
  assert.ok(maxErr < 1e-10, `potential error ${maxErr}`);
  assert.ok(potentialError(g.f, pot) < 0.05);
  assert.ok(poissonResidual(makeField2(g.f, g.jac), pot) < 0.05);
  const bump = PRESETS_2D.find((p) => p.id === 'bump');
  const pb = potentialFromField2(bump.f, [0, 0], b, 61, 45);
  close(pb.phi[0], Math.exp(-(4 + 2.25) / 2) - 1, 1e-6);
  const cells = PRESETS_2D.find((p) => p.id === 'cells');
  const psi = streamFunction2(cells.f, [0, 0], b, 41, 31);
  // psi = sin x sin y at (0.5, 0.5): node i = 25, j = 20
  close(psi.phi[20 * 41 + 25], Math.sin(0.5) * Math.sin(0.5), 1e-9);
  const k = classifyField2(makeField2(g.f, g.jac), b);
  assert.equal(k.curlFree, true); assert.equal(k.divFree, false);
  const kc = classifyField2(makeField2(cells.f, cells.jac), b);
  assert.equal(kc.divFree, true); assert.equal(kc.curlFree, false);
});

test('Helmholtz decomposition reconstructs the field and separates the parts', () => {
  const n = 32, L = 2 * Math.PI;
  // F = grad(sin x cos y) + (psi_y, -psi_x) with psi = sin(2x) sin(y), plus a constant
  const f = (x, y) => [Math.cos(x) * Math.cos(y) + Math.sin(2 * x) * Math.cos(y) + 0.5,
    -Math.sin(x) * Math.sin(y) - 2 * Math.cos(2 * x) * Math.sin(y) - 0.25];
  const grid = gridFromField2(f, 0, 0, L, n);
  const h = helmholtz2(grid.fx, grid.fy, n, L);
  let rec = 0, errG = 0, errS = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = (i * L) / n, y = (j * L) / n;
      rec = Math.max(rec, Math.abs(h.gx[k] + h.sx[k] + h.mx - grid.fx[k]), Math.abs(h.gy[k] + h.sy[k] + h.my - grid.fy[k]));
      errG = Math.max(errG, Math.abs(h.gx[k] - Math.cos(x) * Math.cos(y)), Math.abs(h.gy[k] + Math.sin(x) * Math.sin(y)));
      errS = Math.max(errS, Math.abs(h.sx[k] - Math.sin(2 * x) * Math.cos(y)), Math.abs(h.sy[k] + 2 * Math.cos(2 * x) * Math.sin(y)));
    }
  }
  assert.ok(rec < 1e-12 && errG < 1e-10 && errS < 1e-10, `${rec} ${errG} ${errS}`);
  close(h.mx, 0.5, 1e-12); close(h.my, -0.25, 1e-12);
  const dc = spectralDivCurl(h.gx, h.gy, n, L), ds = spectralDivCurl(h.sx, h.sy, n, L);
  assert.ok(maxAbs(dc.curl) < 1e-10 && maxAbs(ds.div) < 1e-10);
});

test('Helmholtz of Gaussian blobs: sources are curl-free, vortices are divergence-free', () => {
  const n = 64, L = 8;
  const src = gridFromField2(blobField2([{ x: 4, y: 4, s: 0.5, a: 1, kind: 'source' }]), 0, 0, L, n);
  const vor = gridFromField2(blobField2([{ x: 4, y: 4, s: 0.5, a: 1, kind: 'vortex' }]), 0, 0, L, n);
  const a = helmholtz2(src.fx, src.fy, n, L), b = helmholtz2(vor.fx, vor.fy, n, L);
  assert.ok(maxAbs(a.sx) < 1e-6 && maxAbs(a.sy) < 1e-6 && maxAbs(b.gx) < 1e-6 && maxAbs(b.gy) < 1e-6);
});

test('spanningSurfacePoint: rim lies on the loop, apex at height h, normals unit length', async () => {
  const { spanningSurfacePoint: sp } = await import('../../lib/vectorcalc.js');
  const c = [0.2, 0.1, -0.3], nrm = [0, 0, 1], r = 0.9;
  for (const h of [0, 0.4, 1.5, -0.6]) {
    const rim = sp(c, nrm, r, h, 1, 0.7);
    close(Math.hypot(rim.p[0] - c[0], rim.p[1] - c[1]), r, 1e-9, `h=${h}`);
    close(rim.p[2], c[2], 1e-9, `h=${h}`);
    close(Math.hypot(...rim.n), 1, 1e-12);
    const apex = sp(c, nrm, r, h, 0, 0);
    close(apex.p[2], c[2] + h, 1e-9, `apex h=${h}`);
  }
});
