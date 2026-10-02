// Coarse software depth buffer for hidden-line tests: the 2D canvas painter has no z-buffer, so curves
// drawn on top of the mesh would show through the far side of the surface. We rasterise the mesh once per
// camera pose into a small buffer and ask it whether a 3D point is in front.

/**
 * Depth buffer of a mesh seen through an OrbitCamera.
 * @param {{positions:Float32Array, indices:Uint32Array}} mesh
 * @param {object} cam OrbitCamera
 * @param {{x:number,y:number,w:number,h:number}} rect viewport
 * @param {number} scale buffer cells per pixel (default 0.5)
 */
export class DepthBuffer {
  constructor(mesh, cam, rect, scale = 0.5) {
    this.cam = cam;
    this.rect = rect;
    this.scale = scale;
    this.w = Math.max(2, Math.ceil(rect.w * scale));
    this.h = Math.max(2, Math.ceil(rect.h * scale));
    this.z = new Float32Array(this.w * this.h).fill(-Infinity);
    this.frame = cam.frame();
    this.s = cam.pixelScale(rect);
    this.persp = !cam.orthographic;
    this._rasterise(mesh);
  }

  /** Larger value = nearer. Perspective: 1/depth (linear in screen space); orthographic: -depth / distance. */
  _zOf(depth) {
    return this.persp ? 1 / depth : -depth / this.cam.distance;
  }

  /** Writes buffer-space x, y and the depth key into out (out[2] = NaN when behind the camera). */
  _project(x, y, z, out) {
    const { eye, right, up, fwd } = this.frame;
    const rx = x - eye[0], ry = y - eye[1], rz = z - eye[2];
    const vx = rx * right[0] + ry * right[1] + rz * right[2];
    const vy = rx * up[0] + ry * up[1] + rz * up[2];
    const depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    if (this.persp && !(depth > this.cam.near)) { out[2] = NaN; return; }
    const k = this.persp ? this.s / depth : this.s;
    out[0] = (this.rect.w / 2 + vx * k) * this.scale;
    out[1] = (this.rect.h / 2 - vy * k) * this.scale;
    out[2] = this._zOf(depth);
  }

  _rasterise(mesh) {
    const P = mesh.positions, I = mesh.indices;
    const V = Math.floor(P.length / 3);
    const sx = new Float32Array(V), sy = new Float32Array(V), sz = new Float32Array(V);
    const o = [0, 0, 0];
    for (let i = 0; i < V; i++) {
      this._project(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], o);
      sx[i] = o[0]; sy[i] = o[1]; sz[i] = o[2];
    }
    const { w, h, z } = this;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      if (!(sz[a] === sz[a] && sz[b] === sz[b] && sz[c] === sz[c])) continue; // NaN: behind the camera
      const x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[c], y2 = sy[c];
      const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(det) < 1e-9) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / det;
          const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / det;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
          const zz = l0 * sz[a] + l1 * sz[b] + l2 * sz[c];
          if (zz > z[y * w + x]) z[y * w + x] = zz;
        }
      }
    }
  }

  /** Screen position and visibility of a 3D point: { x, y, visible (in front of the mesh), onScreen }. */
  test(p) {
    const o = [0, 0, 0];
    this._project(p[0], p[1], p[2], o);
    if (!(o[2] === o[2])) return { x: NaN, y: NaN, visible: false, onScreen: false };
    const cx = Math.floor(o[0]), cy = Math.floor(o[1]);
    const x = o[0] / this.scale + this.rect.x, y = o[1] / this.scale + this.rect.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: NaN, y: NaN, visible: false, onScreen: false };
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return { x, y, visible: true, onScreen: false };
    const zb = this.z[cy * this.w + cx];
    const tol = this.persp ? 0.008 * Math.abs(o[2]) : 0.012;
    return { x, y, visible: o[2] >= zb - tol, onScreen: true };
  }
}
