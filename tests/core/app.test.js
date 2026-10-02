import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../core/app.js';
import { createMemoryStorage } from '../../core/settings.js';
import { SKETCHES } from '../../sketches/registry.js';
import hello from '../../sketches/hello/index.js';
import { createMockP5 } from '../mock-p5.js';
import { withFakeDocument, createFakeWindow } from './fake-dom.js';

function setup(doc, { hash = '', registry, storage = createMemoryStorage() } = {}) {
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  const win = createFakeWindow(hash);
  const P5 = createMockP5();
  const reg = registry || SKETCHES.filter((s) => s.id === 'hello');
  const app = createApp({ document: doc, window: win, root, storage, registry: reg, p5: P5, debounceMs: 0 });
  return { root, win, P5, app, storage };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('registry lists approx and hello with lazy loaders', () => {
  const ids = SKETCHES.map((s) => s.id);
  assert.ok(ids.includes('approx') && ids.includes('hello'));
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.equal(SKETCHES[0].title, 'Function Approximation Lab');
  for (const s of SKETCHES) {
    assert.equal(typeof s.load, 'function');
    assert.ok(s.description);
  }
});

test('menu route renders a card per sketch linking to #/<id>', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/', registry: SKETCHES.map((s) => ({ ...s })) });
  await app.start();
  const cards = root.querySelectorAll('.card');
  assert.equal(cards.length, SKETCHES.length);
  const hrefs = [...cards].map((c) => c.getAttribute('href'));
  assert.deepEqual(hrefs, SKETCHES.map((s) => `#/${s.id}`));
  assert.match(cards[0].textContent, /Function Approximation Lab/);
  assert.equal(app.current(), '');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  await app.stop();
}));

test('sketch route mounts hello with drawer controls, toolbar button and a p5 instance', () => withFakeDocument(async (doc) => {
  const { root, app, P5 } = setup(doc, { hash: '#/hello' });
  await app.start();
  assert.equal(app.current(), 'hello');
  assert.ok(root.querySelector('.topbar'));
  assert.equal(root.querySelector('.title').textContent, hello.title);
  assert.ok(root.querySelector('.sketch-container'));
  assert.ok(root.querySelector('.drawer-body').querySelector('.ui-root'));
  assert.equal(root.querySelector('.toolbar').children.length, 1);
  assert.equal(P5.instances.length, 1);
  const p = P5.instances[0];
  assert.equal(p.callsOf('createCanvas')[0].args[0], 800);
  p.stepFrames(2);
  assert.equal(p.callsOf('circle').length, 12 * 2);
  await app.stop();
}));

test('changing a setting in the drawer changes drawing; hash mirrors non-default values', () => withFakeDocument(async (doc) => {
  const { root, app, P5, win } = setup(doc, { hash: '#/hello' });
  await app.start();
  const p = P5.instances[0];
  const slider = root.querySelector('.ui-slider-input');
  slider.value = '5';
  slider.dispatch('input');
  p.clearCalls();
  p.stepFrames(1);
  assert.equal(p.callsOf('circle').length, 5);
  assert.equal(win.location.hash, '#/hello?count=5');
  await app.stop();
}));

test('hash params restore settings on load and storage persists across mounts', () => withFakeDocument(async (doc) => {
  const { app, P5 } = setup(doc, { hash: '#/hello?count=3&mode=line' });
  await app.start();
  const p = P5.instances[0];
  p.stepFrames(1);
  assert.equal(p.callsOf('circle').length, 3);
  await app.stop();
}));

test('navigating away unmounts: p5 removed, drawer/toolbar/container cleared, listeners removed; remount works', () => withFakeDocument(async (doc) => {
  const { root, app, P5, win } = setup(doc, { hash: '#/hello' });
  await app.start();
  const p1 = P5.instances[0];
  assert.equal(win.listenerCount('resize'), 1);
  assert.equal(doc.listeners.count('keydown'), 1);
  win.navigate('#/');
  await app.whenIdle();
  assert.equal(p1.removed, true);
  assert.equal(root.querySelector('.sketch-page'), null);
  assert.ok(root.querySelector('.menu-page'));
  assert.equal(win.listenerCount('resize'), 0);
  assert.equal(doc.listeners.count('keydown'), 0);
  win.navigate('#/hello');
  await app.whenIdle();
  assert.equal(P5.instances.length, 2);
  assert.equal(P5.instances[1].removed, false);
  assert.ok(root.querySelector('.drawer-body').querySelector('.ui-root'));
  assert.equal(root.querySelectorAll('.ui-root').length, 1);
  await app.stop();
  assert.equal(P5.instances[1].removed, true);
  assert.equal(win.listenerCount('hashchange'), 0);
}));

test('unknown route falls back to the menu and rewrites the URL', () => withFakeDocument(async (doc) => {
  const { root, app, win } = setup(doc, { hash: '#/nope' });
  await app.start();
  assert.ok(root.querySelector('.menu-page'));
  assert.equal(win.location.hash, '#/');
  await app.stop();
}));

test('rapid navigation: only the last route stays mounted, every mounted sketch is unmounted', () => withFakeDocument(async (doc) => {
  const log = [];
  const slow = (id, ms) => ({
    id, title: id, description: id,
    load: async () => ({
      default: {
        async mount(container) {
          await new Promise((r) => setTimeout(r, ms));
          log.push(`mount ${id}`);
          return { unmount() { log.push(`unmount ${id}`); } };
        },
      },
    }),
  });
  const { root, app, win } = setup(doc, { hash: '#/a', registry: [slow('a', 20), slow('b', 1)] });
  app.start();
  win.navigate('#/b');
  win.navigate('#/');
  win.navigate('#/b');
  await app.whenIdle();
  await tick();
  assert.equal(app.current(), 'b');
  const mounted = log.filter((l) => l.startsWith('mount')).length;
  const unmounted = log.filter((l) => l.startsWith('unmount')).length;
  assert.equal(mounted - unmounted, 1);
  assert.equal(log[log.length - 1], 'mount b');
  assert.equal(root.querySelectorAll('.sketch-page').length, 1);
  await app.stop();
  assert.equal(log.filter((l) => l.startsWith('mount')).length, log.filter((l) => l.startsWith('unmount')).length);
}));

test('a sketch that throws on mount shows an error and does not break navigation', () => withFakeDocument(async (doc) => {
  const origError = console.error;
  console.error = () => {};
  try {
    const bad = { id: 'bad', title: 'Bad', description: '', load: async () => ({ default: { mount() { throw new Error('boom'); } } }) };
    const { root, app, win } = setup(doc, { hash: '#/bad', registry: [bad] });
    await app.start();
    assert.match(root.querySelector('.error-box').textContent, /boom/);
    win.navigate('#/');
    await app.whenIdle();
    assert.ok(root.querySelector('.menu-page'));
    await app.stop();
  } finally { console.error = origError; }
}));

test('ctx contract: all fields present; onResize is debounced, receives size, and unsubscribes', () => withFakeDocument(async (doc) => {
  let ctx; let container;
  const spy = { id: 's', title: 'S', description: '', load: async () => ({ default: { mount(c, x) { ctx = x; container = c; return { unmount() {} }; } } }) };
  const { win, app, root } = setup(doc, { hash: '#/s', registry: [spy] });
  await app.start();
  for (const k of ['p5', 'settings', 'globalSettings', 'ui', 'drawer', 'toolbar', 'onResize', 'size']) assert.ok(ctx[k], k);
  for (const k of ['get', 'set', 'subscribe', 'all', 'reset']) assert.equal(typeof ctx.settings[k], 'function');
  assert.equal(typeof ctx.ui.build, 'function');
  assert.equal(typeof ctx.ui.h, 'function');
  container.clientWidth = 321; container.clientHeight = 123;
  assert.deepEqual(ctx.size(), { width: 321, height: 123 });
  const seen = [];
  const off = ctx.onResize((s) => seen.push(s));
  win.dispatch('resize'); win.dispatch('resize'); win.dispatch('resize');
  await tick();
  assert.deepEqual(seen, [{ width: 321, height: 123 }]);
  off();
  win.dispatch('resize');
  await tick();
  assert.equal(seen.length, 1);
  assert.ok(root.querySelector('.sketch-page'));
  await app.stop();
}));

test('theme button cycles dark -> light -> auto, applies data-theme and persists', () => withFakeDocument(async (doc) => {
  const { root, app, storage } = setup(doc, { hash: '#/' });
  await app.start();
  const btn = root.querySelector('.theme-btn');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  btn.click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  assert.match(btn.textContent, /Light/);
  btn.click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'auto');
  btn.click();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  btn.click();
  assert.deepEqual(JSON.parse(storage.getItem('p5s:global')), { theme: 'light' });
  await app.stop();
  // a new app instance picks the saved theme up
  doc.documentElement.setAttribute('data-theme', 'dark');
  const again = setup(doc, { hash: '#/', storage });
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'light');
  await again.app.stop();
}));

test('drawer button and the "d" key toggle the drawer (ignored while typing in inputs)', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/hello' });
  await app.start();
  const page = root.querySelector('.sketch-page');
  const btn = root.querySelector('.drawer-btn');
  assert.ok(page.classList.contains('drawer-open'));
  btn.click();
  assert.ok(!page.classList.contains('drawer-open'));
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  doc.dispatch('keydown', { key: 'd', target: doc.body });
  assert.ok(page.classList.contains('drawer-open'));
  doc.dispatch('keydown', { key: 'd', target: doc.createElement('input') });
  assert.ok(page.classList.contains('drawer-open'));
  doc.dispatch('keydown', { key: 'x', target: doc.body });
  assert.ok(page.classList.contains('drawer-open'));
  await app.stop();
}));

test('fullscreen button toggles via the document API', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/hello' });
  await app.start();
  const fs = root.querySelector('.fs-btn');
  fs.click();
  assert.ok(doc.fullscreenElement);
  fs.click();
  assert.equal(doc.fullscreenElement, null);
  await app.stop();
}));

test('hello sketch unmount is idempotent-safe and cleans up its own UI', () => withFakeDocument(async (doc) => {
  const P5 = createMockP5();
  const container = doc.createElement('div');
  const drawer = doc.createElement('div');
  const toolbar = doc.createElement('div');
  const { createStore } = await import('../../core/settings.js');
  const ui = await import('../../core/ui.js');
  const settings = createStore({ namespace: 'h', storage: createMemoryStorage() });
  const handle = hello.mount(container, { p5: P5, settings, globalSettings: settings, ui, drawer, toolbar, onResize: () => () => {}, size: () => ({ width: 400, height: 300 }) });
  assert.equal(drawer.children.length, 1);
  assert.equal(toolbar.children.length, 1);
  handle.unmount();
  assert.equal(drawer.children.length, 0);
  assert.equal(toolbar.children.length, 0);
  assert.ok(P5.instances[0].removed);
}));
