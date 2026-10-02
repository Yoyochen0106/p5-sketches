// Small helpers shared by the electromagnetics course units (em-tline, em-antenna).

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const fmt = (v, d = 4) => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : v > 0 ? 'inf' : v < 0 ? '-inf' : '-');
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
/** Rounds to `d` decimals (for settings written back to the URL hash). */
export const round = (v, d = 3) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** Settings store with defaults filled in, as expected by core/ui.js. */
export function withDefaults(store, DEFAULTS) {
  return {
    get: (k, d) => store.get(k, d !== undefined ? d : DEFAULTS[k]),
    set: (k, v) => store.set(k, v),
    subscribe: (fn) => store.subscribe(fn),
    all: () => store.all && store.all(),
    reset: () => store.reset && store.reset(),
  };
}

/** Hash for a deep link: '#/<id>?k=v&...' (values JSON-encoded like core/settings does). */
export function linkHash(id, params = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  }
  return `#/${id}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** Navigates to another unit (no-op outside a browser). Returns the hash it would use. */
export function openUnit(id, params) {
  const h = linkHash(id, params);
  try {
    if (typeof location !== 'undefined') location.hash = h;
  } catch { /* ignore */ }
  return h;
}

/** Drawer buttons "Open in..." for a list of [label, id, params]. */
export function openInNodes(links) {
  return links.map(([label, id, params]) => ({ type: 'button', label, onClick: () => openUnit(id, params), link: linkHash(id, params) }));
}

/** True when keyboard events should be left to a focused form control. */
export function typing(k) {
  const el = globalThis.document && globalThis.document.activeElement;
  if (!el) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable) return true;
  return /^(BUTTON|A)$/.test(el.tagName || '') && (k === ' ' || k === 'Enter');
}

export const onCanvas = (p, e) => !e || !e.target || !p.canvas || e.target === p.canvas || e.target === p.canvas.elt;
