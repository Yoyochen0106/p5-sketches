// Elliptic Curve Group: chord-and-tangent addition on real curves, the group over F_p, and the complex torus.

import { getPalette } from '../approx/palette.js';
import { DEFAULTS, TABS, PRIMES, AB_RANGE, MAX_TRAIL, REAL_PRESETS, FINITE_PRESETS, TORUS_PRESETS } from './state.js';
import { createRealTab } from './real.js';
import { createFiniteTab } from './finite.js';
import { createTorusTab } from './torus.js';

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
    id: 'elliptic',
    title: 'Elliptic Curve Group',
    description: 'Chord-and-tangent addition on y² = x³ + ax + b over the reals, over finite fields F_p, and via the complex torus C/(Z + τZ).',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const cleanups = [];
        const st = { dirty: true, disposed: false, ready: false, w: 800, h: 600 };
        const get = (k) => store.get(k);
        const env = { get, set: (k, v) => store.set(k, v), invalidate: () => { st.dirty = true; } };
        const tabs = { real: createRealTab(env), finite: createFiniteTab(env), torus: createTorusTab(env) };
        const tabKey = () => (tabs[get('tab')] ? get('tab') : 'real');
        const cur = () => tabs[tabKey()];
        let doResize = () => {};

        function layoutAll(w, h) {
            for (const t of Object.values(tabs)) t.layout(w, h);
        }

        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(240, s.width), h: Math.max(240, s.height) };
            };

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                st.w = w; st.h = h; st.ready = true;
                layoutAll(w, h);
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;
            let active = null; // tab that owns the current gesture

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                const t = cur();
                if (t.press(p.mouseX, p.mouseY)) {
                    active = t;
                    st.dirty = true;
                    return true;
                }
                return false;
            }

            function pressDrag() {
                if (!active) return;
                active.drag(p.mouseX, p.mouseY, p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
                st.dirty = true;
            }

            function pressEnd() {
                const had = !!active;
                if (active) active.release();
                active = null;
                if (had) st.dirty = true;
                return had;
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !active; };
            p.touchEnded = () => { pressEnd(); return true; };

            p.mouseWheel = (e) => {
                const t = cur();
                if (!onCanvas(e) || !t.wheel) return true;
                let d = e.delta || 0;
                if (e.deltaMode === 1) d *= 33;
                else if (e.deltaMode === 2) d *= 400;
                d = Math.max(-300, Math.min(300, d));
                t.wheel(p.mouseX, p.mouseY, d);
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
                const tab = tabKey();
                if (k === '1') store.set('tab', 'real');
                else if (k === '2') store.set('tab', 'finite');
                else if (k === '3') store.set('tab', 'torus');
                else if ((k === 'r' || k === 'R') && tab === 'real') tabs.real.randomise();
                else if ((k === 'r' || k === 'R') && tab === 'finite') tabs.finite.randomPoint();
                else if (k === ' ' && tab === 'real') tabs.real.replay();
                else if ((k === 'n' || k === 'N' || k === '+') && tab === 'real') tabs.real.addMultiple();
                else if ((k === 'f' || k === 'F') && tab === 'real') tabs.real.resetView();
                else return true;
                st.dirty = true;
                return false;
            };

            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                st.w = w; st.h = h;
                layoutAll(w, h);
                st.dirty = true;
            };

            p.draw = () => {
                if (st.disposed || !st.ready) return;
                const t = cur();
                const animating = !!(t.animating && t.animating());
                if (!st.dirty && !animating) return;
                st.dirty = false;
                t.draw(p, pal, Math.min(100, p.deltaTime || 16));
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
        const on = (tab) => (s) => s.get('tab') === tab;
        const presetButtons = (tab, presets) => Object.entries(presets).map(([id, pr]) => ({
            type: 'button', label: pr.label, onClick: () => tab.applyPreset(id),
        }));
        const schema = [
            { type: 'tabs', key: 'tab', options: TABS },
            // ----- real -----
            {
                type: 'group', label: 'Curve y² = x³ + ax + b', visibleIf: on('real'), children: [
                    { type: 'slider', key: 'a', label: 'a', min: -AB_RANGE, max: AB_RANGE, step: 0.01 },
                    { type: 'slider', key: 'b', label: 'b', min: -AB_RANGE, max: AB_RANGE, step: 0.01 },
                    { type: 'toggle', key: 'show2torsion', label: 'show 2-torsion points (y = 0)' },
                    { type: 'toggle', key: 'showGrid', label: 'grid' },
                ],
            },
            {
                type: 'group', label: 'Construction', visibleIf: on('real'), children: [
                    { type: 'button', label: 'Replay construction (space)', onClick: () => tabs.real.replay() },
                    { type: 'toggle', key: 'manual', label: 'step manually' },
                    { type: 'slider', key: 'stage', label: 'stage', min: 0, max: 4, step: 0.05, visibleIf: (s) => !!s.get('manual') },
                    { type: 'slider', key: 'speed', label: 'animation speed', min: 0.2, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
                    { type: 'button', label: 'Q := P (tangent case)', onClick: () => tabs.real.tangentCase() },
                    { type: 'button', label: 'Q := −P (vertical line, sum is O)', onClick: () => tabs.real.verticalCase() },
                    { type: 'button', label: 'Random P, Q (R)', onClick: () => tabs.real.randomise() },
                ],
            },
            {
                type: 'group', label: 'Multiples nP', visibleIf: on('real'), children: [
                    { type: 'button', label: 'Add P once more (N)', onClick: () => tabs.real.addMultiple() },
                    { type: 'slider', key: 'trailN', label: 'show up to nP', min: 0, max: MAX_TRAIL, step: 1 },
                    { type: 'button', label: 'Clear trail', onClick: () => tabs.real.clearTrail() },
                ],
            },
            { type: 'group', label: 'Presets', visibleIf: on('real'), children: presetButtons(tabs.real, REAL_PRESETS) },
            // ----- finite -----
            {
                type: 'group', label: 'Curve over F_p', visibleIf: on('finite'), children: [
                    { type: 'select', key: 'p', label: 'prime p', options: PRIMES.map((v) => ({ value: v, label: `p = ${v}` })) },
                    { type: 'slider', key: 'fa', label: 'a (mod p)', min: 0, max: 100, step: 1 },
                    { type: 'slider', key: 'fb', label: 'b (mod p)', min: 0, max: 100, step: 1 },
                    { type: 'button', label: 'Random non-singular curve', onClick: () => tabs.finite.randomCurve() },
                ],
            },
            {
                type: 'group', label: 'Show', visibleIf: on('finite'), children: [
                    { type: 'toggle', key: 'ffMirror', label: 'mirror axis y ↔ −y' },
                    { type: 'toggle', key: 'ffMults', label: 'multiples nP and subgroup ⟨P⟩' },
                    { type: 'toggle', key: 'ffArrows', label: 'arrows nP → (n+1)P (small orders)' },
                    { type: 'toggle', key: 'ffWrap', label: 'wrapped chord (line mod p)' },
                ],
            },
            {
                type: 'group', label: 'Points', visibleIf: on('finite'), children: [
                    { type: 'button', label: 'Find generator', onClick: () => tabs.finite.findGenerator() },
                    { type: 'button', label: 'Random P (R)', onClick: () => tabs.finite.randomPoint() },
                    { type: 'button', label: 'Q := P (doubling)', onClick: () => tabs.finite.qIsP() },
                    { type: 'button', label: 'Q := −P (sum is O)', onClick: () => tabs.finite.qIsNegP() },
                    { type: 'button', label: 'Clear selection', onClick: () => tabs.finite.clearSelection() },
                ],
            },
            {
                type: 'group', label: 'Discrete-log puzzle', visibleIf: on('finite'), children: [
                    { type: 'button', label: 'New puzzle', onClick: () => tabs.finite.newPuzzle() },
                    { type: 'slider', key: 'guess', label: 'guess k', min: 1, max: 2000, step: 1 },
                    { type: 'button', label: 'Check guess', onClick: () => tabs.finite.checkGuess() },
                    { type: 'button', label: 'Reveal k', onClick: () => tabs.finite.reveal() },
                ],
            },
            { type: 'group', label: 'Presets', visibleIf: on('finite'), children: presetButtons(tabs.finite, FINITE_PRESETS) },
            // ----- torus -----
            {
                type: 'group', label: 'Lattice Z + τZ', visibleIf: on('torus'), children: [
                    { type: 'slider', key: 'tauRe', label: 'Re τ', min: -1, max: 1, step: 0.005 },
                    { type: 'slider', key: 'tauIm', label: 'Im τ', min: 0.3, max: 2.5, step: 0.005 },
                    { type: 'toggle', key: 'torusReal', label: 'constrain z to the real section (Re τ = 0 or ±1/2)' },
                ],
            },
            { type: 'group', label: 'Presets', visibleIf: on('torus'), children: presetButtons(tabs.torus, TORUS_PRESETS) },
            {
                type: 'info',
                text: 'Real: drag P, Q along the curve; drag the dot in the (a, b) inset across the cusp curve Δ = 0. '
                    + 'F_p: click points to choose P, Q. Torus: drag τ, z₁, z₂. Keys: 1/2/3 tabs, R random, space replay, N add nP.',
            },
        ];
        const panel = ctx.ui.build(schema, store, ctx.drawer);

        return {
            /** Test / debugging hooks. */
            tabs,
            getState: () => ({ tab: tabKey(), real: tabs.real.getState(), finite: tabs.finite.getState(), torus: tabs.torus.getState() }),
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
