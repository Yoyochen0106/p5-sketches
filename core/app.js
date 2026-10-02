// App shell: menu page, sketch page (top bar + container + settings drawer), theme, routing.
// createApp() takes all environment pieces as options so Node tests can inject fakes; the
// module auto-starts only when a real browser document with #app exists.

import { parseHash, buildHash, buildCourseHash, onRoute, createHashSync } from './router.js';
import { createStore } from './settings.js';
import * as ui from './ui.js';
import { h, clear } from './ui.js';

const THEMES = ['dark', 'light', 'auto'];
const THEME_LABEL = { dark: 'Dark', light: 'Light', auto: 'Auto' };

export function createApp(opts = {}) {
  const document = opts.document || globalThis.document;
  const win = opts.window || globalThis.window || globalThis;
  const storage = opts.storage; // undefined -> settings picks localStorage / memory
  const registry = opts.registry || [];
  const courses = opts.courses || [];
  const byId = (id) => registry.find((s) => s.id === id);
  const courseById = (id) => courses.find((c) => c.id === id);
  const unitsOf = (c) => c.units.map(byId).filter(Boolean);
  const isPlanned = (e) => !!(e && (e.planned || typeof e.load !== 'function'));
  const resizeDebounce = opts.debounceMs ?? 120;
  const root = opts.root || document.getElementById('app') || document.body;
  const getP5 = () => opts.p5 || win.p5;

  const globalSettings = createStore({ namespace: 'global', storage, hashSync: null });

  let stopRouting = null;
  let chain = Promise.resolve();
  let ticket = 0;
  let session = null; // active sketch session { id, teardown() }
  let routeState = { id: null };

  // ---- theme ----------------------------------------------------------------------------
  function applyTheme() {
    let t = globalSettings.get('theme', 'dark');
    if (!THEMES.includes(t)) t = 'dark';
    document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme();
  const unsubTheme = globalSettings.subscribe((k) => { if (k === 'theme' || k === null) applyTheme(); });

  function themeButton() {
    const btn = h('button', { type: 'button', class: 'bar-btn theme-btn', title: 'Cycle theme (dark / light / auto)' });
    const paint = () => {
      const t = globalSettings.get('theme', 'dark');
      btn.textContent = `Theme: ${THEME_LABEL[t] || t}`;
    };
    btn.addEventListener('click', () => {
      const t = globalSettings.get('theme', 'dark');
      globalSettings.set('theme', THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]);
    });
    paint();
    const unsub = globalSettings.subscribe(paint);
    return { el: btn, dispose: unsub };
  }

  // ---- pages ----------------------------------------------------------------------------
  // collapsible home sections are remembered in globalSettings ('collapsed:<name>')
  function section(name, title, bodyEl, extraClass) {
    const key = `collapsed:${name}`;
    let collapsed = globalSettings.get(key, false) === true;
    const btn = h('button', { type: 'button', class: 'section-toggle', 'data-section': name });
    const body = h('div', { class: 'section-body' }, bodyEl);
    const paint = () => {
      btn.textContent = `${collapsed ? '▸' : '▾'} ${title}`;
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      body.hidden = collapsed;
    };
    btn.addEventListener('click', () => { collapsed = !collapsed; globalSettings.set(key, collapsed); paint(); });
    paint();
    return h('section', { class: `home-section ${extraClass || ''}`, 'data-section': name }, h('h2', { class: 'section-title' }, btn), body);
  }

  const miscEntries = () => registry.filter((s) => (s.group || 'misc') !== 'course');

  function renderMenu() {
    clear(root);
    const theme = themeButton();
    const miscCards = miscEntries().map((s) =>
      h('a', { class: 'card', href: buildHash(s.id), 'data-id': s.id },
        h('h2', null, s.title), h('p', null, s.description || '')));
    const courseCards = courses.map((c) => {
      const units = unitsOf(c);
      const done = units.filter((u) => !isPlanned(u)).length;
      return h('a', { class: 'course-card', href: buildCourseHash(c.id), 'data-id': c.id, style: c.accent ? { borderTopColor: c.accent } : null },
        h('h3', null, c.title), h('p', null, c.description || ''),
        h('div', { class: 'course-meta' }, `${units.length} units · ${done} implemented`));
    });
    const page = h('div', { class: 'menu-page' },
      h('header', { class: 'menu-header' }, h('h1', null, 'p5 sketches'), theme.el),
      courses.length ? section('courses', 'Courses', h('div', { class: 'course-cards' }, courseCards), 'courses-section') : null,
      section('misc', 'Misc', h('div', { class: 'cards' }, miscCards), 'misc-section'));
    root.appendChild(page);
    return () => { theme.dispose(); clear(root); };
  }

  const visitedList = () => {
    const v = globalSettings.get('visited', []);
    return Array.isArray(v) ? v : [];
  };
  function markVisited(id) {
    const v = visitedList();
    if (!v.includes(id)) globalSettings.set('visited', [...v, id]);
  }

  function renderCourse(course) {
    clear(root);
    const theme = themeButton();
    const visited = visitedList();
    const units = unitsOf(course);
    const tagLink = (r) => {
      const t = byId(r.id);
      return h('a', { class: 'tag related', href: buildHash(r.id, r.params || {}), title: r.why || '' }, `→ ${r.label || (t && t.title) || r.id}`);
    };
    const items = units.map((u, i) => {
      const planned = isPlanned(u);
      const prereqs = (u.prereqs || []).map((id) => h('span', { class: 'tag prereq' }, `needs: ${(byId(id) || { title: id }).title}`));
      const related = (u.related || []).map(tagLink);
      return h('li', { class: `unit-card${planned ? ' planned' : ''}`, 'data-id': u.id },
        h('span', { class: 'unit-num' }, String(u.unit || i + 1)),
        h('div', { class: 'unit-main' },
          h('h3', null,
            planned ? h('span', { class: 'unit-title' }, u.title) : h('a', { class: 'unit-link', href: buildHash(u.id) }, u.title),
            planned ? h('span', { class: 'badge planned-badge' }, 'planned') : null,
            visited.includes(u.id) ? h('span', { class: 'visited', title: 'visited' }, '✓') : null),
          h('p', null, u.description || ''),
          prereqs.length || related.length ? h('div', { class: 'tags' }, prereqs, related) : null));
    });
    const page = h('div', { class: 'menu-page course-page' },
      h('header', { class: 'menu-header' },
        h('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), h('span', { class: 'sep' }, ' › '), h('span', { class: 'current' }, course.title)),
        theme.el),
      h('h1', { class: 'course-title' }, course.title),
      h('p', { class: 'course-desc' }, course.description || ''),
      h('ol', { class: 'unit-list' }, items));
    root.appendChild(page);
    return () => { theme.dispose(); clear(root); };
  }

  // top-bar navigation for a sketch that is a course unit: breadcrumb, prev/next, unit dropdown
  function courseNav(entry) {
    const course = entry.course && courseById(entry.course);
    if (!course) return null;
    const units = unitsOf(course);
    const idx = units.findIndex((u) => u.id === entry.id);
    if (idx < 0) return null;
    const find = (dir) => {
      for (let i = idx + dir; i >= 0 && i < units.length; i += dir) if (!isPlanned(units[i])) return units[i];
      return null;
    };
    const arrow = (cls, label, target, title) => (target
      ? h('a', { class: `bar-btn unit-nav ${cls}`, href: buildHash(target.id), title: `${title}: ${target.title}` }, label)
      : h('span', { class: `bar-btn unit-nav ${cls} disabled`, 'aria-disabled': 'true', title: `${title}: none` }, label));
    const select = h('select', { class: 'unit-select', 'aria-label': 'Unit' },
      units.map((u, i) => h('option', { value: u.id, selected: u.id === entry.id, disabled: isPlanned(u) },
        `${i + 1}. ${u.title}${isPlanned(u) ? ' (planned)' : ''}`)));
    select.value = entry.id;
    select.addEventListener('change', () => { if (select.value && select.value !== entry.id) win.location.hash = buildHash(select.value); });
    return h('div', { class: 'course-nav' },
      h('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' },
        h('a', { href: buildCourseHash(course.id), title: course.title }, course.title),
        h('span', { class: 'sep' }, ' › '),
        h('span', { class: 'unit-pos' }, `Unit ${idx + 1}/${units.length}`)),
      arrow('unit-prev', '‹ Prev', find(-1), 'Previous unit'),
      select,
      arrow('unit-next', 'Next ›', find(1), 'Next unit'));
  }

  function relatedSection(entry) {
    const rel = entry.related || [];
    if (!rel.length) return null;
    return h('div', { class: 'related' },
      h('h3', null, 'Related'),
      h('ul', null, rel.map((r) => {
        const t = byId(r.id);
        const text = [h('span', { class: 'related-label' }, r.label || (t && t.title) || r.id), r.why ? h('span', { class: 'related-why' }, r.why) : null];
        if (!t || isPlanned(t)) return h('li', { class: 'related-item disabled', 'data-id': r.id }, text, h('span', { class: 'related-soon' }, 'coming soon'));
        return h('li', { class: 'related-item', 'data-id': r.id }, h('a', { href: buildHash(r.id, r.params || {}) }, text));
      })));
  }

  async function renderSketch(entry, route, myTicket) {
    clear(root);
    const theme = themeButton();
    const toolbar = h('div', { class: 'toolbar' });
    const container = h('div', { class: 'sketch-container' });
    const drawer = h('div', { class: 'drawer-body' });
    const drawerBtn = h('button', { type: 'button', class: 'bar-btn drawer-btn', 'aria-expanded': 'true', title: 'Settings (d)' }, 'Settings');
    const fsBtn = h('button', { type: 'button', class: 'bar-btn fs-btn', title: 'Fullscreen' }, 'Fullscreen');
    const back = h('a', { class: 'bar-btn back', href: '#/', title: 'Back to menu' }, 'Menu');
    const aside = h('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Settings' }, drawer, relatedSection(entry));
    const page = h('div', { class: 'sketch-page' },
      h('header', { class: 'topbar' }, back, courseNav(entry), h('span', { class: 'title' }, entry.title), toolbar, theme.el, fsBtn, drawerBtn),
      h('main', { class: 'stage' }, container, aside));
    root.appendChild(page);
    if (entry.course) markVisited(entry.id);

    const narrow = !!(win.matchMedia && win.matchMedia('(max-width: 640px)').matches);
    let open = globalSettings.get('drawerOpen', !narrow) !== false;
    const paintDrawer = () => {
      page.classList.toggle('drawer-open', open);
      drawerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      aside.setAttribute('aria-hidden', open ? 'false' : 'true');
    };
    const setOpen = (v) => { open = v; globalSettings.set('drawerOpen', v); paintDrawer(); };
    paintDrawer();
    drawerBtn.addEventListener('click', () => setOpen(!open));
    fsBtn.addEventListener('click', () => {
      try {
        const r = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        if (r && r.catch) r.catch(() => {});
      } catch { /* not supported */ }
    });
    const onKey = (e) => {
      if (e.key !== 'd' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      setOpen(!open);
    };
    document.addEventListener('keydown', onKey);

    // resize plumbing
    const resizeFns = new Set();
    let timer = null;
    const size = () => ({ width: container.clientWidth, height: container.clientHeight });
    const onWinResize = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const s = size();
        for (const fn of [...resizeFns]) { try { fn(s); } catch (err) { console.error(err); } }
      }, resizeDebounce);
    };
    win.addEventListener('resize', onWinResize);
    // the drawer changes the container size without a window resize
    let observer = null;
    if (typeof win.ResizeObserver === 'function') {
      observer = new win.ResizeObserver(() => onWinResize());
      observer.observe(container);
    }

    const settings = createStore({
      namespace: `sketch:${entry.id}`, storage, hashSync: createHashSync(win, entry.id),
    });

    let handle = null;
    let tornDown = false;
    const teardown = async () => {
      if (tornDown) return;
      tornDown = true;
      document.removeEventListener('keydown', onKey);
      win.removeEventListener('resize', onWinResize);
      if (observer) { observer.disconnect(); observer = null; }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      resizeFns.clear();
      theme.dispose();
      try { if (handle && handle.unmount) await handle.unmount(); } catch (err) { console.error(err); }
      handle = null;
      clear(drawer); clear(toolbar); clear(container);
      clear(root);
    };
    session = { id: entry.id, teardown };

    const ctx = {
      p5: getP5(), settings, globalSettings, ui, drawer, toolbar,
      onResize(fn) { resizeFns.add(fn); return () => resizeFns.delete(fn); },
      size,
      link: (id, params) => buildHash(id, params || {}),
      navigate: (id, params) => { win.location.hash = buildHash(id, params || {}); },
    };
    try {
      const mod = await entry.load();
      const sketch = mod.default || mod;
      const mounted = await sketch.mount(container, ctx);
      handle = mounted || null;
    } catch (err) {
      console.error(err);
      container.appendChild(h('pre', { class: 'error-box' }, `Failed to load sketch "${entry.id}":\n${err && err.message ? err.message : err}`));
    }
  }

  // ---- routing --------------------------------------------------------------------------
  async function leave() {
    const s = session;
    session = null;
    if (s) await s.teardown();
    if (routeState.cleanup) { routeState.cleanup(); routeState.cleanup = null; }
  }

  async function handleRoute(route, myTicket) {
    if (myTicket !== ticket) return; // superseded while queued
    await leave();
    if (myTicket !== ticket) return;
    const entry = route.id ? byId(route.id) : null;
    const course = route.course !== undefined ? courseById(route.course) : null;
    const fixUrl = (to) => { if (win.history && win.history.replaceState) win.history.replaceState(null, '', to); };
    if (course) {
      routeState = { id: '', course: course.id, cleanup: renderCourse(course) };
    } else if (!route.id) {
      if (route.course !== undefined) fixUrl('#/'); // unknown course
      routeState = { id: '', cleanup: renderMenu() };
    } else if (!entry) {
      // unknown route: fall back to the menu and fix the URL without adding a history entry
      fixUrl('#/');
      routeState = { id: '', cleanup: renderMenu() };
    } else if (isPlanned(entry)) {
      // not implemented yet: show its course page (or the menu)
      const c = entry.course && courseById(entry.course);
      fixUrl(c ? buildCourseHash(c.id) : '#/');
      routeState = c ? { id: '', course: c.id, cleanup: renderCourse(c) } : { id: '', cleanup: renderMenu() };
    } else {
      routeState = { id: entry.id };
      await renderSketch(entry, route, myTicket);
    }
  }

  function navigate(route) {
    const my = ++ticket;
    chain = chain.then(() => handleRoute(route, my)).catch((e) => console.error(e));
    return chain;
  }

  function start() {
    stopRouting = onRoute((r) => { navigate(r); }, win);
    return chain;
  }

  async function stop() {
    if (stopRouting) { stopRouting(); stopRouting = null; }
    ticket++;
    await chain;
    await leave();
    unsubTheme();
  }

  return {
    start, stop, navigate, globalSettings,
    whenIdle: () => chain,
    current: () => (session ? session.id : routeState.id),
  };
}

// ---- browser auto-start ---------------------------------------------------------------------
if (typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined' && globalThis.document.getElementById
    && globalThis.document.getElementById('app')) {
  const { SKETCHES, COURSES } = await import('../sketches/registry.js');
  const app = createApp({ registry: SKETCHES, courses: COURSES });
  globalThis.__app = app;
  app.start();
}

export { parseHash };
