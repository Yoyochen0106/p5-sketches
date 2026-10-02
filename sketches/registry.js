// Sketch registry: the menu is generated from this list. `load` lazily imports the sketch module.
export const SKETCHES = [
  {
    id: 'approx',
    title: 'Function Approximation Lab',
    description: 'Taylor, Pade, Fourier and wavelet approximations of real and complex functions.',
    load: () => import('./approx/index.js'),
  },
  {
    id: 'hello',
    title: 'Hello (demo)',
    description: 'Tiny demo sketch exercising settings, the drawer UI, p5 instance mode and unmounting.',
    load: () => import('./hello/index.js'),
  },
  {
    id: 'monge',
    title: "Monge's Theorem",
    description: 'Drag three circles: the intersection points of their external common tangents always lie on one line.',
    load: () => import('./monge/index.js'),
  },
];
