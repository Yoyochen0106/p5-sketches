// Tab 3: real integrals by contour methods (semicircle, Jordan's lemma, indentation), the Laurent series viewer and the
// inverse Laplace transform by the Bromwich contour. All three share a z-plane panel and a plot / table panel.

import * as C from '../../lib/complex.js';
import {
    REAL_EXAMPLES, realExample, evalRealExample, realPart, evalRational, laurentCoefficients, laurentEval, laurentFunc, annulusOf,
    rationalFromCoefs, parseCoefs, inverseLaplaceResidues, bromwich, residues, makeRational, TWO_PI,
} from '../../lib/residues.js';
import {
    Viewport, Scene, FONT, TAU, fmt, fmtC, fmtErr, clip, polyline, drawAxes, cross, arrow, panelFrame, textBox, domainImage, dashed, clamp,
    niceTicks, fmtTick, chevrons,
} from './common.js';

const R_MAX = 12;
const N_SWEEP = 70;
const LAURENT_MAX = 40;

export function createRealTab(env) {
    const { p, get, set } = env;
    const scene = new Scene();
    const zv = new Viewport(-4, 4, -1, 6);
    const plot = new Viewport(0, R_MAX, -1, 1);
    scene.panels = { z: zv };
    const cache = {};
    const st = {
        rectA: { x: 0, y: 0, w: 1, h: 1 }, rectB: { x: 0, y: 0, w: 1, h: 1 }, ev: null, evKey: '', sweep: null, sweepKey: '', lau: null, lauKey: '',
        brom: null, bromKey: '', fcurve: null, fKey: '', animDir: 1, dirty: true, lastAnim: 0, F: null, Fkey: '',
    };
    const kind = () => (get('rex') === 'laurent' ? 'laurent' : get('rex') === 'bromwich' ? 'bromwich' : 'contour');
    const params = () => ({ a: Math.max(0.05, Number(get('ra'))), b: Number(get('rb')), w: Number(get('rw')) });

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
        zv.setRect(a.x, a.y, a.w, a.h);
        if (scene.userView.z) zv.lockAspect();
        else autoFit();
        st.dirty = true;
    }

    // -------- view fitting --------
    function autoFit() {
        const k = kind();
        if (k === 'contour') {
            const W = 1.35 * Math.max(Number(get('R')), 2.4);
            zv.set(-W, W, -0.25 * W, 1.3 * W).lockAspect();
        } else if (k === 'laurent') {
            const f = laurentFunc(get('lfun'));
            const c = [Number(get('lcx')), Number(get('lcy'))];
            let m = 1.5;
            for (const s of f.sing.slice(0, 7)) m = Math.max(m, C.abs(C.sub(s, c)));
            m = Math.min(m * 1.4, 6);
            m = Math.max(m, Number(get('lr')) * 1.4);
            zv.set(c[0] - m, c[0] + m, c[1] - m, c[1] + m).lockAspect();
        } else {
            const F = currentF();
            let m = 2;
            for (const q of F.poles) m = Math.max(m, C.abs(q.z) * 1.3);
            m = Math.max(m, Number(get('bR')) * 1.15);
            zv.set(-m * 0.9, m * 1.1, -m, m).lockAspect();
        }
    }

    function currentF() {
        const key = `${get('num')}|${get('den')}|${get('K')}`;
        if (key === st.Fkey && st.F) return st.F;
        st.Fkey = key;
        const n = parseCoefs(get('num')) || [1];
        const d = parseCoefs(get('den')) || [1, 1];
        st.F = rationalFromCoefs(n, d, Number(get('K')) || 0);
        return st.F;
    }

    // -------- computations --------
    function contourData() {
        const ex = realExample(get('rex'));
        const pr = params();
        const R = clamp(Number(get('R')), 0.2, R_MAX);
        const eps = clamp(Number(get('reps')), 0.005, 0.5);
        const key = `${ex.id}|${pr.a}|${pr.b}|${pr.w}|${R}|${eps}`;
        if (key !== st.evKey) {
            st.evKey = key;
            st.ev = evalRealExample(ex, pr, R, Math.min(eps, R * 0.5));
        }
        const skey = `${ex.id}|${pr.a}|${pr.b}|${pr.w}|${eps}`;
        if (skey !== st.sweepKey) {
            st.sweepKey = skey;
            const rows = [];
            for (let i = 0; i < N_SWEEP; i++) {
                const Rr = 0.25 + ((R_MAX - 0.25) * i) / (N_SWEEP - 1);
                const rat = ex.rational(pr);
                const near = rat.poles.some((q) => Math.abs(C.abs(q.z) - Rr) < 0.04);
                if (near) { rows.push({ R: Rr, skip: true }); continue; }
                const e = evalRealExample(ex, pr, Rr, Math.min(eps, Rr * 0.5));
                rows.push({ R: Rr, line: realPart(ex, e.line), arc: C.abs(e.arc), total: realPart(ex, e.total), ok: e.ok });
            }
            st.sweep = rows;
        }
        return { ex, pr, R, eps, ev: st.ev };
    }

    function laurentData() {
        const f = laurentFunc(get('lfun'));
        const c = [Number(get('lcx')), Number(get('lcy'))];
        const r = Math.max(0.02, Number(get('lr')));
        const key = `${f.id}|${c}|${r}`;
        if (key !== st.lauKey) {
            st.lauKey = key;
            const an = annulusOf(f.sing, c, r);
            const bad = f.sing.some((q) => Math.abs(C.abs(C.sub(q, c)) - r) < 1e-3 * Math.max(1, r));
            const N = bad ? 256 : (an.rout < Infinity && r / an.rout > 0.9) || (an.rin > 0 && an.rin / r > 0.9) ? 4096 : 1024;
            const coefs = bad ? null : laurentCoefficients(f.f, c, r, -LAURENT_MAX, LAURENT_MAX, N);
            const zt = [c[0] + r * Math.cos(0.9), c[1] + r * Math.sin(0.9)];
            const ft = f.f(zt);
            const partial = coefs ? laurentEval(coefs, -LAURENT_MAX, c, zt) : null;
            st.lau = { f, c, r, an, coefs, bad, zt, ft, partial, err: partial ? C.abs(C.sub(partial, ft)) : NaN };
        }
        return st.lau;
    }

    function bromwichData() {
        const F = currentF();
        const t = Math.max(0, Number(get('bt')));
        const c = Number(get('bc'));
        const R = Math.max(1, Number(get('bR')));
        const key = `${st.Fkey}|${t}|${c}|${R}`;
        if (key !== st.bromKey) {
            st.bromKey = key;
            st.brom = { F, t, c, R, b: bromwich(F, t, c, R), exact: inverseLaplaceResidues(F, t) };
        }
        const maxRe = F.poles.length ? Math.max(...F.poles.map((q) => q.z[0])) : -1;
        const tMax = maxRe < -0.05 ? clamp(6 / -maxRe, 2, 40) : 6;
        const fk = `${st.Fkey}|${tMax}`;
        if (fk !== st.fKey) {
            st.fKey = fk;
            const pts = [];
            for (let i = 0; i <= 200; i++) {
                const tt = (tMax * i) / 200;
                pts.push([tt, inverseLaplaceResidues(F, tt)]);
            }
            st.fcurve = { pts, tMax };
        }
        return st.brom;
    }

    // -------- handles --------
    function rebuildHandles() {
        const hs = [];
        const k = kind();
        const bump = () => { st.dirty = true; };
        if (k === 'contour') {
            const ex = realExample(get('rex'));
            hs.push({
                panel: 'z', x: 0, y: Number(get('R')), shape: 'dot', size: 6, color: '#ff9f43', label: 'R',
                set: (z) => { set('R', +clamp(Math.hypot(z[0], z[1]), 0.2, R_MAX).toFixed(3)); bump(); },
            });
            if (['cos', 'xsin'].includes(ex.id)) {
                hs.push({
                    panel: 'z', x: 0, y: Number(get('ra')), shape: 'diamond', size: 5, color: '#ff6b6b', label: 'pole ia',
                    set: (z) => { set('ra', +clamp(z[1], 0.05, 5).toFixed(3)); bump(); },
                });
            } else if (ex.id === 'ft') {
                hs.push({
                    panel: 'z', x: Number(get('rb')), y: Number(get('ra')), shape: 'diamond', size: 5, color: '#ff6b6b', label: 'pole b+ia',
                    set: (z) => { set('rb', +clamp(z[0], -4, 4).toFixed(3)); set('ra', +clamp(z[1], 0.05, 5).toFixed(3)); bump(); },
                });
            }
        } else if (k === 'laurent') {
            const c = [Number(get('lcx')), Number(get('lcy'))];
            const r = Number(get('lr'));
            hs.push({
                panel: 'z', x: c[0], y: c[1], shape: 'square', size: 5.5, color: '#ffd43b', label: 'centre c',
                set: (z) => { set('lcx', +z[0].toFixed(3)); set('lcy', +z[1].toFixed(3)); bump(); },
            });
            hs.push({
                panel: 'z', x: c[0] + r * Math.cos(0.9), y: c[1] + r * Math.sin(0.9), shape: 'dot', size: 6, color: '#ffd43b', label: 'radius r',
                set: (z) => { set('lr', +clamp(Math.hypot(z[0] - c[0], z[1] - c[1]), 0.02, 12).toFixed(3)); bump(); },
            });
        } else {
            hs.push({
                panel: 'z', x: Number(get('bc')), y: 0, shape: 'square', size: 5.5, color: '#4dabf7', label: 'Re s = c',
                set: (z) => { set('bc', +clamp(z[0], -12, 12).toFixed(3)); bump(); },
            });
        }
        scene.handles = hs;
    }
    scene.onChange = () => { st.dirty = true; };

    function sync() {
        const k = kind();
        if (k === 'contour') contourData();
        else if (k === 'laurent') laurentData();
        else bromwichData();
        const fitKey = `${k}|${k === 'contour' ? get('R') : ''}|${get('lfun')}|${get('lcx')}|${get('lcy')}|${st.Fkey}`;
        if (fitKey !== st.fitKey) {
            st.fitKey = fitKey;
            if (!scene.userView.z) autoFit();
        }
        rebuildHandles();
    }

    // -------- drawing: contour examples --------
    function drawContourLeft(pal, d) {
        const r = st.rectA;
        const { ex, R, eps } = d;
        const rat = d.ev.rational;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            drawAxes(p, pal, zv, { unitX: 'Re z (= x)', unitY: 'Im z' });
            // upper half plane tint
            p.noStroke();
            const t = p.color(pal.dark ? '#4aa3ff' : '#2563eb');
            t.setAlpha && t.setAlpha(18);
            p.fill(t);
            p.rect(r.x, r.y, r.w, clamp(zv.toY(0) - r.y, 0, r.h));
            p.noFill();
            // contour pieces
            p.strokeWeight(3);
            p.stroke('#4dabf7');
            if (ex.indent) {
                p.line(zv.toX(-R), zv.toY(0), zv.toX(-eps), zv.toY(0));
                p.line(zv.toX(eps), zv.toY(0), zv.toX(R), zv.toY(0));
                p.stroke('#51cf66');
                const small = [];
                for (let i = 0; i <= 24; i++) small.push([eps * Math.cos(Math.PI - (Math.PI * i) / 24), eps * Math.sin(Math.PI - (Math.PI * i) / 24)]);
                polyline(p, zv, small);
            } else p.line(zv.toX(-R), zv.toY(0), zv.toX(R), zv.toY(0));
            p.stroke('#ff9f43');
            const arc = [];
            for (let i = 0; i <= 90; i++) arc.push([R * Math.cos((Math.PI * i) / 90), R * Math.sin((Math.PI * i) / 90)]);
            polyline(p, zv, arc);
            p.strokeWeight(1.6);
            p.stroke('#ffd43b');
            chevrons(p, zv, arc, 3, 7);
            arrow(p, zv.toX(-R * 0.55), zv.toY(0), zv.toX(-R * 0.45), zv.toY(0), 8);
            // poles
            rat.poles.forEach((q) => {
                const inside = q.z[1] > 1e-9 && C.abs(q.z) < R;
                p.noFill();
                p.stroke(inside ? '#ff6b6b' : pal.muted);
                p.strokeWeight(2);
                cross(p, zv.toX(q.z[0]), zv.toY(q.z[1]), 6);
                if (inside) p.circle(zv.toX(q.z[0]), zv.toY(q.z[1]), 22);
            });
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, 'z-plane: closed contour = real segment + arc');
        p.noStroke();
        p.fill(pal.muted);
        p.textSize(10);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.text(`blue: [-R,R]   orange: arc |z|=R${ex.indent ? '   green: indentation' : ''}   red x: enclosed poles`, r.x + 8, r.y + r.h - 6);
    }

    function drawContourRight(pal, d) {
        const r = st.rectB;
        const { ex, R, ev } = d;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, ex.label);
        const showName = ex.show === 'im' ? 'Im' : ex.show === 'c' ? '|.|' : 'Re';
        const lines = [
            { t: ex.integrand, c: pal.muted },
            `R = ${fmt(R, 2)}`,
            `real line  = ${fmtC(ev.line)}`,
            ...(ex.indent ? [`small arc  = ${fmtC(ev.small)}`] : []),
            `big arc    = ${fmtC(ev.arc)}   |arc| = ${fmtErr(C.abs(ev.arc))}`,
            `total      = ${fmtC(ev.total)}`,
            `2 pi i sum Res (inside) = ${fmtC(ev.predicted)}`,
            { t: `exact value = ${fmtC(ev.exact)}   [${showName}]`, c: '#51cf66' },
            { t: `line - exact = ${fmtErr(C.abs(C.sub(ev.line, ev.exact)))}`, c: pal.fg },
        ];
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(11.5, Math.max(9, r.w / 56)), lead: 14.5, w: r.w - 16 });
        const noteY = r.y + 26 + th + 4;
        // sweep plot
        const pr = { x: r.x + 44, y: noteY + 8, w: r.w - 60, h: Math.max(60, r.y + r.h - noteY - 50) };
        let lo = 0;
        let hi = 0;
        for (const q of st.sweep) {
            if (q.skip) continue;
            for (const v of [q.line, q.arc, q.total]) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        }
        const exv = realPart(ex, ev.exact);
        lo = Math.min(lo, exv);
        hi = Math.max(hi, exv);
        const pad = Math.max(1e-6, (hi - lo) * 0.12);
        plot.set(0, R_MAX, lo - pad, hi + pad).setRect(pr.x, pr.y, pr.w, pr.h);
        clip(p, { x: r.x, y: pr.y - 2, w: r.w, h: pr.h + 36 }, () => {
            p.stroke(pal.grid);
            p.strokeWeight(1);
            for (const t of niceTicks(0, R_MAX, 6)) p.line(plot.toX(t), pr.y, plot.toX(t), pr.y + pr.h);
            const yt = niceTicks(plot.ymin, plot.ymax, 5);
            for (const t of yt) p.line(pr.x, plot.toY(t), pr.x + pr.w, plot.toY(t));
            p.stroke(pal.axis);
            p.line(pr.x, plot.toY(0), pr.x + pr.w, plot.toY(0));
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textFont(FONT);
            p.textAlign(p.CENTER, p.TOP);
            for (const t of niceTicks(0, R_MAX, 6)) p.text(fmtTick(t), plot.toX(t), pr.y + pr.h + 3);
            p.text('contour radius R', pr.x + pr.w / 2, pr.y + pr.h + 15);
            p.textAlign(p.RIGHT, p.CENTER);
            for (const t of yt) p.text(fmtTick(t), pr.x - 4, plot.toY(t));
            // exact
            p.stroke('#51cf66');
            p.strokeWeight(1.3);
            dashed(p, true);
            p.line(pr.x, plot.toY(exv), pr.x + pr.w, plot.toY(exv));
            dashed(p, false);
            const series = [['line', '#4dabf7', 2], ['arc', '#ff9f43', 2], ['total', '#c77dff', 1.6]];
            for (const [key, col, wgt] of series) {
                p.noFill();
                p.stroke(col);
                p.strokeWeight(wgt);
                let open = false;
                for (const q of st.sweep) {
                    if (q.skip || !Number.isFinite(q[key])) { if (open) { p.endShape(); open = false; } continue; }
                    if (!open) { p.beginShape(); open = true; }
                    p.vertex(plot.toX(q.R), plot.toY(q[key]));
                }
                if (open) p.endShape();
            }
            const sx = plot.toX(R);
            p.stroke('#ffd43b');
            p.strokeWeight(1.5);
            p.line(sx, pr.y, sx, pr.y + pr.h);
            p.noStroke();
            p.textAlign(p.LEFT, p.TOP);
            p.fill('#4dabf7');
            p.text(`${showName} of the real-line integral over [-R, R]`, pr.x + 4, pr.y + 2);
            p.fill('#ff9f43');
            p.text('|arc contribution|  (-> 0 as R grows)', pr.x + 4, pr.y + 15);
            p.fill('#c77dff');
            p.text(`${showName} of the closed-contour total (jumps when R passes a pole)`, pr.x + 4, pr.y + 28);
            p.fill('#51cf66');
            p.text('exact value', pr.x + 4, pr.y + 41);
        });
        p.noStroke();
        p.fill(pal.muted);
        p.textSize(10);
        p.textAlign(p.LEFT, p.TOP);
        const words = ex.note;
        p.text(words.length > 120 ? `${words.slice(0, 118)}...` : words, r.x + 8, r.y + r.h - 16);
    }

    // -------- drawing: Laurent --------
    function drawLaurentLeft(pal, d) {
        const r = st.rectA;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            if (get('bg')) {
                p.image(domainImage(p, cache, 'l', `l|${d.f.id}`, zv, (re, im) => d.f.f([re, im])), r.x, r.y, r.w, r.h);
                p.noStroke();
                const cv = p.color(pal.panel);
                cv.setAlpha && cv.setAlpha(pal.dark ? 120 : 100);
                p.fill(cv);
                p.rect(r.x, r.y, r.w, r.h);
            }
            drawAxes(p, pal, zv, { unitX: 'Re z', unitY: 'Im z' });
            const cx = zv.toX(d.c[0]);
            const cy = zv.toY(d.c[1]);
            const sc = r.w / (zv.xmax - zv.xmin);
            // annulus of convergence
            const rinPx = d.an.rin * sc;
            const routPx = Math.min(d.an.rout * sc, 4 * Math.max(r.w, r.h));
            p.noStroke();
            const t = p.color(d.bad ? '#ff6b6b' : '#51cf66');
            t.setAlpha && t.setAlpha(46);
            p.fill(t);
            const ring = (rad, n = 90) => Array.from({ length: n }, (_, i) => [cx + rad * Math.cos((TAU * i) / n), cy + rad * Math.sin((TAU * i) / n)]);
            p.beginShape();
            for (const q of ring(routPx, 120)) p.vertex(q[0], q[1]);
            if (rinPx > 0.5) {
                p.beginContour();
                for (const q of ring(rinPx, 120).reverse()) p.vertex(q[0], q[1]);
                p.endContour();
            }
            p.endShape(p.CLOSE);
            p.noFill();
            p.stroke('#51cf66');
            p.strokeWeight(1.2);
            dashed(p, true);
            if (rinPx > 0.5) p.circle(cx, cy, 2 * rinPx);
            if (routPx < 3 * Math.max(r.w, r.h)) p.circle(cx, cy, 2 * routPx);
            dashed(p, false);
            p.stroke('#ffd43b');
            p.strokeWeight(2.6);
            p.circle(cx, cy, 2 * d.r * sc);
            for (const s of d.f.sing) {
                p.stroke('#ff6b6b');
                p.strokeWeight(2);
                cross(p, zv.toX(s[0]), zv.toY(s[1]), 6);
            }
            p.stroke(pal.fg);
            p.strokeWeight(1);
            p.noFill();
            p.circle(zv.toX(d.zt[0]), zv.toY(d.zt[1]), 8);
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, `z-plane: f(z) = ${d.f.label}; green = annulus of convergence containing the circle`);
    }

    function drawLaurentRight(pal, d) {
        const r = st.rectB;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, 'Laurent coefficients a_n = (1/2 pi i) oint f (z-c)^(-n-1) dz');
        const lines = [];
        lines.push(`annulus: ${fmt(d.an.rin, 3)} < |z-c| < ${d.an.rout === Infinity ? 'inf' : fmt(d.an.rout, 3)};  circle r = ${fmt(d.r, 3)}`);
        if (d.bad) lines.push({ t: 'the circle passes through a singularity: choose another radius', c: '#ff6b6b' });
        else {
            lines.push(`principal part: n < 0 (highlighted);  a_-1 = Res = ${fmtC(d.coefs[LAURENT_MAX - 1], 4)}`);
            lines.push(`test point on the circle: f = ${fmtC(d.ft, 4)}`);
            lines.push({ t: `sum a_n (z-c)^n, |n|<=${LAURENT_MAX}  = ${fmtC(d.partial, 4)}   err ${fmtErr(d.err)}`, c: d.err < 1e-6 ? '#51cf66' : '#ff9f43' });
        }
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(11, Math.max(9, r.w / 60)), lead: 14.5, w: r.w - 16 });
        const N = clamp(Math.round(Number(get('ln'))), 2, 10);
        const pr = { x: r.x + 44, y: r.y + 26 + th + 14, w: r.w - 60, h: Math.max(70, (r.y + r.h - (r.y + 26 + th + 14)) * 0.55) };
        if (!d.bad) {
            const vals = [];
            for (let n = -N; n <= N; n++) vals.push({ n, a: d.coefs[n + LAURENT_MAX] });
            let m = 1e-9;
            for (const q of vals) m = Math.max(m, Math.abs(q.a[0]), Math.abs(q.a[1]));
            plot.set(-N - 0.8, N + 0.8, -m * 1.25, m * 1.25).setRect(pr.x, pr.y, pr.w, pr.h);
            clip(p, { x: r.x, y: pr.y - 2, w: r.w, h: pr.h + 28 }, () => {
                // principal part tint
                p.noStroke();
                const t = p.color('#ff6b6b');
                t.setAlpha && t.setAlpha(34);
                p.fill(t);
                p.rect(pr.x, pr.y, Math.max(0, plot.toX(-0.5) - pr.x), pr.h);
                p.stroke(pal.axis);
                p.strokeWeight(1);
                p.line(pr.x, plot.toY(0), pr.x + pr.w, plot.toY(0));
                p.noStroke();
                p.fill(pal.muted);
                p.textSize(10);
                p.textFont(FONT);
                p.textAlign(p.CENTER, p.TOP);
                for (let n = -N; n <= N; n++) p.text(String(n), plot.toX(n), pr.y + pr.h + 3);
                p.text('n  (power of (z - c));  shaded: principal part', pr.x + pr.w / 2, pr.y + pr.h + 15);
                p.textAlign(p.RIGHT, p.CENTER);
                for (const v of niceTicks(plot.ymin, plot.ymax, 4)) p.text(fmtTick(v), pr.x - 4, plot.toY(v));
                const bw = Math.max(2, Math.min(14, (pr.w / (2 * N + 1)) * 0.36));
                for (const q of vals) {
                    p.noStroke();
                    p.fill(q.n < 0 ? '#ff6b6b' : '#4dabf7');
                    const x = plot.toX(q.n);
                    const y0 = plot.toY(0);
                    const y1 = plot.toY(q.a[0]);
                    p.rect(x - bw - 1, Math.min(y0, y1), bw, Math.abs(y1 - y0));
                    if (Math.abs(q.a[1]) > 1e-9 * m) {
                        p.fill('#ff9f43');
                        const y2 = plot.toY(q.a[1]);
                        p.rect(x + 1, Math.min(y0, y2), bw, Math.abs(y2 - y0));
                    }
                }
                p.fill(pal.muted);
                p.textAlign(p.LEFT, p.TOP);
                p.text('Re a_n (blue / red = principal part), Im a_n (orange)', pr.x + 4, pr.y + 2);
            });
            // table
            const rows = [];
            for (let n = Math.max(-N, -4); n <= Math.min(N, 3); n++) rows.push({ t: `a_${n < 0 ? `(${n})` : n} = ${fmtC(d.coefs[n + LAURENT_MAX], 4)}`, c: n < 0 ? '#ff8787' : pal.fg });
            textBox(p, pal, rows, r.x + 8, pr.y + pr.h + 34, { size: Math.min(11, Math.max(9, r.w / 60)), lead: 14, w: r.w - 16 });
        }
    }

    // -------- drawing: Bromwich --------
    function drawBromwichLeft(pal, d) {
        const r = st.rectA;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        clip(p, r, () => {
            drawAxes(p, pal, zv, { unitX: 'Re s', unitY: 'Im s' });
            const maxRe = d.F.poles.length ? Math.max(...d.F.poles.map((q) => q.z[0])) : -1;
            p.noStroke();
            const t = p.color(d.c > maxRe ? '#51cf66' : '#ff6b6b');
            t.setAlpha && t.setAlpha(22);
            p.fill(t);
            const x0 = zv.toX(d.c);
            p.rect(x0, r.y, Math.max(0, r.x + r.w - x0), r.h);
            p.noFill();
            p.strokeWeight(3);
            p.stroke('#4dabf7');
            p.line(zv.toX(d.c), zv.toY(-d.R), zv.toX(d.c), zv.toY(d.R));
            arrow(p, zv.toX(d.c), zv.toY(-d.R * 0.2), zv.toX(d.c), zv.toY(d.R * 0.2), 9);
            p.stroke('#ff9f43');
            const arc = [];
            for (let i = 0; i <= 90; i++) {
                const ph = Math.PI / 2 + (Math.PI * i) / 90;
                arc.push([d.c + d.R * Math.cos(ph), d.R * Math.sin(ph)]);
            }
            polyline(p, zv, arc);
            d.F.poles.forEach((q) => {
                const inside = q.z[0] < d.c && Math.hypot(q.z[0] - d.c, q.z[1]) < d.R;
                p.noFill();
                p.stroke(inside ? '#ff6b6b' : pal.muted);
                p.strokeWeight(2);
                cross(p, zv.toX(q.z[0]), zv.toY(q.z[1]), 6);
                if (inside) p.circle(zv.toX(q.z[0]), zv.toY(q.z[1]), 22);
                if (q.m > 1) {
                    p.noStroke();
                    p.fill(pal.muted);
                    p.textSize(10);
                    p.text(`m=${q.m}`, zv.toX(q.z[0]) + 8, zv.toY(q.z[1]) + 4);
                }
            });
            scene.drawHandles(p, 'z', pal);
        });
        panelFrame(p, pal, r, 's-plane: Bromwich line Re s = c closed to the left');
        p.noStroke();
        p.fill(d.c > (d.F.poles.length ? Math.max(...d.F.poles.map((q) => q.z[0])) : -1) ? pal.muted : '#ff6b6b');
        p.textSize(10);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.text(d.c > (d.F.poles.length ? Math.max(...d.F.poles.map((q) => q.z[0])) : -1) ? 'the line is right of every pole (region of convergence)' : 'the line must lie to the right of ALL poles', r.x + 8, r.y + r.h - 6);
    }

    function drawBromwichRight(pal, d) {
        const r = st.rectB;
        p.noStroke();
        p.fill(pal.panel);
        p.rect(r.x, r.y, r.w, r.h);
        panelFrame(p, pal, r, 'Inverse Laplace: f(t) = sum of Res[F(s) e^{st}]');
        const lines = [];
        lines.push({ t: `F(s) = ${fmt(Number(get('K')), 2)} (${get('num')}) / (${get('den')})   t = ${fmt(d.t, 2)} s`, c: pal.muted });
        const res = residues(makeRational({ num: d.F.num, poles: d.F.poles, expk: [d.t, 0] }));
        d.F.poles.slice(0, 5).forEach((q, k) => {
            lines.push(`pole ${fmt(q.z[0], 2)}${q.z[1] < 0 ? '-' : '+'}${fmt(Math.abs(q.z[1]), 2)}j (m=${q.m}):  Res e^{pt} = ${fmtC(res[k], 3)}`);
        });
        lines.push(`sum of residues  f(t) = ${fmt(d.exact, 5)}`);
        lines.push(`line integral    = ${fmtC(d.b.line, 4)}`);
        lines.push(`arc (R=${fmt(d.R, 1)})      = ${fmtC(d.b.arc, 4)}`);
        lines.push({ t: `line + arc       = ${fmtC(d.b.total, 5)}`, c: Math.abs(d.b.total[0] - d.exact) < 1e-4 * Math.max(1, Math.abs(d.exact)) ? '#51cf66' : '#ff9f43' });
        const th = textBox(p, pal, lines, r.x + 8, r.y + 26, { size: Math.min(11, Math.max(9, r.w / 62)), lead: 14.5, w: r.w - 16 });
        const pr = { x: r.x + 44, y: r.y + 26 + th + 14, w: r.w - 60, h: Math.max(60, r.y + r.h - (r.y + 26 + th + 14) - 36) };
        const fc = st.fcurve;
        let lo = 0;
        let hi = 0;
        for (const q of fc.pts) if (Number.isFinite(q[1])) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
        lo = Math.max(lo, -1e6);
        hi = Math.min(hi, 1e6);
        if (!(hi > lo)) { lo = -1; hi = 1; }
        const pad = (hi - lo) * 0.12;
        plot.set(0, fc.tMax, lo - pad, hi + pad).setRect(pr.x, pr.y, pr.w, pr.h);
        clip(p, { x: r.x, y: pr.y - 2, w: r.w, h: pr.h + 34 }, () => {
            p.stroke(pal.grid);
            p.strokeWeight(1);
            for (const t of niceTicks(0, fc.tMax, 6)) p.line(plot.toX(t), pr.y, plot.toX(t), pr.y + pr.h);
            const yt = niceTicks(plot.ymin, plot.ymax, 5);
            for (const t of yt) p.line(pr.x, plot.toY(t), pr.x + pr.w, plot.toY(t));
            p.stroke(pal.axis);
            p.line(pr.x, plot.toY(0), pr.x + pr.w, plot.toY(0));
            p.noStroke();
            p.fill(pal.muted);
            p.textSize(10);
            p.textFont(FONT);
            p.textAlign(p.CENTER, p.TOP);
            for (const t of niceTicks(0, fc.tMax, 6)) p.text(fmtTick(t), plot.toX(t), pr.y + pr.h + 3);
            p.text('t (s)', pr.x + pr.w / 2, pr.y + pr.h + 15);
            p.textAlign(p.RIGHT, p.CENTER);
            for (const t of yt) p.text(fmtTick(t), pr.x - 4, plot.toY(t));
            p.noFill();
            p.stroke('#4dabf7');
            p.strokeWeight(2.2);
            polyline(p, plot, fc.pts);
            const tx = plot.toX(clamp(d.t, 0, fc.tMax));
            p.stroke('#ffd43b');
            p.strokeWeight(1.2);
            p.line(tx, pr.y, tx, pr.y + pr.h);
            p.noStroke();
            p.fill('#51cf66');
            p.circle(tx, plot.toY(d.exact), 9);
            p.noFill();
            p.stroke('#ffd43b');
            p.strokeWeight(2);
            p.circle(tx, plot.toY(d.b.total[0]), 15);
            p.noStroke();
            p.fill(pal.muted);
            p.textAlign(p.LEFT, p.TOP);
            p.text('f(t): residues (curve), dot = residue sum at t, ring = Bromwich contour total', pr.x + 4, pr.y + 2);
        });
    }

    return {
        id: 'real', scene, layout, sync,
        draw(pal) {
            p.background(pal.bg);
            const k = kind();
            if (k === 'contour') {
                const d = contourData();
                drawContourLeft(pal, d);
                drawContourRight(pal, d);
            } else if (k === 'laurent') {
                const d = laurentData();
                drawLaurentLeft(pal, d);
                drawLaurentRight(pal, d);
            } else {
                const d = bromwichData();
                drawBromwichLeft(pal, d);
                drawBromwichRight(pal, d);
            }
        },
        step(dt) {
            if (kind() === 'contour' && get('rplay')) {
                let R = Number(get('R')) + st.animDir * dt * 1.6;
                if (R >= R_MAX) { R = R_MAX; st.animDir = -1; } else if (R <= 0.3) { R = 0.3; st.animDir = 1; }
                set('R', +R.toFixed(3));
            }
        },
        press: (x, y) => scene.press(x, y),
        dragTo: (x, y) => scene.dragTo(x, y),
        release: () => scene.release(),
        wheel: (e, x, y) => scene.wheel(e, x, y),
        key: (k) => {
            if (k === ' ' && kind() === 'contour') { set('rplay', !get('rplay')); return true; }
            if (k === 'f' || k === 'F') { scene.userView.z = false; autoFit(); st.dirty = true; return true; }
            return false;
        },
        init() { autoFit(); },
        actions: {
            fit: () => { scene.userView.z = false; autoFit(); },
            reset: () => {
                const d = { R: 3, ra: 1, rb: 0.5, rw: 1.5, reps: 0.1, lr: 0.5, lcx: 0, lcy: 0, bt: 1, bc: 0.5, bR: 8, ln: 5 };
                for (const k of Object.keys(d)) set(k, d[k]);
                scene.userView.z = false;
            },
        },
        getState: () => ({ ev: st.ev, lau: st.lau, brom: st.brom, sweep: st.sweep, handles: scene.handles, kind: kind() }),
    };
}

export const REAL_OPTIONS = [
    ...REAL_EXAMPLES.map((e) => ({ value: e.id, label: e.label })),
    { value: 'laurent', label: 'Laurent series viewer (annulus + coefficients)' },
    { value: 'bromwich', label: 'Inverse Laplace by the Bromwich contour' },
];
