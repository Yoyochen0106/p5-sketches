// Software 3D renderer: pure math, no p5 / DOM.
//
// Conventions
//   * Right-handed world, Z is up. Orbit camera: yaw rotates about Z, pitch is elevation (clamped).
//   * eye = target + distance * (cos(pitch)cos(yaw), cos(pitch)sin(yaw), sin(pitch)).
//   * Viewport: { x, y, w, h } in pixels, y grows downwards (screen space).
//   * "depth" is the distance along the viewing direction (positive in front of the camera).
//   * Bounds: { min: [x,y,z], max: [x,y,z] }.
//   * Segment lists ("edges3d") are Float32Array with 6 numbers per segment: x0 y0 z0 x1 y1 z1.

// ---------------------------------------------------------------------------------------------
// vec3 helpers (plain arrays)

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
/** Unit vector; the zero (or non-finite) vector maps to [0,0,0] instead of NaN. */
export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

const MAX_PITCH = Math.PI / 2 - 0.01;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// ---------------------------------------------------------------------------------------------
// Camera

export class OrbitCamera {
  constructor(opts = {}) {
    this.yaw = finite(opts.yaw, 0.8);
    this.pitch = clamp(finite(opts.pitch, 0.5), -MAX_PITCH, MAX_PITCH);
    this.distance = finite(opts.distance, 5);
    this.target = opts.target ? [opts.target[0], opts.target[1], opts.target[2]] : [0, 0, 0];
    this.fov = finite(opts.fov, Math.PI / 4); // vertical field of view, radians
    this.orthographic = !!opts.orthographic;
    this.near = finite(opts.near, 0.02);
    this.minDistance = finite(opts.minDistance, 1e-3);
    this.maxDistance = finite(opts.maxDistance, 1e6);
    this.home = null;
    this.saveHome();
  }

  /** Remembers the current pose as the one `reset()` returns to. */
  saveHome() {
    this.home = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: this.target.slice() };
  }

  reset() {
    const h = this.home;
    this.yaw = h.yaw; this.pitch = h.pitch; this.distance = h.distance; this.target = h.target.slice();
  }

  clone() {
    const c = new OrbitCamera(this);
    c.home = { ...this.home, target: this.home.target.slice() };
    return c;
  }

  /** Orthonormal camera frame { eye, right, up, fwd } (world space). */
  frame() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const fwd = [-cp * cy, -cp * sy, -sp];
    const right = [-sy, cy, 0];
    const up = cross(right, fwd);
    const d = this.distance;
    const t = this.target;
    return { eye: [t[0] - fwd[0] * d, t[1] - fwd[1] * d, t[2] - fwd[2] * d], right, up, fwd };
  }

  eye() { return this.frame().eye; }

  /** Row-major 4x4 view matrix (Float64Array(16)): view x = right, y = up, z = -depth (GL convention). */
  viewMatrix() {
    const { eye, right, up, fwd } = this.frame();
    return Float64Array.of(
      right[0], right[1], right[2], -dot(right, eye),
      up[0], up[1], up[2], -dot(up, eye),
      -fwd[0], -fwd[1], -fwd[2], dot(fwd, eye),
      0, 0, 0, 1,
    );
  }

  /** Pixels per view-space unit at depth 1 (perspective) / at any depth (orthographic). */
  pixelScale(viewport) {
    const th = Math.tan(this.fov / 2);
    return this.orthographic ? viewport.h / 2 / (this.distance * th) : viewport.h / 2 / th;
  }

  /** Smallest depth that is drawn. Orthographic cameras draw everything. */
  nearLimit() { return this.orthographic ? -Infinity : this.near; }

  /** Projects a world point. visible = in front of the camera and finite (it may still be off-screen). */
  project(point, viewport) {
    const { eye, right, up, fwd } = this.frame();
    return projectWith(this, eye, right, up, fwd, point, viewport);
  }

  rotate(dyaw, dpitch) {
    this.yaw += finite(dyaw, 0);
    this.pitch = clamp(this.pitch + finite(dpitch, 0), -MAX_PITCH, MAX_PITCH);
    // keep yaw bounded so long sessions do not lose precision
    if (Math.abs(this.yaw) > 1e4) this.yaw %= Math.PI * 2;
  }

  /** Multiplies the distance by `factor` (<1 zooms in), within [minDistance, maxDistance]. */
  zoom(factor) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  /** Drags the scene by (dx, dy) screen pixels (the target moves opposite to the drag). */
  pan(dx, dy, viewport) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const { right, up } = this.frame();
    const wpp = (2 * this.distance * Math.tan(this.fov / 2)) / Math.max(1, viewport.h);
    for (let i = 0; i < 3; i++) this.target[i] += (-dx * right[i] + dy * up[i]) * wpp;
  }

  /** Centres the target on the bounds and sets the distance so the bounding sphere fits. */
  fitToBounds(bounds, margin = 1.1) {
    const { min, max } = bounds;
    this.target = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const r = Math.max(1e-9, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
    this.distance = clamp((r / Math.sin(this.fov / 2)) * margin, this.minDistance, this.maxDistance);
    this.near = Math.max(1e-6, Math.min(this.near, this.distance * 0.01));
    this.saveHome();
  }

  /** World-space ray through pixel (px, py): { origin, dir } (dir is unit length). */
  ray(px, py, viewport) {
    const { eye, right, up, fwd } = this.frame();
    const s = this.pixelScale(viewport);
    const xr = (px - viewport.x - viewport.w / 2) / s;
    const yu = -(py - viewport.y - viewport.h / 2) / s;
    if (this.orthographic) {
      return {
        origin: [eye[0] + right[0] * xr + up[0] * yu, eye[1] + right[1] * xr + up[1] * yu, eye[2] + right[2] * xr + up[2] * yu],
        dir: fwd.slice(),
      };
    }
    return {
      origin: eye,
      dir: normalize([fwd[0] + right[0] * xr + up[0] * yu, fwd[1] + right[1] * xr + up[1] * yu, fwd[2] + right[2] * xr + up[2] * yu]),
    };
  }
}

function projectWith(cam, eye, right, up, fwd, p, vp) {
  const rx = p[0] - eye[0], ry = p[1] - eye[1], rz = p[2] - eye[2];
  const vx = rx * right[0] + ry * right[1] + rz * right[2];
  const vy = rx * up[0] + ry * up[1] + rz * up[2];
  const depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
  const s = cam.pixelScale(vp);
  const cx = vp.x + vp.w / 2, cy = vp.y + vp.h / 2;
  const k = cam.orthographic ? s : depth > 0 ? s / depth : 0;
  const x = cx + vx * k, y = cy - vy * k;
  const visible = depth > cam.nearLimit() && Number.isFinite(x) && Number.isFinite(y);
  return { x: visible ? x : NaN, y: visible ? y : NaN, depth, visible };
}

// ---------------------------------------------------------------------------------------------
// Mesh preparation

/**
 * Precomputes per-face data once. `normals` (per vertex, optional) is only used to orient the face
 * normals consistently and is kept for callers. Degenerate / non-finite / out-of-range triangles are
 * flagged in `degenerate` and are never drawn or picked.
 * @returns {{positions, normals, indices, vertexCount, triangleCount, faceNormals, centroids, degenerate, bounds}}
 */
export function prepareMesh({ positions, normals = null, indices }) {
  const vertexCount = Math.floor(positions.length / 3);
  const T = Math.floor(indices.length / 3);
  const faceNormals = new Float32Array(T * 3);
  const centroids = new Float32Array(T * 3);
  const degenerate = new Uint8Array(T);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i * 3 + k];
      if (Number.isFinite(v)) { if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
  }
  if (min[0] > max[0]) { min.fill(0); max.fill(0); }
  const hasN = !!normals && normals.length >= vertexCount * 3;
  for (let t = 0; t < T; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) { degenerate[t] = 1; continue; }
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    const scaleRef = Math.max(Math.abs(ux) + Math.abs(uy) + Math.abs(uz), Math.abs(vx) + Math.abs(vy) + Math.abs(vz));
    if (!(l > 1e-12 * scaleRef * scaleRef) || !Number.isFinite(l)) { degenerate[t] = 1; continue; }
    nx /= l; ny /= l; nz /= l;
    if (hasN) {
      const sx = normals[a * 3] + normals[b * 3] + normals[c * 3];
      const sy = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1];
      const sz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2];
      if (nx * sx + ny * sy + nz * sz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    }
    faceNormals[t * 3] = nx; faceNormals[t * 3 + 1] = ny; faceNormals[t * 3 + 2] = nz;
    centroids[t * 3] = (ax + bx + cx) / 3; centroids[t * 3 + 1] = (ay + by + cy) / 3; centroids[t * 3 + 2] = (az + bz + cz) / 3;
  }
  return { positions, normals: hasN ? normals : null, indices, vertexCount, triangleCount: T, faceNormals, centroids, degenerate, bounds: { min, max } };
}

// ---------------------------------------------------------------------------------------------
// Colormaps

const STOPS = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  coolwarm: [[59, 76, 192], [141, 176, 254], [221, 221, 221], [244, 154, 123], [180, 4, 38]],
  terrain: [[38, 70, 150], [60, 150, 170], [110, 180, 90], [200, 190, 110], [240, 240, 240]],
};
const lutCache = new Map();

/** 256-entry RGB lookup table (Uint8Array(768)) for a named colormap ('viridis', 'coolwarm', 'terrain'). */
export function colormapLUT(name = 'viridis') {
  const key = STOPS[name] ? name : 'viridis';
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Uint8Array(256 * 3);
    const st = STOPS[key];
    for (let i = 0; i < 256; i++) {
      const f = (i / 255) * (st.length - 1);
      const j = Math.min(st.length - 2, Math.floor(f));
      const u = f - j;
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(st[j][k] * (1 - u) + st[j + 1][k] * u);
    }
    lutCache.set(key, lut);
  }
  return lut;
}

// ---------------------------------------------------------------------------------------------
// Shading -> draw list

const IDX_BITS = 2097152; // 2^21 items fit in the packed sort key

/**
 * Creates (or recycles) a draw list. Fields (first `count` entries are valid):
 *   xy[6*i]      screen coordinates of item i's three corners
 *   rgb[3*i]     lit colour, 0..255
 *   tri[i]       index of the source triangle in the prepared mesh
 *   depth[i]     mean view depth
 *   order[k]     item indices sorted far -> near: draw k = 0..count-1 in sequence
 *   vsx, vsy     per-vertex screen position (NaN when behind the camera), vcount entries
 */
export function createDrawList() {
  return {
    count: 0, vcount: 0, xy: new Float32Array(0), rgb: new Uint8Array(0), tri: new Uint32Array(0),
    depth: new Float32Array(0), order: new Uint32Array(0), keys: new Float64Array(0),
    view: new Float32Array(0), vsx: new Float32Array(0), vsy: new Float32Array(0),
    decimated: false, stride: 1, culled: 0, clipped: 0, _sig: null, _prepared: null, rebuilds: 0,
  };
}

function ensure(list, items, verts) {
  if (list.xy.length < items * 6) {
    const cap = Math.max(items, Math.ceil(list.xy.length / 6 * 1.5));
    list.xy = new Float32Array(cap * 6); list.rgb = new Uint8Array(cap * 3);
    list.tri = new Uint32Array(cap); list.depth = new Float32Array(cap);
    list.order = new Uint32Array(cap); list.keys = new Float64Array(cap);
  }
  if (list.vsx.length < verts) {
    list.view = new Float32Array(verts * 3); list.vsx = new Float32Array(verts); list.vsy = new Float32Array(verts);
  }
}

const DEFAULT_LIGHT = [-0.35, 0.5, 0.8]; // camera space: x right, y up, z toward the viewer

function signatureOf(prepared, cam, vp, o) {
  return [
    prepared, cam.yaw, cam.pitch, cam.distance, cam.target[0], cam.target[1], cam.target[2], cam.fov,
    cam.orthographic, cam.near, vp.x, vp.y, vp.w, vp.h, !!o.cull, !!o.twoSided, o.maxTriangles || 0,
    o.colorFn, o.colorBy, o.colormap, o.baseColor && o.baseColor.join(), o.zRange && o.zRange.join(),
    o.lightSpace, o.lightDir && o.lightDir.join(), o.ambient, o.diffuse, o.specular, o.shininess, o.revision,
  ];
}

function sameSig(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Transforms, culls, lights and depth-sorts a prepared mesh into a draw list (painter's algorithm).
 * Triangles crossing the near plane are clipped; triangles entirely behind it are dropped.
 *
 * opts:
 *   out          draw list from a previous call: its arrays are reused and, when nothing relevant
 *                changed (see `signatureOf`), the call returns it untouched (cached).
 *   cull         drop back faces (default false)
 *   twoSided     flip the normal of back faces for lighting (default true)
 *   maxTriangles decimate to roughly this many triangles by uniform stride (default: no limit)
 *   colorFn(tri, prepared, out3) -> optionally writes out3[0..2] (0..255) or returns [r,g,b]
 *   colorBy      'height' (default, z over zRange or the mesh bounds) | 'normal' | 'solid'
 *   colormap     colormap name for 'height' (default 'viridis')
 *   baseColor    [r,g,b] for 'solid' (default [150,180,220])
 *   lightDir     direction towards the light; camera space by default (lightSpace: 'world' to change)
 *   ambient 0.35, diffuse 0.65, specular 0.25, shininess 24
 *   revision     any value; change it to force a rebuild when colorFn's behaviour changed
 */
export function shadeMesh(prepared, camera, viewport, opts = {}) {
  const list = opts.out || createDrawList();
  const sig = signatureOf(prepared, camera, viewport, opts);
  if (opts.out && sameSig(list._sig, sig)) return list;
  list._sig = sig; list._prepared = prepared; list.rebuilds++;

  const T = prepared.triangleCount, V = prepared.vertexCount;
  const maxT = opts.maxTriangles > 0 ? Math.floor(opts.maxTriangles) : Infinity;
  const stride = T > maxT ? T / maxT : 1;
  const nIter = stride > 1 ? Math.min(T, Math.floor(T / stride)) : T;
  ensure(list, nIter * 2, V);
  list.decimated = stride > 1; list.stride = stride; list.vcount = V; list.culled = 0; list.clipped = 0;

  const { eye, right, up, fwd } = camera.frame();
  const ortho = camera.orthographic;
  const near = camera.nearLimit();
  const s = camera.pixelScale(viewport);
  const cx = viewport.x + viewport.w / 2, cy = viewport.y + viewport.h / 2;
  const vx0 = viewport.x, vx1 = viewport.x + viewport.w, vy0 = viewport.y, vy1 = viewport.y + viewport.h;
  const P = prepared.positions, I = prepared.indices, FN = prepared.faceNormals, C = prepared.centroids;
  const view = list.view, vsx = list.vsx, vsy = list.vsy;

  // vertices -> view space + screen
  for (let i = 0; i < V; i++) {
    const rx = P[i * 3] - eye[0], ry = P[i * 3 + 1] - eye[1], rz = P[i * 3 + 2] - eye[2];
    const x = rx * right[0] + ry * right[1] + rz * right[2];
    const y = rx * up[0] + ry * up[1] + rz * up[2];
    const z = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    view[i * 3] = x; view[i * 3 + 1] = y; view[i * 3 + 2] = z;
    if (ortho) { vsx[i] = cx + x * s; vsy[i] = cy - y * s; }
    else if (z > near) { vsx[i] = cx + (x * s) / z; vsy[i] = cy - (y * s) / z; }
    else { vsx[i] = NaN; vsy[i] = NaN; }
  }

  // lighting setup (world-space direction towards the light)
  const ld = opts.lightDir || DEFAULT_LIGHT;
  let L;
  if (opts.lightSpace === 'world') L = normalize(ld);
  else L = normalize([
    right[0] * ld[0] + up[0] * ld[1] - fwd[0] * ld[2],
    right[1] * ld[0] + up[1] * ld[1] - fwd[1] * ld[2],
    right[2] * ld[0] + up[2] * ld[1] - fwd[2] * ld[2],
  ]);
  const ambient = opts.ambient ?? 0.35, diffuse = opts.diffuse ?? 0.65;
  const specK = opts.specular ?? 0.25, shin = opts.shininess ?? 24;
  const cull = !!opts.cull, twoSided = opts.twoSided !== false;
  const colorBy = opts.colorBy || 'height';
  const lut = colormapLUT(opts.colormap);
  const base = opts.baseColor || [150, 180, 220];
  const zr = opts.zRange || [prepared.bounds.min[2], prepared.bounds.max[2]];
  const zInv = zr[1] > zr[0] ? 1 / (zr[1] - zr[0]) : 0;
  const colorFn = opts.colorFn;
  const col = [0, 0, 0];
  const colOut = new Float64Array(3);
  const poly = new Float64Array(24), tmp = new Float64Array(24); // up to 4 (x,y,z) points + slack

  let n = 0;
  let dmin = Infinity, dmax = -Infinity;
  const xy = list.xy, rgb = list.rgb, triArr = list.tri, depthArr = list.depth;

  for (let k = 0; k < nIter; k++) {
    const t = stride > 1 ? Math.floor(k * stride) : k;
    if (prepared.degenerate[t]) continue;
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const za = view[a * 3 + 2], zb = view[b * 3 + 2], zc = view[c * 3 + 2];
    const inA = za > near, inB = zb > near, inC = zc > near;
    if (!inA && !inB && !inC) continue;

    // facing
    let nx = FN[t * 3], ny = FN[t * 3 + 1], nz = FN[t * 3 + 2];
    const px = C[t * 3], py = C[t * 3 + 1], pz = C[t * 3 + 2];
    let vwx, vwy, vwz; // unit vector towards the viewer
    if (ortho) { vwx = -fwd[0]; vwy = -fwd[1]; vwz = -fwd[2]; }
    else {
      vwx = eye[0] - px; vwy = eye[1] - py; vwz = eye[2] - pz;
      const l = Math.hypot(vwx, vwy, vwz) || 1;
      vwx /= l; vwy /= l; vwz /= l;
    }
    const facing = nx * vwx + ny * vwy + nz * vwz;
    if (cull && facing < 0) { list.culled++; continue; }

    const full = inA && inB && inC;
    let m = 3; // number of polygon points (3 or 4 after clipping)
    let depthSum;
    if (full) {
      const sa = vsx[a], sb = vsx[b], sc = vsx[c], ta = vsy[a], tb = vsy[b], tc = vsy[c];
      if ((sa < vx0 && sb < vx0 && sc < vx0) || (sa > vx1 && sb > vx1 && sc > vx1) ||
          (ta < vy0 && tb < vy0 && tc < vy0) || (ta > vy1 && tb > vy1 && tc > vy1)) continue;
      if (!(Number.isFinite(sa + sb + sc + ta + tb + tc))) continue;
      depthSum = za + zb + zc;
    } else {
      // Sutherland-Hodgman against depth = near (view space)
      list.clipped++;
      const vi = [a, b, c];
      let cnt = 0;
      for (let e = 0; e < 3; e++) {
        const i0 = vi[e], i1 = vi[(e + 1) % 3];
        const z0 = view[i0 * 3 + 2], z1 = view[i1 * 3 + 2];
        const in0 = z0 > near, in1 = z1 > near;
        if (in0) { tmp[cnt * 3] = view[i0 * 3]; tmp[cnt * 3 + 1] = view[i0 * 3 + 1]; tmp[cnt * 3 + 2] = z0; cnt++; }
        if (in0 !== in1) {
          const u = (near - z0) / (z1 - z0);
          tmp[cnt * 3] = view[i0 * 3] + (view[i1 * 3] - view[i0 * 3]) * u;
          tmp[cnt * 3 + 1] = view[i0 * 3 + 1] + (view[i1 * 3 + 1] - view[i0 * 3 + 1]) * u;
          tmp[cnt * 3 + 2] = near; cnt++;
        }
      }
      if (cnt < 3) continue;
      m = cnt;
      depthSum = 0;
      for (let q = 0; q < m; q++) {
        const z = Math.max(tmp[q * 3 + 2], near + 1e-9);
        poly[q * 2] = cx + (tmp[q * 3] * s) / z;
        poly[q * 2 + 1] = cy - (tmp[q * 3 + 1] * s) / z;
        depthSum += tmp[q * 3 + 2];
        if (!Number.isFinite(poly[q * 2] + poly[q * 2 + 1])) { m = 0; break; }
      }
      if (m < 3) continue;
      depthSum = (depthSum / m) * 3;
    }

    // colour
    let r, g, bl;
    let custom = false;
    if (colorFn) {
      colOut[0] = colOut[1] = colOut[2] = NaN;
      const ret = colorFn(t, prepared, colOut);
      if (ret && ret.length >= 3) { col[0] = ret[0]; col[1] = ret[1]; col[2] = ret[2]; custom = true; }
      else if (Number.isFinite(colOut[0])) { col[0] = colOut[0]; col[1] = colOut[1]; col[2] = colOut[2]; custom = true; }
    }
    if (custom) { r = col[0]; g = col[1]; bl = col[2]; }
    else if (colorBy === 'normal') { r = (nx * 0.5 + 0.5) * 255; g = (ny * 0.5 + 0.5) * 255; bl = (nz * 0.5 + 0.5) * 255; }
    else if (colorBy === 'solid') { r = base[0]; g = base[1]; bl = base[2]; }
    else {
      const u = clamp((pz - zr[0]) * zInv, 0, 1);
      const li = Math.round(u * 255) * 3;
      r = lut[li]; g = lut[li + 1]; bl = lut[li + 2];
    }

    // lighting (Lambert + ambient + Blinn-Phong)
    if (twoSided && facing < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    let spec = 0;
    if (lam > 0 && specK > 0) {
      let hx = L[0] + vwx, hy = L[1] + vwy, hz = L[2] + vwz;
      const hl = Math.hypot(hx, hy, hz);
      if (hl > 0) {
        const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
        spec = specK * Math.pow(nh, shin) * 255;
      }
    }
    const lit = ambient + diffuse * lam;
    const R = clamp(r * lit + spec, 0, 255), G = clamp(g * lit + spec, 0, 255), B = clamp(bl * lit + spec, 0, 255);

    const items = full ? 1 : m - 2;
    for (let f = 0; f < items; f++) {
      const o6 = n * 6;
      if (full) {
        xy[o6] = vsx[a]; xy[o6 + 1] = vsy[a]; xy[o6 + 2] = vsx[b]; xy[o6 + 3] = vsy[b]; xy[o6 + 4] = vsx[c]; xy[o6 + 5] = vsy[c];
      } else {
        xy[o6] = poly[0]; xy[o6 + 1] = poly[1];
        xy[o6 + 2] = poly[(f + 1) * 2]; xy[o6 + 3] = poly[(f + 1) * 2 + 1];
        xy[o6 + 4] = poly[(f + 2) * 2]; xy[o6 + 5] = poly[(f + 2) * 2 + 1];
      }
      rgb[n * 3] = R; rgb[n * 3 + 1] = G; rgb[n * 3 + 2] = B;
      triArr[n] = t;
      const d = Math.fround(depthSum / 3); // same precision as depthArr, keeps sort keys >= 0
      depthArr[n] = d;
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
      n++;
    }
  }
  list.count = n;

  // sort far -> near. Packed keys (quantised depth * 2^21 + item) sort natively as doubles.
  const order = list.order;
  if (n < IDX_BITS) {
    const keys = list.keys;
    const range = dmax - dmin;
    const inv = range > 0 ? 2147483647 / range : 0;
    for (let i = 0; i < n; i++) keys[i] = Math.max(0, Math.floor((dmax - depthArr[i]) * inv)) * IDX_BITS + i;
    keys.subarray(0, n).sort();
    for (let i = 0; i < n; i++) order[i] = keys[i] % IDX_BITS;
  } else {
    for (let i = 0; i < n; i++) order[i] = i;
    order.subarray(0, n).sort((p, q) => depthArr[q] - depthArr[p]);
  }
  return list;
}

// ---------------------------------------------------------------------------------------------
// Line geometry: bounds box, floor grid, axes gizmo, segment projection

/** The 12 edges of an axis-aligned box as a segment list (Float32Array(72)). */
export function boundsBox(bounds) {
  const { min, max } = bounds;
  const c = (i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const pairs = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const out = new Float32Array(72);
  pairs.forEach(([i, j], s) => out.set([...c(i), ...c(j)], s * 6));
  return out;
}

/** Grid lines on the plane z = `z` (default: bounds min z) covering the bounds' xy extent. */
export function gridFloor(bounds, { divisions = 10, z = bounds.min[2] } = {}) {
  const n = Math.max(1, Math.floor(divisions));
  const { min, max } = bounds;
  const out = new Float32Array((n + 1) * 2 * 6);
  let o = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = min[0] + (max[0] - min[0]) * u, y = min[1] + (max[1] - min[1]) * u;
    out.set([x, min[1], z, x, max[1], z], o); o += 6;
    out.set([min[0], y, z, max[0], y, z], o); o += 6;
  }
  return out;
}

/**
 * Orientation gizmo: three axis lines from (cx, cy) of pixel length `size`, sorted far -> near.
 * Returns [{ axis:'x'|'y'|'z', x0, y0, x1, y1, depth }]; depth > 0 means pointing away from the viewer.
 */
export function axesGizmo(camera, cx, cy, size) {
  const { right, up, fwd } = camera.frame();
  const axes = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]];
  return axes.map(([axis, a]) => ({
    axis, x0: cx, y0: cy, x1: cx + dot(a, right) * size, y1: cy - dot(a, up) * size, depth: dot(a, fwd),
  })).sort((p, q) => q.depth - p.depth);
}

/**
 * Projects a segment list into `out` (Float32Array, 4 per segment: x0 y0 x1 y1), clipping to the near
 * plane. Returns the number of visible segments written. `out` is grown when needed (returned as `.out`).
 */
export function projectSegments(edges3d, camera, viewport, outHolder = {}) {
  const S = Math.floor(edges3d.length / 6);
  if (!outHolder.out || outHolder.out.length < S * 4) outHolder.out = new Float32Array(S * 4);
  const out = outHolder.out;
  const { eye, right, up, fwd } = camera.frame();
  const s = camera.pixelScale(viewport), near = camera.nearLimit(), ortho = camera.orthographic;
  const cx = viewport.x + viewport.w / 2, cy = viewport.y + viewport.h / 2;
  let n = 0;
  const v = new Float64Array(6);
  for (let i = 0; i < S; i++) {
    for (let e = 0; e < 2; e++) {
      const rx = edges3d[i * 6 + e * 3] - eye[0], ry = edges3d[i * 6 + e * 3 + 1] - eye[1], rz = edges3d[i * 6 + e * 3 + 2] - eye[2];
      v[e * 3] = rx * right[0] + ry * right[1] + rz * right[2];
      v[e * 3 + 1] = rx * up[0] + ry * up[1] + rz * up[2];
      v[e * 3 + 2] = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    }
    const in0 = v[2] > near, in1 = v[5] > near;
    if (!in0 && !in1) continue;
    if (in0 !== in1) {
      const k = in0 ? 3 : 0; // the point behind the plane
      const o = in0 ? 0 : 3; // the point in front
      const t = (near - v[o + 2]) / (v[k + 2] - v[o + 2]);
      const x = v[o] + (v[k] - v[o]) * t, y = v[o + 1] + (v[k + 1] - v[o + 1]) * t;
      v[k] = x; v[k + 1] = y; v[k + 2] = near;
    }
    const z0 = ortho ? 1 : Math.max(v[2], 1e-9), z1 = ortho ? 1 : Math.max(v[5], 1e-9);
    const x0 = cx + (v[0] * s) / z0, y0 = cy - (v[1] * s) / z0, x1 = cx + (v[3] * s) / z1, y1 = cy - (v[4] * s) / z1;
    if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
    out[n * 4] = x0; out[n * 4 + 1] = y0; out[n * 4 + 2] = x1; out[n * 4 + 3] = y1;
    n++;
  }
  return n;
}
