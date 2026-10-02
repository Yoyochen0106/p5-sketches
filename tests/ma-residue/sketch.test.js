import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockP5 } from '../mock-p5.js';
import { createStore, createMemoryStorage } from '../../core/settings.js';
import residue from '../../sketches/ma-residue/index.js';
import { RESIDUE_PRESETS } from '../../sketches/ma-residue/model.js';
import { ARG_PRESETS, NYQ_PRESETS } from '../../sketches/ma-residue/arg-tab.js';
import { REAL_EXAMPLES } from '../../lib/residues.js';

function makeCtx(width, height, initial) {
    const P5 = createMockP5({ width, height });
    const settings = createStore({ namespace: 'ma-res-test', storage: createMemoryStorage() });
    for (const [k, v] of Object.entries(initial || {})) settings.set(k, v);
    const globalSettings = createStore({ namespace: 'global-test', storage: createMemoryStorage() });
    return {
        P5, settings,
        ctx: {
            p5: P5, settings, globalSettings,
            ui: { build: () => ({ destroy() {}, refresh() {}, el: null }) },
            drawer: {}, toolbar: {},
            onResize: () => () => {},
            size: () => ({ width, height }),
        },
    };
}

async function mountSketch(initial, w = 1200, h = 640) {
    const { ctx, P5, settings } = makeCtx(w, h, initial);
    const handle = await residue.mount({}, ctx);
    return { p: P5.instances[0], handle, settings };
}

const texts = (p) => p.callsOf('text').map((c) => String(c.args[0]));
const clean = (m, label = '') => assert.equal(m.p.invalidCalls.length, 0, `${label} ${JSON.stringify(m.p.invalidCalls.slice(0, 2))}`);

test('residue tab: every preset renders; numerical integral matches the residue sum', async () => {
    for (const pr of RESIDUE_PRESETS) {
        const m = await mountSketch({ rpreset: pr.id });
        m.p.stepFrames(3);
        clean(m, pr.id);
        const s = m.handle.tabs.residue.getState();
        assert.ok(s.res, pr.id);
        assert.ok(s.res.discrepancy < 1e-6, `${pr.id}: ${s.res.discrepancy}`);
        assert.ok(texts(m.p).some((t) => /discrepancy/.test(t)), 'discrepancy shown');
        assert.ok(m.p.callsOf('image').length >= 1, 'domain colouring image');
        m.handle.unmount();
    }
});

test('dragging the circle radius handle across a pole changes the enclosed set and the integral', async () => {
    const m = await mountSketch({ rpreset: 'two' });
    m.p.stepFrames(2);
    const tab = m.handle.tabs.residue;
    const before = tab.getState().res;
    assert.equal(before.enclosed.length, 2);
    // radius handle: the last 'dot' handle of the circle
    const hs = tab.getState().handles;
    const rh = hs[hs.length - 1];
    const vp = tab.getState().view;
    m.p.pressMouse(vp.toX(rh.x), vp.toY(rh.y));
    m.p.moveMouse(vp.toX(0.2), vp.toY(0.2));
    m.p.releaseMouse();
    m.p.stepFrames(2);
    const after = tab.getState().res;
    assert.equal(after.enclosed.length, 0);
    assert.ok(Math.hypot(after.integral[0], after.integral[1]) < 1e-8);
    assert.ok(after.discrepancy < 1e-6);
    clean(m);
    m.handle.unmount();
});

test('selecting a pole and changing its order via the settings keeps the discrepancy tiny', async () => {
    const m = await mountSketch({ rpreset: 'double' });
    m.p.stepFrames(2);
    m.settings.set('expk', 1.5);
    m.p.stepFrames(2);
    m.settings.set('ckind', 'poly');
    m.p.stepFrames(2);
    const s = m.handle.tabs.residue.getState();
    assert.ok(s.res.discrepancy < 1e-6, String(s.res.discrepancy));
    assert.equal(s.contour.kind, 'poly');
    clean(m);
    m.handle.unmount();
});

test('free loop: drawing a loop on the background records it', async () => {
    const m = await mountSketch({ rpreset: 'eight' });
    m.p.stepFrames(2);
    const tab = m.handle.tabs.residue;
    assert.equal(tab.getState().contour.kind, 'poly');
    const vp = tab.getState().view;
    m.p.pressMouse(vp.toX(-3), vp.toY(-2.5));
    for (let i = 1; i <= 24; i++) m.p.moveMouse(vp.toX(-3 + 0.2 * i), vp.toY(-2.5 + 0.3 * Math.sin(i / 3)));
    m.p.releaseMouse();
    m.p.stepFrames(2);
    assert.ok(tab.getState().contour.pts.length > 10);
    assert.ok(tab.getState().res.discrepancy < 1e-6);
    clean(m);
    m.handle.unmount();
});

test("Cauchy mode: recovers g(a), derivatives, and zero for an analytic region", async () => {
    const m = await mountSketch({ rmode: 'cauchy', cg: 'exp', cn: 0 });
    m.p.stepFrames(3);
    let s = m.handle.tabs.residue.getState().cauchy;
    assert.ok(s.discrepancy < 1e-7, String(s.discrepancy));
    for (const n of [1, 2, 3]) {
        m.settings.set('cn', n);
        m.p.stepFrames(2);
        s = m.handle.tabs.residue.getState().cauchy;
        assert.ok(s.discrepancy < 1e-6, `n=${n}: ${s.discrepancy}`);
    }
    m.settings.set('cn', -1);
    m.p.stepFrames(2);
    s = m.handle.tabs.residue.getState().cauchy;
    assert.ok(Math.hypot(s.value[0], s.value[1]) < 1e-8);
    // 1/(z-q) with q inside: theorem fails, expected = 2 pi i
    m.settings.set('cg', 'recip');
    m.settings.set('cqx', 0.3);
    m.settings.set('cqy', 0.1);
    m.p.stepFrames(2);
    s = m.handle.tabs.residue.getState().cauchy;
    assert.ok(s.insideQ);
    assert.ok(s.discrepancy < 1e-6);
    assert.ok(Math.abs(s.value[1] - 2 * Math.PI) < 1e-6);
    clean(m);
    m.handle.unmount();
});

test('deformation: staircase jumps at pole crossings; numeric samples agree; branch demo runs', async () => {
    const m = await mountSketch({ tab: 'deform', rpreset: 'two' });
    m.p.stepFrames(20);
    const d = m.handle.tabs.deform.getState();
    assert.ok(d.pred.length > 100);
    assert.ok(d.events.length >= 1, 'at least one pole is crossed');
    const done = d.num.filter((q) => q && q.v);
    assert.ok(done.length > 20);
    clean(m);
    // animate
    m.settings.set('dplay', true);
    m.p.stepFrames(10);
    assert.ok(Number(m.settings.get('ds')) > 0);
    // branch cut toy
    for (const fn of ['sqrt', 'log']) {
        m.settings.set('dmode', 'branch');
        m.settings.set('dfun', fn);
        m.p.stepFrames(3);
        const b = m.handle.tabs.deform.getState().branch;
        assert.ok(b && b.out.crossings >= 1, fn);
        clean(m, fn);
    }
    m.settings.set('dcx', -1.6);
    m.settings.set('dcr', 0.9);
    m.p.stepFrames(3);
    const b = m.handle.tabs.deform.getState().branch;
    assert.equal(b.out.crossings, 2);
    assert.ok(texts(m.p).some((t) => /cut/.test(t)));
    m.handle.unmount();
});

test('real integrals: every example renders; arc shrinks with R; Laurent and Bromwich work', async () => {
    for (const ex of REAL_EXAMPLES) {
        const m = await mountSketch({ tab: 'real', rex: ex.id, R: 4 });
        m.p.stepFrames(3);
        clean(m, ex.id);
        const s = m.handle.tabs.real.getState();
        assert.ok(s.ev, ex.id);
        assert.ok(s.sweep.length > 10);
        m.handle.unmount();
    }
    const m = await mountSketch({ tab: 'real', rex: 'inv1', R: 2 });
    m.p.stepFrames(2);
    const a2 = Math.hypot(...m.handle.tabs.real.getState().ev.arc);
    m.settings.set('R', 10);
    m.p.stepFrames(2);
    const a10 = Math.hypot(...m.handle.tabs.real.getState().ev.arc);
    assert.ok(a10 < a2 / 3, `${a10} vs ${a2}`);
    m.settings.set('rplay', true);
    m.p.stepFrames(5);
    clean(m);
    // Laurent
    for (const lfun of ['zz1', 'exp1z', 'sinz', 'twopole', 'cot', 'zexp']) {
        m.settings.set('rex', 'laurent');
        m.settings.set('lfun', lfun);
        m.p.stepFrames(2);
        const l = m.handle.tabs.real.getState().lau;
        assert.ok(l && !l.bad, lfun);
        clean(m, lfun);
    }
    m.settings.set('lfun', 'zz1');
    m.settings.set('lr', 0.5);
    m.p.stepFrames(2);
    const lau = m.handle.tabs.real.getState().lau;
    assert.ok(Math.abs(lau.coefs[39][0] + 1) < 1e-9, 'a_-1 = -1 in the inner annulus');
    assert.ok(lau.err < 1e-6);
    m.settings.set('lr', 1);
    m.p.stepFrames(2);
    assert.ok(m.handle.tabs.real.getState().lau.bad, 'circle through a singularity flagged');
    clean(m);
    // Bromwich
    m.settings.set('rex', 'bromwich');
    m.settings.set('num', '1');
    m.settings.set('den', '1,3,2');
    m.settings.set('bt', 1.3);
    m.settings.set('lr', 0.5);
    m.p.stepFrames(3);
    const br = m.handle.tabs.real.getState().brom;
    assert.ok(Math.abs(br.exact - (Math.exp(-1.3) - Math.exp(-2.6))) < 1e-9);
    assert.ok(Math.abs(br.b.total[0] - br.exact) < 1e-6);
    clean(m);
    m.handle.unmount();
});

test('argument principle: winding equals zeros minus poles for presets; dragging a zero changes it', async () => {
    for (const pr of ARG_PRESETS) {
        const m = await mountSketch({ tab: 'arg', apreset: pr.id });
        m.p.stepFrames(3);
        clean(m, pr.id);
        const s = m.handle.tabs.arg.getState().res;
        assert.ok(!s.nyq);
        assert.equal(s.tr.winding, s.counts.diff, pr.id);
        m.handle.unmount();
    }
    const m = await mountSketch({ tab: 'arg', apreset: 'cubic' });
    m.p.stepFrames(3);
    const tab = m.handle.tabs.arg;
    const w0 = tab.getState().res.tr.winding;
    // push zero 1 far outside by changing the setting text
    m.settings.set('azeros', '5,5;-1,0.8;0.2,-1.2');
    m.p.stepFrames(3);
    const w1 = tab.getState().res.tr.winding;
    assert.equal(w1, w0 - 1);
    assert.equal(tab.getState().res.counts.diff, w1);
    clean(m);
    m.handle.unmount();
});

test('Nyquist mode: presets agree with the closed-loop pole count; gain and delay change the verdict', async () => {
    for (const pr of NYQ_PRESETS) {
        const m = await mountSketch({ tab: 'arg', nyq: true, npreset: pr.id });
        m.p.stepFrames(3);
        clean(m, pr.id);
        const s = m.handle.tabs.arg.getState().res;
        assert.ok(s.nyq, pr.id);
        if (s.closedLoopRoots && !s.marginal) assert.equal(s.Z, s.closedLoopRoots.filter((q) => q[0] > 1e-9).length, pr.id);
        m.handle.unmount();
    }
    const m = await mountSketch({ tab: 'arg', nyq: true, num: '1', den: '1,6,11,6', K: 20, delay: 0, npreset: 'type0' });
    m.p.stepFrames(3);
    const tab = m.handle.tabs.arg;
    assert.equal(tab.getState().res.Z, 0);
    m.settings.set('K', 80);
    m.p.stepFrames(3);
    assert.equal(tab.getState().res.Z, 2);
    assert.equal(tab.getState().res.W, -2);
    assert.ok(texts(m.p).some((t) => /UNSTABLE/.test(t)));
    m.settings.set('K', 20);
    m.settings.set('delay', 1.5);
    m.p.stepFrames(3);
    assert.ok(tab.getState().res.Z >= 0);
    // dragging a pole updates num / den
    m.settings.set('delay', 0);
    m.p.stepFrames(3);
    const hs = tab.getState().handles;
    assert.ok(hs.length >= 3);
    clean(m);
    m.handle.unmount();
});

test('Nyquist: dragging a pole handle rewrites num / den', async () => {
    const m = await mountSketch({ tab: 'arg', nyq: true, num: '1', den: '1,3,2', K: 2, npreset: 'type0' });
    m.p.stepFrames(3);
    const tab = m.handle.tabs.arg;
    // the initial preset (type0) is only applied when num/den are still defaults, otherwise the given plant is used
    const before = m.settings.get('den');
    const h = tab.getState().handles.find((q) => q.label === 'p1');
    assert.ok(h);
    const vp = tab.scene.panels.z;
    m.p.pressMouse(vp.toX(h.x), vp.toY(h.y));
    m.p.moveMouse(vp.toX(h.x - 1), vp.toY(h.y));
    m.p.releaseMouse();
    m.p.stepFrames(3);
    assert.notEqual(m.settings.get('den'), before);
    clean(m);
    m.handle.unmount();
});

test('deep links: open-in buttons build hashes; unmount twice; narrow layout; wheel and keys', async () => {
    globalThis.location = { hash: '' };
    try {
        const { ctx, P5, settings } = makeCtx(420, 800, { tab: 'real', rex: 'bromwich' });
        let schema = null;
        ctx.ui = { build: (s) => { if (s.length > 1 || s[0].type !== 'tabs') schema = s; return { destroy() {} }; } };
        const handle = await residue.mount({}, ctx);
        const p = P5.instances[0];
        p.stepFrames(3);
        assert.equal(p.invalidCalls.length, 0);
        const group = schema.find((n) => n.label === 'Open in...');
        const btn = group.children.find((n) => /ct-freq/.test(n.label));
        btn.onClick();
        assert.match(globalThis.location.hash, /^#\/ct-freq\?num=1&den=1%2C3%2C2/);
        group.children.find((n) => /ct-response/.test(n.label)).onClick();
        assert.match(globalThis.location.hash, /^#\/ct-response\?/);
        group.children.find((n) => /Conformal/.test(n.label)).onClick();
        assert.match(globalThis.location.hash, /^#\/conformal/);
        p.moveMouse(100, 150);
        p.fire('mouseWheel', { delta: -120, deltaMode: 0 });
        p.fire('mousePressed', { target: {} });
        p.pressKey('f', 70);
        p.pressKey(' ', 32);
        p.stepFrames(2);
        assert.equal(p.invalidCalls.length, 0);
        settings.set('tab', 'deform');
        p.stepFrames(3);
        settings.set('tab', 'arg');
        p.stepFrames(3);
        assert.equal(p.invalidCalls.length, 0);
        handle.unmount();
        handle.unmount();
        assert.doesNotThrow(() => p.stepFrames(1));
    } finally {
        delete globalThis.location;
    }
});

test('deep link into the Nyquist tab with a plant from another unit', async () => {
    const m = await mountSketch({ tab: 'arg', nyq: true, num: '2,1', den: '1,2,5,0', K: 3, delay: 0.3 });
    m.p.stepFrames(3);
    const s = m.handle.tabs.arg.getState();
    assert.equal(s.res.nyq, true);
    assert.ok(Math.abs(s.res.K - 3 * 2 / 1) < 1e-9, 'K_eff = K * lead(num) / lead(den)');
    assert.equal(s.res.delay, 0.3);
    assert.equal(s.res.poles.length, 3);
    clean(m);
    m.handle.unmount();
});
