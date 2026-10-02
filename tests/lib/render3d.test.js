import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrbitCamera, prepareMesh, shadeMesh, createDrawList, boundsBox, gridFloor, axesGizmo, projectSegments,
  add, sub, scale, dot, cross, normalize,
} from '../../lib/render3d.js';
import { uvSphere, torus, cube, triangleMesh } from './mesh-helpers.js';
import { close } from './helpers.js';

const VP = { x: 0, y: 0, w: 800, h: 600 };

function distToRay(p, ray) {
  const w = sub(p, ray.origin);
  const t = dot(w, ray.dir);
  return Math.hypot(...sub(w, scale(ray.dir, t)));
}

test('vec3 helpers', () => {
  assert.deepEqual(add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.equal(dot([1, 2, 3], [4, 5, 6]), 32);
  close(Math.hypot(...normalize([3, 4, 12])), 1);
  assert.deepEqual(normalize([0, 0, 0]), [0, 0, 0]);
});

test('project: target at screen centre, left/right symmetric, up is up', () => {
  for (const orthographic of [false, true]) {
    const cam = new OrbitCamera({ yaw: 0, pitch: 0, distance: 5, orthographic });
    const c = cam.project([0, 0, 0], VP);
    close(c.x, 400); close(c.y, 300);
    close(c.depth, 5);
    // yaw 0: right vector is +y
    const r = cam.project([0, 1, 0], VP), l = cam.project([0, -1, 0], VP);
    close(r.x - 400, 400 - l.x, 1e-9);
    close(r.y, l.y);
    assert.ok(r.x > 400);
    const u = cam.project([0, 0, 1], VP);
    assert.ok(u.y < 300, 'world +z is up on screen');
    close(u.x, 400);
  }
  const persp = new OrbitCamera({ yaw: 0, pitch: 0, distance: 5 });
  // nearer points are larger: same lateral offset, closer in x
  assert.ok(Math.abs(persp.project([2, 1, 0], VP).x - 400) > Math.abs(persp.project([-2, 1, 0], VP).x - 400));
  // ortho: independent of depth
  const o = new OrbitCamera({ yaw: 0, pitch: 0, distance: 5, orthographic: true });
  close(o.project([2, 1, 0], VP).x, o.project([-2, 1, 0], VP).x);
});

test('project: viewport offset and behind-camera points', () => {
  const cam = new OrbitCamera({ yaw: 0, pitch: 0, distance: 5 });
  const c = cam.project([0, 0, 0], { x: 100, y: 50, w: 200, h: 100 });
  close(c.x, 200); close(c.y, 100);
  const behind = cam.project([20, 0, 0], VP);
  assert.equal(behind.visible, false);
  assert.ok(Number.isNaN(behind.x));
  assert.equal(cam.project([0, 0, 0], VP).visible, true);
});

test('viewMatrix maps target to -distance on z', () => {
  const cam = new OrbitCamera({ yaw: 1.1, pitch: 0.4, distance: 7, target: [1, 2, 3] });
  const m = cam.viewMatrix();
  const p = [1, 2, 3];
  const z = m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11];
  const x = m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3];
  close(z, -7, 1e-12); close(x, 0, 1e-12);
});

test('rotate round-trips, clamps pitch; zoom limits; reset', () => {
  const cam = new OrbitCamera({ yaw: 0.3, pitch: 0.2, distance: 4 });
  cam.rotate(0.7, 0.4);
  cam.rotate(-0.7, -0.4);
  close(cam.yaw, 0.3, 1e-12); close(cam.pitch, 0.2, 1e-12);
  cam.rotate(0, 100);
  assert.ok(cam.pitch < Math.PI / 2 && cam.pitch > 1.5);
  cam.rotate(0, -1000);
  assert.ok(cam.pitch > -Math.PI / 2);
  cam.rotate(NaN, NaN);
  assert.ok(Number.isFinite(cam.yaw) && Number.isFinite(cam.pitch));
  const p = cam.project([0.1, 0.2, 0.3], VP);
  assert.ok(Number.isFinite(p.x));
  cam.zoom(1e-12); assert.equal(cam.distance, cam.minDistance);
  cam.zoom(1e30); assert.equal(cam.distance, cam.maxDistance);
  cam.zoom(NaN); cam.zoom(-1); assert.equal(cam.distance, cam.maxDistance);
  cam.reset();
  close(cam.yaw, 0.3); close(cam.distance, 4);
});

test('pan: scene follows the drag in pixels', () => {
  for (const orthographic of [false, true]) {
    const cam = new OrbitCamera({ yaw: 0.6, pitch: 0.3, distance: 6, orthographic });
    const before = cam.project([0, 0, 0], VP);
    cam.pan(40, -25, VP);
    const after = cam.project([0, 0, 0], VP);
    close(after.x - before.x, 40, 1e-6);
    close(after.y - before.y, -25, 1e-6);
  }
});

test('ray passes through the projected point (perspective and orthographic)', () => {
  for (const orthographic of [false, true]) {
    const cam = new OrbitCamera({ yaw: 0.9, pitch: 0.5, distance: 8, orthographic, target: [0.5, -0.2, 0.1] });
    for (const pt of [[0, 0, 0], [1, 2, 0.5], [-1, 0.3, -2]]) {
      const s = cam.project(pt, VP);
      const ray = cam.ray(s.x, s.y, VP);
      assert.ok(distToRay(pt, ray) < 1e-6, `orthographic=${orthographic}`);
      close(Math.hypot(...ray.dir), 1);
    }
  }
});

test('fitToBounds keeps the bounds inside the viewport', () => {
  const cam = new OrbitCamera();
  const bounds = { min: [-3, -1, 0], max: [5, 2, 4] };
  cam.fitToBounds(bounds);
  assert.deepEqual(cam.target, [1, 0.5, 2]);
  for (let i = 0; i < 8; i++) {
    const c = [i & 1 ? 5 : -3, i & 2 ? 2 : -1, i & 4 ? 4 : 0];
    const s = cam.project(c, VP);
    assert.ok(s.visible && s.x > 0 && s.x < 800 && s.y > 0 && s.y < 600, JSON.stringify(s));
  }
  cam.rotate(1, 0.2); cam.zoom(0.5);
  cam.reset();
  close(cam.distance, cam.home.distance);
});

test('prepareMesh: outward cube normals, bounds, degenerate flags', () => {
  const pm = prepareMesh(cube());
  assert.equal(pm.triangleCount, 12);
  assert.deepEqual(pm.bounds, { min: [-1, -1, -1], max: [1, 1, 1] });
  for (let t = 0; t < 12; t++) {
    const n = [pm.faceNormals[t * 3], pm.faceNormals[t * 3 + 1], pm.faceNormals[t * 3 + 2]];
    const c = [pm.centroids[t * 3], pm.centroids[t * 3 + 1], pm.centroids[t * 3 + 2]];
    assert.ok(dot(n, c) > 0.9, `triangle ${t} points outward`);
    assert.equal(pm.degenerate[t], 0);
  }
  const bad = prepareMesh({
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, NaN, 0, 0),
    indices: Uint32Array.of(0, 1, 2, 0, 1, 3, 0, 1, 4, 0, 1, 99),
  });
  assert.deepEqual([...bad.degenerate], [1, 0, 1, 1]);
});

test('prepareMesh orients face normals with supplied vertex normals', () => {
  const m = uvSphere(1, 12, 6);
  const flipped = Uint32Array.from(m.indices);
  for (let i = 0; i < flipped.length; i += 3) { const t = flipped[i + 1]; flipped[i + 1] = flipped[i + 2]; flipped[i + 2] = t; }
  const pm = prepareMesh({ positions: m.positions, normals: m.normals, indices: flipped });
  for (let t = 0; t < pm.triangleCount; t++) {
    if (pm.degenerate[t]) continue;
    const n = [pm.faceNormals[t * 3], pm.faceNormals[t * 3 + 1], pm.faceNormals[t * 3 + 2]];
    const c = [pm.centroids[t * 3], pm.centroids[t * 3 + 1], pm.centroids[t * 3 + 2]];
    assert.ok(dot(n, c) > 0);
  }
});

function meshFrom(tris) {
  const pos = [], idx = [];
  tris.forEach((t, i) => { t.forEach((p, j) => { pos.push(...p); idx.push(i * 3 + j); }); });
  return prepareMesh({ positions: Float32Array.from(pos), indices: Uint32Array.from(idx) });
}

test('depth order: nearer triangle is drawn last', () => {
  const cam = new OrbitCamera({ yaw: 0, pitch: 0, distance: 6 });
  // camera looks along -x from +x. tri 0 is NEAR (x = 1), tri 1 is FAR (x = -1)
  const near = [[1, -1, -1], [1, 1, -1], [1, 0, 1]];
  const far = [[-1, -1, -1], [-1, 1, -1], [-1, 0, 1]];
  const pm = meshFrom([near, far]);
  const list = shadeMesh(pm, cam, VP, { twoSided: true });
  assert.equal(list.count, 2);
  assert.equal(list.tri[list.order[0]], 1, 'far first');
  assert.equal(list.tri[list.order[1]], 0, 'near last');
  const cam2 = new OrbitCamera({ yaw: Math.PI, pitch: 0, distance: 6 });
  const l2 = shadeMesh(pm, cam2, VP, {});
  assert.equal(l2.tri[l2.order[1]], 1);
});

test('depth order on a sphere: sorted by non-increasing depth', () => {
  const pm = prepareMesh(uvSphere(1, 24, 12));
  const cam = new OrbitCamera({ yaw: 0.4, pitch: 0.3, distance: 4 });
  const l = shadeMesh(pm, cam, VP, {});
  for (let k = 1; k < l.count; k++) {
    assert.ok(l.depth[l.order[k - 1]] >= l.depth[l.order[k]] - 1e-3, `k=${k}`);
  }
});

test('back-face culling', () => {
  const pm = prepareMesh(uvSphere(1, 24, 12));
  const cam = new OrbitCamera({ yaw: 0.4, pitch: 0.3, distance: 4 });
  const n0 = shadeMesh(pm, cam, VP, { cull: false }).count;
  const culled = shadeMesh(pm, cam, VP, { cull: true });
  assert.ok(culled.count < n0 * 0.65 && culled.count > n0 * 0.3, `${culled.count} of ${n0}`);
  assert.ok(culled.culled > 0);
  const pm1 = prepareMesh(triangleMesh([0, -1, -1], [0, 1, -1], [0, 0, 1])); // normal +x
  assert.equal(shadeMesh(pm1, new OrbitCamera({ yaw: 0, pitch: 0 }), VP, { cull: true }).count, 1);
  assert.equal(shadeMesh(pm1, new OrbitCamera({ yaw: Math.PI, pitch: 0 }), VP, { cull: true }).count, 0);
  assert.equal(shadeMesh(pm1, new OrbitCamera({ yaw: Math.PI, pitch: 0 }), VP, { cull: false }).count, 1);
});

test('two-sided lighting: back faces are lit like front faces', () => {
  const pm1 = prepareMesh(triangleMesh([0, -1, -1], [0, 1, -1], [0, 0, 1]));
  const o = { colorBy: 'solid', specular: 0 };
  const front = shadeMesh(pm1, new OrbitCamera({ yaw: 0, pitch: 0 }), VP, { ...o, twoSided: true });
  const back = shadeMesh(pm1, new OrbitCamera({ yaw: Math.PI, pitch: 0 }), VP, { ...o, twoSided: true });
  assert.deepEqual([...back.rgb.slice(0, 3)], [...front.rgb.slice(0, 3)]);
  const dark = shadeMesh(pm1, new OrbitCamera({ yaw: Math.PI, pitch: 0 }), VP, { ...o, twoSided: false });
  assert.ok(dark.rgb[0] < front.rgb[0], 'one-sided back face only gets ambient light');
});

test('lighting and colour sources', () => {
  const pm1 = prepareMesh(triangleMesh([0, -1, -1], [0, 1, -1], [0, 0, 1]));
  const cam = new OrbitCamera({ yaw: 0, pitch: 0 });
  const bright = shadeMesh(pm1, cam, VP, { colorBy: 'solid', lightDir: [0, 0, 1], specular: 0 }).rgb[0];
  const dim = shadeMesh(pm1, cam, VP, { colorBy: 'solid', lightDir: [0, 0, -1], specular: 0 }).rgb[0];
  assert.ok(bright > dim);
  const spec = shadeMesh(pm1, cam, VP, { colorBy: 'solid', lightDir: [0, 0, 1], specular: 0.5 }).rgb[0];
  assert.ok(spec >= bright);
  const fn = shadeMesh(pm1, cam, VP, { colorFn: (t, p, out) => { out[0] = 255; out[1] = 0; out[2] = 0; }, ambient: 1, diffuse: 0, specular: 0 });
  assert.deepEqual([...fn.rgb.slice(0, 3)], [255, 0, 0]);
  const ret = shadeMesh(pm1, cam, VP, { colorFn: () => [0, 255, 0], ambient: 1, diffuse: 0, specular: 0 });
  assert.deepEqual([...ret.rgb.slice(0, 3)], [0, 255, 0]);
  const pm = prepareMesh(uvSphere(1, 16, 8));
  const l = shadeMesh(pm, new OrbitCamera({ yaw: 0, pitch: 0 }), VP, { ambient: 1, diffuse: 0, specular: 0 });
  const colours = new Set();
  for (let i = 0; i < l.count; i++) colours.add(`${l.rgb[i * 3]},${l.rgb[i * 3 + 1]},${l.rgb[i * 3 + 2]}`);
  assert.ok(colours.size > 4, 'height colormap gives several colours');
});

test('near-plane clipping: no NaN, partial triangles survive, fully-behind dropped', () => {
  const cam = new OrbitCamera({ yaw: 0, pitch: 0, distance: 2, near: 0.1 }); // eye at x = 2
  const crossing = prepareMesh(triangleMesh([5, 0, 0], [0, -1, -1], [0, 1, -1]));
  const l = shadeMesh(crossing, cam, VP, { twoSided: true });
  assert.ok(l.count >= 1 && l.clipped === 1);
  for (let i = 0; i < l.count * 6; i++) assert.ok(Number.isFinite(l.xy[i]), `xy[${i}]`);
  for (let i = 0; i < l.count; i++) assert.ok(Number.isFinite(l.depth[i]) && l.depth[i] > 0);
  const two = prepareMesh(triangleMesh([5, 0, 0], [5, 1, 0], [0, 0, 1]));
  const l2 = shadeMesh(two, cam, VP, {});
  assert.equal(l2.count, 1);
  for (let i = 0; i < 6; i++) assert.ok(Number.isFinite(l2.xy[i]));
  const behind = prepareMesh(triangleMesh([5, 0, 0], [5, 1, 0], [6, 0, 1]));
  assert.equal(shadeMesh(behind, cam, VP, {}).count, 0);
  const sphere = prepareMesh(uvSphere(3, 16, 8));
  const ls = shadeMesh(sphere, new OrbitCamera({ distance: 0.5, near: 0.05 }), VP, { twoSided: true });
  for (let i = 0; i < ls.count * 6; i++) assert.ok(Number.isFinite(ls.xy[i]));
  for (let i = 0; i < ls.count * 3; i++) assert.ok(Number.isFinite(ls.rgb[i]));
});

test('degenerate triangles never produce NaN', () => {
  const pm = prepareMesh({
    positions: Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0),
    indices: Uint32Array.of(0, 1, 2, 3, 4, 5, 0, 0, 1, 6, 7, 8),
  });
  for (const orthographic of [false, true]) {
    const l = shadeMesh(pm, new OrbitCamera({ orthographic }), VP, {});
    assert.equal(l.count, 1);
    for (let i = 0; i < l.count * 6; i++) assert.ok(Number.isFinite(l.xy[i]));
  }
  const empty = prepareMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) });
  assert.equal(shadeMesh(empty, new OrbitCamera(), VP, {}).count, 0);
});

test('draw list cache: unchanged inputs reuse the list; changes rebuild', () => {
  const pm = prepareMesh(uvSphere(1, 24, 12));
  const cam = new OrbitCamera();
  const list = createDrawList();
  assert.equal(shadeMesh(pm, cam, VP, { out: list }), list);
  const r = list.rebuilds;
  shadeMesh(pm, cam, VP, { out: list });
  assert.equal(list.rebuilds, r, 'cached');
  const xyBefore = list.xy;
  cam.rotate(0.1, 0);
  shadeMesh(pm, cam, VP, { out: list });
  assert.equal(list.rebuilds, r + 1);
  assert.equal(list.xy, xyBefore, 'typed arrays are reused');
  shadeMesh(pm, cam, VP, { out: list, cull: true });
  assert.equal(list.rebuilds, r + 2);
  shadeMesh(pm, cam, { ...VP, w: 700 }, { out: list, cull: true });
  assert.equal(list.rebuilds, r + 3);
});

test('maxTriangles decimates', () => {
  const pm = prepareMesh(uvSphere(1, 64, 32));
  const l = shadeMesh(pm, new OrbitCamera(), VP, { maxTriangles: 500 });
  assert.ok(l.decimated);
  assert.ok(l.count <= 505 && l.count > 100, String(l.count));
  assert.equal(shadeMesh(pm, new OrbitCamera(), VP, {}).decimated, false);
});

test('orthographic shading works and keeps order', () => {
  const pm = prepareMesh(torus());
  const cam = new OrbitCamera({ orthographic: true, distance: 4, yaw: 0.5, pitch: 0.7 });
  const l = shadeMesh(pm, cam, VP, { cull: true });
  assert.ok(l.count > 100);
  for (let k = 1; k < l.count; k++) assert.ok(l.depth[l.order[k - 1]] >= l.depth[l.order[k]] - 1e-3);
});

test('boundsBox, gridFloor, axesGizmo, projectSegments', () => {
  const b = { min: [0, 0, 0], max: [2, 3, 4] };
  const box = boundsBox(b);
  assert.equal(box.length, 72);
  for (let s = 0; s < 12; s++) {
    const d = [0, 1, 2].map((k) => Math.abs(box[s * 6 + k] - box[s * 6 + 3 + k]));
    assert.equal(d.filter((v) => v > 0).length, 1, 'each edge is axis-aligned');
  }
  const grid = gridFloor(b, { divisions: 4 });
  assert.equal(grid.length, 5 * 2 * 6);
  for (let i = 2; i < grid.length; i += 3) assert.equal(grid[i], 0);
  const g = axesGizmo(new OrbitCamera({ yaw: 0, pitch: 0 }), 50, 60, 20);
  assert.equal(g.length, 3);
  const z = g.find((a) => a.axis === 'z');
  close(z.x1, 50); close(z.y1, 40);
  assert.equal(g[2].axis, 'x', 'axis pointing at the viewer is drawn last');
  const holder = {};
  const cam = new OrbitCamera({ yaw: 0.3, pitch: 0.4, distance: 10, target: [1, 1.5, 2] });
  assert.equal(projectSegments(box, cam, VP, holder), 12);
  const inside = new OrbitCamera({ yaw: 0, pitch: 0, distance: 0.1, target: [1, 1.5, 2], near: 0.05 });
  const n = projectSegments(box, inside, VP, holder);
  for (let i = 0; i < n * 4; i++) assert.ok(Number.isFinite(holder.out[i]));
});

test('performance: 20k triangles shade + sort under ~60 ms', () => {
  const pm = prepareMesh(uvSphere(1, 100, 100)); // 19,800 triangles
  assert.ok(pm.triangleCount > 19000);
  const cam = new OrbitCamera({ distance: 4 });
  const list = createDrawList();
  shadeMesh(pm, cam, VP, { out: list }); // warm-up
  let best = Infinity;
  for (let i = 0; i < 6; i++) {
    cam.rotate(0.05, 0);
    const t0 = performance.now();
    shadeMesh(pm, cam, VP, { out: list, cull: true });
    best = Math.min(best, performance.now() - t0);
    assert.ok(list.count > 5000);
  }
  assert.ok(best < 60, `best ${best.toFixed(1)} ms`);
});
