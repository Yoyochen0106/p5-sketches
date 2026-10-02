// Vector Calculus: Divergence, Curl, Green & Stokes. Four tabs: 2D field explorer, Green / Stokes
// theorem lab, 3D field with divergence / Stokes theorem, and potentials + Helmholtz decomposition.
//
// Public settings (deep-link keys): see the comment block at the top of state.js
// (tab, src, f2, fx, fy, px, py, gshape, gcx, gcy, gr, gcells, gmode, src3, f3, gx, gy, gz, surf, lr, lh, pmode, bx, by ...).

import { getPalette } from '../approx/palette.js';
import { PRESETS_2D, PRESETS_3D } from '../../lib/vectorcalc.js';
import {
  DEFAULTS, TABS, clamp, fmt, openIn, validateExpr,
} from './state.js';
import { createField2Tab } from './field2.js';
import { createGreenTab } from './green.js';
import { createField3Tab } from './field3.js';
import { createPotentialTab } from './potential.js';

/** Settings store with defaults filled in, as expected by core/ui.js. */
function withDefaults(store) {
  return {
    get: (k, d) => store.get(k, d !== undefined ? d : DEFAULTS[k]),
    set: (k, v) => store.set(k, v),
    subscribe: (fn) => store.subscribe(fn),
    all: () => store.all && store.all(),
    reset: () => store.reset && store.reset(),
  };
}

const isTab = (...names) => (s) => names.includes(s.get('tab'));

function buildSchema(actions) {
  const opts2 = PRESETS_2D.map((q) => ({ value: q.id, label: q.label }));
  const opts3 = PRESETS_3D.map((q) => ({ value: q.id, label: q.label }));
  const expr2 = (key, label) => ({
    type: 'text', key, label, placeholder: 'e.g. x^2 - y^2', validate: (v) => validateExpr(v, ['x', 'y']),
    visibleIf: (s) => s.get('src') === 'expr',
  });
  const expr3 = (key, label) => ({
    type: 'text', key, label, placeholder: 'e.g. x*y + z', validate: (v) => validateExpr(v, ['x', 'y', 'z']),
    visibleIf: (s) => s.get('src3') === 'expr',
  });
  const shapeIs = (...v) => (s) => s.get('tab') === 'green' && s.get('gmode') === 'theorem' && v.includes(s.get('gshape'));
  return [
    {
      type: 'group', label: '2D field', visibleIf: isTab('field2', 'green', 'potential'), children: [
        { type: 'select', key: 'src', label: 'source', options: [{ value: 'preset', label: 'preset' }, { value: 'expr', label: 'typed Fx(x, y), Fy(x, y)' }] },
        { type: 'select', key: 'f2', label: 'preset', options: opts2, visibleIf: (s) => s.get('src') === 'preset' },
        expr2('fx', 'Fx(x, y) ='), expr2('fy', 'Fy(x, y) ='),
        {
          type: 'slider', key: 'stepExp', label: 'derivative step h (numerical div / curl)', min: -8, max: -2, step: 1, format: (v) => `1e${v}`,
        },
        { type: 'info', text: 'Presets use analytic Jacobians; typed fields use central differences with step h (too small: round-off noise, too large: smearing).' },
      ],
    },
    {
      type: 'group', label: 'Display', visibleIf: isTab('field2'), children: [
        { type: 'toggle', key: 'showArrows', label: 'arrow grid' },
        { type: 'toggle', key: 'normalize', label: 'length-normalised arrows (direction only)' },
        { type: 'slider', key: 'arrowDensity', label: 'arrows across', min: 8, max: 40, step: 1 },
        { type: 'toggle', key: 'showStream', label: 'streamlines (RK4)' },
        { type: 'toggle', key: 'showLic', label: 'LIC-style texture (noise smeared along the flow)' },
        {
          type: 'select', key: 'colorBy', label: 'colour map',
          options: [{ value: 'none', label: 'none' }, { value: 'div', label: 'divergence' }, { value: 'curl', label: 'curl' }, { value: 'mag', label: '|F|' }],
        },
        { type: 'toggle', key: 'probeAnim', label: 'paddle wheel (curl) + expanding disc (div) at the probe' },
      ],
    },
    {
      type: 'group', label: 'Closed curve', visibleIf: isTab('green'), children: [
        { type: 'select', key: 'gmode', label: 'experiment', options: [{ value: 'theorem', label: "Green's / divergence theorem" }, { value: 'path', label: 'path independence (conservative test)' }] },
        {
          type: 'select', key: 'gshape', label: 'curve', visibleIf: shapeIs('circle', 'ellipse', 'rect', 'poly'),
          options: [{ value: 'circle', label: 'circle' }, { value: 'ellipse', label: 'ellipse' }, { value: 'rect', label: 'rectangle' }, { value: 'poly', label: 'free polygon (draw it)' }],
        },
        { type: 'select', key: 'gorient', label: 'orientation', options: [{ value: 'ccw', label: 'counter-clockwise' }, { value: 'cw', label: 'clockwise' }], visibleIf: (s) => s.get('gmode') === 'theorem' },
        { type: 'slider', key: 'gr', label: 'size', min: 0.2, max: 4, step: 0.05, visibleIf: shapeIs('circle', 'ellipse', 'rect') },
        { type: 'slider', key: 'gb', label: 'aspect (minor / major)', min: 0.2, max: 3, step: 0.05, visibleIf: shapeIs('ellipse', 'rect') },
        { type: 'slider', key: 'grot', label: 'rotation (deg)', min: 0, max: 360, step: 1, visibleIf: shapeIs('ellipse', 'rect') },
        { type: 'info', text: 'With "free polygon" press on empty space and drag to draw a new closed curve; drag its vertices to edit.', visibleIf: shapeIs('poly') },
        { type: 'toggle', key: 'gshowCells', label: 'subdivide into cells', visibleIf: (s) => s.get('gmode') === 'theorem' },
        { type: 'slider', key: 'gcells', label: 'cells per side', min: 0, max: 16, step: 1, visibleIf: (s) => s.get('gmode') === 'theorem' },
        { type: 'toggle', key: 'gcancel', label: 'animate the cancellation of shared edges', visibleIf: (s) => s.get('gmode') === 'theorem' },
        { type: 'slider', key: 'gbulge', label: 'second path bulge', min: -1.5, max: 1.5, step: 0.05, visibleIf: (s) => s.get('gmode') === 'path' },
        {
          type: 'select', key: 'gcolor', label: 'background colour',
          options: [{ value: 'curl', label: 'curl F' }, { value: 'div', label: 'div F' }, { value: 'none', label: 'none' }],
        },
      ],
    },
    {
      type: 'group', label: '3D field', visibleIf: isTab('field3'), children: [
        { type: 'select', key: 'src3', label: 'source', options: [{ value: 'preset', label: 'preset' }, { value: 'expr', label: 'typed Fx, Fy, Fz of x, y, z' }] },
        { type: 'select', key: 'f3', label: 'preset', options: opts3, visibleIf: (s) => s.get('src3') === 'preset' },
        expr3('gx', 'Fx(x, y, z) ='), expr3('gy', 'Fy(x, y, z) ='), expr3('gz', 'Fz(x, y, z) ='),
        { type: 'slider', key: 'glyphN', label: 'arrows per axis', min: 3, max: 10, step: 1 },
        { type: 'toggle', key: 'normalize3', label: 'length-normalised arrows' },
        { type: 'toggle', key: 'showStream3', label: 'streamlines' },
        { type: 'slider', key: 'seeds3', label: 'streamline seeds', min: 2, max: 40, step: 1, visibleIf: (s) => !!s.get('showStream3') },
        {
          type: 'select', key: 'slice', label: 'slice plane colour map',
          options: [{ value: 'none', label: 'none' }, { value: 'div', label: 'div F' }, { value: 'curl', label: '|curl F|' }, { value: 'mag', label: '|F|' }],
        },
        { type: 'slider', key: 'sliceZ', label: 'slice height z', min: -3, max: 3, step: 0.1, visibleIf: (s) => s.get('slice') !== 'none' },
      ],
    },
    {
      type: 'group', label: 'Closed surface (divergence theorem)', visibleIf: isTab('field3'), children: [
        { type: 'toggle', key: 'showSurf', label: 'show surface' },
        { type: 'select', key: 'surf', label: 'surface', options: [{ value: 'sphere', label: 'sphere' }, { value: 'cube', label: 'cube' }, { value: 'cylinder', label: 'cylinder' }] },
        { type: 'slider', key: 'ssize', label: 'size', min: 0.3, max: 2.6, step: 0.05 },
      ],
    },
    {
      type: 'group', label: 'Closed loop (Stokes)', visibleIf: isTab('field3'), children: [
        { type: 'toggle', key: 'showLoop', label: 'show loop and spanning surface' },
        { type: 'slider', key: 'lr', label: 'loop radius', min: 0.3, max: 2.5, step: 0.05 },
        { type: 'slider', key: 'lh', label: 'cap height (0 = flat disc)', min: -2.5, max: 2.5, step: 0.05 },
        { type: 'slider', key: 'lnth', label: 'normal tilt (deg)', min: 0, max: 180, step: 1 },
        { type: 'slider', key: 'lnph', label: 'normal azimuth (deg)', min: 0, max: 360, step: 1 },
      ],
    },
    {
      type: 'group', label: 'Potential / Helmholtz', visibleIf: isTab('potential'), children: [
        { type: 'select', key: 'pmode', label: 'view', options: [{ value: 'potential', label: 'potential / stream function' }, { value: 'helmholtz', label: 'Helmholtz decomposition' }] },
        {
          type: 'select', key: 'pwhat', label: 'scalar field', visibleIf: (s) => s.get('pmode') === 'potential',
          options: [{ value: 'auto', label: 'automatic' }, { value: 'potential', label: 'potential phi (F = grad phi)' }, { value: 'stream', label: 'stream function psi' }],
        },
        { type: 'slider', key: 'levels', label: 'contour levels', min: 2, max: 40, step: 1, visibleIf: (s) => s.get('pmode') === 'potential' },
        {
          type: 'select', key: 'hsrc', label: 'field to decompose', visibleIf: (s) => s.get('pmode') === 'helmholtz',
          options: [{ value: 'field', label: 'the 2D field above (tapered)' }, { value: 'drawn', label: 'drawn: sources and vortices' }],
        },
        {
          type: 'select', key: 'blobKind', label: 'click adds', visibleIf: (s) => s.get('pmode') === 'helmholtz' && s.get('hsrc') === 'drawn',
          options: [{ value: 'source', label: 'source (div +)' }, { value: 'sink', label: 'sink (div -)' }, { value: 'vortex', label: 'vortex (curl +)' }, { value: 'vortexneg', label: 'vortex (curl -)' }],
        },
        { type: 'button', label: 'clear drawn blobs', onClick: () => actions.clearBlobs(), visibleIf: (s) => s.get('pmode') === 'helmholtz' && s.get('hsrc') === 'drawn' },
        {
          type: 'select', key: 'hn', label: 'grid', visibleIf: (s) => s.get('pmode') === 'helmholtz',
          options: [{ value: 32, label: '32 x 32' }, { value: 64, label: '64 x 64' }, { value: 128, label: '128 x 128' }],
        },
      ],
    },
    {
      type: 'group', label: 'Theory', children: [
        {
          type: 'info', visibleIf: isTab('field2'),
          text: 'div F = dFx/dx + dFy/dy is the net outflow per unit area (an expanding disc); curl F = dFy/dx - dFx/dy is twice the local angular velocity (a paddle wheel). Together they are the trace and the antisymmetric part of the Jacobian J; the eigenvalues of J classify the flow near the probe (saddle, node, spiral, centre). Look for: sources and sinks (div), vortices and shear (curl).',
        },
        {
          type: 'info', visibleIf: isTab('green'),
          text: "Green: closed integral of F.dr = double integral of curl F dA. Divergence theorem (2D): closed integral of F.n dl = double integral of div F dA. Cut the region into cells: each cell's circulation is curl x area, and every shared edge is traversed twice in opposite directions, so only the outer boundary survives. A field is conservative when the line integral between two points does not depend on the path, i.e. curl F = 0.",
        },
        {
          type: 'info', visibleIf: isTab('field3'),
          text: "Divergence theorem: flux of F through a closed surface = triple integral of div F dV. Stokes: circulation around a loop = flux of curl F through ANY surface spanning it (flat disc or cap: the number does not change). Where F is singular (point charge, line current) the identities pick up delta functions: Gauss and Ampere's laws.",
        },
        {
          type: 'info', visibleIf: isTab('potential'),
          text: 'Curl-free F = grad phi: phi(P) = integral of F.dr from a base point, and the equipotentials are orthogonal to the field lines. Divergence-free F = (psi_y, -psi_x): psi is constant along streamlines. Helmholtz: any (decaying or periodic) field is F = grad phi + rot psi; in Fourier space the curl-free part is k (k . F^) / |k|^2 and the rest is divergence-free.',
        },
      ],
    },
    {
      type: 'group', label: 'Try this', children: [
        {
          type: 'info', visibleIf: isTab('field2'),
          text: '1. Pick "rigid vortex": the paddle wheel spins, the disc keeps its size. Pick "source": the reverse. 2. "shear" has div = 0 yet curl != 0: layers sliding do rotate a paddle. 3. Type Fx = x^2 - y^2, Fy = -2*x*y: div and curl vanish everywhere (a harmonic field). 4. Drag the probe over the "saddle": the Jacobian eigenvectors are the stable / unstable directions. 5. Set the derivative step to 1e-8 on a typed field and watch round-off noise in the curl map.',
        },
        {
          type: 'info', visibleIf: isTab('green'),
          text: '1. Rigid vortex + circle: circulation = 2 x area. 2. Dipole: enclose only the + charge, flux = 2 pi; enclose both, flux = 0. 3. Raise the cell count: the staircase boundary circulation converges to the smooth one and always equals the sum of the cells. 4. Path test with "gradient of x^2 y" (equal) and "rigid vortex" (different). 5. Flip the orientation: circulation changes sign, flux (outward) does not.',
        },
        {
          type: 'info', visibleIf: isTab('field3'),
          text: '1. "point charge": a sphere around the origin has flux 4 pi, move it away and the flux is 0; the triple integral of div F stays 0 (delta function). 2. "wire": loop around the z axis gives circulation 2 pi while the curl flux through the flat disc is 0 (the current is in the axis). 3. "ABC flow": curl F = F, so circulation equals the flux of F itself. 4. Slide the cap height: Stokes flux does not change for smooth fields. 5. Slice |curl F| of "screw".',
        },
        {
          type: 'info', visibleIf: isTab('potential'),
          text: '1. "gradient of x^2 y": phi = x^2 y; move the base point and phi shifts by a constant. 2. "convection cells": automatic mode switches to the stream function; contours are the streamlines. 3. "swirl + source": neither exists, go to Helmholtz. 4. Drawn field: add a source and a vortex; the source appears only in the middle panel, the vortex only in the right one.',
        },
      ],
    },
    {
      type: 'group', label: 'Open in...', children: [
        { type: 'button', label: 'Electrostatics (Gauss: divergence theorem)', onClick: () => actions.open('em-electrostatics') },
        { type: 'button', label: "Magnetostatics (Ampere: Stokes' theorem)", onClick: () => actions.open('em-magnetostatics') },
        { type: 'button', label: 'Linear algebra: Jacobian at the probe', onClick: () => actions.open('ma-linalg') },
        { type: 'button', label: 'PDEs (Laplace / Poisson, potentials)', onClick: () => actions.open('ma-pde') },
      ],
    },
    { type: 'button', label: 'Reset', onClick: () => actions.reset() },
  ];
}

export default {
  id: 'ma-vector',
  title: 'Vector Calculus: Divergence, Curl, Green & Stokes',
  description: 'Vector fields in 2D and 3D, divergence and curl, Green / divergence / Stokes theorems checked numerically, potentials and the Helmholtz decomposition.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings);
    const cleanups = [];
    const st = {
      disposed: false, dirty: true, w: 800, h: 600, rect: { x: 0, y: 0, w: 800, h: 600 }, pressed: false, touchHandle: false, error: null, drawCount: 0,
    };
    const over = {};
    let timer = null;
    let doResize = () => {};
    let tabs = {};

    const get = (k) => (Object.prototype.hasOwnProperty.call(over, k) ? over[k] : store.get(k));
    const flush = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      const keys = Object.keys(over);
      for (const k of keys) { const v = over[k]; delete over[k]; store.set(k, v); }
    };
    const commit = (k, v) => {
      over[k] = v;
      st.dirty = true;
      if (timer === null && !st.disposed) {
        timer = setTimeout(() => { timer = null; if (!st.disposed) flush(); }, 150);
        if (timer && timer.unref) timer.unref();
      }
    };
    const set = (k, v) => { store.set(k, v); };
    let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
    const env = {
      get, set, commit, flush, dirty: () => { st.dirty = true; }, retry: () => { st.dirty = true; },
      rect: () => st.rect, pal: () => pal,
    };
    const activeTab = () => tabs[get('tab')] || tabs.field2;

    const sketch = (p) => {
      env.p = p;
      const sizeNow = () => { const s = ctx.size(); return { w: Math.max(260, s.width), h: Math.max(260, s.height) }; };
      const layout = (w, h) => { st.w = w; st.h = h; st.rect = { x: 0, y: 0, w, h }; };
      p.setup = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        layout(w, h);
        tabs = {
          field2: createField2Tab({ ...env, p }), green: createGreenTab({ ...env, p }), field3: createField3Tab({ ...env, p }), potential: createPotentialTab({ ...env, p }),
        };
      };
      doResize = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        layout(w, h);
        st.dirty = true;
      };

      const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
      const inRect = (x, y) => x >= 0 && y >= 0 && x < st.w && y < st.h;

      p.mousePressed = (e) => {
        if (!onCanvas(e) || !inRect(p.mouseX, p.mouseY) || !tabs.field2) return;
        const t = activeTab();
        const is3 = get('tab') === 'field3';
        if (!is3 && (p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER)) return;
        st.pressed = !!t.press(p.mouseX, p.mouseY, e);
        st.dirty = true;
      };
      p.mouseDragged = () => {
        if (!st.pressed) return;
        activeTab().drag(p.mouseX, p.mouseY);
        st.dirty = true;
      };
      p.mouseReleased = () => {
        if (!st.pressed) return;
        st.pressed = false;
        activeTab().release(p.mouseX, p.mouseY);
        st.dirty = true;
      };
      p.doubleClicked = (e) => {
        if (!onCanvas(e) || !inRect(p.mouseX, p.mouseY) || !tabs.field2) return;
        activeTab().reset();
        st.dirty = true;
      };
      p.mouseWheel = (e) => {
        if (!onCanvas(e) || !tabs.field2) return true;
        let d = (e && (e.delta !== undefined ? e.delta : e.deltaY)) || 0;
        if (e && e.deltaMode === 1) d *= 33; else if (e && e.deltaMode === 2) d *= 400;
        d = clamp(d, -300, 300);
        if (!d || !inRect(p.mouseX, p.mouseY)) return true;
        const used = activeTab().wheel(p.mouseX, p.mouseY, d, e);
        if (!used) return true;
        st.dirty = true;
        if (e && e.preventDefault) e.preventDefault();
        return false;
      };

      const touch1 = () => { const t = p.touches || []; return t.length === 1 ? [t[0].x, t[0].y] : null; };
      p.touchStarted = (e) => {
        if (!onCanvas(e) || !tabs.field2) return true;
        const tab = activeTab();
        const t = touch1();
        if (get('tab') === 'field3') {
          if (t && inRect(t[0], t[1]) && tab.pressHandle(t[0], t[1])) { st.touchHandle = true; return false; }
          return tab.ctl.touchStarted(e);
        }
        if (t && inRect(t[0], t[1])) { st.pressed = !!tab.press(t[0], t[1], e); st.dirty = true; return false; }
        return true;
      };
      p.touchMoved = () => {
        if (!tabs.field2) return true;
        const tab = activeTab();
        const t = touch1();
        if (get('tab') === 'field3' && !st.touchHandle) return tab.ctl.touchMoved();
        if (t && st.pressed || t && st.touchHandle) { tab.drag(t[0], t[1]); st.dirty = true; return false; }
        return true;
      };
      p.touchEnded = () => {
        if (!tabs.field2) return true;
        const tab = activeTab();
        if (get('tab') === 'field3' && !st.touchHandle) return tab.ctl.touchEnded();
        const had = st.pressed || st.touchHandle;
        st.pressed = false; st.touchHandle = false;
        if (had) { tab.release(); st.dirty = true; }
        return !had;
      };

      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const el = globalThis.document && globalThis.document.activeElement;
        const k = String(p.key);
        if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable || (/^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter')))) return true;
        if (k === 'r' || k === 'R') { if (tabs.field2) activeTab().reset(); st.dirty = true; return false; }
        const idx = '1234'.indexOf(k);
        if (idx >= 0 && k.length === 1) { store.set('tab', TABS[idx].value); return false; }
        return true;
      };

      p.draw = () => {
        if (st.disposed || !tabs.field2) return;
        const tab = activeTab();
        const anim = tab.wantsFrames();
        if (!st.dirty && !anim) return;
        st.dirty = false;
        st.drawCount++;
        const dt = clamp((p.deltaTime || 16) / 1000, 0, 0.05);
        try {
          tab.draw(dt);
          st.error = null;
        } catch (err) {
          p.background(pal.bg);
          p.noStroke(); p.fill('#ff6b6b'); p.textAlign(p.LEFT, p.TOP); p.textSize(13);
          p.text(`error: ${err && err.message ? err.message : err}`, 12, 12);
          st.error = err;
        }
      };
      cleanups.push(ctx.globalSettings.subscribe(() => { pal = getPalette(ctx.globalSettings.get('theme', 'dark')); st.dirty = true; }));
    };

    const instance = new ctx.p5(sketch, container);
    cleanups.push(store.subscribe(() => { st.dirty = true; }));
    cleanups.push(ctx.onResize(() => doResize()));

    const actions = {
      open(id) {
        const params = {};
        if (id === 'ma-linalg' && tabs.field2) {
          const inf = tabs.field2.probeInfo();
          const J = inf.J;
          params.A = `${fmt(J[0][0], 4)},${fmt(J[0][1], 4)};${fmt(J[1][0], 4)},${fmt(J[1][1], 4)}`;
        }
        flush();
        return openIn(id, params);
      },
      reset() {
        flush();
        store.reset();
        for (const t of Object.values(tabs)) t.reset();
        st.dirty = true;
      },
      clearBlobs() { if (tabs.potential) tabs.potential.clearBlobs(); },
    };
    const toolTabs = ctx.ui.build([{ type: 'tabs', key: 'tab', options: TABS }], store, ctx.toolbar);
    const panel = ctx.ui.build(buildSchema(actions), store, ctx.drawer);

    return {
      /** Introspection for tests and debugging. */
      debug() {
        return {
          tab: get('tab'), tabs, drawCount: st.drawCount, error: st.error, rect: st.rect, actions, env,
        };
      },
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        for (const c of cleanups.splice(0)) {
          try { c(); } catch { /* ignore */ }
        }
        try { toolTabs.destroy(); } catch { /* ignore */ }
        try { panel.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
      },
    };
  },
};
