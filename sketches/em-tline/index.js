// Transmission Lines & the Smith Chart (course unit em-tline).
//
// Public settings (deep-link keys):
//   tab     'smith' | 'waves' | 'match' | 'pulse'
//   z0      characteristic impedance (ohm)          zr, zx   load resistance / reactance (ohm)
//   f       frequency (MHz)   vf velocity factor    loss line loss (dB/m)     lenM line length (m)
//   dLam    distance from the load shown on the Smith chart (wavelengths, 0..1)   showY admittance overlay   pins "r,x;r,x"
//   wSpeed  animation speed; wInc/wRef/wTot/wEnv  which waves/envelope to draw
//   mMethod 'stub' | 'qw' | 'lmatch'   mType 'short' | 'open'   stubD, stubL (wavelengths)   qwAt 'max' | 'min'   lSol 0 | 1   rlThr (dB)
//   zs      source impedance (ohm)    pzl load impedance for the pulse tab (ohm, >= 1e8 = open)    pshape 'step' | 'pulse'   pwid (T)
//   pspeed  pulse animation speed     ploop restart automatically
//
// The Smith chart is the Moebius map w = (z - 1)/(z + 1) (lib/conformal.js applyMoebius): circles of constant
// r and x are the images of lines Re z = r and Im z = x -- see the `conformal` unit.

import { getPalette } from '../approx/palette.js';
import * as T from '../../lib/em/tline.js';
import { DEFAULTS, TABS, lineNow, parsePins, formatPins, zinAtLam } from './model.js';
import { smithTab } from './tab-smith.js';
import { wavesTab } from './tab-waves.js';
import { matchTab } from './tab-match.js';
import { pulseTab, resetPulse } from './tab-pulse.js';
import {
  withDefaults, openInNodes, typing, onCanvas, clamp, round,
} from '../em-common/util.js';

const TAB_IMPL = { smith: smithTab, waves: wavesTab, match: matchTab, pulse: pulseTab };

export default {
  id: 'em-tline',
  title: 'Transmission Lines & the Smith Chart',
  description: 'Reflection, standing waves, the Smith chart as a Moebius map, stub / quarter-wave / L-section matching and pulse propagation with bounce diagrams.',

  async mount(container, ctx) {
    const store = withDefaults(ctx.settings, DEFAULTS);
    const get = (k) => store.get(k);
    const set = (k, v) => store.set(k, v);
    const cleanups = [];
    let lineCache = null, lineKey = '';
    const st = { disposed: false, dirty: true, phase: 0, dAnim: get('dLam'), lastError: null, drawCount: 0, w: 800, h: 600 };
    let sweepWas = !!get('sweep');
    let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));

    const S = {
      p: null, pal, get, set, st,
      w: 800, h: 600, dt: 0.016,
      line() {
        const key = ['z0', 'zr', 'zx', 'f', 'vf', 'loss', 'lenM'].map((k) => get(k)).join('|');
        if (key !== lineKey || !lineCache) { lineCache = lineNow(get); lineKey = key; }
        return lineCache;
      },
      dNow() { return get('sweep') && get('tab') === 'smith' ? st.dAnim : clamp(Number(get('dLam')) || 0, 0, 1); },
    };

    let doResize = () => {};

    // ---------- actions ----------
    const setLoad = (r, x) => { set('zr', r); set('zx', x); };
    const solveStub = (i) => {
      const L = S.line();
      const sols = T.singleStub(L.zl, L.z0, get('mType') === 'open' ? 'open' : 'short');
      const s = sols[Math.min(i, sols.length - 1)];
      set('mMethod', 'stub');
      if (s) { set('stubD', round(s.dLambda, 6)); set('stubL', round(s.lLambda, 6)); }
    };
    const pinPoint = (z) => {
      const pins = parsePins(get('pins'));
      pins.push({ r: z[0], x: z[1] });
      set('pins', formatPins(pins.slice(-8)));
    };
    const resetAll = () => { for (const [k, v] of Object.entries(DEFAULTS)) set(k, v); st.dAnim = DEFAULTS.dLam; resetPulse(S); };
    const pulsePreset = (zs, pzl, extra = {}) => { set('zs', zs); set('pzl', pzl); for (const [k, v] of Object.entries(extra)) set(k, v); resetPulse(S); };

    // ---------- p5 sketch ----------
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
      const tab = () => TAB_IMPL[get('tab')] || smithTab;
      const inCanvas = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
      let active = false;
      const press = (x, y) => {
        const t = tab();
        active = !!(t.press && t.press(S, x, y));
        st.dirty = true;
        return active;
      };
      const move = (x, y) => {
        if (!active) return false;
        const t = tab();
        if (t.drag) t.drag(S, x, y);
        st.dirty = true;
        return true;
      };
      const release = () => {
        if (!active) return;
        active = false;
        const t = tab();
        if (t.release) t.release(S);
        st.dirty = true;
      };
      p.mousePressed = (e) => {
        if (!onCanvas(p, e) || !inCanvas(p.mouseX, p.mouseY)) return;
        if (p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return;
        press(p.mouseX, p.mouseY);
      };
      p.mouseDragged = () => { move(p.mouseX, p.mouseY); };
      p.mouseReleased = () => { release(); };
      const touch1 = () => { const t = p.touches || []; return t.length === 1 ? t[0] : null; };
      p.touchStarted = (e) => {
        if (!onCanvas(p, e)) return true;
        const t = touch1();
        return t && inCanvas(t.x, t.y) && press(t.x, t.y) ? false : true;
      };
      p.touchMoved = () => {
        const t = touch1();
        return t && move(t.x, t.y) ? false : true;
      };
      p.touchEnded = () => { const was = active; release(); return was ? false : true; };
      p.keyPressed = (e) => {
        if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
        const k = String(p.key);
        if (typing(k)) return true;
        if (k === 'p' || k === 'P') pinPoint(get('tab') === 'smith' ? zinAtLam(S.line(), S.dNow()) : S.line().zl);
        else if (k === 'x' || k === 'X') set('pins', '');
        else if (k === 'y' || k === 'Y') set('showY', !get('showY'));
        else return true;
        return false;
      };

      p.draw = () => {
        if (st.disposed) return;
        const dt = clamp((p.deltaTime || 16) / 1000, 0, 0.1);
        S.dt = dt; S.pal = pal;
        const tabId = get('tab');
        let animating = false;
        if (tabId === 'waves') { st.phase = (st.phase + dt * 2 * Math.PI * 0.4 * clamp(Number(get('wSpeed')) || 1, 0, 6)) % (2 * Math.PI * 1000); animating = true; }
        if (tabId === 'pulse') { try { pulseTab.update(S, dt); } catch (e) { st.lastError = e; } animating = true; }
        if (tabId === 'smith' && get('sweep')) {
          st.dAnim = (st.dAnim + dt * 0.06) % 1;
          animating = true;
        }
        if (!animating && !st.dirty) return;
        st.dirty = false;
        st.drawCount++;
        p.background(pal.bg);
        try {
          (TAB_IMPL[tabId] || smithTab).draw(S);
          p.noStroke(); p.fill(pal.muted); p.textSize(11); p.textAlign(p.LEFT, p.TOP);
          p.text(TABS.find((t) => t.value === tabId)?.label || '', 10, 8);
        } catch (err) {
          p.noStroke(); p.fill('#ff6b6b'); p.textAlign(p.LEFT, p.TOP);
          p.text(`error: ${err && err.message ? err.message : err}`, 12, 24);
          st.lastError = err;
        }
      };
      cleanups.push(ctx.globalSettings.subscribe(() => { pal = getPalette(ctx.globalSettings.get('theme', 'dark')); st.dirty = true; }));
    };

    const instance = new ctx.p5(sketch, container);
    cleanups.push(store.subscribe(() => {
      st.dirty = true;
      const sw = !!get('sweep');
      if (sw && !sweepWas) st.dAnim = clamp(Number(get('dLam')) || 0, 0, 1);
      if (!sw && sweepWas) set('dLam', round(st.dAnim, 4));
      sweepWas = sw;
    }));
    cleanups.push(ctx.onResize(() => doResize()));
    // the swept position is persisted at most every 400 ms
    const sweepWriter = setInterval(() => { if (get('sweep') && !st.disposed) set('dLam', round(st.dAnim, 3)); }, 400);
    if (sweepWriter && sweepWriter.unref) sweepWriter.unref();
    cleanups.push(() => clearInterval(sweepWriter));

    // ---------- UI ----------
    const on = (...tabs) => (s) => tabs.includes(s.get('tab'));
    const stubOn = (s) => s.get('tab') === 'match' && s.get('mMethod') === 'stub';
    const schema = [
      { type: 'tabs', key: 'tab', options: TABS },
      {
        type: 'group', label: 'Line & load', children: [
          { type: 'slider', key: 'z0', label: 'Z0 (Ω)', min: 10, max: 200, step: 1 },
          { type: 'slider', key: 'zr', label: 'load R (Ω)', min: 0, max: 500, step: 1 },
          { type: 'slider', key: 'zx', label: 'load X (Ω)', min: -500, max: 500, step: 1 },
          { type: 'slider', key: 'f', label: 'frequency (MHz)', min: 50, max: 1000, step: 5, visibleIf: on('waves', 'match') },
          { type: 'slider', key: 'vf', label: 'velocity factor', min: 0.3, max: 1, step: 0.01, visibleIf: on('waves', 'match', 'smith') },
          { type: 'slider', key: 'loss', label: 'line loss (dB/m)', min: 0, max: 3, step: 0.05, visibleIf: on('waves', 'smith') },
        ],
      },
      {
        type: 'group', label: 'Load presets', children: [
          { type: 'button', label: 'matched  Z0', onClick: () => setLoad(S.line().z0, 0) },
          { type: 'button', label: 'short circuit', onClick: () => setLoad(0, 0) },
          { type: 'button', label: 'open circuit (10 kΩ)', onClick: () => setLoad(10000, 0) },
          { type: 'button', label: 'inductive  2Z0 + j Z0', onClick: () => { const z0 = S.line().z0; setLoad(2 * z0, z0); } },
          { type: 'button', label: 'capacitive  0.5Z0 − j Z0', onClick: () => { const z0 = S.line().z0; setLoad(0.5 * z0, -z0); } },
          { type: 'button', label: 'pure reactance  j Z0', onClick: () => setLoad(0, S.line().z0) },
          { type: 'info', text: 'Short: Γ = −1 (left edge). Open: Γ = +1 (right edge). Pure reactance lies on the outer circle |Γ| = 1: no power is absorbed.' },
        ],
      },
      {
        type: 'group', label: 'Smith chart', visibleIf: on('smith'), children: [
          { type: 'slider', key: 'dLam', label: 'distance from load d (λ, toward generator)', min: 0, max: 1, step: 0.001, format: (v) => `${v.toFixed(3)} λ = ${(v * 360).toFixed(0)}°` },
          { type: 'toggle', key: 'sweep', label: 'sweep d (animate toward generator)' },
          { type: 'toggle', key: 'showY', label: 'admittance overlay (Y, orange)  (Y)' },
          { type: 'button', label: 'pin load (P)', onClick: () => pinPoint(S.line().zl) },
          { type: 'button', label: 'pin Zin(d)', onClick: () => pinPoint(zinAtLam(S.line(), S.dNow())) },
          { type: 'button', label: 'clear pins (X)', onClick: () => set('pins', '') },
        ],
      },
      {
        type: 'group', label: 'Standing waves', visibleIf: on('waves'), children: [
          { type: 'slider', key: 'lenM', label: 'line length (m)', min: 0.2, max: 4, step: 0.05 },
          { type: 'slider', key: 'wSpeed', label: 'animation speed', min: 0, max: 4, step: 0.1 },
          { type: 'toggle', key: 'wInc', label: 'incident wave' },
          { type: 'toggle', key: 'wRef', label: 'reflected wave' },
          { type: 'toggle', key: 'wTot', label: 'total voltage' },
          { type: 'toggle', key: 'wEnv', label: '±|V| envelope on the animation' },
        ],
      },
      {
        type: 'group', label: 'Matching', visibleIf: on('match'), children: [
          { type: 'select', key: 'mMethod', label: 'network', options: [{ value: 'stub', label: 'single shunt stub' }, { value: 'qw', label: 'quarter-wave transformer' }, { value: 'lmatch', label: 'L-section (lumped)' }] },
          { type: 'select', key: 'mType', label: 'stub termination', options: [{ value: 'short', label: 'short-circuited' }, { value: 'open', label: 'open-circuited' }], visibleIf: stubOn },
          { type: 'slider', key: 'stubD', label: 'stub position d (λ from load)', min: 0, max: 0.5, step: 0.001, visibleIf: stubOn },
          { type: 'slider', key: 'stubL', label: 'stub length l (λ)', min: 0, max: 0.5, step: 0.001, visibleIf: stubOn },
          { type: 'select', key: 'qwAt', label: 'insert at', options: [{ value: 'max', label: 'voltage maximum (Zin = Z0 S)' }, { value: 'min', label: 'voltage minimum (Zin = Z0 / S)' }], visibleIf: (s) => s.get('tab') === 'match' && s.get('mMethod') === 'qw' },
          { type: 'select', key: 'lSol', label: 'L-section solution', options: [{ value: 0, label: 'solution 1' }, { value: 1, label: 'solution 2' }], visibleIf: (s) => s.get('tab') === 'match' && s.get('mMethod') === 'lmatch' },
          { type: 'slider', key: 'rlThr', label: 'bandwidth criterion: RL ≥ (dB)', min: 6, max: 30, step: 1 },
          { type: 'button', label: 'auto: stub solution 1', onClick: () => solveStub(0) },
          { type: 'button', label: 'auto: stub solution 2', onClick: () => solveStub(1) },
          { type: 'button', label: 'auto: quarter-wave transformer', onClick: () => set('mMethod', 'qw') },
          { type: 'button', label: 'auto: L-match 1', onClick: () => { set('mMethod', 'lmatch'); set('lSol', 0); } },
          { type: 'button', label: 'auto: L-match 2', onClick: () => { set('mMethod', 'lmatch'); set('lSol', 1); } },
        ],
      },
      {
        type: 'group', label: 'Pulse', visibleIf: on('pulse'), children: [
          { type: 'slider', key: 'zs', label: 'source impedance Zs (Ω)', min: 0, max: 500, step: 1, },
          { type: 'slider', key: 'pzl', label: 'load ZL (Ω; presets set open = 1e9)', min: 0, max: 500, step: 1 },
          { type: 'select', key: 'pshape', label: 'source', options: [{ value: 'step', label: 'unit step' }, { value: 'pulse', label: 'rectangular pulse' }] },
          { type: 'slider', key: 'pwid', label: 'pulse width (T)', min: 0.1, max: 6, step: 0.1, visibleIf: (s) => s.get('tab') === 'pulse' && s.get('pshape') === 'pulse' },
          { type: 'slider', key: 'pspeed', label: 'speed', min: 0.1, max: 6, step: 0.1 },
          { type: 'toggle', key: 'ploop', label: 'repeat when the record is full' },
          { type: 'button', label: 'matched  (Zs = ZL = Z0)', onClick: () => pulsePreset(S.line().z0, S.line().z0) },
          { type: 'button', label: 'open load, matched source', onClick: () => pulsePreset(S.line().z0, 1e9) },
          { type: 'button', label: 'short load, matched source', onClick: () => pulsePreset(S.line().z0, 0) },
          { type: 'button', label: 'ringing: low Zs, open load', onClick: () => pulsePreset(5, 1e9) },
          { type: 'button', label: 'stair-case: high Zs, open load', onClick: () => pulsePreset(200, 1e9) },
          { type: 'button', label: 'restart', onClick: () => resetPulse(S) },
        ],
      },
      {
        type: 'group', label: 'Theory', collapsed: true, children: [
          { type: 'info', text: 'Reflection: ΓL = (ZL − Z0)/(ZL + Z0); along the line Γ(d) = ΓL e^{−2γd} with γ = α + jβ, β = 2π/λ. Zin(d) = Z0 (ZL + Z0 tanh γd)/(Z0 + ZL tanh γd). VSWR = (1+|Γ|)/(1−|Γ|), RL = −20 log|Γ|, mismatch loss = −10 log(1−|Γ|²).' },
          { type: 'info', text: 'The Smith chart is the Moebius map w = (z − 1)/(z + 1) of the normalised impedance plane (lib/conformal.js applyMoebius): lines Re z = r and Im z = x become circles, so moving a distance d toward the generator is a clockwise rotation by 4πd/λ about the centre. Admittance is the same chart rotated by half a turn (Γ → −Γ).' },
          { type: 'info', text: 'Single stub: choose d where Re y(d) = 1 (two solutions from a quadratic in tan βd), then add a stub of susceptance −b: short stub b = −cot βl, open stub b = tan βl. Quarter-wave: Zt = √(Z0 Rin) at a point where Zin is real. In the time domain waves launched with V1 = Vs Z0/(Z0+Zs) bounce between Γs and ΓL.' },
        ],
      },
      {
        type: 'group', label: 'Try this', collapsed: true, children: [
          { type: 'info', text: '1. Smith: drag the red ZL onto the outer circle (reactive load) and sweep d: Γ never shrinks, the VSWR is infinite. Add loss and watch it spiral in.' },
          { type: 'info', text: '2. Standing waves: set ZL = 100 Ω. The maxima sit at the load and every λ/2; the first minimum is λ/4 away. Raise X and see the pattern slide.' },
          { type: 'info', text: '3. Matching: press “auto: stub solution 1” for ZL = 100 + j50, then solution 2. Compare the bandwidths: the shorter d / l solution is wider.' },
          { type: 'info', text: '4. Pulse: low Zs with an open load rings; high Zs with an open load climbs in stairs. Watch the energy residual stay at rounding level.' },
        ],
      },
      {
        type: 'group', label: 'Open in...', children: openInNodes([
          ['conformal map: the Smith chart as a Moebius map', 'conformal', {}],
          ['2D FDTD waves: reflection at an interface', 'em-fdtd', {}],
          ['antenna arrays: the load being matched', 'em-antenna', {}],
          ['Nyquist / Bode: another conformal chart', 'ct-freq', {}],
        ]),
      },
      { type: 'button', label: 'Reset unit', onClick: resetAll },
    ];
    const panelUi = ctx.ui.build(schema, store, ctx.drawer);

    return {
      /** Introspection for tests. */
      debug() {
        const L = S.line();
        return {
          tab: get('tab'), line: L, d: S.dNow(), lastError: st.lastError, drawCount: st.drawCount,
          smith: st.smith, waves: st.waves, match: st.match, pulse: st.pulse, pulseInfo: st.pulseInfo, view: st.view,
          schema,
        };
      },
      /** Runs the pulse simulation forward (tests). */
      advancePulse(td) { return pulseTab.advance(S, td); },
      unmount() {
        if (st.disposed) return;
        st.disposed = true;
        for (const c of cleanups.splice(0)) { try { c(); } catch { /* ignore */ } }
        try { panelUi.destroy(); } catch { /* ignore */ }
        try { instance.remove(); } catch { /* ignore */ }
      },
    };
  },
};
