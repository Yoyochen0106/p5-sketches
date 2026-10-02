// Function Approximation Lab: Taylor / Pade / Fourier / wavelet approximations of a
// function, shown on a real panel and a complex panel (domain colouring).

import { FUNCTIONS, getFunction } from '../../lib/functions.js';
import { CONTINUOUS } from '../../lib/wavelets/cwt.js';
import { Viewport } from './view.js';
import { getPalette } from './palette.js';
import { DEFAULTS } from './state.js';
import { METHODS, METHOD_BY_ID, waveletFamilyOptions } from './methods.js';
import { drawRealPanel } from './real.js';
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

function buildSchema(parseExpression) {
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
                + '↑↓: Taylor order · 1 2 3: panels · space: animate · F: fit · M: next complex view',
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
        };
        const get = (k) => store.get(k);

        function applyLayout(w, h) {
            st.layout = computeLayout(w, h);
            const { real, cplx } = st.layout;
            if (real) realView.setRect(real.x, real.y, real.w, real.h);
            if (cplx) cplxView.setRect(cplx.x, cplx.y, cplx.w, cplx.h);
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
                st.errors.func = null;
                st.cache.clear();
                resetViews();
            } else {
                st.errors.func = 'Cannot parse expression';
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
                sig() {
                    return [func.id, func.expr || '', st.a[0].toPrecision(8), st.a[1].toPrecision(8),
                        get('taylor.order'), get('pade.L'), get('pade.M'), get('fourier.N'), get('fourier.period')].join('|');
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
            let pal = getPalette(ctx.globalSettings.get('theme', 'auto'));
            const markDirty = () => { st.dirty = true; };

            function sizeNow() {
                const s = ctx.size();
                return { w: Math.max(200, s.width), h: Math.max(200, s.height) };
            }

            p.setup = () => {
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

            p.mouseMoved = () => setCenterFromMouse();

            p.mousePressed = (e) => {
                if (!onCanvas(e)) return;
                const hit = hitPanel(p.mouseX, p.mouseY);
                st.press = hit ? { hit, x: p.mouseX, y: p.mouseY, moved: false } : null;
            };

            p.mouseDragged = () => {
                const pr = st.press;
                if (!pr) return;
                if (Math.hypot(p.mouseX - pr.x, p.mouseY - pr.y) > 4) pr.moved = true;
                if (!pr.moved) return;
                const dx = p.mouseX - p.pmouseX;
                const dy = p.mouseY - p.pmouseY;
                if (pr.hit === 'real') realView.panPx(dx, dy);
                else cplxView.panPx(dx, dy);
                st.dirty = true;
            };

            p.mouseReleased = () => {
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
            };

            p.mouseWheel = (e) => {
                const hit = hitPanel(p.mouseX, p.mouseY);
                if (!hit) return true;
                const f = Math.exp((e.delta || 0) * 0.0012);
                const view = hit === 'real' ? realView : cplxView;
                let fx = f, fy = f;
                if (hit === 'real') {
                    if (e.shiftKey) fx = 1;
                    else if (e.altKey) fy = 1;
                }
                view.zoomAt(p.mouseX, p.mouseY, fx, fy);
                st.dirty = true;
                if (e.preventDefault) e.preventDefault();
                return false;
            };

            function typing() {
                const el = globalThis.document && globalThis.document.activeElement;
                return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '');
            }

            function cycleSource() {
                const i = COMPLEX_SOURCES.findIndex((s) => s.value === get('cplx.source'));
                store.set('cplx.source', COMPLEX_SOURCES[(i + 1) % COMPLEX_SOURCES.length].value);
            }

            p.keyPressed = () => {
                if (typing()) return true;
                const k = p.key;
                const step = p.keyIsDown && p.keyIsDown(16) ? 5 : 1;
                if (p.keyCode === p.UP_ARROW) store.set('taylor.order', Math.min(40, get('taylor.order') + step));
                else if (p.keyCode === p.DOWN_ARROW) store.set('taylor.order', Math.max(0, get('taylor.order') - step));
                else if (k === '1') store.set('mode', 'real');
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
                else return true;
                return false;
            };

            p.windowResized = () => {
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h);
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
                tickAnimation();
                if (!st.dirty) return;
                st.dirty = false;

                refreshFunction();
                applyLayout(p.width, p.height);
                p.background(pal.bg);

                const scene = buildScene(pal);
                if (st.layout.real) drawRealPanel(p, scene, realView);
                if (st.layout.cplx) drawComplexPanel(p, scene, cplxView, realView);
                drawStatus(p, pal);
            };

            function drawStatus(pp, palette) {
                const msgs = Object.values(st.errors).filter(Boolean);
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
                pal = getPalette(ctx.globalSettings.get('theme', 'auto'));
                markDirty();
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(() => { st.dirty = true; }));
        cleanups.push(ctx.onResize(() => {
            if (instance.windowResized) instance.windowResized();
        }));

        // ---------- UI ----------
        const modeTabs = ctx.ui.build([{ type: 'tabs', key: 'mode', options: MODES }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(parseExpression), store, ctx.drawer);
        // keep the Taylor-order key bindings out of the way when the user is typing in the expression box
        void METHODS;

        return {
            unmount() {
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
