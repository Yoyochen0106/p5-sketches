// Shared helpers for the Complex Integration & Residues unit: defaults, formatting, deep links,
// pointer / wheel / keyboard normalisation, drawing primitives and a small interactive scene (panels + handles).

import { Viewport, niceTicks, fmtTick } from '../approx/view.js';
import { renderField, domainColor } from '../../lib/domaincolor.js';

export const FONT = 'sans-serif';
export const MONO = 'monospace';
export const TAU = 2 * Math.PI;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const TABS = [
    { value: 'residue', label: 'Residue theorem' },
    { value: 'deform', label: 'Deformation' },
    { value: 'real', label: 'Real integrals' },
    { value: 'arg', label: 'Argument principle' },
];

/** Default values of every setting (the public deep-link keys are documented in index.js). */
export const DEFAULTS = {
    tab: 'residue',
    // residue theorem
    rpreset: 'two', rmode: 'residue', poles: '', zeros: '', expk: 0, bg: true, sel: 0, pm: 1, pcr: 1, pci: 0,
    ckind: 'circle', ccx: 0, ccy: 0, cr: 2.2, cpts: '',
    cg: 'exp', cn: 0, cax: 0.4, cay: 0.3, cqx: 2.5, cqy: 0.5,
    // deformation
    dmode: 'homotopy', ds: 0, dplay: false, dax: 0, day: 0, dar: 3, dbx: 3.2, dby: 0.4, dbr: 0.5, dwig: 0.3,
    dfun: 'sqrt', dcut: Math.PI, dcx: 0, dcy: 0, dcr: 1,
    // real integrals
    rex: 'inv1', R: 3, ra: 1, rb: 0.5, rw: 1.5, reps: 0.1, rplay: false,
    lfun: 'zz1', lcx: 0, lcy: 0, lr: 0.5, ln: 5,
    num: '1', den: '1,3,2', K: 1, bt: 1, bc: 0.5, bR: 8, delay: 0,
    // argument principle
    apreset: 'cubic', azeros: '', apoles: '', acx: 0, acy: 0, ar: 2, akind: 'circle', apts: '',
    nyq: false, npreset: 'type0',
};

/** Settings store with defaults filled in, as expected by core/ui.js. */
export function withDefaults(store) {
    return {
        get: (k, d) => store.get(k, d !== undefined ? d : DEFAULTS[k]),
        set: (k, v) => store.set(k, v),
        subscribe: (fn) => store.subscribe(fn),
        all: () => store.all && store.all(),
        reset: () => store.reset && store.reset(),
    };
}

// ---------------------------------------------------------------------------------------------
// Formatting and parsing

/** Number with `d` decimals, no "-0". */
export function fmt(v, d = 3) {
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : v < 0 ? '-inf' : 'nan';
    const s = v.toFixed(d);
    return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Complex number "a + bi". */
export function fmtC(z, d = 3) {
    if (!z || !Number.isFinite(z[0]) || !Number.isFinite(z[1])) return 'undefined';
    const im = fmt(Math.abs(z[1]), d);
    return `${fmt(z[0], d)} ${z[1] < 0 && !/^0\.?0*$/.test(im) ? '-' : '+'} ${im}i`;
}

/** Small errors in scientific notation. */
export const fmtErr = (v) => (Number.isFinite(v) ? (v === 0 ? '0' : v.toExponential(1)) : 'n/a');

/** Parse "a,b,c;d,e,f" into rows of numbers (invalid rows dropped). */
export function parseRows(text, width) {
    return String(text === undefined || text === null ? '' : text).split(';')
        .map((r) => r.split(',').map((s) => Number(s.trim())))
        .filter((r) => r.length >= width && r.every(Number.isFinite));
}

/** Serialise rows of numbers (limited precision). */
export const rowsToText = (rows) => rows.map((r) => r.map((v) => +(+v).toFixed(4)).join(',')).join(';');

// ---------------------------------------------------------------------------------------------
// Deep links

/** Hash for a unit with query parameters. */
export function unitHash(id, params = {}) {
    const q = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return `#/${id}${q ? `?${q}` : ''}`;
}

/** Navigate to another unit (no-op outside a browser). */
export function openUnit(id, params = {}) {
    if (typeof location === 'undefined') return;
    location.hash = unitHash(id, params);
}

// ---------------------------------------------------------------------------------------------
// Pointer / keyboard helpers

/** True for events that were not aimed at the canvas (UI overlays, the drawer, ...). */
export const offCanvas = (p, e) => !!(e && e.target && p.canvas && e.target !== p.canvas && e.target !== p.canvas.elt);

/** True when the primary button (or a touch) is pressed. */
export function isPrimary(p) {
    const b = p.mouseButton;
    if (b === undefined || b === null || b === '') return true;
    return b === p.LEFT || (typeof b === 'object' && !!b.left);
}

export function wheelDelta(e) {
    let d = Number(e && (e.deltaY !== undefined ? e.deltaY : e.delta)) || 0;
    if (e && e.deltaMode === 1) d *= 33;
    else if (e && e.deltaMode === 2) d *= 400;
    return clamp(d, -300, 300);
}

/** True while a form control has the keyboard focus. */
export function typing(key) {
    const el = globalThis.document && globalThis.document.activeElement;
    if (!el) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
    return /^(BUTTON|A)$/.test(el.tagName || '') && (key === ' ' || key === 'Enter');
}

// ---------------------------------------------------------------------------------------------
// Drawing

const viewKey = (v) => [v.xmin, v.xmax, v.ymin, v.ymax].map((n) => n.toPrecision(6)).join(',');
export { viewKey };

/** Clip drawing to a rectangle (never raw save/restore). */
export function clip(p, r, fn) {
    p.push();
    const ctx = p.drawingContext;
    if (ctx && ctx.beginPath) {
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
    }
    try { fn(); } finally { p.pop(); }
}

/** Dashed strokes (no-op if the context has no setLineDash). */
export function dashed(p, on, pattern = [6, 5]) {
    const ctx = p.drawingContext;
    if (ctx && ctx.setLineDash) ctx.setLineDash(on ? pattern : []);
}

const finitePx = (v) => Number.isFinite(v) && Math.abs(v) < 1e6;

/** Polyline in math coordinates (non-finite / absurd points break the line). */
export function polyline(p, vp, pts, close = false) {
    let open = false;
    for (const q of pts) {
        const x = vp.toX(q[0]);
        const y = vp.toY(q[1]);
        if (!finitePx(x) || !finitePx(y)) {
            if (open) { p.endShape(); open = false; }
            continue;
        }
        if (!open) { p.beginShape(); open = true; }
        p.vertex(x, y);
    }
    if (open) p.endShape(close ? p.CLOSE : undefined);
}

/** Axes with ticks for a viewport. */
export function drawAxes(p, pal, vp, { labels = true, unitX = '', unitY = '' } = {}) {
    const r = vp.rect;
    p.textFont(FONT);
    p.textSize(10);
    p.strokeWeight(1);
    p.stroke(pal.axis);
    if (vp.ymin < 0 && vp.ymax > 0) p.line(r.x, vp.toY(0), r.x + r.w, vp.toY(0));
    if (vp.xmin < 0 && vp.xmax > 0) p.line(vp.toX(0), r.y, vp.toX(0), r.y + r.h);
    if (!labels) return;
    p.noStroke();
    p.fill(pal.muted);
    p.textAlign(p.CENTER, p.BOTTOM);
    for (const x of niceTicks(vp.xmin, vp.xmax, 6)) if (x !== 0) p.text(fmtTick(x), vp.toX(x), r.y + r.h - 2);
    p.textAlign(p.LEFT, p.CENTER);
    for (const y of niceTicks(vp.ymin, vp.ymax, 5)) if (y !== 0) p.text(fmtTick(y), r.x + 3, vp.toY(y));
    p.textAlign(p.RIGHT, p.TOP);
    if (unitX) p.text(unitX, r.x + r.w - 4, Math.min(r.y + r.h - 14, Math.max(r.y + 2, vp.toY(0) + 3)));
    p.textAlign(p.LEFT, p.TOP);
    if (unitY) p.text(unitY, Math.min(r.x + r.w - 30, Math.max(r.x + 4, vp.toX(0) + 4)), r.y + 3);
}

/** Arrow from pixel (x0, y0) to (x1, y1). */
export function arrow(p, x0, y0, x1, y1, head = 8) {
    if (![x0, y0, x1, y1].every(finitePx)) return;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    if (L < 1) return;
    p.line(x0, y0, x1, y1);
    const ux = dx / L;
    const uy = dy / L;
    const h = Math.min(head, L * 0.6);
    p.line(x1, y1, x1 - h * (ux * 0.87 - uy * 0.5), y1 - h * (uy * 0.87 + ux * 0.5));
    p.line(x1, y1, x1 - h * (ux * 0.87 + uy * 0.5), y1 - h * (uy * 0.87 - ux * 0.5));
}

/** An x-shaped pole marker. */
export function cross(p, x, y, r = 5) {
    p.line(x - r, y - r, x + r, y + r);
    p.line(x - r, y + r, x + r, y - r);
}

/** Chevrons showing the direction of travel along a polyline (pixel coordinates are computed with vp). */
export function chevrons(p, vp, pts, count = 5, size = 6) {
    const n = pts.length;
    if (n < 4) return;
    for (let k = 0; k < count; k++) {
        const i = Math.floor(((k + 0.5) * n) / count) % n;
        const a = pts[i];
        const b = pts[(i + 1) % n];
        const x0 = vp.toX(a[0]);
        const y0 = vp.toY(a[1]);
        const x1 = vp.toX(b[0]);
        const y1 = vp.toY(b[1]);
        const L = Math.hypot(x1 - x0, y1 - y0);
        if (!(L > 1e-6) || !finitePx(x0) || !finitePx(y0)) continue;
        const ux = (x1 - x0) / L;
        const uy = (y1 - y0) / L;
        p.line(x0, y0, x0 - size * (ux * 0.8 - uy * 0.6), y0 - size * (uy * 0.8 + ux * 0.6));
        p.line(x0, y0, x0 - size * (ux * 0.8 + uy * 0.6), y0 - size * (uy * 0.8 - ux * 0.6));
    }
}

/** Panel frame with title. */
export function panelFrame(p, pal, r, title) {
    p.noFill();
    p.stroke(pal.border);
    p.strokeWeight(1);
    p.rect(r.x, r.y, r.w, r.h);
    if (title) {
        p.noStroke();
        p.fill(pal.fg);
        p.textFont(FONT);
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        p.text(title, r.x + 8, r.y + 6);
    }
}

/** Translucent box of monospace lines. Returns the height used. */
export function textBox(p, pal, lines, x, y, { size = 11, w = 0, lead = 15, bgAlpha = 0.78 } = {}) {
    p.textFont(MONO);
    p.textSize(size);
    let width = w;
    if (!width) {
        let mx = 0;
        for (const l of lines) mx = Math.max(mx, (typeof l === 'string' ? l : l.t).length);
        width = mx * size * 0.62 + 14;
    }
    const h = lines.length * lead + 8;
    p.noStroke();
    const bg = p.color(pal.panel);
    bg.setAlpha && bg.setAlpha(255 * bgAlpha);
    p.fill(bg);
    p.rect(x, y, width, h, 4);
    p.textAlign(p.LEFT, p.TOP);
    lines.forEach((l, i) => {
        p.fill(typeof l === 'string' ? pal.fg : l.c || pal.fg);
        p.text(typeof l === 'string' ? l : l.t, x + 7, y + 6 + i * lead);
    });
    p.textFont(FONT);
    return h;
}

/** Wrap text to a pixel width (monospace estimate) and draw it; returns the height. */
export function wrapText(p, pal, text, x, y, w, { size = 11, lead = 14, color } = {}) {
    p.textFont(FONT);
    p.textSize(size);
    p.fill(color || pal.muted);
    p.noStroke();
    p.textAlign(p.LEFT, p.TOP);
    const maxChars = Math.max(10, Math.floor(w / (size * 0.52)));
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const wd of words) {
        if ((cur + ' ' + wd).trim().length > maxChars) { lines.push(cur); cur = wd; } else cur = (cur + ' ' + wd).trim();
    }
    if (cur) lines.push(cur);
    lines.forEach((l, i) => p.text(l, x, y + i * lead));
    return lines.length * lead;
}

/**
 * Domain-colouring image of fn(re, im) -> [re, im] over a viewport, cached by `key` (only the inputs it depends on).
 * `cache` is a plain object owned by the caller.
 */
export function domainImage(p, cache, slot, key, vp, fn, block = 4) {
    const r = vp.rect;
    const w = Math.max(2, Math.ceil(r.w / block));
    const h = Math.max(2, Math.ceil(r.h / block));
    const fullKey = `${key}|${viewKey(vp)}|${w}x${h}`;
    const cur = cache[slot];
    if (cur && cur.key === fullKey) return cur.img;
    const img = cur && cur.img && cur.img.width === w && cur.img.height === h ? cur.img : p.createImage(w, h);
    const buf = renderField(w, h, vp, fn, domainColor);
    img.loadPixels();
    if (img.pixels.set) img.pixels.set(buf);
    else for (let i = 0; i < buf.length; i++) img.pixels[i] = buf[i];
    img.updatePixels();
    cache[slot] = { key: fullKey, img };
    return img;
}

// ---------------------------------------------------------------------------------------------
// Interactive scene: viewports ("panels") with draggable handles and pan / zoom

export const HIT_PX = 14;

/**
 * A set of viewports and handles. Handles are { panel, x, y, color, label, shape: 'dot'|'square'|'diamond', set(z), onPress() }.
 * Background drags pan the viewport unless `onBackground(panelId, px, py)` returns a custom drag
 * { move(z, px, py), end() } (called as onBackground(panelId, [x, y], px, py)).
 */
export class Scene {
    constructor() {
        this.panels = {};
        this.handles = [];
        this.drag = null;
        this.onBackground = null;
        this.onChange = null; // called after any pan / zoom / handle move
        this.userView = {};
    }

    panelAt(x, y) {
        for (const id of Object.keys(this.panels)) if (this.panels[id].contains(x, y)) return id;
        return null;
    }

    findHandle(pid, x, y) {
        const vp = this.panels[pid];
        let best = null;
        let bd = HIT_PX;
        for (let i = this.handles.length - 1; i >= 0; i--) {
            const h = this.handles[i];
            if (h.panel !== pid) continue;
            const d = Math.hypot(vp.toX(h.x) - x, vp.toY(h.y) - y);
            if (d <= bd) { bd = d; best = h; }
        }
        return best;
    }

    /** Returns true when the press was inside a panel (consumed). */
    press(x, y) {
        const pid = this.panelAt(x, y);
        if (!pid) { this.drag = null; return false; }
        const h = this.findHandle(pid, x, y);
        if (h) {
            if (h.onPress) h.onPress();
            this.drag = { kind: 'handle', h, pid };
            return true;
        }
        const custom = this.onBackground ? this.onBackground(pid, [this.panels[pid].fromX(x), this.panels[pid].fromY(y)], x, y) : null;
        this.drag = custom ? { kind: 'custom', c: custom, pid } : { kind: 'pan', pid, lx: x, ly: y, sx: x, sy: y, moved: false };
        return true;
    }

    dragTo(x, y) {
        const d = this.drag;
        if (!d) return false;
        const vp = this.panels[d.pid];
        const z = [vp.fromX(x), vp.fromY(y)];
        if (d.kind === 'handle') {
            if (z.every(Number.isFinite)) d.h.set(z);
        } else if (d.kind === 'custom') {
            d.c.move(z, x, y);
        } else {
            if (Math.hypot(x - d.sx, y - d.sy) > 4) d.moved = true;
            if (d.moved) {
                vp.panPx(x - d.lx, y - d.ly);
                this.userView[d.pid] = true;
            }
            d.lx = x;
            d.ly = y;
        }
        if (this.onChange) this.onChange();
        return true;
    }

    release() {
        const d = this.drag;
        this.drag = null;
        if (d && d.kind === 'custom' && d.c.end) d.c.end();
        if (d && this.onChange) this.onChange(true);
        return !!d;
    }

    wheel(e, x, y) {
        const pid = this.panelAt(x, y);
        if (!pid) return false;
        this.panels[pid].zoomAt(x, y, Math.exp(wheelDelta(e) * 0.0012));
        this.userView[pid] = true;
        if (this.onChange) this.onChange();
        return true;
    }

    /** Draw all handles of one panel. */
    drawHandles(p, pid, pal) {
        const vp = this.panels[pid];
        for (const h of this.handles) {
            if (h.panel !== pid) continue;
            const x = vp.toX(h.x);
            const y = vp.toY(h.y);
            if (!finitePx(x) || !finitePx(y)) continue;
            const hot = this.drag && this.drag.kind === 'handle' && this.drag.h === h;
            p.stroke(pal.dark ? '#14161a' : '#ffffff');
            p.strokeWeight(hot ? 2.5 : 1.5);
            p.fill(h.color || pal.accent);
            const s = h.size || 6;
            if (h.shape === 'square') p.rect(x - s, y - s, 2 * s, 2 * s);
            else if (h.shape === 'diamond') p.quad(x, y - s - 1, x + s + 1, y, x, y + s + 1, x - s - 1, y);
            else p.circle(x, y, 2 * s + (hot ? 2 : 0));
            if (h.label) {
                p.noStroke();
                p.fill(pal.fg);
                p.textFont(FONT);
                p.textSize(10);
                p.textAlign(p.LEFT, p.BOTTOM);
                p.text(h.label, x + s + 3, y - s);
            }
        }
    }
}

export { Viewport, niceTicks, fmtTick };
