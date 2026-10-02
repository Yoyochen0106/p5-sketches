// Planar array tab: separable array factor, 3D pattern surface (software-rendered), principal-plane cuts.
import * as A from '../../lib/em/array.js';
import { OrbitCamera, prepareMesh, colormapLUT } from '../../lib/render3d.js';
import { drawMesh, drawEdges, drawAxes } from '../shared3d/draw3d.js';
import { planarWeights } from './model.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp, deg, rad } from '../em-common/util.js';

export function planarLayout(S) {
  if (S.w >= 760) {
    const lw = Math.round(S.w * 0.58);
    return {
      view: { x: 0, y: 0, w: lw, h: S.h },
      grid: { x: lw + 20, y: 28, w: S.w - lw - 36, h: Math.min(110, S.h * 0.18) },
      cut: { x: lw + 56, y: 28 + Math.min(110, S.h * 0.18) + 40, w: S.w - lw - 76, h: Math.max(90, S.h * 0.26) },
      textX: lw + 20, textY: 28 + Math.min(110, S.h * 0.18) + 40 + Math.max(90, S.h * 0.26) + 44, textW: S.w - lw - 30,
    };
  }
  const vh = Math.round(S.h * 0.5);
  return {
    view: { x: 0, y: 0, w: S.w, h: vh },
    grid: { x: 10, y: vh + 8, w: Math.min(140, S.w * 0.35), h: Math.min(90, S.h * 0.18) },
    cut: { x: Math.min(140, S.w * 0.35) + 60, y: vh + 18, w: S.w - Math.min(140, S.w * 0.35) - 80, h: Math.max(60, S.h * 0.2) },
    textX: 10, textY: vh + Math.max(60, S.h * 0.2) + 56, textW: S.w - 20,
  };
}

const ringSegments = (() => {
  const n = 96, out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n;
    out.set([Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0], i * 6);
  }
  return out;
})();
const axisSegments = Float32Array.of(-1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15);

/** Computes (and caches) the planar pattern and its mesh for the current settings. */
export function planarData(S) {
  const g = S.get;
  const Nx = clamp(Math.round(Number(g('Nx')) || 2), 2, 16), Ny = clamp(Math.round(Number(g('Ny')) || 2), 2, 16);
  const dx = clamp(Number(g('dx')) || 0.5, 0.1, 2), dy = clamp(Number(g('dy')) || 0.5, 0.1, 2);
  const th0 = rad(clamp(Number(g('pth')) || 0, 0, 89)), ph0 = rad(Number(g('pph')) || 0);
  const floor = clamp(Number(g('pfloor')) || 30, 10, 60);
  const key = [Nx, Ny, dx, dy, th0, ph0, g('pelem'), floor, g('taper'), g('sll')].join('|');
  if (S.st.planar && S.st.planar.key === key) return S.st.planar;
  const wx = planarWeights(g, Nx), wy = planarWeights(g, Ny);
  const { bx, by } = A.planarSteering(dx, dy, th0, ph0);
  const samples = A.samplePlanar({ wx, wy, dx, dy, bx, by, elem: g('pelem'), nTheta: 48, nPhi: 96 });
  const mesh = A.patternMesh(samples, -floor);
  const prepared = prepareMesh({ positions: mesh.positions, indices: mesh.indices });
  // beam direction from the samples
  let best = 0, bi = 0;
  for (let k = 0; k < samples.amp.length; k++) if (samples.amp[k] > best) { best = samples.amp[k]; bi = k; }
  const ti = Math.floor(bi / (samples.nPhi + 1)), pj = bi % (samples.nPhi + 1);
  S.st.planar = {
    key, Nx, Ny, dx, dy, th0, ph0, floor, wx, wy, bx, by, samples, mesh, prepared,
    peakTheta: (Math.PI * ti) / samples.nTheta, peakPhi: (2 * Math.PI * pj) / samples.nPhi,
    D: samples.directivity,
  };
  return S.st.planar;
}

/** Principal-plane cut: signed theta in [-90, 90] deg; returns { x[], e[], h[] } in dB. */
export function planarCuts(P, elem, n = 181) {
  const x = new Float64Array(n), e = new Float64Array(n), h = new Float64Array(n);
  let maxv = 1e-12;
  const val = (t, phi) => A.planarAF(P.wx, P.wy, P.dx, P.dy, P.bx, P.by, Math.abs(t), t < 0 ? phi + Math.PI : phi) * A.planarElement(elem, Math.abs(t), t < 0 ? phi + Math.PI : phi);
  const ev = new Float64Array(n), hv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = rad(-90 + (180 * i) / (n - 1));
    x[i] = deg(t);
    ev[i] = val(t, P.ph0); hv[i] = val(t, P.ph0 + Math.PI / 2);
    maxv = Math.max(maxv, ev[i], hv[i], P.samples.max);
  }
  const norm = P.samples.max || maxv;
  for (let i = 0; i < n; i++) { e[i] = A.toDb(ev[i] / norm, -60); h[i] = A.toDb(hv[i] / norm, -60); }
  return { x, e, h };
}

export const planarTab = {
  press(S) { return !!S.st.ctl && S.st.ctl.mousePressed(null); },
  drag(S) { return !!S.st.ctl && S.st.ctl.mouseDragged(); },
  release(S) { if (S.st.ctl) S.st.ctl.mouseReleased(); },

  draw(S) {
    const { p, pal } = S;
    const lay = planarLayout(S);
    S.st.rect3d = lay.view;
    const P = planarData(S);
    if (!S.st.cam) {
      S.st.cam = new OrbitCamera({ yaw: 0.9, pitch: 0.5 });
      S.st.cam.fitToBounds({ min: [-1, -1, -1], max: [1, 1, 1] }, 1.12);
    }
    const lut = colormapLUT('viridis');
    const vals = P.mesh.values, idx = P.prepared.indices, floor = P.floor;
    const colorFn = (tri, prep, out) => {
      const a = (vals[idx[tri * 3]] + vals[idx[tri * 3 + 1]] + vals[idx[tri * 3 + 2]]) / 3;
      const t = clamp(1 + A.toDb(a, -floor) / floor, 0, 1);
      const k = Math.round(t * 255) * 3;
      out[0] = lut[k]; out[1] = lut[k + 1]; out[2] = lut[k + 2];
    };
    const mode = S.get('prender') === 'flat' ? 'flat' : S.get('prender') === 'wire' ? 'wire' : 'both';
    drawMesh(p, P.prepared, S.st.cam, lay.view, { mode, colorFn, revision: P.key, twoSided: true, cache: S.st.drawCache || (S.st.drawCache = {}), wireColor: [20, 24, 32, 90], weight: 0.5 });
    drawEdges(p, ringSegments, S.st.cam, lay.view, { stroke: [160, 170, 190, 90], weight: 1, cache: S.st.ringCache || (S.st.ringCache = {}) });
    drawEdges(p, axisSegments, S.st.cam, lay.view, { stroke: [160, 170, 190, 70], weight: 1, cache: S.st.axisCache || (S.st.axisCache = {}) });
    // beam direction
    const bx = Math.sin(P.th0) * Math.cos(P.ph0), by = Math.sin(P.th0) * Math.sin(P.ph0), bz = Math.cos(P.th0);
    drawEdges(p, Float32Array.of(0, 0, 0, bx * 1.2, by * 1.2, bz * 1.2), S.st.cam, lay.view, { stroke: [46, 204, 113, 220], weight: 2, cache: S.st.beamCache || (S.st.beamCache = {}) });
    if (S.get('paxes')) drawAxes(p, S.st.cam, lay.view, {});
    p.noStroke(); p.fill(pal.fg); p.textSize(12); p.textAlign(p.LEFT, p.TOP);
    p.text('3D radiation pattern: radius = level in dB (centre = floor, surface = 0 dB), colour = same level', lay.view.x + 10, lay.view.y + 8);
    p.fill(pal.muted); p.textSize(11);
    p.text('drag: orbit • shift/right-drag: pan • wheel: zoom • R / double-click: reset', lay.view.x + 10, lay.view.y + 24);

    // element grid inset (dot area ~ weight product)
    const gr = lay.grid;
    p.noStroke(); p.fill(pal.panel); p.rect(gr.x, gr.y, gr.w, gr.h);
    p.noFill(); p.stroke(pal.axis); p.rect(gr.x, gr.y, gr.w, gr.h);
    const cell = Math.min((gr.w - 10) / (P.Nx + 0.5), (gr.h - 10) / (P.Ny + 0.5));
    p.noStroke();
    for (let i = 0; i < P.Nx; i++) {
      for (let j = 0; j < P.Ny; j++) {
        const wv = P.wx[i] * P.wy[j];
        p.fill(74, 163, 255, 80 + 175 * wv);
        p.circle(gr.x + gr.w / 2 + (i - (P.Nx - 1) / 2) * cell, gr.y + gr.h / 2 - (j - (P.Ny - 1) / 2) * cell, Math.max(2, cell * (0.25 + 0.6 * Math.sqrt(wv))));
      }
    }
    p.fill(pal.muted); p.textSize(10); p.textAlign(p.LEFT, p.BOTTOM);
    p.text(`array ${P.Nx} × ${P.Ny}, dx = ${fmt(P.dx, 3)} λ, dy = ${fmt(P.dy, 3)} λ (dot size ~ weight)`, gr.x, gr.y - 3);

    // principal-plane cuts
    const cuts = planarCuts(P, S.get('pelem'));
    const fc = plotFrame(p, pal, lay.cut, {
      xmin: -90, xmax: 90, ymin: -60, ymax: 0, title: 'cuts through the beam axis planes (dB)', xlabel: 'angle from z in the cut plane (deg)', ylabel: 'dB', xticks: [-90, -60, -30, 0, 30, 60, 90], yticks: [0, -10, -20, -30, -40, -50, -60],
    });
    clipped(p, lay.cut, () => {
      p.strokeWeight(2);
      p.stroke(COLORS.orange); polyline(p, cuts.x, cuts.e, fc.X, fc.Y);
      p.stroke(COLORS.cyan); polyline(p, cuts.x, cuts.h, fc.X, fc.Y);
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.orange); p.text(`φ = ${fmt(deg(P.ph0), 3)}° plane`, lay.cut.x + 5, lay.cut.y + 3);
    p.fill(COLORS.cyan); p.text(`φ = ${fmt(deg(P.ph0) + 90, 3)}° plane`, lay.cut.x + 5, lay.cut.y + 15);

    const hpbwx = (0.886 / (P.Nx * P.dx)) * (180 / Math.PI), hpbwy = (0.886 / (P.Ny * P.dy)) * (180 / Math.PI);
    textBlock(p, pal, [
      { text: `AF(θ,φ) = AFx(ψx) AFy(ψy)`, color: pal.fg },
      `ψx = 2π dx sinθ cosφ + βx,  ψy = 2π dy sinθ sinφ + βy`,
      `steered to θ₀ = ${fmt(deg(P.th0), 3)}°, φ₀ = ${fmt(deg(P.ph0), 3)}° (βx = ${fmt(deg(P.bx), 4)}°, βy = ${fmt(deg(P.by), 4)}°)`,
      `measured peak at θ = ${fmt(deg(P.peakTheta), 3)}°, φ = ${fmt(deg(P.peakPhi), 3)}°`,
      `directivity D = ${fmt(P.D, 4)} = ${fmt(10 * Math.log10(P.D), 3)} dBi  (4π / ∫|F|² dΩ)`,
      `broadside beamwidths ~ 0.886/(N d): ${fmt(hpbwx, 3)}° (x), ${fmt(hpbwy, 3)}° (y), grows as 1/cosθ₀ when scanned`,
    ], lay.textX, lay.textY, lay.textW, 15);
  },
};
