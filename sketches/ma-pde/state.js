// Default (persisted / deep-link) settings of the PDE unit. Drawn curves and painted plates are
// NOT persisted; only scalar model parameters are, so '#/ma-pde?tab=wave&w.bc=free' works.

export const DEFAULTS = {
    tab: 'heat',
    play: true,
    speed: 1,
    // brush (heat / wave / laplace)
    tool: 'raise',
    radius: 6, // % of the curve length
    soft: 0.5,
    strength: 0.6,
    // plate painting
    ptool: 'source',
    pradius: 3, // cells
    // ---- heat ----
    'h.bc': 'dirichlet',
    'h.preset': 'step',
    'h.alpha': 0.1,
    'h.T': 1.5, // time span in units of the slowest decay time tau = 1/(alpha k1^2)
    'h.t': 0, // seek (fraction of the span)
    'h.terms': 40,
    'h.Tl': 0,
    'h.Tr': 1,
    'h.seed': 1,
    'h.fd': 'off', // off | ftcs | be | cn
    'h.fdN': 32,
    'h.r': 0.4,
    // ---- wave ----
    'w.bc': 'fixed',
    'w.preset': 'pluck',
    'w.c': 1,
    'w.x0': 0.3, // pluck / strike position (fraction of L)
    'w.method': 'both', // dalembert | modes | both
    'w.terms': 40,
    'w.gamma': 0,
    'w.disp': 'none', // none | beam
    'w.T': 2, // time span in fundamental periods 2L/c
    'w.t': 0,
    'w.f0': 220,
    // ---- laplace ----
    'l.preset': 'bump',
    'l.aspect': 1,
    'l.terms': 30,
    'l.show': 'series', // series | relax | diff
    'l.contours': 12,
    'l.walk': false,
    'l.walkers': 4000,
    'l.seed': 1,
    'l.px': 0.4,
    'l.py': 0.6,
    // ---- plate ----
    'p.preset': 'spot',
    'p.edge': 'cold', // cold | insulated
    'p.method': 'adi', // adi | explicit
    'p.alpha': 0.3,
    'p.r': 0.4,
    'p.aspect': 0.75, // b / a
    'p.T': 1, // value of fixed-temperature paint
    'p.q': 4, // source strength
    'p.mode': 'off', // off | heat | vib
    'p.m': 2,
    'p.n': 1,
    'p.speed': 1,
};

export const TOOLS = [
    { value: 'raise', label: 'Raise' },
    { value: 'lower', label: 'Lower' },
    { value: 'smooth', label: 'Smooth' },
    { value: 'flatten', label: 'Flatten' },
    { value: 'line', label: 'Line' },
];

export const PLATE_TOOLS = [
    { value: 'source', label: 'Source' },
    { value: 'sink', label: 'Sink' },
    { value: 'fixed', label: 'Fixed T' },
    { value: 'hole', label: 'Hole' },
    { value: 'erase', label: 'Erase' },
];

export const TABS = [
    { value: 'heat', label: 'Heat' },
    { value: 'wave', label: 'Wave' },
    { value: 'laplace', label: 'Laplace' },
    { value: 'plate', label: 'Plate 2D' },
];

export const HEAT_BCS = [
    { value: 'dirichlet', label: 'Dirichlet  u(0)=u(L)=0' },
    { value: 'neumann', label: 'Neumann  u_x=0 at both ends (insulated)' },
    { value: 'mixed', label: 'Mixed  u(0)=0, u_x(L)=0' },
    { value: 'periodic', label: 'Periodic  (ring)' },
    { value: 'fixed', label: 'Fixed ends  u(0)=T0, u(L)=T1' },
];

export const HEAT_PRESETS = [
    { value: '', label: 'custom (drawn)' },
    { value: 'step', label: 'step (box)' },
    { value: 'triangle', label: 'triangle' },
    { value: 'gaussian', label: 'gaussian' },
    { value: 'sawtooth', label: 'sawtooth' },
    { value: 'random', label: 'random' },
];

export const WAVE_BCS = [
    { value: 'fixed', label: 'Fixed ends  u=0' },
    { value: 'free', label: 'Free ends  u_x=0' },
    { value: 'fixedfree', label: 'Fixed at 0, free at L' },
    { value: 'infinite', label: 'Infinite line' },
];

export const WAVE_PRESETS = [
    { value: '', label: 'custom (drawn)' },
    { value: 'pluck', label: 'plucked (triangle, v=0)' },
    { value: 'strike', label: 'struck (velocity pulse)' },
    { value: 'bow', label: 'bowed (uniform velocity)' },
    { value: 'pulse', label: 'gaussian pulse' },
    { value: 'mode3', label: 'third harmonic' },
];

export const LAPLACE_PRESETS = [
    { value: '', label: 'custom (drawn)' },
    { value: 'bump', label: 'one hot side (sine bump on top)' },
    { value: 'quad', label: 'saddle (+ top/bottom, - left/right)' },
    { value: 'ramp', label: 'ramp (u = x/a on the edges)' },
    { value: 'step', label: 'step on top (discontinuous)' },
    { value: 'spot', label: 'hot spot on the top edge' },
    { value: 'random', label: 'random smooth' },
];

export const PLATE_PRESETS = [
    { value: '', label: 'custom (painted)' },
    { value: 'spot', label: 'hot spot in the centre' },
    { value: 'bar', label: 'hot bar, cold edge' },
    { value: 'hole', label: 'source + insulated hole' },
    { value: 'gradient', label: 'two fixed-temperature walls' },
    { value: 'mode', label: 'product mode (m, n)' },
];

export const ASPECTS = [0.5, 0.75, 1, 1.5, 2];
