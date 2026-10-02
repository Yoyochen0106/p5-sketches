// Monge's Theorem: the three exsimilicenters of three circles are collinear.

import { commonTangents, mongeData, mongeLine, collinearTriples, PAIRS } from '../../lib/geometry2d.js';
import { Viewport } from '../approx/view.js';
import { getPalette } from '../approx/palette.js';
import {
    DEFAULTS, PRESETS, PRESET_LABELS, PROOF_STEPS, DEFAULT_VIEW, cloneCircles, randomCircles, animOffset,
    sanitize, snapTo, hitTest, MIN_R,
} from './state.js';
import { drawScene, extraLines, pairColors } from './draw.js';

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
    id: 'monge',
    title: "Monge's Theorem",
    description: 'Drag three circles: the intersection points of their external common tangents always lie on one line.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const cleanups = [];
        const view = new Viewport(DEFAULT_VIEW.xmin, DEFAULT_VIEW.xmax, DEFAULT_VIEW.ymin, DEFAULT_VIEW.ymax);
        const st = {
            circles: cloneCircles(PRESETS.generic()),
            base: null, // animation anchor positions
            t: 0,
            drag: null,
            dirty: true,
            disposed: false,
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

        function setCircles(cs) {
            st.circles = cs.map(sanitize);
            st.base = null;
            st.dirty = true;
        }

        function usePreset(id) {
            const make = PRESETS[id];
            if (!make) return;
            resetView();
            setCircles(make());
        }

        function randomise() {
            setCircles(randomCircles(view));
        }

        function resetAll() {
            store.set('animate', false);
            usePreset('generic');
        }

        function stepProof(d) {
            const n = Math.max(1, Math.min(PROOF_STEPS, get('proofStep') + d));
            store.set('proofStep', n);
        }

        // ---------- scene ----------
        function buildScene(pal) {
            const circles = st.circles;
            const data = mongeData(circles);
            const tangents = PAIRS.map(([i, j]) => commonTangents(circles[i], circles[j]));
            const monge = mongeLine(data);
            const triples = collinearTriples(data);
            return {
                pal, dark: pal.dark, cols: pairColors(pal.dark), view, circles, data, tangents, monge,
                extra: extraLines(triples, pal.dark), get,
                proofOn: !!get('proof'), proofStep: get('proofStep'),
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
                const hit = hitTest(st.circles, view, p.mouseX, p.mouseY);
                if (hit) {
                    const c = st.circles[hit.i];
                    const [wx, wy] = worldMouse();
                    st.drag = { ...hit, ox: c.x - wx, oy: c.y - wy };
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
                const c = st.circles[d.i];
                const [wx, wy] = worldMouse();
                if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
                if (d.kind === 'handle') {
                    let r = Math.hypot(wx - c.x, wy - c.y);
                    if (snapOn()) r = Math.max(SNAP_MIN, snapTo(r));
                    c.r = Math.max(MIN_R, r);
                } else {
                    c.x = wx + d.ox;
                    c.y = wy + d.oy;
                    if (snapOn()) { c.x = snapTo(c.x); c.y = snapTo(c.y); }
                }
                sanitize(c);
                st.base = null; // re-anchor the animation to the new position
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
                else if (k === ' ') store.set('animate', !get('animate'));
                else if (k === 'p' || k === 'P') store.set('proof', !get('proof'));
                else if (k === 's' || k === 'S') store.set('snap', !get('snap'));
                else if (k === 'f' || k === 'F') resetView();
                else if (p.keyCode === p.RIGHT_ARROW && get('proof')) stepProof(1);
                else if (p.keyCode === p.LEFT_ARROW && get('proof')) stepProof(-1);
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

            function tickAnimation() {
                if (!get('animate')) {
                    st.base = null;
                    return false;
                }
                if (!st.base) st.base = cloneCircles(st.circles).map((c, i) => {
                    const o = animOffset(i, st.t);
                    return { x: c.x - o[0], y: c.y - o[1], r: c.r };
                });
                const dt = Math.min(100, p.deltaTime || 16);
                st.t += dt * 0.001 * get('speed');
                if (!st.drag || st.drag.kind === 'pan') {
                    st.circles.forEach((c, i) => {
                        const o = animOffset(i, st.t);
                        c.x = st.base[i].x + o[0];
                        c.y = st.base[i].y + o[1];
                    });
                }
                return true;
            }

            p.draw = () => {
                if (st.disposed) return;
                const animating = tickAnimation();
                if (!st.dirty && !animating) return;
                st.dirty = false;
                applyLayout(p.width, p.height);
                drawScene(p, buildScene(pal));
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                st.dirty = true;
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(() => { st.dirty = true; }));
        cleanups.push(ctx.onResize(() => doResize()));

        // ---------- UI ----------
        const presetButtons = Object.keys(PRESETS).map((id) => ({
            type: 'button', label: PRESET_LABELS[id], onClick: () => usePreset(id),
        }));
        const schema = [
            {
                type: 'group', label: 'Tangents', children: [
                    { type: 'toggle', key: 'showExternal', label: 'external tangents (solid)' },
                    { type: 'toggle', key: 'showInternal', label: 'internal tangents (dashed)' },
                    { type: 'toggle', key: 'showTangentPoints', label: 'tangent points' },
                    { type: 'toggle', key: 'showCones', label: 'homothety cones' },
                    { type: 'toggle', key: 'showInternalPts', label: 'internal centres I12 I13 I23' },
                    { type: 'toggle', key: 'showExtra', label: 'three extra collinear triples' },
                ],
            },
            {
                type: 'group', label: 'Proof sketch', children: [
                    { type: 'toggle', key: 'proof', label: 'step-by-step proof overlay (P)' },
                    {
                        type: 'slider', key: 'proofStep', label: 'step', min: 1, max: PROOF_STEPS, step: 1,
                        visibleIf: (s) => !!s.get('proof'),
                    },
                ],
            },
            { type: 'group', label: 'Presets', children: presetButtons },
            {
                type: 'group', label: 'Scene', children: [
                    { type: 'button', label: 'Randomise (R)', onClick: () => randomise() },
                    { type: 'button', label: 'Reset (Z)', onClick: () => resetAll() },
                    { type: 'button', label: 'Fit view (F)', onClick: () => resetView() },
                    { type: 'toggle', key: 'snap', label: 'snap to grid (S)' },
                    { type: 'toggle', key: 'showGrid', label: 'grid' },
                    { type: 'toggle', key: 'animate', label: 'animate (space)' },
                    { type: 'slider', key: 'speed', label: 'animation speed', min: 0.1, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
                ],
            },
            {
                type: 'info',
                text: 'Drag a circle to move it, drag its square handle to resize · drag the background to pan · wheel: zoom · '
                    + 'R: randomise · Z: reset · space: animate · P: proof · arrows: proof steps',
            },
        ];
        const panel = ctx.ui.build(schema, store, ctx.drawer);

        return {
            /** Test / debugging hook. */
            getState: () => ({ circles: st.circles, view, t: st.t }),
            setCircles: (cs) => setCircles(cs.map((c) => ({ ...c }))),
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

const SNAP_MIN = 0.5;
