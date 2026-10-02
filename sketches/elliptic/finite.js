// FINITE FIELD tab: the points of y^2 = x^3 + a x + b over F_p on the p x p grid, multiples nP,
// P + Q with the wrapped chord, group order / Hasse bound, subgroup structure and a discrete-log puzzle.

import {
    INF, isInf, mod, isPrime, curveFp, isSingularFp, pointsFp, groupStructureFp, hasseInterval, hasseOk,
    addFp, negFp, scalarMulFp, multiplesFp, lineDotsFp, onCurveFp,
} from '../../lib/elliptic.js';
import { colorsFor, withAlpha, dashed, arrow, label, dot, paragraph, mixHex, dist2, num } from './draw-util.js';
import { FINITE_PRESETS, clamp, randInt } from './state.js';

const keyOf = (P) => `${P.x},${P.y}`;
const same = (A, B) => (isInf(A) ? isInf(B) : !isInf(B) && A.x === B.x && A.y === B.y);
const fmtPt = (P) => (isInf(P) ? 'O' : `(${P.x}, ${P.y})`);

/** Create the finite-field tab. env: { get, set, invalidate }. */
export function createFiniteTab(env) {
    const get = env.get;
    const st = {
        P: null, Q: null, slot: null, puzzle: null, msg: '', size: { w: 800, h: 600 },
        grid: { x: 10, y: 10, s: 400, cell: 4 }, panel: { x: 420, y: 10, w: 300, h: 500 },
        cache: null,
    };

    function currentP() {
        const p = Math.round(get('p'));
        return isPrime(p) && p >= 5 ? p : 97;
    }

    /** Curve data, recomputed only when (p, a, b) change. */
    function data() {
        const p = currentP();
        const a = mod(Math.round(get('fa')), p), b = mod(Math.round(get('fb')), p);
        const key = `${p},${a},${b}`;
        if (st.cache && st.cache.key === key) return st.cache;
        const c = curveFp(a, b, p);
        const pts = pointsFp(c);
        const singular = isSingularFp(c);
        const N = pts.length + 1;
        const d = { key, c, p, a, b, pts, singular, N, set: new Set(pts.map(keyOf)) };
        if (!singular) {
            d.structure = groupStructureFp(c, pts);
            d.gens = pts.filter((P) => d.structure.orders.get(keyOf(P)) === N);
        } else {
            d.structure = null;
            d.gens = [];
        }
        st.cache = d;
        for (const k of ['P', 'Q']) if (st[k] && !onCurveFp(c, st[k])) st[k] = null;
        if (st.puzzle && !onCurveFp(c, st.puzzle.G)) st.puzzle = null;
        return d;
    }

    const orderOf = (d, P) => (isInf(P) ? 1 : d.structure ? d.structure.orders.get(keyOf(P)) : null);

    function layout(w, h) {
        st.size = { w, h };
        const p = currentP();
        if (w >= h * 1.25) {
            const s = Math.max(120, Math.min(h - 24, w * 0.58));
            st.grid = { x: 12, y: 12, s, cell: s / p };
            st.panel = { x: s + 28, y: 12, w: Math.max(100, w - s - 40), h: h - 24 };
        } else {
            const s = Math.max(120, Math.min(w - 24, h * 0.56));
            st.grid = { x: (w - s) / 2, y: 10, s, cell: s / p };
            st.panel = { x: 12, y: s + 22, w: w - 24, h: Math.max(60, h - s - 30) };
        }
    }

    const gx = (x) => st.grid.x + (x + 0.5) * st.grid.cell;
    const gy = (y) => st.grid.y + st.grid.s - (y + 0.5) * st.grid.cell;

    /** Nearest curve point to a pixel, within ~14 px. */
    function pick(px, py) {
        const d = data();
        const { cell, x: x0, y: y0, s } = st.grid;
        const cx = Math.floor((px - x0) / cell), cy = Math.floor((y0 + s - py) / cell);
        const rad = Math.min(d.p, Math.ceil(14 / cell) + 1);
        let best = null, bd = 14;
        for (let x = Math.max(0, cx - rad); x <= Math.min(d.p - 1, cx + rad); x++) {
            for (let y = Math.max(0, cy - rad); y <= Math.min(d.p - 1, cy + rad); y++) {
                if (!d.set.has(`${x},${y}`)) continue;
                const dd = dist2(px, py, gx(x), gy(y));
                if (dd < bd) { bd = dd; best = { x, y }; }
            }
        }
        return best;
    }

    const inGrid = (px, py) => px >= st.grid.x && px <= st.grid.x + st.grid.s && py >= st.grid.y && py <= st.grid.y + st.grid.s;

    function assign(slot, P) {
        st[slot] = P;
        env.invalidate();
    }

    function selectNext(P) {
        if (!st.P) { st.slot = 'P'; assign('P', P); } else if (!st.Q) { st.slot = 'Q'; assign('Q', P); } else {
            st.slot = 'P';
            st.Q = null;
            assign('P', P);
        }
    }

    function press(px, py) {
        if (!inGrid(px, py)) return false;
        const P = pick(px, py);
        if (P) selectNext(P);
        return true;
    }

    function drag(px, py) {
        if (!st.slot) return;
        const P = pick(px, py);
        if (P) assign(st.slot, P);
    }

    function release() {
        const had = !!st.slot;
        st.slot = null;
        return had;
    }

    // ---------- drawing ----------
    function drawGrid(p, pal, C, d) {
        const { x, y, s, cell } = st.grid;
        p.stroke(pal.border);
        p.strokeWeight(1);
        p.fill(withAlpha(p, pal.panel, 255));
        p.rect(x, y, s, s);
        if (cell >= 9) {
            p.stroke(pal.grid);
            for (let i = 1; i < d.p; i++) {
                p.line(x + i * cell, y, x + i * cell, y + s);
                p.line(x, y + i * cell, x + s, y + i * cell);
            }
        }
        p.noStroke();
        p.fill(pal.muted);
        p.textSize(10);
        p.textAlign(p.CENTER, p.TOP);
        p.text('0', gx(0), y + s + 2);
        p.text(String(d.p - 1), gx(d.p - 1), y + s + 2);
        p.textAlign(p.RIGHT, p.CENTER);
        p.text('0', x - 3, gy(0));
        p.text(String(d.p - 1), x - 3, gy(d.p - 1));
        if (get('ffMirror')) {
            const my = y + s - (d.p / 2) * cell;
            p.stroke(withAlpha(p, pal.axis, 200));
            p.strokeWeight(1);
            dashed(p, [6, 5], () => p.line(x, my, x + s, my));
            label(p, 'y ↔ −y  (mod p)', x + 5, my - 14, pal.muted, 10);
        }
    }

    function drawPoints(p, pal, C, d) {
        const w = clamp(st.grid.cell * 0.7, 2.5, 10);
        p.stroke(C.curve);
        p.strokeWeight(w);
        for (const P of d.pts) p.point(gx(P.x), gy(P.y));
    }

    function drawMultiples(p, pal, C, d) {
        if (!st.P || !get('ffMults') || d.singular) return;
        const mult = multiplesFp(d.c, st.P);
        const ord = mult.length;
        const dia = clamp(st.grid.cell * 0.95, 6, 15);
        if (get('ffArrows') && ord <= 24 && ord > 1) {
            p.stroke(withAlpha(p, C.trail, 170));
            p.strokeWeight(1.3);
            for (let i = 0; i < ord - 1; i++) {
                const A = mult[i].point, B = mult[i + 1].point;
                if (isInf(A) || isInf(B)) continue;
                arrow(p, gx(A.x), gy(A.y), gx(B.x), gy(B.y), 7);
            }
        }
        mult.forEach((m, i) => {
            if (isInf(m.point)) return;
            const col = mixHex(C.P, C.trail, ord > 1 ? i / (ord - 1) : 0);
            dot(p, gx(m.point.x), gy(m.point.y), dia, withAlpha(p, col, 215), null);
            if (ord <= 40 && st.grid.cell >= 9) label(p, String(m.n), gx(m.point.x) + dia / 2, gy(m.point.y) - dia, pal.fg, 10);
        });
    }

    function drawSelection(p, pal, C, d, sum) {
        const mark = (P, col, nm, filled) => {
            if (!P || isInf(P)) return;
            const x = gx(P.x), y = gy(P.y);
            dot(p, x, y, 15, filled ? col : null, col, 2.5);
            label(p, nm, x + 9, y - 20, col, 13);
        };
        if (st.P && !d.singular) {
            const n = negFp(d.c, st.P);
            p.stroke(withAlpha(p, pal.axis, 160));
            p.strokeWeight(1);
            dashed(p, [3, 4], () => p.line(gx(st.P.x), gy(st.P.y), gx(n.x), gy(n.y)));
        }
        if (sum && get('ffWrap') && sum.line) {
            const dots = lineDotsFp(sum.line, d.p);
            const sz = clamp(st.grid.cell * 0.45, 2, 5);
            p.noStroke();
            p.fill(withAlpha(p, C.wrap, 170));
            for (const [x, y] of dots) p.rect(gx(x) - sz / 2, gy(y) - sz / 2, sz, sz);
        }
        if (sum && !isInf(sum.third)) {
            p.stroke(withAlpha(p, C.third, 200));
            p.strokeWeight(1.5);
            dashed(p, [4, 4], () => p.line(gx(sum.third.x), gy(sum.third.y), gx(sum.result.x), gy(sum.result.y)));
        }
        mark(sum && sum.third, C.third, 'R′', false);
        mark(sum && sum.result, C.R, 'P+Q', true);
        mark(st.P, C.P, 'P', true);
        mark(st.Q, C.Q, 'Q', true);
        if (st.puzzle) {
            mark(st.puzzle.G, C.torsion, 'G', false);
            mark(st.puzzle.Q, C.R, 'kG', false);
        }
    }

    function drawHasse(p, pal, C, d, y) {
        const { x, w } = st.panel;
        const [lo, hi] = hasseInterval(d.p);
        const s2 = 2 * Math.sqrt(d.p), pad = s2 * 0.35;
        const a = d.p + 1 - s2 - pad, b = d.p + 1 + s2 + pad;
        const X = (v) => x + 8 + ((v - a) / (b - a)) * (w - 16);
        p.stroke(pal.axis);
        p.strokeWeight(1);
        p.line(X(a), y + 12, X(b), y + 12);
        p.noStroke();
        p.fill(withAlpha(p, C.curve, 90));
        p.rect(X(d.p + 1 - s2), y + 5, X(d.p + 1 + s2) - X(d.p + 1 - s2), 14);
        p.stroke(pal.fg);
        p.line(X(d.p + 1), y + 2, X(d.p + 1), y + 22);
        const ok = hasseOk(d.N, d.p);
        dot(p, X(d.N), y + 12, 11, ok ? C.Q : C.R, pal.fg, 1.5);
        label(p, `${lo}`, X(d.p + 1 - s2), y + 24, pal.muted, 9);
        label(p, `${hi}`, X(d.p + 1 + s2) - 18, y + 24, pal.muted, 9);
        label(p, `p+1=${d.p + 1}`, X(d.p + 1) - 18, y - 11, pal.muted, 9);
    }

    function drawPanel(p, pal, C, d, sum) {
        const { x, y: y0, w } = st.panel;
        p.textFont('Consolas, ui-monospace, monospace');
        let y = y0;
        const line = (str, col, size = 12) => {
            p.textSize(size);
            const lines = Math.max(1, Math.ceil(p.textWidth(str) / Math.max(40, w)));
            paragraph(p, str, x, y, w, lines * (size + 4), col, size);
            y += lines * (size + 4) + 2;
        };
        line(`y² = x³ + ${d.a}x + ${d.b}   over F_${d.p}`, pal.fg, 13);
        if (d.singular) {
            line('4a³ + 27b² ≡ 0 (mod p): the curve is singular, so the points do not form a group. Change a or b.', C.R);
            line(`${d.pts.length} affine points`, pal.muted);
            return y;
        }
        line(`#E(F_p) = ${d.N}  (${d.pts.length} affine points + O)`, pal.fg);
        const [lo, hi] = hasseInterval(d.p);
        line(`Hasse: |#E − (p+1)| ≤ 2√p  ⇒  #E ∈ [${lo}, ${hi}] ${hasseOk(d.N, d.p) ? '✓' : '✗'}`, pal.muted, 11);
        y += 6;
        drawHasse(p, pal, C, d, y + 10);
        y += 46;
        const [n1, n2] = d.structure.invariants;
        line(d.structure.cyclic ? `E(F_p) ≅ Z_${d.N}  (cyclic, ${d.gens.length} generators)` : `E(F_p) ≅ Z_${n1} × Z_${n2}  (not cyclic: no generator)`, pal.fg);
        if (st.P) {
            const o = orderOf(d, st.P);
            line(`P = ${fmtPt(st.P)}   ord(P) = ${o}${o === d.N ? '  (generator)' : ''}`, C.P);
            line(`⟨P⟩ has ${o} elements, index ${d.N / o} in E; ord(P) divides ${d.N}`, pal.muted, 11);
        } else {
            line('Click a point for P, then another for Q.', pal.muted);
        }
        if (st.Q) line(`Q = ${fmtPt(st.Q)}   ord(Q) = ${orderOf(d, st.Q)}`, C.Q);
        if (sum) {
            line(`P + Q = ${fmtPt(sum.result)}   (${sum.kind})`, C.R);
            if (sum.line && sum.line.type === 'slope') line(`line: y ≡ ${sum.line.m}·x + ${sum.line.c} (mod ${d.p}) -> R′ = ${fmtPt(sum.third)}`, C.line, 11);
            else if (sum.line) line(`vertical line x = ${sum.line.x}: P = −Q so P + Q = O`, C.line, 11);
        }
        if (st.puzzle) {
            const pz = st.puzzle;
            line(`Discrete log: G = ${fmtPt(pz.G)} (order ${pz.ord}), kG = ${fmtPt(pz.Q)}. Find k.`, C.torsion);
            if (pz.revealed) line(`k = ${pz.k} (mod ${pz.ord})`, C.Q);
        }
        if (st.msg) line(st.msg, pal.fg, 11);
        return y;
    }

    function draw(p, pal) {
        const d = data();
        if (Math.abs(st.grid.cell * d.p - st.grid.s) > 1e-6) layout(st.size.w, st.size.h);
        const C = colorsFor(pal.dark);
        p.background(pal.bg);
        p.textFont('system-ui, sans-serif');
        drawGrid(p, pal, C, d);
        drawPoints(p, pal, C, d);
        drawMultiples(p, pal, C, d);
        const sum = st.P && st.Q && !d.singular ? addFp(d.c, st.P, st.Q) : null;
        drawSelection(p, pal, C, d, sum);
        drawPanel(p, pal, C, d, sum);
        return false;
    }

    // ---------- actions ----------
    function applyPreset(id) {
        const pr = FINITE_PRESETS[id];
        if (!pr) return;
        env.set('p', pr.p);
        env.set('fa', pr.a);
        env.set('fb', pr.b);
        st.cache = null;
        const d = data();
        st.Q = null;
        st.puzzle = null;
        st.msg = '';
        const cand = pr.P && { x: pr.P[0], y: pr.P[1] };
        st.P = cand && onCurveFp(d.c, cand) ? cand : d.pts[Math.floor(d.pts.length / 3)] || null;
        env.invalidate();
    }

    function randomCurve(rnd = Math.random) {
        const p = currentP();
        const hi = Math.min(p - 1, 100); // the a / b sliders go up to 100
        for (let i = 0; i < 200; i++) {
            const a = randInt(0, hi, rnd), b = randInt(0, hi, rnd);
            if (!isSingularFp(curveFp(a, b, p))) {
                env.set('fa', a);
                env.set('fb', b);
                st.msg = '';
                env.invalidate();
                return;
            }
        }
    }

    function findGenerator() {
        const d = data();
        if (d.singular) return;
        if (d.gens.length) {
            st.P = d.gens[0];
            st.msg = `${d.gens.length} generators; P set to one of them (order ${d.N}).`;
        } else {
            let best = d.pts[0], bo = 0;
            for (const P of d.pts) {
                const o = orderOf(d, P);
                if (o > bo) { bo = o; best = P; }
            }
            st.P = best || null;
            st.msg = `No generator: E ≅ Z_${d.structure.invariants[0]} × Z_${d.structure.invariants[1]}. P set to a point of maximal order ${bo}.`;
        }
        st.Q = null;
        env.invalidate();
    }

    function randomPoint(rnd = Math.random) {
        const d = data();
        if (!d.pts.length) return;
        st.P = d.pts[Math.floor(rnd() * d.pts.length)];
        st.Q = null;
        env.invalidate();
    }

    function newPuzzle(rnd = Math.random) {
        const d = data();
        if (d.singular || !d.pts.length) { st.msg = 'Pick a non-singular curve first.'; env.invalidate(); return; }
        let G = d.gens[0];
        if (!G) {
            let bo = 0;
            for (const P of d.pts) { const o = orderOf(d, P); if (o > bo) { bo = o; G = P; } }
        }
        if (st.P && orderOf(d, st.P) >= 5) G = st.P;
        const ord = orderOf(d, G);
        if (ord < 4) { st.msg = 'The group is too small for a puzzle: choose a larger p.'; env.invalidate(); return; }
        const k = 2 + Math.floor(rnd() * (ord - 2));
        st.puzzle = { G, k, ord, Q: scalarMulFp(d.c, G, k).result, revealed: false };
        env.set('guess', 1);
        st.msg = `Find k in [2, ${ord - 1}] with kG = ${fmtPt(st.puzzle.Q)}. Use the guess slider, then Check.`;
        env.invalidate();
    }

    function checkGuess() {
        const d = data();
        const pz = st.puzzle;
        if (!pz) { st.msg = 'Start a puzzle first.'; env.invalidate(); return false; }
        const g = Math.round(get('guess'));
        const R = scalarMulFp(d.c, pz.G, g).result;
        const ok = same(R, pz.Q);
        st.msg = ok ? `Correct: ${g}G = ${fmtPt(R)} = kG.` : `${g}G = ${fmtPt(R)}, not ${fmtPt(pz.Q)}. Try again.`;
        env.invalidate();
        return ok;
    }

    function reveal() {
        if (!st.puzzle) return;
        st.puzzle.revealed = true;
        st.msg = `Revealed: k = ${st.puzzle.k}. Brute force needs up to ${st.puzzle.ord} additions; real curves have ~2^256.`;
        env.invalidate();
    }

    return {
        layout, draw, press, drag, release,
        applyPreset, randomCurve, findGenerator, randomPoint, newPuzzle, checkGuess, reveal,
        clearSelection() { st.P = null; st.Q = null; env.invalidate(); },
        qIsP() { if (st.P) { st.Q = st.P; env.invalidate(); } },
        qIsNegP() { if (st.P) { st.Q = negFp(data().c, st.P); env.invalidate(); } },
        setSelection(P, Q) { st.P = P || null; st.Q = Q || null; env.invalidate(); },
        pointPixel: (P) => [gx(P.x), gy(P.y)],
        getState() {
            const d = data();
            const sum = st.P && st.Q && !d.singular ? addFp(d.c, st.P, st.Q) : null;
            const [lo, hi] = hasseInterval(d.p);
            return {
                p: d.p, a: d.a, b: d.b, curve: d.c, points: d.pts, N: d.N, singular: d.singular,
                structure: d.structure, generators: d.gens, P: st.P, Q: st.Q, sum,
                orderP: st.P && !d.singular ? orderOf(d, st.P) : null,
                hasse: [lo, hi], hasseOk: hasseOk(d.N, d.p), puzzle: st.puzzle, msg: st.msg, grid: st.grid, INF, num,
            };
        },
    };
}
