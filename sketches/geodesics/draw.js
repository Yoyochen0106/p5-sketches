// p5 drawing for the Surface Curvature & Geodesics sketch: hidden-line curves, arrows, markers,
// legend and the overlay layers. All drawing is clipped to the 3D view rect.
import { drawMesh, drawAxes } from '../shared3d/draw3d.js';
import { colormapLUT } from '../../lib/render3d.js';
import { fmt, deg } from './state.js';

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const COLORS = {
  main: [255, 150, 40],
  fan: [60, 200, 190],
  path: [90, 220, 120],
  alt: [150, 170, 120],
  tri: [255, 220, 70],
  transport: [255, 90, 200],
  start: [255, 255, 255],
  target: [90, 200, 255],
  k1: [60, 120, 255],
  k2: [190, 90, 255],
  dupin: [255, 255, 120],
  param: [200, 205, 215],
};

function withClip(p, rect, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.rect(rect.x, rect.y, rect.w, rect.h);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

const xyz = (q) => (Array.isArray(q) ? q : [q.x, q.y, q.z]);

/**
 * Draws a 3D polyline with hidden-line handling: runs in front of the surface are stroked normally, runs
 * behind it faintly and thinner. V = { cam, rect, db }. style: { color, alpha (0..255), weight, hidden (alpha factor) }.
 * Returns the number of vertices emitted.
 */
export function drawCurve(p, V, pts, style = {}) {
  const alpha = style.alpha === undefined ? 235 : style.alpha;
  const hidden = style.hidden === undefined ? 0.22 : style.hidden;
  const w = style.weight || 2;
  const c = style.color || COLORS.main;
  let run = [], runVisible = true, count = 0;
  const flush = () => {
    if (run.length > 1 && (runVisible || hidden > 0)) {
      p.noFill();
      p.stroke(c[0], c[1], c[2], runVisible ? alpha : alpha * hidden);
      p.strokeWeight(runVisible ? w : Math.max(1, w * 0.5));
      p.beginShape();
      for (const q of run) p.vertex(q[0], q[1]);
      p.endShape();
      count += run.length;
    }
    run = [];
  };
  withClip(p, V.rect, () => {
    for (const q of pts) {
      const t = V.db.test(xyz(q));
      if (!(Number.isFinite(t.x) && Number.isFinite(t.y))) { flush(); continue; }
      const pt = [t.x, t.y];
      if (run.length && t.visible !== runVisible) {
        run.push(pt); // share the joint so the two runs touch
        flush();
      }
      runVisible = t.visible;
      run.push(pt);
    }
    flush();
  });
  return count;
}

/** Screen-space arrow from 3D point a to b (shaft + head). Hidden arrows are faint. */
export function drawArrow(p, V, a, b, style = {}) {
  const ta = V.db.test(a), tb = V.db.test(b);
  if (!(Number.isFinite(ta.x) && Number.isFinite(tb.x))) return;
  const c = style.color || COLORS.main;
  const alpha = (style.alpha === undefined ? 240 : style.alpha) * (ta.visible ? 1 : 0.3);
  const dx = tb.x - ta.x, dy = tb.y - ta.y;
  const len = Math.hypot(dx, dy);
  withClip(p, V.rect, () => {
    p.stroke(c[0], c[1], c[2], alpha);
    p.strokeWeight(style.weight || 2.2);
    p.line(ta.x, ta.y, tb.x, tb.y);
    if (len > 3) {
      const hl = Math.min(style.head || 9, len * 0.5), ux = dx / len, uy = dy / len;
      p.line(tb.x, tb.y, tb.x - hl * (ux * 0.87 - uy * 0.5), tb.y - hl * (uy * 0.87 + ux * 0.5));
      p.line(tb.x, tb.y, tb.x - hl * (ux * 0.87 + uy * 0.5), tb.y - hl * (uy * 0.87 - ux * 0.5));
    }
  });
}

/** Round marker at a 3D point. Returns its screen position (or null when not drawable). */
export function drawMarker(p, V, pt, style = {}) {
  const t = V.db.test(xyz(pt));
  if (!(Number.isFinite(t.x) && Number.isFinite(t.y))) return null;
  const c = style.color || COLORS.start;
  withClip(p, V.rect, () => {
    p.stroke(10, 12, 16, 230);
    p.strokeWeight(1.5);
    p.fill(c[0], c[1], c[2], t.visible ? 255 : 90);
    p.circle(t.x, t.y, style.size || 11);
    if (style.label) {
      p.noStroke();
      p.fill(V.pal.fg);
      p.textFont(MONO);
      p.textSize(11);
      p.textAlign(p.LEFT, p.CENTER);
      p.text(style.label, t.x + 9, t.y - 9);
    }
  });
  return { x: t.x, y: t.y, visible: t.visible };
}

/** Legend colour bar for K or H, bottom-right of the rect. */
export function drawLegend(p, pal, rect, title, scale) {
  const lut = colormapLUT('coolwarm');
  const w = Math.min(190, rect.w * 0.3), h = 12;
  const x = rect.x + rect.w - w - 14, y = rect.y + rect.h - 42;
  p.push();
  p.noStroke();
  p.fill(pal.dark ? 20 : 250, 200);
  p.rect(x - 8, y - 20, w + 16, 58, 6);
  const n = 48;
  for (let i = 0; i < n; i++) {
    const k = Math.round((i / (n - 1)) * 255) * 3;
    p.fill(lut[k], lut[k + 1], lut[k + 2]);
    p.rect(x + (i * w) / n, y, w / n + 0.6, h);
  }
  p.fill(pal.fg);
  p.textFont(MONO);
  p.textSize(10);
  p.textAlign(p.LEFT, p.TOP);
  p.text(title, x, y - 15);
  p.text(fmt(-scale, 3), x, y + h + 3);
  p.textAlign(p.CENTER, p.TOP);
  p.text('0', x + w / 2, y + h + 3);
  p.textAlign(p.RIGHT, p.TOP);
  p.text(`+${fmt(scale, 3)}`, x + w, y + h + 3);
  p.pop();
}

/** HUD text block with a translucent backing panel. lines: string | { text, color } */
export function drawHud(p, pal, lines, x, y, maxW) {
  const L = lines.filter(Boolean);
  if (!L.length) return;
  p.push();
  p.textFont(MONO);
  p.textSize(11);
  let w = 0;
  for (const l of L) w = Math.max(w, p.textWidth(typeof l === 'string' ? l : l.text));
  w = Math.min(w, maxW || w);
  p.noStroke();
  p.fill(pal.dark ? 12 : 250, 175);
  p.rect(x - 6, y - 5, w + 12, L.length * 14 + 8, 6);
  p.textAlign(p.LEFT, p.TOP);
  L.forEach((l, i) => {
    p.fill(typeof l === 'string' ? pal.fg : l.color || pal.fg);
    p.text(typeof l === 'string' ? l : l.text, x, y + i * 14);
  });
  p.pop();
}

/**
 * Draws the whole scene. V: { pal, cam, rect, entry, db, drawCache, opts {colorBy, render, paramLines, axes},
 * geo: { start, startPt, main, fan, path, loop, curv, params, dupin, aim, target, bead } }.
 */
export function drawScene(p, V) {
  const { pal, cam, rect, entry, opts, geo } = V;
  const lines = {};
  const colorFn = opts.colorBy === 'K' ? entry.colorK : opts.colorBy === 'H' ? entry.colorH : undefined;
  drawMesh(p, entry.prepared, cam, rect, {
    mode: opts.render, cache: V.drawCache, colorBy: 'solid', colorFn, baseColor: [150, 175, 215],
    revision: `${opts.colorBy}`, wireColor: pal.dark ? [235, 240, 250, 90] : [20, 25, 35, 100], weight: 0.6, twoSided: true,
  });
  if (opts.paramLines && geo.params) {
    for (const pl of geo.params) drawCurve(p, V, pl, { color: COLORS.param, alpha: 90, weight: 1, hidden: 0 });
  }
  if (geo.curv) {
    for (const l of geo.curv) drawCurve(p, V, l.pts, { color: l.which === 1 ? COLORS.k1 : COLORS.k2, alpha: 220, weight: 1.6, hidden: 0 });
  }
  if (geo.fan) {
    for (const g of geo.fan) drawCurve(p, V, g.points, { color: COLORS.fan, alpha: 200, weight: 1.4, hidden: 0.15 });
  }
  if (geo.path) {
    geo.path.polylines.forEach((g, i) => drawCurve(p, V, g.points, i === 0
      ? { color: COLORS.path, alpha: 255, weight: 3, hidden: 0.3 }
      : { color: COLORS.alt, alpha: 190, weight: 1.6, hidden: 0.15 }));
  }
  if (geo.loop && geo.loop.path3d) {
    drawCurve(p, V, geo.loop.path3d, { color: COLORS.tri, alpha: 255, weight: 2.4, hidden: 0.3 });
    geo.loop.arrows.forEach((a, i) => {
      const b = [a.p[0] + a.v[0] * geo.loop.arrowLen, a.p[1] + a.v[1] * geo.loop.arrowLen, a.p[2] + a.v[2] * geo.loop.arrowLen];
      drawArrow(p, V, a.p, b, { color: i === 0 ? [255, 255, 255] : COLORS.transport, weight: i === 0 ? 2.6 : 1.8, head: 7 });
    });
    const last = geo.loop.arrows[geo.loop.arrows.length - 1];
    if (last) {
      const b = [last.p[0] + last.v[0] * geo.loop.arrowLen, last.p[1] + last.v[1] * geo.loop.arrowLen, last.p[2] + last.v[2] * geo.loop.arrowLen];
      drawArrow(p, V, last.p, b, { color: [255, 70, 70], weight: 2.8, head: 10 });
    }
  }
  if (geo.main) drawCurve(p, V, geo.main.points, { color: COLORS.main, alpha: 255, weight: 3, hidden: 0.3 });
  if (geo.dupin) for (const c of geo.dupin.curves) drawCurve(p, V, c, { color: COLORS.dupin, alpha: 255, weight: 1.8, hidden: 0 });
  if (geo.aim) drawArrow(p, V, geo.aim.from, geo.aim.to, { color: [255, 255, 255], weight: 2.6, head: 11 });
  if (geo.startPt) lines.start = drawMarker(p, V, geo.startPt, { color: COLORS.start, size: 11 });
  if (geo.target) lines.target = drawMarker(p, V, geo.target, { color: COLORS.target, size: 13, label: 'B' });
  if (geo.bead) drawMarker(p, V, geo.bead, { color: [255, 70, 70], size: 9 });
  if (opts.axes) drawAxes(p, cam, rect, {});
  return lines;
}

export { deg };
