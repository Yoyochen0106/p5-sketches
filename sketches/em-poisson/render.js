// Image builders and plots for the Laplace & Poisson unit. All dense layers are p5.Image objects (one pixel per grid node).

import { colormapInto, logUnit } from '../../lib/em/colormap.js';
import { METHODS } from '../../lib/em/poisson.js';
import { METHOD_COLORS } from './state.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const finite = Number.isFinite;

/** Compact number formatting for read-outs. */
export function fmt(v, digits = 3) {
  if (!Number.isFinite(v)) return '-';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(digits - 1);
  return String(+v.toPrecision(digits));
}

/**
 * Colour layer for the potential or |E|: img has nx x ny pixels, pixel row r = ny-1-j (y up).
 * Returns { lo, hi } the displayed range.
 */
export function fieldImage(img, prob, phi, field, mode, pal) {
  const { nx, ny } = prob;
  img.loadPixels();
  const px = img.pixels;
  const rgb = [0, 0, 0];
  let lo = 0, hi = 1;
  if (mode === 'phi') {
    lo = Infinity; hi = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = phi[prob.idx(i, j)]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
  } else if (mode === 'E') {
    hi = Math.max(field.max, 1e-30);
    lo = hi * 1e-3;
  }
  const cm = mode === 'phi' ? (lo < 0 && hi > 0 ? (pal.dark ? 'divergingDark' : 'diverging') : (pal.dark ? 'inferno' : 'viridis')) : (pal.dark ? 'inferno' : 'viridis');
  const signed = mode === 'phi' && lo < 0 && hi > 0;
  const m = Math.max(Math.abs(lo), Math.abs(hi));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let t;
      if (mode === 'none') { rgb[0] = pal.dark ? 24 : 235; rgb[1] = pal.dark ? 27 : 235; rgb[2] = pal.dark ? 32 : 240; }
      else {
        if (mode === 'phi') t = signed ? 0.5 + 0.5 * phi[prob.idx(i, j)] / m : (phi[prob.idx(i, j)] - lo) / (hi - lo);
        else t = logUnit(field.mag[i + nx * j], lo, hi);
        colormapInto(cm, t, rgb);
      }
      const o = (i + nx * (ny - 1 - j)) * 4;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
  }
  img.updatePixels();
  return { lo, hi };
}

/**
 * Overlay layer: conductors (metal tinted by voltage), dielectric tint, painted charge, induced surface charge
 * (red +, blue -) and the breakdown field overlay. Transparent where nothing is drawn.
 */
export function overlayImage(img, prob, field, charges, opts) {
  const { nx, ny } = prob;
  const { showCharge, showBreakdown, Ebreak, Vscale, pal } = opts;
  img.loadPixels();
  const px = img.pixels;
  let epsMax = 1, rhoMax = 0, qMax = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = prob.idx(i, j);
      if (prob.eps[k] > epsMax) epsMax = prob.eps[k];
      if (Math.abs(prob.rho[k]) > rhoMax) rhoMax = Math.abs(prob.rho[k]);
      if (charges) qMax = Math.max(qMax, Math.abs(charges[i + nx * j]));
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = prob.idx(i, j);
      const o = (i + nx * (ny - 1 - j)) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (prob.fixed[k]) {
        const t = Vscale > 0 ? clamp(prob.fixedV[k] / Vscale, -1, 1) : 0;
        r = 150 + 90 * Math.max(0, t); g = 150 - 30 * Math.abs(t); b = 150 + 90 * Math.max(0, -t);
        a = 255;
        if (showCharge && charges && qMax > 0) {
          const q = charges[i + nx * j] / qMax;
          const s = Math.min(1, Math.abs(q) * 3);
          if (Math.abs(q) > 0.02) {
            const target = q > 0 ? [255, 40, 40] : [40, 90, 255];
            r = r * (1 - s) + target[0] * s; g = g * (1 - s) + target[1] * s; b = b * (1 - s) + target[2] * s;
          }
        }
      } else {
        if (prob.eps[k] > 1.0001) { r = 70; g = 210; b = 190; a = 40 + 90 * (prob.eps[k] - 1) / Math.max(1, epsMax - 1); }
        if (rhoMax > 0 && Math.abs(prob.rho[k]) > 0) {
          const s = 0.35 + 0.4 * Math.abs(prob.rho[k]) / rhoMax;
          const col = prob.rho[k] > 0 ? [255, 80, 70] : [80, 140, 255];
          r = col[0]; g = col[1]; b = col[2]; a = Math.max(a, 255 * s);
        }
        if (showBreakdown && field && field.mag[i + nx * j] > Ebreak && ((i + j) & 1) === 0) {
          r = 255; g = 40; b = 40; a = 200;
        }
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
    }
  }
  img.updatePixels();
  void pal;
}

/** Residual-vs-iteration (or work) plot comparing the solvers. */
export function drawConvergence(p, pal, rect, solvers, { logx = true, work = false, displayed = '' } = {}) {
  const { x, y, w, h } = rect;
  p.push();
  p.noStroke();
  p.fill(pal.panel);
  p.rect(x, y, w, h, 6);
  p.fill(pal.fg);
  p.textSize(11);
  p.textAlign(p.LEFT, p.TOP);
  p.text(`relative residual  ||r|| / ||r0||  vs ${work ? 'work (smoothing sweeps)' : 'iteration'}`, x + 8, y + 6);
  const px = x + 44, py = y + 28, pw = w - 58, ph = h - 56;
  if (pw < 40 || ph < 30) { p.pop(); return; }
  const workOf = (id, it) => (id === 'mg' ? it * 6 : it);
  let xmax = 10;
  for (const [id, s] of solvers) for (const it of s.iters) xmax = Math.max(xmax, work ? workOf(id, it) : it);
  const X = (v) => (logx ? px + pw * Math.log10(Math.max(1, v + 1)) / Math.log10(xmax + 1) : px + pw * v / xmax);
  const lo = -10, hi = 0;
  const Y = (r) => py + ph * (hi - clamp(Math.log10(Math.max(r, 1e-30)), lo, hi)) / (hi - lo);
  p.stroke(pal.grid);
  p.strokeWeight(1);
  p.textSize(9);
  for (let d = lo; d <= hi; d += 2) {
    p.stroke(pal.grid);
    p.line(px, Y(10 ** d), px + pw, Y(10 ** d));
    p.noStroke();
    p.fill(pal.muted);
    p.textAlign(p.RIGHT, p.CENTER);
    p.text(`1e${d}`, px - 4, Y(10 ** d));
  }
  p.textAlign(p.CENTER, p.TOP);
  const ticks = logx ? [0, 1, 2, 3, 4, 5].map((e) => 10 ** e).filter((t) => t <= xmax * 1.2) : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * xmax));
  for (const t of ticks) {
    p.stroke(pal.grid);
    p.line(X(t), py, X(t), py + ph);
    p.noStroke();
    p.fill(pal.muted);
    p.text(fmt(t, 3), X(t), py + ph + 3);
  }
  p.stroke(pal.axis);
  p.noFill();
  p.rect(px, py, pw, ph);
  p.stroke(pal.muted);
  // curves
  for (const m of METHODS) {
    const s = solvers.get(m.id);
    if (!s || s.res.length < 1) continue;
    const col = METHOD_COLORS[m.id];
    p.noFill();
    p.stroke(col);
    p.strokeWeight(m.id === displayed ? 2.6 : 1.6);
    const n = s.iters.length;
    const stride = Math.max(1, Math.floor(n / 220));
    p.beginShape();
    for (let i = 0; i < n; i += stride) p.vertex(X(work ? workOf(m.id, s.iters[i]) : s.iters[i]), Y(s.res[i]));
    p.vertex(X(work ? workOf(m.id, s.iters[n - 1]) : s.iters[n - 1]), Y(s.res[n - 1]));
    p.endShape();
  }
  // legend with iteration counts to reach 1e-6
  p.noStroke();
  p.textSize(10);
  p.textAlign(p.LEFT, p.TOP);
  const bits = [];
  for (const m of METHODS) {
    const s = solvers.get(m.id);
    if (!s) continue;
    let at = null;
    for (let i = 0; i < s.res.length; i++) if (s.res[i] < 1e-6) { at = s.iters[i]; break; }
    bits.push({ id: m.id, label: m.label, text: `${m.label}: ${s.iter} it${at !== null ? `  (1e-6 @ ${at})` : ''}` });
  }
  bits.forEach((b, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const bx = x + 8 + col * (w - 16) / 3, by = y + h - 26 + row * 12 - (Math.ceil(bits.length / 3) - 1) * 12;
    p.fill(METHOD_COLORS[b.id]);
    p.rect(bx, by + 2, 8, 8);
    p.fill(pal.fg);
    p.text(b.text, bx + 12, by);
  });
  p.pop();
}
