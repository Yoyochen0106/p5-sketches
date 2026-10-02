// Default (persisted) settings of the Impulse Response Lab. Drawn curves are NOT persisted.

export const DEFAULTS = {
    n: 256,
    fs: 1000,
    method: 'wiener',
    lambda: -6, // log10 of the regularisation relative to max|X|^2
    support: 100, // support length L as % of N
    derived: 'h', // which signal is computed: 'h' (solve h), 'y' (solve y), 'x' (solve x)
    active: 'x',
    tool: 'raise',
    radius: 4, // brush radius, % of N
    soft: 0.5,
    strength: 0.5,
    mirror: false,
    'preset.x': 'gauss',
    'preset.sys': 'echo',
    'sys.delay': 12, // echo delay, % of N
    'sys.gain': 0.6,
    noise: 0, // measurement noise on y, % of its rms
    magDb: false,
    dbRange: 80,
    phase: 'wrapped',
    groupDelay: false,
    recon: true,
    phaseModel: 'minimum',
};

export const FS_OPTIONS = [1, 100, 1000, 8000, 44100, 48000, 96000];
export const METHODS = [
    { value: 'wiener', label: 'Frequency domain (Wiener / Tikhonov)' },
    { value: 'ls', label: 'Time-domain least squares' },
    { value: 'nnls', label: 'Non-negative least squares' },
];
export const TOOLS = [
    { value: 'raise', label: 'Raise' },
    { value: 'lower', label: 'Lower' },
    { value: 'smooth', label: 'Smooth' },
    { value: 'flatten', label: 'Flatten' },
    { value: 'line', label: 'Line' },
];
