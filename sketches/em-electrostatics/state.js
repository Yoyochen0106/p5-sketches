// Settings defaults, option lists and static texts for the electrostatics unit.

export const TABS = [
  { value: 'charges', label: 'Charges' },
  { value: 'gauss', label: 'Gauss' },
  { value: 'continuous', label: 'Continuous' },
];

export const DEFAULTS = {
  tab: 'charges',
  preset: 'dipole',
  charges: '',
  law: '3d',
  soft: 0.05,
  tool: 'move',
  newQ: 1,
  // display
  lines: true,
  perUnit: 8,
  equi: true,
  equiLog: false,
  equiCount: 14,
  map: 'E',
  arrows: false,
  grid: true,
  farField: false,
  // test charge
  pm: 1,
  pq: 1,
  pspeed: 8,
  'sel.q': 0,
  // gauss
  'gauss.kind': 'circle',
  'gauss.fieldLines': true,
  'gauss.arrows': true,
  'gauss.sweep': false,
  'gauss.speed': 0.5,
  // continuous
  'cont.kind': 'ring',
  'cont.Q': 1,
  'cont.size': 1,
  'cont.profile': 'axis',
  'cont.res': 40,
};

export const TOOLS = [
  { value: 'move', label: 'Move / pan' },
  { value: 'add', label: 'Add charge (click)' },
  { value: 'remove', label: 'Remove charge (click)' },
  { value: 'test', label: 'Launch test charge (drag)' },
];

export const MAP_OPTIONS = [
  { value: 'none', label: 'none' },
  { value: 'E', label: '|E| colour map (log)' },
  { value: 'V', label: 'potential V (signed)' },
];

export const LAW_OPTIONS = [
  { value: '3d', label: '3D Coulomb slice  (E ~ 1/r^2, V ~ 1/r)' },
  { value: '2d', label: 'True 2D / line charges  (E ~ 1/r, V ~ -ln r)' },
];

export const GAUSS_KINDS = [
  { value: 'circle', label: 'circle' },
  { value: 'rect', label: 'rectangle' },
  { value: 'poly', label: 'free polygon' },
];

export const CONT_KINDS = [
  { value: 'rod', label: 'charged rod (line segment on the axis)' },
  { value: 'ring', label: 'ring' },
  { value: 'disk', label: 'uniform disk' },
  { value: 'ball', label: 'uniform ball' },
  { value: 'gauss', label: 'gaussian blob' },
];

export const THEORY = 'Coulomb: E = k q r_hat / r^2 with k = 1/(4 pi eps0) (units here: eps0 = 1); E = -grad V; field lines start on + and end on -, '
  + 'their density is |E|; equipotentials cross them at right angles. Gauss: the flux of E through a closed surface equals Q_enclosed / eps0. '
  + 'In the true 2D (line-charge) law E = lambda / (2 pi eps0 r) and the flux through a closed curve is exactly Q/eps0 per unit length; '
  + 'in the 3D slice a closed curve is not a closed surface, so the Gauss tab always uses the 2D law.';

export const TRY_THIS = [
  'Charges: load "Dipole", switch the law to true 2D and watch the lines and equipotentials change; far away the dipole potential falls as 1/r^2 (3D) - check the far-field read-out.',
  'Charges: use the "Launch test charge" tool on a dipole; the total energy KE + qV stays constant (see the energy read-out).',
  'Gauss: drag a charge across the circle; the numerical flux jumps by q / eps0 exactly when it crosses, while a charge outside changes the local flux density but not the total.',
  'Gauss: draw a free polygon around two opposite charges: the flux is 0 although E is not.',
  'Continuous: compare the on-axis field of a ring, a disk and a rod with the analytic curves; far away they all become Q / (4 pi z^2).',
];
