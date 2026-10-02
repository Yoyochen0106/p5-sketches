// Tab 4: scalar potential of a curl-free field (or stream function of a divergence-free one) with
// equipotentials orthogonal to the field lines, plus the Helmholtz decomposition of a field on a
// periodic grid into a curl-free and a divergence-free part (three panels).

import { Viewport } from '../approx/view.js';
import { marchingSquares } from '../../lib/marching.js';
import {
  potentialFromField2, streamFunction2, potentialError, poissonResidual, classifyField2, streamline2, pathIntegral2, bumpPath,
  helmholtz2, gridFromField2, spectralDivCurl, blobField2,
} from '../../lib/vectorcalc.js';
import {
  model2, parseBlobs, formatBlobs, clamp, fmt, rnd,
} from './state.js';
import {
  withClip, arrow, hud, drawAxes2D, drawLegend, sequential, diverging, ensureImage, updateScalarImage, drawBoundsImage, dist2,
} from './util.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const HL = 8; // Helmholtz domain [-4, 4)^2
const HX0 = -4;

export function createPotentialTab(env) {
  const { p } = env;
  const vp = new Viewport(-3.2, 3.2, -2.4, 2.4);
  const st = {
    drag: null, rectKey: '', wheelAt: -1e9, pot: null, potKey: '', img: {}, contours: null, streams: null, streamKey: '', info: null,
    hel: null, helKey: '', panels: [], panelImgs: [{}, {}, {}], handles: [], helInfo: null,
  };

  function fitRect() {
    const r = env.rect();
    const key = `${r.w}x${r.h}`;
    if (key !== st.rectKey) { st.rectKey = key; vp.setRect(r.x, r.y, r.w, r.h).lockAspect(); } else vp.setRect(r.x, r.y, r.w, r.h);
  }
  const busy = () => !!st.drag || now() - st.wheelAt < 160;
  const bounds = () => ({ xmin: vp.xmin, xmax: vp.xmax, ymin: vp.ymin, ymax: vp.ymax });
  const bkey = (b) => `${b.xmin.toPrecision(5)},${b.xmax.toPrecision(5)},${b.ymin.toPrecision(5)},${b.ymax.toPrecision(5)}`;
  const safeF = (m) => (x, y) => { const v = m.field.f(x, y); return Number.isFinite(v[0]) && Number.isFinite(v[1]) ? v : [0, 0]; };

  // ------------------------------------------------------------------ potential mode
  function whatToShow(m) {
    const want = env.get('pwhat');
    const cls = classifyField2(m.field, bounds(), 13, 1e-3);
    let what = want;
    if (want === 'auto') what = cls.curlFree ? 'potential' : cls.divFree ? 'stream' : 'none';
    return { what, cls };
  }

  function updatePotential(m, what) {
    const b = bounds();
    const r = env.rect();
    const nx = clamp(Math.ceil(r.w / 7), 24, 130), ny = clamp(Math.ceil(r.h / 7), 24, 100);
    const base = [env.get('bx'), env.get('by')];
    const key = `${m.key}|${what}|${bkey(b)}|${nx}x${ny}|${base.join()}`;
    if (key === st.potKey && st.pot) return;
    if (busy() && st.pot) { env.retry(); return; }
    const F = safeF(m);
    const pot = what === 'stream' ? streamFunction2(F, base, b, nx, ny) : potentialFromField2(F, base, b, nx, ny);
    st.pot = pot; st.potKey = key; st.potWhat = what;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pot.phi.length; i++) { const v = pot.phi[i]; if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    if (!(hi > lo)) { lo = -1; hi = 1; }
    pot.lo = lo; pot.hi = hi;
    // contours
    const nl = clamp(Math.round(env.get('levels')), 2, 40);
    const grid = { values: Float32Array.from(pot.phi), nx: nx - 1, ny: ny - 1, nz: 0, bounds: b };
    const segs = [];
    for (let k = 1; k <= nl; k++) {
      const level = lo + ((hi - lo) * k) / (nl + 1);
      const ms = marchingSquares(grid, { level });
      segs.push(ms.segments.subarray(0, ms.count * 4));
    }
    st.contours = segs;
    st.errors = {
      grad: what === 'stream' ? potentialError((x, y) => { const v = F(x, y); return [-v[1], v[0]]; }, pot) : potentialError(F, pot),
      poisson: what === 'potential' ? poissonResidual(m.field, pot) : null,
    };
  }

  function sampleScalar(x, y) {
    const pot = st.pot;
    if (!pot) return 0;
    const b = pot.bounds;
    const fx = ((x - b.xmin) / (b.xmax - b.xmin)) * (pot.nx - 1), fy = ((y - b.ymin) / (b.ymax - b.ymin)) * (pot.ny - 1);
    const i = clamp(Math.floor(fx), 0, pot.nx - 2), j = clamp(Math.floor(fy), 0, pot.ny - 2);
    const u = clamp(fx - i, 0, 1), v = clamp(fy - j, 0, 1);
    const g = pot.phi, W = pot.nx;
    return g[j * W + i] * (1 - u) * (1 - v) + g[j * W + i + 1] * u * (1 - v) + g[(j + 1) * W + i] * (1 - u) * v + g[(j + 1) * W + i + 1] * u * v;
  }

  function updateStreams(m) {
    const b = bounds();
    const key = `${m.key}|${bkey(b)}`;
    if (key === st.streamKey && st.streams) return;
    if (busy() && st.streams) { env.retry(); return; }
    const F = safeF(m);
    const span = b.xmax - b.xmin, lines = [];
    const nx = 8, ny = Math.max(4, Math.round((8 * (b.ymax - b.ymin)) / span));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = b.xmin + ((i + 0.5) / nx) * span, y = b.ymin + ((j + 0.5) / ny) * (b.ymax - b.ymin);
        const f = streamline2(F, x, y, { h: span / 110, maxSteps: 100, dir: 1, bounds: b }), g = streamline2(F, x, y, { h: span / 110, maxSteps: 100, dir: -1, bounds: b });
        const pts = [];
        for (let k = g.count - 1; k >= 1; k--) pts.push(g.pts[2 * k], g.pts[2 * k + 1]);
        for (let k = 0; k < f.count; k++) pts.push(f.pts[2 * k], f.pts[2 * k + 1]);
        if (pts.length >= 6) lines.push(pts);
      }
    }
    st.streams = lines; st.streamKey = key;
  }

  function drawPotential(pal, dt) {
    void dt;
    const m = model2(env.get);
    const r = env.rect();
    const { what, cls } = whatToShow(m);
    p.background(pal.bg);
    if (what !== 'none') {
      updatePotential(m, what);
      const pot = st.pot;
      withClip(p, r, () => {
        updateScalarImage(p, st.img, {
          rect: r, bounds: bounds(), key: `${st.potKey}|img`, valueAt: (x, y) => (sampleScalar(x, y) - pot.lo) / (pot.hi - pot.lo), signed: false, dark: pal.dark,
          busy: busy(), retry: env.retry, scale: 1, cell: 5,
        });
        drawBoundsImage(p, st.img, vp, 170);
      });
    } else st.img.img = null;
    drawAxes2D(p, pal, vp, { grid: what === 'none' });
    const probe = [env.get('px'), env.get('py')], base = [env.get('bx'), env.get('by')];
    let lines;
    withClip(p, r, () => {
      updateStreams(m);
      p.noFill();
      p.stroke(pal.dark ? [120, 230, 255, 190] : [0, 110, 160, 200]); p.strokeWeight(1.1);
      for (const pts of st.streams) {
        p.beginShape();
        for (let k = 0; k < pts.length; k += 4) p.vertex(vp.toX(pts[k]), vp.toY(pts[k + 1]));
        p.endShape();
        const mid = Math.floor(pts.length / 4) * 2;
        if (mid + 2 < pts.length) arrow(p, vp.toX(pts[mid]), vp.toY(pts[mid + 1]), vp.toX(pts[mid + 2]), vp.toY(pts[mid + 3]), 7);
      }
      if (what !== 'none' && st.contours) {
        p.stroke(pal.dark ? [255, 150, 60, 235] : [200, 70, 0, 235]); p.strokeWeight(1.6);
        for (const seg of st.contours) for (let k = 0; k < seg.length; k += 4) p.line(vp.toX(seg[k]), vp.toY(seg[k + 1]), vp.toX(seg[k + 2]), vp.toY(seg[k + 3]));
      }
      // base and probe markers
      p.stroke(pal.bg); p.strokeWeight(2);
      p.fill(255, 210, 70); p.rect(vp.toX(base[0]) - 6, vp.toY(base[1]) - 6, 12, 12);
      p.fill(pal.accent); p.circle(vp.toX(probe[0]), vp.toY(probe[1]), 12);
    });
    // read-outs
    const hl = [{ text: `${m.label}`, color: pal.accent }];
    if (m.error) hl.push({ text: `expression error: ${m.error}`, color: '#ff6b6b' });
    hl.push(`max |curl F| = ${fmt(cls.maxCurl, 3)}   max |div F| = ${fmt(cls.maxDiv, 3)}   ->  ${cls.curlFree ? 'curl-free (conservative)' : cls.divFree ? 'divergence-free (solenoidal)' : 'neither: use the Helmholtz view'}`);
    if (what === 'none') {
      hl.push({ text: 'No scalar potential (curl F != 0) and no stream function (div F != 0) exist for this field.', color: '#ffb84d' });
    } else {
      const sym = what === 'potential' ? 'phi' : 'psi';
      const val = sampleScalar(probe[0], probe[1]);
      hl.push(what === 'potential'
        ? 'potential phi(P) = integral from base O to P of F.dr  (O = gold square, phi(O) = 0);  field lines cyan, equipotentials orange'
        : 'stream function psi: grad psi = (-Fy, Fx), contours of psi ARE the streamlines (flux between them is constant)');
      hl.push(`${sym}(probe) = ${fmt(val, 5)}   range [${fmt(st.pot.lo, 3)}, ${fmt(st.pot.hi, 3)}]   ${st.contours ? `${st.contours.length} levels` : ''}`);
      // check: integrate along a curved path from base to probe
      const F = what === 'potential' ? safeF(m) : (x, y) => { const v = safeF(m)(x, y); return [-v[1], v[0]]; };
      const viaBump = pathIntegral2(F, bumpPath(base, probe, 0.5, 40));
      hl.push(`integral O to P along a curved path = ${fmt(viaBump, 5)}   (should equal ${sym}(P) - ${sym}(O); difference ${fmt(viaBump - val, 2)})`);
      hl.push(`reconstruction: max |grad ${sym} - F| = ${fmt(st.errors.grad, 2)} (grid, O(h^2))${st.errors.poisson !== null ? `   Poisson check max |lap phi - div F| = ${fmt(st.errors.poisson, 2)}` : ''}`);
      const ang = orthogonality(m, probe);
      if (ang !== null && what === 'potential') hl.push({ text: `angle between the field line and the nearest equipotential at the probe: ${fmt(ang, 4)} deg (orthogonal = 90)`, color: pal.dark ? '#7ee787' : '#1a7f37' });
      if (what === 'potential' && !cls.curlFree) hl.push({ text: 'forced potential on a rotational field: the check above fails, because the integral depends on the path', color: '#ffb84d' });
    }
    hl.push({ text: 'click: move the base point O - drag the red probe - drag to pan - wheel zooms', color: pal.muted });
    lines = hl;
    hud(p, pal, lines, 10, 10, Math.min(860, r.w - 20));
    if (st.img.img && what !== 'none') drawLegend(p, pal, r, what === 'potential' ? 'phi' : 'psi', 1, false);
  }

  /** Angle (deg) between F and the tangent of the nearest contour segment to P. */
  function orthogonality(m, P) {
    if (!st.contours) return null;
    let best = null, bd = Infinity;
    for (const seg of st.contours) {
      for (let k = 0; k < seg.length; k += 4) {
        const mx = (seg[k] + seg[k + 2]) / 2, my = (seg[k + 1] + seg[k + 3]) / 2, d = (mx - P[0]) ** 2 + (my - P[1]) ** 2;
        if (d < bd) { bd = d; best = [mx, my, seg[k + 2] - seg[k], seg[k + 3] - seg[k + 1]]; }
      }
    }
    if (!best) return null;
    const f = safeF(m)(best[0], best[1]);
    const fm = Math.hypot(f[0], f[1]), tm = Math.hypot(best[2], best[3]);
    if (!(fm > 1e-9) || !(tm > 1e-12)) return null;
    return (Math.acos(clamp(Math.abs(f[0] * best[2] + f[1] * best[3]) / (fm * tm), 0, 1)) * 180) / Math.PI;
  }

  // ------------------------------------------------------------------ Helmholtz mode
  function taper(x, y) {
    // smooth window: 1 in the interior, cos^2 roll-off to 0 over the outer 18% of the periodic box
    const w = (u) => {
      const a = Math.abs(u) / (HL / 2), e = 0.82;
      if (a <= e) return 1;
      const t = (a - e) / (1 - e);
      return t >= 1 ? 0 : Math.cos((t * Math.PI) / 2) ** 2;
    };
    return w(x) * w(y);
  }

  function helmholtzData(m) {
    const n = Math.round(env.get('hn'));
    const src = env.get('hsrc');
    const blobStr = env.get('blobs');
    const key = `${src}|${src === 'field' ? m.key : blobStr}|${n}`;
    if (key === st.helKey && st.hel) return st.hel;
    let f;
    if (src === 'drawn') {
      const g = blobField2(parseBlobs(blobStr));
      f = g;
    } else {
      const F = safeF(m);
      f = (x, y) => { const w = taper(x, y), v = F(x, y); return [v[0] * w, v[1] * w]; };
    }
    const grid = gridFromField2(f, HX0, HX0, HL, n);
    const h = helmholtz2(grid.fx, grid.fy, n, HL);
    const dcG = spectralDivCurl(h.gx, h.gy, n, HL), dcS = spectralDivCurl(h.sx, h.sy, n, HL), dcF = spectralDivCurl(grid.fx, grid.fy, n, HL);
    const N = n * n;
    let rec = 0, eF = 0, eG = 0, eS = 0;
    for (let i = 0; i < N; i++) {
      rec = Math.max(rec, Math.abs(h.gx[i] + h.sx[i] + h.mx - grid.fx[i]), Math.abs(h.gy[i] + h.sy[i] + h.my - grid.fy[i]));
      eF += grid.fx[i] ** 2 + grid.fy[i] ** 2; eG += h.gx[i] ** 2 + h.gy[i] ** 2; eS += h.sx[i] ** 2 + h.sy[i] ** 2;
    }
    const mx = (a) => { let r = 0; for (let i = 0; i < a.length; i++) r = Math.max(r, Math.abs(a[i])); return r; };
    st.hel = {
      n, grid, h, dcG, dcS, dcF, rec, energy: [eF, eG, eS], key,
      maxDivG: mx(dcG.div), maxCurlG: mx(dcG.curl), maxDivS: mx(dcS.div), maxCurlS: mx(dcS.curl), maxDivF: mx(dcF.div), maxCurlF: mx(dcF.curl),
    };
    st.helKey = key;
    return st.hel;
  }

  function drawPanel(pal, idx, rect, title, fx, fy, color, n, scalar, subtitle) {
    const holder = st.panelImgs[idx];
    const img = ensureImage(p, holder, n, n);
    const key = `${st.hel.key}|${idx}|${pal.dark}`;
    if (holder.key !== key) {
      let sc = 1e-12;
      const vals = new Float32Array(n * n);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const k = j * n + i;
          vals[k] = color === 'mag' ? Math.hypot(fx[k], fy[k]) : scalar[k];
          sc = Math.max(sc, Math.abs(vals[k]));
        }
      }
      img.loadPixels();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const v = vals[(n - 1 - j) * n + i]; // image row 0 = top = max y
          const c = color === 'mag' ? sequential(v / sc) : diverging(v / sc, pal.dark);
          const o = (j * n + i) * 4;
          img.pixels[o] = c[0]; img.pixels[o + 1] = c[1]; img.pixels[o + 2] = c[2]; img.pixels[o + 3] = 255;
        }
      }
      img.updatePixels();
      holder.key = key; holder.scale = sc;
    }
    p.image(img, rect.x, rect.y, rect.w, rect.h);
    // arrows
    const na = 14, cell = rect.w / na;
    let mx = 1e-12;
    for (let k = 0; k < n * n; k++) mx = Math.max(mx, Math.hypot(fx[k], fy[k]));
    p.stroke(pal.dark ? [255, 255, 255, 190] : [0, 0, 0, 190]); p.fill(pal.dark ? [255, 255, 255, 190] : [0, 0, 0, 190]); p.strokeWeight(1);
    for (let j = 0; j < na; j++) {
      for (let i = 0; i < na; i++) {
        const gi = Math.min(n - 1, Math.floor(((i + 0.5) * n) / na)), gj = Math.min(n - 1, Math.floor(((j + 0.5) * n) / na));
        const k = gj * n + gi, vx = fx[k], vy = fy[k], mag = Math.hypot(vx, vy);
        if (!(mag > 1e-3 * mx)) continue;
        const len = (cell * 0.9 * mag) / mx, cx = rect.x + (i + 0.5) * cell, cy = rect.y + rect.h - (j + 0.5) * (rect.h / na);
        arrow(p, cx - (vx / mag) * len / 2, cy + (vy / mag) * len / 2, cx + (vx / mag) * len / 2, cy - (vy / mag) * len / 2, 4);
      }
    }
    p.noFill(); p.stroke(pal.border); p.strokeWeight(1); p.rect(rect.x, rect.y, rect.w, rect.h);
    p.noStroke(); p.fill(pal.fg); p.textSize(12); p.textAlign(p.LEFT, p.TOP);
    p.text(title, rect.x + 6, rect.y + 5);
    p.fill(pal.muted); p.textSize(10);
    p.text(subtitle, rect.x + 6, rect.y + 20);
  }

  function drawHelmholtz(pal) {
    const m = model2(env.get);
    const r = env.rect();
    p.background(pal.bg);
    const H = helmholtzData(m);
    const wide = r.w >= 1.4 * r.h;
    const gap = 8, infoH = 118;
    let panels;
    if (wide) {
      const pw = (r.w - 4 * gap) / 3, ph = Math.min(r.h - infoH - 2 * gap, pw);
      panels = [0, 1, 2].map((i) => ({ x: r.x + gap + i * (pw + gap), y: r.y + gap, w: pw, h: ph }));
    } else {
      const ph = Math.min((r.h - infoH - 4 * gap) / 3, r.w - 2 * gap);
      panels = [0, 1, 2].map((i) => ({ x: r.x + gap, y: r.y + gap + i * (ph + gap), w: ph, h: ph }));
    }
    panels = panels.map((q) => ({ ...q, w: Math.max(40, q.w), h: Math.max(40, q.h) }));
    st.panels = panels;
    const { n, grid, h } = H;
    drawPanel(pal, 0, panels[0], 'F  (original)', grid.fx, grid.fy, 'mag', n, null, `colour: |F|    max div ${fmt(H.maxDivF, 3)}   max curl ${fmt(H.maxCurlF, 3)}`);
    drawPanel(pal, 1, panels[1], 'curl-free part  grad(phi)', h.gx, h.gy, 'div', n, H.dcG.div, `colour: div (same as F's)    max curl ${fmt(H.maxCurlG, 2)}`);
    drawPanel(pal, 2, panels[2], 'divergence-free part  rot(psi)', h.sx, h.sy, 'curl', n, H.dcS.curl, `colour: curl (same as F's)    max div ${fmt(H.maxDivS, 2)}`);
    const tot = H.energy[0] || 1;
    const y0 = wide ? panels[0].y + panels[0].h + gap : r.y + r.h - infoH;
    const lines = [
      { text: `Helmholtz: F = grad(phi) + rot(psi) + const   (periodic ${n} x ${n} grid on [-4, 4)^2, FFT projection k(k.F^)/|k|^2)`, color: pal.accent },
      `reconstruction max |F - (G + S + mean)| = ${fmt(H.rec, 2)}      mean field (${fmt(h.mx, 3)}, ${fmt(h.my, 3)})`,
      `energy fractions: curl-free ${fmt((100 * H.energy[1]) / tot, 3)} %   divergence-free ${fmt((100 * H.energy[2]) / tot, 3)} %   (sum ${fmt((100 * (H.energy[1] + H.energy[2])) / tot, 4)} % + mean)`,
      env.get('hsrc') === 'drawn'
        ? { text: `drawn field: ${parseBlobs(env.get('blobs')).length} Gaussian blobs. Click the left panel to add one (kind in the drawer): sources land entirely in the curl-free part, vortices in the divergence-free part.`, color: pal.muted }
        : { text: 'field from the 2D tab, tapered to zero at the box edge (so it is periodic); non-conservative AND compressible fields split into both parts.', color: pal.muted },
    ];
    hud(p, pal, lines, r.x + 10, Math.max(y0, 6), Math.min(r.w - 20, 900));
  }

  function draw(dt) {
    fitRect();
    const pal = env.pal();
    if (env.get('pmode') === 'helmholtz') drawHelmholtz(pal);
    else drawPotential(pal, dt);
  }

  function addBlob(x, y) {
    const r = st.panels[0];
    if (!r) return false;
    const wx = HX0 + ((x - r.x) / r.w) * HL, wy = HX0 + ((r.y + r.h - y) / r.h) * HL;
    if (wx < HX0 || wx > HX0 + HL || wy < HX0 || wy > HX0 + HL) return false;
    const k = env.get('blobKind');
    const kind = k === 'vortex' || k === 'vortexneg' ? 'vortex' : 'source';
    const a = k === 'sink' || k === 'vortexneg' ? -1 : 1;
    const bs = parseBlobs(env.get('blobs'));
    bs.push({ x: wx, y: wy, s: 0.6, a, kind });
    env.set('blobs', formatBlobs(bs.slice(-12)));
    return true;
  }

  return {
    draw,
    wantsFrames: () => false,
    press(x, y) {
      if (env.get('pmode') === 'helmholtz') {
        if (env.get('hsrc') === 'drawn' && st.panels[0] && x >= st.panels[0].x && x <= st.panels[0].x + st.panels[0].w && y >= st.panels[0].y && y <= st.panels[0].y + st.panels[0].h) addBlob(x, y);
        return true;
      }
      const pr = [vp.toX(env.get('px')), vp.toY(env.get('py'))], bs = [vp.toX(env.get('bx')), vp.toY(env.get('by'))];
      if (dist2(x, y, pr[0], pr[1]) < 15) st.drag = { mode: 'probe', x, y, moved: false };
      else if (dist2(x, y, bs[0], bs[1]) < 15) st.drag = { mode: 'base', x, y, moved: false };
      else st.drag = { mode: 'pan', x, y, moved: false };
      return true;
    },
    drag(x, y) {
      const d = st.drag;
      if (!d) return false;
      if (dist2(x, y, d.x, d.y) > 3) d.moved = true;
      if (d.mode === 'probe') { env.commit('px', rnd(vp.fromX(x), 3)); env.commit('py', rnd(vp.fromY(y), 3)); } else if (d.mode === 'base') { env.commit('bx', rnd(vp.fromX(x), 3)); env.commit('by', rnd(vp.fromY(y), 3)); } else { vp.panPx(x - d.x, y - d.y); d.x = x; d.y = y; }
      return true;
    },
    release(x, y) {
      const d = st.drag;
      st.drag = null;
      if (d && d.mode === 'pan' && !d.moved && x !== undefined && vp.contains(x, y)) { env.commit('bx', rnd(vp.fromX(x), 3)); env.commit('by', rnd(vp.fromY(y), 3)); }
      env.flush();
    },
    wheel(x, y, delta) {
      if (env.get('pmode') === 'helmholtz' || !vp.contains(x, y)) return false;
      vp.zoomAt(x, y, Math.exp(clamp(delta, -300, 300) * 0.0012));
      st.wheelAt = now();
      return true;
    },
    reset() { vp.set(-3.2, 3.2, -2.4, 2.4); vp.lockAspect(); },
    clearBlobs() { env.set('blobs', ''); },
    debug: () => ({ vp, pot: st.pot, errors: st.errors, hel: st.hel, panels: st.panels, contours: st.contours }),
  };
}
