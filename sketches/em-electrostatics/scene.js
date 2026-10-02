// Field visualisation shared by the Charges and Gauss tabs: colour maps, field lines, equipotentials,
// arrow grid and the test particle. Expensive layers are cached by the inputs they depend on.

import { marchingSquares } from '../../lib/marching.js';
import {
  fieldAt, potentialAt, fieldGrid, equipotentialLevels, traceAll, percentile, stepParticle, particleEnergy,
} from '../../lib/em/electrostatics.js';
import { colormapInto, logUnit } from '../../lib/em/colormap.js';
import { POS, NEG, arrowVerts, polyline, finite, clamp } from './draw.js';

const f4 = (v) => v.toFixed(4);
const viewKey = (v) => `${f4(v.xmin)},${f4(v.xmax)},${f4(v.ymin)},${f4(v.ymax)},${v.rect.w}x${v.rect.h}`;

/** Colour-map image (|E| on a log scale or signed V) at `cell` px per pixel block. Cached. */
export function mapImage(S, law, mode, cell) {
  const { p, view, charges, cache } = S;
  const soft = S.get('soft');
  const key = [mode, law, soft, S.chVer, viewKey(view), cell, S.pal.dark].join('|');
  if (cache.mapKey === key) return cache.map;
  const cw = Math.max(2, Math.ceil(view.rect.w / cell)), ch = Math.max(2, Math.ceil(view.rect.h / cell));
  let img = cache.map;
  if (!img || img.width !== cw || img.height !== ch) img = p.createImage(cw, ch);
  const vals = new Float32Array(cw * ch);
  const e = [0, 0];
  for (let j = 0; j < ch; j++) {
    const y = view.fromY(view.rect.y + (j + 0.5) * cell);
    for (let i = 0; i < cw; i++) {
      const x = view.fromX(view.rect.x + (i + 0.5) * cell);
      vals[i + cw * j] = mode === 'V' ? potentialAt(charges, x, y, law, soft) : (fieldAt(charges, x, y, law, soft, e), Math.hypot(e[0], e[1]));
    }
  }
  let lo = 1, hi = 10, vs = 1;
  if (mode === 'E') {
    const sample = new Float32Array(Math.ceil(vals.length / 7));
    for (let i = 0; i < sample.length; i++) sample[i] = vals[i * 7];
    hi = Math.max(percentile(sample, 0.985), 1e-12);
    lo = Math.max(percentile(sample, 0.04), hi * 1e-4);
  } else {
    const abs = new Float32Array(Math.ceil(vals.length / 7));
    for (let i = 0; i < abs.length; i++) abs[i] = Math.abs(vals[i * 7]);
    vs = Math.max(percentile(abs, 0.6), 1e-12);
  }
  img.loadPixels();
  const rgb = [0, 0, 0];
  const cm = mode === 'E' ? (S.pal.dark ? 'inferno' : 'viridis') : (S.pal.dark ? 'divergingDark' : 'diverging');
  for (let k = 0; k < vals.length; k++) {
    const v = vals[k];
    const t = !finite(v) ? 0 : mode === 'E' ? logUnit(v, lo, hi) : 0.5 + 0.5 * v / (Math.abs(v) + vs);
    colormapInto(cm, t, rgb);
    const o = k * 4;
    img.pixels[o] = rgb[0]; img.pixels[o + 1] = rgb[1]; img.pixels[o + 2] = rgb[2]; img.pixels[o + 3] = 255;
  }
  img.updatePixels();
  cache.map = img;
  cache.mapKey = key;
  return img;
}

/** Cached field lines for the current charges / view. */
export function lines(S, law) {
  const { view, charges, cache } = S;
  const perUnit = S.get('perUnit'), soft = S.get('soft');
  const key = [law, soft, perUnit, S.chVer, viewKey(view)].join('|');
  if (cache.linesKey === key) return cache.lines;
  const scale = view.rect.w / (view.xmax - view.xmin); // px per world unit
  const step = clamp(7 / scale, 0.01, 0.6);
  const padX = (view.xmax - view.xmin) * 0.25, padY = (view.ymax - view.ymin) * 0.25;
  const bounds = { xmin: view.xmin - padX, xmax: view.xmax + padX, ymin: view.ymin - padY, ymax: view.ymax + padY };
  const stopR = clamp(10 / scale, 0.02, 0.3);
  cache.lines = traceAll(charges, { law, soft: 0, perUnit, seedRadius: stopR * 1.8, stopRadius: stopR, step, adaptive: true, minStep: step / 12, maxSteps: 900, bounds });
  cache.linesKey = key;
  return cache.lines;
}

/** Cached equipotential segments: [{ level, seg: Float64Array, count }]. */
export function equipotentials(S, law) {
  const { view, charges, cache } = S;
  const soft = S.get('soft'), count = S.get('equiCount'), log = !!S.get('equiLog');
  const res = S.dragging ? 70 : 120;
  const key = [law, soft, count, log, res, S.chVer, viewKey(view)].join('|');
  if (cache.equiKey === key) return cache.equi;
  const nx = res, ny = Math.max(8, Math.round(res * view.rect.h / view.rect.w));
  const b = { xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax };
  const g = fieldGrid(charges, b, nx, ny, law, soft);
  const levels = charges.length ? equipotentialLevels(g.v, count, log) : [];
  cache.equi = levels.map((level) => {
    const r = marchingSquares({ values: g.v, nx, ny, bounds: b }, { level });
    return { level, seg: r.segments, count: r.count };
  });
  cache.equiKey = key;
  return cache.equi;
}

function drawEquis(S, law) {
  const { p, view, pal } = S;
  const eq = equipotentials(S, law);
  const onMap = S.get('map') !== 'none';
  p.push();
  p.strokeWeight(1.1);
  const groups = [['pos', (l) => l > 0, onMap ? 'rgba(255,200,150,0.75)' : 'rgba(255,120,90,0.65)'],
    ['neg', (l) => l < 0, onMap ? 'rgba(160,215,255,0.75)' : 'rgba(90,160,255,0.65)'],
    ['zero', (l) => l === 0, pal.fg]];
  for (const [, test, col] of groups) {
    p.stroke(col);
    p.beginShape(p.LINES);
    for (const { level, seg, count } of eq) {
      if (!test(level)) continue;
      for (let k = 0; k < count; k++) {
        const x0 = view.toX(seg[4 * k]), y0 = view.toY(seg[4 * k + 1]), x1 = view.toX(seg[4 * k + 2]), y1 = view.toY(seg[4 * k + 3]);
        if (finite(x0 + y0 + x1 + y1)) { p.vertex(x0, y0); p.vertex(x1, y1); }
      }
    }
    p.endShape();
  }
  p.pop();
}

function drawLines(S, law) {
  const { p, view, pal } = S;
  const ls = lines(S, law);
  const onMap = S.get('map') !== 'none';
  p.push();
  p.noFill();
  p.strokeWeight(1.3);
  p.stroke(onMap ? 'rgba(255,255,255,0.85)' : pal.fg);
  for (const l of ls) polyline(p, view, l.pts, 2.5);
  // direction arrowheads at the midpoint of each line
  p.fill(onMap ? '#ffffff' : pal.fg);
  p.noStroke();
  p.beginShape(p.TRIANGLES);
  for (const l of ls) {
    const n = l.pts.length / 2;
    if (n < 6) continue;
    const m = Math.floor(n / 2);
    const x0 = view.toX(l.pts[2 * m]), y0 = view.toY(l.pts[2 * m + 1]);
    const x1 = view.toX(l.pts[2 * m + 2]), y1 = view.toY(l.pts[2 * m + 3]);
    let dx = x1 - x0, dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (!(d > 1e-6)) continue;
    dx /= d; dy /= d;
    if (l.dir < 0) { dx = -dx; dy = -dy; } // traced backwards: E points toward the seed
    const cx = x0, cy = y0, s = 5;
    p.vertex(cx + dx * s, cy + dy * s);
    p.vertex(cx - dx * s - dy * s * 0.6, cy - dy * s + dx * s * 0.6);
    p.vertex(cx - dx * s + dy * s * 0.6, cy - dy * s - dx * s * 0.6);
  }
  p.endShape();
  p.pop();
}

function drawArrows(S, law) {
  const { p, view, charges, pal } = S;
  const soft = S.get('soft');
  const sp = 44;
  const e = [0, 0];
  p.push();
  p.stroke(pal.dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)');
  p.strokeWeight(1);
  p.beginShape(p.LINES);
  for (let sy = view.rect.y + sp / 2; sy < view.rect.y + view.rect.h; sy += sp) {
    for (let sx = view.rect.x + sp / 2; sx < view.rect.x + view.rect.w; sx += sp) {
      fieldAt(charges, view.fromX(sx), view.fromY(sy), law, soft, e);
      const m = Math.hypot(e[0], e[1]);
      if (!(m > 1e-12)) continue;
      // length encodes log magnitude (12..30 px)
      const L = clamp(12 + 6 * Math.log10(m / 1e-3 + 1), 8, 32);
      const ux = e[0] / m, uy = -e[1] / m;
      arrowVerts(p, sx - ux * L / 2, sy - uy * L / 2, sx + ux * L / 2, sy + uy * L / 2, 5);
    }
  }
  p.endShape();
  p.pop();
}

/** Draw the field layers selected in the settings. `opts` can override: lines, equi, arrows, map. */
export function drawField(S, law, opts = {}) {
  const { p, view } = S;
  const map = opts.map !== undefined ? opts.map : S.get('map');
  p.background(S.pal.bg);
  if (map !== 'none' && S.charges.length) {
    const img = mapImage(S, law, map, S.dragging ? 8 : 4);
    p.image(img, view.rect.x, view.rect.y, view.rect.w, view.rect.h);
  }
}

export function drawLayers(S, law, opts = {}) {
  if ((opts.equi !== undefined ? opts.equi : S.get('equi')) && S.charges.length) drawEquis(S, law);
  if ((opts.arrows !== undefined ? opts.arrows : S.get('arrows')) && S.charges.length) drawArrows(S, law);
  if ((opts.lines !== undefined ? opts.lines : S.get('lines')) && S.charges.length) drawLines(S, law);
}

// ---------------------------------------------------------------------------------------------
// Test particle
// ---------------------------------------------------------------------------------------------

/** Launch a test charge from (x, y) with velocity (vx, vy). */
export function launch(S, x, y, vx, vy) {
  const law = S.lawNow();
  const state = [x, y, vx, vy];
  S.particle = {
    state, trail: [x, y], t: 0, alive: true,
    E0: particleEnergy(state, S.charges, S.get('pq'), S.get('pm'), law, S.get('soft')),
    law,
  };
}

/** Advance the particle by dt seconds of simulated time (adaptive substeps, capped work). */
export function stepTestParticle(S, dt) {
  const pt = S.particle;
  if (!pt || !pt.alive) return;
  const qt = S.get('pq'), m = Math.max(1e-3, S.get('pm')), soft = Math.max(0.01, S.get('soft'));
  let left = dt;
  let guard = 0;
  while (left > 1e-9 && guard++ < 400) {
    const [x, y, vx, vy] = pt.state;
    let dmin = Infinity;
    for (const c of S.charges) dmin = Math.min(dmin, Math.hypot(x - c.x, y - c.y));
    const speed = Math.hypot(vx, vy) + 1e-3;
    const h = Math.min(left, 0.02, 0.05 * Math.max(dmin, soft) / speed);
    pt.state = stepParticle(pt.state, S.charges, qt, m, h, pt.law, soft);
    left -= h;
    pt.t += h;
    if (!pt.state.every(finite) || Math.abs(pt.state[0]) > 200 || Math.abs(pt.state[1]) > 200) { pt.alive = false; break; }
  }
  const tr = pt.trail;
  tr.push(pt.state[0], pt.state[1]);
  if (tr.length > 1600) tr.splice(0, tr.length - 1600);
}

export function particleReadout(S) {
  const pt = S.particle;
  if (!pt) return null;
  const [x, y, vx, vy] = pt.state;
  const qt = S.get('pq'), m = S.get('pm'), soft = Math.max(0.01, S.get('soft'));
  const ke = 0.5 * m * (vx * vx + vy * vy);
  const total = particleEnergy(pt.state, S.charges, qt, m, pt.law, soft);
  return { x, y, speed: Math.hypot(vx, vy), ke, pe: total - ke, total, drift: pt.E0 !== 0 ? (total - pt.E0) / Math.abs(pt.E0) : total - pt.E0, alive: pt.alive };
}

export function drawParticle(S) {
  const { p, view, pal } = S;
  const pt = S.particle;
  if (!pt) return;
  p.push();
  p.noFill();
  p.stroke(255, 210, 80, 220);
  p.strokeWeight(1.6);
  polyline(p, view, pt.trail, 2);
  const sx = view.toX(pt.state[0]), sy = view.toY(pt.state[1]);
  if (finite(sx) && finite(sy)) {
    p.stroke(pal.bg);
    p.fill(S.get('pq') >= 0 ? POS : NEG);
    p.circle(sx, sy, 10);
  }
  p.pop();
}
