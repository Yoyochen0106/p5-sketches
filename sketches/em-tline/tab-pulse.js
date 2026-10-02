// Pulse tab: time-domain propagation on a lossless line with source impedance Zs and load ZL, the
// lattice (bounce) diagram, load / source voltages, and the energy-conservation check.
import * as T from '../../lib/em/tline.js';
import { plotFrame, polyline, clipped, textBlock, COLORS } from '../em-common/plot.js';
import { fmt, clamp } from '../em-common/util.js';

export const N_CELLS = 200;
export const T_MAX = 14; // recorded time span in one-way delays
const OPEN = 1e8;

const loadOhms = (v) => (Number(v) >= OPEN ? Infinity : Math.max(0, Number(v) || 0));

function ensure(S) {
  const z0 = Math.max(1, Number(S.get('z0')) || 50);
  const zs = Math.max(0, Number(S.get('zs')) || 0);
  const zl = loadOhms(S.get('pzl'));
  const key = `${z0}|${zs}|${zl}|${S.get('pshape')}|${S.get('pwid')}`;
  let P = S.st.pulse;
  if (!P || P.key !== key) {
    P = {
      key, z0, zs, zl,
      sim: new T.LineSim({ z0, zs, zl, N: N_CELLS, td: 1 }),
      histL: new Float32Array(N_CELLS * T_MAX + 8), histS: new Float32Array(N_CELLS * T_MAX + 8), n: 0, acc: 0,
      bd: T.bounceDiagram({ z0, zs, zl, vs: 1, nBounces: 10 }),
    };
    S.st.pulse = P;
  }
  return P;
}

function vsAt(S, t) {
  if (S.get('pshape') === 'pulse') return t < Math.max(0.05, Number(S.get('pwid')) || 1) ? 1 : 0;
  return 1;
}

/** Restarts the simulation (settings changes do this automatically through the cache key). */
export function resetPulse(S) { S.st.pulse = null; }

export const pulseTab = {
  /** Advance by dt seconds of wall-clock time. */
  update(S, dt) {
    const P = ensure(S);
    const speed = clamp(Number(S.get('pspeed')) || 1, 0.1, 6);
    P.acc += speed * 0.3 * N_CELLS * dt; // 0.3 one-way delays per second at speed 1
    let steps = Math.min(60, Math.floor(P.acc));
    P.acc = Math.min(P.acc - steps, 1);
    while (steps-- > 0) {
      if (P.sim.t >= T_MAX - 1e-9) {
        if (S.get('ploop')) { P.sim.reset(); P.n = 0; } else break;
      }
      P.sim.step(vsAt(S, P.sim.t));
      if (P.n < P.histL.length) { P.histL[P.n] = P.sim.vLoad; P.histS[P.n] = P.sim.vSrc; P.n++; }
    }
  },
  /** Runs the simulation forward by `td` one-way delays instantly (used by tests and the 'skip' button). */
  advance(S, td) {
    const P = ensure(S);
    const steps = Math.round(td * N_CELLS);
    for (let i = 0; i < steps && P.sim.t < T_MAX - 1e-9; i++) {
      P.sim.step(vsAt(S, P.sim.t));
      if (P.n < P.histL.length) { P.histL[P.n] = P.sim.vLoad; P.histS[P.n] = P.sim.vSrc; P.n++; }
    }
    return P;
  },

  draw(S) {
    const { p, pal } = S;
    const P = ensure(S);
    const { sim, bd } = P;
    const left = 62, right = S.w - 22;
    const r1 = { x: left, y: 34, w: Math.max(80, right - left), h: Math.max(80, Math.round(S.h * 0.26)) };
    const r2y = r1.y + r1.h + 46;
    const rowH = Math.max(100, Math.round(S.h * 0.3));
    const latW = Math.max(100, Math.round(r1.w * 0.36));
    const lat = { x: left, y: r2y, w: latW, h: rowH };
    const tim = { x: left + latW + 62, y: r2y, w: Math.max(80, right - (left + latW + 62)), h: rowH };

    // ---- voltage along the line ----
    let vm = 1.2;
    const xs = new Float64Array(N_CELLS), tot = new Float64Array(N_CELLS), fw = new Float64Array(N_CELLS), bw = new Float64Array(N_CELLS);
    for (let i = 0; i < N_CELLS; i++) {
      xs[i] = (i + 0.5) / N_CELLS; fw[i] = sim.f[i]; bw[i] = sim.b[i]; tot[i] = fw[i] + bw[i];
      vm = Math.max(vm, Math.abs(tot[i]) * 1.08, Math.abs(fw[i]) * 1.08, Math.abs(bw[i]) * 1.08);
    }
    for (const e of bd.events) vm = Math.max(vm, Math.abs(e.voltage) * 1.08);
    vm = Math.min(12, Math.ceil(vm * 5) / 5);
    const f1 = plotFrame(p, pal, r1, {
      xmin: 0, xmax: 1, ymin: -vm, ymax: vm, title: `voltage along the line at t = ${fmt(sim.t, 3)} T  (T = one-way delay)`, xlabel: 'position x / length   (source at 0, load at 1)', ylabel: 'v (V)',
    });
    clipped(p, r1, () => {
      p.strokeWeight(1.5);
      p.stroke(COLORS.blue); polyline(p, xs, fw, f1.X, f1.Y);
      p.stroke(COLORS.orange); polyline(p, xs, bw, f1.X, f1.Y);
      p.stroke(pal.fg); p.strokeWeight(2.5); polyline(p, xs, tot, f1.X, f1.Y);
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.blue); p.text('forward wave', r1.x + 6, r1.y + 4);
    p.fill(COLORS.orange); p.text('backward wave', r1.x + 80, r1.y + 4);
    p.fill(pal.fg); p.text('total', r1.x + 160, r1.y + 4);
    p.fill(pal.muted); p.textAlign(p.LEFT, p.BOTTOM);
    p.text(`Zs = ${fmt(P.zs)} Ω, Γs = ${fmt(bd.gs, 3)}`, r1.x + 4, r1.y + r1.h - 4);
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.text(`ZL = ${Number.isFinite(P.zl) ? `${fmt(P.zl)} Ω` : 'open'}, ΓL = ${fmt(bd.gl, 3)}`, r1.x + r1.w - 4, r1.y + r1.h - 4);

    // ---- lattice diagram ----
    const tmax = 8;
    const f2 = plotFrame(p, pal, lat, {
      xmin: 0, xmax: 1, ymin: tmax, ymax: 0, title: 'lattice (bounce) diagram, unit-step source', xlabel: 'x (source 0 → load 1)', ylabel: 't / T',
      xticks: [0, 0.5, 1], yticks: [0, 2, 4, 6, 8],
    });
    clipped(p, lat, () => {
      let A = bd.v1;
      for (let k = 0; k * 2 < tmax; k++) {
        const t0 = 2 * k;
        const segs = [[0, t0, 1, t0 + 1, A], [1, t0 + 1, 0, t0 + 2, A * bd.gl]];
        for (const [xa, ta, xb, tb, amp] of segs) {
          const mag = clamp(Math.abs(amp) / Math.max(0.2, Math.abs(bd.v1)), 0, 1.5);
          if (Math.abs(amp) < 1e-4) continue;
          p.stroke(amp >= 0 ? COLORS.blue : COLORS.orange);
          p.strokeWeight(0.8 + 2.2 * Math.min(1, mag));
          p.line(f2.X(xa), f2.Y(ta), f2.X(xb), f2.Y(tb));
          if (Math.abs(amp) >= 0.004 && ta < tmax) {
            p.noStroke(); p.fill(pal.fg); p.textSize(10);
            p.textAlign(xa < xb ? p.RIGHT : p.LEFT, p.BOTTOM);
            p.text(fmt(amp, 3), f2.X((xa + xb) / 2) + (xa < xb ? -3 : 3), f2.Y((ta + tb) / 2) - 2);
          }
        }
        A = A * bd.gl * bd.gs;
      }
      p.stroke(COLORS.green); p.strokeWeight(1);
      p.line(lat.x, f2.Y(sim.t), lat.x + lat.w, f2.Y(sim.t));
    });

    // ---- load and source voltages vs time ----
    let ym = Math.max(1.2, Math.abs(bd.steady) * 1.2);
    for (const e of bd.events) ym = Math.max(ym, Math.abs(e.voltage) * 1.1);
    ym = Math.min(12, Math.ceil(ym * 5) / 5);
    const f3 = plotFrame(p, pal, tim, {
      xmin: 0, xmax: T_MAX, ymin: -0.5 * ym, ymax: ym,
      title: 'voltage at the load and at the source terminals', xlabel: 't / T', ylabel: 'v (V)',
    });
    const tt = new Float64Array(P.n), vl = new Float64Array(P.n), vs = new Float64Array(P.n);
    for (let i = 0; i < P.n; i++) { tt[i] = ((i + 1) / N_CELLS); vl[i] = P.histL[i]; vs[i] = P.histS[i]; }
    clipped(p, tim, () => {
      p.stroke(pal.muted); p.strokeWeight(1);
      if (S.get('pshape') !== 'pulse') p.line(tim.x, f3.Y(bd.steady), tim.x + tim.w, f3.Y(bd.steady));
      p.strokeWeight(2);
      p.stroke(COLORS.pink); polyline(p, tt, vl, f3.X, f3.Y, Math.max(1, Math.floor(P.n / 800)));
      p.stroke(COLORS.blue); polyline(p, tt, vs, f3.X, f3.Y, Math.max(1, Math.floor(P.n / 800)));
    });
    p.noStroke(); p.textSize(10); p.textAlign(p.LEFT, p.TOP);
    p.fill(COLORS.pink); p.text('v at load', tim.x + 6, tim.y + 4);
    p.fill(COLORS.blue); p.text('v at source end', tim.x + 64, tim.y + 4);
    p.fill(pal.muted); p.text('steady state', tim.x + 150, tim.y + 4);

    // ---- text ----
    const eLine = sim.lineEnergy();
    const res = sim.energyResidual();
    const ring = Number.isFinite(P.zl) && (bd.gl * bd.gs < 0) ? 'alternating signs: ringing about the final value' : bd.gl * bd.gs > 0 && Math.abs(bd.gl * bd.gs) > 0.05 ? 'same signs: stair-case approach to the final value' : '';
    textBlock(p, pal, [
      `V1 = Vs Z0/(Z0+Zs) = ${fmt(bd.v1, 4)} V launched;  at the load v = V1 (1 + ΓL) = ${fmt(bd.v1 * (1 + bd.gl), 4)} V after one delay;  final value Vs ZL/(ZL+Zs) = ${fmt(bd.steady, 4)} V`,
      `energy (V² T/Ω):  from source ${fmt(sim.eSource, 5)}  =  in line ${fmt(eLine, 5)} + dissipated in ZL ${fmt(sim.eLoad, 5)} + in Zs ${fmt(sim.eZs, 5)}    residual ${res < 1e-12 ? '< 1e-12' : res.toExponential(1)}  (exact: waves shift one cell per step)`,
      ring ? `ΓL Γs = ${fmt(bd.gl * bd.gs, 3)}: ${ring}` : `ΓL Γs = ${fmt(bd.gl * bd.gs, 3)}`,
    ], left, tim.y + tim.h + 44, S.w - left - 10, 15);
    S.st.pulseInfo = { energyResidual: res, t: sim.t };
  },
};
