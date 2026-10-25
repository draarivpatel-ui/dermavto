/*
 * DermaVTO render helpers
 * Pure functions that return SVG or text for the reading, so they can be
 * tested in Node and reused by app.js. Styling comes from classes in
 * styles.css; only swatch fills (data, not theme) are set inline.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.DermaRender = factory(root.DermaVTO);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const DEG = 180 / Math.PI;

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function num(v, digits) {
    return Number(v).toFixed(digits === undefined ? 1 : digits);
  }

  function fmt(v) {
    return Number(v.toFixed(2)).toString();
  }

  /* ---------------------------------------------------------------- */
  /* CIE L* b* plot with ITA rays                                      */
  /* ---------------------------------------------------------------- */

  const ARC = Object.freeze({
    width: 560,
    height: 400,
    left: 52,
    right: 20,
    top: 20,
    bottom: 48,
    bMax: 40,
    lMin: 10,
    lMax: 100
  });

  function arcScale() {
    const plotW = ARC.width - ARC.left - ARC.right;
    const plotH = ARC.height - ARC.top - ARC.bottom;
    return {
      x: function (b) {
        return ARC.left + (b / ARC.bMax) * plotW;
      },
      y: function (L) {
        return ARC.top + (1 - (L - ARC.lMin) / (ARC.lMax - ARC.lMin)) * plotH;
      },
      plotW: plotW,
      plotH: plotH
    };
  }

  /** Where the ray of a given ITA (degrees) leaves the plot area. */
  function rayEnd(itaDeg) {
    const slope = Math.tan(itaDeg / DEG);
    let b = ARC.bMax;
    let L = 50 + slope * b;
    if (L > ARC.lMax) {
      L = ARC.lMax;
      b = (ARC.lMax - 50) / slope;
    } else if (L < ARC.lMin) {
      L = ARC.lMin;
      b = (ARC.lMin - 50) / slope;
    }
    return { b: b, L: L };
  }

  /**
   * options: { lab, ita, category, rows } where rows is the foundation ranking
   * from E.rankShades. The sample is the large ring; the top three matches
   * are numbered.
   */
  function renderItaArcSvg(options) {
    const s = arcScale();
    const lab = options.lab;
    const parts = [];
    const desc =
      'Sample at L star ' + num(lab[0]) + ' and b star ' + num(lab[2]) + ', ITA ' + num(options.ita) +
      ' degrees, ' + options.category.name + '. Closest foundation shades: ' +
      options.rows.slice(0, 3).map(function (r) {
        return r.swatch.name + ' at DeltaE00 ' + num(r.deltaE, 2);
      }).join(', ') + '.';

    parts.push(
      '<svg class="arc-svg" viewBox="0 0 ' + ARC.width + ' ' + ARC.height + '" role="img" aria-labelledby="arc-title arc-desc" focusable="false">'
    );
    parts.push('<title id="arc-title">CIE L star b star plot with ITA bands</title>');
    parts.push('<desc id="arc-desc">' + esc(desc) + '</desc>');

    // Grid and axes.
    for (let b = 0; b <= ARC.bMax; b += 10) {
      parts.push('<line class="arc-grid" x1="' + fmt(s.x(b)) + '" y1="' + fmt(s.y(ARC.lMin)) + '" x2="' + fmt(s.x(b)) + '" y2="' + fmt(s.y(ARC.lMax)) + '"/>');
      parts.push('<text class="arc-tick" x="' + fmt(s.x(b)) + '" y="' + fmt(s.y(ARC.lMin) + 18) + '" text-anchor="middle">' + b + '</text>');
    }
    for (let L = 20; L <= ARC.lMax; L += 20) {
      parts.push('<line class="arc-grid" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.y(L)) + '" x2="' + fmt(s.x(ARC.bMax)) + '" y2="' + fmt(s.y(L)) + '"/>');
      parts.push('<text class="arc-tick" x="' + fmt(s.x(0) - 8) + '" y="' + fmt(s.y(L) + 4) + '" text-anchor="end">' + L + '</text>');
    }
    parts.push('<text class="arc-axis" x="' + fmt(s.x(ARC.bMax / 2)) + '" y="' + (ARC.height - 8) + '" text-anchor="middle">b* (yellow to blue axis)</text>');
    parts.push('<text class="arc-axis" transform="translate(14 ' + fmt(s.y(55)) + ') rotate(-90)" text-anchor="middle">L* (lightness)</text>');

    // ITA rays and band names.
    const bounds = [55, 41, 28, 10, -30];
    bounds.forEach(function (deg) {
      const end = rayEnd(deg);
      parts.push('<line class="arc-ray" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.y(50)) + '" x2="' + fmt(s.x(end.b)) + '" y2="' + fmt(s.y(end.L)) + '"/>');
    });
    const mids = [72, 48, 34.5, 19, -10, -55];
    mids.forEach(function (deg, i) {
      const end = rayEnd(deg);
      let bx;
      let Lx;
      let anchor;
      if (end.b >= ARC.bMax - 0.001) {
        bx = ARC.bMax - 0.8;
        Lx = 50 + Math.tan(deg / DEG) * bx;
        anchor = 'end';
      } else {
        bx = end.b * 0.9;
        Lx = 50 + (end.L - 50) * 0.9;
        anchor = 'middle';
      }
      parts.push('<text class="arc-band" x="' + fmt(s.x(bx)) + '" y="' + fmt(s.y(Lx) - 4) + '" text-anchor="' + anchor + '">' + esc(E.ITA_CATEGORIES[i].name) + '</text>');
    });

    // Reference foundation swatches.
    const topIds = {};
    options.rows.slice(0, 3).forEach(function (r, i) {
      topIds[r.swatch.id] = i + 1;
    });
    E.swatchesByKind('foundation').forEach(function (sw) {
      const cx = s.x(sw.lab[2]);
      const cy = s.y(sw.lab[0]);
      const rank = topIds[sw.id];
      parts.push(
        '<circle class="arc-swatch' + (rank ? ' is-top' : '') + '" cx="' + fmt(cx) + '" cy="' + fmt(cy) + '" r="' + (rank ? 10 : 5.5) + '" style="fill:' + esc(sw.hex) + '"><title>' + esc(sw.name + ' ' + sw.hex) + '</title></circle>'
      );
      if (rank) {
        parts.push('<text class="arc-rank" x="' + fmt(cx) + '" y="' + fmt(cy + 4) + '" text-anchor="middle">' + rank + '</text>');
      }
    });

    // The sample: ITA ray and ring.
    const sx = s.x(Math.min(Math.max(lab[2], 0), ARC.bMax));
    const sy = s.y(Math.min(Math.max(lab[0], ARC.lMin), ARC.lMax));
    parts.push('<line class="arc-ita" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.y(50)) + '" x2="' + fmt(sx) + '" y2="' + fmt(sy) + '"/>');
    parts.push('<circle class="arc-sample" cx="' + fmt(sx) + '" cy="' + fmt(sy) + '" r="11"/>');
    parts.push('<circle class="arc-sample-dot" cx="' + fmt(sx) + '" cy="' + fmt(sy) + '" r="3"/>');
    parts.push('<text class="arc-ita-label" x="' + fmt(s.x(1.2)) + '" y="' + fmt(s.y(50) + (sy > s.y(50) ? -10 : 18)) + '">ITA ' + num(options.ita) + '°</text>');
    parts.push('</svg>');
    return parts.join('');
  }

  /* ---------------------------------------------------------------- */
  /* Undertone compass (a* b* quadrant)                                 */
  /* ---------------------------------------------------------------- */

  const COMPASS = Object.freeze({ width: 420, height: 370, left: 48, bottom: 52, top: 34, plot: 280, aMax: 40, bMax: 40 });

  function compassScale() {
    return {
      x: function (a) {
        return COMPASS.left + (a / COMPASS.aMax) * COMPASS.plot;
      },
      y: function (b) {
        return COMPASS.height - COMPASS.bottom - (b / COMPASS.bMax) * COMPASS.plot;
      },
      plot: COMPASS.plot
    };
  }

  /** Hue angle (degrees from the a* axis) at which the ratio of a* to b* equals r. */
  function ratioToHueAngle(r) {
    return Math.atan(1 / r) * DEG;
  }

  function renderUndertoneCompassSvg(options) {
    const s = compassScale();
    const lab = options.lab;
    const cuts = E.UNDERTONE_CUTS;
    const angles = [0, ratioToHueAngle(cuts.cool), ratioToHueAngle(cuts.neutral), ratioToHueAngle(cuts.warm), 90];
    const zones = ['Cool', 'Neutral', 'Warm', 'Olive'];
    const radius = s.plot;
    const ox = s.x(0);
    const oy = s.y(0);
    const parts = [];
    const undertone = options.undertone || 'not rated';
    parts.push('<svg class="compass-svg" viewBox="0 0 ' + COMPASS.width + ' ' + COMPASS.height + '" role="img" aria-labelledby="compass-title compass-desc" focusable="false">');
    parts.push('<title id="compass-title">Undertone compass on the a star b star plane</title>');
    parts.push('<desc id="compass-desc">' + esc('Sample at a star ' + num(lab[1]) + ' and b star ' + num(lab[2]) + ', undertone ' + undertone + ' by heuristic.') + '</desc>');

    zones.forEach(function (name, i) {
      const a0 = angles[i] / DEG;
      const a1 = angles[i + 1] / DEG;
      const x0 = ox + radius * Math.cos(a0);
      const y0 = oy - radius * Math.sin(a0);
      const x1 = ox + radius * Math.cos(a1);
      const y1 = oy - radius * Math.sin(a1);
      parts.push(
        '<path class="compass-zone zone-' + name.toLowerCase() + (name === undertone ? ' is-active' : '') + '" d="M ' + fmt(ox) + ' ' + fmt(oy) + ' L ' + fmt(x0) + ' ' + fmt(y0) + ' A ' + fmt(radius) + ' ' + fmt(radius) + ' 0 0 0 ' + fmt(x1) + ' ' + fmt(y1) + ' Z"/>'
      );
      const mid = (a0 + a1) / 2;
      const lr = radius + 10;
      const lx = ox + lr * Math.cos(mid);
      const ly = oy - lr * Math.sin(mid);
      parts.push('<text class="compass-label' + (name === undertone ? ' is-active' : '') + '" x="' + fmt(lx) + '" y="' + fmt(ly + 4) + '" text-anchor="' + (angles[i + 1] > 80 ? 'middle' : 'start') + '">' + name + '</text>');
    });

    [10, 20, 30, 40].forEach(function (c) {
      const r = (c / COMPASS.aMax) * radius;
      parts.push('<path class="compass-ring" d="M ' + fmt(ox + r) + ' ' + fmt(oy) + ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 0 ' + fmt(ox) + ' ' + fmt(oy - r) + '"/>');
      parts.push('<text class="compass-tick" x="' + fmt(ox + r) + '" y="' + fmt(oy + 16) + '" text-anchor="middle">' + c + '</text>');
    });
    parts.push('<text class="compass-axis" x="' + fmt(ox + radius / 2) + '" y="' + (COMPASS.height - 8) + '" text-anchor="middle">a* (green to red)</text>');
    parts.push('<text class="compass-axis" transform="translate(12 ' + fmt(oy - radius / 2) + ') rotate(-90)" text-anchor="middle">b* (blue to yellow)</text>');

    const px = s.x(Math.min(Math.max(lab[1], 0), COMPASS.aMax));
    const py = s.y(Math.min(Math.max(lab[2], 0), COMPASS.bMax));
    parts.push('<line class="compass-vector" x1="' + fmt(ox) + '" y1="' + fmt(oy) + '" x2="' + fmt(px) + '" y2="' + fmt(py) + '"/>');
    parts.push('<circle class="arc-sample" cx="' + fmt(px) + '" cy="' + fmt(py) + '" r="10"/>');
    parts.push('<circle class="arc-sample-dot" cx="' + fmt(px) + '" cy="' + fmt(py) + '" r="3"/>');
    parts.push('</svg>');
    return parts.join('');
  }

  /* ---------------------------------------------------------------- */
  /* Text                                                               */
  /* ---------------------------------------------------------------- */

  /** One sentence for the aria-live status line. */
  function describeReading(analysis, ranking) {
    const top = ranking && ranking.foundation && ranking.foundation[0];
    const undertone = analysis.undertone ? analysis.undertone + ' undertone (heuristic)' : 'undertone not rated';
    let text =
      'Sample L* ' + num(analysis.lab[0]) + ', a* ' + num(analysis.lab[1]) + ', b* ' + num(analysis.lab[2]) +
      '. ITA ' + num(analysis.ita) + ' degrees, ' + analysis.category.name + ', ' + undertone + '.';
    if (top) {
      text += ' Closest foundation is ' + top.swatch.name + ', DeltaE00 ' + num(top.deltaE, 2) + ', ' + top.label.toLowerCase() + '.';
    }
    return text;
  }

  function formatLab(lab) {
    return 'L* ' + num(lab[0]) + '  a* ' + num(lab[1]) + '  b* ' + num(lab[2]);
  }

  return {
    ARC: ARC,
    COMPASS: COMPASS,
    esc: esc,
    num: num,
    rayEnd: rayEnd,
    ratioToHueAngle: ratioToHueAngle,
    renderItaArcSvg: renderItaArcSvg,
    renderUndertoneCompassSvg: renderUndertoneCompassSvg,
    describeReading: describeReading,
    formatLab: formatLab
  };
});
