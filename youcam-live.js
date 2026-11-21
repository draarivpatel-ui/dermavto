/*
 * DermaVTO live YouCam client
 * The only file in this project that talks to the network. It runs a task
 * only when a person presses Run with their own API key. The key is held in
 * memory for the length of one client object and is never stored or logged.
 *
 * Flow per the published API (checked 2026-10-25)
 *   1. optional  POST /s2s/v2.0/file, then PUT the bytes to the signed URL
 *   2. POST /s2s/v2.0/task/<skin-analysis | makeup-vto>  returns data.task_id
 *   3. GET  /s2s/v2.0/task/<name>/<task_id>  until task_status is success or error
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.DermaYouCam = factory(root.DermaVTO);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  class YouCamApiError extends Error {
    constructor(message, details) {
      super(message);
      this.name = 'YouCamApiError';
      this.status = (details && details.status) || 0;
      this.code = (details && details.code) || '';
    }
  }

  const FRIENDLY = Object.freeze({
    InvalidApiKey: 'YouCam did not recognise this API key.',
    TooManyRequests: 'YouCam says there have been too many requests. Wait a moment and try again.',
    InvalidParameters: 'YouCam rejected a request parameter.'
  });

  function mimeFor(file) {
    // The published examples spell the JPEG type image/jpg.
    return file.type === 'image/jpeg' ? 'image/jpg' : file.type;
  }

  function createYouCamClient(options) {
    const o = Object.assign(
      {
        apiKey: '',
        baseUrl: E.YOUCAM.baseUrl,
        fetchImpl: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
        sleep: function (ms) {
          return new Promise(function (resolve) {
            setTimeout(resolve, ms);
          });
        },
        pollMs: 2500,
        timeoutMs: 180000,
        now: function () {
          return Date.now();
        },
        onProgress: function () {}
      },
      options
    );
    if (!o.apiKey || typeof o.apiKey !== 'string') throw new YouCamApiError('Enter your YouCam API key first.');
    if (!o.fetchImpl) throw new YouCamApiError('This browser cannot make network requests.');

    async function call(method, path, body) {
      const headers = { Authorization: 'Bearer ' + o.apiKey };
      const init = { method: method, headers: headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      let res;
      try {
        res = await o.fetchImpl(o.baseUrl + path, init);
      } catch (err) {
        throw new YouCamApiError('The request to YouCam could not be sent. Check the connection and try again.');
      }
      let json = null;
      try {
        json = await res.json();
      } catch (err) {
        json = null;
      }
      if (!res.ok || (json && typeof json.status === 'number' && json.status >= 400)) {
        const code = (json && (json.error_code || json.error)) || '';
        const status = (json && json.status) || res.status;
        throw new YouCamApiError(FRIENDLY[code] || (json && json.error) || 'YouCam returned status ' + status + '.', { status: status, code: code });
      }
      return json;
    }

    /* Only the headers a signed storage PUT legitimately needs; credentials are never forwarded. */
    const SAFE_UPLOAD_HEADER = /^(content-type|x-amz-|x-goog-|x-ms-)/i;

    /** Upload a File through the File API and return its file_id. */
    async function uploadFile(file) {
      if (!file || typeof file.type !== 'string' || typeof file.size !== 'number' || typeof file.name !== 'string') {
        throw new YouCamApiError('Choose an image file first.');
      }
      o.onProgress('Asking YouCam for an upload slot.');
      const meta = await call('POST', '/s2s/v2.0/file', {
        files: [{ content_type: mimeFor(file), file_name: file.name, file_size: file.size }]
      });
      const slot = meta && meta.data && meta.data.files && meta.data.files[0];
      const target = slot && slot.requests && slot.requests[0];
      if (!slot || !slot.file_id || !target || !target.url) throw new YouCamApiError('YouCam did not return an upload slot.');
      // The photo bytes go wherever this URL points, so it must be a real public https host.
      if (!E.isPublicHttpsUrl(target.url)) throw new YouCamApiError('YouCam returned an upload address this client refuses to use.');
      const headers = {};
      Object.keys(target.headers || {}).forEach(function (k) {
        if (SAFE_UPLOAD_HEADER.test(k)) headers[k] = target.headers[k];
      });
      const method = String(target.method || 'PUT').toUpperCase();
      if (method !== 'PUT' && method !== 'POST') throw new YouCamApiError('YouCam returned an upload method this client refuses to use.');
      o.onProgress('Uploading the photo to YouCam.');
      let res;
      try {
        res = await o.fetchImpl(target.url, { method: method, headers: headers, body: file });
      } catch (err) {
        throw new YouCamApiError('The photo upload was blocked or failed before it finished.');
      }
      if (!res.ok) throw new YouCamApiError('The photo upload was rejected with status ' + res.status + '.', { status: res.status });
      return slot.file_id;
    }

    async function pollTask(name, taskId) {
      const started = o.now();
      const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 180000;
      const maxAttempts = Math.max(5, Math.ceil(timeoutMs / Math.max(o.pollMs, 1)) + 2);
      for (let attempt = 1;; attempt += 1) {
        const json = await call('GET', '/s2s/v2.0/task/' + name + '/' + encodeURIComponent(taskId));
        const status = json && json.data && json.data.task_status;
        if (status === 'success' || status === 'error') return json;
        const elapsed = o.now() - started;
        if (!Number.isFinite(elapsed) || elapsed > timeoutMs || attempt >= maxAttempts) {
          throw new YouCamApiError('The task did not finish in time. Try again later.');
        }
        o.onProgress('The task is running.');
        await o.sleep(o.pollMs);
      }
    }

    async function runTask(name, body) {
      o.onProgress('Starting the ' + name + ' task.');
      const created = await call('POST', '/s2s/v2.0/task/' + name, body);
      const taskId = created && created.data && created.data.task_id;
      if (!taskId) throw new YouCamApiError('YouCam did not return a task id.');
      return pollTask(name, taskId);
    }

    /** options: src_file_url or src_file_id, dst_actions. Returns { raw, result }. */
    async function runSkinAnalysis(options) {
      const request = E.buildYouCamTaskPayload(Object.assign({ task: 'skin-analysis' }, options));
      const raw = await runTask('skin-analysis', request.body);
      return { raw: raw, result: E.normalizeYouCamSkinResponse(raw) };
    }

    /** options: src_file_url or src_file_id, effects. Returns { raw, url }. */
    async function runMakeupVto(options) {
      const request = E.buildYouCamTaskPayload(Object.assign({ task: 'makeup-vto' }, options));
      const raw = await runTask('makeup-vto', request.body);
      if (raw.data.task_status === 'error') {
        throw new YouCamApiError(raw.data.error_message || 'The try on task reported an error.', { code: raw.data.error || '' });
      }
      const url = raw.data.results && raw.data.results.url;
      if (!url) throw new YouCamApiError('The try on task finished without a result link.');
      if (typeof url !== 'string' || !E.isPublicHttpsUrl(url)) {
        throw new YouCamApiError('YouCam returned a result link this client refuses to use.');
      }
      return { raw: raw, url: url };
    }

    return { uploadFile: uploadFile, runSkinAnalysis: runSkinAnalysis, runMakeupVto: runMakeupVto, pollTask: pollTask };
  }

  return { createYouCamClient: createYouCamClient, YouCamApiError: YouCamApiError, mimeFor: mimeFor };
});
