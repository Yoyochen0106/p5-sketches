// Standing-wave tab: |V(z)|, |I(z)| envelopes and the animated incident / reflected / total voltage.
import * as T from '../../lib/em/tline.js';
import { envelopeExtrema, zText } from './model.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp } from '../em-common/util.js';

export function wavesLayout(S) {
  const left = 62, right = S.w - 22;
  const topH = Math.max(80, Math.round(S.h * 0.3));
  const botH = Math.max(100, Math.round(S.h * 0.3));
  const r1 = { x: left, y: 34, w: Math.max(60, right - left), h: topH };
  const r2 = { x: left, y: r1.y + r1.h + 46, w: r1.w, h: botH };
  return { r1, r2, textY: r2.y + r2.h + 46 };
}

export const wavesTab = {
  draw(S) {
    const { p, pal } = S;
    const L = S.line();
    const { r1, r2, textY } = wavesLayout(S);
    const lenLam = L.lenLam;
    const n = clamp(Math.ceil(lenLam * 28), 200, 1600);
    const ex = envelopeExtrema(L, lenLam, Math.min(1600, Math.max(400, n)));
    const ds = new Float64Array(n + 1), vm = new Float64Array(n + 1), im = new Float64Array(n + 1);
    let vmax = 0.2;
    for (let i = 0; i <= n; i++) {
      const d = (lenLam * i) / n;
      const w = T.lineWaves(L.gL, L.gammaLam, d);
      ds[i] = -d; vm[i] = w.vMag; im[i] = w.iMag;
      if (w.vMag > vmax) vmax = w.vMag;
      if (w.iMag > vmax) vmax = w.iMag;
    }
    const yTop = Math.ceil(vmax * 5.2) / 5;
    // ---- envelopes ----
    const f1 = plotFrame(p, pal, r1, {
      xmin: -lenLam, xmax: 0, ymin: 0, ymax: yTop, title: 'envelopes  |V(z)| and |I(z)| Z0  (V+ = 1 at the load)', xlabel: 'position z along the line (wavelengths, load at z = 0)', ylabel: '|V|, |I| Z0',
    });
    clipped(p, r1, () => {
      p.strokeWeight(2);
      p.stroke(COLORS.yellow); polyline(p, ds, vm, f1.X, f1.Y);
      p.stroke(COLORS.pink); polyline(p, ds, im, f1.X, f1.Y);
      // nodes: voltage maxima (current minima) and voltage minima
      p.strokeWeight(1);
      for (const d of ex.maxima) {
        p.stroke(255, 107, 107, 170); p.line(f1.X(-d), r1.y, f1.X(-d), r1.y + r1.h);
        p.noStroke(); p.fill(COLORS.red); p.triangle(f1.X(-d) - 4, r1.y + 1, f1.X(-d) + 4, r1.y + 1, f1.X(-d), r1.y + 9);
      }
      for (const d of ex.minima) {
        p.stroke(74, 163, 255, 170); p.line(f1.X(-d), r1.y, f1.X(-d), r1.y + r1.h);
        p.noStroke(); p.fill(COLORS.blue); p.triangle(f1.X(-d) - 4, r1.y + r1.h - 1, f1.X(-d) + 4, r1.y + r1.h - 1, f1.X(-d), r1.y + r1.h - 9);
      }
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.yellow); p.text('|V|', r1.x + r1.w - 90, r1.y + 4);
    p.fill(COLORS.pink); p.text('|I| Z0', r1.x + r1.w - 64, r1.y + 4);
    p.fill(COLORS.red); p.text('▼ V max', r1.x + 6, r1.y + 4);
    p.fill(COLORS.blue); p.text('▲ V min', r1.x + 62, r1.y + 4);

    // ---- animated waves ----
    const ph = S.st.phase || 0;
    const m = n;
    const inc = new Float64Array(m + 1), rf = new Float64Array(m + 1), tot = new Float64Array(m + 1);
    for (let i = 0; i <= m; i++) {
      const d = (lenLam * i) / m;
      const w = T.instantaneousWaves({ gammaL: L.gL, gamma: L.gammaLam, omega: 1, t: ph, d });
      inc[i] = w.inc; rf[i] = w.ref; tot[i] = w.total;
    }
    const f2 = plotFrame(p, pal, r2, {
      xmin: -lenLam, xmax: 0, ymin: -yTop, ymax: yTop, title: `instantaneous voltage  v(z, t)  at  f = ${fmt(L.f / 1e6, 4)} MHz,  λ = ${fmt(L.lam, 4)} m`, xlabel: 'position z (wavelengths)', ylabel: 'v / V+',
    });
    clipped(p, r2, () => {
      p.strokeWeight(2);
      if (S.get('wInc')) { p.stroke(COLORS.blue); polyline(p, ds, inc, f2.X, f2.Y); }
      if (S.get('wRef')) { p.stroke(COLORS.orange); polyline(p, ds, rf, f2.X, f2.Y); }
      if (S.get('wTot')) { p.stroke(pal.fg); p.strokeWeight(2.5); polyline(p, ds, tot, f2.X, f2.Y); }
      if (S.get('wEnv')) {
        p.strokeWeight(1); p.stroke(255, 255, 255, 70);
        polyline(p, ds, vm, f2.X, f2.Y);
        const neg = Float64Array.from(vm, (v) => -v);
        polyline(p, ds, neg, f2.X, f2.Y);
      }
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.blue); p.text('incident (to the load)', r2.x + 6, r2.y + 4);
    p.fill(COLORS.orange); p.text('reflected', r2.x + 118, r2.y + 4);
    p.fill(pal.fg); p.text('total', r2.x + 178, r2.y + 4);

    // ---- read-outs ----
    const nodes = T.standingWaveNodes(L.gL);
    const first = ex.maxima.length > 1 ? ex.maxima[1] - ex.maxima[0] : NaN;
    const measuredS = (() => {
      let lo = Infinity, hi = 0;
      for (let i = 0; i <= n; i++) { if (vm[i] < lo) lo = vm[i]; if (vm[i] > hi) hi = vm[i]; }
      return lo > 1e-9 ? hi / lo : Infinity;
    })();
    textBlock(p, pal, [
      `ZL = ${zText(L.zl)} Ω (Z0 = ${fmt(L.z0)} Ω)   ΓL = ${fmt(L.gMag, 4)} ∠ ${fmt(L.gPhi * 180 / Math.PI, 4)}°   VSWR = ${fmt(L.vswr, 4)}   RL = ${fmt(L.rl, 3)} dB`,
      `line: ${fmt(L.lenM, 3)} m = ${fmt(lenLam, 4)} λ  (vf = ${fmt(L.vf, 3)}, loss ${fmt(L.lossDbPerM, 3)} dB/m)    |Vmax|/|Vmin| measured = ${fmt(measuredS, 4)}${L.lossDbPerM > 0 ? ' (line loss lowers it along the line)' : ''}`,
      `first V max at ${fmt(nodes.dMax, 4)} λ, first V min at ${fmt(nodes.dMin, 4)} λ from the load; maxima repeat every λ/2${Number.isFinite(first) ? ` (measured spacing ${fmt(first, 4)} λ)` : ''}, max-to-min spacing λ/4`,
    ], r2.x, textY, S.w - r2.x - 10, 15);
    S.st.waves = { maxima: ex.maxima, minima: ex.minima, measuredS, yTop };
  },
};
