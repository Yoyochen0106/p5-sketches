// Inspection helpers for the Marching Squares & Cubes sketch: explain ONE cell (square or cube) of a
// grid produced by lib/marching.js, plus iso-level slider arithmetic. Pure, no DOM.
import {
  SQUARE_EDGES, SQUARE_SADDLE_CONNECTED, CUBE_CORNERS, CUBE_EDGES, TRI_TABLE, EDGE_TABLE, CLASSIC_AMBIGUOUS_CASES,
} from './marching.js';

// ---------------------------------------------------------------------------------------------
// Square cells

/** Corner pair (c_a, c_b) of each square edge, in the order used by marchingSquares. */
export const SQUARE_EDGE_CORNERS = [[0, 1], [1, 2], [3, 2], [0, 3]];
export const SQUARE_EDGE_NAMES = ['bottom', 'right', 'top', 'left'];
const SQUARE_CORNER_OFFSETS = [[0, 0], [1, 0], [1, 1], [0, 1]];

const num = (v) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
};

/**
 * Everything about square cell (i, j) of a 2D grid at `level`: corner samples, case index, crossed
 * edges, the crossing points (with the interpolation parameter t) and the resulting segments.
 * Mirrors marchingSquares exactly (same corner order, inside = value < level, saddle rule).
 * Returns null when (i, j) is outside the grid.
 */
export function squareCellInfo(grid, i, j, level, { interpolate = true, disambiguate = true } = {}) {
  const { values, nx, ny, bounds: b } = grid;
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= nx || j >= ny) return null;
  const sx = nx + 1;
  const dx = (b.xmax - b.xmin) / nx;
  const dy = (b.ymax - b.ymin) / ny;
  const corners = SQUARE_CORNER_OFFSETS.map(([a, c], n) => {
    const ci = i + a, cj = j + c;
    const v = values[ci + sx * cj];
    return { n, i: ci, j: cj, x: b.xmin + ci * dx, y: b.ymin + cj * dy, v, inside: v < level };
  });
  const caseIndex = (corners[0].inside ? 1 : 0) | (corners[1].inside ? 2 : 0) | (corners[2].inside ? 4 : 0) | (corners[3].inside ? 8 : 0);
  const saddle = caseIndex === 5 || caseIndex === 10;
  const avg = (corners[0].v + corners[1].v + corners[2].v + corners[3].v) / 4;
  const connected = disambiguate && saddle && avg < level;
  const table = connected ? SQUARE_SADDLE_CONNECTED[caseIndex] : SQUARE_EDGES[caseIndex];
  const crossing = (e) => {
    const [ia, ib] = SQUARE_EDGE_CORNERS[e];
    const A = corners[ia], B = corners[ib];
    let t = 0.5;
    if (interpolate) {
      t = (level - A.v) / (B.v - A.v);
      if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    }
    return { edge: e, a: ia, b: ib, va: A.v, vb: B.v, t, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  };
  const crossedEdges = [0, 1, 2, 3].filter((e) => {
    const [ia, ib] = SQUARE_EDGE_CORNERS[e];
    return corners[ia].inside !== corners[ib].inside;
  });
  const crossings = {};
  for (const e of crossedEdges) crossings[e] = crossing(e);
  const segments = table.map(([ea, eb]) => ({ edges: [ea, eb], p0: [crossings[ea].x, crossings[ea].y], p1: [crossings[eb].x, crossings[eb].y] }));
  return {
    i, j, level, interpolate, disambiguate, corners, caseIndex, bits: caseIndex.toString(2).padStart(4, '0'),
    saddle, avg, connected, crossedEdges, crossings, segments,
    x0: corners[0].x, x1: corners[2].x, y0: corners[0].y, y1: corners[2].y, dx, dy,
  };
}

/** Human-readable explanation of a squareCellInfo result as an array of text lines. */
export function describeSquareCell(info) {
  const L = [];
  L.push(`Cell (${info.i}, ${info.j})   x in [${num(info.x0)}, ${num(info.x1)}]  y in [${num(info.y0)}, ${num(info.y1)}]`);
  L.push(`iso-level L = ${num(info.level)}   (inside = value < L)`);
  for (const c of info.corners) L.push(`  c${c.n} (${num(c.x)}, ${num(c.y)})  f = ${num(c.v)}  ${c.inside ? '- inside' : '+ outside'}`);
  L.push(`case ${info.caseIndex} = 0b${info.bits}  (bits c3 c2 c1 c0; 1 = inside)`);
  if (!info.crossedEdges.length) {
    L.push('no edge is crossed: no contour in this cell');
    return L;
  }
  L.push(`crossed edges: ${info.crossedEdges.map((e) => `e${e} ${SQUARE_EDGE_NAMES[e]}`).join(', ')}`);
  if (info.saddle) {
    const how = info.disambiguate
      ? `centre average ${num(info.avg)} ${info.avg < info.level ? '<' : '>='} L -> ${info.connected ? 'inside corners joined' : 'inside corners separated'}`
      : 'disambiguation off -> fixed table choice (separated)';
    L.push(`ambiguous saddle case: ${how}`);
  }
  info.segments.forEach((s, n) => L.push(`segment ${n + 1}: e${s.edges[0]} -> e${s.edges[1]}   (${num(s.p0[0])}, ${num(s.p0[1])}) -> (${num(s.p1[0])}, ${num(s.p1[1])})`));
  for (const e of info.crossedEdges) {
    const c = info.crossings[e];
    if (info.interpolate) {
      L.push(`e${e}: t = (L - f${c.a}) / (f${c.b} - f${c.a}) = (${num(info.level)} - ${num(c.va)}) / (${num(c.vb)} - ${num(c.va)}) = ${num(c.t)}`);
    } else {
      L.push(`e${e}: midpoint, t = 1/2`);
    }
    L.push(`    point = c${c.a} + t (c${c.b} - c${c.a}) = (${num(c.x)}, ${num(c.y)})`);
  }
  return L;
}

// ---------------------------------------------------------------------------------------------
// Cube cases

const popcount = (m) => { let n = 0; for (; m; m &= m - 1) n++; return n; };

// Classes of the 256 cases under the 24 cube rotations and complementation (the 15 base cases of
// Lorensen & Cline). Ids are assigned in order of the first case index of each class, so class 0
// is the empty case and the numbering matches lib/marching.js.
const CLASS_OF = new Uint8Array(256).fill(255);
export const CUBE_CLASS_COUNT = (() => {
  const cornerIndex = new Map(CUBE_CORNERS.map((c, n) => [c.join(','), n]));
  const maps = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const parity = [1, -1, -1, 1, 1, -1];
  for (const [pi, perm] of perms.entries()) {
    for (let f = 0; f < 8; f++) {
      const flips = (f & 1) + ((f >> 1) & 1) + ((f >> 2) & 1);
      if (parity[pi] * (flips % 2 ? -1 : 1) < 0) continue; // proper rotations only (mirror images stay distinct, as in Lorensen & Cline)
      maps.push(CUBE_CORNERS.map((c) => cornerIndex.get([0, 1, 2].map((d) => ((f >> d) & 1 ? 1 - c[perm[d]] : c[perm[d]])).join(','))));
    }
  }
  let next = 0;
  for (let m = 0; m < 256; m++) {
    if (CLASS_OF[m] !== 255) continue;
    for (const map of maps) {
      let t = 0;
      for (let k = 0; k < 8; k++) if (m & (1 << k)) t |= 1 << map[k];
      CLASS_OF[t] = next;
      CLASS_OF[255 ^ t] = next;
    }
    next++;
  }
  return next;
})();

/** Class (0..14) of a cube case under symmetry + complement. */
export const cubeClass = (index) => CLASS_OF[index & 255];

/**
 * Description of classic cube case `index`: binary string (corner 7 first), inside corners,
 * class of the 15 base cases, triangles as cube-edge triples, crossed edges and ambiguity flag.
 */
export function cubeCaseInfo(index) {
  const m = ((index | 0) % 256 + 256) % 256;
  const flat = TRI_TABLE[m];
  const triangles = [];
  for (let i = 0; i < flat.length; i += 3) triangles.push([flat[i], flat[i + 1], flat[i + 2]]);
  const crossedEdges = [];
  for (let e = 0; e < 12; e++) if ((EDGE_TABLE[m] >> e) & 1) crossedEdges.push(e);
  return {
    index: m,
    binary: m.toString(2).padStart(8, '0'),
    insideCorners: [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => (m >> c) & 1),
    insideCount: popcount(m),
    cls: CLASS_OF[m],
    triangles,
    triangleCount: triangles.length,
    crossedEdges,
    ambiguous: CLASSIC_AMBIGUOUS_CASES.includes(m),
  };
}

/**
 * Unit-cube geometry of a case for drawing: corner positions, inside flags, edge crossing points
 * and the triangles as point triples. Without `values` (8 corner samples) crossings are edge
 * midpoints; with them they are linearly interpolated at `level` like the mesher does.
 */
export function cubeCaseGeometry(index, values = null, level = 0) {
  const info = cubeCaseInfo(index);
  const corners = CUBE_CORNERS.map((c) => c.slice());
  const inside = corners.map((_, c) => ((info.index >> c) & 1) === 1);
  const edgePoints = CUBE_EDGES.map(([a, b], e) => {
    if (!((EDGE_TABLE[info.index] >> e) & 1)) return null;
    let t = 0.5;
    if (values) {
      t = (level - values[a]) / (values[b] - values[a]);
      if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
    }
    return [0, 1, 2].map((d) => corners[a][d] + (corners[b][d] - corners[a][d]) * t);
  });
  const triangles = info.triangles.map((tri) => tri.map((e) => edgePoints[e]));
  return { ...info, corners, inside, edgePoints, trianglePoints: triangles };
}

/** The 8 corner samples of cell (i, j, k) of a 3D grid in cube-corner order. */
export function cubeCornerValues(grid, i, j, k) {
  const sx = grid.nx + 1, sxy = sx * (grid.ny + 1);
  return CUBE_CORNERS.map(([a, b, c]) => grid.values[i + a + sx * (j + b) + sxy * (k + c)]);
}

/**
 * Cell (i, j, k) of a 3D grid containing the point, clamped to the grid. When `cases` is given and
 * the cell is trivial (0 / 255) the nearest neighbouring cell with a surface is returned instead.
 */
export function locateCell(grid, x, y, z, cases = null) {
  const { nx, ny, nz, bounds: b } = grid;
  const f = (v, lo, hi, n) => {
    const t = Math.floor(((v - lo) / (hi - lo)) * n);
    return Math.max(0, Math.min(n - 1, Number.isFinite(t) ? t : 0));
  };
  const i = f(x, b.xmin, b.xmax, nx), j = f(y, b.ymin, b.ymax, ny), k = f(z, b.zmin, b.zmax, nz);
  const at = (a, c, d) => a + nx * (c + ny * d);
  if (!cases || (cases[at(i, j, k)] !== 0 && cases[at(i, j, k)] !== 255)) return { i, j, k };
  let best = null;
  let bestD = Infinity;
  const cx = (x - b.xmin) / (b.xmax - b.xmin) * nx, cy = (y - b.ymin) / (b.ymax - b.ymin) * ny, cz = (z - b.zmin) / (b.zmax - b.zmin) * nz;
  for (let dk = -1; dk <= 1; dk++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const a = i + di, c = j + dj, d = k + dk;
        if (a < 0 || c < 0 || d < 0 || a >= nx || c >= ny || d >= nz) continue;
        const cs = cases[at(a, c, d)];
        if (cs === 0 || cs === 255) continue;
        const dist = (a + 0.5 - cx) ** 2 + (c + 0.5 - cy) ** 2 + (d + 0.5 - cz) ** 2;
        if (dist < bestD) { bestD = dist; best = { i: a, j: c, k: d }; }
      }
    }
  }
  return best || { i, j, k };
}

// ---------------------------------------------------------------------------------------------
// Iso-level slider arithmetic: the slider is a unit value u in [0, 1] mapped onto a per-field range.

/** Range [lo, hi] covering the suggested levels and the default, padded by 8%. */
export function levelRange(levels, level) {
  const all = [...(levels || []), level].filter(Number.isFinite);
  if (!all.length) return [-1, 1];
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!(hi > lo)) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** 1, 2 or 5 times a power of ten that is >= x/1 (used to snap slider values to round numbers). */
export function niceStep(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const mag = 10 ** Math.floor(Math.log10(x));
  const n = x / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/** Level for slider position u: snapped to ~1/1000 of the range so round values (0, 0.5) are exact. */
export function levelFromU(u, range) {
  const [lo, hi] = range;
  const q = niceStep((hi - lo) / 1000);
  const v = Math.round((lo + Math.max(0, Math.min(1, u)) * (hi - lo)) / q) * q;
  const r = Number(v.toFixed(12));
  return r === 0 ? 0 : r;
}

/** Slider position of a level (clamped to [0, 1]). */
export function uFromLevel(level, range) {
  const [lo, hi] = range;
  return Math.max(0, Math.min(1, (level - lo) / (hi - lo)));
}
