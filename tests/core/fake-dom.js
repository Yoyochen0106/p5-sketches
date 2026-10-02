// Minimal fake DOM for Node tests. Supports only what core/ui.js and core/app.js need.

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
}

class Listeners {
  constructor() { this.map = new Map(); }
  add(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
  }
  remove(type, fn) {
    const l = this.map.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  fire(type, ev, target) {
    for (const fn of [...(this.map.get(type) || [])]) fn.call(target, ev);
  }
  count(type) { return (this.map.get(type) || []).length; }
}

class ClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(this.el.className.split(/\s+/).filter(Boolean)); }
  _write(s) { this.el.className = [...s].join(' '); }
  add(...c) { const s = this._set(); c.forEach((x) => s.add(x)); this._write(s); }
  remove(...c) { const s = this._set(); c.forEach((x) => s.delete(x)); this._write(s); }
  contains(c) { return this._set().has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.contains(c) : !!force;
    if (on) this.add(c); else this.remove(c);
    return on;
  }
}

export class FakeNode {
  constructor() { this.parentNode = null; this.childNodes = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error('removeChild: not a child');
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
}

export class FakeText extends FakeNode {
  constructor(text) { super(); this.nodeType = 3; this.data = text; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

export class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.id = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Listeners();
    this.classList = new ClassList(this);
    this.clientWidth = 800;
    this.clientHeight = 600;
  }
  setAttribute(k, v) {
    v = String(v);
    this.attributes[k] = v;
    if (k === 'class') this.className = v;
    else if (k === 'id') this.id = v;
    else if (k === 'value') this.value = v;
  }
  getAttribute(k) {
    if (k === 'class') return this.className || null;
    return k in this.attributes ? this.attributes[k] : null;
  }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new FakeText(String(v)));
  }
  addEventListener(t, fn) { this.listeners.add(t, fn); }
  removeEventListener(t, fn) { this.listeners.remove(t, fn); }
  dispatch(type, init) {
    const ev = new FakeEvent(type, init);
    ev.target = this;
    // bubble
    for (let n = this; n; n = n.parentNode) if (n.listeners) n.listeners.fire(type, ev, n);
    return ev;
  }
  click() { return this.dispatch('click'); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  requestFullscreen() { this.ownerDocument.fullscreenElement = this; return Promise.resolve(); }
  get tag() { return this.tagName.toLowerCase(); }
  // very small selector engine: comma-free, space-free: tag, .class, #id, [attr], [attr=val], combos
  matches(sel) {
    const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g;
    let m; let ok = true; let any = false;
    while ((m = re.exec(sel))) {
      any = true;
      if (m[1] && this.tag !== m[1].toLowerCase()) ok = false;
      if (m[2] && !this.classList.contains(m[2])) ok = false;
      if (m[3] && this.id !== m[3]) ok = false;
      if (m[4]) {
        const v = this.getAttribute(m[4]);
        if (v === null || (m[5] !== undefined && v !== m[5])) ok = false;
      }
    }
    return any && ok;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

export function createFakeDocument() {
  const document = {
    activeElement: null,
    fullscreenElement: null,
    listeners: new Listeners(),
    createElement(tag) { const e = new FakeElement(tag); e.ownerDocument = document; return e; },
    createTextNode(t) { return new FakeText(t); },
    addEventListener(t, fn) { document.listeners.add(t, fn); },
    removeEventListener(t, fn) { document.listeners.remove(t, fn); },
    dispatch(type, init) {
      const ev = new FakeEvent(type, init);
      document.listeners.fire(type, ev, document);
      return ev;
    },
    exitFullscreen() { document.fullscreenElement = null; return Promise.resolve(); },
  };
  document.body = document.createElement('body');
  document.documentElement = document.createElement('html');
  document.documentElement.appendChild(document.body);
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
  return document;
}

export function createFakeWindow(initialHash = '') {
  const listeners = new Listeners();
  const win = {
    innerWidth: 1000,
    innerHeight: 700,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { hash: initialHash },
    replaceCalls: [],
    history: {
      replaceState(_s, _t, url) { win.replaceCalls.push(url); win.location.hash = url; },
    },
    addEventListener(t, fn) { listeners.add(t, fn); },
    removeEventListener(t, fn) { listeners.remove(t, fn); },
    listenerCount: (t) => listeners.count(t),
    dispatch(type, init) { listeners.fire(type, new FakeEvent(type, init), win); },
    // simulate a user navigation
    navigate(hash) { win.location.hash = hash; win.dispatch('hashchange'); },
  };
  return win;
}

export function withFakeDocument(fn) {
  const prev = globalThis.document;
  const doc = createFakeDocument();
  globalThis.document = doc;
  const restore = () => { if (prev === undefined) delete globalThis.document; else globalThis.document = prev; };
  try {
    const r = fn(doc);
    if (r && typeof r.then === 'function') return r.finally(restore);
    restore();
    return r;
  } catch (e) { restore(); throw e; }
}
