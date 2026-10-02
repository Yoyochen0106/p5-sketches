import test from 'node:test';
import assert from 'node:assert/strict';
import { MockP5, MockGraphics, MockColor, createMockP5, detectLeakedGlobals, detectLeakedGlobalsAsync } from '../mock-p5.js';

const make = (fn, opts) => new MockP5(fn, null, opts);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('lifecycle: sketchFn, then setup; draw only on stepFrames; frameCount increments before draw', () => {
  const order = [];
  const frames = [];
  const p = make((p) => {
    order.push('fn');
    p.setup = () => { order.push('setup'); frames.push(p.frameCount); };
    p.draw = () => { order.push('draw'); frames.push(p.frameCount); };
  });
  assert.deepEqual(order, ['fn', 'setup']);
  assert.equal(p.stepFrames(), 1);
  assert.equal(p.stepFrames(3), 3);
  assert.deepEqual(frames, [0, 1, 2, 3, 4]);
  assert.equal(p.frameCount, 4);
});

test('preload runs before setup; missing draw/setup is fine', () => {
  const order = [];
  make((p) => { p.preload = () => order.push('preload'); p.setup = () => order.push('setup'); });
  assert.deepEqual(order, ['preload', 'setup']);
  const p = make(() => {});
  assert.equal(p.stepFrames(2), 2);
});

test('opts: width/height/window size, defaults, createMockP5 bakes defaults and tracks instances', () => {
  const p = make(() => {}, { width: 300, height: 200 });
  assert.deepEqual([p.width, p.height, p.windowWidth, p.windowHeight], [300, 200, 300, 200]);
  const P5 = createMockP5({ width: 111, height: 222, seed: 7 });
  const a = new P5(() => {}, null);
  const b = new P5(() => {}, null, { width: 5 });
  assert.deepEqual([a.width, a.height, b.width, b.height], [111, 222, 5, 222]);
  assert.equal(P5.instances.length, 2);
  assert.equal(P5.instances[1], b);
  assert.equal(MockP5.instances.includes(a), false);
});

test('createCanvas / resizeCanvas update size and are recorded; canvas object is chainable', () => {
  const p = make((p) => { p.setup = () => { const c = p.createCanvas(640, 480); c.parent('x').style('display', 'block'); }; });
  assert.deepEqual([p.width, p.height], [640, 480]);
  p.resizeCanvas(100, 50);
  assert.deepEqual([p.width, p.height], [100, 50]);
  assert.deepEqual(p.callsOf('createCanvas')[0].args, [640, 480]);
  assert.deepEqual(p.lastCall('resizeCanvas').args, [100, 50]);
  assert.equal(p.canvas.width, 100);
});

test('math helpers', () => {
  const p = make(() => {});
  assert.equal(p.map(5, 0, 10, 0, 100), 50);
  assert.equal(p.map(15, 0, 10, 0, 100, true), 100);
  assert.equal(p.map(-5, 0, 10, 100, 0, true), 100);
  assert.equal(p.constrain(5, 0, 3), 3);
  assert.equal(p.lerp(0, 10, 0.25), 2.5);
  assert.equal(p.norm(5, 0, 10), 0.5);
  assert.equal(p.dist(0, 0, 3, 4), 5);
  assert.equal(p.dist(0, 0, 0, 2, 3, 6), 7);
  assert.equal(p.max(1, 5, 3), 5);
  assert.equal(p.min([4, 2, 9]), 2);
  assert.equal(p.round(2.567, 2), 2.57);
  assert.equal(p.round(2.5), 3);
  assert.equal(p.sq(3), 9);
  assert.equal(p.floor(-0.5), -1);
  assert.equal(p.ceil(0.1), 1);
  assert.equal(p.abs(-2), 2);
  assert.equal(p.pow(2, 10), 1024);
  assert.equal(p.sqrt(16), 4);
  near(p.fract(3.25), 0.25);
  near(p.sin(p.PI / 2), 1);
  near(p.atan2(1, 1), p.QUARTER_PI);
  assert.equal(p.TWO_PI, 2 * Math.PI);
  assert.equal(p.HALF_PI, Math.PI / 2);
  assert.equal(p.TAU, p.TWO_PI);
  assert.equal(p.nf(3.14159, 3, 2), '003.14');
});

test('angleMode(DEGREES) affects trig, not constants', () => {
  const p = make(() => {});
  p.angleMode(p.DEGREES);
  near(p.sin(90), 1);
  near(p.atan2(1, 1), 45);
  p.angleMode(p.RADIANS);
  near(p.cos(Math.PI), -1);
});

test('methods are bound: destructuring works', () => {
  const p = make(() => {});
  const { map, line, fill } = p;
  assert.equal(map(1, 0, 2, 0, 10), 5);
  fill(1); line(0, 0, 1, 1);
  assert.equal(p.callsOf('line').length, 1);
});

test('random is seeded and reproducible; random(array), random(a,b) and gaussian', () => {
  const run = (seed) => { const p = make(() => {}); p.randomSeed(seed); return [p.random(), p.random(10), p.random(5, 6), p.randomGaussian()]; };
  assert.deepEqual(run(3), run(3));
  assert.notDeepEqual(run(3), run(4));
  const p = make(() => {});
  for (let i = 0; i < 200; i++) { const r = p.random(); assert.ok(r >= 0 && r < 1); const q = p.random(-2, 2); assert.ok(q >= -2 && q < 2); }
  assert.ok(['a', 'b'].includes(p.random(['a', 'b'])));
  // default seed is deterministic across instances
  assert.equal(make(() => {}).random(), make(() => {}).random());
});

test('noise is deterministic, in [0,1), smooth, and noiseSeed changes it', () => {
  const p = make(() => {});
  assert.equal(p.noise(1.5, 2.5), p.noise(1.5, 2.5));
  let maxJump = 0;
  for (let x = 0; x < 20; x += 0.01) {
    const v = p.noise(x, 0.3);
    assert.ok(v >= 0 && v < 1);
    maxJump = Math.max(maxJump, Math.abs(v - p.noise(x + 0.01, 0.3)));
  }
  assert.ok(maxJump < 0.05, `noise not smooth: ${maxJump}`);
  const before = p.noise(3.3);
  p.noiseSeed(99);
  assert.notEqual(p.noise(3.3), before);
});

test('recording: every drawing call has fn/args/frame/style', () => {
  const p = make((p) => {
    p.draw = () => { p.stroke(255, 0, 0); p.line(0, 0, 10, 10); };
  });
  p.stepFrames(2);
  const lines = p.callsOf('line');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((c) => c.frame), [1, 2]);
  assert.deepEqual(lines[0].args, [0, 0, 10, 10]);
  assert.deepEqual(lines[0].style.stroke.levels, [255, 0, 0, 255]);
  assert.equal(p.lastCall('line'), lines[1]);
  assert.equal(p.lastCall('text'), undefined);
  assert.equal(p.lastCall().fn, 'line');
  p.clearCalls();
  assert.equal(p.calls.length, 0);
});

test('every listed drawing function is recorded', () => {
  const p = make(() => {});
  const calls = {
    line: [0, 0, 1, 1], point: [1, 1], circle: [1, 1, 2], ellipse: [1, 1, 2, 3], rect: [0, 0, 2, 2], square: [0, 0, 3],
    triangle: [0, 0, 1, 0, 0, 1], quad: [0, 0, 1, 0, 1, 1, 0, 1], arc: [0, 0, 2, 2, 0, 1], bezier: [0, 0, 1, 1, 2, 2, 3, 3],
    text: ['hi', 1, 2], background: [0], clear: [], textSize: [10], strokeWeight: [2], noStroke: [], noFill: [], fill: [1],
    stroke: [2], translate: [1, 2], rotate: [0.1], scale: [2], push: [], pop: [], textAlign: ['center'], textFont: ['Consolas'],
    colorMode: ['hsb'], frameRate: [30], noLoop: [], loop: [], cursor: ['pointer'], pixelDensity: [1], loadPixels: [], updatePixels: [],
  };
  for (const [fn, args] of Object.entries(calls)) {
    if (fn === 'colorMode') p.colorMode('rgb'); // keep fill(1) etc. simple
    p[fn](...args);
    assert.equal(p.lastCall().fn, fn, fn);
  }
  p.beginShape(); p.vertex(0, 0); p.curveVertex(1, 1); p.endShape(p.CLOSE);
  assert.deepEqual(['beginShape', 'vertex', 'curveVertex', 'endShape'], p.calls.slice(-4).map((c) => c.fn));
});

test('style snapshots are independent of later changes', () => {
  const p = make(() => {});
  p.strokeWeight(3);
  p.stroke(10, 20, 30);
  p.line(0, 0, 1, 1);
  const first = p.lastCall('line');
  p.strokeWeight(9);
  p.stroke(1, 2, 3);
  p.line(0, 0, 2, 2);
  const second = p.lastCall('line');
  assert.equal(first.style.strokeWeight, 3);
  assert.deepEqual(first.style.stroke.levels, [10, 20, 30, 255]);
  assert.equal(second.style.strokeWeight, 9);
  assert.throws(() => { 'use strict'; first.style.strokeWeight = 5; }, TypeError);
});

test('defaults match p5: black stroke, white fill, weight 1, textSize 12', () => {
  const p = make(() => {});
  p.rect(0, 0, 1, 1);
  const s = p.lastCall('rect').style;
  assert.deepEqual(s.fill.levels, [255, 255, 255, 255]);
  assert.deepEqual(s.stroke.levels, [0, 0, 0, 255]);
  assert.equal(s.strokeWeight, 1);
  assert.equal(s.textSize, 12);
});

test('noStroke/noFill give null in the snapshot and can be re-enabled', () => {
  const p = make(() => {});
  p.noStroke(); p.noFill();
  p.rect(0, 0, 1, 1);
  assert.equal(p.lastCall('rect').style.stroke, null);
  assert.equal(p.lastCall('rect').style.fill, null);
  p.stroke(0, 255, 0); p.fill(5);
  p.rect(0, 0, 1, 1);
  assert.deepEqual(p.lastCall('rect').style.stroke.levels, [0, 255, 0, 255]);
  assert.deepEqual(p.lastCall('rect').style.fill.levels, [5, 5, 5, 255]);
});

test('push/pop restore style and transform, nest correctly, and report stack depth', () => {
  const p = make(() => {});
  p.fill(1, 2, 3); p.strokeWeight(2); p.textSize(20); p.translate(10, 20);
  p.push();
  assert.equal(p.stackDepth, 1);
  p.fill(200); p.noStroke(); p.strokeWeight(7); p.textSize(40); p.textAlign('center', 'top'); p.translate(5, 5); p.scale(2);
  p.push();
  p.fill(9, 9, 9);
  assert.equal(p.stackDepth, 2);
  p.pop();
  assert.deepEqual(p.style.fill.levels, [200, 200, 200, 255]);
  p.rect(0, 0, 1, 1);
  const inner = p.lastCall('rect');
  assert.equal(inner.style.stroke, null);
  assert.equal(inner.style.textSize, 40);
  assert.deepEqual(inner.transform, [2, 0, 0, 2, 15, 25]);
  p.pop();
  p.rect(0, 0, 1, 1);
  const outer = p.lastCall('rect');
  assert.deepEqual(outer.style.fill.levels, [1, 2, 3, 255]);
  assert.deepEqual(outer.style.stroke.levels, [0, 0, 0, 255]);
  assert.equal(outer.style.strokeWeight, 2);
  assert.equal(outer.style.textSize, 20);
  assert.equal(outer.style.textAlignH, 'left');
  assert.deepEqual(outer.transform, [1, 0, 0, 1, 10, 20]);
  assert.equal(p.stackDepth, 0);
  assert.equal(p.unbalancedPops, 0);
});

test('unbalanced pop does not throw but is counted', () => {
  const p = make(() => {});
  p.pop();
  assert.equal(p.unbalancedPops, 1);
  assert.equal(p.lastCall('pop').unbalanced, true);
});

test('transform: translate/rotate/scale compose in canvas order; transformPoint', () => {
  const p = make(() => {});
  p.translate(100, 50);
  p.rotate(Math.PI / 2);
  const [x, y] = p.transformPoint(10, 0);
  near(x, 100); near(y, 60);
  p.scale(2, 3);
  const [x2, y2] = p.transformPoint(1, 1);
  // scale first (2,3) -> (2,3), rotate 90deg -> (-3,2), translate -> (97, 52)
  near(x2, 97); near(y2, 52);
  p.resetMatrix();
  assert.deepEqual(p.matrix, [1, 0, 0, 1, 0, 0]);
  p.applyMatrix(1, 0, 0, 1, 5, 6);
  assert.deepEqual(p.transformPoint(0, 0), [5, 6]);
  const q = make(() => {});
  q.angleMode(q.DEGREES); q.rotate(90);
  near(q.transformPoint(1, 0)[1], 1);
});

test('colors: gray, gray+alpha, rgb, rgba, strings, arrays, color objects', () => {
  const p = make(() => {});
  assert.deepEqual(p.color(100).levels, [100, 100, 100, 255]);
  assert.deepEqual(p.color(100, 50).levels, [100, 100, 100, 50]);
  assert.deepEqual(p.color(1, 2, 3).levels, [1, 2, 3, 255]);
  assert.deepEqual(p.color(1, 2, 3, 4).levels, [1, 2, 3, 4]);
  assert.deepEqual(p.color('#ff8000').levels, [255, 128, 0, 255]);
  assert.deepEqual(p.color('#f80').levels, [255, 136, 0, 255]);
  assert.deepEqual(p.color('rgba(10, 20, 30, 0.5)').levels, [10, 20, 30, 128]);
  assert.deepEqual(p.color('red').levels, [255, 0, 0, 255]);
  assert.deepEqual(p.color([5, 6, 7]).levels, [5, 6, 7, 255]);
  assert.deepEqual(p.color(p.color(9, 8, 7)).levels, [9, 8, 7, 255]);
  assert.ok(p.color(1) instanceof MockColor);
  assert.throws(() => p.color('notacolour'), /cannot parse/);
  assert.equal(p.color(255, 0, 0).toString(), 'rgba(255,0,0,1)');
  assert.deepEqual(p.color(300, -5, 0).levels, [255, 0, 0, 255]);
  p.stroke('#00ff00');
  p.line(0, 0, 1, 1);
  assert.deepEqual(p.lastCall('line').style.stroke.levels, [0, 255, 0, 255]);
  const c = p.color(1, 2, 3);
  p.fill(c);
  c.setAlpha(10); // later mutation of the user's colour must not change the stored style
  assert.deepEqual(p.style.fill.levels, [1, 2, 3, 255]);
});

test('colorMode HSB with default and custom maxes; lerpColor; red/green/blue/alpha', () => {
  const p = make(() => {});
  p.colorMode(p.HSB);
  assert.deepEqual(p.color(0, 100, 100).levels, [255, 0, 0, 255]);
  assert.deepEqual(p.color(120, 100, 100).levels, [0, 255, 0, 255]);
  assert.deepEqual(p.color(240, 100, 100, 0.5).levels, [0, 0, 255, 128]);
  assert.deepEqual(p.color(50).levels, [128, 128, 128, 255]);
  p.colorMode(p.HSB, 1);
  assert.deepEqual(p.color(1 / 3, 1, 1).levels, [0, 255, 0, 255]);
  p.colorMode(p.RGB, 1);
  assert.deepEqual(p.color(1, 0.5, 0).levels, [255, 128, 0, 255]);
  p.colorMode(p.RGB, 255);
  const m = p.lerpColor(p.color(0, 0, 0), p.color(100, 200, 50), 0.5);
  assert.deepEqual(m.levels, [50, 100, 25, 255]);
  assert.equal(p.red(m), 50); assert.equal(p.green(m), 100); assert.equal(p.blue(m), 25); assert.equal(p.alpha(m), 255);
  p.colorMode(p.HSB);
  p.fill(0, 100, 100);
  p.rect(0, 0, 1, 1);
  assert.deepEqual(p.lastCall('rect').style.fill.levels, [255, 0, 0, 255]);
  assert.equal(p.lastCall('rect').style.colorMode, 'hsb');
});

test('text: textWidth = len*size*0.6, ascent/descent, textSize getter, textFont size arg, textAlign', () => {
  const p = make(() => {});
  p.textSize(20);
  assert.equal(p.textWidth('hello'), 60);
  assert.equal(p.textWidth(12345), 60);
  assert.equal(p.textSize(), 20);
  near(p.textAscent() + p.textDescent(), 20);
  p.textFont('Consolas', 30);
  assert.equal(p.textSize(), 30);
  assert.equal(p.textFont(), 'Consolas');
  p.textAlign(p.CENTER, p.TOP);
  p.text('x', 1, 2);
  const c = p.lastCall('text');
  assert.deepEqual(c.args, ['x', 1, 2]);
  assert.equal(c.style.textAlignH, 'center');
  assert.equal(c.style.textAlignV, 'top');
  assert.equal(c.style.textFont, 'Consolas');
  assert.deepEqual(p.textAlign(), { horizontal: 'center', vertical: 'top' });
  assert.equal(p.callsOf('textSize').length, 1); // getters are not recorded
});

test('shapes: endShape carries collected vertices and close flag', () => {
  const p = make(() => {});
  p.beginShape();
  p.vertex(0, 0); p.vertex(10, 0); p.vertex(10, 10);
  p.endShape(p.CLOSE);
  const e = p.lastCall('endShape');
  assert.deepEqual(e.vertices.map((v) => [v.x, v.y]), [[0, 0], [10, 0], [10, 10]]);
  assert.equal(e.closed, true);
  p.beginShape(p.POINTS); p.curveVertex(1, 2); p.endShape();
  assert.equal(p.lastCall('endShape').kind, 'points');
  assert.equal(p.lastCall('endShape').closed, false);
});

test('non-finite geometry args are collected in invalidCalls; strictNumbers throws', () => {
  const p = make(() => {});
  p.line(0, 0, NaN, 5);
  p.circle(1, undefined, 3);
  p.text('ok', 1, 2);
  p.text('bad', Infinity, 2);
  p.translate(NaN, 0);
  assert.deepEqual(p.invalidCalls.map((c) => c.fn), ['line', 'circle', 'text', 'translate']);
  assert.equal(p.invalidCalls[0].index, 2);
  const s = make(() => {}, { strictNumbers: true });
  assert.throws(() => s.rect(0, 0, NaN, 1), /rect\(\) argument 2/);
  s.rect(0, 0, 1, 1);
  p.clearCalls();
  assert.equal(p.invalidCalls.length, 0);
});

test('background fills the pixel buffer; get/set/loadPixels/updatePixels', () => {
  const p = make(() => {}, { width: 4, height: 3 });
  p.background(10, 20, 30);
  assert.deepEqual(p.get(0, 0), [10, 20, 30, 255]);
  assert.deepEqual(p.get(3, 2), [10, 20, 30, 255]);
  assert.deepEqual(p.get(9, 9), [0, 0, 0, 0]);
  p.set(1, 1, p.color(1, 2, 3));
  p.set(2, 1, 77);
  assert.deepEqual(p.get(1, 1), [1, 2, 3, 255]);
  assert.deepEqual(p.get(2, 1), [77, 77, 77, 255]);
  p.loadPixels();
  assert.ok(p.pixels instanceof Uint8ClampedArray);
  assert.equal(p.pixels.length, 4 * 3 * 4);
  const i = (1 * 4 + 1) * 4;
  assert.deepEqual([...p.pixels.slice(i, i + 4)], [1, 2, 3, 255]);
  p.pixels[0] = 200;
  p.updatePixels();
  assert.deepEqual(p.get(0, 0), [200, 20, 30, 255]);
  const sub = p.get(0, 0, 2, 2);
  assert.equal(sub.width, 2);
  assert.deepEqual([...sub.pixels.slice(0, 4)], [200, 20, 30, 255]);
  p.clear();
  assert.deepEqual(p.get(0, 0), [0, 0, 0, 0]);
});

test('pixelDensity scales pixels length: w*h*4*d^2', () => {
  const p = make(() => {}, { width: 5, height: 4 });
  p.pixelDensity(2);
  assert.equal(p.pixelDensity(), 2);
  p.loadPixels();
  assert.equal(p.pixels.length, 5 * 4 * 4 * 4);
  p.set(1, 1, p.color(9, 9, 9));
  p.loadPixels();
  const w = 10;
  assert.deepEqual([...p.pixels.slice((2 * w + 2) * 4, (2 * w + 2) * 4 + 4)], [9, 9, 9, 255]);
  assert.deepEqual([...p.pixels.slice((3 * w + 3) * 4, (3 * w + 3) * 4 + 4)], [9, 9, 9, 255]);
  p.resizeCanvas(2, 2);
  p.loadPixels();
  assert.equal(p.pixels.length, 2 * 2 * 4 * 4);
});

test('createImage: pixels, set/get; image() is recorded with the image as first arg', () => {
  const p = make(() => {});
  const img = p.createImage(3, 2);
  assert.equal(img.pixels.length, 24);
  img.loadPixels();
  img.set(2, 1, p.color(5, 6, 7));
  assert.deepEqual(img.get(2, 1), [5, 6, 7, 255]);
  img.updatePixels();
  p.image(img, 10, 20);
  assert.equal(p.lastCall('image').args[0], img);
  assert.equal(p.invalidCalls.length, 0);
});

test('createGraphics: own size, own call log with same API, parent logs creation, shares frameCount', () => {
  const p = make((p) => { p.draw = () => {}; });
  p.stepFrames(3);
  const g = p.createGraphics(50, 40);
  assert.ok(g instanceof MockGraphics);
  assert.deepEqual([g.width, g.height], [50, 40]);
  assert.equal(p.lastCall('createGraphics').graphics, g);
  assert.deepEqual(p.lastCall('createGraphics').args, [50, 40]);
  g.fill(255, 0, 0);
  g.noStroke();
  g.rect(0, 0, 10, 10);
  g.push(); g.translate(3, 4); g.circle(0, 0, 2); g.pop();
  assert.equal(g.callsOf('rect').length, 1);
  assert.equal(p.callsOf('rect').length, 0);
  const rect = g.lastCall('rect');
  assert.deepEqual(rect.style.fill.levels, [255, 0, 0, 255]);
  assert.equal(rect.style.stroke, null);
  assert.equal(rect.frame, 3);
  assert.deepEqual(g.lastCall('circle').transform, [1, 0, 0, 1, 3, 4]);
  // graphics style is independent of the parent
  assert.deepEqual(p.style.fill.levels, [255, 255, 255, 255]);
  g.background(1, 2, 3);
  assert.deepEqual(g.get(0, 0), [1, 2, 3, 255]);
  g.resizeCanvas(10, 10);
  assert.equal(g.width, 10);
  p.image(g, 0, 0);
  assert.equal(p.lastCall('image').args[0], g);
  assert.deepEqual(g.textWidth('ab'), 2 * 12 * 0.6);
  p.clearCalls();
  assert.equal(g.calls.length, 0);
  p.remove();
  assert.equal(g.removed, true);
});

test('drawingContext records method calls and property writes separately from p.calls', () => {
  const p = make(() => {});
  const ctx = p.drawingContext;
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 5, 5);
  ctx.save();
  const img = ctx.createImageData(2, 2);
  ctx.putImageData(img, 0, 0);
  const grad = ctx.createLinearGradient(0, 0, 1, 1);
  grad.addColorStop(0, 'red');
  ctx.font = '20px Consolas';
  assert.equal(ctx.measureText('abcd').width, 4 * 20 * 0.6);
  assert.equal(ctx.fillStyle, 'red');
  assert.deepEqual(ctx.callsOf('fillRect')[0].args, [0, 0, 5, 5]);
  assert.equal(ctx.callsOf('putImageData').length, 1);
  assert.equal(ctx.callsOf('=fillStyle')[0].args[0], 'red');
  assert.equal(img.data.length, 16);
  assert.equal(p.calls.length, 0);
  assert.equal(p.ctxCalls, ctx.calls);
  assert.equal(typeof ctx.arbitraryUnknownMethod, 'function');
  assert.equal(ctx.then, undefined); // must not look like a thenable
  p.clearCalls();
  assert.equal(ctx.calls.length, 0);
});

test('input simulation: mouse props, fire handlers, return values, event objects', () => {
  const seen = [];
  const p = make((p) => {
    p.mousePressed = () => { seen.push(['pressed', p.mouseX, p.mouseY, p.mouseIsPressed, p.mouseButton]); };
    p.mouseReleased = () => seen.push(['released']);
    p.mouseDragged = () => seen.push(['dragged', p.mouseX - p.pmouseX, p.movedX]);
    p.mouseMoved = () => seen.push(['moved']);
    p.mouseWheel = (e) => { seen.push(['wheel', e.delta]); e.preventDefault(); return false; };
    p.keyPressed = () => seen.push(['key', p.key, p.keyCode, p.keyIsDown(p.LEFT_ARROW)]);
    p.keyReleased = () => seen.push(['keyup', p.keyIsDown(p.LEFT_ARROW)]);
    p.windowResized = () => seen.push(['resized', p.windowWidth, p.windowHeight]);
  });
  p.moveMouse(5, 5);
  p.pressMouse(10, 20);
  p.moveMouse(15, 25);
  p.releaseMouse();
  const ev = { delta: 100, preventDefault() { this.called = true; } };
  const ret = p.fire('mouseWheel', ev);
  assert.equal(ret, false);
  assert.equal(ev.called, true);
  const ev2 = {};
  p.fire('mouseWheel', ev2);
  assert.equal(ev2.defaultPrevented, true);
  p.pressKey('ArrowLeft', p.LEFT_ARROW);
  assert.equal(p.keyIsPressed, true);
  p.releaseKey();
  assert.equal(p.keyIsPressed, false);
  p.setWindowSize(500, 400);
  assert.deepEqual(seen, [
    ['moved'], ['pressed', 10, 20, true, 'left'], ['dragged', 5, 5], ['released'],
    ['wheel', 100], ['wheel', 0], ['key', 'ArrowLeft', 37, true], ['keyup', false], ['resized', 500, 400],
  ]);
  assert.equal(p.fire('doesNotExist'), undefined);
  // direct property assignment also works
  p.mouseX = 7; p.mouseY = 8; p.mouseIsPressed = true;
  assert.deepEqual([p.mouseX, p.mouseY, p.mouseIsPressed], [7, 8, true]);
});

test('click() presses and releases; fires mouseClicked; pmouse updates after each frame', () => {
  const seen = [];
  const p = make((p) => {
    p.mouseClicked = () => seen.push('clicked');
    p.mousePressed = () => seen.push('pressed');
    p.draw = () => seen.push(['draw', p.pmouseX, p.mouseX]);
  });
  p.click(3, 4);
  assert.deepEqual(seen, ['pressed', 'clicked']);
  p.stepFrames(2);
  assert.deepEqual(seen.slice(2), [['draw', 0, 3], ['draw', 3, 3]]);
});

test('keyIsDown can be overridden by assignment', () => {
  const p = make(() => {});
  p.keyIsDown = (k) => k === 65;
  assert.equal(p.keyIsDown(65), true);
  assert.equal(p.keyIsDown(66), false);
});

test('noLoop/loop/redraw/isLooping; stepFrames respectLoop option', () => {
  let draws = 0;
  const p = make((p) => { p.draw = () => { draws++; }; });
  assert.equal(p.isLooping(), true);
  p.noLoop();
  assert.equal(p.isLooping(), false);
  assert.equal(p.stepFrames(2), 2);          // explicit stepping always draws
  assert.equal(p.stepFrames(2, { respectLoop: true }), 0);
  p.redraw();
  assert.equal(draws, 3);
  p.loop();
  assert.equal(p.stepFrames(1, { respectLoop: true }), 1);
});

test('frameRate getter/setter and millis follow frameCount', () => {
  const p = make((p) => { p.draw = () => {}; });
  assert.equal(p.frameRate(), 60);
  p.frameRate(30);
  assert.equal(p.frameRate(), 30);
  p.stepFrames(30);
  near(p.millis(), 1000);
  p.setMillis(5);
  assert.equal(p.millis(), 5);
});

test('cursor and clearCallsEachFrame', () => {
  const p = make((p) => { p.draw = () => { p.line(0, 0, 1, 1); }; }, { clearCallsEachFrame: true });
  p.cursor('pointer');
  assert.equal(p.cursorType, 'pointer');
  p.stepFrames(5);
  assert.equal(p.callsOf('line').length, 1);
  assert.equal(p.lastCall('line').frame, 5);
});

test('remove() stops frames and input', () => {
  let draws = 0, pressed = 0;
  const p = make((p) => { p.draw = () => { draws++; }; p.mousePressed = () => { pressed++; }; });
  p.stepFrames(2);
  p.remove();
  assert.equal(p.removed, true);
  assert.equal(p.stepFrames(5), 0);
  p.fire('mousePressed');
  assert.equal(draws, 2);
  assert.equal(pressed, 0);
});

test('detectLeakedGlobals reports new globals, cleans them up, ignores existing ones', () => {
  globalThis.__preexisting = 1;
  const leaked = detectLeakedGlobals(() => {
    globalThis.px_der = 5;
    globalThis.__preexisting = 2;
    globalThis.another = 1;
  });
  assert.deepEqual(leaked, ['another', 'px_der']);
  assert.equal('px_der' in globalThis, false);
  assert.deepEqual(detectLeakedGlobals(() => { /* clean */ }), []);
  const kept = detectLeakedGlobals(() => { globalThis.keepMe = 1; }, { cleanup: false });
  assert.deepEqual(kept, ['keepMe']);
  assert.equal(globalThis.keepMe, 1);
  delete globalThis.keepMe; delete globalThis.__preexisting;
  assert.throws(() => detectLeakedGlobals(async () => {}), /synchronous/);
});

test('detectLeakedGlobals catches leaks made while running a whole sketch', () => {
  const leaked = detectLeakedGlobals(() => {
    const p = new MockP5((p) => {
      p.draw = () => { globalThis.leakedInDraw = p.frameCount; };
    }, null);
    p.stepFrames(1);
  });
  assert.deepEqual(leaked, ['leakedInDraw']);
});

test('detectLeakedGlobalsAsync', async () => {
  const leaked = await detectLeakedGlobalsAsync(async () => { await null; globalThis.asyncLeak = 1; });
  assert.deepEqual(leaked, ['asyncLeak']);
});

test('createVector basics', () => {
  const p = make(() => {});
  const v = p.createVector(3, 4);
  assert.equal(v.mag(), 5);
  assert.equal(v.copy().mult(2).x, 6);
  assert.equal(v.x, 3);
});

test('constants cover what sketches commonly use', () => {
  const p = make(() => {});
  for (const k of ['PI', 'TWO_PI', 'HALF_PI', 'LEFT', 'RIGHT', 'CENTER', 'TOP', 'BOTTOM', 'BASELINE', 'CLOSE', 'RGB', 'HSB', 'DEGREES',
    'UP_ARROW', 'DOWN_ARROW', 'LEFT_ARROW', 'RIGHT_ARROW', 'ESCAPE', 'ENTER', 'WEBGL', 'ROUND', 'SQUARE', 'PROJECT', 'CORNER']) {
    assert.notEqual(p[k], undefined, k);
  }
});
