// Shared drawing helpers for the vector calculus unit: clipping, arrows, HUD text, colour maps,
// world axes and cached images.

import { colormapLUT } from '../../lib/render3d.js';
import { niceTicks, fmtTick } from '../approx/view.js';

/** Runs fn clipped to rect (push / pop only, never raw save / restore). */
export function withClip(p, rect, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.rect(rect.x, rect.y, rect.w, rect.h);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

/** Arrow from (x0, y0) to (x1, y1): shaft line + filled head triangle. Skips non-finite / tiny arrows. */
export function arrow(p, x0, y0, x1, y1, head = 6) {
  if (!(Number.isFinite(x0 + y0 + x1 + y1))) return;
  const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
  if (d < 0.8) return;
  const ux = dx / d, uy = dy / d, hs = Math.min(head, d * 0.6);
  p.line(x0, y0, x1 - ux * hs * 0.6, y1 - uy * hs * 0.6);
  p.triangle(x1, y1, x1 - ux * hs - uy * hs * 0.45, y1 - uy * hs + ux * hs * 0.45, x1 - ux * hs + uy * hs * 0.45, y1 - uy * hs - ux * hs * 0.45);
}

/** Text lines in a translucent panel. lines: string | { text, color }. Returns the panel height. */
export function hud(p, pal, lines, x, y, maxW = 420, size = 12) {
  p.textSize(size);
  p.textAlign(p.LEFT, p.TOP);
  const lh = size + 4;
  let w = 0;
  for (const l of lines) w = Math.max(w, p.textWidth(typeof l === 'string' ? l : l.text));
  w = Math.min(maxW, w + 16);
  const h = lines.length * lh + 10;
  p.noStroke();
  p.fill(pal.dark ? [16, 18, 22, 215] : [250, 250, 250, 220]);
  p.rect(x, y, w, h, 6);
  lines.forEach((l, i) => {
    p.fill(typeof l === 'string' ? pal.fg : l.color || pal.fg);
    p.text(typeof l === 'string' ? l : l.text, x + 8, y + 6 + i * lh);
  });
  return h;
}

/** Blue - light - red diverging colour for t in [-1, 1] (0 = neutral). Returns [r, g, b]. */
export function diverging(t, dark = true) {
  const u = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  const a = Math.abs(u) ** 0.8;
  const base = dark ? [26, 29, 36] : [244, 244, 246];
  const hot = u >= 0 ? [235, 70, 60] : [60, 130, 240];
  return [base[0] + (hot[0] - base[0]) * a, base[1] + (hot[1] - base[1]) * a, base[2] + (hot[2] - base[2]) * a];
}

const LUT = colormapLUT('viridis');
/** Sequential colour for t in [0, 1]. */
export function sequential(t) {
  const i = Math.max(0, Math.min(255, Math.round((Number.isFinite(t) ? t : 0) * 255))) * 3;
  return [LUT[i], LUT[i + 1], LUT[i + 2]];
}

/** Robust symmetric scale: the q-quantile of |values| (never 0). */
export function robustScale(values, q = 0.97) {
  const a = [];
  for (let i = 0; i < values.length; i += Math.max(1, Math.floor(values.length / 2000))) if (Number.isFinite(values[i])) a.push(Math.abs(values[i]));
  if (!a.length) return 1;
  a.sort((x, y) => x - y);
  return Math.max(1e-9, a[Math.min(a.length - 1, Math.floor(q * a.length))]);
}

/** Re-creates holder.img when the size changed. */
export function ensureImage(p, holder, w, h) {
  if (!holder.img || holder.w !== w || holder.h !== h) {
    holder.img = p.createImage(w, h);
    holder.w = w; holder.h = h;
    holder.key = null;
  }
  return holder.img;
}

/** Draws x / y axes through the origin (when visible), a light grid and tick labels. */
export function drawAxes2D(p, pal, vp, opts = {}) {
  const r = vp.rect;
  const xt = niceTicks(vp.xmin, vp.xmax, Math.max(3, Math.round(r.w / 90)));
  const yt = niceTicks(vp.ymin, vp.ymax, Math.max(3, Math.round(r.h / 70)));
  withClip(p, r, () => {
    p.strokeWeight(1);
    p.textSize(10);
    if (opts.grid !== false) {
      p.stroke(pal.grid);
      for (const t of xt) p.line(vp.toX(t), r.y, vp.toX(t), r.y + r.h);
      for (const t of yt) p.line(r.x, vp.toY(t), r.x + r.w, vp.toY(t));
    }
    p.stroke(pal.axis);
    if (vp.xmin < 0 && vp.xmax > 0) p.line(vp.toX(0), r.y, vp.toX(0), r.y + r.h);
    if (vp.ymin < 0 && vp.ymax > 0) p.line(r.x, vp.toY(0), r.x + r.w, vp.toY(0));
    p.noStroke();
    p.fill(pal.muted);
    p.textAlign(p.CENTER, p.TOP);
    const ay = Math.min(r.y + r.h - 14, Math.max(r.y + 2, vp.toY(0) + 2));
    for (const t of xt) if (Math.abs(t) > 1e-12) p.text(fmtTick(t), vp.toX(t), ay);
    p.textAlign(p.LEFT, p.CENTER);
    const ax = Math.min(r.x + r.w - 30, Math.max(r.x + 2, vp.toX(0) + 3));
    for (const t of yt) if (Math.abs(t) > 1e-12) p.text(fmtTick(t), ax, vp.toY(t));
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.text(opts.xLabel || 'x', r.x + r.w - 4, r.y + r.h - 3);
  });
}

/** Vertical legend bar for a diverging / sequential scale at the right edge of rect. */
export function drawLegend(p, pal, rect, label, scale, signed) {
  const w = 12, h = Math.min(120, rect.h * 0.4), x = rect.x + rect.w - w - 14, y = rect.y + rect.h - h - 34;
  p.noStroke();
  for (let i = 0; i < h; i++) {
    const t = 1 - i / (h - 1);
    const c = signed ? diverging(2 * t - 1, pal.dark) : sequential(t);
    p.fill(c[0], c[1], c[2]);
    p.rect(x, y + i, w, 1.5);
  }
  p.fill(pal.fg);
  p.textSize(10);
  p.textAlign(p.RIGHT, p.CENTER);
  const f = (v) => (Math.abs(v) >= 100 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : String(Number(v.toPrecision(2))));
  p.text(signed ? f(scale) : f(scale), x - 4, y + 2);
  p.text(signed ? f(-scale) : '0', x - 4, y + h - 2);
  if (signed) p.text('0', x - 4, y + h / 2);
  p.textAlign(p.RIGHT, p.BOTTOM);
  p.text(label, x + w, y - 4);
}

/** Pointer helpers shared by the tabs. */
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Short text for a number with sign, fixed digits. */
export const sgn = (v, d = 4) => (Number.isFinite(v) ? (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(d) : '--');

/**
 * Builds / refreshes a colour-mapped image of valueAt(x, y) over `bounds` in holder (cached by `key`).
 * opts: { rect, bounds, key, valueAt, signed, cell, dark, busy, retry, scale (optional fixed) }.
 * Returns true when the image is current. While `busy` a stale image is kept and retry() is called.
 */
export function updateScalarImage(p, holder, opts) {
  const { rect, bounds: b, valueAt, signed, dark } = opts;
  const cell = opts.cell || 4;
  const cw = Math.max(8, Math.ceil(rect.w / cell)), ch = Math.max(8, Math.ceil(rect.h / cell));
  const key = `${opts.key}|${cw}x${ch}|${b.xmin.toPrecision(6)},${b.xmax.toPrecision(6)},${b.ymin.toPrecision(6)},${b.ymax.toPrecision(6)}`;
  if (holder.key === key && holder.img) return true;
  if (opts.busy && holder.img) { if (opts.retry) opts.retry(); return false; }
  const img = ensureImage(p, holder, cw, ch);
  const vals = new Float32Array(cw * ch);
  const dx = (b.xmax - b.xmin) / cw, dy = (b.ymax - b.ymin) / ch;
  for (let j = 0; j < ch; j++) {
    const y = b.ymax - (j + 0.5) * dy;
    for (let i = 0; i < cw; i++) {
      const v = valueAt(b.xmin + (i + 0.5) * dx, y);
      vals[j * cw + i] = Number.isFinite(v) ? v : 0;
    }
  }
  let scale = opts.scale || robustScale(vals, signed ? 0.97 : 0.98);
  if (!opts.scale) {
    const e = 10 ** Math.floor(Math.log10(scale));
    scale = [1, 2, 5, 10].find((s) => s * e >= scale) * e;
  }
  img.loadPixels();
  const px = img.pixels;
  for (let i = 0; i < cw * ch; i++) {
    const c = signed ? diverging(vals[i] / scale, dark) : sequential(vals[i] / scale);
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  img.updatePixels();
  holder.key = key; holder.bounds = { ...b }; holder.scale = scale; holder.signed = !!signed;
  return true;
}

/** Draws holder.img stretched over holder.bounds through the viewport vp (toX / toY). */
export function drawBoundsImage(p, holder, vp, alpha = 255) {
  if (!holder.img || !holder.bounds) return;
  const b = holder.bounds;
  const x0 = vp.toX(b.xmin), x1 = vp.toX(b.xmax), y0 = vp.toY(b.ymax), y1 = vp.toY(b.ymin);
  if (![x0, x1, y0, y1].every(Number.isFinite)) return;
  if (alpha < 255) p.tint(255, alpha);
  p.image(holder.img, x0, y0, x1 - x0, y1 - y0);
  if (alpha < 255) p.noTint();
}
