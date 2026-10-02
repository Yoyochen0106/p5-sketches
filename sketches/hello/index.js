// Tiny demo sketch: orbiting dots. Exercises settings, drawer UI, p5 instance mode and unmount.

export default {
  id: 'hello',
  title: 'Hello (demo)',
  description: 'Tiny demo sketch exercising settings, the drawer UI, p5 instance mode and unmounting.',

  mount(container, ctx) {
    const { settings, ui } = ctx;
    const schema = [
      { type: 'tabs', key: 'mode', options: [{ value: 'orbit', label: 'Orbit' }, { value: 'line', label: 'Line' }] },
      { type: 'slider', key: 'count', label: 'Dots', min: 1, max: 60, step: 1 },
      { type: 'slider', key: 'speed', label: 'Speed', min: 0, max: 5, step: 0.1, format: (v) => `${v.toFixed(1)}x` },
      { type: 'toggle', key: 'trail', label: 'Trail' },
      { type: 'color', key: 'color', label: 'Colour' },
      { type: 'slider', key: 'radius', label: 'Radius', min: 0.1, max: 0.9, step: 0.05, visibleIf: (s) => s.get('mode', 'orbit') === 'orbit' },
      { type: 'button', label: 'Reset', onClick: () => settings.reset() },
      { type: 'info', text: 'Press "d" to toggle this drawer.' },
    ];
    // register defaults so the store knows them (and keeps the URL hash short)
    settings.get('mode', 'orbit'); settings.get('count', 12); settings.get('speed', 1);
    settings.get('trail', true); settings.get('color', '#4fc3f7'); settings.get('radius', 0.6);

    const panel = ui.build(schema, settings, ctx.drawer);
    const randomBtn = ui.h('button', { type: 'button', class: 'bar-btn' }, 'Randomize');
    randomBtn.addEventListener('click', () => settings.set('count', 1 + Math.floor(Math.random() * 40)));
    ctx.toolbar.appendChild(randomBtn);

    const instance = new ctx.p5((p) => {
      let t = 0;
      p.setup = () => {
        const { width, height } = ctx.size();
        p.createCanvas(Math.max(1, width), Math.max(1, height));
        p.textFont('Consolas');
      };
      p.draw = () => {
        const theme = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : 'dark';
        const dark = theme !== 'light';
        const bg = dark ? 20 : 240;
        if (settings.get('trail')) { p.noStroke(); p.fill(bg, 40); p.rect(0, 0, p.width, p.height); } else p.background(bg);
        t += 0.02 * settings.get('speed');
        const n = settings.get('count');
        p.fill(p.color(settings.get('color'))); p.noStroke();
        const r = settings.get('radius') * Math.min(p.width, p.height) / 2;
        for (let i = 0; i < n; i++) {
          const a = t + (i * p.TWO_PI) / n;
          if (settings.get('mode') === 'orbit') p.circle(p.width / 2 + r * Math.cos(a), p.height / 2 + r * Math.sin(a), 14);
          else p.circle(p.map(i, 0, Math.max(1, n - 1), 40, p.width - 40), p.height / 2 + 80 * Math.sin(a), 14);
        }
        p.fill(dark ? 200 : 40);
        p.textSize(14);
        p.text(`dots: ${n}  frame: ${p.frameCount}`, 12, p.height - 12);
      };
    }, container);

    const offResize = ctx.onResize(({ width, height }) => {
      if (width > 0 && height > 0) instance.resizeCanvas(width, height);
    });

    return {
      unmount() {
        offResize();
        panel.destroy();
        randomBtn.remove();
        instance.remove();
      },
    };
  },
};
