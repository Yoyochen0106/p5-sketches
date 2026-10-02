// Tab 2: Moebius / Kleinian groups on the plane. The limit set is accumulated into a density image by the
// random-walk chaos game and / or the depth-limited enumeration of reduced words. Schottky groups are edited
// by dragging circle pairs; two-generator groups come from Grandma's recipe (Indra's Pearls).
import * as K from '../../lib/kleinian.js';
import { DensityGrid } from '../../lib/ifs.js';
import {
    PlaneView, gridToImage, ensureImage, hexToRgb, tagColors, clamp, wheelDelta, withClip, arrow,
} from './view.js';
import { KLEIN_PRESETS, getKleinPreset, defaultPair } from './presets.js';

export const CLOUD_CAP = 200000;
const MAX_POINTS = 30e6;
const MAX_PER_FRAME = 200000;
const HIT = 11;
const letterName = (j) => String.fromCharCode(j % 2 ? 65 + (j >> 1) : 97 + (j >> 1));
const isFin2 = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7;

/** Creates the plane tab. env = { p, get, set, pal(), rect() }. */
export function createPlaneTab(env) {
    const { p, get, set } = env;
    const st = {
        presetId: null, kind: 'apollonian', pairs: [], group: null, packed: null, check: null, recipe: null,
        gasket: null, dual: null, view: null, grid: null, img: {}, imgKey: '',
        cloud: { xy: new Float64Array(2 * CLOUD_CAP), tag: new Uint8Array(CLOUD_CAP), count: 0, head: 0, version: 0 },
        chaos: null, seed: 1, wordsDone: false, drag: null, z0: [0.27, 0.41], orbit: null, orbitKey: '',
        paramKey: '', accumKey: '', size: '', info: [], buf: new Float64Array(2 * MAX_PER_FRAME), tagBuf: new Uint8Array(MAX_PER_FRAME),
        words: null,
    };

    const rectNow = () => {
        const r = env.rect();
        return { x: r.x, y: r.y, w: Math.max(16, Math.floor(r.w)), h: Math.max(16, Math.floor(r.h)) };
    };

    // ---------- group construction ----------
    function currentPairs() {
        return st.pairs.map((q, k) => ({ ...q, theta: Number(get(`kl.theta${k}`)) || 0 }));
    }

    function rebuild() {
        st.group = null; st.packed = null; st.check = null; st.recipe = null; st.info = [];
        st.kind = get('kl.kind');
        if (st.kind === 'apollonian') {
            st.gasket = K.apollonianGasket({ depth: clamp(Math.floor(get('kl.depth')), 1, 6), minRadius: 0, maxCircles: 4000 });
            st.dual = K.apollonianDualCircles();
            st.info = ['Descartes: (k1+k2+k3+k4)^2 = 2 (k1^2+k2^2+k3^2+k4^2)', `${st.gasket.circles.length} circles; limit set = residual set (chaos game with inversions in the dual circles)`];
        } else if (st.kind === 'schottky') {
            st.group = K.schottkyGroup(currentPairs());
            st.check = K.schottkyCheck(st.group);
            st.packed = K.packGroup(st.group);
            st.info = [st.check.ok
                ? `ping-pong holds: the ${st.group.letters.length} discs are disjoint (min gap ${st.check.minGap.toFixed(3)})`
                : 'discs overlap: not a Schottky group (the picture is no longer a limit set)'];
        } else {
            const ta = [Number(get('kl.taRe')), Number(get('kl.taIm'))];
            const tb = st.kind === 'maskit' ? [2, 0] : [Number(get('kl.tbRe')), Number(get('kl.tbIm'))];
            const rec = ta.concat(tb).every(Number.isFinite) ? K.grandmasRecipe(ta, tb) : null;
            st.recipe = rec;
            if (rec) {
                st.group = K.groupFromGenerators([rec.a, rec.b]);
                st.packed = K.packGroup(st.group);
                const f = (z) => `${z[0].toFixed(3)}${z[1] < 0 ? '-' : '+'}${Math.abs(z[1]).toFixed(3)}i`;
                st.info = [
                    `tr a = ${f(ta)} (${K.classify(rec.a)}),  tr b = ${f(tb)} (${K.classify(rec.b)}),  tr ab = ${f(rec.tab)}`,
                    `tr[a, b] = ${f(K.commutatorTrace(rec.a, rec.b))}  (parabolic commutator: Grandma's recipe)`,
                ];
            } else {
                st.info = ['degenerate parameters for the recipe'];
            }
        }
        st.orbitKey = '';
    }

    function restartAccum() {
        const r = rectNow();
        const view = st.view.gridView();
        if (!st.grid || st.grid.w !== r.w || st.grid.h !== r.h) st.grid = new DensityGrid(r.w, r.h, view);
        else st.grid.setView(view);
        st.cloud.count = 0; st.cloud.head = 0; st.cloud.version++;
        st.chaos = K.createGroupChaos(st.seed);
        st.wordsDone = false;
        st.words = null;
        st.accumKey = accumKey();
        st.size = `${r.w}x${r.h}`;
    }

    const paramKey = () => [
        get('kl.kind'), get('kl.nGens'), get('kl.taRe'), get('kl.taIm'), get('kl.tbRe'), get('kl.tbIm'),
        get('kl.theta0'), get('kl.theta1'), get('kl.theta2'),
    ].join('|');
    const accumKey = () => `${get('kl.method')}|${get('kl.depth')}`;

    function fitView(half, cx = 0, cy = 0) {
        const r = rectNow();
        st.view = new PlaneView(r, cx, cy, r.h / 2 / half);
    }

    function loadPreset(id) {
        const pre = getKleinPreset(id);
        if (!pre) return;
        st.presetId = pre.id;
        set('kl.kind', pre.kind);
        if (pre.kind === 'schottky') {
            st.pairs = pre.pairs.map((q) => ({ c1: q.c1.slice(), r1: q.r1, c2: q.c2.slice(), r2: q.r2, theta: q.theta }));
            set('kl.nGens', st.pairs.length);
            st.pairs.forEach((q, k) => { if (k < 3) set(`kl.theta${k}`, q.theta); });
        } else if (pre.ta) {
            set('kl.taRe', pre.ta[0]); set('kl.taIm', pre.ta[1]);
            set('kl.tbRe', pre.tb[0]); set('kl.tbIm', pre.tb[1]);
        }
        fitView(pre.view.half, pre.view.cx, pre.view.cy);
        st.paramKey = paramKey();
        rebuild();
        restartAccum();
    }

    /** The user changed the circles: the group is now custom. */
    function markCustom() {
        st.presetId = '';
        if (get('kl.preset') !== '') set('kl.preset', '');
        st.paramKey = paramKey();
        rebuild();
        restartAccum();
    }

    function sync() {
        const id = get('kl.preset');
        if (!st.view) {
            loadPreset(id || 'apollonian');
            if (!id) set('kl.preset', 'apollonian');
            return;
        }
        if (id && id !== st.presetId) { loadPreset(id); return; }
        const r = rectNow();
        if (!st.grid || `${r.w}x${r.h}` !== st.size) {
            st.view = new PlaneView(r, st.view.cx, st.view.cy, st.view.scale);
            restartAccum();
        }
        const pk = paramKey();
        if (pk !== st.paramKey) {
            st.paramKey = pk;
            if (st.kind === 'schottky') {
                const n = clamp(Math.floor(Number(get('kl.nGens'))) || 2, 1, 3);
                while (st.pairs.length < n) st.pairs.push(defaultPair(st.pairs.length));
                if (st.pairs.length > n) st.pairs.length = n;
            }
            const pre = getKleinPreset(st.presetId);
            if (pre && !presetMatches(pre)) { st.presetId = ''; set('kl.preset', ''); } // the user moved a parameter
            rebuild();
            restartAccum();
        } else if (accumKey() !== st.accumKey) {
            if (st.kind === 'apollonian') rebuild();
            restartAccum();
        }
    }

    function presetMatches(pre) {
        if (pre.kind === 'schottky') {
            return pre.pairs.length === st.pairs.length && pre.pairs.every((q, k) => Math.abs(q.theta - Number(get(`kl.theta${k}`))) < 1e-9);
        }
        if (pre.ta) {
            return Math.abs(pre.ta[0] - get('kl.taRe')) < 1e-9 && Math.abs(pre.ta[1] - get('kl.taIm')) < 1e-9
                && (pre.kind === 'maskit' || (Math.abs(pre.tb[0] - get('kl.tbRe')) < 1e-9 && Math.abs(pre.tb[1] - get('kl.tbIm')) < 1e-9));
        }
        return true;
    }

    // ---------- point production ----------
    function push(xy, tags, m) {
        const g = st.grid, c = st.cloud;
        const { counts, tag, w, h } = g;
        const { xmin, ymax } = g.view;
        const sx = g.sx, sy = g.sy;
        const cxy = c.xy, ctag = c.tag;
        let head = c.head, count = c.count, inView = 0;
        for (let i = 0; i < m; i++) {
            const x = xy[2 * i], y = xy[2 * i + 1];
            const fx = (x - xmin) * sx, fy = (ymax - y) * sy;
            if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
                const k = (fy | 0) * w + (fx | 0);
                counts[k]++;
                tag[k] = tags[i];
                inView++;
            }
            cxy[2 * head] = x; cxy[2 * head + 1] = y; ctag[head] = tags[i];
            head = head + 1 === CLOUD_CAP ? 0 : head + 1;
            if (count < CLOUD_CAP) count++;
        }
        g.inView += inView;
        g.outside += m - inView;
        g.version++;
        c.head = head; c.count = count;
        c.version++;
    }

    function step() {
        if (get('kl.paused') || !st.grid || st.grid.total >= MAX_POINTS) return;
        const method = get('kl.method');
        const n = clamp(Math.floor(Number(get('kl.speed')) || 20000), 1000, MAX_PER_FRAME);
        if (st.kind === 'apollonian') {
            const out = K.inversionChaos(st.dual, n, { seed: ++st.seed });
            push(out.points, out.tags, out.count);
            return;
        }
        if (!st.group) return;
        if (method !== 'chaos' && !st.wordsDone) {
            st.wordsDone = true;
            const dragging = !!st.drag;
            const e = K.enumerateWords(st.group, {
                maxDepth: clamp(Math.floor(get('kl.depth')), 1, 16),
                minSize: 0.5 / st.view.scale,
                maxNodes: dragging ? 30000 : 150000,
            });
            st.words = { count: e.count, truncated: e.truncated, depth: e.depth };
            const pts = e.points;
            const tags = e.first; // colour by the first letter of the word: the leaf lies inside that letter's disc
            const keep = [];
            for (let i = 0; i < e.count; i++) if (isFin2(pts[2 * i], pts[2 * i + 1])) keep.push(i);
            const xy = new Float64Array(2 * keep.length), tg = new Uint8Array(keep.length);
            keep.forEach((i, j) => { xy[2 * j] = pts[2 * i]; xy[2 * j + 1] = pts[2 * i + 1]; tg[j] = tags[i]; });
            push(xy, tg, keep.length);
        }
        if (method !== 'words') {
            const m = K.groupChaos(st.packed, st.chaos, n, st.buf, st.tagBuf);
            push(st.buf, st.tagBuf, m);
        }
    }

    // ---------- orbit of the test point ----------
    function computeOrbit() {
        const depth = clamp(Math.floor(get('kl.orbitDepth')), 1, 5);
        const key = `${st.paramKey}|${st.z0.join(',')}|${depth}|${st.kind}`;
        if (key === st.orbitKey) return st.orbit;
        st.orbitKey = key;
        if (st.kind === 'apollonian') {
            const pts = [st.z0.slice()], parent = [-1], letter = [-1], level = [0];
            for (let h = 0; h < pts.length && pts.length < 600; h++) {
                if (level[h] >= depth) continue;
                st.dual.forEach((c, j) => {
                    if (j === letter[h]) return;
                    const z = K.invertInCircle(c, pts[h]);
                    if (!isFin2(z[0], z[1])) return;
                    pts.push(z); parent.push(h); letter.push(j); level.push(level[h] + 1);
                });
            }
            st.orbit = { count: pts.length, pts: Float64Array.from(pts.flat()), parent: Int32Array.from(parent), letter: Int8Array.from(letter), level: Uint8Array.from(level) };
        } else if (st.group) {
            st.orbit = K.orbitTree(st.group, st.z0, depth, 600);
        } else {
            st.orbit = null;
        }
        return st.orbit;
    }

    // ---------- circles for the overlay / the sphere ----------
    function circleList() {
        if (st.kind === 'apollonian') {
            return st.dual.map((c, j) => ({ circle: c, tag: j, label: '' }))
                .concat(K.APOLLONIAN_START.map((q, j) => ({ circle: { c: q.c, r: q.r }, tag: j, label: '', start: true })));
        }
        if (!st.group) return [];
        return st.group.letters.map((l, j) => ({ circle: l.to, tag: j, label: letterName(j) }));
    }

    // ---------- drawing ----------
    function draw() {
        const pal = env.pal();
        const r = rectNow();
        const bg = hexToRgb(pal.bg);
        const colors = tagColors(pal);
        const cmode = get('kl.color');
        const mode = cmode === 'letter' ? 'tag' : cmode;
        const key = `${pal.dark}|${mode}|${st.grid.version}`;
        const img = ensureImage(p, st.img, st.grid.w, st.grid.h);
        if (st.imgKey !== key || st.img.version < 0) {
            gridToImage(st.grid, img, { mode, bg, fg: mode === 'density' ? [255, 190, 90] : [pal.dark ? 235 : 40, pal.dark ? 238 : 40, pal.dark ? 245 : 50], colors, gamma: 0.45 });
            st.imgKey = key;
            st.img.version = st.grid.version;
        }
        p.image(img, r.x, r.y);
        withClip(p, r, () => {
            if (get('kl.showCircles')) drawCircles(pal, colors);
            if (get('kl.showOrbit')) drawOrbit(pal, colors);
        });
        p.noStroke();
        p.fill(pal.fg);
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        const preset = getKleinPreset(st.presetId);
        const head = `${preset ? preset.label : 'custom group'}   ${st.grid.total.toLocaleString('en-US')} points${get('kl.paused') ? '  (paused)' : ''}`;
        const lines = [head, ...st.info];
        if (st.words && get('kl.method') !== 'chaos') lines.push(`words: ${st.words.count} limit points, depth <= ${st.words.depth}${st.words.truncated ? ' (node cap reached)' : ''}`);
        lines.forEach((t, i) => p.text(t, r.x + 10, r.y + 8 + i * 16));
    }

    function drawCircles(pal, colors) {
        const v = st.view;
        const r = rectNow();
        const circ = (c, r) => {
            const [sx, sy] = v.toScreen(c[0], c[1]);
            const d = 2 * r * v.scale;
            if (isFin2(sx, sy) && Number.isFinite(d) && d < 1e6) p.circle(sx, sy, d);
        };
        const line = (q) => {
            const R = 4 * (r.w + r.h) / v.scale;
            const a = v.toScreen(q.p[0] - q.dir[0] * R, q.p[1] - q.dir[1] * R), b = v.toScreen(q.p[0] + q.dir[0] * R, q.p[1] + q.dir[1] * R);
            if (isFin2(a[0], a[1]) && isFin2(b[0], b[1])) p.line(a[0], a[1], b[0], b[1]);
        };
        p.noFill();
        if (st.kind === 'apollonian') {
            p.stroke(pal.muted);
            p.strokeWeight(1);
            let drawn = 0;
            for (const q of st.gasket.circles) {
                if (q.r * v.scale < 1.5 || drawn > 1800) continue;
                circ(q.c, q.r);
                drawn++;
            }
            st.dual.forEach((c, j) => {
                const col = colors[j % colors.length];
                p.stroke(col[0], col[1], col[2], 220);
                p.strokeWeight(1.6);
                if (c.line) line(c); else circ(c.c, c.r);
            });
            return;
        }
        if (!st.group) return;
        const L = st.group.letters;
        L.forEach((l, j) => {
            const col = colors[j % colors.length];
            p.stroke(col[0], col[1], col[2], 230);
            p.strokeWeight(1.6);
            if (l.to.r > 0) circ(l.to.c, l.to.r);
            const [sx, sy] = v.toScreen(l.to.c[0], l.to.c[1]);
            if (isFin2(sx, sy)) {
                p.noStroke();
                p.fill(col[0], col[1], col[2]);
                p.textSize(13);
                p.textAlign(p.CENTER, p.CENTER);
                p.text(letterName(j), sx, sy - 14);
                p.noFill();
            }
        });
        // pairing arrows g_k : circle of g_k^-1 -> circle of g_k (they map the outside of `from` onto the disc `to`)
        for (let j = 0; j < L.length; j += 2) {
            const a = L[j].from, b = L[j].to;
            if (!(a.r > 0 && b.r > 0)) continue;
            const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1], d = Math.hypot(dx, dy);
            if (d < 1e-9) continue;
            const ux = dx / d, uy = dy / d;
            const p0 = v.toScreen(a.c[0] + ux * a.r, a.c[1] + uy * a.r), p1 = v.toScreen(b.c[0] - ux * b.r, b.c[1] - uy * b.r);
            const col = colors[j % colors.length];
            p.stroke(col[0], col[1], col[2], 200);
            p.strokeWeight(1.4);
            if (isFin2(p0[0], p0[1]) && isFin2(p1[0], p1[1]) && d > a.r + b.r) arrow(p, p0[0], p0[1], p1[0], p1[1], 9);
        }
        if (st.kind === 'schottky') {
            p.noStroke();
            st.pairs.forEach((q) => {
                for (const side of [1, 2]) {
                    const c = side === 1 ? q.c1 : q.c2, rr = side === 1 ? q.r1 : q.r2;
                    const [sx, sy] = v.toScreen(c[0], c[1]);
                    const [hx, hy] = v.toScreen(c[0] + rr, c[1]);
                    p.fill(pal.fg);
                    p.rect(sx - 4, sy - 4, 8, 8);
                    p.circle(hx, hy, 9);
                }
            });
        }
    }

    function drawOrbit(pal, colors) {
        const o = computeOrbit();
        const v = st.view;
        const [zx, zy] = v.toScreen(st.z0[0], st.z0[1]);
        if (o) {
            p.strokeWeight(1);
            for (let i = 1; i < o.count; i++) {
                const a = v.toScreen(o.pts[2 * i], o.pts[2 * i + 1]);
                const b = v.toScreen(o.pts[2 * o.parent[i]], o.pts[2 * o.parent[i] + 1]);
                const col = colors[((o.letter[i] % colors.length) + colors.length) % colors.length];
                if (!isFin2(a[0], a[1]) || !isFin2(b[0], b[1])) continue;
                p.stroke(col[0], col[1], col[2], 90);
                p.line(b[0], b[1], a[0], a[1]);
                p.noStroke();
                p.fill(col[0], col[1], col[2], 235);
                p.circle(a[0], a[1], Math.max(3, 7 - o.level[i]));
            }
        }
        p.stroke(pal.fg);
        p.strokeWeight(2);
        p.noFill();
        if (isFin2(zx, zy)) {
            p.circle(zx, zy, 14);
            p.line(zx - 9, zy, zx + 9, zy);
            p.line(zx, zy - 9, zx, zy + 9);
        }
    }

    // ---------- interaction ----------
    function handleList() {
        const list = [];
        if (get('kl.showOrbit')) list.push({ kind: 'z0', pos: st.z0 });
        if (st.kind === 'schottky') {
            st.pairs.forEach((q, k) => {
                for (const side of [1, 2]) {
                    const c = side === 1 ? q.c1 : q.c2, rr = side === 1 ? q.r1 : q.r2;
                    list.push({ kind: 'radius', pair: k, side, pos: [c[0] + rr, c[1]] });
                    list.push({ kind: 'centre', pair: k, side, pos: c });
                }
            });
        }
        return list;
    }

    function press(x, y) {
        const r = rectNow();
        if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
        st.drag = null;
        for (const h of handleList()) {
            const [sx, sy] = st.view.toScreen(h.pos[0], h.pos[1]);
            if (Math.hypot(x - sx, y - sy) <= HIT) {
                st.drag = { ...h, lx: x, ly: y };
                return true;
            }
        }
        st.drag = { kind: 'pan', lx: x, ly: y };
        return true;
    }

    function dragTo(x, y) {
        const d = st.drag;
        if (!d) return false;
        const [wx, wy] = st.view.toWorld(x, y);
        if (d.kind === 'pan') {
            st.view.pan(x - d.lx, y - d.ly);
            d.lx = x; d.ly = y;
            restartAccum();
            return true;
        }
        if (d.kind === 'z0') {
            st.z0 = [wx, wy];
            return true;
        }
        const q = st.pairs[d.pair];
        const cKey = d.side === 1 ? 'c1' : 'c2', rKey = d.side === 1 ? 'r1' : 'r2';
        if (d.kind === 'centre') {
            const [lwx, lwy] = st.view.toWorld(d.lx, d.ly);
            q[cKey] = [q[cKey][0] + wx - lwx, q[cKey][1] + wy - lwy];
        } else {
            q[rKey] = clamp(Math.hypot(wx - q[cKey][0], wy - q[cKey][1]), 0.02, 1e4);
        }
        d.lx = x; d.ly = y;
        markCustom();
        return true;
    }

    function release() {
        const had = !!st.drag;
        const wasEdit = st.drag && (st.drag.kind === 'centre' || st.drag.kind === 'radius');
        st.drag = null;
        if (wasEdit) { st.wordsDone = false; restartAccum(); } // full-quality words after the drag
        return had;
    }

    function wheel(e, x, y) {
        const r = rectNow();
        if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) return false;
        const d = wheelDelta(e);
        if (!d) return false;
        st.view.zoomAt(x, y, Math.exp(-d * 0.0015), 1e-3, 1e8);
        restartAccum();
        return true;
    }

    return {
        st, sync, step, draw, press, dragTo, release, wheel, rectNow, circleList, letterName,
        get cloud() { return st.cloud; },
        get grid() { return st.grid; },
        get group() { return st.group; },
        get pairs() { return st.pairs; },
        get gasket() { return st.gasket; },
        presets: KLEIN_PRESETS,
        actions: {
            clear() { restartAccum(); },
            fit() { const pre = getKleinPreset(st.presetId); const h = pre ? pre.view : { half: 2, cx: 0, cy: 0 }; fitView(h.half, h.cx, h.cy); restartAccum(); },
            reset() { const id = st.presetId || get('kl.preset') || 'apollonian'; st.presetId = null; loadPreset(id); },
        },
    };
}
