// Function Approximation Lab: Taylor / Pade / Fourier / wavelet approximations of a
// function, shown on a real panel and a complex panel (domain colouring).

import { FUNCTIONS, getFunction } from '../../lib/functions.js';
import { CONTINUOUS } from '../../lib/wavelets/cwt.js';
import { Viewport } from './view.js';
import { getPalette } from './palette.js';
import { DEFAULTS, AUDIO_TRACKS } from './state.js';
import { NODE_FAMILIES } from '../../lib/interp.js';
import { WINDOWS } from '../../lib/fourier-windows.js';
import { createAudioEngine, listenWindow, MIN_FREQ, MAX_FREQ } from './audio.js';
import { METHODS, METHOD_BY_ID, INTERP_MAX_N, waveletFamilyOptions } from './methods.js';
import { drawRealPanel, splitReal, gibbsGaugeRect, gaugeValue } from './real.js';
import { drawComplexPanel, COMPLEX_SOURCES, resetSlots } from './complex.js';
import { makeCustom, estimateRadius } from './custom.js';

const GAP = 8;
const MODES = [
    { value: 'real', label: 'Real' },
    { value: 'split', label: 'Split' },
    { value: 'complex', label: 'Complex' },
];

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

async function loadExpressionParser() {
    try {
        const m = await import('../../lib/expr.js');
        return m.parseExpression || null;
    } catch {
        return null;
    }
}

function buildSchema(parseExpression, audio) {
    const funcOptions = FUNCTIONS.map((f) => ({ value: f.id, label: f.label }));
    if (parseExpression) funcOptions.push({ value: 'custom', label: 'custom expression…' });
    const sourceOptions = COMPLEX_SOURCES.map((s) => ({ value: s.value, label: s.label }));
    const on = (id) => (s) => !!s.get(`${id}.on`);
    return [
        {
            type: 'group', label: 'Function', children: [
                { type: 'select', key: 'func', label: 'f', options: funcOptions },
                {
                    type: 'text', key: 'expr', label: 'expression', placeholder: 'sin(x)/(1+x^2)',
                    visibleIf: (s) => s.get('func') === 'custom',
                    validate: (v) => {
                        try {
                            parseExpression(v);
                            return null;
                        } catch (e) {
                            return String(e.message || e);
                        }
                    },
                },
            ],
        },
        {
            type: 'group', label: 'Taylor series', enabledKey: 'taylor.on', children: [
                { type: 'slider', key: 'taylor.order', label: 'order n', min: 0, max: 40, step: 1 },
                { type: 'toggle', key: 'taylor.ghosts', label: 'show lower orders' },
                { type: 'toggle', key: 'taylor.animate', label: 'animate growth' },
            ],
        },
        {
            type: 'group', label: 'Padé approximant', enabledKey: 'pade.on', children: [
                { type: 'slider', key: 'pade.L', label: 'numerator L', min: 0, max: 20, step: 1 },
                { type: 'slider', key: 'pade.M', label: 'denominator M', min: 0, max: 20, step: 1 },
            ],
        },
        {
            type: 'group', label: 'Fourier series', enabledKey: 'fourier.on', children: [
                { type: 'slider', key: 'fourier.N', label: 'harmonics N', min: 0, max: 128, step: 1 },
                {
                    type: 'slider', key: 'fourier.period', label: 'period (0 = auto)', min: 0, max: 20, step: 0.05,
                    format: (v) => (v > 0 ? v.toFixed(2) : 'auto'),
                },
                {
                    type: 'select', key: 'fourier.window', label: 'summation window (Gibbs)',
                    options: WINDOWS.map((w) => ({ value: w.id, label: w.label })),
                },
                { type: 'toggle', key: 'fourier.gibbs', label: 'overshoot read-out + N gauge (square / saw / step)' },
            ],
        },
        {
            type: 'group', label: 'Polynomial interpolation', enabledKey: 'interp.on', children: [
                { type: 'slider', key: 'interp.n', label: 'degree n', min: 0, max: INTERP_MAX_N, step: 1 },
                {
                    type: 'select', key: 'interp.family', label: 'nodes',
                    options: NODE_FAMILIES.map((f) => ({ value: f.id, label: f.label })),
                },
                {
                    type: 'select', key: 'interp.window', label: 'window',
                    options: [{ value: 'view', label: 'visible x range' }, { value: 'center', label: 'a ± W' }],
                },
                {
                    type: 'slider', key: 'interp.W', label: 'half-width W', min: 0.1, max: 10, step: 0.1,
                    visibleIf: (s) => s.get('interp.window') === 'center',
                },
                { type: 'toggle', key: 'interp.compare', label: 'compare with Chebyshev (dashed)' },
            ],
        },
        {
            type: 'group', label: 'Wavelets', enabledKey: 'wavelet.on', children: [
                { type: 'select', key: 'wavelet.family', label: 'family', options: waveletFamilyOptions() },
                { type: 'slider', key: 'wavelet.level', label: 'levels J', min: 1, max: 10, step: 1 },
                { type: 'slider', key: 'wavelet.keepPct', label: 'keep % of coefficients', min: 1, max: 100, step: 1 },
                {
                    type: 'select', key: 'wavelet.samples', label: 'samples',
                    options: [256, 512, 1024, 2048, 4096].map((n) => ({ value: n, label: String(n) })),
                },
                { type: 'toggle', key: 'wavelet.mother', label: 'show φ / ψ inset' },
            ],
        },
        {
            type: 'group', label: 'Complex panel', children: [
                { type: 'select', key: 'cplx.source', label: 'shows', options: sourceOptions },
                {
                    type: 'select', key: 'cplx.cwt', label: 'continuous wavelet',
                    options: CONTINUOUS.map((w) => ({ value: w.id, label: w.name || w.id })),
                    visibleIf: (s) => s.get('cplx.source') === 'scalogram',
                },
                {
                    type: 'select', key: 'block', label: 'resolution',
                    options: [1, 2, 3, 4, 6].map((n) => ({ value: n, label: n === 1 ? 'full' : `1/${n}` })),
                },
                { type: 'toggle', key: 'cplx.inset', label: 'f(z) inset' },
                { type: 'toggle', key: 'cplx.overlay', label: 'poles, circle, axes' },
            ],
        },
        {
            type: 'group', label: 'Listen', collapsed: true, children: [
                {
                    type: 'info', text: 'Web Audio is not available (or was blocked) in this browser, so there is no sound.',
                    visibleIf: () => !audio.available,
                },
                { type: 'toggle', key: 'audio.playing', label: 'play / stop (P)' },
                {
                    type: 'slider', key: 'audio.freq', label: 'fundamental', min: MIN_FREQ, max: MAX_FREQ, step: 1,
                    format: (v) => `${Math.round(v)} Hz`,
                },
                { type: 'slider', key: 'audio.volume', label: 'volume', min: 0, max: 1, step: 0.01 },
                { type: 'toggle', key: 'audio.original', label: 'include the original f' },
                ...AUDIO_TRACKS.flatMap((id) => {
                    const name = id === 'original' ? 'f' : METHOD_BY_ID[id].name;
                    const vis = (s) => !!s.get(id === 'original' ? 'audio.original' : `${id}.on`);
                    return [
                        { type: 'toggle', key: `audio.mute.${id}`, label: `mute ${name}`, visibleIf: vis },
                        { type: 'toggle', key: `audio.solo.${id}`, label: `solo ${name}`, visibleIf: vis },
                    ];
                }),
                {
                    type: 'info',
                    text: 'One period of every enabled approximation loops as a waveform (peak-normalised, DC removed). '
                        + 'The period is the Fourier period if Fourier is on, else the function period; for a non-periodic '
                        + 'function it is the visible x range (the loop point may click).',
                },
            ],
        },
        {
            type: 'group', label: 'Display', children: [
                { type: 'toggle', key: 'showGrid', label: 'grid' },
                { type: 'toggle', key: 'showError', label: 'error strip' },
                { type: 'toggle', key: 'showRadius', label: 'convergence band' },
                { type: 'toggle', key: 'lockOn', label: 'lock expansion point (L)' },
            ],
        },
        {
            type: 'info',
            text: 'Hover: move expansion point a · click: lock/unlock · drag: pan · wheel: zoom (shift = y, alt = x) · '
                + '↑↓ / W S: Taylor order · 1 2 3: panels · space: animate · F: fit · M: next complex view · '
                + 'P: play / stop sound · drag the N gauge (square / saw / step with Fourier on) to watch the Gibbs overshoot · '
                + 'interpolation: try 1/(1+25x²) with equispaced vs Chebyshev nodes (Runge phenomenon)',
        },
    ];
}

function resolveFunction(store, parseExpression) {
    const id = store.get('func');
    if (id === 'custom' && parseExpression) {
        try {
            return makeCustom(parseExpression(store.get('expr')), store.get('expr'));
        } catch {
            return null;
        }
    }
    return getFunction(id) || FUNCTIONS[0];
}

export default {
    id: 'approx',
    title: 'Function Approximation Lab',
    description: 'Taylor, Padé, Fourier and wavelet approximations on the real line and in the complex plane.',

    async mount(container, ctx) {
        const parseExpression = await loadExpressionParser();
        const store = withDefaults(ctx.settings);
        const cleanups = [];
        resetSlots();
        const engine = createAudioEngine();
        cleanups.push(() => engine.dispose());
        store.set('audio.playing', false); // playback always needs a fresh user gesture

        // ---------- state ----------
        let func = resolveFunction(store, parseExpression) || FUNCTIONS[0];
        let funcKey = '';
        const realView = new Viewport(-4, 4, -2, 2);
        const cplxView = new Viewport(-4, 4, -2, 2);
        const st = {
            a: [store.get('lockOn') ? store.get('lockRe') : 0, store.get('lockOn') ? store.get('lockIm') : 0],
            dirty: true,
            press: null,
            animAt: 0,
            layout: { real: null, cplx: null },
            cache: new Map(),
            errors: {},
            funcError: null,
            keyHold: null,
            errRect: null,
            audioSig: '',
            audioAt: 0,
            audioPending: false,
            disposed: false,
        };
        let doResize = () => {};
        const get = (k) => store.get(k);

        function applyLayout(w, h) {
            st.layout = computeLayout(w, h);
            const { real, cplx } = st.layout;
            st.errRect = null;
            if (real) {
                const { main, err } = splitReal(real, get('showError'));
                realView.setRect(main.x, main.y, main.w, main.h);
                st.errRect = err;
            }
            if (cplx) cplxView.setRect(cplx.x, cplx.y, cplx.w, cplx.h).lockAspect();
        }

        function resetViews() {
            const v = func.view || { xmin: -4, xmax: 4, ymin: -2, ymax: 2 };
            realView.set(v.xmin, v.xmax, v.ymin, v.ymax);
            cplxView.set(v.xmin, v.xmax, -1, 1);
            cplxView.lockAspect();
            st.dirty = true;
        }

        function refreshFunction() {
            const key = `${get('func')}|${get('func') === 'custom' ? get('expr') : ''}`;
            if (key === funcKey) return;
            funcKey = key;
            const f = resolveFunction(store, parseExpression);
            if (f) {
                func = f;
                st.funcError = null;
                st.cache.clear();
                resetViews();
            } else {
                st.funcError = 'Cannot parse expression';
            }
        }

        // ---------- scene ----------
        function buildScene(pal) {
            const env = {
                func,
                a: st.a,
                get,
                view: { x0: realView.xmin, x1: realView.xmax },
                cache: st.cache,
            };
            const memoFits = {};
            const scene = {
                pal, func, a: st.a, get, env,
                fits: {},
                radius: undefined,
                fit(id) {
                    if (!(id in memoFits)) {
                        const m = METHOD_BY_ID[id];
                        let f = null;
                        try {
                            f = m.fit(env);
                            st.errors[id] = null;
                        } catch (e) {
                            st.errors[id] = `${m.name}: ${e.message || e}`;
                        }
                        if (f) {
                            f.color = m.color;
                            f.id = id;
                        }
                        memoFits[id] = f;
                    }
                    return memoFits[id];
                },
                /** Cache key of the inputs a complex-panel source actually depends on. */
                sig(src) {
                    const A = `${st.a[0].toPrecision(8)},${st.a[1].toPrecision(8)}`;
                    const base = src.startsWith('err-') ? src.slice(4) : src;
                    let part = '';
                    if (base === 'taylor') part = `${A}|${get('taylor.order')}`;
                    else if (base === 'pade') part = `${A}|${get('pade.L')},${get('pade.M')}`;
                    else if (base === 'fourier') part = `${get('fourier.N')},${get('fourier.period')},${get('fourier.window')}`;
                    else if (base === 'interp') {
                        const f = scene.fit('interp');
                        part = f ? `${get('interp.n')},${get('interp.family')},${f.window.join(',')}` : 'none';
                    }
                    return `${func.id}|${func.expr || ''}|${part}`;
                                },
            };
            for (const m of METHODS) if (get(`${m.id}.on`)) scene.fits[m.id] = scene.fit(m.id);
            if (func.analytic) {
                try {
                    scene.radius = func.radius ? func.radius(st.a) : estimateRadius(func.taylor(st.a, 40));
                } catch {
                    scene.radius = undefined;
                }
            }
            return scene;
        }

        // ---------- audio ----------
        /** Track list (original f + enabled fits) over one period; rebuilt only when its signature changes. */
        function audioTracks(scene) {
            const win = listenWindow({ fourierFit: scene.fits.fourier, func, view: scene.env.view });
            const tracks = [];
            const at = (g) => (ph) => g(win.x0 + ph * win.T);
            if (get('audio.original')) tracks.push({ id: 'original', fn: at(func.f) });
            for (const m of METHODS) {
                const f = scene.fits[m.id];
                if (f) tracks.push({ id: m.id, fn: at(f.real) });
            }
            const sig = [func.id, func.expr || '', win.kind, win.x0, win.T,
                st.a[0].toFixed(3), st.a[1].toFixed(3),
                ...tracks.map((t) => `${t.id}:${scene.fits[t.id] ? scene.fits[t.id].info : ''}:${(scene.fits[t.id] && scene.fits[t.id].window) || ''}`),
            ].join('|');
            return { tracks, sig };
        }

        function audioParams() {
            const mute = {};
            const solo = {};
            for (const id of AUDIO_TRACKS) {
                mute[id] = !!get(`audio.mute.${id}`);
                solo[id] = !!get(`audio.solo.${id}`);
            }
            return { freq: get('audio.freq'), volume: get('audio.volume'), mute, solo };
        }

        /** Push the current tracks to the engine (throttled to ~8/s while the inputs keep changing). */
        function syncTracks(scene, force = false) {
            if (st.disposed || !engine.playing) return;
            const { tracks, sig } = audioTracks(scene);
            if (sig === st.audioSig && !force) {
                st.audioPending = false;
                return;
            }
            const t = Date.now();
            if (!force && t - st.audioAt < 120) {
                st.audioPending = true;
                return;
            }
            st.audioAt = t;
            st.audioSig = sig;
            st.audioPending = false;
            engine.setTracks(tracks);
        }

        /** Reacts to store changes: start / stop (inside the user's click), parameters, mute / solo. */
        function onStoreChange() {
            st.dirty = true;
            if (st.disposed) return;
            const want = !!get('audio.playing');
            if (want && !engine.playing) {
                const { tracks, sig } = audioTracks(buildScene(getPalette(ctx.globalSettings.get('theme', 'dark'))));
                st.audioSig = sig;
                engine.setTracks(tracks);
                engine.setParams(audioParams());
                if (!engine.play()) store.set('audio.playing', false);
            } else if (!want && engine.playing) {
                engine.stop();
            } else {
                engine.setParams(audioParams());
            }
        }

        // ---------- layout ----------
        function computeLayout(w, h) {
            const mode = get('mode');
            const pad = GAP;
            const inner = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
            if (mode === 'real') return { real: inner, cplx: null };
            if (mode === 'complex') return { real: null, cplx: inner };
            if (w >= h * 1.25) {
                const half = (inner.w - GAP) / 2;
                return {
                    real: { x: inner.x, y: inner.y, w: half, h: inner.h },
                    cplx: { x: inner.x + half + GAP, y: inner.y, w: half, h: inner.h },
                };
            }
            const half = (inner.h - GAP) / 2;
            return {
                real: { x: inner.x, y: inner.y, w: inner.w, h: half },
                cplx: { x: inner.x, y: inner.y + half + GAP, w: inner.w, h: half },
            };
        }

        // ---------- p5 sketch ----------
        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
            const markDirty = () => { st.dirty = true; };

            function sizeNow() {
                const s = ctx.size();
                return { w: Math.max(200, s.width), h: Math.max(200, s.height) };
            }

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                applyLayout(w, h);
                resetViews();
            };

            function hitPanel(mx, my) {
                const { real, cplx } = st.layout;
                if (real && mx >= real.x && mx < real.x + real.w && my >= real.y && my < real.y + real.h) return 'real';
                if (cplx && mx >= cplx.x && mx < cplx.x + cplx.w && my >= cplx.y && my < cplx.y + cplx.h) return 'cplx';
                return null;
            }

            function setCenterFromMouse() {
                if (get('lockOn')) return;
                const hit = hitPanel(p.mouseX, p.mouseY);
                if (hit === 'real') st.a = [realView.fromX(p.mouseX), 0];
                else if (hit === 'cplx') st.a = [cplxView.fromX(p.mouseX), cplxView.fromY(p.mouseY)];
                else return;
                st.dirty = true;
            }

            function onCanvas(e) {
                return !e || !e.target || !p.canvas || e.target === p.canvas;
            }

            /** Mouse position clamped into the plot area (the error strip belongs to the real panel but has no y scale). */
            function anchor(hit) {
                if (hit !== 'real') return [p.mouseX, p.mouseY];
                const r = realView.rect;
                return [p.mouseX, Math.min(p.mouseY, r.y + r.h - 1)];
            }

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                const g = st.gauge;
                if (g && p.mouseX >= g.x - 8 && p.mouseX <= g.x + g.w + 8 && p.mouseY >= g.y - 4 && p.mouseY <= g.y + g.h + 4) {
                    st.press = { hit: 'gauge', x: p.mouseX, y: p.mouseY, moved: true };
                    setGauge();
                    return true;
                }
                const hit = hitPanel(p.mouseX, p.mouseY);
                st.press = hit ? { hit, x: p.mouseX, y: p.mouseY, moved: false } : null;
                return !!st.press;
            }

            function setGauge() {
                if (st.gauge) store.set('fourier.N', Math.min(128, gaugeValue(st.gauge, p.mouseX)));
            }

            function pressDrag() {
                const pr = st.press;
                if (!pr) return;
                if (pr.hit === 'gauge') {
                    setGauge();
                    return;
                }
                if (Math.hypot(p.mouseX - pr.x, p.mouseY - pr.y) > 4) pr.moved = true;
                if (!pr.moved) return;
                const dx = p.mouseX - p.pmouseX;
                const dy = p.mouseY - p.pmouseY;
                if (pr.hit === 'real') realView.panPx(dx, dy);
                else cplxView.panPx(dx, dy);
                st.dirty = true;
            }

            function pressEnd() {
                const pr = st.press;
                st.press = null;
                if (!pr || pr.moved) return;
                if (store.get('lockOn')) {
                    store.set('lockOn', false);
                    setCenterFromMouse();
                } else {
                    setCenterFromMouse();
                    store.set('lockRe', st.a[0]);
                    store.set('lockIm', st.a[1]);
                    store.set('lockOn', true);
                }
            }

            p.mouseMoved = (e) => {
                if (onCanvas(e)) setCenterFromMouse();
            };
            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.press; };
            p.touchEnded = () => { pressEnd(); return !st.press; };

            p.mouseWheel = (e) => {
                if (!onCanvas(e)) return true;
                const hit = hitPanel(p.mouseX, p.mouseY);
                if (!hit) return true;
                // normalise line / page based wheels (Firefox) to pixels
                let d = e.delta || 0;
                if (e.deltaMode === 1) d *= 33;
                else if (e.deltaMode === 2) d *= 400;
                d = Math.max(-300, Math.min(300, d));
                const f = Math.exp(d * 0.0012);
                const view = hit === 'real' ? realView : cplxView;
                let fx = f, fy = f;
                if (hit === 'real') {
                    if (e.shiftKey) fx = 1;
                    else if (e.altKey) fy = 1;
                }
                const [ax, ay] = anchor(hit);
                view.zoomAt(ax, ay, fx, fy);
                st.dirty = true;
                if (e.preventDefault) e.preventDefault();
                return false;
            };

            function typing(k) {
                const el = globalThis.document && globalThis.document.activeElement;
                if (!el) return false;
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
                // a focused button / link keeps Space and Enter for itself
                return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
            }

            function cycleSource() {
                const i = COMPLEX_SOURCES.findIndex((s) => s.value === get('cplx.source'));
                store.set('cplx.source', COMPLEX_SOURCES[(i + 1) % COMPLEX_SOURCES.length].value);
            }

            function stepOrder(dir, step) {
                store.set('taylor.order', Math.max(0, Math.min(40, get('taylor.order') + dir * step)));
            }

            p.keyPressed = (e) => {
                if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true; // leave browser shortcuts alone
                const k = p.key;
                if (typing(k)) return true;
                const step = p.keyIsDown && p.keyIsDown(16) ? 5 : 1;
                const up = p.keyCode === p.UP_ARROW || k === 'w' || k === 'W';
                const down = p.keyCode === p.DOWN_ARROW || k === 's' || k === 'S';
                if (up || down) {
                    const dir = up ? 1 : -1;
                    stepOrder(dir, step);
                    st.keyHold = { code: p.keyCode, key: k, dir, step, at: Date.now() + 350 };
                } else if (k === '1') store.set('mode', 'real');
                else if (k === '2') store.set('mode', 'split');
                else if (k === '3') store.set('mode', 'complex');
                else if (k === ' ') store.set('taylor.animate', !get('taylor.animate'));
                else if (k === 'l' || k === 'L') {
                    if (!get('lockOn')) {
                        store.set('lockRe', st.a[0]);
                        store.set('lockIm', st.a[1]);
                    }
                    store.set('lockOn', !get('lockOn'));
                } else if (k === 'f' || k === 'F') resetViews();
                else if (k === 'g' || k === 'G') store.set('showGrid', !get('showGrid'));
                else if (k === 'e' || k === 'E') store.set('showError', !get('showError'));
                else if (k === 'm' || k === 'M') cycleSource();
                else if (k === 'p' || k === 'P') store.set('audio.playing', !get('audio.playing'));
                else return true;
                return false;
            };

            // p5 does not auto-repeat keyPressed, so held arrows are handled per frame
            function tickKeyHold() {
                const h = st.keyHold;
                if (!h) return;
                const held = h.key && h.key.length === 1 ? h.key.toUpperCase().charCodeAt(0) : h.code;
                if (!(p.keyIsDown && p.keyIsDown(held))) {
                    st.keyHold = null;
                    return;
                }
                const now = Date.now();
                if (now >= h.at) {
                    stepOrder(h.dir, h.step);
                    h.at = now + 70;
                }
            }

            // driven by ctx.onResize (debounced, also fires when the drawer opens / closes)
            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                applyLayout(w, h);
                st.dirty = true;
            };

            function tickAnimation() {
                if (!get('taylor.animate')) return;
                const now = Date.now();
                if (now - st.animAt < 450) return;
                st.animAt = now;
                const n = get('taylor.order');
                store.set('taylor.order', n >= 20 ? 0 : n + 1);
            }

            p.draw = () => {
                if (st.disposed) return;
                tickKeyHold();
                tickAnimation();
                if (st.audioPending && Date.now() - st.audioAt >= 120) st.dirty = true;
                if (!st.dirty) return;
                st.dirty = false;
                st.errors = {};

                refreshFunction();
                applyLayout(p.width, p.height);
                p.background(pal.bg);

                const scene = buildScene(pal);
                syncTracks(scene);
                st.gauge = st.layout.real ? gibbsGaugeRect(scene, realView.rect) : null;
                if (st.layout.real) drawRealPanel(p, scene, realView, st.errRect);
                if (st.layout.cplx) drawComplexPanel(p, scene, cplxView, realView);
                drawStatus(p, pal);
            };

            function drawStatus(pp, palette) {
                const msgs = [st.funcError, ...Object.values(st.errors)].filter(Boolean);
                if (!msgs.length) return;
                pp.noStroke();
                pp.fill('#ff6b6b');
                pp.textFont('Consolas, ui-monospace, monospace');
                pp.textSize(11);
                pp.textAlign(pp.LEFT, pp.BOTTOM);
                pp.text(msgs.join('  |  '), 14, pp.height - 12);
                void palette;
            }

            // theme / settings changes
            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                markDirty();
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(onStoreChange));
        cleanups.push(ctx.onResize(() => doResize()));

        // ---------- UI ----------
        const modeTabs = ctx.ui.build([{ type: 'tabs', key: 'mode', options: MODES }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(parseExpression, engine), store, ctx.drawer);

        return {
            unmount() {
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { modeTabs.destroy(); } catch { /* ignore */ }
                try { panel.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
                resetSlots();
            },
        };
    },
};
