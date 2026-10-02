// Ray picking against triangle meshes and boxes. Pure math, no p5 / DOM.
// A ray is { origin: [x,y,z], dir: [x,y,z] } (dir need not be unit length; t is in units of dir).

/**
 * Moller-Trumbore ray / triangle test.
 * @returns {number|null} the ray parameter t > 0 of the hit, or null. Writes barycentric (u, v) into `uv` when given.
 */
export function rayTriangle(origin, dir, a, b, c, { cullBack = false, uv = null } = {}) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = dir[1] * e2z - dir[2] * e2y, py = dir[2] * e2x - dir[0] * e2z, pz = dir[0] * e2y - dir[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (!(Math.abs(det) > 1e-14)) return null;
  if (cullBack && det < 0) return null;
  const inv = 1 / det;
  const tx = origin[0] - a[0], ty = origin[1] - a[1], tz = origin[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (!(t > 1e-12)) return null;
  if (uv) { uv[0] = u; uv[1] = v; }
  return t;
}

/**
 * Slab test of a ray against an axis-aligned box.
 * @returns {{tmin:number, tmax:number}|null} tmin may be negative when the origin is inside the box.
 */
export function rayBox(origin, dir, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const d = dir[i], o = origin[i];
    if (d === 0) {
      if (o < min[i] || o > max[i]) return null;
      continue;
    }
    let t0 = (min[i] - o) / d, t1 = (max[i] - o) / d;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { tmin, tmax };
}

/**
 * Nearest triangle of a prepared mesh (see prepareMesh) hit by the ray.
 * @returns {{triangle:number, t:number, point:number[], u:number, v:number, normal:number[]}|null}
 */
export function pickMesh(prepared, ray, { cullBack = false, maxT = Infinity } = {}) {
  const { min, max } = prepared.bounds;
  const pad = 1e-9 + 1e-9 * Math.max(Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1]), Math.abs(max[2] - min[2]));
  if (!rayBox(ray.origin, ray.dir, [min[0] - pad, min[1] - pad, min[2] - pad], [max[0] + pad, max[1] + pad, max[2] + pad])) return null;
  const P = prepared.positions, I = prepared.indices;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], uv = [0, 0];
  let best = null, bestT = maxT, bu = 0, bv = 0;
  for (let t = 0; t < prepared.triangleCount; t++) {
    if (prepared.degenerate[t]) continue;
    const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
    a[0] = P[i0]; a[1] = P[i0 + 1]; a[2] = P[i0 + 2];
    b[0] = P[i1]; b[1] = P[i1 + 1]; b[2] = P[i1 + 2];
    c[0] = P[i2]; c[1] = P[i2 + 1]; c[2] = P[i2 + 2];
    const h = rayTriangle(ray.origin, ray.dir, a, b, c, { cullBack, uv });
    if (h !== null && h < bestT) { bestT = h; best = t; bu = uv[0]; bv = uv[1]; }
  }
  if (best === null) return null;
  const F = prepared.faceNormals;
  return {
    triangle: best, t: bestT, u: bu, v: bv,
    point: [ray.origin[0] + ray.dir[0] * bestT, ray.origin[1] + ray.dir[1] * bestT, ray.origin[2] + ray.dir[2] * bestT],
    normal: [F[best * 3], F[best * 3 + 1], F[best * 3 + 2]],
  };
}
