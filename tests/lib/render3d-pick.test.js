import test from 'node:test';
import assert from 'node:assert/strict';
import { OrbitCamera, prepareMesh } from '../../lib/render3d.js';
import { rayTriangle, rayBox, pickMesh } from '../../lib/render3d-pick.js';
import { uvSphere, cube, triangleMesh } from './mesh-helpers.js';
import { close } from './helpers.js';

const VP = { x: 0, y: 0, w: 800, h: 600 };

test('rayTriangle: hit, miss, edge, parallel, behind, cullBack', () => {
  const a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0]; // normal +z
  const uv = [0, 0];
  close(rayTriangle([0.25, 0.25, 2], [0, 0, -1], a, b, c, { uv }), 2);
  close(uv[0], 0.25); close(uv[1], 0.25);
  assert.equal(rayTriangle([0.9, 0.9, 2], [0, 0, -1], a, b, c), null);
  assert.equal(rayTriangle([0.25, 0.25, 2], [1, 0, 0], a, b, c), null, 'parallel');
  assert.equal(rayTriangle([0.25, 0.25, -2], [0, 0, -1], a, b, c), null, 'behind origin');
  assert.ok(rayTriangle([0.25, 0.25, 2], [0, 0, -1], a, b, c, { cullBack: true }) !== null);
  assert.equal(rayTriangle([0.25, 0.25, -2], [0, 0, 1], a, b, c, { cullBack: true }), null, 'seen from behind');
  assert.ok(rayTriangle([0.25, 0.25, -2], [0, 0, 1], a, b, c) !== null);
  assert.equal(rayTriangle([0.2, 0.2, 1], [0, 0, -1], a, a, a), null, 'degenerate');
});

test('rayBox: hit, miss, inside, axis-parallel', () => {
  const min = [-1, -1, -1], max = [1, 1, 1];
  const h = rayBox([-5, 0, 0], [1, 0, 0], min, max);
  close(h.tmin, 4); close(h.tmax, 6);
  assert.equal(rayBox([-5, 2, 0], [1, 0, 0], min, max), null, 'parallel and outside');
  assert.equal(rayBox([5, 0, 0], [1, 0, 0], min, max), null, 'box behind');
  const inside = rayBox([0, 0, 0], [0, 1, 0], min, max);
  assert.ok(inside.tmin < 0 && inside.tmax > 0);
  assert.equal(rayBox([-5, 0, 0], [1, 1, 0.01], min, max), null);
  assert.ok(rayBox([-5, 0, 0], [1, 0.1, 0.05], min, max) !== null);
});

test('pick a unit cube from several rays', () => {
  const pm = prepareMesh(cube(-0.5, 0.5));
  const cases = [
    { origin: [3, 0.1, 0.2], dir: [-1, 0, 0], point: [0.5, 0.1, 0.2], normal: [1, 0, 0] },
    { origin: [-3, 0.1, 0.2], dir: [1, 0, 0], point: [-0.5, 0.1, 0.2], normal: [-1, 0, 0] },
    { origin: [0.2, 3, 0.1], dir: [0, -1, 0], point: [0.2, 0.5, 0.1], normal: [0, 1, 0] },
    { origin: [0.2, 0.3, -4], dir: [0, 0, 1], point: [0.2, 0.3, -0.5], normal: [0, 0, -1] },
    { origin: [0.2, 0.3, 4], dir: [0, 0, -2], point: [0.2, 0.3, 0.5], normal: [0, 0, 1] }, // non-unit dir
  ];
  for (const c of cases) {
    const hit = pickMesh(pm, c);
    assert.ok(hit, JSON.stringify(c));
    c.point.forEach((v, i) => close(hit.point[i], v, 1e-6));
    c.normal.forEach((v, i) => close(hit.normal[i], v, 1e-6));
    assert.ok(hit.triangle >= 0 && hit.triangle < 12);
  }
  assert.equal(pickMesh(pm, { origin: [3, 2, 0], dir: [-1, 0, 0] }), null);
  assert.equal(pickMesh(pm, { origin: [3, 0, 0], dir: [1, 0, 0] }), null, 'pointing away');
  // from inside, culling hides the inner faces but not the default
  assert.ok(pickMesh(pm, { origin: [0, 0, 0], dir: [1, 0.1, 0.2] }));
  assert.equal(pickMesh(pm, { origin: [0, 0, 0], dir: [1, 0.1, 0.2] }, { cullBack: false }) !== null, true);
  assert.equal(pickMesh(pm, { origin: [0, 0, 0], dir: [1, 0.1, 0.2] }, { cullBack: true }), null);
});

test('pick a sphere through camera rays; nearest hit wins', () => {
  const R = 1.5;
  const pm = prepareMesh(uvSphere(R, 48, 24));
  for (const orthographic of [false, true]) {
    const cam = new OrbitCamera({ yaw: 0.7, pitch: 0.4, distance: 8, orthographic });
    // centre pixel: hits the sphere on the camera side
    const hit = pickMesh(pm, cam.ray(400, 300, VP));
    assert.ok(hit);
    const r = Math.hypot(...hit.point);
    assert.ok(Math.abs(r - R) < 0.05, `radius ${r}`);
    const eye = cam.eye();
    const toHit = Math.hypot(hit.point[0] - eye[0], hit.point[1] - eye[1], hit.point[2] - eye[2]);
    assert.ok(toHit < Math.hypot(...eye), 'front surface, not the far side');
    // several pixels inside / outside the silhouette
    const inside = [[380, 280], [450, 320], [350, 330], [420, 260]];
    for (const [x, y] of inside) assert.ok(pickMesh(pm, cam.ray(x, y, VP)), `${x},${y}`);
    for (const [x, y] of [[5, 5], [790, 590], [100, 300]]) assert.equal(pickMesh(pm, cam.ray(x, y, VP)), null, `${x},${y}`);
  }
});

test('maxT limits the pick; degenerate triangles are ignored', () => {
  const pm = prepareMesh(cube());
  assert.equal(pickMesh(pm, { origin: [10, 0, 0], dir: [-1, 0, 0] }, { maxT: 5 }), null);
  assert.ok(pickMesh(pm, { origin: [10, 0, 0], dir: [-1, 0, 0] }, { maxT: 20 }));
  const dg = prepareMesh(triangleMesh([0, 0, 0], [1, 0, 0], [2, 0, 0]));
  assert.equal(pickMesh(dg, { origin: [1, 0, 1], dir: [0, 0, -1] }), null);
});
