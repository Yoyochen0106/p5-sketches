// Drawing for the Monge sketch. Everything takes a p5 instance and a prepared `scene`.

import { clipLine, fitLine, PAIRS } from '../../lib/geometry2d.js';
import { niceTicks } from '../approx/view.js';
import { handlePos, PROOF_TEXT, PROOF_STEPS } from './state.js';

export const E_MARKER_D = 11;
export const MONGE_WEIGHT = 2.5;

const PAIR_COLORS = {
    dark: ['#4aa3ff', '#ff9f43', '#2ecc71'],
    light: ['#1565c0', '#d9730d', '#1b8a4b'],
};
const CIRCLE_COLORS = {
    dark: ['#9fb4ff', '#ffb3c7', '#9ee6c0'],
    light: ['#3f51b5', '#c2185b', '#00796b'],
};
const EXTRA_COLORS = {
    dark: ['#c77dff', '#f1c40f', '#1abc9c'],
    light: ['#7b1fa2', '#b58900', '#00897b'],
};
const MONGE_COLORS = { dark: '#ff3b6b', light: '#d6004a' };

export const mongeColor = (dark) => MONGE_COLORS[dark ? 'dark' : 'light'];
export const pairColors = (dark) => PAIR_COLORS[dark ? 'dark' : 'light'];

const okPx = (v) => Number.isFinite(v) && Math.abs(v) < 1e6;

function withAlpha(p, col, a) {
    const c = p.color(col);
    c.setAlpha(a);
    return c;
}

function dashed(p, pattern, fn) {
    p.push();
    if (p.drawingContext && p.drawingContext.setLineDash) p.drawingContext.setLineDash(pattern);
    fn();
    p.pop();
}

/** Draw an infinite world-space line clipped to the view. Returns true if something was drawn. */
function worldLine(p, view, line, margin = 0.02) {
    const mx = (view.xmax - view.xmin) * margin, my = (view.ymax - view.ymin) * margin;
    const seg = clipLine(line, view.xmin - mx, view.xmax + mx, Math.min(view.ymin, view.ymax) - my, Math.max(view.ymin, view.ymax) + my);
    if (!seg) return false;
    const [a, b] = seg;
    const x1 = view.toX(a[0]), y1 = view.toY(a[1]), x2 = view.toX(b[0]), y2 = view.toY(b[1]);
    if (![x1, y1, x2, y2].every(okPx)) return false;
    p.line(x1, y1, x2, y2);
    return true;
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

function drawCones(p, view, scene, cols) {
    const { tangents, data } = scene;
    p.noStroke();
    PAIRS.forEach((_, k) => {
        const e = data.E[k];
        const ext = tangents[k].filter((t) => t.kind === 'external');
        if (!e || ext.length < 2) return;
        const far = (t) => {
            const d1 = Math.hypot(t.p1[0] - e[0], t.p1[1] - e[1]);
            const d2 = Math.hypot(t.p2[0] - e[0], t.p2[1] - e[1]);
            return d1 > d2 ? t.p1 : t.p2;
        };
        const a = far(ext[0]), b = far(ext[1]);
        const pts = [e, a, b].flatMap((q) => [view.toX(q[0]), view.toY(q[1])]);
        if (!pts.every(okPx)) return;
        p.fill(withAlpha(p, cols[k], 34));
        p.triangle(...pts);
    });
}

function drawSphereShade(p, sx, sy, sr, col) {
    p.noStroke();
    for (let k = 0; k < 5; k++) {
        const f = 1 - k * 0.2;
        p.fill(withAlpha(p, col, 22));
        p.circle(sx - sr * 0.3 * (1 - f), sy - sr * 0.3 * (1 - f), 2 * sr * f);
    }
}

function drawCircles(p, view, scene) {
    const { circles, pal, dark, proofStep, proofOn } = scene;
    const cc = CIRCLE_COLORS[dark ? 'dark' : 'light'];
    circles.forEach((c, i) => {
        const sx = view.toX(c.x), sy = view.toY(c.y);
        const sr = (view.toX(c.x + c.r) - sx);
        if (![sx, sy, sr].every(okPx) || sr > 1e6) return;
        p.stroke(cc[i]);
        p.strokeWeight(2);
        p.fill(withAlpha(p, cc[i], 28));
        p.circle(sx, sy, 2 * sr);
        if (proofOn && proofStep >= 2) drawSphereShade(p, sx, sy, sr, cc[i]);
        // centre dot
        p.noStroke();
        p.fill(cc[i]);
        p.circle(sx, sy, 7);
        // radius handle
        const [hx, hy] = handlePos(view, c);
        p.stroke(cc[i]);
        p.strokeWeight(1);
        p.line(sx, sy, hx, hy);
        p.fill(pal.bg);
        p.strokeWeight(2);
        p.square(hx - 5, hy - 5, 10);
        // label
        p.noStroke();
        p.fill(cc[i]);
        p.textAlign(p.LEFT, p.TOP);
        p.textSize(12);
        p.text(`C${i + 1}  r=${c.r.toFixed(2)}`, sx + 8, sy + 6);
    });
}

function drawTangents(p, view, scene, cols) {
    const { tangents, get, pal } = scene;
    PAIRS.forEach((_, k) => {
        const col = cols[k];
        for (const t of tangents[k]) {
            const isExt = t.kind === 'external';
            if (isExt ? !get('showExternal') : !get('showInternal')) continue;
            p.stroke(withAlpha(p, col, isExt ? 230 : 190));
            p.strokeWeight(isExt ? 1.6 : 1.2);
            if (isExt) worldLine(p, view, t.line);
            else dashed(p, [8, 6], () => worldLine(p, view, t.line));
        }
        if (get('showTangentPoints')) {
            p.stroke(pal.bg);
            p.strokeWeight(1);
            p.fill(col);
            for (const t of tangents[k]) {
                if (t.kind === 'external' ? !get('showExternal') : !get('showInternal')) continue;
                for (const q of [t.p1, t.p2]) {
                    const x = view.toX(q[0]), y = view.toY(q[1]);
                    if (okPx(x) && okPx(y)) p.circle(x, y, 6);
                }
            }
        }
    });
}

function arrow(p, x, y, dx, dy, len) {
    const x2 = x + dx * len, y2 = y + dy * len;
    p.line(x, y, x2, y2);
    const h = 9, a = 0.45;
    const ang = Math.atan2(dy, dx);
    p.line(x2, y2, x2 - h * Math.cos(ang - a), y2 - h * Math.sin(ang - a));
    p.line(x2, y2, x2 - h * Math.cos(ang + a), y2 - h * Math.sin(ang + a));
}

function drawHomothetyPoints(p, view, scene, cols) {
    const { data, tangents, circles, pal, get } = scene;
    p.textSize(13);
    PAIRS.forEach(([i, j], k) => {
        const e = data.E[k];
        const name = `E${i + 1}${j + 1}`;
        const hasExt = tangents[k].some((t) => t.kind === 'external');
        if (e) {
            const x = view.toX(e[0]), y = view.toY(e[1]);
            if (!okPx(x) || !okPx(y)) return;
            p.stroke(pal.fg);
            p.strokeWeight(1.5);
            if (hasExt) p.fill(cols[k]); else p.noFill();
            p.circle(x, y, E_MARKER_D);
            p.noStroke();
            p.fill(cols[k]);
            p.textAlign(p.LEFT, p.BOTTOM);
            p.text(name, x + 9, y - 7);
        } else if (data.dir[k]) {
            // external centre at infinity: arrows along the line of centres
            const mx = view.toX((circles[i].x + circles[j].x) / 2), my = view.toY((circles[i].y + circles[j].y) / 2);
            const d = data.dir[k];
            const dx = d[0], dy = -d[1];
            p.stroke(cols[k]);
            p.strokeWeight(2);
            arrow(p, mx, my, dx, dy, 90);
            arrow(p, mx, my, -dx, -dy, 90);
            p.noStroke();
            p.fill(cols[k]);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.text(`${name} at infinity (equal radii)`, mx + dy * 14, my - dx * 14 - 4);
        }
        if (get('showInternalPts') && data.I[k]) {
            const q = data.I[k];
            const x = view.toX(q[0]), y = view.toY(q[1]);
            if (!okPx(x) || !okPx(y)) return;
            p.stroke(cols[k]);
            p.strokeWeight(1.5);
            p.fill(pal.bg);
            p.rectMode(p.CENTER);
            p.square(x, y, 8);
            p.rectMode(p.CORNER);
            p.noStroke();
            p.fill(cols[k]);
            p.textAlign(p.LEFT, p.TOP);
            p.textSize(11);
            p.text(`I${i + 1}${j + 1}`, x + 7, y + 5);
            p.textSize(13);
        }
    });
}

/** Lines through the extra collinear triples, one colour each. */
export function extraLines(triples, dark) {
    const cols = EXTRA_COLORS[dark ? 'dark' : 'light'];
    const out = [];
    triples.slice(1).forEach((t, idx) => {
        if (t.pts.some((q) => !q)) return;
        const f = fitLine(t.pts);
        if (f) out.push({ name: t.name, line: f.line, color: cols[idx] });
    });
    return out;
}

function drawHud(p, scene) {
    const { pal, monge, data, tangents, circles } = scene;
    p.noStroke();
    p.textFont('Consolas, ui-monospace, monospace');
    p.textSize(12);
    p.textAlign(p.LEFT, p.TOP);
    let msg;
    if (monge) {
        msg = data.E.every(Boolean)
            ? `Monge line: collinearity residual ${monge.residual.toExponential(2)}`
            : 'Monge line: one exsimilicenter is at infinity (parallel to the line of centres)';
    } else {
        msg = 'All radii equal: the three exsimilicenters are at infinity (no finite Monge line)';
    }
    p.fill(mongeColor(scene.dark));
    p.text(msg, 14, 12);
    p.fill(pal.muted);
    let y = 30;
    PAIRS.forEach(([i, j], k) => {
        const ext = tangents[k].filter((t) => t.kind === 'external').length;
        const int = tangents[k].length - ext;
        const none = ext === 0 ? '  (no real external tangents; homothety centre is algebraic only)' : '';
        p.fill(scene.cols[k]);
        p.text(`C${i + 1}-C${j + 1}: ${ext} external, ${int} internal${none}`, 14, y);
        y += 16;
    });
    void circles;
}

function drawProof(p, scene) {
    const step = scene.proofStep;
    const s = PROOF_TEXT[step - 1];
    const w = Math.min(p.width - 24, 680), h = 96;
    const x = 12, y = p.height - h - 12;
    const { pal } = scene;
    p.stroke(pal.border);
    p.strokeWeight(1);
    p.fill(withAlpha(p, pal.panel, 235));
    p.rect(x, y, w, h, 8);
    p.noStroke();
    p.fill(pal.fg);
    p.textFont('system-ui, sans-serif');
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(14);
    p.text(`Step ${step}/${PROOF_STEPS}   ${s.title}`, x + 12, y + 10);
    p.fill(pal.muted);
    p.textSize(12.5);
    p.text(s.text, x + 12, y + 32, w - 24, h - 40);
}

/** Draw the whole scene. */
export function drawScene(p, scene) {
    const { view, pal, get } = scene;
    p.background(pal.bg);
    const cols = scene.cols;
    if (get('showGrid')) drawGrid(p, view, pal);
    const proofOn = scene.proofOn;
    if (get('showCones') || proofOn) drawCones(p, view, scene, cols);
    drawCircles(p, view, scene);
    drawTangents(p, view, scene, cols);
    const showLine = !proofOn || scene.proofStep >= 3;
    if (get('showExtra') && showLine) {
        for (const e of scene.extra) {
            p.stroke(e.color);
            p.strokeWeight(1.3);
            dashed(p, [3, 5], () => worldLine(p, view, e.line));
        }
    }
    if (scene.monge && showLine) {
        p.stroke(mongeColor(scene.dark));
        p.strokeWeight(MONGE_WEIGHT);
        worldLine(p, view, scene.monge.line);
    }
    drawHomothetyPoints(p, view, scene, cols);
    drawHud(p, scene);
    if (proofOn) drawProof(p, scene);
}
