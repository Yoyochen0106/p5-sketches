// Marching squares / marching cubes / marching tetrahedra on regular scalar grids.
// Pure functions, no DOM, no allocation inside per-cell loops.
//
// CONVENTIONS (shared by 2D and 3D)
//   * A lattice corner is "inside" (case bit set) when its value is STRICTLY LESS than `level`
//     (value >= level is outside). So for f = |p| - R the inside of a sphere is the ball.
//   * Grid layout: values[i + (nx+1) * (j + (ny+1) * k)], x fastest, then y, then z.
//     A grid with nx x ny x nz cells has (nx+1)(ny+1)(nz+1) lattice points; 2D grids have nz = 0.
//   * Non-finite samples are replaced by +/-3e38 when sampling (NaN -> +3e38, i.e. outside).
//   * Float32 storage means level crossings are located to ~1e-7 relative precision.
//
// SQUARE CELL (2D)               CUBE CELL (3D, z up)
//     c3 ----e2---- c2               7 -----e6----- 6        corners  (x,y,z):
//     |             |               /|             /|          0 (0,0,0)  4 (0,0,1)
//    e3             e1             e11            e10         1 (1,0,0)  5 (1,0,1)
//     |             |             / e7           / e5         2 (1,1,0)  6 (1,1,1)
//     c0 ----e0---- c1            4 -----e4----- 5  |         3 (0,1,0)  7 (0,1,1)
//   y                              |  3 ---e2----|-- 2
//   ^                             e8 /           e9 /        edges (corner pairs):
//   +--> x                         |/ e3          |/ e1       e0 0-1  e1 1-2  e2 2-3  e3 3-0
//                                  0 -----e0----- 1          e4 4-5  e5 5-6  e6 6-7  e7 7-4
//                                                            e8 0-4  e9 1-5  e10 2-6  e11 3-7
//
// MESH ORIENTATION (3D): `orientation: 'lower'` (default) makes the counter-clockwise triangle
// normal AND the `normals` array point toward LOWER field values (into the "inside" region);
// `orientation: 'higher'` flips both so they point toward increasing values. Normals are the
// normalised central-difference gradient of the sampled field (interpolated along the edge).

const BIG = 3e38;

/** Corner offsets (x,y,z) of a cube cell; see the diagram above. */
export const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
/** Corner pairs joined by each of the 12 cube edges. */
export const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// ---------------------------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------------------------

/**
 * Sample fn on the (nx+1)(ny+1)(nz+1) lattice over `bounds`. Omit nz for a 2D grid (fn(x, y),
 * nz = 0). Returns { values: Float32Array, nx, ny, nz, bounds }.
 */
export function gridSample(fn, bounds, nx, ny, nz) {
  const is3 = nz !== undefined && nz !== null;
  const NZ = is3 ? nz : 0;
  for (const n of is3 ? [nx, ny, NZ] : [nx, ny]) {
    if (!Number.isInteger(n) || n < 1) throw new Error('gridSample: cell counts must be integers >= 1');
  }
  const b = is3
    ? { xmin: bounds.xmin, xmax: bounds.xmax, ymin: bounds.ymin, ymax: bounds.ymax, zmin: bounds.zmin, zmax: bounds.zmax }
    : { xmin: bounds.xmin, xmax: bounds.xmax, ymin: bounds.ymin, ymax: bounds.ymax };
  const values = new Float32Array((nx + 1) * (ny + 1) * (NZ + 1));
  const dx = (b.xmax - b.xmin) / nx;
  const dy = (b.ymax - b.ymin) / ny;
  const dz = is3 ? (b.zmax - b.zmin) / NZ : 0;
  let p = 0;
  for (let k = 0; k <= NZ; k++) {
    const z = is3 ? b.zmin + k * dz : 0;
    for (let j = 0; j <= ny; j++) {
      const y = b.ymin + j * dy;
      for (let i = 0; i <= nx; i++) {
        const x = b.xmin + i * dx;
        let v = is3 ? fn(x, y, z) : fn(x, y);
        if (!(v === v)) v = BIG; // NaN -> outside
        else if (v > BIG) v = BIG;
        else if (v < -BIG) v = -BIG;
        values[p++] = v;
      }
    }
  }
  return { values, nx, ny, nz: NZ, bounds: b };
}

function resolveGrid(src, opts, dim) {
  if (typeof src === 'function') {
    if (!opts || !opts.bounds) throw new Error('a field function needs opts.bounds');
    return dim === 2
      ? gridSample(src, opts.bounds, opts.nx, opts.ny)
      : gridSample(src, opts.bounds, opts.nx, opts.ny, opts.nz);
  }
  if (!src || !src.values) throw new Error('expected a grid from gridSample or a function');
  return src;
}

// ---------------------------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------------------------

/**
 * Case index of a square cell. Corner order: c0 = (x0,y0), c1 = (x1,y0), c2 = (x1,y1),
 * c3 = (x0,y1) (counter-clockwise from bottom-left). Bit i is set when ci < level.
 */
export function squareCase(c0, c1, c2, c3, level = 0) {
  return (c0 < level ? 1 : 0) | (c1 < level ? 2 : 0) | (c2 < level ? 4 : 0) | (c3 < level ? 8 : 0);
}

/**
 * For each of the 16 cases the list of [edgeA, edgeB] segments (edges: 0 bottom c0-c1, 1 right
 * c1-c2, 2 top c3-c2, 3 left c0-c3). Segments run with the inside (value < level) on their LEFT.
 * Cases 5 and 10 are saddles; the table holds the "separated" resolution (the inside corners
 * are cut off individually). SQUARE_SADDLE_CONNECTED holds the alternative in which the two
 * inside corners are joined.
 */
export const SQUARE_EDGES = [
  [], [[0, 3]], [[1, 0]], [[1, 3]], [[2, 1]], [[0, 3], [2, 1]], [[2, 0]], [[2, 3]],
  [[3, 2]], [[0, 2]], [[1, 0], [3, 2]], [[1, 2]], [[3, 1]], [[0, 1]], [[3, 0]], [],
];
export const SQUARE_SADDLE_CONNECTED = { 5: [[0, 1], [2, 3]], 10: [[3, 0], [1, 2]] };

// Flat copies for the hot loop: segment edge pairs per case (up to 2 segments).
const SQ_COUNT = new Uint8Array(16);
const SQ_FLAT = new Int8Array(16 * 4);
const SQ_ALT_FLAT = new Int8Array(16 * 4);
for (let c = 0; c < 16; c++) {
  const segs = SQUARE_EDGES[c];
  SQ_COUNT[c] = segs.length;
  segs.forEach((s, n) => { SQ_FLAT[c * 4 + n * 2] = s[0]; SQ_FLAT[c * 4 + n * 2 + 1] = s[1]; });
  const alt = SQUARE_SADDLE_CONNECTED[c] || segs;
  alt.forEach((s, n) => { SQ_ALT_FLAT[c * 4 + n * 2] = s[0]; SQ_ALT_FLAT[c * 4 + n * 2 + 1] = s[1]; });
}

/**
 * Contour of a 2D grid (or of fn sampled with opts.bounds/nx/ny) at `level`.
 * Returns { segments: Float64Array [x0,y0,x1,y1,...], count, cases: Uint8Array (per cell, x
 * fastest) }. With disambiguate, saddle cells are resolved by comparing the cell-centre average
 * with `level` (the inside corners connect when the average is below level).
 */
export function marchingSquares(src, opts = {}) {
  const { level = 0, interpolate = true, disambiguate = true } = opts;
  const g = resolveGrid(src, opts, 2);
  const { values: v, nx, ny, bounds: b } = g;
  const sx = nx + 1;
  const dx = (b.xmax - b.xmin) / nx;
  const dy = (b.ymax - b.ymin) / ny;
  const cases = new Uint8Array(nx * ny);
  let cap = 1024;
  let seg = new Float64Array(cap * 4);
  let count = 0;

  // Crossing on `edge` of the cell with origin lattice (i, j); writes into px/py.
  let px = 0;
  let py = 0;
  const cross = (edge, i, j, c0, c1, c2, c3) => {
    let a;
    let bb;
    let x0 = i;
    let y0 = j;
    let ax = 1;
    let ay = 0;
    switch (edge) {
      case 0: a = c0; bb = c1; break;
      case 1: a = c1; bb = c2; x0 = i + 1; ax = 0; ay = 1; break;
      case 2: a = c3; bb = c2; y0 = j + 1; break;
      default: a = c0; bb = c3; ax = 0; ay = 1; break;
    }
    let t = 0.5;
    if (interpolate) {
      t = (level - a) / (bb - a);
      if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    }
    px = b.xmin + (x0 + ax * t) * dx;
    py = b.ymin + (y0 + ay * t) * dy;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = i + sx * j;
      const c0 = v[p];
      const c1 = v[p + 1];
      const c2 = v[p + 1 + sx];
      const c3 = v[p + sx];
      const cs = (c0 < level ? 1 : 0) | (c1 < level ? 2 : 0) | (c2 < level ? 4 : 0) | (c3 < level ? 8 : 0);
      cases[i + nx * j] = cs;
      const n = SQ_COUNT[cs];
      if (n === 0) continue;
      let tbl = SQ_FLAT;
      if (disambiguate && (cs === 5 || cs === 10) && (c0 + c1 + c2 + c3) * 0.25 < level) tbl = SQ_ALT_FLAT;
      for (let s = 0; s < n; s++) {
        if (count === cap) {
          cap *= 2;
          const grown = new Float64Array(cap * 4);
          grown.set(seg);
          seg = grown;
        }
        cross(tbl[cs * 4 + s * 2], i, j, c0, c1, c2, c3);
        seg[count * 4] = px; seg[count * 4 + 1] = py;
        cross(tbl[cs * 4 + s * 2 + 1], i, j, c0, c1, c2, c3);
        seg[count * 4 + 2] = px; seg[count * 4 + 3] = py;
        count++;
      }
    }
  }
  return { segments: seg.slice(0, count * 4), count, cases };
}

// ---------------------------------------------------------------------------------------------
// Cube case tables (generated at load from the 15 Lorensen-Cline base cases)
// ---------------------------------------------------------------------------------------------

const edgeIndex = new Map(); // ordered corner pair key -> cube edge
CUBE_EDGES.forEach(([a, b], e) => { edgeIndex.set(a * 8 + b, e); edgeIndex.set(b * 8 + a, e); });
const cornerIndex = new Map(CUBE_CORNERS.map((c, i) => [c.join(','), i]));
const mid = (e) => {
  const [a, b] = CUBE_EDGES[e];
  return [0, 1, 2].map((d) => (CUBE_CORNERS[a][d] + CUBE_CORNERS[b][d]) / 2);
};
const popcount = (m) => { let n = 0; for (; m; m &= m - 1) n++; return n; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The 48 symmetries of the cube as corner permutations, with the sign of their determinant.
const SYMMETRIES = [];
{
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const parity = [1, -1, -1, 1, 1, -1];
  perms.forEach((perm, pi) => {
    for (let f = 0; f < 8; f++) {
      const flips = [f & 1, (f >> 1) & 1, (f >> 2) & 1];
      const map = CUBE_CORNERS.map((c) => {
        const q = [0, 1, 2].map((d) => (flips[d] ? 1 - c[perm[d]] : c[perm[d]]));
        return cornerIndex.get(q.join(','));
      });
      const det = (flips[0] + flips[1] + flips[2]) % 2 === 0 ? parity[pi] : -parity[pi];
      SYMMETRIES.push({ map, det, edgeMap: CUBE_EDGES.map(([a, b]) => edgeIndex.get(map[a] * 8 + map[b])) });
    }
  });
}
const mapMask = (sym, m) => {
  let r = 0;
  for (let i = 0; i < 8; i++) if (m & (1 << i)) r |= 1 << sym.map[i];
  return r;
};

// Cube faces: their corners, edges and outward normal.
const FACES = [0, 1, 2].flatMap((d) => [0, 1].map((s) => {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => CUBE_CORNERS[c][d] === s);
  const edges = [];
  CUBE_EDGES.forEach(([a, b], e) => { if (corners.includes(a) && corners.includes(b)) edges.push(e); });
  const normal = [0, 0, 0];
  normal[d] = s ? 1 : -1;
  return { corners, edges, normal };
}));

/**
 * Triangulation of a base case: contour segments on each cube face (ambiguous faces split so
 * that the INSIDE corners are separated), chained into loops, each loop fanned into triangles
 * with the CCW normal pointing toward the inside.
 */
function baseTriangles(mask) {
  const inside = (c) => (mask >> c) & 1;
  const crossing = (e) => inside(CUBE_EDGES[e][0]) !== inside(CUBE_EDGES[e][1]);
  const adj = new Map(); // edge -> its two neighbours along the contour (one per face)
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  };
  for (const f of FACES) {
    const ce = f.edges.filter(crossing);
    if (ce.length === 2) link(ce[0], ce[1]);
    else if (ce.length === 4) {
      for (const c of f.corners.filter(inside)) {
        const own = ce.filter((e) => CUBE_EDGES[e].includes(c));
        link(own[0], own[1]);
      }
    }
  }
  const seen = new Set();
  const tris = [];
  for (const start of [...adj.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const loop = [start];
    seen.add(start);
    let prev = start;
    let cur = adj.get(start)[0];
    while (cur !== start) {
      loop.push(cur);
      seen.add(cur);
      const nb = adj.get(cur);
      const next = nb[0] === prev ? nb[1] : nb[0];
      prev = cur;
      cur = next;
    }
    // Orient: the segment loop[0] -> loop[1] lies on a common face F; its normal must point
    // toward the inside corner of loop[0]'s edge.
    const A = mid(loop[0]);
    const B = mid(loop[1]);
    const F = FACES.find((f) => f.edges.includes(loop[0]) && f.edges.includes(loop[1]));
    const C = loop.map(mid).find((p) => Math.abs(dot3(sub3(p, A), F.normal)) > 1e-9);
    const inCorner = CUBE_EDGES[loop[0]].find(inside);
    const n = cross3(sub3(B, A), sub3(C, A));
    if (dot3(n, sub3(CUBE_CORNERS[inCorner], A)) < 0) loop.reverse();
    for (let k = 1; k + 1 < loop.length; k++) tris.push([loop[0], loop[k], loop[k + 1]]);
  }
  return tris;
}

// Classes of the 256 cases under the 48 symmetries and complementation -> the 15 base cases.
const CLASS_OF = new Int16Array(256).fill(-1);
const BASE_MASKS = [];
for (let m = 0; m < 256; m++) {
  if (CLASS_OF[m] >= 0) continue;
  const id = BASE_MASKS.length;
  const members = new Set();
  for (const s of SYMMETRIES) {
    const t = mapMask(s, m);
    members.add(t);
    members.add(255 ^ t);
  }
  for (const t of members) CLASS_OF[t] = id;
  // representative: fewest inside corners, then smallest index
  BASE_MASKS.push([...members].sort((a, b) => popcount(a) - popcount(b) || a - b)[0]);
}
const BASE_TRIS = BASE_MASKS.map(baseTriangles);

/**
 * TRI_TABLE[case] = flat list of cube-edge indices, three per triangle (no -1 terminator), CCW
 * as seen from the side the normal points to = toward the inside (values < level).
 * EDGE_TABLE[case] = 12-bit mask of the cube edges the surface crosses.
 * Built from the 15 base cases by rotation/reflection/complement exactly like the original
 * Lorensen-Cline construction, so it shares its face ambiguities: the same face pattern can be
 * triangulated "connected" by one cube and "separated" by its neighbour (complement cases
 * reuse the triangles of the base case but flip which corners they cut off), which leaves
 * cracks. CLASSIC_AMBIGUOUS_CASES lists every case that has such a face.
 */
export const TRI_TABLE = [];
export const EDGE_TABLE = new Uint16Array(256);
export const CLASSIC_AMBIGUOUS_CASES = [];
for (let c = 0; c < 256; c++) {
  let em = 0;
  CUBE_EDGES.forEach(([a, b], e) => { if (((c >> a) & 1) !== ((c >> b) & 1)) em |= 1 << e; });
  EDGE_TABLE[c] = em;
  if (FACES.some((f) => f.edges.filter((e) => (em >> e) & 1).length === 4)) CLASSIC_AMBIGUOUS_CASES.push(c);
  const cls = CLASS_OF[c];
  const base = BASE_MASKS[cls];
  let found = null;
  for (const comp of [false, true]) {
    for (const s of SYMMETRIES) {
      const t = mapMask(s, base);
      if ((comp ? 255 ^ t : t) === c) { found = { s, comp }; break; }
    }
    if (found) break;
  }
  const flip = (found.s.det < 0) !== found.comp;
  const e = found.s.edgeMap;
  const flat = [];
  for (const [a, b, d] of BASE_TRIS[cls]) {
    if (flip) flat.push(e[a], e[d], e[b]); else flat.push(e[a], e[b], e[d]);
  }
  TRI_TABLE.push(flat);
}

/** Case index of a cube from its 8 corner values (corner order above); bit i set when < level. */
export function cubeCase(corners, level = 0) {
  let m = 0;
  for (let i = 0; i < 8; i++) if (corners[i] < level) m |= 1 << i;
  return m;
}

/** Triangles of a classic case as an array of [e0, e1, e2] cube-edge triples. */
export function cubeCaseTriangles(index) {
  const f = TRI_TABLE[index];
  const out = [];
  for (let i = 0; i < f.length; i += 3) out.push([f[i], f[i + 1], f[i + 2]]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Marching tetrahedra tables
// ---------------------------------------------------------------------------------------------

/**
 * Six tetrahedra around the main diagonal 0-6 (Kuhn / Freudenthal split). The split induces the
 * same diagonal on every face for all cubes (translation invariance), so neighbours agree.
 */
export const TETRAHEDRA = [[0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6]];

// Edge "slots": the 12 cube edges, then the face diagonals and main diagonal used by tets.
// Each slot has a lower corner (componentwise <=), a higher corner, and a class 1..7 giving the
// lattice offset (dx | dy<<1 | dz<<2) between them; (lowerPoint, class) is the weld key.
const SLOT_PAIRS = CUBE_EDGES.map(([a, b]) => [a, b]);
const slotOf = new Map();
SLOT_PAIRS.forEach(([a, b], i) => { slotOf.set(a * 8 + b, i); slotOf.set(b * 8 + a, i); });
for (const t of TETRAHEDRA) {
  for (let p = 0; p < 4; p++) {
    for (let q = p + 1; q < 4; q++) {
      const a = t[p];
      const b = t[q];
      if (!slotOf.has(a * 8 + b)) {
        slotOf.set(a * 8 + b, SLOT_PAIRS.length);
        slotOf.set(b * 8 + a, SLOT_PAIRS.length);
        SLOT_PAIRS.push([a, b]);
      }
    }
  }
}
const SLOT_LO = new Int8Array(SLOT_PAIRS.length);
const SLOT_HI = new Int8Array(SLOT_PAIRS.length);
const SLOT_CLS = new Int8Array(SLOT_PAIRS.length);
SLOT_PAIRS.forEach(([a, b], s) => {
  const ca = CUBE_CORNERS[a];
  const cb = CUBE_CORNERS[b];
  let lo = a;
  let hi = b;
  if (ca.some((v, d) => v > cb[d])) {
    lo = b; hi = a;
    if (cb.some((v, d) => v > ca[d])) throw new Error('internal: edge endpoints are not comparable');
  }
  SLOT_LO[s] = lo;
  SLOT_HI[s] = hi;
  SLOT_CLS[s] = CUBE_CORNERS[hi][0] - CUBE_CORNERS[lo][0] + 2 * (CUBE_CORNERS[hi][1] - CUBE_CORNERS[lo][1])
    + 4 * (CUBE_CORNERS[hi][2] - CUBE_CORNERS[lo][2]);
});

// TET_TRIS[t * 16 + submask] = flat slot triples, oriented with the CCW normal toward the inside.
const TET_TRIS = [];
for (let t = 0; t < 6; t++) {
  const corners = TETRAHEDRA[t];
  for (let sub = 0; sub < 16; sub++) {
    const ins = corners.filter((_, q) => (sub >> q) & 1);
    const out = corners.filter((_, q) => !((sub >> q) & 1));
    const tris = [];
    if (ins.length === 1 || ins.length === 3) {
      const lone = ins.length === 1 ? ins[0] : out[0];
      const others = ins.length === 1 ? out : ins;
      tris.push(others.map((o) => [lone, o]));
    } else if (ins.length === 2) {
      const [a, b] = ins;
      const [c, d] = out;
      tris.push([[a, c], [a, d], [b, d]], [[a, c], [b, d], [b, c]]);
    }
    const insC = [0, 1, 2].map((d) => ins.reduce((s, c) => s + CUBE_CORNERS[c][d], 0) / Math.max(1, ins.length));
    const flat = [];
    for (const tri of tris) {
      const P = tri.map(([a, b]) => [0, 1, 2].map((d) => (CUBE_CORNERS[a][d] + CUBE_CORNERS[b][d]) / 2));
      const n = cross3(sub3(P[1], P[0]), sub3(P[2], P[0]));
      const cen = [0, 1, 2].map((d) => (P[0][d] + P[1][d] + P[2][d]) / 3);
      const ids = tri.map(([a, b]) => slotOf.get(a * 8 + b));
      if (dot3(n, sub3(insC, cen)) < 0) flat.push(ids[0], ids[2], ids[1]);
      else flat.push(ids[0], ids[1], ids[2]);
    }
    TET_TRIS.push(Int8Array.from(flat));
  }
}
const CLASSIC_FLAT = TRI_TABLE.map((t) => Int8Array.from(t));

// ---------------------------------------------------------------------------------------------
// Marching cubes / tetrahedra
// ---------------------------------------------------------------------------------------------

/**
 * Extract the isosurface at `level` from a 3D grid (or fn + opts.bounds/nx/ny/nz).
 * opts.algorithm: 'classic' (256-case table, may leave cracks at ambiguous faces) or 'tetra'
 * (marching tetrahedra, always watertight). opts.orientation: 'lower' (default) or 'higher'.
 * Returns { positions: Float32Array, normals: Float32Array, indices: Uint32Array,
 * triangleCount, vertexCount, cases: Uint8Array } with welded vertices; cases holds the cube
 * case index (0..255) per cell, x fastest. A surface passing exactly through a lattice point
 * yields coincident (but distinct) vertices on the edges meeting there.
 */
export function marchingCubes(src, opts = {}) {
  const { level = 0, interpolate = true, algorithm = 'classic', orientation = 'lower' } = opts;
  if (algorithm !== 'classic' && algorithm !== 'tetra') throw new Error(`unknown algorithm '${algorithm}'`);
  const g = resolveGrid(src, opts, 3);
  const { values: v, nx, ny, nz, bounds: b } = g;
  if (!(nz >= 1)) throw new Error('marchingCubes needs a 3D grid (nz >= 1)');
  const sx = nx + 1;
  const sy = ny + 1;
  const sxy = sx * sy;
  const dx = (b.xmax - b.xmin) / nx;
  const dy = (b.ymax - b.ymin) / ny;
  const dz = (b.zmax - b.zmin) / nz;
  const nSign = orientation === 'higher' ? 1 : -1; // normals = nSign * normalised gradient
  const flipWinding = orientation === 'higher';
  const cases = new Uint8Array(nx * ny * nz);
  const weld = new Int32Array(8 * sxy * (nz + 1)).fill(-1);

  const off = new Int32Array(8);
  for (let c = 0; c < 8; c++) off[c] = CUBE_CORNERS[c][0] + sx * CUBE_CORNERS[c][1] + sxy * CUBE_CORNERS[c][2];

  let vcap = 1024;
  let pos = new Float32Array(vcap * 3);
  let nor = new Float32Array(vcap * 3);
  let vcount = 0;
  let icap = 3072;
  let idx = new Uint32Array(icap);
  let icount = 0;

  let gx = 0;
  let gy = 0;
  let gz = 0;
  const gradient = (p, i, j, k) => {
    gx = i === 0 ? (v[p + 1] - v[p]) / dx : i === nx ? (v[p] - v[p - 1]) / dx : (v[p + 1] - v[p - 1]) / (2 * dx);
    gy = j === 0 ? (v[p + sx] - v[p]) / dy : j === ny ? (v[p] - v[p - sx]) / dy : (v[p + sx] - v[p - sx]) / (2 * dy);
    gz = k === 0 ? (v[p + sxy] - v[p]) / dz : k === nz ? (v[p] - v[p - sxy]) / dz : (v[p + sxy] - v[p - sxy]) / (2 * dz);
  };

  // Welded vertex on edge `slot` of the cell with origin lattice point (base = (i, j, k)).
  const vertex = (slot, base, i, j, k) => {
    const lo = SLOT_LO[slot];
    const hi = SLOT_HI[slot];
    const pLo = base + off[lo];
    const key = pLo * 8 + SLOT_CLS[slot];
    const have = weld[key];
    if (have >= 0) return have;
    if (vcount === vcap) {
      vcap *= 2;
      const p2 = new Float32Array(vcap * 3); p2.set(pos); pos = p2;
      const n2 = new Float32Array(vcap * 3); n2.set(nor); nor = n2;
    }
    const pHi = base + off[hi];
    let t = 0.5;
    if (interpolate) {
      t = (level - v[pLo]) / (v[pHi] - v[pLo]);
      if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    }
    const li = i + CUBE_CORNERS[lo][0];
    const lj = j + CUBE_CORNERS[lo][1];
    const lk = k + CUBE_CORNERS[lo][2];
    const hiI = i + CUBE_CORNERS[hi][0];
    const hiJ = j + CUBE_CORNERS[hi][1];
    const hiK = k + CUBE_CORNERS[hi][2];
    const o = vcount * 3;
    pos[o] = b.xmin + (li + (hiI - li) * t) * dx;
    pos[o + 1] = b.ymin + (lj + (hiJ - lj) * t) * dy;
    pos[o + 2] = b.zmin + (lk + (hiK - lk) * t) * dz;
    gradient(pLo, li, lj, lk);
    const ax = gx;
    const ay = gy;
    const az = gz;
    gradient(pHi, hiI, hiJ, hiK);
    let nxv = ax + (gx - ax) * t;
    let nyv = ay + (gy - ay) * t;
    let nzv = az + (gz - az) * t;
    const len = Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv);
    if (len > 1e-30 && len < Infinity) { nxv /= len; nyv /= len; nzv /= len; } else { nxv = 0; nyv = 0; nzv = 1; }
    nor[o] = nSign * nxv;
    nor[o + 1] = nSign * nyv;
    nor[o + 2] = nSign * nzv;
    weld[key] = vcount;
    return vcount++;
  };

  const emit = (a, bb, c) => {
    if (icount + 3 > icap) {
      icap *= 2;
      const i2 = new Uint32Array(icap); i2.set(idx); idx = i2;
    }
    idx[icount++] = a;
    if (flipWinding) { idx[icount++] = c; idx[icount++] = bb; } else { idx[icount++] = bb; idx[icount++] = c; }
  };

  const classic = algorithm === 'classic';
  let cell = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++, cell++) {
        const base = i + sx * j + sxy * k;
        const m = (v[base] < level ? 1 : 0) | (v[base + off[1]] < level ? 2 : 0)
          | (v[base + off[2]] < level ? 4 : 0) | (v[base + off[3]] < level ? 8 : 0)
          | (v[base + off[4]] < level ? 16 : 0) | (v[base + off[5]] < level ? 32 : 0)
          | (v[base + off[6]] < level ? 64 : 0) | (v[base + off[7]] < level ? 128 : 0);
        cases[cell] = m;
        if (m === 0 || m === 255) continue;
        if (classic) {
          const tri = CLASSIC_FLAT[m];
          for (let q = 0; q < tri.length; q += 3) {
            emit(vertex(tri[q], base, i, j, k), vertex(tri[q + 1], base, i, j, k), vertex(tri[q + 2], base, i, j, k));
          }
        } else {
          for (let t = 0; t < 6; t++) {
            const tc = TETRAHEDRA[t];
            const sub = ((m >> tc[0]) & 1) | (((m >> tc[1]) & 1) << 1) | (((m >> tc[2]) & 1) << 2) | (((m >> tc[3]) & 1) << 3);
            const tri = TET_TRIS[t * 16 + sub];
            for (let q = 0; q < tri.length; q += 3) {
              emit(vertex(tri[q], base, i, j, k), vertex(tri[q + 1], base, i, j, k), vertex(tri[q + 2], base, i, j, k));
            }
          }
        }
      }
    }
  }
  return {
    positions: pos.slice(0, vcount * 3),
    normals: nor.slice(0, vcount * 3),
    indices: idx.slice(0, icount),
    triangleCount: icount / 3,
    vertexCount: vcount,
    cases,
  };
}
