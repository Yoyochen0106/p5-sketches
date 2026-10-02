// Equal-Area Transformations: a triangle keeps its area while a vertex slides along the line
// parallel to the opposite side (a shear). Tabs: triangle, polygon reduction, quadrature.

import { getPalette } from '../approx/palette.js';
import { View, WORLD } from './view.js';
import { Model, TRI_PRESETS, POLY_PRESETS } from './model.js';
import { drawGrid, drawTriangleTab, drawPolygonTab, drawQuadTab, drawFooter } from './draw.js';

const TABS = [
    { value: 'triangle', label: 'Triangle' },
    { value: 'polygon', label: 'Polygon' },
    { value: 'quadrature', label: 'Quadrature' },
];

export const DEFAULTS = {
    tab: 'triangle',
    constrained: true,
    snap: false,
    pick: false,
    trail: true,
    second: false,
    grid: true,
    paused: false,
    speed: 1,
    'preset.triangle': 'lattice',
    'preset.polygon': 'pentagon',
};

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

function buildSchema(model, store) {
    const tab = (id) => (s) => s.get('tab') === id;
    const options = (presets) => Object.entries(presets).map(([value, pr]) => ({ value, label: pr.label }));
    return [
        {
            type: 'group', label: 'Animation', children: [
                { type: 'toggle', key: 'paused', label: 'pause (space)' },
                { type: 'slider', key: 'speed', label: 'speed', min: 0.25, max: 3, step: 0.05, format: (v) => `${Number(v).toFixed(2)}x` },
                { type: 'button', label: 'Step (N)', onClick: () => model.stepForward() },
                { type: 'button', label: 'Reset (R)', onClick: () => model.reset() },
            ],
        },
        {
            type: 'group', label: 'Triangle', visibleIf: tab('triangle'), children: [
                { type: 'select', key: 'preset.triangle', label: 'preset', options: options(TRI_PRESETS) },
                { type: 'toggle', key: 'constrained', label: 'slide along the parallel guide (C)' },
                { type: 'toggle', key: 'snap', label: 'snap to integer grid (G)' },
                { type: 'toggle', key: 'pick', label: "Pick's theorem lattice points (P)" },
                { type: 'toggle', key: 'second', label: 'second triangle, same base (S)' },
                { type: 'toggle', key: 'trail', label: 'trail of the vertex (T)' },
            ],
        },
        {
            type: 'group', label: 'Polygon', visibleIf: tab('polygon'), children: [
                { type: 'select', key: 'preset.polygon', label: 'preset', options: options(POLY_PRESETS) },
                { type: 'toggle', key: 'constrained', label: 'drag along the parallel guide (C)' },
                { type: 'toggle', key: 'snap', label: 'snap to integer grid (G)' },
                { type: 'button', label: 'Reduce (Enter)', onClick: () => model.reduce() },
                { type: 'button', label: 'Play all (Y)', onClick: () => model.startPlayAll() },
                { type: 'button', label: 'Undo (U)', onClick: () => model.undo() },
                { type: 'button', label: 'Add vertex (A)', onClick: () => model.addVertex() },
                { type: 'button', label: 'Remove vertex (X)', onClick: () => model.removeVertex() },
            ],
        },
        {
            type: 'group', label: 'Quadrature', visibleIf: tab('quadrature'), children: [
                { type: 'button', label: 'Play / pause', onClick: () => model.toggleQuadPlaying() },
                { type: 'button', label: 'Previous step (B)', onClick: () => model.stepBack() },
                { type: 'button', label: 'Restart', onClick: () => model.restartQuad() },
                { type: 'info', text: 'The triangle comes from the Triangle tab: change it there to square another triangle.' },
            ],
        },
        { type: 'toggle', key: 'grid', label: 'grid' },
        {
            type: 'info',
            text: '1 2 3: tabs · drag a vertex (it slides along its guide) · C: constrained/free · G: snap · '
                + 'Enter: reduce · Y: play all · U: undo · A / X: add / remove vertex · space: pause · N: step · R: reset',
        },
    ];
}

export default {
    id: 'equal-area',
    title: 'Equal-Area Transformations',
    description: 'Slide a vertex parallel to the opposite side: the area never changes. Triangles, polygon reduction and squaring the triangle.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const cleanups = [];
        const model = new Model((k) => store.get(k));
        const view = new View();
        const st = { disposed: false };
        const applied = { tri: null, poly: null, snap: false };
        let doResize = () => {};

        /** Push settings changes (tab, presets, snapping) into the model. */
        function sync() {
            if (st.disposed) return;
            const tab = store.get('tab');
            if (tab !== model.tab) model.setTab(tab);
            const pt = store.get('preset.triangle');
            if (pt !== applied.tri) { applied.tri = pt; model.applyPreset('triangle', pt); }
            const pp = store.get('preset.polygon');
            if (pp !== applied.poly) { applied.poly = pp; model.applyPreset('polygon', pp); }
            if (store.get('pick') && !store.get('snap')) store.set('snap', true);
            const snap = !!store.get('snap');
            if (snap && !applied.snap) model.snapAll();
            applied.snap = snap;
        }
        sync();

        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));

            function sizeNow() {
                const s = ctx.size();
                return { w: Math.max(200, s.width), h: Math.max(200, s.height) };
            }

            function layout() {
                const world = model.tab === 'quadrature' ? model.quad.bbox : WORLD;
                const narrow = p.width < 560;
                view.fit(world, p.width, p.height, { top: narrow ? 150 : 110, bottom: 36, left: 18, right: 18 });
            }

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                layout();
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;
            const isTouch = (e) => !!e && typeof e.type === 'string' && e.type.startsWith('touch');

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                layout();
                const w = view.toWorld(p.mouseX, p.mouseY);
                const radius = (isTouch(e) ? 28 : 18) / view.scale;
                return model.press(w, radius);
            }

            function pressDrag() {
                if (!model.drag) return;
                layout();
                model.dragTo(view.toWorld(p.mouseX, p.mouseY));
            }

            function pressEnd() {
                if (!model.drag) return;
                model.release();
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.mouseMoved = (e) => {
                if (!onCanvas(e) || model.tab === 'quadrature') { model.hover = -1; return; }
                layout();
                const w = view.toWorld(p.mouseX, p.mouseY);
                let best = -1;
                let bd = 16 / view.scale;
                model.shape().forEach((q, i) => {
                    const d = Math.hypot(q.x - w.x, q.y - w.y);
                    if (d <= bd) { bd = d; best = i; }
                });
                model.hover = best;
            };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !model.drag; };
            p.touchEnded = () => { const had = !!model.drag; pressEnd(); return !had; };

            function typing(k) {
                const el = globalThis.document && globalThis.document.activeElement;
                if (!el) return false;
                if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
                return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
            }

            const toggle = (key) => store.set(key, !store.get(key));

            p.keyPressed = (e) => {
                if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
                const k = p.key;
                if (typing(k)) return true;
                const lower = typeof k === 'string' ? k.toLowerCase() : '';
                if (k === '1') store.set('tab', 'triangle');
                else if (k === '2') store.set('tab', 'polygon');
                else if (k === '3') store.set('tab', 'quadrature');
                else if (k === ' ') {
                    if (model.tab === 'quadrature' && !store.get('paused')) model.toggleQuadPlaying();
                    else toggle('paused');
                } else if (lower === 'n' || p.keyCode === p.RIGHT_ARROW) model.stepForward();
                else if (lower === 'b' || p.keyCode === p.LEFT_ARROW) model.stepBack();
                else if (lower === 'r') model.reset();
                else if (lower === 'c') toggle('constrained');
                else if (lower === 'g') toggle('snap');
                else if (lower === 'p') toggle('pick');
                else if (lower === 's') toggle('second');
                else if (lower === 't') toggle('trail');
                else if (k === 'Enter' || p.keyCode === p.ENTER) model.reduce();
                else if (lower === 'y') model.startPlayAll();
                else if (lower === 'u' || lower === 'z') model.undo();
                else if (lower === 'a') model.addVertex();
                else if (lower === 'x') model.removeVertex();
                else return true;
                return false;
            };

            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
            };

            p.draw = () => {
                if (st.disposed) return;
                const raw = Number.isFinite(p.deltaTime) ? p.deltaTime / 1000 : 1 / 60;
                const dt = Math.min(0.1, Math.max(0, raw));
                const speed = Math.min(3, Math.max(0.1, Number(store.get('speed')) || 1));
                if (!store.get('paused')) model.update(dt * speed);
                layout();
                const constrained = !!store.get('constrained');
                if (model.tab === 'quadrature') {
                    p.background(pal.bg);
                    drawQuadTab(p, view, model, pal);
                } else {
                    drawGrid(p, view, pal, !!store.get('grid'));
                    if (model.tab === 'triangle') {
                        drawTriangleTab(p, view, model, pal, {
                            pick: !!store.get('pick'), trail: !!store.get('trail'), second: !!store.get('second'),
                            constrained, snap: !!store.get('snap'),
                        });
                    } else {
                        drawPolygonTab(p, view, model, pal, { constrained });
                    }
                }
                if (store.get('paused')) drawFooter(p, pal, 'paused: press N to step, space to resume');
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(sync));
        cleanups.push(ctx.onResize(() => doResize()));

        const tabs = ctx.ui.build([{ type: 'tabs', key: 'tab', options: TABS }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(model, store), store, ctx.drawer);

        return {
            model, // exposed for tests
            unmount() {
                if (st.disposed) return;
                st.disposed = true;
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
