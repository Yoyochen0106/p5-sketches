// Iterated Function Systems & Moebius Groups: an affine IFS editor with a chaos-game renderer, Kleinian /
// Schottky groups and their limit sets on the plane, and the same limit sets on the Riemann sphere.

import { getPalette } from '../approx/palette.js';
import { IFS_PRESETS } from '../../lib/ifs.js';
import { DEFAULTS, TABS, KLEIN_PRESETS } from './presets.js';
import { createIfsTab, MAX_MAPS } from './ifs-tab.js';
import { createPlaneTab } from './plane-tab.js';
import { createSphereTab } from './sphere-tab.js';
import { offCanvas, isPrimary, typing } from './view.js';

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

const tabIs = (...names) => (s) => names.includes(s.get('tab'));
const kindIs = (...kinds) => (s) => s.get('tab') !== 'ifs' && kinds.includes(s.get('kl.kind'));
const num = (list) => list.map((v) => ({ value: v, label: v.toLocaleString('en-US') }));

function buildSchema(a) {
    const wSliders = [];
    for (let i = 0; i < MAX_MAPS; i++) {
        wSliders.push({ type: 'slider', key: `ifs.w${i}`, label: `weight of map ${i + 1}`, min: 0.01, max: 1, step: 0.01, visibleIf: (s) => !s.get('ifs.autoW') && i < s.get('ifs.count') });
    }
    const thetaSliders = [0, 1, 2].map((k) => ({
        type: 'slider', key: `kl.theta${k}`, label: `twist of generator ${String.fromCharCode(97 + k)} (rad)`, min: -3.1416, max: 6.2832, step: 0.01,
        visibleIf: (s) => s.get('kl.kind') === 'schottky' && k < s.get('kl.nGens') && s.get('tab') !== 'ifs',
    }));
    return [
        {
            type: 'group', label: 'Affine IFS', visibleIf: tabIs('ifs'), children: [
                { type: 'select', key: 'ifs.preset', label: 'preset', options: IFS_PRESETS.map((q) => ({ value: q.id, label: q.label })) },
                {
                    type: 'select', key: 'ifs.color', label: 'colouring',
                    options: [{ value: 'tag', label: 'by last map applied' }, { value: 'density', label: 'density (log)' }, { value: 'flat', label: 'flat' }],
                },
                { type: 'select', key: 'ifs.speed', label: 'iterations per frame', options: num([20000, 100000, 400000]) },
                { type: 'toggle', key: 'ifs.paused', label: 'pause (Space)' },
                { type: 'toggle', key: 'ifs.showMaps', label: 'show / edit the maps' },
                { type: 'toggle', key: 'ifs.autoW', label: 'weights proportional to |det| (area)' },
                ...wSliders,
                { type: 'button', label: 'Add a map', onClick: a.ifs.add },
                { type: 'button', label: 'Remove the selected map', onClick: a.ifs.remove },
                { type: 'button', label: 'Restart accumulation (C)', onClick: a.ifs.clear },
                { type: 'button', label: 'Reset preset', onClick: a.ifs.reset },
                { type: 'button', label: 'Estimate box-counting dimension', onClick: a.ifs.boxCount },
                {
                    type: 'info', text: 'Each map is the image of the dashed reference rectangle. Drag the square corner (or the inside) to move a map, '
                        + 'the two round corners to change its edge vectors; drag the background to pan, wheel to zoom. The attractor is drawn by the chaos game.',
                },
            ],
        },
        {
            type: 'group', label: 'Moebius group', visibleIf: tabIs('plane', 'sphere'), children: [
                {
                    type: 'select', key: 'kl.preset', label: 'preset',
                    options: [{ value: '', label: 'custom' }, ...KLEIN_PRESETS.map((q) => ({ value: q.id, label: q.label }))],
                },
                {
                    type: 'select', key: 'kl.method', label: 'limit set from',
                    options: [{ value: 'chaos', label: 'chaos game (random reduced words)' }, { value: 'words', label: 'word enumeration' }, { value: 'both', label: 'both' }],
                },
                { type: 'slider', key: 'kl.depth', label: 'word depth / gasket depth', min: 1, max: 14, step: 1 },
                { type: 'select', key: 'kl.speed', label: 'points per frame', options: num([10000, 60000, 200000]) },
                {
                    type: 'select', key: 'kl.color', label: 'colouring',
                    options: [{ value: 'letter', label: 'by first letters of the word' }, { value: 'density', label: 'density (log)' }, { value: 'flat', label: 'flat' }],
                },
                { type: 'toggle', key: 'kl.paused', label: 'pause (Space)' },
                { type: 'select', key: 'kl.nGens', label: 'generators (circle pairs)', options: [1, 2, 3], visibleIf: kindIs('schottky') },
                ...thetaSliders,
                { type: 'slider', key: 'kl.taRe', label: 'Re tr a', min: -4, max: 4, step: 0.01, visibleIf: kindIs('recipe', 'maskit') },
                { type: 'slider', key: 'kl.taIm', label: 'Im tr a  (mu = tr a in the Maskit slice)', min: -4, max: 4, step: 0.01, visibleIf: kindIs('recipe', 'maskit') },
                { type: 'slider', key: 'kl.tbRe', label: 'Re tr b', min: -4, max: 4, step: 0.01, visibleIf: kindIs('recipe') },
                { type: 'slider', key: 'kl.tbIm', label: 'Im tr b', min: -4, max: 4, step: 0.01, visibleIf: kindIs('recipe') },
                { type: 'toggle', key: 'kl.showCircles', label: 'fundamental-domain circles' },
                { type: 'toggle', key: 'kl.showOrbit', label: 'orbit of the test point' },
                { type: 'slider', key: 'kl.orbitDepth', label: 'orbit depth (word length)', min: 1, max: 5, step: 1, visibleIf: (s) => !!s.get('kl.showOrbit') },
                { type: 'button', label: 'Restart accumulation (C)', onClick: a.plane.clear },
                { type: 'button', label: 'Fit view', onClick: a.plane.fit },
                { type: 'button', label: 'Reset preset', onClick: a.plane.reset },
                {
                    type: 'info', text: 'Schottky presets: drag a circle by its square handle, its radius by the round handle; arrows point from the circle a generator '
                        + 'maps the outside of onto the circle it maps it into. Two-generator presets use Grandma\'s recipe: tr[a, b] = -2 is solved for tr(ab). '
                        + 'Drag the cross to move the test point; drag the background to pan, wheel to zoom.',
                },
            ],
        },
        {
            type: 'group', label: 'Riemann sphere', visibleIf: tabIs('sphere'), children: [
                { type: 'toggle', key: 'sp.spin', label: 'rotate the sphere' },
                { type: 'slider', key: 'sp.speed', label: 'rotation speed (rad/s)', min: -2, max: 2, step: 0.05, visibleIf: (s) => !!s.get('sp.spin') },
                { type: 'toggle', key: 'sp.circles', label: 'generator circles on the sphere' },
                { type: 'toggle', key: 'sp.graticule', label: 'graticule' },
                { type: 'select', key: 'sp.size', label: 'point size', options: [1, 2, 3] },
                { type: 'button', label: 'Reset camera (R)', onClick: a.sphere.reset },
            ],
        },
    ];
}

export default {
    id: 'kleinian',
    title: 'Iterated Function Systems & Moebius Groups',
    description: 'Affine IFS fractals by the chaos game, and Schottky / Kleinian group limit sets on the plane and the Riemann sphere.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const set = (k, v) => store.set(k, v);
        const cleanups = [];
        const st = { disposed: false, ifs: null, plane: null, sphere: null, palKey: '', pal: null };

        const pal = () => {
            const theme = ctx.globalSettings.get('theme', 'dark');
            if (st.palKey !== theme || !st.pal) { st.palKey = theme; st.pal = getPalette(theme); }
            return st.pal;
        };

        const actions = {
            ifs: {
                add: () => st.ifs && st.ifs.actions.add(),
                remove: () => st.ifs && st.ifs.actions.remove(),
                clear: () => st.ifs && st.ifs.actions.clear(),
                reset: () => st.ifs && st.ifs.actions.reset(),
                boxCount: () => st.ifs && st.ifs.actions.boxCount(),
            },
            plane: {
                clear: () => st.plane && st.plane.actions.clear(),
                fit: () => st.plane && st.plane.actions.fit(),
                reset: () => st.plane && st.plane.actions.reset(),
            },
            sphere: { reset: () => st.sphere && st.sphere.controller.reset() },
        };

        const sketch = (p) => {
            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(240, s.width), h: Math.max(240, s.height) };
            };
            const env = {
                p, get, set, pal,
                rect: () => ({ x: 0, y: 0, w: p.width, h: p.height }),
            };
            const tab = () => get('tab');

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
                st.ifs = createIfsTab(env);
                st.plane = createPlaneTab(env);
                st.sphere = createSphereTab(env, st.plane);
            };

            const flat = () => (tab() === 'ifs' ? st.ifs : st.plane);

            // ---------- pointer ----------
            p.mousePressed = (e) => {
                if (st.disposed || !st.ifs || offCanvas(p, e)) return;
                if (tab() === 'sphere') { st.sphere.controller.mousePressed(e); return; }
                if (!isPrimary(p)) return;
                flat().press(p.mouseX, p.mouseY);
            };
            p.mouseDragged = () => {
                if (st.disposed || !st.ifs) return;
                if (tab() === 'sphere') { st.sphere.controller.mouseDragged(); return; }
                flat().dragTo(p.mouseX, p.mouseY);
            };
            p.mouseReleased = () => {
                if (st.disposed || !st.ifs) return;
                st.sphere.controller.mouseReleased();
                st.ifs.release();
                st.plane.release();
            };
            p.doubleClicked = (e) => {
                if (st.disposed || !st.ifs || tab() !== 'sphere' || offCanvas(p, e)) return;
                st.sphere.controller.doubleClicked(e);
            };
            p.touchStarted = (e) => {
                if (st.disposed || !st.ifs || offCanvas(p, e)) return true;
                if (tab() === 'sphere') return st.sphere.controller.touchStarted(e);
                return !flat().press(p.mouseX, p.mouseY);
            };
            p.touchMoved = () => {
                if (st.disposed || !st.ifs) return true;
                if (tab() === 'sphere') return st.sphere.controller.touchMoved();
                return !flat().dragTo(p.mouseX, p.mouseY);
            };
            p.touchEnded = () => {
                if (st.disposed || !st.ifs) return true;
                if (tab() === 'sphere') return st.sphere.controller.touchEnded();
                st.ifs.release();
                st.plane.release();
                return true;
            };
            p.mouseWheel = (e) => {
                if (st.disposed || !st.ifs || offCanvas(p, e)) return true;
                if (tab() === 'sphere') return st.sphere.controller.mouseWheel(e);
                if (!flat().wheel(e, p.mouseX, p.mouseY)) return true;
                if (e && e.preventDefault) e.preventDefault();
                return false;
            };

            // ---------- keyboard ----------
            p.keyPressed = (e) => {
                if (st.disposed || !st.ifs) return true;
                if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
                const k = p.key;
                if (typing(k)) return true;
                const t = tab();
                if (k === ' ') {
                    const key = t === 'ifs' ? 'ifs.paused' : 'kl.paused';
                    set(key, !get(key));
                    return false;
                }
                const lk = typeof k === 'string' ? k.toLowerCase() : k;
                if (lk === 'c' && t !== 'sphere') { flat().actions.clear(); return false; }
                if (lk === 'r' && t === 'sphere') { st.sphere.controller.reset(); return false; }
                return true;
            };

            // ---------- resize ----------
            const resize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
            };
            cleanups.push(ctx.onResize(resize));

            // ---------- drawing ----------
            p.draw = () => {
                if (st.disposed || !st.ifs) return;
                const t = tab();
                const c = pal();
                if (t === 'ifs') {
                    st.ifs.sync();
                    st.ifs.step();
                    p.background(c.bg);
                    st.ifs.draw();
                    return;
                }
                st.plane.sync();
                st.plane.step();
                p.background(c.bg);
                if (t === 'sphere') {
                    st.sphere.step();
                    st.sphere.draw();
                } else {
                    st.plane.draw();
                }
            };
        };

        const instance = new ctx.p5(sketch, container);
        const toolTabs = ctx.ui.build([{ type: 'tabs', key: 'tab', options: TABS }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(actions), store, ctx.drawer);

        return {
            /** Exposed for inspection (tests, debugging). */
            get ifs() { return st.ifs; },
            get plane() { return st.plane; },
            get sphere() { return st.sphere; },
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
