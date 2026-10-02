// Tab 3: 3D vector field. Arrow glyph cloud, RK4 streamlines, slice-plane colour maps of div / |curl| / |F|,
// a draggable closed surface (divergence theorem) and a closed loop with a spanning disc or spherical
// cap (Stokes), all drawn with the software 3D renderer (lib/render3d.js + shared3d/draw3d.js).

import { OrbitCamera } from '../../lib/render3d.js';
import { CameraController, drawBoundsBox, drawAxes, drawEdges } from '../shared3d/draw3d.js';
import {
  streamline3, divergenceTheorem3, stokes3, circleLoop3, spanningSurfacePoint,
} from '../../lib/vectorcalc.js';
import { model3, clamp, fmt, rnd } from './state.js';
import { hud, sequential, diverging, robustScale, dist2 } from './util.js';

const B = 3; // half-size of the viewing cube
const BOUNDS = { min: [-B, -B, -B], max: [B, B, B] };

/** Wireframe segments (6 floats each) of a closed surface. */
export function surfaceWire(kind, c, size) {
  const segs = [];
  const seg = (a, b) => segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const poly = (pts, closed) => { for (let i = 0; i + 1 < pts.length; i++) seg(pts[i], pts[i + 1]); if (closed) seg(pts[pts.length - 1], pts[0]); };
  if (kind === 'sphere') {
    const R = size.R;
    for (let m = 0; m < 12; m++) {
      const ph = (m * Math.PI) / 6;
      poly(Array.from({ length: 33 }, (_, i) => { const t = (i * Math.PI) / 32; return [c[0] + R * Math.sin(t) * Math.cos(ph), c[1] + R * Math.sin(t) * Math.sin(ph), c[2] + R * Math.cos(t)]; }), false);
    }
    for (let k = 1; k < 8; k++) {
      const t = (k * Math.PI) / 8;
      poly(Array.from({ length: 48 }, (_, i) => { const ph = (i * 2 * Math.PI) / 48; return [c[0] + R * Math.sin(t) * Math.cos(ph), c[1] + R * Math.sin(t) * Math.sin(ph), c[2] + R * Math.cos(t)]; }), true);
    }
  } else if (kind === 'cube') {
    const a = size.a;
    for (let ax = 0; ax < 3; ax++) {
      const t1 = (ax + 1) % 3, t2 = (ax + 2) % 3;
      for (const sg of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          const f = k / 2;
          for (const dir of [t1, t2]) {
            const other = dir === t1 ? t2 : t1;
            const p0 = [0, 0, 0], p1 = [0, 0, 0];
            p0[ax] = p1[ax] = sg * a; p0[other] = p1[other] = f * a; p0[dir] = -a; p1[dir] = a;
            seg([c[0] + p0[0], c[1] + p0[1], c[2] + p0[2]], [c[0] + p1[0], c[1] + p1[1], c[2] + p1[2]]);
          }
        }
      }
    }
  } else {
    const { R, H } = size;
    for (const z of [-H, -H / 2, 0, H / 2, H]) poly(Array.from({ length: 40 }, (_, i) => { const ph = (i * 2 * Math.PI) / 40; return [c[0] + R * Math.cos(ph), c[1] + R * Math.sin(ph), c[2] + z]; }), true);
    for (let m = 0; m < 16; m++) {
      const ph = (m * Math.PI) / 8;
      seg([c[0] + R * Math.cos(ph), c[1] + R * Math.sin(ph), c[2] - H], [c[0] + R * Math.cos(ph), c[1] + R * Math.sin(ph), c[2] + H]);
      if (m % 2 === 0) for (const z of [-H, H]) seg([c[0], c[1], c[2] + z], [c[0] + R * Math.cos(ph), c[1] + R * Math.sin(ph), c[2] + z]);
    }
  }
  return Float32Array.from(segs);
}

/** Sample points + outward unit normals on a closed surface (for the flux dots). */
export function surfaceSamples(kind, c, size) {
  const out = [];
  if (kind === 'sphere') {
    for (let a = 1; a < 7; a++) {
      const t = (a * Math.PI) / 7, m = Math.max(4, Math.round(10 * Math.sin(t)));
      for (let b = 0; b < m; b++) {
        const ph = ((b + 0.5) * 2 * Math.PI) / m, n = [Math.sin(t) * Math.cos(ph), Math.sin(t) * Math.sin(ph), Math.cos(t)];
        out.push({ p: [c[0] + size.R * n[0], c[1] + size.R * n[1], c[2] + size.R * n[2]], n });
      }
    }
  } else if (kind === 'cube') {
    for (let ax = 0; ax < 3; ax++) {
      for (const sg of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const q = [c[0], c[1], c[2]], n = [0, 0, 0];
            q[ax] += sg * size.a; q[(ax + 1) % 3] += size.a * (i - 1) * 0.66; q[(ax + 2) % 3] += size.a * (j - 1) * 0.66; n[ax] = sg;
            out.push({ p: q, n });
          }
        }
      }
    }
  } else {
    for (let b = 0; b < 12; b++) {
      const ph = ((b + 0.5) * 2 * Math.PI) / 12, n = [Math.cos(ph), Math.sin(ph), 0];
      for (const f of [-0.6, 0, 0.6]) out.push({ p: [c[0] + size.R * n[0], c[1] + size.R * n[1], c[2] + f * size.H], n });
    }
    for (const sg of [-1, 1]) {
      out.push({ p: [c[0], c[1], c[2] + sg * size.H], n: [0, 0, sg] });
      for (let b = 0; b < 6; b++) { const ph = (b * Math.PI) / 3; out.push({ p: [c[0] + 0.6 * size.R * Math.cos(ph), c[1] + 0.6 * size.R * Math.sin(ph), c[2] + sg * size.H], n: [0, 0, sg] }); }
    }
  }
  return out;
}

const SLICE_N = 26;

export function createField3Tab(env) {
  const { p } = env;
  const cam = new OrbitCamera({ yaw: 0.85, pitch: 0.45 });
  cam.fitToBounds(BOUNDS, 1.0);
  cam.saveHome();
  const st = {
    rect: { x: 0, y: 0, w: 800, h: 600 }, streams: null, streamKey: '', slice: null, sliceKey: '', drag: null, result: null, resultKey: '',
    stokes: null, stokesKey: '', handles: [], edgeCache: {}, info: null,
  };
  const ctl = new CameraController(p, cam, () => st.rect, { onChange: () => env.dirty(), resetKey: null });

  const surfSize = () => {
    const s = clamp(env.get('ssize'), 0.2, 2.6), kind = env.get('surf');
    return kind === 'sphere' ? { R: s } : kind === 'cube' ? { a: s } : { R: s * 0.8, H: s };
  };
  const surfC = () => [env.get('sx'), env.get('sy'), env.get('sz')];
  const loopC = () => [env.get('lcx'), env.get('lcy'), env.get('lcz')];
  const loopN = () => {
    const th = (env.get('lnth') * Math.PI) / 180, ph = (env.get('lnph') * Math.PI) / 180;
    return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  };

  function computeSurface(m) {
    const kind = env.get('surf'), c = surfC(), size = surfSize();
    const key = `${m.key}|${kind}|${c.join()}|${JSON.stringify(size)}`;
    if (key !== st.resultKey || !st.result) { st.result = divergenceTheorem3(m.field, kind, c, size, 14); st.resultKey = key; }
    return st.result;
  }
  function computeStokes(m) {
    const c = loopC(), n = loopN(), r = clamp(env.get('lr'), 0.2, 2.5), h = env.get('lh');
    const key = `${m.key}|${c.join()}|${n.join()}|${r}|${h}`;
    if (key !== st.stokesKey || !st.stokes) { st.stokes = stokes3(m.field, c, n, r, h, 14); st.stokesKey = key; }
    return st.stokes;
  }

  function updateStreams(m) {
    const count = Math.round(env.get('seeds3'));
    const key = `${m.key}|${count}`;
    if (key === st.streamKey && st.streams) return;
    const segs = [];
    const F = (x, y, z) => { const v = m.field.f(x, y, z); return [v[0], v[1], v[2]]; };
    for (let i = 0; i < count; i++) {
      // deterministic quasi-random seeds (golden-ratio sequence) inside the cube
      const sx = ((i * 0.7548776662 + 0.1) % 1) * 2 - 1, sy = ((i * 0.5698402909 + 0.3) % 1) * 2 - 1, sz = ((i * 0.6180339887 + 0.7) % 1) * 2 - 1;
      const x0 = sx * 2.4, y0 = sy * 2.4, z0 = sz * 2.4;
      for (const dir of [1, -1]) {
        const s = streamline3(F, x0, y0, z0, { h: 0.1, maxSteps: 70, dir, bounds: BOUNDS });
        for (let k = 0; k + 1 < s.count; k++) segs.push(s.pts[3 * k], s.pts[3 * k + 1], s.pts[3 * k + 2], s.pts[3 * k + 3], s.pts[3 * k + 4], s.pts[3 * k + 5]);
      }
    }
    st.streams = Float32Array.from(segs); st.streamKey = key;
  }

  function updateSlice(m) {
    const mode = env.get('slice');
    const z = env.get('sliceZ');
    const key = `${m.key}|${mode}|${z}`;
    if (key === st.sliceKey && st.slice) return;
    st.sliceKey = key;
    if (mode === 'none') { st.slice = null; return; }
    const vals = new Float32Array((SLICE_N + 1) ** 2);
    for (let j = 0; j <= SLICE_N; j++) {
      for (let i = 0; i <= SLICE_N; i++) {
        const x = -B + (2 * B * i) / SLICE_N, y = -B + (2 * B * j) / SLICE_N;
        let v;
        if (mode === 'div') v = m.field.div(x, y, z);
        else if (mode === 'curl') v = Math.hypot(...m.field.curl(x, y, z));
        else v = Math.hypot(...m.field.f(x, y, z));
        vals[j * (SLICE_N + 1) + i] = Number.isFinite(v) ? v : 0;
      }
    }
    const signed = mode === 'div';
    let scale = robustScale(vals, 0.97);
    const e = 10 ** Math.floor(Math.log10(scale));
    scale = [1, 2, 5, 10].find((s) => s * e >= scale) * e;
    st.slice = { vals, scale, signed, mode, z };
  }

  const proj = (pt) => cam.project(pt, st.rect);
  const fade = (depth) => clamp(1 - 0.6 * ((depth - (cam.distance - 6)) / 12), 0.25, 1);

  function drawSlice(pal) {
    const s = st.slice;
    if (!s) return;
    const N = SLICE_N, W = N + 1;
    p.noStroke();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v = (s.vals[j * W + i] + s.vals[j * W + i + 1] + s.vals[(j + 1) * W + i] + s.vals[(j + 1) * W + i + 1]) / 4;
        const c = s.signed ? diverging(v / s.scale, pal.dark) : sequential(v / s.scale);
        const x0 = -B + (2 * B * i) / N, x1 = -B + (2 * B * (i + 1)) / N, y0 = -B + (2 * B * j) / N, y1 = -B + (2 * B * (j + 1)) / N;
        const a = proj([x0, y0, s.z]), b = proj([x1, y0, s.z]), cc = proj([x1, y1, s.z]), d = proj([x0, y1, s.z]);
        if (!(a.visible && b.visible && cc.visible && d.visible)) continue;
        p.fill(c[0], c[1], c[2], 150);
        p.quad(a.x, a.y, b.x, b.y, cc.x, cc.y, d.x, d.y);
      }
    }
  }

  function drawGlyphs(m, pal) {
    const n = clamp(Math.round(env.get('glyphN')), 3, 10);
    const norm = !!env.get('normalize3');
    const items = [];
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = -2.5 + (5 * i) / (n - 1), y = -2.5 + (5 * j) / (n - 1), z = -2.5 + (5 * k) / (n - 1);
          const v = m.field.f(x, y, z), mag = Math.hypot(v[0], v[1], v[2]);
          if (Number.isFinite(mag) && mag > 1e-12) items.push([x, y, z, v[0], v[1], v[2], mag]);
        }
      }
    }
    if (!items.length) return;
    const mags = items.map((q) => q[6]).sort((a, b) => a - b);
    const ref = Math.max(1e-12, mags[Math.floor(0.9 * (mags.length - 1))]);
    const maxM = mags[mags.length - 1];
    const cell = 5 / (n - 1);
    p.strokeWeight(1.4);
    for (const [x, y, z, fx, fy, fz, mag] of items) {
      const len = norm ? cell * 0.7 : Math.min(cell * 1.4, (cell * 0.7 * mag) / ref);
      const k = len / mag;
      const a = proj([x - fx * k / 2, y - fy * k / 2, z - fz * k / 2]), b = proj([x + fx * k / 2, y + fy * k / 2, z + fz * k / 2]);
      if (!a.visible || !b.visible) continue;
      const col = sequential(clamp(mag / (maxM > ref * 3 ? ref * 2 : maxM), 0, 1)), al = 255 * fade(a.depth);
      p.stroke(col[0], col[1], col[2], al);
      p.line(a.x, a.y, b.x, b.y);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 3) {
        const ux = dx / d, uy = dy / d, hs = Math.min(6, d * 0.4);
        p.line(b.x, b.y, b.x - ux * hs - uy * hs * 0.45, b.y - uy * hs + ux * hs * 0.45);
        p.line(b.x, b.y, b.x - ux * hs + uy * hs * 0.45, b.y - uy * hs - ux * hs * 0.45);
      }
    }
    void pal;
  }

  function drawFluxDots(m, pal, res) {
    const kind = env.get('surf');
    const samples = surfaceSamples(kind, surfC(), surfSize());
    let ref = 1e-12;
    const vals = samples.map((s) => { const v = m.field.f(s.p[0], s.p[1], s.p[2]); const d = Number.isFinite(v[0] + v[1] + v[2]) ? v[0] * s.n[0] + v[1] * s.n[1] + v[2] * s.n[2] : 0; ref = Math.max(ref, Math.abs(d)); return d; });
    p.noStroke();
    samples.forEach((s, i) => {
      const q = proj(s.p);
      if (!q.visible) return;
      const c = diverging(vals[i] / ref, pal.dark);
      p.fill(c[0], c[1], c[2], 240);
      p.circle(q.x, q.y, 3 + 5 * Math.abs(vals[i] / ref));
    });
    void res;
  }

  function loopGeometry() {
    const c = loopC(), n = loopN(), r = clamp(env.get('lr'), 0.2, 2.5), h = env.get('lh');
    const segs = [];
    const seg = (a, b) => segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    const surf = [];
    const NR = 5, NM = 12, steps = 14;
    for (let ri = 1; ri <= NR; ri++) {
      const s = ri / NR;
      let prev = null;
      for (let t = 0; t <= 40; t++) { const q = spanningSurfacePoint(c, n, r, h, s, (t * 2 * Math.PI) / 40).p; if (prev) seg(prev, q); prev = q; }
    }
    for (let mi = 0; mi < NM; mi++) {
      let prev = null;
      for (let t = 0; t <= steps; t++) { const q = spanningSurfacePoint(c, n, r, h, t / steps, (mi * 2 * Math.PI) / NM).p; if (prev) seg(prev, q); prev = q; }
    }
    for (const s of [0.4, 0.8]) for (let mi = 0; mi < 6; mi++) surf.push(spanningSurfacePoint(c, n, r, h, s, (mi * 2 * Math.PI) / 6 + s));
    const loop = circleLoop3(c, n, r, 64);
    const ring = [];
    for (let i = 0; i < loop.length; i++) ring.push(...loop[i], ...loop[(i + 1) % loop.length]);
    return { surfWire: Float32Array.from(segs), ring: Float32Array.from(ring), samples: surf, loop, c, n, r, h };
  }

  function drawHud(pal, m, surf, stokes) {
    const lines = [{ text: `${m.label}`, color: pal.accent }];
    if (m.error) lines.push({ text: `expression error: ${m.error}`, color: '#ff6b6b' });
    lines.push({ text: m.caption, color: pal.muted });
    const diffTone = (d, a, b) => (Math.abs(d) <= 1e-3 * Math.max(1, Math.abs(a), Math.abs(b)) ? (pal.dark ? '#7ee787' : '#1a7f37') : '#ffb84d');
    if (env.get('showSurf') && surf) {
      lines.push({ text: `Divergence theorem on the ${env.get('surf')} (volume ${fmt(surf.volume, 4)}, area ${fmt(surf.area, 4)})`, color: pal.dark ? '#ff9b9b' : '#b02a2a' });
      lines.push({ text: `outward flux = ${fmt(surf.flux, 6)}    triple integral of div F = ${fmt(surf.divIntegral, 6)}    difference ${fmt(surf.error, 2)}`, color: diffTone(surf.error, surf.flux, surf.divIntegral) });
      if (Math.abs(surf.error) > 1e-3 * Math.max(1, Math.abs(surf.flux))) lines.push({ text: 'mismatch: F is singular inside the surface (div F carries a delta function there, e.g. a point charge: flux = 4 pi)', color: '#ffb84d' });
    }
    if (env.get('showLoop') && stokes) {
      const hh = env.get('lh');
      lines.push({ text: `Stokes on the loop (spanning ${Math.abs(hh) < 1e-9 ? 'flat disc' : 'spherical cap, height ' + fmt(hh, 3)}, radius ${fmt(env.get('lr'), 3)})`, color: pal.dark ? '#ffd27a' : '#a35a00' });
      lines.push({ text: `circulation = ${fmt(stokes.circulation, 6)}    flux of curl F through the surface = ${fmt(stokes.curlFlux, 6)}    difference ${fmt(stokes.error, 2)}`, color: diffTone(stokes.error, stokes.circulation, stokes.curlFlux) });
      if (Math.abs(stokes.error) > 1e-3 * Math.max(1, Math.abs(stokes.circulation))) lines.push({ text: 'mismatch: curl F is singular on the surface (a current threads the loop, as in Ampere\'s law)', color: '#ffb84d' });
    }
    const s = st.slice;
    if (s) lines.push({ text: `slice z = ${fmt(s.z, 3)}: ${s.mode === 'div' ? 'div F' : s.mode === 'curl' ? '|curl F|' : '|F|'}, scale ${s.signed ? '+/-' : '0..'}${fmt(s.scale, 2)}`, color: pal.muted });
    lines.push({ text: 'drag: orbit - shift/right drag: pan - wheel: zoom - drag the round handles to move the surface (red) and the loop (gold) - R resets', color: pal.muted });
    hud(p, pal, lines, 10, 10, Math.min(820, st.rect.w - 20));
  }

  function draw() {
    const pal = env.pal();
    st.rect = env.rect();
    const m = model3(env.get);
    const r = st.rect;
    p.background(pal.bg);
    updateSlice(m);
    drawSlice(pal);
    drawBoundsBox(p, BOUNDS, cam, r, { stroke: pal.dark ? [90, 98, 112, 160] : [120, 126, 138, 160], weight: 1, cache: st.edgeCache.box || (st.edgeCache.box = {}) });
    if (env.get('showStream3')) {
      updateStreams(m);
      drawEdges(p, st.streams, cam, r, { stroke: pal.dark ? [110, 180, 255, 120] : [20, 90, 190, 140], weight: 1.1, cache: st.edgeCache.stream || (st.edgeCache.stream = {}) });
    }
    drawGlyphs(m, pal);
    let surf = null, stokes = null;
    const hs = [];
    if (env.get('showSurf')) {
      surf = computeSurface(m);
      drawEdges(p, surfaceWire(env.get('surf'), surfC(), surfSize()), cam, r, { stroke: pal.dark ? [255, 120, 120, 200] : [190, 40, 40, 210], weight: 1.2, cache: st.edgeCache.surf || (st.edgeCache.surf = {}) });
      drawFluxDots(m, pal, surf);
      hs.push({ id: 'surf', p: surfC(), color: [255, 110, 110] });
    }
    if (env.get('showLoop')) {
      stokes = computeStokes(m);
      const g = loopGeometry();
      drawEdges(p, g.surfWire, cam, r, { stroke: pal.dark ? [255, 210, 110, 90] : [190, 120, 0, 110], weight: 1, cache: st.edgeCache.cap || (st.edgeCache.cap = {}) });
      drawEdges(p, g.ring, cam, r, { stroke: pal.dark ? [255, 210, 110, 255] : [180, 100, 0, 255], weight: 2.6, cache: st.edgeCache.ring || (st.edgeCache.ring = {}) });
      // curl vectors on the spanning surface and loop direction markers
      p.strokeWeight(1.6);
      for (const s of g.samples) {
        const cv = m.field.curl(s.p[0], s.p[1], s.p[2]);
        const mag = Math.hypot(...cv);
        if (!(mag > 1e-9) || !Number.isFinite(mag)) continue;
        const k = Math.min(0.7, mag * 0.25) / mag;
        const a = proj(s.p), b = proj([s.p[0] + cv[0] * k, s.p[1] + cv[1] * k, s.p[2] + cv[2] * k]);
        if (!a.visible || !b.visible) continue;
        p.stroke(pal.dark ? [255, 150, 230] : [170, 30, 130]); p.line(a.x, a.y, b.x, b.y);
        p.noStroke(); p.fill(pal.dark ? [255, 150, 230] : [170, 30, 130]); p.circle(b.x, b.y, 4);
      }
      for (let i = 0; i < 4; i++) {
        const k = Math.floor((i * g.loop.length) / 4), a = proj(g.loop[k]), b = proj(g.loop[(k + 2) % g.loop.length]);
        if (!a.visible || !b.visible) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        p.stroke(pal.dark ? [255, 230, 150] : [140, 80, 0]); p.strokeWeight(2); p.fill(pal.dark ? [255, 230, 150] : [140, 80, 0]);
        p.triangle(b.x, b.y, b.x - (dx / d) * 9 - (dy / d) * 4, b.y - (dy / d) * 9 + (dx / d) * 4, b.x - (dx / d) * 9 + (dy / d) * 4, b.y - (dy / d) * 9 - (dx / d) * 4);
      }
      hs.push({ id: 'loop', p: loopC(), color: [255, 205, 90] });
    }
    st.handles = hs.map((hd) => ({ ...hd, s: proj(hd.p) }));
    p.stroke(pal.bg); p.strokeWeight(2);
    for (const hd of st.handles) { if (!hd.s.visible) continue; p.fill(hd.color); p.circle(hd.s.x, hd.s.y, 13); }
    drawAxes(p, cam, r);
    drawHud(pal, m, surf, stokes);
  }

  function dragPoint(x, y, hd) {
    // intersect the mouse ray with the plane through the handle, facing the camera
    const ray = cam.ray(x, y, st.rect), n = cam.frame().fwd;
    const den = ray.dir[0] * n[0] + ray.dir[1] * n[1] + ray.dir[2] * n[2];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((hd.p[0] - ray.origin[0]) * n[0] + (hd.p[1] - ray.origin[1]) * n[1] + (hd.p[2] - ray.origin[2]) * n[2]) / den;
    if (!(t > 0)) return null;
    return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t].map((v) => clamp(v, -B, B));
  }

  return {
    draw,
    wantsFrames: () => false,
    ctl,
    cam,
    pressHandle(x, y) {
      st.rect = env.rect();
      for (const hd of st.handles) {
        if (hd.s.visible && dist2(x, y, hd.s.x, hd.s.y) < 14) { st.drag = { hd }; return true; }
      }
      return false;
    },
    press(x, y, e) {
      if (this.pressHandle(x, y)) return true;
      return ctl.mousePressed(e);
    },
    drag(x, y) {
      if (st.drag) {
        const q = dragPoint(x, y, st.drag.hd);
        if (q) {
          const keys = st.drag.hd.id === 'surf' ? ['sx', 'sy', 'sz'] : ['lcx', 'lcy', 'lcz'];
          q.forEach((v, i) => env.commit(keys[i], rnd(v, 2)));
          st.drag.hd.p = q;
        }
        return true;
      }
      return ctl.mouseDragged();
    },
    release() {
      if (st.drag) { st.drag = null; env.flush(); return; }
      ctl.mouseReleased();
    },
    wheel(x, y, delta, e) {
      return ctl.mouseWheel(e) === false;
    },
    reset() { ctl.reset(); },
    debug: () => ({ cam, result: st.result, stokes: st.stokes, handles: st.handles, slice: st.slice }),
  };
}
