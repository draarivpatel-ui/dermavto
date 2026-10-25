'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const E = require('../engine.js');
const Y = require('../youcam-live.js');

const KEY = 'test-key-1234567890';
const BASE = 'https://yce-api-01.makeupar.com';

/** A scripted fetch. Each route handler returns { status, body } or throws. */
function scriptedFetch(routes) {
  const calls = [];
  const queues = {};
  Object.keys(routes).forEach((k) => {
    queues[k] = Array.isArray(routes[k]) ? routes[k].slice() : [routes[k]];
  });
  async function fetchImpl(url, init) {
    const method = (init && init.method) || 'GET';
    const key = method + ' ' + url;
    calls.push({ url: url, method: method, headers: (init && init.headers) || {}, body: init && init.body });
    const queue = queues[key];
    if (!queue || queue.length === 0) throw new Error('unscripted request ' + key);
    const step = queue.length > 1 ? queue.shift() : queue[0];
    if (step instanceof Error) throw step;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body
    };
  }
  return { fetchImpl: fetchImpl, calls: calls };
}

const noSleep = () => Promise.resolve();
const SKIN_PATH = BASE + '/s2s/v2.0/task/skin-analysis';
const VTO_PATH = BASE + '/s2s/v2.0/task/makeup-vto';

function client(fetchImpl, extra) {
  return Y.createYouCamClient(Object.assign({ apiKey: KEY, fetchImpl: fetchImpl, sleep: noSleep }, extra));
}

describe('live client setup', () => {
  it('requires an api key', () => {
    assert.throws(() => Y.createYouCamClient({ apiKey: '', fetchImpl: () => {} }), /API key/);
  });

  it('requires a fetch implementation', () => {
    assert.throws(() => Y.createYouCamClient({ apiKey: KEY, fetchImpl: null }), /network requests/);
  });

  it('spells jpeg the way the published examples do', () => {
    assert.equal(Y.mimeFor({ type: 'image/jpeg' }), 'image/jpg');
    assert.equal(Y.mimeFor({ type: 'image/png' }), 'image/png');
  });
});

describe('live skin analysis', () => {
  const success = {
    status: 200,
    body: {
      status: 200,
      data: {
        task_status: 'success',
        results: { output: [{ type: 'hd_pore', region: 'whole', raw_score: 49.2, ui_score: 67, mask_urls: [] }, { score: 70.5 }] }
      }
    }
  };

  it('posts the task, polls until success and normalises the result', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: { task_id: 'task/1' } } },
      ['GET ' + SKIN_PATH + '/task%2F1']: [{ status: 200, body: { status: 200, data: { task_status: 'running' } } }, success]
    });
    let sleeps = 0;
    const out = await client(s.fetchImpl, { sleep: () => { sleeps += 1; return Promise.resolve(); } }).runSkinAnalysis({
      src_file_url: 'https://example.com/selfie.jpg',
      dst_actions: ['hd_pore']
    });
    assert.equal(sleeps, 1);
    assert.equal(s.calls.length, 3);
    assert.equal(out.result.concerns[0].concern, 'pore');
    assert.equal(out.result.overall, 70.5);
  });

  it('sends the same body the request builder shows', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: { task_id: 't' } } },
      ['GET ' + SKIN_PATH + '/t']: success
    });
    await client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/selfie.jpg', dst_actions: ['hd_pore'] });
    const expected = E.buildYouCamTaskPayload({ src_file_url: 'https://example.com/selfie.jpg', dst_actions: ['hd_pore'] }).body;
    assert.deepEqual(JSON.parse(s.calls[0].body), expected);
  });

  it('sends the bearer key and a json content type on POST, and no body on GET', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: { task_id: 't' } } },
      ['GET ' + SKIN_PATH + '/t']: success
    });
    await client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] });
    assert.equal(s.calls[0].headers.Authorization, 'Bearer ' + KEY);
    assert.equal(s.calls[0].headers['Content-Type'], 'application/json');
    assert.equal(s.calls[1].method, 'GET');
    assert.equal(s.calls[1].body, undefined);
    assert.equal(s.calls[1].headers['Content-Type'], undefined);
  });

  it('turns an unrecognised key into a friendly error with its status', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 401, body: { status: 401, error: "This API key isn't recognized.", error_code: 'InvalidApiKey' } }
    });
    await assert.rejects(
      client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] }),
      (err) => {
        assert.ok(err instanceof Y.YouCamApiError);
        assert.equal(err.status, 401);
        assert.equal(err.code, 'InvalidApiKey');
        assert.match(err.message, /did not recognise this API key/);
        return true;
      }
    );
  });

  it('never puts the key in an error message or a progress line', async () => {
    const seen = [];
    const s = scriptedFetch({ ['POST ' + SKIN_PATH]: new Error('socket closed for ' + KEY) });
    await assert.rejects(
      client(s.fetchImpl, { onProgress: (m) => seen.push(m) }).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] }),
      (err) => {
        assert.ok(!err.message.includes(KEY));
        return true;
      }
    );
    seen.forEach((m) => assert.ok(!m.includes(KEY)));
  });

  it('reports a network failure plainly', async () => {
    const s = scriptedFetch({ ['POST ' + SKIN_PATH]: new TypeError('Failed to fetch') });
    await assert.rejects(
      client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] }),
      /could not be sent/
    );
  });

  it('returns an error task as a normalised result instead of throwing', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: { task_id: 't' } } },
      ['GET ' + SKIN_PATH + '/t']: { status: 200, body: { status: 200, data: { task_status: 'error', error: 'error_no_face' } } }
    });
    const out = await client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] });
    assert.equal(out.result.taskStatus, 'error');
    assert.match(out.result.errorMessage, /No face/);
  });

  it('gives up when the task never finishes', async () => {
    const s = scriptedFetch({
      ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: { task_id: 't' } } },
      ['GET ' + SKIN_PATH + '/t']: { status: 200, body: { status: 200, data: { task_status: 'running' } } }
    });
    let clock = 0;
    await assert.rejects(
      client(s.fetchImpl, { timeoutMs: 10000, pollMs: 4000, now: () => clock, sleep: () => { clock += 4000; return Promise.resolve(); } }).runSkinAnalysis({
        src_file_url: 'https://example.com/a.jpg',
        dst_actions: ['hd_pore']
      }),
      /did not finish in time/
    );
  });

  it('rejects an invalid request before any network call', async () => {
    const s = scriptedFetch({});
    await assert.rejects(client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'http://example.com/a.jpg', dst_actions: ['hd_pore'] }), E.YouCamPayloadError);
    await assert.rejects(client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore', 'wrinkle'] }), /cannot mix/);
    assert.equal(s.calls.length, 0);
  });

  it('fails clearly when no task id comes back', async () => {
    const s = scriptedFetch({ ['POST ' + SKIN_PATH]: { status: 200, body: { status: 200, data: {} } } });
    await assert.rejects(client(s.fetchImpl).runSkinAnalysis({ src_file_url: 'https://example.com/a.jpg', dst_actions: ['hd_pore'] }), /task id/);
  });
});

describe('live makeup try on', () => {
  const effects = E.shadeToYouCamEffects({ foundation: E.SWATCHES[0] });

  it('returns the result url', async () => {
    const s = scriptedFetch({
      ['POST ' + VTO_PATH]: { status: 200, body: { status: 200, data: { task_id: 'v1' } } },
      ['GET ' + VTO_PATH + '/v1']: { status: 200, body: { status: 200, data: { task_status: 'success', results: { url: 'https://cdn.example.com/out.jpg' } } } }
    });
    const out = await client(s.fetchImpl).runMakeupVto({ src_file_url: 'https://example.com/a.jpg', effects: effects });
    assert.equal(out.url, 'https://cdn.example.com/out.jpg');
    assert.equal(JSON.parse(s.calls[0].body).version, '1.0');
  });

  it('throws when the try on task errors or has no link', async () => {
    const errored = scriptedFetch({
      ['POST ' + VTO_PATH]: { status: 200, body: { status: 200, data: { task_id: 'v1' } } },
      ['GET ' + VTO_PATH + '/v1']: { status: 200, body: { status: 200, data: { task_status: 'error', error: 'error_no_face', error_message: 'No face' } } }
    });
    await assert.rejects(client(errored.fetchImpl).runMakeupVto({ src_file_url: 'https://example.com/a.jpg', effects: effects }), /No face/);
    const empty = scriptedFetch({
      ['POST ' + VTO_PATH]: { status: 200, body: { status: 200, data: { task_id: 'v1' } } },
      ['GET ' + VTO_PATH + '/v1']: { status: 200, body: { status: 200, data: { task_status: 'success', results: {} } } }
    });
    await assert.rejects(client(empty.fetchImpl).runMakeupVto({ src_file_url: 'https://example.com/a.jpg', effects: effects }), /without a result link/);
  });
});

describe('live upload', () => {
  const file = { name: 'me.jpg', type: 'image/jpeg', size: 1234 };
  const slot = {
    status: 200,
    body: {
      status: 200,
      data: {
        files: [
          { file_id: 'FILEID', requests: [{ method: 'PUT', url: 'https://upload.example.com/signed', headers: { 'Content-Type': 'image/jpg', 'Content-Length': '1234' } }] }
        ]
      }
    }
  };

  it('asks for a slot, uploads the bytes and returns the file id', async () => {
    const s = scriptedFetch({
      ['POST ' + BASE + '/s2s/v2.0/file']: slot,
      'PUT https://upload.example.com/signed': { status: 200, body: null }
    });
    const id = await client(s.fetchImpl).uploadFile(file);
    assert.equal(id, 'FILEID');
    assert.deepEqual(JSON.parse(s.calls[0].body), { files: [{ content_type: 'image/jpg', file_name: 'me.jpg', file_size: 1234 }] });
    assert.equal(s.calls[1].body, file);
    assert.equal(s.calls[1].headers['Content-Type'], 'image/jpg');
    assert.equal(s.calls[1].headers['Content-Length'], undefined);
    assert.equal(s.calls[1].headers.Authorization, undefined);
  });

  it('fails when the signed upload is rejected or blocked', async () => {
    const rejected = scriptedFetch({ ['POST ' + BASE + '/s2s/v2.0/file']: slot, 'PUT https://upload.example.com/signed': { status: 403, body: null } });
    await assert.rejects(client(rejected.fetchImpl).uploadFile(file), /rejected with status 403/);
    const blocked = scriptedFetch({ ['POST ' + BASE + '/s2s/v2.0/file']: slot, 'PUT https://upload.example.com/signed': new TypeError('blocked') });
    await assert.rejects(client(blocked.fetchImpl).uploadFile(file), /blocked or failed/);
  });

  it('fails when no upload slot comes back', async () => {
    const s = scriptedFetch({ ['POST ' + BASE + '/s2s/v2.0/file']: { status: 200, body: { status: 200, data: { files: [] } } } });
    await assert.rejects(client(s.fetchImpl).uploadFile(file), /upload slot/);
  });
});
