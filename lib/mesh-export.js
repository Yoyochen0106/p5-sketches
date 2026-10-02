// Triangle-mesh export: binary / ASCII STL and Wavefront OBJ. Pure functions, no DOM.
// A mesh is { positions: ArrayLike<number> (xyz per vertex), indices: ArrayLike<number> (3 per triangle),
// normals?: ArrayLike<number> (xyz per vertex) }.

const triCount = (mesh) => Math.floor(mesh.indices.length / 3);

/** Unit face normal of triangle t (zero vector for degenerate triangles). */
export function faceNormal(mesh, t) {
  const P = mesh.positions;
  const a = mesh.indices[t * 3] * 3, b = mesh.indices[t * 3 + 1] * 3, c = mesh.indices[t * 3 + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l > 0 && Number.isFinite(l) ? [nx / l, ny / l, nz / l] : [0, 0, 0];
}

/** Size in bytes of a binary STL with `triangles` facets: 80 header + 4 count + 50 per facet. */
export const binaryStlSize = (triangles) => 84 + 50 * triangles;

/**
 * Binary STL (little endian): 80-byte header, uint32 triangle count, then per triangle 12 float32
 * (normal, 3 vertices) and a uint16 attribute byte count (0). Returns a Uint8Array of 84 + 50*T bytes.
 */
export function meshToBinarySTL(mesh, { header = 'Binary STL written by p5-sketches' } = {}) {
  const T = triCount(mesh);
  const buf = new ArrayBuffer(binaryStlSize(T));
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) bytes[i] = header.charCodeAt(i) & 0x7f;
  dv.setUint32(80, T, true);
  const P = mesh.positions;
  let o = 84;
  for (let t = 0; t < T; t++) {
    const n = faceNormal(mesh, t);
    for (let k = 0; k < 3; k++) { dv.setFloat32(o, n[k], true); o += 4; }
    for (let v = 0; v < 3; v++) {
      const i = mesh.indices[t * 3 + v] * 3;
      for (let k = 0; k < 3; k++) { dv.setFloat32(o, P[i + k], true); o += 4; }
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return bytes;
}

/** ASCII STL text: `solid name`, one `facet normal ... endfacet` block per triangle, `endsolid name`. */
export function meshToAsciiSTL(mesh, name = 'isosurface') {
  const T = triCount(mesh);
  const P = mesh.positions;
  const f = (v) => Number(v).toPrecision(7);
  const out = [`solid ${name}`];
  for (let t = 0; t < T; t++) {
    const n = faceNormal(mesh, t);
    out.push(`  facet normal ${f(n[0])} ${f(n[1])} ${f(n[2])}`, '    outer loop');
    for (let v = 0; v < 3; v++) {
      const i = mesh.indices[t * 3 + v] * 3;
      out.push(`      vertex ${f(P[i])} ${f(P[i + 1])} ${f(P[i + 2])}`);
    }
    out.push('    endloop', '  endfacet');
  }
  out.push(`endsolid ${name}`);
  return `${out.join('\n')}\n`;
}

/**
 * Wavefront OBJ text. Vertices `v x y z`, optional `vn` (when mesh.normals is present and
 * opts.normals !== false) and faces `f a b c` / `f a//a b//b c//c` with 1-based indices.
 */
export function meshToOBJ(mesh, { name = 'isosurface', normals = true } = {}) {
  const V = Math.floor(mesh.positions.length / 3);
  const T = triCount(mesh);
  const withN = normals && mesh.normals && mesh.normals.length >= V * 3;
  const P = mesh.positions;
  const f = (v) => Number(v).toPrecision(7);
  const out = [`# ${V} vertices, ${T} triangles`, `o ${name}`];
  for (let i = 0; i < V; i++) out.push(`v ${f(P[i * 3])} ${f(P[i * 3 + 1])} ${f(P[i * 3 + 2])}`);
  if (withN) for (let i = 0; i < V; i++) out.push(`vn ${f(mesh.normals[i * 3])} ${f(mesh.normals[i * 3 + 1])} ${f(mesh.normals[i * 3 + 2])}`);
  for (let t = 0; t < T; t++) {
    const a = mesh.indices[t * 3] + 1, b = mesh.indices[t * 3 + 1] + 1, c = mesh.indices[t * 3 + 2] + 1;
    out.push(withN ? `f ${a}//${a} ${b}//${b} ${c}//${c}` : `f ${a} ${b} ${c}`);
  }
  return `${out.join('\n')}\n`;
}
