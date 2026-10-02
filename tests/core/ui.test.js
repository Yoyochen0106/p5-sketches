import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import * as ui from '../../core/ui.js';
import { withFakeDocument } from './fake-dom.js';

const mkStore = () => createStore({ namespace: 't', storage: createMemoryStorage() });

test('h builds elements with attrs, classes, styles, handlers and nested children', () => withFakeDocument(() => {
  let clicked = 0;
  const el = ui.h('div', { class: 'a b', id: 'x', style: { color: 'red' }, 'data-k': 'v', onClick: () => clicked++, hidden: false },
    'text ', ['nested', null, 5], ui.h('span', null, 'child'));
  assert.equal(el.tagName, 'DIV');
  assert.equal(el.className, 'a b');
  assert.equal(el.id, 'x');
  assert.equal(el.style.color, 'red');
  assert.equal(el.getAttribute('data-k'), 'v');
  assert.equal(el.textContent, 'text nested5child');
  el.click();
  assert.equal(clicked, 1);
  assert.equal(el.hidden, false);
}));

test('toggle reflects the store and writes back', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  const ctl = ui.build([{ type: 'toggle', key: 'on', label: 'Enable', color: '#f00' }], store, parent);
  const input = parent.querySelector('input');
  assert.equal(input.checked, false);
  assert.ok(parent.querySelector('.ui-chip'));
  assert.equal(parent.querySelector('label').textContent, 'Enable');
  assert.equal(parent.querySelector('label').getAttribute('for'), input.id);
  input.checked = true;
  input.dispatch('change');
  assert.equal(store.get('on'), true);
  store.set('on', false);
  assert.equal(input.checked, false);
  ctl.destroy();
}));

test('slider: readout, custom format, writes numbers', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([{ type: 'slider', key: 'n', label: 'N', min: 1, max: 10, step: 1, format: (v) => `${v} items` }], store, parent);
  const input = parent.querySelector('input');
  const out = parent.querySelector('output');
  assert.equal(input.getAttribute('type'), 'range');
  assert.equal(input.getAttribute('min'), '1');
  assert.equal(input.getAttribute('max'), '10');
  assert.equal(out.textContent, '1 items');
  input.value = '7';
  input.dispatch('input');
  assert.strictEqual(store.get('n'), 7);
  assert.equal(out.textContent, '7 items');
  store.set('n', 3);
  assert.equal(input.value, '3');
}));

test('select maps option values back to their original type (strings and objects)', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([{ type: 'select', key: 'k', label: 'K', options: ['a', { value: 2, label: 'Two' }] }], store, parent);
  const sel = parent.querySelector('select');
  const opts = parent.querySelectorAll('option');
  assert.equal(opts.length, 2);
  assert.equal(opts[1].textContent, 'Two');
  assert.equal(sel.value, 'a');
  sel.value = '2';
  sel.dispatch('change');
  assert.strictEqual(store.get('k'), 2);
  store.set('k', 'a');
  assert.equal(sel.value, 'a');
}));

test('button calls onClick', () => withFakeDocument((doc) => {
  let n = 0;
  const parent = doc.createElement('div');
  ui.build([{ type: 'button', label: 'Go', onClick: () => n++ }], mkStore(), parent);
  const b = parent.querySelector('button');
  assert.equal(b.textContent, 'Go');
  b.click(); b.click();
  assert.equal(n, 2);
}));

test('color input', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([{ type: 'color', key: 'c', label: 'C' }], store, parent);
  const input = parent.querySelector('input');
  assert.equal(input.getAttribute('type'), 'color');
  input.value = '#123456';
  input.dispatch('input');
  assert.equal(store.get('c'), '#123456');
}));

test('text: validation shows error and blocks the store write; recovery clears it', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  const validate = (v) => (v.includes('(') && !v.includes(')') ? 'unbalanced' : null);
  ui.build([{ type: 'text', key: 'expr', label: 'f(x)', placeholder: 'sin(x)', validate }], store, parent);
  const input = parent.querySelector('input');
  const err = parent.querySelector('.ui-error');
  assert.equal(input.getAttribute('placeholder'), 'sin(x)');
  assert.equal(err.hidden, true);
  input.value = 'sin(x';
  input.dispatch('input');
  assert.equal(err.textContent, 'unbalanced');
  assert.equal(err.hidden, false);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(store.has('expr'), false);
  store.set('other', 1); // unrelated store change must not clobber what the user typed
  assert.equal(input.value, 'sin(x');
  input.value = 'sin(x)';
  input.dispatch('input');
  assert.equal(err.hidden, true);
  assert.equal(input.getAttribute('aria-invalid'), null);
  assert.equal(store.get('expr'), 'sin(x)');
  store.set('expr', 'cos(x)');
  assert.equal(input.value, 'cos(x)');
}));

test('tabs: aria-selected follows the store, click writes', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([{ type: 'tabs', key: 'tab', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }], store, parent);
  const tabs = parent.querySelectorAll('button');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'false');
  tabs[1].click();
  assert.equal(store.get('tab'), 'b');
  assert.equal(tabs[0].getAttribute('aria-selected'), 'false');
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.ok(tabs[1].classList.contains('active'));
  assert.equal(parent.querySelector('[role=tablist]') !== null, true);
}));

test('info renders text', () => withFakeDocument((doc) => {
  const parent = doc.createElement('div');
  ui.build([{ type: 'info', text: 'hello there' }], mkStore(), parent);
  assert.equal(parent.querySelector('.ui-info').textContent, 'hello there');
}));

test('group: collapses, nests children, enabledKey header toggle', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([{
    type: 'group', label: 'Taylor', collapsed: true, enabledKey: 'taylor',
    children: [{ type: 'toggle', key: 'inner', label: 'Inner' }],
  }], store, parent);
  const body = parent.querySelector('.ui-group-body');
  const header = parent.querySelector('.ui-group-toggle');
  assert.equal(body.hidden, true);
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  header.click();
  assert.equal(body.hidden, false);
  assert.equal(header.getAttribute('aria-expanded'), 'true');
  header.click();
  assert.equal(body.hidden, true);
  const enable = parent.querySelector('.ui-group-enable');
  assert.equal(enable.checked, false);
  assert.ok(body.classList.contains('disabled'));
  enable.checked = true;
  enable.dispatch('change');
  assert.equal(store.get('taylor'), true);
  assert.ok(!body.classList.contains('disabled'));
  const inner = body.querySelector('input');
  inner.checked = true;
  inner.dispatch('change');
  assert.equal(store.get('inner'), true);
}));

test('visibleIf is re-evaluated on store change, including inside groups', () => withFakeDocument((doc) => {
  const store = mkStore();
  const parent = doc.createElement('div');
  ui.build([
    { type: 'tabs', key: 'mode', options: ['a', 'b'] },
    { type: 'info', text: 'only b', visibleIf: (s) => s.get('mode', 'a') === 'b' },
    { type: 'group', label: 'G', visibleIf: (s) => s.get('mode', 'a') === 'a', children: [{ type: 'info', text: 'in group' }] },
  ], store, parent);
  const info = parent.querySelector('.ui-info');
  const group = parent.querySelector('.ui-group');
  assert.equal(info.hidden, true);
  assert.equal(group.hidden, false);
  store.set('mode', 'b');
  assert.equal(info.hidden, false);
  assert.equal(group.hidden, true);
  store.set('mode', 'a');
  assert.equal(info.hidden, true);
  assert.equal(group.hidden, false);
}));

test('unknown node type throws', () => withFakeDocument((doc) => {
  assert.throws(() => ui.build([{ type: 'nope' }], mkStore(), doc.createElement('div')), /unknown node type/);
}));

test('destroy removes the DOM, unsubscribes from the store and is idempotent', () => withFakeDocument((doc) => {
  const store = mkStore();
  let renders = 0;
  const parent = doc.createElement('div');
  const ctl = ui.build([{ type: 'slider', key: 'a', label: 'A', min: 0, max: 1, step: 0.1, format: (v) => { renders++; return String(v); } }], store, parent);
  const before = renders;
  store.set('a', 0.5);
  assert.equal(renders, before + 1);
  assert.equal(parent.childNodes.length, 1);
  ctl.destroy();
  assert.equal(parent.childNodes.length, 0);
  store.set('a', 0.7);
  assert.equal(renders, before + 1);
  ctl.destroy();
}));

test('build works without a parent and refresh() re-reads the store', () => withFakeDocument(() => {
  const store = mkStore();
  const ctl = ui.build([{ type: 'info', text: 'x' }], store, null);
  assert.ok(ctl.el);
  assert.equal(ctl.el.parentNode, null);
  ctl.refresh();
  ctl.destroy();
}));

test('clear() empties an element', () => withFakeDocument((doc) => {
  const el = doc.createElement('div');
  el.appendChild(doc.createElement('p')); el.appendChild(doc.createElement('p'));
  ui.clear(el);
  assert.equal(el.childNodes.length, 0);
}));

test('controls do not register their fallback as the store default', () => withFakeDocument((doc) => {
  const store = mkStore();
  store.get('n', 12);
  ui.build([{ type: 'slider', key: 'n', label: 'N', min: 1, max: 60, step: 1 }], store, doc.createElement('div'));
  assert.equal(store.get('n'), 12);
}));
