// Tab 1: affine IFS editor. Every map is drawn as the image of a reference rectangle (the bounding box of the
// attractor of the loaded preset): drag the corner handles (square = move, circles = the two edge vectors) to
// change the map; the attractor is rendered by the chaos game into an accumulating density image.
import {
    IFS_PRESETS, getIfsPreset, cloneMaps, compileMaps, createChaosState, runChaos, DensityGrid, boundingView, viewForRect,
    contractionRatios, similarityDimension, isSimilarity, boxCountDimension,
} from '../../lib/ifs.js';
import {
    PlaneView, gridToImage, ensureImage, hexToRgb, tagColors, rgbCss, clamp, wheelDelta,
} from './view.js';

export const MAX_MAPS = 6;
const MAX_POINTS = 80e6;
const MAX_PER_FRAME = 400000;
const HIT = 11;

const detOf = (m) => m.a * m.d - m.b * m.c;
const apply = (m, x, y) => [m.a * x + m.b * y + m.e, m.c * x + m.d * y + m.f];

/** Creates the IFS tab. env = { p, get, set, pal(), rect() }. */
export function createIfsTab(env) {
    const { p, get, set } = env;
    const st = {
        maps: [], frame: null, view: null, grid: null, sys: null, chaos: null, img: {},
        presetId: '', selected: 0, drag: null, wKey: '', dims: '', boxDim: null, seed: 1,
        imgKey: '', size: '',
    };

    const rectNow = () => {
        const r = env.rect();
        return { x: r.x, y: r.y, w: Math.max(16, Math.floor(r.w)), h: Math.max(16, Math.floor(r.h)) };
    };

    function restart() {
        const r = rectNow();
        const view = st.view.gridView();
        if (!st.grid || st.grid.w !== r.w || st.grid.h !== r.h) st.grid = new DensityGrid(r.w, r.h, view);
        else st.grid.setView(view);
        const plain = get('ifs.autoW') ? st.maps.map((m) => ({ ...m, p: undefined })) : st.maps;
        st.sys = compileMaps(plain);
        st.chaos = createChaosState(st.seed);
        st.boxDim = null;
        const ratios = contractionRatios(st.maps);
        st.dims = st.maps.every((m) => isSimilarity(m)) && ratios.every((q) => q < 1)
            ? `similarity dimension s = ${similarityDimension(ratios).toFixed(4)}  (sum r^s = 1)`
            : 'affine maps: no closed-form dimension';
    }

    function fitView() {
        const r = rectNow();
        const v = viewForRect(st.frame, r.w, r.h, 0.12);
        st.view = new PlaneView(r, (v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2, r.w / (v.xmax - v.xmin));
        st.size = `${r.w}x${r.h}`;
    }

    function pushWeights() {
        st.maps.forEach((m, i) => { if (i < MAX_MAPS) set(`ifs.w${i}`, Math.round(clamp(m.p, 0.01, 1) * 100) / 100); });
        st.wKey = weightKey();
    }

    const weightKey = () => st.maps.map((_, i) => get(`ifs.w${i}`)).join(',') + (get('ifs.autoW') ? 'a' : '');

    function loadPreset(id) {
        const preset = getIfsPreset(id);
        st.presetId = preset.id;
        st.maps = cloneMaps(preset.maps);
        const dets = st.maps.map((m) => (Number.isFinite(m.p) && m.p > 0 ? m.p : Math.abs(detOf(m))));
        const top = Math.max(...dets, 1e-9);
        st.maps.forEach((m, i) => { m.p = Math.max(0.01, dets[i] / top); });
        const b = boundingView(st.maps);
        st.frame = { xmin: b.xmin, xmax: b.xmax > b.xmin ? b.xmax : b.xmin + 1, ymin: b.ymin, ymax: b.ymax > b.ymin ? b.ymax : b.ymin + 1 };
        st.selected = 0;
        st.drag = null;
        fitView();
        pushWeights();
        restart();
    }

    function sync() {
        const id = get('ifs.preset');
        if (id && id !== st.presetId) loadPreset(id);
        const r = rectNow();
        if (!st.grid || st.grid.w !== r.w || st.grid.h !== r.h) {
            const keep = st.view;
            st.view = new PlaneView(r, keep.cx, keep.cy, keep.scale);
            restart();
        }
        if (get('ifs.count') !== st.maps.length) set('ifs.count', st.maps.length);
        const wk = weightKey();
        if (wk !== st.wKey) {
            st.wKey = wk;
            st.maps.forEach((m, i) => { const w = Number(get(`ifs.w${i}`)); if (w > 0) m.p = w; });
            restart();
        }
    }

    function step() {
        if (get('ifs.paused') || !st.grid || st.grid.total >= MAX_POINTS) return;
        const n = clamp(Math.floor(Number(get('ifs.speed')) || 100000), 1000, MAX_PER_FRAME);
        runChaos(st.sys, st.chaos, n, st.grid);
    }

    // ---------- drawing ----------
    function corners(m) {
        const f = st.frame;
        return {
            O: apply(m, f.xmin, f.ymin), X: apply(m, f.xmax, f.ymin), XY: apply(m, f.xmax, f.ymax), Y: apply(m, f.xmin, f.ymax),
        };
    }

    function draw() {
        const pal = env.pal();
        const r = rectNow();
        const bg = hexToRgb(pal.bg);
        const fg = hexToRgb(pal.accent);
        const colors = tagColors(pal);
        const mode = get('ifs.color');
        const key = `${pal.dark}|${mode}|${st.grid.version}`;
        const img = ensureImage(p, st.img, st.grid.w, st.grid.h);
        if (st.imgKey !== key || st.img.version < 0) {
            gridToImage(st.grid, img, { mode, bg, fg: mode === 'density' ? [255, 190, 90] : [pal.dark ? 235 : 40, pal.dark ? 238 : 40, pal.dark ? 245 : 50], colors });
            st.imgKey = key;
            st.img.version = st.grid.version;
        }
        p.image(img, r.x, r.y);
        if (get('ifs.showMaps')) drawMaps(pal, colors);
        p.noStroke();
        p.fill(pal.fg);
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        const lines = [
            `${getIfsPreset(st.presetId).label}   ${st.grid.total.toLocaleString('en-US')} points${get('ifs.paused') ? '  (paused)' : ''}`,
            st.dims,
        ];
        if (st.boxDim) lines.push(`box-counting dimension ~ ${st.boxDim.dimension.toFixed(3)}  (r2 = ${st.boxDim.r2.toFixed(4)})`);
        lines.forEach((t, i) => p.text(t, r.x + 10, r.y + 8 + i * 16));
    }

    function drawMaps(pal, colors) {
        const v = st.view;
        const f = st.frame;
        const [fx0, fy0] = v.toScreen(f.xmin, f.ymin), [fx1, fy1] = v.toScreen(f.xmax, f.ymax);
        p.noFill();
        p.stroke(pal.axis);
        p.strokeWeight(1);
        p.rect(Math.min(fx0, fx1), Math.min(fy0, fy1), Math.abs(fx1 - fx0), Math.abs(fy1 - fy0));
        st.maps.forEach((m, i) => {
            const c = corners(m);
            const col = colors[i % colors.length];
            const sel = i === st.selected;
            const P = [c.O, c.X, c.XY, c.Y].map((q) => v.toScreen(q[0], q[1]));
            if (!P.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.abs(q[0]) < 1e6 && Math.abs(q[1]) < 1e6)) return;
            p.stroke(col[0], col[1], col[2], sel ? 255 : 170);
            p.strokeWeight(sel ? 2.2 : 1.3);
            p.fill(col[0], col[1], col[2], sel ? 46 : 22);
            p.beginShape();
            P.forEach((q) => p.vertex(q[0], q[1]));
            p.endShape(p.CLOSE);
            // orientation marks: O -> X (long edge), O -> Y
            p.stroke(col[0], col[1], col[2], 255);
            p.strokeWeight(sel ? 3 : 2);
            p.line(P[0][0], P[0][1], P[1][0], P[1][1]);
            p.fill(col[0], col[1], col[2], 255);
            p.noStroke();
            p.rect(P[0][0] - 5, P[0][1] - 5, 10, 10);
            p.circle(P[1][0], P[1][1], 11);
            p.circle(P[3][0], P[3][1], 11);
            p.fill(pal.fg);
            p.textSize(11);
            p.textAlign(p.CENTER, p.CENTER);
            const cx = (P[0][0] + P[2][0]) / 2, cy = (P[0][1] + P[2][1]) / 2;
            p.text(String(i + 1), cx, cy);
        });
    }

    // ---------- interaction ----------
    function handlePoints(i) {
        const c = corners(st.maps[i]);
        return { O: st.view.toScreen(c.O[0], c.O[1]), X: st.view.toScreen(c.X[0], c.X[1]), Y: st.view.toScreen(c.Y[0], c.Y[1]) };
    }

    const insideMap = (i, px, py) => {
        const c = corners(st.maps[i]);
        const P = [c.O, c.X, c.XY, c.Y].map((q) => st.view.toScreen(q[0], q[1]));
        let sign = 0;
        for (let k = 0; k < 4; k++) {
            const a = P[k], b = P[(k + 1) % 4];
            const cr = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
            if (cr !== 0) {
                if (sign === 0) sign = Math.sign(cr);
                else if (Math.sign(cr) !== sign) return false;
            }
        }
        return true;
    };

    function setCorner(m, which, wx, wy) {
        const f = st.frame;
        const fw = f.xmax - f.xmin, fh = f.ymax - f.ymin;
        const O = apply(m, f.xmin, f.ymin);
        if (which === 'O') {
            m.e += wx - O[0]; m.f += wy - O[1];
            return;
        }
        if (which === 'X') { m.a = (wx - O[0]) / fw; m.c = (wy - O[1]) / fw; }
        else { m.b = (wx - O[0]) / fh; m.d = (wy - O[1]) / fh; }
        m.e = O[0] - (m.a * f.xmin + m.b * f.ymin);
        m.f = O[1] - (m.c * f.xmin + m.d * f.ymin);
    }

    function press(x, y) {
        const r = rectNow();
        if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
        st.drag = null;
        if (get('ifs.showMaps')) {
            const order = st.maps.map((_, i) => i).reverse();
            order.sort((a, b) => (b === st.selected) - (a === st.selected));
            for (const i of order) {
                const h = handlePoints(i);
                for (const which of ['X', 'Y', 'O']) {
                    if (Math.hypot(x - h[which][0], y - h[which][1]) <= HIT) {
                        st.selected = i;
                        st.drag = { kind: 'corner', map: i, which, lx: x, ly: y };
                        return true;
                    }
                }
            }
            for (const i of order) {
                if (insideMap(i, x, y)) {
                    st.selected = i;
                    st.drag = { kind: 'corner', map: i, which: 'O', lx: x, ly: y };
                    return true;
                }
            }
        }
        st.drag = { kind: 'pan', lx: x, ly: y };
        return true;
    }

    function dragTo(x, y) {
        const d = st.drag;
        if (!d) return false;
        if (d.kind === 'pan') {
            st.view.pan(x - d.lx, y - d.ly);
            d.lx = x; d.ly = y;
            restart();
            return true;
        }
        const m = st.maps[d.map];
        const c = corners(m);
        const [wx, wy] = st.view.toWorld(x, y);
        const [lwx, lwy] = st.view.toWorld(d.lx, d.ly);
        const base = d.which === 'O' ? c.O : d.which === 'X' ? c.X : c.Y;
        setCorner(m, d.which, base[0] + (wx - lwx), base[1] + (wy - lwy));
        d.lx = x; d.ly = y;
        if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite)) Object.assign(m, { a: 0.3, b: 0, c: 0, d: 0.3, e: 0, f: 0 });
        restart();
        return true;
    }

    function release() {
        const had = !!st.drag;
        st.drag = null;
        return had;
    }

    function wheel(e, x, y) {
        const r = rectNow();
        if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
        const d = wheelDelta(e);
        if (!d) return false;
        st.view.zoomAt(x, y, Math.exp(-d * 0.0015), 0.01, 1e7);
        restart();
        return true;
    }

    // ---------- actions ----------
    const actions = {
        add() {
            if (st.maps.length >= MAX_MAPS) return;
            const f = st.frame;
            const k = st.maps.length;
            const s = 0.35;
            st.maps.push({
                a: s, b: 0, c: 0, d: s, p: 0.5,
                e: f.xmin + (f.xmax - f.xmin) * (0.15 + 0.2 * (k % 3)), f: f.ymin + (f.ymax - f.ymin) * (0.15 + 0.2 * ((k + 1) % 3)),
            });
            st.selected = k;
            pushWeights();
            restart();
        },
        remove() {
            if (st.maps.length <= 1) return;
            st.maps.splice(st.selected, 1);
            st.selected = Math.min(st.selected, st.maps.length - 1);
            pushWeights();
            restart();
        },
        reset() { loadPreset(st.presetId || 'sierpinski'); },
        clear() { restart(); },
        fit() { fitView(); restart(); },
        boxCount() { st.boxDim = boxCountDimension(st.grid); },
    };

    return {
        st, actions, sync, step, draw, press, dragTo, release, wheel, rectNow,
        get maps() { return st.maps; },
        get grid() { return st.grid; },
        handlePoints,
        presets: IFS_PRESETS,
    };
}
