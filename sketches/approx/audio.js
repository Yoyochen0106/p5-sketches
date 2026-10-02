// Sonification of the approximations ("Listen"): one period of every enabled approximation becomes a looping
// AudioBuffer, played at a chosen fundamental frequency.
//
// Split in two layers so the logic can be unit-tested in Node:
//   * pure helpers       samplePeriod, removeDC, normalize, buildTrackBuffer, activeTrackIds, listenWindow
//   * createAudioEngine  owns the Web Audio graph; the AudioContext constructor is injected (a fake in tests)
//
// Graph:  source(loop) -> trackGain -> generationGain -> master -> destination
//   * trackGain  = 1 / (number of audible tracks) or 0 (mute / solo); changes ramp over FADE_SEC.
//   * generationGain crossfades between the old and the new set of buffers when the parameters change.
//   * master     = volume; ramps 0 -> volume on play and volume -> 0 before stop (no clicks).
// Limitations: the period is sampled at the audio rate, so harmonics above Nyquist alias; for a non-periodic function
// the loop is one view width and may contain a jump at the loop point (a buzz at the loop frequency).

export const FADE_SEC = 0.025;
export const MIN_FREQ = 55;
export const MAX_FREQ = 880;
const PEAK = 1;
const HEADROOM = 0.8;

/** Sample fn(phase) at phase = i / length, i = 0 .. length - 1, one period of the waveform. Non-finite values become 0. */
export function samplePeriod(fn, length) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const v = fn(i / length);
    out[i] = Number.isFinite(v) ? Math.max(-1e9, Math.min(1e9, v)) : 0;
  }
  return out;
}

/** Subtract the mean in place; returns the buffer. */
export function removeDC(buf) {
  if (!buf.length) return buf;
  let m = 0;
  for (let i = 0; i < buf.length; i++) m += buf[i];
  m /= buf.length;
  for (let i = 0; i < buf.length; i++) buf[i] -= m;
  return buf;
}

/** Scale in place so max |x| = peak (silent buffers stay silent); returns the buffer. */
export function normalize(buf, peak = PEAK) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (!(m > 1e-12)) {
    buf.fill(0);
    return buf;
  }
  const g = peak / m;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/** One period of a waveform as a DC-free, peak-normalised Float32Array (so quiet approximations stay audible). */
export function buildTrackBuffer(fn, length) {
  return normalize(removeDC(samplePeriod(fn, length)));
}

/** Samples per period for fundamental `freq` at `sampleRate` (kept >= 16). */
export function periodLength(sampleRate, freq) {
  return Math.max(16, Math.round(sampleRate / Math.max(1, freq)));
}

/**
 * Which tracks are audible: nothing muted, and if any track is soloed only the soloed ones.
 * `muted` / `soloed` are plain objects {id: bool}. Mute beats solo.
 */
export function activeTrackIds(ids, muted = {}, soloed = {}) {
  const anySolo = ids.some((id) => soloed[id]);
  return ids.filter((id) => !muted[id] && (!anySolo || soloed[id]));
}

/**
 * Where the period is taken from. Priority: the Fourier period when Fourier is enabled, else the function's own
 * period, else the current view width ('view': the function is not periodic, so the loop is just the view).
 * Returns { x0, T, kind: 'fourier' | 'function' | 'view' }.
 */
export function listenWindow({ fourierFit = null, func, view }) {
  if (fourierFit && fourierFit.period > 0) return { x0: fourierFit.x0, T: fourierFit.period, kind: 'fourier' };
  if (func && func.period > 0) return { x0: -func.period / 2, T: func.period, kind: 'function' };
  const T = view.x1 - view.x0;
  return { x0: view.x0, T: T > 0 ? T : 1, kind: 'view' };
}

function audioCtor() {
  const g = globalThis;
  return g.AudioContext || g.webkitAudioContext || null;
}

/**
 * Audio engine. `getCtor` returns the AudioContext constructor (or null); the context is created lazily inside
 * play(), which must be called from a user gesture (autoplay policy).
 */
export function createAudioEngine({ getCtor = audioCtor } = {}) {
  const Ctor = (() => {
    try { return getCtor(); } catch { return null; }
  })();
  const params = { freq: 220, volume: 0.5, mute: {}, solo: {} };
  let tracks = []; // [{ id, fn }]
  let ac = null;
  let master = null;
  let gen = null; // current generation { gain, entries:[{id, src, gain}], freq, ids }
  let playing = false;
  let disposed = false;
  let error = null;

  const now = () => ac.currentTime;

  function ramp(param, target, dur = FADE_SEC) {
    const t = now();
    try {
      if (param.cancelScheduledValues) param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(target, t + dur);
    } catch { /* ignore */ }
  }

  function trackGain(id, ids) {
    const act = activeTrackIds(ids, params.mute, params.solo);
    return act.includes(id) ? 1 / act.length : 0;
  }

  function buildGeneration() {
    const L = periodLength(ac.sampleRate, params.freq);
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(master);
    const ids = tracks.map((t) => t.id);
    const entries = tracks.map((t) => {
      const data = buildTrackBuffer(t.fn, L);
      const buffer = ac.createBuffer(1, L, ac.sampleRate);
      if (buffer.copyToChannel) buffer.copyToChannel(data, 0);
      else buffer.getChannelData(0).set(data);
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = (L * params.freq) / ac.sampleRate;
      const tg = ac.createGain();
      tg.gain.value = trackGain(t.id, ids);
      src.connect(tg);
      tg.connect(g);
      src.start();
      return { id: t.id, src, gain: tg };
    });
    return { gain: g, entries, freq: params.freq, L, ids };
  }

  function retire(old) {
    if (!old) return;
    ramp(old.gain.gain, 0);
    const t = now() + FADE_SEC + 0.01;
    for (const e of old.entries) {
      try { e.src.stop(t); } catch { /* ignore */ }
    }
    old.retiredAt = t;
  }

  /** Crossfade to a freshly built generation. */
  function rebuild() {
    if (!playing || !ac) return;
    const old = gen;
    gen = buildGeneration();
    ramp(gen.gain.gain, 1);
    retire(old);
  }

  function applyTrackGains() {
    if (!gen) return;
    for (const e of gen.entries) ramp(e.gain.gain, trackGain(e.id, gen.ids));
  }

  const engine = {
    /** True when the browser has a Web Audio API. */
    get available() { return !!Ctor && !error; },
    get playing() { return playing; },
    get disposed() { return disposed; },
    get error() { return error; },
    get context() { return ac; },
    get params() { return params; },

    /** Replace the waveforms: tracks = [{ id, fn(phase in [0,1)) }]. Crossfades if currently playing. */
    setTracks(next) {
      if (disposed) return;
      tracks = next.map((t) => ({ id: t.id, fn: t.fn }));
      rebuild();
    },

    /** Update {freq, volume, mute, solo}; all changes are click-free. */
    setParams(next = {}) {
      if (disposed) return;
      const prevFreq = params.freq;
      if (next.freq !== undefined) params.freq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, Number(next.freq) || MIN_FREQ));
      if (next.volume !== undefined) params.volume = Math.max(0, Math.min(1, Number(next.volume) || 0));
      if (next.mute) params.mute = { ...next.mute };
      if (next.solo) params.solo = { ...next.solo };
      if (!playing || !ac) return;
      ramp(master.gain, params.volume * HEADROOM);
      applyTrackGains();
      if (params.freq !== prevFreq && gen) {
        const ratio = params.freq / gen.freq;
        if (ratio > 0.7 && ratio < 1.4) {
          const rate = (gen.L * params.freq) / ac.sampleRate;
          for (const e of gen.entries) ramp(e.src.playbackRate, rate, FADE_SEC);
        } else {
          rebuild();
        }
      }
    },

    /** Start playback. Call from a click / key handler. Creates the AudioContext on first use. */
    play() {
      if (disposed || playing || !Ctor) return false;
      try {
        if (!ac) {
          ac = new Ctor();
          master = ac.createGain();
          master.gain.value = 0;
          master.connect(ac.destination);
        }
        if (ac.state === 'suspended' && ac.resume) {
          const r = ac.resume();
          if (r && r.catch) r.catch(() => {});
        }
        playing = true;
        gen = buildGeneration();
        ramp(gen.gain.gain, 1, 0.001);
        ramp(master.gain, params.volume * HEADROOM);
        return true;
      } catch (e) {
        error = e;
        playing = false;
        return false;
      }
    },

    /** Fade out, then stop the sources. */
    stop() {
      if (!playing || !ac) return;
      playing = false;
      ramp(master.gain, 0);
      const old = gen;
      gen = null;
      if (old) {
        const t = now() + FADE_SEC + 0.01;
        for (const e of old.entries) {
          try { e.src.stop(t); } catch { /* ignore */ }
        }
      }
    },

    /** Stop and close the AudioContext. Safe to call more than once. */
    dispose() {
      if (disposed) return;
      disposed = true;
      playing = false;
      gen = null;
      const c = ac;
      ac = null;
      master = null;
      if (c) {
        try {
          const r = c.close();
          if (r && r.catch) r.catch(() => {});
        } catch { /* ignore */ }
      }
    },
  };
  return engine;
}
