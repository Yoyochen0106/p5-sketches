// PDEs by Fourier Series: Heat, Wave & Laplace  (course unit ma-pde, course "engmath").
//
// Public settings (deep-link keys), all scalar / string, mirrored into the URL hash:
//   tab        heat | wave | laplace | plate          play (bool), speed        shared playback
//   tool       raise|lower|smooth|flatten|line        radius (%), soft, strength brush
//   h.bc       dirichlet|neumann|mixed|periodic|fixed h.preset step|triangle|gaussian|sawtooth|random|''
//   h.alpha    diffusivity                            h.T      time span in slowest e-fold times
//   h.terms    series terms                           h.Tl, h.Tr  end temperatures (bc = fixed)
//   h.fd       off|ftcs|be|cn   h.fdN grid cells      h.r      r = alpha dt / dx^2   h.t  seek (0..1)
//   w.bc       fixed|free|fixedfree|infinite          w.preset pluck|strike|bow|pulse|mode3|''
//   w.c        wave speed       w.x0 pluck position   w.method dalembert|modes|both  w.terms
//   w.gamma    damping          w.disp none|beam      w.T      span in periods      w.t  seek
//   l.preset   bump|quad|ramp|step|spot|random|''     l.aspect b/a    l.terms   l.show series|relax|diff
//   l.contours l.walk (bool)    l.walkers  l.px, l.py probe point (fractions)
//   p.preset   spot|bar|hole|gradient|mode|''         p.edge cold|insulated   p.method adi|explicit
//   p.alpha    p.r   p.aspect (b/a)   p.mode off|heat|vib   p.m, p.n   chosen product mode
//
// Pure numerics live in lib/pde.js; this folder is UI and drawing only.

import { getPalette } from '../approx/palette.js';
import { DEFAULTS, TOOLS, PLATE_TOOLS, TABS, HEAT_BCS, HEAT_PRESETS, WAVE_BCS, WAVE_PRESETS, LAPLACE_PRESETS, PLATE_PRESETS, ASPECTS } from './state.js';
import { ImageCache, clamp } from './draw.js';
import { HeatPanel } from './heat.js';
import { WavePanel } from './wave.js';
import { LaplacePanel } from './laplace.js';
import { PlatePanel } from './plate.js';
import { createAudio } from './audio.js';
import { openIn } from './links.js';

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

const is = (tab) => (s) => s.get('tab') === tab;
const opts = (list) => list.map((v) => ({ value: v, label: String(v) }));

const THEORY = {
    heat: 'Heat equation u_t = alpha u_xx. Separation of variables u = X(x) T(t) gives X\'\' = -lambda X and T\' = -alpha lambda T; the boundary conditions pick the eigenfunctions (sin for Dirichlet, cos for Neumann, sin((n-1/2) pi x/L) for mixed, a Fourier basis for periodic). '
        + 'So u = sum c_n exp(-alpha k_n^2 t) phi_n(x), where c_n is the projection of the initial profile on phi_n. Mode n dies n^2 times faster than mode 1: profiles smooth out and approach the steady state (the mean for insulated ends, the straight line between the end temperatures for fixed ends, zero for Dirichlet). '
        + 'The explicit FTCS scheme is stable only for r = alpha dt/dx^2 <= 1/2; backward Euler and Crank-Nicolson are unconditionally stable.',
    wave: 'Wave equation u_tt = c^2 u_xx. d\'Alembert: u = F(x - ct) + G(x + ct), two half-waves of the initial data that travel apart; a fixed end reflects with a sign flip and a free end without one (method of images: extend the data oddly / evenly). '
        + 'The same motion is a sum of normal modes u = sum (A_n cos w_n t + B_n/w_n sin w_n t) phi_n(x) with w_n = n pi c/L, so a string is harmonic. A plucked string has A_n ~ 1/n^2, a bowed one ~ 1/n. '
        + 'Damping makes the modes decay; a beam-like dispersion w ~ k^2 destroys the travelling-wave picture (d\'Alembert no longer holds).',
    laplace: 'Laplace equation u_xx + u_yy = 0 on a rectangle with u prescribed on the boundary. Superposing four problems, each solved by separation of variables, gives u = sum sin(n pi x/a) [A_n sinh(n pi (b-y)/a) + B_n sinh(n pi y/a)] / sinh(n pi b/a) (plus the same with x and y exchanged). '
        + 'Each term is harmonic, so u has no interior maximum or minimum (maximum principle: red and blue markers sit on the boundary). The relaxation solver averages the four neighbours until nothing changes; a random walker started at P exits at a boundary point, and the average boundary value over many walkers converges to u(P) (harmonic measure).',
    plate: 'Heat on a plate T_t = alpha (T_xx + T_yy) + q. For a rectangle with T = 0 edges the modes are sin(m pi x/a) sin(n pi y/b) with eigenvalue lambda = pi^2 (m^2/a^2 + n^2/b^2), decaying as exp(-alpha lambda t); for insulated edges use cosines. '
        + 'Sources q, fixed-temperature regions and insulated holes break the product structure, so the mode grid fills in. ADI splits each step into two tridiagonal solves (unconditionally stable); the explicit scheme needs r = alpha dt (1/dx^2 + 1/dy^2) <= 1/2. '
        + 'The same shapes vibrate with cos(omega t), omega = c sqrt(lambda), which is exactly the Chladni sketch: same modes, different time law.',
};

const TRY = {
    heat: 'Try this:\n1. Dirichlet + step: set terms to 5, then 80, at t = 0 and watch the Gibbs overshoot (about 9% of the jump) next to each discontinuity; it vanishes as soon as t > 0.\n'
        + '2. Switch to Neumann: the heat content stays constant and u tends to the mean. Fixed ends with T0 != T1 relax to a straight line.\n'
        + '3. Enable FTCS and raise r above 0.5: the error blows up; Crank-Nicolson stays accurate even at r = 2.\n'
        + '4. Draw a thin spike and watch the right-hand bars (high modes) vanish first.',
    wave: 'Try this:\n1. Fixed ends + pulse: follow the two half-waves, and watch the reflected one flip sign; switch to free ends and it keeps its sign.\n'
        + '2. Pluck at x0 = 1/2: only odd harmonics, and the green 1/n^2 line passes through the bars; move x0 and the missing harmonic moves with it.\n'
        + '3. Turn on beam dispersion: the pulse spreads into ripples, omega_n = n^2 omega_1 is no longer harmonic (listen with Play tone).\n'
        + '4. Add damping and watch high modes die first.',
    laplace: 'Try this:\n1. Draw a hot bump on the top edge only; compare the equipotentials with the sinh solution and note u is largest next to the hot edge.\n'
        + '2. Use the step preset with 5 and 60 terms: the series rings at the corner, relaxation does not.\n'
        + '3. Click inside the rectangle, switch on random walkers and watch the estimate converge like 1/sqrt(N).\n'
        + '4. Look for an interior maximum: there is none, the red and blue markers are always on the boundary.',
    plate: 'Try this:\n1. Start with the hot spot (cold edge): the mode grid shows the spot as a sum of products; high modes die first.\n'
        + '2. Paint a source and an insulated hole; the product structure breaks and many modes are excited.\n'
        + '3. Use explicit with r = 0.6 and see it blow up; ADI stays stable even at r = 4.\n'
        + '4. Choose mode (2, 1) and flip between heat and vibration: same nodal lines, but decay versus oscillation.',
};

function buildSchema(A, ac) {
    const heat = is('heat'), wave = is('wave'), lap = is('laplace'), plate = is('plate');
    const both = (a, b) => (s) => a(s) || b(s);
    return [
        {
            type: 'group', label: 'Playback', children: [
                { type: 'toggle', key: 'play', label: 'play animation (Space)' },
                { type: 'slider', key: 'speed', label: 'animation speed', min: 0.1, max: 4, step: 0.1 },
                { type: 'button', label: 'Restart', onClick: () => A.restart() },
            ],
        },
        {
            type: 'group', label: 'Heat equation', visibleIf: heat, children: [
                { type: 'select', key: 'h.bc', label: 'boundary conditions', options: HEAT_BCS },
                { type: 'select', key: 'h.preset', label: 'initial profile', options: HEAT_PRESETS },
                { type: 'button', label: 'New random profile', onClick: () => ac.heat.actions().randomize() },
                { type: 'slider', key: 'h.alpha', label: 'diffusivity alpha (L = 1)', min: 0.005, max: 0.5, step: 0.005 },
                { type: 'slider', key: 'h.T', label: 'time span (slowest e-fold times)', min: 0.2, max: 5, step: 0.1 },
                { type: 'slider', key: 'h.t', label: 'seek time (fraction of span)', min: 0, max: 1, step: 0.005 },
                { type: 'slider', key: 'h.terms', label: 'number of terms (Gibbs at t = 0)', min: 1, max: 100, step: 1 },
                { type: 'slider', key: 'h.Tl', label: 'T0 = u(0)', min: -1, max: 2, step: 0.05, visibleIf: (s) => heat(s) && s.get('h.bc') === 'fixed' },
                { type: 'slider', key: 'h.Tr', label: 'T1 = u(L)', min: -1, max: 2, step: 0.05, visibleIf: (s) => heat(s) && s.get('h.bc') === 'fixed' },
            ],
        },
        {
            type: 'group', label: 'Finite differences', visibleIf: heat, children: [
                { type: 'select', key: 'h.fd', label: 'scheme', options: [{ value: 'off', label: 'off' }, { value: 'ftcs', label: 'explicit FTCS' }, { value: 'be', label: 'implicit backward Euler' }, { value: 'cn', label: 'Crank-Nicolson' }] },
                { type: 'select', key: 'h.fdN', label: 'grid cells N', options: [16, 32, 64, 128].map((v) => ({ value: v, label: String(v) })) },
                { type: 'slider', key: 'h.r', label: 'r = alpha dt / dx^2   (FTCS stable only for r <= 0.5)', min: 0.05, max: 2, step: 0.05 },
            ],
        },
        {
            type: 'group', label: 'Wave equation', visibleIf: wave, children: [
                { type: 'select', key: 'w.bc', label: 'ends', options: WAVE_BCS },
                { type: 'select', key: 'w.preset', label: 'initial motion', options: WAVE_PRESETS },
                { type: 'slider', key: 'w.x0', label: 'pluck / strike position (x0 / L)', min: 0.05, max: 0.95, step: 0.01 },
                { type: 'slider', key: 'w.c', label: 'wave speed c', min: 0.2, max: 3, step: 0.05 },
                { type: 'select', key: 'w.method', label: 'solution shown', options: [{ value: 'both', label: 'd\'Alembert and mode sum' }, { value: 'dalembert', label: 'd\'Alembert (travelling waves)' }, { value: 'modes', label: 'normal-mode series' }] },
                { type: 'slider', key: 'w.terms', label: 'number of modes', min: 1, max: 100, step: 1 },
                { type: 'slider', key: 'w.gamma', label: 'damping gamma (u_tt + 2 gamma u_t)', min: 0, max: 2, step: 0.05 },
                { type: 'select', key: 'w.disp', label: 'dispersion', options: [{ value: 'none', label: 'none  omega = c k' }, { value: 'beam', label: 'beam-like  omega ~ k^2' }] },
                { type: 'slider', key: 'w.T', label: 'time span (periods)', min: 0.5, max: 6, step: 0.5 },
                { type: 'slider', key: 'w.t', label: 'seek time (fraction of span)', min: 0, max: 1, step: 0.005 },
            ],
        },
        {
            type: 'group', label: 'Sound (opt-in)', visibleIf: wave, children: [
                { type: 'slider', key: 'w.f0', label: 'fundamental (Hz)', min: 80, max: 880, step: 1 },
                { type: 'button', label: 'Play tone (starts audio)', onClick: () => ac.wave.actions().sound() },
            ],
        },
        {
            type: 'group', label: 'Laplace equation', visibleIf: lap, children: [
                { type: 'select', key: 'l.preset', label: 'boundary data', options: LAPLACE_PRESETS },
                { type: 'button', label: 'New random data', onClick: () => ac.laplace.actions().randomize() },
                { type: 'select', key: 'l.aspect', label: 'rectangle b / a', options: ASPECTS.map((v) => ({ value: v, label: String(v) })) },
                { type: 'slider', key: 'l.terms', label: 'series terms per side', min: 1, max: 60, step: 1 },
                { type: 'select', key: 'l.show', label: 'colour map shows', options: [{ value: 'series', label: 'series solution' }, { value: 'relax', label: 'relaxation (SOR)' }, { value: 'diff', label: '|series - relaxation|' }] },
                { type: 'slider', key: 'l.contours', label: 'equipotential lines', min: 0, max: 30, step: 1 },
                { type: 'toggle', key: 'l.walk', label: 'random walkers (click inside to move P)' },
                { type: 'slider', key: 'l.walkers', label: 'number of walkers', min: 100, max: 20000, step: 100, visibleIf: (s) => lap(s) && !!s.get('l.walk') },
                { type: 'button', label: 'Reseed walkers', onClick: () => ac.laplace.actions().reseed(), visibleIf: (s) => lap(s) && !!s.get('l.walk') },
            ],
        },
        {
            type: 'group', label: 'Plate 2D', visibleIf: plate, children: [
                { type: 'select', key: 'p.preset', label: 'initial plate', options: PLATE_PRESETS },
                { type: 'select', key: 'p.method', label: 'solver', options: [{ value: 'adi', label: 'ADI (Peaceman-Rachford)' }, { value: 'explicit', label: 'explicit FTCS' }] },
                { type: 'select', key: 'p.edge', label: 'outer edge', options: [{ value: 'cold', label: 'held at T = 0' }, { value: 'insulated', label: 'insulated' }] },
                { type: 'slider', key: 'p.alpha', label: 'diffusivity alpha', min: 0.05, max: 1, step: 0.05 },
                { type: 'slider', key: 'p.r', label: 'r = alpha dt (1/dx^2 + 1/dy^2)  (explicit stable for r <= 0.5)', min: 0.05, max: 6, step: 0.05 },
                { type: 'slider', key: 'p.speed', label: 'solver steps per frame', min: 1, max: 20, step: 1 },
                { type: 'select', key: 'p.aspect', label: 'plate b / a (resets plate)', options: [0.5, 0.75, 1, 1.5].map((v) => ({ value: v, label: String(v) })) },
                { type: 'slider', key: 'pradius', label: 'paint radius (cells)', min: 1, max: 10, step: 0.5 },
                { type: 'slider', key: 'p.T', label: 'fixed temperature (Fixed T tool)', min: -1, max: 2, step: 0.1 },
                { type: 'slider', key: 'p.q', label: 'source strength q', min: 0.5, max: 20, step: 0.5 },
                { type: 'button', label: 'Cool down (T = 0, keep layout)', onClick: () => ac.plate.actions().coolDown() },
            ],
        },
        {
            type: 'group', label: 'Single mode: heat or vibration', visibleIf: plate, children: [
                { type: 'select', key: 'p.mode', label: 'animate one product mode', options: [{ value: 'off', label: 'off (simulate the plate)' }, { value: 'heat', label: 'heat: exp(-alpha lambda t)' }, { value: 'vib', label: 'vibration: cos(omega t)' }] },
                { type: 'slider', key: 'p.m', label: 'mode m (or click the grid)', min: 0, max: 8, step: 1 },
                { type: 'slider', key: 'p.n', label: 'mode n', min: 0, max: 8, step: 1 },
            ],
        },
        {
            type: 'group', label: 'Brush', visibleIf: (s) => !plate(s), children: [
                { type: 'slider', key: 'radius', label: 'radius (% of length)', min: 0.5, max: 30, step: 0.5 },
                { type: 'slider', key: 'soft', label: 'softness', min: 0, max: 1, step: 0.05 },
                { type: 'slider', key: 'strength', label: 'strength', min: 0.05, max: 2, step: 0.05 },
            ],
        },
        {
            type: 'group', label: 'Edit', children: [
                { type: 'button', label: 'Undo (Z)', onClick: () => A.undo() },
                { type: 'button', label: 'Redo (Shift+Z)', onClick: () => A.redo() },
                { type: 'button', label: 'Clear (C)', onClick: () => A.clear() },
                { type: 'button', label: 'Reset this tab', onClick: () => A.resetTab() },
            ],
        },
        {
            type: 'group', label: 'Theory', children: Object.keys(THEORY).map((t) => ({ type: 'info', text: THEORY[t], visibleIf: is(t) })),
        },
        {
            type: 'group', label: 'Try this', children: Object.keys(TRY).map((t) => ({ type: 'info', text: TRY[t], visibleIf: is(t) })),
        },
        {
            type: 'group', label: 'Open in...', children: [
                { type: 'button', label: 'Open in Approximation: Fourier series', visibleIf: both(heat, wave), onClick: () => A.link('approx') },
                { type: 'button', label: 'Open in Fourier painter 2D', visibleIf: both(heat, plate), onClick: () => A.link('fourier2d') },
                { type: 'button', label: 'Open in Chladni plates (same modes)', visibleIf: both(wave, plate), onClick: () => A.link('chladni') },
                { type: 'button', label: 'Open in 2D FDTD waves', visibleIf: both(wave, lap), onClick: () => A.link('em-fdtd') },
                { type: 'button', label: 'Open in Complex integration & residues', visibleIf: lap, onClick: () => A.link('ma-residue') },
                { type: 'button', label: 'Open in Vector calculus', visibleIf: both(lap, both(heat, plate)), onClick: () => A.link('ma-vector') },
            ],
        },
    ];
}

export default {
    id: 'ma-pde',
    title: 'PDEs by Fourier Series: Heat, Wave & Laplace',
    description: 'Draw initial data and boundary values, then compare eigenfunction series with d\'Alembert, finite differences and relaxation for the heat, wave and Laplace equations and a paintable 2D plate.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const cleanups = [];
        const images = new ImageCache();
        const audio = createAudio();
        const st = { disposed: false, p: null, layout: null, lastTab: null, pressed: false };

        const env = {
            p: null, pal: getPalette(ctx.globalSettings.get('theme', 'dark')), images, audio,
            get, set: (k, v) => store.set(k, v),
            mouseDown: () => !!(st.p && st.p.mouseIsPressed),
        };
        const panels = {
            heat: new HeatPanel(env), wave: new WavePanel(env), laplace: new LaplacePanel(env), plate: new PlatePanel(env),
        };
        const cur = () => panels[get('tab')] || panels.heat;
        const ac = panels; // alias for the schema (actions live on panels)
        const act = (name) => { const a = cur().actions(); if (a && a[name]) a[name](); };

        const A = {
            undo: () => act('undo'),
            redo: () => act('redo'),
            clear: () => act('clear'),
            restart: () => { const a = cur().actions(); if (a.restart) a.restart(); },
            resetTab: () => {
                const tab = get('tab');
                const prefix = { heat: 'h.', wave: 'w.', laplace: 'l.', plate: 'p.' }[tab];
                for (const k of Object.keys(DEFAULTS)) if (k.startsWith(prefix)) store.set(k, DEFAULTS[k]);
                for (const k of ['play', 'speed', 'tool', 'radius', 'soft', 'strength', 'ptool', 'pradius']) store.set(k, DEFAULTS[k]);
                const pn = cur();
                pn.lastPreset = null;
                if (pn.t !== undefined) pn.t = 0;
                if (tab === 'plate') pn.key = '';
                images.clear();
            },
            link(id) {
                const tab = get('tab');
                const pl = panels.plate;
                const params = {
                    approx: { 'fourier.on': true, 'taylor.on': false, 'fourier.N': Math.round(Number(tab === 'wave' ? get('w.terms') : get('h.terms')) / 4) || 8 },
                    fourier2d: { mode: 'image' },
                    chladni: tab === 'plate'
                        ? { shape: 'rect', kind: 'simply', dispersion: 'membrane', aspect: Math.round(100 / (Number(get('p.aspect')) || 0.75)) / 100, 's0.m': Math.max(1, Number(get('p.m')) || 1), 's0.n': Math.max(1, Number(get('p.n')) || 1) }
                        : { shape: 'rect', kind: 'simply', dispersion: 'membrane', 's0.m': 3, 's0.n': 1 },
                    'em-fdtd': {},
                    'ma-residue': {},
                    'ma-vector': {},
                }[id] || {};
                void pl;
                return openIn(id, params);
            },
        };

        // ---------- sketch ----------
        const sketch = (p) => {
            st.p = p;
            env.p = p;
            const sizeNow = () => { const s = ctx.size(); return { w: Math.max(240, s.width), h: Math.max(240, s.height) }; };
            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
            const isRight = () => {
                const b = p.mouseButton;
                return b === p.RIGHT || b === 'right' || !!(b && typeof b === 'object' && b.right);
            };
            const isMiddle = () => {
                const b = p.mouseButton;
                return b === p.CENTER || b === 'center' || !!(b && typeof b === 'object' && b.center);
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
            };

            const area = () => ({ x: 6, y: 6, w: p.width - 12, h: p.height - 12 });

            function pressStart(e) {
                if (!onCanvas(e)) return false;
                if (isMiddle()) return false;
                st.pressed = cur().press(p.mouseX, p.mouseY, { right: isRight(), shift: !!(e && e.shiftKey) });
                return st.pressed;
            }
            function pressDrag() { if (st.pressed) cur().drag(p.mouseX, p.mouseY); else if (cur().hoverAt) cur().hoverAt(p.mouseX, p.mouseY); }
            function pressEnd() { const had = st.pressed; st.pressed = false; cur().release(); return had; }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.mouseMoved = (e) => { if (onCanvas(e) && cur().hoverAt) cur().hoverAt(p.mouseX, p.mouseY); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.pressed; };
            p.touchEnded = () => !pressEnd();

            // ---------- keyboard ----------
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
                const tools = { r: 'raise', l: 'lower', s: 'smooth', f: 'flatten', p: 'line' };
                const lk = typeof k === 'string' ? k.toLowerCase() : k;
                const tabs = { 1: 'heat', 2: 'wave', 3: 'laplace', 4: 'plate' };
                if (tabs[k]) store.set('tab', tabs[k]);
                else if (k === ' ') store.set('play', !get('play'));
                else if (tools[lk] && k !== 'S' && k !== 'F' && get('tab') !== 'plate') store.set('tool', tools[lk]);
                else if (k === 'z') A.undo();
                else if (k === 'Z') A.redo();
                else if (lk === 'c') A.clear();
                else return true;
                return false;
            };

            st.resize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
            };

            p.draw = () => {
                if (st.disposed) return;
                const tab = get('tab');
                if (tab !== st.lastTab) {
                    if (st.lastTab && panels[st.lastTab]) panels[st.lastTab].release();
                    st.pressed = false;
                    st.lastTab = tab;
                }
                const pn = cur();
                const dt = clamp((p.deltaTime || 16.7) / 1000, 0, 0.05);
                pn.sync();
                pn.update(dt);
                p.background(env.pal.bg);
                pn.draw(area());
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                env.pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                images.clear();
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(ctx.onResize(() => st.resize && st.resize()));

        const toolbar = ctx.ui.build([
            { type: 'tabs', key: 'tab', options: TABS },
            { type: 'tabs', key: 'tool', options: TOOLS, visibleIf: (s) => s.get('tab') !== 'plate' },
            { type: 'tabs', key: 'ptool', options: PLATE_TOOLS, visibleIf: is('plate') },
        ], store, ctx.toolbar);
        const drawer = ctx.ui.build(buildSchema(A, ac), store, ctx.drawer);

        return {
            /** Exposed for tests and debugging. */
            panels, env, audio, actions: A,
            unmount() {
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { audio.dispose(); } catch { /* ignore */ }
                try { toolbar.destroy(); } catch { /* ignore */ }
                try { drawer.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
            },
        };
    },
};
