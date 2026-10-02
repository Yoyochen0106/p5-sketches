// Drawing for the equal-area sketch (screen-space p5 calls; geometry comes from the model).

import * as G from '../../lib/polygon-area.js';
import { WORLD } from './view.js';

const MONO = 'Consolas, ui-monospace, monospace';
const num = (v) => (Number.isFinite(v) ? v.toFixed(3) : '-');

export function colors(pal) {
    return pal.dark
        ? { tri: '#4aa3ff', guide: '#ff9f43', height: '#2ecc71', second: '#c77dff', warn: '#ff6b6b', build: '#8fb4d9' }
        : { tri: '#1f6fd1', guide: '#d9700a', height: '#169a52', second: '#8e3fd1', warn: '#d12a2a', build: '#4f7aa8' };
}

/** '#rrggbb' + alpha 0..1 -> css rgba() string. */
export function rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const ok = (pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y);

function line(p, a, b) {
    if (ok(a) && ok(b)) p.line(a.x, a.y, b.x, b.y);
}

/** Dashed segment built from short lines (at most ~200 segments). */
function dashed(p, a, b, dash = 8, gap = 6) {
    if (!ok(a) || !ok(b)) return;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1) return;
    const period = Math.max(dash + gap, L / 100);
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    const d = (period * dash) / (dash + gap);
    for (let s = 0; s < L; s += period) {
        const e = Math.min(L, s + d);
        p.line(a.x + ux * s, a.y + uy * s, a.x + ux * e, a.y + uy * e);
    }
}

function polyShape(p, pts) {
    p.beginShape();
    for (const q of pts) if (ok(q)) p.vertex(q.x, q.y);
    p.endShape(p.CLOSE);
}

function dot(p, s, r, fill, stroke) {
    if (!ok(s)) return;
    p.fill(fill);
    if (stroke) { p.stroke(stroke); p.strokeWeight(2); } else p.noStroke();
    p.circle(s.x, s.y, r * 2);
}

function text(p, str, x, y, color, size = 13, w) {
    p.noStroke();
    p.fill(color);
    p.textFont(MONO);
    p.textSize(size);
    p.textAlign(p.LEFT, p.TOP);
    if (w) p.text(str, x, y, w);
    else p.text(str, x, y);
}

function tag(p, str, s, dx, dy, color, size = 13) {
    if (!ok(s) || !str) return;
    p.noStroke();
    p.fill(color);
    p.textFont(MONO);
    p.textSize(size);
    p.textAlign(p.CENTER, p.CENTER);
    p.text(str, s.x + dx, s.y + dy);
}

// ---------------------------------------------------------------------------------------------
// Shared pieces

/** Background, integer grid and (optionally) lattice dots. */
export function drawGrid(p, v, pal, show) {
    p.background(pal.bg);
    const tl = v.toScreen({ x: WORLD.xmin, y: WORLD.ymax });
    const br = v.toScreen({ x: WORLD.xmax, y: WORLD.ymin });
    p.noStroke();
    p.fill(pal.panel);
    p.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    if (!show) return;
    const fine = v.scale >= 12;
    p.strokeWeight(1);
    for (let x = WORLD.xmin; x <= WORLD.xmax; x++) {
        const major = x % 5 === 0;
        if (!fine && !major) continue;
        p.stroke(major ? pal.axis : pal.grid);
        const a = v.toScreen({ x, y: WORLD.ymin });
        const b = v.toScreen({ x, y: WORLD.ymax });
        p.line(a.x, a.y, b.x, b.y);
    }
    for (let y = WORLD.ymin; y <= WORLD.ymax; y++) {
        const major = y % 5 === 0;
        if (!fine && !major) continue;
        p.stroke(major ? pal.axis : pal.grid);
        const a = v.toScreen({ x: WORLD.xmin, y });
        const b = v.toScreen({ x: WORLD.xmax, y });
        p.line(a.x, a.y, b.x, b.y);
    }
}

/** Heads-up lines at the top left. The first line is drawn big. */
export function drawHud(p, pal, lines, width) {
    let y = 12;
    lines.forEach((l, i) => {
        if (!l) return;
        const size = i === 0 ? 22 : 13;
        text(p, l.text, 16, y, l.color || (i === 0 ? pal.fg : pal.muted), size, width - 32);
        y += i === 0 ? 30 : 18 * (1 + Math.floor((l.text.length * 7.6) / Math.max(200, width - 32)));
    });
}

export function drawFooter(p, pal, str) {
    text(p, str, 16, p.height - 22, pal.muted, 11);
}

function rightAngle(p, corner, toA, toB, size, color) {
    const ua = unit(corner, toA);
    const ub = unit(corner, toB);
    if (!ua || !ub) return;
    p.noFill();
    p.stroke(color);
    p.strokeWeight(1.5);
    const a = { x: corner.x + ua.x * size, y: corner.y + ua.y * size };
    const c = { x: a.x + ub.x * size, y: a.y + ub.y * size };
    const b = { x: corner.x + ub.x * size, y: corner.y + ub.y * size };
    p.line(a.x, a.y, c.x, c.y);
    p.line(c.x, c.y, b.x, b.y);
}

function unit(a, b) {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return l > 1e-9 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : null;
}

let pickCache = { key: '', pts: null };
function cachedLattice(poly) {
    const key = poly.map((q) => `${q.x},${q.y}`).join(';');
    if (pickCache.key !== key) pickCache = { key, pts: G.latticePoints(poly) };
    return pickCache.pts;
}

// ---------------------------------------------------------------------------------------------
// Tab 1: triangle

/**
 * @param opts {pick, trail, second, constrained, snap}
 * @returns the readout lines that were drawn (also useful for tests)
 */
export function drawTriangleTab(p, v, m, pal, opts) {
    const C = colors(pal);
    const tri = m.tri;
    const idx = m.drag && m.drag.kind !== 'apex2' ? m.drag.i : m.shareIdx;
    const S = tri.map((q) => v.toScreen(q));
    const apex = tri[idx];
    const B = tri[(idx + 1) % 3];
    const Cc = tri[(idx + 2) % 3];
    const guide = G.slideConstraint(tri, idx);
    const baseLen = Math.hypot(Cc.x - B.x, Cc.y - B.y);
    const foot = G.projectOnLine({ point: B, dir: guide.dir }, apex);
    const h = baseLen > 1e-9 ? Math.abs(G.signedArea(tri)) * 2 / baseLen : 0;

    // lattice points of Pick's theorem
    const pick = opts.pick ? G.pickInfo(tri) : null;
    if (opts.pick && pick) {
        const pts = cachedLattice(tri);
        const r = Math.max(2.5, Math.min(5, v.scale * 0.14));
        for (const q of pts.interior) dot(p, v.toScreen(q), r, rgba(C.tri, 0.95));
        for (const q of pts.boundary) dot(p, v.toScreen(q), r, rgba(C.guide, 0.95));
    }

    // guide line through the dragged vertex, parallel to the opposite side
    const span = G.clipLineToBox(guide, WORLD);
    if (span) {
        const a = v.toScreen({ x: guide.point.x + guide.dir.x * span[0], y: guide.point.y + guide.dir.y * span[0] });
        const b = v.toScreen({ x: guide.point.x + guide.dir.x * span[1], y: guide.point.y + guide.dir.y * span[1] });
        p.strokeWeight(opts.constrained ? 2 : 1);
        p.stroke(opts.constrained ? rgba(C.guide, 0.9) : rgba(C.guide, 0.3));
        dashed(p, a, b, 10, 7);
    }

    // ghost of the triangle before the drag, trail of the dragged vertex
    if (m.ghost) {
        p.noFill();
        p.stroke(rgba(pal.fg, 0.28));
        p.strokeWeight(1);
        polyShape(p, m.ghost.map((q) => v.toScreen(q)));
    }
    if (opts.trail && m.trail.length > 1) {
        m.trail.forEach((q, k) => {
            const a = (k + 1) / m.trail.length;
            dot(p, v.toScreen(q), 2.5, rgba(C.guide, 0.1 + 0.5 * a));
        });
    }

    // second triangle on the same base
    let area2 = null;
    if (opts.second) {
        const a2 = m.secondApex();
        const sb = v.toScreen(B);
        const sc = v.toScreen(Cc);
        const s2 = v.toScreen(a2);
        p.fill(rgba(C.second, 0.18));
        p.stroke(C.second);
        p.strokeWeight(2);
        polyShape(p, [sb, sc, s2]);
        dot(p, s2, 8, C.second, pal.bg);
        tag(p, "C'", s2, 0, -16, C.second);
        area2 = G.area([B, Cc, a2]);
    }

    // main triangle
    p.fill(rgba(C.tri, 0.2));
    p.stroke(C.tri);
    p.strokeWeight(2.5);
    polyShape(p, S);

    // base (opposite side), height and right-angle marker
    const sB = v.toScreen(B);
    const sC = v.toScreen(Cc);
    const sA = v.toScreen(apex);
    const sF = v.toScreen(foot);
    p.stroke(C.height);
    p.strokeWeight(3);
    line(p, sB, sC);
    const outside = Math.hypot(foot.x - B.x, foot.y - B.y) > baseLen + 1e-9 || Math.hypot(foot.x - Cc.x, foot.y - Cc.y) > baseLen + 1e-9;
    if (outside) {
        p.strokeWeight(1.5);
        p.stroke(rgba(C.height, 0.7));
        const far = Math.hypot(foot.x - B.x, foot.y - B.y) < Math.hypot(foot.x - Cc.x, foot.y - Cc.y) ? sB : sC;
        dashed(p, far, sF, 6, 5);
    }
    p.strokeWeight(2);
    p.stroke(rgba(C.height, 0.9));
    dashed(p, sA, sF, 7, 5);
    const toBase = outside ? (Math.hypot(foot.x - B.x, foot.y - B.y) < Math.hypot(foot.x - Cc.x, foot.y - Cc.y) ? sB : sC) : sB;
    const away = Math.hypot(sF.x - toBase.x, sF.y - toBase.y) > 2 ? toBase : sC;
    rightAngle(p, sF, away, sA, 10, C.height);
    const mb = { x: (sB.x + sC.x) / 2, y: (sB.y + sC.y) / 2 };
    const nb = unit(sB, sC);
    let nx = nb ? -nb.y : 0;
    let ny = nb ? nb.x : 1;
    if (nx * (sA.x - mb.x) + ny * (sA.y - mb.y) > 0) { nx = -nx; ny = -ny; } // label on the side away from the apex
    tag(p, `b = ${num(baseLen)}`, mb, nx * 20, ny * 20, C.height);
    const mh = { x: (sA.x + sF.x) / 2, y: (sA.y + sF.y) / 2 };
    tag(p, `h = ${num(h)}`, mh, 24, 0, C.height);

    // vertices
    tri.forEach((q, i) => {
        const s = S[i];
        const active = (m.drag && m.drag.i === i) || m.hover === i;
        dot(p, s, active ? 10 : 8, i === idx ? C.guide : C.tri, active ? pal.fg : pal.bg);
        tag(p, ['A', 'B', 'C'][i], s, 0, -17, pal.fg, 14);
    });

    // read-outs
    const A = G.area(tri);
    const lines = [{ text: `Area = ${num(A)}` }];
    lines.push({ text: `b = ${num(baseLen)}   h = ${num(h)}   b*h/2 = ${num((baseLen * h) / 2)}` });
    if (opts.constrained) {
        lines.push({ text: `Sliding ${['A', 'B', 'C'][idx]} along the guide line parallel to ${['A', 'B', 'C'][(idx + 1) % 3]}${['A', 'B', 'C'][(idx + 2) % 3]}: base and height stay fixed, so the area does too.`, color: C.guide });
    } else {
        const start = m.triStart ? G.area(m.triStart) : A;
        lines.push({ text: `Free mode: the vertex can go anywhere and the area changes (start ${num(start)}, change ${(A - start >= 0 ? '+' : '') + num(A - start)}).`, color: C.warn });
    }
    if (area2 !== null) lines.push({ text: `Second triangle on the same base and height: Area = ${num(area2)}`, color: C.second });
    if (opts.pick) {
        if (pick) {
            lines.push({ text: `Pick: I = ${pick.interior} (blue), B = ${pick.boundary} (orange)  ->  I + B/2 - 1 = ${num(pick.interior + pick.boundary / 2 - 1)}`, color: pal.fg });
        } else {
            lines.push({ text: 'Pick needs lattice vertices: turn on snapping to the grid.', color: C.warn });
        }
    }
    drawHud(p, pal, lines, p.width);
    return lines;
}

// ---------------------------------------------------------------------------------------------
// Tab 2: polygon

export function drawPolygonTab(p, v, m, pal, opts) {
    const C = colors(pal);
    const poly = m.displayPoly();
    const S = poly.map((q) => v.toScreen(q));
    const anim = m.anim;

    // guide line of the sliding / dragged vertex
    let gi = -1;
    if (anim) gi = anim.step.moved.index;
    else if (m.drag && m.drag.kind === 'poly') gi = m.drag.i;
    if (gi >= 0) {
        const n = poly.length;
        const chordA = poly[(gi - 1 + n) % n];
        const chordB = poly[(gi + 1) % n];
        const gl = anim ? anim.step.guide : { point: m.drag.V0, dir: m.drag.dir };
        const span = G.clipLineToBox(gl, WORLD);
        if (span) {
            const a = v.toScreen({ x: gl.point.x + gl.dir.x * span[0], y: gl.point.y + gl.dir.y * span[0] });
            const b = v.toScreen({ x: gl.point.x + gl.dir.x * span[1], y: gl.point.y + gl.dir.y * span[1] });
            p.strokeWeight(2);
            p.stroke(rgba(C.guide, 0.9));
            dashed(p, a, b, 10, 7);
        }
        p.strokeWeight(2);
        p.stroke(rgba(C.height, 0.9));
        line(p, v.toScreen(chordA), v.toScreen(chordB));
        if (anim && anim.step.target) {
            const t = anim.step.target;
            const d = unit(t.a, t.b);
            if (d) {
                const big = 40;
                p.strokeWeight(1.5);
                p.stroke(rgba(C.second, 0.8));
                dashed(p, v.toScreen({ x: t.a.x - d.x * big, y: t.a.y - d.y * big }), v.toScreen({ x: t.a.x + d.x * big, y: t.a.y + d.y * big }), 6, 5);
            }
        }
    }

    // previous outline while sliding
    if (anim) {
        p.noFill();
        p.stroke(rgba(pal.fg, 0.28));
        p.strokeWeight(1);
        polyShape(p, anim.step.before.map((q) => v.toScreen(q)));
    }

    p.fill(rgba(C.tri, 0.2));
    p.stroke(C.tri);
    p.strokeWeight(2.5);
    polyShape(p, S);

    poly.forEach((q, i) => {
        const s = S[i];
        const moving = anim && anim.step.moved.index === i;
        const removed = anim && anim.step.removed === i;
        const active = (m.drag && m.drag.i === i) || m.hover === i || m.sel === i;
        dot(p, s, active || moving ? 10 : 8, moving ? C.guide : removed ? C.second : C.tri, active || moving ? pal.fg : pal.bg);
        tag(p, G.label(i), s, 0, -17, removed ? C.second : pal.fg, 14);
    });

    const A = G.area(poly);
    const A0 = m.polyStart ? G.area(m.polyStart) : A;
    const lines = [{ text: `Area = ${num(A)}` }];
    lines.push({ text: `${poly.length} vertices   start area = ${num(A0)}   difference = ${(A - A0).toExponential(1)}` });
    if (anim) lines.push({ text: anim.step.rationale, color: C.guide });
    else if (poly.length === 3) lines.push({ text: 'A triangle: no more vertices can be removed without changing the area.', color: C.height });
    else lines.push({ text: 'Drag a vertex along its orange guide, or press Reduce: each step slides one vertex until it merges with a neighbour.', color: pal.muted });
    if (!opts.constrained) lines.push({ text: 'Free mode is on: dragging changes the area.', color: C.warn });
    drawHud(p, pal, lines, p.width);
    return lines;
}

// ---------------------------------------------------------------------------------------------
// Tab 3: quadrature

export function drawQuadTab(p, v, m, pal) {
    const C = colors(pal);
    const f = m.quadFrame();
    const { list, step } = f;

    for (const pg of list.polygons) {
        const S = pg.pts.map((q) => v.toScreen(q));
        const alpha = pg.alpha === undefined ? 1 : pg.alpha;
        if (pg.role === 'preview') {
            p.noFill();
            p.stroke(rgba(C.height, 0.9));
            p.strokeWeight(2);
        } else {
            const col = pg.role === 'piece' ? C.second : pg.name === 'square' ? C.height : C.tri;
            p.fill(rgba(col, 0.22 * alpha));
            p.stroke(rgba(col, 0.2 + 0.8 * alpha));
            p.strokeWeight(2.5);
        }
        polyShape(p, S);
    }
    for (const ln of list.lines) {
        const col = ln.role === 'guide' ? C.guide : ln.role === 'height' ? C.height : C.build;
        p.stroke(col);
        p.strokeWeight(ln.role === 'guide' ? 1.5 : 2.5);
        if (ln.role === 'guide') dashed(p, v.toScreen(ln.a), v.toScreen(ln.b), 8, 6);
        else line(p, v.toScreen(ln.a), v.toScreen(ln.b));
    }
    for (const a of list.arcs) {
        const pts = [];
        const N = 48;
        for (let k = 0; k <= N; k++) {
            const ang = a.a0 + ((a.a1 - a.a0) * k) / N;
            pts.push(v.toScreen({
                x: a.c.x + a.r * (Math.cos(ang) * a.u.x + Math.sin(ang) * a.n.x),
                y: a.c.y + a.r * (Math.cos(ang) * a.u.y + Math.sin(ang) * a.n.y),
            }));
        }
        p.noFill();
        p.stroke(C.second);
        p.strokeWeight(2);
        p.beginShape();
        for (const q of pts) if (ok(q)) p.vertex(q.x, q.y);
        p.endShape();
    }
    for (const q of list.points) {
        const s = v.toScreen(q.p);
        dot(p, s, 4.5, pal.fg);
        tag(p, q.label, s, 0, -14, pal.fg, 14);
    }

    const info = step.info;
    const lines = [{ text: `Area = ${num(f.area)}` }];
    lines.push({ text: `Step ${f.k + 1} / ${f.total}: ${step.caption}`, color: C.guide });
    if (info) lines.push({ text: `a = ${num(info.a)}   b = ${num(info.b)}   side = sqrt(a*b) = ${num(info.side)}   side^2 = ${num(info.side * info.side)}`, color: pal.muted });
    drawHud(p, pal, lines, p.width);

    // progress dots
    const y = p.height - 14;
    for (let k = 0; k < f.total; k++) {
        const x = 24 + k * 18;
        dot(p, { x, y }, k === f.k ? 5 : 3.5, k < f.k ? C.height : k === f.k ? C.guide : pal.axis);
    }
    return lines;
}
