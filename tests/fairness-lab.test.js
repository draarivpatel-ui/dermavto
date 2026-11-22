'use strict';
/* Fairness lab regression tests: SHA-256 FIPS 180-4 KATs plus a crypto cross
   check, the ABCDE checklist score, Wilson intervals, ECE, the synthetic
   Fitzpatrick cohort and audit, the photo readiness gate, checksummed
   exports, the #derm= bookmark codec, the fairness SVG and the self tests. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine.js');
const F = require('../fairness-lab.js');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, a + ' vs ' + b);

describe('SHA-256, FIPS 180-4', () => {
  F.SHA256_KAT.forEach((pair, i) => {
    it('known answer ' + (i + 1) + ' matches the published digest', () => {
      assert.equal(F.sha256Hex(pair[0]), pair[1]);
    });
  });

  const SAMPLES = [
    '', 'a', 'abc', 'message digest', 'abcdefghijklmnopqrstuvwxyz',
    'The quick brown fox jumps over the lazy dog',
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890',
    'dermavto', 'Fitzpatrick type V skin', 'café au lait', 'L* 66.0 a* 10.0 b* 23.0',
    'derm=v1,a0,b0,c0,d0,e0,t65,s0',
    'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(57), 'x'.repeat(63),
    'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(119), 'x'.repeat(128), 'x'.repeat(129),
    'y'.repeat(1000), 'n'.repeat(10000)
  ];
  SAMPLES.forEach((s) => {
    it('agrees with node crypto on a ' + s.length + ' char input', () => {
      const want = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
      assert.equal(F.sha256Hex(s), want);
    });
  });

  it('agrees with node crypto on a four byte per code point string', () => {
    const s = 'skin ' + String.fromCodePoint(0x1f311) + ' tone';
    const want = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(F.sha256Hex(s), want);
  });

  it('agrees with node crypto on raw bytes', () => {
    const bytes = [];
    for (let i = 0; i < 256; i += 1) bytes.push(i);
    const want = crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    assert.equal(F.sha256Hex(bytes), want);
  });

  it('utf8 encodes BMP and astral characters correctly', () => {
    assert.deepEqual(F.utf8Bytes('A'), [0x41]);
    assert.deepEqual(F.utf8Bytes('é'), [0xc3, 0xa9]);
    assert.deepEqual(F.utf8Bytes('€'), [0xe2, 0x82, 0xac]);
    assert.deepEqual(F.utf8Bytes(String.fromCodePoint(0x1f311)), [0xf0, 0x9f, 0x8c, 0x91]);
  });

  it('encodes lone surrogates as U+FFFD rather than throwing', () => {
    const bytes = F.utf8Bytes('a\ud800b\udfff');
    assert.deepEqual(bytes, [0x61, 0xef, 0xbf, 0xbd, 0x62, 0xef, 0xbf, 0xbd]);
  });
});

describe('ABCDE checklist score', () => {
  it('weights Evolution above every other letter', () => {
    F.ABCDE.forEach((def) => {
      assert.ok(def.weight <= F.ABCDE[4].weight, def.letter + ' must not outweigh E');
    });
    assert.equal(F.ABCDE[4].letter, 'E');
  });

  it('is non-decreasing in every letter grade', () => {
    ['A', 'B', 'C', 'D', 'E'].forEach((letter) => {
      let prev = -1;
      for (let g = 0; g <= 3; g += 1) {
        const input = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        input[letter] = g;
        const total = F.abcdeScore(input).total;
        assert.ok(total >= prev - 1e-12, letter + ' grade ' + g + ' lowered the score');
        prev = total;
      }
    });
  });

  it('scores zero when every answer is grade 0', () => {
    const r = F.abcdeScore({ A: 0, B: 0, C: 0, D: 0, E: 0 });
    assert.equal(r.total, 0);
    assert.equal(r.band.id, 'few');
    assert.equal(r.complete, true);
  });

  it('scores 100 when every answer is grade 3', () => {
    const r = F.abcdeScore({ A: 3, B: 3, C: 3, D: 3, E: 3 });
    assert.equal(r.total, 100);
    assert.equal(r.band.id, 'strong');
  });

  it('gives one grade step of E more points than one of A', () => {
    const a = F.abcdeScore({ A: 1, B: 0, C: 0, D: 0, E: 0 }).total;
    const e = F.abcdeScore({ A: 0, B: 0, C: 0, D: 0, E: 1 }).total;
    assert.ok(e > a, 'Evolution must weigh most');
  });

  it('computes subscores as grade share times weight', () => {
    const r = F.abcdeScore({ A: 3, B: 0, C: 0, D: 0, E: 0 });
    close(r.letters.A.points, 1.0);
    close(r.letters.B.points, 0);
    const d = F.abcdeScore({ A: 0, B: 0, C: 0, D: 3, E: 0 });
    close(d.letters.D.points, 1.25);
  });

  it('accepts a five element array in A B C D E order', () => {
    const r = F.abcdeScore([1, 2, 0, 3, 1]);
    assert.equal(r.letters.A.grade, 1);
    assert.equal(r.letters.B.grade, 2);
    assert.equal(r.letters.D.grade, 3);
    assert.equal(r.letters.E.grade, 1);
  });

  it('marks unanswered letters and reports completion', () => {
    const r = F.abcdeScore({ A: 1, C: 2 });
    assert.equal(r.answered, 2);
    assert.equal(r.complete, false);
    assert.equal(r.letters.B.grade, null);
    assert.equal(r.letters.B.label, 'not answered');
    assert.equal(r.letters.B.points, 0);
  });

  it('coerces numeric strings to grades', () => {
    const r = F.abcdeScore({ A: '2', B: '0', C: '1', D: '0', E: '3' });
    assert.equal(r.letters.A.grade, 2);
    assert.equal(r.letters.E.grade, 3);
  });

  [-1, 4, 1.5, 'x', {}].forEach((bad) => {
    it('rejects grade ' + JSON.stringify(bad) + ' for a letter', () => {
      assert.throws(() => F.abcdeScore({ A: bad }), RangeError);
    });
  });

  it('lands in the some band just past 20 points', () => {
    const r = F.abcdeScore({ A: 0, B: 0, C: 0, D: 0, E: 2 });
    assert.ok(r.total >= 20 && r.total < 45, 'total ' + r.total);
    assert.equal(r.band.id, 'some');
  });

  it('labels each grade with the matching option text', () => {
    const r = F.abcdeScore({ A: 2, B: 0, C: 0, D: 0, E: 3 });
    assert.equal(r.letters.A.label, 'Clearly lopsided');
    assert.equal(r.letters.E.label, 'Bleeds, itches, crusts or hurts');
  });
});

describe('Referral urgency and visit prep', () => {
  const score = (o) => F.abcdeScore(Object.assign({ A: 0, B: 0, C: 0, D: 0, E: 0 }, o));

  it('maps an all zero checklist to routine', () => {
    assert.equal(F.referralUrgency(score({})).id, 'routine');
  });

  it('maps any single low grade to watch', () => {
    assert.equal(F.referralUrgency(score({ C: 1 })).id, 'watch');
    assert.equal(F.referralUrgency(score({ E: 1 })).id, 'watch');
  });

  it('lets fast evolution force a book tier on its own', () => {
    assert.equal(F.referralUrgency(score({ E: 2 })).id, 'book');
  });

  it('lets new symptoms force the prompt tier on their own', () => {
    assert.equal(F.referralUrgency(score({ E: 3 })).id, 'prompt');
  });

  it('escalates with total score as well', () => {
    assert.equal(F.referralUrgency(score({ A: 3, B: 3, C: 3, D: 3, E: 2 })).id, 'prompt');
    assert.equal(F.referralUrgency(score({ A: 2, B: 2, C: 2, D: 2 })).id, 'book');
  });

  it('is non-decreasing in the checklist score', () => {
    let prev = -1;
    for (let g = 0; g <= 3; g += 1) {
      const r = F.referralUrgency(score({ A: g, B: g, C: g, D: g, E: g }));
      assert.ok(r.index >= prev, 'tier went down at grade ' + g);
      prev = r.index;
    }
  });

  it('throws on a non checklist result', () => {
    assert.throws(() => F.referralUrgency({}), TypeError);
    assert.throws(() => F.referralUrgency(null), TypeError);
  });

  it('always includes the base preparation items', () => {
    const items = F.visitPrepItems(score({}));
    assert.equal(items.length, F.PREP_BASE.length);
    assert.ok(items.some((s) => /ruler/.test(s)));
    assert.ok(items.some((s) => /medicine list/.test(s)));
    assert.ok(items.some((s) => /family history/.test(s)));
  });

  it('adds an onset note when evolution is fast', () => {
    const items = F.visitPrepItems(score({ E: 2 }));
    assert.ok(items[0].indexOf('when the change started') !== -1);
  });

  it('adds a measurement note when the spot is about 6 mm or more', () => {
    const items = F.visitPrepItems(score({ D: 2 }));
    assert.ok(items.some((s) => /millimetres/.test(s)));
  });

  it('returns tier label note and items in the brief', () => {
    const brief = F.visitPrepBrief(score({ E: 3 }));
    assert.equal(brief.urgency.id, 'prompt');
    assert.ok(brief.items.length > F.PREP_BASE.length);
    assert.match(brief.text, /prompt dermatology review/);
    assert.match(brief.text, /Photograph the spot/);
    assert.match(brief.text, /^1\. Write down when the change started/m);
  });
});

describe('Wilson score interval', () => {
  it('keeps lo <= p <= hi for every k in small n', () => {
    for (let n = 1; n <= 40; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const w = F.wilsonInterval(k, n);
        assert.ok(w.lo <= w.p + 1e-12 && w.p <= w.hi + 1e-12, k + '/' + n);
        assert.ok(w.lo >= 0 && w.hi <= 1, 'bounds ' + k + '/' + n);
      }
    }
  });

  it('returns the widest interval when n is zero', () => {
    const w = F.wilsonInterval(0, 0);
    assert.equal(w.p, 0);
    assert.equal(w.lo, 0);
    assert.equal(w.hi, 1);
    assert.equal(w.n, 0);
  });

  it('matches the published interval for 50 of 100', () => {
    const w = F.wilsonInterval(50, 100);
    close(w.lo, 0.4038, 1e-3);
    close(w.hi, 0.5962, 1e-3);
  });

  it('matches the published interval for 95 of 100', () => {
    const w = F.wilsonInterval(95, 100);
    close(w.lo, 0.8882, 1e-3);
    close(w.hi, 0.9785, 1e-3);
  });

  it('is strictly increasing in k at fixed n', () => {
    let prev = -1;
    for (let k = 0; k <= 50; k += 1) {
      const w = F.wilsonInterval(k, 50);
      assert.ok(w.hi >= prev, 'hi went down at k ' + k);
      prev = w.hi;
    }
  });

  it('shrinks as n grows at fixed share', () => {
    const a = F.wilsonInterval(10, 20);
    const b = F.wilsonInterval(100, 200);
    assert.ok(b.hi - b.lo < a.hi - a.lo);
  });

  it('widens for a smaller z', () => {
    const a = F.wilsonInterval(50, 100, 1.0);
    const b = F.wilsonInterval(50, 100, 1.96);
    assert.ok(a.hi - a.lo < b.hi - b.lo);
  });

  it('clamps an out of range k', () => {
    const w = F.wilsonInterval(60, 50);
    assert.equal(w.p, 1);
  });
});

describe('Expected calibration error', () => {
  it('returns zero on an empty input', () => {
    assert.equal(F.expectedCalibrationError([], 10).ece, 0);
  });

  it('returns zero on a perfectly calibrated set', () => {
    const cal = F.expectedCalibrationError(
      [
        { score: 0, truth: 0 },
        { score: 1, truth: 1 }
      ],
      10
    );
    assert.ok(cal.ece < 1e-9);
  });

  it('equals the gap on a single bucket of misses', () => {
    const cal = F.expectedCalibrationError(
      [
        { score: 0.9, truth: 0 },
        { score: 0.9, truth: 0 },
        { score: 0.9, truth: 1 }
      ],
      10
    );
    close(cal.ece, Math.abs(0.9 - 1 / 3));
  });

  it('stays inside [0, 1] on a deterministic random set', () => {
    const rnd = E.mulberry32(99);
    const pairs = [];
    for (let i = 0; i < 2000; i += 1) pairs.push({ score: rnd(), truth: rnd() < 0.4 ? 1 : 0 });
    const cal = F.expectedCalibrationError(pairs, 10);
    assert.ok(cal.ece >= 0 && cal.ece <= 1);
  });

  it('conserves the record count across bins', () => {
    const rnd = E.mulberry32(3);
    const pairs = [];
    for (let i = 0; i < 137; i += 1) pairs.push({ score: rnd(), truth: rnd() < 0.5 ? 1 : 0 });
    const cal = F.expectedCalibrationError(pairs, 10);
    const sum = cal.bins.reduce((acc, b) => acc + b.n, 0);
    assert.equal(sum, 137);
    assert.equal(cal.n, 137);
  });

  it('puts a score of exactly 1 in the last bin', () => {
    const cal = F.expectedCalibrationError([{ score: 1, truth: 1 }], 10);
    assert.equal(cal.bins[9].n, 1);
    assert.equal(cal.bins[9].frac, 1);
  });
});

describe('Synthetic Fitzpatrick cohort and audit', () => {
  const cohort = F.buildSyntheticCohort();

  it('builds sixty records for each of the six types', () => {
    assert.equal(cohort.length, 360);
    [1, 2, 3, 4, 5, 6].forEach((t) => {
      assert.equal(cohort.filter((r) => r.type === t).length, 60, 'type ' + t);
    });
  });

  it('gives every type the same positive base rate', () => {
    [1, 2, 3, 4, 5, 6].forEach((t) => {
      const pos = cohort.filter((r) => r.type === t && r.truth === 1).length;
      assert.equal(pos, Math.round(60 * 0.35), 'type ' + t);
    });
  });

  it('keeps scores inside the open unit interval', () => {
    cohort.forEach((r) => {
      assert.ok(r.score > 0 && r.score < 1, r.id);
      assert.ok(r.truth === 0 || r.truth === 1, r.id);
      assert.ok(r.type >= 1 && r.type <= 6, r.id);
    });
  });

  it('is deterministic for a fixed seed', () => {
    const a = F.buildSyntheticCohort({ seed: 42 });
    const b = F.buildSyntheticCohort({ seed: 42 });
    assert.deepEqual(
      a.map((r) => r.score),
      b.map((r) => r.score)
    );
  });

  it('changes with the seed', () => {
    const a = F.buildSyntheticCohort({ seed: 1 });
    const b = F.buildSyntheticCohort({ seed: 2 });
    assert.notDeepEqual(
      a.map((r) => r.score),
      b.map((r) => r.score)
    );
  });

  it('rejects a non positive or non integer perType', () => {
    assert.throws(() => F.buildSyntheticCohort({ perType: 0 }), RangeError);
    assert.throws(() => F.buildSyntheticCohort({ perType: 2.5 }), RangeError);
    assert.throws(() => F.buildSyntheticCohort({ perType: -4 }), RangeError);
  });

  it('conserves every record across the confusion cells', () => {
    const audit = F.auditFairness(cohort, 0.65);
    audit.perType.forEach((t) => {
      assert.equal(t.tp + t.fp + t.tn + t.fn, t.n, 'type ' + t.numeral);
    });
    const total = audit.perType.reduce((acc, t) => acc + t.n, 0);
    assert.equal(total, cohort.length);
  });

  it('finds the planted sensitivity gap at the default threshold', () => {
    const audit = F.auditFairness(cohort, 0.65);
    assert.ok(audit.sensGap > 0.1, 'gap ' + audit.sensGap);
    assert.ok(audit.groups.light.sensitivity > audit.groups.deep.sensitivity);
    assert.ok(audit.fnrGap > 0, 'deep group must show a higher miss rate');
  });

  it('computes exact metrics on a hand built record set', () => {
    const records = [
      { id: 'a', type: 1, truth: 1, score: 0.9 },
      { id: 'b', type: 1, truth: 1, score: 0.4 },
      { id: 'c', type: 1, truth: 0, score: 0.2 },
      { id: 'd', type: 6, truth: 1, score: 0.4 },
      { id: 'e', type: 6, truth: 1, score: 0.3 },
      { id: 'f', type: 6, truth: 0, score: 0.9 }
    ];
    const a = F.auditFairness(records, 0.6);
    const t1 = a.perType[0];
    const t6 = a.perType[5];
    close(t1.sensitivity, 0.5);
    close(t1.specificity, 1);
    close(t1.fnr, 0.5);
    close(t6.sensitivity, 0);
    close(t6.specificity, 0);
    close(t6.fnr, 1);
    close(a.sensGap, 0.5);
    close(a.fnrGap, 0.5);
  });

  it('flags every record when the threshold is zero', () => {
    const a = F.auditFairness(cohort, 0);
    a.perType.forEach((t) => {
      assert.equal(t.sensitivity, 1);
      assert.equal(t.specificity, 0);
    });
  });

  it('flags nothing above a threshold of one', () => {
    const a = F.auditFairness(cohort, 1);
    a.perType.forEach((t) => {
      assert.equal(t.sensitivity, 0);
      assert.equal(t.specificity, 1);
    });
  });

  it('clamps an out of range threshold', () => {
    const a = F.auditFairness(cohort, 1.7);
    assert.equal(a.threshold, 1);
    const b = F.auditFairness(cohort, -0.5);
    assert.equal(b.threshold, 0);
  });

  it('pools types I and II in the light group and V and VI in the deep group', () => {
    const a = F.auditFairness(cohort, 0.65);
    assert.deepEqual(a.groups.light.ids, [1, 2]);
    assert.deepEqual(a.groups.mid.ids, [3, 4]);
    assert.deepEqual(a.groups.deep.ids, [5, 6]);
    assert.equal(a.groups.light.n, 120);
    assert.equal(a.groups.deep.n, 120);
  });

  it('attaches a Wilson interval per type', () => {
    const a = F.auditFairness(cohort, 0.65);
    a.perType.forEach((t) => {
      assert.ok(t.wilson.lo <= t.sensitivity + 1e-12);
      assert.ok(t.wilson.hi >= t.sensitivity - 1e-12);
    });
  });

  it('rejects malformed records', () => {
    assert.throws(() => F.auditFairness([], 0.6), TypeError);
    assert.throws(() => F.auditFairness([{ type: 9, truth: 1, score: 0.5 }], 0.6), TypeError);
    assert.throws(() => F.auditFairness([{ type: 3, truth: 2, score: 0.5 }], 0.6), TypeError);
    assert.throws(() => F.auditFairness([{ type: 3, truth: 1, score: NaN }], 0.6), TypeError);
  });

  it('discloses the cohort as synthetic in its disclosure text', () => {
    assert.match(F.COHORT_DISCLOSURE, /synthetic/i);
    assert.match(F.COHORT_DISCLOSURE, /not a clinical study/i);
  });
});

describe('Photo readiness gate', () => {
  const specimen = () => {
    const spec = E.createSkinSpecimen({ width: 640, height: 800, lab: [66, 10, 23], shine: 0.5, erythema: 0.55, pigment: 0.3, pores: 0.6 });
    return { width: 640, height: 800, data: spec.data };
  };

  it('passes a real specimen once scale is confirmed', () => {
    const gate = F.imageQualityGate(specimen(), { scaleConfirmed: true });
    assert.equal(gate.verdict.id, 'ready');
    assert.equal(gate.passed, gate.total);
  });

  it('holds the scale check until the person confirms it', () => {
    const gate = F.imageQualityGate(specimen(), { scaleConfirmed: false });
    assert.equal(gate.verdict.id, 'retake');
    const scale = gate.checks.find((c) => c.id === 'scale');
    assert.equal(scale.pass, false);
    assert.equal(scale.attested, true);
    assert.match(gate.verdict.text, /ruler or coin/);
  });

  it('rejects a flat monochrome frame', () => {
    const flat = { width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4).fill(200) };
    for (let i = 3; i < flat.data.length; i += 4) flat.data[i] = 255;
    const gate = F.imageQualityGate(flat, { scaleConfirmed: true });
    assert.equal(gate.verdict.id, 'retake');
    assert.equal(gate.checks.find((c) => c.id === 'light').pass, false);
    assert.equal(gate.checks.find((c) => c.id === 'sharp').pass, false);
  });

  it('rejects an image below the size floor', () => {
    const spec = E.createSkinSpecimen({ width: 320, height: 400, lab: [60, 12, 20] });
    const gate = F.imageQualityGate({ width: 320, height: 400, data: spec.data }, { scaleConfirmed: true });
    assert.equal(gate.checks.find((c) => c.id === 'size').pass, false);
    assert.equal(gate.verdict.id, 'retake');
  });

  it('rejects a frame with little skin colour', () => {
    const img = { width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4) };
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 30 + (i % 60);
      img.data[i + 1] = 60;
      img.data[i + 2] = 90 + (i % 40);
      img.data[i + 3] = 255;
    }
    const gate = F.imageQualityGate(img, { scaleConfirmed: true });
    assert.equal(gate.checks.find((c) => c.id === 'frame').pass, false);
  });

  it('reports the underlying metrics', () => {
    const gate = F.imageQualityGate(specimen(), { scaleConfirmed: true });
    ['width', 'height', 'meanL', 'stdL', 'lapStd', 'skinShare'].forEach((k) => {
      assert.ok(Number.isFinite(gate.metrics[k]), k);
    });
    assert.ok(gate.metrics.skinShare > 0.5);
  });

  it('throws on malformed image objects', () => {
    assert.throws(() => F.imageQualityGate(null), TypeError);
    assert.throws(() => F.imageQualityGate({ width: 0, height: 10, data: new Uint8ClampedArray(400) }), TypeError);
    assert.throws(() => F.imageQualityGate({ width: 10, height: 10, data: new Uint8ClampedArray(40) }), TypeError);
  });

  it('throws on an image with no opaque pixels', () => {
    const img = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    assert.throws(() => F.imageQualityGate(img), RangeError);
  });
});

describe('Checksummed export and verification', () => {
  const bundle = () =>
    F.buildAuditBundle({
      created: '2026-12-04T00:00:00.000Z',
      abcde: F.abcdeScore({ A: 2, B: 1, C: 0, D: 2, E: 1 }),
      audit: F.auditFairness(F.buildSyntheticCohort(), 0.65),
      quality: null,
      tone: { lab: [66, 10, 23], ita: 34.8, band: 'Intermediate', undertone: 'Warm' }
    });

  it('puts the payload digest in the sha256 field', () => {
    const b = bundle();
    assert.equal(b.sha256, F.sha256Hex(F.canonicalJson(b.payload)));
    assert.match(b.sha256, /^[0-9a-f]{64}$/);
  });

  it('labels the digest honestly as unkeyed tamper checking', () => {
    assert.match(F.EXPORT_NOTE, /[Uu]nkeyed SHA-256/);
    assert.match(F.EXPORT_NOTE, /not a signature/i);
  });

  it('keeps the educational scope inside the payload', () => {
    const b = bundle();
    assert.match(b.payload.scope, /educational/i);
    assert.match(b.payload.scope, /medical judgement/i);
  });

  it('verifies an untouched export', () => {
    const r = F.verifyAuditJson(F.exportAuditJson(bundle()));
    assert.equal(r.ok, true);
    assert.equal(r.reason, 'match');
  });

  it('rejects a one character edit inside the payload', () => {
    const text = F.exportAuditJson(bundle());
    assert.ok(text.indexOf('"score": 40') !== -1, 'fixture score moved, update the tamper target');
    const tampered = text.replace('"score": 40', '"score": 99');
    const r = F.verifyAuditJson(tampered);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'changed');
  });

  it('rejects a swapped digest', () => {
    const text = F.exportAuditJson(bundle());
    const tampered = text.replace(/"sha256": "[0-9a-f]{64}"/, '"sha256": "' + '0'.repeat(64) + '"');
    const r = F.verifyAuditJson(tampered);
    assert.equal(r.ok, false);
  });

  it('ignores key order when verifying the payload', () => {
    const doc = JSON.parse(F.exportAuditJson(bundle()));
    const reordered = {};
    Object.keys(doc.payload)
      .reverse()
      .forEach((k) => {
        reordered[k] = doc.payload[k];
      });
    const rebuilt = { tool: doc.tool, version: doc.version, note: doc.note, sha256: doc.sha256, payload: reordered };
    assert.equal(F.verifyAuditJson(JSON.stringify(rebuilt)).ok, true);
  });

  it('rejects malformed exports with clear reasons', () => {
    assert.equal(F.verifyAuditJson('not json').reason, 'not-json');
    assert.equal(F.verifyAuditJson('[1,2]').reason, 'not-object');
    assert.equal(F.verifyAuditJson('{"payload":{}}').reason, 'no-digest');
    assert.equal(F.verifyAuditJson('{"sha256":"abc","payload":{}}').reason, 'no-digest');
    assert.equal(F.verifyAuditJson('{"sha256":"' + 'a'.repeat(64) + '"}').reason, 'no-payload');
  });

  it('keeps the CSV injection guard on formula cells', () => {
    ['=1+1', '+SUM(A1:A9)', '-2+3', '@cmd', '\t=x', ' =x'].forEach((bad) => {
      const cell = F.csvCell(bad);
      assert.ok(cell.charAt(0) === "'" || cell.charAt(0) === '"', 'unescaped ' + JSON.stringify(bad));
    });
    assert.equal(F.csvCell('plain text'), 'plain text');
    assert.equal(F.csvCell(-0.095), '-0.095');
    assert.equal(F.csvCell('a,b'), '"a,b"');
    assert.equal(F.csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(F.csvCell('a\nb'), '"a\nb"');
  });

  it('emits a parseable CSV with one row per section item', () => {
    const csv = F.exportAuditCsv(bundle());
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'section,item,value');
    assert.ok(lines.length >= 30);
    assert.ok(lines.some((l) => l === 'meta,sha256,' + bundle().sha256));
    assert.ok(lines.some((l) => /^abcde,E,1$/.test(l)));
  });

  it('includes the audit table and disclaimer in the markdown', () => {
    const md = F.exportAuditMarkdown(bundle());
    assert.match(md, /# DermaVTO workbench export/);
    assert.match(md, /\| Type \| n \| Sensitivity \|/);
    assert.match(md, /V-VI/);
    assert.match(md, /tamper-detection digest/);
    assert.match(md, /medical judgement/);
  });
});

describe('Canonical JSON', () => {
  it('sorts object keys recursively', () => {
    const a = F.canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    assert.equal(a, '{"a":{"c":3,"d":4},"b":1}');
  });

  it('keeps array order', () => {
    assert.equal(F.canonicalJson({ a: [3, 1, 2] }), '{"a":[3,1,2]}');
  });

  it('handles null, strings, numbers and nested structures', () => {
    assert.equal(F.canonicalJson(null), 'null');
    assert.equal(F.canonicalJson('x'), '"x"');
    assert.equal(F.canonicalJson(2.5), '2.5');
    assert.equal(F.canonicalJson([{ b: 2, a: 1 }]), '[{"a":1,"b":2}]');
  });
});

describe('derm bookmark codec', () => {
  it('round trips a full state', () => {
    const state = { a: 3, b: 0, c: 1, d: 2, e: 3, threshold: 55, scale: true };
    const h = F.formatDermHash(state);
    assert.equal(h, 'derm=v1,a3,b0,c1,d2,e3,t55,s1');
    const back = F.parseDermHash('#' + h);
    assert.deepEqual(back, state);
  });

  it('round trips the default state', () => {
    const state = { a: 0, b: 0, c: 0, d: 0, e: 0, threshold: 65, scale: false };
    const back = F.parseDermHash(F.formatDermHash(state));
    assert.deepEqual(back, state);
  });

  it('accepts a bare hash body or a leading #', () => {
    const h = 'derm=v1,a1,b1,c1,d1,e1,t65,s0';
    assert.ok(F.parseDermHash(h));
    assert.ok(F.parseDermHash('#' + h));
  });

  const BAD = [
    'derm=v1,a4,b0,c0,d0,e0,t50,s0',
    'derm=v1,a0,b0,c0,d0,e0,t0,s0',
    'derm=v1,a0,b0,c0,d0,e0,t100,s0',
    'derm=v1,a0,b0,c0,d0,e0,t50,s2',
    'derm=v2,a0,b0,c0,d0,e0,t50,s0',
    'derm=v1,a0,b0,c0,e0,t50,s0',
    'derm=v1,b0,a0,c0,d0,e0,t50,s0',
    'derm=v1,a0,b0,c0,d0,e0,t50,s0,x9',
    'dermx=v1,a0,b0,c0,d0,e0,t50,s0',
    'DERM=v1,a0,b0,c0,d0,e0,t50,s0',
    ' derm=v1,a0,b0,c0,d0,e0,t50,s0',
    'derm=v1,a0,b0,c0,d0,e0,t50,s0 ',
    'derm=v1,a0,b0,c0,d0,e0,t50,s0\n',
    '',
    'derm=',
    '#',
    '##derm=v1,a0,b0,c0,d0,e0,t50,s0',
    'derm=v1,a0,b0,c0,d0,e0,t50,s0#extra'
  ];
  BAD.forEach((bad) => {
    it('rejects ' + JSON.stringify(bad), () => {
      assert.equal(F.parseDermHash(bad), null);
    });
  });

  it('rejects non string input', () => {
    assert.equal(F.parseDermHash(null), null);
    assert.equal(F.parseDermHash(undefined), null);
    assert.equal(F.parseDermHash({}), null);
  });

  it('validates every field when formatting', () => {
    const good = { a: 0, b: 0, c: 0, d: 0, e: 0, threshold: 65, scale: false };
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { a: 4 })), RangeError);
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { e: -1 })), RangeError);
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { b: 1.5 })), RangeError);
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { threshold: 0 })), RangeError);
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { threshold: 100 })), RangeError);
    assert.throws(() => F.formatDermHash(Object.assign({}, good, { scale: 'yes' })), RangeError);
    assert.throws(() => F.formatDermHash(null), TypeError);
  });
});

describe('Fairness SVG chart', () => {
  const svg = F.renderFairnessSvg(F.auditFairness(F.buildSyntheticCohort(), 0.65));

  it('is an accessible labelled image', () => {
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-labelledby="fair-svg-title fair-svg-desc"/);
    assert.match(svg, /<title id="fair-svg-title">/);
    assert.match(svg, /<desc id="fair-svg-desc">/);
  });

  it('draws one bar and one whisker per Fitzpatrick type', () => {
    assert.equal((svg.match(/fair-bar/g) || []).length, 6);
    assert.equal((svg.match(/<line class="fair-ci/g) || []).length, 18);
  });

  it('marks types V and VI as the deep group', () => {
    assert.equal((svg.match(/fair-bar fair-deep/g) || []).length, 2);
  });

  it('labels the sensitivity gap and the ECE', () => {
    assert.match(svg, />gap /);
    assert.match(svg, /ECE /);
    assert.match(svg, /I-II /);
    assert.match(svg, /V-VI /);
  });

  it('draws calibration dots and the dashed ideal line', () => {
    assert.ok((svg.match(/fair-cal-dot/g) || []).length >= 5);
    assert.match(svg, /fair-cal-ideal/);
  });

  it('carries a tooltip on every bar', () => {
    assert.equal((svg.match(/<rect class="fair-bar/g) || []).length, 6);
    assert.equal((svg.match(/<title>Type/g) || []).length, 6);
  });

  it('throws without an audit result', () => {
    assert.throws(() => F.renderFairnessSvg(null), TypeError);
    assert.throws(() => F.renderFairnessSvg({}), TypeError);
  });
});

describe('In page self tests', () => {
  const results = F.runSelfTests();

  it('runs at least fifteen checks', () => {
    assert.ok(results.length >= 15, results.length + ' checks');
  });

  it('passes every check', () => {
    const failed = results.filter((r) => !r.ok);
    assert.deepEqual(failed, []);
  });

  it('reports a name and a detail line for each check', () => {
    results.forEach((r) => {
      assert.ok(typeof r.name === 'string' && r.name.length > 3);
      assert.ok(typeof r.detail === 'string' && r.detail.length > 0);
      assert.equal(typeof r.ok, 'boolean');
    });
  });

  it('covers each advertised invariant', () => {
    const names = results.map((r) => r.name).join(' | ');
    ['SHA-256', 'non-decreasing', 'Evolution', 'Wilson', 'ECE', 'partition', 'CSV', 'digest', 'Bookmark', 'sensitivity gap'].forEach((needle) => {
      assert.ok(names.includes(needle), 'missing a self test for ' + needle);
    });
  });
});

describe('Lab page wiring pins', () => {
  const html = read('index.html');

  it('loads fairness-lab.js before app.js', () => {
    const a = html.indexOf('src="fairness-lab.js"');
    const b = html.indexOf('src="app.js"');
    assert.ok(a !== -1 && b !== -1 && a < b);
  });

  it('keeps the ABCDE option labels in step with the engine', () => {
    F.ABCDE.forEach((def) => {
      def.levels.forEach((level) => {
        assert.ok(html.includes('<span>' + level + '</span>'), 'missing option: ' + level);
      });
    });
  });

  it('has all twenty ABCDE radios inside labels', () => {
    const radios = html.match(/<input type="radio" name="abcde-[A-E]" value="[0-3]"( checked)?>/g) || [];
    assert.equal(radios.length, 20);
    ['A', 'B', 'C', 'D', 'E'].forEach((letter) => {
      assert.ok(html.includes('name="abcde-' + letter + '"'));
    });
  });

  it('keeps the fairness disclosure in the page', () => {
    assert.match(html, /synthetic/i);
    assert.match(html, /not a clinical study/i);
  });

  it('makes no network calls in the new lab module', () => {
    const src = read('fairness-lab.js');
    ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'import('].forEach((needle) => {
      assert.equal(src.includes(needle), false, needle);
    });
  });

  it('makes no network calls in the app wiring either', () => {
    const src = read('app.js');
    ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource'].forEach((needle) => {
      assert.equal(src.includes(needle), false, needle);
    });
  });

  it('stores nothing in local or session storage', () => {
    const src = read('app.js') + read('fairness-lab.js');
    assert.equal(src.includes('localStorage'), false);
    assert.equal(src.includes('sessionStorage'), false);
  });
});
