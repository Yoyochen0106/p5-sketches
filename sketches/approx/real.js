// Real-line panel: grid, f(x), every enabled approximation, the expansion point,
// convergence band, formula read-out, error strip and the mother-wavelet inset.

import { niceTicks, fmtTick, Viewport } from './view.js';
import { hexToRgb } from './state.js';
import { TypeWriter } from './typewriter.js';
import { motherWavelet, taylorCoefs } from './methods.js';
import { hornerReal } from '../../lib/poly.js';

const FONT = 'Consolas, ui-monospace, Menlo, monospace';
const ERR_LO = -16;
const ERR_HI = 2;
const BIG = 1e7;

/** Run fn with drawing clipped to rect r. Uses push/pop so p5's cached fill/stroke stay in sync. */
export function withClip(p, r, fn) {
    p.push();
    const ctx = p.drawingContext;
    if (ctx && ctx.beginPath) {
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
    }
    try {
        fn();
    } finally {
        p.pop();
    }
}

/** Split the real panel rectangle into the plot area and the optional error strip below it. */
export function splitReal(rect, showError) {
    if (showError && rect.h > 260) {
        const eh = Math.round(rect.h * 0.27);
        return {
            main: { x: rect.x, y: rect.y, w: rect.w, h: rect.h - eh },
            err: { x: rect.x, y: rect.y + rect.h - eh, w: rect.w, h: eh },
        };
    }
    return { main: rect, err: null };
}

function setStroke(p, hex, alpha = 255) {
    const [r, g, b] = hexToRgb(hex.length === 7 ? hex : '#888888');
    p.stroke(r, g, b, alpha);
}

/** Polyline of fn over the viewport's x range; breaks the line at non-finite values and poles. */
export function plotCurve(p, vp, fn, { color, weight = 2, alpha = 255, dash = null }) {
    const r = vp.rect;
    const n = Math.max(2, Math.ceil(r.w));
    p.noFill();
    setStroke(p, color, alpha);
    p.strokeWeight(weight);
    const ctx = p.drawingContext;
    if (dash && ctx && ctx.setLineDash) ctx.setLineDash(dash);
    let open = false;
    let prevPy = 0;
    const jump = r.h * 1.5;
    for (let i = 0; i <= n; i++) {
        const px = r.x + (i * r.w) / n;
        const y = fn(vp.fromX(px));
        const py = vp.toY(y);
        const bad = !Number.isFinite(y) || Math.abs(y) > BIG || !Number.isFinite(py);
        if (bad || (open && Math.abs(py - prevPy) > jump)) {
            if (open) p.endShape();
            open = false;
            if (bad) continue;
        }
        if (!open) {
            p.beginShape();
            open = true;
        }
        p.vertex(px, py);
        prevPy = py;
    }
    if (open) p.endShape();
    if (dash && ctx && ctx.setLineDash) ctx.setLineDash([]);
}

export function drawGrid(p, scene, vp, { labels = true } = {}) {
    const { pal } = scene;
    const r = vp.rect;
    p.textFont(FONT);
    p.textSize(10);
    const xt = niceTicks(vp.xmin, vp.xmax, Math.max(3, r.w / 80));
    const yt = niceTicks(vp.ymin, vp.ymax, Math.max(3, r.h / 50));
    p.strokeWeight(1);
    if (scene.get('showGrid')) {
        p.stroke(pal.grid);
        for (const x of xt) p.line(vp.toX(x), r.y, vp.toX(x), r.y + r.h);
        for (const y of yt) p.line(r.x, vp.toY(y), r.x + r.w, vp.toY(y));
    }
    p.stroke(pal.axis);
    if (vp.ymin < 0 && vp.ymax > 0) p.line(r.x, vp.toY(0), r.x + r.w, vp.toY(0));
    if (vp.xmin < 0 && vp.xmax > 0) p.line(vp.toX(0), r.y, vp.toX(0), r.y + r.h);
    if (labels) {
        p.noStroke();
        p.fill(pal.muted);
        p.textAlign(p.CENTER, p.BOTTOM);
        const ay = Math.min(r.y + r.h - 2, Math.max(r.y + 12, vp.toY(0) + 12));
        for (const x of xt) if (Math.abs(x) > 1e-12) p.text(fmtTick(x), vp.toX(x), ay + 2);
        p.textAlign(p.LEFT, p.CENTER);
        const ax = Math.min(r.x + r.w - 30, Math.max(r.x + 2, vp.toX(0) + 3));
        for (const y of yt) if (Math.abs(y) > 1e-12) p.text(fmtTick(y), ax, vp.toY(y) - 7);
    }
}

function fmtNum(v) {
    return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);
}

function fmtCenter(a) {
    const re = a[0].toFixed(3);
    if (a[1] === 0) return re;
    return `${re} ${a[1] < 0 ? '−' : '+'} ${Math.abs(a[1]).toFixed(3)}i`;
}

function drawReadout(p, scene, rect) {
    const { pal, func, fits, a } = scene;
    p.noStroke();
    p.textFont(FONT);
    p.textSize(13);
    p.textAlign(p.LEFT, p.BASELINE);
    const tw = new TypeWriter(p, rect.x + 10, rect.y + 20, 17);
    p.fill(pal.fg);
    tw.type(`f(x) = ${func.label}`).newline();
    p.fill(pal.muted);
    const fa = a[1] === 0 ? func.f(a[0]) : NaN;
    tw.type(`a = ${fmtCenter(a)}${Number.isFinite(fa) ? `   f(a) = ${fa.toFixed(4)}` : ''}`);
    if (scene.get('lockOn')) tw.type('  \u{1F512}');
    tw.newline();

    const t = fits.taylor;
    if (t) {
        p.fill(t.color);
        const show = Math.min(t.coefs.length, 4);
        for (let k = 0; k < show; k++) {
            const c = t.coefs[k];
            tw.type(k === 0 ? '  ' : '  ');
            tw.type(`${fmtNum(c[0])}`);
            if (k >= 1) tw.type('(x−a)');
            if (k >= 2) tw.sup(String(k));
            tw.newline();
        }
        if (t.coefs.length > show) tw.type('  …').newline();
        const R = scene.radius;
        if (R !== undefined) {
            p.fill(pal.muted);
            tw.type(`R ${Number.isFinite(R) ? '= ' + R.toFixed(3) : '= ∞'}`).newline();
        }
    }
    for (const m of ['pade', 'fourier', 'wavelet', 'interp']) {
        const f = fits[m];
        if (!f) continue;
        p.fill(f.color);
        tw.type(f.info).newline();
        for (const line of f.lines || []) tw.type(`  ${line}`).newline();
    }
}

function drawCenterMarker(p, scene, vp) {
    const { pal, a } = scene;
    const r = vp.rect;
    const px = vp.toX(a[0]);
    setStroke(p, pal.accent, 200);
    p.strokeWeight(1);
    p.line(px, r.y, px, r.y + r.h);
    const fy = scene.func.f(a[0]);
    if (Number.isFinite(fy)) {
        p.fill(pal.accent);
        p.noStroke();
        p.circle(px, vp.toY(fy), 8);
    }
}

function drawRadiusBand(p, scene, vp) {
    const R = scene.radius;
    if (!scene.fits.taylor || !scene.get('showRadius') || R === undefined || !Number.isFinite(R)) return;
    const r = vp.rect;
    const x0 = vp.toX(scene.a[0] - R);
    const x1 = vp.toX(scene.a[0] + R);
    const [cr, cg, cb] = hexToRgb(scene.fits.taylor.color);
    p.noStroke();
    p.fill(cr, cg, cb, 22);
    p.rect(Math.max(r.x, x0), r.y, Math.min(r.x + r.w, x1) - Math.max(r.x, x0), r.h);
    p.stroke(cr, cg, cb, 120);
    p.strokeWeight(1);
    if (x0 > r.x) p.line(x0, r.y, x0, r.y + r.h);
    if (x1 < r.x + r.w) p.line(x1, r.y, x1, r.y + r.h);
}

/** Interpolation nodes as dots lying on f. */
function drawNodes(p, scene, vp) {
    const it = scene.fits.interp;
    if (!it) return;
    const [r, g, b] = hexToRgb(it.color);
    p.stroke(scene.pal.panel);
    p.strokeWeight(1);
    p.fill(r, g, b);
    for (const [x, y] of it.nodes) {
        const px = vp.toX(x);
        const py = vp.toY(y);
        if (Number.isFinite(px) && Number.isFinite(py)) p.circle(px, py, 7);
    }
}

/** Dashed line at the theoretical Gibbs peak (plateau + 8.95 % of the jump) next to the jump. */
function drawGibbsLine(p, scene, vp) {
    const fo = scene.fits.fourier;
    if (!fo || !fo.gibbs || !scene.get('fourier.gibbs')) return;
    const { xj, reach, level } = fo.gibbs;
    const y = vp.toY(level);
    if (!Number.isFinite(y)) return;
    const [r, g, b] = hexToRgb(fo.color);
    p.stroke(r, g, b, 190);
    p.strokeWeight(1);
    const ctx = p.drawingContext;
    if (ctx && ctx.setLineDash) ctx.setLineDash([5, 4]);
    p.line(vp.toX(xj - reach), y, vp.toX(xj + reach), y);
    if (ctx && ctx.setLineDash) ctx.setLineDash([]);
    p.noStroke();
    p.fill(r, g, b);
    p.textFont(FONT);
    p.textSize(10);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text('Gibbs 8.95 %', vp.toX(xj + reach) + 4, y - 2);
}

/** Rectangle of the N gauge (bottom-left of the plot), or null when it is not shown. */
export function gibbsGaugeRect(scene, rect) {
    const fo = scene.fits.fourier;
    if (!fo || !fo.gibbs || !scene.get('fourier.gibbs') || rect.h < 120 || rect.w < 200) return null;
    return { x: rect.x + 10, y: rect.y + rect.h - 34, w: Math.min(240, rect.w * 0.45), h: 14 };
}

export const GAUGE_MAX_N = 128;

/** Map a mouse x on the gauge to a harmonic count N. */
export function gaugeValue(g, mx) {
    return Math.round(Math.max(0, Math.min(1, (mx - g.x) / g.w)) * GAUGE_MAX_N);
}

/** A slider-like gauge marking the current N (click or drag to change it). */
function drawGibbsGauge(p, scene, rect) {
    const g = gibbsGaugeRect(scene, rect);
    if (!g) return;
    const fo = scene.fits.fourier;
    const [r, gg, b] = hexToRgb(fo.color);
    const x = g.x + (Math.min(fo.fit.N, GAUGE_MAX_N) / GAUGE_MAX_N) * g.w;
    p.noStroke();
    p.fill(scene.pal.grid);
    p.rect(g.x, g.y + g.h / 2 - 2, g.w, 4, 2);
    p.fill(r, gg, b);
    p.rect(g.x, g.y + g.h / 2 - 2, x - g.x, 4, 2);
    p.stroke(scene.pal.panel);
    p.circle(x, g.y + g.h / 2, 12);
    p.noStroke();
    p.fill(scene.pal.muted);
    p.textFont(FONT);
    p.textSize(10);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text(`N = ${fo.fit.N}  (drag)   overshoot ${(fo.gibbs.overshoot * 100).toFixed(2)} %`, g.x, g.y - 2);
}

function drawMotherInset(p, scene, rect) {
    const w = scene.fits.wavelet;
    if (!w || !scene.get('wavelet.mother')) return;
    const mw = motherWavelet(scene.env);
    if (!mw || !mw.psi) return;
    const { pal } = scene;
    const bw = Math.min(190, rect.w * 0.4);
    const bh = 90;
    const bx = rect.x + rect.w - bw - 8;
    const by = rect.y + 8;
    p.noStroke();
    p.fill(pal.panel);
    p.rect(bx, by, bw, bh, 4);
    p.noFill();
    p.stroke(pal.border);
    p.rect(bx, by, bw, bh, 4);
    const draw = (ys, color) => {
        if (!ys || !ys.length) return;
        let m = 0;
        for (const v of ys) m = Math.max(m, Math.abs(v));
        if (!(m > 0)) return;
        setStroke(p, color, 230);
        p.strokeWeight(1.5);
        p.noFill();
        p.beginShape();
        for (let i = 0; i < ys.length; i++) {
            p.vertex(bx + 6 + (i / (ys.length - 1)) * (bw - 12), by + bh / 2 - (ys[i] / m) * (bh / 2 - 14));
        }
        p.endShape();
    };
    draw(mw.phi, pal.muted);
    draw(mw.psi, w.color);
    p.noStroke();
    p.fill(pal.muted);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.text(`${mw.family.id}:  φ (grey)  ψ`, bx + 6, by + 3);
}

function drawErrorStrip(p, scene, vp, rect) {
    const { pal, func, fits, env } = scene;
    const ev = new Viewport(vp.xmin, vp.xmax, ERR_LO, ERR_HI).setRect(rect.x, rect.y, rect.w, rect.h);
    p.noStroke();
    p.fill(pal.panel);
    p.rect(rect.x, rect.y, rect.w, rect.h);
    withClip(p, rect, () => {
        p.textFont(FONT);
        p.textSize(10);
        p.strokeWeight(1);
        p.stroke(pal.grid);
        for (let e = -16; e <= 2; e += 4) p.line(rect.x, ev.toY(e), rect.x + rect.w, ev.toY(e));
        for (const m of ['taylor', 'pade', 'fourier', 'wavelet', 'interp']) {
            const f = fits[m];
            if (!f) continue;
            plotCurve(p, ev, (x) => Math.log10(Math.abs(func.f(x) - f.real(x)) + 1e-17), { color: f.color, weight: 1.5 });
        }
        const t = fits.taylor;
        if (t && func.analytic) {
            const c = taylorCoefs(env, t.order + 1)[t.order + 1];
            const mag = Math.hypot(c[0], c[1]);
            if (mag > 0) {
                const l = Math.log10(mag);
                plotCurve(p, ev, (x) => l + (t.order + 1) * Math.log10(Math.abs(x - scene.a[0]) + 1e-300), {
                    color: t.color, weight: 1, alpha: 150, dash: [4, 4],
                });
            }
        }
    });
    p.noStroke();
    p.fill(pal.muted);
    p.textFont(FONT);
    p.textSize(10);
    p.textAlign(p.LEFT, p.TOP);
    p.text('log₁₀ |f − approx|   (dashed: next Taylor term)', rect.x + 6, rect.y + 3);
    p.textAlign(p.RIGHT, p.CENTER);
    for (let e = -12; e <= 0; e += 4) p.text(String(e), rect.x + rect.w - 4, ev.toY(e) - 6);
    const px = ev.toX(scene.a[0]);
    setStroke(p, pal.accent, 160);
    p.line(px, rect.y, px, rect.y + rect.h);
}

/** Draws the real panel: plot area = vp.rect, optional error strip = errRect. */
export function drawRealPanel(p, scene, vp, errRect = null) {
    const { pal, func, fits } = scene;
    const main = vp.rect;

    p.noStroke();
    p.fill(pal.panel);
    p.rect(main.x, main.y, main.w, main.h);

    withClip(p, main, () => {
        drawGrid(p, scene, vp);
        drawRadiusBand(p, scene, vp);
        const t = fits.taylor;
        if (t && scene.get('taylor.ghosts') && t.order > 0) {
            const stride = Math.ceil(t.order / 12);
            for (let k = 0; k < t.order; k += stride) {
                const sub = t.coefs.slice(0, k + 1);
                const alpha = 30 + 70 * (k / t.order);
                plotCurve(p, vp, (x) => hornerReal(sub, x - scene.a[0]), { color: t.color, weight: 1, alpha });
            }
        }
        plotCurve(p, vp, func.f, { color: pal.fg, weight: 2 });
        const cmp = fits.interp && fits.interp.compare;
        if (cmp) plotCurve(p, vp, cmp.real, { color: pal.muted, weight: 1.3, dash: [5, 4] });
        for (const m of ['wavelet', 'fourier', 'pade', 'taylor', 'interp']) {
            const f = fits[m];
            if (f) plotCurve(p, vp, f.real, { color: f.color, weight: 2.2 });
        }
        drawGibbsLine(p, scene, vp);
        drawNodes(p, scene, vp);
        drawCenterMarker(p, scene, vp);
    });
    drawReadout(p, scene, main);
    drawGibbsGauge(p, scene, main);
    drawMotherInset(p, scene, main);
    p.noFill();
    p.stroke(pal.border);
    p.rect(main.x, main.y, main.w, main.h);

    if (errRect) {
        drawErrorStrip(p, scene, vp, errRect);
        p.noFill();
        p.stroke(pal.border);
        p.rect(errRect.x, errRect.y, errRect.w, errRect.h);
    }
    return { main, errRect };
}
