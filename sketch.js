function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(220);
  if (mouseIsPressed) {
    fill(0); // 按下滑鼠時填充黑色
  } else {
    fill(255); // 否則填充白色
  }
  ellipse(mouseX, mouseY, 80, 80); // 圓形跟隨滑鼠
}
