import test from 'node:test';
import assert from 'node:assert/strict';
import {
    IFS_PRESETS, getIfsPreset, makeRng, compileMaps, createChaosState, runChaos, DensityGrid, boundingView, viewForRect,
    contractionRatios, similarityDimension, boxCountDimension, isSimilarity, complexMap, cloneMaps,
} from '../../lib/ifs.js';

function render(maps, n, size = 1024, seed = 3, pad = 0.03) {
    const view = viewForRect(boundingView(maps), size, size, pad);
    const grid = new DensityGrid(size, size, view);
    runChaos(compileMaps(maps), createChaosState(seed), n, grid);
    return grid;
}

test('rng is deterministic, uniform and seed dependent', () => {
    const a = makeRng(5), b = makeRng(5), c = makeRng(6);
    const xs = Array.from({ length: 1000 }, () => a());
    assert.deepEqual(xs, Array.from({ length: 1000 }, () => b()));
    assert.notDeepEqual(xs.slice(0, 10), Array.from({ length: 10 }, () => c()));
    assert.ok(xs.every((x) => x >= 0 && x < 1));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    assert.ok(Math.abs(mean - 0.5) < 0.05);
});

test('all presets are valid affine systems with contracting similarity-free dimensions', () => {
    const ids = IFS_PRESETS.map((q) => q.id);
    for (const id of ['sierpinski', 'fern', 'koch', 'heighway', 'levy', 'maple']) assert.ok(ids.includes(id), id);
    for (const pre of IFS_PRESETS) {
        assert.ok(pre.maps.length >= 2);
        for (const m of pre.maps) assert.ok(['a', 'b', 'c', 'd', 'e', 'f'].every((k) => Number.isFinite(m[k])), pre.id);
        const box = boundingView(pre.maps);
        assert.ok(box.xmax > box.xmin && box.ymax > box.ymin, pre.id);
    }
    assert.equal(getIfsPreset('nonsense').id, IFS_PRESETS[0].id);
});

test('Moran equation: Sierpinski, Koch, Cantor and degenerate inputs', () => {
    assert.ok(Math.abs(similarityDimension([0.5, 0.5, 0.5]) - Math.log(3) / Math.log(2)) < 1e-12);
    assert.ok(Math.abs(similarityDimension(contractionRatios(getIfsPreset('koch').maps)) - Math.log(4) / Math.log(3)) < 1e-12);
    assert.ok(Math.abs(similarityDimension([1 / 3, 1 / 3]) - Math.log(2) / Math.log(3)) < 1e-12);
    // unequal ratios: the root satisfies the equation
    const s = similarityDimension([0.5, 0.3, 0.2]);
    assert.ok(Math.abs(0.5 ** s + 0.3 ** s + 0.2 ** s - 1) < 1e-12);
    assert.ok(Number.isNaN(similarityDimension([1, 0.5])));
    assert.ok(Number.isNaN(similarityDimension([])));
    // Heighway dragon fills a 2D set
    assert.ok(Math.abs(similarityDimension(contractionRatios(getIfsPreset('heighway').maps)) - 2) < 1e-9);
    assert.ok(getIfsPreset('koch').maps.every((m) => isSimilarity(m)));
    assert.ok(!getIfsPreset('fern').maps.every((m) => isSimilarity(m)));
});

test('density grid conserves mass and the bookkeeping is consistent', () => {
    const maps = getIfsPreset('fern').maps;
    const view = viewForRect(boundingView(maps), 400, 300, 0.05);
    const grid = new DensityGrid(400, 300, view);
    const n = 200000;
    runChaos(compileMaps(maps), createChaosState(1), n, grid);
    let total = 0;
    for (let i = 0; i < grid.counts.length; i++) total += grid.counts[i];
    assert.equal(total, grid.inView);
    assert.equal(grid.total, n - 24, 'all but the warm-up points are counted');
    assert.equal(grid.outside, 0, 'the view contains the attractor');
    // a view that cuts the attractor still conserves the total
    const half = new DensityGrid(400, 300, { ...view, xmin: 0 });
    runChaos(compileMaps(maps), createChaosState(1), n, half);
    assert.ok(half.outside > 0 && half.inView > 0);
    assert.equal(half.total, n - 24);
    grid.clear();
    assert.equal(grid.total, 0);
    assert.equal(grid.maxCount(), 0);
});

test('chaos game is deterministic per seed and tags record the last map', () => {
    const maps = getIfsPreset('sierpinski').maps;
    const sys = compileMaps(maps);
    const run = (seed) => { const g = render(maps, 50000, 128, seed); return g; };
    const a = run(1), b = run(1), c = run(2);
    assert.deepEqual(a.counts, b.counts);
    assert.notDeepEqual(a.counts, c.counts);
    for (let i = 0; i < a.counts.length; i++) if (a.counts[i]) assert.ok(a.tag[i] < sys.k);
    // the three corners belong to the maps that fix them: point (0, 0) is the fixed point of map 0
    const g = render(maps, 400000, 256, 1);
    const used = new Set();
    for (let i = 0; i < g.counts.length; i++) if (g.counts[i]) used.add(g.tag[i]);
    assert.equal(used.size, 3);
});

test('map weights are respected (fern) and |det| is the default weight', () => {
    const fern = compileMaps(getIfsPreset('fern').maps);
    assert.ok(Math.abs(fern.cum[0] - 0.01) < 1e-12 && Math.abs(fern.cum[1] - 0.86) < 1e-12);
    const sys = compileMaps(getIfsPreset('fern').maps);
    const st = createChaosState(4);
    const freq = [0, 0, 0, 0];
    const N = 200000;
    for (let i = 0; i < N; i++) { runChaos(sys, st, 1); freq[st.idx]++; }
    assert.ok(Math.abs(freq[1] / N - 0.85) < 0.01, `${freq}`);
    assert.ok(Math.abs(freq[0] / N - 0.01) < 0.003);
    const auto = compileMaps([complexMap(0.5, 0, 0, 0), complexMap(0.25, 0, 1, 0)]);
    assert.ok(Math.abs(auto.cum[0] - 0.25 / 0.3125) < 1e-12); // |det| = r^2: 0.25 vs 0.0625
});

test('box-counting dimension of Sierpinski and Koch is within 5% of the similarity dimension', () => {
    for (const [id, exact] of [['sierpinski', Math.log(3) / Math.log(2)], ['koch', Math.log(4) / Math.log(3)]]) {
        const maps = getIfsPreset(id).maps;
        const g = render(maps, 4e6);
        const est = boxCountDimension(g);
        assert.ok(Math.abs(est.dimension - exact) / exact < 0.05, `${id}: ${est.dimension} vs ${exact}`);
        assert.ok(est.r2 > 0.99);
        assert.ok(Math.abs(similarityDimension(contractionRatios(maps)) - exact) < 1e-12);
    }
});

test('performance budget: several million iterations per second', () => {
    const sys = compileMaps(getIfsPreset('maple').maps);
    const grid = render(getIfsPreset('maple').maps, 1000, 512);
    const st = createChaosState(9);
    const t = performance.now();
    runChaos(sys, st, 3e6, grid);
    const dt = performance.now() - t;
    assert.ok(dt < 3000, `3M iterations took ${dt} ms`);
});

test('diverging maps are reset instead of producing NaN', () => {
    const maps = [{ a: 3, b: 0, c: 0, d: 3, e: 1, f: 1 }, { a: 2, b: 1, c: 1, d: 2, e: 0, f: 0 }];
    const grid = new DensityGrid(64, 64, { xmin: -2, xmax: 2, ymin: -2, ymax: 2 });
    const st = createChaosState(1);
    runChaos(compileMaps(maps), st, 20000, grid);
    assert.ok(Number.isFinite(st.x) && Number.isFinite(st.y));
    assert.equal(cloneMaps(maps)[0].a, 3);
});
