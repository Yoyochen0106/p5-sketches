import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../core/app.js';
import { parseHash, buildHash, buildCourseHash } from '../../core/router.js';
import { createMemoryStorage } from '../../core/settings.js';
import { SKETCHES, COURSES } from '../../sketches/registry.js';
import { createMockP5 } from '../mock-p5.js';
import { withFakeDocument, createFakeWindow } from './fake-dom.js';

// ---- registry integrity ----------------------------------------------------------------
test('registry: unique ids, reserved id not used, groups valid', () => {
  const ids = SKETCHES.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes('course'));
  for (const s of SKETCHES) {
    assert.ok(['misc', 'course', undefined].includes(s.group), s.id);
    assert.ok(s.title && s.description, s.id);
  }
});

test('registry: planned entries have no load, others have one', () => {
  for (const s of SKETCHES) {
    if (s.planned) assert.equal(s.load, undefined, s.id);
    else assert.equal(typeof s.load, 'function', s.id);
  }
});

test('registry: courses reference existing units that belong to them, in order', () => {
  assert.deepEqual(COURSES.map((c) => c.id), ['em', 'engmath', 'ctrl']);
  for (const c of COURSES) {
    assert.ok(c.title && c.description && c.accent);
    assert.equal(c.units.length, 6);
    c.units.forEach((id, i) => {
      const e = SKETCHES.find((s) => s.id === id);
      assert.ok(e, `${c.id}: ${id} exists`);
      assert.equal(e.group, 'course');
      assert.equal(e.course, c.id);
      assert.equal(e.unit, i + 1);
    });
  }
  const courseEntries = SKETCHES.filter((s) => s.group === 'course');
  assert.equal(courseEntries.length, COURSES.reduce((n, c) => n + c.units.length, 0));
});

test('registry: related and prereqs ids exist; related params are plain objects', () => {
  const ids = new Set(SKETCHES.map((s) => s.id));
  for (const s of SKETCHES) {
    for (const r of s.related || []) {
      assert.ok(ids.has(r.id), `${s.id} -> ${r.id}`);
      assert.ok(r.label && r.why, `${s.id} -> ${r.id} label/why`);
      if (r.params) assert.equal(Object.getPrototypeOf(r.params), Object.prototype);
    }
    for (const id of s.prereqs || []) assert.ok(ids.has(id), `${s.id} prereq ${id}`);
  }
});

// ---- router ----------------------------------------------------------------------------
test('router: course routes parse separately from sketch ids', () => {
  assert.deepEqual(parseHash('#/course/em'), { id: '', course: 'em', params: {} });
  assert.deepEqual(parseHash('#/course/em/'), { id: '', course: 'em', params: {} });
  assert.deepEqual(parseHash('#/course'), { id: '', course: '', params: {} });
  assert.deepEqual(parseHash('#/courses'), { id: 'courses', params: {} });
  assert.deepEqual(parseHash('#/ma-linalg?A=1,0;0,1'), { id: 'ma-linalg', params: { A: '1,0;0,1' } });
  assert.equal(buildCourseHash('em'), '#/course/em');
  assert.equal(buildHash('ct-freq', { K: 2, delay: 0.5 }), '#/ct-freq?K=2&delay=0.5');
});

// ---- app fixtures ----------------------------------------------------------------------
const stubLoad = () => async () => ({ default: { mount() { return { unmount() {} }; } } });
function fixture() {
  const mk = (id, n, extra = {}) => ({ id, group: 'course', course: 'c1', unit: n, title: `Unit ${id}`, description: `desc ${id}`, ...extra });
  const registry = [
    { id: 'misc1', group: 'misc', title: 'Misc One', description: 'm1', load: stubLoad(), related: [{ id: 'u2', label: 'Go U2', why: 'because', params: { k: 'v' } }, { id: 'u3', label: 'Soon', why: 'later' }] },
    mk('u1', 1, { load: stubLoad(), related: [{ id: 'u3', label: 'To three', why: 'planned target' }, { id: 'u4', label: 'Four', why: 'x', params: { K: 2 } }], prereqs: [] }),
    mk('u2', 2, { planned: true, prereqs: ['u1'] }),
    mk('u3', 3, { planned: true }),
    mk('u4', 4, { load: stubLoad(), prereqs: ['u1'] }),
    mk('u5', 5, { load: stubLoad() }),
  ];
  const courses = [{ id: 'c1', title: 'Course One', description: 'about c1', accent: '#123456', units: ['u1', 'u2', 'u3', 'u4', 'u5'] }];
  return { registry, courses };
}
function setup(doc, { hash = '', registry, courses, storage = createMemoryStorage() } = {}) {
  const root = doc.createElement('div');
  root.id = 'app';
  doc.body.appendChild(root);
  const win = createFakeWindow(hash);
  const P5 = createMockP5();
  const f = fixture();
  const app = createApp({ document: doc, window: win, root, storage, registry: registry || f.registry, courses: courses || f.courses, p5: P5, debounceMs: 0 });
  return { root, win, app, storage, P5 };
}
const texts = (els) => [...els].map((e) => e.textContent);

test('home: renders Courses and Misc sections', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/' });
  await app.start();
  assert.equal(root.querySelectorAll('.home-section').length, 2);
  const cc = root.querySelectorAll('.course-card');
  assert.equal(cc.length, 1);
  assert.equal(cc[0].getAttribute('href'), '#/course/c1');
  assert.match(cc[0].textContent, /Course One/);
  assert.match(cc[0].textContent, /5 units/);
  assert.match(cc[0].textContent, /3 implemented/);
  const misc = root.querySelectorAll('.card');
  assert.deepEqual(texts(misc).length, 1);
  assert.equal(misc[0].getAttribute('href'), '#/misc1');
  await app.stop();
}));

test('home: real registry shows 3 courses with unit counts and all misc sketches', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/', registry: SKETCHES.map((s) => ({ ...s })), courses: COURSES });
  await app.start();
  assert.equal(root.querySelectorAll('.course-card').length, 3);
  assert.match(root.querySelectorAll('.course-card')[0].textContent, /6 units/);
  assert.equal(root.querySelectorAll('.card').length, SKETCHES.filter((s) => s.group === 'misc').length);
  await app.stop();
}));

test('home: collapsed state is remembered in globalSettings', () => withFakeDocument(async (doc) => {
  const { root, app, storage } = setup(doc, { hash: '#/' });
  await app.start();
  const btn = root.querySelector('.section-toggle[data-section=misc]');
  const body = root.querySelector('.misc-section').querySelector('.section-body');
  assert.equal(body.hidden, false);
  btn.click();
  assert.equal(body.hidden, true);
  assert.equal(JSON.parse(storage.getItem('p5s:global'))['collapsed:misc'], true);
  await app.stop();
  const again = setup(doc, { hash: '#/', storage });
  await again.app.start();
  assert.equal(again.root.querySelector('.misc-section').querySelector('.section-body').hidden, true);
  assert.equal(again.root.querySelector('.courses-section').querySelector('.section-body').hidden, false);
  await again.app.stop();
}));

test('course page: breadcrumb, ordered unit cards, planned badges, tags', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/course/c1' });
  await app.start();
  assert.ok(root.querySelector('.course-page'));
  assert.match(root.querySelector('.breadcrumb').textContent, /Home.*Course One/);
  assert.equal(root.querySelector('.breadcrumb').querySelector('a').getAttribute('href'), '#/');
  assert.match(root.querySelector('.course-title').textContent, /Course One/);
  const cards = root.querySelectorAll('.unit-card');
  assert.deepEqual([...cards].map((c) => c.getAttribute('data-id')), ['u1', 'u2', 'u3', 'u4', 'u5']);
  assert.deepEqual(texts(root.querySelectorAll('.unit-num')), ['1', '2', '3', '4', '5']);
  assert.equal(root.querySelectorAll('.planned-badge').length, 2);
  assert.equal(root.querySelectorAll('.unit-link').length, 3);
  assert.equal(root.querySelectorAll('.unit-link')[0].getAttribute('href'), '#/u1');
  assert.match(cards[1].textContent, /needs: Unit u1/);
  const rel = cards[0].querySelectorAll('.tag.related');
  assert.equal(rel.length, 2);
  assert.equal(rel[1].getAttribute('href'), '#/u4?K=2');
  assert.equal(root.querySelectorAll('.visited').length, 0);
  assert.equal(app.current(), '');
  await app.stop();
}));

test('unknown course and planned sketch ids do not show broken pages', () => withFakeDocument(async (doc) => {
  const a = setup(doc, { hash: '#/course/nope' });
  await a.app.start();
  assert.ok(a.root.querySelector('.home-section'));
  assert.equal(a.win.location.hash, '#/');
  await a.app.stop();
  const b = setup(doc, { hash: '#/u2' });
  await b.app.start();
  assert.ok(b.root.querySelector('.course-page'));
  assert.equal(b.win.location.hash, '#/course/c1');
  await b.app.stop();
}));

test('navigating #/ -> #/course/c1 -> #/u1 -> #/course/c1 re-renders without leaks', () => withFakeDocument(async (doc) => {
  const { root, app, win } = setup(doc, { hash: '#/' });
  await app.start();
  win.navigate('#/course/c1'); await app.whenIdle();
  assert.ok(root.querySelector('.course-page'));
  win.navigate('#/u1'); await app.whenIdle();
  assert.ok(root.querySelector('.sketch-page'));
  assert.equal(root.querySelectorAll('.menu-page').length, 0);
  win.navigate('#/course/c1'); await app.whenIdle();
  assert.equal(root.querySelectorAll('.course-page').length, 1);
  assert.equal(win.listenerCount('resize'), 0);
  await app.stop();
}));

test('sketch page of a unit: breadcrumb, prev/next skip planned units, dropdown lists all units', () => withFakeDocument(async (doc) => {
  const { root, app, win } = setup(doc, { hash: '#/u4' });
  await app.start();
  const bar = root.querySelector('.topbar');
  assert.ok(bar.querySelector('.course-nav'));
  assert.match(bar.querySelector('.breadcrumb').textContent, /Course One.*Unit 4\/5/);
  assert.equal(bar.querySelector('.breadcrumb').querySelector('a').getAttribute('href'), '#/course/c1');
  assert.equal(root.querySelector('.unit-prev').getAttribute('href'), '#/u1'); // skips planned u3, u2
  assert.equal(root.querySelector('.unit-next').getAttribute('href'), '#/u5');
  const opts = root.querySelector('.unit-select').querySelectorAll('option');
  assert.equal(opts.length, 5);
  assert.equal(opts[1].disabled, true);
  assert.equal(opts[3].disabled, false);
  assert.equal(root.querySelector('.unit-select').value, 'u4');
  // dropdown navigates
  const sel = root.querySelector('.unit-select');
  sel.value = 'u5';
  sel.dispatch('change');
  assert.equal(win.location.hash, '#/u5');
  await app.stop();
}));

test('first/last implemented unit: missing neighbour is disabled', () => withFakeDocument(async (doc) => {
  const a = setup(doc, { hash: '#/u1' });
  await a.app.start();
  assert.ok(a.root.querySelector('.unit-prev').classList.contains('disabled'));
  assert.equal(a.root.querySelector('.unit-prev').getAttribute('href'), null);
  assert.equal(a.root.querySelector('.unit-next').getAttribute('href'), '#/u4');
  await a.app.stop();
  const b = setup(doc, { hash: '#/u5' });
  await b.app.start();
  assert.ok(b.root.querySelector('.unit-next').classList.contains('disabled'));
  assert.equal(b.root.querySelector('.unit-prev').getAttribute('href'), '#/u4');
  await b.app.stop();
}));

test('prev/next buttons route to the neighbouring unit', () => withFakeDocument(async (doc) => {
  const { root, app, win } = setup(doc, { hash: '#/u4' });
  await app.start();
  const href = root.querySelector('.unit-next').getAttribute('href');
  win.navigate(href); await app.whenIdle();
  assert.equal(app.current(), 'u5');
  assert.match(root.querySelector('.unit-pos').textContent, /5\/5/);
  await app.stop();
}));

test('misc sketch has no course nav; related links appear in the drawer for misc sketches too', () => withFakeDocument(async (doc) => {
  const { root, app } = setup(doc, { hash: '#/misc1' });
  await app.start();
  assert.equal(root.querySelector('.course-nav'), null);
  const rel = root.querySelector('.related');
  assert.ok(rel);
  const items = rel.querySelectorAll('.related-item');
  assert.equal(items.length, 2);
  // u2 is planned in the fixture -> disabled; so is u3
  assert.ok(items[0].classList.contains('disabled'));
  assert.match(items[0].textContent, /Go U2/);
  assert.ok(items[1].classList.contains('disabled'));
  assert.match(items[1].textContent, /coming soon/);
  await app.stop();
}));

test('related links render label, why and params for implemented targets', () => withFakeDocument(async (doc) => {
  const f = fixture();
  f.registry[0].related[0].id = 'u4';
  f.registry[0].related[0].params = { K: 2, delay: 0.5 };
  const { root, app } = setup(doc, { hash: '#/misc1', registry: f.registry, courses: f.courses });
  await app.start();
  const a = root.querySelector('.related-item').querySelector('a');
  assert.equal(a.getAttribute('href'), '#/u4?K=2&delay=0.5');
  assert.match(a.textContent, /Go U2/);
  assert.match(a.textContent, /because/);
  await app.stop();
}));

test('visited tracking: opening a unit records it in global settings and the course page shows a check', () => withFakeDocument(async (doc) => {
  const storage = createMemoryStorage();
  const a = setup(doc, { hash: '#/u1', storage });
  await a.app.start();
  assert.deepEqual(a.app.globalSettings.get('visited', []), ['u1']);
  a.win.navigate('#/u1'); await a.app.whenIdle();
  a.win.navigate('#/u5'); await a.app.whenIdle();
  assert.deepEqual(JSON.parse(storage.getItem('p5s:global')).visited, ['u1', 'u5']);
  a.win.navigate('#/course/c1'); await a.app.whenIdle();
  const checked = [...a.root.querySelectorAll('.unit-card')].filter((c) => c.querySelector('.visited')).map((c) => c.getAttribute('data-id'));
  assert.deepEqual(checked, ['u1', 'u5']);
  await a.app.stop();
  // misc sketches are not tracked
  const b = setup(doc, { hash: '#/misc1', storage: createMemoryStorage() });
  await b.app.start();
  assert.deepEqual(b.app.globalSettings.get('visited', []), []);
  await b.app.stop();
}));

test('ctx.link and ctx.navigate build and set deep-link hashes', () => withFakeDocument(async (doc) => {
  let ctx;
  const f = fixture();
  f.registry[0].load = async () => ({ default: { mount(c, x) { ctx = x; return { unmount() {} }; } } });
  const { app, win } = setup(doc, { hash: '#/misc1', registry: f.registry, courses: f.courses });
  await app.start();
  assert.equal(ctx.link('ct-freq'), '#/ct-freq');
  assert.equal(ctx.link('ct-freq', { num: '1', den: '1,2,1', K: 3 }), '#/ct-freq?num=1&den=1%2C2%2C1&K=3');
  ctx.navigate('u4', { K: 2 });
  assert.equal(win.location.hash, '#/u4?K=2');
  win.dispatch('hashchange');
  await app.whenIdle();
  assert.equal(app.current(), 'u4');
  await app.stop();
}));

test('real registry: hello still mounts through the shell', () => withFakeDocument(async (doc) => {
  const { root, app, P5 } = setup(doc, { hash: '#/hello', registry: SKETCHES, courses: COURSES });
  await app.start();
  assert.equal(app.current(), 'hello');
  assert.equal(P5.instances.length, 1);
  assert.equal(root.querySelector('.course-nav'), null);
  await app.stop();
}));
