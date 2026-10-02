// Tab 4: the argument principle. The winding number of the image curve f(C) about 0 equals (zeros - poles) inside C.
// 'Nyquist mode' applies it to the D contour in the right half plane and L(s) = K num/den e^{-s delay}: the
// number of encirclements of -1 gives the number of unstable closed-loop poles.

import * as C from '../../lib/complex.js';
import {
    fromFactored, evalRational, traceImage, contourPolyline, zerosMinusPoles, distanceToContour, nyquist, loopTransfer, polyMul, polyScale,
    parseCoefs,
} from '../../lib/residues.js';
import { polyFromRoots, polyRoots } from '../../lib/conformal.js';
import {
    Viewport, Scene, FONT, TAU, fmt, fmtC, clip, polyline, drawAxes, cross, arrow, chevrons, panelFrame, textBox, wrapText,
    domainImage, dashed, clamp, parseRows, rowsToText,
} from './common.js';
import { ContourEditor } from './model.js';

export const ARG_PRESETS = [
    {
        id: 'cubic', label: 'Cubic polynomial: three zeros',
        caption: 'f(z) = (z-a)(z-b)(z-c). Drag a zero across the contour: the winding number of f(C) about 0 changes by 1.',
        zeros: '1,0.5;-1,0.8;0.2,-1.2', poles: '', contour: { kind: 'circle', c: [0, 0], r: 1.6 },
    },
    {
        id: 'zp', label: 'Zeros and a double pole',
        caption: 'The winding number counts zeros minus poles, with multiplicity: a double pole inside lowers it by 2.',
        zeros: '0.8,0.3;-0.6,-0.4;2.4,1.2', poles: '0,0.1,2;-2.2,1.5,1', contour: { kind: 'circle', c: [0, 0], r: 1.4 },
    },
    {
        id: 'poly', label: 'Polygon contour, five zeros',
        caption: 'The contour need not be a circle: any closed curve works, f(C) just has to avoid 0.',
        zeros: '1.5,0;0.46,1.43;-1.21,0.88;-1.21,-0.88;0.46,-1.43', poles: '', contour: { kind: 'poly', pts: [[-2, -1.6], [1.9, -1.9], [2.1, 1.6], [-0.5, 2.1]] },
    },
];

export const NYQ_PRESETS = [
    { id: 'type0', label: 'Type 0: K / ((s+1)(s+2)(s+3))', num: '1', den: '1,6,11,6', K: 20, delay: 0, caption: 'Stable for K < 60: at K = 60 the Nyquist curve passes through -1.' },
    { id: 'type1', label: 'Type 1: K / (s(s+1)(s+2))', num: '1', den: '1,3,2,0', K: 2, delay: 0, caption: 'Pole at the origin: the D contour is indented, the image has a huge arc at infinity. Stable for K < 6.' },
    { id: 'unstable', label: 'Unstable open loop: K / (s - 1)', num: '1', den: '1,-1', K: 3, delay: 0, caption: 'P = 1: stabilised only if the curve encircles -1 once counter-clockwise (K > 1).' },
    { id: 'delay', label: 'Time delay: K / (s+1) e^{-s T}', num: '1', den: '1,1', K: 3, delay: 1.2, caption: 'A delay adds phase lag without bounded poles: the curve spirals and encircles -1 for large K T.' },
    { id: 'osc', label: 'Resonant: K (s+1) / (s^2 + 0.4 s + 4)(s + 2)', num: '1,1', den: '1,2.4,4.8,8', K: 6, delay: 0, caption: 'Lightly damped poles give a big loop near the resonance; moving the poles changes the encirclements.' },
];

const MAX_ZEROS_ARG = 6;
const MAX_POLES_ARG = 4;

/** Highest-power-first coefficient text of real polynomial coefficients (ascending complex input). */
const coefText = (asc) => asc.slice().reverse().map((c) => +c[0].toFixed(5)).join(',');

export function createArgTab(env) {
    const { p, get, set } = env;
    const scene = new Scene();
    const edit = new ContourEditor({ kind: 'akind', cx: 'acx', cy: 'acy', r: 'ar', pts: 'apts' }, { c: [0, 0], r: 1.6 });
    const zv = new Viewport(-3.5, 3.5, -2.6, 2.6);
    const wv = new Viewport(-3, 3, -3, 3);
    scene.panels = { z: zv, w: wv };
    const cache = {};
    const st = {
        zeros: [], poles: [], nz: [], np: [], lead: [1, 1], rectA: { x: 0, y: 0, w: 1, h: 1 }, rectB: { x: 0, y: 0, w: 1, h: 1 },
        res: null, key: '', caption: '', lastPreset: null, lastNPreset: null, lastTexts: {}, lastNumDen: '', dirty: true, version: 0, saveAt: 0, pending: false, animT: 0,
    };
    const isNyq = () => !!get('nyq');

    // -------- model I/O --------
    function loadPlain() {
        st.zeros = parseRows(get('azeros'), 2).slice(0, MAX_ZEROS_ARG).map((r) => [r[0], r[1]]);
        st.poles = parseRows(get('apoles'), 3).slice(0, MAX_POLES_ARG).map((r) => ({ z: [r[0], r[1]], m: clamp(Math.round(r[2]), 1, 3) }));
        edit.load(get);
        st.lastTexts = { z: String(get('azeros')), p: String(get('apoles')), c: [get('akind'), get('acx'), get('acy'), get('ar'), get('apts')].join('|') };
        st.version++;
    }

    function savePlain() {
        set('azeros', rowsToText(st.zeros));
        set('apoles', rowsToText(st.poles.map((q) => [q.z[0], q.z[1], q.m])));
        edit.save(set);
        st.lastTexts = { z: String(get('azeros')), p: String(get('apoles')), c: [get('akind'), get('acx'), get('acy'), get('ar'), get('apts')].join('|') };
    }

    function rootsToItems(asc) {
        const items = [];
        for (const z of polyRoots(asc)) {
            if (Math.abs(z[1]) <= 1e-6) items.push({ z: [z[0], 0], pair: false });
            else if (z[1] > 0) items.push({ z: [z[0], z[1]], pair: true });
        }
        return items;
    }

    function loadNyq() {
        const num = parseCoefs(get('num')) || [1];
        const den = parseCoefs(get('den')) || [1, 1];
        const toAsc = (a) => a.slice().reverse().map((v) => [v, 0]);
        let n = toAsc(num);
        let d = toAsc(den);
        while (n.length > 1 && n[n.length - 1][0] === 0) n.pop();
        while (d.length > 1 && d[d.length - 1][0] === 0) d.pop();
        st.lead = [n[n.length - 1][0], d[d.length - 1][0]];
        st.nz = n.length > 1 ? rootsToItems(n) : [];
        st.np = d.length > 1 ? rootsToItems(d) : [];
        st.lastNumDen = `${get('num')}|${get('den')}`;
        st.version++;
    }

    const expand = (items) => items.flatMap((q) => (q.pair ? [q.z, [q.z[0], -q.z[1]]] : [q.z]));

    function saveNyq(now) {
        const t = Date.now();
        if (!now && t - st.saveAt < 200) { st.pending = true; return; }
        st.saveAt = t;
        st.pending = false;
        const n = polyScale(expand(st.nz).length ? polyFromRoots(expand(st.nz)) : [[1, 0]], [st.lead[0], 0]);
        const d = polyScale(expand(st.np).length ? polyFromRoots(expand(st.np)) : [[1, 0]], [st.lead[1], 0]);
        set('num', coefText(n));
        set('den', coefText(d));
        st.lastNumDen = `${get('num')}|${get('den')}`;
    }

    function applyPlainPreset(id) {
        const pr = ARG_PRESETS.find((q) => q.id === id) || ARG_PRESETS[0];
        st.zeros = parseRows(pr.zeros, 2).map((r) => [r[0], r[1]]);
        st.poles = parseRows(pr.poles, 3).map((r) => ({ z: [r[0], r[1]], m: r[2] }));
        edit.assign(pr.contour);
        st.caption = pr.caption;
        st.lastPreset = id;
        savePlain();
        st.version++;
        fit();
    }

    function applyNyqPreset(id) {
        const pr = NYQ_PRESETS.find((q) => q.id === id) || NYQ_PRESETS[0];
        set('num', pr.num);
        set('den', pr.den);
        set('K', pr.K);
        set('delay', pr.delay);
        st.caption = pr.caption;
        st.lastNPreset = id;
        loadNyq();
        fit();
    }

    function fit() {
        if (isNyq()) {
            zv.set(-5, 3, -3.6, 3.6).lockAspect();
            wv.set(-4, 2, -3, 3).lockAspect();
        } else {
            zv.set(-3.5, 3.5, -2.6, 2.6).lockAspect();
            wv.set(-3, 3, -3, 3).lockAspect();
        }
        scene.userView.z = false;
        scene.userView.w = false;
        st.fitW = true;
    }

    function layout(w, h) {
        const gap = 8;
        const inner = { x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap };
        let a;
        let b;
        if (w >= h * 1.15) {
            const wa = Math.round((inner.w - gap) * 0.5);
            a = { x: inner.x, y: inner.y, w: wa, h: inner.h };
            b = { x: inner.x + wa + gap, y: inner.y, w: inner.w - wa - gap, h: inner.h };
        } else {
            const ha = Math.round((inner.h - gap) * 0.5);
            a = { x: inner.x, y: inner.y, w: inner.w, h: ha };
            b = { x: inner.x, y: inner.y + ha + gap, w: inner.w, h: inner.h - ha - gap };
        }
        st.rectA = a;
        st.rectB = b;
        zv.setRect(a.x, a.y, a.w, a.h).lockAspect();
        wv.setRect(b.x, b.y, b.w, b.h).lockAspect();
        st.dirty = true;
    }

    // -------- computation --------
    function effectiveK() {
        return (Number(get('K')) || 0) * st.lead[0] / (st.lead[1] || 1);
    }

    function compute() {
        if (isNyq()) {
            const zeros = expand(st.nz);
            const poles = expand(st.np);
            const delay = Math.max(0, Number(get('delay')) || 0);
            const K = effectiveK();
            const o = nyquist({ zeros, poles, K, delay });
            st.res = { nyq: true, ...o, zeros, poles, K, delay, L: loopTransfer({ zeros, poles, K, delay }) };
        } else {
            const rat = fromFactored({ zeros: st.zeros, poles: st.poles });
            const contour = edit.contour();
            const f = (z) => evalRational(rat, z);
            const tr = traceImage(f, contourPolyline(contour, 200), { maxStep: 0.15 });
            const counts = zerosMinusPoles(st.zeros, st.poles, contour);
            const hit = st.zeros.some((z) => distanceToContour(contour, z) < 1e-6) || st.poles.some((q) => distanceToContour(contour, q.z) < 1e-6);
            st.res = { nyq: false, rat, contour, tr, counts, hit, f };
        }
        st.fitW = st.fitW || false;
    }

    function fitImage() {
        const r = st.res;
        if (!r || r.nyq || !r.tr.pts.length || scene.userView.w) return;
        const mags = r.tr.pts.map((q) => Math.hypot(q[0], q[1])).filter(Number.isFinite).sort((a, b) => a - b);
        if (!mags.length) return;
        const q90 = mags[Math.floor(mags.length * 0.9)];
        const R = clamp(q90 * 1.3, 0.05, 1e7);
        wv.set(-R, R, -R, R).lockAspect();
    }

    // -------- handles --------
    function rebuildHandles() {
        const hs = [];
        const bump = (final) => { st.dirty = true; st.version++; if (isNyq()) saveNyq(!!final); else if (final) savePlain(); };
        if (isNyq()) {
            const addItems = (items, color, shape, tag) => {
                items.forEach((q, i) => {
                    hs.push({
                        panel: 'z', x: q.z[0], y: q.z[1], shape, size: 6, color, label: `${tag}${i + 1}`,
                        set: (z) => {
                            q.z = q.pair ? [z[0], Math.max(0.05, Math.abs(z[1]))] : [z[0], 0];
                            bump();
                        },
                    });
                    if (q.pair) hs.push({ panel: 'z', x: q.z[0], y: -q.z[1], shape, size: 3.5, color, set: (z) => { q.z = [z[0], Math.max(0.05, Math.abs(z[1]))]; bump(); } });
                });
            };
            addItems(st.np, '#ff6b6b', 'dot', 'p');
            addItems(st.nz, '#4dabf7', 'diamond', 'z');
        } else {
            st.zeros.forEach((z, i) => {
                const inside = st.res && !st.res.nyq && st.res.counts && edit.contour && windingInside(z);
                hs.push({ panel: 'z', x: z[0], y: z[1], shape: 'diamond', size: 6, color: inside ? '#4dabf7' : '#8b93a1', label: `z${i + 1}`, set: (zz) => { st.zeros[i] = zz; bump(); } });
            });
            st.poles.forEach((q, i) => {
                hs.push({
                    panel: 'z', x: q.z[0], y: q.z[1], shape: 'dot', size: 6.5, color: '#ff6b6b', label: `p${i + 1}${q.m > 1 ? ` (m=${q.m})` : ''}`,
                    set: (zz) => { q.z = zz; bump(); },
                });
            });
            hs.push(...edit.handles('z', (final) => { st.dirty = true; st.version++; if (final) savePlain(); }));
        }
        scene.handles = hs;
    }

    function windingInside(z) {
        const c = edit.contour();
        return c.kind === 'circle' ? Math.hypot(z[0] - c.c[0], z[1] - c.c[1]) < c.r : zerosMinusPoles([z], [], c).zeros !== 0;
    }

    scene.onBackground = (pid, z, px, py) => (pid === 'z' && !isNyq() ? edit.startDraw(z, px, py, zv) : null);
    scene.onChange = () => { st.dirty = true; };

    function sync() {
        const nyq = isNyq();
        if (nyq !== st.lastMode) {
            st.lastMode = nyq;
            if (nyq) {
                if (st.lastNPreset === null && `${get('num')}|${get('den')}` === `${'1'}|${'1,3,2'}`) applyNyqPreset(get('npreset'));
                else loadNyq();
            } else if (!st.zeros.length && !st.poles.length) {
                if (String(get('azeros')) === '') applyPlainPreset(get('apreset')); else loadPlain();
            }
            fit();
            st.version++;
        }
        if (nyq) {
            if (get('npreset') !== st.lastNPreset && st.lastNPreset !== null) applyNyqPreset(get('npreset'));
            else if (st.lastNPreset === null) st.lastNPreset = get('npreset');
            if (`${get('num')}|${get('den')}` !== st.lastNumDen) { loadNyq(); fit(); }
            if (st.pending && Date.now() - st.saveAt >= 200) saveNyq(true);
        } else {
            if (get('apreset') !== st.lastPreset && st.lastPreset !== null) applyPlainPreset(get('apreset'));
            else if (st.lastPreset === null) st.lastPreset = get('apreset');
            const cur = { z: String(get('azeros')), p: String(get('apoles')), c: [get('akind'), get('acx'), get('acy'), get('ar'), get('apts')].join('|') };
            const t = st.lastTexts;
            if (t && (cur.z !== t.z || cur.p !== t.p)) { loadPlain(); }
            else if (t && cur.c !== t.c) {
                const kindNow = String(get('akind'));
                if (kindNow !== edit.kind && cur.c.split('|').slice(1).join('|') === t.c.split('|').slice(1).join('|')) { edit.setKind(kindNow); savePlain(); st.version++; } else loadPlain();
            }
        }
        const key = `${nyq}|${st.version}|${edit.version}|${nyq ? `${get('K')}|${get('delay')}` : ''}`;
        if (key !== st.key) {
            st.key = key;
            compute();
            fitImage();
            rebuildHandles();
        } else if (st.dirty) rebuildHandles();
        st.dirty = false;
    }

    // -------- drawing --------
    function drawLeft(pal) {
        const r = st.rectA;
        const res = st.res;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            if (get('bg')) {
                const fn = res.nyq ? (re, im) => res.L([re, im]) : (re, im) => evalRational(res.rat, [re, im]);
                p.image(domainImage(p, cache, 'a', `a|${st.version}|${res.nyq ? `${get('K')}|${get('delay')}` : ''}`, zv, fn), r.x, r.y, r.w, r.h);
                p.noStroke();
                const cv = p.color(pal.panel);
                cv.setAlpha && cv.setAlpha(pal.dark ? 120 : 100);
                p.fill(cv);
                p.rect(r.x, r.y, r.w, r.h);
            }
            if (res.nyq) {
                p.noStroke();
                const t = p.color('#ff6b6b');
                t.setAlpha && t.setAlpha(26);
                p.fill(t);
                const x0 = zv.toX(0);
                p.rect(x0, r.y, Math.max(0, r.x + r.w - x0), r.h);
            }
            drawAxes(p, pal, zv, { unitX: res.nyq ? 'Re s (1/s)' : 'Re z', unitY: res.nyq ? 'Im s (rad/s)' : 'Im z' });
            if (res.nyq) {
                const pts = res.contour;
                p.noFill();
                p.stroke('#ffd43b');
                p.strokeWeight(2.4);
                polyline(p, zv, pts, true);
                p.strokeWeight(1.6);
                chevrons(p, zv, pts, 6, 7);
                // closed-loop poles
                if (res.closedLoopRoots) {
                    for (const q of res.closedLoopRoots) {
                        p.noStroke();
                        p.fill(q[0] > 1e-9 ? '#ff3b3b' : '#51cf66');
                        p.circle(zv.toX(q[0]), zv.toY(q[1]), 8);
                    }
                }
                for (const q of res.poles) {
                    p.noFill();
                    p.stroke('#ff6b6b');
                    p.strokeWeight(2);
                    cross(p, zv.toX(q[0]), zv.toY(q[1]), 6);
                }
                for (const q of res.zeros) {
                    p.noFill();
                    p.stroke('#4dabf7');
                    p.strokeWeight(2);
                    p.circle(zv.toX(q[0]), zv.toY(q[1]), 12);
                }
            } else {
                const pts = contourPolyline(res.contour, 160);
                p.noFill();
                p.stroke('#ffd43b');
                p.strokeWeight(2.6);
                polyline(p, zv, pts, true);
                p.strokeWeight(1.6);
                chevrons(p, zv, pts, 6, 7);
                st.poles.forEach((q) => {
                    p.noFill();
                    p.stroke('#ff6b6b');
                    p.strokeWeight(2);
                    cross(p, zv.toX(q.z[0]), zv.toY(q.z[1]), 6);
                });
                st.zeros.forEach((z) => {
                    p.noFill();
                    p.stroke('#4dabf7');
                    p.strokeWeight(2);
                    p.circle(zv.toX(z[0]), zv.toY(z[1]), 12);
                });
            }
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, res.nyq ? 's-plane: D contour (clockwise), poles x, zeros o, closed-loop poles (dots)' : 'z-plane: contour C, zeros (o), poles (x)');
        if (st.caption) wrapText(p, pal, st.caption, r.x + 8, r.y + r.h - 32, r.w - 16, { size: 10.5, lead: 13 });
        if (res.nyq) {
            p.noStroke();
            p.fill('#ff6b6b');
            p.textSize(10);
            p.textAlign(p.RIGHT, p.TOP);
            p.text('right half plane = unstable', r.x + r.w - 8, r.y + 22);
        }
    }

    function drawImageCurve(pts, wvp, pal, thick = 2) {
        const n = pts.length;
        if (n < 2) return;
        const chunks = Math.min(60, n - 1);
        p.noFill();
        p.strokeWeight(thick);
        for (let c = 0; c < chunks; c++) {
            const i0 = Math.floor((c * (n - 1)) / chunks);
            const i1 = Math.floor(((c + 1) * (n - 1)) / chunks) + 1;
            const t = c / Math.max(1, chunks - 1);
            p.stroke(77 + 178 * t, 163 - 4 * t, 255 - 176 * t);
            polyline(p, wvp, pts.slice(i0, Math.min(n, i1 + 1)));
        }
        p.strokeWeight(1.6);
        p.stroke(pal.fg);
        chevrons(p, wvp, pts, 5, 6);
    }

    function drawRight(pal) {
        const r = st.rectB;
        const res = st.res;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, res.nyq ? 'Nyquist plot: L(s) along the D contour' : 'image curve w = f(C)');
        const lines = [];
        if (res.nyq) {
            lines.push({ t: `L(s) = ${fmt(res.K, 3)} Z(s)/P(s)${res.delay ? ` e^{-${fmt(res.delay, 2)}s}` : ''}`, c: pal.muted });
            lines.push(`open-loop poles in the RHP   P = ${res.P}`);
            lines.push(`counter-clockwise encirclements of -1:  W = ${res.W}   (turns ${fmt(res.turns, 3)})`);
            lines.push(`clockwise N = ${-res.W}:  Z = N + P = ${res.Z}`);
            lines.push({ t: res.marginal ? 'the curve passes (almost) through -1: marginally stable' : `closed loop is ${res.Z === 0 ? 'STABLE' : `UNSTABLE (${res.Z} RHP pole${res.Z > 1 ? 's' : ''})`}`, c: res.marginal ? '#ffd43b' : res.Z === 0 ? '#51cf66' : '#ff6b6b' });
            if (res.closedLoopRoots) {
                const rhp = res.closedLoopRoots.filter((q) => q[0] > 1e-9).length;
                lines.push({ t: `check: roots of 1 + L = 0 in the RHP: ${rhp}${rhp === res.Z ? '  (agrees)' : '  (!)'}`, c: rhp === res.Z ? pal.muted : '#ff9f43' });
            } else lines.push({ t: 'check by roots unavailable with a delay', c: pal.muted });
        } else {
            const c = res.counts;
            lines.push(`zeros inside  N = ${c.zeros}   poles inside  P = ${c.poles}`);
            lines.push(`N - P = ${c.diff}`);
            const ok = Number.isFinite(res.tr.turns) && res.tr.winding === c.diff;
            lines.push({ t: Number.isFinite(res.tr.turns) ? `winding of f(C) about 0: W = ${res.tr.winding}  (turns ${fmt(res.tr.turns, 3)})` : 'contour passes through a zero or pole: f(C) hits 0 or infinity', c: ok ? '#51cf66' : '#ff6b6b' });
            lines.push({ t: ok ? 'W = N - P  (argument principle)' : 'mismatch (numerical)', c: ok ? '#51cf66' : '#ff6b6b' });
        }
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(11.5, Math.max(9, r.w / 54)), lead: 15, w: r.w - 16 });
        const dr = { x: r.x + 8, y: r.y + 26 + th + 8, w: r.w - 16, h: Math.max(40, r.y + r.h - (r.y + 26 + th + 8) - 8) };
        wv.setRect(dr.x, dr.y, dr.w, dr.h).lockAspect();
        clip(p, dr, () => {
            drawAxes(p, pal, wv, { unitX: res.nyq ? 'Re L' : 'Re w', unitY: res.nyq ? 'Im L' : 'Im w' });
            if (res.nyq) {
                p.noFill();
                p.stroke(pal.axis);
                p.strokeWeight(1);
                dashed(p, true);
                p.circle(wv.toX(0), wv.toY(0), 2 * Math.abs(wv.toX(1) - wv.toX(0)));
                dashed(p, false);
                drawImageCurve(res.image, wv, pal);
                p.stroke('#ff3b3b');
                p.strokeWeight(3);
                cross(p, wv.toX(-1), wv.toY(-1 + 0), 6);
                p.noStroke();
                p.fill('#ff3b3b');
                p.textSize(11);
                p.textAlign(p.CENTER, p.TOP);
                p.text('-1', wv.toX(-1), wv.toY(0) + 9);
            } else {
                drawImageCurve(res.tr.pts, wv, pal);
                p.noStroke();
                p.fill('#ff3b3b');
                p.circle(wv.toX(0), wv.toY(0), 9);
                p.fill(pal.muted);
                p.textSize(10);
                p.textAlign(p.LEFT, p.TOP);
                p.text('w = 0', wv.toX(0) + 7, wv.toY(0) + 4);
            }
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textAlign(p.LEFT, p.TOP);
            p.text('blue = start of the contour, orange = end; arrows give the direction', dr.x + 4, dr.y + dr.h - 14);
        });
    }

    return {
        id: 'arg', scene, edit, layout, sync,
        draw(pal) {
            p.background(pal.bg);
            if (!st.res) return;
            drawLeft(pal);
            drawRight(pal);
        },
        step() {},
        press: (x, y) => scene.press(x, y),
        dragTo: (x, y) => scene.dragTo(x, y),
        release: () => { const r = scene.release(); if (isNyq()) saveNyq(true); else savePlain(); return r; },
        wheel: (e, x, y) => scene.wheel(e, x, y),
        key: (k) => {
            if (k === 'f' || k === 'F') { fit(); st.dirty = true; st.key = ''; return true; }
            return false;
        },
        init() { st.lastMode = null; },
        actions: {
            addZero: () => {
                if (isNyq()) { if (st.nz.length < 4) { st.nz.push({ z: [-1 - st.nz.length * 0.7, 0], pair: false }); saveNyq(true); st.version++; } }
                else if (st.zeros.length < MAX_ZEROS_ARG) { st.zeros.push([Math.random() * 2 - 1, Math.random() * 2 - 1]); savePlain(); st.version++; }
            },
            removeZero: () => {
                if (isNyq()) { st.nz.pop(); saveNyq(true); } else st.zeros.pop();
                if (!isNyq()) savePlain();
                st.version++;
            },
            addPole: () => {
                if (isNyq()) { if (st.np.length < 5) { st.np.push({ z: [-1 - st.np.length * 0.6, 0], pair: false }); saveNyq(true); st.version++; } }
                else if (st.poles.length < MAX_POLES_ARG) { st.poles.push({ z: [Math.random() * 2 - 1, Math.random() * 2 - 1], m: 1 }); savePlain(); st.version++; }
            },
            addPair: () => {
                if (isNyq() && st.np.length < 4) { st.np.push({ z: [-0.5, 1.5], pair: true }); saveNyq(true); st.version++; }
            },
            addZeroPair: () => {
                if (isNyq() && st.nz.length < 3) { st.nz.push({ z: [-0.5, 1.2], pair: true }); saveNyq(true); st.version++; }
            },
            removePole: () => {
                if (isNyq()) { st.np.pop(); saveNyq(true); } else st.poles.pop();
                if (!isNyq()) savePlain();
                st.version++;
            },
            orderUp: () => { if (!isNyq() && st.poles.length) { const q = st.poles[st.poles.length - 1]; q.m = q.m >= 3 ? 1 : q.m + 1; savePlain(); st.version++; } },
            addVertex: () => { edit.addVertex(); savePlain(); },
            removeVertex: () => { edit.removeVertex(); savePlain(); },
            reverse: () => { edit.reverse(); savePlain(); },
            fit: () => { fit(); st.key = ''; },
            reset: () => { if (isNyq()) applyNyqPreset(get('npreset')); else applyPlainPreset(get('apreset')); st.key = ''; },
        },
        getState: () => ({ res: st.res, zeros: st.zeros, poles: st.poles, nz: st.nz, np: st.np, handles: scene.handles, lead: st.lead }),
    };
}

void [TAU, FONT, fmtC, arrow, polyMul, wrapText];
