/*
 * DermaVTO engine
 * Colorimetry, skin optics, shade ranking and YouCam API payload helpers.
 * UMD: loads as window.DermaVTO in the browser and as a CommonJS module in Node.
 *
 * Everything here is cosmetic and educational. Nothing in this file is a
 * clinical measurement, and none of it is a medical assessment of skin.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DermaVTO = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENGINE_VERSION = '1.0.0';

  /* ------------------------------------------------------------------ */
  /* Colour science: sRGB, CIE XYZ (D65), CIE L*a*b*                      */
  /* ------------------------------------------------------------------ */

  const D65 = Object.freeze({ X: 0.95047, Y: 1.0, Z: 1.08883 });
  const LAB_EPSILON = 216 / 24389;
  const LAB_KAPPA = 24389 / 27;
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  const LINEAR_LUT = (function () {
    const lut = new Float64Array(256);
    for (let i = 0; i < 256; i += 1) lut[i] = srgbChannelToLinear(i);
    return lut;
  })();

  /** IEC 61966-2-1 gamma expansion for one 0..255 channel. */
  function srgbChannelToLinear(c8) {
    const c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  /** Inverse of the above. Input is linear light, output is a 0..255 float. */
  function linearToSrgbChannel(lin) {
    const l = lin < 0 ? 0 : lin > 1 ? 1 : lin;
    const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    return c * 255;
  }

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function labF(t) {
    return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
  }

  function labFInverse(f) {
    const f3 = f * f * f;
    return f3 > LAB_EPSILON ? f3 : (116 * f - 16) / LAB_KAPPA;
  }

  function linearRgbToXyz(r, g, b) {
    return [
      0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
      0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
      0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    ];
  }

  function xyzToLinearRgb(x, y, z) {
    return [
      3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
      -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
      0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    ];
  }

  function xyzToLab(x, y, z) {
    const fx = labF(x / D65.X);
    const fy = labF(y / D65.Y);
    const fz = labF(z / D65.Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labToXyz(L, a, b) {
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    return [labFInverse(fx) * D65.X, labFInverse(fy) * D65.Y, labFInverse(fz) * D65.Z];
  }

  function linearToLab(rl, gl, bl) {
    const xyz = linearRgbToXyz(rl, gl, bl);
    return xyzToLab(xyz[0], xyz[1], xyz[2]);
  }

  /** sRGB (0..255 per channel) to CIE L*a*b* under D65. */
  function srgbToLab(r, g, b) {
    return linearToLab(
      srgbChannelToLinear(r),
      srgbChannelToLinear(g),
      srgbChannelToLinear(b)
    );
  }

  /** CIE L*a*b* (D65) to clamped sRGB floats on 0..255. */
  function labToSrgb(L, a, b) {
    const xyz = labToXyz(L, a, b);
    const lin = xyzToLinearRgb(xyz[0], xyz[1], xyz[2]);
    return [
      linearToSrgbChannel(lin[0]),
      linearToSrgbChannel(lin[1]),
      linearToSrgbChannel(lin[2])
    ];
  }

  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHex(r, g, b) {
    const part = function (v) {
      return Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    };
    return '#' + part(r) + part(g) + part(b);
  }

  function labToHex(L, a, b) {
    const rgb = labToSrgb(L, a, b);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  function chromaHue(a, b) {
    let h = Math.atan2(b, a) * DEG;
    if (h < 0) h += 360;
    return { chroma: Math.hypot(a, b), hue: h };
  }

  /* ------------------------------------------------------------------ */
  /* Individual Typology Angle and undertone                              */
  /* ------------------------------------------------------------------ */

  /**
   * ITA in degrees: arctan((L* - 50) / b*) * 180 / pi.
   * With b* = 0 the quotient is undefined, so the limit is returned:
   * +90 above L* 50, -90 below, 0 at exactly 50.
   */
  function computeItaAngle(L, b) {
    if (b === 0) {
      if (L > 50) return 90;
      if (L < 50) return -90;
      return 0;
    }
    return Math.atan((L - 50) / b) * DEG;
  }

  /*
   * Six ITA bands. Thresholds follow Chardon et al. (1991); the six band names
   * follow the labels commonly tabulated from Del Bino et al. (2006).
   * Lower bound is exclusive, so an ITA of exactly 55 is Light.
   */
  const ITA_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'very-light', name: 'Very Light', min: 55, max: 90, index: 1 }),
    Object.freeze({ id: 'light', name: 'Light', min: 41, max: 55, index: 2 }),
    Object.freeze({ id: 'intermediate', name: 'Intermediate', min: 28, max: 41, index: 3 }),
    Object.freeze({ id: 'tan', name: 'Tan', min: 10, max: 28, index: 4 }),
    Object.freeze({ id: 'brown', name: 'Brown', min: -30, max: 10, index: 5 }),
    Object.freeze({ id: 'dark', name: 'Dark', min: -90, max: -30, index: 6 })
  ]);

  function classifyItaCategory(ita) {
    if (ita > 55) return ITA_CATEGORIES[0];
    if (ita > 41) return ITA_CATEGORIES[1];
    if (ita > 28) return ITA_CATEGORIES[2];
    if (ita > 10) return ITA_CATEGORIES[3];
    if (ita > -30) return ITA_CATEGORIES[4];
    return ITA_CATEGORIES[5];
  }

  /*
   * Undertone is a HEURISTIC. No standard defines it. The ratio r = a* / b*
   * separates pinker skin (high r) from yellower skin (low r). The cut points
   * below are our own and are tuned only to be monotonic and stable.
   */
  const UNDERTONE_CUTS = Object.freeze({ cool: 0.72, neutral: 0.52, warm: 0.4 });

  function classifyUndertone(a, b) {
    if (!(b > 0)) return null;
    const r = a / b;
    if (r >= UNDERTONE_CUTS.cool) return 'Cool';
    if (r >= UNDERTONE_CUTS.neutral) return 'Neutral';
    if (r >= UNDERTONE_CUTS.warm) return 'Warm';
    return 'Olive';
  }

  /* ------------------------------------------------------------------ */
  /* CIE colour difference                                                 */
  /* ------------------------------------------------------------------ */

  function computeDeltaE76(lab1, lab2) {
    return Math.hypot(lab1[0] - lab2[0], lab1[1] - lab2[1], lab1[2] - lab2[2]);
  }

  function hueDegrees(b, ap) {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) * DEG;
    return h < 0 ? h + 360 : h;
  }

  /**
   * CIEDE2000, following Sharma, Wu and Dalal (2005), section 2.1.
   * lab1 and lab2 are [L*, a*, b*]. kL, kC, kH default to 1.
   */
  function computeDeltaE2000(lab1, lab2, weights) {
    const w = weights || {};
    const kL = w.kL === undefined ? 1 : w.kL;
    const kC = w.kC === undefined ? 1 : w.kC;
    const kH = w.kH === undefined ? 1 : w.kH;
    const L1 = lab1[0];
    const a1 = lab1[1];
    const b1 = lab1[2];
    const L2 = lab2[0];
    const a2 = lab2[1];
    const b2 = lab2[2];

    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const Cbar = (C1 + C2) / 2;
    const Cbar7 = Math.pow(Cbar, 7);
    const pow25 = Math.pow(25, 7);
    const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + pow25)));
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const h1p = hueDegrees(b1, a1p);
    const h2p = hueDegrees(b2, a2p);

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    const chromaProduct = C1p * C2p;
    let dhp = 0;
    if (chromaProduct !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(chromaProduct) * Math.sin((dhp / 2) * RAD);

    const Lbarp = (L1 + L2) / 2;
    const Cbarp = (C1p + C2p) / 2;
    let hbarp;
    if (chromaProduct === 0) {
      hbarp = h1p + h2p;
    } else if (Math.abs(h1p - h2p) <= 180) {
      hbarp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      hbarp = (h1p + h2p + 360) / 2;
    } else {
      hbarp = (h1p + h2p - 360) / 2;
    }

    const T =
      1 -
      0.17 * Math.cos((hbarp - 30) * RAD) +
      0.24 * Math.cos(2 * hbarp * RAD) +
      0.32 * Math.cos((3 * hbarp + 6) * RAD) -
      0.2 * Math.cos((4 * hbarp - 63) * RAD);
    const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    const Cbarp7 = Math.pow(Cbarp, 7);
    const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + pow25));
    const lSq = Math.pow(Lbarp - 50, 2);
    const Sl = 1 + (0.015 * lSq) / Math.sqrt(20 + lSq);
    const Sc = 1 + 0.045 * Cbarp;
    const Sh = 1 + 0.015 * Cbarp * T;
    const Rt = -Math.sin(2 * dTheta * RAD) * Rc;

    const tL = dLp / (kL * Sl);
    const tC = dCp / (kC * Sc);
    const tH = dHp / (kH * Sh);
    return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
  }

  /** Common rule-of-thumb wording for a CIEDE2000 distance. */
  function describeDeltaE(de) {
    if (de < 1) return 'Not noticeable';
    if (de < 2) return 'Noticeable only on close inspection';
    if (de < 3.5) return 'Noticeable at a glance';
    if (de < 5) return 'Clearly different';
    return 'A different colour';
  }

  /* ------------------------------------------------------------------ */
  /* Reference swatches and shade ranking                                  */
  /* ------------------------------------------------------------------ */

  /*
   * 24 reference colours made for this project. Each was specified in
   * L*a*b* over the range skin and lips actually span, then stored as plain
   * sRGB hex with a generic name. They are not measurements of any commercial
   * product. L*a*b* is recomputed from the hex at load time.
   */
  const SWATCH_DEFS = [
    ['f01', 'foundation', 'Porcelain', '#E8C5B7'],
    ['f02', 'foundation', 'Ivory', '#DEB8A6'],
    ['f03', 'foundation', 'Vanilla', '#D2AC94'],
    ['f04', 'foundation', 'Honey', '#C59B79'],
    ['f05', 'foundation', 'Almond', '#BD9A76'],
    ['f06', 'foundation', 'Caramel', '#BD8F6C'],
    ['f07', 'foundation', 'Cinnamon', '#A58465'],
    ['f08', 'foundation', 'Amber', '#A37551'],
    ['f09', 'foundation', 'Walnut', '#946B48'],
    ['f10', 'foundation', 'Chestnut', '#895B3D'],
    ['f11', 'foundation', 'Cocoa', '#795038'],
    ['f12', 'foundation', 'Mocha', '#684633'],
    ['f13', 'foundation', 'Espresso', '#583C2D'],
    ['c01', 'concealer', 'Halo Light', '#E7C5B2'],
    ['c02', 'concealer', 'Halo Soft', '#D3AB91'],
    ['c03', 'concealer', 'Halo Medium', '#BD9370'],
    ['c04', 'concealer', 'Halo Tan', '#A77A55'],
    ['c05', 'concealer', 'Halo Deep', '#8D6141'],
    ['c06', 'concealer', 'Halo Rich', '#6B4834'],
    ['l01', 'lip', 'Rose Nude', '#D68489'],
    ['l02', 'lip', 'Terracotta', '#BB6358'],
    ['l03', 'lip', 'Brick', '#9B4C41'],
    ['l04', 'lip', 'Garnet', '#7C2C26'],
    ['l05', 'lip', 'Plum', '#591A23']
  ];

  const SWATCHES = Object.freeze(
    SWATCH_DEFS.map(function (def) {
      const rgb = parseHex(def[3]);
      const lab = srgbToLab(rgb[0], rgb[1], rgb[2]);
      return Object.freeze({
        id: def[0],
        kind: def[1],
        name: def[2],
        hex: def[3],
        lab: Object.freeze(lab),
        ita: computeItaAngle(lab[0], lab[2]),
        undertone: classifyUndertone(lab[1], lab[2])
      });
    })
  );

  function swatchesByKind(kind) {
    return SWATCHES.filter(function (s) {
      return s.kind === kind;
    });
  }

  /* Heuristic offsets used to turn a skin sample into a target for each kind. */
  const CONCEALER_LIGHTNESS_OFFSET = 3;

  /**
   * Styling heuristic, not a measurement: a lip target that sits darker and
   * redder than the skin sample at roughly the same hue family.
   */
  function lipTargetLab(skinLab) {
    return [Math.max(skinLab[0] - 14, 12), skinLab[1] + 22, skinLab[2] - 2];
  }

  function targetLabForKind(skinLab, kind) {
    if (kind === 'concealer') return [skinLab[0] + CONCEALER_LIGHTNESS_OFFSET, skinLab[1], skinLab[2]];
    if (kind === 'lip') return lipTargetLab(skinLab);
    return [skinLab[0], skinLab[1], skinLab[2]];
  }

  /** Rank the reference swatches of one kind by CIEDE2000 to the target. */
  function rankShades(skinLab, kind) {
    const target = targetLabForKind(skinLab, kind);
    const rows = swatchesByKind(kind).map(function (swatch) {
      const de = computeDeltaE2000(target, swatch.lab);
      return { swatch: swatch, deltaE: de, label: describeDeltaE(de) };
    });
    rows.sort(function (p, q) {
      return p.deltaE - q.deltaE || (p.swatch.id < q.swatch.id ? -1 : 1);
    });
    rows.forEach(function (row, i) {
      row.rank = i + 1;
      row.top = i < 3;
    });
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* Seeded noise and the procedural skin specimen                         */
  /* ------------------------------------------------------------------ */

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function valueNoise(x, y, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = hash2(ix, iy, seed);
    const n10 = hash2(ix + 1, iy, seed);
    const n01 = hash2(ix, iy + 1, seed);
    const n11 = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
  }

  function fbm(x, y, seed, octaves) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < octaves; i += 1) {
      sum += amp * valueNoise(fx, fy, seed + i * 31);
      norm += amp;
      amp *= 0.5;
      fx *= 2.03;
      fy *= 2.03;
    }
    return sum / norm;
  }

  /**
   * Soft lip shape in width units, so it keeps its proportions at any size.
   * Returns coverage 0..1 for a pixel at (x, y) in a width x height canvas.
   */
  function specimenLipCoverage(x, y, width, height) {
    const X = (x - width * 0.5) / width;
    const Y = (y - height * 0.78) / width;
    const halfWidth = 0.26;
    const t = X / halfWidth;
    if (t <= -1 || t >= 1) return 0;
    const shrink = 1 - t * t;
    const bow =
      1 +
      0.45 * Math.exp(-Math.pow((Math.abs(t) - 0.3) / 0.16, 2)) -
      0.4 * Math.exp(-Math.pow(t / 0.1, 2));
    const upper = 0.05 * Math.pow(shrink, 0.8) * bow;
    const lower = 0.07 * Math.pow(shrink, 0.75);
    if (Y < 0) return clamp((upper + Y) / 0.006, 0, 1);
    return clamp((lower - Y) / 0.008, 0, 1);
  }

  /**
   * Procedural skin specimen. It is a texture study (shading, pores, mottled
   * redness, pigment spots, a specular highlight and a lip shape), not a
   * portrait of any person. Deterministic for a given seed.
   * Returns { width, height, data, lipMask }.
   */
  function createSkinSpecimen(options) {
    const o = Object.assign(
      { width: 320, height: 400, lab: [66, 12, 22], seed: 7, erythema: 0.5, pigment: 0.4, pores: 0.5, shine: 0.35 },
      options
    );
    const w = o.width;
    const h = o.height;
    const data = new Uint8ClampedArray(w * h * 4);
    const lipMask = new Float32Array(w * h);
    const baseL = o.lab[0];
    const baseA = o.lab[1];
    const baseB = o.lab[2];
    const lipL = Math.max(baseL - 13, 10);
    const lipA = baseA + 13;
    const lipB = baseB - 4;
    const scale = w / 640;
    const poreCell = Math.max(3, 7 * scale);
    const poreRadius = poreCell * 0.3;
    const seed = o.seed | 0;

    for (let y = 0; y < h; y += 1) {
      const v = y / h;
      for (let x = 0; x < w; x += 1) {
        const u = x / w;
        const i = y * w + x;

        // Broad lighting falloff from an upper left source.
        const lr = Math.hypot(u - 0.38, (v - 0.3) * (h / w)) / 0.9;
        let L = baseL + 7 * (0.5 - clamp(lr, 0, 1));
        let a = baseA;
        let b = baseB;

        // Mottled redness (haemoglobin-like), slow and blotchy.
        const redField = fbm(u * 3.4, v * 3.4 * (h / w), seed + 11, 3);
        const red = smoothstep(0.5, 0.78, redField) * o.erythema;
        a += 7.5 * red;
        b -= 0.8 * red;
        L -= 1.4 * red;

        // Small pigment spots (melanin-like).
        const spotField = fbm(u * 22, v * 22 * (h / w), seed + 23, 2);
        const spot = smoothstep(0.7, 0.86, spotField) * o.pigment;
        L -= 6 * spot;
        b += 3 * spot;
        a += 1.4 * spot;

        // Pores: one jittered pit per cell with a seeded presence chance.
        const cx = Math.floor(x / poreCell);
        const cy = Math.floor(y / poreCell);
        if (hash2(cx, cy, seed + 41) < 0.35 + 0.5 * o.pores) {
          const px = (cx + 0.3 + 0.4 * hash2(cx, cy, seed + 43)) * poreCell;
          const py = (cy + 0.3 + 0.4 * hash2(cx, cy, seed + 47)) * poreCell;
          const d = Math.hypot(x - px, y - py) / poreRadius;
          if (d < 1) {
            const pit = (1 - d) * (1 - d);
            L -= (3 + 4 * o.pores) * pit;
            a += 0.8 * pit;
          }
        }

        // Fine grain.
        L += (hash2(x, y, seed + 99) - 0.5) * 1.6;

        // Specular highlight: raises L* and drains chroma.
        const sr = Math.hypot(u - 0.34, (v - 0.26) * (h / w));
        const spec = o.shine * Math.exp(-(sr * sr) / (2 * 0.09 * 0.09));
        L += 16 * spec;
        a *= 1 - 0.65 * spec;
        b *= 1 - 0.65 * spec;

        // Lips.
        const cover = specimenLipCoverage(x, y, w, h);
        if (cover > 0) {
          const X = (x - w * 0.5) / w;
          const Y = (y - h * 0.78) / w;
          let lL = lipL + 1.6 * Math.sin(X * 950 + 5 * fbm(u * 6, v * 6, seed + 61, 2));
          lL -= 8 * Math.exp(-Math.pow(Y / 0.0025, 2));
          lL += 10 * o.shine * Math.exp(-Math.pow(X / 0.07, 2) - Math.pow((Y - 0.035) / 0.012, 2));
          L = lerp(L, lL, cover);
          a = lerp(a, lipA, cover);
          b = lerp(b, lipB, cover);
          lipMask[i] = cover;
        }

        const rgb = labToSrgb(L, a, b);
        const p = i * 4;
        data[p] = rgb[0];
        data[p + 1] = rgb[1];
        data[p + 2] = rgb[2];
        data[p + 3] = 255;
      }
    }
    return { width: w, height: h, data: data, lipMask: lipMask };
  }

  /** Copy a square window of RGBA pixels, clamped to the image bounds. */
  function extractPatch(image, cx, cy, size) {
    const half = Math.floor(size / 2);
    const x0 = clamp(Math.round(cx) - half, 0, Math.max(0, image.width - size));
    const y0 = clamp(Math.round(cy) - half, 0, Math.max(0, image.height - size));
    const w = Math.min(size, image.width);
    const h = Math.min(size, image.height);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      const src = ((y0 + y) * image.width + x0) * 4;
      data.set(image.data.subarray(src, src + w * 4), y * w * 4);
    }
    return { width: w, height: h, data: data, x: x0, y: y0 };
  }

  /* ------------------------------------------------------------------ */
  /* Patch analysis: tone, chromophore proxies, texture                     */
  /* ------------------------------------------------------------------ */

  const MEXAMETER_STYLE_SCALE = 500 / Math.log10(5);
  const ROUGHNESS_SCALE = 40;
  const PORE_DEPTH_THRESHOLD = 2;
  const PORE_DENSITY_SCALE = 60;
  const REDNESS_EXCESS = 0.04;
const SHINE_LIFT = 2;
const SHINE_CHROMA_KEEP = 0.9;

  function checkPatch(patch) {
    if (!patch || !(patch.width > 0) || !(patch.height > 0) || !patch.data) {
      throw new TypeError('patch must be { width, height, data } with positive size');
    }
    if (patch.data.length !== patch.width * patch.height * 4) {
      throw new RangeError('patch.data length must equal width * height * 4');
    }
  }

  /**
   * Optical analysis of an RGBA patch. All indices are approximations from
   * three-channel colour, not spectral measurements.
   *  - erythemaIndex: scaled log10 of linear R over linear G, a two-band
   *    reflectance proxy for haemoglobin. It rises with melanin too.
   *  - rednessCoverage: share of pixels whose log10(R/G) sits above the patch
   *    median by REDNESS_EXCESS. Independent of overall depth of tone.
   *  - melaninIndex: 100 * log10(1 / linear R), a red-band absorbance proxy.
   *  - textureRoughness: variance of the 3x3 Laplacian of L*.
   *  - poreDensity: local L* minima per 1000 pixels, poreContrast their mean depth.
   *  - shineRatio: share of pixels brighter than the patch mean by SHINE_LIFT L* units
   *    that have also lost chroma, which is how specular reflection looks.
   */
  function analyzeSkinPatch(patch) {
    checkPatch(patch);
    const w = patch.width;
    const h = patch.height;
    const n = w * h;
    const Ls = new Float32Array(n);
    const logRG = new Float32Array(n);
    const chromaArr = new Float32Array(n);
    const valid = new Uint8Array(n);
    let count = 0;
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    let sumR = 0;
    let sumG = 0;
    let sumBl = 0;
    let sumChroma = 0;

    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      if (patch.data[p + 3] < 128) continue;
      const rl = LINEAR_LUT[patch.data[p]];
      const gl = LINEAR_LUT[patch.data[p + 1]];
      const bl = LINEAR_LUT[patch.data[p + 2]];
      const lab = linearToLab(rl, gl, bl);
      valid[i] = 1;
      count += 1;
      Ls[i] = lab[0];
      sumL += lab[0];
      sumA += lab[1];
      sumB += lab[2];
      sumR += rl;
      sumG += gl;
      sumBl += bl;
      logRG[i] = Math.log10(Math.max(rl, 1e-4) / Math.max(gl, 1e-4));
      chromaArr[i] = Math.hypot(lab[1], lab[2]);
      sumChroma += chromaArr[i];
    }
    if (count === 0) throw new RangeError('patch has no opaque pixels');

    const meanLab = [sumL / count, sumA / count, sumB / count];
    const meanR = sumR / count;
    const meanG = sumG / count;
    const ita = computeItaAngle(meanLab[0], meanLab[2]);
    const category = classifyItaCategory(ita);
    const ch = chromaHue(meanLab[1], meanLab[2]);

    const erythemaIndex = MEXAMETER_STYLE_SCALE * Math.log10(Math.max(meanR, 1e-4) / Math.max(meanG, 1e-4));
    const melaninIndex = 100 * Math.log10(1 / Math.max(meanR, 1e-4));

    // Redness coverage against the patch median of log10(R/G).
    const logs = [];
    for (let i = 0; i < n; i += 1) if (valid[i]) logs.push(logRG[i]);
    logs.sort(function (p, q) {
      return p - q;
    });
    const median = logs[Math.floor(logs.length / 2)];
    let redCount = 0;
    for (let i = 0; i < n; i += 1) if (valid[i] && logRG[i] > median + REDNESS_EXCESS) redCount += 1;
    const rednessCoverage = redCount / count;

    // Shine: a specular pixel is brighter than the patch and has lost chroma.
    const meanChroma = sumChroma / count;
    let shineCount = 0;
    for (let i = 0; i < n; i += 1) {
      if (valid[i] && Ls[i] > meanLab[0] + SHINE_LIFT && chromaArr[i] < SHINE_CHROMA_KEEP * meanChroma) {
        shineCount += 1;
      }
    }
    const shineRatio = shineCount / count;

    // Laplacian variance and pore minima on the interior of the L* grid.
    let lapSum = 0;
    let lapSq = 0;
    let lapN = 0;
    let poreCount = 0;
    let poreDepth = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const c = Ls[i];
        const up = Ls[i - w];
        const down = Ls[i + w];
        const left = Ls[i - 1];
        const right = Ls[i + 1];
        const lap = up + down + left + right - 4 * c;
        lapSum += lap;
        lapSq += lap * lap;
        lapN += 1;
        const ul = Ls[i - w - 1];
        const ur = Ls[i - w + 1];
        const dl = Ls[i + w - 1];
        const dr = Ls[i + w + 1];
        const neighbourMean = (up + down + left + right + ul + ur + dl + dr) / 8;
        const isMin = c < up && c < down && c < left && c < right && c < ul && c < ur && c < dl && c < dr;
        if (isMin && neighbourMean - c >= PORE_DEPTH_THRESHOLD) {
          poreCount += 1;
          poreDepth += neighbourMean - c;
        }
      }
    }
    const lapMean = lapN > 0 ? lapSum / lapN : 0;
    const textureRoughness = lapN > 0 ? lapSq / lapN - lapMean * lapMean : 0;
    const poreDensity = lapN > 0 ? (poreCount / lapN) * 1000 : 0;
    const poreContrast = poreCount > 0 ? poreDepth / poreCount : 0;

    return {
      pixels: count,
      lab: meanLab,
      chroma: ch.chroma,
      hue: ch.hue,
      ita: ita,
      category: category,
      undertone: classifyUndertone(meanLab[1], meanLab[2]),
      erythemaIndex: erythemaIndex,
      melaninIndex: melaninIndex,
      rednessCoverage: rednessCoverage,
      textureRoughness: textureRoughness,
      roughnessIndex: 100 * (1 - Math.exp(-textureRoughness / ROUGHNESS_SCALE)),
      poreDensity: poreDensity,
      poreContrast: poreContrast,
      shineRatio: shineRatio
    };
  }

  /**
   * A 0..100 vector in the same direction as YouCam scores (higher is better
   * looking skin) for the four concerns a flat patch can speak to. Wrinkle,
   * acne and moisture need the API; they are listed in `unavailable`.
   */
  function localSkinScores(analysis) {
    const pore = 100 - 100 * (1 - Math.exp(-analysis.poreDensity / PORE_DENSITY_SCALE));
    const texture = 100 - analysis.roughnessIndex;
    const oiliness = 100 - clamp(analysis.shineRatio * 800, 0, 100);
    const redness = 100 - clamp(analysis.rednessCoverage * 200, 0, 100);
    return {
      scores: {
        hd_pore: clamp(pore, 0, 100),
        hd_texture: clamp(texture, 0, 100),
        hd_oiliness: clamp(oiliness, 0, 100),
        hd_redness: clamp(redness, 0, 100)
      },
      unavailable: ['hd_wrinkle', 'hd_acne', 'hd_moisture', 'hd_radiance']
    };
  }

  /* ------------------------------------------------------------------ */
  /* Rendering helpers: chromophore map, foundation, lips, skin mask        */
  /* ------------------------------------------------------------------ */

  /* Overlay colours match --color-accent and --color-sage in tokens.css. */
  const MAP_COLORS = Object.freeze({ erythema: [184, 74, 57], melanin: [42, 111, 98] });

  function trapezoid(x, a, b, c, d) {
    if (x <= a || x >= d) return 0;
    if (x >= b && x <= c) return 1;
    return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
  }

  /** Soft 0..1 likelihood that a pixel is skin-toned (hue, chroma and L* window). */
  function skinMaskAlpha(r, g, b) {
    const lab = srgbToLab(r, g, b);
    const ch = chromaHue(lab[1], lab[2]);
    return (
      trapezoid(ch.hue, 12, 28, 78, 92) *
      trapezoid(ch.chroma, 3, 9, 55, 70) *
      trapezoid(lab[0], 8, 16, 95, 100)
    );
  }

  /** Separable box blur of a Float32Array image using running sums. */
  function boxBlur(src, w, h, radius) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = radius * 2 + 1;
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += src[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x += 1) {
        tmp[row + x] = sum / span;
        sum += src[row + clamp(x + radius + 1, 0, w - 1)] - src[row + clamp(x - radius, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y += 1) {
        out[y * w + x] = sum / span;
        sum += tmp[clamp(y + radius + 1, 0, h - 1) * w + x] - tmp[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  /**
   * Heat map of the two chromophore proxies. Broad shading is removed by
   * subtracting a wide local average, so the map shows blotches and spots
   * (erythema in carmine, melanin in sage) and not the lighting gradient.
   */
  function buildChromophoreMap(image) {
    const w = image.width;
    const h = image.height;
    const n = w * h;
    const e = new Float32Array(n);
    const m = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      const rl = LINEAR_LUT[image.data[p]];
      const gl = LINEAR_LUT[image.data[p + 1]];
      e[i] = Math.log10(Math.max(rl, 1e-4) / Math.max(gl, 1e-4));
      m[i] = Math.log10(1 / Math.max(rl, 1e-4));
    }
    const wide = Math.max(4, Math.round(Math.min(w, h) * 0.05));
    const eDev = deviation(e, w, h, wide);
    const mDev = deviation(m, w, h, wide);
    const eSd = Math.max(robustScale(eDev), 0.0015);
    const mSd = Math.max(robustScale(mDev), 0.003);
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      const rl = LINEAR_LUT[image.data[p]];
      const gl = LINEAR_LUT[image.data[p + 1]];
      const bl = LINEAR_LUT[image.data[p + 2]];
      const ae = clamp((eDev[i] / eSd - 0.6) / 2.4, 0, 1) * 0.85;
      const am = clamp((mDev[i] / mSd - 0.6) / 2.4, 0, 1) * 0.85;
      const grey = linearToSrgbChannel(0.2126 * rl + 0.7152 * gl + 0.0722 * bl);
      let r = lerp(image.data[p], grey, 0.6);
      let g = lerp(image.data[p + 1], grey, 0.6);
      let b = lerp(image.data[p + 2], grey, 0.6);
      r = lerp(r, MAP_COLORS.erythema[0], ae);
      g = lerp(g, MAP_COLORS.erythema[1], ae);
      b = lerp(b, MAP_COLORS.erythema[2], ae);
      r = lerp(r, MAP_COLORS.melanin[0], am);
      g = lerp(g, MAP_COLORS.melanin[1], am);
      b = lerp(b, MAP_COLORS.melanin[2], am);
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
    return { width: w, height: h, data: out };
  }

  /** Lightly smoothed signal minus its wide local average. */
  function deviation(src, w, h, wide) {
    const near = boxBlur(src, w, h, 2);
    const far = boxBlur(src, w, h, wide);
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 1) out[i] = near[i] - far[i];
    return out;
  }

  /** Robust spread, 1.4826 times the median absolute deviation, from a subsample. */
  function robustScale(arr) {
    const sample = [];
    for (let i = 0; i < arr.length; i += 5) sample.push(arr[i]);
    sample.sort(function (p, q) {
      return p - q;
    });
    const med = sample[Math.floor(sample.length / 2)];
    const dev = sample.map(function (v) {
      return Math.abs(v - med);
    });
    dev.sort(function (p, q) {
      return p - q;
    });
    return 1.4826 * dev[Math.floor(dev.length / 2)];
  }

  /**
   * Foundation in L*a*b*. The patch mean moves toward the shade and local
   * deviation from the mean is attenuated by coverage, which is how a real
   * base evens tone while keeping some skin texture.
   * options: coverage 0..1, glow 0..1, smoothing 0..1, meanLab, mask, lipMask.
   */
  function applyFoundation(image, shadeLab, options) {
    const o = Object.assign({ coverage: 0.6, glow: 0.1, smoothing: 0.55 }, options);
    const n = image.width * image.height;
    const out = new Uint8ClampedArray(image.data.length);
    let mean = o.meanLab;
    if (!mean) {
      let sL = 0;
      let sA = 0;
      let sB = 0;
      let wsum = 0;
      for (let i = 0; i < n; i += 1) {
        const wgt = pixelWeight(image, i, o);
        if (wgt <= 0) continue;
        const lab = srgbToLab(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]);
        sL += lab[0] * wgt;
        sA += lab[1] * wgt;
        sB += lab[2] * wgt;
        wsum += wgt;
      }
      mean = wsum > 0 ? [sL / wsum, sA / wsum, sB / wsum] : [shadeLab[0], shadeLab[1], shadeLab[2]];
    }
    const keep = 1 - o.smoothing * o.coverage;
    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      const wgt = pixelWeight(image, i, o);
      if (wgt <= 0) {
        out[p] = image.data[p];
        out[p + 1] = image.data[p + 1];
        out[p + 2] = image.data[p + 2];
        out[p + 3] = image.data[p + 3];
        continue;
      }
      const lab = srgbToLab(image.data[p], image.data[p + 1], image.data[p + 2]);
      const tL = shadeLab[0] + (lab[0] - mean[0]) * keep + o.glow * 4;
      const tA = shadeLab[1] + (lab[1] - mean[1]) * keep;
      const tB = shadeLab[2] + (lab[2] - mean[2]) * keep;
      const t = clamp(o.coverage * wgt, 0, 1);
      const rgb = labToSrgb(lerp(lab[0], tL, t), lerp(lab[1], tA, t), lerp(lab[2], tB, t));
      out[p] = rgb[0];
      out[p + 1] = rgb[1];
      out[p + 2] = rgb[2];
      out[p + 3] = image.data[p + 3];
    }
    return { width: image.width, height: image.height, data: out };
  }

  function pixelWeight(image, i, o) {
    let wgt = o.mask ? o.mask[i] : skinMaskAlpha(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]);
    if (o.lipMask) wgt *= 1 - o.lipMask[i];
    return wgt;
  }

  /**
   * Lipstick in L*a*b*. Pixel detail inside the lip is kept (scaled), the
   * colour moves to the shade, and a gloss finish lifts the brightest parts.
   * options: intensity 0..1, finish 'matte' | 'satin' | 'gloss'.
   */
  function applyLipColor(image, lipMask, shadeLab, options) {
    const o = Object.assign({ intensity: 0.85, finish: 'satin' }, options);
    const n = image.width * image.height;
    const out = new Uint8ClampedArray(image.data.length);
    let sL = 0;
    let wsum = 0;
    for (let i = 0; i < n; i += 1) {
      if (lipMask[i] <= 0) continue;
      const lab = srgbToLab(image.data[i * 4], image.data[i * 4 + 1], image.data[i * 4 + 2]);
      sL += lab[0] * lipMask[i];
      wsum += lipMask[i];
    }
    const meanL = wsum > 0 ? sL / wsum : shadeLab[0];
    const detail = o.finish === 'matte' ? 0.55 : o.finish === 'gloss' ? 0.8 : 0.7;
    const glossLift = o.finish === 'gloss' ? 1.25 : o.finish === 'satin' ? 0.35 : 0;
    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      const m = clamp(lipMask[i] * o.intensity, 0, 1);
      if (m <= 0) {
        out[p] = image.data[p];
        out[p + 1] = image.data[p + 1];
        out[p + 2] = image.data[p + 2];
        out[p + 3] = image.data[p + 3];
        continue;
      }
      const lab = srgbToLab(image.data[p], image.data[p + 1], image.data[p + 2]);
      const dev = lab[0] - meanL;
      const tL = shadeLab[0] + dev * detail + (dev > 0 ? dev * glossLift : 0);
      const rgb = labToSrgb(lerp(lab[0], tL, m), lerp(lab[1], shadeLab[1], m), lerp(lab[2], shadeLab[2], m));
      out[p] = rgb[0];
      out[p + 1] = rgb[1];
      out[p + 2] = rgb[2];
      out[p + 3] = image.data[p + 3];
    }
    return { width: image.width, height: image.height, data: out };
  }

  /* ------------------------------------------------------------------ */
  /* Presets                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * Five calibrated starting points defined directly in L*a*b*. The
   * "Phototype" names are shorthand only. Fitzpatrick phototype is a
   * self-reported reaction to sun and is not the same thing as ITA.
   */
  const PRESETS = Object.freeze([
    Object.freeze({ id: 'p1', name: 'Phototype I Cool Porcelain', short: 'Cool Porcelain', lab: [78, 11.5, 12.5] }),
    Object.freeze({ id: 'p3', name: 'Phototype III Warm Golden', short: 'Warm Golden', lab: [66, 10, 23] }),
    Object.freeze({ id: 'p4', name: 'Phototype IV Olive Neutral', short: 'Olive Neutral', lab: [58, 6.5, 20] }),
    Object.freeze({ id: 'p5', name: 'Phototype V Rich Amber', short: 'Rich Amber', lab: [45, 11, 25] }),
    Object.freeze({ id: 'p6', name: 'Phototype VI Deep Espresso', short: 'Deep Espresso', lab: [30, 9.5, 15] })
  ]);

  /* ------------------------------------------------------------------ */
  /* YouCam API: payload builder and response normalizer                    */
  /* ------------------------------------------------------------------ */

  /*
   * Checked 2026-10-25 against the published OpenAPI bundles at
   * https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.json and
   * https://docs.perfectcorp.com/_bundle/reference/makeup_vto.json
   * The live paths are /s2s/v2.0/task/... ("V1.0" in those docs is the version
   * of the makeup effect specification, sent as the body field "version").
   */
  const YOUCAM = Object.freeze({
    baseUrl: 'https://yce-api-01.makeupar.com',
    skinAnalysisPath: '/s2s/v2.0/task/skin-analysis',
    makeupVtoPath: '/s2s/v2.0/task/makeup-vto',
    effectSpecVersion: '1.0',
    checkedOn: '2026-10-25'
  });

  const HD_ACTIONS = Object.freeze([
    'hd_wrinkle', 'hd_pore', 'hd_texture', 'hd_acne', 'hd_oiliness', 'hd_radiance', 'hd_eye_bag',
    'hd_age_spot', 'hd_dark_circle', 'hd_droopy_upper_eyelid', 'hd_droopy_lower_eyelid',
    'hd_firmness', 'hd_moisture', 'hd_redness', 'hd_tear_trough', 'hd_skin_type'
  ]);
  const SD_ACTIONS = Object.freeze([
    'wrinkle', 'pore', 'texture', 'acne', 'oiliness', 'radiance', 'eye_bag', 'age_spot',
    'dark_circle_v2', 'droopy_upper_eyelid', 'droopy_lower_eyelid', 'firmness', 'moisture',
    'redness', 'tear_trough', 'skin_type'
  ]);
  const DEFAULT_HD_ACTIONS = Object.freeze([
    'hd_wrinkle', 'hd_pore', 'hd_texture', 'hd_acne', 'hd_oiliness', 'hd_radiance', 'hd_moisture', 'hd_redness'
  ]);
  const LIP_TEXTURES = Object.freeze(['matte', 'gloss', 'holographic', 'metallic', 'satin', 'sheer', 'shimmer']);
  const LIP_STYLES = Object.freeze(['full', 'ombre', 'twoTone']);

  class YouCamPayloadError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'YouCamPayloadError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new YouCamPayloadError(code, message);
  }

  /** Classify a dst_actions list as 'hd', 'sd' or 'mixed'. */
  function classifyDstActions(actions) {
    let hd = 0;
    let sd = 0;
    actions.forEach(function (a) {
      if (HD_ACTIONS.indexOf(a) !== -1) hd += 1;
      else if (SD_ACTIONS.indexOf(a) !== -1) sd += 1;
    });
    if (hd > 0 && sd > 0) return 'mixed';
    return hd > 0 ? 'hd' : 'sd';
  }

  function isPublicHttpsUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return false;
    }
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '[::1]' || host === '0.0.0.0') return false;
    return true;
  }

  function checkIntensity(name, value) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      fail('invalid_intensity', name + ' must be an integer from 0 to 100, got ' + String(value));
    }
  }

  function checkHexColour(name, value) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      fail('invalid_color', name + ' must be #RRGGBB, got ' + String(value));
    }
  }

  function buildFoundationEffect(hex, options) {
    const o = Object.assign({ colorIntensity: 50, glowIntensity: 10, coverageIntensity: 50 }, options);
    const effect = {
      category: 'foundation',
      palettes: [
        {
          color: hex.toLowerCase(),
          colorIntensity: o.colorIntensity,
          glowIntensity: o.glowIntensity,
          coverageIntensity: o.coverageIntensity
        }
      ]
    };
    validateMakeupEffect(effect);
    return effect;
  }

  function buildConcealerEffect(hex, options) {
    const o = Object.assign({ colorIntensity: 50, colorUnderEyeIntensity: 50, coverageLevel: 60 }, options);
    const effect = {
      category: 'concealer',
      palettes: [
        {
          color: hex.toLowerCase(),
          colorIntensity: o.colorIntensity,
          colorUnderEyeIntensity: o.colorUnderEyeIntensity,
          coverageLevel: o.coverageLevel
        }
      ]
    };
    validateMakeupEffect(effect);
    return effect;
  }

  function buildLipColorEffect(hex, options) {
    const o = Object.assign(
      { shape: 'original', texture: 'satin', colorIntensity: 70, style: 'full', fullness: 0, wrinkless: 0 },
      options
    );
    const palette = { color: hex.toUpperCase(), texture: o.texture, colorIntensity: o.colorIntensity };
    if (o.texture === 'gloss' || o.texture === 'sheer' || o.texture === 'shimmer') {
      palette.gloss = o.gloss === undefined ? 50 : o.gloss;
      palette.transparencyIntensity = o.transparencyIntensity === undefined ? 30 : o.transparencyIntensity;
    }
    const effect = {
      category: 'lip_color',
      shape: { name: o.shape },
      morphology: { fullness: o.fullness, wrinkless: o.wrinkless },
      style: { type: o.style },
      palettes: [palette]
    };
    validateMakeupEffect(effect);
    return effect;
  }

  /** Validate one makeup effect against the fields the live spec marks required. */
  function validateMakeupEffect(effect) {
    if (!effect || typeof effect !== 'object') fail('invalid_effect', 'effect must be an object');
    const palettes = effect.palettes;
    if (!Array.isArray(palettes) || palettes.length === 0) {
      fail('invalid_effect', 'effect.palettes must be a non-empty array');
    }
    palettes.forEach(function (p) {
      checkHexColour('palette color', p.color);
      checkIntensity('colorIntensity', p.colorIntensity);
      if (effect.category === 'foundation') {
        checkIntensity('glowIntensity', p.glowIntensity);
        checkIntensity('coverageIntensity', p.coverageIntensity);
      } else if (effect.category === 'concealer') {
        checkIntensity('colorUnderEyeIntensity', p.colorUnderEyeIntensity);
        checkIntensity('coverageLevel', p.coverageLevel);
      } else if (effect.category === 'lip_color') {
        if (LIP_TEXTURES.indexOf(p.texture) === -1) {
          fail('invalid_texture', 'lip texture must be one of ' + LIP_TEXTURES.join(', '));
        }
        ['gloss', 'shimmerIntensity', 'shimmerDensity', 'shimmerSize', 'transparencyIntensity'].forEach(function (k) {
          if (p[k] !== undefined) checkIntensity(k, p[k]);
        });
      }
    });
    if (effect.category === 'lip_color') {
      if (!effect.shape || typeof effect.shape.name !== 'string' || effect.shape.name === '') {
        fail('invalid_effect', 'lip_color needs shape.name');
      }
      if (!effect.style || LIP_STYLES.indexOf(effect.style.type) === -1) {
        fail('invalid_effect', 'lip_color style.type must be one of ' + LIP_STYLES.join(', '));
      }
      if (effect.morphology) {
        if (effect.morphology.fullness !== undefined) checkIntensity('fullness', effect.morphology.fullness);
        if (effect.morphology.wrinkless !== undefined) checkIntensity('wrinkless', effect.morphology.wrinkless);
      }
    } else if (effect.category !== 'foundation' && effect.category !== 'concealer') {
      fail('unsupported_category', 'this builder covers foundation, concealer and lip_color, got ' + String(effect.category));
    }
    return true;
  }

  /**
   * Build a ready-to-send YouCam request description.
   * options.task: 'skin-analysis' or 'makeup-vto'.
   * Skin analysis: src_file_url or src_file_id, dst_actions, format.
   * Makeup try on: src_file_url or src_file_id, effects.
   * The Authorization header holds a placeholder; the key never lives here.
   */
  function buildYouCamTaskPayload(options) {
    const o = options || {};
    const task = o.task || 'skin-analysis';
    if (task !== 'skin-analysis' && task !== 'makeup-vto') {
      fail('invalid_task', 'task must be skin-analysis or makeup-vto');
    }
    const hasUrl = o.src_file_url !== undefined && o.src_file_url !== '';
    const hasId = o.src_file_id !== undefined && o.src_file_id !== '';
    if (hasUrl === hasId) fail('invalid_source', 'provide exactly one of src_file_url or src_file_id');
    if (hasUrl && !isPublicHttpsUrl(o.src_file_url)) {
      fail('invalid_source', 'src_file_url must be a publicly reachable https URL');
    }

    const body = {};
    if (hasUrl) body.src_file_url = o.src_file_url;
    else body.src_file_id = o.src_file_id;

    if (task === 'skin-analysis') {
      const actions = o.dst_actions === undefined ? DEFAULT_HD_ACTIONS.slice() : o.dst_actions;
      if (!Array.isArray(actions) || actions.length === 0) fail('invalid_actions', 'dst_actions must be a non-empty array');
      const seen = {};
      actions.forEach(function (a) {
        if (HD_ACTIONS.indexOf(a) === -1 && SD_ACTIONS.indexOf(a) === -1) {
          fail('invalid_actions', 'Not available dst_action ' + String(a));
        }
        if (seen[a]) fail('invalid_actions', 'duplicate dst_action ' + a);
        seen[a] = true;
      });
      if (classifyDstActions(actions) === 'mixed') fail('mixed_actions', 'cannot mix HD and SD dst_actions');
      body.dst_actions = actions.slice();
      const format = o.format === undefined ? 'json' : o.format;
      if (format !== 'json' && format !== 'zip') fail('invalid_format', 'format must be json or zip');
      body.format = format;
      if (o.miniserver_args) body.miniserver_args = o.miniserver_args;
    } else {
      if (!Array.isArray(o.effects) || o.effects.length === 0) fail('invalid_effect', 'effects must be a non-empty array');
      o.effects.forEach(validateMakeupEffect);
      body.version = o.version || YOUCAM.effectSpecVersion;
      body.effects = o.effects;
    }

    return {
      method: 'POST',
      url: YOUCAM.baseUrl + (task === 'skin-analysis' ? YOUCAM.skinAnalysisPath : YOUCAM.makeupVtoPath),
      headers: { Authorization: 'Bearer YOUR_API_KEY', 'Content-Type': 'application/json' },
      body: body
    };
  }

  /** Copyable curl for a request from buildYouCamTaskPayload. */
  function buildYouCamCurl(request) {
    const json = JSON.stringify(request.body, null, 2).replace(/'/g, "'\\''");
    return [
      'curl --request ' + request.method + ' \\',
      "  --url '" + request.url + "' \\",
      "  --header 'Authorization: Bearer YOUR_API_KEY' \\",
      "  --header 'Content-Type: application/json' \\",
      "  --data '" + json + "'"
    ].join('\n');
  }

  /** Turn a ranked foundation or lip row into an effects array for makeup-vto. */
  function shadeToYouCamEffects(selection) {
    const effects = [];
    if (selection.foundation) {
      effects.push(buildFoundationEffect(selection.foundation.hex, selection.foundationOptions));
    }
    if (selection.concealer) {
      effects.push(buildConcealerEffect(selection.concealer.hex, selection.concealerOptions));
    }
    if (selection.lip) {
      effects.push(buildLipColorEffect(selection.lip.hex, selection.lipOptions));
    }
    return effects;
  }

  const CONCERN_LABELS = Object.freeze({
    wrinkle: 'Wrinkles', pore: 'Pores', texture: 'Texture', acne: 'Blemishes', oiliness: 'Oiliness',
    radiance: 'Radiance', moisture: 'Moisture', redness: 'Redness', eye_bag: 'Eye bags',
    age_spot: 'Age spots', dark_circle: 'Dark circles', dark_circle_v2: 'Dark circles',
    droopy_upper_eyelid: 'Upper eyelid droop', droopy_lower_eyelid: 'Lower eyelid droop',
    firmness: 'Firmness', tear_trough: 'Tear trough', skin_type: 'Skin type'
  });

  function concernKey(action) {
    return String(action).replace(/^hd_/, '');
  }

  function scoreBand(score) {
    if (score >= 75) return 'Maintain';
    if (score >= 55) return 'Watch';
    return 'Priority';
  }

  function makeConcern(action, region, rawScore, uiScore, maskCount) {
    const key = concernKey(action);
    const score = typeof rawScore === 'number' ? rawScore : uiScore;
    return {
      action: action,
      concern: key,
      label: CONCERN_LABELS[key] || key,
      region: region || 'whole',
      hd: String(action).indexOf('hd_') === 0,
      rawScore: typeof rawScore === 'number' ? rawScore : null,
      uiScore: typeof uiScore === 'number' ? uiScore : null,
      score: typeof score === 'number' ? score : null,
      band: typeof score === 'number' ? scoreBand(score) : null,
      maskCount: maskCount || 0
    };
  }

  const FRIENDLY_ERRORS = Object.freeze({
    error_no_face: 'No face was found in the source image.',
    error_pose: 'The face pose could not be read. Use a front-facing, neutral photo.',
    error_face_parsing: 'Face segmentation failed on this photo.',
    error_src_face_too_small: 'The face is too small. It should span more than 60 percent of the image width.',
    error_src_face_out_of_bound: 'The face is partly outside the frame.',
    error_lighting_dark: 'The lighting is too dark.',
    error_below_min_image_size: 'The image is below the minimum size.',
    error_exceed_max_image_size: 'The image exceeds the maximum size.',
    invalid_parameter: 'A request parameter was rejected.'
  });

  /**
   * Normalise a YouCam skin analysis response into one shape.
   * Accepts an object or JSON string in any of three layouts:
   *  1. the format=json task response (data.results.output[])
   *  2. a score_info.json file (flat entries, nested regions, "all", "skin_age")
   *  3. a bare results object of either kind
   * Scores follow YouCam: 1..100, higher is better. raw_score is preferred
   * because ui_score is deliberately adjusted upward by the vendor.
   */
  function normalizeYouCamSkinResponse(input) {
    let doc = input;
    if (typeof doc === 'string') {
      try {
        doc = JSON.parse(doc);
      } catch (e) {
        throw new SyntaxError('response is not valid JSON');
      }
    }
    if (!doc || typeof doc !== 'object') throw new TypeError('response must be an object or JSON string');

    const data = doc.data && typeof doc.data === 'object' ? doc.data : doc;
    const result = {
      taskStatus: data.task_status || null,
      error: data.error || null,
      errorMessage: null,
      overall: null,
      skinAge: null,
      concerns: [],
      warnings: []
    };
    if (result.error) {
      result.errorMessage = FRIENDLY_ERRORS[result.error] || data.error_message || 'The task reported an error.';
    }
    if (data.task_status === 'error' || data.task_status === 'running') return result;

    const results = data.results && typeof data.results === 'object' ? data.results : data;

    if (Array.isArray(results.output)) {
      results.output.forEach(function (entry) {
        if (!entry || typeof entry !== 'object') return;
        if (entry.type === undefined && typeof entry.score === 'number') {
          result.overall = entry.score;
          return;
        }
        if (typeof entry.type !== 'string') return;
        if (typeof entry.raw_score !== 'number' && typeof entry.ui_score !== 'number') {
          if (typeof entry.score === 'number') result.overall = entry.score;
          return;
        }
        result.concerns.push(
          makeConcern(entry.type, entry.region, entry.raw_score, entry.ui_score, (entry.mask_urls || []).length)
        );
      });
    } else {
      Object.keys(results).forEach(function (key) {
        const v = results[key];
        if (key === 'all') {
          if (v && typeof v.score === 'number') result.overall = v.score;
          return;
        }
        if (key === 'skin_age') {
          if (typeof v === 'number') result.skinAge = v;
          return;
        }
        if (!v || typeof v !== 'object') return;
        if (typeof v.raw_score === 'number' || typeof v.ui_score === 'number') {
          result.concerns.push(makeConcern(key, 'whole', v.raw_score, v.ui_score, v.output_mask_name ? 1 : 0));
        } else {
          Object.keys(v).forEach(function (region) {
            const r = v[region];
            if (r && (typeof r.raw_score === 'number' || typeof r.ui_score === 'number')) {
              result.concerns.push(makeConcern(key, region, r.raw_score, r.ui_score, r.output_mask_name ? 1 : 0));
            }
          });
        }
      });
    }
    if (typeof data.skin_age === 'number') result.skinAge = data.skin_age;
    if (result.concerns.length === 0 && result.taskStatus !== 'running') {
      result.warnings.push('No concern scores were found in this response.');
    }
    return result;
  }

  /** localSkinScores shaped like normalised YouCam concerns, for the receipt. */
  function localConcerns(analysis) {
    const local = localSkinScores(analysis);
    return Object.keys(local.scores).map(function (action) {
      return makeConcern(action, 'whole', local.scores[action], null, 0);
    });
  }

  /** Cosmetic routine step per concern. These are suggestions, not treatment. */
  const REGIMEN_STEPS = Object.freeze({
    redness: 'Fragrance-free soothing moisturizer and a daily SPF 30 or higher.',
    oiliness: 'Light gel moisturizer and an oil-control primer under foundation.',
    moisture: 'A humectant serum (glycerin or hyaluronic acid) under a moisturizer.',
    texture: 'Gentle exfoliation once or twice a week, and daily sunscreen.',
    pore: 'A niacinamide serum, and a blurring primer on days you want a smoother base.',
    acne: 'Keep the routine gentle and non-comedogenic. For persistent breakouts, see a dermatologist.',
    wrinkle: 'Daily SPF 30 or higher and a moisturizer. Ask a dermatologist before starting retinoids.',
    radiance: 'A vitamin C serum in the morning and a hydrating mask once a week.',
    age_spot: 'Daily SPF 30 or higher. For spots you are unsure about, see a dermatologist.'
  });

  /**
   * Build the regimen and shade receipt shown to the user.
   * input: { concerns, ranking: { foundation, concealer, lip }, tone, source }
   */
  function buildRegimenReceipt(input) {
    const concerns = (input.concerns || []).filter(function (c) {
      return typeof c.score === 'number';
    });
    const ordered = concerns.slice().sort(function (p, q) {
      return p.score - q.score;
    });
    const steps = [];
    const seen = {};
    ordered.forEach(function (c) {
      if (c.band === 'Maintain') return;
      const step = REGIMEN_STEPS[c.concern];
      if (!step || seen[c.concern]) return;
      seen[c.concern] = true;
      steps.push({ concern: c.concern, label: c.label, band: c.band, score: c.score, step: step });
    });
    const lines = [];
    lines.push('DermaVTO receipt (' + (input.source === 'youcam' ? 'YouCam scores' : 'local estimate') + ')');
    if (input.tone) {
      lines.push(
        'Tone, L* ' + input.tone.lab[0].toFixed(1) + ', a* ' + input.tone.lab[1].toFixed(1) + ', b* ' +
          input.tone.lab[2].toFixed(1) + ', ITA ' + input.tone.ita.toFixed(1) + ' degrees (' +
          input.tone.category.name + '), undertone ' + (input.tone.undertone || 'not rated') + ' (heuristic)'
      );
    }
    ['foundation', 'concealer', 'lip'].forEach(function (kind) {
      const rows = input.ranking && input.ranking[kind];
      if (rows && rows[0]) {
        lines.push(
          kind.charAt(0).toUpperCase() + kind.slice(1) + ', ' + rows[0].swatch.name + ' ' + rows[0].swatch.hex +
            ', DeltaE00 ' + rows[0].deltaE.toFixed(2)
        );
      }
    });
    if (steps.length === 0) lines.push('Routine, every scored concern is in the Maintain band. Keep a daily SPF 30 or higher.');
    else {
      steps.forEach(function (s) {
        lines.push('Routine for ' + s.label.toLowerCase() + ' (' + s.band + ', ' + s.score.toFixed(0) + ' of 100), ' + s.step);
      });
    }
    lines.push(DISCLAIMER);
    return { steps: steps, lines: lines, text: lines.join('\n') };
  }

  const DISCLAIMER =
    'Cosmetic and educational only. ITA, DeltaE00 and the optical indices are colour measurements, not a clinical assessment, and cannot replace a dermatologist.';

  return {
    ENGINE_VERSION: ENGINE_VERSION,
    D65: D65,
    ITA_CATEGORIES: ITA_CATEGORIES,
    UNDERTONE_CUTS: UNDERTONE_CUTS,
    SWATCHES: SWATCHES,
    PRESETS: PRESETS,
    YOUCAM: YOUCAM,
    HD_ACTIONS: HD_ACTIONS,
    SD_ACTIONS: SD_ACTIONS,
    DEFAULT_HD_ACTIONS: DEFAULT_HD_ACTIONS,
    LIP_TEXTURES: LIP_TEXTURES,
    DISCLAIMER: DISCLAIMER,
    CONCEALER_LIGHTNESS_OFFSET: CONCEALER_LIGHTNESS_OFFSET,
    YouCamPayloadError: YouCamPayloadError,
    srgbChannelToLinear: srgbChannelToLinear,
    linearToSrgbChannel: linearToSrgbChannel,
    srgbToLab: srgbToLab,
    labToSrgb: labToSrgb,
    labToHex: labToHex,
    parseHex: parseHex,
    rgbToHex: rgbToHex,
    chromaHue: chromaHue,
    computeItaAngle: computeItaAngle,
    classifyItaCategory: classifyItaCategory,
    classifyUndertone: classifyUndertone,
    computeDeltaE76: computeDeltaE76,
    computeDeltaE2000: computeDeltaE2000,
    describeDeltaE: describeDeltaE,
    swatchesByKind: swatchesByKind,
    lipTargetLab: lipTargetLab,
    targetLabForKind: targetLabForKind,
    rankShades: rankShades,
    mulberry32: mulberry32,
    hash2: hash2,
    valueNoise: valueNoise,
    createSkinSpecimen: createSkinSpecimen,
    specimenLipCoverage: specimenLipCoverage,
    extractPatch: extractPatch,
    analyzeSkinPatch: analyzeSkinPatch,
    localSkinScores: localSkinScores,
    localConcerns: localConcerns,
    skinMaskAlpha: skinMaskAlpha,
    buildChromophoreMap: buildChromophoreMap,
    boxBlur: boxBlur,
    applyFoundation: applyFoundation,
    applyLipColor: applyLipColor,
    classifyDstActions: classifyDstActions,
    isPublicHttpsUrl: isPublicHttpsUrl,
    buildFoundationEffect: buildFoundationEffect,
    buildConcealerEffect: buildConcealerEffect,
    buildLipColorEffect: buildLipColorEffect,
    validateMakeupEffect: validateMakeupEffect,
    buildYouCamTaskPayload: buildYouCamTaskPayload,
    buildYouCamCurl: buildYouCamCurl,
    shadeToYouCamEffects: shadeToYouCamEffects,
    normalizeYouCamSkinResponse: normalizeYouCamSkinResponse,
    buildRegimenReceipt: buildRegimenReceipt
  };
});
