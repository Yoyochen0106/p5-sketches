import test from 'node:test';
import assert from 'node:assert/strict';
import { MockP5 } from '../mock-p5.js';
import { OrbitCamera, prepareMesh, boundsBox } from '../../lib/render3d.js';
import { drawMesh, drawEdges, drawAxes, drawBoundsBox, CameraController } from '../../sketches/shared3d/draw3d.js';
import { uvSphere, torus } from '../lib/mesh-helpers.js';

const RECT = { x: 0, y: 0, w: 800, h: 600 };

function makeP(w = 800, h = 600) {
  const p = new MockP5(() => {}, null, { width: w, height: h });
  return p;
}

function counts(p) {
  const c = {};
  for (const call of p.calls) c[call.fn] = (c[call.fn] || 0) + 1;
  return c;
}

test('drawMesh flat: one triangle() per item, few style calls, no invalid numbers', () => {
  const p = makeP();
  const pm = prepareMesh(uvSphere(1, 40, 20));
  const cam = new OrbitCamera({ distance: 4 });
  const list = drawMesh(p, pm, cam, RECT, { cull: true });
  const c = counts(p);
  assert.equal(c.triangle, list.count);
  assert.ok(list.count > 100);
  assert.ok((c.fill || 0) + (c.stroke || 0) < 2 * list.count, 'colour changes are batched');
  assert.ok(((c.fill || 0) + (c.stroke || 0) + c.triangle) / list.count < 3, 'under 3 p5 calls per triangle');
  assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 2)));
  assert.equal(c.push, 1); assert.equal(c.pop, 1);
  assert.ok(p.drawingContext.calls.some((x) => x.fn === 'clip'), 'clipped to the rect via push/clip/pop');
});

test('drawMesh draws far triangles before near ones', () => {
  const p = makeP();
  const pm = prepareMesh({
    positions: Float32Array.of(1, -1, -1, 1, 1, -1, 1, 0, 1, -1, -1, -1, -1, 1, -1, -1, 0, 1),
    indices: Uint32Array.of(0, 1, 2, 3, 4, 5),
  });
  const list = drawMesh(p, pm, new OrbitCamera({ yaw: 0, pitch: 0, distance: 6 }), RECT, { colorBy: 'solid' });
  assert.equal(list.count, 2);
  const tris = p.callsOf('triangle');
  // the far triangle (x = -1) is drawn first; it projects slightly smaller than the near one
  const span = (t) => Math.abs(t.args[2] - t.args[0]);
  assert.ok(span(tris[0]) < span(tris[1]));
});

test('drawMesh: unchanged camera does not re-sort; rotating does', () => {
  const p = makeP();
  const pm = prepareMesh(uvSphere(1, 40, 20));
  const cam = new OrbitCamera({ distance: 4 });
  const l1 = drawMesh(p, pm, cam, RECT, {});
  const r = l1.rebuilds;
  const xy = l1.xy;
  for (let i = 0; i < 5; i++) drawMesh(p, pm, cam, RECT, {});
  assert.equal(l1.rebuilds, r);
  cam.rotate(0.2, 0);
  const l2 = drawMesh(p, pm, cam, RECT, {});
  assert.equal(l2, l1, 'same list object per mesh');
  assert.equal(l2.rebuilds, r + 1);
  assert.equal(l2.xy, xy, 'buffers reused');
  // explicit cache object
  const cache = {};
  const a = drawMesh(p, pm, cam, RECT, { cache });
  assert.notEqual(a, l1);
  assert.equal(cache.list, a);
});

test('drawMesh modes: wire, both, points; alpha; maxTriangles', () => {
  const pm = prepareMesh(torus(1, 0.35, 40, 20));
  const cam = new OrbitCamera({ distance: 4.5 });
  let p = makeP();
  const w = drawMesh(p, pm, cam, RECT, { mode: 'wire' });
  let c = counts(p);
  assert.equal(c.triangle, w.count);
  assert.equal(c.fill || 0, 0);
  assert.ok(c.noFill >= 1);
  p = makeP();
  const b = drawMesh(p, pm, cam, RECT, { mode: 'both' });
  c = counts(p);
  assert.equal(c.triangle, b.count);
  assert.ok(c.fill > 0 && c.stroke === 1);
  p = makeP();
  drawMesh(p, pm, cam, RECT, { mode: 'points' });
  c = counts(p);
  assert.equal(c.point, pm.vertexCount);
  assert.equal(c.triangle || 0, 0);
  p = makeP();
  drawMesh(p, pm, cam, RECT, { alpha: 100 });
  assert.ok(p.callsOf('fill').every((f) => f.args[3] === 100));
  assert.equal(p.callsOf('stroke').length, 0, 'no seam strokes when translucent');
  p = makeP();
  const d = drawMesh(p, pm, cam, RECT, { maxTriangles: 300 });
  assert.ok(d.count <= 305 && d.decimated);
  assert.equal(counts(p).triangle, d.count);
  assert.equal(p.invalidCalls.length, 0);
});

test('drawMesh with 20k triangles: at most 3 p5 calls per triangle (2 without seams), 1 for flat colour', () => {
  const pm = prepareMesh(uvSphere(1, 100, 100));
  const cam = new OrbitCamera({ distance: 4 });
  let p = makeP();
  const list = drawMesh(p, pm, cam, RECT, { cull: true });
  assert.ok(list.count > 5000);
  assert.equal(counts(p).triangle, list.count);
  assert.ok(p.calls.length <= 3 * list.count + 10, `${p.calls.length} calls for ${list.count} triangles`);
  p = makeP();
  drawMesh(p, pm, cam, RECT, { cull: true, seams: false });
  assert.ok(p.calls.length <= 2 * list.count + 10, `${p.calls.length} calls`);
  p = makeP();
  const flat = drawMesh(p, pm, cam, RECT, { cull: true, seams: false, wireColor: null, ambient: 1, diffuse: 0, specular: 0, colorBy: 'solid' });
  assert.ok(p.calls.length < flat.count * 1.01 + 10, `${p.calls.length} calls for uniform colour`);
  assert.equal(p.invalidCalls.length, 0);
});

test('drawEdges, drawBoundsBox, drawAxes', () => {
  const p = makeP();
  const cam = new OrbitCamera({ yaw: 0.5, pitch: 0.4, distance: 8 });
  const b = { min: [-1, -1, -1], max: [1, 1, 1] };
  assert.equal(drawBoundsBox(p, b, cam, RECT, { stroke: [255, 255, 255, 200] }), 12);
  assert.equal(p.callsOf('line').length, 12);
  p.clearCalls();
  drawAxes(p, cam, RECT);
  assert.equal(p.callsOf('line').length, 3);
  assert.equal(p.callsOf('text').length, 3);
  p.clearCalls();
  assert.equal(drawEdges(p, new Float32Array(0), cam, RECT), 0);
  assert.equal(p.invalidCalls.length, 0);
  // camera inside the box
  const inside = new OrbitCamera({ distance: 0.2, near: 0.05 });
  drawEdges(p, boundsBox(b), inside, RECT);
  assert.equal(p.invalidCalls.length, 0);
});

// ---------------------------------------------------------------------------------------------

function setup() {
  const p = makeP();
  const cam = new OrbitCamera({ yaw: 0.5, pitch: 0.3, distance: 5 });
  let changes = 0;
  const ctl = new CameraController(p, cam, RECT, { onChange: () => { changes++; } });
  ctl.attach();
  return { p, cam, ctl, changes: () => changes };
}

test('controller: left drag orbits, shift/right drag pans', () => {
  const { p, cam, changes } = setup();
  const yaw0 = cam.yaw, pitch0 = cam.pitch;
  p.pressMouse(400, 300);
  p.moveMouse(440, 320);
  p.releaseMouse();
  assert.ok(cam.yaw < yaw0, 'dragging right turns the scene right (camera yaw decreases)');
  assert.ok(cam.pitch > pitch0);
  assert.ok(changes() >= 1);
  const t0 = cam.target.slice();
  p.pressMouse(400, 300, 'right');
  p.moveMouse(430, 300);
  p.releaseMouse();
  assert.notDeepEqual(cam.target, t0, 'right drag pans');
  const t1 = cam.target.slice();
  const yaw1 = cam.yaw;
  p.pressMouse(400, 300);
  p.moveMouse(410, 300);
  p.releaseMouse();
  assert.notEqual(cam.yaw, yaw1);
  // shift via event
  const t2 = cam.target.slice();
  p.mouseButton = 'left';
  p.mouseX = 200; p.mouseY = 200;
  assert.equal(p.fire('mousePressed', { shiftKey: true }), undefined);
  p.mouseX = 230; p.mouseY = 210;
  p.fire('mouseDragged', {});
  p.fire('mouseReleased', {});
  assert.notDeepEqual(cam.target, t2);
  assert.notDeepEqual(t1, t0);
});

test('controller: ignores events from other targets and presses outside the rect', () => {
  const p = makeP();
  const cam = new OrbitCamera();
  const ctl = new CameraController(p, cam, { x: 100, y: 100, w: 300, h: 300 });
  const y0 = cam.yaw;
  p.mouseX = 200; p.mouseY = 200;
  assert.equal(ctl.mousePressed({ target: { tagName: 'DIV' } }), false);
  assert.equal(ctl.drag, null);
  assert.equal(ctl.mouseWheel({ target: { tagName: 'DIV' }, delta: 100 }), true);
  p.mouseX = 50; p.mouseY = 50;
  assert.equal(ctl.mousePressed({ target: p.canvas }), false, 'outside rect');
  p.mouseX = 200; p.mouseY = 200;
  assert.equal(ctl.mousePressed({ target: p.canvas }), true);
  p.mouseX = 250;
  ctl.mouseDragged();
  assert.notEqual(cam.yaw, y0);
});

test('controller: wheel zoom with deltaMode normalisation and clamping', () => {
  const { p, cam } = setup();
  p.mouseX = 400; p.mouseY = 300;
  const d0 = cam.distance;
  const e1 = { delta: 100 };
  assert.equal(p.fire('mouseWheel', e1), false);
  assert.ok(e1.defaultPrevented);
  const d1 = cam.distance;
  assert.ok(d1 > d0, 'positive delta zooms out');
  p.fire('mouseWheel', { delta: -100 });
  assert.ok(Math.abs(cam.distance - d0) < 1e-9);
  // line mode (x33) equals pixel mode with 33 times the delta
  const a = new OrbitCamera({ distance: 5 }), b = new OrbitCamera({ distance: 5 });
  const pa = makeP(), pb = makeP();
  pa.mouseX = pb.mouseX = 400; pa.mouseY = pb.mouseY = 300;
  new CameraController(pa, a, RECT).mouseWheel({ delta: 3, deltaMode: 1 });
  new CameraController(pb, b, RECT).mouseWheel({ delta: 99, deltaMode: 0 });
  assert.ok(Math.abs(a.distance - b.distance) < 1e-12);
  // huge delta is clamped
  const c = new OrbitCamera({ distance: 5 });
  new CameraController(pa, c, RECT).mouseWheel({ delta: 1e9, deltaMode: 2 });
  assert.ok(Math.abs(c.distance - 5 * Math.exp(300 * 0.0012)) < 1e-9);
  // outside the rect: not consumed
  p.mouseX = 900;
  const before = cam.distance;
  assert.equal(p.fire('mouseWheel', { delta: 100 }), true);
  assert.equal(cam.distance, before);
});

test('controller: double click and R reset; R ignored with modifiers', () => {
  const { p, cam } = setup();
  cam.rotate(1, 0.3); cam.zoom(2);
  p.mouseX = 400; p.mouseY = 300;
  p.fire('doubleClicked', {});
  assert.ok(Math.abs(cam.yaw - 0.5) < 1e-12 && Math.abs(cam.distance - 5) < 1e-12);
  cam.rotate(1, 0);
  p.key = 'r';
  assert.equal(p.fire('keyPressed', { ctrlKey: true }), undefined);
  assert.notEqual(cam.yaw, 0.5);
  p.pressKey('R', 82);
  assert.ok(Math.abs(cam.yaw - 0.5) < 1e-12);
  // typing in an input
  cam.rotate(1, 0);
  globalThis.document = { activeElement: { tagName: 'INPUT' } };
  try {
    p.pressKey('r', 82);
  } finally {
    delete globalThis.document;
  }
  assert.notEqual(cam.yaw, 0.5);
});

test('controller: one-finger orbit, two-finger pan and pinch zoom', () => {
  const { p, cam } = setup();
  const yaw0 = cam.yaw;
  p.touches = [{ x: 400, y: 300 }];
  assert.equal(p.fire('touchStarted', {}), false);
  p.touches = [{ x: 440, y: 300 }];
  assert.equal(p.fire('touchMoved', {}), false);
  assert.ok(cam.yaw < yaw0);
  // second finger down: re-baseline, no jump
  const y1 = cam.yaw, t1 = cam.target.slice();
  p.touches = [{ x: 440, y: 300 }, { x: 500, y: 300 }];
  p.fire('touchStarted', {});
  assert.equal(cam.yaw, y1);
  assert.deepEqual(cam.target, t1);
  // move both by +30 px, same spread: pans, distance unchanged
  const d0 = cam.distance;
  p.touches = [{ x: 470, y: 300 }, { x: 530, y: 300 }];
  p.fire('touchMoved', {});
  assert.notDeepEqual(cam.target, t1);
  assert.ok(Math.abs(cam.distance - d0) < 1e-9);
  // spread apart: zoom in (distance shrinks)
  p.touches = [{ x: 440, y: 300 }, { x: 560, y: 300 }];
  p.fire('touchMoved', {});
  assert.ok(cam.distance < d0);
  // lift both
  p.touches = [];
  assert.equal(p.fire('touchEnded', {}), false);
  assert.equal(p.fire('touchEnded', {}), true, 'no gesture active any more');
  // a mouse press emulated after a touch does nothing while a touch is active
});

test('controller: detach restores handlers; touch outside rect is not consumed', () => {
  const p = makeP();
  const orig = () => 'orig';
  p.mousePressed = orig;
  const ctl = new CameraController(p, new OrbitCamera(), { x: 0, y: 0, w: 100, h: 100 });
  const off = ctl.attach();
  assert.notEqual(p.mousePressed, orig);
  p.touches = [{ x: 500, y: 500 }];
  assert.equal(p.fire('touchStarted', {}), true);
  off();
  assert.equal(p.mousePressed, orig);
  off(); // twice is safe
});

test('end to end: orbiting while drawing never yields invalid calls', () => {
  const { p, cam } = setup();
  const pm = prepareMesh(torus());
  p.draw = () => {
    p.background(0);
    drawMesh(p, pm, cam, RECT, { cull: false });
  };
  p.stepFrames(1);
  p.pressMouse(400, 300);
  for (let i = 0; i < 10; i++) { p.moveMouse(400 + i * 15, 300 - i * 10); p.stepFrames(1); }
  p.releaseMouse();
  for (let i = 0; i < 5; i++) { p.mouseX = 400; p.mouseY = 300; p.fire('mouseWheel', { delta: -200 }); p.stepFrames(1); }
  assert.equal(p.invalidCalls.length, 0);
});
