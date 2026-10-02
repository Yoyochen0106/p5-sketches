import test from 'node:test';
import assert from 'node:assert/strict';
import * as es from '../../lib/em/electrostatics.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);

test('point charge: Coulomb field and potential in both laws', () => {
  const c = [{ x: 0, y: 0, q: 2 }];
  const e3 = es.fieldAt(c, 3, 0, '3d');
  close(e3[0], 2 / (4 * Math.PI * 9), 1e-12);
  const e2 = es.fieldAt(c, 3, 0, '2d');
  close(e2[0], 2 / (2 * Math.PI * 3), 1e-12);
  close(es.potentialAt(c, 4, 0, '3d'), 2 / (4 * Math.PI * 4), 1e-12);
  // E = -grad V (central difference) in both laws
  for (const law of ['3d', '2d']) {
    const cs = [{ x: 0.3, y: -0.2, q: 1 }, { x: -1, y: 0.5, q: -0.7 }];
    const h = 1e-5;
    const ex = -(es.potentialAt(cs, 1 + h, 2, law) - es.potentialAt(cs, 1 - h, 2, law)) / (2 * h);
    const ey = -(es.potentialAt(cs, 1, 2 + h, law) - es.potentialAt(cs, 1, 2 - h, law)) / (2 * h);
    const e = es.fieldAt(cs, 1, 2, law);
    close(e[0], ex, 1e-6);
    close(e[1], ey, 1e-6);
  }
});

test('Gauss: 2D-law flux equals enclosed charge for circle, rectangle and a concave polygon', () => {
  const ch = [{ x: 0.3, y: 0.1, q: 1.5 }, { x: -0.4, y: 0.2, q: -0.5 }, { x: 4, y: 0, q: 3 }];
  const c = es.circleFlux(ch, 0, 0, 1.2, '2d');
  close(c.flux, 1.0, 1e-9);
  assert.deepEqual(c.enclosedIdx, [0, 1]);
  const r = es.polygonFlux(ch, es.rectPolygon(-1, -1, 1.5, 1.3), '2d');
  close(r.flux, 1.0, 1e-6);
  const star = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: 0, y: 0.2 }, { x: -1, y: 1 }];
  const s = es.polygonFlux([{ x: 0.6, y: 0.2, q: 2 }, { x: 0, y: 0.8, q: 1 }], star, '2d');
  close(s.enclosed, 2, 0);
  close(s.flux, s.enclosed, 1e-5);
  // clockwise orientation gives the same outward flux
  const cw = es.rectPolygon(-1, -1, 1.5, 1.3).reverse();
  close(es.polygonFlux(ch, cw, '2d').flux, 1.0, 1e-6);
  // a charge outside contributes nothing
  close(es.circleFlux([{ x: 5, y: 0, q: 4 }], 0, 0, 1, '2d').flux, 0, 1e-9);
  // 3D-slice law: a closed CURVE flux is NOT Q (documented) - point charge at the centre of a circle R: q/(2 eps0 R)
  close(es.circleFlux([{ x: 0, y: 0, q: 1 }], 0, 0, 2, '3d').flux, 1 / (2 * 2), 1e-9);
});

test('boundary samples integrate to the polygon flux', () => {
  const ch = [{ x: 0.1, y: 0, q: 1 }, { x: 0.5, y: 0.4, q: -0.3 }];
  const poly = es.circlePolygon(0, 0, 1, 200);
  const s = es.boundarySamples(ch, poly, 200, '2d');
  const perim = 2 * Math.PI;
  const sum = s.reduce((a, b) => a + b.En, 0) * perim / s.length;
  close(sum, 0.7, 2e-3);
});

test('field line from a charge in a dipole ends on the opposite charge; line count proportional to |q|', () => {
  const ch = [{ x: -1, y: 0, q: 2 }, { x: 1, y: 0, q: -2 }];
  const t = es.traceFieldLine(ch, -0.9, 0.0, 1, { law: '3d', bounds: { xmin: -8, xmax: 8, ymin: -6, ymax: 6 }, skip: 0 });
  assert.equal(t.end, 'charge');
  assert.equal(t.endCharge, 1);
  const seeds = es.fieldLineSeeds([{ x: 0, y: 0, q: 1 }, { x: 3, y: 0, q: -4 }], 8);
  const n0 = seeds.filter((s) => s.charge === 0).length, n1 = seeds.filter((s) => s.charge === 1).length;
  assert.equal(n1, 4 * n0);
  assert.ok(seeds.filter((s) => s.charge === 1).every((s) => s.dir === -1));
  // unequal charges: some lines escape to infinity
  const ch2 = [{ x: -1, y: 0, q: 3 }, { x: 1, y: 0, q: -1 }];
  const lines = es.traceAll(ch2, { law: '3d', perUnit: 6, bounds: { xmin: -9, xmax: 9, ymin: -7, ymax: 7 } });
  assert.ok(lines.some((l) => l.end === 'bounds'));
  assert.ok(lines.some((l) => l.end === 'charge'));
});

test('system energy, dipole moment and far field', () => {
  const ch = [{ x: -0.5, y: 0, q: 1 }, { x: 0.5, y: 0, q: -1 }];
  close(es.systemEnergy(ch, '3d'), -1 / (4 * Math.PI), 1e-12);
  const d = es.dipoleMoment(ch);
  close(d.px, -1, 1e-12);
  close(d.Q, 0, 1e-12);
  // far field: exact V approaches dipole formula
  const ff = es.farFieldPotential(ch, 30, 12, '3d');
  const exact = es.potentialAt(ch, 30, 12, '3d');
  close(ff.total, exact, 2e-3 * Math.abs(exact) + 1e-12);
  assert.ok(Math.abs(ff.mono) < 1e-12);
});

test('test particle: RK4 conserves energy and reproduces circular orbit of an attractive 2D line charge', () => {
  const ch = [{ x: 0, y: 0, q: -5 }];
  // 3D law circular orbit: m v^2 / r = |q qt| / (4 pi r^2)
  const qt = 1, m = 1, r = 1;
  const v = Math.sqrt(5 / (4 * Math.PI * r));
  let s = [r, 0, 0, v];
  const e0 = es.particleEnergy(s, ch, qt, m, '3d', 0);
  const dt = 0.01;
  let maxR = 0, minR = 9;
  for (let i = 0; i < 2000; i++) {
    s = es.stepParticle(s, ch, qt, m, dt, '3d', 0);
    const rr = Math.hypot(s[0], s[1]);
    maxR = Math.max(maxR, rr);
    minR = Math.min(minR, rr);
  }
  close(es.particleEnergy(s, ch, qt, m, '3d', 0), e0, 1e-6);
  assert.ok(maxR - minR < 1e-4, `orbit radius drift ${maxR - minR}`);
});

test('equipotential levels: anchored at zero and log spaced', () => {
  const ch = [{ x: -1, y: 0, q: 1 }, { x: 1, y: 0, q: -1 }];
  const g = es.fieldGrid(ch, { xmin: -4, xmax: 4, ymin: -3, ymax: 3 }, 40, 30, '3d');
  const lin = es.equipotentialLevels(g.v, 12, false);
  assert.ok(lin.length >= 6 && lin.includes(0));
  const lg = es.equipotentialLevels(g.v, 12, true);
  assert.ok(lg.includes(0));
  const pos = lg.filter((x) => x > 0);
  assert.ok(Math.abs(pos[2] / pos[1] - pos[1] / pos[0]) < 1e-6 * pos[1] / pos[0]);
});

test('continuous distributions: ring list quadrature vs closed forms', () => {
  const Q = 2;
  for (const [kind, size, zs] of [['ring', 1, [0.5, 1, 3]], ['disk', 1, [0.3, 1, 4]], ['rod', 2, [1.5, 3, 6]], ['ball', 1, [0.5, 1.5, 4]], ['gauss', 0.5, [0.4, 1.5, 4]]]) {
    const rings = es.makeRings(kind, { Q, size, n: 120 });
    close(es.ringsCharge(rings), Q, 1e-12);
    for (const z of zs) {
      const num = es.ringsAxisField(rings, z);
      const ana = es.analyticAxisField(kind, { Q, size }, z);
      close(num, ana, kind === 'gauss' || kind === 'ball' ? 2e-2 : 6e-3, `${kind} z=${z}`);
      // azimuthal integration agrees with the exact axis quadrature on the axis
      const full = es.ringsFieldAt(rings, 0, z);
      close(full.Ez, num, 1e-9, `${kind} full`);
    }
  }
  // radial profiles
  for (const [kind, size, xs] of [['rod', 2, [0.5, 2]], ['ball', 1, [0.5, 2]], ['gauss', 0.5, [0.3, 2]]]) {
    const rings = es.makeRings(kind, { Q, size, n: 150 });
    for (const x of xs) {
      close(es.ringsFieldAt(rings, x, 0, 32).Ex, es.analyticRadialField(kind, { Q, size }, x), 3e-2, `${kind} x=${x}`);
    }
  }
  // far field is monopole
  const rings = es.makeRings('disk', { Q, size: 1 });
  close(es.ringsFieldAt(rings, 30, 0).Ex, es.monopoleField(Q, 30), 1e-3);
  assert.ok(Math.abs(es.erf(0.5) - 0.5204998778) < 2e-7);
});

test('charges text round trip and presets', () => {
  for (const p of es.CHARGE_PRESETS) {
    const c = p.make();
    assert.ok(c.length >= 2);
    assert.deepEqual(es.parseCharges(es.formatCharges(c)).length, c.length);
  }
  assert.deepEqual(es.parseCharges('1,2,3;bad;4,5'), [{ x: 1, y: 2, q: 3 }]);
});
