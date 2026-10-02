// Rendering for the Conformal Maps sketch: two linked panels (domain z, image w = F(z)).
// All maths comes from lib/conformal.js; this file only turns it into p5 calls.

import * as C from '../../lib/complex.js';
import { domainColor, renderField } from '../../lib/domaincolor.js';
import {
    sampleCurve, gridLines, breakPolyline, angleBetweenImages, circleImage, crossRatio, joukowskiStreamline,
} from '../../lib/conformal.js';
import { niceTicks, fmtTick } from '../approx/view.js';

const FONT = 'Consolas, ui-monospace, Menlo, monospace';
export const FAMILY_COLORS = ['#ff9f43', '#4aa3ff'];
const STREAM = '#2ecc71';
const BG_BLOCK = 4;

const f4 = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-4) ? v.toExponential(3) : v.toFixed(4)) : 'undefined');
const fc = (z) => (z && Number.isFinite(z[0]) && Number.isFinite(z[1]) ? `${f4(z[0])} ${z[1] < 0 ? '-' : '+'} ${f4(Math.abs(z[1]))}i` : 'undefined');
const deg = (r) => (r * 180) / Math.PI;

const viewKey = (v) => [v.xmin, v.xmax, v.ymin, v.ymax].map((n) => n.toPrecision(7)).join(',');
const boxOf = (vp) => ({ xmin: vp.xmin, xmax: vp.xmax, ymin: vp.ymin, ymax: vp.ymax });

function clip(p, r, fn) {
    p.push();
    const ctx = p.drawingContext;
    if (ctx && ctx.beginPath) {
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
    }
    try { fn(); } finally { p.pop(); }
}

function polyline(p, vp, pts, close = false) {
    p.beginShape();
    for (const q of pts) p.vertex(vp.toX(q[0]), vp.toY(q[1]));
    p.endShape(close ? p.CLOSE : undefined);
}

/** Quantities shown in the readouts (also used by tests). */
export function computeProbe(F, z0, rho) {
    const w0 = F.f(z0);
    const d = F.df(z0);
    const mag = C.abs(d);
    const ok = Number.isFinite(mag);
    const critical = ok && mag < 1e-6;
    const h = 1e-5;
    const ang = angleBetweenImages(F.f, z0, [1, 0], [0, 1], h);
    const ci = circleImage(F.f, z0, rho);
    return {
        z0, w0, d, mag: ok ? mag : NaN, rot: ok && mag > 0 ? C.arg(d) : NaN, critical,
        angle: ang, angleErr: Number.isFinite(ang) ? Math.abs(ang - Math.PI / 2) : NaN,
        roundness: ci.roundness, circle: ci,
    };
}

/** Domain-colouring background, cached by `key` (only the inputs it depends on). */
function backgroundImage(p, st, slot, key, rect, paint) {
    const w = Math.max(2, Math.ceil(rect.w / BG_BLOCK));
    const h = Math.max(2, Math.ceil(rect.h / BG_BLOCK));
    const cur = st.bg[slot];
    const fullKey = `${key}|${w}x${h}`;
    if (cur && cur.key === fullKey) return cur.img;
    const img = cur && cur.img && cur.img.width === w && cur.img.height === h ? cur.img : p.createImage(w, h);
    const buf = paint(w, h);
    img.loadPixels();
    if (img.pixels.set) img.pixels.set(buf);
    else for (let i = 0; i < buf.length; i++) img.pixels[i] = buf[i];
    img.updatePixels();
    st.bg[slot] = { key: fullKey, img };
    return img;
}

function drawAxes(p, S, vp) {
    const { pal } = S;
    const r = vp.rect;
    p.textFont(FONT);
    p.textSize(10);
    p.strokeWeight(1);
    p.stroke(pal.axis);
    if (vp.ymin < 0 && vp.ymax > 0) p.line(r.x, vp.toY(0), r.x + r.w, vp.toY(0));
    if (vp.xmin < 0 && vp.xmax > 0) p.line(vp.toX(0), r.y, vp.toX(0), r.y + r.h);
    p.noStroke();
    p.fill(pal.muted);
    p.textAlign(p.CENTER, p.BOTTOM);
    for (const x of niceTicks(vp.xmin, vp.xmax, 6)) if (x !== 0) p.text(fmtTick(x), vp.toX(x), r.y + r.h - 2);
    p.textAlign(p.LEFT, p.CENTER);
    for (const y of niceTicks(vp.ymin, vp.ymax, 5)) if (y !== 0) p.text(fmtTick(y), r.x + 3, vp.toY(y));
}

/** Curves (grid, region, extras) for one panel; cached by the inputs they depend on. */
function panelGeometry(S, which) {
    const { st, map, get } = S;
    const vp = which === 'dom' ? S.dom.view : S.img.view;
    const apply = which === 'dom' ? (z) => z : S.F.f;
    const dv = S.dom.view;
    const dep = which === 'dom' ? '' : `|${viewKey(S.img.view)}|${map.sig}|${S.t.toFixed(4)}`;
    const key = [which, get('grid'), get('density'), get('region'), viewKey(dv), dep, S.extrasKey].join('|');
    const cached = st.geo[which];
    if (cached && cached.key === key) return cached;
    const box = boxOf(vp);
    const geo = { key, grid: [], region: null, extras: [] };
    const kind = get('grid');
    if (kind !== 'none') {
        for (const line of gridLines(kind, get('density'), boxOf(dv))) {
            for (const pl of sampleCurve((t) => apply(line.at(t)), line.t0, line.t1, { box })) geo.grid.push({ fam: line.fam, pl });
        }
    }
    const region = regionBoundary(get('region'), boxOf(dv));
    if (region) {
        const pls = sampleCurve((t) => apply(region.at(t)), 0, region.n, { box, n: 24 * region.n });
        geo.region = { pls, fill: pls.length === 1 };
    }
    for (const ex of S.extras) {
        for (const pl of sampleCurve((t) => apply(ex.at(t)), 0, 1, { box })) geo.extras.push({ ...ex, pl });
    }
    st.geo[which] = geo;
    return geo;
}

/** Closed boundary of the selected region, parameter t in [0, n] (n straight edges or one circle). */
function regionBoundary(kind, v) {
    if (kind === 'disk') return { n: 1, at: (t) => [Math.cos(2 * Math.PI * t), Math.sin(2 * Math.PI * t)] };
    let y0 = 0;
    let y1 = v.ymax;
    if (kind === 'strip') y1 = Math.min(v.ymax, Math.PI);
    else if (kind !== 'half') return null;
    if (!(y1 > y0)) return null;
    const pts = [[v.xmin, y0], [v.xmax, y0], [v.xmax, y1], [v.xmin, y1]];
    return {
        n: 4,
        at: (t) => {
            const i = Math.min(3, Math.floor(t));
            const a = pts[i];
            const b = pts[(i + 1) % 4];
            const u = t - i;
            return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
        },
    };
}

function dashedLine(p, vp, a, b, n = 24) {
    for (let i = 0; i < n; i += 2) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        p.line(vp.toX(a[0] + (b[0] - a[0]) * u0), vp.toY(a[1] + (b[1] - a[1]) * u0),
            vp.toX(a[0] + (b[0] - a[0]) * u1), vp.toY(a[1] + (b[1] - a[1]) * u1));
    }
}

function rightAngle(p, x, y, ux, uy, size) {
    // ux, uy: unit vector in pixel space of the first arm; the second arm is rotated by +90 degrees
    const vx = -uy;
    const vy = ux;
    p.noFill();
    p.beginShape();
    p.vertex(x + ux * size, y + uy * size);
    p.vertex(x + (ux + vx) * size, y + (uy + vy) * size);
    p.vertex(x + vx * size, y + vy * size);
    p.endShape();
}

function drawHandles(p, S, which) {
    const vp = which === 'dom' ? S.dom.view : S.img.view;
    p.textFont(FONT);
    p.textSize(11);
    for (const h of S.handles) {
        if (h.panel !== which) continue;
        const x = vp.toX(h.z[0]);
        const y = vp.toY(h.z[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        p.stroke(h.color);
        p.strokeWeight(2);
        if (h.shape === 'square') {
            p.noFill();
            p.rect(x - 5, y - 5, 10, 10);
        } else {
            p.fill(h.color);
            p.circle(x, y, 10);
        }
        if (h.label) {
            p.noStroke();
            p.fill(S.pal.fg);
            p.textAlign(p.LEFT, p.BOTTOM);
            p.text(h.label, x + 8, y - 6);
        }
    }
}

function drawMarkers(p, S, which) {
    const vp = which === 'dom' ? S.dom.view : S.img.view;
    const { map } = S;
    const pal = S.pal;
    const full = S.t >= 1;
    const place = (z) => (which === 'dom' ? z : S.F.f(z));
    p.strokeWeight(1.5);
    if (full) {
        p.stroke(pal.accent);
        p.noFill();
        for (const c of map.critical) {
            const q = place(c);
            if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
            const x = vp.toX(q[0]);
            const y = vp.toY(q[1]);
            p.quad(x, y - 6, x + 6, y, x, y + 6, x - 6, y);
        }
    }
    if (which === 'dom') {
        p.stroke(pal.muted);
        p.noFill();
        for (const c of map.special) p.circle(vp.toX(c[0]), vp.toY(c[1]), 9);
        if (map.cut) {
            p.stroke('#ff6b6b');
            p.strokeWeight(2);
            dashedLine(p, vp, [Math.min(vp.xmin, -1e-6), 0], [0, 0]);
        }
    }
}

function drawProbe(p, S, which) {
    const vp = which === 'dom' ? S.dom.view : S.img.view;
    const { probe: pr, rho, pal } = S;
    const arm = rho * 1.9;
    const F = S.F.f;
    p.noFill();
    p.strokeWeight(1.5);
    // image of the small circle (or the circle itself in the domain)
    p.stroke(pal.fg);
    if (which === 'dom') {
        polyline(p, vp, Array.from({ length: 48 }, (_, k) => C.add(pr.z0, C.fromPolar(rho, (2 * Math.PI * k) / 48))), true);
    } else if (pr.circle.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) {
        polyline(p, vp, pr.circle.pts, true);
    }
    // the two tangent vectors (horizontal: Im = const, vertical: Re = const)
    const dirs = [[1, 0, 1], [0, 1, 0]];
    for (const [dx, dy, fam] of dirs) {
        p.stroke(FAMILY_COLORS[fam]);
        p.strokeWeight(2);
        const pts = [];
        for (let k = -4; k <= 4; k++) {
            const q = C.add(pr.z0, [dx * arm * (k / 4), dy * arm * (k / 4)]);
            pts.push(which === 'dom' ? q : F(q));
        }
        for (const seg of breakPolyline(pts, Infinity, 1e9)) polyline(p, vp, seg);
    }
    // right-angle marker between the (images of the) tangent vectors
    const cz = which === 'dom' ? pr.z0 : pr.w0;
    if (!Number.isFinite(cz[0]) || !Number.isFinite(cz[1])) return;
    let u = [1, 0];
    if (which === 'img') {
        if (!(pr.mag > 1e-9)) return;
        u = [pr.d[0] / pr.mag, pr.d[1] / pr.mag];
    }
    p.stroke(pal.fg);
    p.strokeWeight(1);
    rightAngle(p, vp.toX(cz[0]), vp.toY(cz[1]), u[0], -u[1], 9);
    // point
    p.noStroke();
    p.fill(pal.fg);
    p.circle(vp.toX(cz[0]), vp.toY(cz[1]), 5);
}

function drawFreehand(p, S, which) {
    const vp = which === 'dom' ? S.dom.view : S.img.view;
    const pts = S.st.curve;
    if (pts.length < 2) return;
    const span = Math.max(S.img.view.xmax - S.img.view.xmin, S.img.view.ymax - S.img.view.ymin);
    p.stroke('#ff4fd8');
    p.strokeWeight(2.5);
    p.noFill();
    if (which === 'dom') polyline(p, vp, pts);
    else for (const seg of breakPolyline(pts.map((z) => S.F.f(z)), span * 0.3, span * 50)) polyline(p, vp, seg);
}

function drawReadouts(p, S, rect) {
    const { probe: pr, pal, map } = S;
    const lines = [
        `z0   = ${fc(pr.z0)}`,
        `w0   = ${fc(pr.w0)}`,
        `f'(z0) = ${fc(pr.d)}`,
        `|f'|   = ${f4(pr.mag)}   (local magnification)`,
        `arg f' = ${Number.isFinite(pr.rot) ? `${deg(pr.rot).toFixed(3)}°` : 'undefined'}   (local rotation)`,
    ];
    if (pr.critical) {
        lines.push(`f'(z0) = 0: not conformal here, angle between images = ${Number.isFinite(pr.angle) ? `${deg(pr.angle).toFixed(2)}°` : '?'} (doubled)`);
    } else {
        lines.push(`angle between images = ${Number.isFinite(pr.angle) ? `${deg(pr.angle).toFixed(4)}°` : 'undefined'}   (error from 90°: ${Number.isFinite(pr.angleErr) ? deg(pr.angleErr).toExponential(1) : '-'}°)`);
    }
    lines.push(`circle image roundness = ${f4(pr.roundness)}   (1 = exact circle)`);
    if (map.moebius) {
        const m = S.params.mob;
        const a = crossRatio(m.z[0], m.z[1], m.z[2], pr.z0);
        const b = crossRatio(m.w[0], m.w[1], m.w[2], pr.w0);
        lines.push(`cross-ratio: z-side ${fc(a)}  w-side ${fc(b)}`);
    }
    if (S.t < 1) lines.push(`morph t = ${S.t.toFixed(2)}: w = (1-t) z + t f(z)`);
    p.textFont(FONT);
    p.textSize(11);
    p.textAlign(p.LEFT, p.TOP);
    const lh = 14;
    const bw = Math.min(rect.w - 12, Math.max(...lines.map((l) => p.textWidth(l))) + 12);
    p.noStroke();
    p.fill(pal.dark ? 'rgba(20,22,26,0.82)' : 'rgba(250,250,250,0.85)');
    p.rect(rect.x + 6, rect.y + 22, bw, lines.length * lh + 8, 4);
    p.fill(pal.fg);
    lines.forEach((l, i) => p.text(l, rect.x + 12, rect.y + 26 + i * lh));
}

function drawPanel(p, S, which) {
    const pn = which === 'dom' ? S.dom : S.img;
    const { pal, st } = S;
    const vp = pn.view;
    const r = vp.rect;
    p.noStroke();
    p.fill(pal.panel);
    p.rect(r.x, r.y, r.w, r.h);
    const wantBg = S.get('bg');
    clip(p, r, () => {
        if (wantBg === which || wantBg === 'both') {
            const key = which === 'dom'
                ? `dom|${viewKey(vp)}|${S.map.sig}|${S.t.toFixed(4)}`
                : `img|${viewKey(vp)}`;
            const fn = which === 'dom' ? (re, im) => S.F.f([re, im]) : (re, im) => [re, im];
            const img = backgroundImage(p, st, which, key, r, (w, h) => renderField(w, h, boxOf(vp), fn, domainColor));
            p.tint(255, pal.dark ? 120 : 150);
            p.image(img, r.x, r.y, r.w, r.h);
            p.noTint();
        }
        const geo = panelGeometry(S, which);
        if (geo.region) {
            p.stroke(pal.accent);
            p.strokeWeight(2);
            if (geo.region.fill) {
                p.fill(pal.dark ? 'rgba(255,77,79,0.18)' : 'rgba(225,29,46,0.16)');
                polyline(p, vp, geo.region.pls[0], true);
            } else {
                p.noFill();
                for (const pl of geo.region.pls) polyline(p, vp, pl);
            }
        }
        drawAxes(p, S, vp);
        p.noFill();
        p.strokeWeight(1.2);
        for (const g of geo.grid) {
            p.stroke(FAMILY_COLORS[g.fam]);
            polyline(p, vp, g.pl);
        }
        for (const ex of geo.extras) {
            p.stroke(ex.color);
            p.strokeWeight(ex.weight || 1.5);
            polyline(p, vp, ex.pl);
        }
        drawFreehand(p, S, which);
        drawMarkers(p, S, which);
        drawProbe(p, S, which);
        drawHandles(p, S, which);
    });
    p.noFill();
    p.stroke(pal.border);
    p.strokeWeight(1);
    p.rect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    p.noStroke();
    p.fill(pal.fg);
    p.textFont(FONT);
    p.textSize(12);
    p.textAlign(p.LEFT, p.TOP);
    p.text(which === 'dom' ? 'z-plane (domain)' : `w-plane (image)  ${S.title}`, r.x + 8, r.y + 6);
    if (which === 'img') drawReadouts(p, S, r);
}

/** Extra curves (circle, streamlines) that live in the domain and are mapped into the image. */
export function buildExtras(S) {
    const out = [];
    if (S.map.id === 'jouk') {
        const c = S.params.jc;
        const r = Math.hypot(1 - c[0], c[1]);
        out.push({ at: (t) => C.add(c, C.fromPolar(r, 2 * Math.PI * t)), color: S.pal.accent, weight: 2.5 });
        if (S.get('streams')) {
            const reach = 2.2 * Math.max(S.dom.view.xmax - S.dom.view.xmin, S.dom.view.ymax - S.dom.view.ymin);
            for (const m of [0.25, 0.6, 1, 1.6, 2.4]) {
                for (const sgn of [1, -1]) out.push({ at: joukowskiStreamline(c, r, sgn * m * r, reach), color: STREAM, weight: 1.2 });
            }
        }
    }
    return out;
}

/** Draw both panels. S carries everything (see index.js). */
export function drawScene(p, S) {
    p.background(S.pal.bg);
    S.extras = buildExtras(S);
    S.extrasKey = S.map.id === 'jouk' ? `${S.params.jc.map((v) => v.toFixed(5))}|${S.get('streams')}` : '';
    S.probe = computeProbe(S.F, S.z0, S.rho);
    S.st.probe = S.probe;
    drawPanel(p, S, 'dom');
    drawPanel(p, S, 'img');
    if (S.error) {
        p.noStroke();
        p.fill('#ff6b6b');
        p.textFont(FONT);
        p.textSize(11);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.text(S.error, 14, p.height - 10);
    }
}
