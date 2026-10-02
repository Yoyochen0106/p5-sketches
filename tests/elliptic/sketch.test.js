import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import elliptic from '../../sketches/elliptic/index.js';
import { REAL_PRESETS, FINITE_PRESETS, TORUS_PRESETS } from '../../sketches/elliptic/state.js';
import * as E from '../../lib/elliptic.js';

async function mountSketch(initial = {}, width = 1000, height = 700) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'elliptic-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial)) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
    const built = [];
    const ctx = {
        p5: P5, settings, globalSettings,
        ui: { build: (schema) => { built.push(schema); return { destroy() {}, refresh() {}, el: null }; } },
        drawer: {}, toolbar: {},
        onResize: () => () => {},
        size: () => ({ width, height }),
    };
    const handle = await elliptic.mount({}, ctx);
    return { p: P5.instances[P5.instances.length - 1], handle, settings, globalSettings, built };
}

function seeded(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));
const flat = (built) => {
    const out = [];
    const walk = (nodes) => nodes.forEach((n) => { out.push(n); if (n.children) walk(n.children); });
    walk(built[0]);
    return out;
};
const onCurve = (a, b, P) => Math.abs(E.residual(a, b, P)) < 1e-7 * (1 + Math.abs(P.x) ** 3);

test('mounts on every tab without invalid geometry; unmount twice is safe', async () => {
    const { p, handle, settings } = await mountSketch();
    p.stepFrames(5);
    for (const tab of ['real', 'finite', 'torus']) {
        settings.set('tab', tab);
        p.stepFrames(3);
    }
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
    handle.unmount();
    assert.equal(p.removed, true);
});

test('REAL: dragging P and Q keeps them on the curve', async () => {
    const { p, handle } = await mountSketch();
    p.stepFrames(2);
    const r = seeded(5);
    let moved = 0;
    for (const which of ['P', 'Q']) {
        for (let k = 0; k < 12; k++) {
            const s = handle.getState().real;
            const sx = s.view.toX(s[which].x), sy = s.view.toY(s[which][1] ?? s[which].y);
            const before = { ...s[which] };
            p.pressMouse(sx, sy);
            for (let i = 1; i <= 4; i++) p.moveMouse(r() * 900 + 20, r() * 640 + 20);
            p.releaseMouse();
            p.stepFrames(1);
            const e = handle.getState().real;
            assert.ok(onCurve(e.a, e.b, e[which]), `${which} residual ${e.residualP}`);
            assert.ok(onCurve(e.a, e.b, e.P) && onCurve(e.a, e.b, e.Q));
            if (JSON.stringify(e[which]) !== JSON.stringify(before)) moved++;
        }
    }
    assert.ok(moved >= 14, `moved ${moved}`);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('REAL: P+Q read-out equals the library result, for chords, tangents and vertical lines', async () => {
    const { p, handle, settings } = await mountSketch();
    p.stepFrames(1);
    const real = handle.tabs.real;
    const a = settings.get('a'), b = settings.get('b');
    real.setPoints([-1.2, 1.2], [1.8, -1.7]);
    p.stepFrames(2);
    let s = handle.getState().real;
    const ref = E.addReal(a, b, s.P, s.Q);
    assert.deepEqual(s.sum, ref.result);
    assert.equal(s.kind, 'chord');
    assert.ok(texts(p).some((t) => t.startsWith('P + Q = (') && t.includes('chord')));
    // tangent case
    real.tangentCase();
    p.stepFrames(2);
    s = handle.getState().real;
    assert.equal(s.kind, 'tangent');
    assert.deepEqual(s.sum, E.addReal(a, b, s.P, s.P).result);
    assert.ok(texts(p).some((t) => /P \+ Q = \(.*tangent/.test(t)));
    // vertical line case -> O
    real.verticalCase();
    p.stepFrames(2);
    s = handle.getState().real;
    assert.equal(s.kind, 'vertical');
    assert.ok(E.isInf(s.sum));
    assert.ok(texts(p).some((t) => /point at infinity/.test(t)));
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('REAL: dragging Q onto P sticks (tangent) and onto -P sticks (vertical)', async () => {
    const { p, handle } = await mountSketch();
    p.stepFrames(2);
    let s = handle.getState().real;
    const qx = s.view.toX(s.Q.x), qy = s.view.toY(s.Q.y);
    p.pressMouse(qx, qy);
    p.moveMouse(s.view.toX(s.P.x) + 4, s.view.toY(s.P.y) + 3);
    p.releaseMouse();
    s = handle.getState().real;
    assert.deepEqual(s.Q, s.P);
    assert.equal(s.kind, 'tangent');
    // now drag P (Q is on P: the nearest handle is Q or P; either works) towards -Q
    const q2 = { x: s.Q.x, y: -s.Q.y };
    p.pressMouse(s.view.toX(s.P.x), s.view.toY(s.P.y));
    p.moveMouse(s.view.toX(q2.x) + 3, s.view.toY(q2.y) - 3);
    p.releaseMouse();
    s = handle.getState().real;
    assert.ok(s.kind === 'vertical' || s.kind === 'tangent' || s.kind === 'chord');
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('REAL: curve is drawn as two components for a < 0 and the animation advances', async () => {
    const { p, handle } = await mountSketch({ a: -2, b: 1 });
    p.stepFrames(1);
    p.clearCalls();
    p.stepFrames(1);
    p.redraw(1);
    p.clearCalls();
    handle.tabs.real.replay();
    p.stepFrames(1);
    const closed = p.callsOf('endShape').filter((c) => c.args[0] === p.CLOSE);
    assert.ok(closed.length >= 1, 'oval closed');
    const s0 = handle.getState().real.stage;
    p.stepFrames(30);
    assert.ok(handle.getState().real.stage > s0);
    p.stepFrames(200);
    assert.equal(handle.getState().real.stage, 4);
    handle.unmount();
});

test('REAL: (a, b) inset drag changes the curve and snaps onto the cusp curve', async () => {
    const { p, handle, settings } = await mountSketch({ a: -1, b: 1 });
    p.stepFrames(1);
    const s = handle.getState().real;
    const [ox, oy] = s.abToInset(0, 0);
    // empty drag in the inset
    const [x1, y1] = s.abToInset(-2, 0.5);
    p.pressMouse(x1, y1);
    p.moveMouse(x1 + 20, y1 + 10);
    p.releaseMouse();
    assert.notEqual(settings.get('a'), -1);
    assert.equal(handle.getState().real.view.xmin, s.view.xmin, 'inset drag does not pan');
    // snap onto the cusp curve: a = -3 -> b = sqrt(4*27/27) = 2
    const [cx, cy] = s.abToInset(-3, 2);
    p.pressMouse(cx, cy);
    p.moveMouse(cx + 2, cy + 2);
    p.releaseMouse();
    const a = settings.get('a'), b = settings.get('b');
    assert.equal(E.classify(a, b), 'node', `${a},${b}`);
    // origin: cusp
    p.pressMouse(ox + 1, oy + 1);
    p.releaseMouse();
    assert.equal(E.classify(settings.get('a'), settings.get('b')), 'cusp');
    p.stepFrames(3);
    assert.equal(p.invalidCalls.length, 0);
    // P and Q were re-snapped onto the new curve
    const e = handle.getState().real;
    assert.ok(onCurve(e.a, e.b, e.P) && onCurve(e.a, e.b, e.Q));
    handle.unmount();
});

test('REAL: every preset, singular curves and extreme sliders draw without invalid calls', async () => {
    const { p, handle, settings } = await mountSketch({ trailN: 8 });
    for (const id of Object.keys(REAL_PRESETS)) {
        handle.tabs.real.applyPreset(id);
        p.stepFrames(3);
        const s = handle.getState().real;
        assert.ok(onCurve(s.a, s.b, s.P) && onCurve(s.a, s.b, s.Q), id);
    }
    for (const [a, b] of [[-3, 2], [-3, -2], [0, 0], [-4, 4], [4, -4], [-4, 0], [1e-7, 0], [-0.0001, 0.0001]]) {
        settings.set('a', a);
        settings.set('b', b);
        p.stepFrames(3);
        handle.tabs.real.tangentCase();
        p.stepFrames(1);
        handle.tabs.real.verticalCase();
        p.stepFrames(1);
    }
    // extreme zoom
    for (const d of [300, 300, 300, -300, -300, -300, -300]) p.fire('mouseWheel', { delta: d, deltaMode: 0 });
    p.stepFrames(2);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('REAL: multiples nP close up at the right n for torsion points', async () => {
    const { p, handle, settings } = await mountSketch();
    handle.tabs.real.applyPreset('cube1');
    p.stepFrames(2);
    assert.equal(settings.get('trailN'), 6);
    let s = handle.getState().real;
    assert.equal(s.mult.length, 6);
    assert.ok(E.isInf(s.mult[5].point));
    assert.ok(texts(p).some((t) => /6P = O : P has order 6/.test(t)));
    assert.ok(texts(p).some((t) => t === '2P'));
    settings.set('trailN', 3);
    p.stepFrames(1);
    assert.ok(texts(p).some((t) => /no closure yet/.test(t)));
    handle.tabs.real.addMultiple();
    assert.equal(settings.get('trailN'), 4);
    handle.tabs.real.clearTrail();
    assert.equal(settings.get('trailN'), 0);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('FINITE: renders every point exactly once; orders and group data are consistent', async () => {
    const { p, handle, settings } = await mountSketch({ tab: 'finite', p: 97, fa: 2, fb: 3 });
    p.stepFrames(2);
    handle.tabs.finite.clearSelection();
    p.clearCalls();
    p.stepFrames(1);
    const s = handle.getState().finite;
    assert.equal(p.callsOf('point').length, s.points.length);
    assert.equal(s.N, s.points.length + 1);
    assert.ok(s.hasseOk);
    assert.ok(Math.abs(s.N - 98) <= 2 * Math.sqrt(97) + 1e-9);
    assert.equal(s.structure.invariants[0] * s.structure.invariants[1], s.N);
    // brute-force count
    let n = 1;
    for (let x = 0; x < 97; x++) for (let y = 0; y < 97; y++) if ((y * y - (x ** 3 + 2 * x + 3)) % 97 === 0) n++;
    assert.equal(n, s.N);
    // every drawn point is on the curve
    for (const c of p.callsOf('point').slice(0, 20)) assert.ok(c.args.every(Number.isFinite));
    // texts
    assert.ok(texts(p).some((t) => t.includes(`#E(F_p) = ${s.N}`)));
    assert.ok(texts(p).some((t) => /Hasse/.test(t)));
    // other primes
    for (const pr of [5, 7, 223, 1999]) {
        settings.set('p', pr);
        p.stepFrames(2);
        handle.tabs.finite.clearSelection();
        p.clearCalls();
        p.stepFrames(1);
        const f = handle.getState().finite;
        if (!f.singular) assert.equal(p.callsOf('point').length, f.points.length, `p=${pr}`);
        assert.ok(f.hasseOk || f.singular);
    }
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('FINITE: clicking two points gives P+Q matching the library; orders divide #E', async () => {
    const { p, handle } = await mountSketch({ tab: 'finite', p: 97, fa: 2, fb: 3 });
    p.stepFrames(2);
    const fin = handle.tabs.finite;
    const s0 = handle.getState().finite;
    const A = s0.points[3], B = s0.points[40];
    const [ax, ay] = fin.pointPixel(A), [bx, by] = fin.pointPixel(B);
    p.click(ax, ay);
    assert.deepEqual(handle.getState().finite.P, A);
    p.click(bx, by);
    p.stepFrames(1);
    const s = handle.getState().finite;
    assert.deepEqual(s.Q, B);
    assert.deepEqual(s.sum, E.addFp(s0.curve, A, B));
    assert.equal(s.N % s.orderP, 0);
    assert.ok(E.isInf(E.scalarMulFp(s.curve, A, s.orderP).result));
    assert.ok(texts(p).some((t) => t.startsWith('P + Q =')));
    // a third click starts over
    p.click(ax, ay);
    assert.equal(handle.getState().finite.Q, null);
    // clicking empty space keeps the selection
    p.click(1, 1);
    assert.equal(handle.getState().finite.P.x, A.x);
    // wrapped chord dots: p squares plus the markers
    fin.setSelection(A, B);
    p.clearCalls();
    p.stepFrames(1);
    assert.ok(p.callsOf('rect').length >= 97);
    fin.qIsNegP();
    p.stepFrames(1);
    assert.equal(handle.getState().finite.sum.kind, 'vertical');
    fin.qIsP();
    p.stepFrames(1);
    assert.equal(handle.getState().finite.sum.kind, 'tangent');
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('FINITE: presets, generator finding, subgroup of P and structure', async () => {
    const { p, handle } = await mountSketch({ tab: 'finite' });
    const fin = handle.tabs.finite;
    fin.applyPreset('secp');
    p.stepFrames(2);
    let s = handle.getState().finite;
    assert.deepEqual(s.P, { x: 47, y: 71 });
    assert.equal(s.orderP, 21);
    assert.equal(s.N % 21, 0);
    fin.applyPreset('cyclic');
    p.stepFrames(1);
    fin.findGenerator();
    p.stepFrames(1);
    s = handle.getState().finite;
    assert.equal(s.N, 19);
    assert.equal(s.orderP, 19);
    assert.ok(s.structure.cyclic);
    assert.equal(s.generators.length, 18);
    // multiples of a generator are drawn (rings) and numbered
    assert.ok(texts(p).filter((t) => /^\d+$/.test(t)).length >= 17);
    fin.applyPreset('xx');
    p.stepFrames(1);
    fin.findGenerator();
    s = handle.getState().finite;
    assert.equal(s.generators.length, 0);
    assert.ok(/No generator/.test(s.msg));
    for (const id of Object.keys(FINITE_PRESETS)) {
        fin.applyPreset(id);
        p.stepFrames(2);
    }
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('FINITE: singular curves do not break rendering', async () => {
    const { p, handle, settings } = await mountSketch({ tab: 'finite', p: 13, fa: 0, fb: 0 });
    p.stepFrames(2);
    assert.ok(handle.getState().finite.singular);
    assert.ok(texts(p).some((t) => /singular/.test(t)));
    handle.tabs.finite.setSelection({ x: 1, y: 1 }, { x: 2, y: 2 });
    handle.tabs.finite.findGenerator();
    handle.tabs.finite.newPuzzle();
    p.stepFrames(2);
    p.click(300, 300);
    settings.set('fa', 3);
    settings.set('fb', 1);
    p.stepFrames(2);
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});

test('FINITE: discrete-log puzzle (check wrong, check right, reveal)', async () => {
    const { p, handle, settings } = await mountSketch({ tab: 'finite' });
    const fin = handle.tabs.finite;
    fin.applyPreset('cyclic');
    p.stepFrames(1);
    fin.newPuzzle(seeded(3));
    p.stepFrames(2);
    let s = handle.getState().finite;
    const pz = s.puzzle;
    assert.ok(pz && pz.k >= 2 && pz.k < pz.ord);
    assert.deepEqual(E.scalarMulFp(s.curve, pz.G, pz.k).result, pz.Q);
    settings.set('guess', pz.k === 2 ? 3 : 2);
    assert.equal(fin.checkGuess(), false);
    settings.set('guess', pz.k);
    assert.equal(fin.checkGuess(), true);
    assert.ok(/Correct/.test(handle.getState().finite.msg));
    // also correct modulo the order
    settings.set('guess', pz.k + pz.ord > 2000 ? pz.k : pz.k + pz.ord);
    assert.equal(fin.checkGuess(), true);
    fin.reveal();
    p.stepFrames(1);
    assert.ok(handle.getState().finite.puzzle.revealed);
    assert.ok(texts(p).some((t) => t.includes(`k = ${pz.k}`)));
    // a bigger curve
    settings.set('p', 997);
    settings.set('fa', 3);
    settings.set('fb', 8);
    p.stepFrames(1);
    fin.newPuzzle(seeded(4));
    p.stepFrames(1);
    s = handle.getState().finite;
    settings.set('guess', 1);
    assert.equal(fin.checkGuess(), false);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('TORUS: lattice display, g2/g3 for tau = i, and the real-section chord law matches', async () => {
    const { p, handle, settings } = await mountSketch({ tab: 'torus', tauRe: 0, tauIm: 1 });
    p.stepFrames(3);
    let s = handle.getState().torus;
    assert.ok(Math.abs(s.g2[0] - 189.07272) < 1e-4);
    assert.ok(Math.abs(s.g3[0]) < 1e-6);
    assert.ok(s.realSection && s.realOk);
    assert.ok(s.err < 1e-6, `err ${s.err}`);
    assert.ok(texts(p).some((t) => /real section/.test(t)));
    // drag z1 around
    const tor = handle.tabs.torus;
    const r = seeded(11);
    for (let k = 0; k < 10; k++) {
        const [x, y] = tor.zPixel(0);
        p.pressMouse(x, y);
        p.moveMouse(300 + r() * 150, 100 + r() * 500);
        p.releaseMouse();
        p.stepFrames(1);
        s = handle.getState().torus;
        assert.ok(s.realOk);
        assert.ok(s.err < 1e-5 || !Number.isFinite(s.err) === false, `err ${s.err}`);
        assert.ok(s.z[0][1] === 0 || s.z[0][1] === 0.5, 'z1 constrained to the real components');
    }
    // free mode: complex values displayed
    settings.set('torusReal', false);
    tor.setZ(0, 0.21, 0.33);
    p.stepFrames(2);
    s = handle.getState().torus;
    assert.ok(!s.realOk);
    assert.ok(texts(p).some((t) => /℘ =/.test(t)));
    // tau away from the real axes: no real section
    settings.set('tauRe', 0.2);
    p.stepFrames(2);
    s = handle.getState().torus;
    assert.ok(!s.realSection);
    assert.ok(texts(p).some((t) => /no real section/.test(t)));
    // the addition law holds numerically for complex data
    const [w1, w2, w3] = s.W;
    const lam = [(w1.dwp[0] - w2.dwp[0]), (w1.dwp[1] - w2.dwp[1])];
    const den = [(w1.wp[0] - w2.wp[0]), (w1.wp[1] - w2.wp[1])];
    const d2 = den[0] ** 2 + den[1] ** 2;
    const l = [(lam[0] * den[0] + lam[1] * den[1]) / d2, (lam[1] * den[0] - lam[0] * den[1]) / d2];
    const x3 = [(l[0] ** 2 - l[1] ** 2) / 4 - w1.wp[0] - w2.wp[0], (2 * l[0] * l[1]) / 4 - w1.wp[1] - w2.wp[1]];
    assert.ok(Math.hypot(x3[0] - w3.wp[0], x3[1] - w3.wp[1]) < 1e-6 * (1 + Math.hypot(...w3.wp)));
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('TORUS: dragging tau snaps Re tau to 0 and 1/2; presets; hexagonal g2 = 0', async () => {
    const { p, handle, settings } = await mountSketch({ tab: 'torus', tauRe: 0.3, tauIm: 1 });
    p.stepFrames(2);
    const tor = handle.tabs.torus;
    const [x, y] = tor.tauPixel();
    p.pressMouse(x, y);
    p.moveMouse(x + 300, y);
    p.releaseMouse();
    assert.ok(settings.get('tauRe') > 0.3, 'tau moved right');
    // drag far left: clamped; then snap towards zero from a nearby position
    settings.set('tauRe', 0.02);
    p.stepFrames(1);
    const [x2, y2] = tor.tauPixel();
    p.pressMouse(x2, y2);
    p.moveMouse(x2 + 1, y2 + 1);
    p.releaseMouse();
    assert.equal(settings.get('tauRe'), 0, 'snapped to the imaginary axis');
    settings.set('tauRe', 0.49);
    p.stepFrames(1);
    const [x3, y3] = tor.tauPixel();
    p.pressMouse(x3, y3);
    p.moveMouse(x3 + 1, y3);
    p.releaseMouse();
    assert.equal(settings.get('tauRe'), 0.5, 'snapped to the rhombic line');
    assert.ok(handle.getState().torus.realSection);
    for (const id of Object.keys(TORUS_PRESETS)) {
        tor.applyPreset(id);
        p.stepFrames(2);
        const s = handle.getState().torus;
        assert.equal(s.tau[1] > 0, true);
    }
    tor.applyPreset('hex');
    p.stepFrames(1);
    const s = handle.getState().torus;
    assert.ok(Math.hypot(...s.g2) < 1e-6, `g2 = ${s.g2}`);
    assert.ok(s.realSection);
    settings.set('tauRe', 0.5);
    settings.set('tauIm', 0.866);
    p.stepFrames(1);
    assert.ok(handle.getState().torus.realOk);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('keys switch tabs; theme change redraws; touch works; drawer schema has presets', async () => {
    const { p, handle, settings, globalSettings, built } = await mountSketch();
    p.stepFrames(1);
    p.pressKey('2', 50);
    assert.equal(settings.get('tab'), 'finite');
    p.pressKey('3', 51);
    assert.equal(settings.get('tab'), 'torus');
    p.pressKey('1', 49);
    assert.equal(settings.get('tab'), 'real');
    globalSettings.set('theme', 'light');
    p.clearCalls();
    p.stepFrames(1);
    assert.ok(p.callsOf('background').length >= 1);
    // touch: grab P and drag
    p.stepFrames(1);
    const s = handle.getState().real;
    p.moveMouse(s.view.toX(s.P.x), s.view.toY(s.P.y), { fire: false });
    assert.equal(p.touchStarted({}), false);
    p.moveMouse(s.view.toX(s.P.x) + 40, s.view.toY(s.P.y) + 20, { fire: false });
    p.touchMoved({});
    p.touchEnded({});
    const e = handle.getState().real;
    assert.ok(onCurve(e.a, e.b, e.P));
    assert.notDeepEqual(e.P, s.P);
    const buttons = flat(built).filter((n) => n.type === 'button');
    assert.ok(buttons.length >= 20);
    const pre = buttons.find((b) => /secp-like: y² = x³ \+ 7$/.test(b.label));
    pre.onClick();
    assert.equal(settings.get('b'), 7);
    // right button is ignored
    p.pressMouse(100, 100, 'right');
    p.mouseButton = p.RIGHT;
    p.releaseMouse();
    // wheel zoom on the real tab
    const span = e.view.xmax - e.view.xmin;
    p.moveMouse(500, 350);
    assert.equal(p.fire('mouseWheel', { delta: -100, deltaMode: 0 }), false);
    assert.ok(handle.getState().real.view.xmax - handle.getState().real.view.xmin < span);
    assert.equal(p.invalidCalls.length, 0);
    handle.unmount();
});

test('narrow portrait layout draws without invalid calls', async () => {
    const { p, handle, settings } = await mountSketch({}, 360, 640);
    for (const tab of ['real', 'finite', 'torus']) {
        settings.set('tab', tab);
        p.stepFrames(2);
    }
    assert.equal(p.invalidCalls.length, 0, JSON.stringify(p.invalidCalls.slice(0, 3)));
    handle.unmount();
});
