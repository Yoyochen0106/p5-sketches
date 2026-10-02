import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTf, polyRoots, tfPoles } from '../../lib/ctrl/tf.js';
import { rootLocus, asymptotes, realAxisSegments, breakawayPoints, imaginaryAxisCrossings, criticalGain, angleOfDeparture,
  angleOfArrival, polesAtK, gainAtPoint, gainForDamping, gainForWn, gainForRealPart, analyzeLocus } from '../../lib/ctrl/rootlocus.js';
import { close } from './helpers.js';

const L3 = parseTf('1/(s(s+1)(s+2))');

test('asymptotes of 1/(s(s+1)(s+2)): angles +-60 and 180, centroid -1', () => {
  const a = asymptotes(L3);
  assert.equal(a.count, 3);
  assert.deepEqual(a.angles.map((x) => Math.round(x)), [-60, 60, 180]);
  close(a.centroid, -1, 1e-9);
  const neg = asymptotes(L3, { negative: true });
  assert.deepEqual(neg.angles.map((x) => Math.round(x)), [-120, 0, 120]);
  assert.equal(asymptotes(parseTf('(s+1)/(s+2)')).count, 0);
});

test('real-axis segments and breakaway point of 1/(s(s+1)(s+2))', () => {
  const seg = realAxisSegments(L3);
  assert.equal(seg.length, 2);
  assert.deepEqual(seg[0], [-Infinity, -2]);
  close(seg[1][0], -1, 1e-12); close(seg[1][1], 0, 1e-12);
  const b = breakawayPoints(L3);
  assert.equal(b.length, 1);
  close(b[0].s, -1 + 1 / Math.sqrt(3), 1e-9); // -0.42265
  close(b[0].s, -0.4226, 1e-4);
  assert.equal(b[0].kind, 'breakaway');
  close(b[0].K, 2 / (3 * Math.sqrt(3)), 1e-9);
  // zeros with a break-in: (s+3)/(s(s+2)) ... break-in left of -3
  const L = parseTf('(s+4)/(s(s+2))');
  const bk = breakawayPoints(L);
  assert.ok(bk.some((p) => p.kind === 'breakaway' && p.s > -2 && p.s < 0));
  assert.ok(bk.some((p) => p.kind === 'break-in' && p.s < -4));
  // multiple pole: 1/(s+1)^2 leaves at 90 degrees from s = -1
  const mp = breakawayPoints(parseTf('1/(s+1)^2'));
  assert.equal(mp.length, 1); close(mp[0].s, -1, 1e-6);
  assert.equal(realAxisSegments(parseTf('1/(s+1)^2')).length, 0);
});

test('imaginary-axis crossing: critical gain 6 at w = sqrt(2); and the Routh result K=30, w=sqrt(5)', () => {
  const c = imaginaryAxisCrossings(L3).find((x) => x.w > 0);
  close(c.K, 6, 1e-9); close(c.w, Math.SQRT2, 1e-9);
  close(criticalGain(L3), 6, 1e-9);
  const L = parseTf('1/(s(s+1)(s+5))');
  close(criticalGain(L), 30, 1e-9);
  const poles = polesAtK(L, 30).sort((a, b) => b[0] - a[0]);
  close(poles[0][0], 0, 1e-7); close(Math.abs(poles[0][1]), Math.sqrt(5), 1e-7);
  assert.equal(criticalGain(parseTf('1/(s+1)')), Infinity);
});

test('angle of departure / arrival', () => {
  const L = parseTf('(s+2)/(s^2+2s+2)'); // poles -1 +- j, zero -2
  const d = angleOfDeparture(L, [-1, 1]);
  close(d[0], 180 - 90 + 45, 1e-9); // 135
  // zero of a pair of complex zeros: arrival angle
  const L2 = parseTf('(s^2+2s+5)/(s(s+3)(s+4))');
  const a = angleOfArrival(L2, [-1, 2]);
  // 180 + arg(z-0)+arg(z+3)+arg(z+4) - arg(z - conj z)
  const deg = (re, im) => Math.atan2(im, re) * 180 / Math.PI;
  const expected = 180 + deg(-1, 2) + deg(2, 2) + deg(3, 2) - 90;
  close(a[0], ((expected + 180) % 360 + 360) % 360 - 180, 1e-9);
  // double pole: two departure angles 180 apart
  const dd = angleOfDeparture(parseTf('1/(s+1)^2'), [-1, 0]).sort((x, y) => x - y);
  close(dd[0], -90, 1e-9); close(dd[1], 90, 1e-9);
});

test('traced branches: start at the poles, satisfy the characteristic equation, end at zeros / along asymptotes', () => {
  const L = parseTf('(s+1)/(s(s+2)(s+3))');
  const loc = rootLocus(L);
  assert.equal(loc.branches.length, 3);
  assert.ok(loc.K.length > 40 && loc.K.length < 4000);
  // every traced point is a root of D + K N
  let worst = 0;
  loc.branches.forEach((br) => br.forEach((p, i) => {
    const K = loc.K[i];
    const s = p;
    const D = L.den.reduce((acc, c) => [acc[0] * s[0] - acc[1] * s[1] + c, acc[0] * s[1] + acc[1] * s[0]], [0, 0]);
    const N = L.num.reduce((acc, c) => [acc[0] * s[0] - acc[1] * s[1] + c, acc[0] * s[1] + acc[1] * s[0]], [0, 0]);
    worst = Math.max(worst, Math.hypot(D[0] + K * N[0], D[1] + K * N[1]) / (1 + Math.hypot(...D)));
  }));
  assert.ok(worst < 1e-8, `worst residual ${worst}`);
  // starting points equal the poles
  const starts = loc.branches.map((b) => b[0]).sort((a, b) => a[0] - b[0]);
  close(starts[0][0], -3, 1e-9); close(starts[1][0], -2, 1e-9); close(starts[2][0], 0, 1e-9);
  // one branch terminates at the zero -1; the two others go to infinity along +-90 degrees (centroid -2)
  const ends = loc.branches.map((b) => b[b.length - 1]);
  assert.ok(ends.some((e) => Math.hypot(e[0] + 1, e[1]) < 1e-3));
  const far = ends.filter((e) => Math.hypot(e[0], e[1]) > 20);
  assert.equal(far.length, 2);
  for (const e of far) {
    close(Math.abs(Math.atan2(e[1], e[0])) * 180 / Math.PI, 90, 2e-2);
    close(e[0], -2, 0.02); // centroid
  }
  // continuity: no step larger than a few % of the scale
  for (const br of loc.branches) for (let i = 1; i < br.length; i++) {
    assert.ok(Math.hypot(br[i][0] - br[i - 1][0], br[i][1] - br[i - 1][1]) < 0.2 * loc.scale * 2, 'jump');
  }
});

test('locus of 1/(s(s+1)(s+2)) passes through the breakaway and imaginary-axis points', () => {
  const loc = rootLocus(L3);
  // at K = 6 a branch is at +- j sqrt(2)
  const at6 = polesAtK(L3, 6).filter((p) => Math.abs(p[0]) < 1e-6);
  assert.equal(at6.length, 2); close(Math.abs(at6[0][1]), Math.SQRT2, 1e-6);
  // some sample has K close to 6 and a root close to the axis
  let best = Infinity;
  loc.branches.forEach((br) => br.forEach((p, i) => { if (Math.abs(loc.K[i] - 6) < 0.3) best = Math.min(best, Math.abs(p[0])); }));
  assert.ok(best < 0.2);
  // two branches coincide on the real axis at the breakaway (K = 0.3849)
  const rts = polesAtK(L3, 2 / (3 * Math.sqrt(3))).filter((p) => Math.abs(p[1]) < 1e-3).sort((a, b) => b[0] - a[0]);
  close(rts[0][0], -0.42265, 1e-3);
  // negative locus runs along the complementary real-axis parts
  const neg = rootLocus(L3, { negative: true });
  assert.equal(neg.branches.length, 3);
  const e = neg.branches.map((b) => b[b.length - 1]);
  assert.ok(e.some((p) => p[0] > 20 && Math.abs(p[1]) < 1));
});

test('magnitude / angle criteria and design points', () => {
  const g = gainAtPoint(L3, [-0.4226, 0], { tolDeg: 1 });
  assert.ok(g.onLocus); close(g.K, 0.3849, 2e-3);
  assert.ok(!gainAtPoint(L3, [-3, 1]).onLocus);
  // damping ray: zeta = 0.5 -> closed-loop pole pair really has that damping
  const sols = gainForDamping(L3, 0.5);
  assert.ok(sols.length >= 1);
  const K = sols[0].K;
  const poles = polesAtK(L3, K);
  const cp = poles.find((p) => p[1] > 1e-6);
  close(-cp[0] / Math.hypot(cp[0], cp[1]), 0.5, 1e-6);
  close(K, Math.abs(gainAtPoint(L3, sols[0].s).K), 1e-9);
  // zeta = 0 crossing equals the critical gain
  close(gainForDamping(L3, 0)[0].K, 6, 1e-6);
  // vertical line Re s = -0.2 and circle |s| = 1
  const v = gainForRealPart(L3, 0.2);
  assert.ok(v.length >= 1);
  const pv = polesAtK(L3, v[0].K);
  assert.ok(pv.some((p) => Math.abs(p[0] + 0.2) < 1e-6));
  const c = gainForWn(L3, 1);
  assert.ok(c.length >= 1);
  assert.ok(polesAtK(L3, c[0].K).some((p) => Math.abs(Math.hypot(p[0], p[1]) - 1) < 1e-6));
  assert.deepEqual(gainForDamping(L3, 1.2), []);
});

test('analyzeLocus bundles the pieces', () => {
  const a = analyzeLocus(parseTf('(s+2)/(s^2+2s+2)'));
  assert.equal(a.locus.branches.length, 2);
  assert.equal(a.departures.length, 1);
  close(a.departures[0].angles[0], 135, 1e-9);
  assert.equal(a.asymptotes.count, 1);
  void tfPoles; void polyRoots;
});
