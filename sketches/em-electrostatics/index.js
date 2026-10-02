// Electrostatics: Fields, Potential & Gauss's Law  (course: Electromagnetics, unit 1)
//
// Tabs: Charges (draggable point / line charges, field lines, equipotentials, colour maps, test charge),
//       Gauss (closed Gaussian surface, numerical flux vs Q_enclosed / eps0), Continuous (rod, ring, disk, ball, gaussian blob).
//
// Public settings (deep-link keys):
//   tab         'charges' | 'gauss' | 'continuous'
//   preset      'dipole' | 'quadrupole' | 'like' | 'ring' | 'lines' | 'plates' | '' (custom)
//   charges     "x,y,q;x,y,q;..." the charge list (overrides the preset when non-empty)
//   law         '3d' (2D slice of Coulomb's law) | '2d' (line charges, E ~ 1/r)
//   gauss.kind  'circle' | 'rect' | 'poly'
//   cont.kind   'rod' | 'ring' | 'disk' | 'ball' | 'gauss',  cont.Q, cont.size,  cont.profile 'axis' | 'radial'
//   plus display toggles: lines, equi, equiLog, equiCount, map ('none'|'E'|'V'), arrows, grid, perUnit, soft, pm, pq
// Charges are persisted into `charges` every ~0.3 s while editing (not every frame).

import { getPalette } from '../approx/palette.js';
import { Viewport } from '../approx/view.js';
import {
  CHARGE_PRESETS, fieldAt, potentialAt, systemEnergy, dipoleMoment, farFieldPotential, totalCharge, formatCharges, parseCharges,
} from '../../lib/em/electrostatics.js';
import {
  TABS, DEFAULTS, TOOLS, MAP_OPTIONS, LAW_OPTIONS, GAUSS_KINDS, CONT_KINDS, THEORY, TRY_THIS,
} from './state.js';
import { drawAxes, hudBox, drawCharge, fmt, clamp } from './draw.js';
import {
  drawField, drawLayers, launch, stepTestParticle, drawParticle, particleReadout,
} from './scene.js';
import {
  ensureGauss, gaussPress, gaussDrag, gaussRelease, armDraw, drawGauss, sweepCharge, resetSweep,
} from './gauss-tab.js';
import { drawContinuous } from './continuous-tab.js';
import { openUnit } from './link.js';


/** Settings store with defaults filled in (and values from the URL coerced to the default's type). */
function withDefaults(store) {
  const coerce = (k, v) => {
    const d = DEFAULTS[k];
    if (d === undefined || v === undefined) return v;
    if (typeof d === 'number') { const n = Number(v); return Number.isFinite(n) ? n : d; }
    if (typeof d === 'boolean') return v === true || v === 'true' || v === '1' || v === 1;
    return typeof v === 'string' ? v : String(v);
  };
  return {
    get: (k, d) => coerce(k, store.get(k, d !== undefined ? d : DEFAULTS[k])),
    set: (k, v) => store.set(k, v),
    subscribe: (fn) => store.subscribe(fn),
    all: () => store.all && store.all(),
    reset: () => store.reset && store.reset(),
  };
}

function buildSchema(A, S) {
  const tabIs = (t) => (s) => s.get('tab') === t;
  return [
    {
      type: 'group', label: 'Charges', visibleIf: tabIs('charges'), children: [
        { type: 'select', key: 'preset', label: 'preset', options: [{ value: '', label: 'custom' }, ...CHARGE_PRESETS.map((c) => ({ value: c.id, label: c.label }))] },
        { type: 'select', key: 'law', label: 'force law', options: LAW_OPTIONS },
        { type: 'select', key: 'tool', label: 'click tool', options: TOOLS },
        { type: 'slider', key: 'newQ', label: 'new charge q', min: -5, max: 5, step: 0.25 },
        { type: 'slider', key: 'sel.q', label: 'selected charge q (wheel over a charge also works)', min: -9, max: 9, step: 0.1 },
        { type: 'button', label: 'Add + charge', onClick: () => A.addCharge(Math.abs(S.get('newQ')) || 1) },
        { type: 'button', label: 'Add - charge', onClick: () => A.addCharge(-(Math.abs(S.get('newQ')) || 1)) },
        { type: 'button', label: 'Flip selected (F)', onClick: A.flip },
        { type: 'button', label: 'Remove selected (Del)', onClick: A.removeSel },
        { type: 'button', label: 'Clear all charges', onClick: A.clear },
      ],
    },
    {
      type: 'group', label: 'Display', visibleIf: tabIs('charges'), children: [
        { type: 'toggle', key: 'lines', label: 'field lines (RK4)' },
        { type: 'slider', key: 'perUnit', label: 'lines per unit charge', min: 2, max: 20, step: 1 },
        { type: 'toggle', key: 'equi', label: 'equipotentials (marching squares)' },
        { type: 'toggle', key: 'equiLog', label: 'log-spaced levels' },
        { type: 'slider', key: 'equiCount', label: 'number of levels', min: 4, max: 40, step: 1 },
        { type: 'select', key: 'map', label: 'colour map', options: MAP_OPTIONS },
        { type: 'toggle', key: 'arrows', label: 'arrow grid' },
        { type: 'toggle', key: 'grid', label: 'axes grid' },
        { type: 'toggle', key: 'farField', label: 'far-field comparison at cursor (monopole + dipole)' },
        { type: 'slider', key: 'soft', label: 'softening length (Plummer)', min: 0, max: 0.5, step: 0.01 },
        { type: 'button', label: 'Fit view', onClick: A.fit },
      ],
    },
    {
      type: 'group', label: 'Test charge (tool: Launch test charge)', visibleIf: tabIs('charges'), children: [
        { type: 'slider', key: 'pq', label: 'test charge q_t', min: -3, max: 3, step: 0.1 },
        { type: 'slider', key: 'pm', label: 'mass m', min: 0.1, max: 10, step: 0.1 },
        { type: 'slider', key: 'pspeed', label: 'time scale (sim s per real s)', min: 0.5, max: 40, step: 0.5 },
        { type: 'button', label: 'Remove test charge', onClick: A.clearParticle },
      ],
    },
    {
      type: 'group', label: 'Gaussian surface', visibleIf: tabIs('gauss'), children: [
        { type: 'select', key: 'gauss.kind', label: 'surface', options: GAUSS_KINDS },
        { type: 'button', label: 'Draw a free polygon (then drag on the canvas)', onClick: A.armDraw },
        { type: 'toggle', key: 'gauss.sweep', label: 'sweep the first charge through the surface' },
        { type: 'slider', key: 'gauss.speed', label: 'sweep speed', min: 0.1, max: 3, step: 0.1 },
        { type: 'toggle', key: 'gauss.fieldLines', label: 'field lines' },
        { type: 'toggle', key: 'gauss.arrows', label: 'local flux density arrows E.n' },
        { type: 'select', key: 'preset', label: 'charge preset', options: [{ value: '', label: 'custom' }, ...CHARGE_PRESETS.map((c) => ({ value: c.id, label: c.label }))] },
        { type: 'select', key: 'tool', label: 'click tool', options: TOOLS.slice(0, 3) },
        { type: 'slider', key: 'newQ', label: 'new charge q', min: -5, max: 5, step: 0.25 },
        { type: 'slider', key: 'sel.q', label: 'selected charge q', min: -9, max: 9, step: 0.1 },
        { type: 'button', label: 'Add + charge', onClick: () => A.addCharge(Math.abs(S.get('newQ')) || 1) },
        { type: 'button', label: 'Add - charge', onClick: () => A.addCharge(-(Math.abs(S.get('newQ')) || 1)) },
      ],
    },
    {
      type: 'group', label: 'Distribution', visibleIf: tabIs('continuous'), children: [
        { type: 'select', key: 'cont.kind', label: 'shape', options: CONT_KINDS },
        { type: 'slider', key: 'cont.Q', label: 'total charge Q', min: -5, max: 5, step: 0.25 },
        { type: 'slider', key: 'cont.size', label: 'size (L, a, R or sigma)', min: 0.2, max: 3, step: 0.05 },
        { type: 'select', key: 'cont.profile', label: 'profile plot', options: [{ value: 'axis', label: 'E_z along the axis' }, { value: 'radial', label: 'E_rho in the mid plane' }] },
        { type: 'slider', key: 'cont.res', label: 'integration nodes', min: 10, max: 120, step: 5 },
        { type: 'button', label: 'Fit view', onClick: A.fit },
      ],
    },
    {
      type: 'group', label: 'Open in...', collapsed: true, children: [
        { type: 'button', label: 'Laplace & Poisson solver: capacitor plates', onClick: () => openUnit('em-poisson', { preset: 'plates' }) },
        { type: 'button', label: 'Laplace & Poisson solver: painted charges', onClick: () => openUnit('em-poisson', { preset: 'charges' }) },
        { type: 'button', label: 'Vector calculus: divergence & curl', onClick: () => openUnit('ma-vector') },
        { type: 'button', label: 'Magnetostatics', onClick: () => openUnit('em-magnetostatics') },
      ],
    },
    { type: 'group', label: 'Theory', collapsed: true, children: [{ type: 'info', text: THEORY }] },
    { type: 'group', label: 'Try this', collapsed: true, children: [{ type: 'info', text: TRY_THIS.map((t, i) => `${i + 1}. ${t}`).join('\n') }] },
    { type: 'button', label: 'Reset unit', onClick: A.reset },
  ];
}

export default {
  id: 'em-electrostatics',
  title: "Electrostatics: Fields, Potential & Gauss's Law",
  description: "Point and line charges, field lines and equipotentials, test charges, Gauss's law with a draggable surface, and continuous charge distributions.",

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings);
    const get = (k) => store.get(k);
    const cleanups = [];
    const S = {
      disposed: false,
      p: null,
      pal: getPalette(ctx.globalSettings.get('theme', 'dark')),
      view: new Viewport(-7, 7, -4.5, 4.5),
      get,
      set: (k, v) => store.set(k, v),
      charges: [],
      chVer: 1,
      sel: -1,
      hover: -1,
      dragging: false,
      cache: {},
      particle: null,
      ctx2d: null,
      gauss: null,
      sweep: null,
      lawNow: () => (S.get('tab') === 'gauss' ? '2d' : S.get('tab') === 'continuous' ? '3d' : S.get('law')),
    };
    const st = {
      lastPreset: null,
      lastCharges: '',
      persistDirty: false,
      press: null,
      pan: null,
      launch: null,
      mouse: { wx: 0, wy: 0, inside: false },
      lastTab: null,
      lastSelQ: null,
    };

    // ---------- charges ----------
    const touch = (persist = true) => { S.chVer++; if (persist) st.persistDirty = true; };
    function flush() {
      if (!st.persistDirty) return;
      st.persistDirty = false;
      st.lastCharges = formatCharges(S.charges);
      store.set('charges', st.lastCharges);
    }
    function setCharges(list, { keepPreset = false } = {}) {
      S.charges = list.map((c) => ({ x: c.x, y: c.y, q: c.q }));
      S.sel = -1;
      S.hover = -1;
      S.sweep = null;
      touch();
      if (!keepPreset && store.get('preset')) { store.set('preset', ''); st.lastPreset = ''; }
    }
    function applyPreset(id, { fit = true } = {}) {
      const pr = CHARGE_PRESETS.find((c) => c.id === id);
      if (!pr) return;
      setCharges(pr.make(), { keepPreset: true });
      st.lastPreset = id;
      if (store.get('law') !== pr.law) store.set('law', pr.law);
      S.particle = null;
      if (fit) fitView();
    }
    function fitView() {
      const { p } = S;
      if (S.get('tab') === 'continuous') {
        const R = Math.max(2.5, 2.4 * S.get('cont.size') + 1);
        const asp = S.view.rect.w / S.view.rect.h;
        S.view.set(-R * asp, R * asp, -R, R);
        S.cache.gridKey = '';
        return;
      }
      let ext = 3;
      let cx = 0, cy = 0;
      if (S.charges.length) {
        for (const c of S.charges) { cx += c.x; cy += c.y; }
        cx /= S.charges.length; cy /= S.charges.length;
        for (const c of S.charges) ext = Math.max(ext, Math.abs(c.x - cx), Math.abs(c.y - cy) * (S.view.rect.w / S.view.rect.h));
      }
      const hw = ext * 1.9, hh = hw * (p ? S.view.rect.h / S.view.rect.w : 0.65);
      S.view.set(cx - hw, cx + hw, cy - hh, cy + hh);
    }
    const A = {
      addCharge(q) {
        const v = S.view;
        let n = S.charges.length;
        const ang = 2.399963 * n; // golden angle spiral so repeated adds do not overlap
        const r = 0.12 * (v.xmax - v.xmin) * Math.sqrt(n + 1) * 0.5;
        S.charges.push({ x: (v.xmin + v.xmax) / 2 + r * Math.cos(ang), y: (v.ymin + v.ymax) / 2 + r * Math.sin(ang), q });
        S.sel = S.charges.length - 1;
        touch();
        detachPreset();
        return n;
      },
      flip() {
        const i = S.hover >= 0 ? S.hover : S.sel;
        if (i < 0 || !S.charges[i]) return;
        S.charges[i].q = -S.charges[i].q;
        touch(); detachPreset();
      },
      removeSel() {
        const i = S.hover >= 0 ? S.hover : S.sel;
        if (i < 0 || !S.charges[i]) return;
        removeAt(i);
      },
      clear() { setCharges([]); S.particle = null; },
      fit: fitView,
      armDraw() { armDraw(S); },
      clearParticle() { S.particle = null; },
      reset() {
        store.reset();
        S.particle = null;
        resetSweep(S);
        S.gauss = null;
        applyPreset('dipole');
        S.cache = {};
      },
    };
    function detachPreset() {
      if (store.get('preset')) { store.set('preset', ''); st.lastPreset = ''; }
    }
    function removeAt(i) {
      S.charges.splice(i, 1);
      S.sel = -1; S.hover = -1; S.sweep = null;
      touch(); detachPreset();
    }

    // initial charges: explicit list > preset
    const initial = parseCharges(store.get('charges'));
    if (initial.length) { S.charges = initial; st.lastPreset = store.get('preset'); st.lastCharges = formatCharges(initial); }
    else applyPreset(store.get('preset') || 'dipole', { fit: false });

    function syncSettings() {
      const preset = store.get('preset');
      if (preset !== st.lastPreset) {
        st.lastPreset = preset;
        if (preset) applyPreset(preset);
      }
      const txt = store.get('charges');
      if (txt !== st.lastCharges && !st.persistDirty) { // changed from outside (deep link / reset)
        st.lastCharges = txt;
        const list = parseCharges(txt);
        if (list.length || txt === '') { S.charges = list; S.sel = -1; S.chVer++; }
      }
      // selected charge slider
      const sq = Number(store.get('sel.q', 0));
      if (S.sel >= 0 && S.charges[S.sel]) {
        if (st.lastSelQ !== null && sq !== st.lastSelQ && Math.abs(sq - S.charges[S.sel].q) > 1e-9) {
          S.charges[S.sel].q = sq;
          touch(); detachPreset();
        }
        st.lastSelQ = S.charges[S.sel].q;
        if (Math.abs(sq - S.charges[S.sel].q) > 1e-9) store.set('sel.q', +S.charges[S.sel].q.toFixed(3));
      } else st.lastSelQ = null;
      const tab = S.get('tab');
      if (tab !== st.lastTab) {
        st.lastTab = tab;
        layout();
        if (tab === 'gauss') { ensureGauss(S); }
        if (tab === 'continuous') fitView();
        if (tab !== 'gauss' && S.sweep) { resetSweep(S); store.set('gauss.sweep', false); }
        S.cache = {};
      }
      if (!S.get('gauss.sweep') && S.sweep) resetSweep(S);
    }

    // ---------- layout ----------
    function layout() {
      const p = S.p;
      if (!p) return;
      const h = S.get('tab') === 'continuous' ? Math.round(p.height * 0.6) : p.height;
      S.view.setRect(0, 0, p.width, h);
      S.view.lockAspect();
      S.cache = {};
    }

    const sketch = (p) => {
      S.p = p;
      const sizeNow = () => {
        const s = ctx.size();
        return { w: Math.max(260, s.width), h: Math.max(260, s.height) };
      };
      const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
      const isBtn = (name) => {
        const b = p.mouseButton;
        return b === p[name.toUpperCase()] || !!(b && typeof b === 'object' && b[name]);
      };

      p.setup = () => {
        if (S.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        S.ctx2d = p.drawingContext;
        const cv = p.canvas;
        const el = cv && (typeof cv.addEventListener === 'function' ? cv : cv.elt);
        if (el && typeof el.addEventListener === 'function') {
          const noMenu = (e) => { if (e && e.preventDefault) e.preventDefault(); };
          el.addEventListener('contextmenu', noMenu);
          cleanups.push(() => el.removeEventListener('contextmenu', noMenu));
        }
        p.textFont('sans-serif');
        layout();
        fitView();
        syncSettings();
      };

      const hitCharge = (px, py) => {
        let best = -1, bd = 1e9;
        S.charges.forEach((c, i) => {
          const r = clamp(7 + 4 * Math.sqrt(Math.abs(c.q)), 8, 26) + 4;
          const d = Math.hypot(S.view.toX(c.x) - px, S.view.toY(c.y) - py);
          if (d < r && d < bd) { best = i; bd = d; }
        });
        return best;
      };

      function updateHover() {
        const v = S.view;
        st.mouse.inside = v.contains(p.mouseX, p.mouseY);
        st.mouse.wx = v.fromX(p.mouseX);
        st.mouse.wy = v.fromY(p.mouseY);
        S.hover = S.get('tab') === 'continuous' ? -1 : hitCharge(p.mouseX, p.mouseY);
      }

      function pressStart(e) {
        if (!onCanvas(e)) return false;
        updateHover();
        st.press = null; st.pan = null; st.launch = null;
        const v = S.view;
        if (!v.contains(p.mouseX, p.mouseY)) return false;
        const tab = S.get('tab');
        const tool = S.get('tool');
        const shift = (e && e.shiftKey) || (p.keyIsDown && p.keyIsDown(16));
        if (isBtn('center') || isBtn('right')) { st.pan = { x: p.mouseX, y: p.mouseY }; return true; }
        if (tab === 'continuous') { st.pan = { x: p.mouseX, y: p.mouseY }; return true; }
        const hit = hitCharge(p.mouseX, p.mouseY);
        if (tab === 'gauss' && hit < 0 && gaussPress(S, p.mouseX, p.mouseY)) { S.dragging = true; return true; }
        if (hit >= 0 && tool !== 'remove' && tool !== 'add') {
          S.sel = hit;
          st.press = { t: 'charge', i: hit, dx: S.charges[hit].x - st.mouse.wx, dy: S.charges[hit].y - st.mouse.wy };
          S.dragging = true;
          return true;
        }
        if (tool === 'remove') { if (hit >= 0) removeAt(hit); return true; }
        if (tool === 'add') {
          if (hit >= 0) { S.sel = hit; st.press = { t: 'charge', i: hit, dx: S.charges[hit].x - st.mouse.wx, dy: S.charges[hit].y - st.mouse.wy }; S.dragging = true; return true; }
          const q = (shift ? -1 : 1) * (Number(S.get('newQ')) || 1);
          S.charges.push({ x: st.mouse.wx, y: st.mouse.wy, q });
          S.sel = S.charges.length - 1;
          touch(); detachPreset();
          return true;
        }
        if (tool === 'test' && tab === 'charges') {
          st.launch = { x0: st.mouse.wx, y0: st.mouse.wy, px: p.mouseX, py: p.mouseY };
          return true;
        }
        st.pan = { x: p.mouseX, y: p.mouseY };
        return true;
      }

      function pressDrag() {
        updateHover();
        if (st.press && st.press.t === 'charge') {
          const c = S.charges[st.press.i];
          if (c) { c.x = st.mouse.wx + st.press.dx; c.y = st.mouse.wy + st.press.dy; touch(); detachPreset(); }
          if (S.sweep) S.sweep.base = null;
          return;
        }
        if (S.gauss && S.gauss.drag) { gaussDrag(S, p.mouseX, p.mouseY); return; }
        if (st.pan) {
          S.view.panPx(p.mouseX - st.pan.x, p.mouseY - st.pan.y);
          st.pan.x = p.mouseX; st.pan.y = p.mouseY;
          S.cache = { ...S.cache, mapKey: '', linesKey: '', equiKey: '', gridKey: '' };
        }
      }

      function pressEnd() {
        const had = !!(st.press || st.pan || st.launch || (S.gauss && S.gauss.drag));
        if (st.launch) {
          const v = S.view;
          const dx = (p.mouseX - st.launch.px) / (v.rect.w / (v.xmax - v.xmin));
          const dy = -(p.mouseY - st.launch.py) / (v.rect.w / (v.xmax - v.xmin));
          launch(S, st.launch.x0, st.launch.y0, dx * 0.8, dy * 0.8);
        }
        gaussRelease(S);
        st.press = null; st.pan = null; st.launch = null;
        S.dragging = false;
        S.chVer++; // refresh cached layers at full quality
        return had;
      }

      p.mousePressed = (e) => { pressStart(e); };
      p.mouseDragged = () => { pressDrag(); };
      p.mouseReleased = () => { pressEnd(); };
      p.mouseMoved = (e) => { if (onCanvas(e)) updateHover(); };
      p.touchStarted = (e) => (pressStart(e) ? false : true);
      p.touchMoved = () => { pressDrag(); return !(st.press || st.pan || st.launch || (S.gauss && S.gauss.drag)); };
      p.touchEnded = () => !pressEnd();

      p.mouseWheel = (e) => {
        if (!onCanvas(e) || !S.view.contains(p.mouseX, p.mouseY)) return true;
        let d = Number(e && (e.deltaY !== undefined ? e.deltaY : e.delta)) || 0;
        if (e && e.deltaMode === 1) d *= 33;
        else if (e && e.deltaMode === 2) d *= 400;
        d = clamp(d, -300, 300);
        if (d === 0) return true;
        updateHover();
        if (S.hover >= 0 && S.get('tab') !== 'continuous') {
          const c = S.charges[S.hover];
          c.q = clamp(+(c.q - Math.sign(d) * 0.1).toFixed(2), -9.9, 9.9);
          S.sel = S.hover;
          touch(); detachPreset();
        } else {
          const f = Math.exp(d * 0.0015);
          const v = S.view;
          const old = [v.xmin, v.xmax, v.ymin, v.ymax];
          v.zoomAt(p.mouseX, p.mouseY, f);
          const span = v.xmax - v.xmin;
          if (span < 0.2 || span > 400) v.set(...old);
          S.cache = { ...S.cache, mapKey: '', linesKey: '', equiKey: '', gridKey: '' };
        }
        if (e && e.preventDefault) e.preventDefault();
        return false;
      };

      function typing(k) {
        const el = globalThis.document && globalThis.document.activeElement;
        if (!el) return false;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
        return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
      }
      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const k = p.key;
        if (typing(k)) return true;
        if (k === 'f' || k === 'F') A.flip();
        else if (k === 'Delete' || k === 'Backspace') A.removeSel();
        else if (k === '1') store.set('tab', 'charges');
        else if (k === '2') store.set('tab', 'gauss');
        else if (k === '3') store.set('tab', 'continuous');
        else return true;
        return false;
      };

      S.resize = () => {
        if (S.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        layout();
      };

      // ---------- drawing ----------
      function chargesHud() {
        const pal = S.pal;
        const law = S.lawNow();
        const soft = S.get('soft');
        const lines = [];
        const tab = S.get('tab');
        const d = dipoleMoment(S.charges);
        const W = systemEnergy(S.charges, law, soft);
        lines.push([law === '3d' ? 'E = q r/(4πε₀ r³)   V = q/(4πε₀ r)   (3D slice)' : 'E = λ r/(2πε₀ r²)   V = -λ ln r/(2πε₀)   (2D, line charges)', pal.muted]);
        if (st.mouse.inside) {
          const e = fieldAt(S.charges, st.mouse.wx, st.mouse.wy, law, soft);
          lines.push(`cursor (${fmt(st.mouse.wx, 3)}, ${fmt(st.mouse.wy, 3)})`);
          lines.push(`V = ${fmt(potentialAt(S.charges, st.mouse.wx, st.mouse.wy, law, soft))}    |E| = ${fmt(Math.hypot(e[0], e[1]))}`);
          lines.push(`E = (${fmt(e[0])}, ${fmt(e[1])})`);
        }
        lines.push(`total charge Q = ${fmt(totalCharge(S.charges))}   energy W = ${fmt(W)}`);
        lines.push(`dipole moment p = ${fmt(d.p)}  (${fmt(d.px)}, ${fmt(d.py)})`);
        if (S.get('farField') && st.mouse.inside && S.charges.length) {
          const ff = farFieldPotential(S.charges, st.mouse.wx, st.mouse.wy, law);
          const ex = potentialAt(S.charges, st.mouse.wx, st.mouse.wy, law, soft);
          lines.push([`far field V≈${fmt(ff.total)} (mono ${fmt(ff.mono)} + dip ${fmt(ff.dip)})`, '#2ecc71']);
          lines.push([`exact ${fmt(ex)}  rel. error ${fmt(Math.abs(ex) > 0 ? (ff.total - ex) / Math.abs(ex) : 0, 2)}`, '#2ecc71']);
        }
        hudBox(p, pal, 12, 12, lines, { w: 340 });
        const pr = particleReadout(S);
        if (pr && tab === 'charges') {
          hudBox(p, pal, 12, p.height - 106, [
            ['test charge', pal.muted],
            `pos (${fmt(pr.x, 3)}, ${fmt(pr.y, 3)})   |v| = ${fmt(pr.speed)}`,
            `KE = ${fmt(pr.ke)}   PE = qV = ${fmt(pr.pe)}`,
            [`E = KE + PE = ${fmt(pr.total)}   drift ${fmt(100 * pr.drift, 2)} %`, Math.abs(pr.drift) < 1e-3 ? '#2ecc71' : '#ffb020'],
            pr.alive ? '' : ['(left the view)', pal.muted],
          ].filter(Boolean), { w: 340 });
        }
      }

      function drawCharges() {
        S.charges.forEach((c, i) => {
          drawCharge(p, S.pal, S.view.toX(c.x), S.view.toY(c.y), c.q, { selected: i === S.sel, hover: i === S.hover });
        });
      }

      p.draw = () => {
        if (S.disposed) return;
        syncSettings();
        const dt = Math.min(50, p.deltaTime || 16.7) / 1000;
        if (p.frameCount % 18 === 0) flush();
        const tab = S.get('tab');
        p.background(S.pal.bg);
        if (tab === 'continuous') { drawContinuous(S); return; }
        if (tab === 'gauss') {
          if (S.get('gauss.sweep')) sweepCharge(S, dt);
          drawField(S, '2d');
          if (S.get('grid')) drawAxes(p, S.pal, S.view, { grid: true });
          drawLayers(S, '2d', { equi: false, arrows: false, lines: S.get('gauss.fieldLines') });
          drawGauss(S);
          return;
        }
        // charges tab
        if (S.particle) stepTestParticle(S, dt * S.get('pspeed'));
        drawField(S, S.get('law'));
        if (S.get('grid')) drawAxes(p, S.pal, S.view, { grid: true });
        drawLayers(S, S.get('law'));
        drawParticle(S);
        drawCharges();
        if (st.launch) {
          p.push();
          p.stroke('#ffd24a');
          p.strokeWeight(2);
          p.line(st.launch.px, st.launch.py, p.mouseX, p.mouseY);
          p.pop();
        }
        chargesHud();
        void sweepCharge;
      };

      cleanups.push(ctx.globalSettings.subscribe(() => {
        S.pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
        S.cache = {};
      }));
    };

    const instance = new ctx.p5(sketch, container);
    cleanups.push(ctx.onResize(() => S.resize && S.resize()));
    const tabs = ctx.ui.build([{ type: 'tabs', key: 'tab', options: TABS }], store, ctx.toolbar);
    const panel = ctx.ui.build(buildSchema(A, S), store, ctx.drawer);

    return {
      /** Exposed for inspection (tests, debugging). */
      state: S,
      actions: A,
      unmount() {
        if (S.disposed) return;
        S.disposed = true;
        try { flush(); } catch { /* ignore */ }
        for (const c of cleanups.splice(0)) {
          try { c(); } catch { /* ignore */ }
        }
        try { tabs.destroy(); } catch { /* ignore */ }
        try { panel.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
      },
    };
  },
};
