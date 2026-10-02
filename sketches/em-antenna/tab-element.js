// Element patterns tab: the four element patterns in polar form, and pattern multiplication (element x array factor).
import * as A from '../../lib/em/array.js';
import { linearNow } from './model.js';
import { polarGrid, polarCurve } from './polar.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, deg } from '../em-common/util.js';

const COLOR_OF = { iso: '#8b93a1', short: COLORS.blue, half: COLORS.green, patch: COLORS.orange };

export function elementLayout(S) {
  const wide = S.w >= 720;
  const pw = wide ? Math.round(S.w * 0.42) : S.w;
  const R = Math.max(40, Math.min(pw, wide ? S.h - 160 : S.h * 0.38) / 2 - 24);
  const polar = { cx: pw / 2, cy: 56 + R, R };
  const rect = wide
    ? { x: pw + 62, y: 34, w: S.w - pw - 80, h: Math.max(120, S.h * 0.36) }
    : { x: 58, y: polar.cy + R + 54, w: S.w - 76, h: Math.max(90, S.h * 0.2) };
  const textY = wide ? Math.max(polar.cy + R + 36, rect.y + rect.h + 50) : rect.y + rect.h + 46;
  return { polar, rect, textY, textX: wide ? 14 : 10, textW: S.w - 24, wide };
}

/** Numeric directivity and half-power width of every element type (own-axis frame). */
export function elementTable() {
  return A.ELEMENT_TYPES.map((e) => {
    const n = 4000;
    const theta = new Float64Array(n + 1), mag = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) { theta[i] = (Math.PI * i) / n; mag[i] = A.elementPattern(e.id, theta[i]); }
    const maxv = Math.max(...mag);
    for (let i = 0; i <= n; i++) mag[i] /= maxv;
    const dir = A.directivityFromSamples({ theta, mag });
    // half-power width about the maximum (symmetric patterns): find the first crossing from the peak
    let peak = 0;
    for (let i = 0; i <= n; i++) if (mag[i] > mag[peak]) peak = i;
    let hp = null;
    for (let i = peak; i < n; i++) if (mag[i + 1] < Math.SQRT1_2) { hp = 2 * Math.abs(theta[i] - theta[peak]); break; }
    if (e.id === 'iso') hp = null;
    return { id: e.id, label: e.label, D: dir.directivity, Dbi: dir.directivityDbi, hpbw: hp, theta, mag };
  });
}
const TABLE = elementTable();

export const elementTab = {
  draw(S) {
    const { p, pal } = S;
    const lay = elementLayout(S);
    const useDb = !!S.get('polarDb');
    const floor = Math.max(10, Number(S.get('floor')) || 40);
    const P = lay.polar;
    polarGrid(p, pal, P.cx, P.cy, P.R, { useDb, floorDb: floor, title: 'element patterns (own axis vertical)' });
    p.strokeWeight(2);
    for (const e of TABLE) {
      p.stroke(COLOR_OF[e.id]);
      polarCurve(p, P.cx, P.cy, P.R, e.theta.filter((_, i) => i % 20 === 0), e.mag.filter((_, i) => i % 20 === 0), { useDb, floorDb: floor });
    }
    // pattern multiplication for the current linear array
    const D = linearNow(S.get, { steerOverride: S.get('scan') ? S.st.scanDeg : null });
    const iso = A.sampleLinear(D.w, D.d, D.beta, 'iso', 360);
    const n = iso.theta.length;
    const th = new Float64Array(n), elDb = new Float64Array(n), afDb = new Float64Array(n), totDb = new Float64Array(n);
    let emax = 0;
    for (let i = 0; i < n; i++) emax = Math.max(emax, A.linearElement(D.elem, iso.theta[i]));
    const prod = new Float64Array(n);
    let pmax = 0;
    for (let i = 0; i < n; i++) { prod[i] = iso.mag[i] * A.linearElement(D.elem, iso.theta[i]); pmax = Math.max(pmax, prod[i]); }
    for (let i = 0; i < n; i++) {
      th[i] = deg(iso.theta[i]);
      elDb[i] = A.toDb(A.linearElement(D.elem, iso.theta[i]) / (emax || 1), -floor);
      afDb[i] = A.toDb(iso.mag[i], -floor);
      totDb[i] = A.toDb(prod[i] / (pmax || 1), -floor);
    }
    const fr = plotFrame(p, pal, lay.rect, {
      xmin: 0, xmax: 180, ymin: -floor, ymax: 0, title: 'pattern multiplication: total = element × array factor (dB)', xlabel: 'θ from the array axis (deg)', ylabel: 'dB', xticks: [0, 30, 60, 90, 120, 150, 180],
    });
    clipped(p, lay.rect, () => {
      p.strokeWeight(1.5);
      p.stroke(COLORS.blue); polyline(p, th, elDb, fr.X, fr.Y);
      p.stroke(COLORS.green); polyline(p, th, afDb, fr.X, fr.Y);
      p.stroke(COLORS.orange); p.strokeWeight(2.5); polyline(p, th, totDb, fr.X, fr.Y);
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.blue); p.text(`element (${D.elem})`, lay.rect.x + 5, lay.rect.y + 4);
    p.fill(COLORS.green); p.text(`array factor (N = ${D.N}, d = ${fmt(D.d, 3)} λ, θ₀ = ${fmt(D.steerDeg, 3)}°)`, lay.rect.x + 78, lay.rect.y + 4);
    p.fill(COLORS.orange); p.text('product', lay.rect.x + 78, lay.rect.y + 16);

    const lines = [{ text: 'element              D (numeric)      dBi     half-power width   (analytic)', color: pal.fg }];
    const known = { iso: '1', short: '3/2', half: '1.6409', patch: '6 (ideal cosθ over a half space)' };
    for (const e of TABLE) {
      lines.push({ text: `${e.id.padEnd(8)} ${fmt(e.D, 4).padStart(8)}   ${fmt(e.Dbi, 3).padStart(7)}   ${(e.hpbw === null ? '-' : `${fmt(deg(e.hpbw), 3)}°`).padStart(9)}        ${known[e.id]}`, color: COLOR_OF[e.id] });
    }
    lines.push({ text: 'Pattern multiplication: for identical elements the total field is the element field times the array factor. The AF has the sharp lobes; the element pattern only weights them smoothly, so it can suppress a grating lobe that falls in an element null (try d = 1 λ with dipoles along the array axis).', color: pal.muted });
    textBlock(p, pal, lines, lay.textX, lay.textY, lay.textW, 15);
    S.st.element = { table: TABLE, D };
  },
};
