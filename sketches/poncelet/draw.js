// Drawing for the Poncelet sketch. Everything takes a p5 instance and a prepared `scene`.

import { ellipsePoint, conicFromEllipseParams, tangentPointsFrom, secondIntersection, cayleyTable } from '../../lib/conics.js';
import { niceTicks } from '../approx/view.js';
import { handleWorld } from './state.js';

export const EDGE_WEIGHT = 2.25;
export const FAMILY_WEIGHT = 1;
export const ENVELOPE_WEIGHT = 1.25;
export const VERT_D = 8;
export const P0_D = 13;
export const TOUCH_D = 5;

const OUTER = { dark: '#9fb4ff', light: '#3f51b5' };
const INNER = { dark: '#ffb36b', light: '#c2570c' };
const OK_COL = { dark: '#2ecc71', light: '#1b8a4b' };
const BAD_COL = { dark: '#ff6b6b', light: '#c62828' };

const okPx = (v) => Number.isFinite(v) && Math.abs(v) < 1e7;
const clampPx = (v) => Math.max(-1e7, Math.min(1e7, v));

function hsl(h, s, l) {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const hx = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
    return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

/** Colour of step k of `n` (rainbow, adapted to the theme). */
export function stepColor(k, n, dark) {
    return hsl(((k / Math.max(1, Math.min(n, 12))) * 0.85 + 0.55) % 1, 0.75, dark ? 0.62 : 0.42);
}

function withAlpha(p, col, a) {
    const c = p.color(col);
    c.setAlpha(a);
    return c;
}

function drawGrid(p, view, pal) {
    const r = view.rect;
    p.strokeWeight(1);
    p.stroke(pal.grid);
    for (const x of niceTicks(view.xmin, view.xmax, 12)) {
        const sx = view.toX(x);
        if (x !== 0) p.line(sx, r.y, sx, r.y + r.h);
    }
    for (const y of niceTicks(view.ymin, view.ymax, 8)) {
        const sy = view.toY(y);
        if (y !== 0) p.line(r.x, sy, r.x + r.w, sy);
    }
    p.stroke(pal.axis);
    if (0 >= view.xmin && 0 <= view.xmax) p.line(view.toX(0), r.y, view.toX(0), r.y + r.h);
    if (0 >= view.ymin && 0 <= view.ymax) p.line(r.x, view.toY(0), r.x + r.w, view.toY(0));
}

function drawEllipse(p, view, e, col, weight) {
    const N = 180;
    p.noFill();
    p.stroke(col);
    p.strokeWeight(weight);
    p.beginShape();
    for (let i = 0; i < N; i++) {
        const P = ellipsePoint(e, (i / N) * 2 * Math.PI);
        const x = view.toX(P[0]), y = view.toY(P[1]);
        if (okPx(x) && okPx(y)) p.vertex(clampPx(x), clampPx(y));
    }
    p.endShape(p.CLOSE);
}

function seg(p, view, A, B) {
    const x1 = view.toX(A[0]), y1 = view.toY(A[1]), x2 = view.toX(B[0]), y2 = view.toY(B[1]);
    if (okPx(x1) && okPx(y1) && okPx(x2) && okPx(y2)) p.line(x1, y1, x2, y2);
}

function dot(p, view, P, d) {
    const x = view.toX(P[0]), y = view.toY(P[1]);
    if (okPx(x) && okPx(y)) p.circle(x, y, d);
}

function drawHandles(p, view, e, circle, col) {
    const cx = view.toX(e.cx), cy = view.toY(e.cy);
    if (!okPx(cx) || !okPx(cy)) return;
    p.noStroke();
    p.fill(col);
    p.circle(cx, cy, 7);
    p.stroke(col);
    p.strokeWeight(1);
    for (const h of handleWorld(e, circle)) {
        const hx = view.toX(h[0]), hy = view.toY(h[1]);
        if (!okPx(hx) || !okPx(hy)) continue;
        p.line(cx, cy, hx, hy);
        p.fill(col);
        p.rect(hx - 4.5, hy - 4.5, 9, 9);
    }
}

/** Format a number compactly. */
export const fmt = (v, d = 3) => {
    if (!Number.isFinite(v)) return '--';
    if (v === 0) return '0';
    const a = Math.abs(v);
    return a < 1e-3 || a >= 1e5 ? v.toExponential(1) : v.toFixed(d);
};

/** Everything the HUD needs, computed from the analysis. */
export function hudLines(scene) {
    const { an, steps, outer, inner, flags } = scene;
    const lines = [];
    const dark = scene.pal.dark;
    const good = OK_COL[dark ? 'dark' : 'light'], bad = BAD_COL[dark ? 'dark' : 'light'];
    if (!an.chain.ok) {
        lines.push({ text: 'no real tangents: inner conic is not inside the outer one', col: bad });
    } else {
        lines.push({ text: `${steps}-step residual |P${steps} - P0| / size = ${fmt(an.chain.residual)}`, col: null });
    }
    if (an.closed) {
        lines.push({ text: `closed after n = ${an.closed.n}  (winding ${an.closed.winding})`, col: good, badge: true });
    } else if (an.chain.ok) {
        lines.push({ text: 'not closed within 60 steps', col: bad, badge: true });
    }
    if (Number.isFinite(an.rho)) lines.push({ text: `rotation number ~ ${an.rho.toFixed(5)}`, col: null });
    if (flags.showEuler && scene.circles) {
        const R = outer.a, r = inner.a, d = Math.hypot(inner.cx - outer.cx, inner.cy - outer.cy);
        const e = an.euler;
        lines.push({ text: `Euler:  d^2 = ${fmt(e.lhs)}   R^2 - 2Rr = ${fmt(e.rhs)}   diff ${fmt(e.defect)}`, col: Math.abs(e.defect) < 1e-6 ? good : null });
        lines.push({ text: `R = ${fmt(R, 2)}  r = ${fmt(r, 2)}  d = ${fmt(d, 2)}   Fuss(4) diff ${fmt(an.fuss)}`, col: null });
    }
    if (flags.showCayley) {
        lines.push({ text: 'Cayley determinants (0 <=> closes after n):', col: null });
        const t = an.cayley;
        for (let i = 0; i < t.length; i += 2) {
            const cell = (q) => (q ? `n=${String(q.n).padEnd(2)} ${Math.abs(q.value) < 1e-7 ? '0 *' : fmt(q.value, 2)}`.padEnd(17) : '');
            lines.push({ text: cell(t[i]) + cell(t[i + 1]), col: null, mono: true });
        }
    }
    if (scene.msg) lines.push({ text: scene.msg, col: scene.msgCol || null });
    return lines;
}

/** Evaluate everything displayed that is not geometry (kept out of draw for testability). */
export function cayleyFor(outer, inner) {
    return cayleyTable(conicFromEllipseParams(outer), conicFromEllipseParams(inner), 12);
}

function drawHud(p, scene) {
    const { pal } = scene;
    const lines = hudLines(scene);
    const x = 12, y = 12, lh = 16, w = Math.min(p.width - 24, 360);
    if (w < 150) return;
    p.noStroke();
    p.fill(withAlpha(p, pal.panel, 215));
    p.rect(x - 6, y - 6, w, lines.length * lh + 10, 6);
    p.textSize(12);
    p.textAlign(p.LEFT, p.TOP);
    lines.forEach((ln, i) => {
        p.fill(ln.col || pal.fg);
        p.text(ln.text, x, y + i * lh);
    });
}

/** Render one frame. */
export function drawScene(p, scene) {
    const { view, pal, outer, inner, an, steps, flags } = scene;
    const dark = pal.dark;
    const th = dark ? 'dark' : 'light';
    p.background(pal.bg);
    if (flags.showGrid) drawGrid(p, view, pal);

    // envelope: first tangent of the whole family, 60 starting points
    if (flags.showEnvelope) {
        const C = conicFromEllipseParams(outer), D = conicFromEllipseParams(inner);
        p.stroke(withAlpha(p, INNER[th], 70));
        p.strokeWeight(ENVELOPE_WEIGHT);
        for (let i = 0; i < 60; i++) {
            const P = ellipsePoint(outer, (i / 60) * 2 * Math.PI);
            const ts = tangentPointsFrom(D, P);
            if (ts.length < 2) continue;
            for (const T of ts) {
                const Q = secondIntersection(C, P, T);
                if (Q) seg(p, view, P, Q);
            }
        }
    }

    drawEllipse(p, view, outer, OUTER[th], 2);
    drawEllipse(p, view, inner, INNER[th], 2.5);

    // family of polygons
    if (flags.family) {
        p.stroke(withAlpha(p, pal.fg, 60));
        p.strokeWeight(FAMILY_WEIGHT);
        for (const pts of an.family) {
            for (let k = 0; k + 1 < pts.length; k++) seg(p, view, pts[k], pts[k + 1]);
        }
    }

    // the chain, step by step
    const pts = an.chain.pts;
    p.strokeWeight(EDGE_WEIGHT);
    for (let k = 0; k + 1 < pts.length; k++) {
        p.stroke(flags.stepColors ? stepColor(k, steps, dark) : pal.accent);
        seg(p, view, pts[k], pts[k + 1]);
    }
    if (flags.showTouch) {
        p.noStroke();
        p.fill(INNER[th]);
        for (const T of an.chain.touches) dot(p, view, T, TOUCH_D);
    }
    p.noStroke();
    for (let k = 1; k < pts.length; k++) {
        p.fill(flags.stepColors ? stepColor(k - 1, steps, dark) : pal.accent);
        dot(p, view, pts[k], VERT_D);
    }
    // P0 marker
    const P0 = ellipsePoint(outer, scene.t0);
    p.fill(pal.bg);
    p.stroke(pal.fg);
    p.strokeWeight(2);
    dot(p, view, P0, P0_D);
    p.noStroke();
    p.fill(pal.fg);
    p.textSize(11);
    p.textAlign(p.LEFT, p.BOTTOM);
    const lx = view.toX(P0[0]) + 9, ly = view.toY(P0[1]) - 7;
    if (okPx(lx) && okPx(ly)) p.text('P0', lx, ly);

    drawHandles(p, view, outer, scene.outerCircle, OUTER[th]);
    drawHandles(p, view, inner, scene.innerCircle, INNER[th]);
    drawHud(p, scene);
}
