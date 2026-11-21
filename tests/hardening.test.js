'use strict';
/* Pass 1 hardening regression tests: URL guard expansion, upload-target check,
   CIEDE2000 weight/hue edges, gamut bounds, hostile inputs, CSP and hygiene pins. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const Y = require('../youcam-live.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, a + ' vs ' + b);

describe('Public URL guard, IPv6 and trick forms', () => {
  const BLOCKED = [
    'https://[::1]/x.png', 'https://[::]/x.png',
    'https://[::ffff:127.0.0.1]/x.png', 'https://[::ffff:7f00:1]/x.png',
    'https://[fe80::1]/x.png', 'https://[fec0::1]/x.png',
    'https://[fc00::1]/x.png', 'https://[fd00::1]/x.png',
    'https://[64:ff9b::7f00:1]/x.png', 'https://[64:ff9b::a00:1]/x.png',
    'https://example.com@127.0.0.1/x.png', 'https://127.0.0.1:8443/x.png',
    'https://0.0.0.0/x.png', 'https://169.254.169.254/latest/meta-data',
    'https://foo.local/x.png', 'https://db.internal/x.png',
    'ftp://cdn.example.org/x.png', 'HTTPS://LOCALHOST/x.png'
  ];
  BLOCKED.forEach((u) => {
    it('refuses ' + u, () => assert.equal(E.isPublicHttpsUrl(u), false));
  });
  const ALLOWED = [
    'https://cdn.example.org/x.png', 'https://[2606:4700::1]/x.png',
    'https://[2001:4860:4860::8888]/x.png', 'https://172.15.0.1/x.png',
    'https://172.32.0.1/x.png', 'https://user@cdn.example.org/x.png'
  ];
  ALLOWED.forEach((u) => {
    it('allows ' + u, () => assert.equal(E.isPublicHttpsUrl(u), true));
  });
});

describe('Upload target URL is checked before photo bytes leave', () => {
  const KEY = 'k';
  const FILE = { type: 'image/jpeg', name: 'p.jpg', size: 4 };
  function stubbed(targetUrl) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(url);
      if (calls.length === 1) {
        return { ok: true, json: async () => ({ data: { files: [{ file_id: 'f1', requests: [{ url: targetUrl, method: 'PUT', headers: {} }] }] } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    return { calls: calls, fetchImpl: fetchImpl };
  }
  ['http://uploads.example.org/x', 'https://169.254.169.254/x', 'https://[::ffff:7f00:1]/x', 'https://localhost/x'].forEach((bad) => {
    it('refuses to PUT photo bytes to ' + bad, async () => {
      const s = stubbed(bad);
      const client = Y.createYouCamClient({ apiKey: KEY, fetchImpl: s.fetchImpl });
      await assert.rejects(client.uploadFile(FILE), /refuses to use/);
      assert.equal(s.calls.length, 1, 'upload fetch must never run');
    });
  });
  it('accepts a public https signed url', async () => {
    const s = stubbed('https://signed.example.org/put-here?sig=1');
    const client = Y.createYouCamClient({ apiKey: KEY, fetchImpl: s.fetchImpl });
    const id = await client.uploadFile(FILE);
    assert.equal(id, 'f1');
    assert.equal(s.calls.length, 2);
  });
});

describe('CIEDE2000 parametric weights and hue edges', () => {
  const L = [50, 0, 0];
  it('kL=2 halves a pure lightness difference', () => {
    const d1 = E.computeDeltaE2000(L, [52, 0, 0]);
    const d2 = E.computeDeltaE2000(L, [52, 0, 0], { kL: 2 });
    close(d2, d1 / 2, 1e-6);
  });
  it('kC=2 halves a pure chroma difference', () => {
    const a = [50, 20, 0]; const b = [50, 22, 0];
    const d1 = E.computeDeltaE2000(a, b);
    const d2 = E.computeDeltaE2000(a, b, { kC: 2 });
    assert.ok(d2 < d1 && d2 > d1 / 2 - 0.05, 'kC=2 shrinks chroma term toward half');
  });
  it('hue difference wraps across 360 degrees', () => {
    const a = [50, 4 * Math.cos(359 * Math.PI / 180), 4 * Math.sin(359 * Math.PI / 180)];
    const b = [50, 4 * Math.cos(1 * Math.PI / 180), 4 * Math.sin(1 * Math.PI / 180)];
    const near = E.computeDeltaE2000(a, b);
    const far = E.computeDeltaE2000(a, [50, -4, 0]);
    assert.ok(near < far / 10, '2-degree wrap should be tiny vs 180-degree apart');
  });
  it('is finite and nonnegative for achromatic pairs', () => {
    assert.ok(E.computeDeltaE2000([0, 0, 0], [100, 0, 0]) > 0);
    assert.ok(E.computeDeltaE2000([50, 0, 0], [50, 0, 0]) === 0);
  });
  it('accepts partial weight objects', () => {
    const d = E.computeDeltaE2000([50, 10, 10], [60, -10, -10], { kH: 4 });
    assert.ok(Number.isFinite(d) && d > 0);
  });
});

describe('Gamut bounds and conversion edges', () => {
  it('labToSrgb clamps far-out Lab values into gamut', () => {
    [[200, 300, -300], [-50, 0, 0], [50, -400, 400], [0, 0, 0]].forEach((lab) => {
      const rgb = E.labToSrgb(lab[0], lab[1], lab[2]);
      rgb.forEach((v) => {
        assert.ok(Number.isFinite(v) && v >= 0 && v <= 255, lab.join(',') + ' -> ' + v);
      });
    });
  });
  it('srgbToLab is finite at every channel boundary', () => {
    [0, 1, 10, 254, 255].forEach((v) => {
      const lab = E.srgbToLab(v, v, v);
      lab.forEach((x) => assert.ok(Number.isFinite(x), 'channel ' + v));
    });
  });
  it('round trips all 256 gray levels within one channel step', () => {
    for (let v = 0; v <= 255; v += 17) {
      const lab = E.srgbToLab(v, v, v);
      const rgb = E.labToSrgb(lab[0], lab[1], lab[2]);
      assert.ok(Math.abs(rgb[0] - v) <= 1 && Math.abs(rgb[1] - v) <= 1 && Math.abs(rgb[2] - v) <= 1, 'gray ' + v);
    }
  });
  it('parseHex accepts 3/6 digit with or without hash and rejects junk', () => {
    assert.deepEqual(E.parseHex('#fff'), [255, 255, 255]);
    assert.deepEqual(E.parseHex('fff'), [255, 255, 255]);
    assert.deepEqual(E.parseHex('#B84A39'), [184, 74, 57]);
    ['#ff', '#fffff', '#gggggg', '', null, undefined, 5, {}, 'red'].forEach((x) => {
      assert.equal(E.parseHex(x), null, 'reject ' + JSON.stringify(x));
    });
  });
  it('chromaHue reports zero chroma and a defined hue for gray', () => {
    const ch = E.chromaHue(0, 0);
    assert.equal(ch.chroma, 0);
    assert.ok(Number.isFinite(ch.hue));
  });
});

describe('Patch extraction and analysis bounds', () => {
  function img(w, h, fill) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3]; }
    return { width: w, height: h, data: data };
  }
  it('clamps a patch that runs off every edge', () => {
    const p = E.extractPatch(img(64, 64, [180, 120, 90, 255]), -100, 200, 24);
    assert.equal(p.x, 0);
    assert.equal(p.width, 24);
    assert.equal(p.data.length, 24 * 24 * 4);
  });
  it('shrinks the patch to an image smaller than the requested size', () => {
    const p = E.extractPatch(img(10, 8, [180, 120, 90, 255]), 5, 4, 24);
    assert.equal(p.width, 10);
    assert.equal(p.height, 8);
  });
  it('rejects malformed patches', () => {
    [null, {}, { width: 0, height: 4, data: new Uint8ClampedArray(0) },
     { width: 2, height: 2, data: new Uint8ClampedArray(3) }].forEach((p) => {
      assert.throws(() => E.analyzeSkinPatch(p), /patch/);
    });
  });
  it('throws when every pixel is transparent', () => {
    const p = E.extractPatch(img(16, 16, [180, 120, 90, 0]), 8, 8, 16);
    assert.throws(() => E.analyzeSkinPatch(p), /opaque/);
  });
  it('analyzes a single opaque pixel', () => {
    const a = E.analyzeSkinPatch({ width: 1, height: 1, data: new Uint8ClampedArray([180, 120, 90, 255]) });
    assert.ok(Number.isFinite(a.lab[0]));
    assert.equal(a.pixels, 1);
  });
});

describe('YouCam payload and response hardening', () => {
  it('rejects private src urls while allowing public ones', () => {
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_url: 'https://[fd00::5]/x.jpg' }), /publicly reachable https/);
    const ok = E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_url: 'https://cdn.example.org/x.jpg' });
    assert.equal(ok.body.src_file_url, 'https://cdn.example.org/x.jpg');
  });
  it('requires exactly one source', () => {
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'skin-analysis' }), /exactly one/);
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_url: 'https://cdn.example.org/a.jpg', src_file_id: 'f' }), /exactly one/);
  });
  it('never embeds the api key in the payload or curl', () => {
    const req = E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_id: 'f1' });
    const curl = E.buildYouCamCurl(req);
    ['Bearer ', 'sk-', 'apikey'].forEach((s) => assert.ok(!JSON.stringify(req.body).includes(s)));
    assert.ok(curl.includes('YOUR_API_KEY'), 'curl keeps a placeholder, never a key');
  });
  it('classifies action tiers and rejects mixed', () => {
    assert.equal(E.classifyDstActions(E.HD_ACTIONS.slice(0, 2)), 'hd');
    assert.equal(E.classifyDstActions(E.SD_ACTIONS.slice(0, 2)), 'sd');
    assert.equal(E.classifyDstActions([E.HD_ACTIONS[0], E.SD_ACTIONS[0]]), 'mixed');
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_id: 'f', dst_actions: [E.HD_ACTIONS[0], E.SD_ACTIONS[0]] }), /mix/);
  });
  it('tolerates hostile response shapes', () => {
    [{}, { data: null }, { data: {} }, { data: { results: {} } }, { data: { task_status: 'running' } }].forEach((raw) => {
      const out = E.normalizeYouCamSkinResponse(raw);
      assert.ok(out && Array.isArray(out.concerns), 'shape ' + JSON.stringify(raw));
    });
  });
  it('rejects non-document input with a typed error', () => {
    assert.throws(() => E.normalizeYouCamSkinResponse(null), TypeError);
    assert.throws(() => E.normalizeYouCamSkinResponse(5), TypeError);
    assert.throws(() => E.normalizeYouCamSkinResponse('not json'), SyntaxError);
  });
  it('parses a JSON string response and reports an error task', () => {
    const out = E.normalizeYouCamSkinResponse(JSON.stringify({ data: { task_status: 'error', error: 'InvalidParameters', error_message: 'bad field' } }));
    assert.equal(out.taskStatus, 'error');
    assert.ok(out.errorMessage.length > 0);
  });
});

describe('Shipped-page hygiene pins', () => {
  const root = path.join(__dirname, '..');
  it('index.html carries a strict content security policy', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'self'/);
    assert.match(html, /object-src 'none'/);
    assert.ok(!/style-src 'self' 'unsafe-inline'/.test(html), 'no unsafe-inline styles');
  });
  it('stylesheets never set smooth scrolling', () => {
    ['styles.css', 'tokens.css'].forEach((f) => {
      const css = fs.readFileSync(path.join(root, f), 'utf8');
      assert.ok(!/scroll-behavior:\s*smooth/.test(css), f);
    });
  });
  it('no em or en dashes in shipped source', () => {
    ['index.html', 'engine.js', 'app.js', 'render.js', 'youcam-live.js', 'styles.css', 'tokens.css'].forEach((f) => {
      const t = fs.readFileSync(path.join(root, f), 'utf8');
      assert.ok(!t.includes('\u2014'), 'em dash in ' + f);
      assert.ok(!t.includes('\u2013'), 'en dash in ' + f);
    });
  });
});
