import test from 'node:test';
import assert from 'node:assert/strict';
import * as ctrl from '../../lib/ctrl/index.js';
import * as tfm from '../../lib/ctrl/tf.js';
import * as routh from '../../lib/ctrl/routh.js';
import * as ssm from '../../lib/ctrl/ss.js';
import * as resp from '../../lib/ctrl/response.js';
import * as freq from '../../lib/ctrl/freq.js';
import * as rl from '../../lib/ctrl/rootlocus.js';
import * as pid from '../../lib/ctrl/pid.js';
import * as dz from '../../lib/ctrl/discretize.js';
import * as pl from '../../lib/ctrl/plants.js';

test('barrel exports every public name of every module without collisions', () => {
  const mods = { tfm, routh, ssm, resp, freq, rl, pid, dz, pl };
  const seen = new Map();
  for (const [mname, m] of Object.entries(mods)) {
    for (const [k, v] of Object.entries(m)) {
      assert.ok(k in ctrl, `${mname}.${k} missing from the barrel`);
      if (seen.has(k)) assert.equal(seen.get(k), v, `name collision on '${k}' between modules`);
      seen.set(k, v);
    }
  }
  assert.ok(Object.keys(ctrl).length > 150);
  for (const k of ['tf', 'parseTf', 'routhArray', 'stepInfo', 'bode', 'margins', 'rootLocus', 'simulateLoop', 'c2d', 'getPlant']) {
    assert.equal(typeof ctrl[k], 'function', k);
  }
});

test('end-to-end: one plant through every analysis tool agrees', () => {
  // L = 5/(s(s+1)(s+5)): closed loop via algebra, Routh, root locus, Nyquist and margins all tell the same story
  const L = ctrl.parseTf('5/(s(s+1)(s+5))');
  const T = ctrl.tfFeedback(L);
  assert.ok(ctrl.isStable(T));
  assert.equal(ctrl.routhArray(T.den).rhp, 0);
  const m = ctrl.margins(L);
  assert.ok(Math.abs(m.gm - ctrl.criticalGain(L)) < 1e-8);
  assert.equal(ctrl.nyquistAnalysis(L).Z, 0);
  const sp = ctrl.stepSpecs(T);
  assert.ok(sp.overshootPct > 0 && sp.settled);
  const ts = ctrl.simulateLoop({ plant: ctrl.parseTf('1/(s(s+1)(s+5))'), controller: { Kp: 5 }, Ts: 0.002, tEnd: 20, r: 1 });
  assert.ok(Math.abs(ts.y[ts.y.length - 1] - 1) < 1e-2);
  const Hd = ctrl.c2d(T, 0.05, 'zoh');
  assert.ok(ctrl.isStableZ(Hd));
});
