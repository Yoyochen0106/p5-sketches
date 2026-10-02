// Pure numerics for the PDE unit (ma-pde): heat, wave, Laplace and 2D plate problems on
// rectangles, solved by eigenfunction (Fourier) series AND by finite differences so that the two
// can be compared. No p5, no DOM.
//
// Conventions
//   * 1D problems live on [0, L] with samples x_i = i L / (n - 1) (both end points included).
//   * Mode kinds:  'sin'      phi_n = sin(n pi x / L),            k = n pi / L,         n = 1, 2, ...
//                  'cos'      phi_n = cos(n pi x / L),            k = n pi / L,         n = 0, 1, ...
//                  'sinhalf'  phi_n = sin((n - 1/2) pi x / L),    k = (n - 1/2) pi / L, n = 1, 2, ...
//                  'periodic' 1, cos(2 pi m x / L), sin(2 pi m x / L), m = 1, 2, ...
//   * Heat BCs:  'dirichlet' u=0 at both ends, 'neumann' u_x=0 at both ends, 'mixed' u(0)=0 and
//     u_x(L)=0, 'periodic', 'fixed' u(0)=Tl, u(L)=Tr (steady-state offset + Dirichlet transient).
//   * Wave BCs:  'fixed', 'free', 'fixedfree' (fixed at 0, free at L), 'infinite' (d'Alembert only).

const PI = Math.PI;

/** Small deterministic PRNG (mulberry32); returns a function giving uniform numbers in [0, 1). */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Trapezoid rule of uniformly sampled data with spacing h. */
export function trapz(arr, h) {
    const n = arr.length;
    if (n < 2) return 0;
    let s = 0.5 * (arr[0] + arr[n - 1]);
    for (let i = 1; i < n - 1; i++) s += arr[i];
    return s * h;
}

/** Linear interpolation of uniform samples arr over [0, L] at s (clamped). */
export function sampleAt(arr, L, s) {
    const n = arr.length;
    if (n === 0) return 0;
    if (n === 1) return arr[0];
    const t = Math.max(0, Math.min(1, s / L)) * (n - 1);
    const k = Math.min(n - 2, Math.floor(t));
    const f = t - k;
    return arr[k] * (1 - f) + arr[k + 1] * f;
}

// ---------------------------------------------------------------------------------------------
// Eigenmodes

/** Heat BC -> mode kind. */
export function heatKind(bc) {
    switch (bc) {
        case 'neumann': return 'cos';
        case 'mixed': return 'sinhalf';
        case 'periodic': return 'periodic';
        default: return 'sin'; // dirichlet, fixed
    }
}

/** Wave BC -> mode kind (null for the infinite line). */
export function waveKind(bc) {
    switch (bc) {
        case 'free': return 'cos';
        case 'fixedfree': return 'sinhalf';
        case 'infinite': return null;
        default: return 'sin';
    }
}

/**
 * First `count` eigenmodes of the given kind on [0, L]. Each mode: { index, k, norm, phi(x) }
 * where norm = integral of phi^2 over [0, L] and k the spatial wavenumber (eigenvalue k^2).
 */
export function makeModes(kind, L, count) {
    const modes = [];
    for (let j = 0; j < count; j++) {
        if (kind === 'sin') {
            const k = ((j + 1) * PI) / L;
            modes.push({ index: j, k, norm: L / 2, phi: (x) => Math.sin(k * x) });
        } else if (kind === 'cos') {
            const k = (j * PI) / L;
            modes.push({ index: j, k, norm: j === 0 ? L : L / 2, phi: (x) => Math.cos(k * x) });
        } else if (kind === 'sinhalf') {
            const k = ((j + 0.5) * PI) / L;
            modes.push({ index: j, k, norm: L / 2, phi: (x) => Math.sin(k * x) });
        } else if (kind === 'periodic') {
            if (j === 0) modes.push({ index: 0, k: 0, norm: L, phi: () => 1 });
            else {
                const m = Math.ceil(j / 2);
                const k = (2 * PI * m) / L;
                if (j % 2 === 1) modes.push({ index: j, k, norm: L / 2, phi: (x) => Math.cos(k * x) });
                else modes.push({ index: j, k, norm: L / 2, phi: (x) => Math.sin(k * x) });
            }
        } else throw new Error(`makeModes: unknown kind ${kind}`);
    }
    return modes;
}

/** Matrix Phi[j * nx + i] = phi_j(x_i) on the uniform grid of nx points over [0, L]. */
export function modeMatrix(modes, L, nx) {
    const out = new Float64Array(modes.length * nx);
    for (let j = 0; j < modes.length; j++) {
        for (let i = 0; i < nx; i++) out[j * nx + i] = modes[j].phi((i * L) / (nx - 1));
    }
    return out;
}

/** Coefficients c_j = (1/norm_j) * integral f phi_j  (trapezoid rule on the samples of f). */
export function projectModes(modes, L, f, Phi = null) {
    const nx = f.length;
    const h = L / (nx - 1);
    const M = Phi || modeMatrix(modes, L, nx);
    const c = new Float64Array(modes.length);
    for (let j = 0; j < modes.length; j++) {
        const prod = new Float64Array(nx);
        for (let i = 0; i < nx; i++) prod[i] = f[i] * M[j * nx + i];
        c[j] = trapz(prod, h) / modes[j].norm;
    }
    return c;
}

// ---------------------------------------------------------------------------------------------
// Initial profiles

/**
 * Named initial profiles sampled at n points of [0, 1]:
 * step (box), triangle, gaussian, sawtooth, random (seeded smooth), sine.
 */
export function profile(name, n, seed = 1) {
    const out = new Float64Array(n);
    const xs = (i) => i / (n - 1);
    switch (name) {
        case 'step':
            for (let i = 0; i < n; i++) out[i] = xs(i) > 0.25 && xs(i) < 0.75 ? 1 : 0;
            break;
        case 'triangle':
            for (let i = 0; i < n; i++) out[i] = 1 - Math.abs(2 * xs(i) - 1);
            break;
        case 'gaussian':
            for (let i = 0; i < n; i++) out[i] = Math.exp(-(((xs(i) - 0.5) / 0.09) ** 2) / 2);
            break;
        case 'sawtooth':
            for (let i = 0; i < n; i++) { const t = 2 * xs(i); out[i] = t - Math.floor(t); }
            break;
        case 'random': {
            const rng = mulberry32(seed);
            for (let m = 1; m <= 9; m++) {
                const amp = (rng() * 2 - 1) / m;
                for (let i = 0; i < n; i++) out[i] += amp * Math.sin(m * PI * xs(i));
            }
            let mx = 0;
            for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
            if (mx > 0) for (let i = 0; i < n; i++) out[i] /= mx;
            break;
        }
        default:
            for (let i = 0; i < n; i++) out[i] = Math.sin(PI * xs(i));
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Heat equation: eigenfunction series

/**
 * Series solution of u_t = alpha u_xx on [0, L].
 * u0: sampled initial profile (>= 3 samples). For bc 'fixed' the ends are held at Tl, Tr.
 * Returns { kind, modes, coefs, steady(x), amplitudes(t, nTerms), evaluate(t, nx, out, nTerms), decayRate(j) }.
 */
export function heatSeries({ bc = 'dirichlet', L = 1, alpha = 1, u0, Tl = 0, Tr = 0, count = 64 }) {
    const kind = heatKind(bc);
    const n0 = u0.length;
    const modes = makeModes(kind, L, count);
    const offset = bc === 'fixed' ? (x) => Tl + ((Tr - Tl) * x) / L : null;
    const w0 = new Float64Array(n0);
    for (let i = 0; i < n0; i++) w0[i] = u0[i] - (offset ? offset((i * L) / (n0 - 1)) : 0);
    const coefs = projectModes(modes, L, w0);
    const decayRate = (j) => alpha * modes[j].k * modes[j].k;
    const cache = new Map();
    const matrix = (nx) => {
        if (!cache.has(nx)) cache.set(nx, modeMatrix(modes, L, nx));
        return cache.get(nx);
    };
    const mean = coefs[0] * (kind === 'cos' || kind === 'periodic' ? 1 : 0);
    return {
        bc, kind, L, alpha, modes, coefs, decayRate,
        /** Steady state as t -> infinity. */
        steady(x) {
            if (offset) return offset(x);
            return mean; // Neumann / periodic: the mean value; Dirichlet / mixed: 0
        },
        /** Signed coefficient of mode j at time t. */
        amplitudes(t, nTerms = count) {
            const m = Math.min(nTerms, count);
            const a = new Float64Array(m);
            for (let j = 0; j < m; j++) a[j] = coefs[j] * Math.exp(-decayRate(j) * t);
            return a;
        },
        /** u(x_i, t) on nx uniform points using the first nTerms modes. */
        evaluate(t, nx, out = new Float64Array(nx), nTerms = count) {
            const M = matrix(nx);
            const a = this.amplitudes(t, nTerms);
            for (let i = 0; i < nx; i++) out[i] = offset ? offset((i * L) / (nx - 1)) : 0;
            for (let j = 0; j < a.length; j++) {
                const aj = a[j];
                if (aj === 0) continue;
                const row = j * nx;
                for (let i = 0; i < nx; i++) out[i] += aj * M[row + i];
            }
            return out;
        },
    };
}

/** Heat content: integral of u over [0, L]. */
export function heatContent(u, L) {
    return trapz(u, L / (u.length - 1));
}

// ---------------------------------------------------------------------------------------------
// Heat equation: finite differences (FTCS / backward Euler / Crank-Nicolson)

/** Thomas algorithm: solves the tridiagonal system (lo, di, up | rhs) into out. Scratch is reused. */
export function solveTridiagonal(lo, di, up, rhs, out, scratch = null) {
    const n = di.length;
    const cp = scratch || new Float64Array(n);
    const dp = new Float64Array(n);
    cp[0] = up[0] / di[0];
    dp[0] = rhs[0] / di[0];
    for (let i = 1; i < n; i++) {
        const m = di[i] - lo[i] * cp[i - 1];
        cp[i] = up[i] / m;
        dp[i] = (rhs[i] - lo[i] * dp[i - 1]) / m;
    }
    out[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i--) out[i] = dp[i] - cp[i] * out[i + 1];
    return out;
}

/**
 * Cyclic tridiagonal solve (Sherman-Morrison): lo[0] couples row 0 to the LAST unknown and
 * up[n-1] couples the last row to the FIRST unknown.
 */
export function solveCyclic(lo, di, up, rhs, out) {
    const n = di.length;
    if (n < 3) throw new Error('solveCyclic: need at least 3 unknowns');
    const beta = lo[0];
    const alpha = up[n - 1];
    const gamma = -di[0];
    const bb = Float64Array.from(di);
    bb[0] = di[0] - gamma;
    bb[n - 1] = di[n - 1] - (alpha * beta) / gamma;
    const lo2 = Float64Array.from(lo); lo2[0] = 0;
    const up2 = Float64Array.from(up); up2[n - 1] = 0;
    const y = new Float64Array(n);
    solveTridiagonal(lo2, bb, up2, rhs, y);
    const u = new Float64Array(n);
    u[0] = gamma; u[n - 1] = alpha;
    const z = new Float64Array(n);
    solveTridiagonal(lo2, bb, up2, u, z);
    const fact = (y[0] + (beta * y[n - 1]) / gamma) / (1 + z[0] + (beta * z[n - 1]) / gamma);
    for (let i = 0; i < n; i++) out[i] = y[i] - fact * z[i];
    return out;
}

/** Stability limit of FTCS for the heat equation: r = alpha dt / dx^2 <= 1/2. */
export const FTCS_LIMIT = 0.5;

/**
 * 1D heat finite differences on N cells (N + 1 nodes). r = alpha dt / dx^2 sets dt.
 * method: 'ftcs' | 'be' (backward Euler) | 'cn' (Crank-Nicolson).
 * Neumann ends use the ghost-node reflection u_{-1} = u_1 (second order); the trapezoid heat
 * content is conserved exactly by all three methods.
 */
export class HeatFD {
    constructor({ bc = 'dirichlet', N = 64, L = 1, alpha = 1, r = 0.4, method = 'ftcs', u0, Tl = 0, Tr = 0 }) {
        this.bc = bc; this.N = N; this.L = L; this.alpha = alpha; this.r = r; this.method = method;
        this.dx = L / N;
        this.dt = (r * this.dx * this.dx) / alpha;
        this.t = 0;
        this.steps = 0;
        const per = bc === 'periodic';
        this.leftFixed = bc === 'dirichlet' || bc === 'mixed' || bc === 'fixed';
        this.rightFixed = bc === 'dirichlet' || bc === 'fixed';
        this.bl = bc === 'fixed' ? Tl : 0;
        this.br = bc === 'fixed' ? Tr : 0;
        this.periodic = per;
        this.lo = this.leftFixed ? 1 : 0;
        this.hi = this.rightFixed || per ? N - 1 : N;
        const M = this.hi - this.lo + 1;
        this.M = M;
        const lo = new Float64Array(M), di = new Float64Array(M), up = new Float64Array(M), b = new Float64Array(M);
        for (let i = 0; i < M; i++) { lo[i] = 1; di[i] = -2; up[i] = 1; }
        if (!this.leftFixed && !per) { lo[0] = 0; up[0] = 2; }
        if (!this.rightFixed && !per) { up[M - 1] = 0; lo[M - 1] = 2; }
        if (this.leftFixed) b[0] += this.bl; // node 0 is the left neighbour of unknown 0
        if (this.rightFixed) b[M - 1] += this.br;
        // for fixed ends the boundary node value enters through b, not through lo / up
        if (this.leftFixed) lo[0] = 0;
        if (this.rightFixed) up[M - 1] = 0;
        this.Lo = lo; this.Di = di; this.Up = up; this.B = b;
        this.u = new Float64Array(N + 1);
        for (let i = 0; i <= N; i++) this.u[i] = sampleAt(u0, L, i * this.dx);
        this.pin();
        this._buildImplicit();
        this.tmp = new Float64Array(M);
        this.rhs = new Float64Array(M);
        this.x = new Float64Array(M);
    }

    /** Pins boundary nodes (fixed ends, periodic duplicate node). */
    pin() {
        const u = this.u, N = this.N;
        if (this.leftFixed) u[0] = this.bl;
        if (this.rightFixed) u[N] = this.br;
        if (this.periodic) u[N] = u[0];
    }

    _buildImplicit() {
        const M = this.M, r = this.r;
        const th = this.method === 'cn' ? r / 2 : r;
        this.ILo = new Float64Array(M); this.IDi = new Float64Array(M); this.IUp = new Float64Array(M);
        for (let i = 0; i < M; i++) {
            this.ILo[i] = -th * this.Lo[i];
            this.IDi[i] = 1 - th * this.Di[i];
            this.IUp[i] = -th * this.Up[i];
        }
    }

    /** (L v)_i for local unknown index i (cyclic when periodic). */
    _applyL(v, i) {
        const M = this.M;
        let left = 0, right = 0;
        if (i > 0) left = v[i - 1]; else if (this.periodic) left = v[M - 1];
        if (i < M - 1) right = v[i + 1]; else if (this.periodic) right = v[0];
        return this.Lo[i] * left + this.Di[i] * v[i] + this.Up[i] * right;
    }

    /** Advances one time step dt. */
    step() {
        const { M, lo, r, u, method } = { M: this.M, lo: this.lo, r: this.r, u: this.u, method: this.method };
        const v = this.tmp;
        for (let i = 0; i < M; i++) v[i] = u[lo + i];
        if (method === 'ftcs') {
            for (let i = 0; i < M; i++) u[lo + i] = v[i] + r * (this._applyL(v, i) + this.B[i]);
        } else {
            const rhs = this.rhs;
            const th = method === 'cn' ? 0.5 : 0;
            for (let i = 0; i < M; i++) rhs[i] = v[i] + r * this.B[i] + (th ? r * th * this._applyL(v, i) : 0);
            if (this.periodic) solveCyclic(this.ILo, this.IDi, this.IUp, rhs, this.x);
            else solveTridiagonal(this.ILo, this.IDi, this.IUp, rhs, this.x);
            for (let i = 0; i < M; i++) u[lo + i] = this.x[i];
        }
        this.pin();
        this.t += this.dt;
        this.steps++;
    }

    /** Steps until t >= target (at most maxSteps). Returns the number of steps taken. */
    advanceTo(target, maxSteps = 100000) {
        let n = 0;
        while (this.t + this.dt <= target + 1e-12 && n < maxSteps) { this.step(); n++; }
        return n;
    }

    get stable() { return this.method !== 'ftcs' || this.r <= FTCS_LIMIT; }
    content() { return heatContent(this.u, this.L); }
    maxAbs() { let m = 0; for (let i = 0; i < this.u.length; i++) m = Math.max(m, Math.abs(this.u[i])); return m; }
}

/** Largest absolute difference of two arrays (resampling b linearly onto a if lengths differ). */
export function maxDiff(a, b) {
    let m = 0;
    for (let i = 0; i < a.length; i++) {
        const bv = a.length === b.length ? b[i] : sampleAt(b, 1, i / (a.length - 1));
        m = Math.max(m, Math.abs(a[i] - bv));
    }
    return m;
}

// ---------------------------------------------------------------------------------------------
// Wave equation

/**
 * Mode frequencies. dispersion 'none': omega = c k; 'beam': omega = c (L/pi) k^2 (same
 * fundamental frequency, omega_n ~ n^2). gamma is the damping rate in u_tt + 2 gamma u_t = ...
 * Returns { omega0, gamma }.
 */
export function waveOmega(k, { c = 1, L = 1, dispersion = 'none', gamma = 0 } = {}) {
    const omega0 = dispersion === 'beam' ? c * (L / PI) * k * k : c * k;
    return { omega0, gamma };
}

/** Time factors of one damped mode: returns [Cpart, Spart] so that a(t) = A*C(t) + B*S(t). */
export function modeTimeFactors(omega0, gamma, t) {
    if (omega0 < 1e-12) {
        const S = gamma > 1e-12 ? (1 - Math.exp(-2 * gamma * t)) / (2 * gamma) : t;
        return [1, S];
    }
    if (gamma === 0) return [Math.cos(omega0 * t), Math.sin(omega0 * t) / omega0];
    const e = Math.exp(-gamma * t);
    if (omega0 > gamma + 1e-12) {
        const wd = Math.sqrt(omega0 * omega0 - gamma * gamma);
        return [e * (Math.cos(wd * t) + (gamma / wd) * Math.sin(wd * t)), (e * Math.sin(wd * t)) / wd];
    }
    if (omega0 < gamma - 1e-12) {
        const s = Math.sqrt(gamma * gamma - omega0 * omega0);
        return [e * (Math.cosh(s * t) + (gamma / s) * Math.sinh(s * t)), (e * Math.sinh(s * t)) / s];
    }
    return [e * (1 + gamma * t), e * t];
}

/**
 * Normal-mode solution of u_tt + 2 gamma u_t = c^2 u_xx with u(x,0) = f, u_t(x,0) = g.
 * f, g: sampled profiles over [0, L]. Returns { modes, A, B, omega(j), amplitudes(t, nTerms), evaluate(...) }.
 */
export function waveModeSum({ bc = 'fixed', L = 1, c = 1, f, g, count = 64, dispersion = 'none', gamma = 0 }) {
    const kind = waveKind(bc);
    if (!kind) throw new Error('waveModeSum: the infinite line has no normal modes');
    const modes = makeModes(kind, L, count);
    const A = projectModes(modes, L, f);
    const B = projectModes(modes, L, g);
    const omega = (j) => waveOmega(modes[j].k, { c, L, dispersion, gamma }).omega0;
    const cache = new Map();
    const matrix = (nx) => {
        if (!cache.has(nx)) cache.set(nx, modeMatrix(modes, L, nx));
        return cache.get(nx);
    };
    return {
        bc, kind, L, c, modes, A, B, omega,
        /** Signed amplitude a_j(t) of every mode (the coefficient multiplying phi_j(x)). */
        amplitudes(t, nTerms = count) {
            const m = Math.min(nTerms, count);
            const out = new Float64Array(m);
            for (let j = 0; j < m; j++) {
                const [C, S] = modeTimeFactors(omega(j), gamma, t);
                out[j] = A[j] * C + B[j] * S;
            }
            return out;
        },
        evaluate(t, nx, out = new Float64Array(nx), nTerms = count) {
            const M = matrix(nx);
            const a = this.amplitudes(t, nTerms);
            out.fill(0);
            for (let j = 0; j < a.length; j++) {
                const aj = a[j];
                if (aj === 0) continue;
                const row = j * nx;
                for (let i = 0; i < nx; i++) out[i] += aj * M[row + i];
            }
            return out;
        },
    };
}

/** Plucked string: triangle of height h with apex at x0 (sampled at n points of [0, L]). */
export function pluckedProfile(n, L, x0, h) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i * L) / (n - 1);
        out[i] = x <= x0 ? (h * x) / x0 : (h * (L - x)) / (L - x0);
    }
    return out;
}

/** Exact sine coefficient of a plucked string: 2 h L^2 / (pi^2 n^2 x0 (L - x0)) sin(n pi x0 / L). */
export function pluckCoefficient(n, L, x0, h) {
    return (2 * h * L * L * Math.sin((n * PI * x0) / L)) / (PI * PI * n * n * x0 * (L - x0));
}

/** Struck string: initial velocity v0 on [xc - w/2, xc + w/2], zero elsewhere. */
export function struckProfile(n, L, xc, w, v0) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const x = (i * L) / (n - 1);
        out[i] = Math.abs(x - xc) <= w / 2 ? v0 : 0;
    }
    return out;
}

/**
 * d'Alembert solution u = F-part + G-part with the boundary conditions handled by the method of
 * images: f and g are extended to the whole line (odd about a fixed end, even about a free end;
 * zero outside [0, L] for the infinite line).
 * Returns { period, ext(arr, s), at(t, xs) -> { u, right, left }, extendedF(s) }.
 */
export function dAlembert({ bc = 'fixed', L = 1, c = 1, f, g }) {
    const infinite = bc === 'infinite';
    const P = bc === 'fixedfree' ? 4 * L : 2 * L;
    // extension of a sampled profile at an arbitrary point s
    const ext = (arr, s) => {
        if (infinite) return s < 0 || s > L ? 0 : sampleAt(arr, L, s);
        let r = s % P;
        if (r < 0) r += P;
        if (bc === 'fixed') return r <= L ? sampleAt(arr, L, r) : -sampleAt(arr, L, 2 * L - r);
        if (bc === 'free') return r <= L ? sampleAt(arr, L, r) : sampleAt(arr, L, 2 * L - r);
        // fixedfree: odd about 0, even about L
        if (r <= L) return sampleAt(arr, L, r);
        if (r <= 2 * L) return sampleAt(arr, L, 2 * L - r);
        if (r <= 3 * L) return -sampleAt(arr, L, r - 2 * L);
        return -sampleAt(arr, L, 4 * L - r);
    };
    // cumulative integral of the extended velocity over one period (or [0, L] for infinite)
    const span = infinite ? L : P;
    const M = 4096;
    const cum = new Float64Array(M + 1);
    const hh = span / M;
    for (let i = 1; i <= M; i++) {
        const a = ext(g, (i - 1) * hh), b = ext(g, i * hh);
        cum[i] = cum[i - 1] + 0.5 * (a + b) * hh;
    }
    const total = cum[M];
    const cumAt = (r) => {
        const tt = Math.max(0, Math.min(1, r / span)) * M;
        const k = Math.min(M - 1, Math.floor(tt));
        return cum[k] + (cum[k + 1] - cum[k]) * (tt - k);
    };
    // G(s) = (1/c) * integral_0^s g_ext
    const G = (s) => {
        if (infinite) return (s <= 0 ? 0 : s >= L ? total : cumAt(s)) / c;
        const q = Math.floor(s / P);
        return (q * total + cumAt(s - q * P)) / c;
    };
    return {
        period: P, ext, G,
        extendedF: (s) => ext(f, s),
        /** u(x,t) and its right- / left-travelling parts on the points xs. */
        at(t, xs) {
            const n = xs.length;
            const u = new Float64Array(n), right = new Float64Array(n), left = new Float64Array(n);
            for (let i = 0; i < n; i++) {
                const sr = xs[i] - c * t, sl = xs[i] + c * t;
                right[i] = 0.5 * (ext(f, sr) - G(sr));
                left[i] = 0.5 * (ext(f, sl) + G(sl));
                u[i] = right[i] + left[i];
            }
            return { u, right, left };
        },
    };
}

/**
 * Additive synthesis of a string tone. amps: partial amplitudes (signed), ratios: frequency of each
 * partial relative to the fundamental f0 (> 0), per-partial exponential decay rate = decay * ratio.
 * Partials above 0.45 * sampleRate are skipped. Output is normalised to peak <= 0.9.
 */
export function synthString(amps, ratios, f0, sampleRate, seconds, decay = 3) {
    const n = Math.max(1, Math.floor(sampleRate * seconds));
    const out = new Float32Array(n);
    let mx = 0;
    for (let j = 0; j < amps.length; j++) {
        const f = f0 * ratios[j];
        if (!(f > 0) || f > 0.45 * sampleRate || !Number.isFinite(amps[j])) continue;
        const w = (2 * PI * f) / sampleRate;
        const d = decay * Math.sqrt(ratios[j]) / sampleRate;
        for (let i = 0; i < n; i++) out[i] += amps[j] * Math.sin(w * i) * Math.exp(-d * i);
    }
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(out[i]));
    if (mx > 0) for (let i = 0; i < n; i++) out[i] *= 0.9 / mx;
    // short fade to avoid clicks
    const fade = Math.min(n >> 1, Math.floor(sampleRate * 0.01));
    for (let i = 0; i < fade; i++) { out[i] *= i / fade; out[n - 1 - i] *= i / fade; }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Laplace equation on a rectangle [0, a] x [0, b]

// side arrays: bottom (y = 0) and top (y = b) have nx + 1 samples over x; left (x = 0) and right
// (x = a) have ny + 1 samples over y. The grid node (i, j) is stored at index i + (nx + 1) * j.

/** sinh(q (b - y)) / sinh(q b), overflow safe. */
export function sinhRatioDown(q, y, b) {
    return (Math.exp(-q * y) - Math.exp(-q * (2 * b - y))) / (1 - Math.exp(-2 * q * b));
}
/** sinh(q y) / sinh(q b), overflow safe. */
export function sinhRatioUp(q, y, b) {
    return (Math.exp(-q * (b - y)) - Math.exp(-q * (b + y))) / (1 - Math.exp(-2 * q * b));
}

/**
 * Separation-of-variables solution of the Dirichlet problem: four sine series with sinh/sinh
 * ratios. Interior nodes come from the series (first `terms` terms of each side), boundary nodes
 * are set to the data. Returns the node values (nx + 1) x (ny + 1).
 */
export function laplaceSeries({ a = 1, b = 1, nx, ny, bottom, top, left, right, terms = 40 }) {
    const sx = nx + 1;
    const out = new Float64Array(sx * (ny + 1));
    const mx = makeModes('sin', a, terms), my = makeModes('sin', b, terms);
    const Cb = projectModes(mx, a, bottom), Ct = projectModes(mx, a, top);
    const Cl = projectModes(my, b, left), Cr = projectModes(my, b, right);
    const sinx = modeMatrix(mx, a, sx), siny = modeMatrix(my, b, ny + 1);
    for (let j = 1; j < ny; j++) {
        const y = (j * b) / ny;
        for (let n = 0; n < terms; n++) {
            const q = mx[n].k;
            const w = Cb[n] * sinhRatioDown(q, y, b) + Ct[n] * sinhRatioUp(q, y, b);
            if (w === 0) continue;
            for (let i = 1; i < nx; i++) out[i + sx * j] += w * sinx[n * sx + i];
        }
    }
    for (let i = 1; i < nx; i++) {
        const x = (i * a) / nx;
        for (let m = 0; m < terms; m++) {
            const q = my[m].k;
            const w = Cl[m] * sinhRatioDown(q, x, a) + Cr[m] * sinhRatioUp(q, x, a);
            if (w === 0) continue;
            for (let j = 1; j < ny; j++) out[i + sx * j] += w * siny[m * (ny + 1) + j];
        }
    }
    applyBoundary(out, nx, ny, bottom, top, left, right);
    return out;
}

/** Writes the side data onto the boundary nodes (corners = mean of the two meeting sides). */
export function applyBoundary(v, nx, ny, bottom, top, left, right) {
    const sx = nx + 1;
    for (let i = 0; i <= nx; i++) { v[i] = bottom[i]; v[i + sx * ny] = top[i]; }
    for (let j = 0; j <= ny; j++) { v[sx * j] = left[j]; v[nx + sx * j] = right[j]; }
    v[0] = 0.5 * (bottom[0] + left[0]);
    v[nx] = 0.5 * (bottom[nx] + right[0]);
    v[sx * ny] = 0.5 * (top[0] + left[ny]);
    v[nx + sx * ny] = 0.5 * (top[nx] + right[ny]);
}

/** Gauss-Seidel / SOR relaxation of the 5-point Laplacian with Dirichlet sides (dx = a/nx, dy = b/ny). */
export class LaplaceRelax {
    constructor({ a = 1, b = 1, nx, ny, bottom, top, left, right, omega = null }) {
        this.nx = nx; this.ny = ny; this.a = a; this.b = b;
        this.sides = { bottom, top, left, right };
        this.v = new Float64Array((nx + 1) * (ny + 1));
        applyBoundary(this.v, nx, ny, bottom, top, left, right);
        const hx = a / nx, hy = b / ny;
        this.cx = 1 / (hx * hx); this.cy = 1 / (hy * hy);
        const rho = (this.cx * Math.cos(PI / nx) + this.cy * Math.cos(PI / ny)) / (this.cx + this.cy);
        this.omega = omega || 2 / (1 + Math.sqrt(Math.max(0, 1 - rho * rho)));
        this.iterations = 0;
        this.lastChange = Infinity;
    }

    /** One SOR sweep; returns the largest update. */
    sweep() {
        const { nx, ny, v, cx, cy, omega } = this;
        const sx = nx + 1;
        const den = 2 * (cx + cy);
        let maxd = 0;
        for (let j = 1; j < ny; j++) {
            for (let i = 1; i < nx; i++) {
                const k = i + sx * j;
                const gs = (cx * (v[k - 1] + v[k + 1]) + cy * (v[k - sx] + v[k + sx])) / den;
                const d = omega * (gs - v[k]);
                v[k] += d;
                const ad = Math.abs(d);
                if (ad > maxd) maxd = ad;
            }
        }
        this.iterations++;
        this.lastChange = maxd;
        return maxd;
    }

    /** Sweeps until the largest update is below tol (or maxIter sweeps). */
    solve(tol = 1e-9, maxIter = 20000) {
        let n = 0;
        while (n < maxIter) { n++; if (this.sweep() < tol) break; }
        return n;
    }
}

/** Min / max of a node grid: whole grid, interior only and boundary only (with locations). */
export function fieldExtrema(v, nx, ny) {
    const sx = nx + 1;
    const r = {
        min: Infinity, max: -Infinity, interiorMin: Infinity, interiorMax: -Infinity,
        boundaryMin: Infinity, boundaryMax: -Infinity, argMax: [0, 0], argMin: [0, 0],
    };
    for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
            const x = v[i + sx * j];
            const inner = i > 0 && i < nx && j > 0 && j < ny;
            if (x > r.max) { r.max = x; r.argMax = [i, j]; }
            if (x < r.min) { r.min = x; r.argMin = [i, j]; }
            if (inner) { if (x > r.interiorMax) r.interiorMax = x; if (x < r.interiorMin) r.interiorMin = x; }
            else { if (x > r.boundaryMax) r.boundaryMax = x; if (x < r.boundaryMin) r.boundaryMin = x; }
        }
    }
    return r;
}

/**
 * Random-walk (harmonic measure) estimate of the discrete harmonic function at node (si, sj):
 * a walker steps to one of its 4 neighbours with equal probability until it hits the boundary,
 * and the boundary value there is averaged. E[value] equals the relaxation solution exactly.
 */
export class RandomWalkEstimator {
    constructor({ nx, ny, bottom, top, left, right, seed = 1 }) {
        this.nx = nx; this.ny = ny;
        this.sides = { bottom, top, left, right };
        this.rng = mulberry32(seed);
        this.perimeter = 2 * (nx + ny);
        this.setStart(Math.floor(nx / 2), Math.floor(ny / 2));
    }

    setStart(i, j) {
        this.si = Math.max(1, Math.min(this.nx - 1, i));
        this.sj = Math.max(1, Math.min(this.ny - 1, j));
        this.reset();
    }

    reset() {
        this.count = 0; this.sum = 0; this.sumSq = 0;
        this.sideHits = { bottom: 0, top: 0, left: 0, right: 0 };
        this.hist = new Float64Array(this.perimeter);
        this.rng = mulberry32(this.seed || 1);
    }

    /** Runs `n` more walkers. */
    run(n, maxSteps = 2000000) {
        const { nx, ny, rng } = this;
        const { bottom, top, left, right } = this.sides;
        for (let w = 0; w < n; w++) {
            let i = this.si, j = this.sj, steps = 0;
            while (i > 0 && i < nx && j > 0 && j < ny && steps < maxSteps) {
                const r = rng();
                if (r < 0.25) i--; else if (r < 0.5) i++; else if (r < 0.75) j--; else j++;
                steps++;
            }
            let val, pos, side;
            if (j === 0) { val = bottom[i]; pos = i; side = 'bottom'; }
            else if (i === nx) { val = right[j]; pos = nx + j; side = 'right'; }
            else if (j === ny) { val = top[i]; pos = nx + ny + (nx - i); side = 'top'; }
            else if (i === 0) { val = left[j]; pos = 2 * nx + ny + (ny - j); side = 'left'; }
            else { val = 0; pos = 0; side = 'bottom'; }
            this.sum += val; this.sumSq += val * val; this.count++;
            this.sideHits[side]++;
            this.hist[pos % this.perimeter]++;
        }
    }

    get mean() { return this.count ? this.sum / this.count : 0; }
    get stderr() {
        if (this.count < 2) return Infinity;
        const m = this.mean;
        return Math.sqrt(Math.max(0, this.sumSq / this.count - m * m) / this.count);
    }
}

// ---------------------------------------------------------------------------------------------
// 2D plate: heat equation with sources, fixed-temperature cells and insulated holes

export const CELL_NORMAL = 0, CELL_HOLE = 1, CELL_FIXED = 2;

/** pi^2 (m^2 / a^2 + n^2 / b^2): eigenvalue of the product mode (m, n). */
export function rectEigen(m, n, a, b) {
    return PI * PI * ((m * m) / (a * a) + (n * n) / (b * b));
}

/**
 * Cell-centred grid (nx x ny cells of a x b) for u_t = alpha lap(u) + q. The outer edge is
 * 'cold' (u = 0) or 'insulated'; hole cells are insulated; fixed cells hold a temperature.
 * method 'explicit' (FTCS) or 'adi' (Peaceman-Rachford, unconditionally stable).
 * r = alpha dt (1/dx^2 + 1/dy^2): explicit needs r <= 1/2.
 */
export class PlateHeat {
    constructor({ nx = 48, ny = 36, a = 1, b = 0.75, alpha = 1, edge = 'cold', method = 'adi', r = 0.4 }) {
        this.nx = nx; this.ny = ny; this.a = a; this.b = b; this.alpha = alpha;
        this.edge = edge; this.method = method; this.r = r;
        this.dx = a / nx; this.dy = b / ny;
        this.u = new Float64Array(nx * ny);
        this.next = new Float64Array(nx * ny);
        this.type = new Uint8Array(nx * ny);
        this.fixedT = new Float64Array(nx * ny);
        this.q = new Float64Array(nx * ny);
        this.t = 0; this.steps = 0;
        this.setR(r);
        const m = Math.max(nx, ny);
        this._lo = new Float64Array(m); this._di = new Float64Array(m); this._up = new Float64Array(m);
        this._rhs = new Float64Array(m); this._x = new Float64Array(m);
    }

    setR(r) {
        this.r = r;
        this.dt = r / (this.alpha * (1 / (this.dx * this.dx) + 1 / (this.dy * this.dy)));
    }

    /** Value seen by a cell from its neighbour on one side (see class comment). */
    _nb(k, i, j, di, dj) {
        const ni = i + di, nj = j + dj;
        const u = this.u;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.ny) return this.edge === 'cold' ? -u[k] : u[k];
        const kk = ni + this.nx * nj;
        return this.type[kk] === CELL_HOLE ? u[k] : u[kk];
    }

    /** Applies the fixed-temperature cells (call after painting). */
    applyFixed() {
        for (let k = 0; k < this.u.length; k++) {
            if (this.type[k] === CELL_FIXED) this.u[k] = this.fixedT[k];
            else if (this.type[k] === CELL_HOLE) this.u[k] = 0;
        }
    }

    _d2(k, i, j, axis) {
        const u = this.u;
        const h2 = axis === 0 ? this.dx * this.dx : this.dy * this.dy;
        const l = axis === 0 ? this._nb(k, i, j, -1, 0) : this._nb(k, i, j, 0, -1);
        const r = axis === 0 ? this._nb(k, i, j, 1, 0) : this._nb(k, i, j, 0, 1);
        return (l - 2 * u[k] + r) / h2;
    }

    step() {
        const { nx, ny, alpha, dt } = this;
        if (this.method === 'explicit') {
            const nxt = this.next;
            for (let j = 0; j < ny; j++) {
                for (let i = 0; i < nx; i++) {
                    const k = i + nx * j;
                    if (this.type[k] !== CELL_NORMAL) { nxt[k] = this.u[k]; continue; }
                    nxt[k] = this.u[k] + dt * (alpha * (this._d2(k, i, j, 0) + this._d2(k, i, j, 1)) + this.q[k]);
                }
            }
            this.u.set(nxt);
        } else {
            this._adiHalf(0); // implicit in x, explicit in y
            this._adiHalf(1); // implicit in y, explicit in x
        }
        this.t += dt;
        this.steps++;
    }

    // One Peaceman-Rachford half step: implicit along `axis`, explicit along the other axis.
    _adiHalf(axis) {
        const { nx, ny, alpha, dt } = this;
        const h2 = axis === 0 ? this.dx * this.dx : this.dy * this.dy;
        const rho = (alpha * dt) / (2 * h2);
        const nxt = this.next;
        const outer = axis === 0 ? ny : nx;
        const inner = axis === 0 ? nx : ny;
        const lo = this._lo, di = this._di, up = this._up, rhs = this._rhs, x = this._x;
        const idx = (s, t) => (axis === 0 ? t + nx * s : s + nx * t);
        const pos = (s, t) => (axis === 0 ? [t, s] : [s, t]);
        // explicit part (the other axis) + source
        for (let s = 0; s < outer; s++) {
            for (let t = 0; t < inner; t++) {
                const k = idx(s, t);
                const [i, j] = pos(s, t);
                nxt[k] = this.type[k] === CELL_NORMAL
                    ? this.u[k] + ((alpha * dt) / 2) * this._d2(k, i, j, 1 - axis) + (dt / 2) * this.q[k]
                    : this.u[k];
            }
        }
        for (let s = 0; s < outer; s++) {
            let t = 0;
            while (t < inner) {
                if (this.type[idx(s, t)] !== CELL_NORMAL) { t++; continue; }
                const start = t;
                while (t < inner && this.type[idx(s, t)] === CELL_NORMAL) t++;
                const m = t - start;
                for (let q = 0; q < m; q++) {
                    const tt = start + q;
                    let dg = 1, l = 0, r = 0, b = nxt[idx(s, tt)];
                    // lower neighbour
                    if (tt === 0) { if (this.edge === 'cold') dg += 2 * rho; } else {
                        const ty = this.type[idx(s, tt - 1)];
                        if (ty === CELL_NORMAL) { dg += rho; l = -rho; } else if (ty === CELL_FIXED) { dg += rho; b += rho * this.u[idx(s, tt - 1)]; }
                    }
                    if (tt === inner - 1) { if (this.edge === 'cold') dg += 2 * rho; } else {
                        const ty = this.type[idx(s, tt + 1)];
                        if (ty === CELL_NORMAL) { dg += rho; r = -rho; } else if (ty === CELL_FIXED) { dg += rho; b += rho * this.u[idx(s, tt + 1)]; }
                    }
                    lo[q] = l; di[q] = dg; up[q] = r; rhs[q] = b;
                }
                // the segment endpoints do not couple outside the run
                lo[0] = 0; up[m - 1] = 0;
                solveTridiagonal(lo.subarray(0, m), di.subarray(0, m), up.subarray(0, m), rhs.subarray(0, m), x.subarray(0, m));
                for (let q = 0; q < m; q++) nxt[idx(s, start + q)] = x[q];
            }
        }
        this.u.set(nxt);
    }

    /** Advances `n` steps. */
    advance(n) { for (let i = 0; i < n; i++) this.step(); }

    /** Total heat: integral of u over the plate (hole cells excluded). */
    content() {
        let s = 0;
        for (let k = 0; k < this.u.length; k++) if (this.type[k] !== CELL_HOLE) s += this.u[k];
        return s * this.dx * this.dy;
    }
    maxAbs() { let m = 0; for (let k = 0; k < this.u.length; k++) m = Math.max(m, Math.abs(this.u[k])); return m; }
}

/**
 * Product-mode amplitudes of a cell-centred field: u ~ sum amp[m,n] phi_m(x) psi_n(y) with sin
 * modes (m, n >= 1) for a cold edge or cos modes (m, n >= 0) for an insulated edge. amp has M * N
 * entries stored at (mi + M * ni) where mi, ni are zero-based list positions.
 */
export function plateModeAmplitudes(u, nx, ny, a, b, M, N, edge = 'cold') {
    const cold = edge === 'cold';
    const fx = new Float64Array(M * nx), fy = new Float64Array(N * ny);
    const nrm = (idx, count) => (cold || idx > 0 ? 2 / count : 1 / count);
    for (let m = 0; m < M; m++) {
        const kk = cold ? m + 1 : m;
        for (let i = 0; i < nx; i++) fx[m * nx + i] = cold ? Math.sin((kk * PI * (i + 0.5)) / nx) : Math.cos((kk * PI * (i + 0.5)) / nx);
    }
    for (let n = 0; n < N; n++) {
        const kk = cold ? n + 1 : n;
        for (let j = 0; j < ny; j++) fy[n * ny + j] = cold ? Math.sin((kk * PI * (j + 0.5)) / ny) : Math.cos((kk * PI * (j + 0.5)) / ny);
    }
    const amp = new Float64Array(M * N);
    const tmp = new Float64Array(nx);
    for (let n = 0; n < N; n++) {
        tmp.fill(0);
        for (let j = 0; j < ny; j++) {
            const w = fy[n * ny + j];
            for (let i = 0; i < nx; i++) tmp[i] += u[i + nx * j] * w;
        }
        for (let m = 0; m < M; m++) {
            let s = 0;
            for (let i = 0; i < nx; i++) s += tmp[i] * fx[m * nx + i];
            amp[m + M * n] = s * nrm(m, nx) * nrm(n, ny);
        }
    }
    return amp;
}

/** Fills out (nx*ny cell values) with amp * phi_m(x) psi_n(y) for list positions (mi, ni). */
export function plateModeField(out, nx, ny, mi, ni, amp, edge = 'cold') {
    const cold = edge === 'cold';
    const km = cold ? mi + 1 : mi, kn = cold ? ni + 1 : ni;
    for (let j = 0; j < ny; j++) {
        const fy = cold ? Math.sin((kn * PI * (j + 0.5)) / ny) : Math.cos((kn * PI * (j + 0.5)) / ny);
        for (let i = 0; i < nx; i++) {
            const fx = cold ? Math.sin((km * PI * (i + 0.5)) / nx) : Math.cos((km * PI * (i + 0.5)) / nx);
            out[i + nx * j] = amp * fx * fy;
        }
    }
    return out;
}
