// Marching Squares & Cubes: contour lines and isosurfaces of scalar fields, with a cell inspector in
// 2D and a cube-case inspector, hole detector, slice plane and STL / OBJ export in 3D.

import { Viewport } from '../approx/view.js';
import { getPalette } from '../approx/palette.js';
import { OrbitCamera, prepareMesh } from '../../lib/render3d.js';
import { pickMesh } from '../../lib/render3d-pick.js';
import { CameraController } from '../shared3d/draw3d.js';
import { gridSample, marchingSquares } from '../../lib/marching.js';
import {
  squareCellInfo, cubeCaseGeometry, cubeCornerValues, locateCell, levelFromU, uFromLevel,
} from '../../lib/iso-inspect.js';
import { buildIsoMesh, sliceContour, clipMeshBelow, sampleGrid3, LRU } from '../../lib/iso-mesh.js';
import { openEdges } from '../../lib/mesh-topology.js';
import { meshToBinarySTL, meshToAsciiSTL, meshToOBJ } from '../../lib/mesh-export.js';
import {
  DEFAULTS, PRESETS, CATALOGUE_2D, CATALOGUE_3D, CUSTOM_MAX_RES3, resolveField, sampler, defaultU, validateExpression,
} from './state.js';
import {
  makeBackground, drawScene2D, drawInspector2D, strokeSegments, accentFor, wrapText, panel, MONO, INSIDE, OUTSIDE,
} from './draw2d.js';
import { drawScene3D, drawCaseWidget } from './draw3d.js';

const MODES = [{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }];
const MAX_TRIANGLES = 60000;
const SWEEP_RES_CAP = 48;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fmt = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : String(v));

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

/** Triggers a file download in the browser; returns false when there is no DOM (tests, SSR). */
function download(name, data, mime) {
  const doc = globalThis.document;
  const URLc = globalThis.URL;
  if (!doc || !URLc || !URLc.createObjectURL || typeof Blob === 'undefined') return false;
  const url = URLc.createObjectURL(new Blob([data], { type: mime }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URLc.revokeObjectURL(url), 4000);
  return true;
}

export default {
  id: 'iso',
  title: 'Marching Squares & Cubes',
  description: 'Contours and isosurfaces of scalar fields: inspect single cells, the 256 cube cases, cracks and slices.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings);
    const get = (k) => store.get(k);
    const cleanups = [];
    const st = {
      disposed: false,
      dirty: true,
      w: 800,
      h: 600,
      field2: null,
      field3: null,
      fieldKey: { 2: null, 3: null },
      keepLevel: false,
      writing: false,
      liveU: null,
      liveT: null,
      phase: 0,
      lastWrite: 0,
      // 2D
      view: new Viewport(-2, 2, -2, 2),
      sel2: null,
      hover: null,
      press: null,
      gridCache2: new LRU(4),
      contourCache: new LRU(24),
      bgCache: new LRU(3),
      // 3D
      cam: new OrbitCamera({ yaw: 0.8, pitch: 0.45 }),
      wcam: new OrbitCamera({ yaw: 0.9, pitch: 0.5 }),
      rect3: { x: 0, y: 0, w: 800, h: 600 },
      widgetRect: null,
      gridCache3: new LRU(3),
      meshCache: new LRU(6),
      sliceCache: new LRU(8),
      clipCache: new LRU(3),
      drawCache: {}, floorCache: {}, boxCache: {}, holeCache: {}, sliceDrawCache: {}, selCache: {},
      sel3: null,
      mesh3: null,
      meshKey: '',
      lastDrawn: null,
      drawCount: 0,
      notice: null,
    };
    let doResize = () => {};

    st.wcam.fitToBounds({ min: [0, 0, 0], max: [1, 1, 1] }, 1.3);

    // ---------- fields, levels, time ----------
    function syncField(dim) {
      const key = dim === 2 ? `${get('f2')}|${get('f2') === 'custom' ? get('expr2') : ''}` : `${get('f3')}|${get('f3') === 'custom' ? get('expr3') : ''}`;
      if (key === st.fieldKey[dim] && st[`field${dim}`]) return;
      const first = st.fieldKey[dim] === null;
      st.fieldKey[dim] = key;
      const fd = resolveField(dim, get);
      st[`field${dim}`] = fd;
      st.sel2 = dim === 2 ? null : st.sel2;
      st.sel3 = dim === 3 ? null : st.sel3;
      const lk = `lu${dim}`;
      if (get(lk) == null || (!first && !st.keepLevel)) withWrite(() => store.set(lk, defaultU(fd)));
      fitView(dim);
      st.dirty = true;
    }

    function withWrite(fn) {
      st.writing = true;
      try { fn(); } finally { st.writing = false; }
    }

    function fitView(dim) {
      if (dim === 2) {
        const b = st.field2.bounds;
        const r = st.view.rect;
        const pad = 0.06;
        const s = Math.min(r.w / ((b.xmax - b.xmin) * (1 + 2 * pad)), r.h / ((b.ymax - b.ymin) * (1 + 2 * pad)));
        const cx = (b.xmin + b.xmax) / 2, cy = (b.ymin + b.ymax) / 2;
        st.view.set(cx - r.w / (2 * s), cx + r.w / (2 * s), cy - r.h / (2 * s), cy + r.h / (2 * s));
      } else {
        const b = st.field3.bounds;
        st.cam.yaw = 0.8; st.cam.pitch = 0.45;
        st.cam.fitToBounds({ min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }, 1.1);
        st.cam.saveHome();
      }
    }

    const dimNow = () => (get('mode') === '3d' ? 3 : 2);
    const fieldNow = () => st[`field${dimNow()}`];
    const timeNow = () => Number((st.liveT ?? get('time')).toFixed(3));
    const uNow = (dim) => (st.liveU !== null && dimNow() === dim ? st.liveU : get(`lu${dim}`));
    const levelNow = (dim) => levelFromU(uNow(dim), st[`field${dim}`].range);

    syncField(2);
    syncField(3);

    // ---------- 2D scene ----------
    function grid2() {
      const fd = st.field2;
      const res = clamp(Math.round(get('res2')), 4, 200);
      const t = fd.timeDep ? timeNow() : 0;
      const ex = fd.bounds.xmax - fd.bounds.xmin, ey = fd.bounds.ymax - fd.bounds.ymin;
      const nx = res, ny = clamp(Math.round((res * ey) / ex), 2, 200);
      const key = `${fd.key}|${nx}x${ny}|${t}`;
      return { key, grid: st.gridCache2.getOrCreate(key, () => gridSample(sampler(fd, t), fd.bounds, nx, ny)), t };
    }

    function contours2(g, level) {
      const interp = !!get('interp'), dis = !!get('disamb');
      const mk = (L) => st.contourCache.getOrCreate(`${g.key}|${L}|${interp}|${dis}`, () => {
        const r = marchingSquares(g.grid, { level: L, interpolate: interp, disambiguate: dis });
        return { segs: r.segments, count: r.count, cases: r.cases };
      });
      const active = mk(level);
      const levelSegs = get('contour') === 'levels' ? st.field2.levels.map((L) => ({ level: L, ...mk(L) })) : [];
      return { active, levelSegs };
    }

    function scene2(pal) {
      const fd = st.field2;
      const g = grid2();
      const level = levelNow(2);
      const { active, levelSegs } = contours2(g, level);
      const bgOn = !!get('bg');
      const bg = bgOn
        ? st.bgCache.getOrCreate(`${g.key}|${level}|${pal.dark}`, () => makeBackground(ctx_p(), g.grid, level, pal.dark ? 190 : 170))
        : null;
      let selInfo = null;
      if (st.sel2) {
        selInfo = squareCellInfo(g.grid, st.sel2.i, st.sel2.j, level, { interpolate: !!get('interp'), disambiguate: !!get('disamb') });
        if (!selInfo) st.sel2 = null;
      }
      const hv = st.hover && st.hover.i < g.grid.nx && st.hover.j < g.grid.ny ? st.hover : null;
      return {
        pal, view: st.view, grid: g.grid, level, bg, levelSegs, activeSegs: active, f: sampler(fd, g.t), hover: hv, selInfo, key: g.key,
        opts: { lattice: !!get('lattice'), grad: !!get('grad'), showLevels: get('contour') === 'levels' },
      };
    }

    // p is only known inside the sketch closure
    let pRef = null;
    const ctx_p = () => pRef;

    // ---------- 3D scene ----------
    function mesh3() {
      const fd = st.field3;
      const sweeping = st.liveU !== null && dimNow() === 3;
      let res = clamp(Math.round(get('res3')), 8, 96);
      let capNote = null;
      if (fd.custom && res > CUSTOM_MAX_RES3) { res = CUSTOM_MAX_RES3; capNote = `custom expressions are capped at ${CUSTOM_MAX_RES3}`; }
      if (sweeping && res > SWEEP_RES_CAP) { res = SWEEP_RES_CAP; capNote = `sweep: resolution capped at ${SWEEP_RES_CAP}`; }
      const algo = get('algo') === 'classic' ? 'classic' : 'tetra';
      const level = levelNow(3);
      const interp = !!get('interp');
      const key = `${fd.key}|${res}|${algo}|${level}|${interp}`;
      let entry = st.meshCache.get(key);
      if (!entry) {
        const built = buildIsoMesh({
          fn: fd.f, bounds: fd.bounds, res, level, algorithm: algo, interpolate: interp, maxTriangles: MAX_TRIANGLES,
          getGrid: (r) => st.gridCache3.getOrCreate(`${fd.key}|${r}`, () => sampleGrid3(fd.f, fd.bounds, r)),
        });
        const holes = openEdges(built.mesh, built.grid.bounds);
        entry = st.meshCache.set(key, { ...built, key, level, algo, holes, prepared: prepareMesh(built.mesh), capNote });
      }
      entry.capNote = capNote;
      return entry;
    }

    function scene3(pal) {
      const fd = st.field3;
      const entry = mesh3();
      if (entry.key !== st.meshKey) {
        st.meshKey = entry.key;
        st.sel3 = null;
      }
      st.mesh3 = entry;
      const level = entry.level;
      const slice = { on: !!get('slice'), z: 0, edges3d: null };
      let prepared = entry.prepared;
      const zr = [entry.prepared.bounds.min[2], entry.prepared.bounds.max[2]];
      if (slice.on) {
        const b = fd.bounds;
        slice.z = b.zmin + clamp(get('sliceU'), 0, 1) * (b.zmax - b.zmin);
        slice.z = Number(slice.z.toFixed(5));
        const sres = clamp(Math.round(get('res3')) * 2, 40, 160);
        const skey = `${fd.key}|${slice.z}|${level}|${sres}|${!!get('interp')}|${!!get('disamb')}`;
        const sc = st.sliceCache.getOrCreate(skey, () => sliceContour(fd.f, b, slice.z, level, sres, { interpolate: !!get('interp'), disambiguate: !!get('disamb') }));
        slice.edges3d = sc.edges3d;
        slice.segments2d = sc.segments2d;
        slice.count = sc.count;
        if (get('sliceClip')) {
          prepared = st.clipCache.getOrCreate(`${entry.key}|${slice.z}`, () => prepareMesh(clipMeshBelow(entry.mesh, slice.z)));
        }
      }
      const caseIdx = clamp(Math.round(get('caseIdx')), 0, 255);
      const s3 = st.sel3;
      const gb = entry.grid.bounds;
      const real = !!s3 && entry.mesh.cases[s3.i + entry.grid.nx * (s3.j + entry.grid.ny * s3.k)] === caseIdx;
      let sel = null;
      if (real) {
        const dx = (gb.xmax - gb.xmin) / entry.grid.nx, dy = (gb.ymax - gb.ymin) / entry.grid.ny, dz = (gb.zmax - gb.zmin) / entry.grid.nz;
        sel = {
          box: { min: [gb.xmin + s3.i * dx, gb.ymin + s3.j * dy, gb.zmin + s3.k * dz], max: [gb.xmin + (s3.i + 1) * dx, gb.ymin + (s3.j + 1) * dy, gb.zmin + (s3.k + 1) * dz] },
          tri: s3.shownPrepared === prepared ? s3.tri : null,
        };
      }
      const geo = real
        ? cubeCaseGeometry(caseIdx, cubeCornerValues(entry.grid, s3.i, s3.j, s3.k), level)
        : cubeCaseGeometry(caseIdx);
      return {
        pal, cam: st.cam, rect: st.rect3, prepared, drawCache: st.drawCache, floorCache: st.floorCache, boxCache: st.boxCache,
        holeCache: st.holeCache, sliceCache: st.sliceDrawCache, selCache: st.selCache,
        opts: { render: get('render'), colorBy: get('colorBy'), box: !!get('box'), axes: !!get('axes'), floor: !!get('floor'), holes: !!get('holes') },
        bounds: fd.bounds, holeEdges: entry.holes.edges, slice, sel, zRange: zr,
        entry, level, geo, real, caseIdx,
        cellLabel: real ? `cell (${s3.i},${s3.j},${s3.k}) real samples` : 'generic case, edge midpoints',
      };
    }

    // ---------- picking ----------
    function pick3(mx, my) {
      const entry = st.mesh3;
      if (!entry || !st.lastDrawn) return;
      const prepared = st.lastDrawn.prepared;
      const ray = st.cam.ray(mx, my, st.rect3);
      const hit = prepared.triangleCount ? pickMesh(prepared, ray) : null;
      if (!hit) { st.sel3 = null; st.dirty = true; return; }
      const c = hit.triangle;
      const cx = prepared.centroids[c * 3], cy = prepared.centroids[c * 3 + 1], cz = prepared.centroids[c * 3 + 2];
      const cell = locateCell(entry.grid, cx, cy, cz, entry.mesh.cases);
      const cs = entry.mesh.cases[cell.i + entry.grid.nx * (cell.j + entry.grid.ny * cell.k)];
      st.sel3 = { ...cell, tri: c, shownPrepared: prepared, caseIdx: cs };
      withWrite(() => store.set('caseIdx', cs));
      st.dirty = true;
    }

    // ---------- export ----------
    function meshForExport() {
      const e = mesh3();
      st.mesh3 = e;
      return e && e.mesh.triangleCount ? { positions: e.mesh.positions, normals: e.mesh.normals, indices: e.mesh.indices } : null;
    }

    /** Serialises the current isosurface: 'stl' -> Uint8Array, 'stl-ascii' / 'obj' -> string, null when empty. */
    function exportMesh(format) {
      syncField(3);
      const m = meshForExport();
      if (!m) return null;
      const name = `${st.field3.id}`;
      if (format === 'obj') return meshToOBJ(m, { name });
      if (format === 'stl-ascii') return meshToAsciiSTL(m, name);
      return meshToBinarySTL(m);
    }

    function doExport(format) {
      const data = exportMesh(format);
      if (!data) { notify('nothing to export: the mesh is empty'); return; }
      const ext = format === 'obj' ? 'obj' : 'stl';
      const ok = download(`${st.field3.id}.${ext}`, data, format === 'obj' ? 'text/plain' : 'model/stl');
      notify(ok ? `exported ${st.field3.id}.${ext} (${st.mesh3.triangleCount} triangles)` : 'export is not available here');
    }

    function notify(text) {
      st.notice = { text, until: Date.now() + 4000 };
      st.dirty = true;
    }

    // ---------- presets ----------
    function applyPreset(id) {
      const pr = PRESETS.find((x) => x.id === id);
      if (!pr) return;
      const dim = pr.mode === '3d' ? 3 : 2;
      const fkey = dim === 2 ? 'f2' : 'f3';
      const probe = resolveField(dim, (k) => (k === fkey ? pr.field : get(k)));
      st.keepLevel = true;
      st.liveU = null;
      st.liveT = null;
      const set = (k, v) => store.set(k, v);
      set('mode', pr.mode);
      set(fkey, pr.field);
      set(`lu${dim}`, uFromLevel(pr.level, probe.range));
      set(dim === 2 ? 'res2' : 'res3', pr.res);
      set('interp', pr.interp !== false);
      set('disamb', pr.disamb !== false);
      set('sweep', !!pr.sweep);
      if (dim === 2) {
        set('animT', !!pr.animT);
        set('grad', !!pr.grad);
        set('contour', pr.contour || 'levels');
        set('bg', pr.bg !== false);
      } else {
        set('algo', pr.algo || 'tetra');
        set('colorBy', pr.colorBy || 'height');
        set('slice', !!pr.slice);
        set('render', 'flat');
      }
      set('presetId', id);
      st.keepLevel = false;
      syncField(dim);
      fitView(dim);
      st.dirty = true;
    }

    // ---------- p5 sketch ----------
    const sketch = (p) => {
      pRef = p;
      let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));

      const sizeNow = () => {
        const s = ctx.size();
        return { w: Math.max(260, s.width), h: Math.max(260, s.height) };
      };

      function layout(w, h) {
        st.w = w; st.h = h;
        const old = st.view;
        const r = old.rect;
        const s = r.w / (old.xmax - old.xmin);
        const cx = (old.xmin + old.xmax) / 2, cy = (old.ymin + old.ymax) / 2;
        old.setRect(0, 0, w, h);
        if (Number.isFinite(s) && s > 0) old.set(cx - w / (2 * s), cx + w / (2 * s), cy - h / (2 * s), cy + h / (2 * s));
        st.rect3 = { x: 0, y: 0, w, h };
        const ww = clamp(w * 0.3, 230, 300), wh = Math.round(ww * 0.95);
        st.widgetRect = w >= 420 && h >= wh + 60 ? { x: w - ww - 10, y: h - wh - 10, w: ww, h: wh } : null;
      }

      p.setup = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        st.view.setRect(0, 0, w, h);
        fitView(2);
        layout(w, h);
      };

      doResize = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        layout(w, h);
        st.dirty = true;
      };

      const markDirty = () => { st.dirty = true; };
      const mctl = new CameraController(p, st.cam, () => st.rect3, { onChange: markDirty, resetKey: null });
      const wctl = new CameraController(p, st.wcam, () => st.widgetRect || { x: -10, y: -10, w: 0, h: 0 }, { onChange: markDirty, resetKey: null });
      st.mctl = mctl; st.wctl = wctl;
      const inWidget = (x, y) => {
        const r = st.widgetRect;
        return !!get('showCase') && !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      };
      const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;

      function cellAt(mx, my) {
        const g = st.lastGrid2;
        if (!g || !st.view.contains(mx, my)) return null;
        const b = g.bounds;
        const i = Math.floor(((st.view.fromX(mx) - b.xmin) / (b.xmax - b.xmin)) * g.nx);
        const j = Math.floor(((st.view.fromY(my) - b.ymin) / (b.ymax - b.ymin)) * g.ny);
        return i >= 0 && j >= 0 && i < g.nx && j < g.ny ? { i, j } : null;
      }

      function pressStart(x, y) {
        st.press = { x, y, moved: false, widget: dimNow() === 3 && inWidget(x, y) };
      }
      function pressDrag(x, y, dx, dy) {
        const pr = st.press;
        if (!pr) return;
        if (Math.hypot(x - pr.x, y - pr.y) > 4) pr.moved = true;
        if (dimNow() === 2 && pr.moved) {
          st.view.panPx(dx, dy);
          st.dirty = true;
        }
      }
      function pressEnd(x, y, isShift) {
        const pr = st.press;
        st.press = null;
        if (!pr || pr.moved) return;
        if (dimNow() === 2) {
          const c = cellAt(x, y);
          st.sel2 = c && !(st.sel2 && st.sel2.i === c.i && st.sel2.j === c.j) ? c : null;
          st.dirty = true;
        } else if (!pr.widget && !isShift && st.rect3 && x >= 0 && y >= 0) {
          pick3(x, y);
        }
      }

      p.mousePressed = (e) => {
        if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) {
          if (dimNow() === 3 && onCanvas(e)) (inWidget(p.mouseX, p.mouseY) ? wctl : mctl).mousePressed(e);
          return;
        }
        pressStart(p.mouseX, p.mouseY);
        if (dimNow() === 3) (st.press.widget ? wctl : mctl).mousePressed(e);
      };
      p.mouseDragged = () => {
        pressDrag(p.mouseX, p.mouseY, p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
        if (dimNow() === 3) { mctl.mouseDragged(); wctl.mouseDragged(); }
      };
      p.mouseReleased = (e) => {
        if (dimNow() === 3) { mctl.mouseReleased(); wctl.mouseReleased(); }
        pressEnd(p.mouseX, p.mouseY, !!(e && e.shiftKey));
      };
      p.mouseMoved = (e) => {
        if (!onCanvas(e) || dimNow() !== 2) return;
        const c = cellAt(p.mouseX, p.mouseY);
        const same = (!c && !st.hover) || (c && st.hover && c.i === st.hover.i && c.j === st.hover.j);
        if (!same) { st.hover = c; st.dirty = true; }
      };
      p.doubleClicked = (e) => {
        if (!onCanvas(e)) return;
        if (dimNow() === 3) { if (inWidget(p.mouseX, p.mouseY)) wctl.doubleClicked(e); else mctl.doubleClicked(e); } else fitView(2);
        st.dirty = true;
      };

      p.mouseWheel = (e) => {
        if (!onCanvas(e)) return true;
        if (dimNow() === 3) {
          return inWidget(p.mouseX, p.mouseY) ? wctl.mouseWheel(e) : mctl.mouseWheel(e);
        }
        if (!st.view.contains(p.mouseX, p.mouseY)) return true;
        let d = (e && (e.delta !== undefined ? e.delta : e.deltaY)) || 0;
        if (e && e.deltaMode === 1) d *= 33; else if (e && e.deltaMode === 2) d *= 400;
        d = clamp(d, -300, 300);
        if (!d) return true;
        const v = st.view;
        const before = [v.xmin, v.xmax, v.ymin, v.ymax];
        v.zoomAt(p.mouseX, p.mouseY, Math.exp(d * 0.0012));
        const bw = st.field2.bounds.xmax - st.field2.bounds.xmin;
        const span = v.xmax - v.xmin;
        if (span < bw / 600 || span > bw * 12) v.set(...before);
        st.dirty = true;
        if (e && e.preventDefault) e.preventDefault();
        return false;
      };

      const touchPoint = () => {
        const t = (p.touches && p.touches[0]) || null;
        return t ? [t.x, t.y] : null;
      };
      p.touchStarted = (e) => {
        const pt = touchPoint();
        if (!pt || !onCanvas(e)) return true;
        st.touchLast = pt;
        pressStart(pt[0], pt[1]);
        if (dimNow() === 3) {
          st.touchCtl = st.press.widget ? wctl : mctl;
          return st.touchCtl.touchStarted(e);
        }
        return false;
      };
      p.touchMoved = () => {
        const pt = touchPoint();
        if (!pt || !st.press) return true;
        const last = st.touchLast || pt;
        pressDrag(pt[0], pt[1], pt[0] - last[0], pt[1] - last[1]);
        st.touchLast = pt;
        if (dimNow() === 3 && st.touchCtl) return st.touchCtl.touchMoved();
        return false;
      };
      p.touchEnded = () => {
        const last = st.touchLast;
        const ctl = st.touchCtl;
        st.touchCtl = null;
        if (dimNow() === 3 && ctl) ctl.touchEnded();
        if (last) pressEnd(last[0], last[1], false);
        st.touchLast = null;
        return false;
      };

      function typing(k) {
        const el = globalThis.document && globalThis.document.activeElement;
        if (!el) return false;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
        return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
      }

      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const k = p.key;
        if (typing(k)) return true;
        if (k === '1') store.set('mode', '2d');
        else if (k === '2') store.set('mode', '3d');
        else if (k === ' ') store.set('sweep', !get('sweep'));
        else if (k === 'f' || k === 'F' || k === 'r' || k === 'R') { fitView(dimNow()); st.dirty = true; } else if (p.keyCode === 27) { st.sel2 = null; st.sel3 = null; st.dirty = true; } else return true;
        return false;
      };

      // ---------- animation ----------
      function tick() {
        const dt = clamp((p.deltaTime || 16) / 1000, 0, 0.1);
        const speed = clamp(Number(get('sweepSpeed')) || 1, 0.1, 4);
        const dim = dimNow();
        const now = Date.now();
        const flush = (k, v) => { withWrite(() => store.set(k, v)); st.lastWrite = now; };
        if (get('sweep')) {
          if (st.liveU === null) st.phase = Math.acos(clamp(1 - 2 * get(`lu${dim}`), -1, 1));
          st.phase += dt * speed * 0.55;
          st.liveU = 0.5 - 0.5 * Math.cos(st.phase);
          if (now - st.lastWrite > 250) flush(`lu${dim}`, st.liveU);
          st.dirty = true;
        } else if (st.liveU !== null) {
          flush(`lu${dim}`, st.liveU);
          st.liveU = null;
          st.dirty = true;
        }
        if (dim === 2 && get('animT')) {
          st.liveT = (st.liveT ?? get('time')) + dt * speed;
          if (st.liveT > 40) st.liveT = 0;
          if (now - st.lastWrite > 250) flush('time', Number(st.liveT.toFixed(3)));
          st.dirty = true;
        } else if (st.liveT !== null) {
          flush('time', Number(st.liveT.toFixed(3)));
          st.liveT = null;
          st.dirty = true;
        }
        if (st.notice && Date.now() > st.notice.until) { st.notice = null; st.dirty = true; }
      }

      // ---------- draw ----------
      function hudText(lines, x, y, color) {
        p.textFont(MONO);
        p.textSize(11);
        p.textAlign(p.LEFT, p.TOP);
        p.noStroke();
        let yy = y;
        for (const l of lines) {
          if (!l) continue;
          p.fill(l.color || color);
          p.text(l.text !== undefined ? l.text : l, x, yy);
          yy += 14;
        }
      }

      function drawCaption(fieldId) {
        const pr = PRESETS.find((x) => x.id === get('presetId'));
        if (!pr || pr.field !== fieldId || pr.mode !== get('mode')) return;
        p.textFont(MONO);
        p.textSize(11);
        const maxW = Math.min(st.w - 40, 620);
        const lines = wrapText(p, pr.caption, maxW - 16);
        const h = lines.length * 14 + 10;
        const x = 10, y = st.h - h - 10;
        panel(p, pal, x, y, maxW, h);
        p.noStroke();
        p.fill(pal.fg);
        p.textAlign(p.LEFT, p.TOP);
        lines.forEach((l, n) => p.text(l, x + 8, y + 6 + n * 14));
      }

      function draw2D() {
        const S = scene2(pal);
        st.lastGrid2 = S.grid;
        drawScene2D(p, S);
        const fd = st.field2;
        const acc = accentFor(pal);
        const cellCount = S.grid.nx * S.grid.ny;
        const lines = [
          { text: `${fd.label}   level L = ${fmt(S.level)}`, color: acc },
          `${S.grid.nx} x ${S.grid.ny} = ${cellCount} cells, ${S.activeSegs.count} segments${fd.timeDep ? `, t = ${fmt(timeNow())}` : ''}`,
          fd.error ? { text: `expression error: ${fd.error}`, color: '#ff6b6b' } : null,
          { text: 'click a cell to inspect it - drag: pan - wheel: zoom - F: fit', color: pal.muted },
        ];
        hudText(lines, 12, 10, pal.fg);
        // legend
        const ly = 10 + lines.filter(Boolean).length * 14 + 10;
        p.stroke(pal.dark ? 20 : 250);
        p.strokeWeight(1);
        p.fill(INSIDE[0], INSIDE[1], INSIDE[2]);
        p.circle(18, ly, 9);
        p.fill(OUTSIDE[0], OUTSIDE[1], OUTSIDE[2], 200);
        p.circle(18, ly + 16, 9);
        p.noStroke();
        p.fill(pal.fg);
        p.textAlign(p.LEFT, p.CENTER);
        p.text('inside: f < L  (bit = 1)', 28, ly);
        p.text('outside: f >= L', 28, ly + 16);
        if (S.selInfo) drawInspector2D(p, S, { x: 0, y: 0, w: st.w, h: st.h });
        drawCaption(fd.id);
      }

      function sliceInset(S) {
        const sl = S.slice;
        if (!sl.on || !sl.segments2d) return;
        const size = clamp(st.w * 0.2, 130, 200);
        const x = st.w - size - 10, y = 10;
        const b = S.bounds;
        panel(p, pal, x, y, size, size + 18);
        const acc = accentFor(pal);
        p.textFont(MONO); p.textSize(10); p.noStroke(); p.fill(pal.muted); p.textAlign(p.LEFT, p.TOP);
        p.text(`z = ${fmt(sl.z)}: same contour in 2D`, x + 6, y + 4);
        const m = Math.max(b.xmax - b.xmin, b.ymax - b.ymin);
        const sc = (size - 16) / m;
        const ox = x + 8, oy = y + 18 + 8 + (b.ymax - b.ymin) * sc;
        const map = { toX: (v) => ox + (v - b.xmin) * sc, toY: (v) => oy - (v - b.ymin) * sc };
        p.noFill();
        p.stroke(pal.axis);
        p.strokeWeight(1);
        p.rect(map.toX(b.xmin), map.toY(b.ymax), (b.xmax - b.xmin) * sc, (b.ymax - b.ymin) * sc);
        p.stroke(acc[0], acc[1], acc[2]);
        p.strokeWeight(1.5);
        strokeSegments(p, map, sl.segments2d, sl.count);
      }

      function draw3D() {
        const S = scene3(pal);
        const list = drawScene3D(p, S);
        void list;
        st.lastDrawn = { prepared: S.prepared };
        sliceInset(S);
        const e = S.entry;
        const fd = st.field3;
        const acc = accentFor(pal);
        const g = e.grid;
        const h = e.holes;
        const lines = [
          { text: `${fd.label}   level L = ${fmt(S.level)}`, color: acc },
          `${e.algo === 'tetra' ? 'marching tetrahedra' : 'classic marching cubes'}: ${e.triangleCount} triangles, ${e.mesh.vertexCount} vertices, grid ${g.nx}x${g.ny}x${g.nz}`,
          e.limited ? { text: `resolution limited to ${e.res} (requested ${e.requested}) to keep <= ${MAX_TRIANGLES} triangles`, color: '#ffb84d' } : null,
          e.capNote ? { text: e.capNote, color: '#ffb84d' } : null,
          h.open > 0
            ? { text: `hole detector: ${h.open} open edge(s) = cracks (red)${h.domain ? `, ${h.domain} cut by the box` : ''}`, color: '#ff6b6b' }
            : { text: `hole detector: no cracks${h.domain ? ` (${h.domain} edges cut by the box)` : ''}`, color: '#5fd18b' },
          h.nonManifold ? { text: `${h.nonManifold} non-manifold edge(s)`, color: '#ffb84d' } : null,
          fd.error ? { text: `expression error: ${fd.error}`, color: '#ff6b6b' } : null,
          { text: 'drag: orbit - shift/right drag: pan - wheel: zoom - click: pick a cell', color: pal.muted },
        ];
        hudText(lines, 12, 10, pal.fg);
        if (get('showCase') && st.widgetRect) {
          drawCaseWidget(p, { rect: st.widgetRect, cam: st.wcam, pal, geo: S.geo, real: S.real, cellLabel: S.cellLabel });
        }
        drawCaption(fd.id);
      }

      p.draw = () => {
        if (st.disposed) return;
        tick();
        if (!st.dirty) return;
        st.dirty = false;
        st.drawCount++;
        syncField(2);
        syncField(3);
        p.background(pal.bg);
        try {
          if (dimNow() === 2) draw2D(); else draw3D();
          if (st.notice) hudText([{ text: st.notice.text, color: accentFor(pal) }], 12, st.h - 28 - (st.sel2 ? 0 : 0), pal.fg);
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
    cleanups.push(store.subscribe((key) => {
      st.dirty = true;
      if (key === 'f2' || key === 'expr2') syncField(2);
      else if (key === 'f3' || key === 'expr3') syncField(3);
      if (!st.writing && (key === 'lu2' || key === 'lu3')) st.liveU = null;
      if (!st.writing && key === 'time') st.liveT = null;
      if (!st.writing && key === 'mode') { st.liveU = null; }
      if (!st.writing && !st.keepLevel && (key === 'f2' || key === 'f3' || key === 'expr2' || key === 'expr3')) store.set('presetId', '');
    }));
    cleanups.push(ctx.onResize(() => doResize()));

    // ---------- UI ----------
    const levelFormat = (dim) => (u) => {
      const fd = st[`field${dim}`];
      return fd ? fmt(levelFromU(u, fd.range)) : String(u);
    };
    const opts2 = CATALOGUE_2D.map((f) => ({ value: f.id, label: f.label })).concat([{ value: 'custom', label: 'custom expression...' }]);
    const opts3 = CATALOGUE_3D.map((f) => ({ value: f.id, label: f.label })).concat([{ value: 'custom', label: 'custom expression...' }]);
    const is2 = (s) => s.get('mode') === '2d';
    const is3 = (s) => s.get('mode') === '3d';
    const schema = [
      {
        type: 'group', label: 'Presets', children: PRESETS.map((pr) => ({ type: 'button', label: pr.label, onClick: () => applyPreset(pr.id) })),
      },
      {
        type: 'group', label: 'Field', visibleIf: is2, children: [
          { type: 'select', key: 'f2', label: 'f(x, y)', options: opts2 },
          {
            type: 'text', key: 'expr2', label: 'expression of x, y, t', placeholder: 'sin(x) * cos(y) + 0.3 * sin(t)',
            visibleIf: (s) => s.get('f2') === 'custom', validate: (v) => validateExpression(v, 2),
          },
          { type: 'slider', key: 'time', label: 'time t', min: 0, max: 40, step: 0.01, format: fmt },
          { type: 'toggle', key: 'animT', label: 'animate t (drifting fields, expressions using t)' },
        ],
      },
      {
        type: 'group', label: 'Field', visibleIf: is3, children: [
          { type: 'select', key: 'f3', label: 'f(x, y, z)', options: opts3 },
          {
            type: 'text', key: 'expr3', label: 'expression of x, y, z', placeholder: 'x^2 + y^2 + z^2 - 1',
            visibleIf: (s) => s.get('f3') === 'custom', validate: (v) => validateExpression(v, 3),
          },
        ],
      },
      {
        type: 'group', label: 'Iso-level', children: [
          { type: 'slider', key: 'lu2', label: 'level L', min: 0, max: 1, step: 0.001, format: levelFormat(2), visibleIf: is2 },
          { type: 'slider', key: 'lu3', label: 'level L', min: 0, max: 1, step: 0.001, format: levelFormat(3), visibleIf: is3 },
          { type: 'toggle', key: 'sweep', label: 'sweep the level (space)' },
          { type: 'slider', key: 'sweepSpeed', label: 'sweep / time speed', min: 0.1, max: 4, step: 0.1, format: (v) => `${fmt(v)}x` },
        ],
      },
      {
        type: 'group', label: 'Marching squares', visibleIf: is2, children: [
          { type: 'slider', key: 'res2', label: 'grid resolution', min: 4, max: 200, step: 1 },
          {
            type: 'select', key: 'contour', label: 'contours', options: [
              { value: 'levels', label: 'field levels + active level' }, { value: 'single', label: 'active level only' }],
          },
          { type: 'toggle', key: 'bg', label: 'colour-mapped background' },
          { type: 'toggle', key: 'lattice', label: 'grid and +/- sample dots' },
          { type: 'toggle', key: 'interp', label: 'linear interpolation (off: midpoints)' },
          { type: 'toggle', key: 'disamb', label: 'saddle disambiguation (cases 5 / 10)' },
          { type: 'toggle', key: 'grad', label: 'gradient arrows' },
        ],
      },
      {
        type: 'group', label: 'Marching cubes', visibleIf: is3, children: [
          { type: 'slider', key: 'res3', label: 'grid resolution', min: 8, max: 96, step: 1 },
          { type: 'select', key: 'algo', label: 'algorithm', options: [{ value: 'tetra', label: 'marching tetrahedra (watertight)' }, { value: 'classic', label: 'classic 256-case table' }] },
          { type: 'toggle', key: 'interp', label: 'linear interpolation (off: midpoints)' },
          {
            type: 'select', key: 'render', label: 'render', options: [
              { value: 'flat', label: 'flat' }, { value: 'wire', label: 'wireframe' }, { value: 'both', label: 'flat + wire' }, { value: 'points', label: 'points' }],
          },
          { type: 'select', key: 'colorBy', label: 'colour by', options: [{ value: 'height', label: 'height' }, { value: 'normal', label: 'normal' }, { value: 'solid', label: 'solid' }] },
          { type: 'toggle', key: 'box', label: 'bounds box' },
          { type: 'toggle', key: 'axes', label: 'axes' },
          { type: 'toggle', key: 'floor', label: 'floor grid' },
          { type: 'toggle', key: 'holes', label: 'highlight open edges (red)' },
        ],
      },
      {
        type: 'group', label: 'Cube case inspector', visibleIf: is3, children: [
          { type: 'toggle', key: 'showCase', label: 'show widget' },
          { type: 'slider', key: 'caseIdx', label: 'case (0..255)', min: 0, max: 255, step: 1 },
          { type: 'info', text: 'Click the mesh to load the case of the cell under the cursor.' },
        ],
      },
      {
        type: 'group', label: 'Slice plane', visibleIf: is3, children: [
          { type: 'toggle', key: 'slice', label: 'slice plane z = c with 2D contour' },
          { type: 'slider', key: 'sliceU', label: 'plane height', min: 0, max: 1, step: 0.005, format: (v) => `${Math.round(v * 100)}%` },
          { type: 'toggle', key: 'sliceClip', label: 'clip the mesh above the plane' },
          { type: 'toggle', key: 'disamb', label: 'saddle disambiguation (2D contour)' },
        ],
      },
      {
        type: 'group', label: 'Export', visibleIf: is3, children: [
          { type: 'button', label: 'Export STL (binary)', onClick: () => doExport('stl') },
          { type: 'button', label: 'Export OBJ', onClick: () => doExport('obj') },
        ],
      },
      {
        type: 'info',
        text: '1 / 2: 2D / 3D - space: sweep the level - F: fit view - Esc: clear selection. '
          + 'Inside means f < L; the contour separates inside from outside samples.',
      },
    ];
    const modeTabs = ctx.ui.build([{ type: 'tabs', key: 'mode', options: MODES }], store, ctx.toolbar);
    const panelUi = ctx.ui.build(schema, store, ctx.drawer);

    return {
      /** Introspection for tests and debugging. */
      debug() {
        return {
          mode: get('mode'),
          meshKey: st.meshKey,
          gridKeys2: [...st.gridCache2.map.keys()],
          triangles: st.mesh3 ? st.mesh3.triangleCount : 0,
          holes: st.mesh3 ? st.mesh3.holes : null,
          res: st.mesh3 ? { used: st.mesh3.res, requested: st.mesh3.requested, limited: st.mesh3.limited } : null,
          sel2: st.sel2,
          sel3: st.sel3 ? { i: st.sel3.i, j: st.sel3.j, k: st.sel3.k, tri: st.sel3.tri, caseIdx: st.sel3.caseIdx } : null,
          view: st.view,
          cam: st.cam,
          rect3: st.rect3,
          widgetRect: st.widgetRect,
          level2: st.field2 ? levelNow(2) : null,
          level3: st.field3 ? levelNow(3) : null,
          drawCount: st.drawCount,
          lastError: st.lastError || null,
        };
      },
      exportMesh,
      applyPreset,
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
        for (const c of cleanups.splice(0)) {
          try { c(); } catch { /* ignore */ }
        }
        try { modeTabs.destroy(); } catch { /* ignore */ }
        try { panelUi.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
        for (const c of [st.gridCache2, st.contourCache, st.bgCache, st.gridCache3, st.meshCache, st.sliceCache, st.clipCache]) c.clear();
        st.mesh3 = null;
      },
    };
  },
};
