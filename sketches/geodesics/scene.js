// Geometry for the Surface Curvature & Geodesics sketch: mesh entries, picking, geodesics, loops,
// triangles, lines of curvature. Pure (no p5); the sketch memoises these functions by their inputs.
import {
  meshSurface, symmetricScale, localGeometry, principalDirections, dupinIndicatrix, surfaceExtent, wrapUV, clampV,
  projectToSurface, intersectRay,
} from '../../lib/surfaces.js';
import { prepareMesh, colormapLUT } from '../../lib/render3d.js';
import { pickMesh } from '../../lib/render3d-pick.js';
import {
  geodesicFrom, geodesicBetween, geodesicTriangle, holonomy, parallelCircle, integrateK, curvatureLine,
} from '../../lib/geodesic.js';
import { clamp } from './state.js';

const TAU = Math.PI * 2;
const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));

/** Mesh, prepared mesh and per-triangle colour functions for a surface at a resolution. */
export function buildMeshEntry(S, resolution) {
  const nu = clamp(Math.round(resolution), 8, 160);
  const nv = clamp(Math.round(resolution * 0.75), 6, 140);
  const mesh = meshSurface(S, { nu, nv });
  const prepared = prepareMesh(mesh);
  const T = mesh.triangleCount;
  const triK = new Float32Array(T), triH = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const a = mesh.indices[t * 3], b = mesh.indices[t * 3 + 1], c = mesh.indices[t * 3 + 2];
    triK[t] = (mesh.K[a] + mesh.K[b] + mesh.K[c]) / 3;
    triH[t] = (mesh.H[a] + mesh.H[b] + mesh.H[c]) / 3;
  }
  const kScale = symmetricScale(mesh.K, 0.95, 1e-9), hScale = symmetricScale(mesh.H, 0.95, 1e-9);
  const lut = colormapLUT('coolwarm');
  const colorFnFor = (vals, scale) => (tri, prep, out) => {
    const t = clamp(vals[tri] / scale, -1, 1);
    const i = Math.round((t + 1) * 127.5) * 3;
    out[0] = lut[i]; out[1] = lut[i + 1]; out[2] = lut[i + 2];
  };
  return {
    S, mesh, prepared, triK, triH, kScale, hScale, colorK: colorFnFor(triK, kScale), colorH: colorFnFor(triH, hScale),
    bounds: prepared.bounds, extent: surfaceExtent(S, 24), nu, nv,
  };
}

/** Chart point from domain fractions (poles are kept a little way inside). */
export function startPoint(S, fu, fv) {
  const { u0, u1, v0, v1 } = S.domain;
  return { u: u0 + clamp(fu, 0, 1) * (u1 - u0), v: v0 + clamp(fv, 0.004, 0.996) * (v1 - v0) };
}

/** Domain fractions of a chart point (wrapped into the base domain). */
export function fractionOf(S, u, v) {
  const [uu, vv] = wrapUV(S, u, v);
  const { u0, u1, v0, v1 } = S.domain;
  return { fu: (uu - u0) / (u1 - u0), fv: (vv - v0) / (v1 - v0) };
}

/** Ray pick: nearest mesh hit refined to the exact surface point. Returns { u, v, point, normal } or null. */
export function pickSurface(entry, ray) {
  const hit = pickMesh(entry.prepared, ray);
  if (!hit) return null;
  const m = entry.mesh, t = hit.triangle;
  const a = m.indices[t * 3], b = m.indices[t * 3 + 1], c = m.indices[t * 3 + 2];
  const w0 = 1 - hit.u - hit.v;
  const u = w0 * m.uv[a * 2] + hit.u * m.uv[b * 2] + hit.v * m.uv[c * 2];
  const v = w0 * m.uv[a * 2 + 1] + hit.u * m.uv[b * 2 + 1] + hit.v * m.uv[c * 2 + 1];
  // the mesh is faceted: intersect the ray with the true surface (fall back to the closest point)
  const x = intersectRay(entry.S, ray, u, v, hit.t);
  const r = x.ok ? { u: x.u, v: x.v, dist: 0 } : projectToSurface(entry.S, hit.point, u, v);
  const [uu, vv] = wrapUV(entry.S, r.u, r.v);
  return { u: uu, v: vv, point: hit.point, normal: hit.normal, triangle: t, dist: r.dist, exact: x.ok };
}

/** Local geometry summary at a chart point. */
export function describePoint(S, u, v) {
  const q = localGeometry(S, u, v);
  const pd = principalDirections(S, u, v);
  return { u, v, r: q.r, n: q.n, K: q.K, H: q.H, k1: q.k1, k2: q.k2, W: q.W, pd };
}

const samplesFor = (L, per = 0.04) => clamp(Math.ceil(L / per), 40, 700);

/** Geodesic from the start point; angle in radians, length in absolute units. */
export function mainGeodesic(S, start, theta, length) {
  return geodesicFrom(S, start.u, start.v, theta, length, { samples: samplesFor(length) });
}

/** `count` geodesics at equal angles starting at theta. */
export function fanGeodesics(S, start, theta, length, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(geodesicFrom(S, start.u, start.v, theta + (TAU * i) / count, length, { samples: samplesFor(length, 0.06), maxStep: 0.02 }));
  }
  return out;
}

/**
 * Shortest geodesic found from start to target by shooting, plus the next-shortest alternatives.
 * quick = fewer starting angles (used while dragging).
 */
export function shortestPath(S, start, target, quick = false) {
  const between = geodesicBetween(S, start, target, { starts: quick ? 3 : 12 });
  const polylines = between.candidates.slice(0, 3).map((c) => geodesicFrom(S, start.u, start.v, c.theta, c.length, { samples: samplesFor(c.length), maxStep: 0.01 }));
  return { between, polylines, quick };
}

/** Indices of at most `n` evenly spread entries of an array of length `len`. */
function spread(len, n) {
  const out = [];
  const step = Math.max(1, Math.ceil(len / n));
  for (let i = 0; i < len; i += step) out.push(i);
  if (out[out.length - 1] !== len - 1) out.push(len - 1);
  return out;
}

/**
 * Parallel-transport loop data. kind: 'parallel' | 'circle' | 'triangle' | 'none'.
 * Returns null for 'none' or when the loop does not exist on this surface; otherwise
 * { kind, title, path3d, arrows: [{p, v}], angle, KIntegral|null, expected|null, note, triangle|null }.
 */
export function loopData(S, extent, start, o) {
  const size = extent.size;
  let path = null, polygon = null, triangle = null, title = '', note = '', enclosed = false, latitude;
  const { u0, u1, v0, v1 } = S.domain;
  if (o.loop === 'parallel') {
    if (!S.periodicU) return { kind: 'parallel', unavailable: 'this surface has no closed parallels (u is not periodic)' };
    const v = v0 + clamp(o.loopV, S.poleV0 ? 0.02 : 0, S.poleV1 ? 0.98 : 1) * (v1 - v0);
    path = parallelCircle(S, v, 240);
    title = `parallel v = ${v.toFixed(3)}`;
    if (S.defId === 'sphere') latitude = v - Math.PI / 2;
    if (S.poleV1) {
      polygon = [[u0, v], [u1, v], [u1, v1], [u0, v1]];
      enclosed = true;
      note = 'encloses the cap up to the pole';
    } else note = 'not contractible: Gauss-Bonnet needs the whole boundary';
  } else if (o.loop === 'circle') {
    const room = [
      S.periodicU ? Infinity : Math.min(start.u - u0, u1 - start.u),
      S.periodicV ? Infinity : Math.min(start.v - v0, v1 - start.v),
    ];
    const rad = Math.min(o.loopR * Math.min(u1 - u0, v1 - v0), 0.9 * Math.min(room[0], room[1]));
    if (!(rad > 1e-4)) return { kind: 'circle', unavailable: 'start point is too close to the domain edge' };
    path = [];
    for (let i = 0; i <= 160; i++) path.push([start.u + rad * Math.cos((TAU * i) / 160), start.v + rad * Math.sin((TAU * i) / 160)]);
    polygon = path.slice(0, -1);
    enclosed = true;
    title = `chart circle r = ${rad.toFixed(3)}`;
  } else if (o.loop === 'triangle') {
    const t = geodesicTriangle(S, start, {
      theta: o.theta, alpha: (o.triAlpha * Math.PI) / 180, lenAB: o.triAB * size, lenAC: o.triAC * size,
    });
    if (!t) return { kind: 'triangle', unavailable: 'a side leaves the surface or the third side was not found' };
    triangle = t;
    path = t.polygon;
    enclosed = t.closed;
    polygon = t.closed ? t.polygon : null;
    title = 'geodesic triangle';
    if (!t.closed) note = 'chart polygon does not close (wraps a periodic direction): integral not available';
  } else return null;
  const h = holonomy(S, path);
  const K = enclosed && polygon ? integrateK(S, polygon) : null;
  const arrows = spread(h.points3d.length, 28).map((i) => ({ p: h.points3d[i], v: h.vectors3d[i] }));
  return {
    kind: o.loop, title, path3d: h.points3d, arrows, angle: h.angle, KIntegral: K, expected: K === null ? null : wrapPi(K),
    note, triangle, holonomy: h, latitude,
  };
}

/** Lines of curvature (both families) seeded on a grid; empty for fully umbilic surfaces. */
export function curvatureLines(S, extent) {
  const { u0, u1, v0, v1 } = S.domain;
  const lines = [];
  const nU = S.periodicU ? 6 : 5, nV = 5;
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nV; j++) {
      const u = u0 + ((u1 - u0) * (S.periodicU ? i / nU : (i + 0.5) / nU));
      const v = v0 + (v1 - v0) * (S.periodicV ? j / nV : (j + 0.5) / nV);
      if (principalDirections(S, u, v).umbilic) continue;
      for (const which of [1, 2]) {
        const pts = curvatureLine(S, u, v, which, { length: 0.9 * extent.size, step: 0.025 * extent.size });
        if (pts.length > 2) lines.push({ which, pts });
      }
    }
  }
  return lines;
}

/** u- and v- parameter lines as 3D point arrays. */
export function paramLines(S, nu = 14, nv = 10, samples = 56) {
  const { u0, u1, v0, v1 } = S.domain;
  const out = [];
  const lastU = S.periodicU ? nu : nu, lastV = S.periodicV ? nv : nv;
  for (let i = 0; i <= lastU; i++) {
    if (S.periodicU && i === lastU) continue;
    const u = u0 + ((u1 - u0) * i) / nu, pts = [];
    for (let k = 0; k <= samples; k++) pts.push(S.eval(u, clampV(S, v0 + ((v1 - v0) * k) / samples)).r);
    out.push(pts);
  }
  for (let j = 0; j <= lastV; j++) {
    if (S.periodicV && j === lastV) continue;
    const v = v0 + ((v1 - v0) * j) / nv, pts = [];
    if (S.poleV0 && j === 0) continue;
    if (S.poleV1 && j === nv) continue;
    for (let k = 0; k <= samples; k++) pts.push(S.eval(u0 + ((u1 - u0) * k) / samples, clampV(S, v)).r);
    out.push(pts);
  }
  return out;
}

/** Dupin indicatrix at the start point, lifted slightly off the surface. */
export function dupinAt(S, extent, u, v) {
  return dupinIndicatrix(S, u, v, { radius: 0.09 * extent.size, lift: 0.004 * extent.size, samples: 64 });
}
