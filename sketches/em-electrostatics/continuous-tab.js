// Continuous tab: axisymmetric charge distributions (rod, ring, disk, uniform ball, gaussian blob) integrated numerically
// (rings summed with the azimuth integrated by quadrature) in the half-plane through the symmetry axis z.
// World view: horizontal = rho (signed, the mirror half-plane), vertical = z. The profile plot compares the numerical
// field on the axis (or in the mid plane) with the analytic formula and the point-charge far field Q / (4 pi r^2).

import { marchingSquares } from '../../lib/marching.js';
import {
  makeRings, ringsFieldAt, ringsAxisField, analyticAxisField, analyticRadialField, monopoleField, ringsCharge, equipotentialLevels, percentile,
} from '../../lib/em/electrostatics.js';
import { colormapInto, logUnit } from '../../lib/em/colormap.js';
import { drawAxes, hudBox, fmt, clamp, finite } from './draw.js';

const KIND_TEXT = {
  rod: 'E_z(z) = (λ/4πε₀)[1/(z-L/2) - 1/(z+L/2)],  λ = Q/L   (end-on)',
  ring: 'E_z(z) = Q z / (4πε₀ (z²+a²)^{3/2})',
  disk: 'E_z(z) = (σ/2ε₀)(1 - z/√(z²+a²)),  σ = Q/πa²',
  ball: 'E(r) = Q r / (4πε₀ R³) inside, Q / (4πε₀ r²) outside',
  gauss: 'E(r) = Q/(4πε₀ r²) [erf(r/√2σ) - √(2/π)(r/σ) e^{-r²/2σ²}]',
};

export function contParams(S) {
  return { kind: S.get('cont.kind'), Q: S.get('cont.Q'), size: Math.max(0.05, S.get('cont.size')), n: S.get('cont.res') };
}

export function contRings(S) {
  const c = contParams(S);
  const key = `${c.kind}|${c.Q}|${c.size}|${c.n}`;
  if (S.cache.ringsKey !== key) {
    S.cache.rings = makeRings(c.kind, { Q: c.Q, size: c.size, n: c.n });
    S.cache.ringsKey = key;
  }
  return S.cache.rings;
}

function contGrid(S) {
  const { view, cache } = S;
  const c = contParams(S);
  const heavy = c.kind === 'ball' || c.kind === 'gauss';
  const gx = heavy ? 48 : 72;
  const gy = Math.max(8, Math.round(gx * view.rect.h / view.rect.w));
  const key = [contRingsKeyOf(S), gx, gy, view.xmin.toFixed(4), view.xmax.toFixed(4), view.ymin.toFixed(4), view.ymax.toFixed(4), S.pal.dark].join('|');
  if (cache.gridKey === key) return cache.grid;
  const rings = contRings(S);
  const n = (gx + 1) * (gy + 1);
  const v = new Float32Array(n), mag = new Float32Array(n);
  for (let j = 0; j <= gy; j++) {
    const z = view.ymin + (view.ymax - view.ymin) * j / gy;
    for (let i = 0; i <= gx; i++) {
      const x = view.xmin + (view.xmax - view.xmin) * i / gx;
      const r = ringsFieldAt(rings, x, z, 24);
      v[i + (gx + 1) * j] = r.V;
      mag[i + (gx + 1) * j] = Math.hypot(r.Ex, r.Ez);
    }
  }
  // image
  const { p } = S;
  let img = cache.contImg;
  if (!img || img.width !== gx + 1 || img.height !== gy + 1) img = p.createImage(gx + 1, gy + 1);
  const hi = Math.max(percentile(mag, 0.985), 1e-12), lo = Math.max(percentile(mag, 0.04), hi * 1e-4);
  img.loadPixels();
  const rgb = [0, 0, 0];
  for (let j = 0; j <= gy; j++) {
    for (let i = 0; i <= gx; i++) {
      const t = logUnit(mag[i + (gx + 1) * j], lo, hi);
      colormapInto(S.pal.dark ? 'inferno' : 'viridis', t, rgb);
      const o = (i + (gx + 1) * (gy - j)) * 4; // image rows run top-down
      img.pixels[o] = rgb[0]; img.pixels[o + 1] = rgb[1]; img.pixels[o + 2] = rgb[2]; img.pixels[o + 3] = 255;
    }
  }
  img.updatePixels();
  const b = { xmin: view.xmin, xmax: view.xmax, ymin: view.ymin, ymax: view.ymax };
  const levels = equipotentialLevels(v, 12, false).filter((l) => l !== 0);
  const contours = levels.map((level) => {
    const r = marchingSquares({ values: v, nx: gx, ny: gy, bounds: b }, { level });
    return { seg: r.segments, count: r.count };
  });
  cache.grid = { gx, gy, img, contours };
  cache.contImg = img;
  cache.gridKey = key;
  return cache.grid;
}

function contRingsKeyOf(S) {
  const c = contParams(S);
  return `${c.kind}|${c.Q}|${c.size}|${c.n}`;
}

/** Profile samples { t[], num[], ana[], mono[] } for the chosen profile (axis: E_z(z), radial: E_rho(rho) at z = 0). */
export function profile(S, count = 160) {
  const c = contParams(S);
  const rings = contRings(S);
  const axis = S.get('cont.profile') === 'axis';
  const R = Math.max(4, 4.5 * c.size);
  const t = [], num = [], ana = [], mono = [];
  for (let i = 0; i < count; i++) {
    const s = -R + (2 * R * (i + 0.5)) / count;
    t.push(s);
    num.push(axis ? ringsAxisField(rings, s) : ringsFieldAt(rings, s, 0, 32).Ex);
    ana.push(axis ? analyticAxisField(c.kind, { Q: c.Q, size: c.size }, s) : analyticRadialField(c.kind, { Q: c.Q, size: c.size }, s));
    mono.push(Math.sign(s) * monopoleField(c.Q, Math.abs(s)));
  }
  return { t, num, ana, mono, R };
}

export function drawContinuous(S) {
  const { p, view, pal } = S;
  const c = contParams(S);
  const rings = contRings(S);
  const grid = contGrid(S);
  p.background(pal.bg);
  // clip to the world rect (push / pop keep p5's cached style in sync)
  p.push();
  S.ctx2d.beginPath();
  S.ctx2d.rect(view.rect.x, view.rect.y, view.rect.w, view.rect.h);
  S.ctx2d.clip();
  p.image(grid.img, view.rect.x, view.rect.y, view.rect.w, view.rect.h);
  p.stroke(pal.dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)');
  p.strokeWeight(1);
  p.beginShape(p.LINES);
  for (const { seg, count } of grid.contours) {
    for (let k = 0; k < count; k++) {
      const x0 = view.toX(seg[4 * k]), y0 = view.toY(seg[4 * k + 1]), x1 = view.toX(seg[4 * k + 2]), y1 = view.toY(seg[4 * k + 3]);
      if (finite(x0 + y0 + x1 + y1)) { p.vertex(x0, y0); p.vertex(x1, y1); }
    }
  }
  p.endShape();
  // arrows
  p.stroke('rgba(0,0,0,0.55)');
  p.beginShape(p.LINES);
  const sp = 52;
  for (let sy = view.rect.y + sp / 2; sy < view.rect.y + view.rect.h; sy += sp) {
    for (let sx = view.rect.x + sp / 2; sx < view.rect.x + view.rect.w; sx += sp) {
      const r = ringsFieldAt(rings, view.fromX(sx), view.fromY(sy), 16);
      const m = Math.hypot(r.Ex, r.Ez);
      if (!(m > 1e-14)) continue;
      const ux = r.Ex / m, uy = -r.Ez / m, L = 14;
      p.vertex(sx - ux * L / 2, sy - uy * L / 2); p.vertex(sx + ux * L / 2, sy + uy * L / 2);
      p.vertex(sx + ux * L / 2, sy + uy * L / 2); p.vertex(sx + ux * L / 2 - ux * 5 - uy * 3, sy + uy * L / 2 - uy * 5 + ux * 3);
      p.vertex(sx + ux * L / 2, sy + uy * L / 2); p.vertex(sx + ux * L / 2 - ux * 5 + uy * 3, sy + uy * L / 2 - uy * 5 - ux * 3);
    }
  }
  p.endShape();
  // the distribution itself
  const col = c.Q >= 0 ? '#ff5a4f' : '#4aa3ff';
  p.stroke(col);
  p.strokeWeight(3);
  p.fill(c.Q >= 0 ? 'rgba(255,90,79,0.25)' : 'rgba(74,163,255,0.25)');
  const X = (x) => view.toX(x), Y = (y) => view.toY(y);
  const sc = view.rect.w / (view.xmax - view.xmin);
  if (c.kind === 'rod') p.line(X(0), Y(-c.size / 2), X(0), Y(c.size / 2));
  else if (c.kind === 'ring') { p.noStroke(); p.fill(col); p.circle(X(c.size), Y(0), 9); p.circle(X(-c.size), Y(0), 9); }
  else if (c.kind === 'disk') p.line(X(-c.size), Y(0), X(c.size), Y(0));
  else if (c.kind === 'ball') p.circle(X(0), Y(0), 2 * c.size * sc);
  else { for (const k of [1, 2, 3]) p.circle(X(0), Y(0), 2 * k * c.size * sc); }
  p.pop();
  drawAxes(p, { ...pal, grid: 'rgba(0,0,0,0)' }, view, { xLabel: 'ρ', yLabel: 'z  (symmetry axis)', grid: false });

  // hover read-outs
  const mx = p.mouseX, my = p.mouseY;
  const lines = [[`${c.kind}   Q = ${fmt(c.Q)}   size = ${fmt(c.size)}   (${c.n} nodes, azimuth by quadrature)`, pal.muted]];
  if (view.contains(mx, my)) {
    const wx = view.fromX(mx), wz = view.fromY(my);
    const r = ringsFieldAt(rings, wx, wz, 48);
    lines.push(`cursor (ρ, z) = (${fmt(wx, 3)}, ${fmt(wz, 3)})`, `V = ${fmt(r.V)}    |E| = ${fmt(Math.hypot(r.Ex, r.Ez))}`);
  }
  const R = 10 * c.size;
  const farNum = Math.hypot(ringsFieldAt(rings, 0.6 * R, 0.8 * R, 32).Ex, ringsFieldAt(rings, 0.6 * R, 0.8 * R, 32).Ez);
  lines.push(`far field at r = ${fmt(R)}: |E| / (Q/4πr²) = ${fmt(farNum / Math.abs(monopoleField(c.Q, R)), 5)}`);
  lines.push([`total charge (sum of rings) = ${fmt(ringsCharge(rings), 6)}`, pal.muted]);
  hudBox(p, pal, 12, 12, lines, { w: 360 });
  drawProfile(S);
}

function drawProfile(S) {
  const { p, pal } = S;
  const c = contParams(S);
  const pr = profile(S);
  const axis = S.get('cont.profile') === 'axis';
  const top = S.view.rect.h + 6;
  const x = 46, y = top + 18, w = p.width - x - 18, h = p.height - y - 30;
  if (h < 40) return;
  p.push();
  p.noStroke();
  p.fill(pal.panel);
  p.rect(0, top, p.width, p.height - top);
  p.fill(pal.fg);
  p.textSize(11);
  p.textAlign(p.LEFT, p.TOP);
  p.text(axis ? `field on the axis E_z(z)     analytic: ${KIND_TEXT[c.kind]}` : `field in the mid plane E_ρ(ρ) at z = 0   (${c.kind === 'ring' || c.kind === 'disk' ? 'no simple closed form: numerical only' : KIND_TEXT[c.kind]})`, x, top + 3);
  // range
  const vals = [];
  for (const v of pr.num) if (finite(v)) vals.push(Math.abs(v));
  const emax = Math.max(percentile(vals, 0.97) * 1.1, 1e-12);
  const X = (t) => x + w * (t + pr.R) / (2 * pr.R);
  const Y = (v) => y + h * (0.5 - 0.5 * clamp(v / emax, -1.05, 1.05));
  p.stroke(pal.grid);
  p.line(x, Y(0), x + w, Y(0));
  p.line(X(0), y, X(0), y + h);
  p.noStroke();
  p.fill(pal.muted);
  p.textSize(10);
  p.textAlign(p.CENTER, p.TOP);
  p.text(axis ? 'z' : 'ρ', X(0), y + h + 3);
  p.text(fmt(-pr.R), X(-pr.R) + 8, y + h + 3);
  p.text(fmt(pr.R), X(pr.R) - 10, y + h + 3);
  p.textAlign(p.RIGHT, p.CENTER);
  p.text(fmt(emax), x - 4, y);
  p.text('E', x - 4, Y(0));
  p.text(fmt(-emax), x - 4, y + h);
  // monopole (dashed)
  p.stroke(pal.muted);
  p.strokeWeight(1);
  for (let i = 0; i + 1 < pr.t.length; i += 3) {
    if (!finite(pr.mono[i]) || !finite(pr.mono[i + 1]) || Math.abs(pr.mono[i]) > emax * 1.2 || Math.abs(pr.mono[i + 1]) > emax * 1.2) continue;
    p.line(X(pr.t[i]), Y(pr.mono[i]), X(pr.t[i + 1]), Y(pr.mono[i + 1]));
  }
  // analytic curve
  p.stroke('#2ecc71');
  p.strokeWeight(2);
  p.noFill();
  p.beginShape();
  let open = false;
  for (let i = 0; i < pr.t.length; i++) {
    if (!finite(pr.ana[i])) { if (open) { p.endShape(); p.beginShape(); open = false; } continue; }
    p.vertex(X(pr.t[i]), Y(pr.ana[i]));
    open = true;
  }
  p.endShape();
  // numerical points
  p.noStroke();
  p.fill('#ffb020');
  for (let i = 0; i < pr.t.length; i += 4) if (finite(pr.num[i])) p.circle(X(pr.t[i]), Y(pr.num[i]), 4);
  // legend + cursor
  p.textAlign(p.LEFT, p.TOP);
  p.textSize(10);
  p.fill('#ffb020'); p.text('numerical quadrature', x + 8, y + 2);
  p.fill('#2ecc71'); p.text('analytic', x + 140, y + 2);
  p.fill(pal.muted); p.text('point charge Q/(4πr²)', x + 200, y + 2);
  const { view } = S;
  if (view.contains(p.mouseX, p.mouseY)) {
    const t = axis ? view.fromY(p.mouseY) : view.fromX(p.mouseX);
    if (Math.abs(t) < pr.R) {
      const rings = contRings(S);
      const num = axis ? ringsAxisField(rings, t) : ringsFieldAt(rings, t, 0, 48).Ex;
      const ana = axis ? analyticAxisField(c.kind, { Q: c.Q, size: c.size }, t) : analyticRadialField(c.kind, { Q: c.Q, size: c.size }, t);
      p.stroke(pal.fg);
      p.strokeWeight(1);
      p.line(X(t), y, X(t), y + h);
      p.noStroke();
      p.fill(pal.fg);
      p.textAlign(p.LEFT, p.BOTTOM);
      const rel = finite(ana) && Math.abs(ana) > 1e-14 ? (num - ana) / Math.abs(ana) : NaN;
      p.text(`${axis ? 'z' : 'ρ'} = ${fmt(t, 3)}   E_num = ${fmt(num)}   E_analytic = ${fmt(ana)}   rel. error = ${finite(rel) ? fmt(rel, 2) : '-'}`, x + 6, y + h - 4);
    }
  }
  p.pop();
}
