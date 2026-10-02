// App shell: menu page, sketch page (top bar + container + settings drawer), theme, routing.
// createApp() takes all environment pieces as options so Node tests can inject fakes; the
// module auto-starts only when a real browser document with #app exists.

import { parseHash, buildHash, onRoute, createHashSync } from './router.js';
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
  function renderMenu() {
    clear(root);
    const theme = themeButton();
    const cards = registry.map((s) =>
      h('a', { class: 'card', href: buildHash(s.id), 'data-id': s.id },
        h('h2', null, s.title), h('p', null, s.description || '')));
    const page = h('div', { class: 'menu-page' },
      h('header', { class: 'menu-header' }, h('h1', null, 'p5 sketches'), theme.el),
      h('main', { class: 'cards' }, cards));
    root.appendChild(page);
    return () => { theme.dispose(); clear(root); };
  }

  async function renderSketch(entry, route, myTicket) {
    clear(root);
    const theme = themeButton();
    const toolbar = h('div', { class: 'toolbar' });
    const container = h('div', { class: 'sketch-container' });
    const drawer = h('div', { class: 'drawer-body' });
    const drawerBtn = h('button', { type: 'button', class: 'bar-btn drawer-btn', 'aria-expanded': 'true', title: 'Settings (s)' }, 'Settings');
    const fsBtn = h('button', { type: 'button', class: 'bar-btn fs-btn', title: 'Fullscreen' }, 'Fullscreen');
    const back = h('a', { class: 'bar-btn back', href: '#/', title: 'Back to menu' }, 'Menu');
    const aside = h('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Settings' }, drawer);
    const page = h('div', { class: 'sketch-page' },
      h('header', { class: 'topbar' }, back, h('span', { class: 'title' }, entry.title), toolbar, theme.el, fsBtn, drawerBtn),
      h('main', { class: 'stage' }, container, aside));
    root.appendChild(page);

    let open = globalSettings.get('drawerOpen', true) !== false;
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
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      } catch { /* not supported */ }
    });
    const onKey = (e) => {
      if (e.key !== 's' || e.ctrlKey || e.metaKey || e.altKey) return;
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
    const entry = route.id ? registry.find((s) => s.id === route.id) : null;
    if (!route.id) {
      routeState = { id: '', cleanup: renderMenu() };
    } else if (!entry) {
      // unknown route: fall back to the menu and fix the URL without adding a history entry
      if (win.history && win.history.replaceState) win.history.replaceState(null, '', '#/');
      routeState = { id: '', cleanup: renderMenu() };
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
  const { SKETCHES } = await import('../sketches/registry.js');
  const app = createApp({ registry: SKETCHES });
  globalThis.__app = app;
  app.start();
}

export { parseHash };
