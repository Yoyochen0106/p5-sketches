// Opt-in Web Audio output for the plucked / struck string. The AudioContext is created lazily on
// the first click (never on mount), guarded against a missing API, and closed on dispose.

import { synthString } from '../../lib/pde.js';

/**
 * Engine around a lazily created AudioContext. `win` defaults to globalThis so tests can install a
 * fake `AudioContext` constructor there.
 */
export function createAudio(win = globalThis) {
    let ac = null;
    let source = null;
    let disposed = false;

    const Ctor = () => (win && (win.AudioContext || win.webkitAudioContext)) || null;

    return {
        /** True when a Web Audio constructor exists. */
        get available() { return !!Ctor(); },
        get context() { return ac; },

        /**
         * Synthesises the partials (amps / frequency ratios) and plays them once.
         * Returns true when sound was started, false when the API is missing or disposed.
         */
        play(amps, ratios, f0 = 220, seconds = 2.2) {
            if (disposed) return false;
            const C = Ctor();
            if (!C) return false;
            try {
                if (!ac) ac = new C();
                if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume();
                const sr = ac.sampleRate || 44100;
                const data = synthString(amps, ratios, f0, sr, seconds);
                const buf = ac.createBuffer(1, data.length, sr);
                buf.getChannelData(0).set(data);
                this.stop();
                source = ac.createBufferSource();
                source.buffer = buf;
                source.connect(ac.destination);
                source.start();
                return true;
            } catch {
                return false;
            }
        },

        stop() {
            if (source) {
                try { source.stop(); } catch { /* already stopped */ }
                try { source.disconnect(); } catch { /* ignore */ }
                source = null;
            }
        },

        /** Stops sound and closes the context; safe to call repeatedly. */
        dispose() {
            disposed = true;
            this.stop();
            if (ac) {
                try { const r = ac.close(); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* ignore */ }
                ac = null;
            }
        },
    };
}
