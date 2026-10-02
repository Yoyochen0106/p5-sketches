// Small perceptual-ish colour maps for field images. Pure, no DOM.

const MAPS = {
  // dark -> purple -> orange -> pale yellow (field strength)
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
  // dark teal -> green -> yellow (neutral magnitude)
  viridis: [[68, 1, 84], [70, 50, 126], [54, 92, 141], [39, 127, 142], [31, 161, 135], [74, 194, 109], [159, 218, 58], [253, 231, 37]],
  // blue - white - red (signed quantity, centre = 0)
  diverging: [[33, 102, 172], [103, 169, 207], [209, 229, 240], [247, 247, 247], [253, 219, 199], [239, 138, 98], [178, 24, 43]],
  // blue - near-black - red (signed, for dark themes)
  divergingDark: [[70, 150, 255], [30, 80, 170], [20, 28, 52], [18, 20, 24], [60, 22, 30], [170, 50, 55], [255, 120, 90]],
};

/** Names of the available maps. */
export const COLORMAPS = Object.keys(MAPS);

/** Write the colour of map `name` at t in [0, 1] into out (length >= 3, at offset o). */
export function colormapInto(name, t, out, o = 0) {
  const stops = MAPS[name] || MAPS.viridis;
  if (!(t > 0)) t = 0; else if (t > 1) t = 1;
  const f = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const u = f - i;
  const a = stops[i], b = stops[i + 1];
  out[o] = a[0] + (b[0] - a[0]) * u;
  out[o + 1] = a[1] + (b[1] - a[1]) * u;
  out[o + 2] = a[2] + (b[2] - a[2]) * u;
  return out;
}

/** Colour as [r, g, b]. */
export function colormap(name, t) {
  return colormapInto(name, t, [0, 0, 0]);
}

/** Map a magnitude on a log scale between lo and hi to [0, 1]. */
export function logUnit(v, lo, hi) {
  if (!(v > 0) || !(hi > lo) || !(lo > 0)) return 0;
  return Math.min(1, Math.max(0, Math.log(v / lo) / Math.log(hi / lo)));
}
