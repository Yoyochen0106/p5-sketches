// Mesh topology checks: open (boundary) edges of a welded triangle mesh. Pure, no DOM.

/**
 * Classifies every undirected edge by the number of triangles using it.
 *   boundary    edges used by exactly one triangle
 *   nonManifold edges used by three or more triangles
 * With `bounds` ({xmin,xmax,ymin,ymax,zmin,zmax}) boundary edges lying entirely in one face of the
 * bounding box are reported as `domain` (the surface is simply cut off there) and the rest as
 * `open` -- those are real cracks / holes. Returns counts and `edges`: Float32Array of the open
 * edges (6 numbers per edge: x0 y0 z0 x1 y1 z1).
 */
export function openEdges(mesh, bounds = null) {
  const idx = mesh.indices;
  const P = mesh.positions;
  const V = Math.max(1, Math.floor(P.length / 3));
  const H = idx.length;
  const keys = new Float64Array(H);
  for (let t = 0; t + 2 < H; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
      keys[t + e] = a < b ? a * V + b : b * V + a;
    }
  }
  keys.sort();
  let boundary = 0;
  let nonManifold = 0;
  let domain = 0;
  const open = [];
  const size = bounds ? Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin, bounds.zmax - bounds.zmin) : 0;
  const eps = 1e-5 * (size || 1);
  const lo = bounds ? [bounds.xmin, bounds.ymin, bounds.zmin] : null;
  const hi = bounds ? [bounds.xmax, bounds.ymax, bounds.zmax] : null;
  const onFace = (a, b) => {
    for (let d = 0; d < 3; d++) {
      const pa = P[a * 3 + d], pb = P[b * 3 + d];
      if ((Math.abs(pa - lo[d]) < eps && Math.abs(pb - lo[d]) < eps) || (Math.abs(pa - hi[d]) < eps && Math.abs(pb - hi[d]) < eps)) return true;
    }
    return false;
  };
  for (let i = 0; i < H;) {
    let j = i + 1;
    while (j < H && keys[j] === keys[i]) j++;
    const uses = j - i;
    if (uses === 1 || uses >= 3) {
      const a = Math.floor(keys[i] / V), b = keys[i] - a * V;
      if (uses >= 3) nonManifold++;
      else {
        boundary++;
        if (bounds && onFace(a, b)) domain++;
        else open.push(a, b);
      }
    }
    i = j;
  }
  const edges = new Float32Array(open.length * 3);
  for (let k = 0; k < open.length; k += 2) {
    const a = open[k], b = open[k + 1];
    edges.set([P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], (k / 2) * 6);
  }
  return { boundary, nonManifold, domain, open: open.length / 2, edges };
}
