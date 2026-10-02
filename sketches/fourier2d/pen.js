// Freehand pen: collects strokes in normalised coordinates and turns them into one closed loop.

import { resampleClosedPath, smoothClosed } from '../../lib/epicycles.js';

export class Pen {
    constructor() {
        /** @type {{x:number,y:number}[][]} */
        this.strokes = [];
        this.version = 0;
        this.active = false;
        this.fromPreset = false;
    }

    /** Start a new stroke at pt. Drawing over a preset replaces it. */
    begin(pt) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
        if (this.fromPreset) { this.strokes = []; this.fromPreset = false; }
        this.strokes.push([{ x: pt.x, y: pt.y }]);
        this.active = true;
        this.version++;
    }

    /** Extend the current stroke; points closer than minDist to the previous one are skipped. */
    add(pt, minDist = 0.004) {
        if (!this.active || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return false;
        const s = this.strokes[this.strokes.length - 1];
        const last = s[s.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) < minDist) return false;
        s.push({ x: pt.x, y: pt.y });
        this.version++;
        return true;
    }

    end() {
        if (!this.active) return;
        this.active = false;
        this.version++;
    }

    undo() {
        this.active = false;
        this.fromPreset = false;
        const had = this.strokes.length > 0;
        this.strokes.pop();
        this.version++;
        return had;
    }

    clear() {
        this.active = false;
        this.fromPreset = false;
        this.strokes = [];
        this.version++;
    }

    /** Replace everything with a single preset stroke. */
    setPreset(points) {
        this.active = false;
        this.strokes = [points.map((p) => ({ x: p.x, y: p.y }))];
        this.fromPreset = true;
        this.version++;
    }

    /** All strokes concatenated in drawing order (the loop closes last -> first). */
    points() {
        const out = [];
        for (const s of this.strokes) for (const p of s) out.push(p);
        return out;
    }

    /** True when there are at least two distinct points to make a loop of. */
    hasLoop() {
        const pts = this.points();
        if (pts.length < 2) return false;
        return pts.some((p) => p.x !== pts[0].x || p.y !== pts[0].y);
    }

    /** Uniformly resampled, smoothed closed loop of N points ([] when nothing has been drawn). */
    loop(N, smoothPasses = 0) {
        if (!this.hasLoop()) return [];
        const r = resampleClosedPath(this.points(), N);
        return smoothPasses > 0 ? smoothClosed(r, smoothPasses) : r;
    }
}
