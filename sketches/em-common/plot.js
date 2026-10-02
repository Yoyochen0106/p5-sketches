// 2D plotting helpers on a p5 canvas (shared by the electromagnetics units).

/** Runs fn with drawing clipped to rect {x, y, w, h}. */
export function clipped(p, rect, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.rect(rect.x, rect.y, rect.w, rect.h);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

/** Runs fn with drawing clipped to a disc. */
export function clippedDisc(p, cx, cy, r, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

/** "Nice" tick values between lo and hi (about n of them). */
export function niceTicks(lo, hi, n = 6) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const tickText = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(0) : String(Number(v.toPrecision(4))));

/**
 * Draws a framed plot area with grid, ticks and axis labels. Returns { X, Y, iX, iY, rect } mapping data to pixels.
 * o: { xmin, xmax, ymin, ymax, xlabel, ylabel, title, xticks, yticks, xfmt, yfmt, nx, ny }
 */
export function plotFrame(p, pal, rect, o) {
  const X = (x) => rect.x + ((x - o.xmin) / (o.xmax - o.xmin)) * rect.w;
  const Y = (y) => rect.y + rect.h - ((y - o.ymin) / (o.ymax - o.ymin)) * rect.h;
  const iX = (px) => o.xmin + ((px - rect.x) / rect.w) * (o.xmax - o.xmin);
  const iY = (py) => o.ymin + ((rect.y + rect.h - py) / rect.h) * (o.ymax - o.ymin);
  p.noStroke();
  p.fill(pal.panel);
  p.rect(rect.x, rect.y, rect.w, rect.h);
  const xt = o.xticks || niceTicks(o.xmin, o.xmax, o.nx || Math.max(2, Math.floor(rect.w / 80)));
  const yt = o.yticks || niceTicks(o.ymin, o.ymax, o.ny || Math.max(2, Math.floor(rect.h / 46)));
  p.strokeWeight(1);
  p.textSize(10);
  for (const v of xt) {
    const px = X(v);
    p.stroke(pal.grid);
    p.line(px, rect.y, px, rect.y + rect.h);
    p.noStroke(); p.fill(pal.muted);
    p.textAlign(p.CENTER, p.TOP);
    p.text(o.xfmt ? o.xfmt(v) : tickText(v), px, rect.y + rect.h + 3);
  }
  for (const v of yt) {
    const py = Y(v);
    p.stroke(v === 0 ? pal.axis : pal.grid);
    p.line(rect.x, py, rect.x + rect.w, py);
    p.noStroke(); p.fill(pal.muted);
    p.textAlign(p.RIGHT, p.CENTER);
    p.text(o.yfmt ? o.yfmt(v) : tickText(v), rect.x - 4, py);
  }
  p.noFill(); p.stroke(pal.axis);
  p.rect(rect.x, rect.y, rect.w, rect.h);
  p.noStroke(); p.fill(pal.muted);
  p.textSize(11);
  if (o.xlabel) { p.textAlign(p.CENTER, p.TOP); p.text(o.xlabel, rect.x + rect.w / 2, rect.y + rect.h + 16); }
  if (o.title) { p.fill(pal.fg); p.textAlign(p.LEFT, p.BOTTOM); p.text(o.title, rect.x, rect.y - 3); }
  if (o.ylabel) {
    p.push();
    p.translate(rect.x - 38, rect.y + rect.h / 2);
    p.rotate(-Math.PI / 2);
    p.textAlign(p.CENTER, p.CENTER);
    p.fill(pal.muted);
    p.text(o.ylabel, 0, 0);
    p.pop();
  }
  return { X, Y, iX, iY, rect };
}

/** Polyline through (xs[i], ys[i]) given as data arrays and mappers; breaks at non-finite values. */
export function polyline(p, xs, ys, X, Y, step = 1) {
  p.noFill();
  let open = false;
  for (let i = 0; i < xs.length; i += step) {
    const x = X(xs[i]), y = Y(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 1e6) {
      if (open) { p.endShape(); open = false; }
      continue;
    }
    if (!open) { p.beginShape(); open = true; }
    p.vertex(x, y);
  }
  if (open) p.endShape();
}

/** Polyline through pixel points [[x, y], ...]. */
export function polylinePx(p, pts) {
  p.noFill();
  let open = false;
  for (const q of pts) {
    if (!q || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) {
      if (open) { p.endShape(); open = false; }
      continue;
    }
    if (!open) { p.beginShape(); open = true; }
    p.vertex(q[0], q[1]);
  }
  if (open) p.endShape();
}

/** Multi-line text block with optional per-line colours: lines are strings or { text, color }. */
export function textBlock(p, pal, lines, x, y, w, lineH = 15) {
  p.noStroke();
  p.textSize(12);
  p.textAlign(p.LEFT, p.TOP);
  let yy = y;
  for (const ln of lines) {
    const t = typeof ln === 'string' ? ln : ln.text;
    p.fill(typeof ln === 'string' ? pal.fg : ln.color || pal.fg);
    const rows = Math.max(1, Math.ceil(p.textWidth(t) / Math.max(40, w)));
    if (rows > 1) p.text(t, x, yy, w); else p.text(t, x, yy);
    yy += rows * lineH;
  }
  return yy;
}

export const COLORS = {
  blue: '#4aa3ff', orange: '#ff9f43', green: '#2ecc71', purple: '#c77dff', pink: '#ff5fa2', yellow: '#f1c40f', red: '#ff6b6b', cyan: '#2ec4d6',
};
