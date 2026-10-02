// Tab 1: 2D vector field explorer. Arrow grid, RK4 streamlines, LIC-style texture, div / curl colour
// maps, and a draggable probe with F, div, curl, Jacobian, its eigen-structure, a paddle wheel
// (spins with curl) and an expanding disc (area changes with div).

import { Viewport } from '../approx/view.js';
import {
  streamline2, licField, eigen2,
} from '../../lib/vectorcalc.js';
import { model2, clamp, fmt, rnd } from './state.js';
import {
  withClip, arrow, hud, diverging, sequential, robustScale, ensureImage, drawAxes2D, drawLegend, dist2,
} from './util.js';

const CELL = 4; // colour-map cell size in px
const LIC_CELL = 3;

/** Writes a Float32 value grid into an image through a colour function. */
function paintImage(img, vals, n, colorAt) {
  img.loadPixels();
  const px = img.pixels;
  for (let i = 0; i < n; i++) {
    const c = colorAt(vals[i]);
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = c[3] === undefined ? 255 : c[3];
  }
  img.updatePixels();
}

export function createField2Tab(env) {
  const { p } = env;
  const vp = new Viewport(-3.2, 3.2, -2.4, 2.4);
  const st = {
    colorImg: {}, licImg: {}, streams: null, streamKey: '', drag: null, wheelAt: -1e9,
    wheelAngle: 0, discT: 0, info: null, rectKey: '', lastModel: null,
  };

  function fitRect() {
    const r = env.rect();
    const key = `${r.w}x${r.h}`;
    if (key !== st.rectKey) {
      st.rectKey = key;
      vp.setRect(r.x, r.y, r.w, r.h).lockAspect();
    } else vp.setRect(r.x, r.y, r.w, r.h);
  }
  const bounds = () => ({ xmin: vp.xmin, xmax: vp.xmax, ymin: vp.ymin, ymax: vp.ymax });
  const bkey = (b) => `${b.xmin.toPrecision(6)},${b.xmax.toPrecision(6)},${b.ymin.toPrecision(6)},${b.ymax.toPrecision(6)}`;
  const busy = () => !!st.drag || (typeof performance !== 'undefined' ? performance.now() : Date.now()) - st.wheelAt < 160;
  const probe = () => [env.get('px'), env.get('py')];

  function safeF(m) {
    return (x, y) => {
      const v = m.field.f(x, y);
      return Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : [0, 0];
    };
  }

  // ---- cached layers ----
  function updateColorMap(m, h) {
    const mode = env.get('colorBy');
    const holder = st.colorImg;
    if (mode === 'none') { holder.img = null; return; }
    const r = env.rect();
    const cw = Math.max(8, Math.ceil(r.w / CELL)), ch = Math.max(8, Math.ceil(r.h / CELL));
    const b = bounds();
    const key = `${m.key}|${mode}|${h}|${bkey(b)}|${cw}x${ch}`;
    if (holder.key === key && holder.img) return;
    if (busy() && holder.img) { env.retry(); return; }
    const img = ensureImage(p, holder, cw, ch);
    const vals = new Float32Array(cw * ch);
    const F = m.field;
    const dx = (b.xmax - b.xmin) / cw, dy = (b.ymax - b.ymin) / ch;
    for (let j = 0; j < ch; j++) {
      const y = b.ymax - (j + 0.5) * dy;
      for (let i = 0; i < cw; i++) {
        const x = b.xmin + (i + 0.5) * dx;
        let v;
        if (mode === 'div') v = F.div(x, y, h);
        else if (mode === 'curl') v = F.curl(x, y, h);
        else { const f = F.f(x, y); v = Math.hypot(f[0], f[1]); }
        vals[j * cw + i] = Number.isFinite(v) ? v : 0;
      }
    }
    const signed = mode !== 'mag';
    let scale = signed ? robustScale(vals) : Math.max(1e-9, robustScale(vals, 0.98));
    // snap to a 1-2-5 scale so the legend is readable and the colours stay stable while panning
    const e = 10 ** Math.floor(Math.log10(scale));
    scale = [1, 2, 5, 10].find((s) => s * e >= scale) * e;
    const dark = env.pal().dark;
    paintImage(img, vals, cw * ch, signed ? (v) => diverging(v / scale, dark) : (v) => sequential(v / scale));
    holder.key = key; holder.bounds = b; holder.scale = scale; holder.signed = signed; holder.mode = mode;
  }

  function updateLic(m) {
    const holder = st.licImg;
    if (!env.get('showLic')) return;
    const r = env.rect();
    const cw = Math.max(8, Math.ceil(r.w / LIC_CELL)), ch = Math.max(8, Math.ceil(r.h / LIC_CELL));
    const b = bounds();
    const key = `${m.key}|${bkey(b)}|${cw}x${ch}`;
    if (holder.key === key && holder.img) return;
    if (busy() && holder.img) { env.retry(); return; }
    const img = ensureImage(p, holder, cw, ch);
    const { lic } = licField(safeF(m), b, cw, ch, { steps: 7, stepPx: 0.9 });
    const dark = env.pal().dark;
    paintImage(img, lic, cw * ch, (t) => (dark ? [255, 255, 255, Math.round(t * 120)] : [0, 0, 0, Math.round(t * 120)]));
    holder.key = key; holder.bounds = b;
  }

  function drawLayerImage(holder) {
    if (!holder.img || !holder.bounds) return;
    const b = holder.bounds;
    const x0 = vp.toX(b.xmin), x1 = vp.toX(b.xmax), y0 = vp.toY(b.ymax), y1 = vp.toY(b.ymin);
    if (![x0, x1, y0, y1].every(Number.isFinite)) return;
    p.image(holder.img, x0, y0, x1 - x0, y1 - y0);
  }

  function updateStreams(m) {
    const b = bounds();
    const key = `${m.key}|${bkey(b)}`;
    if (key === st.streamKey && st.streams) return;
    if (busy() && st.streams) { env.retry(); return; }
    const F = safeF(m);
    const span = b.xmax - b.xmin;
    const h = span / 110;
    const nx = 9, ny = Math.max(4, Math.round((9 * (b.ymax - b.ymin)) / span));
    const lines = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = b.xmin + ((i + 0.5) / nx) * span, y = b.ymin + ((j + 0.5) / ny) * (b.ymax - b.ymin);
        const f = streamline2(F, x, y, { h, maxSteps: 110, dir: 1, bounds: b });
        const g = streamline2(F, x, y, { h, maxSteps: 110, dir: -1, bounds: b });
        // join: reversed backward line + forward line (direction of flow = increasing index)
        const pts = [];
        for (let k = g.count - 1; k >= 1; k--) pts.push(g.pts[2 * k], g.pts[2 * k + 1]);
        for (let k = 0; k < f.count; k++) pts.push(f.pts[2 * k], f.pts[2 * k + 1]);
        if (pts.length >= 6) lines.push(pts);
      }
    }
    st.streams = lines; st.streamKey = key;
  }

  function drawStreams(pal) {
    if (!st.streams) return;
    p.noFill();
    p.stroke(pal.dark ? [120, 190, 255, 150] : [20, 90, 190, 150]);
    p.strokeWeight(1.2);
    for (const pts of st.streams) {
      p.beginShape();
      for (let k = 0; k < pts.length; k += 4) p.vertex(vp.toX(pts[k]), vp.toY(pts[k + 1]));
      p.endShape();
      // direction chevron at the middle
      const mid = Math.floor(pts.length / 4) * 2;
      if (mid + 2 < pts.length) {
        p.stroke(pal.dark ? [160, 210, 255, 220] : [10, 70, 170, 220]);
        arrow(p, vp.toX(pts[mid]), vp.toY(pts[mid + 1]), vp.toX(pts[mid + 2]), vp.toY(pts[mid + 3]), 7);
        p.stroke(pal.dark ? [120, 190, 255, 150] : [20, 90, 190, 150]);
      }
    }
  }

  function drawArrows(m, pal) {
    const r = env.rect();
    const n = clamp(Math.round(env.get('arrowDensity')), 6, 40);
    const cell = r.w / n;
    const nx = n, ny = Math.max(2, Math.floor(r.h / cell));
    const F = safeF(m);
    const norm = !!env.get('normalize');
    const items = [];
    let maxM = 1e-12;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const sx = r.x + (i + 0.5) * cell, sy = r.y + (j + 0.5) * cell + (r.h - ny * cell) / 2;
        const v = F(vp.fromX(sx), vp.fromY(sy));
        const mag = Math.hypot(v[0], v[1]);
        maxM = Math.max(maxM, mag);
        items.push([sx, sy, v[0], v[1], mag]);
      }
    }
    // Typical magnitude (90th percentile) sets the scale so one huge value does not flatten the rest.
    const mags = items.map((q) => q[4]).sort((a, b) => a - b);
    const ref = Math.max(1e-12, mags[Math.floor(0.9 * (mags.length - 1))] || maxM);
    p.strokeWeight(1.3);
    for (const [sx, sy, fx, fy, mag] of items) {
      if (!(mag > 1e-12)) continue;
      const len = norm ? cell * 0.78 : Math.min(cell * 1.5, (cell * 0.78 * mag) / ref);
      const ux = fx / mag, uy = -fy / mag; // screen y points down
      const c = sequential(clamp(mag / (maxM > ref * 3 ? ref * 2 : maxM), 0, 1));
      p.stroke(c[0], c[1], c[2], 235);
      p.fill(c[0], c[1], c[2], 235);
      arrow(p, sx - (ux * len) / 2, sy - (uy * len) / 2, sx + (ux * len) / 2, sy + (uy * len) / 2, Math.min(7, cell * 0.3));
    }
    void pal;
  }

  function probeInfo() {
    const m = model2(env.get);
    const h = 10 ** env.get('stepExp');
    const [x, y] = probe();
    const f = m.field.f(x, y);
    const J = m.field.jac(x, y, h);
    const div = J[0][0] + J[1][1], curl = J[1][0] - J[0][1];
    return { m, x, y, F: f, J, div, curl, eig: eigen2(J), h };
  }

  function drawProbe(pal, dt) {
    const inf = probeInfo();
    st.info = inf;
    const sx = vp.toX(inf.x), sy = vp.toY(inf.y);
    if (!Number.isFinite(sx + sy)) return inf;
    withClip(p, env.rect(), () => {
      // eigenvectors of the Jacobian
      if (inf.eig.v1 && inf.eig.type !== 'centre') {
        const drawEv = (v, l, col) => {
          if (!v) return;
          p.stroke(col);
          p.strokeWeight(1);
          p.line(sx - v[0] * 60, sy + v[1] * 60, sx + v[0] * 60, sy - v[1] * 60);
          p.noStroke(); p.fill(col);
          p.textSize(10); p.textAlign(p.LEFT, p.CENTER);
          p.text(`lambda=${fmt(l, 3)}`, sx + v[0] * 62 + 2, sy - v[1] * 62);
        };
        drawEv(inf.eig.v1, inf.eig.l1.re, pal.dark ? [255, 200, 90, 200] : [190, 110, 0, 220]);
        if (inf.eig.v2 && inf.eig.type !== 'degenerate node') drawEv(inf.eig.v2, inf.eig.l2.re, pal.dark ? [255, 140, 220, 200] : [170, 40, 130, 220]);
      }
      // probe streamline (both directions)
      const m = inf.m;
      const F = safeF(m);
      const span = vp.xmax - vp.xmin;
      p.noFill(); p.stroke(pal.accent); p.strokeWeight(2);
      for (const dir of [1, -1]) {
        const s = streamline2(F, inf.x, inf.y, { h: span / 120, maxSteps: 220, dir, bounds: bounds() });
        p.beginShape();
        for (let k = 0; k < s.count; k += 2) p.vertex(vp.toX(s.pts[2 * k]), vp.toY(s.pts[2 * k + 1]));
        p.endShape();
      }
      // expanding disc (area ~ exp(div * t)) and paddle wheel (omega = curl / 2)
      if (env.get('probeAnim')) {
        st.discT = (st.discT + dt) % 1.6;
        st.wheelAngle += clamp(inf.curl / 2, -6, 6) * dt;
        const area = Math.exp(clamp(inf.div, -4, 4) * st.discT);
        const R = 34 * Math.sqrt(area);
        p.noFill();
        p.stroke(pal.dark ? [120, 255, 170, 90] : [10, 140, 70, 110]); p.strokeWeight(1);
        p.circle(sx, sy, 68);
        p.stroke(pal.dark ? [120, 255, 170, 230] : [10, 140, 70, 240]); p.strokeWeight(2);
        p.circle(sx, sy, clamp(2 * R, 4, 260));
        p.stroke(pal.fg); p.strokeWeight(2);
        const rw = 15;
        for (let k = 0; k < 4; k++) {
          const a = st.wheelAngle + (k * Math.PI) / 2, cx = Math.cos(a), cy = Math.sin(a);
          p.line(sx, sy, sx + cx * rw, sy - cy * rw);
          p.line(sx + cx * rw - cy * 5, sy - cy * rw - cx * 5, sx + cx * rw + cy * 5, sy - cy * rw + cx * 5);
        }
      }
      p.stroke(pal.bg); p.strokeWeight(2); p.fill(pal.accent);
      p.circle(sx, sy, 11);
    });
    return inf;
  }

  function drawHud(pal, inf) {
    const { J, eig } = inf;
    const m = inf.m;
    const lines = [{ text: `${m.label}`, color: pal.accent }];
    if (m.error) lines.push({ text: `expression error: ${m.error}`, color: '#ff6b6b' });
    lines.push(`probe (${fmt(inf.x, 3)}, ${fmt(inf.y, 3)})    F = (${fmt(inf.F[0])}, ${fmt(inf.F[1])})    |F| = ${fmt(Math.hypot(inf.F[0], inf.F[1]))}`);
    lines.push(`div F = ${fmt(inf.div)}      curl F = ${fmt(inf.curl)}      (${m.analytic ? 'analytic' : `numeric, step ${fmt(inf.h, 2)}`})`);
    lines.push(`J = [ ${fmt(J[0][0], 3)}  ${fmt(J[0][1], 3)} ; ${fmt(J[1][0], 3)}  ${fmt(J[1][1], 3)} ]   tr = div, det = ${fmt(eig.det, 3)}`);
    const ev = eig.l1.im ? `${fmt(eig.l1.re, 3)} +/- ${fmt(Math.abs(eig.l1.im), 3)} i` : `${fmt(eig.l1.re, 3)}, ${fmt(eig.l2.re, 3)}`;
    lines.push(`eigenvalues ${ev}  =>  ${eig.type}`);
    lines.push({ text: m.caption, color: pal.muted });
    lines.push({ text: 'drag the probe - drag empty space to pan - wheel to zoom - R resets the view', color: pal.muted });
    hud(p, pal, lines, 10, 10, Math.min(640, env.rect().w - 20));
  }

  function draw(dt) {
    const pal = env.pal();
    fitRect();
    const m = model2(env.get);
    st.lastModel = m;
    const h = 10 ** env.get('stepExp');
    const r = env.rect();
    p.background(pal.bg);
    withClip(p, r, () => {
      updateColorMap(m, h);
      drawLayerImage(st.colorImg);
      if (env.get('showLic')) { updateLic(m); drawLayerImage(st.licImg); }
    });
    drawAxes2D(p, pal, vp, { grid: !st.colorImg.img });
    withClip(p, r, () => {
      if (env.get('showStream')) { updateStreams(m); drawStreams(pal); }
      if (env.get('showArrows')) drawArrows(m, pal);
    });
    const inf = drawProbe(pal, dt);
    const ci = st.colorImg;
    if (ci.img && ci.mode !== 'none') drawLegend(p, pal, r, ci.mode === 'div' ? 'div F' : ci.mode === 'curl' ? 'curl F' : '|F|', ci.scale, ci.signed);
    drawHud(pal, inf);
  }

  return {
    draw,
    wantsFrames: () => !!env.get('probeAnim'),
    press(x, y) {
      const [px, py] = probe();
      const onProbe = dist2(x, y, vp.toX(px), vp.toY(py)) < 16;
      st.drag = { mode: onProbe ? 'probe' : 'pan', x, y, moved: false };
      if (onProbe) this.drag(x, y);
      return true;
    },
    drag(x, y) {
      const d = st.drag;
      if (!d) return false;
      if (dist2(x, y, d.x, d.y) > 3) d.moved = true;
      if (d.mode === 'probe') {
        env.commit('px', rnd(vp.fromX(x), 3)); env.commit('py', rnd(vp.fromY(y), 3));
      } else {
        vp.panPx(x - d.x, y - d.y); d.x = x; d.y = y;
      }
      return true;
    },
    release(x, y) {
      const d = st.drag;
      st.drag = null;
      if (d && d.mode === 'pan' && !d.moved && x !== undefined && vp.contains(x, y)) {
        env.commit('px', rnd(vp.fromX(x), 3)); env.commit('py', rnd(vp.fromY(y), 3));
      }
      env.flush();
    },
    wheel(x, y, delta) {
      if (!vp.contains(x, y)) return false;
      vp.zoomAt(x, y, Math.exp(clamp(delta, -300, 300) * 0.0012));
      st.wheelAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      return true;
    },
    reset() { vp.set(-3.2, 3.2, -2.4, 2.4); vp.lockAspect(); st.streamKey = ''; },
    probeInfo,
    debug: () => ({ vp, info: st.info, streams: st.streams, color: st.colorImg, lic: st.licImg, busy: busy() }),
  };
}
