import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryStorage, encodeValue, decodeValue } from '../../core/settings.js';

function fakeHash(initial = {}) {
  const h = { params: { ...initial }, writes: [], read() { return { ...h.params }; }, write(p) { h.params = { ...p }; h.writes.push({ ...p }); } };
  return h;
}

test('get returns default until set; set notifies subscribers', () => {
  const s = createStore({ namespace: 'a', storage: createMemoryStorage() });
  assert.equal(s.get('x', 5), 5);
  const seen = [];
  const off = s.subscribe((k, v) => seen.push([k, v]));
  s.set('x', 7);
  assert.equal(s.get('x', 5), 7);
  s.set('x', 7); // unchanged: no notification
  off();
  s.set('x', 8);
  assert.deepEqual(seen, [['x', 7]]);
});

test('persists to storage and reloads', () => {
  const storage = createMemoryStorage();
  const a = createStore({ namespace: 'n', storage });
  a.set('k', { deep: [1, 2] });
  a.set('flag', true);
  const b = createStore({ namespace: 'n', storage });
  assert.deepEqual(b.get('k'), { deep: [1, 2] });
  assert.equal(b.get('flag'), true);
  assert.deepEqual(createStore({ namespace: 'other', storage }).all(), {});
});

test('corrupt storage and throwing storage fall back gracefully', () => {
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); }, removeItem() {} };
  const s = createStore({ namespace: 'n', storage: bad });
  s.set('a', 1);
  assert.equal(s.get('a'), 1);
});

test('hash params override storage and are decoded', () => {
  const storage = createMemoryStorage();
  createStore({ namespace: 'n', storage }).set('n', 1);
  const hash = fakeHash({ n: '42', s: 'hello', b: 'true', str: '"12"' });
  const s = createStore({ namespace: 'n', storage, hashSync: hash });
  assert.equal(s.get('n'), 42);
  assert.equal(s.get('s'), 'hello');
  assert.equal(s.get('b'), true);
  assert.equal(s.get('str'), '12');
});

test('hash mirrors only non-default values', () => {
  const hash = fakeHash();
  const s = createStore({ namespace: 'n', storage: createMemoryStorage(), hashSync: hash });
  assert.equal(s.get('mode', 'a'), 'a');
  assert.equal(s.get('n', 3), 3);
  s.set('mode', 'b');
  s.set('n', 4);
  assert.deepEqual(hash.params, { mode: 'b', n: '4' });
  s.set('mode', 'a'); // back to default: dropped from hash
  assert.deepEqual(hash.params, { n: '4' });
});

test('string values that look like JSON round-trip through encode/decode', () => {
  for (const v of ['12', 'true', 'null', 'plain', 'a b', 'sin(x)^2', '{"a":1}', 3.5, false, [1, 2]]) {
    assert.deepEqual(decodeValue(encodeValue(v)), v, String(v));
  }
});

test('set(key, undefined) removes; reset clears everything and notifies with null key', () => {
  const storage = createMemoryStorage();
  const hash = fakeHash();
  const s = createStore({ namespace: 'n', storage, hashSync: hash });
  s.set('a', 1); s.set('b', 2);
  s.set('a', undefined);
  assert.deepEqual(s.all(), { b: 2 });
  const seen = [];
  s.subscribe((k) => seen.push(k));
  s.reset();
  assert.deepEqual(s.all(), {});
  assert.deepEqual(seen, [null]);
  assert.deepEqual(hash.params, {});
  assert.deepEqual(createStore({ namespace: 'n', storage }).all(), {});
});

test('all() returns a copy', () => {
  const s = createStore({ namespace: 'n', storage: createMemoryStorage() });
  s.set('a', 1);
  const copy = s.all();
  copy.a = 99;
  assert.equal(s.get('a'), 1);
});
