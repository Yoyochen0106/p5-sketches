import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_DEFS, createSurface, localGeometry, christoffel, christoffelNumeric, principalDirections, dupinIndicatrix,
  meshSurface, projectToSurface, naturalSpline, wrapUV, symmetricScale,
} from '../../lib/surfaces.js';
import { close } from './helpers.js';

const mid = (S, fu = 0.37, fv = 0.41) => {
  const d = S.domain;
  return [d.u0 + (d.u1 - d.u0) * fu, d.v0 + (d.v1 - d.v0) * fv];
};

test('analytic derivatives agree with finite differences for every surface', () => {
  for (const def of SURFACE_DEFS) {
    const S = createSurface(def.id);
    const [u, v] = mid(S);
    const h = 1e-5;
    const e = (a, b) => S.eval(a, b);
    const c = e(u, v);
    for (let k = 0; k < 3; k++) {
      close((e(u + h, v).r[k] - e(u - h, v).r[k]) / (2 * h), c.ru[k], 1e-6, `${def.id} ru`);
      close((e(u, v + h).r[k] - e(u, v - h).r[k]) / (2 * h), c.rv[k], 1e-6, `${def.id} rv`);
      close((e(u + h, v).ru[k] - e(u - h, v).ru[k]) / (2 * h), c.ruu[k], 1e-6, `${def.id} ruu`);
      close((e(u, v + h).ru[k] - e(u, v - h).ru[k]) / (2 * h), c.ruv[k], 1e-6, `${def.id} ruv`);
      close((e(u + h, v).rv[k] - e(u - h, v).rv[k]) / (2 * h), c.ruv[k], 1e-6, `${def.id} ruv(2)`);
      close((e(u, v + h).rv[k] - e(u, v - h).rv[k]) / (2 * h), c.rvv[k], 1e-6, `${def.id} rvv`);
    }
  }
});

test('Christoffel symbols: analytic equals numerically differentiated metric', () => {
  for (const def of SURFACE_DEFS) {
    const S = createSurface(def.id);
    const [u, v] = mid(S, 0.3, 0.55);
    const a = christoffel(S, u, v), b = christoffelNumeric(S, u, v);
    for (let i = 0; i < 6; i++) close(a[i], b[i], 1e-5, `${def.id} gamma[${i}]`);
  }
});

test('sphere: K = 1/R^2, |H| = 1/R, umbilic, area element R^2 sin v', () => {
  for (const R of [0.5, 1, 2.2]) {
    const S = createSurface('sphere', { R });
    for (const [u, v] of [[0.3, 1.1], [4, 2.5], [1, 0.2]]) {
      const q = localGeometry(S, u, v);
      close(q.K, 1 / (R * R), 1e-9);
      close(q.H, -1 / R, 1e-9);
      close(q.W, R * R * Math.sin(v), 1e-9);
      assert.ok(principalDirections(S, u, v).umbilic);
    }
    // finite at the pole
    close(localGeometry(S, 0, 0).K, 1 / (R * R), 1e-6);
  }
});

test('torus: K = cos v / (r (R + r cos v)): positive outside, negative inside, zero on top', () => {
  const R = 1.5, r = 0.6;
  const S = createSurface('torus', { R, r });
  for (const v of [0, 0.7, 1.4, 2.2, 3.1415926535, 4, 5.5]) {
    close(localGeometry(S, 0.9, v).K, Math.cos(v) / (r * (R + r * Math.cos(v))), 1e-9);
  }
  assert.ok(localGeometry(S, 0, 0).K > 0);
  assert.ok(localGeometry(S, 0, Math.PI).K < 0);
  assert.ok(Math.abs(localGeometry(S, 0, Math.PI / 2).K) < 1e-9);
});

test('pseudosphere K = -1/a^2; catenoid and Enneper and helicoid are minimal (H = 0)', () => {
  for (const a of [0.7, 1, 1.5]) {
    const S = createSurface('pseudosphere', { a });
    for (const f of [0.1, 0.5, 0.9]) close(localGeometry(S, 1, mid(S, 0.2, f)[1]).K, -1 / (a * a), 1e-8);
  }
  for (const id of ['catenoid', 'helicoid', 'enneper']) {
    const S = createSurface(id);
    for (const [fu, fv] of [[0.2, 0.3], [0.7, 0.8], [0.5, 0.45]]) {
      const [u, v] = mid(S, fu, fv);
      const q = localGeometry(S, u, v);
      assert.ok(Math.abs(q.H) < 1e-9, `${id} H=${q.H}`);
      assert.ok(q.K <= 1e-12, `${id} K<=0`);
    }
  }
  const c = createSurface('catenoid', { a: 0.7 });
  close(localGeometry(c, 1, 0.5).K, -1 / (0.7 * 0.7 * Math.cosh(0.5 / 0.7) ** 4), 1e-9);
  const e = createSurface('enneper');
  close(localGeometry(e, 0.4, -0.3).K, -4 / (1 + 0.16 + 0.09) ** 4, 1e-9);
});

test('developable surfaces (cylinder, cone) have K = 0; saddle K < 0; bump K changes sign', () => {
  for (const id of ['cylinder', 'cone']) {
    const S = createSurface(id);
    const [u, v] = mid(S);
    assert.ok(Math.abs(localGeometry(S, u, v).K) < 1e-10, id);
  }
  const cyl = createSurface('cylinder', { R: 0.9 });
  close(Math.abs(localGeometry(cyl, 1, 0).H), 1 / (2 * 0.9), 1e-9);
  assert.ok(localGeometry(createSurface('saddle'), 0.2, 0.1).K < 0);
  const b = createSurface('bump');
  assert.ok(localGeometry(b, 0, 0).K > 0);
  assert.ok(localGeometry(b, 1.2, 0).K < 0);
});

test('principal curvatures: k1 >= k2, k1 + k2 = 2H, k1 k2 = K, directions orthogonal', () => {
  for (const def of SURFACE_DEFS) {
    const S = createSurface(def.id);
    const [u, v] = mid(S, 0.31, 0.62);
    const pd = principalDirections(S, u, v);
    close(pd.k1 + pd.k2, 2 * pd.H, 1e-9);
    close(pd.k1 * pd.k2, pd.K, 1e-8);
    assert.ok(pd.k1 >= pd.k2 - 1e-12);
    const d = pd.t1[0] * pd.t2[0] + pd.t1[1] * pd.t2[1] + pd.t1[2] * pd.t2[2];
    assert.ok(Math.abs(d) < 1e-8, `${def.id} orthogonal ${d}`);
  }
});

test('mesh: format, normals unit and consistent with triangle winding, K/H arrays', () => {
  for (const def of SURFACE_DEFS) {
    const S = createSurface(def.id);
    const m = meshSurface(S, { nu: 12, nv: 9 });
    assert.equal(m.vertexCount, 13 * 10);
    assert.equal(m.triangleCount, 12 * 9 * 2);
    assert.equal(m.positions.length, m.vertexCount * 3);
    assert.equal(m.K.length, m.vertexCount);
    assert.ok(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite) && m.K.every(Number.isFinite));
    let agree = 0, total = 0;
    for (let t = 0; t < m.triangleCount; t++) {
      const [a, b, c] = [m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2]];
      const P = (i) => [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
      const A = P(a), B = P(b), C = P(c);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      if (Math.hypot(...n) < 1e-9) continue;
      const vn = [m.normals[a * 3], m.normals[a * 3 + 1], m.normals[a * 3 + 2]];
      total++;
      if (n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] > 0) agree++;
    }
    assert.ok(agree / total > 0.98, `${def.id} winding ${agree}/${total}`);
  }
});

test('projectToSurface recovers (u, v) of a surface point from a nearby start', () => {
  const S = createSurface('torus');
  const p = S.eval(1.2, 2.0).r;
  const r = projectToSurface(S, p, 1.1, 2.1);
  close(r.u, 1.2, 1e-8); close(r.v, 2.0, 1e-8);
  assert.ok(r.dist < 1e-10);
});

test('Dupin indicatrix: ellipse on a sphere/ellipsoid, hyperbola on a saddle, lines on a cylinder', () => {
  assert.equal(dupinIndicatrix(createSurface('sphere'), 0.3, 1.2).type, 'circle');
  assert.equal(dupinIndicatrix(createSurface('ellipsoid'), 0.3, 1.2).type, 'ellipse');
  const h = dupinIndicatrix(createSurface('saddle'), 0.1, 0.2);
  assert.equal(h.type, 'hyperbola');
  assert.ok(h.curves.length >= 2);
  const c = dupinIndicatrix(createSurface('cylinder'), 0.3, 0.2);
  assert.equal(c.type, 'parabolic');
  // ellipse points satisfy k1 x^2 + k2 y^2 = c in the tangent plane
  const S = createSurface('ellipsoid');
  const ind = dupinIndicatrix(S, 0.4, 1.0, { radius: 0.2 });
  const pd = ind.pd;
  const vals = ind.curves[0].map((P) => {
    const d = [P[0] - pd.r[0], P[1] - pd.r[1], P[2] - pd.r[2]];
    const x = d[0] * pd.t1[0] + d[1] * pd.t1[1] + d[2] * pd.t1[2], y = d[0] * pd.t2[0] + d[1] * pd.t2[1] + d[2] * pd.t2[2];
    return pd.k1 * x * x + pd.k2 * y * y;
  });
  for (const x of vals) close(x, vals[0], 1e-9);
});

test('naturalSpline interpolates, is C2 and has zero end curvature; wrapUV and symmetricScale', () => {
  const ys = [0, 1, 0.5, 2, 1];
  const f = naturalSpline(ys);
  ys.forEach((y, i) => close(f(i)[0], y, 1e-12));
  close(f(0)[2], 0, 1e-12); close(f(4)[2], 0, 1e-12);
  close(f(2 - 1e-9)[2], f(2 + 1e-9)[2], 1e-6);
  const S = createSurface('torus');
  const [u, v] = wrapUV(S, -0.5, 7);
  close(u, 2 * Math.PI - 0.5, 1e-12); close(v, 7 - 2 * Math.PI, 1e-12);
  close(symmetricScale([0, 0, 0, 5, -5], 1), 5, 1e-12);
});
