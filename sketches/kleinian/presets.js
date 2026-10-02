// Settings defaults and the preset gallery of Moebius groups for the Kleinian tabs.

export const DEFAULTS = {
    tab: 'ifs',
    // IFS tab
    'ifs.preset': 'sierpinski',
    'ifs.color': 'tag',
    'ifs.speed': 100000,
    'ifs.paused': false,
    'ifs.autoW': false,
    'ifs.count': 3,
    'ifs.showMaps': true,
    'ifs.w0': 1, 'ifs.w1': 1, 'ifs.w2': 1, 'ifs.w3': 1, 'ifs.w4': 1, 'ifs.w5': 1,
    // Moebius / Kleinian plane tab
    'kl.preset': 'apollonian',
    'kl.kind': 'apollonian',
    'kl.method': 'both',
    'kl.depth': 8,
    'kl.speed': 60000,
    'kl.color': 'letter',
    'kl.paused': false,
    'kl.showCircles': true,
    'kl.showOrbit': true,
    'kl.orbitDepth': 2,
    'kl.nGens': 2,
    'kl.theta0': 0, 'kl.theta1': 0, 'kl.theta2': 0,
    'kl.taRe': 2, 'kl.taIm': 0, 'kl.tbRe': 2, 'kl.tbIm': 0,
    // Riemann sphere tab
    'sp.spin': false,
    'sp.speed': 0.4,
    'sp.circles': true,
    'sp.graticule': true,
    'sp.size': 1,
};

export const TABS = [
    { value: 'ifs', label: 'Affine IFS' },
    { value: 'plane', label: 'Moebius plane' },
    { value: 'sphere', label: 'Riemann sphere' },
];

/** Symmetric Fuchsian Schottky pairs: four circles orthogonal to the unit circle, half-angle alpha < pi/4. */
export function fuchsianPairs(alpha) {
    const d = 1 / Math.cos(alpha), r = Math.tan(alpha);
    return [
        { c1: [d, 0], r1: r, c2: [-d, 0], r2: r, theta: Math.PI },
        { c1: [0, d], r1: r, c2: [0, -d], r2: r, theta: 2 * Math.PI },
    ];
}

/** The Fuchsian pairs with the twist of some generators changed: a deformation away from the unit circle. */
const twisted = (pairs, d) => pairs.map((q, k) => ({ ...q, theta: q.theta + d[k] }));

function threePairs() {
    const out = [];
    for (let k = 0; k < 3; k++) {
        const a = (2 * Math.PI * k) / 3;
        const p1 = [1.7 * Math.cos(a), 1.7 * Math.sin(a)];
        const p2 = [1.7 * Math.cos(a + Math.PI / 3), 1.7 * Math.sin(a + Math.PI / 3)];
        out.push({ c1: p1, r1: 0.82, c2: p2, r2: 0.82, theta: 0 });
    }
    return out;
}

/**
 * kind 'apollonian': gasket circles + inversion chaos game; 'schottky': draggable circle pairs;
 * 'recipe': Grandma's recipe from ta, tb; 'maskit': recipe with tb = 2 and ta = mu.
 * view = { cx, cy, half } is the half height of the initial window.
 */
export const KLEIN_PRESETS = [
    { id: 'apollonian', label: 'Apollonian gasket (Descartes circles)', kind: 'apollonian', view: { cx: 0, cy: 0, half: 1.15 } },
    { id: 'gasket-group', label: "Grandma's special group (ta = tb = 2)", kind: 'recipe', ta: [2, 0], tb: [2, 0], view: { cx: 0, cy: 0, half: 1.4 } },
    { id: 'maskit-cusp', label: 'Maskit cusp group (tb = 2, mu = 1 + 2i)', kind: 'maskit', ta: [1, 2], tb: [2, 0], view: { cx: 0, cy: 0, half: 1.4 } },
    { id: 'maskit-circle', label: 'Maskit slice, Fuchsian (tb = 2, mu = 2.5i)', kind: 'maskit', ta: [0, 2.5], tb: [2, 0], view: { cx: 0, cy: 0, half: 1.4 } },
    { id: 'quasi-fuchsian', label: 'Quasi-Fuchsian torus (ta = 3 + 0.4i, tb = 3 - 0.4i)', kind: 'recipe', ta: [3, 0.4], tb: [3, -0.4], view: { cx: 0, cy: 0, half: 1.5 } },
    { id: 'fuchsian-torus', label: 'Fuchsian torus (ta = tb = 3, circle limit set)', kind: 'recipe', ta: [3, 0], tb: [3, 0], view: { cx: 0, cy: 0, half: 1.5 } },
    { id: 'fuchsian-cantor', label: 'Fuchsian Schottky group (Cantor set on a circle)', kind: 'schottky', pairs: fuchsianPairs(0.6), view: { cx: 0, cy: 0, half: 1.9 } },
    { id: 'fuchsian-circle', label: 'Fuchsian group, tangent circles (full circle)', kind: 'schottky', pairs: fuchsianPairs(Math.PI / 4), view: { cx: 0, cy: 0, half: 1.9 } },
    { id: 'circle-chain', label: 'Schottky circle chain (near-tangent circles, twisted)', kind: 'schottky', pairs: twisted(fuchsianPairs(0.76), [0.4, 0]), view: { cx: 0, cy: 0, half: 1.9 } },
    { id: 'schottky3', label: 'Schottky group, 3 generators', kind: 'schottky', pairs: threePairs(), view: { cx: 0, cy: 0, half: 2.9 } },
];

export const getKleinPreset = (id) => KLEIN_PRESETS.find((q) => q.id === id) || null;

/** Default circle pair number k for a new generator. */
export function defaultPair(k) {
    const a = 1.1 * k;
    return {
        c1: [1.4 * Math.cos(a), 1.4 * Math.sin(a)], r1: 0.5,
        c2: [1.4 * Math.cos(a + Math.PI), 1.4 * Math.sin(a + Math.PI)], r2: 0.5, theta: 0,
    };
}
