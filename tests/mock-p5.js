// MockP5: a browser-free stand-in for p5 instance mode, for testing sketches in Node.
//
//   const p = new MockP5((p) => { p.setup = ...; p.draw = ... }, container, { width: 800, height: 600 });
//   p.stepFrames(3);
//   p.callsOf('line')[0].style.stroke.levels   // -> [r, g, b, a]
//
// What is real: math helpers, constants, seeded random/noise, colour parsing (RGB/HSB/HSL, css
// strings), push/pop of style + transform, pixel buffer for background()/get()/set()/loadPixels().
// What is only recorded: every drawing / state call (see `calls`), shapes are never rasterised.
//
// Each recorded call is  { fn, args, frame, style, transform }:
//   style     frozen snapshot of the style AFTER the call was applied (stroke/fill are MockColor or
//             null for noStroke/noFill; see DEFAULT_STYLE for all keys)
//   transform [a,b,c,d,e,f] canvas-style current matrix (x' = a x + c y + e, y' = b x + d y + f)
//   endShape calls additionally carry `vertices` (the collected vertex list).

const TWO_PI = Math.PI * 2;

export const CONSTANTS = {
  PI: Math.PI, TWO_PI, TAU: TWO_PI, HALF_PI: Math.PI / 2, QUARTER_PI: Math.PI / 4,
  DEGREES: 'degrees', RADIANS: 'radians',
  LEFT: 'left', RIGHT: 'right', CENTER: 'center', TOP: 'top', BOTTOM: 'bottom', BASELINE: 'alphabetic',
  CORNER: 'corner', CORNERS: 'corners', RADIUS: 'radius',
  CLOSE: 'close', OPEN: 'open', CHORD: 'chord', PIE: 'pie',
  RGB: 'rgb', HSB: 'hsb', HSL: 'hsl',
  POINTS: 'points', LINES: 'lines', TRIANGLES: 'triangles', TRIANGLE_FAN: 'triangle_fan',
  TRIANGLE_STRIP: 'triangle_strip', QUADS: 'quads', QUAD_STRIP: 'quad_strip', TESS: 'tess',
  ARROW: 'default', CROSS: 'crosshair', HAND: 'pointer', MOVE: 'move', TEXT: 'text', WAIT: 'wait',
  ROUND: 'round', SQUARE: 'butt', PROJECT: 'square', MITER: 'miter', BEVEL: 'bevel',
  BLEND: 'source-over', ADD: 'lighter', MULTIPLY: 'multiply', SCREEN: 'screen', REPLACE: 'copy',
  P2D: 'p2d', WEBGL: 'webgl',
  NORMAL: 'normal', ITALIC: 'italic', BOLD: 'bold', BOLDITALIC: 'bold italic',
  BACKSPACE: 8, DELETE: 46, ENTER: 13, RETURN: 13, TAB: 9, ESCAPE: 27, SHIFT: 16, CONTROL: 17, OPTION: 18, ALT: 18,
  UP_ARROW: 38, DOWN_ARROW: 40, LEFT_ARROW: 37, RIGHT_ARROW: 39,
};

// ---------------------------------------------------------------------------------------------
// Colours

const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], lime: [0, 255, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255],
  magenta: [255, 0, 255], fuchsia: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128],
  orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203], brown: [165, 42, 42],
  navy: [0, 0, 128], teal: [0, 128, 128], silver: [192, 192, 192],
};

export class MockColor {
  constructor(levels, mode = 'rgb') {
    this.levels = levels.map((v) => Math.round(v));
    this.mode = mode;
    this._array = this.levels.map((v) => v / 255);
  }
  setAlpha(a) { this.levels[3] = Math.round(a); this._array[3] = this.levels[3] / 255; return this; }
  toString() {
    const [r, g, b, a] = this.levels;
    return `rgba(${r},${g},${b},${Math.round((a / 255) * 1000) / 1000})`;
  }
  get isMockColor() { return true; }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function hsbToRgb(h, s, v) { // h in [0,360), s,v in [0,1]
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hslToRgb(h, s, l) {
  const v = l + s * Math.min(l, 1 - l);
  const sv = v === 0 ? 0 : 2 * (1 - l / v);
  return hsbToRgb(h, sv, v);
}

function parseCssColor(str) {
  const s = str.trim().toLowerCase();
  if (s in NAMED) return [...NAMED[s], 255];
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) {
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
    }
  }
  m = /^(rgba?|hsla?|hsba?)\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[2].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)));
    const a = parts.length > 3 ? (parts[3] <= 1 ? parts[3] * 255 : parts[3]) : 255;
    if (m[1].startsWith('rgb')) {
      const pct = m[2].includes('%');
      return [...parts.slice(0, 3).map((v) => (pct ? v * 255 : v)), a];
    }
    const [hh, ss, ll] = parts;
    const rgb = m[1].startsWith('hsl') ? hslToRgb(hh, ss <= 1 ? ss : ss / 100, ll <= 1 ? ll : ll / 100)
      : hsbToRgb(hh, ss <= 1 ? ss : ss / 100, ll <= 1 ? ll : ll / 100);
    return [...rgb, a];
  }
  return null;
}

// Convert p5-style colour arguments to a MockColor given the active colorMode state.
function makeColor(args, cm) {
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  const a0 = args[0];
  if (a0 && typeof a0 === 'object' && a0.levels) return new MockColor(a0.levels, a0.mode);
  if (typeof a0 === 'string') {
    const lv = parseCssColor(a0);
    if (!lv) throw new Error(`MockP5: cannot parse colour string "${a0}"`);
    return new MockColor(lv);
  }
  const { mode, maxes } = cm; // maxes: [m1, m2, m3, mA]
  let comps;
  let alpha;
  if (args.length === 1) { comps = [args[0], args[0], args[0]]; alpha = maxes[3]; }
  else if (args.length === 2) { comps = [args[0], args[0], args[0]]; alpha = args[1]; }
  else if (args.length === 3) { comps = args; alpha = maxes[3]; }
  else { comps = args; alpha = args[3]; }
  const a = clamp((alpha / maxes[3]) * 255, 0, 255);
  let rgb;
  if (mode === 'rgb') {
    rgb = args.length <= 2
      ? [1, 2, 3].map(() => clamp((comps[0] / maxes[0]) * 255, 0, 255))
      : [0, 1, 2].map((i) => clamp((comps[i] / maxes[i]) * 255, 0, 255));
  } else {
    // gray in HSB/HSL = brightness/lightness only
    const [h, s, v] = args.length <= 2 ? [0, 0, comps[0] / maxes[2]] : [comps[0] / maxes[0] * 360, comps[1] / maxes[1], comps[2] / maxes[2]];
    rgb = mode === 'hsb' ? hsbToRgb(h, clamp(s, 0, 1), clamp(v, 0, 1)) : hslToRgb(h, clamp(s, 0, 1), clamp(v, 0, 1));
  }
  return new MockColor([...rgb, a]);
}

// ---------------------------------------------------------------------------------------------
// Deterministic random + noise

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fade = (t) => t * t * (3 - 2 * t);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return L(
    L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf),
    L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf);
}

// ---------------------------------------------------------------------------------------------
// Fake 2D context: any method call is recorded as { fn, args }; property writes as { fn: '=name' }.

export function createFakeContext(owner) {
  const calls = [];
  const props = Object.create(null);
  const fns = Object.create(null);
  const target = {
    calls,
    clearCalls() { calls.length = 0; },
    callsOf(name) { return calls.filter((c) => c.fn === name); },
  };
  const proxy = new Proxy(target, {
    get(t, name) {
      if (typeof name === 'symbol' || name === 'then' || name === 'toJSON') return undefined;
      if (name in t) return t[name];
      if (name in props) return props[name];
      if (name === 'canvas') return owner ? owner.canvas : undefined;
      if (!fns[name]) {
        fns[name] = (...args) => {
          calls.push({ fn: name, args });
          switch (name) {
            case 'createLinearGradient': case 'createRadialGradient': case 'createPattern':
              return { addColorStop(...a) { calls.push({ fn: 'addColorStop', args: a }); } };
            case 'measureText': {
              const m = /(\d+(?:\.\d+)?)px/.exec(String(props.font || ''));
              return { width: String(args[0]).length * (m ? +m[1] : 10) * 0.6 };
            }
            case 'getImageData': {
              const [, , w, h] = args;
              return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            }
            case 'createImageData': {
              const [w, h] = args;
              return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
            }
            case 'isPointInPath': case 'isPointInStroke': return false;
            default: return undefined;
          }
        };
      }
      return fns[name];
    },
    set(t, name, value) {
      if (typeof name === 'symbol') return true;
      props[name] = value;
      calls.push({ fn: `=${name}`, args: [value] });
      return true;
    },
  });
  return proxy;
}

// ---------------------------------------------------------------------------------------------
// Images

class MockImage {
  constructor(w, h) {
    this.width = w; this.height = h;
    this.pixels = new Uint8ClampedArray(w * h * 4);
  }
  loadPixels() {}
  updatePixels() {}
  get(x, y, w, h) {
    if (x === undefined) { const c = new MockImage(this.width, this.height); c.pixels.set(this.pixels); return c; }
    if (w === undefined) {
      const i = (Math.floor(y) * this.width + Math.floor(x)) * 4;
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
      return [...this.pixels.slice(i, i + 4)];
    }
    const c = new MockImage(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = this.get(x + i, y + j);
      c.pixels.set(v, (j * w + i) * 4);
    }
    return c;
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    const lv = typeof c === 'number' ? [c, c, c, 255] : (c.levels || c);
    this.pixels.set([lv[0], lv[1], lv[2], lv[3] === undefined ? 255 : lv[3]], i);
  }
  resize(w, h) { this.width = w; this.height = h; this.pixels = new Uint8ClampedArray(w * h * 4); }
}

class MockVector {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy() { return new MockVector(this.x, this.y, this.z); }
  set(x, y, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
  add(x, y = 0, z = 0) { if (x instanceof MockVector) { y = x.y; z = x.z; x = x.x; } this.x += x; this.y += y; this.z += z; return this; }
  sub(x, y = 0, z = 0) { if (x instanceof MockVector) { y = x.y; z = x.z; x = x.x; } this.x -= x; this.y -= y; this.z -= z; return this; }
  mult(k) { this.x *= k; this.y *= k; this.z *= k; return this; }
  div(k) { return this.mult(1 / k); }
  mag() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const m = this.mag(); return m ? this.div(m) : this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  heading() { return Math.atan2(this.y, this.x); }
}

// ---------------------------------------------------------------------------------------------
// Style

export const DEFAULT_STYLE = Object.freeze({
  fill: new MockColor([255, 255, 255, 255]),
  stroke: new MockColor([0, 0, 0, 255]),
  strokeWeight: 1,
  textSize: 12,
  textFont: 'sans-serif',
  textStyle: 'normal',
  textLeading: 15,
  textAlignH: 'left',
  textAlignV: 'alphabetic',
  rectMode: 'corner',
  ellipseMode: 'center',
  imageMode: 'corner',
  strokeCap: 'round',
  strokeJoin: 'miter',
  blendMode: 'source-over',
  tint: null,
  colorMode: 'rgb',
  erase: false,
});

const GEOMETRY_FNS = new Set([
  'line', 'point', 'circle', 'ellipse', 'rect', 'square', 'triangle', 'quad', 'arc', 'bezier', 'curve',
  'vertex', 'curveVertex', 'bezierVertex', 'quadraticVertex', 'translate', 'rotate', 'scale', 'image',
]);

// Pure setters recorded generically: name -> style key (value = first arg)
const SIMPLE_STYLE_SETTERS = {
  rectMode: 'rectMode', ellipseMode: 'ellipseMode', imageMode: 'imageMode',
  strokeCap: 'strokeCap', strokeJoin: 'strokeJoin', blendMode: 'blendMode', textStyle: 'textStyle',
  textLeading: 'textLeading',
};

// Plain recorded calls with no state effect
const PLAIN_RECORDED = [
  'noSmooth', 'smooth', 'noCursor', 'save', 'saveCanvas', 'curveTightness', 'bezierDetail', 'curveDetail',
  'clip', 'beginContour', 'endContour', 'describe', 'textWrap',
];


// ---------------------------------------------------------------------------------------------
// MockGraphics: the drawing surface (also what createGraphics returns). MockP5 extends it.

export class MockGraphics {
  constructor(w = 100, h = 100, opts = {}) {
    this._parent = opts.parent || null;
    this._frameCount = 0;
    this.width = w;
    this.height = h;
    this.isGraphics = !!opts.parent;
    this.calls = [];
    this.invalidCalls = [];
    this.strictNumbers = !!opts.strictNumbers;
    this.graphics = [];
    this._style = DEFAULT_STYLE;
    this._stack = [];
    this.unbalancedPops = 0;
    this._matrix = [1, 0, 0, 1, 0, 0];
    this._shape = null;
    this._angleMode = 'radians';
    this._colorMaxes = { rgb: [255, 255, 255, 255], hsb: [360, 100, 100, 1], hsl: [360, 100, 100, 1] };
    this._pixelDensity = opts.pixelDensity || 1;
    this._pixelBuffer = null;
    this._pendingFill = [0, 0, 0, 0];
    this.pixels = new Uint8ClampedArray(0);
    this._seed = opts.seed ?? 12345;
    this._rng = mulberry32(this._seed);
    this._noiseSeed = this._seed;
    this._noiseOctaves = 4;
    this._noiseFalloff = 0.5;
    this._gauss = null;
    this._looping = true;
    this._cursor = 'default';
    this._frameRate = 60;
    this.drawingContext = createFakeContext(this);
    this.canvas = this._makeCanvas();
    this.elt = this.canvas.elt;
    Object.assign(this, CONSTANTS);
    this.lastBackground = null;
    this._bindMethods();
  }

  // p5 binds methods to the instance so that `const { map } = p` works; do the same.
  _bindMethods() {
    for (let proto = Object.getPrototypeOf(this); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || name.startsWith('_') || Object.hasOwn(this, name)) continue;
        const d = Object.getOwnPropertyDescriptor(proto, name);
        if (typeof d.value === 'function') {
          Object.defineProperty(this, name, { value: d.value.bind(this), writable: true, configurable: true, enumerable: false });
        }
      }
    }
  }

  _makeCanvas() {
    const self = this;
    const elt = {
      style: {}, listeners: {},
      addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
      removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); },
      getContext() { return self.drawingContext; },
      get width() { return self.width * self._pixelDensity; },
      get height() { return self.height * self._pixelDensity; },
      remove() {},
    };
    const c = {
      elt, parentEl: null,
      get width() { return self.width; },
      get height() { return self.height; },
      parent(p) { if (p !== undefined) { c.parentEl = p; return c; } return c.parentEl; },
      style(k, v) { elt.style[k] = v; return c; },
      position() { return c; }, id() { return c; }, class() { return c; }, addClass() { return c; },
      mouseWheel() { return c; }, mousePressed() { return c; }, touchStarted() { return c; },
      remove() {},
    };
    return c;
  }

  // ---- frame counter (graphics share their parent's) ----
  get frameCount() { return this._parent ? this._parent.frameCount : this._frameCount; }
  set frameCount(v) { this._frameCount = v; }

  // Styles are immutable frozen objects; every change creates a new one, so call snapshots can share them.
  _set(patch) { this._style = Object.freeze({ ...this._style, ...patch }); }

  // ---- recording ----
  _record(fn, args, extra) {
    const c = { fn, args: Array.from(args), frame: this.frameCount, style: this._style, transform: this._matrix.slice() };
    if (extra) Object.assign(c, extra);
    this.calls.push(c);
    return c;
  }
  _checkNumbers(fn, args) {
    for (let i = 0; i < args.length; i++) {
      const v = args[i];
      if (fn === 'image' && i === 0) continue;
      if ((typeof v === 'number' && !Number.isFinite(v)) || v === undefined || v === null) {
        this.invalidCalls.push({ fn, args: Array.from(args), index: i, frame: this.frameCount });
        if (this.strictNumbers) throw new Error(`MockP5: ${fn}() argument ${i} is ${v}`);
        return;
      }
    }
  }
  _draw(fn, args) {
    this._checkNumbers(fn, args);
    return this._record(fn, args);
  }
  callsOf(fn) { return this.calls.filter((c) => c.fn === fn); }
  lastCall(fn) {
    for (let i = this.calls.length - 1; i >= 0; i--) if (!fn || this.calls[i].fn === fn) return this.calls[i];
    return undefined;
  }
  clearCalls() {
    this.calls.length = 0;
    this.invalidCalls.length = 0;
    this.drawingContext.clearCalls();
    for (const g of this.graphics) g.clearCalls();
  }
  get ctxCalls() { return this.drawingContext.calls; }
  get style() { return this._style; }
  get stackDepth() { return this._stack.length; }
  get matrix() { return this._matrix.slice(); }
  transformPoint(x, y) {
    const [a, b, c, d, e, f] = this._matrix;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  // ---- math (real) ----
  _ang(a) { return this._angleMode === 'degrees' ? (a * Math.PI) / 180 : a; }
  _unang(a) { return this._angleMode === 'degrees' ? (a * 180) / Math.PI : a; }
  sin(a) { return Math.sin(this._ang(a)); }
  cos(a) { return Math.cos(this._ang(a)); }
  tan(a) { return Math.tan(this._ang(a)); }
  asin(v) { return this._unang(Math.asin(v)); }
  acos(v) { return this._unang(Math.acos(v)); }
  atan(v) { return this._unang(Math.atan(v)); }
  atan2(y, x) { return this._unang(Math.atan2(y, x)); }
  degrees(r) { return (r * 180) / Math.PI; }
  radians(d) { return (d * Math.PI) / 180; }
  angleMode(m) { if (m === undefined) return this._angleMode; this._angleMode = m; this._record('angleMode', [m]); }
  abs(x) { return Math.abs(x); }
  floor(x) { return Math.floor(x); }
  ceil(x) { return Math.ceil(x); }
  round(x, d = 0) { const k = 10 ** d; return Math.round(x * k) / k; }
  sq(x) { return x * x; }
  sqrt(x) { return Math.sqrt(x); }
  pow(a, b) { return Math.pow(a, b); }
  exp(x) { return Math.exp(x); }
  log(x) { return Math.log(x); }
  fract(x) { return x - Math.floor(x); }
  max(...a) { const v = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; return Math.max(...v); }
  min(...a) { const v = a.length === 1 && Array.isArray(a[0]) ? a[0] : a; return Math.min(...v); }
  int(x) { return Array.isArray(x) ? x.map((v) => Math.trunc(Number(v))) : Math.trunc(Number(x)); }
  float(x) { return Array.isArray(x) ? x.map(parseFloat) : parseFloat(x); }
  str(x) { return String(x); }
  nf(n, left = 0, right = 0) {
    const neg = n < 0;
    const s = right > 0 ? Math.abs(n).toFixed(right) : String(Math.trunc(Math.abs(n)));
    const [i, f] = s.split('.');
    return (neg ? '-' : '') + i.padStart(left, '0') + (f ? `.${f}` : '');
  }
  constrain(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
  lerp(a, b, t) { return a + (b - a) * t; }
  norm(v, lo, hi) { return (v - lo) / (hi - lo); }
  map(v, a, b, c, d, within = false) {
    const r = ((v - a) / (b - a)) * (d - c) + c;
    if (!within) return r;
    return c < d ? this.constrain(r, c, d) : this.constrain(r, d, c);
  }
  dist(...a) {
    if (a.length === 4) return Math.hypot(a[2] - a[0], a[3] - a[1]);
    return Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]);
  }
  mag(x, y, z = 0) { return Math.hypot(x, y, z); }
  createVector(x, y, z) { return new MockVector(x, y, z); }
  randomSeed(s) { this._seed = s; this._rng = mulberry32(s); this._gauss = null; }
  random(a, b) {
    const r = this._rng();
    if (a === undefined) return r;
    if (Array.isArray(a)) return a[Math.floor(r * a.length)];
    if (b === undefined) return r * a;
    return a + r * (b - a);
  }
  randomGaussian(mean = 0, sd = 1) {
    let y1;
    if (this._gauss !== null) { y1 = this._gauss; this._gauss = null; }
    else {
      let x1, x2, w;
      do { x1 = this._rng() * 2 - 1; x2 = this._rng() * 2 - 1; w = x1 * x1 + x2 * x2; } while (w >= 1 || w === 0);
      w = Math.sqrt((-2 * Math.log(w)) / w);
      y1 = x1 * w; this._gauss = x2 * w;
    }
    return y1 * sd + mean;
  }
  noiseSeed(s) { this._noiseSeed = s | 0; }
  noiseDetail(octaves, falloff) { this._noiseOctaves = octaves; if (falloff !== undefined) this._noiseFalloff = falloff; }
  noise(x, y = 0, z = 0) {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < this._noiseOctaves; o++) {
      sum += amp * valueNoise(x * f, y * f, z * f, this._noiseSeed + o * 101);
      amp *= this._noiseFalloff; f *= 2;
    }
    return sum;
  }

  // ---- colour ----
  _cm() { return { mode: this._style.colorMode, maxes: this._colorMaxes[this._style.colorMode] }; }
  get colorMaxes() { return [...this._colorMaxes[this._style.colorMode]]; }
  color(...args) { return makeColor(args, this._cm()); }
  lerpColor(a, b, t) {
    const A = makeColor([a], this._cm()).levels, B = makeColor([b], this._cm()).levels;
    return new MockColor(A.map((v, i) => v + (B[i] - v) * t));
  }
  red(c) { return makeColor([c], this._cm()).levels[0]; }
  green(c) { return makeColor([c], this._cm()).levels[1]; }
  blue(c) { return makeColor([c], this._cm()).levels[2]; }
  alpha(c) { return makeColor([c], this._cm()).levels[3]; }
  colorMode(mode, ...maxes) {
    if (mode === undefined) return this._style.colorMode;
    const cur = this._colorMaxes[mode];
    if (!cur) throw new Error(`MockP5: unknown colorMode ${mode}`);
    if (maxes.length === 1) cur.splice(0, 3, maxes[0], maxes[0], maxes[0]);
    else if (maxes.length === 2) { cur.splice(0, 3, maxes[0], maxes[0], maxes[0]); cur[3] = maxes[1]; }
    else if (maxes.length >= 3) { cur.splice(0, 3, maxes[0], maxes[1], maxes[2]); if (maxes[3] !== undefined) cur[3] = maxes[3]; }
    this._set({ colorMode: mode });
    this._record('colorMode', [mode, ...maxes]);
  }
  _setColorStyle(key, fn, args) {
    this._set({ [key]: args === null ? null : makeColor(args, this._cm()) });
    this._record(fn, args || []);
  }
  fill(...a) { this._setColorStyle('fill', 'fill', a); }
  stroke(...a) { this._setColorStyle('stroke', 'stroke', a); }
  noFill() { this._setColorStyle('fill', 'noFill', null); }
  noStroke() { this._setColorStyle('stroke', 'noStroke', null); }
  tint(...a) { this._setColorStyle('tint', 'tint', a); }
  noTint() { this._setColorStyle('tint', 'noTint', null); }
  strokeWeight(w) { this._set({ strokeWeight: w }); this._draw('strokeWeight', [w]); }
  erase() { this._set({ erase: true }); this._record('erase', []); }
  noErase() { this._set({ erase: false }); this._record('noErase', []); }

  // ---- text ----
  textSize(s) {
    if (s === undefined) return this._style.textSize;
    this._set({ textSize: s });
    this._draw('textSize', [s]);
  }
  textFont(f, s) {
    if (f === undefined) return this._style.textFont;
    this._set({ textFont: f, ...(s !== undefined ? { textSize: s } : {}) });
    this._record('textFont', s === undefined ? [f] : [f, s]);
  }
  textAlign(h, v) {
    if (h === undefined) return { horizontal: this._style.textAlignH, vertical: this._style.textAlignV };
    this._set({ textAlignH: h, ...(v !== undefined ? { textAlignV: v } : {}) });
    this._record('textAlign', v === undefined ? [h] : [h, v]);
  }
  textWidth(s) { return String(s).length * this._style.textSize * 0.6; }
  textAscent() { return this._style.textSize * 0.8; }
  textDescent() { return this._style.textSize * 0.2; }

  // ---- generic style setters / plain recorded ----
  // (defined in the loop after the class body)

  // ---- state stack ----
  push() {
    this._stack.push({ style: this._style, matrix: this._matrix.slice() });
    this._record('push', []);
  }
  pop() {
    const s = this._stack.pop();
    if (!s) { this.unbalancedPops++; this._record('pop', [], { unbalanced: true }); return; }
    this._style = s.style;
    this._matrix = s.matrix;
    this._record('pop', []);
  }

  // ---- transforms ----
  translate(x, y = 0) {
    this._checkNumbers('translate', [x, y]);
    const m = this._matrix;
    m[4] += m[0] * x + m[2] * y;
    m[5] += m[1] * x + m[3] * y;
    this._record('translate', y === 0 && arguments.length < 2 ? [x] : [x, y]);
  }
  rotate(angle) {
    this._checkNumbers('rotate', [angle]);
    const t = this._ang(angle), c = Math.cos(t), s = Math.sin(t), m = this._matrix;
    const a = m[0], b = m[1], cc = m[2], d = m[3];
    m[0] = a * c + cc * s; m[1] = b * c + d * s;
    m[2] = -a * s + cc * c; m[3] = -b * s + d * c;
    this._record('rotate', [angle]);
  }
  scale(sx, sy = sx) {
    this._checkNumbers('scale', [sx, sy]);
    const m = this._matrix;
    m[0] *= sx; m[1] *= sx; m[2] *= sy; m[3] *= sy;
    this._record('scale', arguments.length < 2 ? [sx] : [sx, sy]);
  }
  applyMatrix(a, b, c, d, e, f) {
    const m = this._matrix;
    const n = [
      m[0] * a + m[2] * b, m[1] * a + m[3] * b,
      m[0] * c + m[2] * d, m[1] * c + m[3] * d,
      m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
    ];
    this._matrix = n;
    this._record('applyMatrix', [a, b, c, d, e, f]);
  }
  resetMatrix() { this._matrix = [1, 0, 0, 1, 0, 0]; this._record('resetMatrix', []); }

  // ---- shapes ----
  line(...a) { this._draw('line', a); }
  point(...a) { this._draw('point', a); }
  circle(...a) { this._draw('circle', a); }
  ellipse(...a) { this._draw('ellipse', a); }
  rect(...a) { this._draw('rect', a); }
  square(...a) { this._draw('square', a); }
  triangle(...a) { this._draw('triangle', a); }
  quad(...a) { this._draw('quad', a); }
  arc(...a) { this._draw('arc', a); }
  bezier(...a) { this._draw('bezier', a); }
  curve(...a) { this._draw('curve', a); }
  text(...a) {
    this._checkNumbers('text', a.slice(1));
    this._record('text', a);
  }
  image(...a) { this._draw('image', a); }
  beginShape(kind) {
    this._shape = { kind: kind ?? null, vertices: [] };
    this._record('beginShape', kind === undefined ? [] : [kind]);
  }
  _vertex(type, a) {
    this._checkNumbers(type, a);
    if (this._shape) this._shape.vertices.push({ type, args: Array.from(a), x: a[0], y: a[1] });
    this._record(type, a);
  }
  vertex(...a) { this._vertex('vertex', a); }
  curveVertex(...a) { this._vertex('curveVertex', a); }
  bezierVertex(...a) { this._vertex('bezierVertex', a); }
  quadraticVertex(...a) { this._vertex('quadraticVertex', a); }
  endShape(mode) {
    const sh = this._shape;
    this._shape = null;
    this._record('endShape', mode === undefined ? [] : [mode], {
      vertices: sh ? sh.vertices : [], kind: sh ? sh.kind : null, closed: mode === 'close',
    });
  }

  // ---- canvas / background ----
  _fillBuffer(rgba) { this._pixelBuffer = null; this._pendingFill = rgba; }
  _buffer() {
    const n = this.width * this._pixelDensity * this.height * this._pixelDensity * 4;
    if (!this._pixelBuffer || this._pixelBuffer.length !== n) {
      this._pixelBuffer = new Uint8ClampedArray(n);
      const f = this._pendingFill;
      if (f[0] || f[1] || f[2] || f[3]) for (let i = 0; i < n; i += 4) { this._pixelBuffer[i] = f[0]; this._pixelBuffer[i + 1] = f[1]; this._pixelBuffer[i + 2] = f[2]; this._pixelBuffer[i + 3] = f[3]; }
    }
    return this._pixelBuffer;
  }
  createCanvas(w, h, renderer) {
    this.width = w; this.height = h;
    this._pixelBuffer = null; this._pendingFill = [0, 0, 0, 0];
    this._record('createCanvas', renderer === undefined ? [w, h] : [w, h, renderer]);
    return this.canvas;
  }
  resizeCanvas(w, h) {
    this.width = w; this.height = h;
    this._pixelBuffer = null; this._pendingFill = [0, 0, 0, 0];
    this._record('resizeCanvas', [w, h]);
  }
  background(...a) {
    const isImage = a.length >= 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !a[0].levels;
    const c = isImage ? null : makeColor(a, this._cm());
    this.lastBackground = c;
    if (c) this._fillBuffer(c.levels);
    this._record('background', a);
  }
  clear() { this.lastBackground = null; this._fillBuffer([0, 0, 0, 0]); this._record('clear', []); }
  pixelDensity(d) {
    if (d === undefined) return this._pixelDensity;
    this._pixelDensity = d; this._pixelBuffer = null;
    this._record('pixelDensity', [d]);
  }
  displayDensity() { return 1; }
  createGraphics(w, h, renderer) {
    const g = new MockGraphics(w, h, { parent: this, seed: this._seed, strictNumbers: this.strictNumbers, pixelDensity: this._pixelDensity });
    this.graphics.push(g);
    this._record('createGraphics', renderer === undefined ? [w, h] : [w, h, renderer], { graphics: g });
    return g;
  }
  createImage(w, h) { return new MockImage(w, h); }
  loadPixels() {
    this.pixels = new Uint8ClampedArray(this._buffer());
    this._record('loadPixels', []);
  }
  updatePixels() {
    const buf = this._buffer();
    if (this.pixels.length === buf.length) buf.set(this.pixels);
    this._record('updatePixels', []);
  }
  get(x, y, w, h) {
    const d = this._pixelDensity, W = this.width * d, buf = this._buffer();
    const px = (xx, yy) => {
      if (xx < 0 || yy < 0 || xx >= this.width || yy >= this.height) return [0, 0, 0, 0];
      const i = (Math.floor(yy * d) * W + Math.floor(xx * d)) * 4;
      return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
    };
    if (x === undefined) { w = this.width; h = this.height; x = 0; y = 0; }
    else if (w === undefined) return px(x, y);
    const img = new MockImage(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img.pixels.set(px(x + i, y + j), (j * w + i) * 4);
    return img;
  }
  set(x, y, c) {
    const d = this._pixelDensity, W = this.width * d, buf = this._buffer();
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const lv = c instanceof MockColor ? c.levels : (typeof c === 'number' ? [c, c, c, 255] : (Array.isArray(c) ? c : makeColor([c], this._cm()).levels));
    // p5 writes the whole density x density block
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
      const k = ((Math.floor(y * d) + j) * W + Math.floor(x * d) + i) * 4;
      buf[k] = lv[0]; buf[k + 1] = lv[1]; buf[k + 2] = lv[2]; buf[k + 3] = lv[3] === undefined ? 255 : lv[3];
    }
  }

  // ---- misc ----
  cursor(t) { this._cursor = t === undefined ? 'default' : t; this._record('cursor', t === undefined ? [] : [t]); }
  get cursorType() { return this._cursor; }
  frameRate(f) {
    if (f === undefined) return this._frameRate;
    this._frameRate = f;
    this._record('frameRate', [f]);
  }
  getFrameRate() { return this._frameRate; }
  noLoop() { this._looping = false; this._record('noLoop', []); }
  loop() { this._looping = true; this._record('loop', []); }
  isLooping() { return this._looping; }
  remove() { this.removed = true; }
}

// Generic recorded setters / no-ops
for (const [fn, key] of Object.entries(SIMPLE_STYLE_SETTERS)) {
  MockGraphics.prototype[fn] = function simpleSetter(v) {
    if (v === undefined) return this._style[key];
    this._set({ [key]: v });
    this._record(fn, [v]);
  };
}
for (const fn of PLAIN_RECORDED) {
  MockGraphics.prototype[fn] = function plain(...a) { this._record(fn, a); };
}

// ---------------------------------------------------------------------------------------------
// MockP5

export class MockP5 extends MockGraphics {
  constructor(sketchFn, container, opts = {}) {
    const width = opts.width ?? 800, height = opts.height ?? 600;
    super(width, height, opts);
    this.container = container || null;
    this.windowWidth = opts.windowWidth ?? width;
    this.windowHeight = opts.windowHeight ?? height;
    this.removed = false;
    this.clearCallsEachFrame = !!opts.clearCallsEachFrame;
    this.drawCount = 0;
    // input state
    this.mouseX = 0; this.mouseY = 0; this.pmouseX = 0; this.pmouseY = 0;
    this.movedX = 0; this.movedY = 0;
    this.mouseIsPressed = false; this.mouseButton = null;
    this.key = ''; this.keyCode = 0; this.keyIsPressed = false;
    this.touches = [];
    this.deltaTime = 1000 / 60;
    this._millis = null;
    this._keysDown = new Set();
    const ctor = this.constructor;
    if (!Object.hasOwn(ctor, 'instances')) ctor.instances = [];
    ctor.instances.push(this);

    sketchFn(this);
    if (typeof this.preload === 'function') this.preload();
    if (typeof this.setup === 'function') this.setup();
  }

  _callHandler(name, ...args) {
    return typeof this[name] === 'function' ? this[name](...args) : undefined;
  }

  stepFrames(n = 1, { respectLoop = false } = {}) {
    let done = 0;
    for (let i = 0; i < n && !this.removed; i++) {
      if (respectLoop && !this._looping) break;
      this._frame();
      done++;
    }
    return done;
  }
  _frame() {
    this.frameCount = this._frameCount + 1;
    if (this.clearCallsEachFrame) this.clearCalls();
    this.drawCount++;
    if (typeof this.draw === 'function') this.draw();
    this.pmouseX = this.mouseX; this.pmouseY = this.mouseY; // like p5: updated after each frame
  }
  redraw(n = 1) {
    for (let i = 0; i < n && !this.removed; i++) this._frame();
  }
  millis() { return this._millis ?? (this.frameCount * 1000) / this._frameRate; }
  setMillis(ms) { this._millis = ms; }

  keyIsDown(code) {
    return this._keysDown.has(code);
  }

  // Calls the user's handler of that name if defined; returns its return value.
  fire(name, evt) {
    if (this.removed) return undefined;
    evt = evt || {};
    if (typeof evt.preventDefault !== 'function') {
      evt.defaultPrevented = false;
      evt.preventDefault = () => { evt.defaultPrevented = true; };
    }
    if (name === 'mouseWheel') {
      if (evt.delta === undefined) evt.delta = evt.deltaY ?? 0;
      if (evt.deltaY === undefined) evt.deltaY = evt.delta;
    }
    return this._callHandler(name, evt);
  }

  // ---- input helpers ----
  moveMouse(x, y, { fire = true } = {}) {
    this.pmouseX = this.mouseX; this.pmouseY = this.mouseY;
    this.mouseX = x; this.mouseY = y;
    this.movedX = x - this.pmouseX; this.movedY = y - this.pmouseY;
    if (fire) this.fire(this.mouseIsPressed ? 'mouseDragged' : 'mouseMoved');
  }
  pressMouse(x = this.mouseX, y = this.mouseY, button = 'left') {
    this.moveMouse(x, y, { fire: false });
    this.mouseIsPressed = true; this.mouseButton = button;
    return this.fire('mousePressed');
  }
  releaseMouse() {
    this.mouseIsPressed = false;
    const r = this.fire('mouseReleased');
    this.fire('mouseClicked');
    this.mouseButton = null;
    return r;
  }
  click(x, y, button = 'left') {
    this.pressMouse(x, y, button);
    this.releaseMouse();
  }
  pressKey(key, keyCode = 0) {
    this.key = key; this.keyCode = keyCode; this.keyIsPressed = true;
    this._keysDown.add(keyCode);
    const r = this.fire('keyPressed');
    this.fire('keyTyped');
    return r;
  }
  releaseKey(key = this.key, keyCode = this.keyCode) {
    this.key = key; this.keyCode = keyCode;
    this._keysDown.delete(keyCode);
    this.keyIsPressed = this._keysDown.size > 0;
    return this.fire('keyReleased');
  }
  setWindowSize(w, h) {
    this.windowWidth = w; this.windowHeight = h;
    return this.fire('windowResized');
  }

  remove() {
    this.removed = true;
    this._looping = false;
    for (const g of this.graphics) g.removed = true;
  }
}
MockP5.instances = [];

// Returns a MockP5 subclass with default options baked in, usable as `ctx.p5`:
//   const P5 = createMockP5({ width: 900, height: 500 });  new P5(fn, container);  P5.instances
export function createMockP5(defaults = {}) {
  return class extends MockP5 {
    static instances = [];
    constructor(sketchFn, container, opts) { super(sketchFn, container, { ...defaults, ...opts }); }
  };
}

// Runs fn and returns the names of globalThis properties it created (implicit globals). Leaked
// properties are deleted afterwards unless { cleanup: false }. Note ES modules are strict mode:
// assigning an undeclared variable throws there, so this mainly catches `globalThis.x = ...` and
// sloppy-mode scripts.
export function detectLeakedGlobals(fn, { cleanup = true } = {}) {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  const result = fn();
  const leaked = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k)).sort();
  if (cleanup) for (const k of leaked) { try { delete globalThis[k]; } catch { /* non-configurable */ } }
  if (result && typeof result.then === 'function') {
    throw new Error('detectLeakedGlobals: fn must be synchronous; use detectLeakedGlobalsAsync');
  }
  return leaked;
}

export async function detectLeakedGlobalsAsync(fn, { cleanup = true } = {}) {
  const before = new Set(Object.getOwnPropertyNames(globalThis));
  await fn();
  const leaked = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k)).sort();
  if (cleanup) for (const k of leaked) { try { delete globalThis[k]; } catch { /* ignore */ } }
  return leaked;
}
