/*
 * DermaVTO app
 * Wires the page to the engine. This file makes no network calls itself. A
 * chosen photo is read with the browser file API and drawn to a canvas. The
 * only code that can reach the network is youcam-live.js, and only after a
 * person presses Run live.
 */
(function () {
  'use strict';

  const E = window.DermaVTO;
  const R = window.DermaRender;
  const Y = window.DermaYouCam;
  const F = window.DermaFairness;

  const W = 640;
  const H = 800;
  const PATCH = 64;
  const SPECIMEN_SAMPLE = { x: Math.round(W * 0.64), y: Math.round(H * 0.52) };
  const PHOTO_SAMPLE = { x: Math.round(W * 0.5), y: Math.round(H * 0.45) };

  const DOCS_SAMPLE = {
    hd_redness: { raw_score: 72.011962890625, ui_score: 77, output_mask_name: 'hd_redness_output.png' },
    hd_oiliness: { raw_score: 60.74365234375, ui_score: 72, output_mask_name: 'hd_oiliness_output.png' },
    hd_age_spot: { raw_score: 83.23274230957031, ui_score: 77, output_mask_name: 'hd_age_spot_output.png' },
    hd_radiance: { raw_score: 76.57244205474854, ui_score: 79, output_mask_name: 'hd_radiance_output.png' },
    hd_moisture: { raw_score: 48.694559931755066, ui_score: 70, output_mask_name: 'hd_moisture_output.png' },
    hd_texture: { whole: { raw_score: 66.3921568627451, ui_score: 75, output_mask_name: 'hd_texture_output.png' } },
    hd_acne: { whole: { raw_score: 59.92677688598633, ui_score: 76, output_mask_name: 'hd_acne_output.png' } },
    hd_pore: {
      forehead: { raw_score: 79.59770965576172, ui_score: 80, output_mask_name: 'hd_pore_output_forehead.png' },
      nose: { raw_score: 29.139814376831055, ui_score: 58, output_mask_name: 'hd_pore_output_nose.png' },
      cheek: { raw_score: 44.11081314086914, ui_score: 65, output_mask_name: 'hd_pore_output_cheek.png' },
      whole: { raw_score: 49.23978805541992, ui_score: 67, output_mask_name: 'hd_pore_output_all.png' }
    },
    hd_wrinkle: {
      forehead: { raw_score: 55.96956729888916, ui_score: 67, output_mask_name: 'hd_wrinkle_output_forehead.png' },
      whole: { raw_score: 49.64699745178223, ui_score: 65, output_mask_name: 'hd_wrinkle_output_all.png' }
    },
    all: { score: 75.75757575757575 },
    skin_age: 37
  };

  const SD_FOR = {
    hd_wrinkle: 'wrinkle', hd_pore: 'pore', hd_texture: 'texture', hd_acne: 'acne', hd_oiliness: 'oiliness',
    hd_radiance: 'radiance', hd_moisture: 'moisture', hd_redness: 'redness'
  };

  const KIND_NOTES = {
    foundation: 'Foundation is compared with the sample colour directly.',
    concealer: 'Concealer is compared with the sample after a small lift of L* by ' + E.CONCEALER_LIGHTNESS_OFFSET + '. That offset is a styling heuristic.',
    lip: 'Lip shades are compared with a target that is darker and redder than the sample. The target is a styling heuristic, not a measurement.'
  };

  function $(id) {
    return document.getElementById(id);
  }

  const els = {
    stage: $('stage'),
    frame: $('stage-frame'),
    raw: $('canvas-raw'),
    result: $('canvas-result'),
    split: $('split'),
    ring: $('stage-ring'),
    picker: $('stage-picker'),
    tagRight: $('tag-right'),
    caption: $('stage-caption'),
    status: $('status'),
    hexInput: $('hex-input'),
    hexApply: $('hex-apply'),
    photoInput: $('photo-input'),
    sampleToggle: $('sample-toggle'),
    coverage: $('coverage'),
    coverageOut: $('coverage-out'),
    glow: $('glow'),
    glowOut: $('glow-out'),
    lipFinish: $('lip-finish'),
    lipIntensity: $('lip-intensity'),
    lipIntensityOut: $('lip-intensity-out'),
    arcHost: $('arc-host'),
    compassHost: $('compass-host'),
    metrics: $('metrics'),
    ranking: $('ranking'),
    kindNote: $('kind-note'),
    ycSrcType: $('yc-src-type'),
    ycUploadField: $('yc-upload-field'),
    ycUpload: $('yc-upload'),
    ycSrcField: $('yc-src-field'),
    ycKey: $('yc-key'),
    ycConsent: $('yc-consent'),
    ycRun: $('yc-run'),
    ycLiveStatus: $('yc-live-status'),
    ycLiveResult: $('yc-live-result'),
    ycSrc: $('yc-src'),
    ycActions: $('yc-actions'),
    ycSkinOptions: $('yc-skin-options'),
    ycError: $('yc-error'),
    ycEndpoint: $('yc-endpoint'),
    ycJson: $('yc-json'),
    ycCopyJson: $('yc-copy-json'),
    ycCopyCurl: $('yc-copy-curl'),
    ycCopyNote: $('yc-copy-note'),
    ycResponse: $('yc-response'),
    ycRead: $('yc-read'),
    ycSample: $('yc-sample'),
    ycReadError: $('yc-read-error'),
    ycTable: $('yc-table-host'),
    receiptText: $('receipt-text'),
    receiptSource: $('receipt-source'),
    receiptCopy: $('receipt-copy'),
    receiptNote: $('receipt-note'),
    abcdeScore: $('abcde-score'),
    abcdeBand: $('abcde-band'),
    abcdeNote: $('abcde-note'),
    fairThreshold: $('fair-threshold'),
    fairThresholdOut: $('fair-threshold-out'),
    fairChartHost: $('fair-chart-host'),
    fairTableHost: $('fair-table-host'),
    fairNote: $('fair-note'),
    pqScale: $('pq-scale'),
    pqRun: $('pq-run'),
    pqList: $('pq-list'),
    pqVerdict: $('pq-verdict'),
    prepUrgency: $('prep-urgency'),
    prepNote: $('prep-note'),
    prepList: $('prep-list'),
    exCopyJson: $('ex-copy-json'),
    exCopyCsv: $('ex-copy-csv'),
    exCopyMd: $('ex-copy-md'),
    exDownload: $('ex-download'),
    exChecksum: $('ex-checksum'),
    exCopyNote: $('ex-copy-note'),
    dermBookmark: $('derm-bookmark'),
    exVerify: $('ex-verify'),
    exVerifyRun: $('ex-verify-run'),
    exVerifyStatus: $('ex-verify-status'),
    selftestRun: $('selftest-run'),
    selftestList: $('selftest-list'),
    labStatus: $('lab-status')
  };

  const state = {
    sourceKind: 'preset',
    presetId: 'p3',
    image: null,
    lipMask: null,
    solidMask: null,
    sample: { x: SPECIMEN_SAMPLE.x, y: SPECIMEN_SAMPLE.y },
    analysis: null,
    ranking: { foundation: [], concealer: [], lip: [] },
    selected: {},
    kind: 'foundation',
    mode: 'tryon',
    sampling: false,
    yc: { json: '', curl: '', concerns: null, overall: null, skinAge: null },
    abcdeGrades: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    abcdeResult: null,
    threshold: 65,
    scaleConfirmed: false,
    cohort: null,
    audit: null,
    quality: null,
    exportBundle: null,
    queued: false
  };

  function radioValue(name, fallback) {
    const list = document.querySelectorAll('input[name="' + name + '"]');
    for (let i = 0; i < list.length; i += 1) {
      if (list[i].checked) return list[i].value;
    }
    return fallback;
  }

  function say(text) {
    els.status.textContent = text;
  }

  /* ------------------------------------------------------------ */
  /* Sources                                                       */
  /* ------------------------------------------------------------ */

  function useSpecimen(lab, caption) {
    const specimen = E.createSkinSpecimen({ width: W, height: H, lab: lab, shine: 0.5, erythema: 0.55, pigment: 0.3, pores: 0.6 });
    state.image = { width: W, height: H, data: specimen.data };
    state.lipMask = specimen.lipMask;
    if (!state.solidMask) state.solidMask = new Float32Array(W * H).fill(1);
    state.sample = { x: SPECIMEN_SAMPLE.x, y: SPECIMEN_SAMPLE.y };
    els.caption.textContent = caption;
    refreshSource();
  }

  function loadPreset(id) {
    const preset = E.PRESETS.find(function (p) {
      return p.id === id;
    });
    if (!preset) return;
    state.sourceKind = 'preset';
    state.presetId = id;
    useSpecimen(
      preset.lab,
      'A procedural skin specimen at the ' + preset.short + ' starting point. It is a colour and texture study, not a picture of a person. Measured values come from the drawn pixels, so they can sit a few units away from the starting values.'
    );
  }

  function loadHex(value) {
    const rgb = E.parseHex(value);
    if (!rgb) {
      els.hexInput.setAttribute('aria-invalid', 'true');
      say('That is not a hex colour. Use six digits such as #C3987A.');
      return;
    }
    els.hexInput.removeAttribute('aria-invalid');
    state.sourceKind = 'hex';
    const lab = E.srgbToLab(rgb[0], rgb[1], rgb[2]);
    useSpecimen(
      lab,
      'A procedural skin specimen drawn around ' + E.rgbToHex(rgb[0], rgb[1], rgb[2]).toUpperCase() + '. Shading and texture move the measured values a few units from the typed colour.'
    );
  }

  function drawPhoto(source, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(W / width, H / height);
    const dw = width * scale;
    const dh = height * scale;
    ctx.drawImage(source, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const data = ctx.getImageData(0, 0, W, H);
    state.image = { width: W, height: H, data: data.data };
    state.lipMask = null;
    state.sourceKind = 'photo';
    state.sample = { x: PHOTO_SAMPLE.x, y: PHOTO_SAMPLE.y };
    els.caption.textContent = 'Your photo, cropped to fit. It stays in this tab. Turn on the skin patch picker and click a cheek in even light for the cleanest reading.';
    refreshSource();
  }

  function loadPhoto(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      say('Choose a PNG, JPEG or WebP photo.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      say('That photo is over 25 MB. Choose a smaller one.');
      return;
    }
    say('Reading the photo in this tab.');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      drawPhoto(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      say('That photo could not be read. Try a different file.');
    };
    img.src = url;
  }

  /* ------------------------------------------------------------ */
  /* Analysis and rendering                                        */
  /* ------------------------------------------------------------ */

  function refreshSource() {
    state.selected = {};
    state.sampling = false;
    syncSamplingUi();
    drawRaw();
    analyze(true);
  }

  function analyze(resetSelection) {
    let analysis;
    try {
      state.patch = E.extractPatch(state.image, state.sample.x, state.sample.y, PATCH);
      analysis = E.analyzeSkinPatch(state.patch);
    } catch (err) {
      state.analysis = null;
      say('The sampled region has no readable pixels. Move the marker onto skin.');
      return;
    }
    state.analysis = analysis;
    ['foundation', 'concealer', 'lip'].forEach(function (kind) {
      state.ranking[kind] = E.rankShades(state.analysis.lab, kind);
      if (resetSelection || !state.selected[kind]) state.selected[kind] = state.ranking[kind][0].swatch.id;
    });
    placeRing();
    renderReading();
    renderRanking();
    renderResult();
    renderYouCam();
    renderChecksum();
    say(R.describeReading(state.analysis, state.ranking));
  }

  function drawRaw() {
    const ctx = els.raw.getContext('2d');
    ctx.putImageData(new ImageData(state.image.data, W, H), 0, 0);
  }

  function selectedRow(kind) {
    const id = state.selected[kind];
    return state.ranking[kind].find(function (row) {
      return row.swatch.id === id;
    });
  }

  function renderResult() {
    if (state.queued) return;
    state.queued = true;
    requestAnimationFrame(function () {
      state.queued = false;
      paintResult();
    });
  }

  function paintResult() {
    if (!state.image || !state.analysis) return;
    let out;
    if (state.mode === 'map') {
      out = E.buildChromophoreMap(state.image);
    } else {
      const foundation = selectedRow('foundation');
      out = E.applyFoundation(state.image, foundation.swatch.lab, {
        coverage: Number(els.coverage.value) / 100,
        glow: Number(els.glow.value) / 100,
        meanLab: state.analysis.lab,
        mask: state.lipMask ? state.solidMask : undefined,
        lipMask: state.lipMask || undefined
      });
      if (state.lipMask) {
        const lip = selectedRow('lip');
        out = E.applyLipColor(out, state.lipMask, lip.swatch.lab, {
          intensity: Number(els.lipIntensity.value) / 100,
          finish: els.lipFinish.value
        });
      }
    }
    els.result.getContext('2d').putImageData(new ImageData(out.data, W, H), 0, 0);
  }

  function placeRing() {
    els.ring.hidden = false;
    els.ring.style.left = (state.sample.x / W) * 100 + '%';
    els.ring.style.top = (state.sample.y / H) * 100 + '%';
    els.ring.style.width = (PATCH / W) * 100 + '%';
    els.ring.style.height = (PATCH / H) * 100 + '%';
  }

  function metricRows(a) {
    return [
      ['L*', R.num(a.lab[0], 2)],
      ['a*', R.num(a.lab[1], 2)],
      ['b*', R.num(a.lab[2], 2)],
      ['Chroma C*', R.num(a.chroma, 2)],
      ['Hue angle', R.num(a.hue, 1) + '°'],
      ['ITA', R.num(a.ita, 1) + '°'],
      ['ITA band', a.category.name],
      ['Undertone (heuristic)', a.undertone || 'Not rated'],
      ['Erythema index (proxy)', R.num(a.erythemaIndex, 1)],
      ['Melanin index (proxy)', R.num(a.melaninIndex, 1)],
      ['Redness coverage', R.num(a.rednessCoverage * 100, 1) + '%'],
      ['Texture roughness', R.num(a.textureRoughness, 2)],
      ['Pore minima per 1000 px', R.num(a.poreDensity, 1)],
      ['Pore contrast (L*)', R.num(a.poreContrast, 2)],
      ['Shine ratio', R.num(a.shineRatio * 100, 1) + '%']
    ];
  }

  function renderReading() {
    const a = state.analysis;
    els.arcHost.innerHTML =
      R.renderItaArcSvg({ lab: a.lab, ita: a.ita, category: a.category, rows: state.ranking.foundation }) +
      '<p class="arc-legend">' +
      state.ranking.foundation
        .slice(0, 3)
        .map(function (r, i) {
          return R.esc((i + 1) + ' ' + r.swatch.name + ' ' + R.num(r.deltaE, 2));
        })
        .join(',  ') +
      '</p>';
    els.compassHost.innerHTML = R.renderUndertoneCompassSvg({ lab: a.lab, undertone: a.undertone });
    els.metrics.innerHTML = metricRows(a)
      .map(function (row) {
        return '<dt>' + R.esc(row[0]) + '</dt><dd>' + R.esc(row[1]) + '</dd>';
      })
      .join('');
  }

  function renderRanking() {
    const kind = state.kind;
    els.kindNote.textContent = KIND_NOTES[kind];
    const rows = state.ranking[kind];
    const worst = Math.max.apply(null, rows.map(function (r) { return r.deltaE; }));
    const tryable = kind !== 'concealer';
    els.ranking.innerHTML = rows
      .map(function (row) {
        const chosen = state.selected[kind] === row.swatch.id;
        const width = Math.max(4, Math.round((1 - row.deltaE / (worst + 1)) * 100));
        return (
          '<li><span class="rank-num">' + row.rank + '</span>' +
          '<span class="rank-chip" style="background:' + R.esc(row.swatch.hex) + '" aria-hidden="true"></span>' +
          '<span class="rank-name"><strong>' + R.esc(row.swatch.name) + (row.top ? '<span class="top-flag">Top 3</span>' : '') + '</strong><span>' + R.esc(row.swatch.hex) + '</span></span>' +
          '<span class="rank-de"><strong>' + R.num(row.deltaE, 2) + '</strong><span>' + R.esc(row.label) + '</span></span>' +
          '<span class="rank-bar" aria-hidden="true"><i style="width:' + width + '%"></i></span>' +
          '<button type="button" class="btn btn-quiet" data-shade="' + row.swatch.id + '" data-kind="' + kind + '" aria-pressed="' + (chosen ? 'true' : 'false') + '">' +
          (chosen ? 'In use' : tryable ? 'Try on' : 'Use in request') + '</button></li>'
        );
      })
      .join('');
  }

  /* ------------------------------------------------------------ */
  /* YouCam panel                                                  */
  /* ------------------------------------------------------------ */

  function currentTier() {
    return radioValue('yc-tier', 'hd');
  }

  function currentTask() {
    return radioValue('yc-task', 'skin-analysis');
  }

  function defaultActions(tier) {
    return tier === 'hd'
      ? E.DEFAULT_HD_ACTIONS.slice()
      : E.DEFAULT_HD_ACTIONS.map(function (a) {
          return SD_FOR[a];
        });
  }

  function renderActionChoices(tier, checked) {
    const list = tier === 'hd' ? E.HD_ACTIONS : E.SD_ACTIONS;
    els.ycActions.innerHTML = list
      .map(function (action) {
        return (
          '<label><input type="checkbox" value="' + action + '"' + (checked.indexOf(action) !== -1 ? ' checked' : '') + '><span>' + action + '</span></label>'
        );
      })
      .join('');
  }

  function checkedActions() {
    const boxes = els.ycActions.querySelectorAll('input');
    const out = [];
    for (let i = 0; i < boxes.length; i += 1) {
      if (boxes[i].checked) out.push(boxes[i].value);
    }
    return out;
  }

  function sourceOptions() {
    const type = els.ycSrcType.value;
    if (type === 'upload') return { src_file_id: 'ASSIGNED_AFTER_UPLOAD' };
    const src = {};
    src[type] = els.ycSrc.value.trim();
    return src;
  }

  function currentEffects() {
    const foundation = selectedRow('foundation');
    const concealer = selectedRow('concealer');
    const lip = selectedRow('lip');
    return E.shadeToYouCamEffects({
      foundation: foundation.swatch,
      foundationOptions: {
        colorIntensity: 50,
        glowIntensity: Number(els.glow.value),
        coverageIntensity: Number(els.coverage.value)
      },
      concealer: concealer.swatch,
      lip: lip.swatch,
      lipOptions: { texture: els.lipFinish.value, colorIntensity: Number(els.lipIntensity.value) }
    });
  }

  function renderYouCam() {
    const task = currentTask();
    const upload = els.ycSrcType.value === 'upload';
    els.ycSkinOptions.hidden = task !== 'skin-analysis';
    els.ycUploadField.hidden = !upload;
    els.ycSrcField.hidden = upload;
    syncRunButton();
    let request;
    try {
      if (task === 'skin-analysis') {
        request = E.buildYouCamTaskPayload(Object.assign({ task: task, dst_actions: checkedActions() }, sourceOptions()));
      } else {
        request = E.buildYouCamTaskPayload(Object.assign({ task: task, effects: currentEffects() }, sourceOptions()));
      }
      els.ycError.textContent = '';
      state.yc.json = JSON.stringify(request.body, null, 2);
      state.yc.curl = E.buildYouCamCurl(request);
      els.ycEndpoint.textContent = request.method + ' ' + request.url;
      els.ycJson.textContent = state.yc.json;
      els.ycCopyJson.disabled = false;
      els.ycCopyCurl.disabled = false;
    } catch (err) {
      els.ycError.textContent = err.message;
      state.yc.json = '';
      state.yc.curl = '';
      els.ycJson.textContent = '';
      els.ycEndpoint.textContent = '';
      els.ycCopyJson.disabled = true;
      els.ycCopyCurl.disabled = true;
    }
    renderReceipt();
  }

  /* ------------------------------------------------------------ */
  /* Live run                                                      */
  /* ------------------------------------------------------------ */

  function syncRunButton() {
    els.ycRun.disabled = !(els.ycConsent.checked && els.ycKey.value.trim() !== '');
  }

  function liveStatus(text, isError) {
    els.ycLiveStatus.textContent = text;
    if (isError) els.ycLiveStatus.setAttribute('data-error', 'true');
    else els.ycLiveStatus.removeAttribute('data-error');
  }

  async function runLive() {
    const task = currentTask();
    const upload = els.ycSrcType.value === 'upload';
    els.ycLiveResult.innerHTML = '';
    els.ycRun.setAttribute('aria-busy', 'true');
    els.ycRun.disabled = true;
    try {
      const clientOptions = {
        apiKey: els.ycKey.value.trim(),
        onProgress: function (message) {
          liveStatus(message, false);
        }
      };
      if (typeof window.fetch === 'function') clientOptions.fetchImpl = window.fetch.bind(window);
      const client = Y.createYouCamClient(clientOptions);
      let src;
      if (upload) {
        const file = els.ycUpload.files && els.ycUpload.files[0];
        if (!file) throw new Error('Choose a photo to upload first.');
        if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('YouCam takes JPEG or PNG photos.');
        if (file.size > 10 * 1024 * 1024) throw new Error('YouCam takes photos under 10 MB.');
        src = { src_file_id: await client.uploadFile(file) };
      } else {
        src = sourceOptions();
      }
      if (task === 'skin-analysis') {
        const out = await client.runSkinAnalysis(Object.assign({ dst_actions: checkedActions() }, src));
        els.ycResponse.value = JSON.stringify(out.raw, null, 2);
        readResponse();
        liveStatus(out.result.taskStatus === 'success' ? 'Done. The scores are in the response inspector below.' : 'The task finished with an error. Details are in the response inspector below.', out.result.taskStatus !== 'success');
      } else {
        const out = await client.runMakeupVto(Object.assign({ effects: currentEffects() }, src));
        els.ycLiveResult.innerHTML = '<img src="' + R.esc(out.url) + '" alt="Try on result returned by YouCam" width="360">';
        liveStatus('Done. The link to this image is valid for about two hours.', false);
      }
    } catch (err) {
      liveStatus(err.message, true);
    } finally {
      els.ycRun.removeAttribute('aria-busy');
      syncRunButton();
    }
  }

  function renderConcernTable(result) {
    if (result.taskStatus === 'error') {
      return '<p class="form-error">' + R.esc(result.errorMessage || 'The task reported an error.') + '</p>';
    }
    if (result.taskStatus === 'running') {
      return '<p class="hint">The task is still running. Poll again and paste the finished response.</p>';
    }
    const head = [];
    if (result.overall !== null) head.push('Overall ' + R.num(result.overall, 1));
    if (result.skinAge !== null) head.push('Skin age ' + result.skinAge);
    let html = head.length ? '<p class="mono-line">' + R.esc(head.join(', ')) + '</p>' : '';
    if (result.concerns.length === 0) {
      return html + '<p class="hint">' + R.esc(result.warnings.join(' ') || 'No concern scores found.') + '</p>';
    }
    html += '<table class="data-table"><caption>Scores read from the response</caption><thead><tr><th scope="col">Concern</th><th scope="col">Region</th><th scope="col">Raw</th><th scope="col">UI</th><th scope="col">Band</th></tr></thead><tbody>';
    result.concerns.forEach(function (c) {
      html +=
        '<tr><th scope="row">' + R.esc(c.label) + '</th><td>' + R.esc(c.region) + '</td><td class="num">' +
        (c.rawScore === null ? 'n/a' : R.num(c.rawScore, 1)) + '</td><td class="num">' +
        (c.uiScore === null ? 'n/a' : c.uiScore) + '</td><td><span class="band-tag" data-band="' + c.band + '">' + c.band + '</span></td></tr>';
    });
    return html + '</tbody></table>';
  }

  function readResponse() {
    const text = els.ycResponse.value.trim();
    els.ycResponse.removeAttribute('aria-invalid');
    els.ycReadError.textContent = '';
    if (!text) {
      els.ycReadError.textContent = 'Paste a response first, or load the docs sample.';
      els.ycResponse.setAttribute('aria-invalid', 'true');
      return;
    }
    try {
      const result = E.normalizeYouCamSkinResponse(text);
      els.ycTable.innerHTML = renderConcernTable(result);
      state.yc.concerns = result.concerns.length ? result.concerns : null;
      state.yc.overall = result.overall;
      state.yc.skinAge = result.skinAge;
      renderReceipt();
    } catch (err) {
      els.ycReadError.textContent = err.message + '. Paste the JSON exactly as returned.';
      els.ycResponse.setAttribute('aria-invalid', 'true');
    }
  }

  function renderReceipt() {
    if (!state.analysis) return;
    const fromYouCam = !!state.yc.concerns;
    const concerns = fromYouCam ? state.yc.concerns : E.localConcerns(state.analysis);
    const ranking = {};
    ['foundation', 'concealer', 'lip'].forEach(function (kind) {
      const row = selectedRow(kind);
      ranking[kind] = row ? [row] : [];
    });
    const receipt = E.buildRegimenReceipt({
      concerns: concerns,
      ranking: ranking,
      tone: { lab: state.analysis.lab, ita: state.analysis.ita, category: state.analysis.category, undertone: state.analysis.undertone },
      source: fromYouCam ? 'youcam' : 'local'
    });
    els.receiptText.textContent = receipt.text;
    els.receiptSource.textContent = fromYouCam
      ? 'Built from the pasted YouCam response, using raw scores.'
      : 'Built from the local estimate. It covers pores, texture, oiliness and redness only. Wrinkles, blemishes, moisture and radiance need a YouCam response.';
  }

  /* ------------------------------------------------------------ */
  /* Clipboard                                                     */
  /* ------------------------------------------------------------ */

  function flash(button, note, noteText, ok) {
    button.setAttribute('data-state', ok ? 'success' : 'error');
    note.textContent = noteText;
    setTimeout(function () {
      button.removeAttribute('data-state');
    }, 1600);
  }

  function copyText(text, button, note) {
    const done = function (ok) {
      flash(button, note, ok ? 'Copied to the clipboard.' : 'Copy failed. Select the text and copy it by hand.', ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(false);
        }
      );
    } else {
      done(false);
    }
  }

  /* ------------------------------------------------------------ */
  /* Sampling                                                      */
  /* ------------------------------------------------------------ */

  function syncSamplingUi() {
    els.sampleToggle.setAttribute('aria-pressed', state.sampling ? 'true' : 'false');
    els.sampleToggle.textContent = state.sampling ? 'Picker on' : 'Pick a skin patch';
    els.picker.hidden = !state.sampling;
    els.stage.setAttribute('data-sampling', state.sampling ? 'true' : 'false');
  }

  function moveSample(x, y) {
    const half = PATCH / 2;
    state.sample.x = Math.min(Math.max(Math.round(x), half), W - half);
    state.sample.y = Math.min(Math.max(Math.round(y), half), H - half);
    analyze(false);
  }

  function pointerToCanvas(event) {
    const rect = els.frame.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H
    };
  }

  /* ------------------------------------------------------------ */
  /* Screening literacy and fairness workbench                     */
  /* ------------------------------------------------------------ */

  function labSay(text) {
    els.labStatus.textContent = text;
  }

  function renderAbcde() {
    state.abcdeResult = F.abcdeScore(state.abcdeGrades);
    els.abcdeScore.textContent = 'Checklist score ' + Math.round(state.abcdeResult.total) + ' of 100';
    els.abcdeBand.textContent = state.abcdeResult.band.label;
    els.abcdeBand.setAttribute('data-band', state.abcdeResult.band.id);
    els.abcdeNote.textContent = state.abcdeResult.note;
  }

  function renderFairnessTable(audit) {
    const row = function (label, g) {
      return '<tr><th scope="row">' + label + '</th><td class="num">' + g.n + '</td>' +
        '<td class="num">' + g.sensitivity.toFixed(2) + '</td>' +
        '<td class="num">' + g.wilson.lo.toFixed(2) + ' to ' + g.wilson.hi.toFixed(2) + '</td>' +
        '<td class="num">' + g.specificity.toFixed(2) + '</td>' +
        '<td class="num">' + g.fnr.toFixed(2) + '</td></tr>';
    };
    const body = audit.perType
      .map(function (t) {
        return row(t.numeral, t);
      })
      .concat([
        row('I-II', audit.groups.light),
        row('V-VI', audit.groups.deep)
      ])
      .join('');
    return '<table class="data-table"><caption>Sensitivity, Wilson 95% interval, specificity and false negative rate by Fitzpatrick type at threshold ' +
      audit.threshold.toFixed(2) + '</caption><thead><tr><th scope="col">Type</th><th scope="col">n</th>' +
      '<th scope="col">Sens</th><th scope="col">Wilson 95%</th><th scope="col">Spec</th><th scope="col">FNR</th></tr></thead>' +
      '<tbody>' + body + '</tbody></table>';
  }

  function renderFairness() {
    if (!state.cohort) state.cohort = F.buildSyntheticCohort();
    state.audit = F.auditFairness(state.cohort, state.threshold / 100);
    els.fairChartHost.innerHTML = F.renderFairnessSvg(state.audit);
    els.fairTableHost.innerHTML = renderFairnessTable(state.audit);
    els.fairNote.textContent =
      'Sensitivity gap, I-II minus V-VI: ' + state.audit.sensGap.toFixed(2) +
      '. FNR gap, V-VI minus I-II: ' + state.audit.fnrGap.toFixed(2) +
      '. ECE ' + state.audit.ece.toFixed(3) + ' over ' + state.audit.n + ' synthetic records.';
  }

  function renderPhotoGate() {
    const q = state.quality;
    els.pqList.innerHTML = q.checks
      .map(function (c) {
        return '<li class="pq-check" data-pass="' + (c.pass ? 'true' : 'false') + '">' +
          '<span class="pq-name">' + R.esc(c.name) + (c.attested ? ' <span class="pq-attested">you confirmed</span>' : '') + '</span>' +
          '<span class="pq-value">' + R.esc(c.value) + '</span>' +
          '<span class="pq-state">' + (c.pass ? 'pass' : 'check') + '</span></li>';
      })
      .join('');
    els.pqVerdict.textContent = q.verdict.text + ' ' + q.note;
    els.pqVerdict.setAttribute('data-verdict', q.verdict.id);
  }

  function runPhotoGate() {
    if (!state.image) {
      els.pqVerdict.textContent = 'No image in the studio yet.';
      return;
    }
    state.quality = F.imageQualityGate(state.image, { scaleConfirmed: state.scaleConfirmed });
    renderPhotoGate();
    renderChecksum();
    labSay('Photo gate: ' + state.quality.passed + ' of ' + state.quality.total + ' checks pass.');
  }

  function renderPrep() {
    const brief = F.visitPrepBrief(state.abcdeResult);
    els.prepUrgency.textContent = brief.urgency.label;
    els.prepUrgency.setAttribute('data-tier', brief.urgency.id);
    els.prepNote.textContent = brief.urgency.note;
    els.prepList.innerHTML = brief.items
      .map(function (item) {
        return '<li>' + R.esc(item) + '</li>';
      })
      .join('');
  }

  function buildExport() {
    return F.buildAuditBundle({
      created: new Date().toISOString(),
      abcde: state.abcdeResult,
      audit: state.audit,
      quality: state.quality,
      tone: state.analysis
        ? {
            lab: state.analysis.lab,
            ita: state.analysis.ita,
            band: state.analysis.category.name,
            undertone: state.analysis.undertone
          }
        : null
    });
  }

  function renderChecksum() {
    state.exportBundle = buildExport();
    els.exChecksum.textContent = 'sha256 ' + state.exportBundle.sha256;
  }

  function updateBookmark() {
    const hash = F.formatDermHash({
      a: state.abcdeGrades.A,
      b: state.abcdeGrades.B,
      c: state.abcdeGrades.C,
      d: state.abcdeGrades.D,
      e: state.abcdeGrades.E,
      threshold: state.threshold,
      scale: state.scaleConfirmed
    });
    let base = 'https://aariv.me/dermavto/';
    if (typeof window.location === 'object' && window.location && typeof window.location.href === 'string') {
      base = window.location.href.split('#')[0];
    }
    els.dermBookmark.value = base + '#' + hash;
    if (window.history && typeof window.history.replaceState === 'function') {
      try {
        window.history.replaceState(null, '', '#' + hash);
      } catch (err) {
        // file:// pages can refuse replaceState; the field still shows the link.
      }
    }
  }

  function restoreFromHash() {
    let raw = '';
    try {
      if (typeof window.location === 'object' && window.location && window.location.hash) {
        raw = window.location.hash;
      }
    } catch (err) {
      raw = '';
    }
    const parsed = F.parseDermHash(raw);
    if (!parsed) return false;
    state.abcdeGrades = { A: parsed.a, B: parsed.b, C: parsed.c, D: parsed.d, E: parsed.e };
    state.threshold = parsed.threshold;
    state.scaleConfirmed = parsed.scale;
    ['A', 'B', 'C', 'D', 'E'].forEach(function (letter) {
      const want = String(state.abcdeGrades[letter]);
      document.querySelectorAll('input[name="abcde-' + letter + '"]').forEach(function (input) {
        input.checked = input.value === want;
      });
    });
    els.fairThreshold.value = String(state.threshold);
    els.fairThresholdOut.textContent = String(state.threshold);
    els.pqScale.checked = state.scaleConfirmed;
    return true;
  }

  function renderLabAll() {
    renderAbcde();
    renderFairness();
    renderPrep();
    renderChecksum();
    updateBookmark();
  }

  function onLabInput() {
    renderAbcde();
    renderPrep();
    renderChecksum();
    updateBookmark();
  }

  function bindLab() {
    ['A', 'B', 'C', 'D', 'E'].forEach(function (letter) {
      document.querySelectorAll('input[name="abcde-' + letter + '"]').forEach(function (input) {
        input.addEventListener('change', function () {
          if (!input.checked) return;
          state.abcdeGrades[letter] = Number(input.value);
          onLabInput();
        });
      });
    });
    els.fairThreshold.addEventListener('input', function () {
      state.threshold = Number(els.fairThreshold.value);
      els.fairThresholdOut.textContent = String(state.threshold);
      renderFairness();
      renderChecksum();
      updateBookmark();
    });
    els.pqScale.addEventListener('change', function () {
      state.scaleConfirmed = els.pqScale.checked === true;
      updateBookmark();
      renderChecksum();
      if (state.quality) runPhotoGate();
    });
    els.pqRun.addEventListener('click', runPhotoGate);
    els.exCopyJson.addEventListener('click', function () {
      copyText(F.exportAuditJson(state.exportBundle), els.exCopyJson, els.exCopyNote);
    });
    els.exCopyCsv.addEventListener('click', function () {
      copyText(F.exportAuditCsv(state.exportBundle), els.exCopyCsv, els.exCopyNote);
    });
    els.exCopyMd.addEventListener('click', function () {
      copyText(F.exportAuditMarkdown(state.exportBundle), els.exCopyMd, els.exCopyNote);
    });
    els.exDownload.addEventListener('click', function () {
      if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        flash(els.exDownload, els.exCopyNote, 'Download is not available here; use Copy JSON instead.', false);
        return;
      }
      const blob = new Blob([F.exportAuditJson(state.exportBundle)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dermavto-workbench.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(els.exDownload, els.exCopyNote, 'Downloaded dermavto-workbench.json.', true);
    });
    els.exVerifyRun.addEventListener('click', function () {
      const text = els.exVerify.value;
      if (!text || !text.trim()) {
        els.exVerifyStatus.textContent = 'Paste a JSON export first.';
        els.exVerifyStatus.setAttribute('data-error', 'true');
        return;
      }
      const r = F.verifyAuditJson(text);
      if (r.ok) {
        els.exVerifyStatus.textContent = 'Digest matches. The export is unchanged.';
        els.exVerifyStatus.setAttribute('data-error', 'false');
      } else if (r.reason === 'changed') {
        els.exVerifyStatus.textContent = 'Digest mismatch. The export text was changed after it was written, or the digest does not belong to it.';
        els.exVerifyStatus.setAttribute('data-error', 'true');
      } else {
        els.exVerifyStatus.textContent = 'That is not a readable workbench export.';
        els.exVerifyStatus.setAttribute('data-error', 'true');
      }
    });
    els.selftestRun.addEventListener('click', function () {
      const results = F.runSelfTests();
      els.selftestList.innerHTML = results
        .map(function (r) {
          return '<li class="st-row" data-ok="' + (r.ok ? 'true' : 'false') + '">' +
            '<span class="st-name">' + R.esc(r.name) + '</span>' +
            '<span class="st-state">' + (r.ok ? 'pass' : 'fail') + '</span>' +
            '<span class="st-detail">' + R.esc(r.detail) + '</span></li>';
        })
        .join('');
      const fails = results.filter(function (r) {
        return !r.ok;
      }).length;
      labSay(fails === 0
        ? 'All ' + results.length + ' in page checks passed.'
        : fails + ' of ' + results.length + ' in page checks failed.');
    });
  }

  /* ------------------------------------------------------------ */
  /* Events                                                        */
  /* ------------------------------------------------------------ */

  function bind() {
    document.querySelectorAll('input[name="preset"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.checked) loadPreset(input.value);
      });
    });
    document.querySelectorAll('input[name="mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.mode = input.value;
        els.tagRight.textContent = state.mode === 'map' ? 'Chromophore map' : 'Try on';
        renderResult();
      });
    });
    document.querySelectorAll('input[name="kind"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.kind = input.value;
        renderRanking();
      });
    });
    document.querySelectorAll('input[name="yc-task"]').forEach(function (input) {
      input.addEventListener('change', renderYouCam);
    });
    document.querySelectorAll('input[name="yc-tier"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        renderActionChoices(input.value, defaultActions(input.value));
        renderYouCam();
      });
    });

    els.hexApply.addEventListener('click', function () {
      loadHex(els.hexInput.value);
    });
    els.hexInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadHex(els.hexInput.value);
      }
    });
    els.photoInput.addEventListener('change', function () {
      loadPhoto(els.photoInput.files && els.photoInput.files[0]);
    });

    els.split.addEventListener('input', function () {
      const v = Number(els.split.value);
      els.stage.style.setProperty('--split', v + '%');
      els.split.setAttribute('aria-valuetext', 'Raw sample ' + v + ' percent, result ' + (100 - v) + ' percent');
    });

    [els.coverage, els.glow, els.lipIntensity].forEach(function (input) {
      input.addEventListener('input', function () {
        $(input.id + '-out').textContent = input.value;
        renderResult();
        renderYouCam();
      });
    });
    els.lipFinish.addEventListener('change', function () {
      renderResult();
      renderYouCam();
    });

    els.sampleToggle.addEventListener('click', function () {
      state.sampling = !state.sampling;
      syncSamplingUi();
      if (state.sampling) {
        els.picker.focus();
        say('Picker on. Click the image, or use the arrow keys, to move the sampled patch.');
      }
    });
    let dragging = false;
    els.picker.addEventListener('pointerdown', function (event) {
      dragging = true;
      const p = pointerToCanvas(event);
      moveSample(p.x, p.y);
    });
    els.picker.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      const p = pointerToCanvas(event);
      moveSample(p.x, p.y);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (name) {
      els.picker.addEventListener(name, function () {
        dragging = false;
      });
    });
    els.picker.addEventListener('keydown', function (event) {
      const step = event.shiftKey ? 48 : 16;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) {
        event.preventDefault();
        moveSample(state.sample.x + moves[event.key][0], state.sample.y + moves[event.key][1]);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        say(R.describeReading(state.analysis, state.ranking));
      }
    });

    els.ranking.addEventListener('click', function (event) {
      const button = event.target && event.target.closest ? event.target.closest('button[data-shade]') : null;
      if (!button) return;
      state.selected[button.dataset.kind] = button.dataset.shade;
      renderRanking();
      renderResult();
      renderYouCam();
    });

    els.ycSrcType.addEventListener('change', renderYouCam);
    els.ycKey.addEventListener('input', syncRunButton);
    els.ycConsent.addEventListener('change', syncRunButton);
    els.ycRun.addEventListener('click', runLive);
    els.ycSrc.addEventListener('input', renderYouCam);
    els.ycActions.addEventListener('change', renderYouCam);
    els.ycCopyJson.addEventListener('click', function () {
      copyText(state.yc.json, els.ycCopyJson, els.ycCopyNote);
    });
    els.ycCopyCurl.addEventListener('click', function () {
      copyText(state.yc.curl, els.ycCopyCurl, els.ycCopyNote);
    });
    els.ycRead.addEventListener('click', readResponse);
    els.ycSample.addEventListener('click', function () {
      els.ycResponse.value = JSON.stringify(DOCS_SAMPLE, null, 2);
      readResponse();
    });
    els.receiptCopy.addEventListener('click', function () {
      copyText(els.receiptText.textContent, els.receiptCopy, els.receiptNote);
    });
  }

  function watchStageStick() {
    if (typeof window.matchMedia !== 'function' || typeof window.addEventListener !== 'function') return;
    const narrow = window.matchMedia('(max-width: 960px)');
    let queued = false;
    function update() {
      queued = false;
      const stuck = narrow.matches && els.stage.getBoundingClientRect().top <= 1 && window.scrollY > 1;
      const was = els.stage.getAttribute('data-stuck') === 'true';
      if (stuck === was) return;
      if (stuck) {
        // The caption leaves the pinned bar to save height. The margin keeps the page below from jumping up.
        const before = els.stage.offsetHeight;
        els.stage.setAttribute('data-stuck', 'true');
        els.stage.style.marginBottom = Math.max(0, before - els.stage.offsetHeight) + 'px';
      } else {
        els.stage.removeAttribute('data-stuck');
        els.stage.style.marginBottom = '';
      }
    }
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update);
  }

  function init() {
    document.querySelectorAll('.preset-chip').forEach(function (chip) {
      const preset = E.PRESETS.find(function (p) {
        return p.id === chip.dataset.chip;
      });
      if (preset) chip.style.background = E.labToHex(preset.lab[0], preset.lab[1], preset.lab[2]);
    });
    renderActionChoices('hd', defaultActions('hd'));
    bind();
    bindLab();
    watchStageStick();
    els.stage.style.setProperty('--split', els.split.value + '%');
    loadPreset(radioValue('preset', 'p3'));
    restoreFromHash();
    renderLabAll();
  }

  init();
})();
