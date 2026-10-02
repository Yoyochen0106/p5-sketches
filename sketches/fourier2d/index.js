// Fourier Painter: draw a closed curve and watch epicycles fit it (curve mode), or paint a raster
// image and keep only a subset of its 2D frequencies (image mode).

import { getPalette } from '../approx/palette.js';
import { DEFAULTS } from './state.js';
import { Pen } from './pen.js';
import { RasterPainter, MaskPainter } from './raster.js';
import { CURVE_PRESETS, RASTER_PRESETS, getCurvePreset, getRasterPreset, textPreset } from './presets.js';
import {
    CurveModel, curveLayout, drawCurve, fromScreen, inRect, spectrumHit,
} from './curvePanel.js';
import {
    ImageModel, ImageCache, MASK_MODES, imageLayout, drawImages, cellAt, hitCell,
} from './imagePanel.js';

const MODES = [
    { value: 'curve', label: 'Curve (epicycles)' },
    { value: 'image', label: 'Image (2D Fourier)' },
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

const opts = (list) => list.map((v) => ({ value: v, label: String(v) }));

function buildSchema(actions) {
    const curve = (s) => s.get('mode') === 'curve';
    const image = (s) => s.get('mode') === 'image';
    const imgMode = (m) => (s) => image(s) && s.get('img.mode') === m;
    return [
        {
            type: 'group', label: 'Curve', visibleIf: curve, children: [
                {
                    type: 'select', key: 'curve.preset', label: 'preset',
                    options: [{ value: '', label: 'freehand' }, ...CURVE_PRESETS.map((c) => ({ value: c.id, label: c.label }))],
                },
                { type: 'button', label: 'Undo stroke (Z)', onClick: actions.undo },
                { type: 'button', label: 'Clear (C)', onClick: actions.clearCurve },
                { type: 'slider', key: 'curve.smooth', label: 'smoothing', min: 0, max: 30, step: 1 },
                { type: 'select', key: 'curve.N', label: 'samples N', options: opts([64, 128, 256, 512, 1024]) },
                { type: 'slider', key: 'curve.K', label: 'harmonics K', min: 1, max: 1024, step: 1 },
                {
                    type: 'select', key: 'curve.order', label: 'order',
                    options: [{ value: 'freq', label: 'lowest |frequency| first' }, { value: 'amp', label: 'largest amplitude first' }],
                },
            ],
        },
        {
            type: 'group', label: 'Animation & display', visibleIf: curve, children: [
                { type: 'toggle', key: 'curve.play', label: 'play (Space)' },
                { type: 'slider', key: 'curve.speed', label: 'speed', min: 0.1, max: 8, step: 0.1 },
                { type: 'toggle', key: 'curve.circles', label: 'circles' },
                { type: 'toggle', key: 'curve.arrows', label: 'arrows' },
                { type: 'toggle', key: 'curve.trace', label: 'trace' },
                { type: 'toggle', key: 'curve.partial', label: 'partial-sum curve' },
                { type: 'toggle', key: 'curve.ghost', label: 'original (ghost)' },
                { type: 'toggle', key: 'curve.spectrum', label: 'spectrum' },
                { type: 'slider', key: 'curve.specRange', label: 'spectrum range ±k', min: 8, max: 256, step: 1 },
            ],
        },
        {
            type: 'group', label: 'Canvas', visibleIf: image, children: [
                { type: 'select', key: 'img.n', label: 'grid', options: opts([32, 64, 128]) },
                {
                    type: 'select', key: 'img.preset', label: 'preset',
                    options: [{ value: '', label: 'custom' }, ...RASTER_PRESETS.map((c) => ({ value: c.id, label: c.label }))],
                },
                { type: 'select', key: 'img.tool', label: 'brush', options: [{ value: 'draw', label: 'draw' }, { value: 'erase', label: 'erase' }] },
                { type: 'slider', key: 'img.size', label: 'brush radius', min: 0.5, max: 16, step: 0.5 },
                { type: 'slider', key: 'img.hardness', label: 'hardness', min: 0, max: 1, step: 0.05 },
                { type: 'button', label: 'Fill', onClick: actions.fill },
                { type: 'button', label: 'Clear', onClick: actions.clearImage },
                { type: 'button', label: 'Invert', onClick: actions.invert },
                { type: 'button', label: 'Noise', onClick: actions.noise },
            ],
        },
        {
            type: 'group', label: 'Frequencies kept', visibleIf: image, children: [
                { type: 'select', key: 'img.mode', label: 'mode', options: MASK_MODES },
                { type: 'slider', key: 'img.K', label: 'K (|fx|,|fy| ≤ K)', min: 0, max: 64, step: 1, visibleIf: imgMode('square') },
                { type: 'slider', key: 'img.radius', label: 'radius', min: 0, max: 91, step: 1, visibleIf: imgMode('disc') },
                { type: 'slider', key: 'img.top', label: 'top-K count', min: 1, max: 4096, step: 1, visibleIf: imgMode('topk') },
                { type: 'select', key: 'img.maskTool', label: 'spectrum brush', options: [{ value: 'add', label: 'keep' }, { value: 'remove', label: 'remove' }] },
                { type: 'slider', key: 'img.maskSize', label: 'mask brush radius', min: 0, max: 8, step: 1 },
                { type: 'button', label: 'Mask: keep all', onClick: actions.maskAll },
                { type: 'button', label: 'Mask: keep none', onClick: actions.maskNone },
                { type: 'button', label: 'Mask: copy current mode', onClick: actions.maskCopy },
                { type: 'toggle', key: 'img.error', label: 'error image' },
            ],
        },
        {
            type: 'info',
            text: 'Curve: drag to draw (several strokes join into one closed loop), Z undo, C clear, Space play/pause, '
                + 'click a spectrum bar to toggle that harmonic. Image: drag on the original to paint, drag on the spectrum '
                + 'to paint the kept-frequency mask (it switches to "painted mask"). 1 / 2 switch mode.',
        },
    ];
}

export default {
    id: 'fourier2d',
    title: 'Fourier Painter',
    description: 'Draw a curve and watch epicycles fit it, or paint an image and keep only some 2D frequencies.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const cleanups = [];
        const pen = new Pen();
        const model = new CurveModel();
        const raster = new RasterPainter(Number(get('img.n')) || 64);
        const paint = new MaskPainter(raster.n);
        const imodel = new ImageModel();
        const cache = new ImageCache();
        let p5i = null;

        const st = {
            dirty: true,
            disposed: false,
            t: 0,
            press: null,
            mouse: null,
            lastCurvePreset: null,
            lastImgPreset: null,
            lastN: raster.n,
        };

        const dirty = () => { st.dirty = true; };
        const Kc = () => Math.max(1, Math.min(Number(get('curve.N')), Math.floor(get('curve.K'))));

        function refreshModel() {
            model.update(pen, Number(get('curve.N')), Math.max(0, Math.floor(get('curve.smooth'))), get('curve.order'));
        }

        function detachCurvePreset() {
            st.lastCurvePreset = '';
            if (get('curve.preset') !== '') store.set('curve.preset', '');
        }

        function detachImagePreset() {
            st.lastImgPreset = '';
            if (get('img.preset') !== '') store.set('img.preset', '');
        }

        function loadRasterPreset(id) {
            const pr = getRasterPreset(id);
            if (!pr) return;
            const data = id === 'text' && p5i ? textPreset(p5i, raster.n) : pr.make(raster.n);
            raster.load(raster.n, data);
        }

        /** Apply preset / grid-size changes made through the drawer. */
        function syncSettings() {
            const n = Number(get('img.n'));
            if (n !== raster.n && [32, 64, 128].includes(n)) {
                raster.resize(n);
                paint.resize(n);
            }
            const cp = get('curve.preset');
            if (cp !== st.lastCurvePreset) {
                st.lastCurvePreset = cp;
                const pr = getCurvePreset(cp);
                if (pr) pen.setPreset(pr.points());
            }
            const ip = get('img.preset');
            if (ip !== st.lastImgPreset) {
                st.lastImgPreset = ip;
                loadRasterPreset(ip);
            }
        }

        const actions = {
            undo() { pen.undo(); detachCurvePreset(); dirty(); },
            clearCurve() { pen.clear(); detachCurvePreset(); dirty(); },
            fill() { raster.fill(1); detachImagePreset(); dirty(); },
            clearImage() { raster.clear(); detachImagePreset(); dirty(); },
            invert() { raster.invert(); detachImagePreset(); dirty(); },
            noise() { loadRasterPreset('noise'); detachImagePreset(); dirty(); },
            maskAll() { paint.resize(raster.n); paint.fillAll(true); store.set('img.mode', 'paint'); dirty(); },
            maskNone() { paint.resize(raster.n); paint.fillAll(false); store.set('img.mode', 'paint'); dirty(); },
            maskCopy() {
                paint.load(raster.n, imodel.mask(get, raster, paint));
                store.set('img.mode', 'paint');
                dirty();
            },
        };

        const sketch = (p) => {
            p5i = p;
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
            let curveL = null;
            let imgL = null;

            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(200, s.width), h: Math.max(200, s.height) };
            };

            function layouts() {
                curveL = curveLayout(p.width, p.height, !!get('curve.spectrum'));
                imgL = imageLayout(p.width, p.height, !!get('img.error'));
            }

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                paint.load(raster.n, imodel.mask((k) => (k === 'img.mode' ? 'square' : get(k)), raster, paint));
                syncSettings();
                layouts();
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;

            // ---------- pointer ----------
            function toCell(cell, x, y) {
                return cellAt(cell, raster.n, x, y);
            }

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                layouts();
                const x = p.mouseX, y = p.mouseY;
                st.press = null;
                if (get('mode') === 'curve') {
                    if (inRect(curveL.spec, x, y)) {
                        refreshModel();
                        const k = spectrumHit(curveL, Number(get('curve.N')), get('curve.specRange'), x, y);
                        if (k !== null) model.toggle(k, Kc());
                        st.press = { t: 'spec' };
                    } else if (inRect(curveL.main, x, y)) {
                        detachCurvePreset();
                        pen.begin(fromScreen(curveL, x, y));
                        st.press = { t: 'pen' };
                    }
                } else {
                    const hit = hitCell(imgL, x, y);
                    if (hit === 'orig') {
                        detachImagePreset();
                        const c = toCell(imgL.cells.orig, x, y);
                        raster.dab(c.u, c.v, get('img.size'), get('img.hardness'), get('img.tool') === 'erase');
                        st.press = { t: 'raster', u: c.u, v: c.v };
                    } else if (hit === 'spec') {
                        if (get('img.mode') !== 'paint') {
                            paint.load(raster.n, imodel.mask(get, raster, paint));
                            store.set('img.mode', 'paint');
                        }
                        const c = toCell(imgL.cells.spec, x, y);
                        paint.paint(c.u, c.v, get('img.maskSize'), get('img.maskTool') !== 'remove');
                        st.press = { t: 'mask', u: c.u, v: c.v };
                    }
                }
                dirty();
                return !!st.press;
            }

            function pressDrag() {
                const pr = st.press;
                if (!pr) return;
                const x = p.mouseX, y = p.mouseY;
                if (pr.t === 'pen') {
                    pen.add(fromScreen(curveL, x, y), 2 / curveL.S);
                } else if (pr.t === 'raster') {
                    const c = toCell(imgL.cells.orig, x, y);
                    raster.stroke(pr.u, pr.v, c.u, c.v, get('img.size'), get('img.hardness'), get('img.tool') === 'erase');
                    pr.u = c.u; pr.v = c.v;
                } else if (pr.t === 'mask') {
                    const c = toCell(imgL.cells.spec, x, y);
                    paint.stroke(pr.u, pr.v, c.u, c.v, get('img.maskSize'), get('img.maskTool') !== 'remove');
                    pr.u = c.u; pr.v = c.v;
                }
                dirty();
            }

            function pressEnd() {
                const pr = st.press;
                st.press = null;
                if (pr && pr.t === 'pen') pen.end();
                dirty();
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.mouseMoved = (e) => {
                if (!onCanvas(e)) return;
                st.mouse = { x: p.mouseX, y: p.mouseY };
                if (get('mode') === 'image') dirty();
            };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.press; };
            p.touchEnded = () => { const had = !!st.press; pressEnd(); return !had; };

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
                if (k === '1') store.set('mode', 'curve');
                else if (k === '2') store.set('mode', 'image');
                else if (k === ' ' && get('mode') === 'curve') store.set('curve.play', !get('curve.play'));
                else if ((k === 'z' || k === 'Z') && get('mode') === 'curve') actions.undo();
                else if ((k === 'c' || k === 'C') && get('mode') === 'curve') actions.clearCurve();
                else return true;
                return false;
            };

            // driven by ctx.onResize (debounced, also fires when the drawer opens / closes)
            st.resize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                layouts();
                dirty();
            };

            p.draw = () => {
                if (st.disposed) return;
                const isCurve = get('mode') === 'curve';
                syncSettings();
                refreshModel();
                if (isCurve && get('curve.play') && model.path.length && !pen.active) {
                    const dt = Math.min(100, p.deltaTime || 16.7);
                    st.t = (st.t + (dt / 1000) * get('curve.speed') * 0.1) % 1;
                    st.dirty = true;
                }
                if (!st.dirty) return;
                st.dirty = false;
                layouts();
                p.background(pal.bg);
                if (isCurve) {
                    drawCurve(p, {
                        pen, model, pal, get, t: st.t, K: Kc(), N: Number(get('curve.N')), range: get('curve.specRange'),
                    }, curveL);
                } else {
                    drawImages(p, { raster, paint, model: imodel, cache, pal, get, mouse: st.mouse }, imgL);
                }
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                dirty();
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(dirty));
        cleanups.push(ctx.onResize(() => st.resize && st.resize()));

        const modeTabs = ctx.ui.build([{ type: 'tabs', key: 'mode', options: MODES }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(actions), store, ctx.drawer);

        return {
            unmount() {
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { modeTabs.destroy(); } catch { /* ignore */ }
                try { panel.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
            },
        };
    },
};
