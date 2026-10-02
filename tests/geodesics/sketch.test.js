import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import geodesics from '../../sketches/geodesics/index.js';
import { SURFACE_DEFS, projectToSurface, localGeometry } from '../../lib/surfaces.js';
import { normalize } from '../../lib/render3d.js';

function makeCtx(width, height, initial) {
  const P5 = createMockP5({ width, height });
  const settings = createStore({ namespace: 'geo-test', storage: createMemoryStorage() });
  for (const [k, v] of Object.entries(initial)) settings.set(k, v);
  const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
  const built = [];
  const ctx = {
    p5: P5, settings, globalSettings,
    ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
    drawer: {}, toolbar: {},
    onResize: () => () => {},
    size: () => ({ width, height }),
  };
  return { ctx, P5, built, settings };
}

async function mountSketch(initial = {}, size = [900, 650]) {
  const { ctx, P5, built, settings } = makeCtx(size[0], size[1], { resolution: 24, ...initial });
  const handle = await geodesics.mount({}, ctx);
  const p = P5.instances[P5.instances.length - 1];
  p.stepFrames(2);
  return { p, handle, built, settings };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));
const wrapPi = (x) => Math.atan2(Math.sin(x), Math.cos(x));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('every surface renders without invalid calls, with all overlays on', async () => {
  for (const def of SURFACE_DEFS) {
    const m = await mountSketch({
      surface: def.id, fan: true, fanCount: 6, target: true, paramLines: true, curvLines: true, dupin: true, loop: 'circle',
    });
    m.p.stepFrames(3);
    assert.equal(m.p.invalidCalls.length, 0, `${def.id}: ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);
    const d = m.handle.debug();
    assert.equal(d.lastError, null, `${def.id}: ${d.lastError && d.lastError.stack}`);
    assert.ok(m.p.callsOf('triangle').length > 100, `${def.id} draws the mesh`);
    assert.ok(m.p.callsOf('endShape').length > 0, `${def.id} draws curves`);
    assert.ok(d.main.points.length > 10);
    m.handle.unmount();
  }
});

test('all colour / render / loop modes draw cleanly and show their readouts', async () => {
  for (const colorBy of ['K', 'H', 'solid']) {
    for (const render of ['flat', 'both', 'wire']) {
      const m = await mountSketch({ surface: 'ellipsoid', colorBy, render });
      assert.equal(m.p.invalidCalls.length, 0, `${colorBy}/${render}`);
      assert.equal(m.handle.debug().lastError, null);
      const t = texts(m.p).join('\n');
      if (colorBy === 'K') assert.match(t, /Gaussian curvature K/);
      if (colorBy === 'H') assert.match(t, /mean curvature H/);
      m.handle.unmount();
    }
  }
  for (const loop of ['parallel', 'circle', 'triangle']) {
    for (const surface of ['sphere', 'torus', 'saddle']) {
      const m = await mountSketch({ surface, loop });
      assert.equal(m.p.invalidCalls.length, 0, `${surface}/${loop}`);
      assert.equal(m.handle.debug().lastError, null, `${surface}/${loop}`);
      assert.match(texts(m.p).join('\n'), /holonomy angle|loop:/);
      m.handle.unmount();
    }
  }
});

test('mesh cache is keyed by (surface, params, resolution) and survives camera / geodesic changes', async () => {
  const m = await mountSketch({ surface: 'torus' });
  const k0 = m.handle.debug().meshKeys;
  assert.equal(k0.length, 1);
  m.settings.set('theta', 80);
  m.settings.set('length', 3);
  m.settings.set('fan', true);
  m.p.stepFrames(2);
  assert.deepEqual(m.handle.debug().meshKeys, k0);
  m.settings.set('s.torus.r', 0.9);
  m.p.stepFrames(2);
  assert.equal(m.handle.debug().meshKeys.length, 2);
  m.settings.set('s.torus.r', 0.6);
  m.p.stepFrames(2);
  assert.equal(m.handle.debug().meshKeys.length, 2, 'going back reuses the first mesh');
  m.settings.set('resolution', 30);
  m.p.stepFrames(2);
  assert.equal(m.handle.debug().meshKeys.length, 3);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('clicking a visible surface point picks plausible (u, v) on every surface', async () => {
  for (const def of SURFACE_DEFS) {
    const m = await mountSketch({ surface: def.id, orbitOnly: false });
    const S = m.handle.debug().S;
    const { u0, u1, v0, v1 } = S.domain;
    let tried = 0, ok = 0;
    for (const [fu, fv] of [[0.2, 0.3], [0.5, 0.5], [0.7, 0.4], [0.35, 0.65], [0.85, 0.7], [0.1, 0.55], [0.6, 0.2], [0.05, 0.45], [0.15, 0.6], [0.25, 0.5], [0.3, 0.4], [0.9, 0.3], [0.95, 0.55], [0.45, 0.35], [0.8, 0.55]]) {
      const u = u0 + fu * (u1 - u0), v = v0 + fv * (v1 - v0);
      const sc = m.handle.screenOf(u, v);
      if (!sc.visible || !(sc.x > 5 && sc.x < 895 && sc.y > 5 && sc.y < 645)) continue;
      // skip grazing views, where a faceted mesh may legitimately be missed
      const q = localGeometry(S, u, v), eye = m.handle.debug().cam.eye();
      const view = normalize([eye[0] - q.r[0], eye[1] - q.r[1], eye[2] - q.r[2]]);
      if (Math.abs(dot(view, q.n)) < 0.3) continue;
      tried++;
      m.p.click(sc.x, sc.y);
      m.p.stepFrames(1);
      const d = m.handle.debug();
      // compare in 3D: the picked chart point must be the clicked surface point
      const want = S.eval(u, v).r, got = S.eval(d.start.u, d.start.v).r;
      const dist = Math.hypot(want[0] - got[0], want[1] - got[1], want[2] - got[2]);
      if (dist < 0.02 * d.size) ok++;
    }
    assert.ok(tried >= 2, `${def.id}: found visible points`);
    assert.equal(ok, tried, `${def.id}: picked ${ok}/${tried}`);
    assert.equal(m.p.invalidCalls.length, 0);
    m.handle.unmount();
  }
});

test('press on the surface sets A and dragging aims the geodesic; background drag orbits', async () => {
  const m = await mountSketch({ surface: 'sphere', theta: 10 });
  const S = m.handle.debug().S;
  const sc = m.handle.screenOf(1.2, 1.4);
  assert.ok(sc.visible);
  const theta0 = m.handle.debug().cam.yaw;
  m.p.pressMouse(sc.x, sc.y);
  const afterPress = m.handle.debug();
  assert.ok(Math.hypot(...S.eval(afterPress.start.u, afterPress.start.v).r.map((c, i) => c - S.eval(1.2, 1.4).r[i])) < 0.03);
  const before = m.settingsTheta ?? 10;
  m.p.moveMouse(sc.x + 60, sc.y);
  m.p.moveMouse(sc.x + 80, sc.y + 5);
  m.p.releaseMouse();
  m.p.stepFrames(1);
  const d = m.handle.debug();
  assert.notEqual(m.settings.get('theta'), before);
  assert.equal(d.cam.yaw, theta0, 'aiming does not orbit the camera');
  // drag from empty space orbits
  m.p.pressMouse(10, 10);
  m.p.moveMouse(60, 40);
  m.p.releaseMouse();
  assert.notEqual(m.handle.debug().cam.yaw, theta0);
  // right button and foreign targets are ignored for picking
  const s0 = m.settings.get('su');
  m.p.pressMouse(sc.x + 30, sc.y + 30, 'right');
  m.p.releaseMouse();
  assert.equal(m.settings.get('su'), s0);
  m.p.fire('mousePressed', { target: { tagName: 'DIV' } });
  m.handle.unmount();
});

test('geodesic polyline stays on the surface to 1e-6 (implicit equations)', async () => {
  const checks = {
    sphere: (S, q) => Math.hypot(q[0], q[1], q[2]) - S.params.R,
    torus: (S, q) => (Math.hypot(q[0], q[1]) - S.params.R) ** 2 + q[2] ** 2 - S.params.r ** 2,
    cylinder: (S, q) => Math.hypot(q[0], q[1]) - S.params.R,
    ellipsoid: (S, q) => (q[0] / S.params.a) ** 2 + (q[1] / S.params.b) ** 2 + (q[2] / S.params.c) ** 2 - 1,
    saddle: (S, q) => q[2] - S.params.a * (q[0] * q[0] - q[1] * q[1]),
    catenoid: (S, q) => Math.hypot(q[0], q[1]) - S.params.a * Math.cosh(q[2] / S.params.a),
  };
  for (const [id, f] of Object.entries(checks)) {
    const m = await mountSketch({ surface: id, length: 3, theta: 33, fan: true, fanCount: 5 });
    const d = m.handle.debug();
    for (const g of [d.main, ...d.fan]) {
      for (const pt of g.points) assert.ok(Math.abs(f(d.S, [pt.x, pt.y, pt.z])) < 1e-6, `${id}: ${f(d.S, [pt.x, pt.y, pt.z])}`);
    }
    m.handle.unmount();
  }
});

test('sphere great circle checked from the drawn output (orthographic view)', async () => {
  const R = 1.2;
  const m = await mountSketch({
    surface: 'sphere', 's.sphere.R': R, theta: 37, length: 2.6, bead: false, axes: false, fan: false, target: false, colorBy: 'solid',
  });
  const d = m.handle.debug();
  d.cam.orthographic = true;
  m.settings.set('axes', true);
  m.settings.set('axes', false);
  m.p.clearCalls();
  m.p.stepFrames(1);
  const cam = d.cam, rect = d.rect;
  const { right, up, fwd } = cam.frame();
  const s = cam.pixelScale(rect);
  // main geodesic strokes: weight 3 (visible runs, i.e. the front hemisphere)
  const runs = m.p.callsOf('endShape').filter((c) => c.style.strokeWeight === 3 && c.vertices.length > 1);
  assert.ok(runs.length >= 1, 'visible geodesic runs are drawn');
  const pts = [];
  for (const r of runs) {
    for (const v of r.vertices) {
      const xr = (v.x - rect.w / 2) / s, yr = -(v.y - rect.h / 2) / s;
      const rr2 = xr * xr + yr * yr;
      if (rr2 > (0.93 * R) ** 2) continue;
      const zr = Math.sqrt(R * R - rr2);
      pts.push([0, 1, 2].map((i) => cam.target[i] + right[i] * xr + up[i] * yr - fwd[i] * zr));
    }
  }
  assert.ok(pts.length > 10, `reconstructed ${pts.length} points`);
  const t0 = d.main.points[0];
  const nrm = normalize([
    t0.y * d.main.points[3].z - t0.z * d.main.points[3].y,
    t0.z * d.main.points[3].x - t0.x * d.main.points[3].z,
    t0.x * d.main.points[3].y - t0.y * d.main.points[3].x,
  ]);
  for (const q of pts) assert.ok(Math.abs(dot(q, nrm)) < 2e-3 * R, `plane distance ${dot(q, nrm)}`);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('holonomy readout equals 2 pi (1 - sin lat) on a sphere parallel (and the Gauss-Bonnet integral)', async () => {
  for (const latDeg of [60, 35, -25, 75]) {
    const lat = (latDeg * Math.PI) / 180;
    const m = await mountSketch({ surface: 'sphere', loop: 'parallel', loopV: (lat + Math.PI / 2) / Math.PI });
    const d = m.handle.debug();
    const lp = d.loop;
    assert.ok(lp && !lp.unavailable);
    const expected = wrapPi(2 * Math.PI * (1 - Math.sin(lp.latitude)));
    assert.ok(Math.abs(lp.latitude - lat) < 0.005);
    assert.ok(Math.abs(lp.angle - expected) < 1e-6, `lat ${latDeg}: ${lp.angle} vs ${expected}`);
    assert.ok(Math.abs(wrapPi(lp.KIntegral) - lp.angle) < 1e-6);
    // the number on screen
    const line = texts(m.p).find((t) => t.startsWith('holonomy angle'));
    assert.ok(line, 'holonomy readout is displayed');
    const shown = Number(/= ([-\d.e]+) deg/.exec(line)[1]);
    assert.ok(Math.abs(shown - (expected * 180) / Math.PI) < 1e-3 * Math.max(1, Math.abs(shown)), `${shown}`);
    m.handle.unmount();
  }
});

test('geodesic triangle readout: angle excess equals the integral of K (sphere), negative on a saddle', async () => {
  const m = await mountSketch({ surface: 'sphere', loop: 'triangle', triAlpha: 75, triAB: 0.9, triAC: 0.8, theta: 20 });
  const lp = m.handle.debug().loop;
  assert.ok(lp.triangle && lp.triangle.closed);
  assert.ok(Math.abs(lp.triangle.excess - lp.KIntegral) < 5e-4, `${lp.triangle.excess} vs ${lp.KIntegral}`);
  assert.ok(Math.abs(lp.angle - wrapPi(lp.KIntegral)) < 2e-3, 'holonomy around the triangle');
  assert.ok(texts(m.p).some((t) => t.startsWith('excess =')));
  m.handle.unmount();
  const s = await mountSketch({ surface: 'saddle', loop: 'triangle', triAlpha: 60, triAB: 0.3, triAC: 0.3, theta: 10, su: 0.4, sv: 0.4 });
  assert.ok(s.handle.debug().loop.triangle.excess < 0);
  s.handle.unmount();
});

test('shortest path to B: great-circle distance on a sphere; dragging B updates the distance', async () => {
  const m = await mountSketch({ surface: 'sphere', target: true, su: 0.1, sv: 0.4, tu: 0.4, tv: 0.55 });
  const d = m.handle.debug();
  const S = d.S;
  const a = S.eval(d.start.u, d.start.v).r;
  const tp = d.path.between;
  const { u0, u1, v0, v1 } = S.domain;
  const b = S.eval(u0 + 0.4 * (u1 - u0), v0 + 0.55 * (v1 - v0)).r;
  const R = S.params.R;
  assert.ok(Math.abs(tp.best.length - R * Math.acos(dot(a, b) / (R * R))) < 1e-5);
  assert.ok(texts(m.p).some((t) => t.includes('geodesic distance d(A,B)')));
  // drag B
  const mk = m.handle.debug().markers.target;
  assert.ok(mk, 'target marker drawn');
  const dest = m.handle.screenOf(u0 + 0.75 * (u1 - u0), v0 + 0.45 * (v1 - v0));
  m.p.pressMouse(mk.x, mk.y);
  m.p.moveMouse(dest.x, dest.y);
  m.p.releaseMouse();
  m.p.stepFrames(1);
  assert.notEqual(m.settings.get('tu'), 0.4);
  assert.equal(m.p.invalidCalls.length, 0);
  assert.equal(m.handle.debug().lastError, null);
  m.handle.unmount();
});

test('antipodal B is reported as non-unique / near conjugate', async () => {
  const m = await mountSketch({ surface: 'sphere', target: true, su: 0.1, sv: 0.4, tu: 0.6, tv: 0.6 });
  const S = m.handle.debug().S;
  const d = m.handle.debug();
  const a = S.eval(d.start.u, d.start.v).r;
  const b = S.eval(d.start.u + Math.PI, Math.PI - d.start.v).r;
  assert.ok(Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2]) < 1e-9);
  m.settings.set('tu', (0.1 + 0.5) % 1);
  m.settings.set('tv', 1 - 0.4);
  m.p.stepFrames(2);
  assert.ok(m.handle.debug().path.between.nearConjugate);
  assert.ok(texts(m.p).some((t) => /conjugate|cut locus/.test(t)));
  m.handle.unmount();
});

test('bead animates, keyboard toggles work, shortcuts ignore modifiers, d is not used', async () => {
  const m = await mountSketch({ surface: 'torus', bead: true });
  const s0 = m.handle.debug().beadS;
  m.p.stepFrames(10);
  assert.ok(m.handle.debug().beadS > s0);
  m.p.pressKey('f');
  assert.equal(m.settings.get('fan'), true);
  m.p.pressKey('t');
  assert.equal(m.settings.get('target'), true);
  m.p.pressKey('b');
  assert.equal(m.settings.get('bead'), false);
  const frozen = m.handle.debug().beadS;
  m.p.stepFrames(5);
  assert.equal(m.handle.debug().beadS, frozen);
  m.p.fire('keyPressed', { ctrlKey: true });
  m.p.key = 'd';
  const r = m.p.fire('keyPressed', {});
  assert.equal(r, true, 'd is left to the shell');
  m.handle.unmount();
});

test('wheel zooms, touch aim and orbit, double click resets the camera', async () => {
  const m = await mountSketch({ surface: 'torus' });
  const cam = m.handle.debug().cam;
  const d0 = cam.distance;
  m.p.moveMouse(300, 300, { fire: false });
  m.p.fire('mouseWheel', { delta: 100, deltaY: 100 });
  assert.ok(cam.distance > d0);
  m.p.fire('mouseWheel', { delta: 3, deltaMode: 1 });
  m.p.fire('doubleClicked', {});
  assert.equal(cam.distance, d0);
  m.p.touches = [{ x: 20, y: 20 }];
  m.p.fire('touchStarted', {});
  m.p.touches = [{ x: 80, y: 60 }];
  m.p.fire('touchMoved', {});
  m.p.fire('touchEnded', {});
  m.p.touches = [];
  m.p.stepFrames(1);
  assert.equal(m.p.invalidCalls.length, 0);
  m.handle.unmount();
});

test('resize through ctx.onResize and unmount twice are safe', async () => {
  let resize = () => {};
  const { ctx, P5 } = makeCtx(700, 500, { resolution: 20 });
  ctx.onResize = (fn) => { resize = fn; return () => { resize = () => {}; }; };
  let size = { width: 700, height: 500 };
  ctx.size = () => size;
  const handle = await geodesics.mount({}, ctx);
  const p = P5.instances[0];
  p.stepFrames(1);
  size = { width: 500, height: 420 };
  resize();
  p.stepFrames(1);
  assert.equal(p.width, 500);
  assert.equal(p.invalidCalls.length, 0);
  handle.unmount();
  handle.unmount();
  assert.equal(p.removed, true);
  const n = p.calls.length;
  p.stepFrames(2);
  assert.equal(p.calls.length, n, 'draw does nothing after unmount');
});

test('the drawer schema lists every surface and its parameters', async () => {
  const m = await mountSketch({});
  const schema = m.built[0];
  const find = (nodes, pred) => {
    for (const n of nodes) {
      if (pred(n)) return n;
      if (n.children) { const r = find(n.children, pred); if (r) return r; }
    }
    return null;
  };
  const sel = find(schema, (n) => n.key === 'surface');
  assert.equal(sel.options.length, SURFACE_DEFS.length);
  for (const def of SURFACE_DEFS) for (const prm of def.params) assert.ok(find(schema, (n) => n.key === `s.${def.id}.${prm.key}`), prm.key);
  m.handle.unmount();
  void projectToSurface;
});
