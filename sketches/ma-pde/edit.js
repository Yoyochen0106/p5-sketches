// Terrain-style brush editing of sampled 1D curves (reuses the impulse-lab brush primitives) and
// a small snapshot undo stack shared by the panels.

import { raise, smooth, flatten, lineSegment } from '../impulse/brush.js';

/**
 * Applies one brush dab at sample position idx. params: { tool, radius (samples), soft, amount }.
 * sign = +1 (left button) or -1 (right button, inverse of the tool).
 */
export function dab(arr, idx, val, sign, params, factor = 1) {
    const { tool, radius, soft, amount } = params;
    if (tool === 'raise') raise(arr, idx, radius, soft, sign * amount * factor);
    else if (tool === 'lower') raise(arr, idx, radius, soft, -sign * amount * factor);
    else if (tool === 'smooth') smooth(arr, idx, radius, soft, 0.5 * Math.min(1, factor));
    else if (tool === 'flatten') flatten(arr, idx, radius, soft, sign < 0 ? 0 : val, 0.6 * Math.min(1, factor));
}

/** Continues a stroke from stroke.lastIdx to (idx, val), interpolating dabs. Mutates stroke. */
export function strokeTo(arr, stroke, idx, val, params) {
    if (params.tool === 'line') {
        const v1 = stroke.sign < 0 ? 0 : val, v0 = stroke.sign < 0 ? 0 : stroke.lastVal;
        lineSegment(arr, stroke.lastIdx, v0, idx, v1);
    } else {
        const step = Math.max(1, params.radius / 3);
        const cnt = Math.max(1, Math.ceil(Math.abs(idx - stroke.lastIdx) / step));
        for (let k = 1; k <= cnt; k++) {
            const t = k / cnt;
            dab(arr, stroke.lastIdx + (idx - stroke.lastIdx) * t, stroke.lastVal + (val - stroke.lastVal) * t, stroke.sign, params, 1);
        }
    }
    stroke.lastIdx = idx;
    stroke.lastVal = val;
}

/** Snapshot undo / redo over a named set of Float64Arrays. */
export class Undo {
    constructor(limit = 60) { this.limit = limit; this.past = []; this.future = []; }

    static snap(arrays) {
        const s = {};
        for (const k of Object.keys(arrays)) s[k] = Float64Array.from(arrays[k]);
        return s;
    }

    push(arrays) {
        this.past.push(Undo.snap(arrays));
        if (this.past.length > this.limit) this.past.shift();
        this.future.length = 0;
    }

    _apply(snap, arrays) { for (const k of Object.keys(snap)) if (arrays[k] && arrays[k].length === snap[k].length) arrays[k].set(snap[k]); }

    undo(arrays) {
        if (!this.past.length) return false;
        this.future.push(Undo.snap(arrays));
        this._apply(this.past.pop(), arrays);
        return true;
    }

    redo(arrays) {
        if (!this.future.length) return false;
        this.past.push(Undo.snap(arrays));
        this._apply(this.future.pop(), arrays);
        return true;
    }

    clear() { this.past.length = 0; this.future.length = 0; }
}
