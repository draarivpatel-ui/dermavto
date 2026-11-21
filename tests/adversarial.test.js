'use strict';
/* Pass 2 regression tests: every defect the hostile audit reproduced is pinned here.
   URL guard bypass classes, upload header forwarding, malformed patches, non-finite
   propagation, payload types, poll hang, blur hang, classifier and normalizer edges. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const Y = require('../youcam-live.js');

const KEY = 'k';
const FILE = { type: 'image/jpeg', name: 'p.jpg', size: 4 };

function client(fetchImpl, extra) {
  return Y.createYouCamClient(
    Object.assign({ apiKey: KEY, fetchImpl: fetchImpl, sleep: () => Promise.resolve(), pollMs: 1, timeoutMs: 10 }, extra)
  );
}

describe('URL guard covers the bypass classes the audit found', () => {
  const BLOCKED = [
    'https://localhost./x', 'https://LOCALHOST./x', 'https://foo.local./x',
    'https://db.internal./x', 'https://a.internal./x', 'https://lan./x',
    'https://home.arpa./x', 'https://corp./x', 'https://local./x',
    'https://localhost%2e/x', 'https://localhost。/x', 'https://foo.local。/x',
    'https://api.localhost/x', 'https://localhost.localdomain/x',
    'https://local/x', 'https://intranet/x', 'https:///x',
    'https://100.64.5.5/x', 'https://100.127.0.1/x', 'https://0.1.2.3/x',
    'https://192.0.0.9/x', 'https://192.88.99.7/x', 'https://198.18.0.1/x',
    'https://198.19.255.254/x', 'https://224.0.0.1/x', 'https://240.0.0.1/x',
    'https://255.255.255.255/x', 'https://999.1.1.1/x', 'https://198.51.100.5/x',
    'https://203.0.113.5/x',
    'https://[64:ff9b:1::a00:1]/x', 'https://[2002:a00:1::]/x',
    'https://[2001::4136:e378:8000:63bf:3fff:fdd2]/x', 'https://[2001:db8::1]/x',
    'https://[3fff::1]/x', 'https://[ff02::1]/x', 'https://[0:1::1]/x',
    'https://[::ffff:0a00:1]/x', 'https://[::ffff:c0a8:101]/x',
    'https://[fe80::1%25eth0]/x', 'https://[0:0:0:0:0:0:0:2]/x'
  ];
  BLOCKED.forEach((u) => {
    it('refuses ' + u, () => assert.equal(E.isPublicHttpsUrl(u), false));
  });
  const ALLOWED = [
    'https://cdn.example.org/x.png', 'https://1.1.1.1/x', 'https://8.8.8.8/x',
    'https://[2001:4860:4860::8888]/x', 'https://[2606:4700:4700::1111]/x',
    'https://example.com./x', 'https://a.b.co.uk/x', 'https://192.0.1.5/x',
    'https://100.63.255.255/x', 'https://172.15.0.1/x', 'https://192.167.0.1/x'
  ];
  ALLOWED.forEach((u) => {
    it('allows ' + u, () => assert.equal(E.isPublicHttpsUrl(u), true));
  });
});

describe('Upload slot headers are filtered to the storage allowlist', () => {
  it('drops Authorization and custom headers, keeps Content-Type', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: url, init: init });
      if (calls.length === 1) {
        return { ok: true, json: async () => ({ data: { files: [{ file_id: 'f1', requests: [{ url: 'https://cdn.youcam.example/put', method: 'PUT', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'image/jpg', 'X-Evil': '1', 'x-amz-acl': 'private' } }] }] } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    const id = await client(fetchImpl).uploadFile(FILE);
    assert.equal(id, 'f1');
    const sent = calls[1].init.headers;
    assert.deepEqual(Object.keys(sent).sort(), ['Content-Type', 'x-amz-acl']);
  });
  it('rejects a non-PUT/POST upload method', async () => {
    const fetchImpl = async (url, init) => {
      if (url.indexOf('/file') !== -1) {
        return { ok: true, json: async () => ({ data: { files: [{ file_id: 'f1', requests: [{ url: 'https://cdn.youcam.example/put', method: 'DELETE', headers: {} }] }] } }) };
      }
      return { ok: true, json: async () => ({}) };
    };
    await assert.rejects(client(fetchImpl).uploadFile(FILE), /upload method/);
  });
  it('rejects a missing file without a raw TypeError', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
    await assert.rejects(client(fetchImpl).uploadFile(null), Y.YouCamApiError);
  });
});

describe('pollTask terminates on a frozen or NaN clock', () => {
  const running = async () => ({ ok: true, json: async () => ({ data: { task_status: 'running' } }) });
  it('frozen clock still stops via the attempt cap', async () => {
    await assert.rejects(client(running, { now: () => 1000 }).pollTask('skin-analysis', 't1'), /did not finish/);
  });
  it('NaN clock stops immediately', async () => {
    await assert.rejects(client(running, { now: () => NaN }).pollTask('skin-analysis', 't1'), /did not finish/);
  });
});

describe('runMakeupVto validates the result link', () => {
  function vtoStub(resultUrl) {
    let n = 0;
    return async () => {
      n += 1;
      if (n === 1) return { ok: true, json: async () => ({ data: { task_id: 't1' } }) };
      return { ok: true, json: async () => ({ data: { task_status: 'success', results: { url: resultUrl } } }) };
    };
  }
  const effect = E.buildFoundationEffect('#C3987A');
  it('rejects a non-string result url', async () => {
    await assert.rejects(client(vtoStub(12345)).runMakeupVto({ src_file_url: 'https://cdn.example.org/p.jpg', effects: [effect] }), /result link/);
  });
  it('rejects a private result host', async () => {
    await assert.rejects(client(vtoStub('https://localhost./r.png')).runMakeupVto({ src_file_url: 'https://cdn.example.org/p.jpg', effects: [effect] }), /result link/);
  });
  it('accepts a public https result', async () => {
    const r = await client(vtoStub('https://cdn.youcam.example/r.png')).runMakeupVto({ src_file_url: 'https://cdn.example.org/p.jpg', effects: [effect] });
    assert.equal(r.url, 'https://cdn.youcam.example/r.png');
  });
});

describe('Patch and image contracts reject malformed input', () => {
  it('analyzeSkinPatch requires integer dims', () => {
    assert.throws(() => E.analyzeSkinPatch({ width: 2.5, height: 2, data: new Uint8ClampedArray(20) }), TypeError);
    assert.throws(() => E.analyzeSkinPatch({ width: 10.5, height: 4, data: new Uint8ClampedArray(42 * 4) }), TypeError);
  });
  it('analyzeSkinPatch treats NaN alpha as transparent', () => {
    assert.throws(() => E.analyzeSkinPatch({ width: 1, height: 1, data: [255, 0, 0, NaN] }), /no opaque pixels/);
  });
  it('analyzeSkinPatch stays finite on non-byte channel values', () => {
    const out = E.analyzeSkinPatch({ width: 1, height: 1, data: [300.7, -5, 1e9, 255] });
    assert.ok(Number.isFinite(out.lab[0]) && Number.isFinite(out.lab[1]) && Number.isFinite(out.lab[2]));
  });
  it('extractPatch rejects non-finite points, bad sizes and short buffers', () => {
    const img = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    assert.throws(() => E.extractPatch(img, NaN, 2, 4), RangeError);
    assert.throws(() => E.extractPatch(img, 2, 2, -5), RangeError);
    assert.throws(() => E.extractPatch(img, 2, 2, 0), RangeError);
    assert.throws(() => E.extractPatch({ width: 4, height: 4, data: new Uint8ClampedArray(8) }, 2, 2, 4), TypeError);
  });
  it('extractPatch works on a plain-array data buffer', () => {
    const img = { width: 2, height: 2, data: [200, 100, 80, 255, 200, 100, 80, 255, 200, 100, 80, 255, 200, 100, 80, 255] };
    const p = E.extractPatch(img, 1, 1, 2);
    assert.equal(p.data[0], 200);
  });
});

describe('Non-finite colour values stop propagating', () => {
  it('labToHex and labToSrgb return bounded output', () => {
    assert.match(E.labToHex(NaN, 0, 0), /^#[0-9a-f]{6}$/);
    assert.match(E.labToHex(Infinity, 0, 0), /^#[0-9a-f]{6}$/);
    E.labToSrgb(NaN, NaN, NaN).forEach((v) => assert.ok(Number.isFinite(v)));
  });
  it('srgbToLab returns finite Lab for non-finite input', () => {
    E.srgbToLab(NaN, Infinity, -Infinity).forEach((v) => assert.ok(Number.isFinite(v)));
  });
});

describe('Classifiers and helpers handle non-finite input honestly', () => {
  it('computeItaAngle returns NaN and classify says Indeterminate', () => {
    assert.ok(Number.isNaN(E.computeItaAngle(NaN, 0)));
    assert.equal(E.classifyItaCategory(NaN).id, 'indeterminate');
  });
  it('classifyUndertone returns null instead of mislabelling', () => {
    assert.equal(E.classifyUndertone(NaN, 10), null);
  });
  it('describeDeltaE calls bad distances not measurable', () => {
    assert.equal(E.describeDeltaE(-1), 'Not measurable');
    assert.equal(E.describeDeltaE(NaN), 'Not measurable');
    assert.equal(E.describeDeltaE(0.5), 'Not noticeable');
  });
  it('lipTargetLab and targetLabForKind require finite triples', () => {
    assert.throws(() => E.lipTargetLab([50]), TypeError);
    assert.throws(() => E.rankShades([NaN, 0, 0], 'lip'), TypeError);
  });
  it('localSkinScores stays finite on junk fields and rejects non-objects', () => {
    const s = E.localSkinScores({ poreDensity: NaN, roughnessIndex: Infinity, shineRatio: NaN, rednessCoverage: undefined });
    Object.keys(s.scores).forEach((k) => assert.ok(Number.isFinite(s.scores[k])));
    assert.throws(() => E.localSkinScores(null), TypeError);
  });
});

describe('Image helpers bound hostile input', () => {
  const img = { width: 2, height: 2, data: new Uint8ClampedArray([200, 100, 80, 255, 200, 100, 80, 255, 200, 100, 80, 255, 200, 100, 80, 255]) };
  it('boxBlur caps a huge radius instead of hanging', () => {
    const out = E.boxBlur(new Float32Array(4), 2, 2, 1e9);
    assert.equal(out.length, 4);
  });
  it('applyFoundation clamps NaN options and ignores a bad meanLab', () => {
    const out = E.applyFoundation(img, [50, 10, 10], { coverage: NaN, glow: NaN, smoothing: NaN, meanLab: [NaN, 0, 0] });
    for (let i = 0; i < out.data.length; i += 1) assert.ok(Number.isFinite(out.data[i]));
  });
  it('applyLipColor passes pixels through when the mask is missing or short', () => {
    const out = E.applyLipColor(img, null, [40, 30, 10]);
    assert.equal(out.data[0], 200);
    const out2 = E.applyLipColor(img, new Float32Array(1), [40, 30, 10]);
    assert.equal(out2.data[4], 200);
  });
  it('applyLipColor and applyFoundation reject bad shadeLab', () => {
    assert.throws(() => E.applyLipColor(img, new Float32Array(4), [NaN]), TypeError);
    assert.throws(() => E.applyFoundation(img, 'x'), TypeError);
  });
  it('buildChromophoreMap requires a full buffer and stays finite on odd values', () => {
    assert.throws(() => E.buildChromophoreMap({ width: 2, height: 2, data: new Uint8ClampedArray(4) }), TypeError);
    const out = E.buildChromophoreMap({ width: 2, height: 2, data: [300, -1, 0.5, 255, 0, 0, 0, 255, 400, 2, 9, 255, 1, 1, 1, 255] });
    for (let i = 0; i < out.data.length; i += 1) assert.ok(Number.isFinite(out.data[i]));
  });
  it('createSkinSpecimen validates dims and lab', () => {
    assert.throws(() => E.createSkinSpecimen({ lab: [NaN, 0, 0] }), TypeError);
    assert.throws(() => E.createSkinSpecimen({ width: 99999 }), TypeError);
    assert.throws(() => E.createSkinSpecimen({ width: 2.5 }), TypeError);
  });
});

describe('Payload builder enforces types and copies caller arrays', () => {
  const url = 'https://cdn.example.org/p.jpg';
  it('rejects a non-string src_file_id and non-string src_file_url', () => {
    assert.throws(() => E.buildYouCamTaskPayload({ src_file_id: 123 }), E.YouCamPayloadError);
    assert.throws(() => E.buildYouCamTaskPayload({ src_file_url: {} }), E.YouCamPayloadError);
  });
  it('trims the source URL before sending', () => {
    const r = E.buildYouCamTaskPayload({ src_file_url: '  ' + url + '  ' });
    assert.equal(r.body.src_file_url, url);
  });
  it('rejects a non-string version and non-object miniserver_args', () => {
    const fx = [E.buildFoundationEffect('#C3987A')];
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_url: url, effects: fx, version: { evil: 1 } }), E.YouCamPayloadError);
    assert.throws(() => E.buildYouCamTaskPayload({ src_file_url: url, miniserver_args: 'x' }), E.YouCamPayloadError);
  });
  it('does not alias the caller effects array', () => {
    const fx = [E.buildFoundationEffect('#C3987A')];
    const r = E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_url: url, effects: fx });
    fx.push(E.buildFoundationEffect('#A37551'));
    assert.equal(r.body.effects.length, 1);
  });
});

describe('Effect validation reports payload errors, not raw TypeErrors', () => {
  it('null palette entries fail with a payload error', () => {
    assert.throws(
      () => E.validateMakeupEffect({ category: 'foundation', palettes: [null] }),
      E.YouCamPayloadError
    );
  });
});

describe('buildYouCamCurl escapes single quotes in the URL', () => {
  it('quote in url cannot break out of the data argument', () => {
    const c = E.buildYouCamCurl({ method: 'POST', url: "https://x.example/a'b", body: { a: 1 } });
    assert.ok(c.indexOf("a'\\''b") !== -1);
  });
});

describe('Response normalizer resists junk shapes', () => {
  it('rejects a top-level array', () => {
    assert.throws(() => E.normalizeYouCamSkinResponse([{ raw_score: 50 }]), TypeError);
  });
  it('skips prototype-ish keys', () => {
    const r = E.normalizeYouCamSkinResponse(JSON.parse('{"__proto__":{"raw_score":50},"hd_pore":{"raw_score":80}}'));
    assert.equal(r.concerns.length, 1);
    assert.equal(r.concerns[0].action, 'hd_pore');
  });
  it('clamps absurd scores and drops non-finite scores', () => {
    const r = E.normalizeYouCamSkinResponse({ results: { output: [{ type: 'hd_pore', raw_score: 1e999, ui_score: 60 }, { type: 'hd_redness', raw_score: -5 }] } });
    const pore = r.concerns.find((c) => c.action === 'hd_pore');
    const red = r.concerns.find((c) => c.action === 'hd_redness');
    assert.equal(pore.rawScore, null);
    assert.equal(pore.score, 60);
    assert.equal(red.score, 0);
  });
  it('caps the concern list', () => {
    const doc = {};
    for (let i = 0; i < 300; i += 1) doc['k' + i] = { raw_score: 50 };
    const r = E.normalizeYouCamSkinResponse(doc);
    assert.equal(r.concerns.length, 200);
    assert.ok(r.warnings.length > 0);
  });
  it('ignores non-finite skin_age', () => {
    const r = E.normalizeYouCamSkinResponse({ skin_age: NaN, all: { score: 70 } });
    assert.equal(r.skinAge, null);
    assert.equal(r.overall, 70);
  });
});

describe('Receipt builder tolerates malformed input', () => {
  it('skips a malformed tone block instead of throwing', () => {
    const r = E.buildRegimenReceipt({ tone: { lab: 'x' }, concerns: [{ score: 40, band: 'Priority', concern: 'pore', label: 'Pores' }] });
    assert.equal(r.steps.length, 1);
  });
  it('works on no input at all', () => {
    assert.ok(E.buildRegimenReceipt(undefined).text.length > 0);
  });
});

describe('App wiring pins', () => {
  it('analyze() wraps the engine calls in try/catch so a transparent patch cannot kill the UI', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const fn = src.slice(src.indexOf('function analyze('));
    assert.match(fn.slice(0, 700), /try \{/);
    assert.match(fn.slice(0, 700), /catch \(err\)/);
  });
  it('the picker is a labelled group, not an application landmark', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    assert.match(html, /id="stage-picker"[^>]*role="group"/);
    assert.doesNotMatch(html, /role="application"/);
  });
});

// ---------- Verify-round regressions (second independent review) ----------

describe('URL guard: rebinding domains and backslash confusion', () => {
  [
    'https://127.0.0.1.nip.io/put',
    'https://169.254.169.254.nip.io/put',
    'https://localtest.me/put',
    'https://x.localtest.me/put',
    'https://a.sslip.io/put',
    'https://1.2.3.4.xip.io/put',
    'https://a.lvh.me/put',
    'https://a.vcap.me/put',
    'https://a.local-ip.co/put',
    'https://example.com\\@169.254.169.254/put',
    'https://example.com\\@127.0.0.1/put',
    'https://cdn.youcam.example\\x.evil.example/put'
  ].forEach((u) => {
    it('rejects ' + u, () => assert.equal(E.isPublicHttpsUrl(u), false));
  });
  it('still accepts a plain public https host', () => {
    assert.equal(E.isPublicHttpsUrl('https://cdn.youcam.example/r.png'), true);
  });
  it('refuses a rebinding upload target end to end', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ data: { files: [{ file_id: 'f1', requests: [{ url: 'https://127.0.0.1.nip.io/put', method: 'PUT', headers: {} }] }] } }) });
    await assert.rejects(client(fetchImpl).uploadFile(FILE), /upload address/);
  });
  it('rejects a rebinding result link', async () => {
    let n = 0;
    const stub = async () => {
      n += 1;
      if (n === 1) return { ok: true, json: async () => ({ data: { task_id: 't1' } }) };
      return { ok: true, json: async () => ({ data: { task_status: 'success', results: { url: 'https://169.254.169.254.nip.io/r.png' } } }) };
    };
    await assert.rejects(client(stub).runMakeupVto({ src_file_url: 'https://cdn.example.org/p.jpg', effects: [E.buildFoundationEffect('#C3987A')] }), /result link/);
  });
});

describe('pollTask bounds attempts even when pollMs is hostile', () => {
  const running = async () => ({ ok: true, json: async () => ({ data: { task_status: 'running' } }) });
  it('NaN pollMs falls back and still terminates', async () => {
    await assert.rejects(client(running, { pollMs: NaN, now: () => 1000 }).pollTask('skin-analysis', 't1'), /did not finish/);
  });
  it('zero and negative pollMs fall back to the default', async () => {
    await assert.rejects(client(running, { pollMs: -5, now: () => 1000 }).pollTask('skin-analysis', 't1'), /did not finish/);
  });
  it('sleep receives the coerced pollMs, never NaN', async () => {
    const sleeps = [];
    const c = client(running, { pollMs: NaN, timeoutMs: 5000, now: Date.now, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } });
    await assert.rejects(c.pollTask('skin-analysis', 't1'), /did not finish/);
    assert.ok(sleeps.every((ms) => ms === 2500));
  });
});

describe('createYouCamClient pins the API key to the YouCam domain', () => {
  it('rejects a foreign baseUrl', () => {
    assert.throws(() => Y.createYouCamClient({ apiKey: KEY, fetchImpl: async () => ({}), baseUrl: 'https://evil.example.com' }), /YouCam API domain/);
    assert.throws(() => Y.createYouCamClient({ apiKey: KEY, fetchImpl: async () => ({}), baseUrl: 'https://makeupar.com.evil.example' }), /YouCam API domain/);
    assert.throws(() => Y.createYouCamClient({ apiKey: KEY, fetchImpl: async () => ({}), baseUrl: 'not a url' }), /YouCam API domain/);
  });
  it('accepts the default and other makeupar.com hosts', () => {
    assert.ok(Y.createYouCamClient({ apiKey: KEY, fetchImpl: async () => ({}) }));
    assert.ok(Y.createYouCamClient({ apiKey: KEY, fetchImpl: async () => ({}), baseUrl: 'https://cdn.makeupar.com' }));
  });
});

describe('buildYouCamCurl keeps the method shell-safe', () => {
  it('strips non-letters from the method', () => {
    const out = E.buildYouCamCurl({ method: "POST' --insecure; #", url: 'https://cdn.example.org/x', body: {} });
    assert.match(out.split('\n')[0], /^curl --request [A-Z]+ \\$/);
    assert.equal(out.split('\n')[0].indexOf("'"), -1);
  });
});

describe('Normalizer output[] entries cannot mint non-string labels', () => {
  it('prototype-named types keep string labels', () => {
    const r = E.normalizeYouCamSkinResponse({ results: { output: [
      { type: 'constructor', raw_score: 50 },
      { type: 'hd___proto__', raw_score: 60 },
      { type: 'hd_pore', raw_score: 70 }
    ] } });
    assert.equal(r.concerns.length, 3);
    r.concerns.forEach((c) => assert.equal(typeof c.label, 'string'));
    assert.equal(r.concerns[0].label, 'constructor');
    assert.equal(r.concerns[2].label, 'Pores');
  });
});

describe('Payloads never alias caller objects', () => {
  it('miniserver_args is deep-copied', () => {
    const args = { strength: 1, nested: { x: 1 } };
    const req = E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_id: 'f1', miniserver_args: args });
    args.strength = 99;
    args.nested.x = 99;
    assert.equal(req.body.miniserver_args.strength, 1);
    assert.equal(req.body.miniserver_args.nested.x, 1);
  });
  it('effects are deep-copied', () => {
    const fx = [E.buildFoundationEffect('#AABBCC')];
    const req = E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_id: 'f1', effects: fx });
    fx[0].palettes[0].color = '#000000';
    assert.equal(req.body.effects[0].palettes[0].color, '#aabbcc');
  });
  it('non-serializable args are rejected, not sent', () => {
    assert.throws(() => E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_id: 'f1', miniserver_args: { x: 1n } }), E.YouCamPayloadError);
  });
});
