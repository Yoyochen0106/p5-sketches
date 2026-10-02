// Surface Curvature & Geodesics: parametric surfaces coloured by Gaussian / mean curvature, geodesics
// shot from a picked point, shortest paths by shooting, parallel transport and holonomy (Gauss-Bonnet),
// lines of curvature and the Dupin indicatrix. Software-rendered 3D on a 2D p5 canvas.

import { getPalette } from '../approx/palette.js';
import { OrbitCamera } from '../../lib/render3d.js';
import { CameraController } from '../shared3d/draw3d.js';
import { LRU } from '../../lib/iso-mesh.js';
import { SURFACE_DEFS, createSurface } from '../../lib/surfaces.js';
import { tangentFrame } from '../../lib/geodesic.js';
import {
  DEFAULTS, COLOR_MODES, RENDER_MODES, LOOPS, paramKey, clamp, fmt, deg,
} from './state.js';
import {
  buildMeshEntry, startPoint, fractionOf, pickSurface, describePoint, mainGeodesic, fanGeodesics, shortestPath, loopData,
  curvatureLines, paramLines, dupinAt,
} from './scene.js';
import { DepthBuffer } from './depth.js';
import { drawScene, drawLegend, drawHud, COLORS } from './draw.js';

/** Settings store with defaults filled in, as expected by core/ui.js. */
function withDefaults(store) {
  return {
    get: (k, d) => store.get(k, d !== undefined ? d : DEFAULTS[k]),
    set: (k, v) => store.set(k, v),
    subscribe: (fn) => store.subscribe(fn),
    all: () => store.all && store.all(),
    reset: () => store.reset && store.reset(),
  };
}

const rad = (d) => (d * Math.PI) / 180;
const hex = (c) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;
const norm360 = (d) => ((d % 360) + 360) % 360;

export default {
  id: 'geodesics',
  title: 'Surface Curvature & Geodesics',
  description: 'Curvature of parametric surfaces, geodesics and shortest paths, parallel transport, holonomy and Gauss-Bonnet.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings);
    const get = (k) => store.get(k);
    const cleanups = [];
    const st = {
      disposed: false,
      dirty: true,
      w: 800,
      h: 600,
      rect: { x: 0, y: 0, w: 800, h: 600 },
      cam: new OrbitCamera({ yaw: 0.8, pitch: 0.5 }),
      surfKey: '',
      surf: null,
      meshes: new LRU(4),
      memo: new LRU(48),
      drawCache: {},
      depth: null,
      depthSig: '',
      press: null,
      aimLive: false,
      quickPath: false,
      beadS: 0,
      lastGeo: null,
      lastView: null,
      lastError: null,
      drawCount: 0,
      markers: {},
    };
    let doResize = () => {};

    // ---------- model ----------
    function surfaceNow() {
      const id = get('surface');
      const def = SURFACE_DEFS.find((d) => d.id === id) || SURFACE_DEFS[0];
      const params = {};
      for (const s of def.params) params[s.key] = get(paramKey(def.id, s.key));
      const key = `${def.id}|${JSON.stringify(params)}`;
      if (key !== st.surfKey || !st.surf) {
        st.surfKey = key;
        st.surf = createSurface(def.id, params);
        st.surf.key = key;
        st.fit = true;
      }
      return st.surf;
    }

    function entryNow() {
      const S = surfaceNow();
      const res = clamp(Math.round(get('resolution')), 12, 120);
      const key = `${S.key}|${res}`;
      const e = st.meshes.getOrCreate(key, () => buildMeshEntry(S, res));
      if (st.fit) {
        st.fit = false;
        st.cam.yaw = 0.8; st.cam.pitch = 0.5;
        st.cam.fitToBounds(e.bounds, 1.15);
        st.cam.saveHome();
        st.beadS = 0;
      }
      return e;
    }

    const memo = (key, make) => st.memo.getOrCreate(key, make);

    /** All derived geometry for the current settings. */
    function geoNow() {
      const e = entryNow();
      const S = e.S;
      const size = e.extent.size;
      const start = startPoint(S, get('su'), get('sv'));
      const theta = rad(norm360(get('theta')));
      const L = clamp(get('length'), 0.05, 12) * size;
      const sk = `${S.key}|${start.u.toFixed(6)},${start.v.toFixed(6)}`;
      const point = memo(`pt|${sk}`, () => describePoint(S, start.u, start.v));
      const main = memo(`main|${sk}|${theta.toFixed(5)}|${L.toFixed(4)}`, () => mainGeodesic(S, start, theta, L));
      const geo = { S, entry: e, start, theta, L, point, main, size };
      geo.fan = get('fan')
        ? memo(`fan|${sk}|${theta.toFixed(5)}|${L.toFixed(4)}|${get('fanCount')}`, () => fanGeodesics(S, start, theta, L, clamp(Math.round(get('fanCount')), 2, 48)))
        : null;
      if (get('target')) {
        geo.targetUV = startPoint(S, get('tu'), get('tv'));
        const quick = st.quickPath;
        geo.path = memo(`path|${sk}|${geo.targetUV.u.toFixed(5)},${geo.targetUV.v.toFixed(5)}|${quick}`, () => shortestPath(S, start, geo.targetUV, quick));
      }
      if (get('loop') !== 'none') {
        const o = {
          loop: get('loop'), loopV: get('loopV'), loopR: get('loopR'), theta, triAlpha: get('triAlpha'), triAB: get('triAB'), triAC: get('triAC'),
        };
        geo.loop = memo(`loop|${sk}|${JSON.stringify(o)}`, () => {
          const d = loopData(S, e.extent, start, o);
          if (d) d.arrowLen = 0.07 * size;
          return d;
        });
      }
      geo.curv = get('curvLines') ? memo(`curv|${S.key}`, () => curvatureLines(S, e.extent)) : null;
      geo.params = get('paramLines') ? memo(`params|${S.key}`, () => paramLines(S)) : null;
      geo.dupin = get('dupin') ? memo(`dupin|${sk}`, () => dupinAt(S, e.extent, start.u, start.v)) : null;
      st.lastGeo = geo;
      return geo;
    }

    /** Point on the main geodesic at arc length s (linear between samples). */
    function pointAt(g, s) {
      const pts = g.points;
      if (!pts.length) return null;
      if (s <= 0) return [pts[0].x, pts[0].y, pts[0].z];
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].s >= s) {
          const a = pts[i - 1], b = pts[i], f = (s - a.s) / Math.max(1e-12, b.s - a.s);
          return [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f];
        }
      }
      const l = pts[pts.length - 1];
      return [l.x, l.y, l.z];
    }

    // ---------- p5 sketch ----------
    const sketch = (p) => {
      let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
      const markDirty = () => { st.dirty = true; };
      const ctl = new CameraController(p, st.cam, () => st.rect, { onChange: markDirty, resetKey: 'r' });
      st.ctl = ctl;

      const sizeNow = () => {
        const s = ctx.size();
        return { w: Math.max(260, s.width), h: Math.max(260, s.height) };
      };
      function layout(w, h) {
        st.w = w; st.h = h;
        st.rect = { x: 0, y: 0, w, h };
      }
      p.setup = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        layout(w, h);
      };
      doResize = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        layout(w, h);
        st.dirty = true;
      };

      const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
      const inRect = (x, y) => x >= 0 && y >= 0 && x < st.w && y < st.h;

      // ----- interaction -----
      function pickAt(x, y) {
        const e = entryNow();
        return pickSurface(e, st.cam.ray(x, y, st.rect));
      }
      function setStart(hit) {
        const f = fractionOf(st.surf, hit.u, hit.v);
        store.set('su', Number(f.fu.toFixed(5)));
        store.set('sv', Number(f.fv.toFixed(5)));
      }
      function aimTo(x, y) {
        const geo = geoNow();
        const S = geo.S;
        const fr = tangentFrame(S, geo.start.u, geo.start.v);
        const eps = 0.1 * geo.size;
        const P0 = st.cam.project(fr.r, st.rect);
        const P1 = st.cam.project([fr.r[0] + fr.e1[0] * eps, fr.r[1] + fr.e1[1] * eps, fr.r[2] + fr.e1[2] * eps], st.rect);
        const P2 = st.cam.project([fr.r[0] + fr.e2[0] * eps, fr.r[1] + fr.e2[1] * eps, fr.r[2] + fr.e2[2] * eps], st.rect);
        if (!P0.visible || !P1.visible || !P2.visible) return;
        const m = [x - P0.x, y - P0.y];
        if (Math.hypot(m[0], m[1]) < 4) return;
        const a = (P1.x - P0.x) * m[0] + (P1.y - P0.y) * m[1], b = (P2.x - P0.x) * m[0] + (P2.y - P0.y) * m[1];
        if (!(Math.hypot(a, b) > 1e-9)) return;
        store.set('theta', Number(norm360(deg(Math.atan2(b, a))).toFixed(1)));
      }
      function nearTarget(x, y) {
        const t = st.markers.target;
        return !!get('target') && !!t && Math.hypot(t.x - x, t.y - y) < 16;
      }
      function pressAt(x, y, allowPick) {
        st.press = { x, y, moved: false, mode: 'cam', hit: null };
        if (!allowPick) return false;
        if (nearTarget(x, y)) { st.press.mode = 'target'; st.quickPath = true; return true; }
        const hit = pickAt(x, y);
        if (!hit) return false;
        st.press.hit = hit;
        if (get('orbitOnly')) { st.press.mode = 'camclick'; return false; }
        setStart(hit);
        st.press.mode = 'aim';
        return true;
      }
      function dragTo(x, y) {
        const pr = st.press;
        if (!pr) return false;
        if (Math.hypot(x - pr.x, y - pr.y) > 4) pr.moved = true;
        if (pr.mode === 'aim') { if (pr.moved) aimTo(x, y); return true; }
        if (pr.mode === 'target') {
          const hit = pickAt(x, y);
          if (hit) {
            const f = fractionOf(st.surf, hit.u, hit.v);
            store.set('tu', Number(f.fu.toFixed(5)));
            store.set('tv', Number(f.fv.toFixed(5)));
          }
          return true;
        }
        return false;
      }
      function releaseAt() {
        const pr = st.press;
        st.press = null;
        if (!pr) return;
        if (pr.mode === 'target') { st.quickPath = false; st.dirty = true; }
        if (pr.mode === 'camclick' && !pr.moved && pr.hit) setStart(pr.hit);
      }

      p.mousePressed = (e) => {
        if (!onCanvas(e) || ctl.touchActive || !inRect(p.mouseX, p.mouseY)) return;
        const left = p.mouseButton !== p.RIGHT && p.mouseButton !== p.CENTER && !(e && e.shiftKey) && !(p.keyIsDown && p.keyIsDown(16));
        const consumed = pressAt(p.mouseX, p.mouseY, left);
        if (!consumed) ctl.mousePressed(e);
      };
      p.mouseDragged = () => {
        if (ctl.touchActive) return;
        if (!dragTo(p.mouseX, p.mouseY)) ctl.mouseDragged();
      };
      p.mouseReleased = () => {
        if (ctl.touchActive) return;
        ctl.mouseReleased();
        releaseAt();
      };
      p.doubleClicked = (e) => {
        if (!onCanvas(e)) return;
        ctl.doubleClicked(e);
      };
      p.mouseWheel = (e) => {
        if (!onCanvas(e)) return true;
        return ctl.mouseWheel(e);
      };

      const touch1 = () => {
        const t = p.touches || [];
        return t.length === 1 ? [t[0].x, t[0].y] : null;
      };
      p.touchStarted = (e) => {
        if (!onCanvas(e)) return true;
        const t = touch1();
        if (t && inRect(t[0], t[1]) && pressAt(t[0], t[1], true)) return false;
        st.press = null;
        return ctl.touchStarted(e);
      };
      p.touchMoved = () => {
        const t = touch1();
        if (t && st.press && (st.press.mode === 'aim' || st.press.mode === 'target')) { dragTo(t[0], t[1]); return false; }
        return ctl.touchMoved();
      };
      p.touchEnded = () => {
        const had = st.press && (st.press.mode === 'aim' || st.press.mode === 'target');
        releaseAt();
        if (had) return false;
        return ctl.touchEnded();
      };

      function typing(k) {
        const el = globalThis.document && globalThis.document.activeElement;
        if (!el) return false;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
        return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
      }
      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const k = String(p.key);
        if (typing(k)) return true;
        if (k === 'f' || k === 'F') store.set('fan', !get('fan'));
        else if (k === 'b' || k === 'B') store.set('bead', !get('bead'));
        else if (k === 't' || k === 'T') store.set('target', !get('target'));
        else if (k === 'r' || k === 'R') ctl.reset();
        else return true;
        return false;
      };

      // ----- animation -----
      function tick() {
        if (!get('bead')) return;
        const geo = st.lastGeo;
        if (!geo || !geo.main || !geo.main.points.length) return;
        const dt = clamp((p.deltaTime || 16) / 1000, 0, 0.1);
        st.beadS += dt * 0.35 * geo.size * clamp(Number(get('beadSpeed')) || 1, 0.1, 4);
        if (st.beadS > geo.main.length) st.beadS = 0;
        st.dirty = true;
      }

      // ----- drawing -----
      function depthFor(entry) {
        const c = st.cam, r = st.rect;
        const sig = [entry.S.key, entry.nu, c.yaw, c.pitch, c.distance, c.target.join(), c.fov, c.orthographic, r.w, r.h].join('|');
        if (sig !== st.depthSig || !st.depth) {
          st.depth = new DepthBuffer(entry.mesh, c, r, 0.5);
          st.depthSig = sig;
        }
        return st.depth;
      }

      function classify(pt) {
        if (Math.abs(pt.k1) < 1e-6 && Math.abs(pt.k2) < 1e-6) return 'planar';
        if (pt.K > 1e-6) return 'elliptic (K > 0)';
        if (pt.K < -1e-6) return 'hyperbolic (K < 0)';
        return 'parabolic (K = 0)';
      }

      function buildHud(geo) {
        const S = geo.S, pt = geo.point;
        const lines = [];
        lines.push({ text: `${S.label}   ${Object.entries(S.params).map(([k, v]) => `${k}=${fmt(v, 3)}`).join(' ')}`, color: pal.accent });
        lines.push(`A: (u, v) = (${fmt(geo.start.u, 4)}, ${fmt(geo.start.v, 4)})   ${classify(pt)}`);
        lines.push(`K = ${fmt(pt.K)}   H = ${fmt(pt.H)}   k1 = ${fmt(pt.k1)}   k2 = ${fmt(pt.k2)}`);
        const g = geo.main;
        lines.push({
          text: `geodesic: angle ${fmt(norm360(get('theta')), 4)} deg, length ${fmt(g.length, 4)}${g.reason === 'length' ? '' : ` (stopped: ${g.reason})`}`,
          color: hex(COLORS.main),
        });
        if (geo.path) {
          const b = geo.path.between;
          if (!b.best) lines.push({ text: 'B: no geodesic from A reaches B (shooting failed)', color: '#ff6b6b' });
          else {
            lines.push({ text: `B: geodesic distance d(A,B) = ${fmt(b.best.length, 5)}  (straight chord ${fmt(b.chord, 5)})`, color: hex(COLORS.path) });
            const alts = b.candidates.slice(1, 3).map((c) => fmt(c.length, 4));
            if (alts.length) lines.push(`other geodesics A to B: ${alts.join(', ')}${geo.path.quick ? ' (quick search while dragging)' : ''}`);
            if (b.ambiguous) lines.push({ text: 'cut locus: two shortest paths of equal length, the shortest path is not unique', color: '#ffb84d' });
            else if (b.nearConjugate) lines.push({ text: 'near a conjugate point: neighbouring geodesics focus, the shortest path is unstable', color: '#ffb84d' });
          }
        }
        const lp = geo.loop;
        if (lp) {
          if (lp.unavailable) lines.push({ text: `loop: ${lp.unavailable}`, color: '#ffb84d' });
          else {
            lines.push({ text: `loop: ${lp.title}`, color: hex(COLORS.tri) });
            lines.push({ text: `holonomy angle = ${fmt(deg(lp.angle), 5)} deg`, color: hex(COLORS.transport) });
            if (lp.KIntegral !== null) lines.push(`integral of K dA over the enclosed region = ${fmt(lp.KIntegral, 5)} rad = ${fmt(deg(lp.KIntegral), 5)} deg  (mod 360: ${fmt(deg(lp.expected), 5)})`);
            if (lp.kind === 'parallel' && S.defId === 'sphere' && lp.KIntegral !== null) {
              const lat = lp.latitude;
              if (lat !== undefined) lines.push(`sphere: 2 pi (1 - sin lat) = ${fmt(deg(2 * Math.PI * (1 - Math.sin(lat))), 5)} deg at lat ${fmt(deg(lat), 4)} deg`);
            }
            if (lp.note) lines.push({ text: lp.note, color: pal.muted });
            const t = lp.triangle;
            if (t) {
              lines.push(`angles ${t.angles.map((a) => fmt(deg(a), 4)).join(', ')} deg   sum = ${fmt(deg(t.sum), 5)} deg`);
              lines.push(`excess = sum - 180 = ${fmt(deg(t.excess), 5)} deg = ${fmt(t.excess, 5)} rad${t.closed ? `   (area ${fmt(t.area, 4)})` : ''}`);
            }
          }
        }
        if (geo.curv && !geo.curv.length) lines.push({ text: 'every point is umbilic: no lines of curvature', color: pal.muted });
        if (geo.dupin) lines.push(`Dupin indicatrix: ${geo.dupin.type}`);
        lines.push({ text: 'click: set A - drag from A: aim - T: second point B - F: fan - B: bead - wheel/drag: camera', color: pal.muted });
        return lines;
      }

      p.draw = () => {
        if (st.disposed) return;
        tick();
        if (!st.dirty) return;
        st.dirty = false;
        st.drawCount++;
        p.background(pal.bg);
        try {
          const geo = geoNow();
          const e = geo.entry;
          const db = depthFor(e);
          const V = {
            pal, cam: st.cam, rect: st.rect, entry: e, db, drawCache: st.drawCache,
            opts: { colorBy: get('colorBy'), render: get('render'), paramLines: !!get('paramLines'), axes: !!get('axes') },
            geo: {
              startPt: geo.point.r,
              main: geo.main,
              fan: geo.fan,
              path: geo.path && geo.path.between.best ? geo.path : null,
              loop: geo.loop && !geo.loop.unavailable ? geo.loop : null,
              curv: geo.curv,
              params: geo.params,
              dupin: geo.dupin,
              target: get('target') ? e.S.eval(geo.targetUV.u, geo.targetUV.v).r : null,
              bead: get('bead') ? pointAt(geo.main, st.beadS) : null,
              aim: (() => {
                const fr = tangentFrame(geo.S, geo.start.u, geo.start.v);
                const len = 0.2 * geo.size;
                const c = Math.cos(geo.theta), s = Math.sin(geo.theta);
                return { from: fr.r, to: [fr.r[0] + (c * fr.e1[0] + s * fr.e2[0]) * len, fr.r[1] + (c * fr.e1[1] + s * fr.e2[1]) * len, fr.r[2] + (c * fr.e1[2] + s * fr.e2[2]) * len] };
              })(),
            },
          };
          st.lastView = V;
          st.markers = drawScene(p, V);
          const mode = get('colorBy');
          if (mode === 'K') drawLegend(p, pal, st.rect, 'Gaussian curvature K', e.kScale);
          else if (mode === 'H') drawLegend(p, pal, st.rect, 'mean curvature H', e.hScale);
          drawHud(p, pal, buildHud(geo), 12, 10, st.w - 24);
        } catch (err) {
          p.noStroke();
          p.fill('#ff6b6b');
          p.textAlign(p.LEFT, p.TOP);
          p.text(`error: ${err && err.message ? err.message : err}`, 12, 12);
          st.lastError = err;
        }
      };

      cleanups.push(ctx.globalSettings.subscribe(() => {
        pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
        st.dirty = true;
      }));
    };

    const instance = new ctx.p5(sketch, container);
    cleanups.push(store.subscribe(() => { st.dirty = true; }));
    cleanups.push(ctx.onResize(() => doResize()));

    // ---------- UI ----------
    const surfaceOptions = SURFACE_DEFS.map((d) => ({ value: d.id, label: d.label }));
    const paramNodes = SURFACE_DEFS.flatMap((d) => d.params.map((s) => ({
      type: 'slider', key: paramKey(d.id, s.key), label: s.label, min: s.min, max: s.max, step: s.step,
      format: (v) => fmt(v, 3), visibleIf: (store2) => store2.get('surface') === d.id,
    })));
    const schema = [
      {
        type: 'group', label: 'Surface', children: [
          { type: 'select', key: 'surface', label: 'surface', options: surfaceOptions },
          ...paramNodes,
          { type: 'slider', key: 'resolution', label: 'mesh resolution', min: 12, max: 120, step: 2 },
        ],
      },
      {
        type: 'group', label: 'Display', children: [
          { type: 'select', key: 'colorBy', label: 'colour by', options: COLOR_MODES },
          { type: 'select', key: 'render', label: 'render', options: RENDER_MODES },
          { type: 'toggle', key: 'paramLines', label: 'parameter lines (u, v)' },
          { type: 'toggle', key: 'axes', label: 'axes gizmo' },
          { type: 'toggle', key: 'orbitOnly', label: 'drag always orbits (click still picks A)' },
        ],
      },
      {
        type: 'group', label: 'Geodesic from A', children: [
          { type: 'slider', key: 'theta', label: 'direction (deg, in the tangent plane)', min: 0, max: 360, step: 0.5, format: (v) => `${fmt(v, 4)}` },
          { type: 'slider', key: 'length', label: 'length (x surface size)', min: 0.05, max: 12, step: 0.05, format: (v) => fmt(v, 3) },
          { type: 'toggle', key: 'fan', label: 'fan of geodesics (F)' },
          { type: 'slider', key: 'fanCount', label: 'fan size', min: 2, max: 48, step: 1, visibleIf: (s) => !!s.get('fan') },
          { type: 'toggle', key: 'bead', label: 'bead sliding along the geodesic (B)' },
          { type: 'slider', key: 'beadSpeed', label: 'bead speed', min: 0.1, max: 4, step: 0.1, format: (v) => `${fmt(v, 2)}x`, visibleIf: (s) => !!s.get('bead') },
        ],
      },
      {
        type: 'group', label: 'Shortest path A to B', children: [
          { type: 'toggle', key: 'target', label: 'show B and the geodesic distance (T)' },
          { type: 'info', text: 'Drag the blue B marker over the surface. Shooting finds geodesics from A to B and reports the shortest; near the cut locus or a conjugate point it says so.' },
        ],
      },
      {
        type: 'group', label: 'Parallel transport & holonomy', children: [
          { type: 'select', key: 'loop', label: 'closed loop', options: LOOPS },
          { type: 'slider', key: 'loopV', label: 'parallel position v', min: 0, max: 1, step: 0.005, format: (v) => `${Math.round(v * 100)}%`, visibleIf: (s) => s.get('loop') === 'parallel' },
          { type: 'slider', key: 'loopR', label: 'circle radius (chart)', min: 0.02, max: 0.4, step: 0.005, visibleIf: (s) => s.get('loop') === 'circle' },
          { type: 'slider', key: 'triAlpha', label: 'angle at A (deg)', min: 10, max: 170, step: 1, visibleIf: (s) => s.get('loop') === 'triangle' },
          { type: 'slider', key: 'triAB', label: 'side AB (x size)', min: 0.1, max: 2, step: 0.05, visibleIf: (s) => s.get('loop') === 'triangle' },
          { type: 'slider', key: 'triAC', label: 'side AC (x size)', min: 0.1, max: 2, step: 0.05, visibleIf: (s) => s.get('loop') === 'triangle' },
          { type: 'info', text: 'The white arrow is transported parallel around the loop; the red one is where it ends. The angle between them is the holonomy = integral of K over the enclosed region (mod 360 deg).' },
        ],
      },
      {
        type: 'group', label: 'Curvature overlays', children: [
          { type: 'toggle', key: 'curvLines', label: 'lines of curvature (blue k1, purple k2)' },
          { type: 'toggle', key: 'dupin', label: 'Dupin indicatrix at A' },
        ],
      },
    ];
    const panelUi = ctx.ui.build(schema, store, ctx.drawer);

    return {
      /** Introspection for tests and debugging. */
      debug() {
        const geo = geoNow();
        return {
          surface: get('surface'),
          S: geo.S,
          start: geo.start,
          point: geo.point,
          main: geo.main,
          fan: geo.fan,
          path: geo.path || null,
          loop: geo.loop || null,
          size: geo.size,
          cam: st.cam,
          rect: st.rect,
          drawCount: st.drawCount,
          meshCacheSize: st.meshes.size,
          meshKeys: [...st.meshes.map.keys()],
          lastError: st.lastError,
          beadS: st.beadS,
          markers: st.markers,
        };
      },
      /** Screen position of a chart point: { x, y, visible }. */
      screenOf(u, v) {
        const S = surfaceNow();
        entryNow();
        const r = S.eval(u, v).r;
        const q = st.cam.project(r, st.rect);
        const db = st.depth || depthForTest();
        const t = db.test(r);
        return { x: q.x, y: q.y, visible: q.visible && t.visible };
      },
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
        for (const c of cleanups.splice(0)) {
          try { c(); } catch { /* ignore */ }
        }
        try { panelUi.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
        st.meshes.clear();
        st.memo.clear();
        st.depth = null;
      },
    };

    function depthForTest() {
      const e = entryNow();
      return new DepthBuffer(e.mesh, st.cam, st.rect, 0.5);
    }
  },
};
