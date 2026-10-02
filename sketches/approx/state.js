// Default values for every persisted setting of the approximation lab.

export const DEFAULTS = {
    func: 'sin',
    expr: 'sin(x)/(1+x^2)',
    mode: 'split',          // 'real' | 'split' | 'complex'
    showGrid: true,
    showError: true,
    showRadius: true,
    block: 3,               // complex panel: screen pixels per sample (lower = sharper, slower)

    'taylor.on': true,
    'taylor.order': 5,
    'taylor.ghosts': true,
    'taylor.animate': false,

    'pade.on': false,
    'pade.L': 3,
    'pade.M': 3,

    'fourier.on': false,
    'fourier.N': 5,
    'fourier.period': 0,    // 0 = automatic
    'fourier.window': 'none', // summation window (lib/fourier-windows.js)
    'fourier.gibbs': true,  // overshoot read-out + N gauge for functions with a jump

    'wavelet.on': false,
    'wavelet.family': 'db4',
    'wavelet.level': 5,
    'wavelet.keepPct': 100,
    'wavelet.samples': 1024,
    'wavelet.mother': true,

    'interp.on': false,
    'interp.n': 10,
    'interp.family': 'chebyshev',
    'interp.window': 'view', // 'view' = the visible x range, 'center' = [a - W, a + W]
    'interp.W': 1,
    'interp.compare': false, // dashed Chebyshev interpolant of the same degree for comparison

    'audio.playing': false, // never restored as true: playback needs a user gesture
    'audio.freq': 220,
    'audio.volume': 0.4,
    'audio.original': false,

    'cplx.source': 'taylor',
    'cplx.cwt': 'morlet',
    'cplx.inset': true,
    'cplx.overlay': true,

    lockOn: false,
    lockRe: 0,
    lockIm: 0,
};

// Listen section: per-track mute / solo flags ('original' = f itself, then every method id).
export const AUDIO_TRACKS = ['original', 'taylor', 'pade', 'fourier', 'wavelet', 'interp'];
for (const id of AUDIO_TRACKS) {
    DEFAULTS[`audio.mute.${id}`] = false;
    DEFAULTS[`audio.solo.${id}`] = false;
}

export function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
