// Smith chart drawing and hit-testing. The chart is the unit disc of the Gamma plane, i.e. the image of
// the right half of the normalised-impedance plane under the Moebius map w = (z - 1)/(z + 1)
// (lib/em/tline.js builds it with lib/conformal.js).
import { zToGamma, rCircle, xCircle, wtgReading } from '../../lib/em/tline.js';
import { clippedDisc } from '../em-common/plot.js';

const R_VALUES = [0.2, 0.5, 1, 2, 5];
const X_VALUES = [0.2, 0.5, 1, 2, 5];

/** Maps Gamma <-> pixels for a chart of radius R centred at (cx, cy). */
export class SmithView {
  constructor(cx = 0, cy = 0, R = 100) { this.set(cx, cy, R); }
  set(cx, cy, R) { this.cx = cx; this.cy = cy; this.R = Math.max(20, R); }
  toPx(g) { return [this.cx + this.R * g[0], this.cy - this.R * g[1]]; }
  fromPx(x, y) { return [(x - this.cx) / this.R, -(y - this.cy) / this.R]; }
  /** Angle (Gamma phase, radians) of a pixel position about the chart centre. */
  angleOf(x, y) { return Math.atan2(-(y - this.cy), x - this.cx); }
}

const withAlpha = (p, hex, a) => { const c = p.color(hex); c.setAlpha(a); return c; };

/**
 * Draws the grid. opts: { showY (admittance overlay), ring (wavelength scales), labels, color }
 */
export function drawSmithGrid(p, pal, v, opts = {}) {
  const { cx, cy, R } = v;
  const gridC = withAlpha(p, pal.dark ? '#8b93a1' : '#6b7280', 110);
  const gridMajor = withAlpha(p, pal.dark ? '#8b93a1' : '#6b7280', 190);
  const yC = withAlpha(p, '#ff9f43', 70);
  p.noFill();
  p.strokeWeight(1);
  p.stroke(pal.axis);
  p.circle(cx, cy, 2 * R);
  clippedDisc(p, cx, cy, R, () => {
    p.noFill();
    for (const pass of opts.showY ? ['y', 'z'] : ['z']) {
      const sg = pass === 'y' ? -1 : 1;
      p.stroke(pass === 'y' ? yC : gridC);
      for (const r of R_VALUES) {
        const c = rCircle(r);
        if (r === 1) p.stroke(pass === 'y' ? withAlpha(p, '#ff9f43', 130) : gridMajor);
        p.circle(cx + sg * R * c.c[0], cy, 2 * R * c.r);
        if (r === 1) p.stroke(pass === 'y' ? yC : gridC);
      }
      for (const x of X_VALUES) {
        for (const s of [1, -1]) {
          const c = xCircle(s * x);
          if (x === 1) p.stroke(pass === 'y' ? withAlpha(p, '#ff9f43', 130) : gridMajor);
          p.circle(cx + sg * R * c.c[0], cy - sg * R * c.c[1], 2 * R * c.r);
          if (x === 1) p.stroke(pass === 'y' ? yC : gridC);
        }
      }
    }
    p.stroke(gridMajor);
    p.line(cx - R, cy, cx + R, cy);
  });
  if (opts.labels !== false && R > 90) {
    p.noStroke();
    p.textSize(9);
    p.fill(pal.muted);
    p.textAlign(p.CENTER, p.BOTTOM);
    for (const r of [0.2, 0.5, 1, 2, 5]) {
      const gx = (r - 1) / (r + 1);
      p.text(String(r), cx + R * gx, cy - 2);
    }
    for (const x of X_VALUES) {
      for (const s of [1, -1]) {
        const g = zToGamma([0, s * x]);
        const k = 0.9;
        p.textAlign(p.CENTER, p.CENTER);
        p.text(`${s < 0 ? '-' : ''}${x}`, cx + R * g[0] * k * 1.0 + (g[0] > 0 ? 4 : -4) * 0, cy - R * g[1] * k * 1.06);
      }
    }
  }
  if (opts.ring && R > 110) drawWavelengthRing(p, pal, v);
}

/** Outer scales "wavelengths toward generator" (clockwise) and "toward load". */
export function drawWavelengthRing(p, pal, v) {
  const { cx, cy, R } = v;
  p.strokeWeight(1);
  p.stroke(pal.axis);
  p.noFill();
  p.circle(cx, cy, 2 * (R + 4));
  p.textSize(9);
  for (let i = 0; i < 50; i++) {
    const w = i * 0.01;
    const phi = Math.PI - 4 * Math.PI * w;
    const major = i % 5 === 0;
    const r0 = R + 4, r1 = R + (major ? 12 : 8);
    p.stroke(pal.axis);
    p.line(cx + r0 * Math.cos(phi), cy - r0 * Math.sin(phi), cx + r1 * Math.cos(phi), cy - r1 * Math.sin(phi));
    if (major) {
      p.noStroke();
      p.fill(pal.muted);
      p.textAlign(p.CENTER, p.CENTER);
      const rt = R + 22;
      p.text(w.toFixed(2).replace(/^0/, ''), cx + rt * Math.cos(phi), cy - rt * Math.sin(phi));
      // toward-load scale (counter-clockwise): reading (0.5 - w) % 0.5 at the same place
      const wl = (0.5 - w) % 0.5;
      p.fill(pal.dark ? '#5f6775' : '#9aa1ad');
      const rl = R + 34;
      p.text(wl.toFixed(2).replace(/^0/, ''), cx + rl * Math.cos(phi), cy - rl * Math.sin(phi));
    }
  }
  p.noStroke();
  p.fill(pal.muted);
  p.textAlign(p.CENTER, p.CENTER);
  p.text('toward generator', cx, cy - R - 46);
}

/** Wavelengths-toward-generator reading at the point of a Gamma value. */
export function wtgOf(g) { return wtgReading(Math.atan2(g[1], g[0])); }

/** Draws a marker: filled/hollow dot with an optional label. */
export function marker(p, x, y, color, { r = 5, hollow = false, label = '', pal, dx = 8, dy = -8 } = {}) {
  p.strokeWeight(2);
  if (hollow) { p.noFill(); p.stroke(color); } else { p.fill(color); p.stroke(pal ? pal.bg : '#000'); }
  p.circle(x, y, 2 * r);
  if (label) {
    p.noStroke();
    p.fill(color);
    p.textSize(11);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(label, x + dx, y + dy);
  }
}

/** Polyline of Gamma points through the view. */
export function gammaPath(p, v, pts) {
  p.noFill();
  p.beginShape();
  for (const g of pts) {
    if (!g || !Number.isFinite(g[0]) || !Number.isFinite(g[1])) continue;
    const q = v.toPx(g);
    p.vertex(q[0], q[1]);
  }
  p.endShape();
}
