// Glue between scalar fields and meshes for the Marching Squares & Cubes sketch: grid dimensions,
// triangle-budgeted marching cubes, slice contours and a tiny LRU cache. Pure, no DOM.
import { gridSample, marchingCubes, marchingSquares } from './marching.js';

/** Minimal least-recently-used cache. */
export class LRU {
  constructor(capacity = 4) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get size() { return this.map.size; }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);
    return value;
  }

  /** Cached value for key or the result of make(), which is then stored. */
  getOrCreate(key, make) {
    const have = this.get(key);
    return have !== undefined ? have : this.set(key, make());
  }

  clear() { this.map.clear(); }
}

/** Cell counts so that `res` cells cover the longest side and cells stay roughly cubic. */
export function gridDims3(bounds, res) {
  const ex = bounds.xmax - bounds.xmin, ey = bounds.ymax - bounds.ymin, ez = bounds.zmax - bounds.zmin;
  const m = Math.max(ex, ey, ez);
  const n = (e) => Math.max(1, Math.round((res * e) / m));
  return { nx: n(ex), ny: n(ey), nz: n(ez) };
}

/** Samples fn(x, y, z) on a grid whose longest side has `res` cells. */
export function sampleGrid3(fn, bounds, res) {
  const { nx, ny, nz } = gridDims3(bounds, res);
  return gridSample(fn, bounds, nx, ny, nz);
}

/**
 * Isosurface of fn at `level` with a triangle budget. The resolution is lowered (never below
 * `minRes`) until the mesh has at most `maxTriangles` triangles; the number of triangles grows
 * about quadratically with the resolution, which makes a coarse probe a good predictor.
 *
 * opts: { fn, bounds, res, level, algorithm = 'classic', interpolate = true, maxTriangles = 60000,
 *   minRes = 8, getGrid(res) -> grid (lets the caller cache samples) }.
 * Returns { mesh, grid, res (used), requested, limited, triangleCount }. The mesh follows the
 * 'higher' orientation (CCW normals toward increasing field values = outward for f < level inside).
 */
export function buildIsoMesh(opts) {
  const {
    fn, bounds, level, algorithm = 'classic', interpolate = true, maxTriangles = 60000, minRes = 8,
  } = opts;
  const requested = Math.max(1, Math.floor(opts.res));
  const getGrid = opts.getGrid || ((r) => sampleGrid3(fn, bounds, r));
  const run = (r) => {
    const grid = getGrid(r);
    const mesh = marchingCubes(grid, { level, interpolate, algorithm, orientation: 'higher' });
    return { grid, mesh };
  };
  let res = requested;
  if (requested > minRes) {
    const probeRes = Math.min(requested, 16);
    const probe = run(probeRes).mesh.triangleCount;
    if (probeRes < requested && probe > 0) {
      const predicted = probe * (requested / probeRes) ** 2;
      if (predicted > maxTriangles) res = Math.max(minRes, Math.floor(probeRes * Math.sqrt(maxTriangles / probe)));
    } else if (probe > maxTriangles) res = minRes;
    res = Math.min(res, requested);
  }
  let out = run(res);
  for (let tries = 0; tries < 4 && out.mesh.triangleCount > maxTriangles && res > minRes; tries++) {
    res = Math.max(minRes, Math.min(res - 1, Math.floor(res * Math.sqrt(maxTriangles / out.mesh.triangleCount) * 0.97)));
    out = run(res);
  }
  return { mesh: out.mesh, grid: out.grid, res, requested, limited: res < requested, triangleCount: out.mesh.triangleCount };
}

/**
 * Contour of the plane z = c: samples fn(x, y, c) on an nx x ny grid over the xy bounds and runs
 * marching squares. Returns { segments2d (Float64Array x0 y0 x1 y1 ...), edges3d (Float32Array,
 * 6 per segment, z = c), count, grid }.
 */
export function sliceContour(fn, bounds, z, level, res, { interpolate = true, disambiguate = true } = {}) {
  const ex = bounds.xmax - bounds.xmin, ey = bounds.ymax - bounds.ymin;
  const m = Math.max(ex, ey);
  const nx = Math.max(2, Math.round((res * ex) / m)), ny = Math.max(2, Math.round((res * ey) / m));
  const b2 = { xmin: bounds.xmin, xmax: bounds.xmax, ymin: bounds.ymin, ymax: bounds.ymax };
  const grid = gridSample((x, y) => fn(x, y, z), b2, nx, ny);
  const ms = marchingSquares(grid, { level, interpolate, disambiguate });
  const edges3d = new Float32Array(ms.count * 6);
  for (let s = 0; s < ms.count; s++) {
    edges3d.set([ms.segments[s * 4], ms.segments[s * 4 + 1], z, ms.segments[s * 4 + 2], ms.segments[s * 4 + 3], z], s * 6);
  }
  return { segments2d: ms.segments, edges3d, count: ms.count, grid };
}

/** Keeps the triangles whose centroid lies at or below z = c (a cheap "clip above the plane"). */
export function clipMeshBelow(mesh, c) {
  const P = mesh.positions, I = mesh.indices;
  const keep = [];
  for (let t = 0; t < I.length; t += 3) {
    const z = (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
    if (z <= c) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  return { positions: P, normals: mesh.normals, indices: Uint32Array.from(keep) };
}
