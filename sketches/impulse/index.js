// Impulse Response Lab: draw an input x(t) and an output y(t) like a terrain, and read off the
// system's impulse response h(t) (y = x * h), each in the time and frequency domain.

import { getPalette } from '../approx/palette.js';
import { DEFAULTS, FS_OPTIONS, METHODS, TOOLS } from './state.js';
import { ImpulseModel, SIZES } from './model.js';
import { X_PRESETS, SYSTEM_PRESETS, getXPreset, getSystemPreset } from './presets.js';
import { raise, smooth, flatten, lineSegment } from './brush.js';
import {
    PlotRenderer, gridLayout, hitPlot, timeIndexAt, timeValueAt, binAt, magValueAt,
} from './plots.js';

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
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function buildSchema(actions) {
    const sysIs = (id) => (s) => s.get('preset.sys') === id;
    return [
        {
            type: 'group', label: 'Signals', children: [
                { type: 'select', key: 'active', label: 'edit signal (click a time plot)', options: [{ value: 'x', label: 'x  input' }, { value: 'y', label: 'y  output' }, { value: 'h', label: 'h  impulse response' }] },
                {
                    type: 'select', key: 'derived', label: 'computed signal',
                    options: [{ value: 'h', label: 'solve h  (from x, y)' }, { value: 'y', label: 'solve y  (y = x * h)' }, { value: 'x', label: 'solve x  (from y, h)' }],
                },
                { type: 'select', key: 'n', label: 'samples N', options: opts(SIZES) },
                { type: 'select', key: 'fs', label: 'sample rate fs (Hz)', options: opts(FS_OPTIONS) },
                { type: 'select', key: 'preset.x', label: 'input preset', options: [{ value: '', label: 'custom' }, ...X_PRESETS.map((c) => ({ value: c.id, label: c.label }))] },
                { type: 'select', key: 'preset.sys', label: 'system preset (generates y)', options: [{ value: '', label: 'none (y as drawn)' }, ...SYSTEM_PRESETS.map((c) => ({ value: c.id, label: c.label }))] },
                { type: 'slider', key: 'sys.delay', label: 'echo delay (% of N)', min: 1, max: 60, step: 1, visibleIf: sysIs('echo') },
                { type: 'slider', key: 'sys.gain', label: 'echo gain', min: -1, max: 1.5, step: 0.05, visibleIf: sysIs('echo') },
                { type: 'slider', key: 'noise', label: 'noise on y (% of rms)', min: 0, max: 50, step: 0.5 },
            ],
        },
        {
            type: 'group', label: 'Brush', children: [
                { type: 'slider', key: 'radius', label: 'radius (% of N)', min: 0.5, max: 30, step: 0.5 },
                { type: 'slider', key: 'soft', label: 'softness', min: 0, max: 1, step: 0.05 },
                { type: 'slider', key: 'strength', label: 'strength', min: 0.05, max: 2, step: 0.05 },
                { type: 'toggle', key: 'mirror', label: 'symmetric (mirror) (M)' },
                { type: 'button', label: 'Undo (Z)', onClick: actions.undo },
                { type: 'button', label: 'Redo (Shift+Z)', onClick: actions.redo },
                { type: 'button', label: 'Clear active signal (C)', onClick: actions.clear },
            ],
        },
        {
            type: 'group', label: 'Deconvolution', children: [
                { type: 'select', key: 'method', label: 'method', options: METHODS },
                { type: 'slider', key: 'lambda', label: 'lambda (log10, relative)', min: -12, max: 0, step: 0.1 },
                { type: 'button', label: 'Auto lambda (A)', onClick: actions.auto },
                { type: 'slider', key: 'support', label: 'support length L (% of N)', min: 2, max: 100, step: 1 },
                {
                    type: 'select', key: 'phaseModel', label: 'phase when painting |H|',
                    options: [{ value: 'minimum', label: 'minimum phase (cepstrum)' }, { value: 'linear', label: 'linear phase (zero phase, delayed)' }],
                },
            ],
        },
        {
            type: 'group', label: 'Display', children: [
                { type: 'toggle', key: 'magDb', label: 'magnitude in dB' },
                { type: 'slider', key: 'dbRange', label: 'dB range', min: 20, max: 140, step: 5, visibleIf: (s) => !!s.get('magDb') },
                { type: 'select', key: 'phase', label: 'phase', options: [{ value: 'wrapped', label: 'wrapped' }, { value: 'unwrapped', label: 'unwrapped' }] },
                { type: 'toggle', key: 'groupDelay', label: 'group delay' },
                { type: 'toggle', key: 'recon', label: 'show x * h over y (dashed) and residual' },
                { type: 'button', label: 'Reset time view (0)', onClick: actions.resetView },
            ],
        },
        {
            type: 'info',
            text: 'Left button raises the curve under the brush, right button lowers it (touch: use the tool tabs). '
                + 'Click a time plot to choose which signal you edit; wheel zooms and Shift/middle-drag pans the shared time axis. '
                + 'Drag in the |H| plot to paint the filter response. Keys: R L S F P tools, 1 2 3 signal, Z undo, M mirror, A auto lambda.',
        },
    ];
}

export default {
    id: 'impulse',
    title: 'Impulse Response Lab',
    description: 'Draw an input and an output like a terrain and recover the impulse response h with y = x * h, in time and frequency.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const cleanups = [];
        const validN = (v) => (SIZES.includes(Number(v)) ? Number(v) : 256);
        const model = new ImpulseModel(validN(get('n')));
        const renderer = new PlotRenderer();

        const st = {
            disposed: false,
            dirty: true,
            view: { a: 0, b: model.n - 1 },
            hover: null,
            stroke: null,
            pan: null,
            moved: false,
            hmag: null,
            layout: null,
            lastN: model.n,
            lastX: null,
            lastSys: null,
            lastSysKey: '',
            lastNoise: null,
            lastDerived: null,
        };
        const dirty = () => { st.dirty = true; };
        const solveParams = () => ({
            derived: get('derived'),
            method: get('method'),
            lambdaLog: Number(get('lambda')),
            supportPct: clamp(Number(get('support')) || 100, 1, 100),
        });

        // ---------- presets & settings synchronisation ----------
        function resetView() {
            st.view = { a: 0, b: model.n - 1 };
            dirty();
        }

        function dropTruth() {
            if (model.truth) { model.truth = null; model.truthVer++; }
            st.lastSys = '';
            if (get('preset.sys') !== '') store.set('preset.sys', '');
        }

        function detachXPreset() {
            st.lastX = '';
            if (get('preset.x') !== '') store.set('preset.x', '');
        }

        function applyXPreset(id) {
            const pr = getXPreset(id);
            if (!pr) return;
            model.load('x', pr.make(model.n));
            if (model.truth) model.regenerateY();
        }

        function applySystem(id) {
            const pr = getSystemPreset(id);
            if (!pr) { model.truth = null; model.truthVer++; return; }
            model.setTruth(pr.make(model.n, { delay: Number(get('sys.delay')) / 100, gain: Number(get('sys.gain')) }));
        }

        function syncSettings() {
            const n = validN(get('n'));
            let regen = false;
            if (n !== model.n) {
                model.resize(n);
                st.lastN = n;
                resetView();
                st.hmag = null;
                regen = true;
            }
            const derived = get('derived');
            if (derived !== st.lastDerived) {
                st.lastDerived = derived;
                if (derived !== 'h' && (model.truth || get('preset.sys'))) dropTruth();
            }
            const xp = get('preset.x');
            if (regen || xp !== st.lastX) {
                const prev = { px: st.lastX || '', ps: st.lastSys || '' };
                st.lastX = xp;
                if (xp) {
                    pushUndo(prev);
                    applyXPreset(xp);
                    if (get('derived') === 'x') store.set('derived', 'h');
                }
            }
            const sp = get('preset.sys');
            const sysKey = `${sp}|${get('sys.delay')}|${get('sys.gain')}`;
            if (regen || sp !== st.lastSys || (sp === 'echo' && sysKey !== st.lastSysKey)) {
                const changed = sp !== st.lastSys;
                const prev = { px: st.lastX || '', ps: st.lastSys || '' };
                st.lastSys = sp;
                st.lastSysKey = sysKey;
                if (sp) {
                    if (changed || regen) pushUndo(prev);
                    if (get('derived') !== 'h') { store.set('derived', 'h'); st.lastDerived = 'h'; }
                    applySystem(sp);
                } else if (model.truth) {
                    model.truth = null; model.truthVer++;
                }
            }
            const noise = Number(get('noise'));
            if (noise !== st.lastNoise) {
                st.lastNoise = noise;
                model.setNoise(noise);
            }
        }

        function pushUndo(meta) {
            model.meta = meta || { px: get('preset.x'), ps: get('preset.sys') };
            model.pushUndo();
        }

        function restoreMeta() {
            const m = model.meta;
            if (!m) return;
            st.lastX = m.px;
            st.lastSys = m.ps;
            st.lastSysKey = `${m.ps}|${get('sys.delay')}|${get('sys.gain')}`;
            if (get('preset.x') !== m.px) store.set('preset.x', m.px);
            if (get('preset.sys') !== m.ps) store.set('preset.sys', m.ps);
        }

        // ---------- editing ----------
        const radiusSamples = () => Math.max(0.5, (Number(get('radius')) / 100) * model.n);

        function beginEdit(sig) {
            pushUndo();
            if (get('derived') === sig) store.set('derived', sig === 'h' ? 'y' : 'h');
            if (sig === 'y' || sig === 'h') dropTruth();
            if (sig === 'x') detachXPreset();
            if (get('active') !== sig) store.set('active', sig);
        }

        function afterEdit(sig) {
            model.touch(sig);
            if (sig === 'x' && model.truth) model.regenerateY();
            dirty();
        }

        /** One brush dab on sample position idx (float) of signal sig. */
        function dab(sig, idx, val, sign, factor) {
            const arr = model[sig];
            const tool = get('tool');
            const r = radiusSamples(), soft = Number(get('soft'));
            const amount = Number(get('strength')) * model.scale[sig] * 0.08 * factor;
            const centres = get('mirror') ? [idx, model.n - 1 - idx] : [idx];
            for (const c of centres) {
                if (tool === 'raise') raise(arr, c, r, soft, sign * amount);
                else if (tool === 'lower') raise(arr, c, r, soft, -sign * amount);
                else if (tool === 'smooth') smooth(arr, c, r, soft, 0.5 * Math.min(1, factor));
                else if (tool === 'flatten') flatten(arr, c, r, soft, sign < 0 ? 0 : val, 0.6 * Math.min(1, factor));
            }
        }

        function strokeTo(s, idx, val) {
            const sig = s.sig, tool = get('tool');
            if (tool === 'line') {
                const v1 = s.sign < 0 ? 0 : val, v0 = s.sign < 0 ? 0 : s.lastVal;
                lineSegment(model[sig], s.lastIdx, v0, idx, v1);
                if (get('mirror')) lineSegment(model[sig], model.n - 1 - idx, v1, model.n - 1 - s.lastIdx, v0);
            } else {
                const step = Math.max(1, radiusSamples() / 3);
                const dist = Math.abs(idx - s.lastIdx);
                const cnt = Math.max(1, Math.ceil(dist / step));
                for (let k = 1; k <= cnt; k++) {
                    const t = k / cnt;
                    dab(sig, s.lastIdx + (idx - s.lastIdx) * t, s.lastVal + (val - s.lastVal) * t, s.sign, 1);
                }
            }
            s.lastIdx = idx;
            s.lastVal = val;
            afterEdit(sig);
        }

        function paintMagnitude(s, bin, value) {
            // bins are on the 2N grid in the plot; the editable response lives on the N grid
            const c = clamp(bin / 2, 0, model.n / 2);
            const r = Math.max(1.5, (Number(get('radius')) / 100) * (model.n / 2));
            flatten(st.hmag, c, r, Number(get('soft')), value, 1);
            if (s.lastBin !== null) {
                const c0 = clamp(s.lastBin / 2, 0, model.n / 2);
                const cnt = Math.ceil(Math.abs(c - c0) / Math.max(1, r / 3));
                for (let k = 1; k < cnt; k++) flatten(st.hmag, c0 + ((c - c0) * k) / cnt, r, Number(get('soft')), value, 1);
            }
            s.lastBin = bin;
            model.setHFromMagnitude(st.hmag, get('phaseModel'));
            dirty();
        }

        const actions = {
            undo() { model.meta = { px: get('preset.x'), ps: get('preset.sys') }; if (model.undo()) restoreMeta(); dirty(); },
            redo() { model.meta = { px: get('preset.x'), ps: get('preset.sys') }; if (model.redo()) restoreMeta(); dirty(); },
            clear() {
                const sig = get('active');
                beginEdit(sig);
                model.touch(sig);
                model[sig].fill(0);
                afterEdit(sig);
            },
            auto() {
                const v = model.autoLambdaLog(solveParams());
                if (v !== null) store.set('lambda', v);
                dirty();
            },
            resetView,
        };

        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(240, s.width), h: Math.max(240, s.height) };
            };
            const layout = () => {
                st.layout = gridLayout(p.width, p.height);
                return st.layout;
            };
            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
            const isBtn = (name) => {
                const b = p.mouseButton;
                return b === p[name.toUpperCase()] || !!(b && typeof b === 'object' && b[name]);
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
                syncSettings();
                layout();
            };

            // ---------- pointer ----------
            function updateHover() {
                const L = st.layout || layout();
                const hit = hitPlot(L, p.mouseX, p.mouseY);
                let next = null;
                if (hit) {
                    const R = L.plots[hit.sig][hit.kind];
                    const idx = hit.kind === 'time'
                        ? clamp(Math.round(timeIndexAt(R.in, st.view, p.mouseX)), 0, model.n - 1)
                        : clamp(Math.round(binAt(R.in, model.n, p.mouseX)), 0, model.n);
                    next = { sig: hit.sig, kind: hit.kind, idx };
                }
                const cur = st.hover;
                if ((!cur && !next) || (cur && next && cur.sig === next.sig && cur.kind === next.kind && cur.idx === next.idx)) return;
                st.hover = next;
                dirty();
            }

            function pointer(sig) {
                const I = layout().plots[sig].time.in;
                const idx = clamp(timeIndexAt(I, st.view, p.mouseX), 0, model.n - 1);
                const val = clamp(timeValueAt(I, model.scale[sig], p.mouseY), -model.scale[sig], model.scale[sig]);
                return { idx, val };
            }

            function pressStart(e) {
                if (!onCanvas(e)) return false;
                const L = layout();
                const hit = hitPlot(L, p.mouseX, p.mouseY);
                st.stroke = null;
                st.pan = null;
                st.moved = true;
                if (!hit) return false;
                const shift = (e && e.shiftKey) || (p.keyIsDown && p.keyIsDown(16));
                if (isBtn('center') || (hit.kind === 'time' && shift)) {
                    if (hit.kind !== 'time') return false;
                    st.pan = { x: p.mouseX, a: st.view.a, b: st.view.b, w: L.plots[hit.sig].time.in.w };
                    return true;
                }
                const sign = isBtn('right') ? -1 : 1;
                if (hit.kind === 'time') {
                    if (get('active') !== hit.sig) store.set('active', hit.sig);
                    beginEdit(hit.sig);
                    model.updateScales();
                    const { idx, val } = pointer(hit.sig);
                    st.stroke = { sig: hit.sig, sign, lastIdx: idx, lastVal: val, kind: 'time' };
                    if (get('tool') === 'line') strokeTo(st.stroke, idx, val);
                    else dab(hit.sig, idx, val, sign, 1);
                    afterEdit(hit.sig);
                    return true;
                }
                if (hit.kind === 'mag' && hit.sig === 'h') {
                    beginEdit('h');
                    st.hmag = Float64Array.from(model.hMagnitudeBase());
                    const R = L.plots.h.mag;
                    const bin = binAt(R.in, model.n, p.mouseX);
                    st.stroke = { sig: 'h', kind: 'mag', lastBin: null };
                    paintMagnitude(st.stroke, bin, magValueAt(R.in, renderer.ranges.h || { lo: 0, hi: 1, db: false }, p.mouseY));
                    return true;
                }
                if (get('active') !== hit.sig) store.set('active', hit.sig);
                dirty();
                return false;
            }

            function pressDrag() {
                updateHover();
                if (st.pan) {
                    const span = st.pan.b - st.pan.a;
                    const d = (-(p.mouseX - st.pan.x) / st.pan.w) * span;
                    setView(st.pan.a + d, st.pan.b + d);
                    return;
                }
                const s = st.stroke;
                if (!s) return;
                st.moved = true;
                if (s.kind === 'time') {
                    const { idx, val } = pointer(s.sig);
                    strokeTo(s, idx, val);
                } else if (s.kind === 'mag') {
                    const R = layout().plots.h.mag;
                    paintMagnitude(s, binAt(R.in, model.n, p.mouseX), magValueAt(R.in, renderer.ranges.h || { lo: 0, hi: 1, db: false }, p.mouseY));
                }
            }

            function pressEnd() {
                const had = st.stroke || st.pan;
                st.stroke = null;
                st.pan = null;
                dirty();
                return !!had;
            }

            function setView(a, b) {
                const max = model.n - 1;
                let span = clamp(b - a, 8, max);
                if (max < 8) span = max;
                a = clamp(a, 0, max - span);
                st.view = { a, b: a + span };
                dirty();
            }

            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.mouseMoved = (e) => { if (onCanvas(e)) updateHover(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !(st.stroke || st.pan); };
            p.touchEnded = () => !pressEnd();

            p.mouseWheel = (e) => {
                if (!onCanvas(e)) return true;
                const L = layout();
                const hit = hitPlot(L, p.mouseX, p.mouseY);
                if (!hit || hit.kind !== 'time') return true;
                let d = Number(e && (e.deltaY !== undefined ? e.deltaY : e.delta)) || 0;
                if (e && e.deltaMode === 1) d *= 33;
                else if (e && e.deltaMode === 2) d *= 400;
                d = clamp(d, -300, 300);
                if (d === 0) return true;
                const I = L.plots[hit.sig].time.in;
                const anchor = timeIndexAt(I, st.view, p.mouseX);
                const frac = clamp((p.mouseX - I.x) / I.w, 0, 1);
                const span = (st.view.b - st.view.a) * Math.exp(d * 0.0015);
                const sp = clamp(span, 8, model.n - 1);
                setView(anchor - frac * sp, anchor - frac * sp + sp);
                if (e && e.preventDefault) e.preventDefault();
                return false;
            };

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
                if (tools[lk] && k !== 'S' && k !== 'F') store.set('tool', tools[lk]);
                else if (k === '1') store.set('active', 'x');
                else if (k === '2') store.set('active', 'y');
                else if (k === '3') store.set('active', 'h');
                else if (k === 'z') actions.undo();
                else if (k === 'Z' || k === 'y') actions.redo();
                else if (lk === 'c') actions.clear();
                else if (lk === 'm') store.set('mirror', !get('mirror'));
                else if (lk === 'a') actions.auto();
                else if (k === '0') resetView();
                else return true;
                return false;
            };

            st.resize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                layout();
                dirty();
            };

            // ---------- drawing ----------
            p.draw = () => {
                if (st.disposed) return;
                syncSettings();
                if (model.solve(solveParams())) dirty();
                const s = st.stroke;
                if (s && p.mouseIsPressed && !st.moved && s.kind === 'time' && get('tool') !== 'line') {
                    // holding still keeps raising / smoothing under the brush
                    const dt = Math.min(100, p.deltaTime || 16.7);
                    dab(s.sig, s.lastIdx, s.lastVal, s.sign, dt / 60);
                    afterEdit(s.sig);
                }
                st.moved = false;
                if (!st.dirty) return;
                st.dirty = false;
                model.updateScales(st.stroke ? st.stroke.sig : null);
                const L = layout();
                const radiusIdx = radiusSamples();
                p.background(pal.bg);
                renderer.drawAll({
                    p, pal, model, layout: L, view: st.view, fs: Number(get('fs')) || 1000, active: get('active'), hover: st.hover,
                    opts: {
                        magDb: !!get('magDb'),
                        dbRange: Number(get('dbRange')),
                        phase: get('phase'),
                        groupDelay: !!get('groupDelay'),
                        recon: !!get('recon'),
                        truthOverlay: true,
                        derived: get('derived'),
                        methodLabel: (METHODS.find((m) => m.value === get('method')) || METHODS[0]).value,
                        lambdaLog: Number(get('lambda')),
                        brush: { radiusIdx },
                    },
                });
            };

            cleanups.push(ctx.globalSettings.subscribe(() => {
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                dirty();
            }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(dirty));
        cleanups.push(ctx.onResize(() => st.resize && st.resize()));

        const toolTabs = ctx.ui.build([{ type: 'tabs', key: 'tool', options: TOOLS }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(actions), store, ctx.drawer);

        return {
            /** Exposed for inspection (tests, debugging). */
            model,
            renderer,
            unmount() {
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
