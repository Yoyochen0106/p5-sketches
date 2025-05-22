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

function mod(x, y) {
    return x - Math.floor(x / y) * y;
}

class Mirrored {
    constructor(func, xmin, xmax) {
        this.func = func;
        this.xmin = xmin;
        this.xmax = xmax;
    }
    call(x) {
        let size = this.xmax - this.xmin;
        let x2 = mod(x - this.xmin, 2*size) + this.xmin;
        if (x2 > size) x2 = 2*size - x2;
        return this.func.call(x2);
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

let [xmin, xmax] = [-5, 5];
let [ymin, ymax] = [-2, 2];
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

function calc_taylor_series(func, x, h, order) {
    let coeff = []
    for (let i = 0; i <= order; i++) {
        coeff.push(calc_derivative(func, i, x, h) / factorial(i))
    }
    return new Poly(coeff)
}

class TypeWriter {
    constructor(x, y) {
        this.x = x
        this.y = y
        this.line_gap = 20;
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

function factorial(x) {
    let s = 1;
    for (let i = 1; i <= x; i++) {
        s *= i;
    }
    return s;
}

function draw() {
    background(192);

    let func = new Sine();
    // let func = new Mirrored(new Sine(), 0, 1);
    // let func = new Mirrored(new Poly([0, 0, 3, -2]), 0, 1); // this shows the reflection point of 2nd derivative // this look like sine
    // let func = new Poly([0, 0, 3, -2]);
    // let func = new Poly([0, 0, 1.0]);
    let tw = new TypeWriter(0, 20);

    let prev_px;
    let prev_py;

    let taylor_x = map(mouseX, 0, windowWidth, xmin, xmax);
    let taylor_y = func.call(taylor_x)
    let h = 1e-2;
    let order = 9;
    let func_taylor = calc_taylor_series(func, taylor_x, h, order);
    
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
    f = n => n.toFixed(3).padStart(10);
    for (let i = 0; i < func_taylor.coeffs.length; i++) {
        let n = func_taylor.coeffs[i]
        if (i == 0) {
            tw.type(`       ${f(n)}`).newline()
        } else if (i == 1) {
            tw.type(`     + ${f(n)} (x - ${f(taylor_x)})`).newline()
        } else {
            tw.type(`     + ${f(n)} (x - ${f(taylor_x)})`).super(`${i}`).newline()
        }
    }
    tw.newline()
    tw.type(`mouse (x, y) = (${f(taylor_x)}, ${f(taylor_y)})`)

    stroke(255, 0, 0);
    line(x_to_scr(taylor_x), 0, x_to_scr(taylor_x), windowHeight);
    circle(x_to_scr(taylor_x), y_to_scr(taylor_y), 8);
//   ellipse(mouseX, mouseY, 80, 80); // 圓形跟隨滑鼠
}
