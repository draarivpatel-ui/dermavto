'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const E = require('../engine.js');
const R = require('../render.js');
const Y = require('../youcam-live.js');

const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');
const DASH_ENTITIES = new RegExp('&(m|n)dash;|&#(8212|8211|x2014|x2013);', 'i');
const PICTOGRAPHS = new RegExp('[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]', 'u');

const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const tokens = read('tokens.css');

function walkText(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'fonts') return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkText(full, out);
    else if (/\.(html|css|js|md|json|txt)$/.test(entry.name)) out.push(full);
  });
  return out;
}

describe('index.html structure', () => {
  it('declares language, charset and a mobile viewport', () => {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<meta charset="utf-8">/);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  });

  it('has a title and a meta description', () => {
    assert.match(html, /<title>DermaVTO[^<]+<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{60,}">/);
  });

  ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt'].forEach((prop) => {
    it('carries <meta property="' + prop + '">', () => {
      assert.match(html, new RegExp('<meta property="' + prop + '" content="[^"]+">'));
    });
  });

  it('carries a twitter large image card', () => {
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  });

  it('points og:url and og:image at the public site', () => {
    assert.match(html, /og:url" content="https:\/\/aariv\.me\/dermavto\/"/);
    assert.match(html, /og:image" content="https:\/\/aariv\.me\/dermavto\/og\.png"/);
    assert.ok(fs.existsSync(path.join(ROOT, 'og.png')), 'og.png must exist next to index.html');
  });

  it('uses an inline SVG favicon', () => {
    assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
  });

  it('has a noscript fallback with a data table', () => {
    const m = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
    assert.ok(m);
    assert.match(m[1], /<table/);
    assert.match(m[1], /<caption>/);
  });

  it('keeps the noscript table in step with the engine', () => {
    const rows = [...html.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
    assert.equal(rows.length, 5);
    rows.forEach((row, i) => {
      const preset = E.PRESETS[i];
      assert.equal(row[1], preset.name);
      assert.equal(Number(row[2]), preset.lab[0]);
      assert.equal(Number(row[3]), preset.lab[1]);
      assert.equal(Number(row[4]), preset.lab[2]);
      const ita = E.computeItaAngle(preset.lab[0], preset.lab[2]);
      assert.equal(row[5], ita.toFixed(1));
      assert.equal(row[6], E.classifyItaCategory(ita).name);
      assert.equal(row[7], E.classifyUndertone(preset.lab[1], preset.lab[2]));
    });
  });

  it('shows the same preset values as the engine in the visible list', () => {
    E.PRESETS.forEach((p) => {
      const expected = 'L* ' + p.lab[0].toFixed(1) + ' a* ' + p.lab[1].toFixed(1) + ' b* ' + p.lab[2].toFixed(1);
      assert.ok(html.includes('data-lab="' + p.id + '">' + expected + '<'), p.id + ' label');
      assert.ok(html.includes('<span class="preset-name">' + p.name + '</span>'), p.id + ' name');
    });
  });

  it('has live regions for status, copy notes and form errors', () => {
    assert.match(html, /id="status" role="status" aria-live="polite"/);
    assert.match(html, /id="yc-copy-note" role="status" aria-live="polite"/);
    assert.match(html, /id="receipt-note" role="status" aria-live="polite"/);
    assert.match(html, /id="yc-error" role="alert"/);
    assert.match(html, /id="yc-read-error" role="alert"/);
  });

  it('has exactly one h1 and no skipped heading levels', () => {
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    assert.equal(levels.filter((l) => l === 1).length, 1);
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] - levels[i - 1] <= 1, 'jump at heading ' + i);
  });

  it('has unique ids', () => {
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('gives every text, range, file, select and textarea control an accessible name', () => {
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    const labelFor = new Set([...html.matchAll(/<label[^>]* for="([^"]+)"/g)].map((m) => m[1]));
    const controls = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter((m) => !/type="(radio|hidden)"/.test(m[2]));
    assert.ok(controls.length >= 10);
    controls.forEach((m) => {
      const id = (/ id="([^"]+)"/.exec(m[2]) || [])[1];
      const named = /aria-label(ledby)?="/.test(m[2]) || (id && labelFor.has(id));
      assert.ok(named, 'unnamed control ' + m[0]);
    });
    labelFor.forEach((id) => assert.ok(ids.has(id), 'label for missing id ' + id));
  });

  it('wraps every radio in a label or radiogroup', () => {
    const radios = [...html.matchAll(/<label[^>]*>(?:(?!<\/label>)[\s\S])*type="radio"(?:(?!<\/label>)[\s\S])*<\/label>/g)];
    const count = [...html.matchAll(/type="radio"/g)].length;
    assert.equal(radios.length, count);
    assert.ok(count >= 12);
    assert.ok((html.match(/role="radiogroup"/g) || []).length >= 5);
  });

  it('hides decorative svg from assistive tech and names the rest', () => {
    [...html.matchAll(/<svg\b([^>]*)>/g)].forEach((m) => {
      assert.ok(/aria-hidden="true"/.test(m[1]) || /role="img"/.test(m[1]), 'svg without aria: ' + m[0]);
    });
  });

  it('has a skip link before the masthead', () => {
    assert.ok(html.indexOf('class="skip-link"') < html.indexOf('class="masthead"'));
  });

  it('loads everything from this site, with no third party font or script host', () => {
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr/);
    [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].forEach((m) => {
      if (m[1].startsWith('data:')) return;
      assert.doesNotMatch(m[1], /^(https?:)?\/\//, 'external asset ' + m[1]);
    });
  });

  it('loads engine, render and app scripts in order', () => {
    const a = html.indexOf('src="engine.js"');
    const b = html.indexOf('src="render.js"');
    const c = html.indexOf('src="app.js"');
    assert.ok(a > 0 && a < b && b < c);
  });

  it('states the cosmetic and educational limits in the page text', () => {
    assert.match(html, /not a clinical assessment/);
    assert.match(html, /replaces a dermatologist/);
  });

  it('never uses diagnose or detect wording in its own prose', () => {
    const prose = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
    assert.doesNotMatch(prose, /\b(diagnos\w*|detect\w*)\b/i);
  });
});

describe('Style rules', () => {
  it('has no em dash, en dash or their entities in any text file', () => {
    walkText(ROOT, []).forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, DASHES, file);
      assert.doesNotMatch(text, DASH_ENTITIES, file);
    });
  });

  it('has no emoji or pictograph in any text file', () => {
    walkText(ROOT, []).forEach((file) => {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), PICTOGRAPHS, file);
    });
  });

  it('has no middle dot or bullet separators in the page or the styles', () => {
    assert.doesNotMatch(html + css, /[\u00B7\u2022]|&middot;|&bull;/);
  });

  it('has no uppercase kicker styling', () => {
    assert.doesNotMatch(css, /text-transform:\s*uppercase/);
    assert.doesNotMatch(css, /letter-spacing:\s*0?\.[1-9]\d*em/);
  });

  it('keeps raw colours out of styles.css', () => {
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla|oklch|lab)\(/);
  });

  it('keeps font-family declarations on tokens', () => {
    [...css.matchAll(/font-family:\s*([^;]+);/g)].forEach((m) => assert.match(m[1].trim(), /^var\(--font-(display|body|mono)\)$/));
    assert.doesNotMatch(html, /font-family/);
  });

  it('resolves every var(--token) used in styles.css and index.html', () => {
    const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...(css + html).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    used.forEach((name) => {
      if (name === '--split') return;
      assert.ok(defined.has(name), name + ' is not defined in tokens.css');
    });
  });

  it('defines the five brand colours exactly', () => {
    const t = tokens.toLowerCase();
    ['#faf7f2', '#f1ece3', '#181514', '#b84a39', '#2a6f62'].forEach((hex) => assert.ok(t.includes(hex), hex));
  });

  it('keeps headings roman with Cormorant Garamond display type', () => {
    assert.doesNotMatch(css, /font-style:\s*italic/);
    assert.match(tokens, /--font-display:\s*"Cormorant Garamond"/);
    assert.match(tokens, /--font-body:\s*"Plus Jakarta Sans"/);
    assert.match(tokens, /--font-mono:\s*"JetBrains Mono"/);
  });

  it('serves the three fonts from this repository', () => {
    ['cormorant-garamond', 'plus-jakarta-sans', 'jetbrains-mono'].forEach((f) => {
      assert.ok(fs.statSync(path.join(ROOT, 'fonts', f + '.woff2')).size > 10000, f);
      assert.ok(tokens.includes('fonts/' + f + '.woff2'), f);
    });
  });

  it('clips horizontal overflow on html and body, never hides it', () => {
    assert.match(css, /html\s*\{[^}]*overflow-x:\s*clip/);
    assert.match(css, /body\s*\{[^}]*overflow-x:\s*clip/);
    assert.doesNotMatch(css, /overflow-x:\s*hidden/);
  });

  it('shows a visible focus ring and a reduced motion path', () => {
    assert.match(css, /:focus-visible\s*\{[^}]*outline:/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  });

  it('styles disabled, busy, success and error states for buttons', () => {
    assert.match(css, /\.btn:disabled/);
    assert.match(css, /\.btn\[aria-busy="true"\]/);
    assert.match(css, /\.btn\[data-state="success"\]/);
    assert.match(css, /\.btn\[data-state="error"\]/);
  });

  it('animates only transform and opacity in keyframes', () => {
    [...css.matchAll(/@keyframes[^{]+\{([\s\S]*?\})\s*\}/g)].forEach((m) => {
      [...m[1].matchAll(/([a-z-]+)\s*:/g)].forEach((p) => assert.ok(['opacity', 'transform'].includes(p[1]), p[1]));
    });
  });

  it('opens styles.css with the Hallmark stamp', () => {
    assert.match(css.split('\n')[0], /^\/\* Hallmark \| macrostructure: Workbench/);
  });
});

describe('render.js output', () => {
  const rows = E.rankShades([66, 10, 23], 'foundation');
  const svg = R.renderItaArcSvg({ lab: [66, 10, 23], ita: 34.8, category: E.classifyItaCategory(34.8), rows: rows });
  const compass = R.renderUndertoneCompassSvg({ lab: [66, 10, 23], undertone: 'Warm' });

  it('draws the arc with a title, a description and role img', () => {
    assert.match(svg, /^<svg[^>]*role="img"/);
    assert.match(svg, /<title id="arc-title">/);
    assert.match(svg, /<desc id="arc-desc">/);
  });

  it('plots all 13 foundation swatches and numbers the top three', () => {
    assert.equal((svg.match(/class="arc-swatch/g) || []).length, 13);
    assert.equal((svg.match(/class="arc-rank"/g) || []).length, 3);
    assert.equal((svg.match(/class="arc-ray"/g) || []).length, 5);
  });

  it('prints the ITA of the sample and the six band names', () => {
    assert.ok(svg.includes('ITA 34.8\u00b0'));
    E.ITA_CATEGORIES.forEach((c) => assert.ok(svg.includes('>' + c.name + '<'), c.name));
  });

  it('computes ray ends on the plot edge', () => {
    const top = R.rayEnd(55);
    assert.equal(top.L, 100);
    const side = R.rayEnd(10);
    assert.equal(side.b, 40);
    const low = R.rayEnd(-30);
    assert.ok(low.L > 10);
  });

  it('draws four compass zones and marks the active one', () => {
    ['cool', 'neutral', 'warm', 'olive'].forEach((z) => assert.ok(compass.includes('zone-' + z)));
    assert.match(compass, /zone-warm is-active/);
    assert.equal((compass.match(/is-active/g) || []).length, 2);
  });

  it('puts the compass zone edges where the undertone cuts are', () => {
    close(R.ratioToHueAngle(0.72), Math.atan(1 / 0.72) * 180 / Math.PI);
    assert.ok(R.ratioToHueAngle(0.4) > R.ratioToHueAngle(0.52));
  });

  it('marks both plots as non focusable images', () => {
    assert.equal((svg.match(/focusable="false"/g) || []).length, 1);
    assert.equal((compass.match(/focusable="false"/g) || []).length, 1);
  });

  it('prints every axis tick on the arc', () => {
    assert.equal((svg.match(/class="arc-tick"/g) || []).length, 10);
    ['0', '10', '20', '30', '40', '60', '80', '100'].forEach((v) => assert.ok(svg.includes('>' + v + '</text>'), v));
    assert.equal((svg.match(/class="arc-grid"/g) || []).length, 10);
  });

  it('anchors the band names at the right edge or above their ray', () => {
    ['Light', 'Intermediate', 'Tan', 'Brown'].forEach((name) => {
      assert.match(svg, new RegExp('text-anchor="end">' + name + '<'), name);
    });
    ['Very Light', 'Dark'].forEach((name) => {
      assert.match(svg, new RegExp('text-anchor="middle">' + name + '<'), name);
    });
  });

  it('draws compass zones that span 0, the three cuts and 90 degrees', () => {
    const paths = [...compass.matchAll(/<path class="compass-zone[^"]*" d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+) A [\d.]+ [\d.]+ 0 0 0 ([\d.]+) ([\d.]+) Z"/g)];
    assert.equal(paths.length, 4);
    const angle = (x, y, ox, oy) => Math.atan2(oy - y, x - ox) * 180 / Math.PI;
    const expected = [0, R.ratioToHueAngle(0.72), R.ratioToHueAngle(0.52), R.ratioToHueAngle(0.4), 90];
    paths.forEach((m, i) => {
      const ox = Number(m[1]);
      const oy = Number(m[2]);
      close(angle(Number(m[3]), Number(m[4]), ox, oy), expected[i], 0.05);
      close(angle(Number(m[5]), Number(m[6]), ox, oy), expected[i + 1], 0.05);
    });
  });

  it('left aligns the first three compass labels and centres the last', () => {
    assert.match(compass, /text-anchor="start">Cool</);
    assert.match(compass, /text-anchor="start">Neutral</);
    assert.match(compass, /text-anchor="start">Warm</);
    assert.match(compass, /text-anchor="middle">Olive</);
  });

  it('escapes text', () => {
    assert.equal(R.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('describes a reading in one sentence', () => {
    const analysis = { lab: [66, 10, 23], ita: 34.8, category: { name: 'Intermediate' }, undertone: 'Warm' };
    const text = R.describeReading(analysis, { foundation: rows });
    assert.match(text, /ITA 34\.8 degrees, Intermediate, Warm undertone \(heuristic\)\./);
    assert.match(text, /Closest foundation is \w+, DeltaE00 \d+\.\d\d, /);
  });

  function close(a, b, tol) {
    assert.ok(Math.abs(a - b) < (tol || 1e-9), 'expected ' + b + ' got ' + a);
  }
});

/* ---------------------------------------------------------------- */
/* Run app.js against a small stand-in DOM                           */
/* ---------------------------------------------------------------- */

class El {
  constructor(id) {
    this.id = id || '';
    this.attrs = {};
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    this.dataset = {};
    this.listeners = {};
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.files = null;
    this.ctx = { last: null, putImageData(img) { this.last = img; }, drawImage() {}, getImageData() { return null; } };
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  fire(type, extra) {
    (this.listeners[type] || []).forEach((fn) =>
      fn(Object.assign({ target: this, preventDefault() {}, shiftKey: false }, extra))
    );
  }
  click() {
    this.fire('click');
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] === undefined ? null : this.attrs[k];
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  getContext() {
    return this.ctx;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 590, height: 738 };
  }
  querySelectorAll(sel) {
    if (this.id === 'yc-actions' && sel === 'input') {
      return [...this.innerHTML.matchAll(/<input type="checkbox" value="([^"]+)"( checked)?>/g)].map((m) => {
        const c = new El();
        c.value = m[1];
        c.checked = !!m[2];
        return c;
      });
    }
    return [];
  }
}

function buildDocument() {
  const byId = {};
  [...html.matchAll(/ id="([^"]+)"/g)].forEach((m) => {
    byId[m[1]] = new El(m[1]);
  });
  const radios = {};
  [...html.matchAll(/<input type="radio" name="([^"]+)" value="([^"]+)"( checked)?>/g)].forEach((m) => {
    const r = new El();
    r.value = m[2];
    r.checked = !!m[3];
    r.name = m[1];
    (radios[m[1]] = radios[m[1]] || []).push(r);
  });
  const chips = [...html.matchAll(/data-chip="([^"]+)"/g)].map((m) => {
    const c = new El();
    c.dataset.chip = m[1];
    return c;
  });
  const defaults = { coverage: '60', glow: '10', 'lip-intensity': '85', 'lip-finish': 'satin', 'yc-src': 'https://example.com/selfie.jpg', 'yc-src-type': 'src_file_url', split: '50' };
  Object.keys(defaults).forEach((k) => {
    byId[k].value = defaults[k];
  });
  return {
    byId: byId,
    radios: radios,
    chips: chips,
    document: {
      getElementById: (id) => byId[id] || null,
      querySelectorAll(sel) {
        const m = /^input\[name="([^"]+)"\]$/.exec(sel);
        if (m) return radios[m[1]] || [];
        if (sel === '.preset-chip') return chips;
        return [];
      },
      createElement: () => new El()
    }
  };
}

describe('app.js on a stand-in DOM', () => {
  let dom;
  let clipboard;
  let currentFetch = () => Promise.reject(new Error('unscripted fetch'));

  function pick(name, value) {
    dom.radios[name].forEach((r) => {
      r.checked = r.value === value;
    });
    dom.radios[name].find((r) => r.value === value).fire('change');
  }

  before(() => {
    dom = buildDocument();
    clipboard = [];
    const sandbox = {
      window: null,
      document: dom.document,
      DermaVTO: E,
      DermaRender: R,
      DermaYouCam: Y,
      fetch: (...args) => currentFetch(...args),
      ImageData: class ImageData {
        constructor(data, width, height) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
      requestAnimationFrame: (fn) => fn(),
      setTimeout: () => 0,
      navigator: { clipboard: { writeText: (t) => { clipboard.push(t); return Promise.resolve(); } } },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
      Image: class Image {},
      Float32Array,
      Uint8ClampedArray,
      Math,
      Number,
      JSON,
      Object,
      Array
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('app.js'), sandbox, { filename: 'app.js' });
  });

  it('draws the first reading on load', () => {
    assert.match(dom.byId.status.textContent, /^Sample L\* \d+\.\d, a\* /);
    assert.match(dom.byId.status.textContent, /Intermediate, Warm undertone \(heuristic\)/);
  });

  it('paints both canvases at 640 by 800', () => {
    ['canvas-raw', 'canvas-result'].forEach((id) => {
      const img = dom.byId[id].ctx.last;
      assert.equal(img.width, 640);
      assert.equal(img.height, 800);
      assert.equal(img.data.length, 640 * 800 * 4);
    });
  });

  it('renders the arc, the compass and fifteen metric rows', () => {
    assert.match(dom.byId['arc-host'].innerHTML, /^<svg class="arc-svg"/);
    assert.match(dom.byId['compass-host'].innerHTML, /^<svg class="compass-svg"/);
    assert.equal((dom.byId.metrics.innerHTML.match(/<dt>/g) || []).length, 15);
    assert.match(dom.byId['arc-host'].innerHTML, /class="arc-legend">1 /);
  });

  it('lists 13 foundations with three marked Top 3 and one in use', () => {
    const list = dom.byId.ranking.innerHTML;
    assert.equal((list.match(/<li>/g) || []).length, 13);
    assert.equal((list.match(/top-flag/g) || []).length, 3);
    assert.equal((list.match(/aria-pressed="true"/g) || []).length, 1);
  });

  it('builds the default skin analysis request', () => {
    assert.match(dom.byId['yc-endpoint'].textContent, /^POST https:\/\/yce-api-01\.makeupar\.com\/s2s\/v2\.0\/task\/skin-analysis$/);
    const body = JSON.parse(dom.byId['yc-json'].textContent);
    assert.equal(body.dst_actions.length, 8);
    assert.equal(body.format, 'json');
    assert.equal(dom.byId['yc-error'].textContent, '');
  });

  it('shows 16 HD action choices with 8 checked', () => {
    const boxes = dom.byId['yc-actions'].querySelectorAll('input');
    assert.equal(boxes.length, 16);
    assert.equal(boxes.filter((b) => b.checked).length, 8);
  });

  it('shows the receipt from the local estimate with the disclaimer', () => {
    assert.match(dom.byId['receipt-text'].textContent, /^DermaVTO receipt \(local estimate\)/);
    assert.ok(dom.byId['receipt-text'].textContent.includes(E.DISCLAIMER));
    assert.match(dom.byId['receipt-source'].textContent, /local estimate/);
  });

  it('switches presets and updates the reading', () => {
    const before = dom.byId.status.textContent;
    pick('preset', 'p6');
    assert.notEqual(dom.byId.status.textContent, before);
    assert.match(dom.byId.status.textContent, /Dark, Neutral undertone/);
  });

  it('switches the right side to the chromophore map', () => {
    pick('mode', 'map');
    assert.equal(dom.byId['tag-right'].textContent, 'Chromophore map');
    pick('mode', 'tryon');
    assert.equal(dom.byId['tag-right'].textContent, 'Try on');
  });

  it('updates the split position and its spoken value', () => {
    dom.byId.split.value = '30';
    dom.byId.split.fire('input');
    assert.equal(dom.byId.stage.style.props['--split'], '30%');
    assert.match(dom.byId.split.attrs['aria-valuetext'], /Raw sample 30 percent, result 70 percent/);
  });

  it('echoes slider values into their outputs', () => {
    dom.byId.coverage.value = '80';
    dom.byId.coverage.fire('input');
    assert.equal(dom.byId['coverage-out'].textContent, '80');
  });

  it('switches to concealer and lip rankings', () => {
    pick('kind', 'concealer');
    assert.equal((dom.byId.ranking.innerHTML.match(/<li>/g) || []).length, 6);
    assert.match(dom.byId.ranking.innerHTML, /Use in request/);
    pick('kind', 'lip');
    assert.equal((dom.byId.ranking.innerHTML.match(/<li>/g) || []).length, 5);
  });

  it('selects a shade from the list and reflects it in the pressed state', () => {
    const button = { dataset: { shade: 'l05', kind: 'lip' } };
    dom.byId.ranking.fire('click', { target: { closest: () => button } });
    assert.match(dom.byId.ranking.innerHTML, /data-shade="l05" data-kind="lip" aria-pressed="true">In use/);
  });

  it('puts the chosen shades into a makeup try on request', () => {
    pick('yc-task', 'makeup-vto');
    const body = JSON.parse(dom.byId['yc-json'].textContent);
    assert.equal(body.version, '1.0');
    assert.deepEqual(body.effects.map((e) => e.category), ['foundation', 'concealer', 'lip_color']);
    assert.equal(body.effects[0].palettes[0].coverageIntensity, 80);
    assert.equal(body.effects[2].palettes[0].color, E.SWATCHES.find((s) => s.id === 'l05').hex.toUpperCase());
    assert.equal(dom.byId['yc-skin-options'].hidden, true);
  });

  it('reports a request error and disables copying for a private url', () => {
    pick('yc-task', 'skin-analysis');
    dom.byId['yc-src'].value = 'https://192.168.0.2/me.jpg';
    dom.byId['yc-src'].fire('input');
    assert.match(dom.byId['yc-error'].textContent, /publicly reachable https URL/);
    assert.equal(dom.byId['yc-copy-json'].disabled, true);
    assert.equal(dom.byId['yc-json'].textContent, '');
    dom.byId['yc-src'].value = 'https://example.com/selfie.jpg';
    dom.byId['yc-src'].fire('input');
    assert.equal(dom.byId['yc-copy-json'].disabled, false);
  });

  it('swaps to SD actions when the tier changes', () => {
    pick('yc-tier', 'sd');
    const body = JSON.parse(dom.byId['yc-json'].textContent);
    assert.ok(body.dst_actions.every((a) => !a.startsWith('hd_')));
    assert.equal(body.dst_actions.length, 8);
    pick('yc-tier', 'hd');
  });

  it('copies the request JSON and curl to the clipboard', async () => {
    dom.byId['yc-copy-json'].click();
    dom.byId['yc-copy-curl'].click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(clipboard.length, 2);
    assert.ok(clipboard[0].startsWith('{'));
    assert.ok(clipboard[1].startsWith('curl --request POST'));
    assert.equal(dom.byId['yc-copy-json'].attrs['data-state'], 'success');
  });

  it('reads the docs sample into a table and a YouCam receipt', () => {
    dom.byId['yc-sample'].click();
    assert.match(dom.byId['yc-table-host'].innerHTML, /<table class="data-table">/);
    assert.match(dom.byId['yc-table-host'].innerHTML, /Overall 75\.8, Skin age 37/);
    assert.match(dom.byId['receipt-text'].textContent, /^DermaVTO receipt \(YouCam scores\)/);
    assert.match(dom.byId['receipt-text'].textContent, /Routine for moisture \(Priority/);
    assert.match(dom.byId['receipt-source'].textContent, /raw scores/);
  });

  it('flags an empty or broken response paste', () => {
    dom.byId['yc-response'].value = '';
    dom.byId['yc-read'].click();
    assert.match(dom.byId['yc-read-error'].textContent, /Paste a response first/);
    dom.byId['yc-response'].value = '{nope';
    dom.byId['yc-read'].click();
    assert.match(dom.byId['yc-read-error'].textContent, /not valid JSON/);
    assert.equal(dom.byId['yc-response'].attrs['aria-invalid'], 'true');
  });

  it('rejects a bad hex colour and accepts a good one', () => {
    dom.byId['hex-input'].value = 'nope';
    dom.byId['hex-apply'].click();
    assert.equal(dom.byId['hex-input'].attrs['aria-invalid'], 'true');
    assert.match(dom.byId.status.textContent, /not a hex colour/);
    dom.byId['hex-input'].value = '#C3987A';
    dom.byId['hex-apply'].click();
    assert.equal(dom.byId['hex-input'].attrs['aria-invalid'], undefined);
    assert.match(dom.byId['stage-caption'].textContent, /#C3987A/);
  });

  it('turns the skin patch picker on and moves the patch with the arrow keys', () => {
    dom.byId['sample-toggle'].click();
    assert.equal(dom.byId['sample-toggle'].attrs['aria-pressed'], 'true');
    assert.equal(dom.byId['stage-picker'].hidden, false);
    const before = dom.byId['stage-ring'].style.left;
    dom.byId['stage-picker'].fire('keydown', { key: 'ArrowLeft' });
    assert.notEqual(dom.byId['stage-ring'].style.left, before);
    dom.byId['sample-toggle'].click();
    assert.equal(dom.byId['stage-picker'].hidden, true);
  });

  it('copies the receipt text', async () => {
    dom.byId['receipt-copy'].click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(clipboard[2].startsWith('DermaVTO receipt'));
  });

  async function settle() {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  function route(table) {
    const log = [];
    currentFetch = async (url, init) => {
      const key = ((init && init.method) || 'GET') + ' ' + url;
      log.push(key);
      const hit = table[key];
      if (!hit) throw new Error('unscripted ' + key);
      return { ok: hit.status < 400, status: hit.status, json: async () => hit.body };
    };
    return log;
  }

  const SKIN = 'https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis';
  const VTO = 'https://yce-api-01.makeupar.com/s2s/v2.0/task/makeup-vto';

  it('keeps Run live disabled until there is a key and consent', () => {
    assert.equal(dom.byId['yc-run'].disabled, true);
    dom.byId['yc-key'].value = 'abc123';
    dom.byId['yc-key'].fire('input');
    assert.equal(dom.byId['yc-run'].disabled, true);
    dom.byId['yc-consent'].checked = true;
    dom.byId['yc-consent'].fire('change');
    assert.equal(dom.byId['yc-run'].disabled, false);
  });

  it('runs a live skin analysis and fills the response inspector', async () => {
    pick('yc-task', 'skin-analysis');
    dom.byId['yc-src'].value = 'https://example.com/selfie.jpg';
    dom.byId['yc-src'].fire('input');
    const log = route({
      ['POST ' + SKIN]: { status: 200, body: { status: 200, data: { task_id: 'T9' } } },
      ['GET ' + SKIN + '/T9']: { status: 200, body: { status: 200, data: { task_status: 'success', results: { output: [{ type: 'hd_pore', region: 'whole', raw_score: 42.5, ui_score: 63 }, { score: 66 }] } } } }
    });
    dom.byId['yc-run'].click();
    await settle();
    assert.deepEqual(log, ['POST ' + SKIN, 'GET ' + SKIN + '/T9']);
    assert.match(dom.byId['yc-live-status'].textContent, /^Done\. The scores are in the response inspector/);
    assert.match(dom.byId['yc-response'].value, /"raw_score": 42\.5/);
    assert.match(dom.byId['yc-table-host'].innerHTML, /Pores/);
    assert.equal(dom.byId['yc-run'].attrs['aria-busy'], undefined);
  });

  it('shows a rejected key as a flagged status line', async () => {
    route({ ['POST ' + SKIN]: { status: 401, body: { status: 401, error: "This API key isn't recognized.", error_code: 'InvalidApiKey' } } });
    dom.byId['yc-run'].click();
    await settle();
    assert.match(dom.byId['yc-live-status'].textContent, /did not recognise this API key/);
    assert.equal(dom.byId['yc-live-status'].attrs['data-error'], 'true');
  });

  it('runs a live try on and shows the returned image', async () => {
    pick('yc-task', 'makeup-vto');
    route({
      ['POST ' + VTO]: { status: 200, body: { status: 200, data: { task_id: 'V1' } } },
      ['GET ' + VTO + '/V1']: { status: 200, body: { status: 200, data: { task_status: 'success', results: { url: 'https://cdn.example.com/out.jpg' } } } }
    });
    dom.byId['yc-run'].click();
    await settle();
    assert.match(dom.byId['yc-live-result'].innerHTML, /<img src="https:\/\/cdn\.example\.com\/out\.jpg" alt="Try on result/);
    assert.equal(dom.byId['yc-live-status'].attrs['data-error'], undefined);
    pick('yc-task', 'skin-analysis');
  });

  it('asks for a photo before an upload run and sends nothing', async () => {
    dom.byId['yc-src-type'].value = 'upload';
    dom.byId['yc-src-type'].fire('change');
    assert.equal(dom.byId['yc-upload-field'].hidden, false);
    assert.equal(dom.byId['yc-src-field'].hidden, true);
    assert.match(dom.byId['yc-json'].textContent, /"src_file_id": "ASSIGNED_AFTER_UPLOAD"/);
    const log = route({});
    dom.byId['yc-upload'].files = [];
    dom.byId['yc-run'].click();
    await settle();
    assert.match(dom.byId['yc-live-status'].textContent, /Choose a photo to upload first/);
    assert.equal(log.length, 0);
    dom.byId['yc-src-type'].value = 'src_file_url';
    dom.byId['yc-src-type'].fire('change');
  });

  it('refuses an upload of the wrong type', async () => {
    dom.byId['yc-src-type'].value = 'upload';
    dom.byId['yc-src-type'].fire('change');
    const log = route({});
    dom.byId['yc-upload'].files = [{ name: 'a.gif', type: 'image/gif', size: 10 }];
    dom.byId['yc-run'].click();
    await settle();
    assert.match(dom.byId['yc-live-status'].textContent, /JPEG or PNG/);
    assert.equal(log.length, 0);
    dom.byId['yc-src-type'].value = 'src_file_url';
    dom.byId['yc-src-type'].fire('change');
  });

  it('makes no network calls outside youcam-live.js', () => {
    ['app.js', 'engine.js', 'render.js'].forEach((name) => {
      assert.doesNotMatch(read(name), /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.geolocation|new Image\(\)\.src/, name);
    });
    const live = read('youcam-live.js');
    assert.equal((live.match(/o\.fetchImpl\(/g) || []).length, 2);
    assert.doesNotMatch(live, /localStorage|sessionStorage|document\.cookie|console\./);
  });

  it('never writes the api key to storage or to the page', () => {
    const app = read('app.js');
    assert.doesNotMatch(app, /localStorage|sessionStorage|document\.cookie/);
    assert.equal(dom.byId['yc-key'].attrs.value, undefined);
    assert.ok(!html.includes('autocomplete="on"'));
    assert.match(html, /id="yc-key" type="password" autocomplete="off"/);
  });
});
