// REAL tab: y^2 = x^3 + a x + b with draggable P, Q, an animated chord-and-tangent construction,
// the multiples nP, and an (a, b) inset showing the singular locus 4a^3 + 27b^2 = 0.

import {
    INF, isInf, classify, discriminant, twoTorsion, addReal, negReal, multiplesReal,
    samplePolylines, closestPoint, residual,
} from '../../lib/elliptic.js';
import { Viewport } from '../approx/view.js';
import {
    colorsFor, withAlpha, dashed, clipped, drawWorldLine, label, dot, drawGridAxes, drawPolylines,
    paragraph, num, dist2, okPx,
} from './draw-util.js';
import { REAL_VIEW, REAL_PRESETS, AB_RANGE, MAX_TRAIL, STAGES, clamp } from './state.js';

const HIT = 18;
const STICK = 10;
const CUSP_N = 80;

/** Sample of the cusp curve 4a^3 + 27 b^2 = 0 in the (a, b) plane, upper and lower branch. */
function cuspSamples() {
    const up = [], lo = [];
    for (let i = 0; i <= CUSP_N; i++) {
        const a = -AB_RANGE * (1 - i / CUSP_N);
        const b = Math.sqrt(Math.max(0, (-4 * a * a * a) / 27));
        up.push([a, b]);
        lo.push([a, -b]);
    }
    return { up, lo };
}
const CUSP = cuspSamples();

const sgnTerm = (v, s) => `${v < 0 ? '−' : '+'} ${num(Math.abs(v), 3)}${s}`;

/** Create the REAL tab. env: { get, set, pal, invalidate }. */
export function createRealTab(env) {
    const view = new Viewport(REAL_VIEW.xmin, REAL_VIEW.xmax, REAL_VIEW.ymin, REAL_VIEW.ymax);
    const st = {
        P: null, Q: null, drag: null, stageT: STAGES, size: { w: 800, h: 600 },
        inset: { x: 0, y: 0, s: 140 }, polyKey: '', polys: null, lastAB: '',
    };
    const get = env.get;

    const curve = () => [get('a'), get('b')];

    function layout(w, h) {
        st.size = { w, h };
        view.setRect(0, 0, w, h).lockAspect();
        const s = clamp(Math.min(w, h) * 0.3, 96, 170);
        st.inset = { x: w - s - 12, y: 12, s };
    }

    const snap = (x, y) => {
        const [a, b] = curve();
        const c = closestPoint(a, b, x, y);
        return c ? { x: c.x, y: c.y } : null;
    };

    function setPoints(P, Q, replay = true) {
        st.P = snap(P[0], P[1]) || st.P;
        st.Q = snap(Q[0], Q[1]) || st.Q;
        if (replay) st.stageT = 0;
        env.invalidate();
    }

    function ensure() {
        if (!st.P || !st.Q) {
            const pr = REAL_PRESETS.generic;
            st.P = snap(pr.P[0], pr.P[1]);
            st.Q = snap(pr.Q[0], pr.Q[1]);
        }
        const [a, b] = curve();
        const key = `${a},${b}`;
        if (key !== st.lastAB) {
            st.lastAB = key;
            st.P = snap(st.P.x, st.P.y) || st.P;
            st.Q = snap(st.Q.x, st.Q.y) || st.Q;
        }
    }

    function polylines() {
        const [a, b] = curve();
        const key = `${a},${b},${Math.round(view.xmax * 50)}`;
        if (key !== st.polyKey) {
            st.polyKey = key;
            st.polys = samplePolylines(a, b, view.xmax + 0.1 * (view.xmax - view.xmin));
        }
        return st.polys;
    }

    // ---------- model ----------
    function model() {
        ensure();
        const [a, b] = curve();
        const add = addReal(a, b, st.P, st.Q);
        const trailN = Math.round(get('trailN'));
        const mult = trailN >= 1 ? multiplesReal(a, b, st.P, trailN) : [];
        const kind = classify(a, b);
        return { a, b, add, mult, trailN, kind };
    }

    function stageValue() {
        return get('manual') ? clamp(get('stage'), 0, STAGES) : st.stageT;
    }

    function tick(dt) {
        if (get('manual') || st.stageT >= STAGES) return false;
        st.stageT = Math.min(STAGES, st.stageT + dt * 0.0012 * get('speed'));
        return true;
    }

    // ---------- inset ----------
    const insetToAB = (px, py) => {
        const { x, y, s } = st.inset;
        return [clamp(AB_RANGE * (2 * (px - x) / s - 1), -AB_RANGE, AB_RANGE), clamp(AB_RANGE * (1 - 2 * (py - y) / s), -AB_RANGE, AB_RANGE)];
    };
    const abToInset = (a, b) => {
        const { x, y, s } = st.inset;
        return [x + (a / AB_RANGE + 1) * s / 2, y + (1 - b / AB_RANGE) * s / 2];
    };
    const inInset = (px, py) => {
        const { x, y, s } = st.inset;
        return px >= x && px <= x + s && py >= y && py <= y + s;
    };

    function dragInset(px, py) {
        let [a, b] = insetToAB(px, py);
        // snap onto the singular locus when close
        let best = null, bd = 9;
        for (const [ca, cb] of [...CUSP.up, ...CUSP.lo]) {
            const [sx, sy] = abToInset(ca, cb);
            const d = Math.hypot(sx - px, sy - py);
            if (d < bd) { bd = d; best = [ca, cb]; }
        }
        if (best) [a, b] = best;
        else { a = +a.toFixed(3); b = +b.toFixed(3); }
        env.set('a', a);
        env.set('b', b);
    }

    // ---------- pointer ----------
    function press(px, py) {
        ensure();
        if (inInset(px, py)) {
            st.drag = { kind: 'inset' };
            dragInset(px, py);
            return true;
        }
        const dP = dist2(px, py, view.toX(st.P.x), view.toY(st.P.y));
        const dQ = dist2(px, py, view.toX(st.Q.x), view.toY(st.Q.y));
        if (Math.min(dP, dQ) <= HIT) {
            st.drag = { kind: dP <= dQ ? 'P' : 'Q' };
            return true;
        }
        st.drag = { kind: 'pan' };
        return true;
    }

    function drag(px, py) {
        const d = st.drag;
        if (!d) return;
        env.invalidate();
        if (d.kind === 'inset') { dragInset(px, py); return; }
        if (d.kind === 'pan') { view.panPx(px - d.lx, py - d.ly); d.lx = px; d.ly = py; return; }
        const wx = view.fromX(px), wy = view.fromY(py);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
        let T = snap(wx, wy);
        if (!T) return;
        const other = d.kind === 'P' ? st.Q : st.P;
        const sd = (A) => dist2(view.toX(T.x), view.toY(T.y), view.toX(A.x), view.toY(A.y));
        if (sd(other) < STICK) T = { x: other.x, y: other.y };
        else if (sd(negReal(other)) < STICK) T = negReal(other);
        if (d.kind === 'P') st.P = T; else st.Q = T;
        st.stageT = STAGES;
    }

    function start(px, py) {
        const ok = press(px, py);
        if (st.drag && st.drag.kind === 'pan') { st.drag.lx = px; st.drag.ly = py; }
        return ok;
    }

    function release() {
        const had = !!st.drag;
        st.drag = null;
        return had;
    }

    function wheel(px, py, delta) {
        view.zoomAt(px, py, Math.exp(delta * 0.0012));
        env.invalidate();
    }

    // ---------- drawing ----------
    function drawInset(p, pal, C, m) {
        const { x, y, s } = st.inset;
        p.stroke(pal.border);
        p.strokeWeight(1);
        p.fill(withAlpha(p, pal.panel, 235));
        p.rect(x, y, s, s, 6);
        clipped(p, { x, y, w: s, h: s }, () => {
            // region with three real roots (two components)
            p.noStroke();
            p.fill(withAlpha(p, C.curve, 40));
            p.beginShape();
            for (const [a, b] of CUSP.up) { const [sx, sy] = abToInset(a, b); p.vertex(sx, sy); }
            for (const [a, b] of [...CUSP.lo].reverse()) { const [sx, sy] = abToInset(a, b); p.vertex(sx, sy); }
            p.endShape(p.CLOSE);
            p.stroke(pal.axis);
            p.strokeWeight(1);
            const [ox, oy] = abToInset(0, 0);
            p.line(x, oy, x + s, oy);
            p.line(ox, y, ox, y + s);
            p.noFill();
            p.stroke(C.R);
            p.strokeWeight(1.6);
            for (const br of [CUSP.up, CUSP.lo]) {
                p.beginShape();
                for (const [a, b] of br) { const [sx, sy] = abToInset(a, b); p.vertex(sx, sy); }
                p.endShape();
            }
        });
        const [dx, dy] = abToInset(m.a, m.b);
        dot(p, dx, dy, 10, m.kind === 'smooth' ? C.P : C.R, pal.fg, 1.5);
        p.textFont('system-ui, sans-serif');
        label(p, '(a, b) plane: drag the dot', x + 6, y + s - 15, pal.muted, 10);
        label(p, 'Δ=0', x + 5, y + 4, C.R, 10);
        label(p, '2 comp.', x + s * 0.14, y + s * 0.44, pal.muted, 9);
        label(p, '1 comp.', x + s * 0.62, y + s * 0.3, pal.muted, 9);
    }

    function describe(m) {
        const D = discriminant(m.a, m.b);
        if (m.kind === 'cusp') return 'Δ = 0 : cusp (y² = x³), singular';
        if (m.kind === 'node') return 'Δ = 0 : node / isolated point, singular';
        return `Δ = ${num(D, 3)} ${D > 0 ? '> 0 : two components (egg + branch)' : '< 0 : one component'}`;
    }

    function hud(p, pal, C, m, tt) {
        const { w } = st.size;
        const tw = Math.max(160, w - st.inset.s - 40);
        p.textFont('Consolas, ui-monospace, monospace');
        const lines = [];
        lines.push([pal.fg, `y² = x³ ${sgnTerm(m.a, 'x')} ${sgnTerm(m.b, '')}`]);
        lines.push([m.kind === 'smooth' ? pal.muted : C.R, describe(m)]);
        lines.push([C.P, `P = (${num(st.P.x)}, ${num(st.P.y)})`]);
        lines.push([C.Q, `Q = (${num(st.Q.x)}, ${num(st.Q.y)})`]);
        const r = m.add.result;
        const kindText = { chord: 'chord', tangent: 'tangent (P = Q)', vertical: 'vertical line (Q = −P)', identity: 'identity' }[m.add.kind];
        lines.push([C.R, isInf(r) ? `P + Q = O (point at infinity) via ${kindText}` : `P + Q = (${num(r.x)}, ${num(r.y)}) via ${kindText}`]);
        if (m.trailN >= 1) {
            const last = m.mult[m.mult.length - 1];
            const closed = last && isInf(last.point);
            lines.push([C.trail, closed ? `${last.n}P = O : P has order ${last.n} (torsion)` : `multiples up to ${m.trailN}P shown; no closure yet`]);
        }
        if (m.kind !== 'smooth') lines.push([C.R, 'Singular curve: the group law is only valid on nonsingular points.']);
        let y = 10;
        for (const [col, str] of lines) {
            paragraph(p, str, 12, y, tw, 40, col, 12);
            y += p.textWidth(str) > tw ? 32 : 17;
        }
        const names = ['points', 'line through P and Q', 'third intersection R′', 'reflect in the x axis', 'P + Q'];
        const stageName = names[Math.min(STAGES, Math.floor(tt))];
        paragraph(p, `construction ${tt >= STAGES ? '(complete)' : `step ${Math.floor(tt) + 1}/${STAGES + 1}: ${stageName}`}`, 12, st.size.h - 22, tw, 18, pal.muted, 11);
    }

    function drawConstruction(p, pal, C, m, tt) {
        const { add } = m;
        const P = st.P, Q = st.Q;
        const sx = (X) => view.toX(X.x), sy = (X) => view.toY(X.y);
        // stage 0->1: the line grows out of P/Q
        const lineT = clamp(tt - 0, 0, 1);
        if (add.line && lineT > 0) {
            p.stroke(C.line);
            p.strokeWeight(2);
            const mid = [(P.x + Q.x) / 2, (P.y + Q.y) / 2];
            drawWorldLine(p, view, add.line, lineT, add.line.type === 'vertical' ? [P.x, P.y] : mid);
        }
        // stage 1->2: third intersection
        const thirdT = clamp(tt - 1, 0, 1);
        const R3 = add.third;
        if (!isInf(R3) && thirdT > 0) {
            dot(p, sx(R3), sy(R3), 12 * thirdT, withAlpha(p, pal.bg, 255), C.third, 2.5);
            if (thirdT >= 1) label(p, 'R′', sx(R3) + 8, sy(R3) - 18, C.third, 13);
        }
        // stage 2->3: reflect (vertical dashed segment)
        const refT = clamp(tt - 2, 0, 1);
        const R = add.result;
        if (!isInf(R3) && !isInf(R) && refT > 0) {
            p.stroke(C.third);
            p.strokeWeight(1.5);
            dashed(p, [5, 5], () => {
                const x1 = sx(R3), y1 = sy(R3), y2 = sy(R);
                if (okPx(x1) && okPx(y1) && okPx(y2)) p.line(x1, y1, x1, y1 + (y2 - y1) * refT);
            });
        }
        // stage 3->4: the sum
        const sumT = clamp(tt - 3, 0, 1);
        if (sumT > 0) {
            if (isInf(R)) {
                // O lives at the top and bottom of every vertical line
                const top = view.rect.y + 22;
                const x = add.line && add.line.type === 'vertical' ? view.toX(add.line.x) : view.toX(P.x);
                if (okPx(x)) {
                    dot(p, x, top, 14 * sumT, C.R, pal.fg, 1.5);
                    label(p, 'O (∞)', x + 10, top - 7, C.R, 13);
                }
            } else {
                dot(p, sx(R), sy(R), 14 * sumT, C.R, pal.fg, 1.5);
                if (sumT >= 1) label(p, 'P+Q', sx(R) + 9, sy(R) + 6, C.R, 13);
            }
        }
    }

    function drawTrail(p, pal, C, m) {
        if (m.trailN < 2) return;
        const pts = m.mult.filter((e) => e.n >= 2 && !isInf(e.point));
        p.stroke(withAlpha(p, C.trail, 110));
        p.strokeWeight(1.2);
        let prev = st.P;
        for (const e of pts) {
            const a = view.toX(prev.x), b = view.toY(prev.y), c = view.toX(e.point.x), d = view.toY(e.point.y);
            if ([a, b, c, d].every(okPx)) p.line(a, b, c, d);
            prev = e.point;
        }
        for (const e of pts) {
            const x = view.toX(e.point.x), y = view.toY(e.point.y);
            dot(p, x, y, 9, C.trail, pal.bg, 1);
            label(p, `${e.n}P`, x + 7, y - 16, C.trail, 12);
        }
    }

    function draw(p, pal, dt = 16) {
        const animating = tick(dt);
        const m = model();
        const C = colorsFor(pal.dark);
        const tt = stageValue();
        p.background(pal.bg);
        p.textFont('system-ui, sans-serif');
        const r = view.rect;
        clipped(p, r, () => {
            if (get('showGrid')) drawGridAxes(p, view, pal);
            p.stroke(C.curve);
            p.strokeWeight(2.6);
            drawPolylines(p, view, polylines(), C.curve);
            if (get('show2torsion') && m.kind === 'smooth') {
                for (const t of twoTorsion(m.a, m.b)) {
                    p.noFill();
                    p.stroke(C.torsion);
                    p.strokeWeight(1.5);
                    const x = view.toX(t.x), y = view.toY(t.y);
                    if (okPx(x) && okPx(y)) p.square(x - 4, y - 4, 8);
                }
            }
            drawTrail(p, pal, C, m);
            drawConstruction(p, pal, C, m, tt);
            for (const [X, col, nm] of [[st.P, C.P, 'P'], [st.Q, C.Q, 'Q']]) {
                const x = view.toX(X.x), y = view.toY(X.y);
                dot(p, x, y, 13, col, pal.fg, 1.5);
                label(p, nm, x - 18, y - 22, col, 14);
            }
        });
        hud(p, pal, C, m, tt);
        drawInset(p, pal, C, m);
        return animating;
    }

    // ---------- actions ----------
    function applyPreset(id) {
        const pr = REAL_PRESETS[id];
        if (!pr) return;
        env.set('a', pr.a);
        env.set('b', pr.b);
        env.set('trailN', pr.trail || 0);
        view.set(REAL_VIEW.xmin, REAL_VIEW.xmax, REAL_VIEW.ymin, REAL_VIEW.ymax).lockAspect();
        st.lastAB = '';
        st.polyKey = '';
        setPoints(pr.P, pr.Q);
    }

    function randomise(rnd = Math.random) {
        const [a, b] = curve();
        const xs = (rnd() - 0.2) * 6 + view.xmin * 0.3;
        const ys = (rnd() - 0.5) * 6;
        const xq = (rnd() - 0.2) * 6 + view.xmin * 0.3;
        const yq = (rnd() - 0.5) * 6;
        void a; void b;
        setPoints([xs, ys], [xq, yq]);
    }

    return {
        layout, draw, press: start, drag, release, wheel,
        animating: () => !get('manual') && st.stageT < STAGES,
        addMultiple() {
            env.set('trailN', Math.min(MAX_TRAIL, Math.round(get('trailN')) + 1));
        },
        clearTrail() { env.set('trailN', 0); },
        replay() { env.set('manual', false); st.stageT = 0; env.invalidate(); },
        tangentCase() { ensure(); st.Q = { x: st.P.x, y: st.P.y }; st.stageT = 0; env.invalidate(); },
        verticalCase() { ensure(); st.Q = negReal(st.P); st.stageT = 0; env.invalidate(); },
        applyPreset, randomise, setPoints,
        resetView() {
            view.set(REAL_VIEW.xmin, REAL_VIEW.xmax, REAL_VIEW.ymin, REAL_VIEW.ymax).lockAspect();
            env.invalidate();
        },
        getState() {
            const m = model();
            const [a, b] = curve();
            return {
                a, b, P: st.P, Q: st.Q, sum: m.add.result, kind: m.add.kind, third: m.add.third, line: m.add.line,
                stage: stageValue(), view, inset: st.inset, mult: m.mult, residualP: residual(a, b, st.P), curveKind: m.kind,
                abToInset, INF,
            };
        },
    };
}
