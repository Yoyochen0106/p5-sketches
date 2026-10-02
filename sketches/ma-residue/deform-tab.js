// Tab 2: deformation of contours. A homotopy C_s from loop A to loop B sweeps across poles: the integral is
// constant between crossings and jumps by 2 pi i Res when a pole is crossed. A branch-cut toy shows what a cut
// does to oint sqrt(z) dz and oint log(z) dz.

import * as C from '../../lib/complex.js';
import {
    evalRational, residueTheorem, residues, windingNumber, distanceToContour, homotopyContour, circleIntegralWithCut,
    sqrtCut, logCut, argWithCut, contourPolyline, TWO_PI,
} from '../../lib/residues.js';
import {
    Viewport, Scene, FONT, TAU, fmt, fmtC, fmtErr, clip, polyline, drawAxes, cross, chevrons, panelFrame, textBox, wrapText,
    domainImage, dashed, clamp, niceTicks, fmtTick,
} from './common.js';

const N_PLOT = 240; // exact (winding) staircase samples
const N_NUM = 64; // numerical integral samples
const PER_FRAME = 6;

export function createDeformTab(env, { model }) {
    const { p, get, set } = env;
    const scene = new Scene();
    const zv = new Viewport(-4.5, 4.5, -3.4, 3.4);
    const plot = new Viewport(0, 1, -1, 1);
    const wv = new Viewport(-2, 2, -2, 2);
    scene.panels = { z: zv, w: wv };
    const cache = {};
    const st = {
        rectA: { x: 0, y: 0, w: 1, h: 1 }, rectB: { x: 0, y: 0, w: 1, h: 1 }, key: '', pred: [], num: [], numDone: 0, events: [], rat: null, res: null,
        cur: null, curKey: '', branch: null, branchKey: '', dirty: true, animDir: 1, lastTexts: {},
    };

    const A = () => {
        const c = [Number(get('dax')), Number(get('day'))];
        const r = Math.max(0.1, Number(get('dar')));
        return (th) => [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)];
    };
    const B = () => {
        const c = [Number(get('dbx')), Number(get('dby'))];
        const r = Math.max(0.1, Number(get('dbr')));
        const wig = Number(get('dwig')) || 0;
        return (th) => {
            const rr = r * (1 + wig * Math.sin(3 * th));
            return [c[0] + rr * Math.cos(th), c[1] + rr * Math.sin(th)];
        };
    };
    const contourAt = (s) => homotopyContour(A(), B(), s, 96);
    const mode = () => get('dmode');

    function layout(w, h) {
        const gap = 8;
        const inner = { x: gap, y: gap, w: w - 2 * gap, h: h - 2 * gap };
        let a;
        let b;
        if (w >= h * 1.15) {
            const wa = Math.round((inner.w - gap) * 0.55);
            a = { x: inner.x, y: inner.y, w: wa, h: inner.h };
            b = { x: inner.x + wa + gap, y: inner.y, w: inner.w - wa - gap, h: inner.h };
        } else {
            const ha = Math.round((inner.h - gap) * 0.55);
            a = { x: inner.x, y: inner.y, w: inner.w, h: ha };
            b = { x: inner.x, y: inner.y + ha + gap, w: inner.w, h: inner.h - ha - gap };
        }
        st.rectA = a;
        st.rectB = b;
        zv.setRect(a.x, a.y, a.w, a.h).lockAspect();
        wv.setRect(b.x, b.y, b.w, b.h).lockAspect();
        st.dirty = true;
    }

    // -------- homotopy computations --------
    function recompute() {
        st.rat = model.rational();
        st.res = residues(st.rat);
        st.pred = [];
        for (let i = 0; i <= N_PLOT; i++) {
            const s = i / N_PLOT;
            const c = contourAt(s);
            let sum = [0, 0];
            let near = false;
            st.rat.poles.forEach((q, k) => {
                const w = windingNumber(c, q.z);
                if (w) sum = C.add(sum, C.scale(st.res[k], w));
                if (distanceToContour(c, q.z) < 0.02) near = true;
            });
            st.pred.push({ s, v: C.mul([0, TWO_PI], sum), near });
        }
        // jump events from the staircase
        st.events = [];
        for (let i = 1; i < st.pred.length; i++) {
            const a = st.pred[i - 1].v;
            const b = st.pred[i].v;
            if (C.abs(C.sub(a, b)) > 1e-9) st.events.push({ s: st.pred[i].s, jump: C.sub(b, a) });
        }
        // merge events that fall in the same plot step but are listed twice (near-contour samples)
        st.num = new Array(N_NUM + 1).fill(null);
        st.numDone = 0;
    }

    function numericStep() {
        let n = 0;
        while (st.numDone <= N_NUM && n < PER_FRAME) {
            const s = st.numDone / N_NUM;
            const c = contourAt(s);
            if (st.rat.poles.some((q) => distanceToContour(c, q.z) < 0.04)) st.num[st.numDone] = { s, v: null };
            else {
                const out = residueTheorem(st.rat, c, { tol: 1e-8, maxDepth: 12, maxEvals: 9000 });
                st.num[st.numDone] = { s, v: out.ok ? out.integral : null };
            }
            st.numDone++;
            n++;
        }
    }

    function currentHomotopy() {
        const s = clamp(Number(get('ds')), 0, 1);
        const key = `${s}|${model.version}|${['dax', 'day', 'dar', 'dbx', 'dby', 'dbr', 'dwig'].map((k) => get(k)).join(',')}`;
        if (key !== st.curKey) {
            st.curKey = key;
            const c = contourAt(s);
            const out = residueTheorem(st.rat, c, { tol: 1e-9, maxDepth: 13, maxEvals: 12000 });
            st.cur = { s, contour: c, out };
        }
        return st.cur;
    }

    // -------- branch-cut computations --------
    function branchData() {
        const key = ['dfun', 'dcut', 'dcx', 'dcy', 'dcr'].map((k) => get(k)).join('|');
        if (key === st.branchKey && st.branch) return st.branch;
        st.branchKey = key;
        const phi = Number(get('dcut'));
        const c = [Number(get('dcx')), Number(get('dcy'))];
        const r = Math.max(0.05, Number(get('dcr')));
        const isSqrt = get('dfun') === 'sqrt';
        const g = isSqrt ? (z, ph) => sqrtCut(z, ph) : (z, ph) => logCut(z, ph);
        const out = circleIntegralWithCut(g, c, r, phi);
        const wind = Math.hypot(c[0], c[1]) < r ? 1 : 0;
        // image of the loop with the cut branch, and the analytic continuation along the loop
        const n = 360;
        const image = [];
        const cont = [];
        let prev = null;
        let k2 = 0;
        for (let i = 0; i <= n; i++) {
            const th = (TAU * i) / n;
            const z = [c[0] + r * Math.cos(th), c[1] + r * Math.sin(th)];
            const th2 = i === 0 ? 1e-9 : i === n ? TAU - 1e-9 : th;
            const zz = [c[0] + r * Math.cos(th2), c[1] + r * Math.sin(th2)];
            const v = g(zz, phi);
            image.push(v);
            if (isSqrt) {
                let u = v;
                if (prev && C.abs(C.sub(C.neg(u), prev)) < C.abs(C.sub(u, prev))) u = C.neg(u);
                cont.push(u);
                prev = u;
            } else {
                let u = [v[0], v[1] + TAU * k2];
                if (prev && Math.abs(u[1] - prev[1]) > Math.PI) {
                    k2 += u[1] > prev[1] ? -1 : 1;
                    u = [v[0], v[1] + TAU * k2];
                }
                cont.push(u);
                prev = u;
            }
        }
        const f0 = image[0];
        const fEnd = cont[cont.length - 1];
        const z0 = [c[0] + r, c[1]];
        // exact integral along the continuation (antiderivative): (2/3) z^{3/2} or z log z - z
        const exact = isSqrt
            ? C.scale(C.sub(C.mul(fEnd, z0), C.mul(cont[0], z0)), 2 / 3)
            : C.mul(z0, C.sub(fEnd, cont[0]));
        st.branch = { out, wind, image, cont, f0, fEnd, exact, phi, c, r, isSqrt };
        return st.branch;
    }

    // -------- handles --------
    function rebuildHandles() {
        const hs = [];
        const onChange = (final) => { st.dirty = true; st.curKey = ''; if (final) model.save(set); };
        if (mode() === 'homotopy') {
            const cur = st.cur;
            const enc = new Set();
            if (cur) for (const e of cur.out.enclosed) {
                const q = st.rat.poles[e.k];
                model.poles.forEach((mp, i) => { if (C.abs(C.sub(mp.z, q.z)) < 1e-9) enc.add(i); });
            }
            hs.push(...model.handles('z', (final) => { st.dirty = true; st.key = ''; if (final) model.save(set); }, enc));
            const setP = (kx, ky) => (z) => { set(kx, +z[0].toFixed(4)); set(ky, +z[1].toFixed(4)); st.dirty = true; st.key = ''; st.curKey = ''; };
            const rad = (kx, ky, kr) => (z) => { set(kr, +Math.max(0.1, Math.hypot(z[0] - Number(get(kx)), z[1] - Number(get(ky)))).toFixed(4)); st.dirty = true; st.key = ''; st.curKey = ''; };
            hs.push({ panel: 'z', x: Number(get('dax')), y: Number(get('day')), shape: 'square', size: 5.5, color: '#4dabf7', label: 'A', set: setP('dax', 'day') });
            hs.push({ panel: 'z', x: Number(get('dax')) + Number(get('dar')) * Math.cos(2.3), y: Number(get('day')) + Number(get('dar')) * Math.sin(2.3), shape: 'dot', size: 5.5, color: '#4dabf7', set: rad('dax', 'day', 'dar') });
            hs.push({ panel: 'z', x: Number(get('dbx')), y: Number(get('dby')), shape: 'square', size: 5.5, color: '#ff9f43', label: 'B', set: setP('dbx', 'dby') });
            hs.push({ panel: 'z', x: Number(get('dbx')) + Number(get('dbr')) * Math.cos(2.3), y: Number(get('dby')) + Number(get('dbr')) * Math.sin(2.3), shape: 'dot', size: 5.5, color: '#ff9f43', set: rad('dbx', 'dby', 'dbr') });
        } else {
            const setP = (z) => { set('dcx', +z[0].toFixed(4)); set('dcy', +z[1].toFixed(4)); st.dirty = true; };
            const c = [Number(get('dcx')), Number(get('dcy'))];
            const r = Number(get('dcr'));
            hs.push({ panel: 'z', x: c[0], y: c[1], shape: 'square', size: 5.5, color: '#ffd43b', label: 'loop', set: setP });
            hs.push({
                panel: 'z', x: c[0] + r * Math.cos(2.3), y: c[1] + r * Math.sin(2.3), shape: 'dot', size: 6, color: '#ffd43b',
                set: (z) => { set('dcr', +Math.max(0.05, Math.hypot(z[0] - c[0], z[1] - c[1])).toFixed(4)); st.dirty = true; },
            });
            const phi = Number(get('dcut'));
            hs.push({
                panel: 'z', x: 3.2 * Math.cos(phi), y: 3.2 * Math.sin(phi), shape: 'diamond', size: 5, color: '#ff6b6b', label: 'cut direction',
                set: (z) => { set('dcut', +Math.atan2(z[1], z[0]).toFixed(4)); st.dirty = true; },
            });
        }
        scene.handles = hs;
    }
    scene.onChange = () => { st.dirty = true; };

    function sync() {
        const key = `${mode()}|${model.version}|${['dax', 'day', 'dar', 'dbx', 'dby', 'dbr', 'dwig'].map((k) => get(k)).join(',')}`;
        if (mode() === 'homotopy') {
            if (key !== st.key) {
                st.key = key;
                recompute();
                st.curKey = '';
            }
            currentHomotopy();
            if (st.numDone <= N_NUM) numericStep();
        } else branchData();
        rebuildHandles();
    }

    // -------- drawing --------
    function drawHomotopy(pal) {
        const r = st.rectA;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            if (get('bg')) {
                p.image(domainImage(p, cache, 'z', `h|${model.version}`, zv, (re, im) => evalRational(st.rat, [re, im])), r.x, r.y, r.w, r.h);
                p.noStroke();
                const cv = p.color(pal.panel);
                cv.setAlpha && cv.setAlpha(pal.dark ? 130 : 110);
                p.fill(cv);
                p.rect(r.x, r.y, r.w, r.h);
            }
            drawAxes(p, pal, zv, { unitX: 'Re z', unitY: 'Im z' });
            p.noFill();
            p.strokeWeight(1.4);
            dashed(p, true);
            p.stroke('#4dabf7');
            polyline(p, zv, contourPolyline(contourAt(0), 96), true);
            p.stroke('#ff9f43');
            polyline(p, zv, contourPolyline(contourAt(1), 96), true);
            dashed(p, false);
            const cur = st.cur;
            if (cur) {
                p.stroke('#ffd43b');
                p.strokeWeight(2.8);
                const pts = contourPolyline(cur.contour, 96);
                polyline(p, zv, pts, true);
                p.strokeWeight(1.6);
                chevrons(p, zv, pts, 6, 7);
            }
            const enc = new Set(cur ? cur.out.enclosed.map((e) => e.k) : []);
            st.rat.poles.forEach((q, k) => {
                p.noFill();
                p.stroke(enc.has(k) ? '#ff6b6b' : pal.muted);
                p.strokeWeight(2);
                cross(p, zv.toX(q.z[0]), zv.toY(q.z[1]), 6);
            });
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, 'z-plane: loop A (blue) is deformed into B (orange); yellow = C_s');
        wrapText(p, pal, 'C_s(t) = (1-s) A(t) + s B(t). The integral changes only when the moving contour sweeps over a pole.', r.x + 8, r.y + r.h - 30, r.w - 16, { size: 10.5, lead: 13 });
    }

    function drawStaircase(pal) {
        const r = st.rectB;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, 'Integral vs morph parameter s');
        const cur = st.cur;
        const lines = [];
        if (cur) {
            const o = cur.out;
            lines.push(`s = ${fmt(cur.s, 3)}   enclosed poles: ${o.enclosed.length}`);
            lines.push(`oint_(C_s) f dz = ${fmtC(o.integral)}`);
            lines.push(`2 pi i sum Res  = ${fmtC(o.predicted)}`);
            lines.push({ t: `|diff| = ${fmtErr(o.discrepancy)}${o.onContour ? '  (pole on contour)' : ''}`, c: o.discrepancy < 1e-6 ? '#51cf66' : '#ff6b6b' });
        }
        const jumps = st.events.slice(0, 4);
        if (jumps.length) {
            lines.push({ t: 'jumps (pole crossed):', c: pal.muted });
            for (const e of jumps) lines.push({ t: `  s=${fmt(e.s, 3)}: ${fmtC(e.jump, 2)}`, c: pal.fg });
        } else lines.push({ t: 'no pole is crossed: the integral is constant', c: pal.muted });
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(12, Math.max(9, r.w / 48)), lead: 15, w: r.w - 16 });
        const pr = { x: r.x + 44, y: r.y + 26 + th + 14, w: r.w - 60, h: Math.max(60, r.y + r.h - (r.y + 26 + th + 14) - 28) };
        let lo = Infinity;
        let hi = -Infinity;
        for (const q of st.pred) for (const v of q.v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (!(hi > lo)) { lo -= 1; hi += 1; }
        const pad = (hi - lo) * 0.15;
        plot.set(0, 1, lo - pad, hi + pad).setRect(pr.x, pr.y, pr.w, pr.h);
        clip(p, { x: r.x, y: pr.y - 4, w: r.w, h: pr.h + 24 }, () => {
            p.stroke(pal.grid);
            p.strokeWeight(1);
            for (const t of niceTicks(0, 1, 5)) p.line(plot.toX(t), pr.y, plot.toX(t), pr.y + pr.h);
            const yt = niceTicks(plot.ymin, plot.ymax, 5);
            for (const t of yt) p.line(pr.x, plot.toY(t), pr.x + pr.w, plot.toY(t));
            p.stroke(pal.axis);
            p.line(pr.x, plot.toY(0), pr.x + pr.w, plot.toY(0));
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textFont(FONT);
            p.textAlign(p.CENTER, p.TOP);
            for (const t of niceTicks(0, 1, 5)) p.text(fmtTick(t), plot.toX(t), pr.y + pr.h + 3);
            p.text('s (morph parameter)', pr.x + pr.w / 2, pr.y + pr.h + 14);
            p.textAlign(p.RIGHT, p.CENTER);
            for (const t of yt) p.text(fmtTick(t), pr.x - 4, plot.toY(t));
            // exact staircase
            for (const [idx, col] of [[0, '#4dabf7'], [1, '#ff9f43']]) {
                p.noFill();
                p.stroke(col);
                p.strokeWeight(1.6);
                p.beginShape();
                let prev = null;
                for (const q of st.pred) {
                    if (prev && Math.abs(q.v[idx] - prev) > 1e-9) { p.vertex(plot.toX(q.s), plot.toY(prev)); }
                    p.vertex(plot.toX(q.s), plot.toY(q.v[idx]));
                    prev = q.v[idx];
                }
                p.endShape();
                p.noStroke();
                p.fill(col);
                for (const q of st.num) if (q && q.v) p.circle(plot.toX(q.s), plot.toY(q.v[idx]), 4.5);
            }
            const sx = plot.toX(clamp(Number(get('ds')), 0, 1));
            p.stroke('#ffd43b');
            p.strokeWeight(1.5);
            p.line(sx, pr.y, sx, pr.y + pr.h);
            p.noStroke();
            p.fill('#4dabf7');
            p.textAlign(p.LEFT, p.TOP);
            p.text('Re I(s)  (line: 2 pi i sum w Res, dots: numerical)', pr.x + 4, pr.y + 2);
            p.fill('#ff9f43');
            p.text('Im I(s)', pr.x + 4, pr.y + 15);
        });
    }

    function drawBranch(pal) {
        const b = st.branch;
        const r = st.rectA;
        const phi = b.phi;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        const fn = b.isSqrt ? (re, im) => sqrtCut([re, im], phi) : (re, im) => logCut([re, im], phi);
        clip(p, r, () => {
            p.image(domainImage(p, cache, 'zb', `b|${get('dfun')}|${phi}`, zv, fn), r.x, r.y, r.w, r.h);
            drawAxes(p, pal, zv, { unitX: 'Re z', unitY: 'Im z' });
            // the cut: a wavy red ray from the origin
            p.noFill();
            p.stroke('#ff3b3b');
            p.strokeWeight(3);
            dashed(p, true, [9, 5]);
            const len = Math.hypot(zv.xmax - zv.xmin, zv.ymax - zv.ymin);
            p.line(zv.toX(0), zv.toY(0), zv.toX(len * Math.cos(phi)), zv.toY(len * Math.sin(phi)));
            dashed(p, false);
            p.stroke('#ffd43b');
            p.strokeWeight(2.8);
            const pts = contourPolyline({ kind: 'circle', c: b.c, r: b.r }, 120);
            polyline(p, zv, pts, true);
            p.strokeWeight(1.6);
            chevrons(p, zv, pts, 6, 7);
            p.noStroke();
            p.fill('#ffd43b');
            p.circle(zv.toX(b.c[0] + b.r), zv.toY(b.c[1]), 7);
            p.fill(pal.fg);
            p.textSize(10);
            p.textAlign(p.LEFT, p.BOTTOM);
            p.text('start', zv.toX(b.c[0] + b.r) + 6, zv.toY(b.c[1]) - 4);
            p.stroke(pal.fg);
            p.strokeWeight(2);
            cross(p, zv.toX(0), zv.toY(0), 5);
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, `z-plane: ${b.isSqrt ? 'sqrt(z)' : 'log(z)'} with its branch cut (red)`);
    }

    function drawBranchImage(pal) {
        const b = st.branch;
        const r = st.rectB;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, `w = ${b.isSqrt ? 'sqrt' : 'log'}(z) along the loop`);
        const o = b.out;
        const f0 = b.f0;
        const lines = [];
        lines.push(`cut crossings: ${o.crossings}    loop encloses 0: ${b.wind ? 'yes' : 'no'}`);
        lines.push(`oint f dz (cut branch, numerical) = ${fmtC(o.value)}`);
        lines.push(`by continuation, no jump        = ${fmtC(b.exact)}`);
        lines.push(`f(start) = ${fmtC(f0, 3)}  ->  after one loop ${fmtC(b.fEnd, 3)}`);
        if (b.isSqrt) lines.push(b.wind ? { t: 'sqrt changes sign after one turn round 0: two sheets', c: '#ffd43b' } : { t: 'f returns to itself (loop does not enclose 0)', c: '#51cf66' });
        else lines.push(b.wind ? { t: 'log gains 2 pi i after one turn round 0: infinitely many sheets', c: '#ffd43b' } : { t: 'f returns to itself (loop does not enclose 0)', c: '#51cf66' });
        if (o.crossings > 0 && !b.wind) lines.push({ t: 'loop crosses the cut but f is analytic inside: integral != 0 only because of the cut', c: '#ff6b6b' });
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(11.5, Math.max(9, r.w / 52)), lead: 15, w: r.w - 16 });
        const dr = { x: r.x + 8, y: r.y + 26 + th + 8, w: r.w - 16, h: Math.max(40, r.y + r.h - (r.y + 26 + th + 8) - 8) };
        const pts = b.cont.concat(b.image);
        let xmin = -1; let xmax = 1; let ymin = -1; let ymax = 1;
        for (const q of pts) { xmin = Math.min(xmin, q[0]); xmax = Math.max(xmax, q[0]); ymin = Math.min(ymin, q[1]); ymax = Math.max(ymax, q[1]); }
        const span = Math.max(xmax - xmin, ymax - ymin) * 1.2;
        wv.setRect(dr.x, dr.y, dr.w, dr.h);
        wv.set((xmin + xmax) / 2 - span / 2, (xmin + xmax) / 2 + span / 2, (ymin + ymax) / 2 - span / 2, (ymin + ymax) / 2 + span / 2).lockAspect();
        clip(p, dr, () => {
            drawAxes(p, pal, wv, { unitX: 'Re w', unitY: 'Im w' });
            p.noFill();
            p.strokeWeight(1.6);
            dashed(p, true);
            p.stroke('#4dabf7');
            polyline(p, wv, b.cont);
            dashed(p, false);
            p.stroke('#ffd43b');
            p.strokeWeight(2.4);
            // principal image: break the polyline at jumps
            let seg = [];
            const flush = () => { if (seg.length > 1) polyline(p, wv, seg); seg = []; };
            for (const q of b.image) {
                const last = seg[seg.length - 1];
                if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.4 * span) flush();
                seg.push(q);
            }
            flush();
            p.noStroke();
            p.fill('#ffd43b');
            p.circle(wv.toX(f0[0]), wv.toY(f0[1]), 7);
            p.fill('#4dabf7');
            p.circle(wv.toX(b.fEnd[0]), wv.toY(b.fEnd[1]), 6);
            p.fill(pal.muted);
            p.textSize(10);
            p.textAlign(p.LEFT, p.TOP);
            p.text('yellow: f with the cut;  dashed blue: analytic continuation', dr.x + 4, dr.y + dr.h - 14);
        });
    }

    return {
        id: 'deform', scene, layout, sync,
        draw(pal) {
            p.background(pal.bg);
            if (mode() === 'homotopy') {
                if (!st.rat) return;
                drawHomotopy(pal);
                drawStaircase(pal);
            } else if (st.branch) {
                drawBranch(pal);
                drawBranchImage(pal);
            }
        },
        step(dt) {
            if (mode() === 'homotopy' && get('dplay')) {
                let s = clamp(Number(get('ds')), 0, 1) + st.animDir * dt * 0.12;
                if (s >= 1) { s = 1; st.animDir = -1; } else if (s <= 0) { s = 0; st.animDir = 1; }
                set('ds', +s.toFixed(4));
            }
        },
        press: (x, y) => scene.press(x, y),
        dragTo: (x, y) => scene.dragTo(x, y),
        release: () => scene.release(),
        wheel: (e, x, y) => scene.wheel(e, x, y),
        key: (k) => {
            if (k === ' ') { set('dplay', !get('dplay')); return true; }
            if (k === 'f' || k === 'F') { zv.set(-4.5, 4.5, -3.4, 3.4).lockAspect(); st.dirty = true; return true; }
            return false;
        },
        init() { st.key = ''; },
        actions: {
            reset: () => {
                for (const k of ['dax', 'day', 'dar', 'dbx', 'dby', 'dbr', 'dwig', 'ds', 'dcx', 'dcy', 'dcr', 'dcut']) {
                    set(k, { dax: 0, day: 0, dar: 3, dbx: 3.2, dby: 0.4, dbr: 0.5, dwig: 0.3, ds: 0, dcx: 0, dcy: 0, dcr: 1, dcut: Math.PI }[k]);
                }
                st.key = '';
            },
        },
        getState: () => ({ pred: st.pred, num: st.num, events: st.events, cur: st.cur, branch: st.branch, handles: scene.handles }),
    };
}
