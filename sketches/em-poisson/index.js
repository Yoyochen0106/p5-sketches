// Laplace & Poisson Solver: Conductors & Capacitance  (course: Electromagnetics, unit 2)
//
// Paint conductors (fixed voltage), dielectrics (eps_r) and charge density on a grid and solve div(eps grad phi) = -rho/eps0
// with Jacobi / Gauss-Seidel / SOR / red-black SOR / multigrid running in lock-step on the SAME problem, with a
// residual-vs-iteration plot. Post-processing: E = -grad phi arrows, equipotentials (marching squares), induced surface
// charge, energy, capacitance by charge and by energy against analytic values, probes and a breakdown-field overlay.
//
// Public settings (deep-link keys):
//   preset  'plates' | 'plates-finite' | 'coax' | 'wedge' | 'faraday' | 'faraday-open' | 'dielectric' | 'charges' | '' (custom)
//   res     64 | 128 | 256 cells across the width        aspect 1 | 0.75 | 0.5        bc 'grounded' | 'neumann' | 'periodic'
//   width   domain width in cm            V  electrode voltage [V]        epsr  relative permittivity        rho  painted charge [uC/m^3]
//   method  displayed solver 'jacobi'|'gs'|'sor'|'rb'|'mg'        m.<id> run that solver too        omega (0 = optimal)  sweeps per frame
//   tool    'probe'|'conductor'|'dielectric'|'charge'|'erase'     brush (radius, cells)     Eb  breakdown field [MV/m]
//   show.map 'phi'|'E'|'none'   show.equi   show.arrows   show.charge   show.breakdown   equiCount
// Painted content itself is not serialised (open the unit with a preset to share a configuration).

import { getPalette } from '../approx/palette.js';
import { marchingSquares } from '../../lib/marching.js';
import {
  PoissonProblem, Solver, POISSON_PRESETS, METHODS, EPS0, solve, fieldFromPhi, nodeCharges, capacitance, fieldEnergy,
  optimalOmega, stamp, resampleInto, sampleField, refractionCheck, freeCharge,
} from '../../lib/em/poisson.js';
import {
  DEFAULTS, TOOLS, RES_OPTIONS, ASPECT_OPTIONS, BC_OPTIONS, MAP_OPTIONS, METHOD_COLORS, THEORY, TRY_THIS,
} from './state.js';
import { fieldImage, overlayImage, drawConvergence, clamp, fmt } from './render.js';
import { openUnit } from './link.js';

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

function buildSchema(A) {
  const presetOpts = [{ value: '', label: 'custom (painted)' }, ...POISSON_PRESETS.map((c) => ({ value: c.id, label: c.label }))];
  return [
    {
      type: 'group', label: 'Problem', children: [
        { type: 'select', key: 'preset', label: 'preset', options: presetOpts },
        { type: 'select', key: 'res', label: 'resolution', options: RES_OPTIONS },
        { type: 'select', key: 'aspect', label: 'domain shape', options: ASPECT_OPTIONS },
        { type: 'select', key: 'bc', label: 'boundary', options: BC_OPTIONS },
        { type: 'slider', key: 'width', label: 'domain width (cm)', min: 1, max: 100, step: 1 },
        { type: 'slider', key: 'V', label: 'electrode voltage V (V)', min: -50000, max: 50000, step: 100 },
        { type: 'slider', key: 'epsr', label: 'relative permittivity eps_r', min: 1, max: 20, step: 0.5 },
        { type: 'slider', key: 'rho', label: 'painted charge density (uC/m^3)', min: -20000, max: 20000, step: 100 },
        { type: 'button', label: 'Clear everything', onClick: A.clear },
      ],
    },
    {
      type: 'group', label: 'Paint (tool bar above)', children: [
        { type: 'slider', key: 'brush', label: 'brush radius (cells)', min: 1, max: 20, step: 1 },
        { type: 'info', text: 'Left drag paints with the active tool, right drag erases. Probe tool: click to drop up to 4 probes (click again to cycle). Painting turns the preset into "custom".' },
      ],
    },
    {
      type: 'group', label: 'Solvers (lock-step on the same problem)', children: [
        { type: 'select', key: 'method', label: 'displayed solution from', options: METHODS.map((m) => ({ value: m.id, label: m.label })) },
        { type: 'toggle', key: 'm.jacobi', label: 'run Jacobi' },
        { type: 'toggle', key: 'm.gs', label: 'run Gauss-Seidel' },
        { type: 'toggle', key: 'm.sor', label: 'run SOR' },
        { type: 'toggle', key: 'm.rb', label: 'run red-black SOR' },
        { type: 'toggle', key: 'm.mg', label: 'run multigrid V-cycle' },
        { type: 'slider', key: 'omega', label: 'SOR omega (0 = optimal 2/(1+sin(pi/N)))', min: 0, max: 1.99, step: 0.01 },
        { type: 'slider', key: 'sweeps', label: 'iterations per frame', min: 1, max: 100, step: 1 },
        { type: 'toggle', key: 'run', label: 'animate relaxation (Space)' },
        { type: 'button', label: 'Single step (N)', onClick: A.step },
        { type: 'button', label: 'Restart from phi = 0 (R)', onClick: A.restart },
        { type: 'button', label: 'Solve now (multigrid to 1e-10)', onClick: A.solveNow },
        { type: 'toggle', key: 'plot.logx', label: 'log iteration axis' },
        { type: 'toggle', key: 'plot.work', label: 'x axis = work (multigrid cycle = 6 sweeps)' },
      ],
    },
    {
      type: 'group', label: 'Display', children: [
        { type: 'select', key: 'show.map', label: 'colour map', options: MAP_OPTIONS },
        { type: 'toggle', key: 'show.equi', label: 'equipotentials (marching squares)' },
        { type: 'slider', key: 'equiCount', label: 'levels', min: 4, max: 40, step: 1 },
        { type: 'toggle', key: 'show.arrows', label: 'E = -grad phi arrows' },
        { type: 'toggle', key: 'show.charge', label: 'induced surface charge on conductors' },
        { type: 'toggle', key: 'show.breakdown', label: 'breakdown field overlay (|E| > E_b)' },
        { type: 'slider', key: 'Eb', label: 'breakdown field E_b (MV/m)', min: 0.1, max: 30, step: 0.1 },
        { type: 'button', label: 'Clear probes', onClick: A.clearProbes },
      ],
    },
    {
      type: 'group', label: 'Open in...', collapsed: true, children: [
        { type: 'button', label: 'Electrostatics: point charges & Gauss', onClick: () => openUnit('em-electrostatics', { preset: 'dipole' }) },
        { type: 'button', label: 'Electrostatics: Gauss law tab', onClick: () => openUnit('em-electrostatics', { tab: 'gauss', preset: 'dipole' }) },
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
  id: 'em-poisson',
  title: 'Laplace & Poisson Solver: Conductors & Capacitance',
  description: 'Paint conductors, dielectrics and charge; solve Poisson with Jacobi, Gauss-Seidel, SOR and multigrid side by side; read capacitance, energy, induced charge and breakdown fields.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings);
    const get = (k) => store.get(k);
    const cleanups = [];
    const st = {
      disposed: false,
      pal: getPalette(ctx.globalSettings.get('theme', 'dark')),
      prob: null,
      info: {},
      solvers: new Map(),
      lastPreset: null,
      geomKey: '',
      paramKey: '',
      lastTool: null,
      probes: [],
      hover: null,
      paint: null,
      paintDirty: false,
      post: { key: '', field: null, charges: null, cap: null, energy: 0, groups: [] },
      imgs: { field: null, over: null, fieldKey: '', overKey: '', range: { lo: 0, hi: 1 } },
      equi: { key: '', segs: [] },
      layout: null,
      mounted: false,
      stepOnce: false,
    };
    const dirtyAll = () => { st.post.key = ''; st.imgs.fieldKey = ''; st.imgs.overKey = ''; st.equi.key = ''; };

    // ---------- problem construction ----------
    const rhoNorm = () => (Number(get('rho')) * 1e-6) / EPS0; // rho/eps0 in V/m^2
    const presetObj = () => POISSON_PRESETS.find((c) => c.id === get('preset')) || null;

    function build({ resampleFrom = null } = {}) {
      const pr = presetObj();
      const prob = new PoissonProblem({ cells: get('res'), aspect: get('aspect'), bc: get('bc'), width: get('width') / 100 });
      if (pr) st.info = pr.make(prob, { V: get('V'), epsr: get('epsr'), rhoNorm: rhoNorm() }) || {};
      else { st.info = {}; if (resampleFrom) resampleInto(prob, resampleFrom); }
      prob.commit();
      st.prob = prob;
      st.solvers.clear();
      st.probes = [];
      dirtyAll();
      ensureSolvers();
    }

    function ensureSolvers() {
      const disp = get('method');
      for (const m of METHODS) {
        const want = m.id === disp || get(`m.${m.id}`);
        if (want && !st.solvers.has(m.id)) st.solvers.set(m.id, new Solver(st.prob, m.id, { omega: Number(get('omega')) || null }));
        if (!want) st.solvers.delete(m.id);
      }
      for (const s of st.solvers.values()) s.userOmega = Number(get('omega')) || null;
    }

    function keys() {
      return {
        geom: `${get('res')}|${get('aspect')}|${get('bc')}|${get('width')}`,
        param: `${get('V')}|${get('epsr')}|${get('rho')}`,
      };
    }

    function syncSettings() {
      const preset = get('preset');
      let k = keys();
      if (preset !== st.lastPreset) {
        const first = st.lastPreset === null;
        st.lastPreset = preset;
        const pr = presetObj();
        if (pr) {
          if (get('bc') !== pr.bc) store.set('bc', pr.bc);
          if (get('aspect') !== pr.aspect) store.set('aspect', pr.aspect);
          if (!first && pr.usesEpsr && get('epsr') !== (pr.defaultEpsr || 1)) store.set('epsr', pr.defaultEpsr || 1);
          if (!first && !pr.usesEpsr && get('epsr') !== 1) store.set('epsr', 1);
        }
        k = keys();
        st.geomKey = k.geom; st.paramKey = k.param;
        build({ resampleFrom: first ? null : st.prob });
      } else if (k.geom !== st.geomKey) {
        const old = st.prob;
        if (preset) { store.set('preset', ''); st.lastPreset = ''; }
        st.geomKey = k.geom; st.paramKey = k.param;
        build({ resampleFrom: old });
      } else if (k.param !== st.paramKey) {
        st.paramKey = k.param;
        if (preset) build();
      }
      const tool = get('tool');
      if (tool !== st.lastTool) {
        st.lastTool = tool;
        if (tool === 'dielectric' && get('epsr') <= 1.0001) store.set('epsr', 4);
      }
      ensureSolvers();
    }

    // ---------- solving ----------
    function weight(id) { return id === 'mg' ? 6 : 1; }
    function iterate(n) {
      const active = [...st.solvers.values()].filter((s) => !s.converged);
      if (!active.length) return;
      const cells = st.prob.nx * st.prob.ny;
      const w = active.reduce((a, s) => a + weight(s.method), 0);
      const it = clamp(Math.floor(2.4e6 / (cells * w)), 1, n);
      for (const s of active) s.step(it);
    }
    const display = () => st.solvers.get(get('method')) || st.solvers.values().next().value;

    const A = {
      step() { st.stepOnce = true; },
      restart() { for (const s of st.solvers.values()) s.restart(true); dirtyAll(); },
      solveNow() {
        const s = display();
        if (!s) return;
        const r = solve(st.prob, { tol: 1e-11, maxCycles: 80 });
        s.phi.set(r.phi);
        s.version = st.prob.version;
        s.measure();
        dirtyAll();
      },
      clear() {
        if (get('preset')) { store.set('preset', ''); st.lastPreset = ''; }
        st.prob.clear();
        st.info = {};
        st.probes = [];
        for (const s of st.solvers.values()) { s.restart(true); }
        dirtyAll();
      },
      clearProbes() { st.probes = []; },
      reset() {
        store.reset();
        st.lastPreset = null;
        st.geomKey = ''; st.paramKey = '';
        syncSettings();
      },
    };

    // ---------- post-processing ----------
    function postProcess() {
      const s = display();
      if (!s) return;
      const key = `${st.prob.version}|${get('method')}|${s.iter}|${s.version}`;
      if (st.post.key === key) return;
      st.post.key = key;
      const prob = st.prob;
      st.post.field = fieldFromPhi(prob, s.phi);
      st.post.charges = nodeCharges(prob, s.phi);
      st.post.cap = capacitance(prob, s.phi);
      st.post.energy = fieldEnergy(prob, s.phi);
      st.imgs.fieldKey = ''; st.imgs.overKey = ''; st.equi.key = '';
    }

    // ---------- layout / mapping ----------
    function computeLayout(p) {
      const W = p.width, H = p.height;
      const prob = st.prob;
      const wide = W >= 820;
      const pw = wide ? clamp(Math.round(W * 0.36), 300, 460) : 0;
      const area = wide ? { x: 8, y: 8, w: W - pw - 24, h: H - 16 } : { x: 8, y: 8, w: W - 16, h: Math.round(H * 0.6) - 8 };
      const cw = Math.max(1, Math.min(area.w / prob.cells, area.h / prob.cellsY));
      const dom = { cw, w: cw * prob.cells, h: cw * prob.cellsY };
      dom.x = area.x + (area.w - dom.w) / 2;
      dom.y = area.y + (area.h - dom.h) / 2;
      const panel = wide ? { x: W - pw - 8, y: 8, w: pw, h: H - 16 } : { x: 8, y: Math.round(H * 0.6), w: W - 16, h: H - Math.round(H * 0.6) - 8 };
      const convH = wide ? Math.round(panel.h * 0.42) : panel.h;
      st.layout = { dom, wide, conv: { x: panel.x, y: panel.y, w: panel.w, h: convH }, info: { x: panel.x, y: panel.y + convH + 8, w: panel.w, h: panel.h - convH - 8 } };
      return st.layout;
    }
    const toNode = (px, py) => {
      const d = st.layout.dom;
      return { i: Math.round((px - d.x) / d.cw), j: Math.round((d.y + d.h - py) / d.cw) };
    };
    const inDomain = (px, py) => {
      const d = st.layout.dom;
      return px >= d.x - d.cw / 2 && px <= d.x + d.w + d.cw / 2 && py >= d.y - d.cw / 2 && py <= d.y + d.h + d.cw / 2;
    };

    // ---------- painting ----------
    function paintAt(i, j, tool) {
      const prob = st.prob;
      const r = Number(get('brush'));
      let val = 0;
      if (tool === 'conductor') val = Number(get('V'));
      else if (tool === 'dielectric') val = Number(get('epsr'));
      else if (tool === 'charge') val = rhoNorm();
      stamp(prob, tool, clamp(i, 0, prob.nx - 1), clamp(j, 0, prob.ny - 1), r, val, false);
      st.paintDirty = true;
    }

    // ---------- the p5 sketch ----------
    const sketch = (p) => {
      const sizeNow = () => {
        const s = ctx.size();
        return { w: Math.max(300, s.width), h: Math.max(300, s.height) };
      };
      const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
      const isBtn = (name) => {
        const b = p.mouseButton;
        return b === p[name.toUpperCase()] || !!(b && typeof b === 'object' && b[name]);
      };

      p.setup = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.createCanvas(w, h);
        const cv = p.canvas;
        const el = cv && (typeof cv.addEventListener === 'function' ? cv : cv.elt);
        if (el && typeof el.addEventListener === 'function') {
          const noMenu = (e) => { if (e && e.preventDefault) e.preventDefault(); };
          el.addEventListener('contextmenu', noMenu);
          cleanups.push(() => el.removeEventListener('contextmenu', noMenu));
        }
        p.textFont('sans-serif');
        syncSettings();
        st.mounted = true;
        computeLayout(p);
      };

      function pointerDown(e) {
        if (!onCanvas(e) || !st.layout) return false;
        if (!inDomain(p.mouseX, p.mouseY)) return false;
        const { i, j } = toNode(p.mouseX, p.mouseY);
        const tool = get('tool');
        const right = isBtn('right') || isBtn('center');
        if (tool === 'probe' && !right) {
          const hit = st.probes.findIndex((q) => Math.abs(q.i - i) + Math.abs(q.j - j) <= 3);
          if (hit >= 0) st.probes.splice(hit, 1);
          else { st.probes.push({ i: clamp(i, 0, st.prob.nx - 1), j: clamp(j, 0, st.prob.ny - 1) }); if (st.probes.length > 4) st.probes.shift(); }
          return true;
        }
        const t = right ? 'erase' : tool === 'probe' ? 'erase' : tool;
        if (get('preset')) { store.set('preset', ''); st.lastPreset = ''; st.info = {}; }
        st.paint = { tool: t, i, j };
        paintAt(i, j, t);
        return true;
      }
      function pointerDrag() {
        if (!st.layout) return;
        updateHover();
        const s = st.paint;
        if (!s) return;
        const { i, j } = toNode(p.mouseX, p.mouseY);
        const dist = Math.hypot(i - s.i, j - s.j);
        const stepLen = Math.max(1, Number(get('brush')) / 2);
        const n = Math.max(1, Math.ceil(dist / stepLen));
        for (let k = 1; k <= n; k++) paintAt(Math.round(s.i + (i - s.i) * k / n), Math.round(s.j + (j - s.j) * k / n), s.tool);
        s.i = i; s.j = j;
      }
      function pointerUp() {
        const had = !!st.paint;
        st.paint = null;
        return had;
      }
      function updateHover() {
        if (!st.layout || !inDomain(p.mouseX, p.mouseY)) { st.hover = null; return; }
        const { i, j } = toNode(p.mouseX, p.mouseY);
        st.hover = { i: clamp(i, 0, st.prob.nx - 1), j: clamp(j, 0, st.prob.ny - 1) };
      }
      p.mousePressed = (e) => { pointerDown(e); };
      p.mouseDragged = () => { pointerDrag(); };
      p.mouseReleased = () => { pointerUp(); };
      p.mouseMoved = (e) => { if (onCanvas(e)) updateHover(); };
      p.touchStarted = (e) => (pointerDown(e) ? false : true);
      p.touchMoved = () => { pointerDrag(); return !st.paint; };
      p.touchEnded = () => !pointerUp();
      p.mouseWheel = (e) => {
        if (!onCanvas(e) || !st.layout || !inDomain(p.mouseX, p.mouseY)) return true;
        let d = Number(e && (e.deltaY !== undefined ? e.deltaY : e.delta)) || 0;
        if (e && e.deltaMode === 1) d *= 33;
        else if (e && e.deltaMode === 2) d *= 400;
        d = clamp(d, -300, 300);
        if (d === 0) return true;
        store.set('brush', clamp(Math.round(Number(get('brush')) - Math.sign(d)), 1, 20));
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
        const tools = ['probe', 'conductor', 'dielectric', 'charge', 'erase'];
        if (k === ' ') store.set('run', !get('run'));
        else if (k === 'n' || k === 'N') A.step();
        else if (k === 'r' || k === 'R') A.restart();
        else if (k >= '1' && k <= '5') store.set('tool', tools[Number(k) - 1]);
        else return true;
        return false;
      };

      st.resize = () => {
        if (st.disposed) return;
        const { w, h } = sizeNow();
        p.resizeCanvas(w, h, true);
        computeLayout(p);
      };

      // ---------- drawing ----------
      function ensureImages() {
        const prob = st.prob;
        const s = display();
        if (!s || !st.post.field) return;
        const k1 = `${st.post.key}|${get('show.map')}|${st.pal.dark}`;
        if (!st.imgs.field || st.imgs.field.width !== prob.nx || st.imgs.field.height !== prob.ny) {
          st.imgs.field = p.createImage(prob.nx, prob.ny);
          st.imgs.over = p.createImage(prob.nx, prob.ny);
          st.imgs.fieldKey = ''; st.imgs.overKey = '';
        }
        if (st.imgs.fieldKey !== k1) {
          st.imgs.range = fieldImage(st.imgs.field, prob, s.phi, st.post.field, get('show.map'), st.pal);
          st.imgs.fieldKey = k1;
        }
        const Vs = groupsAbs()[0];
        const k2 = `${st.post.key}|${get('show.charge')}|${get('show.breakdown')}|${get('Eb')}|${prob.version}`;
        if (st.imgs.overKey !== k2) {
          overlayImage(st.imgs.over, prob, st.post.field, get('show.charge') ? st.post.charges : null, {
            showCharge: !!get('show.charge'), showBreakdown: !!get('show.breakdown'), Ebreak: Number(get('Eb')) * 1e6, Vscale: Vs, pal: st.pal,
          });
          st.imgs.overKey = k2;
        }
      }
      function groupsAbs() {
        let m = 0;
        const prob = st.prob;
        for (let k = 0; k < prob.size; k++) if (prob.fixed[k]) m = Math.max(m, Math.abs(prob.fixedV[k]));
        return [m || 1];
      }

      function equipotentials() {
        const prob = st.prob, s = display();
        if (!s) return [];
        const n = get('equiCount');
        const key = `${st.post.key}|${n}`;
        if (st.equi.key === key) return st.equi.segs;
        // contour a decimated lattice (<= 128 cells across) to keep the number of drawn segments small
        const stride = Math.max(1, Math.ceil((prob.nx - 1) / 128));
        const cx = Math.floor((prob.nx - 1) / stride), cy = Math.floor((prob.ny - 1) / stride);
        const vals = new Float32Array((cx + 1) * (cy + 1));
        let lo = Infinity, hi = -Infinity;
        for (let j = 0; j <= cy; j++) {
          for (let i = 0; i <= cx; i++) {
            const v = s.phi[prob.idx(i * stride, j * stride)];
            vals[i + (cx + 1) * j] = v;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const segs = [];
        if (hi - lo > 1e-12) {
          const b = { xmin: 0, xmax: cx * stride, ymin: 0, ymax: cy * stride };
          for (let k = 0; k < n; k++) {
            const level = lo + (k + 0.5) * (hi - lo) / n;
            const r = marchingSquares({ values: vals, nx: cx, ny: cy, bounds: b }, { level });
            segs.push({ seg: r.segments, count: r.count });
          }
        }
        st.equi = { key, segs };
        return segs;
      }

      function drawDomain() {
        const L = st.layout, d = L.dom, prob = st.prob;
        const pal = st.pal;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(d.x - 4, d.y - 4, d.w + 8, d.h + 8, 4);
        if (!st.imgs.field) return;
        p.push();
        p.drawingContext.beginPath();
        p.drawingContext.rect(d.x, d.y, d.w, d.h);
        p.drawingContext.clip();
        p.image(st.imgs.field, d.x - d.cw / 2, d.y - d.cw / 2, prob.nx * d.cw, prob.ny * d.cw);
        p.noSmooth();
        p.image(st.imgs.over, d.x - d.cw / 2, d.y - d.cw / 2, prob.nx * d.cw, prob.ny * d.cw);
        p.smooth();
        // equipotentials
        if (get('show.equi')) {
          p.stroke(pal.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)');
          p.strokeWeight(1);
          p.beginShape(p.LINES);
          for (const { seg, count } of equipotentials()) {
            for (let k = 0; k < count; k++) {
              p.vertex(d.x + seg[4 * k] * d.cw, d.y + d.h - seg[4 * k + 1] * d.cw);
              p.vertex(d.x + seg[4 * k + 2] * d.cw, d.y + d.h - seg[4 * k + 3] * d.cw);
            }
          }
          p.endShape();
        }
        // arrows
        if (get('show.arrows') && st.post.field) {
          const f = st.post.field;
          const stride = Math.max(2, Math.round(30 / d.cw));
          p.stroke(pal.dark ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)');
          p.strokeWeight(1);
          p.beginShape(p.LINES);
          for (let j = stride >> 1; j < prob.ny; j += stride) {
            for (let i = stride >> 1; i < prob.nx; i += stride) {
              const k = prob.idx(i, j);
              if (prob.fixed[k]) continue;
              const m = f.mag[i + prob.nx * j];
              if (!(m > 1e-9)) continue;
              const ux = f.ex[i + prob.nx * j] / m, uy = -f.ey[i + prob.nx * j] / m;
              const L2 = clamp(stride * d.cw * 0.7, 8, 22);
              const sx = d.x + i * d.cw, sy = d.y + d.h - j * d.cw;
              const x0 = sx - ux * L2 / 2, y0 = sy - uy * L2 / 2, x1 = sx + ux * L2 / 2, y1 = sy + uy * L2 / 2;
              p.vertex(x0, y0); p.vertex(x1, y1);
              p.vertex(x1, y1); p.vertex(x1 - ux * 5 - uy * 3, y1 - uy * 5 + ux * 3);
              p.vertex(x1, y1); p.vertex(x1 - ux * 5 + uy * 3, y1 - uy * 5 - ux * 3);
            }
          }
          p.endShape();
        }
        p.pop();
        // frame, probes, brush
        p.noFill();
        p.stroke(pal.axis);
        p.strokeWeight(1);
        p.rect(d.x, d.y, d.w, d.h);
        const f = st.post.field;
        st.probes.forEach((q, n) => {
          const sx = d.x + q.i * d.cw, sy = d.y + d.h - q.j * d.cw;
          p.stroke('#ffd24a');
          p.strokeWeight(1.5);
          p.line(sx - 6, sy, sx + 6, sy);
          p.line(sx, sy - 6, sx, sy + 6);
          p.noStroke();
          p.fill('#ffd24a');
          p.textSize(10);
          p.textAlign(p.LEFT, p.BOTTOM);
          p.text(String(n + 1), sx + 5, sy - 3);
        });
        void f;
        if (st.hover && ['conductor', 'dielectric', 'charge', 'erase'].includes(get('tool'))) {
          p.noFill();
          p.stroke(pal.fg);
          p.strokeWeight(1);
          p.circle(d.x + st.hover.i * d.cw, d.y + d.h - st.hover.j * d.cw, 2 * Number(get('brush')) * d.cw);
        }
      }

      function probeLine(prefix, i, j) {
        const prob = st.prob, f = st.post.field, s = display();
        if (!f || !s) return '';
        const k = prob.idx(i, j);
        const o = i + prob.nx * j;
        const E = f.mag[o];
        return `${prefix} phi = ${fmt(s.phi[k])} V   |E| = ${fmt(E / 1e3)} kV/m   angle ${fmt(Math.atan2(f.ey[o], f.ex[o]) * 180 / Math.PI, 3)} deg   eps_r ${fmt(prob.eps[k], 3)}`;
      }

      function infoLines(compact) {
        const prob = st.prob, s = display(), f = st.post.field, pr = st.post.cap;
        const lines = [];
        if (!s || !f) return lines;
        const wopt = optimalOmega(prob.nx, prob.ny);
        const label = METHODS.find((m) => m.id === s.method).label;
        lines.push([`${prob.cells} x ${prob.cellsY} cells   h = ${fmt(prob.h * 1000)} mm   boundary: ${prob.bc}`, 'muted']);
        lines.push([`${label}: iteration ${s.iter}   residual ${fmt(s.res.length ? s.res[s.res.length - 1] : 1, 2)} (relative)${s.converged ? '   converged' : ''}`, s.converged ? '#2ecc71' : null]);
        lines.push([`SOR omega = ${fmt(s.method === 'sor' || s.method === 'rb' ? s.omega : wopt, 4)}${Number(get('omega')) ? '' : '  (optimal 2/(1+sin(pi/N)))'}`, 'muted']);
        const W = st.post.energy * EPS0;
        lines.push(`energy W' = ${fmt(W * 1e6)} uJ/m     E_max = ${fmt(f.max / 1e6)} MV/m`);
        if (st.info.gap && f.max > 0) {
          const dV = pr ? Math.abs(pr.dV) : Math.max(...groupsAbs());
          const Eavg = dV / (st.info.gap * prob.width);
          lines.push(`field enhancement beta = E_max / (V/gap) = ${fmt(f.max / Eavg, 3)}`);
        }
        const frac = fractionAbove(f, Number(get('Eb')) * 1e6);
        lines.push([`breakdown: ${fmt(100 * frac, 2)} % of the gas above E_b = ${fmt(Number(get('Eb')))} MV/m`, frac > 0 ? '#ff6b6b' : 'muted']);
        if (pr && !pr.hasFreeCharge) {
          lines.push(`C' by charge  Q/dV = ${fmt(pr.CQ * EPS0 * 1e12)} pF/m  (${fmt(pr.CQ, 5)} eps0)`);
          lines.push(`C' by energy  2W/dV^2 = ${fmt(pr.CW * EPS0 * 1e12)} pF/m  (${fmt(pr.CW, 5)} eps0)`);
          lines.push([`methods differ by ${fmt(100 * Math.abs(pr.CQ - pr.CW) / Math.abs(pr.CW), 2)} %`, 'muted']);
          if (st.info.analytic) {
            const a = st.info.analytic;
            lines.push([`analytic ${a.label} = ${fmt(a.value * EPS0 * 1e12)} pF/m   error (charge) ${fmt(100 * (pr.CQ - a.value) / a.value, 3)} %`, '#2ecc71']);
            if (!compact) lines.push([a.note, 'muted']);
          }
        } else if (pr && pr.hasFreeCharge) {
          lines.push(['capacitance n/a (free charge present)', 'muted']);
        }
        if (!compact) {
          for (const g of (pr ? pr.groups : [])) lines.push([`conductor at ${fmt(g.V)} V: Q' = ${fmt(g.Q * EPS0 * 1e9, 4)} nC/m`, 'muted']);
          if (freeCharge(prob) !== 0) lines.push([`free charge = ${fmt(freeCharge(prob) * EPS0 * 1e9, 4)} nC/m`, 'muted']);
        }
        const c = st.info.check;
        if (c && c.kind === 'refraction') {
          const r = refractionCheck(prob, f, c.u, c.v, c.nu, c.nv, c.epsA, c.epsB, 0.02);
          lines.push([`refraction: tan(th1)/tan(th2) = ${fmt(r.ratio, 3)}   eps1/eps2 = ${fmt(r.expected, 3)}`, '#2ecc71']);
        } else if (c && c.kind === 'shield') {
          const ins = sampleField(prob, f.mag, c.inside[0], c.inside[1]), out = sampleField(prob, f.mag, c.outside[0], c.outside[1]);
          lines.push([`shielding: |E| inside ${fmt(ins / 1e3)} kV/m vs outside ${fmt(out / 1e3)} kV/m  (ratio ${fmt(ins / out, 2)})`, '#2ecc71']);
        }
        if (st.hover) lines.push(probeLine('cursor', st.hover.i, st.hover.j));
        if (!compact) st.probes.forEach((q, n) => lines.push(probeLine(`probe ${n + 1}`, q.i, q.j)));
        return lines;
      }
      function fractionAbove(f, Eb) {
        let n = 0, tot = 0;
        const prob = st.prob;
        for (let j = 0; j < prob.ny; j++) for (let i = 0; i < prob.nx; i++) {
          if (prob.fixed[prob.idx(i, j)]) continue;
          tot++;
          if (f.mag[i + prob.nx * j] > Eb) n++;
        }
        return tot ? n / tot : 0;
      }

      function drawInfo(rect, compact) {
        const pal = st.pal;
        const lines = infoLines(compact);
        const size = compact ? 10 : 11;
        const lh = size + 5;
        p.push();
        p.noStroke();
        p.fill(pal.panel);
        p.rect(rect.x, rect.y, rect.w, rect.h, 6);
        p.textSize(size);
        p.textAlign(p.LEFT, p.TOP);
        let y = rect.y + 6;
        const cap = st.info && presetObj();
        if (cap && !compact) {
          p.fill(pal.muted);
          p.text(cap.caption, rect.x + 8, y, rect.w - 16, 56);
          y += 58;
        }
        for (const l of lines) {
          const [txt, col] = Array.isArray(l) ? l : [l, null];
          if (y > rect.y + rect.h - lh) break;
          p.fill(col === 'muted' ? pal.muted : col || pal.fg);
          p.text(txt, rect.x + 8, y);
          y += lh;
        }
        p.pop();
      }

      p.draw = () => {
        if (st.disposed) return;
        syncSettings();
        if (st.paintDirty) { st.prob.commit(); st.paintDirty = false; dirtyAll(); }
        if (get('run') || st.stepOnce) { iterate(st.stepOnce ? 1 : get('sweeps')); st.stepOnce = false; }
        const L = computeLayout(p);
        postProcess();
        ensureImages();
        p.background(st.pal.bg);
        drawDomain();
        drawConvergence(p, st.pal, L.conv, st.solvers, { logx: !!get('plot.logx'), work: !!get('plot.work'), displayed: get('method') });
        if (L.wide) drawInfo(L.info, false);
        else {
          drawInfo({ x: L.dom.x + 6, y: L.dom.y + 6, w: Math.min(L.dom.w - 12, 420), h: 5 * 15 + 12 }, true);
        }
      };

      cleanups.push(ctx.globalSettings.subscribe(() => {
        st.pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
        dirtyAll();
      }));
    };

    const instance = new ctx.p5(sketch, container);
    cleanups.push(ctx.onResize(() => st.resize && st.resize()));
    const toolTabs = ctx.ui.build([{ type: 'tabs', key: 'tool', options: TOOLS }], store, ctx.toolbar);
    const panel = ctx.ui.build(buildSchema(A), store, ctx.drawer);
    void METHOD_COLORS; void MAP_OPTIONS;

    return {
      /** Exposed for inspection (tests, debugging). */
      state: st,
      actions: A,
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
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
