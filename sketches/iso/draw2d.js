// Drawing for the 2D (marching squares) mode: colour-mapped background, contours, lattice dots,
// gradient arrows, cell highlight and the cell inspector panel. All functions take the p5 instance.
import { colormapLUT } from '../../lib/render3d.js';
import { describeSquareCell } from '../../lib/iso-inspect.js';

export const MONO = 'Consolas, ui-monospace, monospace';
export const INSIDE = [74, 163, 255];
export const OUTSIDE = [255, 159, 67];

export function accentFor(pal) { return pal.dark ? [255, 209, 102] : [180, 83, 9]; }

const finite = (...v) => v.every(Number.isFinite);

/** Pixel image (nx+1) x (ny+1) of the field, diverging colormap centred on the iso-level. */
export function makeBackground(p, grid, level, alpha = 210) {
  const { values, nx, ny } = grid;
  const w = nx + 1, h = ny + 1;
  let sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const d = Math.abs(values[i] - level);
    if (d < 1e5) { sum += d; n++; }
  }
  const scale = Math.max(1e-12, (sum / Math.max(1, n)) * 1.5);
  const lut = colormapLUT('coolwarm');
  const img = p.createImage(w, h);
  img.loadPixels();
  const px = img.pixels;
  for (let j = 0; j <= ny; j++) {
    const row = ny - j; // image row 0 is the top (largest y)
    for (let i = 0; i <= nx; i++) {
      const v = values[i + w * j];
      const u = Number.isFinite(v) ? Math.tanh((v - level) / scale) : 1;
      const k = Math.max(0, Math.min(255, Math.round((u * 0.5 + 0.5) * 255))) * 3;
      const o = (row * w + i) * 4;
      px[o] = lut[k]; px[o + 1] = lut[k + 1]; px[o + 2] = lut[k + 2]; px[o + 3] = alpha;
    }
  }
  img.updatePixels();
  return img;
}

function withClip(p, rect, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.rect(rect.x, rect.y, rect.w, rect.h);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

/** Draws segments [x0,y0,x1,y1,...] (math coordinates) as one batched LINES shape. */
export function strokeSegments(p, view, segs, count = segs.length / 4) {
  p.beginShape(p.LINES);
  for (let s = 0; s < count; s++) {
    const x0 = view.toX(segs[s * 4]), y0 = view.toY(segs[s * 4 + 1]), x1 = view.toX(segs[s * 4 + 2]), y1 = view.toY(segs[s * 4 + 3]);
    if (!finite(x0, y0, x1, y1)) continue;
    p.vertex(x0, y0);
    p.vertex(x1, y1);
  }
  p.endShape();
}

function drawGradient(p, view, rect, bounds, f, pal) {
  const step = 30;
  const hx = (view.xmax - view.xmin) * 1e-4, hy = (view.ymax - view.ymin) * 1e-4;
  p.stroke(pal.dark ? 235 : 30, 170);
  p.strokeWeight(1);
  p.noFill();
  p.beginShape(p.LINES);
  for (let sy = rect.y + step / 2; sy < rect.y + rect.h; sy += step) {
    for (let sx = rect.x + step / 2; sx < rect.x + rect.w; sx += step) {
      const x = view.fromX(sx), y = view.fromY(sy);
      if (x < bounds.xmin || x > bounds.xmax || y < bounds.ymin || y > bounds.ymax) continue;
      const gx = (f(x + hx, y) - f(x - hx, y)) / (2 * hx);
      const gy = (f(x, y + hy) - f(x, y - hy)) / (2 * hy);
      const l = Math.hypot(gx, gy);
      if (!(l > 1e-12) || !Number.isFinite(l)) continue;
      const ux = gx / l, uy = -gy / l; // screen y points down
      const len = 11;
      const ex = sx + ux * len, ey = sy + uy * len;
      const bx = sx - ux * len * 0.4, by = sy - uy * len * 0.4;
      const hxv = -ux * 4, hyv = -uy * 4;
      p.vertex(bx, by); p.vertex(ex, ey);
      p.vertex(ex, ey); p.vertex(ex + hxv - uy * 2.5, ey + hyv + ux * 2.5);
      p.vertex(ex, ey); p.vertex(ex + hxv + uy * 2.5, ey + hyv - ux * 2.5);
    }
  }
  p.endShape();
}

/**
 * Draws the whole 2D scene (everything except the inspector panel and HUD text).
 * S: { pal, view, bounds, grid, level, bg (p5.Image|null), levelSegs [{level, segs, count}], activeSegs {segs, count},
 *      opts {lattice, grad, contour, showLevels}, f (x,y)->value, hover {i,j}|null, selInfo }
 */
export function drawScene2D(p, S) {
  const { pal, view, grid } = S;
  const rect = view.rect;
  const acc = accentFor(pal);
  const b = grid.bounds;
  const dx = (b.xmax - b.xmin) / grid.nx, dy = (b.ymax - b.ymin) / grid.ny;
  const pxX = Math.abs(view.toX(b.xmin + dx) - view.toX(b.xmin)), pxY = Math.abs(view.toY(b.ymin + dy) - view.toY(b.ymin));
  const cellPx = Math.min(pxX, pxY);
  withClip(p, rect, () => {
    // domain box + background
    const x0 = view.toX(b.xmin), x1 = view.toX(b.xmax), y0 = view.toY(b.ymax), y1 = view.toY(b.ymin);
    if (finite(x0, x1, y0, y1)) {
      p.noStroke();
      p.fill(pal.panel);
      p.rect(x0, y0, x1 - x0, y1 - y0);
      if (S.bg) {
        const ix = view.toX(b.xmin - dx / 2), iy = view.toY(b.ymax + dy / 2);
        const iw = view.toX(b.xmax + dx / 2) - ix, ih = view.toY(b.ymin - dy / 2) - iy;
        if (finite(ix, iy, iw, ih) && iw > 0 && ih > 0 && iw < 1e6 && ih < 1e6) p.image(S.bg, ix, iy, iw, ih);
      }
    }
    // cell grid
    if (S.opts.lattice && cellPx >= 5) {
      p.stroke(pal.dark ? 255 : 0, 40);
      p.strokeWeight(1);
      p.noFill();
      p.beginShape(p.LINES);
      const i0 = Math.max(0, Math.floor((view.xmin - b.xmin) / dx)), i1 = Math.min(grid.nx, Math.ceil((view.xmax - b.xmin) / dx));
      const j0 = Math.max(0, Math.floor((view.ymin - b.ymin) / dy)), j1 = Math.min(grid.ny, Math.ceil((view.ymax - b.ymin) / dy));
      for (let i = i0; i <= i1; i++) { const x = view.toX(b.xmin + i * dx); p.vertex(x, y0); p.vertex(x, y1); }
      for (let j = j0; j <= j1; j++) { const y = view.toY(b.ymin + j * dy); p.vertex(x0, y); p.vertex(x1, y); }
      p.endShape();
    }
    // extra level lines
    if (S.opts.showLevels) {
      p.noFill();
      p.stroke(pal.dark ? 235 : 20, 150);
      p.strokeWeight(1);
      for (const L of S.levelSegs) if (L.count) strokeSegments(p, view, L.segs, L.count);
    }
    // gradient arrows
    if (S.opts.grad) drawGradient(p, view, rect, b, S.f, pal);
    // selected + hover cell
    const cellRect = (i, j) => [view.toX(b.xmin + i * dx), view.toY(b.ymin + (j + 1) * dy), pxX, pxY];
    if (S.hover && (!S.selInfo || S.selInfo.i !== S.hover.i || S.selInfo.j !== S.hover.j)) {
      const [rx, ry, rw, rh] = cellRect(S.hover.i, S.hover.j);
      if (finite(rx, ry, rw, rh)) {
        p.noStroke(); p.fill(acc[0], acc[1], acc[2], 55);
        p.rect(rx, ry, rw, rh);
      }
    }
    if (S.selInfo) {
      const [rx, ry, rw, rh] = cellRect(S.selInfo.i, S.selInfo.j);
      if (finite(rx, ry, rw, rh)) {
        p.fill(acc[0], acc[1], acc[2], 40);
        p.stroke(acc[0], acc[1], acc[2]);
        p.strokeWeight(2);
        p.rect(rx, ry, rw, rh);
      }
    }
    // active contour on top
    p.noFill();
    p.stroke(acc[0], acc[1], acc[2]);
    p.strokeWeight(2.2);
    if (S.activeSegs.count) strokeSegments(p, view, S.activeSegs.segs, S.activeSegs.count);
    // lattice sample dots
    if (S.opts.lattice && cellPx >= 10) drawDots(p, S, cellPx, pal);
    if (S.selInfo) drawSelectedDetail(p, S, acc);
  });
}

function drawDots(p, S, cellPx, pal) {
  const { view, grid, level } = S;
  const b = grid.bounds;
  const dx = (b.xmax - b.xmin) / grid.nx, dy = (b.ymax - b.ymin) / grid.ny;
  const i0 = Math.max(0, Math.floor((view.xmin - b.xmin) / dx)), i1 = Math.min(grid.nx, Math.ceil((view.xmax - b.xmin) / dx));
  const j0 = Math.max(0, Math.floor((view.ymin - b.ymin) / dy)), j1 = Math.min(grid.ny, Math.ceil((view.ymax - b.ymin) / dy));
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 3200) return;
  const d = Math.max(4, Math.min(11, cellPx * 0.3));
  const glyphs = cellPx >= 22;
  p.strokeWeight(1);
  if (glyphs) { p.textFont(MONO); p.textSize(Math.max(8, Math.min(12, d))); p.textAlign(p.CENTER, p.CENTER); }
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const v = grid.values[i + (grid.nx + 1) * j];
      const inside = v < level;
      const x = view.toX(b.xmin + i * dx), y = view.toY(b.ymin + j * dy);
      if (!finite(x, y)) continue;
      const c = inside ? INSIDE : OUTSIDE;
      p.stroke(pal.dark ? 20 : 250, 200);
      p.fill(c[0], c[1], c[2], inside ? 255 : 200);
      p.circle(x, y, d);
      if (glyphs) {
        p.noStroke();
        p.fill(10, 10, 10);
        p.text(inside ? '-' : '+', x, y - 0.5);
      }
    }
  }
}

function drawSelectedDetail(p, S, acc) {
  const { view, selInfo } = S;
  p.strokeWeight(3.5);
  p.stroke(255, 255, 255, 230);
  for (const s of selInfo.segments) p.line(view.toX(s.p0[0]), view.toY(s.p0[1]), view.toX(s.p1[0]), view.toY(s.p1[1]));
  p.stroke(acc[0], acc[1], acc[2]);
  p.strokeWeight(2);
  for (const s of selInfo.segments) p.line(view.toX(s.p0[0]), view.toY(s.p0[1]), view.toX(s.p1[0]), view.toY(s.p1[1]));
  p.fill(255, 80, 80);
  p.stroke(20);
  p.strokeWeight(1);
  for (const e of selInfo.crossedEdges) {
    const c = selInfo.crossings[e];
    p.circle(view.toX(c.x), view.toY(c.y), 7);
  }
}

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Greedy word wrap with p.textWidth; continuation lines keep a 4-space indent. */
export function wrapText(p, str, maxW) {
  if (p.textWidth(str) <= maxW) return [str];
  const words = str.split(' ');
  const out = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && p.textWidth(trial) > maxW) { out.push(cur); cur = `    ${w}`; } else cur = trial;
  }
  if (cur) out.push(cur);
  return out;
}

/** Semi-transparent panel behind text. */
export function panel(p, pal, x, y, w, h) {
  p.stroke(pal.border);
  p.strokeWeight(1);
  p.fill(pal.dark ? 'rgba(20,22,26,0.88)' : 'rgba(250,250,250,0.92)');
  p.rect(x, y, w, h, 6);
}

/** CELL INSPECTOR: small diagram of the square plus the explanation lines. */
export function drawInspector2D(p, S, canvasRect) {
  const { selInfo: info, pal } = S;
  if (!info) return null;
  const acc = accentFor(pal);
  const W = Math.max(220, Math.min(430, canvasRect.w * 0.46));
  const x = canvasRect.x + canvasRect.w - W - 10, y = canvasRect.y + 10;
  p.textFont(MONO);
  p.textSize(11);
  p.textAlign(p.LEFT, p.TOP);
  const lines = [];
  for (const l of describeSquareCell(info)) lines.push(...wrapText(p, l, W - 20));
  const diagram = 118;
  const H = Math.min(canvasRect.h - 20, 14 + diagram + lines.length * 14 + 8);
  panel(p, pal, x, y, W, H);
  // title
  p.noStroke();
  p.fill(acc[0], acc[1], acc[2]);
  p.text('CELL INSPECTOR', x + 10, y + 8);
  // diagram
  const sz = 78, dxm = x + 40, dym = y + 28;
  const cx = [dxm, dxm + sz, dxm + sz, dxm], cy = [dym + sz, dym + sz, dym, dym];
  p.stroke(pal.axis);
  p.strokeWeight(1.5);
  p.noFill();
  p.rect(dxm, dym, sz, sz);
  for (const s of info.segments) {
    const f = (pt) => [dxm + ((pt[0] - info.x0) / (info.x1 - info.x0)) * sz, dym + sz - ((pt[1] - info.y0) / (info.y1 - info.y0)) * sz];
    const a = f(s.p0), b2 = f(s.p1);
    if (finite(a[0], a[1], b2[0], b2[1])) {
      p.stroke(acc[0], acc[1], acc[2]);
      p.strokeWeight(2.5);
      p.line(a[0], a[1], b2[0], b2[1]);
    }
  }
  p.textAlign(p.CENTER, p.CENTER);
  info.corners.forEach((c, n) => {
    const col = c.inside ? INSIDE : OUTSIDE;
    p.stroke(pal.dark ? 20 : 250);
    p.strokeWeight(1);
    p.fill(col[0], col[1], col[2]);
    p.circle(cx[n], cy[n], 12);
    p.noStroke();
    p.fill(pal.fg);
    const ox = n === 0 || n === 3 ? -15 : 15, oy = n < 2 ? 12 : -12;
    p.text(`c${n}`, cx[n] + ox, cy[n] + oy);
  });
  p.fill(pal.muted);
  p.text('e0', dxm + sz / 2, dym + sz + 11);
  p.text('e2', dxm + sz / 2, dym - 11);
  p.text('e3', dxm - 14, dym + sz / 2);
  p.text('e1', dxm + sz + 14, dym + sz / 2);
  p.fill(pal.fg);
  p.textAlign(p.LEFT, p.TOP);
  p.text(`case ${info.caseIndex}`, x + 150, y + 36);
  p.text(`0b${info.bits}`, x + 150, y + 54);
  p.fill(pal.muted);
  p.text(`${info.segments.length} segment(s)`, x + 150, y + 72);
  // text lines
  p.fill(pal.fg);
  let ty = y + 14 + diagram;
  for (const l of lines) {
    if (ty > y + H - 14) break;
    p.text(l, x + 10, ty);
    ty += 14;
  }
  return { x, y, w: W, h: H };
}
