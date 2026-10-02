// Poncelet's Porism: if a polygon inscribed in a conic C and circumscribed about a conic D closes
// for one starting point, it closes for every starting point.

import {
    chainClosure, closedAfter, rotationNumber, ellipsePoint, conicFromEllipseParams, ponceletChain, innerInside,
    eulerCheck, fussQuadrilateralDefect, solveClosure,
} from '../../lib/conics.js';
import { Viewport } from '../approx/view.js';
import { getPalette } from '../approx/palette.js';
import {
    DEFAULTS, DEFAULT_VIEW, PRESETS, PRESET_LABELS, sanitize, cloneE, hitTest, dragHandle, dragP0, snapTo, randomPair,
} from './state.js';
import { drawScene, cayleyFor } from './draw.js';

const TAU = 2 * Math.PI;
const FAMILY_COUNT = 24;

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

export default {
    id: 'poncelet',
    title: "Poncelet's Porism",
    description: 'Two conics, a chain of tangents: if the polygon closes for one start point it closes for all of them.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const cleanups = [];
        const view = new Viewport(DEFAULT_VIEW.xmin, DEFAULT_VIEW.xmax, DEFAULT_VIEW.ymin, DEFAULT_VIEW.ymax);
        const st = {
            outer: null, inner: null, t0: 0,
            outerCircle: true, innerCircle: true,
            drag: null, dirty: true, disposed: false, ready: false,
            msg: '', msgCol: null,
            cayleyKey: '', cayley: [],
        };
        let doResize = () => {};
        const get = (k) => store.get(k);

        function applyLayout(w, h) {
            view.setRect(0, 0, w, h).lockAspect();
        }

        function resetView() {
            view.set(DEFAULT_VIEW.xmin, DEFAULT_VIEW.xmax, DEFAULT_VIEW.ymin, DEFAULT_VIEW.ymax);
            if (st.ready) applyLayout(st.w, st.h);
            st.dirty = true;
        }

        /** Mirror the circle toggles from the settings onto the geometry. */
        function syncCircles() {
            st.outerCircle = !!get('outerCircle');
            st.innerCircle = !!get('innerCircle');
            sanitize(st.outer, st.outerCircle);
            sanitize(st.inner, st.innerCircle);
        }

        function setConfig(cfg) {
            st.outer = sanitize(cloneE(cfg.outer), !!cfg.outerCircle);
            st.inner = sanitize(cloneE(cfg.inner), !!cfg.innerCircle);
            st.t0 = Number.isFinite(cfg.t0) ? cfg.t0 : 0;
            st.msg = '';
            if (cfg.outerCircle !== undefined) store.set('outerCircle', !!cfg.outerCircle);
            if (cfg.innerCircle !== undefined) store.set('innerCircle', !!cfg.innerCircle);
            if (cfg.steps) store.set('steps', cfg.steps);
            if (cfg.closeN) store.set('closeN', cfg.closeN);
            if (cfg.closeM) store.set('closeM', cfg.closeM);
            syncCircles();
            st.dirty = true;
        }

        function usePreset(id) {
            const make = PRESETS[id];
            if (!make) return;
            resetView();
            setConfig(make());
        }

        function randomise() {
            setConfig(randomPair());
        }

        function resetAll() {
            store.set('animate', false);
            usePreset('triangle');
        }

        /** Solve one parameter of the inner conic so that the chain closes after closeN steps. */
        function fixIt() {
            const n = Math.round(get('closeN')), m = Math.round(get('closeM'));
            const first = get('fixParam') === 'offset' ? 'offset' : 'scale';
            const order = first === 'scale' ? ['scale', 'offset'] : ['offset', 'scale'];
            for (const param of order) {
                const s = solveClosure(st.outer, st.inner, { n, m, param, t0: st.t0 });
                if (s.ok) {
                    st.inner = sanitize(cloneE(s.inner), st.innerCircle);
                    st.msg = `Fixed (${param}): closes after ${n}, residual ${s.residual.toExponential(1)}`;
                    st.msgCol = null;
                    store.set('steps', n);
                    st.dirty = true;
                    return true;
                }
            }
            st.msg = `No ${n}-gon (winding ${m}) found: try moving the inner conic nearer the centre of C`;
            st.msgCol = '#ff6b6b';
            st.dirty = true;
            return false;
        }

        // ---------- analysis ----------
        function analyse() {
            const steps = Math.max(1, Math.min(60, Math.round(get('steps'))));
            const { outer, inner, t0 } = st;
            const chain = chainClosure(outer, inner, t0, steps);
            const closed = closedAfter(outer, inner, t0, 60, 1e-6);
            const rho = rotationNumber(outer, inner, t0, 120);
            const key = JSON.stringify([outer, inner]);
            if (key !== st.cayleyKey) {
                st.cayleyKey = key;
                st.cayley = cayleyFor(outer, inner);
            }
            const bothCircles = st.outerCircle && st.innerCircle;
            let euler = null, fuss = NaN;
            if (bothCircles) {
                const d = Math.hypot(inner.cx - outer.cx, inner.cy - outer.cy);
                euler = eulerCheck(outer.a, inner.a, d);
                fuss = fussQuadrilateralDefect(outer.a, inner.a, d);
            }
            let family = [];
            if (get('family') && innerInside(outer, inner, 48)) {
                const C = conicFromEllipseParams(outer), D = conicFromEllipseParams(inner);
                for (let i = 0; i < FAMILY_COUNT; i++) {
                    const ch = ponceletChain(C, D, ellipsePoint(outer, t0 + (i / FAMILY_COUNT) * TAU), steps);
                    family.push(ch.pts);
                }
            }
            return {
                steps, chain, closed, rho, cayley: st.cayley, euler, fuss, family,
            };
        }

        function buildScene(pal) {
            const an = analyse();
            return {
                pal, view, outer: st.outer, inner: st.inner, t0: st.t0, steps: an.steps, an,
                outerCircle: st.outerCircle, innerCircle: st.innerCircle, circles: st.outerCircle && st.innerCircle,
                flags: {
                    stepColors: !!get('stepColors'), showTouch: !!get('showTouch'), showEnvelope: !!get('showEnvelope'),
                    family: !!get('family'), showCayley: !!get('showCayley'), showEuler: !!get('showEuler'), showGrid: !!get('showGrid'),
                },
                msg: st.msg, msgCol: st.msgCol,
            };
        }

        // ---------- p5 sketch ----------
        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));

            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(200, s.width), h: Math.max(200, s.height) };
            };

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                st.w = w; st.h = h; st.ready = true;
                applyLayout(w, h);
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;
            const worldMouse = () => [view.fromX(p.mouseX), view.fromY(p.mouseY)];
            const snapOn = () => !!get('snap');

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                syncCircles();
                const hit = hitTest(st, view, p.mouseX, p.mouseY);
                if (hit) {
                    const [wx, wy] = worldMouse();
                    const e0 = hit.which ? st[hit.which] : null;
                    st.drag = { ...hit, ox: e0 ? e0.cx - wx : 0, oy: e0 ? e0.cy - wy : 0 };
                } else {
                    st.drag = { kind: 'pan' };
                }
                return true;
            }

            function pressDrag() {
                const d = st.drag;
                if (!d) return;
                st.dirty = true;
                if (d.kind === 'pan') {
                    view.panPx(p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
                    return;
                }
                const [wx, wy] = worldMouse();
                if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
                st.msg = '';
                if (d.kind === 'p0') {
                    dragP0(st, wx, wy, snapOn());
                    return;
                }
                const e = st[d.which];
                if (d.kind === 'handle') {
                    dragHandle(e, st[d.which + 'Circle'], d.h, wx, wy, snapOn());
                } else {
                    e.cx = wx + d.ox;
                    e.cy = wy + d.oy;
                    if (snapOn()) { e.cx = snapTo(e.cx); e.cy = snapTo(e.cy); }
                }
                sanitize(e, st[d.which + 'Circle']);
            }

            function pressEnd() {
                const had = !!st.drag;
                st.drag = null;
                return had;
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.drag; };
            p.touchEnded = () => { pressEnd(); return true; };

            p.mouseWheel = (e) => {
                if (!onCanvas(e)) return true;
                let d = e.delta || 0;
                if (e.deltaMode === 1) d *= 33;
                else if (e.deltaMode === 2) d *= 400;
                d = Math.max(-300, Math.min(300, d));
                view.zoomAt(p.mouseX, p.mouseY, Math.exp(d * 0.0012));
                st.dirty = true;
                if (e.preventDefault) e.preventDefault();
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
                if (k === 'r' || k === 'R') randomise();
                else if (k === 'z' || k === 'Z') resetAll();
                else if (k === 'x' || k === 'X') fixIt();
                else if (k === ' ') store.set('animate', !get('animate'));
                else if (k === 's' || k === 'S') store.set('snap', !get('snap'));
                else if (k === 'f' || k === 'F') resetView();
                else if (p.keyCode === p.RIGHT_ARROW) store.set('steps', Math.min(60, get('steps') + 1));
                else if (p.keyCode === p.LEFT_ARROW) store.set('steps', Math.max(1, get('steps') - 1));
                else return true;
                return false;
            };

            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                st.w = w; st.h = h;
                applyLayout(w, h);
                st.dirty = true;
            };

            p.draw = () => {
                if (st.disposed) return;
                const animating = !!get('animate');
                if (animating) {
                    const dt = Math.min(100, p.deltaTime || 16);
                    if (!st.drag || st.drag.kind !== 'p0') st.t0 = (st.t0 + dt * 0.001 * 0.7 * get('speed')) % TAU;
                }
                if (!st.dirty && !animating) return;
                st.dirty = false;
                syncCircles();
                applyLayout(p.width, p.height);
                drawScene(p, buildScene(pal));
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                st.dirty = true;
            }));
        };

        setConfig(PRESETS.triangle());
        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(() => { st.dirty = true; }));
        cleanups.push(ctx.onResize(() => doResize()));

        // ---------- UI ----------
        const presetButtons = Object.keys(PRESETS).map((id) => ({
            type: 'button', label: PRESET_LABELS[id], onClick: () => usePreset(id),
        }));
        const schema = [
            {
                type: 'group', label: 'Conics', children: [
                    { type: 'toggle', key: 'outerCircle', label: 'outer conic C is a circle' },
                    { type: 'toggle', key: 'innerCircle', label: 'inner conic D is a circle' },
                    { type: 'slider', key: 'steps', label: 'steps', min: 1, max: 60, step: 1 },
                    { type: 'toggle', key: 'stepColors', label: 'colour per step' },
                    { type: 'toggle', key: 'showTouch', label: 'points of tangency' },
                    { type: 'toggle', key: 'showEnvelope', label: 'envelope (tangents to D from all of C)' },
                    { type: 'toggle', key: 'family', label: 'family of 24 polygons' },
                ],
            },
            {
                type: 'group', label: 'Fix it', children: [
                    { type: 'slider', key: 'closeN', label: 'target n', min: 3, max: 12, step: 1 },
                    { type: 'slider', key: 'closeM', label: 'winding m', min: 1, max: 5, step: 1 },
                    {
                        type: 'tabs', key: 'fixParam', label: 'adjust',
                        options: [{ value: 'scale', label: 'size of D' }, { value: 'offset', label: 'offset of D' }],
                    },
                    { type: 'button', label: 'Fix it (X)', onClick: () => fixIt() },
                ],
            },
            {
                type: 'group', label: 'Checks', children: [
                    { type: 'toggle', key: 'showCayley', label: 'Cayley determinants' },
                    { type: 'toggle', key: 'showEuler', label: 'Euler / Fuss check (circles)' },
                ],
            },
            { type: 'group', label: 'Presets', children: presetButtons },
            {
                type: 'group', label: 'Scene', children: [
                    { type: 'button', label: 'Randomise (R)', onClick: () => randomise() },
                    { type: 'button', label: 'Reset (Z)', onClick: () => resetAll() },
                    { type: 'button', label: 'Fit view (F)', onClick: () => resetView() },
                    { type: 'toggle', key: 'snap', label: 'snap (S)' },
                    { type: 'toggle', key: 'showGrid', label: 'grid' },
                    { type: 'toggle', key: 'animate', label: 'animate P0 around C (space)' },
                    { type: 'slider', key: 'speed', label: 'animation speed', min: 0.1, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
                ],
            },
            {
                type: 'info',
                text: 'Drag P0 along C, a centre to move a conic, a square handle to resize / rotate it; drag the background to pan, '
                    + 'wheel: zoom. R: randomise, Z: reset, X: fix it, space: animate, arrows: steps.',
            },
        ];
        const panel = ctx.ui.build(schema, store, ctx.drawer);

        return {
            /** Test / debugging hook. */
            getState: () => ({ st, view }),
            setConfig,
            fixIt,
            unmount() {
                if (st.disposed) return;
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { panel.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
            },
        };
    },
};
