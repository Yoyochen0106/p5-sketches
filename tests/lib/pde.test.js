import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mulberry32, profile, makeModes, heatSeries, HeatFD, heatContent, maxDiff, FTCS_LIMIT,
    waveModeSum, dAlembert, pluckedProfile, pluckCoefficient, synthString, solveCyclic, solveTridiagonal,
    laplaceSeries, LaplaceRelax, fieldExtrema, RandomWalkEstimator,
    PlateHeat, plateModeAmplitudes, plateModeField, rectEigen, CELL_HOLE, CELL_FIXED,
} from '../../lib/pde.js';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b} (eps ${eps})`);

test('mulberry32 is deterministic', () => {
    const a = mulberry32(5), b = mulberry32(5);
    for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('modes: orthogonal with the stated norms (all kinds)', () => {
    for (const kind of ['sin', 'cos', 'sinhalf', 'periodic']) {
        const modes = makeModes(kind, 2, 6);
        const n = 4001, h = 2 / (n - 1);
        for (let a = 0; a < 6; a++) {
            for (let b = a; b < 6; b++) {
                let s = 0;
                for (let i = 0; i < n; i++) {
                    const x = i * h;
                    const w = i === 0 || i === n - 1 ? 0.5 : 1;
                    s += w * modes[a].phi(x) * modes[b].phi(x) * h;
                }
                close(s, a === b ? modes[a].norm : 0, 1e-5, `${kind} ${a},${b}`);
            }
        }
    }
});

test('tridiagonal and cyclic solvers reproduce a known solution', () => {
    const n = 7;
    const lo = new Float64Array(n).fill(-1), di = new Float64Array(n).fill(3), up = new Float64Array(n).fill(-1);
    const x = Float64Array.from({ length: n }, (_, i) => i + 1);
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) rhs[i] = di[i] * x[i] + (i > 0 ? lo[i] * x[i - 1] : 0) + (i < n - 1 ? up[i] * x[i + 1] : 0);
    const o = new Float64Array(n);
    solveTridiagonal(lo, di, up, rhs, o);
    for (let i = 0; i < n; i++) close(o[i], x[i], 1e-12);
    const rc = new Float64Array(n);
    for (let i = 0; i < n; i++) rc[i] = di[i] * x[i] + lo[i] * x[(i + n - 1) % n] + up[i] * x[(i + 1) % n];
    solveCyclic(lo, di, up, rc, o);
    for (let i = 0; i < n; i++) close(o[i], x[i], 1e-12);
});

const KIND = { dirichlet: 'sin', fixed: 'sin', neumann: 'cos', mixed: 'sinhalf', periodic: 'periodic' };

test('heat: one-mode series is exact (every BC)', () => {
    const L = 1, alpha = 0.3, n = 257;
    for (const bc of ['dirichlet', 'neumann', 'mixed', 'periodic']) {
        const modes = makeModes(KIND[bc], L, 4);
        const j = bc === 'neumann' || bc === 'periodic' ? 2 : 1;
        const u0 = Float64Array.from({ length: n }, (_, i) => modes[j].phi(i / (n - 1)) * 0.8);
        const hs = heatSeries({ bc, L, alpha, u0, count: 16 });
        const t = 0.07;
        const u = hs.evaluate(t, n);
        const dec = Math.exp(-alpha * modes[j].k ** 2 * t);
        for (let i = 0; i < n; i += 16) close(u[i], 0.8 * dec * modes[j].phi(i / (n - 1)), 2e-4, bc);
    }
});

test('heat: series vs finite differences (FTCS / BE / CN) within tolerance', () => {
    const n = 129, alpha = 0.1;
    const u0 = profile('gaussian', n);
    for (const bc of ['dirichlet', 'neumann', 'mixed', 'periodic']) {
        const hs = heatSeries({ bc, alpha, u0, count: 100 });
        for (const [method, r, tol] of [['ftcs', 0.4, 0.01], ['be', 0.5, 0.02], ['cn', 1, 0.01]]) {
            const fd = new HeatFD({ bc, N: 64, alpha, r, method, u0 });
            fd.advanceTo(0.8);
            const ref = hs.evaluate(fd.t, 65);
            assert.ok(maxDiff(fd.u, ref) < tol, `${bc}/${method}: ${maxDiff(fd.u, ref)}`);
        }
    }
    // fixed-temperature ends approach the linear steady state
    const hs = heatSeries({ bc: 'fixed', alpha, u0: new Float64Array(n), Tl: 1, Tr: 3, count: 64 });
    const far = hs.evaluate(50, 33);
    close(far[0], 1, 1e-9); close(far[32], 3, 1e-9); close(far[16], 2, 1e-6);
    assert.equal(hs.steady(0.5), 2);
    const fd = new HeatFD({ bc: 'fixed', N: 32, alpha, r: 0.5, method: 'cn', u0: new Float64Array(n), Tl: 1, Tr: 3 });
    fd.advanceTo(50);
    close(fd.u[16], 2, 1e-4);
});

test('FTCS stability threshold: bounded for r <= 0.5, blows up above', () => {
    const n = 65;
    const noisy = (seed) => { const rng = mulberry32(seed); return Float64Array.from({ length: n }, () => rng() - 0.5); };
    const run = (r, method = 'ftcs') => {
        const fd = new HeatFD({ bc: 'dirichlet', N: 64, alpha: 1, r, method, u0: noisy(3) });
        for (let i = 0; i < 400; i++) fd.step();
        return fd.maxAbs();
    };
    assert.ok(run(0.5) < 0.5);
    assert.ok(run(0.45) < 0.5);
    assert.ok(run(0.55) > 1e3, `${run(0.55)}`);
    assert.ok(run(0.7) > 1e12);
    assert.ok(run(50, 'be') < 0.5); // implicit schemes are unconditionally stable
    assert.ok(run(50, 'cn') < 5);
    assert.equal(FTCS_LIMIT, 0.5);
    assert.equal(new HeatFD({ bc: 'dirichlet', N: 8, r: 0.6, u0: new Float64Array(9) }).stable, false);
});

test('heat content is conserved with Neumann ends (series and FD) and the limit is the mean', () => {
    const n = 129;
    const u0 = profile('triangle', n);
    const c0 = heatContent(u0, 1);
    for (const method of ['ftcs', 'be', 'cn']) {
        const fd = new HeatFD({ bc: 'neumann', N: 128, alpha: 0.05, r: method === 'ftcs' ? 0.4 : 3, method, u0 });
        const c = fd.content();
        fd.advanceTo(2);
        close(fd.content(), c, 1e-10 * Math.max(1, c), method);
    }
    const hs = heatSeries({ bc: 'neumann', alpha: 0.1, u0, count: 80 });
    close(heatContent(hs.evaluate(0.3, n), 1), c0, 2e-3);
    close(hs.steady(0.3), c0, 2e-3);
    const per = new HeatFD({ bc: 'periodic', N: 64, alpha: 0.1, r: 1, method: 'cn', u0 });
    const cp = per.content();
    per.advanceTo(1);
    close(per.content(), cp, 1e-10);
    // Dirichlet loses heat
    const dir = new HeatFD({ bc: 'dirichlet', N: 64, alpha: 0.1, r: 0.4, u0 });
    dir.advanceTo(1);
    assert.ok(dir.content() < 0.5 * c0);
});

test('high modes die first: amplitude ratio follows exp(-alpha (n pi/L)^2 t)', () => {
    const u0 = profile('step', 257);
    const hs = heatSeries({ bc: 'dirichlet', alpha: 0.02, u0, count: 30 });
    const a0 = hs.amplitudes(0), a1 = hs.amplitudes(0.5);
    for (const j of [0, 2, 4, 8]) close(a1[j] / a0[j], Math.exp(-0.02 * ((j + 1) * Math.PI) ** 2 * 0.5), 1e-12);
});

test('Gibbs: truncated series overshoots a discontinuity by ~9% of the jump, more terms do not cure it', () => {
    const n = 2049;
    const u0 = profile('step', n); // jump of 1 at 0.25 and 0.75
    const hs = heatSeries({ bc: 'dirichlet', u0, count: 120 });
    for (const terms of [30, 100]) {
        const u = hs.evaluate(0, n, undefined, terms);
        let mx = 0;
        for (let i = 0; i < n; i++) mx = Math.max(mx, u[i]);
        close(mx, 1.0895, 0.02, `terms ${terms}`);
    }
});

test('wave: plucked-string coefficients follow the 1/n^2 law', () => {
    const L = 1, x0 = 0.3, h = 0.1, n = 4097;
    const f = pluckedProfile(n, L, x0, h), g = new Float64Array(n);
    const w = waveModeSum({ bc: 'fixed', L, c: 1, f, g, count: 40 });
    for (let k = 1; k <= 40; k++) close(w.A[k - 1], pluckCoefficient(k, L, x0, h), 1e-6, `n=${k}`);
    // pluck at the midpoint: only odd harmonics, amplitude ratio exactly 1/n^2 (alternating sign)
    const mid = waveModeSum({ bc: 'fixed', L, c: 1, f: pluckedProfile(n, L, 0.5, h), g, count: 15 });
    close(mid.A[1], 0, 1e-8);
    for (const k of [3, 5, 7, 9]) close(mid.A[k - 1] / mid.A[0], (1 / (k * k)) * (k % 4 === 1 ? 1 : -1), 1e-5);
    close(pluckCoefficient(1, 1, 0.5, 0.1), (8 * 0.1) / (Math.PI ** 2), 1e-12);
});

test("d'Alembert equals the normal-mode sum (fixed, free, fixed-free)", () => {
    const L = 1, c = 1.7, n = 2049;
    const f = Float64Array.from({ length: n }, (_, i) => Math.exp(-(((i / (n - 1) - 0.4) / 0.1) ** 2)));
    const g = Float64Array.from({ length: n }, (_, i) => { const x = i / (n - 1); return 0.5 * Math.sin(2 * Math.PI * x) * x; });
    for (const bc of ['fixed', 'free', 'fixedfree']) {
        const ms = waveModeSum({ bc, L, c, f, g, count: 400 });
        const da = dAlembert({ bc, L, c, f, g });
        const xs = Float64Array.from({ length: 65 }, (_, i) => i / 64);
        for (const t of [0, 0.13, 0.5, 1.1, 2.9]) {
            const a = da.at(t, xs).u;
            const b = ms.evaluate(t, 65, undefined, 400);
            let d = 0;
            for (let i = 0; i < 65; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
            assert.ok(d < 5e-3, `${bc} t=${t} diff ${d}`);
        }
    }
});

test("d'Alembert: reflection flips sign at a fixed end, keeps it at a free end; infinite line splits in two", () => {
    const L = 1, n = 1025;
    const pulse = Float64Array.from({ length: n }, (_, i) => Math.exp(-(((i / (n - 1) - 0.7) / 0.04) ** 2)));
    const zero = new Float64Array(n);
    const fixed = dAlembert({ bc: 'fixed', L, c: 1, f: pulse, g: zero });
    const free = dAlembert({ bc: 'free', L, c: 1, f: pulse, g: zero });
    // after t = 0.6 the right-going half (centre 1.3) has bounced off x = 1: its mirror image is a left-going pulse at 0.7
    const fr = fixed.at(0.6, [0.7]), fe = free.at(0.6, [0.7]);
    close(fr.left[0], -0.5, 1e-3); // inverted image (left-moving)
    close(fe.left[0], 0.5, 1e-3); // same sign
    const inf = dAlembert({ bc: 'infinite', L, c: 1, f: pulse, g: zero });
    const r = inf.at(0.3, [1.0, 0.4, 0.7]);
    close(r.right[0], 0.5, 1e-3); close(r.left[1], 0.5, 1e-3); close(r.u[2], 0, 1e-3);
    const s = inf.at(0.2, [0.2, 0.9]);
    for (let i = 0; i < 2; i++) close(s.right[i] + s.left[i], s.u[i], 1e-14);
});

test('wave: damping decays modes, beam dispersion makes omega_n ~ n^2, free zero-mode drifts', () => {
    const n = 513;
    const f = pluckedProfile(n, 1, 0.3, 1), g = new Float64Array(n);
    const ideal = waveModeSum({ bc: 'fixed', f, g, count: 20, c: 1 });
    close(ideal.omega(2) / ideal.omega(0), 3, 1e-12);
    const beam = waveModeSum({ bc: 'fixed', f, g, count: 20, c: 1, dispersion: 'beam' });
    close(beam.omega(2) / beam.omega(0), 9, 1e-12);
    close(beam.omega(0), Math.PI, 1e-12);
    const damp = waveModeSum({ bc: 'fixed', f, g, count: 20, c: 1, gamma: 0.8 });
    assert.ok(Math.abs(damp.amplitudes(3)[0]) < 0.2 * Math.abs(damp.A[0]));
    const free = waveModeSum({ bc: 'free', f: new Float64Array(n), g: new Float64Array(n).fill(2), count: 4 });
    close(free.evaluate(1.5, n)[100], 3, 1e-9);
});

test('synthString produces bounded audio', () => {
    const s = synthString([1, 0.5, 0.25], [1, 2, 3], 200, 8000, 0.25);
    assert.equal(s.length, 2000);
    let mx = 0; for (const v of s) mx = Math.max(mx, Math.abs(v));
    assert.ok(mx > 0.5 && mx <= 0.9001);
    assert.ok(s.every(Number.isFinite));
});

function sidesFor(nx, ny, kind) {
    const bottom = new Float64Array(nx + 1), top = new Float64Array(nx + 1), left = new Float64Array(ny + 1), right = new Float64Array(ny + 1);
    if (kind === 'bump') for (let i = 0; i <= nx; i++) top[i] = Math.sin(Math.PI * i / nx);
    else if (kind === 'saddle') {
        for (let i = 0; i <= nx; i++) { top[i] = bottom[i] = Math.sin(Math.PI * i / nx); }
        for (let j = 0; j <= ny; j++) { left[j] = right[j] = -Math.sin(Math.PI * j / ny); }
    } else if (kind === 'mixed') {
        for (let i = 0; i <= nx; i++) { top[i] = Math.sin(2 * Math.PI * i / nx); bottom[i] = 0.5 * Math.sin(3 * Math.PI * i / nx); }
        for (let j = 0; j <= ny; j++) { left[j] = 0.3 * Math.sin(Math.PI * j / ny); right[j] = Math.sin(2 * Math.PI * j / ny); }
    }
    return { bottom, top, left, right };
}

test('Laplace: closed form for the single-bump problem, and series == relaxation', () => {
    const nx = 48, ny = 48;
    const s = sidesFor(nx, ny, 'bump');
    const ser = laplaceSeries({ nx, ny, ...s, terms: 10 });
    for (const [i, j] of [[24, 24], [12, 40], [36, 8]]) {
        const exact = Math.sin(Math.PI * i / nx) * Math.sinh(Math.PI * j / ny) / Math.sinh(Math.PI);
        close(ser[i + (nx + 1) * j], exact, 1e-4);
    }
    for (const kind of ['bump', 'saddle', 'mixed']) {
        const sd = sidesFor(nx, ny, kind);
        const series = laplaceSeries({ nx, ny, ...sd, terms: 40 });
        const rel = new LaplaceRelax({ nx, ny, ...sd });
        const its = rel.solve(1e-10);
        assert.ok(its < 2000, `SOR iterations ${its}`);
        let d = 0;
        for (let k = 0; k < series.length; k++) d = Math.max(d, Math.abs(series[k] - rel.v[k]));
        assert.ok(d < 0.01, `${kind}: ${d}`);
    }
});

test('maximum principle: interior extrema stay within the boundary range', () => {
    const nx = 40, ny = 30;
    const sd = sidesFor(nx, ny, 'mixed');
    const rel = new LaplaceRelax({ nx, ny, ...sd });
    rel.solve(1e-10);
    const e = fieldExtrema(rel.v, nx, ny);
    assert.ok(e.interiorMax <= e.boundaryMax + 1e-9 && e.interiorMin >= e.boundaryMin - 1e-9);
    const [i, j] = e.argMax;
    assert.ok(i === 0 || i === nx || j === 0 || j === ny);
});

test('random walkers converge to the harmonic value (and are seeded)', () => {
    const nx = 24, ny = 24;
    const sd = sidesFor(nx, ny, 'saddle');
    sd.left.fill(-0.3);
    const rel = new LaplaceRelax({ nx, ny, ...sd });
    rel.solve(1e-11);
    const target = rel.v[8 + (nx + 1) * 14];
    const mk = () => { const w = new RandomWalkEstimator({ nx, ny, ...sd, seed: 11 }); w.setStart(8, 14); return w; };
    const w = mk();
    w.run(300);
    const se300 = w.stderr;
    w.run(20000);
    assert.ok(Math.abs(w.mean - target) < 4 * w.stderr + 1e-3, `${w.mean} vs ${target} se ${w.stderr}`);
    assert.ok(w.stderr < se300 / 4);
    assert.equal(w.count, 20300);
    assert.equal(w.sideHits.bottom + w.sideHits.top + w.sideHits.left + w.sideHits.right, w.count);
    assert.equal(w.hist.reduce((a, b) => a + b, 0), w.count);
    const w2 = mk(); w2.run(300);
    const w3 = mk(); w3.run(300);
    assert.equal(w2.mean, w3.mean);
});

test('plate: single product mode decays like exp(-alpha lambda t) (ADI and explicit)', () => {
    const nx = 40, ny = 30, a = 1, b = 0.75, alpha = 0.5;
    for (const method of ['adi', 'explicit']) {
        const pl = new PlateHeat({ nx, ny, a, b, alpha, edge: 'cold', method, r: method === 'adi' ? 1 : 0.4 });
        plateModeField(pl.u, nx, ny, 1, 0, 2, 'cold'); // (m, n) = (2, 1)
        const amp0 = plateModeAmplitudes(pl.u, nx, ny, a, b, 4, 4, 'cold');
        close(amp0[1], 2, 1e-12);
        close(amp0[0], 0, 1e-12);
        while (pl.t < 0.08) pl.step();
        const amp = plateModeAmplitudes(pl.u, nx, ny, a, b, 4, 4, 'cold');
        const expected = 2 * Math.exp(-alpha * rectEigen(2, 1, a, b) * pl.t);
        close(amp[1] / expected, 1, 0.02, method);
    }
});

test('plate: heat is conserved with insulated edges and holes; ADI is stable at huge r, explicit blows up', () => {
    const mk = (method, r) => {
        const pl = new PlateHeat({ nx: 32, ny: 24, edge: 'insulated', method, r });
        for (let j = 8; j < 14; j++) for (let i = 12; i < 18; i++) pl.type[i + 32 * j] = CELL_HOLE;
        const rng = mulberry32(2);
        for (let k = 0; k < pl.u.length; k++) pl.u[k] = pl.type[k] === CELL_HOLE ? 0 : rng();
        return pl;
    };
    const adi = mk('adi', 5);
    const c0 = adi.content();
    adi.advance(100);
    close(adi.content(), c0, 1e-9);
    assert.ok(adi.maxAbs() < 1);
    const ex = mk('explicit', 0.45); const e0 = ex.content();
    ex.advance(200);
    close(ex.content(), e0, 1e-9);
    const bad = mk('explicit', 0.6);
    bad.advance(300);
    assert.ok(bad.maxAbs() > 1e3);
});

test('plate: fixed-temperature cells pin the field, sources heat it', () => {
    const pl = new PlateHeat({ nx: 24, ny: 18, edge: 'insulated', method: 'adi', r: 2 });
    for (let j = 0; j < 18; j++) {
        pl.type[24 * j] = CELL_FIXED; pl.fixedT[24 * j] = 1;
        pl.type[23 + 24 * j] = CELL_FIXED; pl.fixedT[23 + 24 * j] = 0;
    }
    pl.applyFixed();
    pl.advance(4000);
    assert.equal(pl.u[0], 1);
    close(pl.u[12 + 24 * 9], 0.5, 0.04); // linear ramp between the two fixed columns
    const src = new PlateHeat({ nx: 20, ny: 20, edge: 'cold', method: 'adi', r: 1 });
    src.q[10 + 20 * 10] = 5;
    src.advance(50);
    assert.ok(src.u[10 + 20 * 10] > src.u[2 + 20 * 2] && src.u[10 + 20 * 10] > 0);
});
