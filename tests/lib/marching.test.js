import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gridSample, marchingSquares, marchingCubes, squareCase, SQUARE_EDGES, SQUARE_SADDLE_CONNECTED,
  cubeCase, cubeCaseTriangles, CUBE_CORNERS, CUBE_EDGES, TRI_TABLE, EDGE_TABLE, CLASSIC_AMBIGUOUS_CASES,
} from '../../lib/marching.js';
import { close, rng } from './helpers.js';

const B3 = { xmin: -1.5, xmax: 1.5, ymin: -1.5, ymax: 1.5, zmin: -1.5, zmax: 1.5 };
const B2 = { xmin: -2, xmax: 2, ymin: -2, ymax: 2 };
const sphere = (R) => (x, y, z) => Math.sqrt(x * x + y * y + z * z) - R;
const torus = (R, r) => (x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r;

// ---- mesh helpers --------------------------------------------------------------------------
function area(m) {
  let s = 0;
  const P = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
    s += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s;
}
/** Directed/undirected edge usage counts of a mesh. */
function edgeCounts(m) {
  const N = m.vertexCount;
  const undirected = new Map();
  const directed = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e];
      const b = m.indices[t + (e + 1) % 3];
      directed.set(a * N + b, (directed.get(a * N + b) || 0) + 1);
      const k = Math.min(a, b) * N + Math.max(a, b);
      undirected.set(k, (undirected.get(k) || 0) + 1);
    }
  }
  return { undirected, directed, N };
}
const onBoundary = (m, v, b) => {
  const [x, y, z] = [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
  const eps = 1e-5;
  return [Math.abs(x - b.xmin) < eps, Math.abs(x - b.xmax) < eps, Math.abs(y - b.ymin) < eps,
    Math.abs(y - b.ymax) < eps, Math.abs(z - b.zmin) < eps, Math.abs(z - b.zmax) < eps];
};
/** Number of undirected edges used by exactly one triangle that are NOT on the domain boundary. */
function interiorOpenEdges(m, b) {
  const { undirected, N } = edgeCounts(m);
  let open = 0;
  for (const [k, c] of undirected) {
    if (c !== 1) continue;
    const va = onBoundary(m, Math.floor(k / N), b);
    const vb = onBoundary(m, k % N, b);
    if (!va.some((f, i) => f && vb[i])) open++;
  }
  return open;
}
const maxEdgeUse = (m) => Math.max(...edgeCounts(m).undirected.values());
const maxDirectedUse = (m) => Math.max(...edgeCounts(m).directed.values());
function euler(m) {
  const { undirected } = edgeCounts(m);
  return m.vertexCount - undirected.size + m.triangleCount;
}
function randomField(seed, n = 8) {
  const r = rng(seed);
  const g = gridSample(() => 0, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, zmin: 0, zmax: 1 }, n, n, n);
  for (let i = 0; i < g.values.length; i++) g.values[i] = r() - 0.5 + 1e-4;
  return g;
}

// ---- sampling ------------------------------------------------------------------------------
test('gridSample: layout, sizes and non-finite guard', () => {
  const g = gridSample((x, y, z) => x + 10 * y + 100 * z, { xmin: 0, xmax: 2, ymin: 0, ymax: 3, zmin: 0, zmax: 4 }, 2, 3, 4);
  assert.equal(g.values.length, 3 * 4 * 5);
  assert.deepEqual([g.nx, g.ny, g.nz], [2, 3, 4]);
  assert.equal(g.values[1], 1); // x fastest
  assert.equal(g.values[3], 10); // then y
  assert.equal(g.values[12], 100); // then z
  const g2 = gridSample((x, y) => x * y, B2, 4, 5);
  assert.equal(g2.values.length, 5 * 6);
  assert.equal(g2.nz, 0);
  const bad = gridSample(() => NaN, B2, 2, 2);
  assert.ok(bad.values.every((v) => v === bad.values[0] && Number.isFinite(v) && v > 0));
  assert.throws(() => gridSample(() => 0, B2, 0, 2));
});

// ---- marching squares ----------------------------------------------------------------------
test('squareCase corner order and SQUARE_EDGES table', () => {
  assert.equal(squareCase(-1, 1, 1, 1), 1);
  assert.equal(squareCase(1, -1, 1, 1), 2);
  assert.equal(squareCase(1, 1, -1, 1), 4);
  assert.equal(squareCase(1, 1, 1, -1), 8);
  assert.equal(squareCase(0, 0, 0, 0, 0), 0); // value == level is outside
  assert.equal(squareCase(2, 2, 2, 2, 3), 15);
  const edgeCorners = [[0, 1], [1, 2], [3, 2], [0, 3]];
  for (let c = 0; c < 16; c++) {
    const inside = (k) => (c >> k) & 1;
    for (const seg of [...SQUARE_EDGES[c], ...(SQUARE_SADDLE_CONNECTED[c] || [])]) {
      for (const e of seg) assert.notEqual(inside(edgeCorners[e][0]), inside(edgeCorners[e][1]), `case ${c} edge ${e}`);
    }
    const crossing = edgeCorners.filter(([a, b]) => inside(a) !== inside(b)).length;
    assert.equal(SQUARE_EDGES[c].length * 2, crossing);
  }
});

test('marchingSquares: circle perimeter, vertices on the level set, orientation', () => {
  const f = (x, y) => x * x + y * y - 1;
  const r = marchingSquares(f, { bounds: B2, nx: 160, ny: 160 });
  let perim = 0;
  let maxF = 0;
  for (let s = 0; s < r.count; s++) {
    const [x0, y0, x1, y1] = [r.segments[4 * s], r.segments[4 * s + 1], r.segments[4 * s + 2], r.segments[4 * s + 3]];
    perim += Math.hypot(x1 - x0, y1 - y0);
    maxF = Math.max(maxF, Math.abs(f(x0, y0)), Math.abs(f(x1, y1)));
    // inside (lower values) is on the left of each segment: centre (0,0) is inside
    const cross = (x1 - x0) * (0 - y0) - (y1 - y0) * (0 - x0);
    assert.ok(cross > 0, 'inside on the left');
  }
  close(perim, 2 * Math.PI, 2e-3, 'perimeter');
  assert.ok(maxF < 1e-3, `vertices near f=0, got ${maxF}`);
  const mid = marchingSquares(f, { bounds: B2, nx: 160, ny: 160, interpolate: false });
  const interpErr = (res) => {
    let m = 0;
    for (let s = 0; s < res.count; s++) m = Math.max(m, Math.abs(f(res.segments[4 * s], res.segments[4 * s + 1])));
    return m;
  };
  assert.ok(interpErr(mid) > interpErr(r), 'interpolation is more accurate than midpoints');
  assert.equal(r.cases.length, 160 * 160);
});

test('marchingSquares: linear field is exact; level option; closed contour has no stray ends', () => {
  const f = (x, y) => 2 * x + 3 * y - 1;
  const r = marchingSquares(f, { bounds: B2, nx: 17, ny: 13, level: 0.5 });
  assert.ok(r.count > 0);
  for (let i = 0; i < r.segments.length; i += 2) {
    assert.ok(Math.abs(f(r.segments[i], r.segments[i + 1]) - 0.5) < 1e-5);
  }
  // closed contour: every endpoint appears exactly twice
  const c = marchingSquares((x, y) => x * x + y * y - 1.07, { bounds: B2, nx: 40, ny: 40 });
  const ends = new Map();
  for (let i = 0; i < c.segments.length; i += 2) {
    const k = `${c.segments[i].toFixed(9)},${c.segments[i + 1].toFixed(9)}`;
    ends.set(k, (ends.get(k) || 0) + 1);
  }
  assert.ok([...ends.values()].every((n) => n === 2));
});

test('marchingSquares: saddle disambiguation uses the cell-centre average', () => {
  const bounds = { xmin: 0, xmax: 1, ymin: 0, ymax: 1 };
  // lattice order: c0, c1, c3, c2  (x fastest)
  const mk = (c0, c1, c2, c3) => ({ values: Float32Array.from([c0, c1, c3, c2]), nx: 1, ny: 1, nz: 0, bounds });
  const nearCorner = (res, cx, cy) => {
    for (let s = 0; s < res.count; s++) {
      const mx = (res.segments[4 * s] + res.segments[4 * s + 2]) / 2;
      const my = (res.segments[4 * s + 1] + res.segments[4 * s + 3]) / 2;
      if (Math.hypot(mx - cx, my - cy) < 0.6) return true;
    }
    return false;
  };
  // c0, c2 inside; average = 1 > 0 -> separated: segments hug c0 and c2
  const sep = marchingSquares(mk(-1, 3, -1, 3), { level: 0 });
  assert.equal(sep.cases[0], 5);
  assert.equal(sep.count, 2);
  assert.ok(nearCorner(sep, 0, 0) && nearCorner(sep, 1, 1) && !nearCorner(sep, 1, 0));
  // average = -1 < 0 -> inside corners connected: segments hug the outside corners c1, c3
  const con = marchingSquares(mk(-3, 1, -3, 1), { level: 0 });
  assert.equal(con.cases[0], 5);
  assert.ok(nearCorner(con, 1, 0) && nearCorner(con, 0, 1) && !nearCorner(con, 0, 0));
  const off = marchingSquares(mk(-3, 1, -3, 1), { level: 0, disambiguate: false });
  assert.ok(nearCorner(off, 0, 0), 'without disambiguation the fixed separated resolution is used');
});

// ---- cube tables ---------------------------------------------------------------------------
test('cube geometry: corners and edges', () => {
  assert.equal(CUBE_CORNERS.length, 8);
  assert.equal(CUBE_EDGES.length, 12);
  for (const [a, b] of CUBE_EDGES) {
    const diff = CUBE_CORNERS[a].filter((v, i) => v !== CUBE_CORNERS[b][i]).length;
    assert.equal(diff, 1, 'edges differ in exactly one coordinate');
  }
  assert.deepEqual(CUBE_CORNERS[6], [1, 1, 1]);
  assert.deepEqual(CUBE_EDGES[8], [0, 4]);
});

test('cubeCase / cubeCaseTriangles', () => {
  assert.equal(cubeCase([0, 1, 1, 1, 1, 1, 1, 1], 0.5), 1);
  assert.equal(cubeCase([1, 1, 1, 1, 1, 1, 1, 0], 0.5), 128);
  assert.equal(cubeCase([0, 0, 0, 0, 0, 0, 0, 0], 0.5), 255);
  assert.equal(cubeCase([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0.5), 0);
  assert.deepEqual(cubeCaseTriangles(0), []);
  assert.deepEqual(cubeCaseTriangles(255), []);
  assert.equal(cubeCaseTriangles(1).length, 1);
  assert.deepEqual([...cubeCaseTriangles(1)[0]].sort((a, b) => a - b), [0, 3, 8]); // edges at corner 0
});

test('classic tables: every triangle edge crosses a sign change, edge table matches', () => {
  for (let c = 0; c < 256; c++) {
    let mask = 0;
    CUBE_EDGES.forEach(([a, b], e) => { if (((c >> a) & 1) !== ((c >> b) & 1)) mask |= 1 << e; });
    assert.equal(EDGE_TABLE[c], mask, `edgeTable ${c}`);
    const used = new Set();
    assert.equal(TRI_TABLE[c].length % 3, 0);
    for (const e of TRI_TABLE[c]) {
      assert.ok(e >= 0 && e < 12);
      const [a, b] = CUBE_EDGES[e];
      assert.notEqual((c >> a) & 1, (c >> b) & 1, `case ${c}: edge ${e} endpoints share a sign`);
      used.add(e);
    }
    for (let e = 0; e < 12; e++) assert.equal(used.has(e), Boolean((mask >> e) & 1), `case ${c}: every crossing edge is used`);
    for (const [x, y, z] of cubeCaseTriangles(c)) assert.ok(x !== y && y !== z && x !== z);
  }
});

test('classic tables: triangle counts of the 15 base cases', () => {
  const inside = (c) => [...Array(8).keys()].filter((i) => (c >> i) & 1).length;
  // 0 corners 0 tris; 1 corner 1 tri; 2 corners (adjacent / face-diagonal / body-diagonal) 2 tris;
  // 3 corners (L / diagonal+1 / scattered) 3 tris; 4 corners: a full face 2 tris, the other six
  // 4-corner classes 4 tris. Complements (>4 corners) share the count of the complement.
  let total = 0;
  for (let c = 0; c < 256; c++) {
    const n = Math.min(inside(c), 8 - inside(c));
    const t = TRI_TABLE[c].length / 3;
    total += t;
    if (n === 0) assert.equal(t, 0);
    else if (n === 1) assert.equal(t, 1);
    else if (n === 2) assert.equal(t, 2);
    else if (n === 3) assert.equal(t, 3);
    else {
      const face = [0x0f, 0xf0, 0x33, 0xcc, 0x99, 0x66].includes(c);
      assert.equal(t, face ? 2 : 4, `case ${c}`);
    }
  }
  assert.equal(total, 16 * 1 + 62 * 2 + 112 * 3 + 64 * 4);
});

/** Directed boundary of a case triangulation: directed edges not cancelled by their reverse. */
function caseBoundary(c) {
  const dir = new Map();
  for (const [a, b, d] of cubeCaseTriangles(c)) {
    for (const [x, y] of [[a, b], [b, d], [d, a]]) dir.set(`${x}>${y}`, (dir.get(`${x}>${y}`) || 0) + 1);
  }
  const out = new Set();
  for (const [k, n] of dir) {
    assert.equal(n, 1, `case ${c}: directed edge ${k} used ${n} times`);
    const [x, y] = k.split('>');
    if (!dir.has(`${y}>${x}`)) out.add(k);
  }
  return out;
}

test('classic tables: boundary of each case lies on cube faces with the inside on the left', () => {
  const faces = [0, 1, 2].flatMap((d) => [0, 1].map((s) => ({ d, s })));
  const mp = (e) => [0, 1, 2].map((d) => (CUBE_CORNERS[CUBE_EDGES[e][0]][d] + CUBE_CORNERS[CUBE_EDGES[e][1]][d]) / 2);
  for (let c = 1; c < 255; c++) {
    const bd = caseBoundary(c);
    assert.ok(bd.size > 0);
    for (const k of bd) {
      const [ea, eb] = k.split('>').map(Number);
      const A = mp(ea);
      const Bp = mp(eb);
      const f = faces.find(({ d, s }) => A[d] === s && Bp[d] === s);
      assert.ok(f, `case ${c}: boundary edge ${k} must lie on a cube face`);
      const N = [0, 0, 0];
      N[f.d] = f.s ? 1 : -1;
      const dd = [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]];
      // seen from outside the face, "left" of direction dd is N x dd
      const left = [N[1] * dd[2] - N[2] * dd[1], N[2] * dd[0] - N[0] * dd[2], N[0] * dd[1] - N[1] * dd[0]];
      const inC = CUBE_EDGES[ea].find((k2) => (c >> k2) & 1);
      const s = CUBE_CORNERS[inC].map((v, i) => v - A[i]);
      assert.ok(s[0] * left[0] + s[1] * left[1] + s[2] * left[2] > 0, `case ${c}: inside must be on the left of ${k}`);
    }
  }
});

test('classic tables: complementary cases mirror orientation (exactly, except ambiguous cases)', () => {
  const rev = (set) => new Set([...set].map((k) => k.split('>').reverse().join('>')));
  let mismatch = 0;
  for (let c = 1; c < 255; c++) {
    const a = caseBoundary(c);
    const b = rev(caseBoundary(255 ^ c));
    const same = a.size === b.size && [...a].every((k) => b.has(k));
    if (CLASSIC_AMBIGUOUS_CASES.includes(c)) { if (!same) mismatch++; } else assert.ok(same, `case ${c} vs ${255 ^ c}`);
  }
  // Honest characterisation: for ambiguous cases the complement may resolve a shared face
  // differently -- this is the classic marching cubes crack mechanism.
  assert.ok(mismatch > 0, 'some ambiguous complementary pairs disagree on a face (classic ambiguity)');
  assert.ok(CLASSIC_AMBIGUOUS_CASES.length > 0 && CLASSIC_AMBIGUOUS_CASES.length < 256);
});

// ---- meshes --------------------------------------------------------------------------------
test('marchingCubes classic: sphere accuracy, area, normals, orientation, welding', () => {
  const R = 1.01;
  const m = marchingCubes(sphere(R), { bounds: B3, nx: 32, ny: 32, nz: 32 });
  assert.ok(m.triangleCount > 1000);
  assert.equal(m.positions.length, m.vertexCount * 3);
  assert.equal(m.normals.length, m.vertexCount * 3);
  assert.equal(m.indices.length, m.triangleCount * 3);
  let maxErr = 0;
  for (let v = 0; v < m.vertexCount; v++) {
    const [x, y, z] = [m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]];
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(x, y, z) - R));
    close(Math.hypot(m.normals[3 * v], m.normals[3 * v + 1], m.normals[3 * v + 2]), 1, 1e-5, 'unit normal');
    // normals point toward lower values = inward
    const dot = (m.normals[3 * v] * x + m.normals[3 * v + 1] * y + m.normals[3 * v + 2] * z) / Math.hypot(x, y, z);
    assert.ok(dot < -0.97, `normal direction ${dot}`);
  }
  assert.ok(maxErr < 3e-3, `radius error ${maxErr}`);
  const A = area(m);
  assert.ok(Math.abs(A / (4 * Math.PI * R * R) - 1) < 0.01, `area ${A}`);
  // winding agrees with normals: geometric normal . vertex normal > 0
  const P = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const w = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [0, 1, 2].map((d) => m.normals[a + d] + m.normals[b + d] + m.normals[c + d]);
    assert.ok(n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2] > 0, 'CCW normal toward lower values');
  }
  assert.ok(maxEdgeUse(m) <= 2);
  assert.equal(maxDirectedUse(m), 1);
  assert.equal(interiorOpenEdges(m, B3), 0);
  assert.equal(euler(m), 2);
  const h = marchingCubes(sphere(R), { bounds: B3, nx: 12, ny: 12, nz: 12, orientation: 'higher' });
  assert.ok(h.normals[0] * h.positions[0] + h.normals[1] * h.positions[1] + h.normals[2] * h.positions[2] > 0);
});

test('marchingCubes tetra: sphere and torus are watertight with the right Euler characteristic', () => {
  const s = marchingCubes(sphere(1.013), { bounds: B3, nx: 28, ny: 28, nz: 28, algorithm: 'tetra' });
  assert.equal(interiorOpenEdges(s, B3), 0);
  assert.equal(maxEdgeUse(s), 2);
  assert.equal(maxDirectedUse(s), 1);
  assert.equal(euler(s), 2);
  assert.ok(Math.abs(area(s) / (4 * Math.PI * 1.013 ** 2) - 1) < 0.02);
  const t = marchingCubes(torus(1, 0.37), { bounds: B3, nx: 40, ny: 40, nz: 40, algorithm: 'tetra' });
  assert.equal(interiorOpenEdges(t, B3), 0);
  assert.equal(maxDirectedUse(t), 1);
  assert.equal(euler(t), 0);
  const exact = 4 * Math.PI * Math.PI * 1 * 0.37;
  assert.ok(Math.abs(area(t) / exact - 1) < 0.03, `torus area ${area(t)} vs ${exact}`);
  const c = marchingCubes(torus(1, 0.37), { bounds: B3, nx: 40, ny: 40, nz: 40 });
  assert.ok(Math.abs(area(c) / exact - 1) < 0.03);
  for (let v = 0; v < s.vertexCount; v += 7) {
    const dot = s.normals[3 * v] * s.positions[3 * v] + s.normals[3 * v + 1] * s.positions[3 * v + 1] + s.normals[3 * v + 2] * s.positions[3 * v + 2];
    assert.ok(dot < 0);
  }
});

test('marchingCubes tetra: random fields are watertight (each interior edge shared by exactly two triangles)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = randomField(seed);
    const m = marchingCubes(g, { algorithm: 'tetra', level: 0 });
    assert.ok(m.triangleCount > 20);
    assert.equal(interiorOpenEdges(m, g.bounds), 0, `seed ${seed}`);
    assert.ok(maxEdgeUse(m) <= 2, 'manifold');
    assert.equal(maxDirectedUse(m), 1, 'consistent orientation');
  }
});

test('marchingCubes classic: random fields -- orientation consistent, but ambiguity can leave cracks', () => {
  let cracked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = randomField(seed);
    const m = marchingCubes(g, { algorithm: 'classic', level: 0 });
    assert.equal(maxDirectedUse(m), 1);
    assert.ok(maxEdgeUse(m) <= 2);
    const open = interiorOpenEdges(m, g.bounds);
    if (open > 0) cracked++;
    // never cracks without an ambiguous cell somewhere
    if (!m.cases.some((c) => CLASSIC_AMBIGUOUS_CASES.includes(c))) assert.equal(open, 0);
  }
  // Random noise is full of ambiguous faces; the classic table is known to produce holes there.
  assert.ok(cracked > 0, `expected cracks on noisy fields (${cracked}/12)`);
});

test('marchingCubes: interpolation puts vertices on the level set; linear field exact', () => {
  const f = (x, y, z) => 2 * x - y + 0.5 * z - 0.3;
  for (const algorithm of ['classic', 'tetra']) {
    const m = marchingCubes(f, { bounds: B3, nx: 9, ny: 8, nz: 7, algorithm });
    assert.ok(m.vertexCount > 0);
    for (let v = 0; v < m.vertexCount; v++) {
      assert.ok(Math.abs(f(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2])) < 2e-5, algorithm);
    }
    // gradient normal of a linear field is constant: -grad/|grad|
    const gl = Math.hypot(2, -1, 0.5);
    close(m.normals[0], -2 / gl, 1e-5);
    close(m.normals[1], 1 / gl, 1e-5);
    close(m.normals[2], -0.5 / gl, 1e-5);
  }
  const mid = marchingCubes(f, { bounds: B3, nx: 9, ny: 8, nz: 7, interpolate: false });
  let worst = 0;
  for (let v = 0; v < mid.vertexCount; v++) worst = Math.max(worst, Math.abs(f(mid.positions[3 * v], mid.positions[3 * v + 1], mid.positions[3 * v + 2])));
  assert.ok(worst > 1e-3, 'midpoint placement is not on the level set');
});

test('marchingCubes: level option, errors, empty result', () => {
  const m = marchingCubes(sphere(0), { bounds: B3, nx: 20, ny: 20, nz: 20, level: 0.9 });
  let e = 0;
  for (let v = 0; v < m.vertexCount; v++) e = Math.max(e, Math.abs(Math.hypot(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]) - 0.9));
  assert.ok(e < 5e-3);
  const none = marchingCubes(() => 1, { bounds: B3, nx: 4, ny: 4, nz: 4 });
  assert.equal(none.triangleCount, 0);
  assert.equal(none.indices.length, 0);
  assert.throws(() => marchingCubes(() => 0, { nx: 2, ny: 2, nz: 2 }));
  assert.throws(() => marchingCubes(sphere(1), { bounds: B3, nx: 2, ny: 2, nz: 2, algorithm: 'bogus' }));
});

test('marchingCubes: classic and tetra agree on the area within a few percent', () => {
  const o = { bounds: B3, nx: 36, ny: 36, nz: 36 };
  const a = area(marchingCubes(sphere(1.1), o));
  const b = area(marchingCubes(sphere(1.1), { ...o, algorithm: 'tetra' }));
  assert.ok(Math.abs(a / b - 1) < 0.02);
});

test('performance: 64^3 classic grid mesh in well under a second', () => {
  const g = gridSample(torus(1, 0.4), B3, 64, 64, 64);
  const t0 = performance.now();
  const m = marchingCubes(g, { level: 0 });
  const ms = performance.now() - t0;
  assert.ok(m.triangleCount > 5000);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  console.log(`# marchingCubes 64^3 classic: ${ms.toFixed(0)} ms, ${m.triangleCount} triangles`);
});
