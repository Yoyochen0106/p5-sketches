import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurface, localGeometry, principalDirections } from '../../lib/surfaces.js';
import {
  geodesicFrom, tangentFrame, directionParam, sampleTangent, speedOf, geodesicBetween, parallelTransport, holonomy,
  parallelCircle, integratePolygon, integrateK, polygonArea, geodesicTriangle, curvatureLine, integrateGeodesic,
  angleBetween, polylineLength,
} from '../../lib/geodesic.js';
import { close } from './helpers.js';

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));
const P = (pt) => [pt.x, pt.y, pt.z];

test('sphere geodesics are great circles: planar through the centre, length 2 pi R closes', () => {
  for (const R of [1, 1.7]) {
    const S = createSurface('sphere', { R });
    const g = geodesicFrom(S, 0.3, 1.2, 0.7, 2 * Math.PI * R, { samples: 400 });
    assert.equal(g.reason, 'length');
    const p0 = P(g.points[0]);
    const t0 = sampleTangent(S, g.points[0]);
    const nrm = cross3(p0, t0);
    const nl = Math.hypot(...nrm);
    for (const pt of g.points) {
      const p = P(pt);
      assert.ok(Math.abs(dot3(p, nrm) / nl) < 1e-6, `plane ${dot3(p, nrm) / nl}`);
      assert.ok(Math.abs(Math.hypot(...p) - R) < 1e-12);
    }
    const last = P(g.points[g.points.length - 1]);
    assert.ok(Math.hypot(last[0] - p0[0], last[1] - p0[1], last[2] - p0[2]) < 1e-6, 'closes');
    // arc-length parameter: chord-polyline length approaches 2 pi R
    assert.ok(Math.abs(polylineLength(g.points) - 2 * Math.PI * R) < 1e-3 * R);
  }
});

test('sphere meridian through both poles (pole mirroring) stays on one great circle and closes', () => {
  const S = createSurface('sphere', { R: 1 });
  const g = geodesicFrom(S, 0.8, Math.PI / 2, Math.PI / 2, 2 * Math.PI, { samples: 500 });
  assert.equal(g.reason, 'length');
  const n = [-Math.sin(0.8), Math.cos(0.8), 0];
  for (const pt of g.points) assert.ok(Math.abs(dot3(P(pt), n)) < 1e-6);
  const p0 = P(g.points[0]), pe = P(g.points[g.points.length - 1]);
  assert.ok(Math.hypot(pe[0] - p0[0], pe[1] - p0[1], pe[2] - p0[2]) < 1e-5);
  assert.ok(g.points.some((q) => Math.abs(q.z) > 0.9999), 'reaches a pole');
});

test('cylinder geodesics are helices, ending with reason boundary at the rim', () => {
  const R = 0.9;
  const S = createSurface('cylinder', { R, h: 2.4 });
  const th = 0.6, u0 = 1, v0 = -1;
  const g = geodesicFrom(S, u0, v0, th, 3, { samples: 100 });
  for (const pt of g.points) {
    close(pt.u, u0 + (pt.s * Math.cos(th)) / R, 1e-8);
    close(pt.v, v0 + pt.s * Math.sin(th), 1e-8);
  }
  const far = geodesicFrom(S, u0, v0, th, 50, { samples: 100 });
  assert.equal(far.reason, 'boundary');
  const last = far.points[far.points.length - 1];
  close(last.v, 1.2, 1e-9);
});

test('torus: outer/inner equators and meridians are geodesics, the top circle is not', () => {
  const R = 1.5, r = 0.6;
  const S = createSurface('torus', { R, r });
  const outer = geodesicFrom(S, 0.2, 0, 0, 5, { samples: 60 });
  for (const pt of outer.points) assert.ok(Math.abs(pt.v) < 1e-9);
  close(outer.points[60].u, 0.2 + 5 / (R + r), 1e-8);
  const inner = geodesicFrom(S, 0.2, Math.PI, 0, 5, { samples: 60 });
  for (const pt of inner.points) assert.ok(Math.abs(pt.v - Math.PI) < 1e-9);
  const mer = geodesicFrom(S, 0.2, 0.4, Math.PI / 2, 2 * Math.PI * r, { samples: 100 });
  for (const pt of mer.points) assert.ok(Math.abs(pt.u - 0.2) < 1e-9);
  close(mer.points[100].v - 0.4, 2 * Math.PI, 1e-6);
  const top = geodesicFrom(S, 0.2, Math.PI / 2, 0, 3, { samples: 60 });
  assert.ok(top.points.some((pt) => Math.abs(pt.v - Math.PI / 2) > 1e-3), 'top parallel is not a geodesic');
});

test('geodesic speed is conserved without renormalisation, and Clairaut holds on surfaces of revolution', () => {
  for (const [id, params, u, v, th] of [['torus', {}, 0.3, 0.9, 0.5], ['catenoid', {}, 0.1, -0.5, 0.3], ['sphere', {}, 0.2, 1.0, 0.9], ['revolve', { shape: 0 }, 0.4, 2.5, 0.2]]) {
    const S = createSurface(id, params);
    const d = directionParam(S, u, v, th);
    const g = integrateGeodesic(S, { u, v, du: d[0], dv: d[1] }, { length: 12, samples: 240, normalize: false });
    assert.ok(g.points.length > 5, id);
    const L0 = localGeometry(S, u, v);
    const clairaut0 = L0.E * d[0];
    // the final sample of a geodesic that hit the domain edge is linearly interpolated: skip it
    for (const pt of g.reason === 'boundary' ? g.points.slice(0, -1) : g.points) {
      close(speedOf(S, pt), 1, id === 'revolve' ? 2e-5 : 1e-7, `${id} speed`);
      const q = localGeometry(S, pt.u, pt.v);
      close(q.E * pt.du, clairaut0, id === 'revolve' ? 2e-5 : 1e-6, `${id} Clairaut rho^2 u'`);
    }
  }
});

test('geodesicBetween on a sphere: great-circle distance, long way as second candidate', () => {
  const R = 1.4;
  const S = createSurface('sphere', { R });
  const A = { u: 0.4, v: 1.0 }, B = { u: 2.1, v: 1.9 };
  const a = S.eval(A.u, A.v).r, b = S.eval(B.u, B.v).r;
  const ang = Math.acos(dot3(a, b) / (R * R));
  const res = geodesicBetween(S, A, B);
  close(res.best.length, R * ang, 1e-6);
  assert.ok(res.candidates.some((c) => Math.abs(c.length - R * (2 * Math.PI - ang)) < 1e-5), 'long way found');
  // the shot polyline really ends at B
  const g = geodesicFrom(S, A.u, A.v, res.best.theta, res.best.length, { samples: 100, maxStep: 0.01 });
  const e = P(g.points[g.points.length - 1]);
  assert.ok(Math.hypot(e[0] - b[0], e[1] - b[1], e[2] - b[2]) < 1e-6);
  assert.ok(!res.ambiguous);
});

test('geodesicBetween: antipodal points are flagged as non-unique / near-conjugate', () => {
  const S = createSurface('sphere', { R: 1 });
  const A = { u: 0.4, v: 1.0 };
  const r = S.eval(A.u, A.v).r;
  const B = { u: 0.4 + Math.PI, v: Math.PI - 1.0 };
  const res = geodesicBetween(S, A, B);
  assert.ok(res.best);
  close(res.best.length, Math.PI, 1e-4);
  assert.ok(res.nearConjugate, 'ratio ~ sin(L)/L ~ 0');
  void r;
});

test('geodesicBetween on a cylinder finds the helix; on a torus the result is a true geodesic', () => {
  const S = createSurface('cylinder', { R: 1, h: 4 });
  const A = { u: 0.2, v: -1 }, B = { u: 0.2 + 2.5, v: 0.8 };
  const res = geodesicBetween(S, A, B);
  close(res.best.length, Math.hypot(2.5, 1.8), 1e-6);
  const T = createSurface('torus');
  const t = geodesicBetween(T, { u: 0.3, v: 0.5 }, { u: 1.5, v: 2.2 });
  assert.ok(t.best && t.best.length >= t.chord - 1e-9);
  const g = geodesicFrom(T, 0.3, 0.5, t.best.theta, t.best.length, { samples: 60, maxStep: 0.01 });
  const e = g.points[g.points.length - 1], target = T.eval(1.5, 2.2).r;
  assert.ok(Math.hypot(e.x - target[0], e.y - target[1], e.z - target[2]) < 1e-6);
});

test('holonomy around a sphere latitude circle = 2 pi (1 - sin lat) (mod 2 pi); flat cylinder has none', () => {
  const S = createSurface('sphere', { R: 1.3 });
  for (const latDeg of [60, 35, 75, -20, 10]) {
    const lat = (latDeg * Math.PI) / 180;
    const path = parallelCircle(S, lat + Math.PI / 2, 360);
    const h = holonomy(S, path);
    close(h.angle, wrapPi(2 * Math.PI * (1 - Math.sin(lat))), 1e-6, `lat ${latDeg}`);
    // Gauss-Bonnet: the same number as the integral of K over the cap to the north pole
    const cap = integrateK(S, [[0, lat + Math.PI / 2], [2 * Math.PI, lat + Math.PI / 2], [2 * Math.PI, Math.PI], [0, Math.PI]]);
    close(wrapPi(cap), h.angle, 1e-7);
  }
  const C = createSurface('cylinder');
  close(holonomy(C, parallelCircle(C, 0.3, 120)).angle, 0, 1e-9);
});

test('parallel transport keeps lengths and angles; a geodesic transports its own tangent', () => {
  const S = createSurface('torus');
  const g = geodesicFrom(S, 0.3, 0.9, 0.5, 6, { samples: 600, maxStep: 0.01 });
  const path = g.points.map((p) => [p.u, p.v]);
  const t0 = [g.points[0].du, g.points[0].dv];
  const tr = parallelTransport(S, path, t0);
  const last = g.points[g.points.length - 1];
  const a = angleBetween(S, last.u, last.v, tr.final, [last.du, last.dv]);
  assert.ok(Math.abs(a) < 2e-3, `angle to tangent ${a}`);
  // a second vector keeps its angle to the tangent
  const f0 = tangentFrame(S, 0.3, 0.9);
  const pv = directionParam(S, 0.3, 0.9, 0.5 + 1.0);
  void f0;
  const tr2 = parallelTransport(S, path, pv);
  const a2 = angleBetween(S, last.u, last.v, [last.du, last.dv], tr2.final);
  close(a2, 1.0, 5e-3);
  const q = localGeometry(S, last.u, last.v);
  const nrm = (V) => Math.sqrt(q.E * V[0] * V[0] + 2 * q.F * V[0] * V[1] + q.G * V[1] * V[1]);
  close(nrm(tr2.final), 1, 1e-6);
});

test('integratePolygon: exact areas of simple polygons', () => {
  close(integratePolygon(() => 1, [[0, 0], [2, 0], [2, 3], [0, 3]]), 6, 1e-12);
  close(integratePolygon(() => 1, [[0, 0], [4, 0], [0, 3]]), 6, 1e-12);
  close(integratePolygon((u, v) => u * v, [[0, 0], [1, 0], [1, 1], [0, 1]]), 0.25, 1e-12);
  // non-convex polygon (L shape)
  close(integratePolygon(() => 1, [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]), 3, 1e-12);
  const S = createSurface('sphere', { R: 2 });
  const v = 1.0;
  close(polygonArea(S, [[0, 0], [2 * Math.PI, 0], [2 * Math.PI, v], [0, v]]), 2 * Math.PI * 4 * (1 - Math.cos(v)), 1e-9);
});

test('Gauss-Bonnet: geodesic triangle angle excess = integral of K dA (sphere, torus, saddle, pseudosphere)', () => {
  const cases = [
    ['sphere', { R: 1.2 }, { u: 1.0, v: 1.4 }, { theta: 0.3, alpha: 1.1, lenAB: 1.0, lenAC: 0.8 }],
    ['sphere', { R: 1 }, { u: 2.0, v: 1.0 }, { theta: 1.0, alpha: 0.9, lenAB: 1.6, lenAC: 1.4 }],
    ['saddle', {}, { u: -0.5, v: -0.4 }, { theta: 0.2, alpha: 1.0, lenAB: 0.8, lenAC: 0.7 }],
    ['torus', {}, { u: 0.3, v: 0.2 }, { theta: 0.4, alpha: 0.9, lenAB: 0.6, lenAC: 0.5 }],
    ['pseudosphere', {}, { u: 0.5, v: 1.2 }, { theta: 0.3, alpha: 1.0, lenAB: 0.6, lenAC: 0.5 }],
  ];
  for (const [id, params, A, o] of cases) {
    const S = createSurface(id, params);
    const T = geodesicTriangle(S, A, o);
    assert.ok(T, `${id} triangle`);
    assert.ok(T.closed, `${id} closes in the chart`);
    close(T.excess, T.KIntegral, 2e-3, `${id}: excess ${T.excess} vs int K ${T.KIntegral}`);
    assert.ok(Math.abs(T.excess - T.KIntegral) < 2e-4 + 1e-3 * Math.abs(T.KIntegral), `${id}: ${T.excess} vs ${T.KIntegral}`);
    if (id === 'sphere') close(T.KIntegral, T.area / (params.R * params.R), 1e-8);
  }
  const sph = geodesicTriangle(createSurface('sphere', { R: 1 }), { u: 1, v: 1.4 }, { theta: 0.3, alpha: 1.1, lenAB: 1, lenAC: 0.8 });
  assert.ok(sph.excess > 0);
  const sad = geodesicTriangle(createSurface('saddle'), { u: -0.5, v: -0.4 }, { theta: 0.2, alpha: 1.0, lenAB: 0.8, lenAC: 0.7 });
  assert.ok(sad.excess < 0);
});

test('lines of curvature of a torus are its parallels and meridians', () => {
  const S = createSurface('torus');
  const u0 = 0.7, v0 = 0.9;
  const pd = principalDirections(S, u0, v0);
  assert.ok(!pd.umbilic);
  const l1 = curvatureLine(S, u0, v0, 1, { length: 1.5 });
  const l2 = curvatureLine(S, u0, v0, 2, { length: 1.5 });
  const constU = (l) => l.every((p) => Math.abs(p.u - u0) < 1e-6);
  const constV = (l) => l.every((p) => Math.abs(p.v - v0) < 1e-6);
  assert.ok((constU(l1) && constV(l2)) || (constV(l1) && constU(l2)));
  assert.ok(l1.length > 10 && l2.length > 10);
  assert.equal(curvatureLine(createSurface('sphere'), 1, 1, 1).length <= 1, true, 'umbilic: no lines');
});
