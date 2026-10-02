// Antenna Arrays & Radiation Patterns (course unit em-antenna).
//
// Public settings (deep-link keys):
//   tab     'linear' | 'planar' | 'element'
//   N       number of elements (2..32)   d spacing (wavelengths)   steer scan angle theta0 from the axis (deg, 90 = broadside)
//   taper   'uniform' | 'binomial' | 'chebyshev' | 'taylor' | 'hamming' | 'hann' | 'triangular' | 'custom'   sll sidelobe level (dB, positive)
//   w       custom weights "w0,w1,..." (used when taper = 'custom')    elem 'iso' | 'short' | 'half'
//   polarDb polar plot in dB   floor dB range (positive)   scan animate the steering angle   scanSpeed
//   Nx, Ny, dx, dy planar array size / spacing    pth, pph steering (deg from +z, azimuth)    pelem 'iso' | 'patch' | 'dipole'
//   pfloor  3D dB range   prender 'flat' | 'both' | 'wire'
//
// Key idea: the array factor AF(psi) = sum w_n e^{j n psi} is the DFT of the weights (spatial frequency psi <-> angle).

import { getPalette } from '../approx/palette.js';
import { CameraController } from '../shared3d/draw3d.js';
import {
  DEFAULTS, TABS, TAPER_OPTIONS, LINEAR_ELEMENTS, formatWeights, weightsNow,
} from './model.js';
import { linearTab } from './tab-linear.js';
import { planarTab } from './tab-planar.js';
import { elementTab } from './tab-element.js';
import {
  withDefaults, openInNodes, typing, onCanvas, clamp, round,
} from '../em-common/util.js';

const TAB_IMPL = { linear: linearTab, planar: planarTab, element: elementTab };

export default {
  id: 'em-antenna',
  title: 'Antenna Arrays & Radiation Patterns',
  description: 'Array factor as the DFT of the weights: tapers, steering, grating lobes, directivity, planar arrays with a 3D pattern and element patterns.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings, DEFAULTS);
    const get = (k) => store.get(k);
    const set = (k, v) => store.set(k, v);
    const cleanups = [];
    const st = { disposed: false, dirty: true, lastError: null, drawCount: 0, scanDeg: get('steer'), scanT: 0, wEdit: null };
    let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
    const S = { p: null, pal, get, set, st, w: 800, h: 600 };
    let doResize = () => {};

    // ---------- actions ----------
    const setMany = (o) => { for (const [k, v] of Object.entries(o)) set(k, v); };
    const resetAll = () => { setMany(DEFAULTS); st.wEdit = null; };
    const toTaper = () => { // freeze the current taper as editable custom weights
      set('w', formatWeights(weightsNow(get)));
      set('taper', 'custom');
    };

    const sketch = (p) => {
      S.p = p;
      const sizeNow = () => { const s = ctx.size(); return { w: Math.max(300, s.width), h: Math.max(300, s.height) }; };
      p.setup = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        S.w = w; S.h = h;
      };
      doResize = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        S.w = w; S.h = h; st.dirty = true;
      };
      const markDirty = () => { st.dirty = true; };
      const ctl = new CameraController(p, null, () => st.rect3d || { x: 0, y: 0, w: S.w, h: S.h }, { onChange: markDirty, resetKey: 'r' });
      st.ctl = ctl;
      const bindCam = () => { if (st.cam && ctl.camera !== st.cam) ctl.camera = st.cam; };
      const tab = () => TAB_IMPL[get('tab')] || linearTab;
      const isPlanar = () => get('tab') === 'planar';
      const inCanvas = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
      let active = false;

      p.mousePressed = (e) => {
        if (!onCanvas(p, e) || !inCanvas(p.mouseX, p.mouseY)) return;
        if (isPlanar()) { bindCam(); if (!st.cam) return; active = ctl.mousePressed(e); st.dirty = true; return; }
        if (p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return;
        active = !!tab().press?.(S, p.mouseX, p.mouseY);
        st.dirty = true;
      };
      p.mouseDragged = () => {
        if (!active) return;
        if (isPlanar()) { bindCam(); ctl.mouseDragged(); } else tab().drag?.(S, p.mouseX, p.mouseY);
        st.dirty = true;
      };
      p.mouseReleased = () => {
        if (!active) return;
        active = false;
        if (isPlanar()) ctl.mouseReleased(); else tab().release?.(S);
        st.dirty = true;
      };
      p.doubleClicked = (e) => { if (isPlanar() && st.cam) { bindCam(); ctl.doubleClicked(e); } else if (get('tab') === 'linear') { toDefaultTaper(); } };
      function toDefaultTaper() { if (get('taper') === 'custom') { set('taper', 'uniform'); } }
      p.mouseWheel = (e) => { if (isPlanar() && st.cam && onCanvas(p, e)) { bindCam(); return ctl.mouseWheel(e); } return true; };
      const touch1 = () => { const t = p.touches || []; return t.length === 1 ? t[0] : null; };
      p.touchStarted = (e) => {
        if (!onCanvas(p, e)) return true;
        if (isPlanar()) { bindCam(); return st.cam ? ctl.touchStarted(e) : true; }
        const t = touch1();
        if (t && inCanvas(t.x, t.y) && tab().press?.(S, t.x, t.y)) { active = true; st.dirty = true; return false; }
        return true;
      };
      p.touchMoved = () => {
        if (isPlanar()) { bindCam(); return ctl.touchMoved(); }
        const t = touch1();
        if (t && active) { tab().drag?.(S, t.x, t.y); st.dirty = true; return false; }
        return true;
      };
      p.touchEnded = () => {
        if (isPlanar()) return ctl.touchEnded();
        const was = active;
        active = false;
        if (was) { tab().release?.(S); st.dirty = true; }
        return was ? false : true;
      };
      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const k = String(p.key);
        if (typing(k)) return true;
        if (isPlanar()) { bindCam(); return ctl.keyPressed(e) ? false : true; }
        if (k === 's' || k === 'S') set('scan', !get('scan'));
        else if (k === 'u' || k === 'U') set('taper', 'uniform');
        else return true;
        return false;
      };

      p.draw = () => {
        if (st.disposed) return;
        const dt = clamp((p.deltaTime || 16) / 1000, 0, 0.1);
        S.pal = pal;
        let animating = false;
        if (get('scan') && get('tab') !== 'planar') {
          st.scanT += dt * clamp(Number(get('scanSpeed')) || 1, 0.1, 5);
          st.scanDeg = 90 + 75 * Math.sin(st.scanT * 0.9);
          animating = true;
        }
        if (!animating && !st.dirty) return;
        st.dirty = false;
        st.drawCount++;
        p.background(pal.bg);
        try {
          (TAB_IMPL[get('tab')] || linearTab).draw(S);
          bindCam();
          p.noStroke(); p.fill(pal.muted); p.textSize(11); p.textAlign(p.LEFT, p.TOP);
          if (get('tab') !== 'planar') p.text(TABS.find((t) => t.value === get('tab'))?.label || '', 10, 8);
        } catch (err) {
          p.noStroke(); p.fill('#ff6b6b'); p.textAlign(p.LEFT, p.TOP);
          p.text(`error: ${err && err.message ? err.message : err}`, 12, 24);
          st.lastError = err;
        }
      };
      cleanups.push(ctx.globalSettings.subscribe(() => { pal = getPalette(ctx.globalSettings.get('theme', 'dark')); st.dirty = true; }));
    };

    const instance = new ctx.p5(sketch, container);
    let scanWas = !!get('scan');
    cleanups.push(store.subscribe(() => {
      st.dirty = true;
      const sc = !!get('scan');
      if (sc && !scanWas) st.scanT = Math.asin(clamp((Number(get('steer')) - 90) / 75, -1, 1)) / 0.9;
      if (!sc && scanWas) set('steer', round(st.scanDeg, 1));
      scanWas = sc;
    }));
    cleanups.push(ctx.onResize(() => doResize()));
    const scanWriter = setInterval(() => { if (get('scan') && !st.disposed) set('steer', round(st.scanDeg, 1)); }, 500);
    if (scanWriter && scanWriter.unref) scanWriter.unref();
    cleanups.push(() => clearInterval(scanWriter));

    // ---------- UI ----------
    const on = (...tabs) => (s) => tabs.includes(s.get('tab'));
    const schema = [
      { type: 'tabs', key: 'tab', options: TABS },
      {
        type: 'group', label: 'Linear array', visibleIf: on('linear', 'element'), children: [
          { type: 'slider', key: 'N', label: 'elements N', min: 2, max: 32, step: 1 },
          { type: 'slider', key: 'd', label: 'spacing d (λ)', min: 0.1, max: 2, step: 0.01 },
          { type: 'slider', key: 'steer', label: 'scan angle θ₀ from the axis (deg)', min: 0, max: 180, step: 0.5 },
          { type: 'toggle', key: 'scan', label: 'sweep the beam (S)' },
          { type: 'slider', key: 'scanSpeed', label: 'sweep speed', min: 0.1, max: 4, step: 0.1, visibleIf: (s) => !!s.get('scan') },
          { type: 'select', key: 'elem', label: 'element', options: LINEAR_ELEMENTS },
          { type: 'select', key: 'taper', label: 'amplitude taper', options: TAPER_OPTIONS, visibleIf: on('linear', 'element') },
          { type: 'slider', key: 'sll', label: 'sidelobe level (Chebyshev / Taylor, dB)', min: 15, max: 60, step: 1, visibleIf: (s) => ['chebyshev', 'taylor'].includes(s.get('taper')) || s.get('tab') === 'planar' },
          { type: 'slider', key: 'brush', label: 'bar brush radius (elements)', min: 0, max: 5, step: 0.5, visibleIf: on('linear') },
          { type: 'button', label: 'copy taper into editable bars', onClick: toTaper, },
        ],
      },
      {
        type: 'group', label: 'Planar array', visibleIf: on('planar'), children: [
          { type: 'slider', key: 'Nx', label: 'elements along x', min: 2, max: 16, step: 1 },
          { type: 'slider', key: 'Ny', label: 'elements along y', min: 2, max: 16, step: 1 },
          { type: 'slider', key: 'dx', label: 'spacing dx (λ)', min: 0.2, max: 1.5, step: 0.01 },
          { type: 'slider', key: 'dy', label: 'spacing dy (λ)', min: 0.2, max: 1.5, step: 0.01 },
          { type: 'slider', key: 'pth', label: 'steer θ₀ from +z (deg)', min: 0, max: 85, step: 0.5 },
          { type: 'slider', key: 'pph', label: 'steer azimuth φ₀ (deg)', min: 0, max: 360, step: 1 },
          { type: 'select', key: 'pelem', label: 'element', options: [{ value: 'iso', label: 'isotropic' }, { value: 'patch', label: 'patch cosθ' }, { value: 'dipole', label: 'short dipole along x' }] },
          { type: 'select', key: 'taper', label: 'taper (both axes)', options: TAPER_OPTIONS.filter((o) => o.value !== 'custom') },
          { type: 'slider', key: 'pfloor', label: '3D dB range', min: 10, max: 60, step: 1 },
          { type: 'select', key: 'prender', label: 'render', options: [{ value: 'flat', label: 'flat' }, { value: 'both', label: 'flat + wire' }, { value: 'wire', label: 'wireframe' }] },
          { type: 'toggle', key: 'paxes', label: 'axes gizmo' },
        ],
      },
      {
        type: 'group', label: 'Display', children: [
          { type: 'toggle', key: 'polarDb', label: 'polar plots in dB (else linear field)' },
          { type: 'slider', key: 'floor', label: 'dB range of 2D plots', min: 20, max: 80, step: 5 },
        ],
      },
      {
        type: 'group', label: 'Presets', visibleIf: on('linear', 'element'), children: [
          { type: 'button', label: 'broadside, uniform', onClick: () => setMany({ tab: 'linear', N: 10, d: 0.5, steer: 90, taper: 'uniform', elem: 'iso', scan: false }) },
          { type: 'button', label: 'end-fire (d = λ/4, β = −kd)', onClick: () => setMany({ tab: 'linear', N: 10, d: 0.25, steer: 0, taper: 'uniform', elem: 'iso', scan: false }) },
          { type: 'button', label: 'steered 30° off broadside', onClick: () => setMany({ tab: 'linear', N: 12, d: 0.5, steer: 60, taper: 'uniform', scan: false }) },
          { type: 'button', label: 'Dolph-Chebyshev −30 dB', onClick: () => setMany({ tab: 'linear', N: 12, d: 0.5, steer: 90, taper: 'chebyshev', sll: 30, scan: false }) },
          { type: 'button', label: 'binomial: no sidelobes', onClick: () => setMany({ tab: 'linear', N: 8, d: 0.5, steer: 90, taper: 'binomial', scan: false }) },
          { type: 'button', label: 'Taylor −35 dB', onClick: () => setMany({ tab: 'linear', N: 16, d: 0.5, steer: 90, taper: 'taylor', sll: 35, scan: false }) },
          { type: 'button', label: 'grating lobes (d = 1 λ)', onClick: () => setMany({ tab: 'linear', N: 8, d: 1, steer: 90, taper: 'uniform', scan: false }) },
          { type: 'button', label: 'thinned array (elements switched off)', onClick: () => setMany({ tab: 'linear', N: 16, d: 0.5, steer: 90, w: '1,1,0,1,0,0,1,1,1,1,0,0,1,0,1,1', taper: 'custom', scan: false }) },
        ],
      },
      {
        type: 'group', label: 'Presets', visibleIf: on('planar'), children: [
          { type: 'button', label: 'broadside 8 × 8', onClick: () => setMany({ Nx: 8, Ny: 8, dx: 0.5, dy: 0.5, pth: 0, pph: 0, taper: 'uniform', pelem: 'iso' }) },
          { type: 'button', label: 'steered θ₀ = 35°, φ₀ = 45°', onClick: () => setMany({ Nx: 8, Ny: 8, dx: 0.5, dy: 0.5, pth: 35, pph: 45, taper: 'uniform' }) },
          { type: 'button', label: 'Chebyshev −30 dB pencil beam', onClick: () => setMany({ Nx: 10, Ny: 10, pth: 0, taper: 'chebyshev', sll: 30 }) },
          { type: 'button', label: 'fan beam (12 × 3)', onClick: () => setMany({ Nx: 12, Ny: 3, pth: 0, taper: 'uniform' }) },
          { type: 'button', label: 'grating lobes (dx = dy = 1 λ)', onClick: () => setMany({ Nx: 6, Ny: 6, dx: 1, dy: 1, pth: 0, taper: 'uniform' }) },
        ],
      },
      {
        type: 'group', label: 'Theory', collapsed: true, children: [
          { type: 'info', text: 'Array factor: AF(ψ) = Σ wₙ e^{j n ψ}, ψ = k d cosθ + β, k = 2π/λ. This is the discrete-time Fourier transform of the weights, so tapering is windowing: a uniform (rectangular) window gives the narrowest beam but −13.3 dB sidelobes; Hamming/Hann/Taylor/Chebyshev trade width for lower sidelobes.' },
          { type: 'info', text: 'Steering: β = −k d cosθ₀ slides the visible window [β − kd, β + kd] along the ψ axis. If d > λ/2 (more precisely d > λ/(1 + |cosθ₀|)) a second copy of the main lobe, a grating lobe, enters the window. Nulls of a uniform array: ψ = 2πm/N. HPBW ≈ 0.886 λ/(N d sinθ₀); D ≈ 2Nd/λ at broadside.' },
          { type: 'info', text: 'Total pattern = element pattern × AF. Planar arrays with separable weights have AF = AFx AFy with ψx = k dx sinθ cosφ + βx, ψy = k dy sinθ sinφ + βy; directivity D = 4π/∫|F|² dΩ is integrated numerically.' },
        ],
      },
      {
        type: 'group', label: 'Try this', collapsed: true, children: [
          { type: 'info', text: '1. Uniform weights, then drag the bars into a bell shape: sidelobes fall, the beam widens, and the DFT plot changes exactly like a windowed spectrum.' },
          { type: 'info', text: '2. Raise d past 0.5 λ while steering: watch the green window in the DFT plot admit a second main lobe (grating lobe).' },
          { type: 'info', text: '3. Chebyshev at −40 dB: all sidelobes are equal height. Binomial has none, but a wide beam. Compare the directivity read-out.' },
          { type: 'info', text: '4. Thin the array (zero some bars): the beam stays narrow but sidelobes rise. Planar tab: steer to 60° and see the beam broaden by 1/cosθ.' },
        ],
      },
      {
        type: 'group', label: 'Open in...', children: openInNodes([
          ['2D FDTD waves: radiation and interference', 'em-fdtd', {}],
          ['Fourier 2D: spatial frequency <-> pattern', 'fourier2d', {}],
          ['Impulse response lab: windows / DFT', 'impulse', {}],
          ['transmission lines: matching the feed', 'em-tline', {}],
        ]),
      },
      { type: 'button', label: 'Reset unit', onClick: resetAll },
    ];
    const panelUi = ctx.ui.build(schema, store, ctx.drawer);

    return {
      /** Introspection for tests. */
      debug() {
        return {
          tab: get('tab'), lastError: st.lastError, drawCount: st.drawCount, linear: st.linear, planar: st.planar,
          element: st.element, schema, cam: st.cam, wEdit: st.wEdit, scanDeg: st.scanDeg,
        };
      },
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
        for (const c of cleanups.splice(0)) { try { c(); } catch { /* ignore */ } }
        try { panelUi.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
        st.planar = null;
      },
    };
  },
};

