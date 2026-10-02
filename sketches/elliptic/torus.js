// COMPLEX TORUS tab: C / (Z + tau Z) with draggable tau, z1, z2; the Weierstrass map z -> (p(z), p'(z))
// sends vector addition mod the lattice to the chord-and-tangent law (shown on the real section when it exists).

import {
    curveCoefficients, hasRealSection, wpPair, realRoots, samplePolylines, addReal, isInf,
    cubic, negReal,
} from '../../lib/elliptic.js';
import { Viewport } from '../approx/view.js';
import {
    colorsFor, withAlpha, dashed, clipped, arrow, label, dot, drawGridAxes, drawPolylines, drawWorldLine,
    paragraph, num, cnum, dist2, okPx,
} from './draw-util.js';
import { TORUS_PRESETS, clamp } from './state.js';

const HIT = 18;
const BOX = { x0: -1.4, x1: 2.4, y0: -0.35, y1: 2.9 };
const TAU_RE = 1, TAU_IM_MIN = 0.3, TAU_IM_MAX = 2.5;
const mod1 = (v) => {
    const r = v - Math.floor(v);
    return r > 1 - 1e-12 ? 0 : r;
};

/** Create the torus tab. env: { get, set, invalidate }. */
export function createTorusTab(env) {
    const get = env.get;
    const left = new Viewport(BOX.x0, BOX.x1, BOX.y0, BOX.y1);
    const right = new Viewport(-5, 5, -5, 5);
    const st = {
        z: [[0.18, 0], [0.31, 0.5]], drag: null, size: { w: 800, h: 600 },
        lrect: { x: 0, y: 0, w: 400, h: 600 }, rrect: { x: 400, y: 0, w: 400, h: 600 }, invKey: '', inv: null,
    };

    const tau = () => [clamp(get('tauRe'), -TAU_RE, TAU_RE), clamp(get('tauIm'), TAU_IM_MIN, TAU_IM_MAX)];
    const toZ = (t, uv) => [uv[0] + uv[1] * t[0], uv[1] * t[1]];

    /** Fit the box into a rectangle with equal scales (independent of tau so dragging is stable). */
    function fit(v, r) {
        v.setRect(r.x, r.y, r.w, r.h);
        const bw = BOX.x1 - BOX.x0, bh = BOX.y1 - BOX.y0;
        const sc = Math.min(r.w / bw, r.h / bh);
        const cx = (BOX.x0 + BOX.x1) / 2, cy = (BOX.y0 + BOX.y1) / 2;
        v.set(cx - r.w / (2 * sc), cx + r.w / (2 * sc), cy - r.h / (2 * sc), cy + r.h / (2 * sc));
    }

    function layout(w, h) {
        st.size = { w, h };
        if (w >= h * 1.1) {
            st.lrect = { x: 0, y: 0, w: Math.floor(w / 2), h };
            st.rrect = { x: Math.floor(w / 2), y: 0, w: w - Math.floor(w / 2), h };
        } else {
            st.lrect = { x: 0, y: 0, w, h: Math.floor(h / 2) };
            st.rrect = { x: 0, y: Math.floor(h / 2), w, h: h - Math.floor(h / 2) };
        }
        fit(left, st.lrect);
    }

    // ---------- model ----------
    function invariants(t) {
        const key = `${t[0]},${t[1]}`;
        if (key !== st.invKey) {
            st.invKey = key;
            const cc = curveCoefficients(t);
            st.inv = { ...cc, real: hasRealSection(t), rect: Math.abs(Math.abs(t[0]) % 1) < 1e-9 };
        }
        return st.inv;
    }

    /** Allowed v coordinates for real z (v = 0 always; v = 1/2 for rectangular lattices). */
    function realVs(inv) {
        return inv.rect ? [0, 0.5] : [0];
    }

    function snapV(inv, v) {
        let best = 0, bd = Infinity;
        for (const c of realVs(inv)) {
            const dd = Math.abs(v - c);
            if (dd < bd) { bd = dd; best = c; }
        }
        return best;
    }

    const realType = (inv, uv) => inv.real && realVs(inv).some((c) => Math.abs(uv[1] - c) < 1e-9);

    function sync() {
        const t = tau();
        const inv = invariants(t);
        if (get('torusReal') && inv.real) st.z = st.z.map(([u, v]) => [u, snapV(inv, mod1(v))]);
        return { t, inv };
    }

    function model() {
        const { t, inv } = sync();
        const [z1, z2] = st.z;
        const uv3 = [mod1(z1[0] + z2[0]), mod1(z1[1] + z2[1])];
        const Z = [toZ(t, z1), toZ(t, z2), toZ(t, uv3)];
        const W = Z.map((z) => wpPair(z, t));
        const out = { t, inv, uv: [z1, z2, uv3], Z, W, raw: [Z[0][0] + Z[1][0], Z[0][1] + Z[1][1]] };
        out.realOk = inv.real && out.uv.every((uv) => realType(inv, uv)) && W.every(Boolean);
        if (out.realOk) {
            const a = inv.a[0], b = inv.b[0];
            const pts = W.map((w) => ({ x: w.wp[0], y: w.dwp[0] / 2 }));
            const add = addReal(a, b, pts[0], pts[1]);
            out.real = { a, b, pts, add };
            out.err = isInf(add.result) ? Infinity : Math.hypot(add.result.x - pts[2].x, add.result.y - pts[2].y) / (1 + Math.abs(pts[2].x));
        }
        return out;
    }

    // ---------- pointer ----------
    const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    const screenOf = (z) => [left.toX(z[0]), left.toY(z[1])];

    function press(px, py) {
        if (!inRect(st.lrect, px, py)) return false;
        const m = model();
        const cand = [{ k: 'tau', z: m.t }, { k: 0, z: m.Z[0] }, { k: 1, z: m.Z[1] }];
        let best = null, bd = HIT;
        for (const c of cand) {
            const [sx, sy] = screenOf(c.z);
            const d = dist2(px, py, sx, sy);
            if (d < bd) { bd = d; best = c; }
        }
        st.drag = best ? { kind: best.k } : null;
        return !!best;
    }

    function drag(px, py) {
        const d = st.drag;
        if (!d) return;
        const wx = left.fromX(px), wy = left.fromY(py);
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
        env.invalidate();
        if (d.kind === 'tau') {
            let re = clamp(wx, -TAU_RE, TAU_RE), im = clamp(wy, TAU_IM_MIN, TAU_IM_MAX);
            for (const s of [0, 0.5, -0.5]) if (Math.abs(re - s) < 0.04) re = s;
            env.set('tauRe', +re.toFixed(3) === re ? re : +re.toFixed(3));
            env.set('tauIm', +im.toFixed(3));
            return;
        }
        const { t, inv } = sync();
        let v = mod1(wy / t[1]);
        const u = mod1(wx - (wy / t[1]) * t[0]);
        if (get('torusReal') && inv.real) v = snapV(inv, v);
        st.z[d.kind] = [u, v];
    }

    function release() {
        const had = !!st.drag;
        st.drag = null;
        return had;
    }

    // ---------- drawing ----------
    function drawLeft(p, pal, C, m) {
        const { t } = m;
        const r = st.lrect;
        clipped(p, r, () => {
            // lattice lines
            p.strokeWeight(1);
            p.stroke(withAlpha(p, pal.axis, 110));
            for (let n = -2; n <= 4; n++) {
                const a = screenOf([-3 + n * t[0], n * t[1]]), b = screenOf([4 + n * t[0], n * t[1]]);
                if (a.every(okPx) && b.every(okPx)) p.line(a[0], a[1], b[0], b[1]);
            }
            for (let k = -3; k <= 4; k++) {
                const a = screenOf([k - 2 * t[0], -2 * t[1]]), b = screenOf([k + 4 * t[0], 4 * t[1]]);
                if (a.every(okPx) && b.every(okPx)) p.line(a[0], a[1], b[0], b[1]);
            }
            // fundamental parallelogram
            const O = screenOf([0, 0]), A = screenOf([1, 0]), D = screenOf([1 + t[0], t[1]]), B = screenOf([t[0], t[1]]);
            p.fill(withAlpha(p, C.curve, 34));
            p.stroke(C.curve);
            p.strokeWeight(2);
            p.quad(O[0], O[1], A[0], A[1], D[0], D[1], B[0], B[1]);
            // lattice points
            p.noStroke();
            p.fill(pal.fg);
            for (let n = -2; n <= 4; n++) {
                for (let k = -3; k <= 4; k++) {
                    const s = screenOf([k + n * t[0], n * t[1]]);
                    if (okPx(s[0]) && okPx(s[1])) p.circle(s[0], s[1], 5);
                }
            }
            // vector addition: 0 -> z1 -> z1 + z2, and the wrapped sum
            const Z1 = screenOf(m.Z[0]), Z2 = screenOf(m.Z[1]), RAW = screenOf(m.raw), Z3 = screenOf(m.Z[2]);
            p.strokeWeight(2);
            p.stroke(C.P);
            arrow(p, O[0], O[1], Z1[0], Z1[1], 9);
            p.stroke(withAlpha(p, C.Q, 190));
            arrow(p, O[0], O[1], Z2[0], Z2[1], 9);
            dashed(p, [5, 4], () => {
                p.stroke(C.Q);
                arrow(p, Z1[0], Z1[1], RAW[0], RAW[1], 9);
                p.stroke(C.P);
                arrow(p, Z2[0], Z2[1], RAW[0], RAW[1], 9);
            });
            const wrapped = Math.hypot(RAW[0] - Z3[0], RAW[1] - Z3[1]) > 2;
            if (wrapped) {
                p.stroke(withAlpha(p, C.R, 200));
                p.strokeWeight(1.5);
                dashed(p, [3, 4], () => arrow(p, RAW[0], RAW[1], Z3[0], Z3[1], 8));
                dot(p, RAW[0], RAW[1], 9, null, C.R, 1.5);
            }
            dot(p, Z1[0], Z1[1], 14, C.P, pal.fg, 1.5);
            dot(p, Z2[0], Z2[1], 14, C.Q, pal.fg, 1.5);
            dot(p, Z3[0], Z3[1], 15, C.R, pal.fg, 1.5);
            label(p, 'z₁', Z1[0] + 8, Z1[1] - 20, C.P, 13);
            label(p, 'z₂', Z2[0] + 8, Z2[1] - 20, C.Q, 13);
            label(p, 'z₁+z₂', Z3[0] + 9, Z3[1] + 5, C.R, 13);
            // tau handle
            dot(p, B[0], B[1], 17, withAlpha(p, C.line, 230), pal.fg, 2);
            label(p, 'τ', B[0] + 11, B[1] - 22, C.line, 15);
            label(p, '1', A[0] + 6, A[1] + 3, pal.muted, 12);
        });
        p.textFont('Consolas, ui-monospace, monospace');
        const w = r.w - 24;
        paragraph(p, `Λ = Z + τZ,  τ = ${num(m.t[0])} + ${num(m.t[1])}i`, r.x + 12, r.y + 10, w, 20, pal.fg, 12);
        paragraph(p, `g2 = ${cnum(m.inv.g2, 4)}\ng3 = ${cnum(m.inv.g3, 4)}`, r.x + 12, r.y + 28, w, 40, pal.muted, 11);
        paragraph(p, `z₁ = ${num(m.uv[0][0], 2)} + ${num(m.uv[0][1], 2)}τ,  z₂ = ${num(m.uv[1][0], 2)} + ${num(m.uv[1][1], 2)}τ  ->  z₁+z₂ ≡ ${num(m.uv[2][0], 2)} + ${num(m.uv[2][1], 2)}τ`, r.x + 12, r.y + r.h - 42, w, 38, pal.muted, 11);
        p.textFont('system-ui, sans-serif');
    }

    function rightView(real) {
        const a = real.a, b = real.b;
        const roots = realRoots(a, b);
        const r1 = roots[0].x, r3 = roots[roots.length - 1].x;
        const span = Math.max(r3 - r1, 2 * Math.sqrt(Math.abs(a)) + 1);
        const r = st.rrect;
        right.setRect(r.x, r.y, r.w, r.h);
        const xmin = r1 - 0.5 * span, xmax = r3 + 1.1 * span;
        right.set(xmin, xmax, -1, 1);
        right.lockAspect();
        return right;
    }

    function drawRight(p, pal, C, m) {
        const r = st.rrect;
        p.stroke(pal.border);
        p.strokeWeight(1);
        p.line(r.x, r.y, st.size.w >= st.size.h * 1.1 ? r.x : r.x + r.w, st.size.w >= st.size.h * 1.1 ? r.y + r.h : r.y);
        p.textFont('Consolas, ui-monospace, monospace');
        const tx = r.x + 12, tw = r.w - 24;
        if (m.inv.real) {
            const a = m.inv.a[0], b = m.inv.b[0];
            paragraph(p, `real section: y² = x³ ${a < 0 ? '−' : '+'} ${num(Math.abs(a))}x ${b < 0 ? '−' : '+'} ${num(Math.abs(b))}   (x = ℘(z), y = ℘′(z)/2)`, tx, r.y + 10, tw, 34, pal.fg, 12);
        } else {
            paragraph(p, 'Re τ is not 0 or ±1/2, so g2, g3 are not real: the curve has no real section.', tx, r.y + 10, tw, 34, C.R, 12);
        }
        if (m.realOk) {
            const { a, b, pts, add } = m.real;
            const v = rightView(m.real);
            p.textFont('system-ui, sans-serif');
            clipped(p, r, () => {
                p.stroke(withAlpha(p, pal.grid, 255));
                drawGridAxes(p, v, pal);
                p.stroke(C.curve);
                p.strokeWeight(2.4);
                drawPolylines(p, v, samplePolylines(a, b, v.xmax + 1), C.curve);
                if (add.line) {
                    p.stroke(C.line);
                    p.strokeWeight(1.8);
                    drawWorldLine(p, v, add.line, 1);
                }
                const R3 = add.third;
                if (!isInf(R3)) {
                    dot(p, v.toX(R3.x), v.toY(R3.y), 11, pal.bg, C.third, 2.5);
                    p.stroke(C.third);
                    p.strokeWeight(1.3);
                    dashed(p, [4, 4], () => p.line(v.toX(R3.x), v.toY(R3.y), v.toX(R3.x), v.toY(-R3.y)));
                }
                const cols = [C.P, C.Q, C.R];
                const names = ['℘(z₁)', '℘(z₂)', '℘(z₁+z₂)'];
                pts.forEach((P, i) => {
                    const x = v.toX(P.x), y = v.toY(P.y);
                    dot(p, x, y, i === 2 ? 15 : 13, cols[i], pal.fg, 1.5);
                    label(p, names[i], x + 9, y - 18, cols[i], 12);
                });
            });
            p.textFont('Consolas, ui-monospace, monospace');
            const err = m.err;
            paragraph(p, `chord sum of ℘(z₁), ℘(z₂) vs ℘(z₁+z₂): ${Number.isFinite(err) ? err.toExponential(1) : 'O'}`, tx, r.y + r.h - 24, tw, 18, pal.muted, 11);
        } else {
            const lines = [];
            const names = ['z₁', 'z₂', 'z₁+z₂'];
            m.W.forEach((w, i) => {
                lines.push(w ? `${names[i]}:  ℘ = ${cnum(w.wp, 3)}\n        ℘′ = ${cnum(w.dwp, 3)}` : `${names[i]}: lattice point -> O (∞)`);
            });
            lines.push('');
            lines.push(m.inv.real && get('torusReal') ? '' : (m.inv.real ? 'Enable "constrain z to the real section" to see the real chord construction.' : 'Values live in C × C: (℘(z), ℘′(z)) lies on y² = 4x³ − g2 x − g3.'));
            paragraph(p, lines.join('\n'), tx, r.y + 56, tw, r.h - 100, pal.fg, 12);
        }
        p.textFont('system-ui, sans-serif');
    }

    function draw(p, pal) {
        const m = model();
        const C = colorsFor(pal.dark);
        p.background(pal.bg);
        p.textFont('system-ui, sans-serif');
        drawLeft(p, pal, C, m);
        drawRight(p, pal, C, m);
        return false;
    }

    function setTau(re, im) {
        env.set('tauRe', re);
        env.set('tauIm', im);
        env.invalidate();
    }

    return {
        layout, draw, press, drag, release,
        setTau,
        applyPreset(id) {
            const pr = TORUS_PRESETS[id];
            if (pr) setTau(pr.re, pr.im);
        },
        setZ(i, u, v) { st.z[i] = [mod1(u), mod1(v)]; env.invalidate(); },
        zPixel(i) { return screenOf(toZ(tau(), st.z[i])); },
        tauPixel() { return screenOf(tau()); },
        getState() {
            const m = model();
            return {
                tau: m.t, g2: m.inv.g2, g3: m.inv.g3, realSection: m.inv.real, z: m.uv, Z: m.Z, W: m.W,
                real: m.real || null, err: m.err, realOk: m.realOk, cubic, negReal,
            };
        },
    };
}
