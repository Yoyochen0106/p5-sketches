function setup() {
    createCanvas(windowWidth, windowHeight);
    textFont('Consolas')
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

let _2pi = 2*Math.PI;

class Sine {
    call(x) {
        return 0.5*Math.sin(_2pi*x) + 0.5*Math.sin(_2pi*2*x);
    }
}

class Poly {
    constructor(coeffs) {
        this.coeffs = coeffs;
        this.offset = 0;
    }
    call(x) {
        x += this.offset;
        let s = 0.0;
        for (let i = this.coeffs.length-1; i >= 0; i--) {
            s = s*x + this.coeffs[i]
        }
        return s;
    }
}

let [xmin, xmax] = [-2, 2];
let [ymin, ymax] = [-5, 5];
function x_to_scr(x) {
    return map(x, xmin, xmax, 0, windowWidth);
}
function y_to_scr(y) {
    return map(y, ymin, ymax, windowHeight, 0);
}

function calc_derivative(func, order, x, h) {
    let samples = [];
    for (let i = 0; i < (order+1); i++) {
        let x_sample = x + h*(i - order/2.0);
        samples.push(func.call(x_sample));
    }
    // console.log(`${samples[0]}, ${samples[1]}`);
    // Reduce into higher derivative (order+1) => 1
    while (samples.length > 1) {
        let tmp = [];
        for (let i = 0; i < samples.length-1; i++) {
            tmp.push((samples[i+1] - samples[i]) / h);
        }
        samples = tmp;
    }
    return samples[0];
}

class TypeWriter {
    constructor(x, y) {
        this.x = x
        this.y = y
        this.line_gap = 50;
    }

    type(str) {
        let w = textWidth(str);
        text(str, this.x, this.y);
        this.x += w;
        return this;
    }
    super(str) {
        push()
        textSize(textSize() - 4)
        let w = textWidth(str);
        let h = textAscent() - textDescent();
        text(str, this.x, this.y - 0.3*h);
        this.x += w;
        pop()
        return this;
    }
    newline() {
        this.x = 0;
        this.y += this.line_gap;
        return this;
    }
}

function draw() {
    background(192);

    let func = new Sine();
    // let func = new Poly([0, 0, 1.0]);
    let func_taylor = new Poly([0, 0, 0]);
    let tw = new TypeWriter(0, 20);

    let prev_px;
    let prev_py;

    let taylor_x = map(mouseX, 0, windowWidth, xmin, xmax);
    let taylor_y = func.call(taylor_x)
    let h = 1e-3;
    // let der = (func.call(taylor_x+h) - taylor_y) / h
    let der = calc_derivative(func, 1, taylor_x, h);
    let der2 = calc_derivative(func, 2, taylor_x, h);
    func_taylor.coeffs[0] = taylor_y;
    func_taylor.coeffs[1] = der;
    func_taylor.coeffs[2] = der2;
    
    // let a = der;
    // let b = ;

    stroke(0);

    for (var i = 0; i < 1000; i++) {
        let x = i/1000.0 * (xmax-xmin) + xmin;
        let y = func.call(x);
        let px = x_to_scr(x);
        let py = y_to_scr(y);
        if (i != 0) {
            line(prev_px, prev_py, px, py);
        }

        prev_px = px;
        prev_py = py;
    }

    stroke(0, 0, 255);
    for (var i = 0; i < 1000; i++) {
        let x = i/1000.0 * (xmax-xmin) + xmin;
        // let y = a*x + b;
        let y = func_taylor.call(x - taylor_x);
        let px = x_to_scr(x);
        let py = y_to_scr(y);
        if (i != 0) {
            line(px_der, py_der, px, py);
        }

        px_der = px;
        py_der = py;
    }

    tw.type(`f(x) = `).newline();
    tw.type(`       ${taylor_y.toFixed(3).padStart(10)}`).newline()
    tw.type(`     + ${der.toFixed(3).padStart(10)} x`).newline()
    tw.type(`     + ${der2.toFixed(3).padStart(10)} x`).super("2").newline()

    stroke(255, 0, 0);
    line(x_to_scr(taylor_x), 0, x_to_scr(taylor_x), windowHeight);
    circle(x_to_scr(taylor_x), y_to_scr(taylor_y), 8);
//   ellipse(mouseX, mouseY, 80, 80); // 圓形跟隨滑鼠
}
