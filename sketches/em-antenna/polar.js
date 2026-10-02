// Polar pattern plot: the array/element axis is vertical, theta runs from 0 (top) to 180 deg (bottom);
// the pattern is a body of revolution so it is mirrored left-right.
import { polylinePx } from '../em-common/plot.js';
import { toDb } from '../../lib/em/array.js';

/** Normalised radius (0..1) of a field magnitude (max 1): dB scale from floorDb..0 or linear. */
export function radiusOf(mag, useDb, floorDb) {
  if (!(mag > 0)) return 0;
  if (!useDb) return Math.min(1, mag);
  return Math.max(0, 1 + toDb(mag, -floorDb) / floorDb);
}

/** Pixel position at angle theta (rad from the top) and normalised radius r; side +1 right, -1 left. */
export function polarPoint(cx, cy, R, theta, r, side = 1) {
  return [cx + side * R * r * Math.sin(theta), cy - R * r * Math.cos(theta)];
}

export function polarGrid(p, pal, cx, cy, R, { useDb = true, floorDb = 40, title = '' } = {}) {
  p.noFill();
  p.strokeWeight(1);
  const rings = [];
  if (useDb) {
    const step = floorDb > 45 ? 20 : 10;
    for (let db = 0; db >= -floorDb + 1e-9; db -= step) rings.push([db, 1 + db / floorDb]);
  } else for (const v of [0.25, 0.5, 0.75, 1]) rings.push([v, v]);
  for (const [lab, r] of rings) {
    p.stroke(lab === 0 || lab === 1 ? pal.axis : pal.grid);
    p.circle(cx, cy, 2 * R * r);
    p.noStroke(); p.fill(pal.muted); p.textSize(9); p.textAlign(p.LEFT, p.BOTTOM);
    p.text(useDb ? `${lab} dB` : String(lab), cx + 3, cy - R * r + 11);
    p.noFill();
  }
  for (let a = 0; a < 360; a += 30) {
    const t = (a * Math.PI) / 180;
    p.stroke(pal.grid);
    p.line(cx, cy, cx + R * Math.sin(t), cy - R * Math.cos(t));
    if (a <= 180) {
      p.noStroke(); p.fill(pal.muted); p.textSize(9);
      p.textAlign(p.CENTER, p.CENTER);
      p.text(`${a}°`, cx + (R + 11) * Math.sin(t), cy - (R + 11) * Math.cos(t));
      p.noFill();
    }
  }
  if (title) {
    p.noStroke(); p.fill(pal.fg); p.textSize(11); p.textAlign(p.LEFT, p.BOTTOM);
    p.text(title, cx - R - 8, cy - R - 20);
  }
}

/** Draws a pattern (theta[], mag[]) mirrored about the vertical axis. */
export function polarCurve(p, cx, cy, R, theta, mag, { useDb = true, floorDb = 40, mirror = true } = {}) {
  for (const side of mirror ? [1, -1] : [1]) {
    const pts = [];
    for (let i = 0; i < theta.length; i++) pts.push(polarPoint(cx, cy, R, theta[i], radiusOf(mag[i], useDb, floorDb), side));
    polylinePx(p, pts);
  }
}
