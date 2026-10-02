// Gauss tab: a draggable closed Gaussian surface (circle / rectangle / free polygon), the flux of E through it by
// quadrature compared with Q_enclosed / eps0, local flux density arrows and a flux-vs-time strip chart.
// Convention: 2D (line charge) law, E = lambda r / (2 pi eps0 r^2); flux per unit length equals Q_enc / eps0 exactly.

import {
  circleFlux, polygonFlux, circlePolygon, rectPolygon, pointInPolygon, boundarySamples,
} from '../../lib/em/electrostatics.js';
import { fmt, clamp, hudBox, drawCharge, finite } from './draw.js';

const HIST = 360;

export function ensureGauss(S) {
  if (S.gauss) return S.gauss;
  const v = S.view;
  const cx = (v.xmin + v.xmax) / 2, cy = (v.ymin + v.ymax) / 2, w = v.xmax - v.xmin;
  S.gauss = {
    ver: 0,
    circle: { cx, cy, r: w * 0.16 },
    rect: { x0: cx - w * 0.17, y0: cy - w * 0.1, x1: cx + w * 0.17, y1: cy + w * 0.1 },
    poly: { pts: [{ x: cx - w * 0.15, y: cy - w * 0.1 }, { x: cx + w * 0.15, y: cy - w * 0.12 }, { x: cx + w * 0.1, y: cy + w * 0.14 }, { x: cx - w * 0.05, y: cy + w * 0.06 }, { x: cx - w * 0.16, y: cy + w * 0.13 }] },
    hist: { flux: [], q: [], key: '' },
    result: null, resultKey: '',
    drag: null, armDraw: false, freehand: null,
  };
  return S.gauss;
}

/** Closed polygon of the current surface (for rect / poly; a fine polygon for the circle). */
export function surfacePolygon(S, n = 160) {
  const g = ensureGauss(S);
  const kind = S.get('gauss.kind');
  if (kind === 'circle') return circlePolygon(g.circle.cx, g.circle.cy, g.circle.r, n);
  if (kind === 'rect') return rectPolygon(g.rect.x0, g.rect.y0, g.rect.x1, g.rect.y1);
  return g.poly.pts;
}

/** Flux, enclosed charge and enclosed indices of the current surface (cached). */
export function gaussResult(S) {
  const g = ensureGauss(S);
  const kind = S.get('gauss.kind');
  const key = `${kind}|${g.ver}|${S.chVer}|${S.get('soft')}`;
  if (g.resultKey === key) return g.result;
  let r;
  if (kind === 'circle') r = circleFlux(S.charges, g.circle.cx, g.circle.cy, g.circle.r, '2d', 0);
  else if (kind === 'poly' && g.poly.pts.length < 3) r = { flux: 0, enclosed: 0, enclosedIdx: [] };
  else r = polygonFlux(S.charges, surfacePolygon(S), '2d', 0);
  g.result = r;
  g.resultKey = key;
  return r;
}

function inside(S, wx, wy) {
  const g = ensureGauss(S);
  const kind = S.get('gauss.kind');
  if (kind === 'circle') return Math.hypot(wx - g.circle.cx, wy - g.circle.cy) < g.circle.r;
  if (kind === 'rect') return wx > Math.min(g.rect.x0, g.rect.x1) && wx < Math.max(g.rect.x0, g.rect.x1) && wy > Math.min(g.rect.y0, g.rect.y1) && wy < Math.max(g.rect.y0, g.rect.y1);
  return g.poly.pts.length >= 3 && pointInPolygon(g.poly.pts, wx, wy);
}

/** Hit test the surface handles then its interior. Returns a drag descriptor or null. */
export function gaussHit(S, px, py) {
  const g = ensureGauss(S);
  const { view } = S;
  const kind = S.get('gauss.kind');
  const near = (x, y) => Math.hypot(view.toX(x) - px, view.toY(y) - py) < 11;
  if (g.armDraw && kind === 'poly') return { t: 'draw' };
  if (kind === 'circle' && near(g.circle.cx + g.circle.r, g.circle.cy)) return { t: 'radius' };
  if (kind === 'rect') {
    const c = [[g.rect.x0, g.rect.y0], [g.rect.x1, g.rect.y0], [g.rect.x1, g.rect.y1], [g.rect.x0, g.rect.y1]];
    for (let i = 0; i < 4; i++) if (near(c[i][0], c[i][1])) return { t: 'corner', idx: i };
  }
  if (kind === 'poly') {
    for (let i = 0; i < g.poly.pts.length; i++) if (near(g.poly.pts[i].x, g.poly.pts[i].y)) return { t: 'vertex', idx: i };
  }
  const wx = view.fromX(px), wy = view.fromY(py);
  if (inside(S, wx, wy) && (kind !== 'poly' || true)) return { t: 'move', last: [wx, wy] };
  return null;
}

export function gaussPress(S, px, py) {
  const g = ensureGauss(S);
  const d = gaussHit(S, px, py);
  if (!d) return false;
  g.drag = d;
  if (d.t === 'draw') {
    g.freehand = [{ x: S.view.fromX(px), y: S.view.fromY(py) }];
    g.poly.pts = g.freehand;
    g.ver++;
  }
  return true;
}

export function gaussDrag(S, px, py) {
  const g = ensureGauss(S);
  const d = g.drag;
  if (!d) return false;
  const { view } = S;
  const wx = view.fromX(px), wy = view.fromY(py);
  if (d.t === 'radius') g.circle.r = Math.max(0.05, Math.hypot(wx - g.circle.cx, wy - g.circle.cy));
  else if (d.t === 'corner') {
    const r = g.rect;
    if (d.idx === 0) { r.x0 = wx; r.y0 = wy; } else if (d.idx === 1) { r.x1 = wx; r.y0 = wy; } else if (d.idx === 2) { r.x1 = wx; r.y1 = wy; } else { r.x0 = wx; r.y1 = wy; }
  } else if (d.t === 'vertex') {
    g.poly.pts[d.idx] = { x: wx, y: wy };
  } else if (d.t === 'draw') {
    const last = g.freehand[g.freehand.length - 1];
    if (Math.hypot(view.toX(last.x) - px, view.toY(last.y) - py) > 10 && g.freehand.length < 120) g.freehand.push({ x: wx, y: wy });
  } else if (d.t === 'move') {
    const dx = wx - d.last[0], dy = wy - d.last[1];
    d.last = [wx, wy];
    const kind = S.get('gauss.kind');
    if (kind === 'circle') { g.circle.cx += dx; g.circle.cy += dy; }
    else if (kind === 'rect') { g.rect.x0 += dx; g.rect.x1 += dx; g.rect.y0 += dy; g.rect.y1 += dy; }
    else g.poly.pts = g.poly.pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
  }
  g.ver++;
  return true;
}

export function gaussRelease(S) {
  const g = ensureGauss(S);
  const was = g.drag;
  if (was && was.t === 'draw') {
    g.armDraw = false;
    if (g.freehand.length < 3) { // too short: restore a triangle around the click
      const q = g.freehand[0];
      g.poly.pts = [{ x: q.x - 0.6, y: q.y - 0.4 }, { x: q.x + 0.6, y: q.y - 0.4 }, { x: q.x, y: q.y + 0.6 }];
    }
    g.freehand = null;
    g.ver++;
  }
  g.drag = null;
  return !!was;
}

/** Arm free-hand drawing (next drag on the canvas draws the polygon). */
export function armDraw(S) {
  const g = ensureGauss(S);
  g.armDraw = true;
  S.set('gauss.kind', 'poly');
}

function recordHistory(S, res) {
  const h = ensureGauss(S).hist;
  const key = `${S.get('gauss.kind')}|${S.gauss.ver}|${S.chVer}`;
  if (h.key === key && !S.get('gauss.sweep')) return;
  h.key = key;
  h.flux.push(res.flux);
  h.q.push(res.enclosed);
  if (h.flux.length > HIST) { h.flux.shift(); h.q.shift(); }
}

function drawChart(S, res) {
  const { p, pal } = S;
  const h = ensureGauss(S).hist;
  const w = 270, ht = 110, x = 12, y = p.height - ht - 14;
  p.push();
  p.noStroke();
  p.fill(pal.dark ? 'rgba(20,22,26,0.85)' : 'rgba(250,250,250,0.9)');
  p.rect(x, y, w, ht, 6);
  p.textSize(10);
  p.fill(pal.muted);
  p.textAlign(p.LEFT, p.TOP);
  p.text('flux vs time (samples)', x + 6, y + 4);
  let m = 0.5;
  for (let i = 0; i < h.flux.length; i++) m = Math.max(m, Math.abs(h.flux[i]), Math.abs(h.q[i]));
  const X = (i) => x + 6 + (w - 12) * i / (HIST - 1);
  const Y = (v) => y + 22 + (ht - 30) * (0.5 - 0.5 * v / m);
  p.stroke(pal.axis);
  p.line(x + 6, Y(0), x + w - 6, Y(0));
  p.noFill();
  p.strokeWeight(1.6);
  p.stroke('#2ecc71');
  p.beginShape();
  h.q.forEach((v, i) => p.vertex(X(i), Y(v)));
  p.endShape();
  p.stroke('#ffb020');
  p.strokeWeight(1.2);
  p.beginShape();
  h.flux.forEach((v, i) => p.vertex(X(i), Y(v)));
  p.endShape();
  p.noStroke();
  p.fill('#ffb020');
  p.text('flux (numerical)', x + 120, y + 4);
  p.fill('#2ecc71');
  p.text('Q_enc / eps0', x + 200, y + 4);
  p.pop();
  void res;
}

/** Draw surface, highlights, flux arrows, readout and strip chart. */
export function drawGauss(S) {
  const g = ensureGauss(S);
  const { p, view, pal } = S;
  const kind = S.get('gauss.kind');
  const res = gaussResult(S);
  recordHistory(S, res);

  // surface
  p.push();
  p.strokeWeight(2.4);
  p.stroke('#ffb020');
  p.fill(255, 176, 32, 22);
  if (kind === 'circle') {
    p.circle(view.toX(g.circle.cx), view.toY(g.circle.cy), 2 * g.circle.r * view.rect.w / (view.xmax - view.xmin));
  } else {
    const pts = surfacePolygon(S);
    p.beginShape();
    for (const q of pts) p.vertex(view.toX(q.x), view.toY(q.y));
    p.endShape(p.CLOSE);
  }
  // handles
  p.fill(pal.bg);
  p.strokeWeight(1.5);
  const handle = (x, y) => p.circle(view.toX(x), view.toY(y), 9);
  if (kind === 'circle') handle(g.circle.cx + g.circle.r, g.circle.cy);
  else if (kind === 'rect') { handle(g.rect.x0, g.rect.y0); handle(g.rect.x1, g.rect.y0); handle(g.rect.x1, g.rect.y1); handle(g.rect.x0, g.rect.y1); }
  else for (const q of g.poly.pts) handle(q.x, q.y);
  p.pop();

  // local flux density arrows E.n along the boundary
  if (S.get('gauss.arrows')) {
    const samples = boundarySamples(S.charges, surfacePolygon(S, 200), 44, '2d', 0);
    let mx = 1e-12;
    for (const s of samples) mx = Math.max(mx, Math.abs(s.En));
    p.push();
    for (const sign of [1, -1]) {
      p.stroke(sign > 0 ? '#ff7a59' : '#59a8ff');
      p.strokeWeight(1.8);
      p.beginShape(p.LINES);
      for (const s of samples) {
        if (Math.sign(s.En) !== sign || !finite(s.En)) continue;
        const L = 6 + 34 * Math.abs(s.En) / mx;
        const x0 = view.toX(s.x), y0 = view.toY(s.y);
        const nx = s.nx, ny = -s.ny;
        const a = sign > 0 ? [x0, y0, x0 + nx * L, y0 + ny * L] : [x0 + nx * L, y0 + ny * L, x0, y0];
        const dx = a[2] - a[0], dy = a[3] - a[1], d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        p.vertex(a[0], a[1]); p.vertex(a[2], a[3]);
        p.vertex(a[2], a[3]); p.vertex(a[2] - ux * 5 - uy * 3, a[3] - uy * 5 + ux * 3);
        p.vertex(a[2], a[3]); p.vertex(a[2] - ux * 5 + uy * 3, a[3] - uy * 5 - ux * 3);
      }
      p.endShape();
    }
    p.pop();
  }

  // charges (enclosed ones glow)
  const enc = new Set(res.enclosedIdx);
  S.charges.forEach((c, i) => {
    drawCharge(p, pal, view.toX(c.x), view.toY(c.y), c.q, { selected: i === S.sel, hover: i === S.hover, glow: enc.has(i) });
  });

  const diff = res.flux - res.enclosed;
  hudBox(p, pal, 12, 12, [
    ['Gauss law (2D line-charge convention, eps0 = 1)', pal.muted],
    `flux  Φ = ∮ E·n dl  = ${fmt(res.flux, 6)}`,
    `Q_enclosed / ε₀       = ${fmt(res.enclosed, 6)}  (${res.enclosedIdx.length} charge${res.enclosedIdx.length === 1 ? '' : 's'})`,
    [`Φ - Q/ε₀ = ${fmt(diff, 2)}   (quadrature error)`, Math.abs(diff) < 1e-6 * Math.max(1, Math.abs(res.enclosed)) ? '#2ecc71' : '#ffb020'],
    ['red arrows: E·n > 0 (outflow), blue: inflow', pal.muted],
  ], { w: 300 });
  drawChart(S, res);
}

/** Move charge 0 back and forth through the surface (the "flux changing as a charge crosses" demo). */
export function sweepCharge(S, dt) {
  const sw = S.sweep || (S.sweep = { phase: 0, base: null, n: -1 });
  const c = S.charges[0];
  if (!c) return;
  if (!sw.base || sw.n !== S.charges.length) { sw.base = { x: c.x, y: c.y }; sw.n = S.charges.length; sw.phase = 0; }
  const g = ensureGauss(S);
  const kind = S.get('gauss.kind');
  const amp = clamp(kind === 'circle' ? g.circle.r * 1.9 : (S.view.xmax - S.view.xmin) * 0.22, 0.5, 20);
  sw.phase += dt * S.get('gauss.speed') * 2;
  c.x = sw.base.x + amp * Math.sin(sw.phase);
  S.chVer++;
}

export function resetSweep(S) {
  if (S.sweep && S.sweep.base && S.charges[0]) { S.charges[0].x = S.sweep.base.x; S.charges[0].y = S.sweep.base.y; S.chVer++; }
  S.sweep = null;
}
