// Tab 3: the limit set of the plane tab on the Riemann sphere (inverse stereographic projection), rendered
// with the software 3D camera of lib/render3d.js. The points are splatted into one image with a z-buffer and
// depth shading; the generator circles and a graticule are drawn as curves on top.
import { OrbitCamera } from '../../lib/render3d.js';
import { CameraController, drawEdges } from '../shared3d/draw3d.js';
import { toSphere, circleOnSphere, isGreatCircle } from '../../lib/kleinian.js';
import { CLOUD_CAP } from './plane-tab.js';
import { ensureImage, hexToRgb, tagColors, withClip } from './view.js';

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const MAX_IMG_W = 960, MAX_IMG_H = 720;

/** Segments (6 floats each, closed polyline) of a point list of 3 floats per vertex. */
function polylineToSegments(pts, closed = false) {
    const n = Math.floor(pts.length / 3);
    const m = closed ? n : n - 1;
    const out = new Float32Array(Math.max(0, m) * 6);
    for (let i = 0; i < m; i++) {
        const j = (i + 1) % n;
        out.set([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], pts[3 * j], pts[3 * j + 1], pts[3 * j + 2]], 6 * i);
    }
    return out;
}

function buildGraticule() {
    const segs = [];
    const N = 36;
    const ring = (f) => {
        const pts = new Float64Array(3 * (N + 1));
        for (let i = 0; i <= N; i++) pts.set(f((2 * Math.PI * i) / N), 3 * i);
        segs.push(polylineToSegments(pts));
    };
    for (const lat of [-60, -30, 0, 30, 60]) {
        const z = Math.sin((lat * Math.PI) / 180), r = Math.cos((lat * Math.PI) / 180);
        ring((t) => [r * Math.cos(t), r * Math.sin(t), z]);
    }
    for (let k = 0; k < 4; k++) {
        const a = (Math.PI * k) / 4;
        ring((t) => [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)]);
    }
    const total = segs.reduce((s, q) => s + q.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const q of segs) { out.set(q, o); o += q.length; }
    return out;
}

/** Splits a segment list into the parts facing the camera (midpoint on the visible cap) and the rest. */
function splitByVisibility(segs, eye, front, back) {
    let nf = 0, nb = 0;
    const S = segs.length / 6;
    if (front.length < segs.length) front = new Float32Array(segs.length);
    if (back.length < segs.length) back = new Float32Array(segs.length);
    for (let i = 0; i < S; i++) {
        const o = 6 * i;
        const mx = segs[o] + segs[o + 3], my = segs[o + 1] + segs[o + 4], mz = segs[o + 2] + segs[o + 5];
        const vis = 0.5 * (mx * eye[0] + my * eye[1] + mz * eye[2]) > 1;
        const dst = vis ? front : back;
        const k = vis ? nf++ : nb++;
        for (let e = 0; e < 6; e++) dst[6 * k + e] = segs[o + e];
    }
    return { front: front.subarray(0, 6 * nf), back: back.subarray(0, 6 * nb), fbuf: front, bbuf: back };
}

/** Creates the sphere tab. env = { p, get, set, pal(), rect() }, plane = the plane tab (source of the points). */
export function createSphereTab(env, plane) {
    const { p, get } = env;
    const camera = new OrbitCamera({ yaw: 0.7, pitch: 0.35, distance: 3.6, minDistance: 1.5, maxDistance: 14 });
    const st = {
        camera, xyz: new Float32Array(3 * CLOUD_CAP), tag: new Uint8Array(CLOUD_CAP), count: 0, cloudVersion: -1,
        img: {}, zbuf: null, imgKey: '', graticule: buildGraticule(), bufs: { f: new Float32Array(0), b: new Float32Array(0) },
        dirty: true, drawn: 0, lastRect: null, circleCache: { key: '', list: [] }, cacheF: new Float32Array(0), cacheB: new Float32Array(0),
    };
    const rectNow = () => {
        const r = env.rect();
        return { x: r.x, y: r.y, w: Math.max(16, Math.floor(r.w)), h: Math.max(16, Math.floor(r.h)) };
    };
    const controller = new CameraController(p, camera, rectNow, { onChange: () => { st.dirty = true; } });

    function refreshPoints() {
        const c = plane.cloud;
        if (c.version === st.cloudVersion) return;
        st.cloudVersion = c.version;
        const n = c.count;
        for (let i = 0; i < n; i++) {
            const q = toSphere(c.xy[2 * i], c.xy[2 * i + 1]);
            st.xyz[3 * i] = q[0]; st.xyz[3 * i + 1] = q[1]; st.xyz[3 * i + 2] = q[2];
            st.tag[i] = c.tag[i];
        }
        st.count = n;
        st.dirty = true;
    }

    function step() {
        if (get('sp.spin') && !controller.drag) {
            const dt = Math.min(0.05, (p.deltaTime || 16.7) / 1000);
            camera.yaw += (Number(get('sp.speed')) || 0.4) * dt;
            st.dirty = true;
        }
    }

    /** Splats the points into the (transparent) image; returns the number of pixels written. */
    function rasterise(r, pal) {
        const f = Math.min(1, MAX_IMG_W / r.w, MAX_IMG_H / r.h);
        const iw = Math.max(8, Math.floor(r.w * f)), ih = Math.max(8, Math.floor(r.h * f));
        const img = ensureImage(p, st.img, iw, ih);
        if (!st.zbuf || st.zbuf.length !== iw * ih) st.zbuf = new Float32Array(iw * ih);
        img.loadPixels();
        const px = img.pixels;
        const u32 = new Uint32Array(px.buffer, px.byteOffset, iw * ih);
        u32.fill(0);
        const z = st.zbuf;
        z.fill(Infinity);
        const { eye, right, up, fwd } = camera.frame();
        const vp = { x: 0, y: 0, w: iw, h: ih };
        const s = camera.pixelScale(vp);
        const near = camera.nearLimit();
        const D = camera.distance;
        const colors = tagColors(pal);
        const byTag = get('kl.color') === 'letter';
        const flat = hexToRgb(pal.dark ? '#e6e9ef' : '#202430');
        const size = Math.max(1, Math.min(3, Math.floor(Number(get('sp.size')) || 1)));
        const cx = iw / 2, cy = ih / 2;
        const pack = LITTLE_ENDIAN
            ? (r0, g0, b0) => ((255 << 24) | (b0 << 16) | (g0 << 8) | r0) >>> 0
            : (r0, g0, b0) => ((r0 << 24) | (g0 << 16) | (b0 << 8) | 255) >>> 0;
        const xyz = st.xyz, tag = st.tag;
        let written = 0;
        for (let i = 0; i < st.count; i++) {
            const rx = xyz[3 * i] - eye[0], ry = xyz[3 * i + 1] - eye[1], rz = xyz[3 * i + 2] - eye[2];
            const depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
            if (depth <= near) continue;
            const vx = rx * right[0] + ry * right[1] + rz * right[2];
            const vy = rx * up[0] + ry * up[1] + rz * up[2];
            const k = camera.orthographic ? s : s / depth;
            const sx = Math.floor(cx + vx * k), sy = Math.floor(cy - vy * k);
            if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) continue;
            const b = Math.max(0, Math.min(1, 1 - (depth - (D - 1)) / 2));
            const shade = 0.28 + 0.72 * b * b;
            const col = byTag ? colors[tag[i] % colors.length] : flat;
            const val = pack((col[0] * shade) | 0, (col[1] * shade) | 0, (col[2] * shade) | 0);
            for (let dy = 0; dy < size; dy++) {
                const yy = sy + dy;
                if (yy >= ih) break;
                for (let dx = 0; dx < size; dx++) {
                    const xx = sx + dx;
                    if (xx >= iw) break;
                    const idx = yy * iw + xx;
                    if (depth < z[idx]) { z[idx] = depth; u32[idx] = val; written++; }
                }
            }
        }
        img.updatePixels();
        return written;
    }

    function circleSegments() {
        const list = plane.circleList();
        const desc = (c) => (c.line ? `L${c.p[0].toFixed(5)},${c.p[1].toFixed(5)},${c.dir[0].toFixed(5)},${c.dir[1].toFixed(5)}` : `${c.c[0].toFixed(5)},${c.c[1].toFixed(5)},${c.r.toFixed(5)}`);
        const key = `${plane.st.paramKey}|${plane.st.kind}|${list.length}|${list.map((q) => desc(q.circle)).join(';')}`;
        if (st.circleCache.key !== key) {
            st.circleCache = {
                key,
                list: list.filter((q) => q.circle && (q.circle.line || (q.circle.r > 0 && Number.isFinite(q.circle.r) && Math.abs(q.circle.c[0]) < 1e6 && Math.abs(q.circle.c[1]) < 1e6)))
                    .map((q) => ({ ...q, segs: polylineToSegments(circleOnSphere(q.circle, 96)), great: isGreatCircle(q.circle) })),
            };
        }
        return st.circleCache.list;
    }

    function draw() {
        const pal = env.pal();
        const r = rectNow();
        refreshPoints();
        const { eye } = camera.frame();
        const sc = camera.pixelScale(r);
        const rad = sc / Math.sqrt(Math.max(1.0001, camera.distance * camera.distance - 1));
        const ccx = r.x + r.w / 2, ccy = r.y + r.h / 2;
        // body of the sphere
        p.noStroke();
        p.fill(pal.panel);
        if (Number.isFinite(rad) && rad < 1e6) p.circle(ccx, ccy, 2 * rad);

        const key = [camera.yaw.toFixed(4), camera.pitch.toFixed(4), camera.distance.toFixed(3), camera.target.join(','), st.cloudVersion,
            r.w, r.h, pal.dark, get('kl.color'), get('sp.size')].join('|');
        if (st.imgKey !== key || st.img.version < 0) {
            st.drawn = rasterise(r, pal);
            st.imgKey = key;
            st.img.version = 0;
        }
        const back = pal.dark ? [90, 98, 112, 90] : [120, 126, 140, 90];
        const front = pal.dark ? [150, 160, 178, 150] : [90, 96, 110, 150];
        const grat = get('sp.graticule') ? splitByVisibility(st.graticule, eye, st.cacheF, st.cacheB) : null;
        if (grat) { st.cacheF = grat.fbuf; st.cacheB = grat.bbuf; }
        const circles = get('sp.circles') ? circleSegments() : [];
        const colors = tagColors(pal);
        withClip(p, r, () => {
            if (grat) drawEdges(p, grat.back, camera, r, { stroke: back, weight: 1, cache: st.bufs.bk || (st.bufs.bk = {}) });
            for (const q of circles) {
                const sp = splitByVisibility(q.segs, eye, new Float32Array(0), new Float32Array(0));
                const col = colors[q.tag % colors.length];
                drawEdges(p, sp.back, camera, r, { stroke: [col[0], col[1], col[2], 70], weight: 1, cache: {} });
            }
            p.image(st.img.img, r.x, r.y, r.w, r.h);
            if (grat) drawEdges(p, grat.front, camera, r, { stroke: front, weight: 1, cache: st.bufs.fr || (st.bufs.fr = {}) });
            for (const q of circles) {
                const sp = splitByVisibility(q.segs, eye, new Float32Array(0), new Float32Array(0));
                const col = colors[q.tag % colors.length];
                drawEdges(p, sp.front, camera, r, { stroke: [col[0], col[1], col[2], 235], weight: q.great ? 3 : 2, cache: {} });
            }
            // silhouette and poles
            p.noFill();
            p.stroke(pal.axis);
            p.strokeWeight(1.5);
            if (Number.isFinite(rad) && rad < 1e6) p.circle(ccx, ccy, 2 * rad);
            for (const [label, pt] of [['inf', [0, 0, 1]], ['0', [0, 0, -1]]]) {
                const q = camera.project(pt, r);
                if (!q.visible) continue;
                const vis = pt[0] * eye[0] + pt[1] * eye[1] + pt[2] * eye[2] > 1;
                p.noStroke();
                p.fill(vis ? pal.fg : pal.muted);
                p.textSize(11);
                p.textAlign(p.LEFT, p.BOTTOM);
                p.text(label, q.x + 5, q.y - 3);
                p.circle(q.x, q.y, 4);
            }
        });
        p.noStroke();
        p.fill(pal.fg);
        p.textSize(12);
        p.textAlign(p.LEFT, p.TOP);
        p.text(`Riemann sphere: ${st.count.toLocaleString('en-US')} limit-set points (inverse stereographic projection; north pole = infinity)`, r.x + 10, r.y + 8);
        p.text('drag: orbit   shift/right-drag: pan   wheel: zoom   R: reset', r.x + 10, r.y + 24);
    }

    return {
        st, camera, controller, step, draw, refreshPoints,
        get pixelsDrawn() { return st.drawn; },
    };
}
