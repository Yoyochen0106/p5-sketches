// World <-> screen mapping for the equal-area sketch: uniform scale, y axis pointing up.

/** Default world rectangle (one unit = one lattice cell). */
export const WORLD = { xmin: 0, xmax: 24, ymin: 0, ymax: 14 };

export class View {
    constructor() {
        this.scale = 1;
        this.ox = 0;
        this.oy = 0;
        this.w = 1;
        this.h = 1;
    }

    /**
     * Fit `world` into a w x h canvas with the given pixel margins, centred, uniform scale.
     * @param {{xmin,xmax,ymin,ymax}} world
     * @param {number} w canvas width
     * @param {number} h canvas height
     * @param {{top?,bottom?,left?,right?}} margin
     */
    fit(world, w, h, margin = {}) {
        const top = margin.top ?? 90;
        const bottom = margin.bottom ?? 36;
        const left = margin.left ?? 18;
        const right = margin.right ?? 18;
        const ww = Math.max(1e-6, world.xmax - world.xmin);
        const wh = Math.max(1e-6, world.ymax - world.ymin);
        const availW = Math.max(40, w - left - right);
        const availH = Math.max(40, h - top - bottom);
        this.scale = Math.max(1e-3, Math.min(availW / ww, availH / wh));
        const cx = left + availW / 2;
        const cy = top + availH / 2;
        this.ox = cx - ((world.xmin + world.xmax) / 2) * this.scale;
        this.oy = cy + ((world.ymin + world.ymax) / 2) * this.scale;
        this.w = w;
        this.h = h;
        return this;
    }

    toScreen(p) {
        return { x: this.ox + p.x * this.scale, y: this.oy - p.y * this.scale };
    }

    toWorld(sx, sy) {
        return { x: (sx - this.ox) / this.scale, y: (this.oy - sy) / this.scale };
    }

    /** Pixel length of a world length. */
    px(len) {
        return len * this.scale;
    }
}
