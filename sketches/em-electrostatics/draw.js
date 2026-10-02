// Shared drawing helpers of the electrostatics unit.

import { niceTicks, fmtTick } from '../approx/view.js';

export const POS = '#ff5a4f';
export const NEG = '#4aa3ff';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const finite = (v) => Number.isFinite(v);

/** Compact number formatting for read-outs. */
export function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return '-';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(digits - 1);
  return String(+v.toPrecision(digits));
}

/** Background grid + axes with tick labels (world units). */
export function drawAxes(p, pal, view, { xLabel = 'x', yLabel = 'y', grid = true } = {}) {
  const r = view.rect;
  const xt = niceTicks(view.xmin, view.xmax, Math.max(3, Math.round(r.w / 90)));
  const yt = niceTicks(view.ymin, view.ymax, Math.max(3, Math.round(r.h / 70)));
  p.push();
  p.strokeWeight(1);
  if (grid) {
    p.stroke(pal.grid);
    for (const x of xt) { const px = view.toX(x); p.line(px, r.y, px, r.y + r.h); }
    for (const y of yt) { const py = view.toY(y); p.line(r.x, py, r.x + r.w, py); }
  }
  p.stroke(pal.axis);
  if (view.xmin < 0 && view.xmax > 0) p.line(view.toX(0), r.y, view.toX(0), r.y + r.h);
  if (view.ymin < 0 && view.ymax > 0) p.line(r.x, view.toY(0), r.x + r.w, view.toY(0));
  p.noStroke();
  p.fill(pal.muted);
  p.textSize(10);
  p.textAlign(p.CENTER, p.TOP);
  for (const x of xt) { if (Math.abs(x) > 1e-12) p.text(fmtTick(x), view.toX(x), r.y + r.h - 14); }
  p.textAlign(p.LEFT, p.CENTER);
  for (const y of yt) { if (Math.abs(y) > 1e-12) p.text(fmtTick(y), r.x + 4, view.toY(y)); }
  p.textAlign(p.RIGHT, p.BOTTOM);
  p.text(`${xLabel} (length units)`, r.x + r.w - 6, r.y + r.h - 16);
  p.textAlign(p.LEFT, p.TOP);
  p.text(`${yLabel}`, r.x + 6, r.y + 4);
  p.pop();
}

/** A text box in the corner: lines is an array of strings or [string, colour]. */
export function hudBox(p, pal, x, y, lines, { w = 250, size = 11, align = 'left' } = {}) {
  const lh = size + 4;
  const h = lines.length * lh + 10;
  p.push();
  p.noStroke();
  p.fill(pal.dark ? 'rgba(20,22,26,0.82)' : 'rgba(250,250,250,0.88)');
  p.rect(x, y, w, h, 6);
  p.textSize(size);
  p.textAlign(p.LEFT, p.TOP);
  lines.forEach((l, i) => {
    const [txt, col] = Array.isArray(l) ? l : [l, pal.fg];
    p.fill(col);
    p.text(txt, x + 8, y + 6 + i * lh);
  });
  p.pop();
  void align;
  return h;
}

/** Charge disc with a label. */
export function drawCharge(p, pal, sx, sy, q, { selected = false, hover = false, glow = false } = {}) {
  const rad = clamp(7 + 4 * Math.sqrt(Math.abs(q)), 8, 26);
  p.push();
  if (glow) {
    p.noFill();
    p.stroke(255, 220, 90);
    p.strokeWeight(3);
    p.circle(sx, sy, 2 * rad + 10);
  }
  p.stroke(selected || hover ? pal.fg : pal.bg);
  p.strokeWeight(selected ? 2.5 : 1.5);
  p.fill(q >= 0 ? POS : NEG);
  p.circle(sx, sy, 2 * rad);
  p.noStroke();
  p.fill('#ffffff');
  p.textSize(clamp(rad, 10, 15));
  p.textAlign(p.CENTER, p.CENTER);
  p.text(q >= 0 ? '+' : '-', sx, sy - 1);
  p.fill(pal.fg);
  p.textSize(10);
  p.textAlign(p.CENTER, p.TOP);
  p.text(`${q >= 0 ? '+' : ''}${fmt(q, 2)}`, sx, sy + rad + 2);
  p.pop();
  return rad;
}

/** Arrow from (x0,y0) to (x1,y1) in screen space. */
export function drawArrow(p, x0, y0, x1, y1, head = 6) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return;
  const ux = dx / len, uy = dy / len;
  const h = Math.min(head, len * 0.6);
  p.line(x0, y0, x1, y1);
  p.line(x1, y1, x1 - ux * h - uy * h * 0.5, y1 - uy * h + ux * h * 0.5);
  p.line(x1, y1, x1 - ux * h + uy * h * 0.5, y1 - uy * h - ux * h * 0.5);
}

/** Push the segments of an arrow as vertex pairs (for one beginShape(LINES) batch). */
export function arrowVerts(p, x0, y0, x1, y1, head = 5) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0.5)) return;
  const ux = dx / len, uy = dy / len;
  const h = Math.min(head, len * 0.6);
  p.vertex(x0, y0); p.vertex(x1, y1);
  p.vertex(x1, y1); p.vertex(x1 - ux * h - uy * h * 0.5, y1 - uy * h + ux * h * 0.5);
  p.vertex(x1, y1); p.vertex(x1 - ux * h + uy * h * 0.5, y1 - uy * h - ux * h * 0.5);
}

/** Draw a polyline from a flat [x,y,...] world array, thinning to roughly `minPx` screen spacing. */
export function polyline(p, view, pts, minPx = 3) {
  let lx = NaN, ly = NaN, n = 0;
  p.beginShape();
  const last = pts.length - 2;
  for (let i = 0; i < pts.length; i += 2) {
    const sx = view.toX(pts[i]), sy = view.toY(pts[i + 1]);
    if (!finite(sx) || !finite(sy)) continue;
    if (i === 0 || i === last || Math.hypot(sx - lx, sy - ly) >= minPx) { p.vertex(sx, sy); lx = sx; ly = sy; n++; }
  }
  p.endShape();
  return n;
}
