// State and behaviour of the equal-area sketch, independent of p5.
// Coordinates are world units (y up); the view maps them to pixels.

import * as G from '../../lib/polygon-area.js';

/** Region where vertices may be dragged (slightly inside WORLD). */
export const BOX = { xmin: 0.3, xmax: 23.7, ymin: 0.3, ymax: 13.7 };

const P = (arr) => arr.map(([x, y]) => ({ x, y }));
const copy = (poly) => poly.map((v) => ({ x: v.x, y: v.y }));

export const TRI_PRESETS = {
    lattice: { label: 'lattice 8 x 6', pts: P([[4, 3], [12, 3], [9, 9]]) },
    acute: { label: 'acute', pts: P([[5, 3], [17, 3], [11, 11]]) },
    right: { label: 'right', pts: P([[4, 3], [14, 3], [4, 10]]) },
    obtuse: { label: 'obtuse', pts: P([[3, 3], [10, 3], [19, 8]]) },
    flat: { label: 'low and wide', pts: P([[2, 4], [22, 4], [12, 7]]) },
};

export const POLY_PRESETS = {
    pentagon: { label: 'pentagon', pts: P([[4, 3], [14, 2], [20, 7], [12, 12], [5, 9]]) },
    arrow: { label: 'concave pentagon', pts: P([[3, 2], [20, 2], [20, 11], [12, 6], [3, 11]]) },
    hexagon: { label: 'hexagon', pts: P([[4, 7], [8, 2], [16, 2], [21, 7], [16, 12], [8, 12]]) },
    heptagon: { label: 'heptagon', pts: P([[3, 5], [7, 2], [14, 2], [20, 5], [21, 10], [13, 12], [6, 11]]) },
    star: {
        label: 'star (octagon)',
        pts: Array.from({ length: 8 }, (_, k) => {
            const r = k % 2 === 0 ? 6 : 3;
            const a = (k / 8) * Math.PI * 2;
            return { x: 12 + r * Math.cos(a), y: 7 + r * Math.sin(a) };
        }),
    },
    quad: { label: 'quadrilateral', pts: P([[4, 3], [18, 2], [20, 10], [7, 11]]) },
};

export const MAX_VERTS = 8;
export const MIN_VERTS = 3;
const REDUCE_SECONDS = 1.4;
const HOLD_SECONDS = 0.45;
const QUAD_STEP_SECONDS = 2.4;
const QUAD_HOLD_SECONDS = 0.6;

const dot = (a, b) => a.x * b.x + a.y * b.y;
const finite = (v) => Number.isFinite(v);

function clampT(line, t, snapStep) {
    const r = G.clipLineToBox(line, BOX);
    if (!r) return t;
    if (snapStep) {
        const kLo = Math.ceil(r[0] / snapStep - 1e-9);
        const kHi = Math.floor(r[1] / snapStep + 1e-9);
        const k = Math.min(kHi, Math.max(kLo, Math.round(t / snapStep)));
        return k * snapStep;
    }
    return Math.min(r[1], Math.max(r[0], t));
}

export class Model {
    /** @param {(key:string)=>any} get settings reader (snap, constrained, ...) */
    constructor(get) {
        this.get = get;
        this.tab = 'triangle';
        this.tri = copy(TRI_PRESETS.lattice.pts);
        this.triStart = copy(this.tri);
        this.poly = copy(POLY_PRESETS.pentagon.pts);
        this.polyStart = copy(this.poly);
        this.history = [];
        this.anim = null;
        this.playAll = false;
        this.hold = 0;
        this.shareIdx = 2;
        this.second = { off: -5 };
        this.sel = -1;
        this.hover = -1;
        this.drag = null;
        this.ghost = null;
        this.trail = [];
        this.quad = null;
        this.rebuildQuad();
    }

    // ---------------------------------------------------------------- shapes / reset

    /** The vertex array the current tab edits. */
    shape() {
        return this.tab === 'polygon' ? this.poly : this.tri;
    }

    setTab(tab) {
        if (tab === this.tab) return;
        this.cancelDrag();
        this.tab = tab;
        if (tab === 'quadrature') this.restartQuad();
    }

    applyPreset(tab, id) {
        this.cancelDrag();
        if (tab === 'polygon' && POLY_PRESETS[id]) {
            this.poly = copy(POLY_PRESETS[id].pts);
            this.polyStart = copy(this.poly);
            this.history = [];
            this.anim = null;
            this.playAll = false;
            this.sel = -1;
        } else if (tab === 'triangle' && TRI_PRESETS[id]) {
            this.tri = copy(TRI_PRESETS[id].pts);
            this.triStart = copy(this.tri);
            this.ghost = null;
            this.trail = [];
            this.second.off = -5;
            this.shareIdx = 2;
        }
        this.rebuildQuad();
        if (this.tab === 'quadrature') this.restartQuad();
    }

    /** Back to the preset the tab was started from. */
    reset() {
        this.cancelDrag();
        if (this.tab === 'polygon') {
            this.poly = copy(this.polyStart);
            this.history = [];
            this.anim = null;
            this.playAll = false;
            this.hold = 0;
        } else if (this.tab === 'triangle') {
            this.tri = copy(this.triStart);
            this.ghost = null;
            this.trail = [];
        } else {
            this.restartQuad();
        }
        this.rebuildQuad();
    }

    /** Round every vertex of the active shape(s) to the integer lattice. */
    snapAll() {
        const snap = (poly) => poly.forEach((v) => {
            v.x = Math.min(BOX.xmax, Math.max(BOX.xmin, Math.round(v.x)));
            v.y = Math.min(BOX.ymax, Math.max(BOX.ymin, Math.round(v.y)));
        });
        snap(this.tri);
        snap(this.poly);
        this.rebuildQuad();
    }

    // ---------------------------------------------------------------- dragging

    secondApex() {
        const line = G.slideConstraint(this.tri, this.shareIdx);
        return { x: line.point.x + line.dir.x * this.second.off, y: line.point.y + line.dir.y * this.second.off };
    }

    /** Start dragging the vertex nearest to world point w within radius r (world units). */
    press(w, r) {
        if (this.tab === 'quadrature' || this.anim) return false;
        const poly = this.shape();
        let best = -1;
        let bd = r;
        poly.forEach((v, i) => {
            const d = Math.hypot(v.x - w.x, v.y - w.y);
            if (d <= bd) { bd = d; best = i; }
        });
        if (this.tab === 'triangle' && this.get('second')) {
            const a = this.secondApex();
            const d = Math.hypot(a.x - w.x, a.y - w.y);
            if (d <= bd && d < r) {
                this.drag = { kind: 'apex2', i: -1, V0: a, grab: { x: a.x - w.x, y: a.y - w.y }, dir: G.slideConstraint(this.tri, this.shareIdx).dir, moved: false };
                return true;
            }
        }
        if (best < 0) return false;
        const V0 = { x: poly[best].x, y: poly[best].y };
        const line = G.slideConstraint(poly, best);
        this.drag = {
            kind: this.tab === 'polygon' ? 'poly' : 'tri',
            i: best, V0, grab: { x: V0.x - w.x, y: V0.y - w.y }, dir: line.dir,
            step: G.primitiveStep(poly, best),
            startPoly: copy(poly), moved: false,
        };
        this.sel = best;
        if (this.tab === 'triangle') {
            this.shareIdx = best;
            this.ghost = copy(poly);
            this.trail = [{ x: V0.x, y: V0.y }];
        }
        return true;
    }

    /** Move the dragged vertex towards world point w (constrained or free depending on settings). */
    dragTo(w) {
        const d = this.drag;
        if (!d || !finite(w.x) || !finite(w.y)) return;
        const target = { x: w.x + d.grab.x, y: w.y + d.grab.y };
        const snap = !!this.get('snap');
        if (d.kind === 'apex2') {
            const base = this.tri[this.shareIdx];
            const ps = snap ? G.primitiveStep(this.tri, this.shareIdx) : null;
            const s = ps ? Math.hypot(ps.x, ps.y) : 0;
            const t = clampT({ point: base, dir: d.dir }, dot({ x: target.x - base.x, y: target.y - base.y }, d.dir), s);
            this.second.off = t;
            d.moved = true;
            return;
        }
        const poly = d.kind === 'poly' ? this.poly : this.tri;
        let pos;
        if (this.get('constrained')) {
            const line = { point: d.V0, dir: d.dir };
            let t = dot({ x: target.x - d.V0.x, y: target.y - d.V0.y }, d.dir);
            const s = snap && d.step ? Math.hypot(d.step.x, d.step.y) : 0;
            t = clampT(line, t, s);
            pos = { x: d.V0.x + d.dir.x * t, y: d.V0.y + d.dir.y * t };
            if (s && d.step) {
                const k = Math.round(t / s);
                pos = { x: d.V0.x + d.step.x * k, y: d.V0.y + d.step.y * k };
            }
        } else {
            pos = { x: target.x, y: target.y };
            if (snap) pos = { x: Math.round(pos.x), y: Math.round(pos.y) };
            pos.x = Math.min(BOX.xmax, Math.max(BOX.xmin, pos.x));
            pos.y = Math.min(BOX.ymax, Math.max(BOX.ymin, pos.y));
        }
        if (!finite(pos.x) || !finite(pos.y)) return;
        const cur = poly[d.i];
        if (Math.hypot(pos.x - cur.x, pos.y - cur.y) < 1e-12) return;
        poly[d.i] = pos;
        d.moved = true;
        if (d.kind === 'tri') {
            const last = this.trail[this.trail.length - 1];
            if (!last || Math.hypot(last.x - pos.x, last.y - pos.y) > 0.12) {
                this.trail.push({ x: pos.x, y: pos.y });
                if (this.trail.length > 120) this.trail.shift();
            }
            this.rebuildQuad();
        }
    }

    release() {
        const d = this.drag;
        this.drag = null;
        if (d && d.kind === 'poly' && d.moved) this.pushHistory(d.startPoly);
        return d;
    }

    cancelDrag() {
        this.drag = null;
    }

    // ---------------------------------------------------------------- polygon operations

    pushHistory(poly) {
        this.history.push(copy(poly));
        if (this.history.length > 200) this.history.shift();
    }

    canReduce() {
        return this.tab === 'polygon' && !this.anim && this.poly.length > MIN_VERTS;
    }

    /** Start the animation of the next sliding step. */
    reduce() {
        if (!this.canReduce()) return false;
        let step;
        try {
            step = G.reduceStep(this.poly);
        } catch {
            return false;
        }
        this.pushHistory(this.poly);
        this.anim = { step, t: 0 };
        this.sel = -1;
        return true;
    }

    startPlayAll() {
        if (this.tab !== 'polygon') return;
        this.playAll = this.poly.length > MIN_VERTS || !!this.anim;
        this.hold = 0;
    }

    undo() {
        this.playAll = false;
        if (this.anim) {
            this.anim = null;
            this.history.pop();
            return true;
        }
        const prev = this.history.pop();
        if (!prev) return false;
        this.poly = copy(prev);
        this.sel = -1;
        return true;
    }

    addVertex() {
        if (this.tab !== 'polygon' || this.anim || this.poly.length >= MAX_VERTS) return false;
        const n = this.poly.length;
        let bi = 0;
        let bl = -1;
        for (let i = 0; i < n; i++) {
            const a = this.poly[i];
            const b = this.poly[(i + 1) % n];
            const l = Math.hypot(b.x - a.x, b.y - a.y);
            if (l > bl) { bl = l; bi = i; }
        }
        const a = this.poly[bi];
        const b = this.poly[(bi + 1) % n];
        const sgn = G.signedArea(this.poly) >= 0 ? 1 : -1; // outward normal is the right-hand side of a CCW edge
        const nx = (b.y - a.y) / (bl || 1);
        const ny = -(b.x - a.x) / (bl || 1);
        const bump = Math.min(1.2, bl * 0.15);
        const v = {
            x: Math.min(BOX.xmax, Math.max(BOX.xmin, (a.x + b.x) / 2 + nx * bump * sgn)),
            y: Math.min(BOX.ymax, Math.max(BOX.ymin, (a.y + b.y) / 2 + ny * bump * sgn)),
        };
        this.pushHistory(this.poly);
        this.poly.splice(bi + 1, 0, v);
        this.sel = bi + 1;
        return true;
    }

    removeVertex() {
        if (this.tab !== 'polygon' || this.anim || this.poly.length <= MIN_VERTS) return false;
        const i = this.sel >= 0 && this.sel < this.poly.length ? this.sel : this.poly.length - 1;
        this.pushHistory(this.poly);
        this.poly.splice(i, 1);
        this.sel = -1;
        return true;
    }

    /** Polygon as it is drawn right now (mid-slide while an animation runs). */
    displayPoly() {
        if (!this.anim) return this.poly;
        const { step } = this.anim;
        const out = copy(step.before);
        const e = G.easeInOut(this.anim.t);
        const f = step.moved.from;
        const t = step.moved.to;
        out[step.moved.index] = { x: f.x + (t.x - f.x) * e, y: f.y + (t.y - f.y) * e };
        return out;
    }

    finishAnim() {
        if (!this.anim) return;
        this.poly = copy(this.anim.step.polygon);
        this.anim = null;
        this.hold = HOLD_SECONDS;
        if (this.poly.length <= MIN_VERTS) this.playAll = false;
    }

    // ---------------------------------------------------------------- quadrature

    rebuildQuad() {
        const steps = G.quadratureSteps(this.tri);
        const keep = this.quad;
        let xmin = Infinity;
        let xmax = -Infinity;
        let ymin = Infinity;
        let ymax = -Infinity;
        const grow = (p) => {
            if (!finite(p.x) || !finite(p.y)) return;
            xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
            ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
        };
        for (const s of steps) {
            for (const t of [0, 1]) {
                const l = s.at(t);
                l.polygons.forEach((pg) => pg.pts.forEach(grow));
                l.lines.forEach((ln) => { grow(ln.a); grow(ln.b); });
                l.points.forEach((q) => grow(q.p));
                l.arcs.forEach((a) => { grow({ x: a.c.x - a.r, y: a.c.y - a.r }); grow({ x: a.c.x + a.r, y: a.c.y + a.r }); });
            }
        }
        if (!finite(xmin)) { xmin = 0; xmax = 24; ymin = 0; ymax = 14; }
        const pad = 0.06 * Math.max(xmax - xmin, ymax - ymin, 1);
        this.quad = {
            steps, k: keep ? Math.min(keep.k, steps.length - 1) : 0, t: keep ? keep.t : 0,
            playing: keep ? keep.playing : true, wait: keep ? keep.wait : 0,
            bbox: { xmin: xmin - pad, xmax: xmax + pad, ymin: ymin - pad, ymax: ymax + pad },
        };
    }

    restartQuad() {
        this.quad.k = 0;
        this.quad.t = 0;
        this.quad.wait = 0;
        this.quad.playing = true;
    }

    /** Current frame of the quadrature animation. */
    quadFrame() {
        const q = this.quad;
        const step = q.steps[q.k];
        const list = step.at(G.easeInOut(q.t));
        return { list, step, k: q.k, total: q.steps.length, t: q.t, area: G.areaOf(list), done: q.k === q.steps.length - 1 && q.t >= 1 };
    }

    // ---------------------------------------------------------------- stepping

    /** Finish the current phase at once, or start and finish the next one. */
    stepForward() {
        if (this.tab === 'polygon') {
            if (this.anim) this.finishAnim();
            else if (this.reduce()) this.finishAnim();
            this.hold = 0;
        } else if (this.tab === 'quadrature') {
            const q = this.quad;
            if (q.t < 1) q.t = 1;
            else if (q.k < q.steps.length - 1) { q.k++; q.t = 1; }
            q.wait = 0;
        }
    }

    stepBack() {
        if (this.tab === 'quadrature') {
            const q = this.quad;
            if (q.t > 0) q.t = 0;
            else if (q.k > 0) { q.k--; q.t = 0; }
            q.playing = false;
        } else if (this.tab === 'polygon') {
            this.undo();
        }
    }

    toggleQuadPlaying() {
        const q = this.quad;
        if (q.k === q.steps.length - 1 && q.t >= 1) this.restartQuad();
        else q.playing = !q.playing;
    }

    /** Advance animations by dt seconds of animation time (already scaled by speed). */
    update(dt) {
        if (!finite(dt) || dt <= 0) return;
        if (this.tab === 'polygon') {
            if (this.anim) {
                this.anim.t = Math.min(1, this.anim.t + dt / REDUCE_SECONDS);
                if (this.anim.t >= 1) this.finishAnim();
            } else if (this.playAll) {
                if (this.poly.length <= MIN_VERTS) this.playAll = false;
                else {
                    this.hold -= dt;
                    if (this.hold <= 0 && !this.reduce()) this.playAll = false;
                }
            }
        } else if (this.tab === 'quadrature') {
            const q = this.quad;
            if (!q.playing) return;
            if (q.wait > 0) {
                q.wait -= dt;
                if (q.wait <= 0) {
                    if (q.k < q.steps.length - 1) { q.k++; q.t = 0; } else q.playing = false;
                }
                return;
            }
            q.t = Math.min(1, q.t + dt / QUAD_STEP_SECONDS);
            if (q.t >= 1) {
                if (q.k < q.steps.length - 1) q.wait = QUAD_HOLD_SECONDS;
                else q.playing = false;
            }
        }
    }
}
