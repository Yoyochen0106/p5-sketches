// Test-only mesh generators (independent of any marching-cubes code).
// Mesh format: { positions: Float32Array xyz, normals: Float32Array xyz, indices: Uint32Array, triangleCount }.

/** UV sphere with outward winding; ~2*nu*(nv-1) triangles. */
export function uvSphere(radius = 1, nu = 32, nv = 16, center = [0, 0, 0]) {
  const pos = [], nor = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    const th = (j / nv) * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const ph = (i / nu) * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      nor.push(...n);
      pos.push(center[0] + radius * n[0], center[1] + radius * n[1], center[2] + radius * n[2]);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      if (j > 0) idx.push(a, c, b);
      if (j < nv - 1) idx.push(b, c, d);
    }
  }
  return pack(pos, nor, idx);
}

/** Torus around the z axis. */
export function torus(R = 1, r = 0.35, nu = 48, nv = 24) {
  const pos = [], nor = [], idx = [];
  for (let j = 0; j < nv; j++) {
    const v = (j / nv) * Math.PI * 2;
    for (let i = 0; i < nu; i++) {
      const u = (i / nu) * Math.PI * 2;
      const n = [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
      nor.push(...n);
      pos.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * nu + i, b = j * nu + ((i + 1) % nu);
      const c = ((j + 1) % nv) * nu + i, d = ((j + 1) % nv) * nu + ((i + 1) % nu);
      idx.push(a, b, c, b, d, c);
    }
  }
  return pack(pos, nor, idx);
}

/** Axis-aligned cube [min, max]^3 with 8 shared vertices and outward winding (12 triangles). */
export function cube(min = -1, max = 1) {
  const pos = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? max : min, i & 2 ? max : min, i & 4 ? max : min);
  // quads counter-clockwise seen from outside
  const quads = [
    [0, 4, 6, 2], // -x
    [1, 3, 7, 5], // +x
    [0, 1, 5, 4], // -y
    [2, 6, 7, 3], // +y
    [0, 2, 3, 1], // -z
    [4, 5, 7, 6], // +z
  ];
  const idx = [];
  for (const [a, b, c, d] of quads) idx.push(a, b, c, a, c, d);
  return pack(pos, null, idx);
}

export function triangleMesh(...pts) {
  const pos = [], idx = [];
  pts.forEach((p, i) => { pos.push(...p); idx.push(i); });
  return pack(pos, null, idx);
}

function pack(pos, nor, idx) {
  return {
    positions: Float32Array.from(pos),
    normals: nor ? Float32Array.from(nor) : undefined,
    indices: Uint32Array.from(idx),
    triangleCount: idx.length / 3,
  };
}
