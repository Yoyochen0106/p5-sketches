// Chladni Plates: eigenmodes of vibrating square / rectangular / circular plates, mode mixing,
// point-driven resonance with a frequency sweep, nodal lines and a sand simulation.

import { getPalette } from '../approx/palette.js';
import { chainSegments, segmentsToCsv } from '../../lib/plates.js';
import { createSand, stepSand, MAX_GRAINS } from '../../lib/sand.js';
import { PlateModel } from './model.js';
import { DEFAULTS, PRESETS, SLOTS } from './state.js';

const SIDEBAR = 224;
const PAD = 14;
const TOP = 46;
const SAND_RES = 256;

const KIND_LABEL = { simply: 'simply supported', free: 'free-edge (Chladni)', clamped: 'clamped (approx.)', membrane: 'membrane' };

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

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 256-entry diverging colour table: index 0 = most negative, 255 = most positive. */
function buildLut(dark, dim) {
    const zero = hexToRgb(dark ? '#1a1d23' : '#f4f4f1');
    const neg = hexToRgb(dark ? '#2f7bff' : '#2f6fe0');
    const pos = hexToRgb(dark ? '#ff5a3c' : '#e8452a');
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
        const v = (i - 127.5) / 127.5;
        const t = Math.min(1, Math.abs(v)) ** 0.75;
        const side = v < 0 ? neg : pos;
        for (let c = 0; c < 3; c++) {
            const col = zero[c] + (side[c] - zero[c]) * t;
            lut[i * 3 + c] = dim ? zero[c] + (col - zero[c]) * 0.55 : col;
        }
    }
    return lut;
}

function buildSchema(ctx, store, actions) {
    const slotChildren = [];
    for (let i = 0; i < SLOTS; i++) {
        slotChildren.push({
            type: 'group', label: i === 0 ? 'Mode 1 (primary)' : `Mode ${i + 1}`, collapsed: i > 1,
            children: [
                { type: 'slider', key: `s${i}.m`, label: 'm', min: 0, max: 10, step: 1 },
                { type: 'slider', key: `s${i}.n`, label: 'n', min: 0, max: 10, step: 1 },
                { type: 'slider', key: `s${i}.a`, label: 'weight', min: -1, max: 1, step: 0.05 },
            ],
        });
    }
    return [
        {
            type: 'select', key: 'preset', label: 'presets',
            options: [{ value: '', label: 'choose a preset…' }, ...PRESETS.map((pr) => ({ value: pr.id, label: pr.label }))],
        },
        {
            type: 'group', label: 'Plate', children: [
                {
                    type: 'select', key: 'kind', label: 'edges',
                    options: [{ value: 'simply', label: 'simply supported' }, { value: 'free', label: 'free-edge (Chladni)' }, { value: 'clamped', label: 'clamped (approx.)' }],
                    visibleIf: (s) => s.get('shape') !== 'circle',
                },
                { type: 'slider', key: 'aspect', label: 'aspect ratio', min: 1, max: 3, step: 0.05, visibleIf: (s) => s.get('shape') === 'rect' },
                {
                    type: 'select', key: 'phase', label: 'variant (± / cos, sin)',
                    options: [{ value: 0, label: 'minus / cos' }, { value: 1, label: 'plus / sin' }],
                },
                {
                    type: 'select', key: 'dispersion', label: 'dispersion',
                    options: [{ value: 'plate', label: 'plate: ω ∝ k²' }, { value: 'membrane', label: 'membrane: ω ∝ k' }],
                },
                { type: 'slider', key: 'res', label: 'grid resolution', min: 32, max: 200, step: 8 },
            ],
        },
        { type: 'group', label: 'Mode mixing (up to 4)', children: slotChildren },
        {
            type: 'group', label: 'Driven plate', children: [
                { type: 'toggle', key: 'drive.on', label: 'drive with an excitation point' },
                { type: 'slider', key: 'drive.ratio', label: 'drive frequency / fundamental', min: 0.5, max: 24, step: 0.01 },
                { type: 'slider', key: 'damping', label: 'damping γ/ω₁', min: 0.002, max: 0.3, step: 0.002 },
                { type: 'slider', key: 'amp', label: 'drive amplitude', min: 0.05, max: 2, step: 0.05 },
                { type: 'info', text: 'Click or drag on the plate to move the excitation point.' },
            ],
        },
        {
            type: 'group', label: 'Display', children: [
                { type: 'toggle', key: 'showField', label: 'displacement colours' },
                { type: 'toggle', key: 'nodal', label: 'nodal lines' },
                { type: 'slider', key: 'lineWidth', label: 'line thickness', min: 1, max: 6, step: 0.5 },
                { type: 'slider', key: 'speed', label: 'animation speed', min: 0.05, max: 2, step: 0.05 },
                { type: 'toggle', key: 'sand.on', label: 'sand' },
                { type: 'slider', key: 'sand.count', label: 'grains', min: 200, max: MAX_GRAINS, step: 100 },
                { type: 'button', label: 'Scatter sand again', onClick: () => actions.resetSand() },
                { type: 'button', label: 'Download nodal lines (CSV)', onClick: () => actions.exportCsv() },
            ],
        },
        {
            type: 'info',
            text: 'Click a row of the mode table to select a mode and tune the drive to it · click/drag the plate: excitation point · '
                + 'space: play/pause · R: scatter sand · arrows: m, n',
        },
    ];
}

export default {
    id: 'chladni',
    title: 'Chladni Plates',
    description: 'Vibrating square, rectangular and circular plates: eigenmodes, mode mixing, driven resonance sweeps, nodal lines and sand.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const cleanups = [];
        const model = new PlateModel();
        const st = {
            disposed: false,
            dirty: true,
            t: 0,
            ratio: get('drive.ratio'),
            lastRatio: get('drive.ratio'),
            lastRatioWrite: 0,
            rect: { x: 0, y: 0, w: 1, h: 1 },
            side: 0,
            rowH: 18,
            drag: false,
            sand: null,
            sandKey: '',
            sandSeed: 1,
            fieldImg: null,
            sandImg: null,
            lut: null,
            lutKey: '',
            hoverRow: -1,
            chains: null,
            chainsFor: null,
            frames: 0,
        };
        let doResize = () => {};

        function sizeNow() {
            const s = ctx.size();
            return { w: Math.max(240, s.width), h: Math.max(240, s.height) };
        }

        // the live drive ratio (moved by the sweep) overrides the throttled store value
        const live = (k) => (k === 'drive.ratio' ? st.ratio : get(k));

        function computeLayout(w, h) {
            model.configure(live);
            const b = model.cfg.bounds;
            const ar = (b.xmax - b.xmin) / (b.ymax - b.ymin);
            st.side = w >= 720 ? SIDEBAR : 0;
            const aw = w - st.side - PAD * 2;
            const ah = h - TOP - PAD;
            let rw = aw;
            let rh = rw / ar;
            if (rh > ah) { rh = ah; rw = rh * ar; }
            st.rect = { x: PAD + (aw - rw) / 2, y: TOP + (ah - rh) / 2, w: Math.max(10, rw), h: Math.max(10, rh) };
            st.rowH = Math.max(12, Math.min(18, (h - TOP - 36) / 21));
        }

        // ---------- actions ----------
        function resetSand() {
            st.sandSeed += 1;
            st.sandKey = '';
            st.dirty = true;
        }

        function exportCsv() {
            try {
                const csv = segmentsToCsv(model.lines);
                const doc = globalThis.document;
                if (!doc || !globalThis.URL || !globalThis.Blob) return csv;
                const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                const a = doc.createElement('a');
                a.href = url;
                a.download = 'chladni-nodal-lines.csv';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return csv;
            } catch {
                return null;
            }
        }

        function applyPreset(id) {
            const pr = PRESETS.find((x) => x.id === id);
            if (!pr) return;
            for (const [k, v] of Object.entries(pr.patch)) store.set(k, v);
            if (pr.patch['drive.ratio'] !== undefined) st.ratio = pr.patch['drive.ratio'];
            resetSand();
        }

        function selectRow(i) {
            const row = model.cfg.table[i];
            if (!row) return;
            store.set('s0.m', row.spec.m);
            store.set('s0.n', row.spec.n);
            store.set('phase', row.spec.phase);
            store.set('s0.a', 1);
            const r = Math.min(24, Math.max(0.5, row.ratio));
            st.ratio = r;
            st.lastRatio = r;
            store.set('drive.ratio', r);
            resetSand();
        }

        function placeSource(mx, my) {
            const { x, y, w, h } = st.rect;
            const u = Math.max(0, Math.min(1, (mx - x) / w));
            const v = Math.max(0, Math.min(1, 1 - (my - y) / h));
            store.set('src.u', u);
            store.set('src.v', v);
            if (!get('drive.on')) store.set('drive.on', true);
            st.dirty = true;
        }

        // ---------- p5 ----------
        const sketch = (p) => {
            let pal = getPalette(ctx.globalSettings.get('theme', 'dark'));

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                computeLayout(w, h);
            };

            doResize = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                computeLayout(w, h);
                st.dirty = true;
            };

            const onCanvas = (e) => !e || !e.target || !p.canvas || e.target === p.canvas;
            const inRect = (mx, my) => mx >= st.rect.x && mx <= st.rect.x + st.rect.w && my >= st.rect.y && my <= st.rect.y + st.rect.h;
            const rowAt = (mx, my) => {
                if (!st.side || mx < p.width - st.side + 6) return -1;
                const i = Math.floor((my - TOP - 18) / st.rowH);
                return i >= 0 && i < model.cfg.table.length ? i : -1;
            };

            function pressStart(e) {
                if (!onCanvas(e) || p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER) return false;
                const row = rowAt(p.mouseX, p.mouseY);
                if (row >= 0) { selectRow(row); return true; }
                if (inRect(p.mouseX, p.mouseY)) {
                    st.drag = true;
                    placeSource(p.mouseX, p.mouseY);
                    return true;
                }
                return false;
            }
            function pressDrag() {
                if (st.drag) placeSource(p.mouseX, p.mouseY);
            }
            function pressEnd() { st.drag = false; }

            p.mouseMoved = (e) => {
                if (!onCanvas(e)) return;
                const r = rowAt(p.mouseX, p.mouseY);
                if (r !== st.hoverRow) { st.hoverRow = r; st.dirty = true; }
            };
            p.mousePressed = (e) => { pressStart(e); };
            p.mouseDragged = () => { pressDrag(); };
            p.mouseReleased = () => { pressEnd(); };
            p.touchStarted = (e) => (pressStart(e) ? false : true);
            p.touchMoved = () => { pressDrag(); return !st.drag; };
            p.touchEnded = () => { const was = st.drag; pressEnd(); return !was; };

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
                const bump = (key, d, lo, hi) => store.set(key, Math.max(lo, Math.min(hi, get(key) + d)));
                if (k === ' ') store.set('playing', !get('playing'));
                else if (k === 'r' || k === 'R') resetSand();
                else if (p.keyCode === p.LEFT_ARROW) bump('s0.m', -1, 0, 10);
                else if (p.keyCode === p.RIGHT_ARROW) bump('s0.m', 1, 0, 10);
                else if (p.keyCode === p.UP_ARROW) bump('s0.n', 1, 0, 10);
                else if (p.keyCode === p.DOWN_ARROW) bump('s0.n', -1, 0, 10);
                else return true;
                return false;
            };

            // ---------- per-frame simulation ----------
            function advance() {
                const dt = Math.min(0.05, (p.deltaTime || 16.7) / 1000);
                if (get('sweep')) {
                    if (!get('drive.on')) store.set('drive.on', true);
                }
                if (!get('playing')) return;
                st.t += dt * get('speed');
                if (get('sweep')) {
                    const maxR = model.cfg.table[model.cfg.table.length - 1].ratio * 1.03;
                    st.ratio *= Math.exp(0.07 * dt);
                    if (st.ratio > maxR) st.ratio = 0.8;
                    const now = p.millis();
                    if (now - st.lastRatioWrite > 120) {
                        st.lastRatioWrite = now;
                        st.lastRatio = st.ratio;
                        store.set('drive.ratio', st.ratio);
                    }
                }
            }

            function ensureSand(c) {
                const count = Math.min(MAX_GRAINS, Math.max(0, Math.round(get('sand.count'))));
                const key = `${c.base.shape}|${c.base.aspect}|${count}|${st.sandSeed}`;
                if (st.sand && key === st.sandKey) return;
                st.sandKey = key;
                st.sand = createSand({ count, seed: st.sandSeed * 7919, bounds: c.bounds, inside: c.inside });
            }

            function stepGrains(c) {
                ensureSand(c);
                const h = c.bounds.ymax - c.bounds.ymin;
                stepSand(st.sand, model.env, c.inside, { steps: 3, stepSize: 0.012 * h, mobility: 3.5 * c.amp, ampMax: 1 });
            }

            // ---------- drawing ----------
            function paintField(c, u, dark, dim) {
                const { nx, ny } = u;
                if (!st.fieldImg || st.fieldImg.width !== nx || st.fieldImg.height !== ny) st.fieldImg = p.createImage(nx, ny);
                const lutKey = `${dark}|${dim}`;
                if (lutKey !== st.lutKey) { st.lut = buildLut(dark, dim); st.lutKey = lutKey; }
                const lut = st.lut;
                const img = st.fieldImg;
                img.loadPixels();
                const px = img.pixels;
                const v = u.values;
                const s = nx + 1;
                const b = c.bounds;
                const dx = (b.xmax - b.xmin) / nx;
                const dy = (b.ymax - b.ymin) / ny;
                for (let j = 0; j < ny; j++) {
                    const row = (ny - 1 - j) * nx;
                    for (let i = 0; i < nx; i++) {
                        const o = (row + i) * 4;
                        if (c.circle) {
                            const cx = b.xmin + (i + 0.5) * dx;
                            const cy = b.ymin + (j + 0.5) * dy;
                            if (cx * cx + cy * cy > 1) { px[o + 3] = 0; continue; }
                        }
                        const a = 0.25 * (v[i + s * j] + v[i + 1 + s * j] + v[i + s * (j + 1)] + v[i + 1 + s * (j + 1)]);
                        let idx = Math.round(127.5 + 127.5 * Math.max(-1, Math.min(1, a)));
                        if (!(idx >= 0)) idx = 128;
                        px[o] = lut[idx * 3]; px[o + 1] = lut[idx * 3 + 1]; px[o + 2] = lut[idx * 3 + 2]; px[o + 3] = 255;
                    }
                }
                img.updatePixels();
                p.image(img, st.rect.x, st.rect.y, st.rect.w, st.rect.h);
            }

            function paintSand(c, dark) {
                const b = c.bounds;
                const w = b.xmax - b.xmin;
                const h = b.ymax - b.ymin;
                const SW = w >= h ? SAND_RES : Math.max(8, Math.round((SAND_RES * w) / h));
                const SH = h >= w ? SAND_RES : Math.max(8, Math.round((SAND_RES * h) / w));
                if (!st.sandImg || st.sandImg.width !== SW || st.sandImg.height !== SH) st.sandImg = p.createImage(SW, SH);
                const img = st.sandImg;
                img.loadPixels();
                const px = img.pixels;
                px.fill(0);
                const col = dark ? [244, 214, 140] : [120, 86, 20];
                const sd = st.sand;
                for (let i = 0; i < sd.n; i++) {
                    const gx = Math.floor(((sd.x[i] - b.xmin) / w) * (SW - 1));
                    const gy = Math.floor((1 - (sd.y[i] - b.ymin) / h) * (SH - 1));
                    for (let oy = 0; oy < 2; oy++) {
                        for (let ox = 0; ox < 2; ox++) {
                            const x = gx + ox;
                            const y = gy + oy;
                            if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
                            const o = (y * SW + x) * 4;
                            px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
                        }
                    }
                }
                img.updatePixels();
                p.image(img, st.rect.x, st.rect.y, st.rect.w, st.rect.h);
            }

            function toPx(c, x, y) {
                const b = c.bounds;
                return [st.rect.x + ((x - b.xmin) / (b.xmax - b.xmin)) * st.rect.w, st.rect.y + (1 - (y - b.ymin) / (b.ymax - b.ymin)) * st.rect.h];
            }

            function drawNodal(c) {
                if (st.chainsFor !== model.lines) {
                    st.chains = chainSegments(model.lines, c.bounds.xmax - c.bounds.xmin);
                    st.chainsFor = model.lines;
                }
                p.noFill();
                p.stroke(pal.dark ? 'rgba(255,255,255,0.92)' : 'rgba(20,22,26,0.92)');
                p.strokeWeight(get('lineWidth'));
                for (const ch of st.chains) {
                    p.beginShape();
                    for (let k = 0; k < ch.length; k += 2) {
                        const [x, y] = toPx(c, ch[k], ch[k + 1]);
                        p.vertex(x, y);
                    }
                    p.endShape();
                }
            }

            function drawOutline(c) {
                p.noFill();
                p.stroke(pal.axis);
                p.strokeWeight(1.5);
                if (c.circle) p.ellipse(st.rect.x + st.rect.w / 2, st.rect.y + st.rect.h / 2, st.rect.w, st.rect.h);
                else p.rect(st.rect.x, st.rect.y, st.rect.w, st.rect.h);
            }

            function drawSource(c) {
                const [sx, sy] = toPx(c, c.src.x, c.src.y);
                p.noFill();
                p.stroke(pal.accent);
                p.strokeWeight(2);
                p.ellipse(sx, sy, 16, 16);
                p.line(sx - 11, sy, sx + 11, sy);
                p.line(sx, sy - 11, sx, sy + 11);
            }

            function modeName(spec) {
                const v = spec.shape === 'circle' ? (spec.phase ? ' sin' : '') : (spec.kind === 'free' && spec.shape === 'square' && spec.m !== spec.n ? (spec.phase ? ' +' : ' −') : '');
                return `(${spec.m},${spec.n})${v}`;
            }

            function drawHud(c) {
                p.noStroke();
                p.fill(pal.fg);
                p.textFont('Consolas, ui-monospace, monospace');
                p.textAlign(p.LEFT, p.TOP);
                p.textSize(14);
                const shapeName = c.base.shape === 'circle' ? 'Circular' : c.base.shape === 'rect' ? `Rectangular ${c.base.aspect.toFixed(2)}:1` : 'Square';
                p.text(`${shapeName} plate, ${KIND_LABEL[c.base.kind]}`, PAD, 10);
                p.textSize(12);
                p.fill(pal.muted);
                const s0 = c.slots[0];
                let line = `mode ${modeName(s0.mode.spec)}  k² = ${s0.mode.lambda.toFixed(2)}  ω = ${s0.omega.toFixed(2)}  ω/ω₁ = ${s0.ratio.toFixed(3)}  [${c.dispersion === 'plate' ? 'ω ∝ k²' : 'ω ∝ k'}]`;
                if (c.active.length > 1) line += `  mix of ${c.active.length}`;
                p.text(line, PAD, 28);
                if (c.drive) {
                    p.fill(pal.accent);
                    p.text(`driven at ω/ω₁ = ${c.ratio.toFixed(2)}   damping ${c.damping.toFixed(3)}${get('sweep') ? '   sweeping' : ''}`, PAD, p.height - 16);
                }
            }

            function drawTable(c) {
                if (!st.side) return;
                const x0 = p.width - st.side + 6;
                p.noStroke();
                p.fill(pal.muted);
                p.textFont('Consolas, ui-monospace, monospace');
                p.textSize(11);
                p.textAlign(p.LEFT, p.TOP);
                p.text('first 20 modes (click)', x0, TOP);
                const tolerance = 1e-9;
                c.table.forEach((row, i) => {
                    const y = TOP + 18 + i * st.rowH;
                    const active = c.active.some((a) => a.mode.spec.m === row.spec.m && a.mode.spec.n === row.spec.n && a.mode.spec.phase === row.spec.phase);
                    const near = c.drive && Math.abs(c.ratio - row.ratio) < 0.03 * row.ratio + tolerance;
                    if (active || i === st.hoverRow || near) {
                        p.fill(active ? pal.border : pal.grid);
                        p.rect(x0 - 4, y - 1, st.side - 8, st.rowH);
                    }
                    p.fill(active ? pal.accent : pal.fg);
                    p.text(`${String(i + 1).padStart(2)} ${modeName(row.spec).padEnd(7)} ${row.ratio.toFixed(3).padStart(7)}`, x0, y);
                });
                p.fill(pal.muted);
                p.text('mode          ω/ω₁', x0, TOP + 18 + c.table.length * st.rowH + 2);
            }

            p.draw = () => {
                if (st.disposed) return;
                st.frames++;
                // follow the slider unless a sweep is moving the ratio
                const sv = get('drive.ratio');
                if (sv !== st.lastRatio) { st.ratio = sv; st.lastRatio = sv; }
                if (!get('playing') && !st.dirty && !st.drag) return;
                st.dirty = false;
                computeLayout(p.width, p.height);
                advance();
                const c = model.cfg;
                c.ratio = st.ratio;
                const sandOn = !!get('sand.on');
                model.evaluate(st.t);
                if (get('playing') && sandOn) stepGrains(c);
                else if (sandOn) ensureSand(c);
                pal = getPalette(ctx.globalSettings.get('theme', 'dark'));
                p.background(pal.bg);
                drawHud(c);
                if (get('showField')) paintField(c, model.u, pal.dark, sandOn);
                if (sandOn) paintSand(c, pal.dark);
                if (get('nodal')) drawNodal(c);
                drawOutline(c);
                if (c.drive) drawSource(c);
                drawTable(c);
            };

            cleanups.push(ctx.globalSettings.subscribe(() => { st.dirty = true; }));
        };

        const instance = new ctx.p5(sketch, container);
        cleanups.push(store.subscribe(() => {
            st.dirty = true;
            const id = store.get('preset');
            if (id) {
                store.set('preset', '');
                applyPreset(id);
            }
        }));
        cleanups.push(ctx.onResize(() => doResize()));

        // ---------- UI ----------
        const actions = { resetSand, exportCsv };
        const toolbarUi = ctx.ui.build([
            {
                type: 'tabs', key: 'shape',
                options: [{ value: 'square', label: 'Square' }, { value: 'rect', label: 'Rectangle' }, { value: 'circle', label: 'Circle' }],
            },
            { type: 'toggle', key: 'playing', label: 'play' },
            { type: 'toggle', key: 'sweep', label: 'frequency sweep' },
        ], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(ctx, store, actions), store, ctx.drawer);

        return {
            /** Test hook: internal state. */
            debug: () => ({ model, st, store, exportCsv }),
            unmount() {
                if (st.disposed) return;
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { toolbarUi.destroy(); } catch { /* ignore */ }
                try { panel.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
            },
        };
    },
};
