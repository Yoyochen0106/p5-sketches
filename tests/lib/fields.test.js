import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS_2D, FIELDS_3D, getField, valueNoise2, valueNoise3, fbm2, fbm3, shLobe } from '../../lib/fields.js';
import { gridSample, marchingSquares, marchingCubes } from '../../lib/marching.js';
import { close } from './helpers.js';

test('catalogue shape: ids unique, required keys present', () => {
  const ids = new Set();
  for (const d of [...FIELDS_2D, ...FIELDS_3D]) {
    assert.ok(!ids.has(d.id), `duplicate ${d.id}`);
    ids.add(d.id);
    assert.equal(typeof d.label, 'string');
    assert.equal(typeof d.f, 'function');
    assert.ok(Number.isFinite(d.level));
    assert.ok(d.bounds.xmax > d.bounds.xmin && d.bounds.ymax > d.bounds.ymin);
    if (d.dim === 3) assert.ok(d.bounds.zmax > d.bounds.zmin);
    assert.ok(Array.isArray(d.levels) && d.levels.length >= 3 && d.levels.every(Number.isFinite));
  }
  for (const id of ['circle', 'metaballs2', 'metaballs4', 'saddle', 'eggcrate', 'himmelblau', 'rosenbrock', 'noise2', 'mandelbrot', 'star']) {
    assert.ok(FIELDS_2D.some((d) => d.id === id), id);
  }
  assert.ok(FIELDS_2D.filter((d) => d.id.startsWith('chladni')).length >= 3);
  for (const id of ['sphere', 'torus', 'genus2', 'metaballs3', 'gyroid', 'schwarzP', 'schwarzD', 'heart', 'barth', 'cone', 'chmutov', 'noise3', 'mandelbulb']) {
    assert.ok(FIELDS_3D.some((d) => d.id === id), id);
  }
  assert.equal(getField('sphere').dim, 3);
  assert.equal(getField('circle').dim, 2);
  assert.equal(getField('nope'), undefined);
});

test('every field is finite on a dense grid, including awkward points', () => {
  for (const d of FIELDS_2D) {
    const g = gridSample(d.f, d.bounds, 60, 60);
    assert.ok(g.values.every(Number.isFinite), d.id);
    for (const [x, y] of [[0, 0], [1e-12, -1e-12], [d.bounds.xmin, d.bounds.ymax], [1e3, -1e3]]) {
      assert.ok(Number.isFinite(d.f(x, y)), `${d.id} at ${x},${y}`);
    }
  }
  for (const d of FIELDS_3D) {
    const g = gridSample(d.f, d.bounds, 24, 24, 24);
    assert.ok(g.values.every(Number.isFinite), d.id);
    for (const p of [[0, 0, 0], [1e-12, 0, -1e-12], [0, 0, 1], [0, 0, -1], [1e3, -1e3, 5]]) {
      assert.ok(Number.isFinite(d.f(...p)), `${d.id} at ${p}`);
    }
  }
});

test('every field has a non-empty contour/surface at its default level', () => {
  for (const d of FIELDS_2D) {
    const r = marchingSquares(d.f, { bounds: d.bounds, nx: 80, ny: 80, level: d.level });
    assert.ok(r.count > 10, `${d.id}: ${r.count} segments`);
    for (const lv of d.levels) assert.ok(Number.isFinite(lv));
  }
  for (const d of FIELDS_3D) {
    const m = marchingCubes(d.f, { bounds: d.bounds, nx: 36, ny: 36, nz: 36, level: d.level, algorithm: 'tetra' });
    assert.ok(m.triangleCount > 50, `${d.id}: ${m.triangleCount} triangles`);
    assert.ok(m.positions.every(Number.isFinite) && m.normals.every(Number.isFinite), d.id);
  }
});

test('analytic spot checks', () => {
  const f2 = (id) => getField(id).f;
  close(f2('circle')(0, 0), -1);
  close(f2('circle')(1, 0), 0);
  close(f2('saddle')(2, 1), 3);
  close(f2('himmelblau')(3, 2), 0, 1e-12); // a minimum
  close(f2('himmelblau')(-2.805118, 3.131312), 0, 1e-8);
  close(f2('rosenbrock')(1, 1), 0);
  close(f2('eggcrate')(Math.PI / 2, Math.PI / 2), 1, 1e-12);
  assert.ok(f2('metaballs2')(0, 0) < 0 && f2('metaballs2')(1.9, 1.9) > 0);
  assert.ok(f2('mandelbrot')(0, 0) >= 48 - 1e-9); // inside the set: never escapes
  assert.ok(f2('mandelbrot')(1, 1) < 4);
  close(f2('star')(STAR_VERTEX[0], STAR_VERTEX[1]), 0, 1e-12);
  const c = f2('chladni23');
  close(c(0.3, -0.2), -c(-0.2, 0.3), 1e-12); // antisymmetric in x <-> y (mode (n,m) minus (m,n))
  const g = (id) => getField(id).f;
  close(g('sphere')(1, 0, 0), 0);
  close(g('torus')(1.4, 0, 0), 0, 1e-12); // R + r = 1.4
  close(g('torus')(0.6, 0, 0), 0, 1e-12);
  close(g('torus')(1, 0, 0.4), 0, 1e-12);
  close(g('schwarzP')(Math.PI / 2, Math.PI / 2, Math.PI / 2), 0, 1e-12);
  close(g('gyroid')(0, 0, 0), 0);
  close(g('chmutov')(0.5, 0.5, 0.5) , 3 * (8 / 16 - 2 + 1), 1e-12);
  close(g('heart')(0, 0, 0), -1, 1e-12);
  close(g('cone')(1, 0, 1), 0);
  assert.equal(g('mandelbulb')(0, 0, 0), 0);
  assert.ok(g('mandelbulb')(1.2, 1.2, 1.2) > 0.02);
  // Chmutov: T4 vanishes at cos(pi/8)
  close(g("chmutov")(Math.cos(Math.PI / 8), Math.cos(Math.PI / 8), 0), 1, 1e-12); // T4(cos(pi/8)) = 0
});
const STAR_VERTEX = [0, 1.5]; // top vertex of the pentagram (angle pi/2, radius 1.5)

test('value noise: deterministic, seedable, bounded, continuous', () => {
  const a = valueNoise2(3);
  const b = valueNoise2(3);
  const c = valueNoise2(4);
  let differ = 0;
  for (let i = 0; i < 50; i++) {
    const x = i * 0.37 - 5;
    const y = i * 0.11 + 2;
    assert.equal(a(x, y), b(x, y));
    if (a(x, y) !== c(x, y)) differ++;
    assert.ok(a(x, y) >= 0 && a(x, y) < 1);
    assert.ok(Math.abs(a(x + 1e-6, y) - a(x, y)) < 1e-4);
  }
  assert.ok(differ > 40);
  const n3 = valueNoise3(2);
  assert.equal(n3(0.3, 0.7, -1.2), valueNoise3(2)(0.3, 0.7, -1.2));
  assert.ok(Math.abs(n3(0.3, 0.7, -1.2 + 1e-7) - n3(0.3, 0.7, -1.2)) < 1e-5);
  for (const f of [fbm2(1), (x, y) => fbm3(1)(x, y, 0.5)]) {
    let min = Infinity; let max = -Infinity;
    for (let i = 0; i < 500; i++) { const v = f(i * 0.173, i * 0.091); min = Math.min(min, v); max = Math.max(max, v); }
    assert.ok(min >= -0.5 && max <= 0.5 && max - min > 0.2);
  }
});

test('shLobe: radius profile of |Y_l^m| is bounded by its scale and has the right zeros', () => {
  const f = shLobe(4, 2, 1.3);
  assert.equal(f(0, 0, 0), 0);
  // along the z axis Y_4^2 vanishes (m != 0) -> field = r
  close(f(0, 0, 0.7), 0.7, 1e-12);
  // equator, phi = 0: radius reaches somewhere between 0 and the scale
  let maxR = 0;
  for (let k = 0; k < 2000; k++) {
    const th = Math.acos(1 - (2 * (k + 0.5)) / 2000);
    // surface point radius: solve f(r*dir) = 0 -> r = f offset; f(dir)=1-target
    const dir = [Math.sin(th), 0, Math.cos(th)];
    maxR = Math.max(maxR, 1 - f(...dir));
  }
  close(maxR, 1.3, 2e-3, 'peak lobe radius equals scale');
});

test('isosurface meshes of catalogue fields have the expected topology (tetra)', () => {
  const chi = (m) => {
    const N = m.vertexCount;
    const e = new Set();
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = m.indices[t + k];
        const b = m.indices[t + (k + 1) % 3];
        e.add(Math.min(a, b) * N + Math.max(a, b));
      }
    }
    return m.vertexCount - e.size + m.triangleCount;
  };
  const mesh = (id, n) => {
    const d = getField(id);
    return marchingCubes(d.f, { bounds: d.bounds, nx: n, ny: n, nz: n, level: d.level + 1e-4, algorithm: 'tetra' });
  };
  assert.equal(chi(mesh('sphere', 30)), 2);
  assert.equal(chi(mesh('torus', 44)), 0);
  assert.equal(chi(mesh('genus2', 70)), -2, 'genus 2 -> Euler characteristic -2');
  const three = mesh('metaballs3', 40);
  assert.ok(three.triangleCount > 100);
  assert.equal(Math.abs(chi(mesh("sh42", 40)) % 2), 0);
});
