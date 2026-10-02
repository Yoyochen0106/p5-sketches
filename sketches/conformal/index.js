// Conformal Maps: a coordinate grid in the z-plane and its image under w = f(z), with a draggable test point
// showing local magnification, rotation and angle preservation. Maths: lib/conformal.js, drawing: draw.js.

import { Viewport } from '../approx/view.js';
import { getPalette } from '../approx/palette.js';
import { buildMap, defaultParams, presetViews, PRESET_OPTIONS } from './maps.js';
import { drawScene } from './draw.js';

const GAP = 8;
const HIT_PX = 15;
const DEFAULTS = {
    preset: 'z2', grid: 'rect', density: 12, bg: 'none', region: 'none', probe: 0.08,
    z0re: 0.7, z0im: 0.5, t: 1, play: false, draw: false, streams: false, nroots: 3, expr: 'z^2 + 1/z',
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

async function loadParser() {
    try {
        const m = await import('../../lib/expr.js');
        return m.parseExpression || null;
    } catch {
        return null;
    }
}

const finite = (z) => Number.isFinite(z[0]) && Number.isFinite(z[1]);

function buildSchema(reset, clearCurve, snap) {
    const sel = (key, label, options, extra = {}) => ({ type: 'select', key, label, options, ...extra });
    const o = (v, l) => ({ value: v, label: l });
    return [
        {
            type: 'group', label: 'Map', children: [
                sel('preset', 'f(z)', PRESET_OPTIONS),
                {
                    type: 'text', key: 'expr', label: 'formula in z', placeholder: 'z^2 + 1/z',
                    visibleIf: (s) => s.get('preset') === 'custom',
                },
                {
                    type: 'slider', key: 'nroots', label: 'roots', min: 2, max: 5, step: 1,
                    visibleIf: (s) => s.get('preset') === 'poly',
                },
                { type: 'toggle', key: 'streams', label: 'streamlines', visibleIf: (s) => s.get('preset') === 'jouk' },
                { type: 'button', label: 'Reset draggable points', onClick: reset },
            ],
        },
        {
            type: 'group', label: 'Grid', children: [
                sel('grid', 'lines', [o('rect', 'rectangular'), o('polar', 'polar'), o('both', 'both'), o('none', 'none')]),
                { type: 'slider', key: 'density', label: 'density', min: 3, max: 40, step: 1 },
            ],
        },
        {
            type: 'group', label: 'Display', children: [
                sel('bg', 'domain colouring', [o('none', 'off'), o('dom', 'z-plane'), o('img', 'w-plane'), o('both', 'both')]),
                sel('region', 'region and its image', [o('none', 'none'), o('disk', 'unit disk'), o('strip', 'strip 0 < Im z < π'), o('half', 'upper half-plane')]),
                { type: 'slider', key: 'probe', label: 'probe circle size', min: 0.01, max: 0.3, step: 0.01 },
            ],
        },
        {
            type: 'group', label: 'Morph w = (1-t) z + t f(z)', children: [
                { type: 'slider', key: 't', label: 't', min: 0, max: 1, step: 0.01 },
                { type: 'toggle', key: 'play', label: 'play (space)' },
            ],
        },
        {
            type: 'group', label: 'Tools', children: [
                { type: 'toggle', key: 'draw', label: 'free-hand curve in z-plane (H)' },
                { type: 'button', label: 'Clear curve', onClick: clearCurve },
                { type: 'button', label: 'Snap z0 to a critical point (C)', onClick: snap },
            ],
        },
        {
            type: 'info',
            text: 'Drag z0 (or click the z-plane) · drag the other handles (Möbius points, polynomial roots, Joukowski centre) · '
                + 'drag background: pan · wheel: zoom · F: fit views · space: play morph · red diamonds: f′ = 0',
        },
    ];
}

export default {
    id: 'conformal',
    title: 'Conformal Maps',
    description: 'Grids, angles and local magnification under complex maps: z², exp, sin, Joukowski, Möbius, polynomials.',

    async mount(container, ctx) {
        const parse = await loadParser();
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const cleanups = [];
        const dom = { view: new Viewport(-3, 3, -3, 3) };
        const img = { view: new Viewport(-4, 4, -4, 4) };
        const st = {
            params: defaultParams(),
            curve: [],
            press: null,
            dirty: true,
            disposed: false,
            presetKey: '',
            geo: {},
            bg: {},
            probe: null,
            map: null,
            error: null,
            animAt: 0,
            animDir: 1,
            handles: [],
        };
        let doResize = () => {};

        const z0 = () => [get('z0re'), get('z0im')];
        const setZ0 = (z) => {
            if (!finite(z)) return;
            store.set('z0re', z[0]);
            store.set('z0im', z[1]);
        };

        function applyLayout(w, h) {
            const pad = GAP;
            const inner = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
            let a;
            let b;
            if (w >= h * 1.15) {
                const half = (inner.w - GAP) / 2;
                a = { x: inner.x, y: inner.y, w: half, h: inner.h };
                b = { x: inner.x + half + GAP, y: inner.y, w: half, h: inner.h };
            } else {
                const half = (inner.h - GAP) / 2;
                a = { x: inner.x, y: inner.y, w: inner.w, h: half };
                b = { x: inner.x, y: inner.y + half + GAP, w: inner.w, h: half };
            }
            dom.view.setRect(a.x, a.y, a.w, a.h).lockAspect();
            img.view.setRect(b.x, b.y, b.w, b.h).lockAspect();
        }

        function fitViews() {
            const { dv, iv } = presetViews(get('preset'));
            dom.view.set(dv.xmin, dv.xmax, dv.ymin, dv.ymax).lockAspect();
            img.view.set(iv.xmin, iv.xmax, iv.ymin, iv.ymax).lockAspect();
            st.dirty = true;
        }

        function resetPoints() {
            st.params = defaultParams();
            st.dirty = true;
        }

        function currentMap() {
            const r = buildMap(get('preset'), dom.view, st.params, { n: get('nroots'), expr: get('expr'), parse });
            return r;
        }

        function morphed(map, t) {
            if (t >= 1) return map;
            return {
                f: (z) => {
                    const v = map.f(z);
                    return [(1 - t) * z[0] + t * v[0], (1 - t) * z[1] + t * v[1]];
                },
                df: (z) => {
                    const d = map.df(z);
                    return [(1 - t) + t * d[0], t * d[1]];
                },
            };
        }

        function snapToCritical() {
            const crit = (st.map ? st.map.critical : []).filter(finite);
            if (!crit.length) return;
            const a = z0();
            let best = crit[0];
            for (const c of crit) if (Math.hypot(c[0] - a[0], c[1] - a[1]) < Math.hypot(best[0] - a[0], best[1] - a[1])) best = c;
            setZ0(best);
        }

        function buildHandles(map) {
            const hs = [{ id: 'z0', panel: 'dom', z: z0(), color: '#ffd43b', label: 'z0' }];
            const cols = ['#ff6b6b', '#51cf66', '#4dabf7'];
            if (map.id === 'moebius') {
                for (let i = 0; i < 3; i++) {
                    hs.push({ id: `mz${i}`, panel: 'dom', z: st.params.mob.z[i], color: cols[i], label: `z${i + 1}` });
                    hs.push({ id: `mw${i}`, panel: 'img', z: st.params.mob.w[i], color: cols[i], label: `w${i + 1}`, shape: 'square' });
                }
            } else if (map.id === 'poly') {
                for (let i = 0; i < map.roots.length; i++) hs.push({ id: `root${i}`, panel: 'dom', z: map.roots[i], color: '#c77dff', label: `r${i + 1}` });
            } else if (map.id === 'jouk') {
                hs.push({ id: 'jc', panel: 'dom', z: st.params.jc, color: '#ff4d4f', label: 'c' });
            }
            return hs;
        }

        function moveHandle(h, z) {
            if (!finite(z)) return;
            if (h.id === 'z0') setZ0(z);
            else if (h.id === 'jc') st.params.jc = z;
            else if (h.id.startsWith('mz')) st.params.mob.z[+h.id.slice(2)] = z;
            else if (h.id.startsWith('mw')) st.params.mob.w[+h.id.slice(2)] = z;
            else if (h.id.startsWith('root')) st.params.roots[+h.id.slice(4)] = z;
            st.dirty = true;
        }

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
                applyLayout(w, h);
                fitViews();
            };

            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                applyLayout(w, h);
                st.dirty = true;
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;
            const panelAt = (x, y) => (dom.view.contains(x, y) ? 'dom' : img.view.contains(x, y) ? 'img' : null);
            const viewOf = (which) => (which === 'dom' ? dom.view : img.view);

            function hitHandle(which, x, y) {
                let best = null;
                let bd = HIT_PX;
                const vp = viewOf(which);
                for (const h of st.handles) {
                    if (h.panel !== which) continue;
                    const d = Math.hypot(vp.toX(h.z[0]) - x, vp.toY(h.z[1]) - y);
                    if (d <= bd) { bd = d; best = h; }
                }
                return best;
            }

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                const which = panelAt(p.mouseX, p.mouseY);
                if (!which) { st.press = null; return false; }
                const h = hitHandle(which, p.mouseX, p.mouseY);
                if (h) st.press = { kind: 'handle', h, which };
                else if (get('draw') && which === 'dom') {
                    st.curve = [[dom.view.fromX(p.mouseX), dom.view.fromY(p.mouseY)]];
                    st.press = { kind: 'draw', which, lx: p.mouseX, ly: p.mouseY };
                    st.dirty = true;
                } else st.press = { kind: 'pan', which, x: p.mouseX, y: p.mouseY, moved: false };
                return true;
            }

            function pressDrag() {
                const pr = st.press;
                if (!pr) return;
                const vp = viewOf(pr.which);
                if (pr.kind === 'handle') {
                    moveHandle(pr.h, [vp.fromX(p.mouseX), vp.fromY(p.mouseY)]);
                } else if (pr.kind === 'draw') {
                    if (Math.hypot(p.mouseX - pr.lx, p.mouseY - pr.ly) >= 3 && st.curve.length < 2000) {
                        pr.lx = p.mouseX;
                        pr.ly = p.mouseY;
                        st.curve.push([vp.fromX(p.mouseX), vp.fromY(p.mouseY)]);
                        st.dirty = true;
                    }
                } else {
                    if (Math.hypot(p.mouseX - pr.x, p.mouseY - pr.y) > 4) pr.moved = true;
                    if (pr.moved) {
                        vp.panPx(p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
                        st.dirty = true;
                    }
                }
            }

            function pressEnd() {
                const pr = st.press;
                st.press = null;
                if (pr && pr.kind === 'pan' && !pr.moved && pr.which === 'dom') {
                    setZ0([dom.view.fromX(pr.x), dom.view.fromY(pr.y)]);
                }
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.press; };
            p.touchEnded = () => { pressEnd(); return !st.press; };

            p.mouseWheel = (e) => {
                if (!onCanvas(e)) return true;
                const which = panelAt(p.mouseX, p.mouseY);
                if (!which) return true;
                let d = e.delta || 0;
                if (e.deltaMode === 1) d *= 33;
                else if (e.deltaMode === 2) d *= 400;
                d = Math.max(-300, Math.min(300, d));
                viewOf(which).zoomAt(p.mouseX, p.mouseY, Math.exp(d * 0.0012));
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
                if (k === ' ') store.set('play', !get('play'));
                else if (k === 'f' || k === 'F') fitViews();
                else if (k === 'c' || k === 'C') snapToCritical();
                else if (k === 'h' || k === 'H') store.set('draw', !get('draw'));
                else return true;
                return false;
            };

            function tickAnimation() {
                if (!get('play')) return;
                const now = Date.now();
                const dt = st.animAt ? Math.min(0.1, (now - st.animAt) / 1000) : 0;
                st.animAt = now;
                let t = get('t') + st.animDir * dt / 3;
                if (t >= 1) { t = 1; st.animDir = -1; } else if (t <= 0) { t = 0; st.animDir = 1; }
                store.set('t', t);
            }

            p.draw = () => {
                if (st.disposed) return;
                if (get('play')) tickAnimation();
                else st.animAt = 0;
                if (!st.dirty) return;
                st.dirty = false;

                const key = `${get('preset')}`;
                if (key !== st.presetKey) {
                    st.presetKey = key;
                    st.geo = {};
                    fitViews();
                }
                const { map, error } = currentMap();
                st.map = map;
                st.error = error;
                st.handles = buildHandles(map);
                const t = Math.max(0, Math.min(1, +get('t')));
                const F = morphed(map, t);
                const rho = get('probe') * (dom.view.xmax - dom.view.xmin);
                drawScene(p, {
                    p, pal, st, get, dom, img, map, F, t, params: st.params, handles: st.handles,
                    z0: z0(), rho, error, title: `${mapTitle(get('preset'))}${t < 1 ? ' (morph)' : ''}`,
                });
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                st.geo = {};
                st.dirty = true;
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(() => { st.dirty = true; }));
        cleanups.push(ctx.onResize(() => doResize()));

        const panel = ctx.ui.build(buildSchema(resetPoints, () => { st.curve = []; st.dirty = true; }, snapToCritical), store, ctx.drawer);

        return {
            /** Snapshot for tests / debugging. */
            getState: () => ({ probe: st.probe, map: st.map, params: st.params, curve: st.curve, error: st.error, handles: st.handles }),
            unmount() {
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

function mapTitle(id) {
    const o = PRESET_OPTIONS.find((q) => q.value === id);
    return o ? `w = ${o.label}` : '';
}
