// Drawing for the 3D (marching cubes) mode: the mesh with helpers, slice plane, open-edge
// highlight, picked cell, and the cube-case inspector widget (own mini camera).
import { drawMesh, drawEdges, drawBoundsBox, drawAxes } from '../shared3d/draw3d.js';
import { gridFloor, boundsBox } from '../../lib/render3d.js';
import { CUBE_EDGES } from '../../lib/marching.js';
import { INSIDE, OUTSIDE, MONO, accentFor, panel } from './draw2d.js';

const RED = [255, 60, 60, 255];

function withClip(p, rect, fn) {
  p.push();
  const c = p.drawingContext;
  c.beginPath();
  c.rect(rect.x, rect.y, rect.w, rect.h);
  c.clip();
  try { fn(); } finally { p.pop(); }
}

const toBox = (b) => ({ min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] });

/** Edges (Float32Array, 6 per segment) of triangle t of a prepared mesh. */
export function triangleEdges(prepared, t) {
  const P = prepared.positions, I = prepared.indices;
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const out = new Float32Array(18);
  out.set([P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], P[c], P[c + 1], P[c + 2], P[a], P[a + 1], P[a + 2]]);
  return out;
}

/**
 * Draws the 3D scene into S.rect. S: { pal, cam, rect, prepared, drawCache, opts {render, colorBy, box, axes, floor, holes},
 *   bounds (field bounds), holeEdges, slice {on, z, edges3d}, sel {box:{min,max}, tri}|null, zRange }.
 * Returns the draw list of the mesh.
 */
export function drawScene3D(p, S) {
  const { pal, cam, rect, opts } = S;
  const acc = accentFor(pal);
  const grid = pal.dark ? [120, 130, 150, 90] : [90, 100, 120, 110];
  const box = toBox(S.bounds);
  if (opts.floor) drawEdges(p, gridFloor(box, { divisions: 10 }), cam, rect, { stroke: grid, weight: 1, cache: S.floorCache });
  if (opts.box) drawBoundsBox(p, box, cam, rect, { stroke: pal.dark ? [200, 205, 215, 170] : [60, 70, 90, 170], cache: S.boxCache });
  let list = null;
  if (S.prepared && S.prepared.triangleCount > 0) {
    list = drawMesh(p, S.prepared, cam, rect, {
      mode: opts.render, colorBy: opts.colorBy, colormap: 'viridis', cache: S.drawCache, zRange: S.zRange,
      wireColor: pal.dark ? [235, 240, 250, 110] : [20, 25, 35, 130], baseColor: [140, 180, 230], pointSize: 2,
    });
  }
  if (S.slice && S.slice.on) {
    const z = S.slice.z;
    const corners = [[box.min[0], box.min[1]], [box.max[0], box.min[1]], [box.max[0], box.max[1]], [box.min[0], box.max[1]]]
      .map(([x, y]) => cam.project([x, y, z], rect));
    if (corners.every((c) => c.visible)) {
      withClip(p, rect, () => {
        p.noStroke();
        p.fill(acc[0], acc[1], acc[2], 38);
        p.quad(corners[0].x, corners[0].y, corners[1].x, corners[1].y, corners[2].x, corners[2].y, corners[3].x, corners[3].y);
      });
    }
    if (S.slice.edges3d && S.slice.edges3d.length) drawEdges(p, S.slice.edges3d, cam, rect, { stroke: [acc[0], acc[1], acc[2], 255], weight: 2.5, cache: S.sliceCache });
  }
  if (opts.holes && S.holeEdges && S.holeEdges.length) drawEdges(p, S.holeEdges, cam, rect, { stroke: RED, weight: 3, cache: S.holeCache });
  if (S.sel) {
    if (S.sel.box) drawEdges(p, boundsBox(S.sel.box), cam, rect, { stroke: [acc[0], acc[1], acc[2], 255], weight: 2, cache: S.selCache });
    if (S.sel.tri !== undefined && S.sel.tri !== null && S.prepared && S.sel.tri < S.prepared.triangleCount) {
      drawEdges(p, triangleEdges(S.prepared, S.sel.tri), cam, rect, { stroke: [255, 255, 255, 255], weight: 2.5 });
    }
  }
  if (opts.axes) drawAxes(p, cam, rect, {});
  return list;
}

// ---------------------------------------------------------------------------------------------
// Cube case widget

/**
 * W: { rect, cam, pal, geo (cubeCaseGeometry), real (bool: uses actual cell samples), cellLabel }.
 * Draws the cube with inside/outside corners, the 12 edges, edge crossings and the case triangles.
 */
export function drawCaseWidget(p, W) {
  const { rect, cam, pal, geo } = W;
  const acc = accentFor(pal);
  panel(p, pal, rect.x, rect.y, rect.w, rect.h);
  const view = { x: rect.x, y: rect.y + 18, w: rect.w, h: rect.h - 18 - 56 };
  p.textFont(MONO);
  p.textSize(11);
  p.textAlign(p.LEFT, p.TOP);
  p.noStroke();
  p.fill(acc[0], acc[1], acc[2]);
  p.text('CUBE CASE INSPECTOR', rect.x + 8, rect.y + 6);
  const pr = geo.corners.map((c) => cam.project(c, view));
  withClip(p, view, () => {
    // edges
    p.noFill();
    CUBE_EDGES.forEach(([a, b], e) => {
      const A = pr[a], B = pr[b];
      if (!A.visible || !B.visible) return;
      const crossed = geo.edgePoints[e] !== null;
      if (crossed) { p.stroke(acc[0], acc[1], acc[2]); p.strokeWeight(2.2); } else { p.stroke(pal.axis); p.strokeWeight(1); }
      p.line(A.x, A.y, B.x, B.y);
    });
    // triangles, far to near
    const tris = geo.trianglePoints.map((tri) => {
      const q = tri.map((pt) => cam.project(pt, view));
      return { q, depth: q.reduce((s, v) => s + v.depth, 0) / 3 };
    }).filter((t) => t.q.every((v) => v.visible)).sort((a, b) => b.depth - a.depth);
    p.stroke(pal.dark ? 20 : 250, 220);
    p.strokeWeight(1);
    p.fill(120, 200, 140, 150);
    for (const t of tris) p.triangle(t.q[0].x, t.q[0].y, t.q[1].x, t.q[1].y, t.q[2].x, t.q[2].y);
    // crossing points
    p.stroke(20);
    p.fill(255, 80, 80);
    geo.edgePoints.forEach((pt) => {
      if (!pt) return;
      const q = cam.project(pt, view);
      if (q.visible) p.circle(q.x, q.y, 6);
    });
    // corners
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(10);
    pr.forEach((q, c) => {
      if (!q.visible) return;
      const col = geo.inside[c] ? INSIDE : OUTSIDE;
      p.stroke(pal.dark ? 20 : 250);
      p.strokeWeight(1);
      if (geo.inside[c]) p.fill(col[0], col[1], col[2]); else p.fill(col[0], col[1], col[2], 70);
      p.circle(q.x, q.y, 11);
      p.noStroke();
      p.fill(pal.fg);
      p.text(String(c), q.x + 10, q.y - 9);
    });
  });
  // text
  p.textAlign(p.LEFT, p.TOP);
  p.textSize(11);
  p.noStroke();
  p.fill(pal.fg);
  const y0 = rect.y + rect.h - 52;
  p.text(`case ${geo.index} = 0b${geo.binary}`, rect.x + 8, y0);
  p.text(`class ${geo.cls} of 15 base cases   ${geo.triangleCount} triangle(s)`, rect.x + 8, y0 + 14);
  p.fill(pal.muted);
  p.text(W.cellLabel, rect.x + 8, y0 + 28);
  if (geo.ambiguous) { p.fill(OUTSIDE[0], OUTSIDE[1], OUTSIDE[2]); p.text('ambiguous faces', rect.x + rect.w - 108, rect.y + 6); }
}
