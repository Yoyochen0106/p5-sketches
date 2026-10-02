// Persistent, observable key/value store for sketch settings.
//
// createStore({ namespace, storage, hashSync, defaults })
//   storage  : { getItem, setItem, removeItem } (default: localStorage with in-memory fallback)
//   hashSync : { read() -> {key: string}, write({key: string}) } or null (see router.createHashSync)
//
// Values are JSON-serialisable. localStorage holds the whole store as one JSON blob under
// `p5s:<namespace>`. Hash params override stored values on creation. Only values that differ
// from the default last passed to get(key, default) are mirrored into the hash.

export function createMemoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

export function defaultStorage() {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = '__p5s_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch { /* blocked storage: fall through */ }
  return createMemoryStorage();
}

// Encode a value as a hash param string. Plain strings stay plain unless JSON.parse would
// read them back as something else (e.g. the string "12" or "true").
export function encodeValue(v) {
  if (typeof v === 'string') {
    try { JSON.parse(v); return JSON.stringify(v); } catch { return v; }
  }
  return JSON.stringify(v);
}

export function decodeValue(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function same(a, b) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function createStore({ namespace = 'default', storage, hashSync = null, defaults = {} } = {}) {
  const store_ = storage || defaultStorage();
  const storageKey = `p5s:${namespace}`;
  const values = Object.create(null);
  const knownDefaults = Object.create(null);
  const listeners = new Set();

  // 1. storage
  try {
    const raw = store_.getItem(storageKey);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) Object.assign(values, obj);
    }
  } catch { /* corrupt or blocked: start empty */ }

  // 2. hash overrides
  if (hashSync) {
    try {
      const params = hashSync.read() || {};
      for (const k of Object.keys(params)) values[k] = decodeValue(params[k]);
    } catch { /* ignore */ }
  }
  Object.assign(knownDefaults, defaults);

  function persist() {
    try { store_.setItem(storageKey, JSON.stringify(values)); } catch { /* ignore */ }
    if (hashSync) {
      const out = {};
      for (const k of Object.keys(values)) {
        if (k in knownDefaults && same(values[k], knownDefaults[k])) continue;
        out[k] = encodeValue(values[k]);
      }
      try { hashSync.write(out); } catch { /* ignore */ }
    }
  }

  function notify(key, value) {
    for (const fn of [...listeners]) fn(key, value);
  }

  const store = {
    namespace,
    get(key, def) {
      if (def !== undefined) knownDefaults[key] = def;
      return key in values ? values[key] : (def !== undefined ? def : knownDefaults[key]);
    },
    set(key, value) {
      if (value === undefined) {
        if (!(key in values)) return;
        delete values[key];
      } else {
        if (key in values && same(values[key], value)) return;
        values[key] = value;
      }
      persist();
      notify(key, value);
    },
    has(key) { return key in values; },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    all() { return { ...values }; },
    reset() {
      for (const k of Object.keys(values)) delete values[k];
      persist();
      notify(null, undefined);
    },
  };
  return store;
}
