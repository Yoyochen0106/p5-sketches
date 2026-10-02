// Declarative settings UI. Pure DOM; `document` is taken lazily from globalThis so tests can
// inject a fake. Controls read/write store.get/set and refresh on store.subscribe.

const PROP_ATTRS = new Set(['value', 'checked', 'disabled', 'hidden', 'id', 'textContent', 'className']);

function doc() {
  const d = globalThis.document;
  if (!d) throw new Error('ui: no document available');
  return d;
}

// h('div', {class:'x', onClick: fn, style:{color:'red'}}, 'text', childEl, [more])
export function h(tag, attrs, ...children) {
  const d = doc();
  const el = d.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (/^on[A-Z]/.test(k)) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROP_ATTRS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  appendAll(el, children);
  return el;
}

function appendAll(el, children) {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else if (typeof c === 'object') el.appendChild(c);
    else el.appendChild(doc().createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Read without registering a default in the store (the sketch owns defaults).
const read = (store, key, fallback) => { const v = store.get(key); return v === undefined ? fallback : v; };

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function normOptions(options) {
  return (options || []).map((o) => (typeof o === 'object' && o !== null ? o : { value: o, label: String(o) }));
}

const defaultFormat = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  return String(Math.round(v * 1e6) / 1e6);
};

// ---- node builders: each returns { el, update() } --------------------------------------------

function buildToggle(n, store) {
  const id = nextId('tg');
  const input = h('input', { type: 'checkbox', id, class: 'ui-toggle-input' });
  input.addEventListener('change', () => store.set(n.key, !!input.checked));
  const chip = n.color ? h('span', { class: 'ui-chip', style: { background: n.color } }) : null;
  const el = h('div', { class: 'ui-node ui-toggle' }, input, chip, h('label', { for: id }, n.label));
  return { el, update() { input.checked = !!store.get(n.key); } };
}

function buildSlider(n, store) {
  const id = nextId('sl');
  const fmt = n.format || defaultFormat;
  const input = h('input', { type: 'range', id, min: n.min, max: n.max, step: n.step ?? 'any', class: 'ui-slider-input' });
  const out = h('output', { for: id, class: 'ui-readout' });
  input.addEventListener('input', () => store.set(n.key, Number(input.value)));
  const el = h('div', { class: 'ui-node ui-slider' },
    h('div', { class: 'ui-row' }, h('label', { for: id }, n.label), out), input);
  return {
    el,
    update() {
      const v = read(store, n.key, n.default ?? n.min);
      input.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

function buildSelect(n, store) {
  const id = nextId('se');
  const opts = normOptions(n.options);
  const select = h('select', { id, class: 'ui-select-input' },
    opts.map((o) => h('option', { value: String(o.value) }, o.label)));
  select.addEventListener('change', () => {
    const o = opts.find((x) => String(x.value) === select.value);
    store.set(n.key, o ? o.value : select.value);
  });
  const el = h('div', { class: 'ui-node ui-select' }, h('label', { for: id }, n.label), select);
  return { el, update() { select.value = String(read(store, n.key, opts.length ? opts[0].value : '')); } };
}

function buildButton(n) {
  const b = h('button', { type: 'button', class: 'ui-button' }, n.label);
  b.addEventListener('click', (e) => { if (n.onClick) n.onClick(e); });
  return { el: h('div', { class: 'ui-node ui-button-wrap' }, b), update() {} };
}

function buildColor(n, store) {
  const id = nextId('co');
  const input = h('input', { type: 'color', id, class: 'ui-color-input' });
  input.addEventListener('input', () => store.set(n.key, input.value));
  const el = h('div', { class: 'ui-node ui-color' }, h('label', { for: id }, n.label), input);
  return { el, update() { input.value = String(read(store, n.key, '#000000')); } };
}

function buildText(n, store) {
  const id = nextId('tx');
  const input = h('input', { type: 'text', id, class: 'ui-text-input', placeholder: n.placeholder, spellcheck: 'false', autocomplete: 'off' });
  const err = h('div', { class: 'ui-error', role: 'alert' });
  let invalid = false;
  const showError = (msg) => {
    err.textContent = msg || '';
    err.hidden = !msg;
    invalid = !!msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  };
  showError(null);
  input.addEventListener('input', () => {
    const v = input.value;
    const msg = n.validate ? n.validate(v) : null;
    showError(msg);
    if (!msg) store.set(n.key, v);
  });
  const el = h('div', { class: 'ui-node ui-text' }, h('label', { for: id }, n.label), input, err);
  return {
    el,
    update() {
      if (invalid) return; // do not clobber what the user is typing
      const v = String(read(store, n.key, ''));
      if (input.value !== v) input.value = v;
    },
  };
}

function buildInfo(n) {
  return { el: h('p', { class: 'ui-node ui-info' }, n.text), update() {} };
}

function buildTabs(n, store) {
  const opts = normOptions(n.options);
  const el = h('div', { class: 'ui-node ui-tabs', role: 'tablist' });
  const buttons = opts.map((o) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'ui-tab', 'data-value': String(o.value) }, o.label);
    b.addEventListener('click', () => store.set(n.key, o.value));
    el.appendChild(b);
    return b;
  });
  return {
    el,
    update() {
      const cur = read(store, n.key, opts.length ? opts[0].value : undefined);
      opts.forEach((o, i) => {
        const on = o.value === cur;
        buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
        buttons[i].setAttribute('tabindex', on ? '0' : '-1');
        if (on) buttons[i].classList.add('active'); else buttons[i].classList.remove('active');
      });
    },
  };
}

function buildGroup(n, store, ctx) {
  let collapsed = !!n.collapsed;
  const bodyId = nextId('gr');
  const toggleBtn = h('button', { type: 'button', class: 'ui-group-toggle', 'aria-controls': bodyId }, n.label);
  let enable = null;
  if (n.enabledKey) {
    enable = h('input', { type: 'checkbox', class: 'ui-group-enable', 'aria-label': `Enable ${n.label}` });
    enable.addEventListener('change', () => store.set(n.enabledKey, !!enable.checked));
  }
  const header = h('div', { class: 'ui-group-header' }, enable, toggleBtn);
  const body = h('div', { class: 'ui-group-body', id: bodyId });
  const el = h('div', { class: 'ui-node ui-group' }, header, body);
  const kids = (n.children || []).map((c) => buildNode(c, store, ctx));
  for (const k of kids) body.appendChild(k.el);
  const applyCollapsed = () => {
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    body.hidden = collapsed;
    if (collapsed) el.classList.add('collapsed'); else el.classList.remove('collapsed');
  };
  toggleBtn.addEventListener('click', () => { collapsed = !collapsed; applyCollapsed(); });
  applyCollapsed();
  return {
    el,
    update() {
      if (enable) {
        enable.checked = !!store.get(n.enabledKey);
        body.classList.toggle('disabled', !enable.checked);
      }
      for (const k of kids) k.update();
    },
  };
}

const BUILDERS = {
  toggle: buildToggle, slider: buildSlider, select: buildSelect, button: buildButton,
  color: buildColor, text: buildText, group: buildGroup, tabs: buildTabs, info: buildInfo,
};

function buildNode(node, store, ctx) {
  const fn = BUILDERS[node.type];
  if (!fn) throw new Error(`ui.build: unknown node type "${node.type}"`);
  const built = fn(node, store, ctx);
  const update = () => {
    if (node.visibleIf) {
      const vis = !!node.visibleIf(store);
      built.el.hidden = !vis;
      if (!vis) return;
    }
    built.update();
  };
  return { el: built.el, update };
}

export function build(schema, store, parentEl, opts = {}) {
  const root = h('div', { class: opts.class ? `ui-root ${opts.class}` : 'ui-root' });
  const nodes = (schema || []).map((n) => buildNode(n, store, opts));
  for (const n of nodes) root.appendChild(n.el);
  if (parentEl) parentEl.appendChild(root);
  const refresh = () => { for (const n of nodes) n.update(); };
  refresh();
  let unsub = store.subscribe(refresh);
  let destroyed = false;
  return {
    el: root,
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (unsub) unsub();
      unsub = null;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
