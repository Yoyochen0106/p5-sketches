import test from 'node:test';
import assert from 'node:assert/strict';
import {
  samplePeriod, removeDC, normalize, buildTrackBuffer, periodLength, activeTrackIds, listenWindow,
  createAudioEngine, FADE_SEC, MIN_FREQ, MAX_FREQ,
} from '../../sketches/approx/audio.js';

// ---- fake Web Audio ---------------------------------------------------------------------------------------

class FakeParam {
  constructor(v = 1) { this.value = v; this.events = []; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; }
}
class FakeNode {
  constructor(ac) { this.ac = ac; this.connected = []; }
  connect(n) { this.connected.push(n); return n; }
}
class FakeGain extends FakeNode { constructor(ac) { super(ac); this.gain = new FakeParam(1); } }
class FakeSource extends FakeNode {
  constructor(ac) { super(ac); this.playbackRate = new FakeParam(1); this.loop = false; this.buffer = null; this.started = false; this.stoppedAt = null; }
  start() { this.started = true; }
  stop(t) { this.stoppedAt = t; }
}
class FakeBuffer {
  constructor(ch, length, sr) { this.length = length; this.sampleRate = sr; this.data = new Float32Array(length); }
  getChannelData() { return this.data; }
}
function makeFake() {
  const log = { contexts: [] };
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.currentTime = 1;
      this.state = 'suspended';
      this.destination = {};
      this.closed = 0;
      this.resumed = 0;
      this.gains = [];
      this.sources = [];
      log.contexts.push(this);
    }
    createGain() { const g = new FakeGain(this); this.gains.push(g); return g; }
    createBufferSource() { const s = new FakeSource(this); this.sources.push(s); return s; }
    createBuffer(c, l, sr) { return new FakeBuffer(c, l, sr); }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
  }
  return { Ctor: FakeAudioContext, log };
}

const sine = (ph) => Math.sin(2 * Math.PI * ph);
const saw = (ph) => 2 * ph - 1;

// ---- pure helpers ------------------------------------------------------------------------------------------

test('samplePeriod is periodic: sample 0 equals the function one period later', () => {
  const L = 200;
  const b = samplePeriod((ph) => Math.sin(2 * Math.PI * ph) + 0.3 * Math.cos(6 * Math.PI * ph), L);
  assert.equal(b.length, L);
  const next = Math.sin(2 * Math.PI * 1) + 0.3 * Math.cos(6 * Math.PI * 1);
  assert.ok(Math.abs(b[0] - next) < 1e-6);
  const bad = samplePeriod((ph) => (ph < 0.5 ? NaN : Infinity), 8);
  assert.ok([...bad].every((v) => v === 0 || Math.abs(v) <= 1e9));
  assert.ok([...bad].slice(0, 4).every((v) => v === 0));
});

test('DC removal gives a zero mean', () => {
  const b = removeDC(samplePeriod((ph) => 5 + sine(ph), 480));
  const mean = b.reduce((s, v) => s + v, 0) / b.length;
  assert.ok(Math.abs(mean) < 1e-4);
});

test('normalisation brings quiet and loud signals to the same peak; silence stays silent', () => {
  const quiet = buildTrackBuffer((ph) => 1e-6 * sine(ph), 256);
  const loud = buildTrackBuffer((ph) => 1e4 * sine(ph) + 7, 256);
  const peak = (b) => Math.max(...b.map(Math.abs));
  assert.ok(Math.abs(peak(quiet) - 1) < 1e-5);
  assert.ok(Math.abs(peak(loud) - 1) < 1e-5);
  const silent = buildTrackBuffer(() => 3, 64);
  assert.ok(silent.every((v) => v === 0));
  assert.ok(normalize(new Float32Array(0)).length === 0);
});

test('periodLength follows the sample rate and frequency', () => {
  assert.equal(periodLength(48000, 480), 100);
  assert.ok(periodLength(48000, 1e9) >= 16);
});

test('mute / solo logic', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(activeTrackIds(ids), ids);
  assert.deepEqual(activeTrackIds(ids, { b: true }, {}), ['a', 'c']);
  assert.deepEqual(activeTrackIds(ids, {}, { b: true }), ['b']);
  assert.deepEqual(activeTrackIds(ids, {}, { b: true, c: true }), ['b', 'c']);
  assert.deepEqual(activeTrackIds(ids, { b: true }, { b: true }), [], 'mute beats solo');
  assert.deepEqual(activeTrackIds(ids, {}, { zzz: true }), ids, 'solo of an unknown id is ignored');
});

test('listenWindow: Fourier period, else function period, else the view width', () => {
  const view = { x0: -3, x1: 5 };
  assert.deepEqual(listenWindow({ fourierFit: { period: 2, x0: -1 }, func: { period: 1 }, view }), { x0: -1, T: 2, kind: 'fourier' });
  assert.deepEqual(listenWindow({ func: { period: 4 }, view }), { x0: -2, T: 4, kind: 'function' });
  assert.deepEqual(listenWindow({ func: { period: null }, view }), { x0: -3, T: 8, kind: 'view' });
});

// ---- engine ------------------------------------------------------------------------------------------------

test('no AudioContext: engine reports unavailable and every call is a harmless no-op', () => {
  const e = createAudioEngine({ getCtor: () => null });
  assert.equal(e.available, false);
  assert.equal(e.play(), false);
  e.setTracks([{ id: 'a', fn: sine }]);
  e.setParams({ freq: 100 });
  e.stop();
  e.dispose();
  e.dispose();
  const thrower = createAudioEngine({ getCtor: () => { throw new Error('boom'); } });
  assert.equal(thrower.available, false);
});

test('play builds one looping buffer per track, fades the master in and resumes the context', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  assert.equal(log.contexts.length, 0, 'context is created lazily');
  e.setTracks([{ id: 'a', fn: sine }, { id: 'b', fn: saw }]);
  e.setParams({ freq: 480, volume: 0.5 });
  assert.equal(log.contexts.length, 0, 'still nothing before the user gesture');
  assert.equal(e.play(), true);
  const ac = log.contexts[0];
  assert.equal(ac.resumed, 1);
  assert.equal(ac.sources.length, 2);
  for (const s of ac.sources) {
    assert.equal(s.loop, true);
    assert.equal(s.started, true);
    assert.equal(s.buffer.length, 100);
    assert.ok(Math.abs(s.playbackRate.value - 1) < 1e-12);
    const peak = Math.max(...s.buffer.getChannelData(0).map(Math.abs));
    assert.ok(Math.abs(peak - 1) < 1e-5, 'normalised');
  }
  const master = ac.gains[0];
  assert.equal(master.gain.value, 0.4);
  const rampEv = master.gain.events.find((x) => x[0] === 'ramp');
  assert.ok(rampEv && rampEv[2] - ac.currentTime >= FADE_SEC - 1e-9, 'fade-in is not instantaneous');
  assert.equal(e.play(), false, 'second play while playing is ignored');
  assert.equal(log.contexts.length, 1);
});

test('mute and solo change track gains with ramps (no clicks), without rebuilding', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  e.setTracks([{ id: 'a', fn: sine }, { id: 'b', fn: saw }]);
  e.play();
  const ac = log.contexts[0];
  const [sa, sb] = ac.sources;
  const trackGains = () => ac.gains.slice(2, 4); // gains: master, generation, track a, track b
  assert.deepEqual(trackGains().map((g) => g.gain.value), [0.5, 0.5]);
  e.setParams({ mute: { a: true } });
  assert.deepEqual(trackGains().map((g) => g.gain.value), [0, 1]);
  assert.ok(trackGains()[0].gain.events.some((x) => x[0] === 'ramp'));
  e.setParams({ mute: {}, solo: { a: true } });
  assert.deepEqual(trackGains().map((g) => g.gain.value), [1, 0]);
  assert.equal(ac.sources.length, 2, 'no new sources');
  assert.equal(sa.stoppedAt, null);
  assert.equal(sb.stoppedAt, null);
});

test('parameter changes crossfade: old generation fades out and is stopped after the fade, new one fades in', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  e.setTracks([{ id: 'a', fn: sine }]);
  e.play();
  const ac = log.contexts[0];
  const first = ac.sources[0];
  e.setTracks([{ id: 'a', fn: (ph) => sine(2 * ph) }]);
  assert.equal(ac.sources.length, 2);
  assert.ok(first.stoppedAt >= ac.currentTime + FADE_SEC, 'old source stops after its fade-out');
  const oldGen = ac.gains[1];
  const newGen = ac.gains[3];
  assert.equal(oldGen.gain.value, 0);
  assert.equal(newGen.gain.value, 1);
  const setEv = newGen.gain.events.find((x) => x[0] === 'set');
  assert.equal(setEv[1], 0, 'new generation starts silent');
});

test('small frequency changes retune via playbackRate, large ones rebuild; range is clamped', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  e.setTracks([{ id: 'a', fn: sine }]);
  e.setParams({ freq: 400 });
  e.play();
  const ac = log.contexts[0];
  e.setParams({ freq: 440 });
  assert.equal(ac.sources.length, 1);
  assert.ok(Math.abs(ac.sources[0].playbackRate.value - (ac.sources[0].buffer.length * 440) / 48000) < 1e-9);
  e.setParams({ freq: 800 });
  assert.equal(ac.sources.length, 2);
  e.setParams({ freq: 1e6 });
  assert.equal(e.params.freq, MAX_FREQ);
  e.setParams({ freq: -5 });
  assert.equal(e.params.freq, MIN_FREQ);
  e.setParams({ volume: 7 });
  assert.equal(e.params.volume, 1);
});

test('stop fades the master out and stops sources after the fade; play again works', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  e.setTracks([{ id: 'a', fn: sine }]);
  e.play();
  const ac = log.contexts[0];
  e.stop();
  assert.equal(e.playing, false);
  assert.equal(ac.gains[0].gain.value, 0);
  assert.ok(ac.sources[0].stoppedAt > ac.currentTime + FADE_SEC);
  e.stop(); // idempotent
  assert.equal(e.play(), true);
  assert.equal(log.contexts.length, 1, 'context reused');
  assert.equal(ac.sources.length, 2);
});

test('dispose closes the context exactly once; double dispose and later calls are safe', () => {
  const { Ctor, log } = makeFake();
  const e = createAudioEngine({ getCtor: () => Ctor });
  e.setTracks([{ id: 'a', fn: sine }]);
  e.play();
  const ac = log.contexts[0];
  e.dispose();
  e.dispose();
  assert.equal(ac.closed, 1);
  assert.equal(e.disposed, true);
  assert.equal(e.play(), false);
  e.setTracks([{ id: 'a', fn: saw }]);
  e.setParams({ freq: 300 });
  e.stop();
  assert.equal(ac.closed, 1);
  assert.equal(log.contexts.length, 1);
  // disposing an engine that never played must not create or close anything
  const idle = createAudioEngine({ getCtor: () => Ctor });
  idle.dispose();
  assert.equal(log.contexts.length, 1);
});

test('a throwing AudioContext constructor leaves the engine unavailable without throwing', () => {
  const e = createAudioEngine({ getCtor: () => class { constructor() { throw new Error('denied'); } } });
  e.setTracks([{ id: 'a', fn: sine }]);
  assert.equal(e.play(), false);
  assert.equal(e.available, false);
  assert.equal(e.playing, false);
});
