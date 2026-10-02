// Tab 1: the residue theorem. A rational function with draggable poles (orders 1..3, complex coefficients) and zeros,
// a draggable closed contour, and the numerical contour integral against 2 pi i * sum of enclosed residues.
// A second mode demonstrates Cauchy's theorem / integral formula for an analytic g.

import * as C from '../../lib/complex.js';
import { evalRational, residueTheorem, cauchyIntegral, windingNumber, contourPolyline, integrateContour, TWO_PI } from '../../lib/residues.js';
import {
    Viewport, Scene, FONT, TAU, fmt, fmtC, fmtErr, clip, polyline, drawAxes, arrow, cross, chevrons, panelFrame, textBox, wrapText,
    domainImage, dashed, clamp,
} from './common.js';
import { Model, ContourEditor, RESIDUE_PRESETS } from './model.js';

const POLE_COLORS = ['#ff6b6b', '#51cf66', '#4dabf7', '#ffd43b', '#c77dff', '#ff9f43'];

/** Analytic functions for the Cauchy mode: value and n-th derivative. */
export const CAUCHY_FUNCS = {
    exp: { label: 'e^z', g: (z) => C.exp(z), d: (n, z) => C.exp(z) },
    sin: {
        label: 'sin z', g: (z) => C.sin(z),
        d: (n, z) => [C.sin, C.cos, (w) => C.neg(C.sin(w)), (w) => C.neg(C.cos(w))][n % 4](z),
    },
    poly: {
        label: 'z^3 - 2z + 1', g: (z) => C.add(C.sub(C.mul(z, C.mul(z, z)), C.scale(z, 2)), [1, 0]),
        d: (n, z) => (n === 0 ? C.add(C.sub(C.mul(z, C.mul(z, z)), C.scale(z, 2)), [1, 0])
            : n === 1 ? C.sub(C.scale(C.mul(z, z), 3), [2, 0]) : n === 2 ? C.scale(z, 6) : n === 3 ? [6, 0] : [0, 0]),
    },
    recip: {
        label: '1/(z - q)  (q draggable)', needsQ: true,
        g: (z, q) => C.div([1, 0], C.sub(z, q)),
        d: (n, z, q) => {
            let f = 1;
            for (let k = 2; k <= n; k++) f *= k;
            return C.scale(C.div([1, 0], C.powInt(C.sub(z, q), n + 1)), (n % 2 ? -1 : 1) * f);
        },
    },
};

export function createResidueTab(env) {
    const { p, get, set } = env;
    const scene = new Scene();
    const model = new Model();
    const edit = new ContourEditor({ kind: 'ckind', cx: 'ccx', cy: 'ccy', r: 'cr', pts: 'cpts' }, { c: [0, 0], r: 2.2 });
    const view = new Viewport(-4.4, 4.4, -3.2, 3.2);
    const diag = new Viewport(-1, 1, -1, 1);
    scene.panels = { z: view, d: diag };
    const cache = {};
    const st = {
        res: null, cauchy: null, calcKey: '', rectB: { x: 0, y: 0, w: 1, h: 1 }, textH: 0, lastPreset: null, lastTexts: {},
        lastUi: null, dirty: true, saveAt: 0, rectA: { x: 0, y: 0, w: 1, h: 1 }, caption: '', fitKey: '',
    };

    const cauchyQ = () => [Number(get('cqx')), Number(get('cqy'))];
    const cauchyA = () => [Number(get('cax')), Number(get('cay'))];
    const isCauchy = () => get('rmode') === 'cauchy';

    function applyPreset(id) {
        const pr = RESIDUE_PRESETS.find((q) => q.id === id) || RESIDUE_PRESETS[0];
        model.setRows(pr.poles, pr.zeros, pr.expk);
        edit.assign(pr.contour);
        st.caption = pr.caption;
        st.lastPreset = id;
        persist(true);
        fit();
        st.dirty = true;
    }

    function loadFromSettings() {
        model.load(get);
        edit.load(get);
        st.lastTexts = { poles: String(get('poles')), zeros: String(get('zeros')), expk: String(get('expk')), cpts: String(get('cpts')), ckind: String(get('ckind')), ccx: String(get('ccx')), ccy: String(get('ccy')), cr: String(get('cr')) };
        st.dirty = true;
    }

    function persist(force) {
        const now = Date.now();
        if (!force && now - st.saveAt < 250) { st.pendingSave = true; return; }
        st.saveAt = now;
        st.pendingSave = false;
        model.save(set);
        edit.save(set);
        st.lastTexts = { poles: String(get('poles')), zeros: String(get('zeros')), expk: String(get('expk')), cpts: String(get('cpts')), ckind: String(get('ckind')), ccx: String(get('ccx')), ccy: String(get('ccy')), cr: String(get('cr')) };
    }

    function fit() {
        view.set(-4.4, 4.4, -3.2, 3.2).lockAspect();
        scene.userView.z = false;
    }

    function layout(w, h) {
        const gap = 8;
        const inner = { x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap };
        let a;
        let b;
        if (w >= h * 1.15) {
            const wa = Math.round((inner.w - gap) * 0.58);
            a = { x: inner.x, y: inner.y, w: wa, h: inner.h };
            b = { x: inner.x + wa + gap, y: inner.y, w: inner.w - wa - gap, h: inner.h };
        } else {
            const ha = Math.round((inner.h - gap) * 0.58);
            a = { x: inner.x, y: inner.y, w: inner.w, h: ha };
            b = { x: inner.x, y: inner.y + ha + gap, w: inner.w, h: inner.h - ha - gap };
        }
        st.rectA = a;
        st.rectB = b;
        view.setRect(a.x, a.y, a.w, a.h).lockAspect();
        st.dirty = true;
    }

    // -------- computations --------
    function compute() {
        const contour = edit.contour();
        if (!isCauchy()) {
            const r = model.rational();
            st.res = residueTheorem(r, contour, { tol: 1e-9, maxDepth: 14, maxEvals: 20000 });
            st.res.rational = r;
            st.cauchy = null;
            return;
        }
        const fn = CAUCHY_FUNCS[get('cg')] || CAUCHY_FUNCS.exp;
        const q = cauchyQ();
        const a = cauchyA();
        const n = Math.round(Number(get('cn')));
        const g = (z) => fn.g(z, q);
        let out;
        if (n < 0) {
            const r = integrateContour(g, contour, { tol: 1e-9, maxDepth: 14, maxEvals: 20000 });
            const insideQ = fn.needsQ && windingNumber(contour, q) !== 0;
            out = {
                theorem: true, value: r.value, expected: insideQ ? C.mul([0, TWO_PI], [windingNumber(contour, q), 0]) : [0, 0], ok: r.ok, insideQ,
            };
        } else {
            const r = cauchyIntegral(g, a, contour, n, { tol: 1e-9, maxDepth: 14, maxEvals: 20000 });
            const w = windingNumber(contour, a);
            const insideQ = fn.needsQ && windingNumber(contour, q) !== 0;
            out = {
                theorem: false, n, value: r.value, ok: r.ok, w, insideQ,
                expected: C.scale(fn.d(n, a, q), w), exactAtA: fn.d(n, a, q),
            };
        }
        out.discrepancy = C.abs(C.sub(out.value, out.expected));
        st.cauchy = out;
        st.res = null;
    }

    function enclosedSet() {
        const s = new Set();
        if (st.res) for (const e of st.res.enclosed) s.add(e.k);
        return s;
    }

    function rebuildHandles() {
        const onChange = (final) => { st.dirty = true; persist(!!final); };
        const hs = [];
        if (!isCauchy()) {
            // poles of the merged rational may be fewer than model.poles when positions coincide; use the model for handles
            const enc = new Set();
            if (st.res) {
                for (const e of st.res.enclosed) {
                    const q = st.res.rational.poles[e.k];
                    model.poles.forEach((mp, i) => { if (C.abs(C.sub(mp.z, q.z)) < 1e-9) enc.add(i); });
                }
            }
            hs.push(...model.handles('z', onChange, enc));
        } else {
            hs.push({
                panel: 'z', x: cauchyA()[0], y: cauchyA()[1], shape: 'square', size: 5.5, color: '#51cf66', label: 'a',
                set: (z) => { set('cax', +z[0].toFixed(4)); set('cay', +z[1].toFixed(4)); st.dirty = true; },
            });
            if ((CAUCHY_FUNCS[get('cg')] || {}).needsQ) {
                hs.push({
                    panel: 'z', x: cauchyQ()[0], y: cauchyQ()[1], shape: 'dot', size: 6.5, color: '#ff6b6b', label: 'q (singularity)',
                    set: (z) => { set('cqx', +z[0].toFixed(4)); set('cqy', +z[1].toFixed(4)); st.dirty = true; },
                });
            }
        }
        hs.push(...edit.handles('z', onChange));
        scene.handles = hs;
    }

    scene.onBackground = (pid, z, px, py) => {
        if (pid !== 'z') return null;
        return edit.startDraw(z, px, py, view);
    };
    scene.onChange = () => { st.dirty = true; };

    // -------- sync with settings (drawer controls, deep links) --------
    function sync() {
        const t = st.lastTexts;
        if (get('rpreset') !== st.lastPreset && !(st.lastPreset === null && String(get('poles')) !== '')) {
            applyPreset(get('rpreset'));
            return;
        }
        st.lastPreset = get('rpreset');
        if (String(get('poles')) !== t.poles || String(get('zeros')) !== t.zeros || String(get('expk')) !== t.expk
            || String(get('cpts')) !== t.cpts || String(get('ckind')) !== t.ckind || String(get('ccx')) !== t.ccx
            || String(get('ccy')) !== t.ccy || String(get('cr')) !== t.cr) {
            // 'expk' and the contour kind can also come from the drawer: a kind change converts the shape
            const kindNow = String(get('ckind'));
            const external = String(get('poles')) !== t.poles || String(get('zeros')) !== t.zeros || String(get('cpts')) !== t.cpts
                || String(get('ccx')) !== t.ccx || String(get('ccy')) !== t.ccy || String(get('cr')) !== t.cr;
            if (kindNow !== t.ckind && !external) {
                edit.setKind(kindNow === 'poly' || kindNow === 'free' ? kindNow : 'circle');
                model.expk = Number(get('expk')) || 0;
                model.touch();
                persist(true);
            } else if (String(get('expk')) !== t.expk && !external) {
                model.expk = Number(get('expk')) || 0;
                model.touch();
                persist(true);
            } else {
                loadFromSettings();
            }
            st.dirty = true;
        }
        // selected pole <-> drawer sliders
        const q = model.poles[model.sel];
        if (q) {
            const ui = [Math.round(Number(get('pm'))), Number(get('pcr')), Number(get('pci')), model.sel];
            const cur = [q.m, q.c[0], q.c[1], model.sel];
            if (st.lastUi && (ui[0] !== st.lastUi[0] || ui[1] !== st.lastUi[1] || ui[2] !== st.lastUi[2]) && ui[3] === st.lastUi[3]) {
                q.m = clamp(ui[0] || 1, 1, 3);
                q.c = [ui[1], ui[2]];
                model.touch();
                st.dirty = true;
                persist();
                st.lastUi = [q.m, ui[1], ui[2], model.sel];
            } else if (!st.lastUi || cur.some((v, i) => Math.abs(v - st.lastUi[i]) > 1e-12)) {
                set('pm', q.m);
                set('pcr', +q.c[0].toFixed(3));
                set('pci', +q.c[1].toFixed(3));
                st.lastUi = [q.m, +q.c[0].toFixed(3), +q.c[1].toFixed(3), model.sel];
            }
        }
        if (st.pendingSave && Date.now() - st.saveAt >= 250) persist(true);
        const key = `${model.version}|${edit.version}|${get('rmode')}|${get('cg')}|${get('cn')}|${get('cax')}|${get('cay')}|${get('cqx')}|${get('cqy')}`;
        if (key !== st.calcKey) {
            st.calcKey = key;
            compute();
            rebuildHandles();
        } else if (st.dirty) rebuildHandles();
        st.dirty = false;
    }

    // -------- drawing --------
    function drawLeft(pal) {
        const r = st.rectA;
        const fn = (re, im) => {
            if (isCauchy()) {
                const f = CAUCHY_FUNCS[get('cg')] || CAUCHY_FUNCS.exp;
                const n = Math.round(Number(get('cn')));
                const z = [re, im];
                const a = cauchyA();
                const v = f.g(z, cauchyQ());
                return n < 0 ? v : C.div(v, C.powInt(C.sub(z, a), n + 1));
            }
            return evalRational(st.res ? st.res.rational : model.rational(), [re, im]);
        };
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            if (get('bg')) {
                const key = `${isCauchy() ? `c|${get('cg')}|${get('cn')}|${get('cax')}|${get('cay')}|${get('cqx')}|${get('cqy')}` : `r|${model.version}`}`;
                p.image(domainImage(p, cache, 'z', key, view, fn), r.x, r.y, r.w, r.h);
                p.noStroke();
                const cv = p.color(pal.panel);
                cv.setAlpha && cv.setAlpha(pal.dark ? 120 : 100);
                p.fill(cv);
                p.rect(r.x, r.y, r.w, r.h);
            }
            drawAxes(p, pal, view, { unitX: 'Re z', unitY: 'Im z' });
            // contour
            const pts = contourPolyline(edit.contour(), 160);
            p.noFill();
            p.stroke('#ffd43b');
            p.strokeWeight(2.4);
            polyline(p, view, pts, true);
            p.strokeWeight(1.6);
            chevrons(p, view, pts, 6, 7);
            if (!isCauchy()) drawPoles(pal);
            else drawCauchyMarks(pal);
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, isCauchy() ? 'z-plane: analytic g and the contour (colour = arg, brightness = |integrand|)' : 'z-plane: poles (x), zeros (diamonds), contour');
        if (edit.kind === 'free') {
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textAlign(p.LEFT, p.BOTTOM);
            p.text('free loop: drag on the background to draw a new one', r.x + 8, r.y + r.h - 6 - (st.caption ? 30 : 0));
        }
        if (st.caption && !isCauchy()) wrapText(p, pal, st.caption, r.x + 8, r.y + r.h - 32, r.w - 16, { size: 10.5, lead: 13 });
    }

    function drawPoles(pal) {
        const enc = enclosedSet();
        const rat = st.res ? st.res.rational : null;
        if (!rat) return;
        // residue arrows (scaled so the longest is ~70 px)
        let maxR = 0;
        for (const e of st.res.enclosed) maxR = Math.max(maxR, C.abs(e.res));
        rat.poles.forEach((q, k) => {
            const x = view.toX(q.z[0]);
            const y = view.toY(q.z[1]);
            const inside = enc.has(k);
            p.noFill();
            p.stroke(inside ? '#ff6b6b' : pal.muted);
            p.strokeWeight(2);
            cross(p, x, y, 6);
            if (inside) {
                p.strokeWeight(1);
                p.circle(x, y, 22 + 3 * q.m);
            }
            if (q.m > 1) {
                p.noStroke();
                p.fill(pal.muted);
                p.textSize(10);
                p.textAlign(p.LEFT, p.TOP);
                p.text(`order ${q.m}`, x + 8, y + 6);
            }
        });
        for (const e of st.res.enclosed) {
            if (!(maxR > 0) || !Number.isFinite(maxR)) break;
            const q = rat.poles[e.k];
            const x = view.toX(q.z[0]);
            const y = view.toY(q.z[1]);
            const s = 70 / maxR;
            p.stroke(POLE_COLORS[e.k % POLE_COLORS.length]);
            p.strokeWeight(2.4);
            const dx = e.res[0] * s * e.w;
            const dy = -e.res[1] * s * e.w;
            arrow(p, x, y, x + dx, y + dy, 9);
        }
    }

    function drawCauchyMarks(pal) {
        const a = cauchyA();
        const x = view.toX(a[0]);
        const y = view.toY(a[1]);
        p.noFill();
        p.stroke('#51cf66');
        p.strokeWeight(1.5);
        p.circle(x, y, 20);
        const fn = CAUCHY_FUNCS[get('cg')];
        if (fn && fn.needsQ) {
            const q = cauchyQ();
            p.stroke('#ff6b6b');
            p.strokeWeight(2);
            cross(p, view.toX(q[0]), view.toY(q[1]), 6);
        }
        if (Number(get('cn')) >= 0) {
            p.stroke('#ff6b6b');
            p.strokeWeight(2);
            cross(p, x, y, 5);
        }
        void pal;
    }

    function drawRight(pal) {
        const r = st.rectB;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, isCauchy() ? "Cauchy's formula read-out" : 'Residue theorem: integral vs 2 pi i sum of residues');
        const lines = [];
        if (!isCauchy() && st.res) {
            const o = st.res;
            lines.push({ t: `contour integral (numerical, ${o.evals} evals)`, c: pal.muted });
            lines.push(`  oint f dz       = ${fmtC(o.integral)}`);
            lines.push({ t: '2 pi i * sum (winding * Res of enclosed poles)', c: pal.muted });
            lines.push(`  2 pi i sum Res  = ${fmtC(o.predicted)}`);
            lines.push({ t: `  discrepancy |diff| = ${fmtErr(o.discrepancy)}${o.onContour ? '   (a pole lies ON the contour!)' : ''}`, c: o.discrepancy < 1e-6 && !o.onContour ? '#51cf66' : '#ff6b6b' });
            if (!o.enclosed.length) lines.push({ t: '  no pole enclosed -> Cauchy\'s theorem: integral = 0', c: pal.muted });
            for (const e of o.enclosed.slice(0, 6)) {
                const q = o.rational.poles[e.k];
                lines.push({ t: `  pole ${fmt(q.z[0], 2)}${q.z[1] < 0 ? '-' : '+'}${fmt(Math.abs(q.z[1]), 2)}i (m=${q.m})  w=${e.w > 0 ? '+' : ''}${e.w}  Res=${fmtC(e.res, 3)}`, c: POLE_COLORS[e.k % POLE_COLORS.length] });
            }
        } else if (st.cauchy) {
            const o = st.cauchy;
            const fn = CAUCHY_FUNCS[get('cg')] || CAUCHY_FUNCS.exp;
            if (o.theorem) {
                lines.push(`g(z) = ${fn.label}`);
                lines.push(`oint g dz        = ${fmtC(o.value)}`);
                lines.push(`expected         = ${fmtC(o.expected)}   ${o.insideQ ? '(pole inside!)' : '(g analytic inside)'}`);
            } else {
                lines.push(`g(z) = ${fn.label},  n = ${o.n}`);
                lines.push(`n!/(2 pi i) oint g/(z-a)^${o.n + 1} dz = ${fmtC(o.value)}`);
                lines.push(`g${o.n ? `^(${o.n})` : ''}(a)${o.w ? '' : ' (a outside -> 0)'}   = ${fmtC(o.expected)}`);
                if (o.insideQ) lines.push({ t: 'q is inside the contour: g is not analytic there, the formula fails', c: '#ff6b6b' });
            }
            lines.push({ t: `|difference|     = ${fmtErr(o.discrepancy)}`, c: o.discrepancy < 1e-6 ? '#51cf66' : '#ff6b6b' });
        }
        st.textH = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(12, Math.max(9, r.w / 48)), lead: 15, w: r.w - 16 });
        // vector-sum diagram
        const top = r.y + 26 + st.textH + 8;
        const dr = { x: r.x + 8, y: top, w: r.w - 16, h: Math.max(40, r.y + r.h - top - 8) };
        diag.setRect(dr.x, dr.y, dr.w, dr.h);
        if (!isCauchy() && st.res) drawVectorSum(pal, dr);
        else if (st.cauchy) drawCauchyDiagram(pal, dr);
    }

    function fitDiagram(points, dr) {
        let xmin = 0;
        let xmax = 0;
        let ymin = 0;
        let ymax = 0;
        for (const q of points) {
            if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
            xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]);
            ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]);
        }
        const span = Math.max(xmax - xmin, ymax - ymin, 1e-3) * 1.3;
        const cx = (xmin + xmax) / 2;
        const cy = (ymin + ymax) / 2;
        const asp = dr.w / dr.h;
        diag.set(cx - span * Math.max(1, asp) / 2, cx + span * Math.max(1, asp) / 2, cy - span * Math.max(1, 1 / asp) / 2, cy + span * Math.max(1, 1 / asp) / 2).lockAspect();
    }

    function drawVectorSum(pal, dr) {
        const o = st.res;
        const terms = o.enclosed.map((e) => ({ k: e.k, v: C.mul([0, TWO_PI], C.scale(e.res, e.w)) }));
        const pts = [[0, 0]];
        let acc = [0, 0];
        for (const t of terms) { acc = C.add(acc, t.v); pts.push(acc); }
        pts.push(o.integral);
        fitDiagram(pts, dr);
        clip(p, dr, () => {
            drawAxes(p, pal, diag, { unitX: 'Re', unitY: 'Im' });
            let cur = [0, 0];
            p.strokeWeight(2.4);
            for (const t of terms) {
                const nx = C.add(cur, t.v);
                p.stroke(POLE_COLORS[t.k % POLE_COLORS.length]);
                arrow(p, diag.toX(cur[0]), diag.toY(cur[1]), diag.toX(nx[0]), diag.toY(nx[1]), 8);
                cur = nx;
            }
            if (terms.length > 1) {
                p.stroke(pal.fg);
                p.strokeWeight(1.2);
                arrow(p, diag.toX(0), diag.toY(0), diag.toX(cur[0]), diag.toY(cur[1]), 9);
            }
            p.stroke('#ffd43b');
            p.strokeWeight(2);
            dashed(p, true);
            arrow(p, diag.toX(0), diag.toY(0), diag.toX(o.integral[0]), diag.toY(o.integral[1]), 10);
            dashed(p, false);
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textFont(FONT);
            p.textAlign(p.LEFT, p.TOP);
            p.text('coloured: 2 pi i w Res of each enclosed pole, head to tail;  dashed yellow: numerical contour integral', dr.x + 4, dr.y + dr.h - 14);
        });
    }

    function drawCauchyDiagram(pal, dr) {
        const o = st.cauchy;
        fitDiagram([o.value, o.expected, [0, 0]], dr);
        clip(p, dr, () => {
            drawAxes(p, pal, diag, { unitX: 'Re', unitY: 'Im' });
            p.strokeWeight(2.5);
            p.stroke('#51cf66');
            arrow(p, diag.toX(0), diag.toY(0), diag.toX(o.expected[0]), diag.toY(o.expected[1]), 9);
            p.stroke('#ffd43b');
            dashed(p, true);
            arrow(p, diag.toX(0), diag.toY(0), diag.toX(o.value[0]), diag.toY(o.value[1]), 10);
            dashed(p, false);
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textAlign(p.LEFT, p.TOP);
            p.text('green: expected value;  dashed yellow: recovered from the boundary integral', dr.x + 4, dr.y + dr.h - 14);
        });
    }

    return {
        id: 'residue', scene, model, edit, layout, sync,
        draw(pal) {
            p.background(pal.bg);
            drawLeft(pal);
            drawRight(pal);
        },
        step() {},
        press: (x, y) => scene.press(x, y),
        dragTo: (x, y) => scene.dragTo(x, y),
        release: () => { const r = scene.release(); persist(true); return r; },
        wheel: (e, x, y) => scene.wheel(e, x, y),
        key: (k) => {
            if (k === 'f' || k === 'F') { fit(); st.dirty = true; return true; }
            return false;
        },
        init() {
            if (String(get('poles')) === '') applyPreset(get('rpreset'));
            else { loadFromSettings(); st.lastPreset = get('rpreset'); st.caption = (RESIDUE_PRESETS.find((q) => q.id === get('rpreset')) || {}).caption || ''; }
            fit();
        },
        actions: {
            addPole: () => { model.addPole([clamp(view.fromX(st.rectA.x + st.rectA.w * 0.5) + (Math.random() - 0.5), view.xmin, view.xmax), 0.5 + Math.random() * 0.5]); persist(true); st.dirty = true; },
            removePole: () => { model.removePole(); persist(true); st.dirty = true; },
            addZero: () => { model.addZero([(Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2]); persist(true); st.dirty = true; },
            removeZero: () => { model.removeZero(); persist(true); st.dirty = true; },
            addVertex: () => { edit.addVertex(); persist(true); },
            removeVertex: () => { edit.removeVertex(); persist(true); },
            reverse: () => { edit.reverse(); persist(true); },
            fit: () => { fit(); st.dirty = true; },
            reset: () => applyPreset(get('rpreset')),
        },
        getState: () => ({ res: st.res, cauchy: st.cauchy, poles: model.poles, zeros: model.zeros, contour: edit.contour(), handles: scene.handles, view, sel: model.sel }),
        persist,
    };
}
