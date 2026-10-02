// Default settings and shared constants for the Fourier Painter.

export const DEFAULTS = {
    mode: 'curve',
    // curve mode
    'curve.preset': 'heart',
    'curve.N': 512,
    'curve.K': 24,
    'curve.order': 'amp',
    'curve.smooth': 2,
    'curve.speed': 1,
    'curve.play': true,
    'curve.circles': true,
    'curve.arrows': true,
    'curve.trace': true,
    'curve.partial': true,
    'curve.ghost': true,
    'curve.spectrum': true,
    'curve.specRange': 40,
    // image mode
    'img.n': 64,
    'img.preset': 'ring',
    'img.mode': 'square',
    'img.K': 6,
    'img.radius': 8,
    'img.top': 150,
    'img.tool': 'draw',
    'img.size': 3,
    'img.hardness': 0.6,
    'img.maskTool': 'add',
    'img.maskSize': 2,
    'img.error': true,
};

export const GAP = 8;
