// Tiny text layout helper: chained `type()` / `sup()` calls on one line, `newline()` to wrap.

export class TypeWriter {
    constructor(p, x, y, lineGap = 18) {
        this.p = p;
        this.x0 = x;
        this.x = x;
        this.y = y;
        this.lineGap = lineGap;
    }

    type(str) {
        const { p } = this;
        p.text(str, this.x, this.y);
        this.x += p.textWidth(str);
        return this;
    }

    /** Superscript: smaller text raised above the baseline. */
    sup(str) {
        const { p } = this;
        p.push();
        p.textSize(p.textSize() - 3);
        const w = p.textWidth(str);
        p.text(str, this.x, this.y - 0.45 * p.textSize());
        this.x += w;
        p.pop();
        return this;
    }

    newline() {
        this.x = this.x0;
        this.y += this.lineGap;
        return this;
    }
}
