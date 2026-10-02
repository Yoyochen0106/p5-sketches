// Tab 2: Green's theorem and the 2D divergence theorem on a draggable closed curve, the
// "cancellation of interior circulation" picture, and the path-independence (conservative) test.

import { Viewport } from '../approx/view.js';
import {
  circlePolygon, ellipsePolygon, rectPolygon, polygonOrientation, greenCheck, cellCancellation, pathIntegral2,
  bumpPath, classifyField2,
} from '../../lib/vectorcalc.js';
import {
  model2, parsePoly, formatPoly, clamp, fmt, rnd,
} from './state.js';
import {
  withClip, arrow, hud, drawAxes2D, drawLegend, updateScalarImage, drawBoundsImage, diverging, dist2,
} from './util.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createGreenTab(env) {
  const { p } = env;
  const vp = new Viewport(-3.2, 3.2, -2.4, 2.4);
  const st = {
    img: {}, drag: null, rectKey: '', t: 0, wheelAt: -1e9, stroke: null, result: null, resultKey: '', cells: null, cellsKey: '', pts: [],
    handles: [], lastPath: null,
  };

  function fitRect() {
    const r = env.rect();
    const key = `${r.w}x${r.h}`;
    if (key !== st.rectKey) { st.rectKey = key; vp.setRect(r.x, r.y, r.w, r.h).lockAspect(); } else vp.setRect(r.x, r.y, r.w, r.h);
  }
  const busy = () => !!st.drag || now() - st.wheelAt < 160;
  const bounds = () => ({ xmin: vp.xmin, xmax: vp.xmax, ymin: vp.ymin, ymax: vp.ymax });
  const rad = (d) => (d * Math.PI) / 180;

  /** The curve as a polygon in the requested orientation. */
  function curve() {
    const shape = env.get('gshape');
    const cx = env.get('gcx'), cy = env.get('gcy'), r = Math.max(0.05, env.get('gr')), b = clamp(env.get('gb'), 0.1, 4), rot = rad(env.get('grot'));
    let pts;
    if (shape === 'ellipse') pts = ellipsePolygon(cx, cy, r, r * b, rot, 72);
    else if (shape === 'rect') {
      const c = Math.cos(rot), s = Math.sin(rot);
      pts = rectPolygon(-r, -r * b, r, r * b, 6).map(([x, y]) => [cx + c * x - s * y, cy + s * x + c * y]);
    } else if (shape === 'poly') pts = parsePoly(env.get('gpoly'));
    else pts = circlePolygon(cx, cy, r, 72);
    if (pts.length < 3) pts = circlePolygon(cx, cy, r, 72);
    const want = env.get('gorient') === 'cw' ? -1 : 1;
    const o = polygonOrientation(pts);
    if (o !== 0 && o !== want) pts = pts.slice().reverse();
    return pts;
  }

  function handles(pts) {
    const shape = env.get('gshape');
    const cx = env.get('gcx'), cy = env.get('gcy'), r = Math.max(0.05, env.get('gr')), b = clamp(env.get('gb'), 0.1, 4), rot = rad(env.get('grot'));
    const hs = [];
    if (env.get('gmode') === 'path') {
      hs.push({ id: 'A', x: env.get('gax'), y: env.get('gay') }, { id: 'B', x: env.get('gbx'), y: env.get('gby') });
      return hs;
    }
    if (shape === 'poly') {
      const src = parsePoly(env.get('gpoly'));
      src.forEach((q, i) => hs.push({ id: `v${i}`, x: q[0], y: q[1], idx: i }));
      const mx = src.reduce((s, q) => s + q[0], 0) / Math.max(1, src.length), my = src.reduce((s, q) => s + q[1], 0) / Math.max(1, src.length);
      hs.push({ id: 'move', x: mx, y: my });
    } else {
      hs.push({ id: 'move', x: cx, y: cy });
      hs.push({ id: 'size', x: cx + r * Math.cos(rot), y: cy + r * Math.sin(rot) });
      if (shape !== 'circle') hs.push({ id: 'aspect', x: cx - r * b * Math.sin(rot), y: cy + r * b * Math.cos(rot) });
    }
    void pts;
    return hs;
  }

  function compute(m, pts) {
    const h = 10 ** env.get('stepExp');
    const key = `${m.key}|${pts.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(';')}|${h}`;
    if (key !== st.resultKey || !st.result) {
      st.result = greenCheck(m.field, pts, { h, depth: 2 });
      st.resultKey = key;
    }
    return st.result;
  }

  function computeCells(m, pts) {
    const n = Math.round(env.get('gcells'));
    if (n < 1) return null;
    const key = `${m.key}|${n}|${pts.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(';')}`;
    if (key !== st.cellsKey) { st.cells = cellCancellation(m.field.f, pts, n); st.cellsKey = key; }
    return st.cells;
  }

  // ---- drawing ----
  function drawCurve(pal, pts, res) {
    const sx = pts.map((q) => vp.toX(q[0])), sy = pts.map((q) => vp.toY(q[1]));
    p.fill(pal.dark ? [90, 160, 255, 40] : [40, 90, 220, 40]);
    p.stroke(pal.dark ? [120, 190, 255] : [20, 80, 200]);
    p.strokeWeight(2.5);
    p.beginShape();
    for (let i = 0; i < sx.length; i++) p.vertex(sx[i], sy[i]);
    p.endShape(p.CLOSE);
    // orientation chevrons (circulation direction) and outward normal ticks (flux)
    const o = res ? res.orientation : 1;
    let acc = 0;
    const step = 46;
    for (let i = 0; i < sx.length; i++) {
      const j = (i + 1) % sx.length;
      const dx = sx[j] - sx[i], dy = sy[j] - sy[i], d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      let pos = step - acc;
      while (pos <= d) {
        const mx = sx[i] + (dx * pos) / d, my = sy[i] + (dy * pos) / d, ux = dx / d, uy = dy / d;
        p.stroke(pal.dark ? [255, 190, 80] : [200, 110, 0]); p.fill(pal.dark ? [255, 190, 80] : [200, 110, 0]); p.strokeWeight(1.6);
        arrow(p, mx - ux * 6, my - uy * 6, mx + ux * 6, my + uy * 6, 7);
        const nx = -uy * o, ny = ux * o; // right of the travel direction = outward for CCW (screen y points down)
        p.stroke(pal.dark ? [90, 235, 200] : [0, 140, 110]); p.fill(pal.dark ? [90, 235, 200] : [0, 140, 110]); p.strokeWeight(1.4);
        arrow(p, mx, my, mx + nx * 13, my + ny * 13, 5);
        pos += step;
      }
      acc = (acc + d) % step;
    }
  }

  function drawCells(pal, cells) {
    if (!cells) return;
    const fade = env.get('gcancel') ? 0.5 + 0.5 * Math.cos((2 * Math.PI * st.t) / 3.6) : 1;
    const interiorAlpha = 40 + 215 * fade;
    let maxC = 1e-12;
    for (const c of cells.cells) maxC = Math.max(maxC, Math.abs(c.circ));
    const key = new Set(cells.cells.map((c) => `${c.i},${c.j}`));
    const has = (i, j) => key.has(`${i},${j}`);
    const col = pal.dark ? [255, 190, 80] : [200, 110, 0];
    for (const c of cells.cells) {
      const x0 = vp.toX(c.x0), x1 = vp.toX(c.x1), y0 = vp.toY(c.y1), y1 = vp.toY(c.y0);
      const dc = diverging(c.circ / maxC, pal.dark);
      p.noStroke(); p.fill(dc[0], dc[1], dc[2], 110);
      p.rect(x0, y0, x1 - x0, y1 - y0);
      p.stroke(pal.grid); p.noFill(); p.strokeWeight(1);
      p.rect(x0, y0, x1 - x0, y1 - y0);
      // CCW arrows on the four edges (screen: bottom edge left -> right etc.), faded when shared with a neighbour
      const edges = [
        [x0, y1, x1, y1, !has(c.i, c.j - 1)], [x1, y1, x1, y0, !has(c.i + 1, c.j)],
        [x1, y0, x0, y0, !has(c.i, c.j + 1)], [x0, y0, x0, y1, !has(c.i - 1, c.j)],
      ];
      for (const [ax, ay, bx, by, exposed] of edges) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
        if (d < 6) continue;
        const ux = dx / d, uy = dy / d;
        const alpha = exposed ? 255 : interiorAlpha;
        p.stroke(col[0], col[1], col[2], alpha); p.fill(col[0], col[1], col[2], alpha); p.strokeWeight(exposed ? 2 : 1.2);
        const L = Math.min(d * 0.28, 9);
        arrow(p, mx - ux * L, my - uy * L, mx + ux * L, my + uy * L, Math.min(6, d * 0.2));
      }
    }
    // exposed (staircase) boundary
    p.stroke(pal.accent); p.strokeWeight(2.2); p.noFill();
    for (const e of cells.exposed) p.line(vp.toX(e.x0), vp.toY(e.y0), vp.toX(e.x1), vp.toY(e.y1));
  }

  function drawFieldArrows(m, pal) {
    const r = env.rect();
    const n = 20, cell = r.w / n;
    const ny = Math.floor(r.h / cell);
    let maxM = 1e-12;
    const items = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < n; i++) {
        const sx = r.x + (i + 0.5) * cell, sy = r.y + (j + 0.5) * cell + (r.h - ny * cell) / 2;
        const v = m.field.f(vp.fromX(sx), vp.fromY(sy));
        const mag = Math.hypot(v[0], v[1]);
        if (!Number.isFinite(mag)) continue;
        maxM = Math.max(maxM, mag); items.push([sx, sy, v[0], v[1], mag]);
      }
    }
    const mags = items.map((q) => q[4]).sort((a, b) => a - b);
    const ref = Math.max(1e-12, mags[Math.floor(0.9 * (mags.length - 1))] || maxM);
    p.strokeWeight(1);
    p.stroke(pal.dark ? [200, 210, 225, 110] : [40, 50, 70, 120]); p.fill(pal.dark ? [200, 210, 225, 110] : [40, 50, 70, 120]);
    for (const [sx, sy, fx, fy, mag] of items) {
      if (!(mag > 1e-12)) continue;
      const len = Math.min(cell * 1.3, (cell * 0.7 * mag) / ref);
      arrow(p, sx - (fx / mag) * len / 2, sy + (fy / mag) * len / 2, sx + (fx / mag) * len / 2, sy - (fy / mag) * len / 2, 5);
    }
  }

  const tone = (diff, scale, pal) => (Math.abs(diff) <= 1e-3 * Math.max(1, scale) ? (pal.dark ? '#7ee787' : '#1a7f37') : '#ffb84d');

  function theoremHud(pal, res, cells, m) {
    const sc = Math.max(Math.abs(res.circulation), Math.abs(res.curlIntegral), Math.abs(res.flux), Math.abs(res.divIntegral));
    const lines = [
      { text: `${m.label}    curve: ${env.get('gshape')}, ${res.orientation > 0 ? 'counter-clockwise' : 'clockwise'}, area ${fmt(res.area)}, length ${fmt(res.perimeter)}`, color: pal.accent },
      { text: 'Green:          closed integral F.dr = double integral of curl F dA  (CCW; sign flips for CW)', color: pal.muted },
      `circulation  = ${fmt(res.circulation, 6)}`,
      `curl integral = ${fmt(res.curlIntegral, 6)}      difference ${fmt(res.circulationError, 2)}`,
      { text: 'Divergence:   closed integral F.n dl = double integral of div F dA', color: pal.muted },
      `outward flux = ${fmt(res.flux, 6)}`,
      `div integral = ${fmt(res.divIntegral, 6)}      difference ${fmt(res.fluxError, 2)}`,
    ];
    lines[3] = { text: lines[3], color: tone(res.circulationError, sc, pal) };
    lines[6] = { text: lines[6], color: tone(res.fluxError, sc, pal) };
    if (cells) {
      lines.push({ text: `cells ${cells.n} x ${cells.n}: sum of ${cells.cells.length} cell circulations = ${fmt(cells.sumCells, 6)}`, color: pal.dark ? '#ffd27a' : '#a35a00' });
      lines.push({ text: `circulation along the staircase boundary only = ${fmt(cells.boundaryCirc, 6)}   (shared edges cancelled: difference ${fmt(cells.sumCells - cells.boundaryCirc, 2)})`, color: pal.dark ? '#ffd27a' : '#a35a00' });
    }
    lines.push({ text: 'drag the shape handles - draw a new polygon freehand with shape = free polygon - wheel zooms', color: pal.muted });
    hud(p, pal, lines, 10, 10, Math.min(720, env.rect().w - 20));
  }

  function drawPathMode(pal, m) {
    const h = 10 ** env.get('stepExp');
    const A = [env.get('gax'), env.get('gay')], B = [env.get('gbx'), env.get('gby')];
    const bulge = env.get('gbulge');
    const p1 = [A, B], p2 = bumpPath(A, B, bulge, 48);
    const i1 = pathIntegral2(m.field.f, p1), i2 = pathIntegral2(m.field.f, p2);
    const loop = p1.concat(p2.slice(1, -1).reverse());
    const gc = loop.length >= 3 ? greenCheck(m.field, loop, { h }) : null;
    const loopCirc = i1 - i2; // closed loop A -> B along path 1, back along path 2
    const reg = classifyField2(m.field, bounds(), 13, 1e-3);
    if (gc) {
      p.fill(pal.dark ? [255, 255, 255, 18] : [0, 0, 0, 16]); p.noStroke();
      p.beginShape();
      for (const q of loop) p.vertex(vp.toX(q[0]), vp.toY(q[1]));
      p.endShape(p.CLOSE);
    }
    p.noFill(); p.strokeWeight(2.5);
    p.stroke(pal.dark ? [110, 190, 255] : [20, 90, 200]);
    p.line(vp.toX(A[0]), vp.toY(A[1]), vp.toX(B[0]), vp.toY(B[1]));
    p.stroke(pal.dark ? [255, 170, 80] : [200, 100, 0]);
    p.beginShape();
    for (const q of p2) p.vertex(vp.toX(q[0]), vp.toY(q[1]));
    p.endShape();
    for (const [pt, label] of [[A, 'A'], [B, 'B']]) {
      p.stroke(pal.bg); p.strokeWeight(2); p.fill(pal.accent); p.circle(vp.toX(pt[0]), vp.toY(pt[1]), 13);
      p.noStroke(); p.fill(pal.fg); p.textSize(13); p.textAlign(p.LEFT, p.BOTTOM); p.text(label, vp.toX(pt[0]) + 9, vp.toY(pt[1]) - 6);
    }
    const sc = Math.max(Math.abs(i1), Math.abs(i2), 1e-9);
    const indep = Math.abs(i1 - i2) <= 1e-3 * Math.max(1, sc);
    const lines = [
      { text: `${m.label}: is the line integral path independent?`, color: pal.accent },
      { text: `straight path A to B:  integral F.dr = ${fmt(i1, 6)}`, color: pal.dark ? '#8cc8ff' : '#1a5fc0' },
      { text: `curved path (bulge ${fmt(bulge, 2)}):  integral F.dr = ${fmt(i2, 6)}`, color: pal.dark ? '#ffb070' : '#b05a00' },
      { text: `difference = circulation around the loop = ${fmt(loopCirc, 3)}${gc ? `   (Green: double integral of curl over the loop = ${fmt(gc.curlIntegral, 3)})` : ''}`, color: indep ? (pal.dark ? '#7ee787' : '#1a7f37') : '#ffb84d' },
      { text: indep ? 'Same value: consistent with a conservative field (curl F = 0 in the region).' : 'Different values: F is NOT conservative here, so no scalar potential exists.', color: indep ? (pal.dark ? '#7ee787' : '#1a7f37') : '#ffb84d' },
      { text: `max |curl F| in view = ${fmt(reg.maxCurl, 3)}  ->  ${reg.curlFree ? 'curl-free' : 'rotational'} view`, color: pal.muted },
      { text: 'drag A and B; the bulge slider bends the second path', color: pal.muted },
    ];
    hud(p, pal, lines, 10, 10, Math.min(760, env.rect().w - 20));
    st.lastPath = { i1, i2, loopCirc };
  }

  function draw(dt) {
    const pal = env.pal();
    fitRect();
    st.t += dt;
    const m = model2(env.get);
    const h = 10 ** env.get('stepExp');
    const r = env.rect();
    p.background(pal.bg);
    const mode = env.get('gcolor');
    const F = m.field;
    withClip(p, r, () => {
      if (mode === 'curl' || mode === 'div') {
        updateScalarImage(p, st.img, {
          rect: r, bounds: bounds(), key: `${m.key}|${mode}|${h}`, valueAt: (x, y) => (mode === 'curl' ? F.curl(x, y, h) : F.div(x, y, h)),
          signed: true, dark: pal.dark, busy: busy(), retry: env.retry,
        });
        drawBoundsImage(p, st.img, vp, 150);
      } else st.img.img = null;
    });
    drawAxes2D(p, pal, vp, { grid: mode === 'none' });
    withClip(p, r, () => {
      drawFieldArrows(m, pal);
      if (env.get('gmode') === 'path') {
        drawPathMode(pal, m);
        return;
      }
      let pts = curve();
      if (st.stroke && st.stroke.length) {
        p.noFill(); p.stroke(pal.accent); p.strokeWeight(2);
        p.beginShape();
        for (const q of st.stroke) p.vertex(vp.toX(q[0]), vp.toY(q[1]));
        p.endShape();
        pts = null;
      }
      if (pts) {
        st.pts = pts;
        const res = compute(m, pts);
        const cells = env.get('gshowCells') ? computeCells(m, pts) : null;
        drawCells(pal, cells);
        drawCurve(pal, pts, res);
        theoremHud(pal, res, cells, m);
      }
    });
    // handles above everything
    const hs = handles(st.pts);
    st.handles = hs;
    withClip(p, r, () => {
      for (const hd of hs) {
        p.stroke(pal.bg); p.strokeWeight(2);
        p.fill(hd.id === 'move' ? pal.accent : hd.id === 'size' || hd.id === 'aspect' ? [255, 200, 70] : pal.fg);
        p.circle(vp.toX(hd.x), vp.toY(hd.y), hd.id === 'move' ? 12 : 10);
      }
    });
    const ci = st.img;
    if (ci.img && env.get('gmode') !== 'path') drawLegend(p, pal, r, mode === 'div' ? 'div F' : 'curl F', ci.scale, true);
  }

  function hit(x, y) {
    let best = null, bd = 14;
    for (const hd of st.handles) {
      const d = dist2(x, y, vp.toX(hd.x), vp.toY(hd.y));
      if (d < bd) { bd = d; best = hd; }
    }
    return best;
  }

  function applyHandle(hd, wx, wy) {
    const shape = env.get('gshape');
    if (env.get('gmode') === 'path') {
      if (hd.id === 'A') { env.commit('gax', rnd(wx, 3)); env.commit('gay', rnd(wy, 3)); } else { env.commit('gbx', rnd(wx, 3)); env.commit('gby', rnd(wy, 3)); }
      return;
    }
    if (shape === 'poly') {
      const pts = parsePoly(env.get('gpoly'));
      if (hd.id === 'move') {
        const mx = pts.reduce((s, q) => s + q[0], 0) / pts.length, my = pts.reduce((s, q) => s + q[1], 0) / pts.length;
        env.commit('gpoly', formatPoly(pts.map((q) => [q[0] + wx - mx, q[1] + wy - my])));
      } else if (pts[hd.idx]) { pts[hd.idx] = [wx, wy]; env.commit('gpoly', formatPoly(pts)); }
      return;
    }
    const cx = env.get('gcx'), cy = env.get('gcy'), rot = rad(env.get('grot')), r = Math.max(0.05, env.get('gr'));
    if (hd.id === 'move') { env.commit('gcx', rnd(wx, 3)); env.commit('gcy', rnd(wy, 3)); } else if (hd.id === 'size') {
      const d = Math.hypot(wx - cx, wy - cy);
      env.commit('gr', rnd(clamp(d, 0.1, 6), 3));
      if (shape !== 'circle') env.commit('grot', rnd(((Math.atan2(wy - cy, wx - cx) * 180) / Math.PI + 360) % 360, 1));
    } else if (hd.id === 'aspect') {
      const ux = -Math.sin(rot), uy = Math.cos(rot);
      const proj = (wx - cx) * ux + (wy - cy) * uy;
      env.commit('gb', rnd(clamp(Math.abs(proj) / r, 0.1, 4), 3));
    }
  }

  return {
    draw,
    wantsFrames: () => env.get('gmode') !== 'path' && !!env.get('gcancel') && env.get('gshowCells') && env.get('gcells') > 0,
    press(x, y) {
      fitRect();
      const hd = hit(x, y);
      if (hd) { st.drag = { mode: 'handle', hd, x, y, moved: false }; return true; }
      if (env.get('gmode') !== 'path' && env.get('gshape') === 'poly') {
        st.stroke = [[vp.fromX(x), vp.fromY(y)]];
        st.drag = { mode: 'draw', x, y, moved: false };
        return true;
      }
      st.drag = { mode: 'pan', x, y, moved: false };
      return true;
    },
    drag(x, y) {
      const d = st.drag;
      if (!d) return false;
      if (dist2(x, y, d.x, d.y) > 3) d.moved = true;
      if (d.mode === 'handle') applyHandle(d.hd, vp.fromX(x), vp.fromY(y));
      else if (d.mode === 'draw') {
        const last = st.stroke[st.stroke.length - 1];
        if (dist2(vp.toX(last[0]), vp.toY(last[1]), x, y) > 7 && st.stroke.length < 400) st.stroke.push([vp.fromX(x), vp.fromY(y)]);
      } else { vp.panPx(x - d.x, y - d.y); d.x = x; d.y = y; }
      return true;
    },
    release() {
      const d = st.drag;
      st.drag = null;
      if (d && d.mode === 'draw') {
        let s = st.stroke || [];
        st.stroke = null;
        if (s.length >= 3) {
          const stride = Math.ceil(s.length / 48);
          s = s.filter((_, i) => i % stride === 0);
          if (s.length >= 3) env.commit('gpoly', formatPoly(s));
        }
      }
      env.flush();
    },
    wheel(x, y, delta) {
      if (!vp.contains(x, y)) return false;
      vp.zoomAt(x, y, Math.exp(clamp(delta, -300, 300) * 0.0012));
      st.wheelAt = now();
      return true;
    },
    reset() { vp.set(-3.2, 3.2, -2.4, 2.4); vp.lockAspect(); },
    debug: () => ({
      vp, result: st.result, cells: st.cells, handles: st.handles, pts: st.pts, path: st.lastPath,
      handlePx: (id) => { const hd = st.handles.find((q) => q.id === id); return hd ? [vp.toX(hd.x), vp.toY(hd.y)] : null; },
    }),
  };
}
