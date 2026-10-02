// p5 (2D canvas) drawing helpers for the software 3D renderer in lib/render3d.js, plus a mouse /
// touch / keyboard CameraController. Everything draws with plain 2D calls: no WEBGL.
//
// Rect arguments are { x, y, w, h } in canvas pixels; drawing is clipped to the rect.
import {
  shadeMesh, createDrawList, boundsBox, projectSegments, axesGizmo,
} from '../../lib/render3d.js';

const lists = new WeakMap(); // prepared mesh -> draw list (used when the caller passes no `cache`)

function withClip(p, rect, fn) {
  p.push();
  const ctx = p.drawingContext;
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  try { fn(); } finally { p.pop(); }
}

const rgba = (c, fallbackAlpha = 255) => [c[0], c[1], c[2], c[3] === undefined ? fallbackAlpha : c[3]];

/**
 * Draws a prepared mesh. Returns the draw list (useful for stats: `count`, `rebuilds`, `decimated`).
 * opts: mode 'flat' | 'wire' | 'both' | 'points' (default 'flat'), alpha 0..255, colorFn, colorBy,
 *   colormap, baseColor, lightDir, cull, twoSided, maxTriangles, wireColor [r,g,b,a], weight,
 *   pointSize, seams (default true: hairline stroke in the fill colour hides anti-aliasing cracks),
 *   colorStep (default 4: fill colours are quantised so unchanged colours skip fill()/stroke() calls),
 *   cache (object holding the reusable draw list; default is keyed by the mesh).
 * Per frame cost: when the camera, rect and options are unchanged the sort is skipped (cached), and
 * a flat triangle costs one p.triangle() plus fill()/stroke() only when the quantised colour changes.
 * (p.triangle is cheaper than beginShape(TRIANGLES)+3 vertex+endShape = 5 calls, because every
 * triangle has its own colour.)
 */
export function drawMesh(p, prepared, camera, rect, opts = {}) {
  let list = opts.cache ? opts.cache.list : lists.get(prepared);
  if (!list) {
    list = createDrawList();
    if (opts.cache) opts.cache.list = list; else lists.set(prepared, list);
  }
  const mode = opts.mode || 'flat';
  list = shadeMesh(prepared, camera, rect, { ...opts, out: list });
  const alpha = opts.alpha === undefined ? 255 : opts.alpha;

  withClip(p, rect, () => {
    if (mode === 'points') {
      p.stroke(...rgba(opts.baseColor || [200, 220, 255], alpha));
      p.strokeWeight(opts.pointSize || 2);
      const V = list.vcount;
      const step = opts.maxTriangles > 0 && V > opts.maxTriangles ? V / opts.maxTriangles : 1;
      for (let f = 0; f < V; f += step) {
        const i = Math.floor(f);
        const x = list.vsx[i], y = list.vsy[i];
        if (Number.isFinite(x) && Number.isFinite(y)) p.point(x, y);
      }
      return;
    }
    const wire = mode === 'wire' || mode === 'both';
    const fill = mode === 'flat' || mode === 'both';
    const step = opts.colorStep || 4;
    const wc = rgba(opts.wireColor || [15, 20, 30, 150]);
    const seams = fill && !wire && opts.seams !== false && alpha >= 255;
    if (wire) p.strokeWeight(opts.weight || 0.7);
    if (wire && !fill) { p.noFill(); p.stroke(...wc); }
    else if (wire) p.stroke(...wc);
    else if (!seams) p.noStroke();
    else p.strokeWeight(1);
    let last = -1;
    const xy = list.xy, rgb = list.rgb, order = list.order;
    for (let k = 0; k < list.count; k++) {
      const i = order[k];
      if (fill) {
        const r = Math.round(rgb[i * 3] / step) * step, g = Math.round(rgb[i * 3 + 1] / step) * step, b = Math.round(rgb[i * 3 + 2] / step) * step;
        const packed = (r << 16) | (g << 8) | b;
        if (packed !== last) {
          p.fill(r, g, b, alpha);
          if (seams) p.stroke(r, g, b, alpha);
          last = packed;
        }
      }
      const o = i * 6;
      p.triangle(xy[o], xy[o + 1], xy[o + 2], xy[o + 3], xy[o + 4], xy[o + 5]);
    }
  });
  return list;
}

/** Draws a segment list (Float32Array, 6 per segment) as lines. style: { stroke:[r,g,b,a], weight }. */
export function drawEdges(p, edges3d, camera, rect, style = {}) {
  const holder = style.cache || {};
  const n = projectSegments(edges3d, camera, rect, holder);
  const out = holder.out;
  withClip(p, rect, () => {
    p.noFill();
    p.stroke(...rgba(style.stroke || [200, 205, 215, 180]));
    p.strokeWeight(style.weight || 1);
    for (let i = 0; i < n; i++) p.line(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]);
  });
  return n;
}

export function drawBoundsBox(p, bounds, camera, rect, style = {}) {
  return drawEdges(p, boundsBox(bounds), camera, rect, style);
}

const AXIS_COLORS = { x: [235, 90, 90], y: [100, 205, 110], z: [90, 150, 245] };

/** Orientation gizmo in the bottom-left corner of the rect. opts: size px, margin, labels. */
export function drawAxes(p, camera, rect, opts = {}) {
  const size = opts.size || 36, margin = opts.margin || size + 14;
  const cx = rect.x + margin, cy = rect.y + rect.h - margin;
  const lines = axesGizmo(camera, cx, cy, size);
  withClip(p, rect, () => {
    p.strokeWeight(2);
    p.textSize(11);
    p.textAlign(p.CENTER, p.CENTER);
    for (const l of lines) {
      const c = AXIS_COLORS[l.axis];
      p.stroke(c[0], c[1], c[2], 230);
      p.line(l.x0, l.y0, l.x1, l.y1);
      if (opts.labels !== false) {
        p.noStroke(); p.fill(c[0], c[1], c[2], 255);
        p.text(l.axis, l.x1 + (l.x1 - l.x0) * 0.25, l.y1 + (l.y1 - l.y0) * 0.25);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Camera controller

const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/**
 * Orbit / pan / zoom interaction for an OrbitCamera.
 *   - left-drag: orbit; shift+drag, right/middle-drag, or two-finger drag: pan
 *   - wheel (normalised for deltaMode, clamped) and two-finger pinch: zoom
 *   - double-click or R: camera.reset()
 * Each handler returns true when it consumed the event (touch handlers and mouseWheel return the
 * p5 convention instead: false = preventDefault). `attach()` installs them as p.* handlers; call
 * the handlers yourself instead if the sketch has its own handlers to combine.
 * getRect is a rect or a function returning one (called on every event).
 */
export class CameraController {
  constructor(p, camera, getRect, opts = {}) {
    this.p = p;
    this.camera = camera;
    this.getRect = typeof getRect === 'function' ? getRect : () => getRect;
    this.onChange = opts.onChange || (() => {});
    this.orbitSpeed = opts.orbitSpeed || 0.008;
    this.resetKey = opts.resetKey === undefined ? 'r' : opts.resetKey;
    this.drag = null; // { mode: 'orbit'|'pan', x, y }
    this.pinch = null;
    this.touchActive = false;
    this._touchCount = 0;
    this._attached = null;
  }

  _onCanvas(e) {
    const p = this.p;
    return !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
  }

  _changed() { this.onChange(this.camera); }

  reset() { this.camera.reset(); this._changed(); }

  _isShift(e) {
    return !!(e && e.shiftKey) || (this.p.keyIsDown ? !!this.p.keyIsDown(16) : false);
  }

  mousePressed(e) {
    const p = this.p;
    if (this.touchActive || !this._onCanvas(e)) return false;
    if (!inRect(this.getRect(), p.mouseX, p.mouseY)) { this.drag = null; return false; }
    const panBtn = p.mouseButton === p.RIGHT || p.mouseButton === p.CENTER;
    this.drag = { mode: panBtn || this._isShift(e) ? 'pan' : 'orbit', x: p.mouseX, y: p.mouseY };
    return true;
  }

  mouseDragged() {
    const p = this.p;
    if (!this.drag || this.touchActive) return false;
    this._move(p.mouseX - this.drag.x, p.mouseY - this.drag.y, this.drag.mode);
    this.drag.x = p.mouseX; this.drag.y = p.mouseY;
    return true;
  }

  mouseReleased() {
    const was = !!this.drag && !this.touchActive;
    if (!this.touchActive) this.drag = null;
    return was;
  }

  _move(dx, dy, mode) {
    if (!dx && !dy) return;
    if (mode === 'pan') this.camera.pan(dx, dy, this.getRect());
    else this.camera.rotate(-dx * this.orbitSpeed, dy * this.orbitSpeed);
    this._changed();
  }

  doubleClicked(e) {
    const p = this.p;
    if (!this._onCanvas(e) || !inRect(this.getRect(), p.mouseX, p.mouseY)) return false;
    this.reset();
    return true;
  }

  mouseWheel(e) {
    const p = this.p;
    if (!this._onCanvas(e) || !inRect(this.getRect(), p.mouseX, p.mouseY)) return true;
    let d = (e && (e.delta !== undefined ? e.delta : e.deltaY)) || 0;
    if (e && e.deltaMode === 1) d *= 33;
    else if (e && e.deltaMode === 2) d *= 400;
    d = Math.max(-300, Math.min(300, d));
    if (!d) return true;
    this.camera.zoom(Math.exp(d * 0.0012));
    this._changed();
    if (e && e.preventDefault) e.preventDefault();
    return false;
  }

  _touchPoints() {
    return (this.p.touches || []).map((q) => [q.x, q.y]);
  }

  touchStarted(e) {
    const pts = this._touchPoints();
    if (!this._onCanvas(e) || !pts.length) return true;
    const r = this.getRect();
    if (!this.touchActive && !pts.every((q) => inRect(r, q[0], q[1]))) return true;
    this.touchActive = true;
    this._syncTouch(pts);
    return false;
  }

  _syncTouch(pts) {
    if (pts.length >= 2) {
      this.drag = { mode: 'pan', x: (pts[0][0] + pts[1][0]) / 2, y: (pts[0][1] + pts[1][1]) / 2 };
      this.pinch = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    } else if (pts.length === 1) {
      this.drag = { mode: 'orbit', x: pts[0][0], y: pts[0][1] };
      this.pinch = null;
    } else {
      this.drag = null; this.pinch = null;
    }
    this._touchCount = pts.length;
  }

  touchMoved() {
    if (!this.touchActive) return true;
    const pts = this._touchPoints();
    if (pts.length !== this._touchCount) { this._syncTouch(pts); return false; }
    if (!this.drag) return true;
    if (pts.length >= 2) {
      const cx = (pts[0][0] + pts[1][0]) / 2, cy = (pts[0][1] + pts[1][1]) / 2;
      const dist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      this._move(cx - this.drag.x, cy - this.drag.y, 'pan');
      if (this.pinch > 1 && dist > 1) { this.camera.zoom(this.pinch / dist); this._changed(); }
      this.drag.x = cx; this.drag.y = cy; this.pinch = dist;
    } else {
      this._move(pts[0][0] - this.drag.x, pts[0][1] - this.drag.y, 'orbit');
      this.drag.x = pts[0][0]; this.drag.y = pts[0][1];
    }
    return false;
  }

  touchEnded() {
    if (!this.touchActive) return true;
    const pts = this._touchPoints();
    this._syncTouch(pts);
    if (!pts.length) this.touchActive = false;
    return false;
  }

  keyPressed(e) {
    const p = this.p;
    if (this.resetKey == null || String(p.key).toLowerCase() !== this.resetKey) return false;
    if (e && (e.ctrlKey || e.metaKey || e.altKey)) return false;
    const el = globalThis.document && globalThis.document.activeElement;
    if (el && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName || '') || el.isContentEditable)) return false;
    this.reset();
    return true;
  }

  /** Installs the handlers on the p5 instance. Returns a function that removes them again. */
  attach() {
    const p = this.p;
    const names = ['mousePressed', 'mouseDragged', 'mouseReleased', 'doubleClicked', 'touchStarted', 'touchMoved', 'touchEnded', 'mouseWheel', 'keyPressed'];
    const prev = {};
    for (const n of names) {
      prev[n] = p[n];
      // a `false` return makes p5 call preventDefault: only touch / wheel handlers use it
      p[n] = (e) => {
        const r = this[n](e);
        return n.startsWith('touch') || n === 'mouseWheel' ? r : undefined;
      };
    }
    this._attached = prev;
    return () => this.detach();
  }

  detach() {
    if (!this._attached) return;
    for (const n of Object.keys(this._attached)) this.p[n] = this._attached[n];
    this._attached = null;
    this.drag = null; this.touchActive = false;
  }
}
