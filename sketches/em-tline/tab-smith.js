// Smith chart tab: draggable load, rotation along the SWR circle (toward the generator), read-outs, pins.
import * as T from '../../lib/em/tline.js';
import * as C from '../../lib/complex.js';
import { SmithView, drawSmithGrid, marker, gammaPath, wtgOf } from './smithchart.js';
import { gammaAtLam, zinAtLam, parsePins, zText, ang } from './model.js';
import { textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp, round } from '../em-common/util.js';

export function smithLayout(S, left = 0, width = S.w, top = 0, height = S.h, margin = 62) {
  if (!S.st.view) S.st.view = new SmithView();
  const R = Math.max(30, Math.min(width, height) / 2 - margin);
  S.st.view.set(left + width / 2, top + height / 2 + 6, R);
  return S.st.view;
}

/** Sets the load from a Gamma value (clamped inside the chart). */
export function setLoadFromGamma(S, g) {
  const m = Math.hypot(g[0], g[1]);
  const k = m > 0.9995 ? 0.9995 / m : 1;
  const L = S.line();
  const zl = T.gammaToLoad([g[0] * k, g[1] * k], L.z0);
  if (!Number.isFinite(zl[0]) || !Number.isFinite(zl[1])) return;
  S.set('zr', round(Math.max(0, zl[0]), 1));
  S.set('zx', round(zl[1], 1));
}

/** Sets the line position d from the pointer angle (keeps the current number of half-wave turns). */
export function setDFromPointer(S, x, y) {
  const L = S.line();
  const v = S.st.view;
  const phim = v.angleOf(x, y);
  const d0 = ((((L.gPhi - phim) / (4 * Math.PI)) % 0.5) + 0.5) % 0.5;
  const cur = S.dNow();
  const k = Math.round((cur - d0) / 0.5);
  S.set('dLam', round(clamp(d0 + 0.5 * k, 0, 1), 4));
  S.st.dAnim = S.get('dLam');
}

export const smithTab = {
  press(S, x, y) {
    const v = S.st.view;
    if (!v) return false;
    const g = v.fromPx(x, y);
    if (Math.hypot(g[0], g[1]) > 1.12) return false;
    const L = S.line();
    const gd = gammaAtLam(L, S.dNow());
    const q = v.toPx(gd);
    if (S.dNow() > 1e-6 && Math.hypot(q[0] - x, q[1] - y) < 14) S.st.drag = 'rot';
    else {
      S.st.drag = 'load';
      setLoadFromGamma(S, g);
    }
    return true;
  },
  drag(S, x, y) {
    const v = S.st.view;
    if (!v || !S.st.drag) return false;
    if (S.st.drag === 'rot') setDFromPointer(S, x, y);
    else setLoadFromGamma(S, v.fromPx(x, y));
    return true;
  },
  release(S) { S.st.drag = null; },

  draw(S) {
    const { p, pal } = S;
    const panelW = S.w >= 860 ? 290 : 0;
    const v = smithLayout(S, 0, S.w - panelW, 0, S.h);
    drawSmithGrid(p, pal, v, { showY: !!S.get('showY'), ring: true });
    const L = S.line();
    const d = S.dNow();
    // SWR circle through the load
    p.noFill();
    p.stroke(240, 90, 90, 140);
    p.strokeWeight(1.5);
    p.circle(v.cx, v.cy, 2 * v.R * Math.min(1, L.gMag));
    // spiral from the load to the point at d
    const path = [];
    const n = Math.max(2, Math.ceil(d * 160));
    for (let i = 0; i <= n; i++) path.push(gammaAtLam(L, (d * i) / n));
    p.stroke(COLORS.blue);
    p.strokeWeight(3);
    gammaPath(p, v, path);
    // pins
    const pins = parsePins(S.get('pins'));
    pins.forEach((q, i) => {
      const g = T.loadGamma([q.r, q.x], L.z0);
      const px = v.toPx(g);
      marker(p, px[0], px[1], COLORS.purple, { r: 4, label: `P${i + 1}`, pal });
    });
    // load and rotated point
    const gL = L.gL, gd = gammaAtLam(L, d);
    const pl = v.toPx(gL), pd = v.toPx(gd);
    if (S.get('showY')) {
      const py = v.toPx(C.neg(gd));
      marker(p, py[0], py[1], COLORS.orange, { r: 4, hollow: true, label: 'y', pal });
    }
    if (d > 1e-6) marker(p, pd[0], pd[1], COLORS.blue, { r: 6, hollow: true, label: `Zin(${fmt(d, 3)}λ)`, pal });
    marker(p, pl[0], pl[1], '#ff4d4f', { r: 6, label: 'ZL', pal });

    // read-outs
    const zin = zinAtLam(L, d);
    const gdMag = C.abs(gd);
    const y = C.div([1, 0], L.zn);
    const nodes = T.standingWaveNodes(gL);
    const lines = [
      { text: 'Load', color: pal.accent },
      `ZL = ${zText(L.zl)} Ω`,
      `z = ${zText(L.zn, 3)}   y = ${zText(y, 3)}`,
      `|Γ| = ${fmt(L.gMag, 4)}   ∠Γ = ${fmt(ang(gL), 4)}°`,
      `VSWR = ${fmt(L.vswr, 4)}   RL = ${fmt(L.rl, 3)} dB`,
      `mismatch loss = ${fmt(L.ml, 3)} dB`,
      `first V max ${fmt(nodes.dMax, 4)} λ, min ${fmt(nodes.dMin, 4)} λ from load`,
      { text: `At d = ${fmt(d, 4)} λ  (θ = ${fmt(d * 360, 4)}° electrical)`, color: COLORS.blue },
      `Zin = ${zText(zin)} Ω`,
      `|Γ(d)| = ${fmt(gdMag, 4)}   ∠ = ${fmt(ang(gd), 4)}°`,
      `WTG scale reading ${fmt(wtgOf(gd), 4)} λ`,
      L.lossDbPerM > 0 ? `loss ${fmt(L.lossDbPerM, 3)} dB/m : Γ spirals inward` : 'lossless: Γ stays on the SWR circle',
    ];
    if (pins.length) {
      lines.push({ text: 'Pinned points', color: COLORS.purple });
      pins.forEach((q, i) => {
        const g = T.loadGamma([q.r, q.x], L.z0);
        lines.push(`P${i + 1}: ${zText([q.r, q.x])} Ω   |Γ| ${fmt(C.abs(g), 3)}`);
      });
    }
    lines.push({ text: 'click/drag: set ZL • drag the blue point: move along the line', color: pal.muted });
    if (panelW) textBlock(p, pal, lines, S.w - panelW + 6, 14, panelW - 12);
    else textBlock(p, pal, lines.slice(0, 5).concat(lines.slice(7, 10)), 10, 8, S.w - 20, 14);
    S.st.smith = { zin, gd, d };
  },
};
