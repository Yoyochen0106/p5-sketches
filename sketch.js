function setup() {
    createCanvas(windowWidth, windowHeight);
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

function x_to_scr(x) {
    return map(x, 0, 1, 0, windowWidth);
}
function y_to_scr(y) {
    return map(y, -1, 1, windowHeight, 0);
}

function draw() {
    background(192);

    let func = new Sine();

    let prev_px;
    let prev_py;
    let prev_px_der;
    let prev_py_der;

    let taylor_x = map(mouseX, 0, windowWidth, 0, 1);
    let taylor_y = func.call(taylor_x)
    let h = 1e-6;
    let der = (func.call(taylor_x+h) - taylor_y) / h
    let a = der;
    let b = taylor_y - taylor_x*der;

    stroke(0);

    for (var i = 0; i < 1000; i++) {
        let x = i/1000.0;
        let y = func.call(x);
        let px = map(x, 0, 1, 0, windowWidth);
        let py = map(y, -1, 1, windowHeight, 0);
        if (i != 0) {
            line(prev_px, prev_py, px, py);
        }

        prev_px = px;
        prev_py = py;

        y = a*x + b;
        px = map(x, 0, 1, 0, windowWidth);
        py = map(y, -1, 1, windowHeight, 0);
        if (i != 0) {
            line(prev_px_der, prev_py_der, px, py);
        }

        prev_px_der = px;
        prev_py_der = py;
    }

    stroke(0, 0, 255);
    line(x_to_scr(taylor_x), 0, x_to_scr(taylor_x), windowHeight);
//   ellipse(mouseX, mouseY, 80, 80); // 圓形跟隨滑鼠
}
