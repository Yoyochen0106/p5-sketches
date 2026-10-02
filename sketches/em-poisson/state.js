// Settings defaults, option lists and static texts for the Laplace & Poisson solver unit.

export const DEFAULTS = {
  preset: 'plates',
  res: 128,
  aspect: 1,
  bc: 'neumann',
  width: 10, // domain width in cm
  V: 30000, // electrode voltage [V]
  epsr: 1,
  rho: 2000, // painted charge density [uC/m^3]
  Eb: 3, // breakdown field [MV/m] (dry air)
  tool: 'probe',
  brush: 4,
  // solvers
  method: 'sor',
  'm.jacobi': true,
  'm.gs': true,
  'm.sor': true,
  'm.rb': false,
  'm.mg': true,
  omega: 0, // 0 = optimal
  sweeps: 2,
  run: true,
  // display
  'show.map': 'phi',
  'show.equi': true,
  'show.arrows': false,
  'show.charge': true,
  'show.breakdown': true,
  equiCount: 14,
  'plot.logx': true,
  'plot.work': false,
};

export const TOOLS = [
  { value: 'probe', label: 'Probe' },
  { value: 'conductor', label: 'Conductor' },
  { value: 'dielectric', label: 'Dielectric' },
  { value: 'charge', label: 'Charge' },
  { value: 'erase', label: 'Erase' },
];

export const RES_OPTIONS = [64, 128, 256].map((n) => ({ value: n, label: `${n} x ${n} cells` }));
export const ASPECT_OPTIONS = [
  { value: 1, label: 'square (1 : 1)' },
  { value: 0.75, label: '4 : 3' },
  { value: 0.5, label: '2 : 1' },
];
export const BC_OPTIONS = [
  { value: 'grounded', label: 'grounded box (Dirichlet 0 V)' },
  { value: 'neumann', label: 'Neumann (zero normal field)' },
  { value: 'periodic', label: 'periodic' },
];
export const MAP_OPTIONS = [
  { value: 'phi', label: 'potential phi' },
  { value: 'E', label: '|E| (log)' },
  { value: 'none', label: 'none (materials only)' },
];

export const METHOD_COLORS = {
  jacobi: '#ff6b6b',
  gs: '#ffa94d',
  sor: '#69db7c',
  rb: '#38d9a9',
  mg: '#74c0fc',
};

export const THEORY = 'Electrostatics reduces to one PDE: div(eps grad phi) = -rho/eps0, E = -grad phi (Poisson; Laplace where rho = 0). '
  + 'A conductor is a region of fixed phi (Dirichlet); E is normal to its surface and sigma = eps0 E_n. A dielectric changes eps_r: tangential E and normal D = eps E are continuous, so field lines refract with tan(theta1)/tan(theta2) = eps1/eps2. '
  + 'The 5-point finite-volume stencil gives a big sparse system; Jacobi, Gauss-Seidel and SOR (optimal omega = 2/(1 + sin(pi/N))) relax it iteratively, multigrid removes smooth error on coarse grids and converges in ~10 cycles independent of N. '
  + 'Capacitance C = Q/V = 2W/V^2 (charge and energy methods must agree). Sharp tips concentrate the field (lightning-rod effect); air breaks down near 3 MV/m.';

export const TRY_THIS = [
  'Load "Parallel plates" and compare C from charge and from energy with eps_r w / d: raise eps_r and watch both scale.',
  'Switch on Jacobi, Gauss-Seidel, SOR and multigrid together (same problem, lock-step) and read the residual-vs-iteration plot: 5000, 2500, ~300 and ~10 iterations.',
  '"Wedge / point electrode": the field enhancement beta at the tip is far above 1 and the red breakdown overlay lights up at 30 kV; lower V or round the tip by painting.',
  '"Shielded box": compare |E| inside and outside the shell; open a slot and watch the field leak in.',
  'Paint your own conductors and dielectrics; try periodic boundaries with + and - charge blobs.',
];
