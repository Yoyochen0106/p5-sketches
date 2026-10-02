// Matching tab: stub / quarter-wave / L-section on the Smith chart, with the return-loss-vs-frequency plot.
import * as T from '../../lib/em/tline.js';
import * as C from '../../lib/complex.js';
import { drawSmithGrid, marker, gammaPath } from './smithchart.js';
import { smithLayout, setLoadFromGamma } from './tab-smith.js';
import { matchingNow, zText } from './model.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp, round } from '../em-common/util.js';

export function matchLayout(S) {
  const leftW = Math.round(clamp(S.w * 0.5, 240, Math.max(240, S.h + 20)));
  const x0 = leftW + 52, x1 = S.w - 18;
  const plot = { x: x0, y: 34, w: Math.max(80, x1 - x0), h: Math.max(90, Math.round(S.h * 0.3)) };
  const strip1 = { x: x0, y: plot.y + plot.h + 52, w: plot.w, h: 22 };
  const strip2 = { x: x0, y: strip1.y + 52, w: plot.w, h: 22 };
  return { leftW, plot, strip1, strip2, textY: strip2.y + 40 };
}

const inRect = (r, x, y, pad = 8) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

export const matchTab = {
  press(S, x, y) {
    const lay = matchLayout(S);
    if (S.get('mMethod') === 'stub') {
      if (inRect(lay.strip1, x, y)) { S.st.mdrag = 'd'; this.drag(S, x, y); return true; }
      if (inRect(lay.strip2, x, y)) { S.st.mdrag = 'l'; this.drag(S, x, y); return true; }
    }
    const v = S.st.view;
    if (v && x < lay.leftW) {
      const g = v.fromPx(x, y);
      if (Math.hypot(g[0], g[1]) <= 1.12) { S.st.mdrag = 'load'; setLoadFromGamma(S, g); return true; }
    }
    return false;
  },
  drag(S, x, y) {
    const lay = matchLayout(S);
    if (S.st.mdrag === 'd') S.set('stubD', round(clamp(((x - lay.strip1.x) / lay.strip1.w) * 0.5, 0, 0.5), 4));
    else if (S.st.mdrag === 'l') S.set('stubL', round(clamp(((x - lay.strip2.x) / lay.strip2.w) * 0.5, 0, 0.5), 4));
    else if (S.st.mdrag === 'load' && S.st.view) setLoadFromGamma(S, S.st.view.fromPx(x, y));
    else return false;
    return true;
  },
  release(S) { S.st.mdrag = null; },

  draw(S) {
    const { p, pal } = S;
    const L = S.line();
    const lay = matchLayout(S);
    const v = smithLayout(S, 0, lay.leftW, 0, S.h, 48);
    drawSmithGrid(p, pal, v, { showY: true, ring: false, labels: v.R > 90 });
    const m = matchingNow(L, S.get);
    // path
    const pts = m.path();
    p.stroke(COLORS.green);
    p.strokeWeight(3);
    if (pts.length) gammaPath(p, v, pts);
    const pl = v.toPx(L.gL);
    marker(p, pl[0], pl[1], '#ff4d4f', { r: 6, label: 'ZL', pal });
    if (pts.length) {
      const end = pts[pts.length - 1];
      const pe = v.toPx(end);
      marker(p, pe[0], pe[1], COLORS.green, { r: 5, hollow: true, label: `|Γ|=${fmt(C.abs(end), 2)}`, pal });
      if (m.kind === 'stub') {
        const mid = pts[60];
        const pm = v.toPx(mid);
        marker(p, pm[0], pm[1], COLORS.blue, { r: 4, label: 'stub', pal });
      }
    }
    // return loss vs frequency
    const thr = Number(S.get('rlThr')) || 10;
    const fr = new Float64Array(201), s11 = new Float64Array(201), s0 = new Float64Array(201);
    for (let i = 0; i <= 200; i++) {
      const r = 0.5 + i / 200;
      fr[i] = r;
      s11[i] = Math.max(-60, 20 * Math.log10(Math.max(1e-6, m.gammaAt(r))));
      s0[i] = 20 * Math.log10(Math.max(1e-6, L.gMag));
    }
    const bw = T.matchBandwidth(m.gammaAt, thr);
    const fp = plotFrame(p, pal, lay.plot, {
      xmin: 0.5, xmax: 1.5, ymin: -40, ymax: 0, title: `|S11| versus frequency (design f0 = ${fmt(L.f / 1e6, 4)} MHz)`, xlabel: 'f / f0', ylabel: '|Γ| (dB)',
    });
    clipped(p, lay.plot, () => {
      if (bw) {
        p.noStroke(); p.fill(46, 204, 113, 40);
        p.rect(fp.X(bw.lo), lay.plot.y, fp.X(bw.hi) - fp.X(bw.lo), lay.plot.h);
      }
      p.stroke(pal.muted); p.strokeWeight(1); polyline(p, fr, s0, fp.X, fp.Y);
      p.stroke(COLORS.red); p.strokeWeight(1);
      p.line(lay.plot.x, fp.Y(-thr), lay.plot.x + lay.plot.w, fp.Y(-thr));
      p.stroke(COLORS.green); p.strokeWeight(2.5); polyline(p, fr, s11, fp.X, fp.Y);
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.green); p.text('matched network', lay.plot.x + 6, lay.plot.y + lay.plot.h - 28);
    p.fill(pal.muted); p.text('load alone', lay.plot.x + 6, lay.plot.y + lay.plot.h - 16);
    p.fill(COLORS.red); p.text(`${fmt(thr)} dB RL`, lay.plot.x + lay.plot.w - 58, fp.Y(-thr) - 12);

    // stub strips
    if (m.kind === 'stub') {
      const sols = m.solutions || [];
      const strip = (r, val, label, key) => {
        p.noStroke(); p.fill(pal.muted); p.textSize(11); p.textAlign(p.LEFT, p.BOTTOM);
        p.text(label, r.x, r.y - 4);
        p.fill(pal.panel); p.rect(r.x, r.y, r.w, r.h);
        p.noFill(); p.stroke(pal.axis); p.rect(r.x, r.y, r.w, r.h);
        p.textSize(9); p.textAlign(p.CENTER, p.TOP); p.noStroke(); p.fill(pal.muted);
        for (let k = 0; k <= 5; k++) p.text((k * 0.1).toFixed(1), r.x + (r.w * k) / 5, r.y + r.h + 2);
        for (const s of sols) {
          const sx = r.x + (r.w * s[key]) / 0.5;
          p.stroke(COLORS.green); p.strokeWeight(2); p.line(sx, r.y + 2, sx, r.y + r.h - 2);
        }
        const hx = r.x + (r.w * clamp(val, 0, 0.5)) / 0.5;
        p.stroke(COLORS.blue); p.strokeWeight(3); p.line(hx, r.y - 3, hx, r.y + r.h + 3);
        p.noStroke(); p.fill(COLORS.blue); p.triangle(hx - 5, r.y - 8, hx + 5, r.y - 8, hx, r.y - 1);
      };
      strip(lay.strip1, m.sol.dLambda, `stub position d = ${fmt(m.sol.dLambda, 4)} λ from the load (drag)`, 'dLambda');
      strip(lay.strip2, m.sol.lLambda, `stub length l = ${fmt(m.sol.lLambda, 4)} λ, ${m.type}-circuited (drag)   green = exact solutions`, 'lLambda');
    }

    // text
    const g0 = m.gammaAt(1);
    const lines = [
      { text: `${m.kind === 'stub' ? 'single shunt stub' : m.kind === 'qw' ? 'quarter-wave transformer' : 'L-section (lumped)'}`, color: COLORS.green },
      ...m.info,
      `at f0:  |Γ| = ${g0 < 1e-5 ? '0 (perfect match)' : fmt(g0, 3)},  RL = ${g0 < 1e-5 ? 'inf' : fmt(-20 * Math.log10(g0), 3)} dB,  VSWR = ${fmt(T.vswr(g0), 3)}`,
      bw ? `bandwidth for RL ≥ ${fmt(thr)} dB: ${fmt(bw.lo, 3)} – ${fmt(bw.hi, 3)} f0  =  ${fmt(bw.fractional * 100, 3)} %` : `RL ≥ ${fmt(thr)} dB is not reached at f0`,
      `ZL = ${zText(L.zl)} Ω   (load alone: RL ${fmt(L.rl, 3)} dB)`,
    ];
    if (m.kind === 'stub' && m.solutions && m.solutions.length) {
      m.solutions.forEach((s, i) => lines.push(`solution ${i + 1}: d = ${fmt(s.dLambda, 4)} λ, l = ${fmt(s.lLambda, 4)} λ  (stub B = ${fmt(s.stubB, 3)})`));
    }
    textBlock(p, pal, lines, lay.plot.x - 40, lay.textY, S.w - lay.plot.x - 6, 14);
    S.st.match = { m, bw, g0 };
  },
};
