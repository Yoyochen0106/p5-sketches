// Hash router. Routes look like  #/<id>?key=value&key2=value2  ; '#/' or '' is the menu.
// '#/course/<courseId>' is a course page: parseHash returns { id: '', course: '<courseId>', params }
// (the key `course` exists only for course routes). The sketch id 'course' is therefore reserved.

export function parseHash(hash) {
  let s = String(hash || '');
  if (s.startsWith('#')) s = s.slice(1);
  const qi = s.indexOf('?');
  const path = qi >= 0 ? s.slice(0, qi) : s;
  const query = qi >= 0 ? s.slice(qi + 1) : '';
  const id = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const params = {};
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue;
      const ei = part.indexOf('=');
      const k = safeDecode(ei >= 0 ? part.slice(0, ei) : part);
      const v = ei >= 0 ? safeDecode(part.slice(ei + 1)) : '';
      params[k] = v;
    }
  }
  if (id === 'course' || id.startsWith('course/')) {
    return { id: '', course: safeDecode(id.slice('course/'.length)), params };
  }
  return { id, params };
}

function safeDecode(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
}

export function buildHash(id, params = {}) {
  const base = `#/${id || ''}`;
  const parts = [];
  for (const k of Object.keys(params)) {
    if (params[k] === undefined || params[k] === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`);
  }
  return parts.length ? `${base}?${parts.join('&')}` : base;
}

export function buildCourseHash(courseId) {
  return `#/course/${encodeURIComponent(courseId)}`;
}

// Calls fn(route) now and on every hashchange. Returns an unsubscribe function.
export function onRoute(fn, win = globalThis) {
  const handler = () => fn(parseHash(win.location && win.location.hash));
  win.addEventListener('hashchange', handler);
  handler();
  return () => win.removeEventListener('hashchange', handler);
}

// hashSync adapter for settings.createStore: mirrors params into the current route's hash
// using replaceState (no hashchange event, no history spam).
export function createHashSync(win, id) {
  return {
    read() { return parseHash(win.location.hash).params; },
    write(params) {
      const next = buildHash(id, params);
      if (win.location.hash === next) return;
      if (win.history && win.history.replaceState) win.history.replaceState(null, '', next);
      else win.location.hash = next;
    },
  };
}
