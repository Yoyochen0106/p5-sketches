// Linear array tab: weights (editable bars), their DFT |W(psi)| with the visible region, polar and rectangular patterns.
import * as A from '../../lib/em/array.js';
import { linearNow, weightsNow, formatWeights } from './model.js';
import { polarGrid, polarCurve, polarPoint, radiusOf } from './polar.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp, deg, rad, round } from '../em-common/util.js';
import { flatten } from '../impulse/brush.js';

export function linearLayout(S) {
  const left = 58, right = S.w - 14, top = 30, textH = 96, gap = 50, gapY = 46;
  const cw = Math.max(100, (right - left - gap) / 2);
  const ch = Math.max(90, (S.h - top - textH - gapY - 20) / 2);
  const x2 = left + cw + gap;
  const R = Math.max(30, Math.min(cw, ch) / 2 - 18);
  return {
    bars: { x: left, y: top, w: cw, h: ch },
    dft: { x: left, y: top + ch + gapY, w: cw, h: ch },
    polar: { x: x2, y: top, w: cw, h: ch, cx: x2 + cw / 2, cy: top + ch / 2 + 4, R },
    rect: { x: x2, y: top + ch + gapY, w: cw, h: ch },
    textY: top + 2 * ch + gapY + 40,
  };
}

const inside = (r, x, y, pad = 6) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/** The live weights (while a bar is being dragged) or the weights from the settings. */
function currentOptions(S) {
  return {
    wOverride: S.st.wEdit || null,
    steerOverride: S.get('scan') ? S.st.scanDeg : null,
  };
}
export function linearData(S) { return linearNow(S.get, currentOptions(S)); }

function paintBars(S, x, y, first) {
  const lay = linearLayout(S);
  const N = S.st.wEdit.length;
  const c = clamp(((x - lay.bars.x) / lay.bars.w) * N - 0.5, 0, N - 1);
  const v = clamp(1.05 * (1 - (y - lay.bars.y) / lay.bars.h), 0, 1);
  const radius = Math.max(0, Number(S.get('brush')) || 0);
  const prev = first ? null : S.st.lastPaint;
  const steps = prev ? Math.max(1, Math.ceil(Math.abs(c - prev.c) * 2)) : 1;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const cc = prev ? prev.c + (c - prev.c) * t : c;
    const vv = prev ? prev.v + (v - prev.v) * t : v;
    flatten(S.st.wEdit, Math.round(cc), radius, 0.5, vv, 1);
  }
  S.st.lastPaint = { c, v };
}

export const linearTab = {
  press(S, x, y) {
    const lay = linearLayout(S);
    if (inside(lay.bars, x, y)) {
      S.st.wEdit = Float64Array.from(weightsNow(S.get));
      S.st.lastPaint = null;
      S.st.mode = 'bars';
      paintBars(S, x, y, true);
      return true;
    }
    if (inside(lay.polar, x, y)) { S.st.mode = 'steer'; this.drag(S, x, y); return true; }
    return false;
  },
  drag(S, x, y) {
    const lay = linearLayout(S);
    if (S.st.mode === 'bars' && S.st.wEdit) paintBars(S, x, y, false);
    else if (S.st.mode === 'steer') {
      const th = Math.atan2(Math.abs(x - lay.polar.cx), lay.polar.cy - y);
      S.set('scan', false);
      S.set('steer', round(deg(th), 1));
    } else return false;
    return true;
  },
  release(S) {
    if (S.st.mode === 'bars' && S.st.wEdit) {
      const w = S.st.wEdit;
      S.st.wEdit = null;
      S.set('w', formatWeights(w));
      S.set('taper', 'custom');
    }
    S.st.mode = null;
  },

  draw(S) {
    const { p, pal } = S;
    const lay = linearLayout(S);
    const D = linearData(S);
    const { w, d, beta, samples, analysis: an } = D;
    const N = D.N, floor = Math.max(10, Number(S.get('floor')) || 40);
    const useDb = !!S.get('polarDb');
    const kd = 2 * Math.PI * d;

    // ---- weights ----
    const fb = plotFrame(p, pal, lay.bars, {
      xmin: -0.5, xmax: N - 0.5, ymin: 0, ymax: 1.05, title: S.get('taper') === 'custom' || S.st.wEdit ? 'weights wₙ  (custom, drag to edit)' : `weights wₙ  (${S.get('taper')}) – drag to edit`,
      xlabel: 'element index n', ylabel: 'amplitude', xticks: Array.from({ length: N }, (_, i) => i).filter((i) => N <= 16 || i % 2 === 0), yticks: [0, 0.5, 1],
    });
    p.noStroke();
    for (let n = 0; n < N; n++) {
      const x0 = fb.X(n - 0.36), x1 = fb.X(n + 0.36);
      p.fill(w[n] > 0.001 ? COLORS.blue : pal.axis);
      p.rect(x0, fb.Y(Math.max(w[n], 0.008)), x1 - x0, fb.Y(0) - fb.Y(Math.max(w[n], 0.008)));
      if (N <= 12) { p.fill(pal.muted); p.textSize(9); p.textAlign(p.CENTER, p.BOTTOM); p.text(fmt(w[n], 2), (x0 + x1) / 2, fb.Y(w[n]) - 2); }
    }

    // ---- DFT of the weights with the visible region ----
    const lo = Math.floor(Math.min(-Math.PI, beta - kd) / Math.PI) * Math.PI;
    const hi = Math.ceil(Math.max(Math.PI, beta + kd) / Math.PI) * Math.PI;
    const M = D.spec.psi.length;
    const per = (hi - lo) / (2 * Math.PI);
    const npts = Math.min(4096, Math.round(M * per));
    const xs = new Float64Array(npts + 1), ys = new Float64Array(npts + 1), yu = new Float64Array(npts + 1);
    const uni = A.weightSpectrum(new Float64Array(N).fill(1), M);
    for (let i = 0; i <= npts; i++) {
      const psi = lo + ((hi - lo) * i) / npts;
      xs[i] = psi / Math.PI;
      // spec index k corresponds to psi = 2 pi (k - M/2)/M (wrapped: |W| is 2 pi periodic)
      const idx = (((Math.round((psi / (2 * Math.PI)) * M) + M / 2) % M) + M) % M;
      ys[i] = A.toDb(D.spec.mag[idx] / D.sum, -floor);
      yu[i] = A.toDb(uni.mag[idx] / N, -floor);
    }
    const fd = plotFrame(p, pal, lay.dft, {
      xmin: lo / Math.PI, xmax: hi / Math.PI, ymin: -floor, ymax: 0, title: '|W(ψ)| = FFT of the weights (dB)', xlabel: 'ψ / π     ψ = 2π d cosθ + β', ylabel: 'dB',
    });
    const v0 = (beta - kd) / Math.PI, v1 = (beta + kd) / Math.PI;
    clipped(p, lay.dft, () => {
      p.noStroke(); p.fill(46, 204, 113, 38);
      p.rect(fd.X(v0), lay.dft.y, fd.X(v1) - fd.X(v0), lay.dft.h);
      p.strokeWeight(1); p.stroke(pal.muted); polyline(p, xs, yu, fd.X, fd.Y);
      p.strokeWeight(2); p.stroke(COLORS.blue); polyline(p, xs, ys, fd.X, fd.Y);
      p.stroke(COLORS.green); p.strokeWeight(1);
      p.line(fd.X(v0), lay.dft.y, fd.X(v0), lay.dft.y + lay.dft.h);
      p.line(fd.X(v1), lay.dft.y, fd.X(v1), lay.dft.y + lay.dft.h);
    });
    p.noStroke(); p.textSize(9); p.fill(COLORS.green);
    p.textAlign(p.LEFT, p.TOP); p.text('θ=180°', Math.max(lay.dft.x + 2, fd.X(v0) + 2), lay.dft.y + 3);
    p.textAlign(p.RIGHT, p.TOP); p.text('θ=0°', Math.min(lay.dft.x + lay.dft.w - 2, fd.X(v1) - 2), lay.dft.y + 3);
    p.fill(pal.muted); p.textAlign(p.LEFT, p.BOTTOM);
    p.text('grey: uniform weights (rectangular window)', lay.dft.x + 4, lay.dft.y + lay.dft.h - 3);
    p.fill(COLORS.green); p.textAlign(p.CENTER, p.TOP);
    p.text('visible region (real angles)', (Math.max(lay.dft.x, fd.X(v0)) + Math.min(lay.dft.x + lay.dft.w, fd.X(v1))) / 2, lay.dft.y + 15);

    // ---- polar ----
    const P = lay.polar;
    polarGrid(p, pal, P.cx, P.cy, P.R, { useDb, floorDb: floor, title: `pattern ${useDb ? '(dB)' : '(linear field)'}` });
    p.strokeWeight(2); p.stroke(COLORS.orange);
    polarCurve(p, P.cx, P.cy, P.R, samples.theta, samples.mag, { useDb, floorDb: floor });
    // steering line
    const t0 = rad(D.steerDeg);
    p.stroke(46, 204, 113, 160); p.strokeWeight(1);
    p.line(P.cx, P.cy, P.cx + P.R * Math.sin(t0), P.cy - P.R * Math.cos(t0));
    // lobe dots
    p.noStroke();
    for (const pk of an.peaks) {
      if (pk.db < -floor) continue;
      const q = polarPoint(P.cx, P.cy, P.R, pk.theta, radiusOf(samples.mag[pk.i], useDb, floor));
      p.fill(pk === an.main ? COLORS.green : COLORS.red);
      p.circle(q[0], q[1], 6);
    }

    // ---- rectangular dB ----
    const th = new Float64Array(samples.theta.length), db = new Float64Array(samples.theta.length);
    for (let i = 0; i < th.length; i++) { th[i] = deg(samples.theta[i]); db[i] = A.toDb(samples.mag[i], -floor); }
    const fr = plotFrame(p, pal, lay.rect, {
      xmin: 0, xmax: 180, ymin: -floor, ymax: 0, title: 'pattern |AF(θ)| |E(θ)| (dB)', xlabel: 'θ from the array axis (deg)', ylabel: 'dB', xticks: [0, 30, 60, 90, 120, 150, 180],
    });
    clipped(p, lay.rect, () => {
      p.strokeWeight(1); p.stroke(255, 255, 255, 60);
      p.line(lay.rect.x, fr.Y(-3.0103), lay.rect.x + lay.rect.w, fr.Y(-3.0103));
      p.strokeWeight(2); p.stroke(COLORS.orange); polyline(p, th, db, fr.X, fr.Y);
      // nulls
      p.strokeWeight(1); p.stroke(120, 160, 255, 150);
      for (const nl of an.nulls.slice(0, 60)) p.line(fr.X(deg(nl)), lay.rect.y + lay.rect.h, fr.X(deg(nl)), lay.rect.y + lay.rect.h - 6);
      // half-power bracket
      if (an.hpbw !== null && an.hpbwLo !== null && an.hpbwHi !== null) {
        p.stroke(COLORS.green); p.strokeWeight(2);
        p.line(fr.X(deg(an.hpbwLo)), fr.Y(-3.0103), fr.X(deg(an.hpbwHi)), fr.Y(-3.0103));
      }
    });
    p.noStroke(); p.textSize(9); p.textAlign(p.CENTER, p.BOTTOM);
    for (const pk of an.peaks) {
      if (pk.db < -floor + 1) continue;
      const px = fr.X(deg(pk.theta)), py = fr.Y(pk.db);
      p.fill(pk === an.main ? COLORS.green : COLORS.red);
      p.triangle(px - 4, py - 9, px + 4, py - 9, px, py - 2);
      if (pk !== an.main) p.text(`${fmt(pk.db, 3)}`, px, py - 10);
    }

    // ---- read-outs ----
    const gratLobes = an.grating;
    const uniSll = D.N > 1 ? -13.26 : -Infinity;
    const lines = [
      { text: `N = ${N}, d = ${fmt(d, 3)} λ, scan θ₀ = ${fmt(D.steerDeg, 4)}° ⇒ β = −k d cosθ₀ = ${fmt(deg(beta), 4)}°       element: ${D.elem === 'iso' ? 'isotropic' : D.elem === 'short' ? 'short dipole' : 'half-wave dipole'}`, color: pal.fg },
      `main beam at ${fmt(deg(an.mainTheta), 4)}°, HPBW ${an.hpbw === null ? '-' : fmt(deg(an.hpbw), 3)}°${an.hpbwEdge ? ' (end-fire: one side cut off)' : ''}   largest sidelobe ${Number.isFinite(an.sllDb) ? `${fmt(an.sllDb, 3)} dB` : 'none'}   (uniform array: ${fmt(uniSll, 4)} dB)`,
      `directivity D = ${fmt(an.directivity, 4)} = ${fmt(an.directivityDbi, 3)} dBi   (numeric integral of the pattern)    nulls: ${an.nulls.length}    Σw = ${fmt(D.sum, 3)}`,
      gratLobes.length ? { text: `grating lobe${gratLobes.length > 1 ? 's' : ''} at θ = ${gratLobes.map((g) => `${fmt(deg(g.theta), 3)}°`).join(', ')} (d = ${fmt(d, 3)} λ exceeds ${fmt(A.maxSpacingNoGrating(t0), 3)} λ)`, color: COLORS.red } : `no grating lobes: d < ${fmt(A.maxSpacingNoGrating(t0), 3)} λ at this scan angle`,
      { text: 'AF(ψ) = Σ wₙ e^{j n ψ}: the DFT of the weights. Angle θ only picks the window [β − kd, β + kd] of ψ (green); a smoother taper lowers sidelobes but widens the beam.', color: pal.muted },
    ];
    textBlock(p, pal, lines, lay.bars.x - 20, lay.textY, S.w - lay.bars.x, 15);
    S.st.linear = { D, lay };
  },
};
