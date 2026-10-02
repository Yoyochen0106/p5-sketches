import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resampleClosedPath, smoothClosed, dftPath, sortCoefs, evaluate, epicycleChain, rmsError,
} from '../../lib/epicycles.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

const circle = (N, R = 1, cx = 0, cy = 0) => Array.from({ length: N }, (_, i) => ({
    x: cx + R * Math.cos((2 * Math.PI * i) / N), y: cy + R * Math.sin((2 * Math.PI * i) / N),
}));

function blob(N) {
    return Array.from({ length: N }, (_, i) => {
        const a = (2 * Math.PI * i) / N;
        const r = 1 + 0.3 * Math.cos(3 * a) + 0.1 * Math.sin(5 * a);
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
}

test('resample: unit square perimeter gives equal spacing and N points', () => {
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const r = resampleClosedPath(sq, 16);
    assert.equal(r.length, 16);
    assert.deepEqual(r[0], { x: 0, y: 0 });
    close(r[4].x, 1); close(r[4].y, 0);
    close(r[2].x, 0.5); close(r[2].y, 0);
    close(r[6].x, 1); close(r[6].y, 0.5);
    // consecutive chord lengths are all 0.25 (no corner is cut with 16 points on a square)
    for (let i = 0; i < 16; i++) {
        const a = r[i], b = r[(i + 1) % 16];
        close(Math.hypot(b.x - a.x, b.y - a.y), 0.25, 1e-9, `chord ${i}`);
    }
});

test('resample: closes the loop (last -> first) and ignores point density', () => {
    const dense = [];
    for (let i = 0; i <= 100; i++) dense.push({ x: i / 100, y: 0 }); // 0..1 then back to start
    const r = resampleClosedPath(dense, 8);
    // total length = 2 (there and back); sample 4 is the far end
    close(r[4].x, 1, 1e-9); close(r[2].x, 0.5, 1e-9); close(r[6].x, 0.5, 1e-9);
});

test('resample: degenerate inputs', () => {
    assert.deepEqual(resampleClosedPath([], 8), []);
    const one = resampleClosedPath([{ x: 2, y: 3 }], 4);
    assert.equal(one.length, 4);
    assert.ok(one.every((p) => p.x === 2 && p.y === 3));
    const dup = resampleClosedPath([{ x: 1, y: 1 }, { x: 1, y: 1 }], 4);
    assert.ok(dup.every((p) => p.x === 1 && p.y === 1));
    const bad = resampleClosedPath([{ x: NaN, y: 0 }, { x: 1, y: 1 }], 4);
    assert.ok(bad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('smoothClosed keeps the centroid and shrinks the roughness', () => {
    const pts = circle(64).map((p, i) => ({ x: p.x + (i % 2 ? 0.05 : -0.05), y: p.y }));
    const sm = smoothClosed(pts, 3);
    const cx = (a) => a.reduce((s, p) => s + p.x, 0) / a.length;
    close(cx(sm), cx(pts), 1e-12);
    const rough = (a) => a.reduce((s, p, i) => s + Math.abs(p.x - a[(i + 1) % a.length].x), 0);
    assert.ok(rough(sm) < rough(pts));
    assert.equal(smoothClosed(pts, 0)[5].x, pts[5].x);
});

test('circle path: one dominant coefficient at k=1', () => {
    const coefs = dftPath(circle(256, 2, 0.5, -0.25), 'amp');
    assert.equal(coefs[0].k, 1);
    close(coefs[0].amp, 2, 1e-9);
    assert.equal(coefs[1].k, 0); // centre offset
    close(coefs[1].re, 0.5); close(coefs[1].im, -0.25);
    for (let i = 2; i < coefs.length; i++) assert.ok(coefs[i].amp < 1e-9);
});

test('clockwise circle -> k = -1', () => {
    const cw = circle(64).map((p) => ({ x: p.x, y: -p.y }));
    assert.equal(dftPath(cw, 'amp')[0].k, -1);
});

test('ordering: freq = 0,1,-1,2,-2,...; amp = non-increasing amplitude', () => {
    const f = dftPath(blob(64), 'freq');
    assert.deepEqual(f.slice(0, 5).map((c) => c.k), [0, 1, -1, 2, -2]);
    assert.equal(new Set(f.map((c) => c.k)).size, 64);
    const a = dftPath(blob(64), 'amp');
    for (let i = 1; i < a.length; i++) assert.ok(a[i].amp <= a[i - 1].amp + 1e-15);
    assert.deepEqual(sortCoefs(a, 'freq').map((c) => c.k), f.map((c) => c.k));
});

test('K = N reproduces the sampled path exactly (both orders)', () => {
    const path = blob(128);
    for (const order of ['freq', 'amp']) {
        const coefs = dftPath(path, order);
        for (let i = 0; i < 128; i++) {
            const q = evaluate(coefs, 128, i / 128);
            close(q.x, path[i].x, 1e-9); close(q.y, path[i].y, 1e-9);
        }
        close(rmsError(coefs, 128, path), 0, 1e-9);
    }
});

test('rmsError is non-increasing in K for amp ordering and matches Parseval', () => {
    const path = blob(128);
    const coefs = dftPath(path, 'amp');
    let prev = Infinity;
    for (const K of [0, 1, 2, 3, 5, 8, 16, 64, 128]) {
        const e = rmsError(coefs, K, path);
        assert.ok(e <= prev + 1e-12, `K=${K}`);
        prev = e;
        let dropped = 0;
        for (let i = K; i < 128; i++) dropped += coefs[i].amp ** 2;
        close(e, Math.sqrt(dropped), 1e-9, `parseval K=${K}`);
    }
});

test('top-K energy is monotonic and amp ordering beats freq ordering for the same K', () => {
    const path = blob(64);
    const byAmp = dftPath(path, 'amp'), byFreq = dftPath(path, 'freq');
    let last = -1;
    for (let K = 0; K <= 64; K++) {
        const e = byAmp.slice(0, K).reduce((s, c) => s + c.amp ** 2, 0);
        assert.ok(e >= last - 1e-15);
        last = e;
    }
    for (const K of [1, 3, 5, 9]) assert.ok(rmsError(byAmp, K, path) <= rmsError(byFreq, K, path) + 1e-12);
});

test('epicycle chain: tip of last circle equals evaluate; radii are amplitudes; centres chain', () => {
    const coefs = dftPath(blob(64), 'amp');
    for (const t of [0, 0.123, 0.5, 0.9]) {
        for (const K of [1, 4, 20]) {
            const ch = epicycleChain(coefs, K, t);
            assert.equal(ch.length, K);
            const last = ch[K - 1];
            const q = evaluate(coefs, K, t);
            close(last.cx + last.r * Math.cos(last.angle), q.x, 1e-9);
            close(last.cy + last.r * Math.sin(last.angle), q.y, 1e-9);
            for (let i = 1; i < K; i++) {
                close(ch[i].cx, ch[i - 1].cx + ch[i - 1].r * Math.cos(ch[i - 1].angle), 1e-12);
                close(ch[i].r, coefs[i].amp);
            }
        }
    }
    assert.equal(epicycleChain(coefs, 0, 0).length, 0);
    assert.equal(epicycleChain(coefs, 1e9, 0).length, 64);
});

test('evaluate is periodic in t and K is clamped', () => {
    const coefs = dftPath(blob(32), 'freq');
    const a = evaluate(coefs, 7, 0.3), b = evaluate(coefs, 7, 1.3);
    close(a.x, b.x, 1e-9); close(a.y, b.y, 1e-9);
    assert.deepEqual(evaluate(coefs, -3, 0.2), { x: 0, y: 0 });
    assert.deepEqual(evaluate(coefs, 1e6, 0.2), evaluate(coefs, 32, 0.2));
});

test('dftPath requires a power-of-two length', () => {
    assert.throws(() => dftPath(circle(12)), /power of two/);
});
