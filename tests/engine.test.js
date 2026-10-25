'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const E = require('../engine.js');

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || 'value') + ' expected ' + expected + ' got ' + actual);
}

function flatPatch(rgb, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: data };
}

function specimenPatch(options, cx, cy) {
  const sp = E.createSkinSpecimen(Object.assign({ width: 320, height: 400 }, options));
  return E.extractPatch({ width: 320, height: 400, data: sp.data }, cx || 205, cy || 208, 48);
}

describe('sRGB to L*a*b* conversion', () => {
  it('maps white to L* 100 with a* and b* near zero', () => {
    const lab = E.srgbToLab(255, 255, 255);
    close(lab[0], 100, 1e-4);
    close(lab[1], 0, 1e-3);
    close(lab[2], 0, 1e-3);
  });

  it('maps black to L* 0', () => {
    const lab = E.srgbToLab(0, 0, 0);
    close(lab[0], 0, 1e-9);
    close(lab[1], 0, 1e-9);
    close(lab[2], 0, 1e-9);
  });

  it('puts sRGB 119 grey near L* 50 with no chroma', () => {
    const lab = E.srgbToLab(119, 119, 119);
    close(lab[0], 50, 0.1);
    close(Math.hypot(lab[1], lab[2]), 0, 0.01);
  });

  it('matches published D65 values for sRGB red', () => {
    const lab = E.srgbToLab(255, 0, 0);
    close(lab[0], 53.2408, 0.001);
    close(lab[1], 80.0925, 0.001);
    close(lab[2], 67.2032, 0.001);
  });

  it('matches published D65 values for sRGB green and blue', () => {
    const g = E.srgbToLab(0, 255, 0);
    close(g[0], 87.7347, 0.001);
    close(g[1], -86.1827, 0.001);
    close(g[2], 83.1793, 0.001);
    const b = E.srgbToLab(0, 0, 255);
    close(b[0], 32.297, 0.001);
    close(b[1], 79.1875, 0.001);
    close(b[2], -107.8602, 0.001);
  });

  it('uses the linear segment of the sRGB curve at and below 0.04045', () => {
    close(E.srgbChannelToLinear(10), 10 / 255 / 12.92, 1e-12);
    close(E.srgbChannelToLinear(11), Math.pow((11 / 255 + 0.055) / 1.055, 2.4), 1e-12);
  });

  it('inverts gamma expansion', () => {
    for (let c = 0; c <= 255; c += 17) {
      close(E.linearToSrgbChannel(E.srgbChannelToLinear(c)), c, 1e-6);
    }
  });

  it('round trips sRGB through L*a*b*', () => {
    const samples = [[195, 152, 122], [245, 220, 207], [94, 64, 49], [30, 120, 200], [250, 250, 5]];
    samples.forEach((rgb) => {
      const lab = E.srgbToLab(rgb[0], rgb[1], rgb[2]);
      const back = E.labToSrgb(lab[0], lab[1], lab[2]);
      close(back[0], rgb[0], 0.01);
      close(back[1], rgb[1], 0.01);
      close(back[2], rgb[2], 0.01);
    });
  });

  it('clamps out of gamut L*a*b* into 0 to 255', () => {
    const rgb = E.labToSrgb(50, 120, -120);
    rgb.forEach((v) => assert.ok(v >= 0 && v <= 255));
  });

  it('parses 3 and 6 digit hex and rejects junk', () => {
    assert.deepEqual(E.parseHex('#fff'), [255, 255, 255]);
    assert.deepEqual(E.parseHex('C3987A'), [195, 152, 122]);
    assert.equal(E.parseHex('#12345'), null);
    assert.equal(E.parseHex('hello'), null);
    assert.equal(E.parseHex(42), null);
  });

  it('formats hex with rounding and clamping', () => {
    assert.equal(E.rgbToHex(195.4, 151.6, 122), '#c3987a');
    assert.equal(E.rgbToHex(-5, 300, 0), '#00ff00');
  });

  it('computes chroma and hue in degrees', () => {
    const ch = E.chromaHue(0, 10);
    close(ch.chroma, 10, 1e-12);
    close(ch.hue, 90, 1e-9);
    close(E.chromaHue(-1, -1).hue, 225, 1e-9);
  });
});

describe('Individual Typology Angle', () => {
  it('follows arctan((L* - 50) / b*) in degrees', () => {
    close(E.computeItaAngle(66, 23), Math.atan(16 / 23) * 180 / Math.PI, 1e-12);
    close(E.computeItaAngle(50 + 20, 20), 45, 1e-9);
    close(E.computeItaAngle(30, 20), -45, 1e-9);
  });

  it('returns the limit when b* is zero', () => {
    assert.equal(E.computeItaAngle(80, 0), 90);
    assert.equal(E.computeItaAngle(20, 0), -90);
    assert.equal(E.computeItaAngle(50, 0), 0);
  });

  const edges = [
    [55.0001, 'Very Light'],
    [55, 'Light'],
    [41.0001, 'Light'],
    [41, 'Intermediate'],
    [28.0001, 'Intermediate'],
    [28, 'Tan'],
    [10.0001, 'Tan'],
    [10, 'Brown'],
    [-29.9999, 'Brown'],
    [-30, 'Dark']
  ];
  edges.forEach((pair) => {
    it('classifies ITA ' + pair[0] + ' as ' + pair[1], () => {
      assert.equal(E.classifyItaCategory(pair[0]).name, pair[1]);
    });
  });

  it('keeps six bands in order with contiguous limits', () => {
    assert.equal(E.ITA_CATEGORIES.length, 6);
    assert.deepEqual(
      E.ITA_CATEGORIES.map((c) => c.name),
      ['Very Light', 'Light', 'Intermediate', 'Tan', 'Brown', 'Dark']
    );
    for (let i = 0; i < 5; i += 1) assert.equal(E.ITA_CATEGORIES[i].min, E.ITA_CATEGORIES[i + 1].max);
  });
});

describe('Undertone heuristic', () => {
  it('splits Cool, Neutral, Warm and Olive on the a*/b* ratio', () => {
    assert.equal(E.classifyUndertone(15, 15), 'Cool');
    assert.equal(E.classifyUndertone(12, 20), 'Neutral');
    assert.equal(E.classifyUndertone(10, 23), 'Warm');
    assert.equal(E.classifyUndertone(6, 20), 'Olive');
  });

  it('is inclusive at each lower bound', () => {
    assert.equal(E.classifyUndertone(0.72 * 10, 10), 'Cool');
    assert.equal(E.classifyUndertone(0.52 * 10, 10), 'Neutral');
    assert.equal(E.classifyUndertone(0.4 * 10, 10), 'Warm');
    assert.equal(E.classifyUndertone(0.39 * 10, 10), 'Olive');
  });

  it('declines to rate when b* is not positive', () => {
    assert.equal(E.classifyUndertone(10, 0), null);
    assert.equal(E.classifyUndertone(10, -4), null);
  });
});

describe('Calibrated presets', () => {
  const expected = {
    p1: ['Very Light', 'Cool'],
    p3: ['Intermediate', 'Warm'],
    p4: ['Tan', 'Olive'],
    p5: ['Brown', 'Warm'],
    p6: ['Dark', 'Neutral']
  };
  E.PRESETS.forEach((preset) => {
    it(preset.name + ' lands in its stated ITA band and undertone', () => {
      const ita = E.computeItaAngle(preset.lab[0], preset.lab[2]);
      assert.equal(E.classifyItaCategory(ita).name, expected[preset.id][0]);
      assert.equal(E.classifyUndertone(preset.lab[1], preset.lab[2]), expected[preset.id][1]);
    });
  });

  it('has five presets in descending lightness', () => {
    assert.equal(E.PRESETS.length, 5);
    for (let i = 0; i < 4; i += 1) assert.ok(E.PRESETS[i].lab[0] > E.PRESETS[i + 1].lab[0]);
  });
});

describe('CIEDE2000 against Sharma, Wu and Dalal (2005) test data', () => {
  const file = path.join(__dirname, 'fixtures', 'ciede2000testdata.txt');
  const rows = fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));

  it('loads all 34 published pairs', () => {
    assert.equal(rows.length, 34);
    rows.forEach((r) => assert.equal(r.length, 7));
  });

  rows.forEach((r, i) => {
    it('pair ' + (i + 1) + ' gives ' + r[6].toFixed(4), () => {
      const de = E.computeDeltaE2000(r.slice(0, 3), r.slice(3, 6));
      close(de, r[6], 1e-4, 'DeltaE00 for pair ' + (i + 1));
    });
  });

  it('is symmetric in its arguments', () => {
    rows.forEach((r) => {
      const a = E.computeDeltaE2000(r.slice(0, 3), r.slice(3, 6));
      const b = E.computeDeltaE2000(r.slice(3, 6), r.slice(0, 3));
      close(a, b, 1e-9);
    });
  });

  it('is zero for identical colours', () => {
    close(E.computeDeltaE2000([60, 10, 20], [60, 10, 20]), 0, 1e-12);
  });

  it('scales a pure lightness difference by 1 over kL', () => {
    const base = E.computeDeltaE2000([50, 0, 0], [60, 0, 0]);
    const weighted = E.computeDeltaE2000([50, 0, 0], [60, 0, 0], { kL: 2 });
    close(weighted, base / 2, 1e-9);
  });

  it('handles hue on the a* and b* axes (regression pins from the implementation checked on all 34 pairs)', () => {
    close(E.computeDeltaE2000([50, -10, 0], [50, 10, 0]), 26.0273, 1e-4);
    close(E.computeDeltaE2000([50, 0, -10], [50, 0, 10]), 17.4409, 1e-4);
    close(E.computeDeltaE2000([60, -20, 0], [60, -25, 0]), 2.7246, 1e-4);
  });

  it('agrees with CIE76 at small neutral lightness steps within weighting', () => {
    const d76 = E.computeDeltaE76([50, 0, 0], [51, 0, 0]);
    close(d76, 1, 1e-12);
    assert.ok(E.computeDeltaE2000([50, 0, 0], [51, 0, 0]) > 0.9);
  });

  it('describes distances in plain words', () => {
    assert.equal(E.describeDeltaE(0.5), 'Not noticeable');
    assert.equal(E.describeDeltaE(1.5), 'Noticeable only on close inspection');
    assert.equal(E.describeDeltaE(3), 'Noticeable at a glance');
    assert.equal(E.describeDeltaE(4), 'Clearly different');
    assert.equal(E.describeDeltaE(9), 'A different colour');
  });
});

describe('Reference swatches and ranking', () => {
  it('holds exactly 24 swatches', () => {
    assert.equal(E.SWATCHES.length, 24);
  });

  it('splits them 13 foundation, 6 concealer and 5 lip', () => {
    assert.equal(E.swatchesByKind('foundation').length, 13);
    assert.equal(E.swatchesByKind('concealer').length, 6);
    assert.equal(E.swatchesByKind('lip').length, 5);
  });

  it('uses unique ids and unique names', () => {
    assert.equal(new Set(E.SWATCHES.map((s) => s.id)).size, 24);
    assert.equal(new Set(E.SWATCHES.map((s) => s.name)).size, 24);
  });

  it('stores valid hex whose L*a*b* is recomputed from the hex', () => {
    E.SWATCHES.forEach((s) => {
      assert.match(s.hex, /^#[0-9A-F]{6}$/);
      const rgb = E.parseHex(s.hex);
      const lab = E.srgbToLab(rgb[0], rgb[1], rgb[2]);
      close(s.lab[0], lab[0], 1e-9);
    });
  });

  it('orders foundations from light to deep', () => {
    const f = E.swatchesByKind('foundation');
    for (let i = 0; i < f.length - 1; i += 1) assert.ok(f[i].lab[0] > f[i + 1].lab[0], f[i].name);
  });

  it('names no commercial brand', () => {
    const banned = /fenty|mac |nars|maybelline|loreal|estee|dior|chanel|revlon|covergirl/i;
    E.SWATCHES.forEach((s) => assert.doesNotMatch(s.name, banned));
  });

  it('ranks a swatch first against its own colour at distance zero', () => {
    E.swatchesByKind('foundation').forEach((s) => {
      const rows = E.rankShades(s.lab, 'foundation');
      assert.equal(rows[0].swatch.id, s.id);
      close(rows[0].deltaE, 0, 1e-9);
    });
  });

  it('returns rows sorted ascending with ranks 1..n and exactly three tops', () => {
    const rows = E.rankShades([66, 10, 23], 'foundation');
    for (let i = 0; i < rows.length - 1; i += 1) assert.ok(rows[i].deltaE <= rows[i + 1].deltaE);
    assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
    assert.equal(rows.filter((r) => r.top).length, 3);
  });

  it('is deterministic', () => {
    assert.deepEqual(
      E.rankShades([58, 6.5, 20], 'concealer').map((r) => r.swatch.id),
      E.rankShades([58, 6.5, 20], 'concealer').map((r) => r.swatch.id)
    );
  });

  it('lifts the concealer target by the documented offset', () => {
    const t = E.targetLabForKind([60, 10, 20], 'concealer');
    close(t[0], 60 + E.CONCEALER_LIGHTNESS_OFFSET, 1e-12);
    assert.equal(t[1], 10);
  });

  it('builds a darker, redder lip target and never goes below L* 12', () => {
    const t = E.lipTargetLab([66, 10, 23]);
    assert.ok(t[0] < 66 && t[1] > 10);
    assert.equal(E.lipTargetLab([15, 5, 5])[0], 12);
  });

  it('matches each preset to a foundation within a clearly visible distance', () => {
    E.PRESETS.forEach((p) => {
      const best = E.rankShades(p.lab, 'foundation')[0];
      assert.ok(best.deltaE < 4, p.name + ' best ' + best.deltaE.toFixed(2));
    });
  });
});

describe('Seeded noise and the skin specimen', () => {
  it('mulberry32 repeats for a seed and stays in [0, 1)', () => {
    const a = E.mulberry32(42);
    const b = E.mulberry32(42);
    for (let i = 0; i < 50; i += 1) {
      const v = a();
      assert.equal(v, b());
      assert.ok(v >= 0 && v < 1);
    }
    assert.notEqual(E.mulberry32(1)(), E.mulberry32(2)());
  });

  it('hash2 and valueNoise are pure and bounded', () => {
    assert.equal(E.hash2(3, 9, 5), E.hash2(3, 9, 5));
    assert.notEqual(E.hash2(3, 9, 5), E.hash2(4, 9, 5));
    for (let i = 0; i < 40; i += 1) {
      const v = E.valueNoise(i * 0.37, i * 0.91, 7);
      assert.ok(v >= 0 && v <= 1);
    }
  });

  it('pins the noise and specimen output so the deterministic claim cannot drift', () => {
    close(E.hash2(3, 9, 5), 0.10079142451286316, 1e-15);
    close(E.valueNoise(3.3, 4.7, 2), 0.727091260004297, 1e-12);
    close(E.valueNoise(-1.5, 0.25, 9), 0.5953410474066914, 1e-12);
    const s = E.createSkinSpecimen({ width: 48, height: 60, seed: 11, lab: [66, 10, 23] });
    let sum = 0;
    s.data.forEach((v) => {
      sum += v;
    });
    let lips = 0;
    s.lipMask.forEach((v) => {
      lips += v;
    });
    assert.equal(sum, 2058897);
    close(lips, 98.78808164596558, 1e-6);
    assert.deepEqual(Array.from(s.data.slice(0, 8)), [192, 153, 119, 255, 191, 152, 119, 255]);
  });

  it('draws the same specimen for the same seed and a different one otherwise', () => {
    const a = E.createSkinSpecimen({ width: 64, height: 80, seed: 3 });
    const b = E.createSkinSpecimen({ width: 64, height: 80, seed: 3 });
    const c = E.createSkinSpecimen({ width: 64, height: 80, seed: 4 });
    assert.deepEqual(Array.from(a.data), Array.from(b.data));
    assert.notDeepEqual(Array.from(a.data), Array.from(c.data));
  });

  it('is opaque and sized width x height x 4', () => {
    const s = E.createSkinSpecimen({ width: 40, height: 50 });
    assert.equal(s.data.length, 40 * 50 * 4);
    for (let i = 3; i < s.data.length; i += 4) assert.equal(s.data[i], 255);
  });

  it('keeps the lip coverage inside 0..1 and above zero somewhere', () => {
    const s = E.createSkinSpecimen({ width: 160, height: 200 });
    let max = 0;
    s.lipMask.forEach((v) => {
      assert.ok(v >= 0 && v <= 1);
      if (v > max) max = v;
    });
    assert.equal(max, 1);
    assert.equal(E.specimenLipCoverage(0, 0, 160, 200), 0);
  });

  it('measures close to the requested L*a*b* on a cheek patch', () => {
    E.PRESETS.forEach((p) => {
      const a = E.analyzeSkinPatch(specimenPatch({ lab: p.lab }));
      close(a.lab[0], p.lab[0], 4, p.name + ' L*');
      close(a.lab[1], p.lab[1], 3.5, p.name + ' a*');
      close(a.lab[2], p.lab[2], 3.5, p.name + ' b*');
    });
  });
});

describe('Patch analysis', () => {
  it('reads a flat patch exactly with no texture', () => {
    const a = E.analyzeSkinPatch(flatPatch([195, 152, 122], 24, 24));
    const lab = E.srgbToLab(195, 152, 122);
    close(a.lab[0], lab[0], 1e-4);
    close(a.lab[1], lab[1], 1e-4);
    close(a.lab[2], lab[2], 1e-4);
    assert.equal(a.textureRoughness, 0);
    assert.equal(a.poreDensity, 0);
    assert.equal(a.shineRatio, 0);
    assert.equal(a.rednessCoverage, 0);
  });

  it('reports ITA, band and undertone consistently with the mean colour', () => {
    const a = E.analyzeSkinPatch(flatPatch([195, 152, 122], 16, 16));
    close(a.ita, E.computeItaAngle(a.lab[0], a.lab[2]), 1e-9);
    assert.equal(a.category.name, E.classifyItaCategory(a.ita).name);
    assert.equal(a.undertone, E.classifyUndertone(a.lab[1], a.lab[2]));
  });

  it('computes the erythema proxy from the linear R to G ratio', () => {
    const rgb = [200, 140, 120];
    const a = E.analyzeSkinPatch(flatPatch(rgb, 8, 8));
    const r = E.srgbChannelToLinear(rgb[0]);
    const g = E.srgbChannelToLinear(rgb[1]);
    close(a.erythemaIndex, (500 / Math.log10(5)) * Math.log10(r / g), 1e-6);
    close(a.melaninIndex, 100 * Math.log10(1 / r), 1e-6);
  });

  it('gives a darker tone a higher melanin proxy', () => {
    const light = E.analyzeSkinPatch(specimenPatch({ lab: E.PRESETS[0].lab }));
    const deep = E.analyzeSkinPatch(specimenPatch({ lab: E.PRESETS[4].lab }));
    assert.ok(deep.melaninIndex > light.melaninIndex + 30);
  });

  it('raises redness coverage with specimen erythema', () => {
    const calm = E.analyzeSkinPatch(specimenPatch({ erythema: 0 }, 160, 200));
    const flushed = E.analyzeSkinPatch(specimenPatch({ erythema: 1 }, 160, 200));
    assert.ok(flushed.erythemaIndex > calm.erythemaIndex);
  });

  it('raises pore minima with specimen pores', () => {
    const smooth = E.analyzeSkinPatch(specimenPatch({ pores: 0 }));
    const pitted = E.analyzeSkinPatch(specimenPatch({ pores: 1 }));
    assert.ok(pitted.poreDensity > smooth.poreDensity);
    assert.ok(pitted.textureRoughness > smooth.textureRoughness);
  });

  it('raises the shine ratio on a specular highlight', () => {
    const matte = E.analyzeSkinPatch(specimenPatch({ shine: 0, width: 640, height: 800 }, 218, 208));
    const glossy = E.analyzeSkinPatch(specimenPatch({ shine: 1, width: 640, height: 800 }, 218, 208));
    assert.ok(glossy.shineRatio > matte.shineRatio);
  });

  it('measures Laplacian variance on a checkerboard far above a flat patch', () => {
    const w = 16;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = (x + y) % 2 === 0 ? 90 : 200;
        const p = (y * w + x) * 4;
        data[p] = v;
        data[p + 1] = v;
        data[p + 2] = v;
        data[p + 3] = 255;
      }
    }
    const a = E.analyzeSkinPatch({ width: w, height: w, data: data });
    assert.ok(a.textureRoughness > 1000);
    assert.ok(a.roughnessIndex > 99);
  });

  it('counts a single dark pixel as one pore with the exact depth', () => {
    const w = 9;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i += 1) data.set([180, 140, 120, 255], i * 4);
    data.set([60, 40, 30, 255], (4 * w + 4) * 4);
    const a = E.analyzeSkinPatch({ width: w, height: w, data: data });
    close(a.poreDensity, 1000 / 49, 1e-9);
    // L* is held as 32 bit floats, so depth agrees to about 1e-5.
    close(a.poreContrast, E.srgbToLab(180, 140, 120)[0] - E.srgbToLab(60, 40, 30)[0], 1e-4);
  });

  it('does not count the plateau beside a bright pixel as pores, and gets the Laplacian variance exactly', () => {
    const w = 9;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i += 1) data.set([100, 100, 100, 255], i * 4);
    data.set([200, 200, 200, 255], (4 * w + 4) * 4);
    const a = E.analyzeSkinPatch({ width: w, height: w, data: data });
    const delta = E.srgbToLab(200, 200, 200)[0] - E.srgbToLab(100, 100, 100)[0];
    assert.equal(a.poreDensity, 0);
    close(a.textureRoughness, (20 * delta * delta) / 49, 1e-3);
  });

  it('skips transparent pixels', () => {
    const p = flatPatch([195, 152, 122], 8, 8);
    for (let i = 0; i < 32; i += 1) p.data[i * 4 + 3] = 0;
    assert.equal(E.analyzeSkinPatch(p).pixels, 32);
  });

  it('rejects malformed patches', () => {
    assert.throws(() => E.analyzeSkinPatch(null), TypeError);
    assert.throws(() => E.analyzeSkinPatch({ width: 0, height: 4, data: new Uint8ClampedArray(0) }), TypeError);
    assert.throws(() => E.analyzeSkinPatch({ width: 2, height: 2, data: new Uint8ClampedArray(8) }), RangeError);
    const clear = flatPatch([1, 2, 3], 4, 4);
    for (let i = 0; i < 16; i += 1) clear.data[i * 4 + 3] = 0;
    assert.throws(() => E.analyzeSkinPatch(clear), RangeError);
  });

  it('extracts a clamped window from an image', () => {
    const img = flatPatch([10, 20, 30], 40, 30);
    const p = E.extractPatch(img, 2, 2, 16);
    assert.equal(p.width, 16);
    assert.equal(p.x, 0);
    assert.equal(p.y, 0);
    const q = E.extractPatch(img, 39, 29, 16);
    assert.equal(q.x, 24);
    assert.equal(q.y, 14);
  });

  it('turns analysis into 0 to 100 scores where rougher skin scores lower', () => {
    const calm = E.localSkinScores(E.analyzeSkinPatch(specimenPatch({ pores: 0 })));
    const rough = E.localSkinScores(E.analyzeSkinPatch(specimenPatch({ pores: 1 })));
    Object.values(calm.scores).forEach((v) => assert.ok(v >= 0 && v <= 100));
    assert.ok(rough.scores.hd_texture < calm.scores.hd_texture);
    assert.deepEqual(calm.unavailable, ['hd_wrinkle', 'hd_acne', 'hd_moisture', 'hd_radiance']);
  });

  it('shapes local scores like normalised concerns', () => {
    const concerns = E.localConcerns(E.analyzeSkinPatch(specimenPatch({})));
    assert.equal(concerns.length, 4);
    concerns.forEach((c) => {
      assert.equal(c.region, 'whole');
      assert.ok(['Maintain', 'Watch', 'Priority'].includes(c.band));
    });
  });
});

describe('Neighbourhood maths', () => {
  it('keeps a constant image constant under box blur, edges included', () => {
    const w = 11;
    const h = 7;
    const out = E.boxBlur(new Float32Array(w * h).fill(0.25), w, h, 3);
    out.forEach((v) => close(v, 0.25, 1e-6));
  });

  it('spreads an impulse into a normalised box and conserves its mass', () => {
    const w = 15;
    const h = 15;
    const src = new Float32Array(w * h);
    src[7 * w + 7] = 1;
    const out = E.boxBlur(src, w, h, 2);
    let sum = 0;
    out.forEach((v) => {
      sum += v;
    });
    close(sum, 1, 1e-5);
    close(out[7 * w + 7], 1 / 25, 1e-6);
    close(out[5 * w + 9], 1 / 25, 1e-6);
    assert.equal(out[4 * w + 7], 0);
    assert.equal(out[7 * w + 10], 0);
  });

  it('matches a brute force count of pores and Laplacian variance on a textured patch', () => {
    const sp = E.createSkinSpecimen({ width: 160, height: 200, pores: 1, seed: 5 });
    const patch = E.extractPatch({ width: 160, height: 200, data: sp.data }, 80, 100, 40);
    const a = E.analyzeSkinPatch(patch);
    const w = patch.width;
    const h = patch.height;
    const L = [];
    for (let y = 0; y < h; y += 1) {
      L.push([]);
      for (let x = 0; x < w; x += 1) {
        const p = (y * w + x) * 4;
        L[y].push(Math.fround(E.srgbToLab(patch.data[p], patch.data[p + 1], patch.data[p + 2])[0]));
      }
    }
    let pores = 0;
    let depth = 0;
    let lapSum = 0;
    let lapSq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const around = [];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) if (dy !== 0 || dx !== 0) around.push(L[y + dy][x + dx]);
        }
        const c = L[y][x];
        const mean = around.reduce((p, q) => p + q, 0) / 8;
        if (around.every((v) => c < v) && mean - c >= 2) {
          pores += 1;
          depth += mean - c;
        }
        const lap = L[y - 1][x] + L[y + 1][x] + L[y][x - 1] + L[y][x + 1] - 4 * c;
        lapSum += lap;
        lapSq += lap * lap;
        n += 1;
      }
    }
    assert.ok(pores > 5, 'the patch should contain pores to compare');
    close(a.poreDensity, (pores / n) * 1000, 1e-6);
    close(a.poreContrast, depth / pores, 1e-3);
    close(a.textureRoughness, lapSq / n - (lapSum / n) * (lapSum / n), 1e-2);
  });
});

describe('Try on rendering', () => {
  const sp = E.createSkinSpecimen({ width: 96, height: 120, lab: [66, 10, 23] });
  const img = { width: 96, height: 120, data: sp.data };
  const solid = new Float32Array(96 * 120).fill(1);

  it('scores preset skin colours as skin and rejects blue, white and black', () => {
    E.PRESETS.forEach((p) => {
      const rgb = E.labToSrgb(p.lab[0], p.lab[1], p.lab[2]);
      assert.ok(E.skinMaskAlpha(rgb[0], rgb[1], rgb[2]) > 0.9, p.name);
    });
    assert.equal(E.skinMaskAlpha(0, 0, 255), 0);
    assert.equal(E.skinMaskAlpha(255, 255, 255), 0);
    assert.equal(E.skinMaskAlpha(0, 0, 0), 0);
  });

  it('leaves pixels unchanged at zero foundation coverage', () => {
    const out = E.applyFoundation(img, E.SWATCHES[0].lab, { coverage: 0, mask: solid, meanLab: [66, 10, 23] });
    for (let i = 0; i < out.data.length; i += 1) assert.ok(Math.abs(out.data[i] - img.data[i]) <= 1);
  });

  it('moves the mean toward the shade at full coverage', () => {
    const shade = E.swatchesByKind('foundation').find((s) => s.name === 'Espresso');
    const before = E.analyzeSkinPatch(img);
    const out = E.applyFoundation(img, shade.lab, { coverage: 1, glow: 0, mask: solid, meanLab: before.lab });
    const after = E.analyzeSkinPatch(out);
    assert.ok(E.computeDeltaE2000(after.lab, shade.lab) < E.computeDeltaE2000(before.lab, shade.lab) / 3);
  });

  it('softens local variation as coverage rises', () => {
    const shade = E.SWATCHES[5];
    const before = E.analyzeSkinPatch(img);
    const out = E.applyFoundation(img, shade.lab, { coverage: 1, mask: solid, meanLab: before.lab });
    assert.ok(E.analyzeSkinPatch(out).textureRoughness < before.textureRoughness);
  });

  it('keeps alpha and does not touch masked-out pixels', () => {
    const none = new Float32Array(96 * 120);
    const out = E.applyFoundation(img, E.SWATCHES[0].lab, { coverage: 1, mask: none, meanLab: [66, 10, 23] });
    assert.deepEqual(Array.from(out.data), Array.from(img.data));
  });

  it('colours only the lip mask', () => {
    const lip = E.swatchesByKind('lip')[3];
    const out = E.applyLipColor(img, sp.lipMask, lip.lab, { intensity: 1, finish: 'matte' });
    let changedInside = 0;
    for (let i = 0; i < sp.lipMask.length; i += 1) {
      const same = out.data[i * 4] === img.data[i * 4] && out.data[i * 4 + 1] === img.data[i * 4 + 1];
      if (sp.lipMask[i] === 0) assert.ok(same);
      else if (!same) changedInside += 1;
    }
    assert.ok(changedInside > 50);
  });

  it('gives matte, satin and gloss different finishes, with gloss the brightest', () => {
    const lip = E.swatchesByKind('lip')[1];
    const lipLightness = (finish) => {
      const out = E.applyLipColor(img, sp.lipMask, lip.lab, { intensity: 1, finish: finish });
      let max = 0;
      let sum = 0;
      sp.lipMask.forEach((v, i) => {
        if (v === 1) {
          const L = E.srgbToLab(out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2])[0];
          sum += L;
          if (L > max) max = L;
        }
      });
      return { max: max, sum: sum };
    };
    const matte = lipLightness('matte');
    const satin = lipLightness('satin');
    const gloss = lipLightness('gloss');
    assert.ok(gloss.max > satin.max && satin.max > matte.max, 'highlights ' + [matte.max, satin.max, gloss.max].join(', '));
    assert.notEqual(matte.sum, satin.sum);
    assert.notEqual(satin.sum, gloss.sum);
  });

  it('pulls lip pixels toward the lip shade', () => {
    const lip = E.swatchesByKind('lip')[3];
    const out = E.applyLipColor(img, sp.lipMask, lip.lab, { intensity: 1, finish: 'satin' });
    let best = -1;
    sp.lipMask.forEach((v, i) => {
      if (v === 1 && best < 0) best = i;
    });
    const before = E.srgbToLab(img.data[best * 4], img.data[best * 4 + 1], img.data[best * 4 + 2]);
    const after = E.srgbToLab(out.data[best * 4], out.data[best * 4 + 1], out.data[best * 4 + 2]);
    assert.ok(Math.abs(after[1] - lip.lab[1]) < Math.abs(before[1] - lip.lab[1]));
  });

  it('draws a chromophore map the same size, opaque, with carmine on red blotches', () => {
    const map = E.buildChromophoreMap(img);
    assert.equal(map.data.length, img.data.length);
    for (let i = 3; i < map.data.length; i += 4) assert.equal(map.data[i], 255);
    let reddest = 0;
    for (let i = 0; i < map.data.length; i += 4) reddest = Math.max(reddest, map.data[i] - map.data[i + 2]);
    assert.ok(reddest > 40);
  });
});
