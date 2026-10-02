import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, onRoute, createHashSync } from '../../core/router.js';
import { createFakeWindow } from './fake-dom.js';

test('parseHash handles menu, sketch and params', () => {
  assert.deepEqual(parseHash(''), { id: '', params: {} });
  assert.deepEqual(parseHash('#'), { id: '', params: {} });
  assert.deepEqual(parseHash('#/'), { id: '', params: {} });
  assert.deepEqual(parseHash(undefined), { id: '', params: {} });
  assert.deepEqual(parseHash('#/approx'), { id: 'approx', params: {} });
  assert.deepEqual(parseHash('#/approx/'), { id: 'approx', params: {} });
  assert.deepEqual(parseHash('#/approx?a=1&b=x%20y&flag&c=%7B%22k%22'), {
    id: 'approx', params: { a: '1', b: 'x y', flag: '', c: '{"k"' },
  });
});

test('parseHash tolerates malformed escapes', () => {
  assert.deepEqual(parseHash('#/s?a=%E0%A4%A').params, { a: '%E0%A4%A' });
});

test('buildHash encodes and round-trips', () => {
  assert.equal(buildHash(''), '#/');
  assert.equal(buildHash('hello'), '#/hello');
  const params = { expr: 'sin(x)^2 + 1&2', n: '3', 'we ird': 'a=b' };
  const h = buildHash('approx', params);
  assert.deepEqual(parseHash(h), { id: 'approx', params });
  assert.equal(buildHash('x', { a: undefined, b: null, c: 0 }), '#/x?c=0');
});

test('onRoute fires immediately and on hashchange; unsubscribe stops it', () => {
  const win = createFakeWindow('#/hello?a=1');
  const seen = [];
  const off = onRoute((r) => seen.push(r), win);
  assert.deepEqual(seen, [{ id: 'hello', params: { a: '1' } }]);
  win.navigate('#/approx');
  assert.equal(seen.length, 2);
  assert.equal(seen[1].id, 'approx');
  off();
  win.navigate('#/');
  assert.equal(seen.length, 2);
  assert.equal(win.listenerCount('hashchange'), 0);
});

test('createHashSync reads params and writes with replaceState only when changed', () => {
  const win = createFakeWindow('#/hello?a=1');
  const hs = createHashSync(win, 'hello');
  assert.deepEqual(hs.read(), { a: '1' });
  hs.write({ a: '2' });
  assert.equal(win.location.hash, '#/hello?a=2');
  assert.equal(win.replaceCalls.length, 1);
  hs.write({ a: '2' });
  assert.equal(win.replaceCalls.length, 1);
  hs.write({});
  assert.equal(win.location.hash, '#/hello');
});
