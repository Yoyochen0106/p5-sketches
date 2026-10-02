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
  {
    id: 'fourier2d',
    title: 'Fourier Painter',
    description: 'Draw a curve and watch epicycles fit it, or paint an image and keep only some 2D frequencies.',
    load: () => import('./fourier2d/index.js'),
  },
  {
    id: 'equal-area',
    title: 'Equal-Area Transformations',
    description: 'Slide a vertex parallel to the opposite side: the area never changes. Triangles, polygon reduction and squaring the triangle.',
    load: () => import('./equal-area/index.js'),
  },
  {
    id: 'conformal',
    title: 'Conformal Maps',
    description: 'Grids, angles and local magnification under complex maps: z\u00b2, exp, sin, Joukowski, M\u00f6bius, polynomials.',
    load: () => import('./conformal/index.js'),
  },
];
