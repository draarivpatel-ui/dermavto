'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const E = require('../engine.js');

const URL_SRC = 'https://example.com/selfie.jpg';

function throwsCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof E.YouCamPayloadError, 'expected YouCamPayloadError, got ' + err);
    assert.equal(err.code, code);
    return true;
  });
}

describe('YouCam skin analysis payload', () => {
  it('targets the live v2.0 path on the makeupar host', () => {
    const req = E.buildYouCamTaskPayload({ task: 'skin-analysis', src_file_url: URL_SRC });
    assert.equal(req.method, 'POST');
    assert.equal(req.url, 'https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis');
  });

  it('defaults to the eight HD actions and json format', () => {
    const req = E.buildYouCamTaskPayload({ src_file_url: URL_SRC });
    assert.deepEqual(req.body.dst_actions, [
      'hd_wrinkle', 'hd_pore', 'hd_texture', 'hd_acne', 'hd_oiliness', 'hd_radiance', 'hd_moisture', 'hd_redness'
    ]);
    assert.equal(req.body.format, 'json');
    assert.equal(req.body.src_file_url, URL_SRC);
  });

  it('accepts src_file_id in place of a url', () => {
    const req = E.buildYouCamTaskPayload({ src_file_id: 'abc123', dst_actions: ['hd_pore'] });
    assert.equal(req.body.src_file_id, 'abc123');
    assert.equal(req.body.src_file_url, undefined);
  });

  it('requires exactly one source', () => {
    throwsCode(() => E.buildYouCamTaskPayload({ dst_actions: ['hd_pore'] }), 'invalid_source');
    throwsCode(
      () => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, src_file_id: 'x', dst_actions: ['hd_pore'] }),
      'invalid_source'
    );
  });

  it('rejects http, localhost and private network urls', () => {
    ['http://example.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://10.0.0.4/a.jpg',
      'https://192.168.1.9/a.jpg', 'https://172.20.1.1/a.jpg', 'data:image/png;base64,AAAA', 'not a url'].forEach((u) => {
      throwsCode(() => E.buildYouCamTaskPayload({ src_file_url: u }), 'invalid_source');
    });
  });

  it('accepts a normal public https url', () => {
    assert.equal(E.isPublicHttpsUrl('https://cdn.example.org/a/b.png?x=1'), true);
    assert.equal(E.isPublicHttpsUrl('https://172.15.0.1/a.png'), true);
  });

  it('rejects unknown actions with the vendor wording', () => {
    assert.throws(
      () => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, dst_actions: ['abc123'] }),
      /Not available dst_action abc123/
    );
  });

  it('rejects mixing HD and SD actions', () => {
    assert.throws(
      () => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, dst_actions: ['hd_pore', 'wrinkle'] }),
      /cannot mix HD and SD dst_actions/
    );
  });

  it('accepts an all-SD list', () => {
    const req = E.buildYouCamTaskPayload({ src_file_url: URL_SRC, dst_actions: ['wrinkle', 'pore', 'dark_circle_v2'] });
    assert.equal(E.classifyDstActions(req.body.dst_actions), 'sd');
  });

  it('rejects duplicates and empty lists', () => {
    throwsCode(() => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, dst_actions: ['hd_pore', 'hd_pore'] }), 'invalid_actions');
    throwsCode(() => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, dst_actions: [] }), 'invalid_actions');
  });

  it('rejects a bad format and a bad task name', () => {
    throwsCode(() => E.buildYouCamTaskPayload({ src_file_url: URL_SRC, format: 'xml' }), 'invalid_format');
    throwsCode(() => E.buildYouCamTaskPayload({ task: 'enhance', src_file_url: URL_SRC }), 'invalid_task');
  });

  it('lists 16 HD and 16 SD actions with no overlap', () => {
    assert.equal(E.HD_ACTIONS.length, 16);
    assert.equal(E.SD_ACTIONS.length, 16);
    assert.equal(new Set(E.HD_ACTIONS.concat(E.SD_ACTIONS)).size, 32);
  });

  it('keeps the Authorization header a placeholder', () => {
    const req = E.buildYouCamTaskPayload({ src_file_url: URL_SRC });
    assert.equal(req.headers.Authorization, 'Bearer YOUR_API_KEY');
    assert.equal(req.headers['Content-Type'], 'application/json');
  });

  it('passes miniserver_args through untouched', () => {
    const args = { enable_mask_overlay: true };
    const req = E.buildYouCamTaskPayload({ src_file_url: URL_SRC, miniserver_args: args });
    assert.deepEqual(req.body.miniserver_args, args);
  });
});

describe('YouCam makeup try on payload', () => {
  it('builds a foundation effect with all four required palette keys', () => {
    const fx = E.buildFoundationEffect('#EAC595', { coverageIntensity: 55 });
    assert.equal(fx.category, 'foundation');
    assert.deepEqual(Object.keys(fx.palettes[0]).sort(), ['color', 'colorIntensity', 'coverageIntensity', 'glowIntensity']);
    assert.equal(fx.palettes[0].color, '#eac595');
    assert.equal(fx.palettes[0].coverageIntensity, 55);
  });

  it('builds a concealer effect with the under eye and coverage keys', () => {
    const fx = E.buildConcealerEffect('#E6C7A8');
    assert.deepEqual(Object.keys(fx.palettes[0]).sort(), ['color', 'colorIntensity', 'colorUnderEyeIntensity', 'coverageLevel']);
  });

  it('builds a lip effect with shape, style, morphology and palette keys', () => {
    const fx = E.buildLipColorEffect('#c2185b', { texture: 'matte' });
    assert.equal(fx.category, 'lip_color');
    assert.equal(fx.shape.name, 'original');
    assert.equal(fx.style.type, 'full');
    assert.equal(fx.palettes[0].texture, 'matte');
    assert.equal(fx.palettes[0].gloss, undefined);
  });

  it('adds gloss and transparency for glossy finishes', () => {
    const fx = E.buildLipColorEffect('#c2185b', { texture: 'gloss' });
    assert.equal(fx.palettes[0].gloss, 50);
    assert.equal(fx.palettes[0].transparencyIntensity, 30);
  });

  it('wraps effects with version 1.0 for the makeup-vto endpoint', () => {
    const effects = E.shadeToYouCamEffects({
      foundation: E.SWATCHES[0],
      concealer: E.swatchesByKind('concealer')[0],
      lip: E.swatchesByKind('lip')[0]
    });
    const req = E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_url: URL_SRC, effects: effects });
    assert.equal(req.url, 'https://yce-api-01.makeupar.com/s2s/v2.0/task/makeup-vto');
    assert.equal(req.body.version, '1.0');
    assert.deepEqual(req.body.effects.map((e) => e.category), ['foundation', 'concealer', 'lip_color']);
  });

  it('keeps every intensity an integer from 0 to 100', () => {
    const effects = E.shadeToYouCamEffects({
      foundation: E.SWATCHES[0],
      concealer: E.swatchesByKind('concealer')[0],
      lip: E.swatchesByKind('lip')[0],
      lipOptions: { texture: 'gloss', colorIntensity: 85 }
    });
    effects.forEach((fx) => {
      fx.palettes.forEach((p) => {
        Object.keys(p).forEach((k) => {
          if (typeof p[k] === 'number') assert.ok(Number.isInteger(p[k]) && p[k] >= 0 && p[k] <= 100, k);
        });
      });
    });
  });

  it('requires effects for the makeup task', () => {
    throwsCode(() => E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_url: URL_SRC }), 'invalid_effect');
    throwsCode(() => E.buildYouCamTaskPayload({ task: 'makeup-vto', src_file_url: URL_SRC, effects: [] }), 'invalid_effect');
  });

  it('rejects out of range, fractional and missing intensities', () => {
    throwsCode(() => E.buildFoundationEffect('#aabbcc', { glowIntensity: 101 }), 'invalid_intensity');
    throwsCode(() => E.buildFoundationEffect('#aabbcc', { coverageIntensity: 10.5 }), 'invalid_intensity');
    throwsCode(
      () => E.validateMakeupEffect({ category: 'foundation', palettes: [{ color: '#aabbcc', colorIntensity: 50 }] }),
      'invalid_intensity'
    );
  });

  it('checks lip morphology intensities', () => {
    const base = E.buildLipColorEffect('#aabbcc');
    throwsCode(() => E.validateMakeupEffect(Object.assign({}, base, { morphology: { fullness: 150 } })), 'invalid_intensity');
    throwsCode(() => E.validateMakeupEffect(Object.assign({}, base, { morphology: { wrinkless: -1 } })), 'invalid_intensity');
    assert.equal(E.validateMakeupEffect(Object.assign({}, base, { morphology: { fullness: 20, wrinkless: 10 } })), true);
    assert.equal(E.validateMakeupEffect(Object.assign({}, base, { morphology: undefined })), true);
  });

  it('rejects bad colours, textures, styles and categories', () => {
    throwsCode(() => E.buildFoundationEffect('red'), 'invalid_color');
    throwsCode(() => E.buildLipColorEffect('#aabbcc', { texture: 'velvet' }), 'invalid_texture');
    throwsCode(() => E.buildLipColorEffect('#aabbcc', { style: 'stripe' }), 'invalid_effect');
    throwsCode(() => E.validateMakeupEffect({ category: 'blush', palettes: [{ color: '#aabbcc', colorIntensity: 5 }] }), 'unsupported_category');
    throwsCode(() => E.validateMakeupEffect({ category: 'foundation', palettes: [] }), 'invalid_effect');
  });
});

describe('curl output', () => {
  it('includes the url, a placeholder key and the body', () => {
    const req = E.buildYouCamTaskPayload({ src_file_url: URL_SRC });
    const curl = E.buildYouCamCurl(req);
    assert.match(curl, /^curl --request POST/);
    assert.ok(curl.includes(req.url));
    assert.ok(curl.includes('Bearer YOUR_API_KEY'));
    assert.ok(curl.includes('"dst_actions"'));
  });

  it('escapes single quotes in the body for the shell', () => {
    const curl = E.buildYouCamCurl({ method: 'POST', url: 'https://x.test/a', body: { note: "it's" } });
    assert.ok(curl.includes("it'\\''s"));
  });
});

describe('YouCam response normalizer', () => {
  const jsonFormat = {
    status: 200,
    data: {
      task_status: 'success',
      results: {
        output: [
          { type: 'hd_texture', region: 'whole', raw_score: 66.39, ui_score: 75, mask_urls: ['https://x/a.png'] },
          { type: 'hd_pore', region: 'nose', raw_score: 29.14, ui_score: 58, mask_urls: [] },
          { type: 'hd_redness', raw_score: 72.01, ui_score: 77 },
          { score: 75.76 }
        ]
      }
    }
  };

  it('reads the format=json response', () => {
    const r = E.normalizeYouCamSkinResponse(jsonFormat);
    assert.equal(r.taskStatus, 'success');
    assert.equal(r.concerns.length, 3);
    assert.equal(r.overall, 75.76);
    assert.equal(r.concerns[0].concern, 'texture');
    assert.equal(r.concerns[0].maskCount, 1);
    assert.equal(r.concerns[1].region, 'nose');
    assert.equal(r.concerns[2].region, 'whole');
  });

  it('prefers raw_score over ui_score', () => {
    const c = E.normalizeYouCamSkinResponse(jsonFormat).concerns[0];
    assert.equal(c.score, 66.39);
    assert.equal(c.rawScore, 66.39);
    assert.equal(c.uiScore, 75);
  });

  it('falls back to ui_score when raw_score is missing', () => {
    const r = E.normalizeYouCamSkinResponse({ data: { task_status: 'success', results: { output: [{ type: 'pore', ui_score: 84 }] } } });
    assert.equal(r.concerns[0].score, 84);
    assert.equal(r.concerns[0].rawScore, null);
    assert.equal(r.concerns[0].hd, false);
  });

  const scoreInfo = {
    hd_redness: { raw_score: 72.01, ui_score: 77, output_mask_name: 'hd_redness_output.png' },
    hd_texture: { whole: { raw_score: 66.39, ui_score: 75, output_mask_name: 'hd_texture_output.png' } },
    hd_pore: {
      forehead: { raw_score: 79.6, ui_score: 80 },
      nose: { raw_score: 29.1, ui_score: 58 },
      whole: { raw_score: 49.2, ui_score: 67 }
    },
    all: { score: 75.7575 },
    skin_age: 37
  };

  it('reads a score_info.json with flat and nested regions', () => {
    const r = E.normalizeYouCamSkinResponse(JSON.stringify(scoreInfo));
    assert.equal(r.concerns.length, 5);
    assert.equal(r.overall, 75.7575);
    assert.equal(r.skinAge, 37);
    assert.deepEqual(r.concerns.filter((c) => c.concern === 'pore').map((c) => c.region), ['forehead', 'nose', 'whole']);
  });

  it('reads score_info.json wrapped in a data.results envelope', () => {
    const r = E.normalizeYouCamSkinResponse({ data: { task_status: 'success', results: scoreInfo } });
    assert.equal(r.concerns.length, 5);
  });

  it('bands scores at 75 and 55', () => {
    const r = E.normalizeYouCamSkinResponse({
      hd_a: { raw_score: 75, ui_score: 80 },
      hd_b: { raw_score: 74.9, ui_score: 80 },
      hd_c: { raw_score: 55, ui_score: 80 },
      hd_d: { raw_score: 54.9, ui_score: 80 }
    });
    assert.deepEqual(r.concerns.map((c) => c.band), ['Maintain', 'Watch', 'Watch', 'Priority']);
  });

  it('reports a running task without concerns', () => {
    const r = E.normalizeYouCamSkinResponse({ status: 200, data: { task_status: 'running' } });
    assert.equal(r.taskStatus, 'running');
    assert.equal(r.concerns.length, 0);
  });

  it('maps an error task to friendly wording', () => {
    const r = E.normalizeYouCamSkinResponse({ status: 200, data: { task_status: 'error', error: 'error_no_face' } });
    assert.equal(r.taskStatus, 'error');
    assert.match(r.errorMessage, /No face/);
  });

  it('warns when nothing scoreable is present and throws on bad input', () => {
    assert.equal(E.normalizeYouCamSkinResponse({ data: { task_status: 'success', results: { output: [] } } }).warnings.length, 1);
    assert.throws(() => E.normalizeYouCamSkinResponse('{nope'), SyntaxError);
    assert.throws(() => E.normalizeYouCamSkinResponse(null), TypeError);
  });

  it('ignores typed entries with no scores but keeps an overall score they carry', () => {
    const r = E.normalizeYouCamSkinResponse({
      data: { task_status: 'success', skin_age: 41, results: { output: [{ type: 'all', score: 66 }, { type: 'hd_pore' }, null, { type: 7 }, { type: 'hd_acne', raw_score: 50 }] } }
    });
    assert.equal(r.overall, 66);
    assert.equal(r.skinAge, 41);
    assert.deepEqual(r.concerns.map((c) => c.concern), ['acne']);
    assert.equal(r.concerns[0].uiScore, null);
  });

  it('skips non score regions and non numeric skin_age in a score_info.json', () => {
    const r = E.normalizeYouCamSkinResponse({
      skin_age: 'unknown',
      hd_pore: { whole: { raw_score: 50 }, extra: { mask: 1 }, bad: null },
      note: 'text',
      all: { score: 'n/a' }
    });
    assert.equal(r.skinAge, null);
    assert.equal(r.overall, null);
    assert.equal(r.concerns.length, 1);
    assert.equal(r.concerns[0].region, 'whole');
  });

  it('labels concerns readably', () => {
    const r = E.normalizeYouCamSkinResponse({ hd_acne: { whole: { raw_score: 59.9, ui_score: 76 } }, dark_circle_v2: { raw_score: 80, ui_score: 76 } });
    assert.deepEqual(r.concerns.map((c) => c.label), ['Blemishes', 'Dark circles']);
  });
});

describe('Routine and shade receipt', () => {
  const concerns = E.normalizeYouCamSkinResponse({
    hd_moisture: { raw_score: 48.7, ui_score: 70 },
    hd_oiliness: { raw_score: 60.7, ui_score: 72 },
    hd_redness: { raw_score: 82, ui_score: 80 }
  }).concerns;
  const tone = { lab: [66, 10, 23], ita: 34.8, category: { name: 'Intermediate' }, undertone: 'Warm' };
  const ranking = { foundation: E.rankShades(tone.lab, 'foundation').slice(0, 1) };

  it('orders routine steps from lowest score and skips Maintain concerns', () => {
    const r = E.buildRegimenReceipt({ concerns: concerns, ranking: ranking, tone: tone, source: 'youcam' });
    assert.deepEqual(r.steps.map((s) => s.concern), ['moisture', 'oiliness']);
  });

  it('names the shade and the source', () => {
    const r = E.buildRegimenReceipt({ concerns: concerns, ranking: ranking, tone: tone, source: 'youcam' });
    assert.match(r.text, /YouCam scores/);
    assert.match(r.text, /Foundation, /);
    assert.match(r.text, /undertone Warm \(heuristic\)/);
  });

  it('always ends with the cosmetic only disclaimer', () => {
    const r = E.buildRegimenReceipt({ concerns: concerns, ranking: ranking, tone: tone, source: 'local' });
    assert.equal(r.lines[r.lines.length - 1], E.DISCLAIMER);
    assert.match(E.DISCLAIMER, /Cosmetic and educational only/);
  });

  it('says so when every concern is in the Maintain band', () => {
    const r = E.buildRegimenReceipt({ concerns: [{ concern: 'pore', label: 'Pores', score: 90, band: 'Maintain' }], ranking: {}, source: 'local' });
    assert.equal(r.steps.length, 0);
    assert.match(r.text, /Maintain band/);
  });

  it('sends blemish concerns to a dermatologist', () => {
    const r = E.buildRegimenReceipt({ concerns: [{ concern: 'acne', label: 'Blemishes', score: 40, band: 'Priority' }], ranking: {}, source: 'local' });
    assert.match(r.text, /dermatologist/);
  });
});

describe('Text hygiene of engine output', () => {
  it('has no em dash, en dash or emoji in any generated receipt or message', () => {
    const r = E.buildRegimenReceipt({
      concerns: E.normalizeYouCamSkinResponse({ hd_acne: { whole: { raw_score: 40, ui_score: 60 } } }).concerns,
      ranking: { foundation: E.rankShades([66, 10, 23], 'foundation').slice(0, 1) },
      tone: { lab: [66, 10, 23], ita: 34.8, category: { name: 'Intermediate' }, undertone: 'Warm' },
      source: 'youcam'
    });
    const dash = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');
    const pictographs = new RegExp('[' + String.fromCharCode(0x2600) + '-' + String.fromCharCode(0x27bf) + ']');
    assert.doesNotMatch(r.text, dash);
    assert.doesNotMatch(r.text, pictographs);
  });
});
