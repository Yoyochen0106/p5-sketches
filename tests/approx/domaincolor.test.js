import test from 'node:test';
import assert from 'node:assert/strict';
import { domainColor, errorColor, viridis, hslToRgb, renderField } from '../../lib/domaincolor.js';

test('hslToRgb primaries', () => {
    const [r, g, b] = hslToRgb(0, 1, 0.5);
    assert.ok(Math.abs(r - 255) < 1e-9 && Math.abs(g) < 1e-9 && Math.abs(b) < 1e-9);
    const [r2, g2, b2] = hslToRgb(1 / 3, 1, 0.5);
    assert.ok(Math.abs(g2 - 255) < 1e-9 && Math.abs(r2) < 1e-9 && Math.abs(b2) < 1e-9);
});

test('domainColor: poles white, zeros dark, hue follows the argument', () => {
    assert.deepEqual(domainColor(Infinity, 0), [255, 255, 255]);
    assert.deepEqual(domainColor(NaN, 0), [255, 255, 255]);
    const dark = domainColor(1e-9, 0);
    const bright = domainColor(1e9, 0);
    assert.ok(dark[0] + dark[1] + dark[2] < bright[0] + bright[1] + bright[2]);
    // |w| = 1 on the positive real axis is reddish, on the positive imaginary axis it is not
    const pos = domainColor(1, 0);
    const up = domainColor(0, 1);
    assert.ok(pos[0] > pos[1] && pos[0] > pos[2]);
    assert.ok(up[1] > up[0] || up[2] > up[0]);
});

test('errorColor and viridis are monotone endpoints and clamp', () => {
    assert.deepEqual(viridis(-1), viridis(0));
    assert.deepEqual(viridis(2), viridis(1));
    assert.deepEqual(errorColor(-50), viridis(0));
    assert.deepEqual(errorColor(50), viridis(1));
    assert.deepEqual(errorColor(Infinity), [255, 255, 255]);
});

test('renderField samples pixel centres with y growing upwards', () => {
    const seen = [];
    const view = { xmin: 0, xmax: 2, ymin: 0, ymax: 2 };
    const out = renderField(2, 2, view, (re, im) => { seen.push([re, im]); return [re, im]; }, () => [1, 2, 3]);
    assert.deepEqual(seen, [[0.5, 1.5], [1.5, 1.5], [0.5, 0.5], [1.5, 0.5]]);
    assert.deepEqual([...out.slice(0, 4)], [1, 2, 3, 255]);
});
