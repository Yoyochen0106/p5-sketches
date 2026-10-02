// Default settings and presets of the Chladni Plates sketch.

export const SLOTS = 4;

export const DEFAULTS = {
    shape: 'square',        // 'square' | 'rect' | 'circle'
    kind: 'simply',         // rectangles: 'simply' | 'free' | 'clamped'
    aspect: 1.5,            // rectangle width / height
    dispersion: 'plate',    // 'plate' (omega ~ k^2) | 'membrane' (omega ~ k)
    phase: 0,               // free square: minus/plus combination; circle: cos/sin
    res: 96,                // lattice cells along the long side

    's0.m': 2, 's0.n': 1, 's0.a': 1,
    's1.m': 1, 's1.n': 2, 's1.a': 0,
    's2.m': 3, 's2.n': 1, 's2.a': 0,
    's3.m': 2, 's3.n': 3, 's3.a': 0,

    playing: true,
    speed: 0.35,            // cycles / second of the fundamental
    amp: 1,                 // drive / display amplitude (also scales the sand mobility)
    'drive.on': false,
    'drive.ratio': 3,       // drive frequency / fundamental frequency
    damping: 0.02,          // gamma / omega_1
    sweep: false,
    'src.u': 0.31,          // excitation point in unit-box coordinates of the plate
    'src.v': 0.43,

    showField: true,
    nodal: true,
    lineWidth: 2,
    'sand.on': false,
    'sand.count': 3000,
    preset: '',
};

const FREE = { kind: 'free' };
const reset = { 's1.a': 0, 's2.a': 0, 's3.a': 0, 's0.a': 1, 'drive.on': false, sweep: false };

/** Classic Chladni figures and a few mixtures. Each preset is a settings patch. */
export const PRESETS = [
    { id: 'cross', label: 'Free square (1,2): saddle', patch: { shape: 'square', ...FREE, phase: 0, 's0.m': 1, 's0.n': 2, ...reset } },
    { id: 'diamond', label: 'Free square (1,2) plus: diamond', patch: { shape: 'square', ...FREE, phase: 1, 's0.m': 1, 's0.n': 2, ...reset } },
    { id: 'grid', label: 'Free square (1,3)', patch: { shape: 'square', ...FREE, phase: 0, 's0.m': 1, 's0.n': 3, ...reset } },
    { id: 'star', label: 'Free square (2,3)', patch: { shape: 'square', ...FREE, phase: 0, 's0.m': 2, 's0.n': 3, ...reset } },
    { id: 'lattice', label: 'Free square (3,5)', patch: { shape: 'square', ...FREE, phase: 0, 's0.m': 3, 's0.n': 5, ...reset } },
    { id: 'ss21', label: 'Simply supported (2,1)', patch: { shape: 'square', kind: 'simply', 's0.m': 2, 's0.n': 1, ...reset } },
    { id: 'ss33', label: 'Simply supported (3,3)', patch: { shape: 'square', kind: 'simply', 's0.m': 3, 's0.n': 3, ...reset } },
    {
        id: 'beat', label: 'Mix (1,2) + (2,1): beating diagonal',
        patch: { shape: 'square', kind: 'simply', 's0.m': 1, 's0.n': 2, 's0.a': 1, 's1.m': 2, 's1.n': 1, 's1.a': 1, 's2.a': 0, 's3.a': 0, 'drive.on': false, sweep: false },
    },
    { id: 'rings', label: 'Circle (0,3): concentric rings', patch: { shape: 'circle', 's0.m': 0, 's0.n': 3, ...reset } },
    { id: 'sectors', label: 'Circle (3,1): six sectors', patch: { shape: 'circle', 's0.m': 3, 's0.n': 1, ...reset } },
    { id: 'wheel', label: 'Circle (2,2): rings and sectors', patch: { shape: 'circle', 's0.m': 2, 's0.n': 2, ...reset } },
    { id: 'rect', label: 'Rectangle 3:2 clamped (3,2)', patch: { shape: 'rect', kind: 'clamped', aspect: 1.5, 's0.m': 3, 's0.n': 2, ...reset } },
    {
        id: 'driven', label: 'Driven: tap the plate and sweep',
        patch: { shape: 'square', kind: 'simply', 's0.a': 1, 's1.a': 0, 's2.a': 0, 's3.a': 0, 'drive.on': true, 'drive.ratio': 2, sweep: true, 'sand.on': true },
    },
];
