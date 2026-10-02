// Complex Integration & Residues (course unit "ma-residue" of Engineering Mathematics).
// Tabs: Residue theorem | Deformation | Real integrals | Argument principle (with Nyquist mode).
// Maths: lib/residues.js (+ lib/conformal.js, lib/complex.js, lib/domaincolor.js). Drawing / interaction: the *-tab.js files.
//
// Public settings (deep-link keys; all scalar or string):
//   tab      residue | deform | real | arg
//   rpreset  residue preset id                  rmode  residue | cauchy
//   poles    "x,y,m,cr,ci;..." poles of f (order m = 1..3, complex coefficient c)    zeros  "x,y;..."    expk  k of e^{kz}
//   ckind    circle | poly | free     ccx,ccy,cr  circle;   cpts  "x,y;..." polygon / free loop vertices
//   dmode    homotopy | branch        ds  morph parameter 0..1;  dfun sqrt | log;  dcut  cut angle (rad)
//   rex      real-integral example id | laurent | bromwich;     R  contour radius;   ra, rb, rw  example parameters
//   lfun, lcx, lcy, lr   Laurent viewer;   bt, bc, bR   Bromwich (time, abscissa, radius)
//   num, den  comma separated coefficients, highest power first;  K  loop gain;  delay  seconds   (Nyquist + Bromwich)
//   nyq      true = Nyquist mode of the argument principle tab;   apreset / npreset  presets
//   azeros, apoles ("x,y,m;..."), akind, acx, acy, ar, apts   argument-principle contour and f.

import { getPalette } from '../approx/palette.js';
import { TABS, withDefaults, offCanvas, isPrimary, typing } from './common.js';
import { RESIDUE_PRESETS } from './model.js';
import { CAUCHY_FUNCS, createResidueTab } from './residue-tab.js';
import { createDeformTab } from './deform-tab.js';
import { createRealTab, REAL_OPTIONS } from './real-tab.js';
import { createArgTab, ARG_PRESETS, NYQ_PRESETS } from './arg-tab.js';
import { LINKS, exprFromItems, conformalLink } from './links.js';
import { parseCoefs } from '../../lib/residues.js';

const is = (key, ...vals) => (s) => vals.includes(s.get(key));
const both = (a, b) => (s) => a(s) && b(s);
const tabIs = (...t) => is('tab', ...t);
const o = (value, label) => ({ value, label });

function go(hash) {
    if (typeof location !== 'undefined') location.hash = hash;
}

function buildSchema(A, links) {
    const rex = (...ids) => is('rex', ...ids);
    const contourEx = (s) => !['laurent', 'bromwich'].includes(s.get('rex'));
    const validCoefs = (v) => (parseCoefs(v) ? null : 'comma separated numbers, highest power first');
    return [
        // ---------------- residue theorem ----------------
        {
            type: 'group', label: 'Residue theorem', visibleIf: tabIs('residue'), children: [
                { type: 'select', key: 'rpreset', label: 'preset', options: RESIDUE_PRESETS.map((q) => o(q.id, q.label)) },
                { type: 'select', key: 'rmode', label: 'mode', options: [o('residue', 'Residue theorem: oint f dz = 2 pi i sum Res'), o('cauchy', "Cauchy's theorem & integral formula")] },
                { type: 'toggle', key: 'bg', label: 'domain colouring (hue = arg, brightness = |f|)' },
                {
                    type: 'group', label: 'Poles and zeros of f', visibleIf: is('rmode', 'residue'), children: [
                        { type: 'button', label: 'Add pole', onClick: A.residue.addPole },
                        { type: 'button', label: 'Remove last pole', onClick: A.residue.removePole },
                        { type: 'button', label: 'Add zero', onClick: A.residue.addZero },
                        { type: 'button', label: 'Remove last zero', onClick: A.residue.removeZero },
                        { type: 'slider', key: 'pm', label: 'order of the selected pole (click a pole)', min: 1, max: 3, step: 1 },
                        { type: 'slider', key: 'pcr', label: 'Re c of the selected pole', min: -3, max: 3, step: 0.05 },
                        { type: 'slider', key: 'pci', label: 'Im c of the selected pole', min: -3, max: 3, step: 0.05 },
                        { type: 'slider', key: 'expk', label: 'entire factor e^{kz}: k', min: 0, max: 2, step: 0.05 },
                        { type: 'info', text: 'f(z) = (prod of zeros) e^{kz} sum_j c_j / (z - p_j)^{m_j}. Without zeros and k = 0 a pole of order m > 1 has residue 0: only c/(z-p) contributes.' },
                    ],
                },
                {
                    type: 'group', label: 'Analytic function g', visibleIf: is('rmode', 'cauchy'), children: [
                        { type: 'select', key: 'cg', label: 'g(z)', options: Object.entries(CAUCHY_FUNCS).map(([k, v]) => o(k, v.label)) },
                        {
                            type: 'select', key: 'cn', label: 'what to compute',
                            options: [o(-1, "Cauchy's theorem: oint g dz"), o(0, 'g(a) = (1/2 pi i) oint g/(z-a) dz'), o(1, "g'(a) = (1/2 pi i) oint g/(z-a)^2 dz"), o(2, 'g\'\'(a) = (2!/2 pi i) oint g/(z-a)^3 dz'), o(3, 'g\'\'\'(a)')],
                        },
                        { type: 'info', text: 'Drag the green square a, and the contour. With g = 1/(z-q) drag the singularity q inside / outside the contour: the formula holds only while g is analytic inside.' },
                    ],
                },
                {
                    type: 'group', label: 'Contour', children: [
                        { type: 'select', key: 'ckind', label: 'shape', options: [o('circle', 'circle (centre + radius handle)'), o('poly', 'polygon (vertices, mid-edge diamonds add)'), o('free', 'free-drawn loop (drag on the background)')] },
                        { type: 'button', label: 'Add vertex (polygon)', onClick: A.residue.addVertex },
                        { type: 'button', label: 'Remove vertex (polygon)', onClick: A.residue.removeVertex },
                        { type: 'button', label: 'Reverse direction (polygon / loop)', onClick: A.residue.reverse },
                        { type: 'button', label: 'Fit view (F)', onClick: A.residue.fit },
                    ],
                },
                { type: 'button', label: 'Reset preset', onClick: A.residue.reset },
                {
                    type: 'info', text: 'Theory: for f analytic except at isolated poles p_k, oint_C f dz = 2 pi i sum_k n(C, p_k) Res(f, p_k), n = winding number. '
                        + 'Res at a pole of order m: (1/(m-1)!) d^(m-1)/dz^(m-1) [(z-p)^m f] at p (a simple pole: lim (z-p) f). '
                        + 'The program integrates numerically (adaptive Gauss-Legendre on every segment) and compares with the residue sum; the discrepancy should stay near round-off.',
                },
                {
                    type: 'info', text: 'Try this: (1) drag the circle edge across a pole and watch the integral jump. (2) Select the double pole and change k: how does its residue change? '
                        + '(3) Load "Figure-eight loop" and check the +1 / -1 windings. (4) In Cauchy mode make g = 1/(z-q) and move q into the loop. (5) Draw your own loop around the poles.',
                },
            ],
        },
        // ---------------- deformation ----------------
        {
            type: 'group', label: 'Deformation of contours', visibleIf: tabIs('deform'), children: [
                { type: 'select', key: 'dmode', label: 'demo', options: [o('homotopy', 'Homotopy: sweep a loop across poles'), o('branch', 'Branch cut toy: sqrt z and log z')] },
                { type: 'slider', key: 'ds', label: 'morph parameter s', min: 0, max: 1, step: 0.005, visibleIf: is('dmode', 'homotopy') },
                { type: 'toggle', key: 'dplay', label: 'play (Space)', visibleIf: is('dmode', 'homotopy') },
                { type: 'slider', key: 'dwig', label: 'wiggle of the target loop B', min: 0, max: 0.6, step: 0.02, visibleIf: is('dmode', 'homotopy') },
                { type: 'toggle', key: 'bg', label: 'domain colouring', visibleIf: is('dmode', 'homotopy') },
                { type: 'select', key: 'dfun', label: 'function', options: [o('sqrt', 'sqrt(z)'), o('log', 'log(z)')], visibleIf: is('dmode', 'branch') },
                { type: 'slider', key: 'dcut', label: 'cut direction (rad)', min: -3.1416, max: 3.1416, step: 0.01, visibleIf: is('dmode', 'branch') },
                { type: 'slider', key: 'dcr', label: 'loop radius', min: 0.1, max: 3, step: 0.05, visibleIf: is('dmode', 'branch') },
                { type: 'button', label: 'Reset', onClick: A.deform.reset },
                {
                    type: 'info', text: 'Theory: if two closed contours are homotopic in the region where f is analytic, the integrals agree (Cauchy). Sweeping a contour over a pole changes the integral by 2 pi i Res. '
                        + 'Branch cuts: sqrt(z) changes sign and log(z) gains 2 pi i after one turn round 0; a cut is an artificial barrier that you may place anywhere, but the integral along a loop that crosses it is not the analytic one.',
                },
                {
                    type: 'info', text: 'Try this: (1) play the morph and read the jump events on the right. (2) Drag the poles so that B encloses none: what is the final integral? '
                        + '(3) In the branch demo move the loop so that it encloses 0, then not, and compare the continuation and cut-branch integrals. (4) Rotate the cut: only loops crossing it change.',
                },
            ],
        },
        // ---------------- real integrals ----------------
        {
            type: 'group', label: 'Real integrals', visibleIf: tabIs('real'), children: [
                { type: 'select', key: 'rex', label: 'example', options: REAL_OPTIONS },
                { type: 'slider', key: 'R', label: 'contour radius R', min: 0.2, max: 12, step: 0.05, visibleIf: contourEx },
                { type: 'toggle', key: 'rplay', label: 'animate R (Space)', visibleIf: contourEx },
                { type: 'slider', key: 'ra', label: 'parameter a', min: 0.1, max: 4, step: 0.05, visibleIf: rex('cos', 'xsin', 'ft') },
                { type: 'slider', key: 'rb', label: 'centre b', min: -3, max: 3, step: 0.05, visibleIf: rex('ft') },
                { type: 'slider', key: 'rw', label: 'frequency w', min: 0, max: 6, step: 0.05, visibleIf: rex('ft') },
                { type: 'slider', key: 'reps', label: 'indentation radius eps', min: 0.01, max: 0.5, step: 0.01, visibleIf: rex('sinc') },
                { type: 'toggle', key: 'bg', label: 'domain colouring', visibleIf: rex('laurent') },
                { type: 'select', key: 'lfun', label: 'function', options: [o('zz1', '1/(z(z-1))'), o('exp1z', 'e^{1/z}'), o('sinz', 'sin(z)/z^4'), o('twopole', '1/((z-1)(z+2)) about 1'), o('cot', 'cot z'), o('zexp', 'z e^{1/z^2}')], visibleIf: rex('laurent') },
                { type: 'slider', key: 'lr', label: 'circle radius r', min: 0.05, max: 6, step: 0.01, visibleIf: rex('laurent') },
                { type: 'slider', key: 'ln', label: 'coefficients shown: |n| <=', min: 2, max: 10, step: 1, visibleIf: rex('laurent') },
                { type: 'text', key: 'num', label: 'numerator of F(s) (highest power first)', placeholder: '1', validate: validCoefs, visibleIf: rex('bromwich') },
                { type: 'text', key: 'den', label: 'denominator of F(s)', placeholder: '1,3,2', validate: validCoefs, visibleIf: rex('bromwich') },
                { type: 'slider', key: 'K', label: 'gain K', min: -10, max: 10, step: 0.05, visibleIf: rex('bromwich') },
                { type: 'slider', key: 'bt', label: 'time t (s)', min: 0, max: 20, step: 0.02, visibleIf: rex('bromwich') },
                { type: 'slider', key: 'bc', label: 'Bromwich abscissa c', min: -6, max: 6, step: 0.05, visibleIf: rex('bromwich') },
                { type: 'slider', key: 'bR', label: 'arc radius R', min: 1, max: 30, step: 0.5, visibleIf: rex('bromwich') },
                { type: 'button', label: 'Fit view (F)', onClick: A.real.fit },
                { type: 'button', label: 'Reset parameters', onClick: A.real.reset },
                {
                    type: 'info', text: 'Theory: close the real line by a big arc; oint = int_(-R)^R f dx + arc = 2 pi i sum Res(upper half plane). If the arc vanishes (|f| decays like 1/R^2, or Jordan: e^{iaz} with a > 0 and f -> 0) then the real integral is 2 pi i sum Res. '
                        + 'Poles on the axis are skipped by a small indentation (clockwise half circle contributes -i pi Res). Laurent: f = sum a_n (z-c)^n on an annulus, a_n = (1/2 pi i) oint f (z-c)^(-n-1) dz, and the principal part (n < 0) carries the singularity; a_-1 is the residue. '
                        + 'Bromwich: f(t) = (1/2 pi i) int_(c-i inf)^(c+i inf) F(s) e^(st) ds = sum Res[F e^(st)] for t > 0 (close to the left).',
                },
                {
                    type: 'info', text: 'Try this: (1) animate R: the arc contribution shrinks like 1/R and the total jumps when R passes a pole. (2) Compare cos(ax) for a = 0.2 and 3: Jordan decay is faster for large a. '
                        + '(3) Laurent: move the circle between the two annuli of 1/(z(z-1)) and watch the coefficients change completely. (4) Bromwich: put a complex pole pair into den (1,0.4,4) and see the damped oscillation.',
                },
            ],
        },
        // ---------------- argument principle ----------------
        {
            type: 'group', label: 'Argument principle', visibleIf: tabIs('arg'), children: [
                { type: 'toggle', key: 'nyq', label: 'Nyquist mode (D contour, L(s) = K num/den e^{-sT})' },
                { type: 'select', key: 'apreset', label: 'preset', options: ARG_PRESETS.map((q) => o(q.id, q.label)), visibleIf: (s) => !s.get('nyq') },
                { type: 'select', key: 'npreset', label: 'Nyquist preset', options: NYQ_PRESETS.map((q) => o(q.id, q.label)), visibleIf: (s) => !!s.get('nyq') },
                { type: 'toggle', key: 'bg', label: 'domain colouring' },
                { type: 'button', label: 'Add zero', onClick: A.arg.addZero },
                { type: 'button', label: 'Add zero pair (Nyquist: conjugates)', onClick: A.arg.addZeroPair, visibleIf: (s) => !!s.get('nyq') },
                { type: 'button', label: 'Remove last zero', onClick: A.arg.removeZero },
                { type: 'button', label: 'Add pole', onClick: A.arg.addPole },
                { type: 'button', label: 'Add pole pair (Nyquist: conjugates)', onClick: A.arg.addPair, visibleIf: (s) => !!s.get('nyq') },
                { type: 'button', label: 'Remove last pole', onClick: A.arg.removePole },
                { type: 'button', label: 'Raise order of the last pole', onClick: A.arg.orderUp, visibleIf: (s) => !s.get('nyq') },
                { type: 'select', key: 'akind', label: 'contour shape', options: [o('circle', 'circle'), o('poly', 'polygon'), o('free', 'free-drawn loop')], visibleIf: (s) => !s.get('nyq') },
                { type: 'button', label: 'Add vertex (polygon)', onClick: A.arg.addVertex, visibleIf: (s) => !s.get('nyq') },
                { type: 'button', label: 'Remove vertex (polygon)', onClick: A.arg.removeVertex, visibleIf: (s) => !s.get('nyq') },
                { type: 'button', label: 'Reverse direction', onClick: A.arg.reverse, visibleIf: (s) => !s.get('nyq') },
                { type: 'text', key: 'num', label: 'numerator (highest power first)', placeholder: '1', validate: validCoefs, visibleIf: (s) => !!s.get('nyq') },
                { type: 'text', key: 'den', label: 'denominator', placeholder: '1,3,2', validate: validCoefs, visibleIf: (s) => !!s.get('nyq') },
                { type: 'slider', key: 'K', label: 'loop gain K', min: -10, max: 80, step: 0.1, visibleIf: (s) => !!s.get('nyq') },
                { type: 'slider', key: 'delay', label: 'delay T (s)', min: 0, max: 3, step: 0.05, visibleIf: (s) => !!s.get('nyq') },
                { type: 'button', label: 'Fit views (F)', onClick: A.arg.fit },
                { type: 'button', label: 'Reset preset', onClick: A.arg.reset },
                {
                    type: 'info', text: 'Theory: for f meromorphic on and inside C with no zeros / poles on C, (1/2 pi i) oint f\'/f dz = N - P (zeros minus poles, with multiplicity) and this equals the winding number of the image curve f(C) about 0. '
                        + 'Nyquist: take C = the D contour of the right half plane (clockwise) and f = 1 + L. The winding of L(C) about -1 gives Z = P - W: Z closed-loop RHP poles, P open-loop RHP poles, W counter-clockwise encirclements of -1.',
                },
                {
                    type: 'info', text: 'Try this: (1) drag a zero across the contour; W changes by one. (2) Nyquist type 0: raise K past 60 and watch two encirclements appear. (3) Unstable pole preset: find the K where the curve encircles -1. '
                        + '(4) Add a delay to K/(s+1) and see the spiral. (5) Compare Z with the green / red closed-loop pole dots.',
                },
            ],
        },
        // ---------------- links ----------------
        {
            type: 'group', label: 'Open in...', children: [
                { type: 'button', label: 'Conformal Maps (this function as w = f(z))', onClick: links.conformal },
                { type: 'button', label: 'Bode, Nyquist & Stability Margins (ct-freq)', onClick: links.ctFreq, visibleIf: tabIs('arg', 'real') },
                { type: 'button', label: 'Time Response & Pole Locations (ct-response)', onClick: links.ctResponse, visibleIf: tabIs('arg', 'real') },
                { type: 'button', label: 'Laplace Transform & the s-Plane (ma-laplace)', onClick: links.maLaplace, visibleIf: tabIs('arg', 'real') },
                { type: 'button', label: 'Vector Calculus: Green & Stokes (ma-vector)', onClick: links.maVector },
            ],
        },
    ];
}

export default {
    id: 'ma-residue',
    title: 'Complex Integration & Residues',
    description: 'Residue theorem with live contour integrals, contour deformation and branch cuts, real integrals, Laurent series, Bromwich inversion and the argument principle / Nyquist criterion.',

    async mount(container, ctx) {
        const store = withDefaults(ctx.settings);
        const get = (k) => store.get(k);
        const set = (k, v) => store.set(k, v);
        const cleanups = [];
        const st = { disposed: false, tabs: null, palKey: '', pal: null, last: 0, lastTab: null };

        const pal = () => {
            const theme = ctx.globalSettings.get('theme', 'dark');
            if (st.palKey !== theme || !st.pal) { st.palKey = theme; st.pal = getPalette(theme); }
            return st.pal;
        };
        const cur = () => (st.tabs ? st.tabs[TABS.some((t) => t.value === get('tab')) ? get('tab') : 'residue'] : null);

        // deep links built from the live state
        const nyqPlant = () => ({ num: get('num'), den: get('den'), K: get('K'), delay: Number(get('delay')) || 0 });
        const links = {
            conformal: () => {
                const t = get('tab');
                if (t === 'arg' && get('nyq') && st.tabs) {
                    const s = st.tabs.arg.getState();
                    go(conformalLink(exprFromItems(s.nz, s.np, Number(get('K')) * s.lead[0] / (s.lead[1] || 1))));
                } else if (t === 'real' && get('rex') === 'bromwich' && st.tabs) {
                    go(conformalLink(null));
                } else go(conformalLink(null));
            },
            ctFreq: () => go(LINKS.ctFreq(nyqPlant())),
            ctResponse: () => go(LINKS.ctResponse(nyqPlant())),
            maLaplace: () => go(LINKS.maLaplace(nyqPlant())),
            maVector: () => go(LINKS.maVector()),
        };
        const actions = {
            residue: new Proxy({}, { get: (_, k) => () => st.tabs && st.tabs.residue.actions[k]() }),
            deform: new Proxy({}, { get: (_, k) => () => st.tabs && st.tabs.deform.actions[k]() }),
            real: new Proxy({}, { get: (_, k) => () => st.tabs && st.tabs.real.actions[k]() }),
            arg: new Proxy({}, { get: (_, k) => () => st.tabs && st.tabs.arg.actions[k]() }),
        };

        const sketch = (p) => {
            const sizeNow = () => {
                const s = ctx.size();
                return { w: Math.max(260, s.width), h: Math.max(260, s.height) };
            };
            const env = { p, get, set };

            const layoutAll = () => {
                if (!st.tabs) return;
                for (const t of Object.values(st.tabs)) t.layout(p.width, p.height);
            };

            p.setup = () => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.createCanvas(w, h);
                p.textFont('sans-serif');
                const residue = createResidueTab(env);
                st.tabs = {
                    residue,
                    deform: createDeformTab(env, { model: residue.model }),
                    real: createRealTab(env),
                    arg: createArgTab(env),
                };
                for (const t of Object.values(st.tabs)) if (t.init) t.init();
                layoutAll();
            };

            // ---------- pointer ----------
            p.mousePressed = (e) => {
                if (st.disposed || !st.tabs || offCanvas(p, e) || !isPrimary(p)) return;
                cur().press(p.mouseX, p.mouseY);
            };
            p.mouseDragged = () => {
                if (st.disposed || !st.tabs) return;
                cur().dragTo(p.mouseX, p.mouseY);
            };
            p.mouseReleased = () => {
                if (st.disposed || !st.tabs) return;
                cur().release();
            };
            p.touchStarted = (e) => {
                if (st.disposed || !st.tabs || offCanvas(p, e)) return true;
                return !cur().press(p.mouseX, p.mouseY);
            };
            p.touchMoved = () => {
                if (st.disposed || !st.tabs) return true;
                return !cur().dragTo(p.mouseX, p.mouseY);
            };
            p.touchEnded = () => {
                if (st.disposed || !st.tabs) return true;
                cur().release();
                return true;
            };
            p.mouseWheel = (e) => {
                if (st.disposed || !st.tabs || offCanvas(p, e)) return true;
                if (!cur().wheel(e, p.mouseX, p.mouseY)) return true;
                if (e && e.preventDefault) e.preventDefault();
                return false;
            };
            p.keyPressed = (e) => {
                if (st.disposed || !st.tabs) return true;
                if (e && (e.ctrlKey || e.metaKey || e.altKey)) return true;
                const k = p.key;
                if (typing(k)) return true;
                return cur().key(k) ? false : true;
            };

            // ---------- resize ----------
            cleanups.push(ctx.onResize(() => {
                if (st.disposed) return;
                const { w, h } = sizeNow();
                p.resizeCanvas(w, h, true);
                layoutAll();
            }));

            // ---------- drawing ----------
            p.draw = () => {
                if (st.disposed || !st.tabs) return;
                const tab = cur();
                if (st.lastTab !== tab) { st.lastTab = tab; tab.layout(p.width, p.height); }
                const dt = Math.min(0.1, (p.deltaTime || 16) / 1000);
                tab.step(dt);
                tab.sync();
                tab.draw(pal());
            };
        };

        const instance = new ctx.p5(sketch, container);
        const toolTabs = ctx.ui.build([{ type: 'tabs', key: 'tab', options: TABS }], store, ctx.toolbar);
        const panel = ctx.ui.build(buildSchema(actions, links), store, ctx.drawer);

        return {
            /** Exposed for inspection (tests, debugging). */
            get tabs() { return st.tabs; },
            unmount() {
                if (st.disposed) return;
                st.disposed = true;
                for (const c of cleanups.splice(0)) {
                    try { c(); } catch { /* ignore */ }
                }
                try { toolTabs.destroy(); } catch { /* ignore */ }
                try { panel.destroy(); } catch { /* ignore */ }
                try { instance.remove(); } catch { /* ignore */ }
            },
        };
    },
};
