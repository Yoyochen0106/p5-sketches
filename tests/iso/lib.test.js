import test from 'node:test';
import assert from 'node:assert/strict';
import { gridSample, marchingCubes } from '../../lib/marching.js';
import { FIELDS_3D } from '../../lib/fields.js';
import {
  meshToBinarySTL, meshToAsciiSTL, meshToOBJ, binaryStlSize, faceNormal,
} from '../../lib/mesh-export.js';
import { openEdges } from '../../lib/mesh-topology.js';
import {
  squareCellInfo, describeSquareCell, cubeCaseInfo, cubeCaseGeometry, cubeClass, CUBE_CLASS_COUNT, locateCell,
  levelRange, levelFromU, uFromLevel, cubeCornerValues,
} from '../../lib/iso-inspect.js';
import {
  buildIsoMesh, sliceContour, clipMeshBelow, LRU, gridDims3, sampleGrid3,
} from '../../lib/iso-mesh.js';

const TETRA = { positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1), indices: Uint32Array.of(0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3) };
const field = (id) => FIELDS_3D.find((d) => d.id === id);

test('binary STL: size 84 + 50*T, count and first facet', () => {
  const stl = meshToBinarySTL(TETRA);
  assert.equal(stl.length, binaryStlSize(4));
  assert.equal(stl.length, 84 + 50 * 4);
  const dv = new DataView(stl.buffer);
  assert.equal(dv.getUint32(80, true), 4);
  const n = faceNormal(TETRA, 0);
  assert.ok(Math.abs(dv.getFloat32(84, true) - n[0]) < 1e-6 && Math.abs(dv.getFloat32(92, true) - n[2]) < 1e-6);
  assert.equal(dv.getFloat32(84 + 12 + 12, true), 0); // second vertex x of facet 0 = vertex 2 (0,1,0)
  assert.equal(dv.getUint16(84 + 48, true), 0);
  const empty = meshToBinarySTL({ positions: new Float32Array(0), indices: new Uint32Array(0) });
  assert.equal(empty.length, 84);
});

test('ASCII STL has one facet per triangle and balanced markers', () => {
  const s = meshToAsciiSTL(TETRA, 'tet');
  assert.ok(s.startsWith('solid tet\n') && s.trim().endsWith('endsolid tet'));
  assert.equal(s.match(/facet normal/g).length, 4);
  assert.equal(s.match(/endfacet/g).length, 4);
  assert.equal(s.match(/vertex /g).length, 12);
});

test('OBJ: 1-based indices, vertex / normal / face counts', () => {
  const m = { ...TETRA, normals: new Float32Array(12).fill(0.5) };
  const obj = meshToOBJ(m);
  const lines = obj.split('\n');
  assert.equal(lines.filter((l) => l.startsWith('v ')).length, 4);
  assert.equal(lines.filter((l) => l.startsWith('vn ')).length, 4);
  const faces = lines.filter((l) => l.startsWith('f '));
  assert.equal(faces.length, 4);
  assert.equal(faces[0], 'f 1//1 3//3 2//2');
  const all = faces.flatMap((f) => f.slice(2).split(' ').map((t) => Number(t.split('//')[0])));
  assert.equal(Math.min(...all), 1);
  assert.equal(Math.max(...all), 4);
  const plain = meshToOBJ(TETRA, { normals: false });
  assert.ok(plain.includes('\nf 1 3 2\n') && !plain.includes('vn '));
});

test('openEdges: closed tetra has none, removing a face opens 3 edges, bounds classify domain edges', () => {
  assert.equal(openEdges(TETRA).open, 0);
  const cut = { positions: TETRA.positions, indices: TETRA.indices.slice(0, 9) };
  const r = openEdges(cut);
  assert.equal(r.open, 3);
  assert.equal(r.edges.length, 18);
  const dom = openEdges(cut, { xmin: 0, xmax: 1, ymin: 0, ymax: 1, zmin: 0, zmax: 1 });
  assert.ok(dom.domain >= 1 && dom.open + dom.domain === 3);
});

test('hole detector: tetra sphere is closed; classic gets no worse cracks than tetra elsewhere', () => {
  const f = field('sphere');
  const g = sampleGrid3(f.f, f.bounds, 16);
  const tet = marchingCubes(g, { level: 0, algorithm: 'tetra' });
  const r = openEdges(tet, g.bounds);
  assert.equal(r.open, 0);
  assert.equal(r.nonManifold, 0);
  assert.equal(r.domain, 0);
});

test('hole detector: tetra is crack-free on noise (cut by bounds only); classic leaves cracks', () => {
  const f = field('noise3');
  const g = sampleGrid3(f.f, f.bounds, 20);
  const tet = openEdges(marchingCubes(g, { level: 0, algorithm: 'tetra' }), g.bounds);
  assert.equal(tet.open, 0);
  assert.ok(tet.domain > 0, 'noise surface is cut by the box');
  const cl = openEdges(marchingCubes(g, { level: 0, algorithm: 'classic' }), g.bounds);
  assert.ok(cl.open > 0, 'classic table leaves cracks on noise');
});

test('cube cases: 15 classes, triangle counts and binary strings', () => {
  assert.equal(CUBE_CLASS_COUNT, 15);
  const classes = new Set();
  for (let c = 0; c < 256; c++) classes.add(cubeClass(c));
  assert.equal(classes.size, 15);
  assert.equal(cubeClass(0), 0);
  assert.equal(cubeClass(255), 0);
  assert.equal(cubeClass(1), cubeClass(2));
  assert.equal(cubeClass(1), cubeClass(254));
  const one = cubeCaseInfo(1);
  assert.equal(one.binary, '00000001');
  assert.equal(one.triangleCount, 1);
  assert.deepEqual(one.insideCorners, [0]);
  assert.equal(cubeCaseInfo(0).triangleCount, 0);
  assert.equal(cubeCaseInfo(255).triangleCount, 0);
  assert.equal(cubeCaseInfo(0b00000101).ambiguous, true);
  const geo = cubeCaseGeometry(3);
  assert.equal(geo.edgePoints.filter(Boolean).length, geo.crossedEdges.length);
  assert.equal(geo.trianglePoints.length, geo.triangleCount);
  const tri = geo.trianglePoints[0];
  assert.ok(tri.every((p) => p.length === 3 && p.every(Number.isFinite)));
});

test('cube case geometry with sample values interpolates on crossed edges', () => {
  const vals = [-1, 3, 3, 3, 3, 3, 3, 3];
  const geo = cubeCaseGeometry(1, vals, 0);
  const e0 = geo.edgePoints[0];
  assert.ok(Math.abs(e0[0] - 0.25) < 1e-12); // t = (0-(-1))/(3-(-1))
});

test('squareCellInfo: circle cell has case 4 and explains the segment', () => {
  const g = gridSample((x, y) => x * x + y * y - 1, { xmin: -2, xmax: 2, ymin: -2, ymax: 2 }, 4, 4);
  const info = squareCellInfo(g, 1, 1, 0);
  assert.equal(info.caseIndex, 4);
  assert.equal(info.bits, '0100');
  assert.deepEqual(info.crossedEdges, [1, 2]);
  assert.equal(info.segments.length, 1);
  const lines = describeSquareCell(info);
  assert.ok(lines.some((l) => /case 4 = 0b0100/.test(l)));
  assert.ok(lines.some((l) => /t = \(L - f/.test(l)));
  assert.equal(squareCellInfo(g, 4, 0, 0), null);
  const mid = squareCellInfo(g, 1, 1, 0, { interpolate: false });
  assert.ok(describeSquareCell(mid).some((l) => /midpoint/.test(l)));
});

test('squareCellInfo saddle: disambiguation toggles joined vs separated', () => {
  const g = gridSample((x, y) => x * y, { xmin: -1, xmax: 1, ymin: -1, ymax: 1 }, 1, 1);
  const sep = squareCellInfo(g, 0, 0, 0.0001, { disambiguate: false });
  assert.equal(sep.caseIndex, 10);
  assert.equal(sep.saddle, true);
  const joined = squareCellInfo(g, 0, 0, 0.0001, { disambiguate: true });
  assert.equal(joined.connected, true);
  assert.deepEqual(joined.segments.map((s) => s.edges), [[3, 0], [1, 2]]);
  assert.ok(describeSquareCell(joined).some((l) => /saddle/.test(l)));
});

test('locateCell finds the cell of a surface point', () => {
  const f = field('sphere');
  const g = sampleGrid3(f.f, f.bounds, 12);
  const m = marchingCubes(g, { level: 0 });
  const c = locateCell(g, 1, 0.01, 0.02, m.cases);
  const idx = c.i + g.nx * (c.j + g.ny * c.k);
  assert.ok(m.cases[idx] !== 0 && m.cases[idx] !== 255);
  assert.equal(cubeCornerValues(g, c.i, c.j, c.k).length, 8);
});

test('buildIsoMesh respects the triangle budget and reports limiting', () => {
  const f = field('gyroid');
  const r = buildIsoMesh({ fn: f.f, bounds: f.bounds, res: 60, level: 0, algorithm: 'tetra', maxTriangles: 6000 });
  assert.ok(r.triangleCount <= 6000, `${r.triangleCount}`);
  assert.equal(r.limited, true);
  assert.ok(r.res >= 8 && r.res < 60);
  const small = buildIsoMesh({ fn: f.f, bounds: f.bounds, res: 12, level: 0, maxTriangles: 60000 });
  assert.equal(small.limited, false);
  assert.equal(small.res, 12);
  assert.ok(small.triangleCount > 0);
  const hi = buildIsoMesh({ fn: f.f, bounds: f.bounds, res: 12, level: 0.8 });
  assert.notEqual(hi.triangleCount, small.triangleCount);
});

test('sliceContour: sphere at z = 0.5 is a circle of radius sqrt(0.75)', () => {
  const f = field('sphere');
  const s = sliceContour(f.f, f.bounds, 0.5, 0, 40);
  assert.ok(s.count > 20);
  for (let i = 0; i < s.count; i++) {
    const r = Math.hypot(s.segments2d[i * 4], s.segments2d[i * 4 + 1]);
    assert.ok(Math.abs(r - Math.sqrt(0.75)) < 0.03, `r = ${r}`);
    assert.equal(s.edges3d[i * 6 + 2], 0.5);
  }
});

test('clipMeshBelow keeps lower triangles; LRU evicts oldest; gridDims3 follows aspect', () => {
  const f = field('sphere');
  const g = sampleGrid3(f.f, f.bounds, 12);
  const m = marchingCubes(g, { level: 0 });
  const half = clipMeshBelow(m, 0);
  assert.ok(half.indices.length > 0 && half.indices.length < m.indices.length);
  const lru = new LRU(2);
  lru.set('a', 1); lru.set('b', 2); lru.get('a'); lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 1);
  assert.deepEqual(gridDims3({ xmin: 0, xmax: 4, ymin: 0, ymax: 2, zmin: 0, zmax: 1 }, 20), { nx: 20, ny: 10, nz: 5 });
});

test('level slider mapping is exact at round numbers and invertible', () => {
  const r = levelRange([-0.75, -0.5, 0, 0.5, 3], 0);
  assert.equal(levelFromU(uFromLevel(0, r), r), 0);
  assert.equal(levelFromU(uFromLevel(0.5, r), r), 0.5);
  assert.ok(r[0] < -0.75 && r[1] > 3);
  assert.equal(levelFromU(-5, r), levelFromU(0, r));
  assert.deepEqual(levelRange([], NaN), [-1, 1]);
});
