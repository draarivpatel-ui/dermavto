/*
 * DermaVTO screening literacy and fairness workbench
 * Pure functions for the lab section: an ABCDE checklist score, a Fitzpatrick
 * I to VI fairness audit over a disclosed synthetic cohort, a photo readiness
 * gate, a visit prep builder, SHA-256 checksummed exports, #derm= bookmarks
 * and the in page self tests. UMD: window.DermaFairness in the browser, a
 * CommonJS module in Node.
 *
 * Everything here is educational. The ABCDE score is a checklist count, the
 * audit runs on synthetic records, and none of it is a medical judgement or
 * a clinical assessment of anyone's skin.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else {
    root.DermaFairness = factory(root.DermaVTO);
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const LAB_VERSION = '1.0.0';
  const DEG = 180 / Math.PI;

  function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
  }

  function fin(v, fallback) {
    return Number.isFinite(v) ? v : (fallback === undefined ? 0 : fallback);
  }

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
    return Number(v.toFixed(3)).toString();
  }

  /* ------------------------------------------------------------------ */
  /* SHA-256, FIPS 180-4, in plain JavaScript                             */
  /* ------------------------------------------------------------------ */

  const SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  const SHA256_H0 = Object.freeze([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);

  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  /** UTF-8 encode a JS string to a byte array. Lone surrogates encode as U+FFFD. */
  function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        if (i + 1 < s.length) {
          const d = s.charCodeAt(i + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
            i += 1;
          } else {
            c = 0xfffd;
          }
        } else {
          c = 0xfffd;
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        c = 0xfffd;
      }
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  /** SHA-256 over a byte array. Returns eight 32 bit words. */
  function sha256Bytes(bytes) {
    const len = bytes.length;
    const bitLen = len * 8;
    const padded = new Array(len + 9 + ((64 - ((len + 9) % 64)) % 64));
    for (let i = 0; i < len; i += 1) padded[i] = bytes[i] & 0xff;
    padded[len] = 0x80;
    for (let i = len + 1; i < padded.length; i += 1) padded[i] = 0;
    const hiLen = Math.floor(bitLen / 0x100000000);
    const loLen = bitLen >>> 0;
    const n = padded.length;
    padded[n - 8] = (hiLen >>> 24) & 0xff;
    padded[n - 7] = (hiLen >>> 16) & 0xff;
    padded[n - 6] = (hiLen >>> 8) & 0xff;
    padded[n - 5] = hiLen & 0xff;
    padded[n - 4] = (loLen >>> 24) & 0xff;
    padded[n - 3] = (loLen >>> 16) & 0xff;
    padded[n - 2] = (loLen >>> 8) & 0xff;
    padded[n - 1] = loLen & 0xff;

    let h0 = SHA256_H0[0];
    let h1 = SHA256_H0[1];
    let h2 = SHA256_H0[2];
    let h3 = SHA256_H0[3];
    let h4 = SHA256_H0[4];
    let h5 = SHA256_H0[5];
    let h6 = SHA256_H0[6];
    let h7 = SHA256_H0[7];
    const w = new Array(64);
    for (let off = 0; off < n; off += 64) {
      for (let t = 0; t < 16; t += 1) {
        w[t] = (
          (padded[off + 4 * t] << 24) |
          (padded[off + 4 * t + 1] << 16) |
          (padded[off + 4 * t + 2] << 8) |
          padded[off + 4 * t + 3]
        ) >>> 0;
      }
      for (let t = 16; t < 64; t += 1) {
        const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let hh = h7;
      for (let t = 0; t < 64; t += 1) {
        const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
        const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (s0 + maj) >>> 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + hh) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7];
  }

  /** SHA-256 hex digest of a string (UTF-8) or a byte array. */
  function sha256Hex(input) {
    const bytes = typeof input === 'string' ? utf8Bytes(input) : input;
    const words = sha256Bytes(bytes);
    let hex = '';
    for (let i = 0; i < 8; i += 1) {
      hex += ('00000000' + words[i].toString(16)).slice(-8);
    }
    return hex;
  }

  /* ------------------------------------------------------------------ */
  /* ABCDE structured checklist                                           */
  /* ------------------------------------------------------------------ */

  /*
   * The ABCDE checklist is public skin cancer education (Asymmetry, Border,
   * Colour, Diameter at or over 6 mm, Evolution). It helps a person decide
   * when to book a dermatologist. Each answer is a grade from 0 (no sign)
   * to 3 (strong sign). Evolution carries the most weight because change
   * over time is the warning sign public guidance stresses hardest.
   * The score is a count of checklist answers, never a medical judgement.
   */
  const ABCDE = Object.freeze([
    Object.freeze({
      letter: 'A',
      name: 'Asymmetry',
      weight: 1,
      levels: Object.freeze([
        'Both halves look alike',
        'A little uneven',
        'Clearly lopsided',
        'Very uneven or one half much darker'
      ])
    }),
    Object.freeze({
      letter: 'B',
      name: 'Border',
      weight: 1,
      levels: Object.freeze([
        'Edge is smooth and even',
        'A little uneven',
        'Notched, scalloped or blurred',
        'Ragged, blurred or spreading'
      ])
    }),
    Object.freeze({
      letter: 'C',
      name: 'Colour',
      weight: 1,
      levels: Object.freeze([
        'One even colour',
        'Two shades',
        'Three or more colours',
        'Many colours, or black, blue or red areas'
      ])
    }),
    Object.freeze({
      letter: 'D',
      name: 'Diameter',
      weight: 1.25,
      levels: Object.freeze([
        'Under 6 mm across',
        'About 6 mm across',
        'Clearly over 6 mm',
        'Well over 6 mm or still growing'
      ])
    }),
    Object.freeze({
      letter: 'E',
      name: 'Evolution',
      weight: 2,
      levels: Object.freeze([
        'No change over months',
        'Slow change over months',
        'Fast change in size, shape or colour',
        'Bleeds, itches, crusts or hurts'
      ])
    })
  ]);

  const ABCDE_BANDS = Object.freeze([
    Object.freeze({ id: 'few', max: 20, label: 'Few checklist signs', note: 'No strong checklist pattern in these answers. Keep monthly self checks and recheck if anything changes.' }),
    Object.freeze({ id: 'some', max: 45, label: 'Some checklist signs', note: 'Some checklist signs. Photograph the spot beside a ruler each month and book a visit if it keeps changing.' }),
    Object.freeze({ id: 'several', max: 70, label: 'Several checklist signs', note: 'Several checklist signs. Booking a dermatology visit is the reasonable next step.' }),
    Object.freeze({ id: 'strong', max: Infinity, label: 'Strong checklist pattern', note: 'A strong checklist pattern. A prompt dermatology review is the reasonable next step. This checklist cannot say what the spot is.' })
  ]);

  function abcdeBand(total) {
    for (let i = 0; i < ABCDE_BANDS.length; i += 1) {
      if (total < ABCDE_BANDS[i].max) return ABCDE_BANDS[i];
    }
    return ABCDE_BANDS[ABCDE_BANDS.length - 1];
  }

  function gradeFor(def, value) {
    if (value === undefined || value === null) return null;
    const g = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!Number.isInteger(g) || g < 0 || g >= def.levels.length) {
      throw new RangeError('ABCDE grade for ' + def.letter + ' must be an integer from 0 to ' + (def.levels.length - 1));
    }
    return g;
  }

  /**
   * Score a set of ABCDE answers. Input is {A, B, C, D, E} grades 0..3, or a
   * five element array in the same order. Unanswered letters count as grade
   * null and add no points; the result reports how many were answered.
   */
  function abcdeScore(input) {
    const answers = Array.isArray(input)
      ? { A: input[0], B: input[1], C: input[2], D: input[3], E: input[4] }
      : (input || {});
    const letters = {};
    let raw = 0;
    let maxRaw = 0;
    let answered = 0;
    ABCDE.forEach(function (def) {
      maxRaw += def.weight;
      const grade = gradeFor(def, answers[def.letter]);
      if (grade === null) {
        letters[def.letter] = { grade: null, points: 0, label: 'not answered' };
        return;
      }
      answered += 1;
      const points = (grade / (def.levels.length - 1)) * def.weight;
      raw += points;
      letters[def.letter] = { grade: grade, points: points, label: def.levels[grade] };
    });
    const total = maxRaw > 0 ? (raw / maxRaw) * 100 : 0;
    const band = abcdeBand(total);
    return {
      letters: letters,
      total: total,
      raw: raw,
      maxRaw: maxRaw,
      answered: answered,
      complete: answered === ABCDE.length,
      band: { id: band.id, label: band.label },
      note: band.note
    };
  }

  /* ------------------------------------------------------------------ */
  /* Referral urgency and visit preparation                               */
  /* ------------------------------------------------------------------ */

  const URGENCY_TIERS = Object.freeze([
    Object.freeze({ id: 'routine', label: 'Keep monthly self checks', note: 'Nothing on the checklist today. Keep monthly self checks, and book a visit any time a spot worries you.' }),
    Object.freeze({ id: 'watch', label: 'Photograph it monthly', note: 'A few checklist signs. Photograph the spot beside a ruler each month and recheck the checklist.' }),
    Object.freeze({ id: 'book', label: 'Book a dermatology visit', note: 'Several checklist signs, or change you can see. Booking a dermatology visit is the reasonable next step.' }),
    Object.freeze({ id: 'prompt', label: 'Seek a prompt dermatology review', note: 'A strong checklist pattern, fast change, or new symptoms like bleeding. Seek a prompt dermatology review.' })
  ]);

  /**
   * Map an abcdeScore result to a referral urgency tier. Fast evolution or
   * new symptoms (E grade 2 or 3) lift the tier on their own, which is how
   * the public checklist is meant to be read.
   */
  function referralUrgency(result) {
    if (!result || !result.letters || !Number.isFinite(result.total)) {
      throw new TypeError('referralUrgency needs an abcdeScore result');
    }
    const e = result.letters.E && result.letters.E.grade !== null ? result.letters.E.grade : 0;
    const t = result.total;
    let idx = 0;
    if (t > 0 || e >= 1) idx = 1;
    if (t >= 45 || e === 2) idx = 2;
    if (t >= 70 || e >= 3) idx = 3;
    const tier = URGENCY_TIERS[idx];
    return { id: tier.id, index: idx, label: tier.label, note: tier.note };
  }

  const PREP_BASE = Object.freeze([
    'Photograph the spot beside a ruler or a coin in daylight, so the dermatologist can see its size.',
    'Write down when you first noticed it and everything that changed since.',
    'List symptoms such as itching, bleeding, pain or tenderness, or write that there are none.',
    'Bring your medicine list and any personal or family history of skin cancer.',
    'Note where on the body it is and how long it has been there.',
    'Prepare a question for the dermatologist, such as what change should make you come back sooner.'
  ]);

  /** Non-diagnostic preparation checklist for a dermatology visit. */
  function visitPrepItems(result) {
    if (!result || !result.letters) throw new TypeError('visitPrepItems needs an abcdeScore result');
    const items = PREP_BASE.slice();
    const e = result.letters.E && result.letters.E.grade;
    if (e !== null && e >= 2) {
      items.unshift('Write down when the change started and how fast it moved.');
    }
    const d = result.letters.D && result.letters.D.grade;
    if (d !== null && d >= 1) {
      items.push('Measure the spot in millimetres against a ruler before the visit.');
    }
    return items;
  }

  /** The full visit prep block: urgency tier plus checklist lines. */
  function visitPrepBrief(result) {
    const urgency = referralUrgency(result);
    const items = visitPrepItems(result);
    const lines = [urgency.label + '. ' + urgency.note, ''].concat(
      items.map(function (item, i) {
        return (i + 1) + '. ' + item;
      })
    );
    return { urgency: urgency, items: items, text: lines.join('\n') };
  }

  /* ------------------------------------------------------------------ */
  /* Wilson score interval and expected calibration error                 */
  /* ------------------------------------------------------------------ */

  /**
   * Wilson 95% score interval for k successes in n trials. With n = 0 the
   * estimate is not estimable, so the widest possible interval is returned
   * and the caller can check wilson.n.
   */
  function wilsonInterval(k, n, z) {
    const zz = Number.isFinite(z) && z > 0 ? z : 1.959963984540054;
    if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0) {
      return { p: 0, lo: 0, hi: 1, k: 0, n: 0 };
    }
    const kk = clamp(k, 0, n);
    const p = kk / n;
    const z2 = zz * zz;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (zz / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { p: p, lo: clamp(center - half, 0, 1), hi: clamp(center + half, 0, 1), k: kk, n: n };
  }

  /**
   * Expected calibration error over {score, truth} pairs, binned by score.
   * Returns { ece, bins }, where bins reports n, meanScore, observed positive
   * share and the gap for each non-empty bin. ECE always lies in [0, 1].
   */
  function expectedCalibrationError(pairs, binCount) {
    const bins = Number.isInteger(binCount) && binCount > 0 ? binCount : 10;
    const list = Array.isArray(pairs) ? pairs : [];
    const n = list.length;
    const acc = [];
    for (let i = 0; i < bins; i += 1) acc.push({ n: 0, scoreSum: 0, posSum: 0 });
    list.forEach(function (pair) {
      const s = clamp(fin(pair && pair.score), 0, 1);
      const b = Math.min(bins - 1, Math.floor(s * bins));
      acc[b].n += 1;
      acc[b].scoreSum += s;
      acc[b].posSum += pair && pair.truth ? 1 : 0;
    });
    let ece = 0;
    const out = acc.map(function (b) {
      if (b.n === 0) return { n: 0, meanScore: null, frac: null, gap: 0 };
      const meanScore = b.scoreSum / b.n;
      const frac = b.posSum / b.n;
      const gap = Math.abs(meanScore - frac);
      ece += gap * (b.n / n);
      return { n: b.n, meanScore: meanScore, frac: frac, gap: gap };
    });
    return { ece: n > 0 ? ece : 0, bins: out, n: n };
  }

  /* ------------------------------------------------------------------ */
  /* Synthetic Fitzpatrick I to VI cohort and the fairness audit          */
  /* ------------------------------------------------------------------ */

  const FITZ_TYPES = Object.freeze([
    Object.freeze({ id: 1, numeral: 'I', name: 'Type I' }),
    Object.freeze({ id: 2, numeral: 'II', name: 'Type II' }),
    Object.freeze({ id: 3, numeral: 'III', name: 'Type III' }),
    Object.freeze({ id: 4, numeral: 'IV', name: 'Type IV' }),
    Object.freeze({ id: 5, numeral: 'V', name: 'Type V' }),
    Object.freeze({ id: 6, numeral: 'VI', name: 'Type VI' })
  ]);

  /*
   * The cohort is synthetic and disclosed as such. A seeded generator writes
   * records whose planted assessor separates positive from negative cases
   * less cleanly on types V and VI, modelling a fairness concern published
   * about visual lesion checklists. Same base rate on every type, so any
   * gap the audit finds comes from the planted assessor, not prevalence.
   * It demonstrates the audit method. It is not a clinical study and says
   * nothing about any real product.
   */
  const COHORT_SEED = 20261204;
  const COHORT_PER_TYPE = 60;
  const COHORT_PREVALENCE = 0.35;
  const COHORT_SEPARATION = Object.freeze({ 1: 0.62, 2: 0.62, 3: 0.55, 4: 0.5, 5: 0.36, 6: 0.3 });
  const COHORT_DISCLOSURE =
    'Synthetic teaching cohort generated in this page from seed ' + COHORT_SEED +
    '. The generator is deliberately weaker on types V and VI to model a fairness concern published about ' +
    'visual lesion checklists. It demonstrates the audit method. It is not a clinical study and says nothing ' +
    'about any real product.';

  function buildSyntheticCohort(options) {
    const o = Object.assign({ seed: COHORT_SEED, perType: COHORT_PER_TYPE }, options);
    if (!Number.isInteger(o.perType) || o.perType <= 0 || o.perType > 100000) {
      throw new RangeError('perType must be an integer from 1 to 100000');
    }
    const rnd = E.mulberry32((o.seed | 0) >>> 0);
    const records = [];
    FITZ_TYPES.forEach(function (type) {
      const sep = COHORT_SEPARATION[type.id];
      const positives = Math.round(o.perType * COHORT_PREVALENCE);
      for (let i = 0; i < o.perType; i += 1) {
        // Exactly `positives` true cases per type, spread evenly through the
        // list, so the base rate is identical on every skin type by design.
        const truth = Math.floor(((i + 1) * positives) / o.perType) > Math.floor((i * positives) / o.perType) ? 1 : 0;
        const center = truth ? 0.5 + sep * 0.5 : 0.5 - sep * 0.45;
        let score = center + (rnd() + rnd() + rnd() - 1.5) * 0.26;
        score = clamp(score, 0.005, 0.995);
        records.push({
          id: 'F' + type.id + '-' + ('000' + (i + 1)).slice(-3),
          type: type.id,
          truth: truth,
          score: score
        });
      }
    });
    return Object.freeze(records);
  }

  function checkRecords(records) {
    records.forEach(function (r) {
      if (
        !r || !Number.isInteger(r.type) || r.type < 1 || r.type > 6 ||
        (r.truth !== 0 && r.truth !== 1) || !Number.isFinite(r.score) || r.score < 0 || r.score > 1
      ) {
        throw new TypeError('each record needs type 1..6, truth 0 or 1 and a score from 0 to 1');
      }
    });
  }

  function groupStats(records, ids, t) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    records.forEach(function (r) {
      if (ids.indexOf(r.type) === -1) return;
      const flag = r.score >= t;
      if (r.truth === 1 && flag) tp += 1;
      else if (r.truth === 1) fn += 1;
      else if (flag) fp += 1;
      else tn += 1;
    });
    const positives = tp + fn;
    const negatives = tn + fp;
    return {
      ids: ids.slice(),
      n: tp + fp + tn + fn,
      tp: tp,
      fp: fp,
      tn: tn,
      fn: fn,
      sensitivity: positives > 0 ? tp / positives : 0,
      specificity: negatives > 0 ? tn / negatives : 0,
      fnr: positives > 0 ? fn / positives : 0,
      wilson: wilsonInterval(tp, positives)
    };
  }

  /**
   * Audit a cohort of {type, truth, score} records at one referral threshold.
   * Reports per-type counts, sensitivity, specificity, FNR and Wilson 95%
   * intervals, pooled I-II / III-IV / V-VI groups, the skin-tone sensitivity
   * and FNR gaps (I-II minus V-VI), overall accuracy and ECE.
   */
  function auditFairness(records, threshold) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new TypeError('auditFairness needs a non-empty records array');
    }
    checkRecords(records);
    const t = clamp(fin(threshold, 0.6), 0, 1);
    const perType = FITZ_TYPES.map(function (type) {
      const stats = groupStats(records, [type.id], t);
      stats.type = type.id;
      stats.numeral = type.numeral;
      return stats;
    });
    const groups = {
      light: groupStats(records, [1, 2], t),
      mid: groupStats(records, [3, 4], t),
      deep: groupStats(records, [5, 6], t)
    };
    const all = groupStats(records, [1, 2, 3, 4, 5, 6], t);
    const accuracy = all.n > 0 ? (all.tp + all.tn) / all.n : 0;
    const calibration = expectedCalibrationError(records, 10);
    return {
      records: records,
      threshold: t,
      n: records.length,
      perType: perType,
      groups: groups,
      all: all,
      accuracy: accuracy,
      sensGap: groups.light.sensitivity - groups.deep.sensitivity,
      fnrGap: groups.deep.fnr - groups.light.fnr,
      ece: calibration.ece,
      calibration: calibration
    };
  }

  /* ------------------------------------------------------------------ */
  /* Photo readiness gate for a telederm visit                            */
  /* ------------------------------------------------------------------ */

  /*
   * Deterministic photo checks: enough pixels, even and adequate light, a
   * sharpness proxy from the Laplacian of L*, and how much of the frame is
   * skin coloured. A scale reference cannot be verified from pixels, so the
   * gate records the person's confirmation instead. These checks judge the
   * photo, never what the photo shows.
   */
  const GATE_DEFAULTS = Object.freeze({
    minSide: 480,
    meanLRange: Object.freeze([18, 92]),
    stdLRange: Object.freeze([2, 32]),
    minLapStd: 0.7,
    minSkinShare: 0.2
  });

  function checkImageArg(image) {
    if (
      !image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width <= 0 || image.height <= 0 || !image.data ||
      typeof image.data.length !== 'number' || image.data.length < image.width * image.height * 4
    ) {
      throw new TypeError('image must be { width, height, data } with positive integer size and full RGBA data');
    }
  }

  function imageQualityGate(image, options) {
    checkImageArg(image);
    const o = Object.assign({ scaleConfirmed: false }, options);
    const w = image.width;
    const h = image.height;
    const n = w * h;
    const Ls = new Float32Array(n);
    const opaque = new Uint8Array(n);
    let count = 0;
    let sumL = 0;
    let sumL2 = 0;
    let skin = 0;
    for (let i = 0; i < n; i += 1) {
      const p = i * 4;
      if (!(image.data[p + 3] >= 128)) continue;
      const r = image.data[p] & 0xff;
      const g = image.data[p + 1] & 0xff;
      const b = image.data[p + 2] & 0xff;
      const lab = E.srgbToLab(r, g, b);
      Ls[i] = lab[0];
      opaque[i] = 1;
      count += 1;
      sumL += lab[0];
      sumL2 += lab[0] * lab[0];
      if (E.skinMaskAlpha(r, g, b) >= 0.5) skin += 1;
    }
    if (count === 0) throw new RangeError('image has no opaque pixels');

    const meanL = sumL / count;
    const varL = Math.max(0, sumL2 / count - meanL * meanL);
    const stdL = Math.sqrt(varL);
    const skinShare = skin / count;

    let lapSum = 0;
    let lapSq = 0;
    let lapN = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!opaque[i] || !opaque[i - 1] || !opaque[i + 1] || !opaque[i - w] || !opaque[i + w]) continue;
        const lap = Ls[i - w] + Ls[i + w] + Ls[i - 1] + Ls[i + 1] - 4 * Ls[i];
        lapSum += lap;
        lapSq += lap * lap;
        lapN += 1;
      }
    }
    const lapMean = lapN > 0 ? lapSum / lapN : 0;
    const lapStd = lapN > 0 ? Math.sqrt(Math.max(0, lapSq / lapN - lapMean * lapMean)) : 0;

    const checks = [
      {
        id: 'size',
        name: 'Enough pixels',
        value: w + ' x ' + h + ', short side ' + Math.min(w, h) + ' px',
        target: 'short side at least ' + GATE_DEFAULTS.minSide + ' px',
        pass: Math.min(w, h) >= GATE_DEFAULTS.minSide
      },
      {
        id: 'light',
        name: 'Even, adequate light',
        value: 'mean L* ' + num(meanL, 1) + ', spread ' + num(stdL, 1),
        target: 'mean ' + GATE_DEFAULTS.meanLRange[0] + ' to ' + GATE_DEFAULTS.meanLRange[1] + ', spread ' + GATE_DEFAULTS.stdLRange[0] + ' to ' + GATE_DEFAULTS.stdLRange[1],
        pass: meanL >= GATE_DEFAULTS.meanLRange[0] && meanL <= GATE_DEFAULTS.meanLRange[1] && stdL >= GATE_DEFAULTS.stdLRange[0] && stdL <= GATE_DEFAULTS.stdLRange[1]
      },
      {
        id: 'sharp',
        name: 'Sharp enough to read texture',
        value: 'edge spread ' + num(lapStd, 2),
        target: 'edge spread at least ' + GATE_DEFAULTS.minLapStd,
        pass: lapStd >= GATE_DEFAULTS.minLapStd
      },
      {
        id: 'frame',
        name: 'Skin fills enough of the frame',
        value: num(skinShare * 100, 0) + '% of the frame',
        target: 'at least ' + num(GATE_DEFAULTS.minSkinShare * 100, 0) + '%',
        pass: skinShare >= GATE_DEFAULTS.minSkinShare
      },
      {
        id: 'scale',
        name: 'Scale reference in frame',
        value: o.scaleConfirmed === true ? 'confirmed by you' : 'not confirmed',
        target: 'a ruler, tape or coin beside the spot',
        pass: o.scaleConfirmed === true,
        attested: true
      }
    ];
    const failed = checks.filter(function (c) {
      return !c.pass;
    });
    const ready = failed.length === 0;
    return {
      checks: checks,
      passed: checks.length - failed.length,
      total: checks.length,
      metrics: { width: w, height: h, meanL: meanL, stdL: stdL, lapStd: lapStd, skinShare: skinShare },
      verdict: ready
        ? { id: 'ready', text: 'Ready to send. The photo is bright, sharp and shows scale.' }
        : {
            id: 'retake',
            text:
              'Retake the photo. Fix ' +
              failed
                .map(function (c) {
                  return c.id === 'scale' ? 'scale (add a ruler or coin)' : c.name.toLowerCase();
                })
                .join(', ') +
              '.'
          },
      note: 'These checks judge the photo, never what the photo shows. The scale line records your confirmation because a reference object cannot be verified from pixels.'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Checksummed export and verification                                  */
  /* ------------------------------------------------------------------ */

  /** Deterministic JSON with sorted keys, used as the digest input. */
  function canonicalJson(v, seen) {
    if (v === null || typeof v !== 'object') {
      const s = JSON.stringify(v === undefined ? null : v);
      return s === undefined ? 'null' : s;
    }
    const stack = seen || [];
    if (stack.indexOf(v) !== -1) throw new TypeError('cyclic structure cannot be canonicalized');
    stack.push(v);
    let out;
    if (Array.isArray(v)) {
      out = '[' + v.map(function (x) { return canonicalJson(x, stack); }).join(',') + ']';
    } else {
      const keys = Object.keys(v).sort();
      out = '{' + keys.map(function (k) {
        return JSON.stringify(k) + ':' + canonicalJson(v[k], stack);
      }).join(',') + '}';
    }
    stack.pop();
    return out;
  }

  const EXPORT_NOTE =
    'Unkeyed SHA-256 tamper-detection digest over the payload. It shows whether the text changed after export. It is not a signature and says nothing about who wrote it.';
  const EXPORT_DISCLAIMER =
    'Educational screening literacy workbench output. The ABCDE score is a checklist count, the fairness audit runs on disclosed synthetic records, and the photo gate judges the photo only. None of this is a medical judgement, a clinical trial result, or a reason to skip a dermatologist.';

  function summarizeAudit(audit) {
    if (!audit) return null;
    return {
      threshold: audit.threshold,
      n: audit.n,
      cohort: 'synthetic teaching cohort, seed ' + COHORT_SEED,
      perType: audit.perType.map(function (s) {
        return {
          type: s.numeral,
          n: s.n,
          sensitivity: s.sensitivity,
          specificity: s.specificity,
          fnr: s.fnr,
          wilson95: [s.wilson.lo, s.wilson.hi]
        };
      }),
      pooled: {
        'I-II': { sensitivity: audit.groups.light.sensitivity, n: audit.groups.light.n },
        'III-IV': { sensitivity: audit.groups.mid.sensitivity, n: audit.groups.mid.n },
        'V-VI': { sensitivity: audit.groups.deep.sensitivity, n: audit.groups.deep.n }
      },
      sensitivityGap_I_II_minus_V_VI: audit.sensGap,
      fnrGap_V_VI_minus_I_II: audit.fnrGap,
      ece: audit.ece,
      accuracy: audit.accuracy
    };
  }

  /**
   * Build the export document. The digest covers canonicalJson(payload), so
   * reformatting the file cannot hide an edit and reordering keys cannot
   * fake a match.
   */
  function buildAuditBundle(input) {
    const src = input || {};
    const payload = {
      created: typeof src.created === 'string' ? src.created : 'in-browser session',
      abcde: src.abcde
        ? {
            answers: {
              A: src.abcde.letters.A.grade,
              B: src.abcde.letters.B.grade,
              C: src.abcde.letters.C.grade,
              D: src.abcde.letters.D.grade,
              E: src.abcde.letters.E.grade
            },
            score: Math.round(src.abcde.total * 10) / 10,
            band: src.abcde.band.label,
            referral: referralUrgency(src.abcde).label
          }
        : null,
      fairnessAudit: summarizeAudit(src.audit),
      photoGate: src.quality
        ? {
            verdict: src.quality.verdict.id,
            passed: src.quality.passed,
            total: src.quality.total,
            checks: src.quality.checks.map(function (c) {
              return { id: c.id, pass: c.pass, value: c.value };
            })
          }
        : null,
      sampleTone: src.tone || null,
      scope: EXPORT_DISCLAIMER
    };
    return {
      tool: 'dermavto-workbench-export',
      version: 1,
      note: EXPORT_NOTE,
      sha256: sha256Hex(canonicalJson(payload)),
      payload: payload
    };
  }

  function exportAuditJson(bundle) {
    return JSON.stringify(bundle, null, 2) + '\n';
  }

  /** CSV cell escaping: quotes doubled, and formula-leading cells prefixed with a quote mark. */
  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+@\t ]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s))) {
      s = "'" + s;
    }
    if (/[",\n\r']/.test(s) || s !== s.trim()) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportAuditCsv(bundle) {
    const p = bundle.payload;
    const rows = [['section', 'item', 'value']];
    rows.push(['meta', 'tool', bundle.tool]);
    rows.push(['meta', 'version', bundle.version]);
    rows.push(['meta', 'created', p.created]);
    rows.push(['meta', 'sha256', bundle.sha256]);
    if (p.abcde) {
      ['A', 'B', 'C', 'D', 'E'].forEach(function (l) {
        rows.push(['abcde', l, p.abcde.answers[l]]);
      });
      rows.push(['abcde', 'score', p.abcde.score]);
      rows.push(['abcde', 'band', p.abcde.band]);
      rows.push(['abcde', 'referral', p.abcde.referral]);
    }
    if (p.fairnessAudit) {
      rows.push(['fairness', 'threshold', p.fairnessAudit.threshold]);
      p.fairnessAudit.perType.forEach(function (t) {
        rows.push(['fairness', 'type ' + t.type + ' sensitivity', t.sensitivity]);
        rows.push(['fairness', 'type ' + t.type + ' wilson95', t.wilson95[0] + ' to ' + t.wilson95[1]]);
        rows.push(['fairness', 'type ' + t.type + ' fnr', t.fnr]);
      });
      rows.push(['fairness', 'sensitivity gap I-II minus V-VI', p.fairnessAudit.sensitivityGap_I_II_minus_V_VI]);
      rows.push(['fairness', 'fnr gap V-VI minus I-II', p.fairnessAudit.fnrGap_V_VI_minus_I_II]);
      rows.push(['fairness', 'ece', p.fairnessAudit.ece]);
    }
    if (p.photoGate) {
      p.photoGate.checks.forEach(function (c) {
        rows.push(['photo', c.id, c.pass ? 'pass' : 'check']);
      });
      rows.push(['photo', 'verdict', p.photoGate.verdict]);
    }
    if (p.sampleTone && Array.isArray(p.sampleTone.lab)) {
      rows.push(['tone', 'L*', p.sampleTone.lab[0]]);
      rows.push(['tone', 'a*', p.sampleTone.lab[1]]);
      rows.push(['tone', 'b*', p.sampleTone.lab[2]]);
      rows.push(['tone', 'ITA', p.sampleTone.ita]);
      rows.push(['tone', 'band', p.sampleTone.band]);
    }
    rows.push(['meta', 'scope', EXPORT_DISCLAIMER]);
    return (
      rows
        .map(function (row) {
          return row.map(csvCell).join(',');
        })
        .join('\n') + '\n'
    );
  }

  function exportAuditMarkdown(bundle) {
    const p = bundle.payload;
    const lines = [];
    lines.push('# DermaVTO workbench export');
    lines.push('');
    lines.push('Created ' + p.created + '. ' + EXPORT_NOTE);
    lines.push('');
    lines.push('SHA-256 `' + bundle.sha256 + '`');
    lines.push('');
    if (p.abcde) {
      lines.push('## ABCDE checklist');
      lines.push('');
      ['A', 'B', 'C', 'D', 'E'].forEach(function (l) {
        const def = ABCDE.filter(function (d) {
          return d.letter === l;
        })[0];
        const g = p.abcde.answers[l];
        lines.push('- ' + def.name + ': ' + (g === null ? 'not answered' : 'grade ' + g + ' of 3, ' + def.levels[g]));
      });
      lines.push('');
      lines.push('Checklist score ' + p.abcde.score + ' of 100, ' + p.abcde.band + '. Referral: ' + p.abcde.referral + '.');
      lines.push('');
    }
    if (p.fairnessAudit) {
      lines.push('## Fitzpatrick fairness audit (synthetic cohort)');
      lines.push('');
      lines.push('| Type | n | Sensitivity | Wilson 95% | Specificity | FNR |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      p.fairnessAudit.perType.forEach(function (t) {
        lines.push(
          '| ' + t.type + ' | ' + t.n + ' | ' + num(t.sensitivity, 3) + ' | ' +
            num(t.wilson95[0], 3) + ' to ' + num(t.wilson95[1], 3) + ' | ' +
            num(t.specificity, 3) + ' | ' + num(t.fnr, 3) + ' |'
        );
      });
      lines.push('');
      lines.push(
        'Sensitivity gap, I-II minus V-VI: ' + num(p.fairnessAudit.sensitivityGap_I_II_minus_V_VI, 3) +
          '. ECE ' + num(p.fairnessAudit.ece, 3) + ' over ' + p.fairnessAudit.n + ' synthetic records.'
      );
      lines.push('');
    }
    if (p.photoGate) {
      lines.push('## Photo readiness');
      lines.push('');
      p.photoGate.checks.forEach(function (c) {
        lines.push('- ' + c.id + ': ' + (c.pass ? 'pass' : 'check') + ' (' + c.value + ')');
      });
      lines.push('');
      lines.push('Verdict: ' + p.photoGate.verdict + '.');
      lines.push('');
    }
    if (p.sampleTone && Array.isArray(p.sampleTone.lab)) {
      lines.push('## Sample tone');
      lines.push('');
      lines.push(
        'L* ' + num(p.sampleTone.lab[0], 1) + ', a* ' + num(p.sampleTone.lab[1], 1) + ', b* ' +
          num(p.sampleTone.lab[2], 1) + ', ITA ' + num(p.sampleTone.ita, 1) + ' degrees, ' +
          p.sampleTone.band + ', undertone ' + (p.sampleTone.undertone || 'not rated') + ' (heuristic).'
      );
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    lines.push(EXPORT_DISCLAIMER);
    return lines.join('\n') + '\n';
  }

  /**
   * Verify an exported JSON document: parse it, recompute the digest of the
   * payload, and compare. Returns { ok, reason, expected, actual }.
   */
  function verifyAuditJson(text) {
    let doc;
    try {
      doc = JSON.parse(String(text));
    } catch (err) {
      return { ok: false, reason: 'not-json' };
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      return { ok: false, reason: 'not-object' };
    }
    if (typeof doc.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(doc.sha256)) {
      return { ok: false, reason: 'no-digest' };
    }
    if (!doc.payload || typeof doc.payload !== 'object' || Array.isArray(doc.payload)) {
      return { ok: false, reason: 'no-payload' };
    }
    const actual = sha256Hex(canonicalJson(doc.payload));
    return {
      ok: actual === doc.sha256,
      reason: actual === doc.sha256 ? 'match' : 'changed',
      expected: doc.sha256,
      actual: actual
    };
  }

  /* ------------------------------------------------------------------ */
  /* #derm= bookmark codec                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Strict bookmark codec. The only accepted shape is
   * derm=v1,aN,bN,cN,dN,eN,tNN,sN with grades 0..3, threshold 1..99 and
   * scale 0 or 1. Anything else returns null.
   */
  function formatDermHash(state) {
    if (!state || typeof state !== 'object') throw new TypeError('formatDermHash needs a state object');
    const g = ['a', 'b', 'c', 'd', 'e'].map(function (k) {
      const v = state[k];
      if (!Number.isInteger(v) || v < 0 || v > 3) throw new RangeError('bookmark grade ' + k + ' must be 0 to 3');
      return v;
    });
    const t = state.threshold;
    if (!Number.isInteger(t) || t < 1 || t > 99) throw new RangeError('bookmark threshold must be an integer from 1 to 99');
    const s = state.scale === true ? 1 : state.scale === false ? 0 : -1;
    if (s === -1) throw new RangeError('bookmark scale must be true or false');
    return 'derm=v1,a' + g[0] + ',b' + g[1] + ',c' + g[2] + ',d' + g[3] + ',e' + g[4] + ',t' + t + ',s' + s;
  }

  function parseDermHash(str) {
    if (typeof str !== 'string') return null;
    let h = str;
    if (h.indexOf('#') === 0) h = h.slice(1);
    if (h.length === 0 || h !== h.trim()) return null;
    const m = /^derm=v1,a([0-3]),b([0-3]),c([0-3]),d([0-3]),e([0-3]),t([0-9]{1,2}),s([01])$/.exec(h);
    if (!m) return null;
    const t = Number(m[6]);
    if (t < 1 || t > 99) return null;
    return {
      a: Number(m[1]),
      b: Number(m[2]),
      c: Number(m[3]),
      d: Number(m[4]),
      e: Number(m[5]),
      threshold: t,
      scale: m[7] === '1'
    };
  }

  /* ------------------------------------------------------------------ */
  /* Subgroup sensitivity and calibration chart                           */
  /* ------------------------------------------------------------------ */

  const FAIR = Object.freeze({
    width: 560,
    height: 430,
    left: 46,
    right: 14,
    sensTop: 34,
    sensBottom: 214,
    calTop: 258,
    calBottom: 404
  });

  function fairScales() {
    const plotW = FAIR.width - FAIR.left - FAIR.right;
    return {
      x: function (frac) {
        return FAIR.left + frac * plotW;
      },
      ySens: function (v) {
        return FAIR.sensTop + (1 - clamp(v, 0, 1)) * (FAIR.sensBottom - FAIR.sensTop);
      },
      yCal: function (v) {
        return FAIR.calTop + (1 - clamp(v, 0, 1)) * (FAIR.calBottom - FAIR.calTop);
      },
      plotW: plotW
    };
  }

  /**
   * Render the subgroup sensitivity and calibration gap chart as SVG text.
   * Bars carry Wilson 95% whiskers, the pooled I-II and V-VI sensitivities
   * are sage markers, and the lower panel plots observed positive share
   * against mean score per bin with a dashed ideal line.
   */
  function renderFairnessSvg(audit) {
    if (!audit || !Array.isArray(audit.perType)) throw new TypeError('renderFairnessSvg needs an auditFairness result');
    const s = fairScales();
    const parts = [];
    const desc =
      'Sensitivity by Fitzpatrick type at threshold ' + num(audit.threshold, 2) + ': ' +
      audit.perType
        .map(function (t) {
          return t.numeral + ' ' + num(t.sensitivity, 2);
        })
        .join(', ') +
      '. Sensitivity gap I-II minus V-VI is ' + num(audit.sensGap, 2) + '. ECE ' + num(audit.ece, 3) + '.';

    parts.push(
      '<svg class="fair-svg" viewBox="0 0 ' + FAIR.width + ' ' + FAIR.height + '" role="img" aria-labelledby="fair-svg-title fair-svg-desc" focusable="false">'
    );
    parts.push('<title id="fair-svg-title">Sensitivity and calibration by Fitzpatrick type</title>');
    parts.push('<desc id="fair-svg-desc">' + esc(desc) + '</desc>');

    // Sensitivity panel grid and axis.
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      parts.push('<line class="fair-grid" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.ySens(v)) + '" x2="' + fmt(s.x(1)) + '" y2="' + fmt(s.ySens(v)) + '"/>');
      parts.push('<text class="fair-tick" x="' + fmt(s.x(0) - 6) + '" y="' + fmt(s.ySens(v) + 4) + '" text-anchor="end">' + num(v, 2) + '</text>');
    });
    parts.push('<text class="fair-axis" transform="translate(12 ' + fmt((FAIR.sensTop + FAIR.sensBottom) / 2) + ') rotate(-90)" text-anchor="middle">sensitivity</text>');

    // Per-type bars with Wilson whiskers.
    const slot = s.plotW / audit.perType.length;
    const barW = slot * 0.52;
    audit.perType.forEach(function (t, i) {
      const cx = s.x(0) + slot * (i + 0.5);
      const deep = t.type >= 5;
      const top = s.ySens(t.sensitivity);
      const tip =
        'Type ' + t.numeral + ': sensitivity ' + num(t.sensitivity, 2) + ', Wilson 95% ' +
        num(t.wilson.lo, 2) + ' to ' + num(t.wilson.hi, 2) + ', n ' + t.n + ', FNR ' + num(t.fnr, 2);
      parts.push(
        '<rect class="fair-bar' + (deep ? ' fair-deep' : '') + '" x="' + fmt(cx - barW / 2) + '" y="' + fmt(top) +
          '" width="' + fmt(barW) + '" height="' + fmt(FAIR.sensBottom - top) + '"><title>' + esc(tip) + '</title></rect>'
      );
      const yLo = s.ySens(t.wilson.lo);
      const yHi = s.ySens(t.wilson.hi);
      parts.push(
        '<line class="fair-ci' + (deep ? ' fair-deep' : '') + '" x1="' + fmt(cx) + '" y1="' + fmt(yHi) + '" x2="' + fmt(cx) + '" y2="' + fmt(yLo) + '"/>' +
          '<line class="fair-ci' + (deep ? ' fair-deep' : '') + '" x1="' + fmt(cx - 5) + '" y1="' + fmt(yHi) + '" x2="' + fmt(cx + 5) + '" y2="' + fmt(yHi) + '"/>' +
          '<line class="fair-ci' + (deep ? ' fair-deep' : '') + '" x1="' + fmt(cx - 5) + '" y1="' + fmt(yLo) + '" x2="' + fmt(cx + 5) + '" y2="' + fmt(yLo) + '"/>'
      );
      parts.push('<text class="fair-type" x="' + fmt(cx) + '" y="' + fmt(FAIR.sensBottom + 16) + '" text-anchor="middle">' + t.numeral + '</text>');
    });

    // Pooled group markers and the gap bracket.
    const g1cx = s.x(0) + slot * 1;
    const g2cx = s.x(0) + slot * 5;
    const yLight = s.ySens(audit.groups.light.sensitivity);
    const yDeep = s.ySens(audit.groups.deep.sensitivity);
    parts.push('<line class="fair-pool" x1="' + fmt(g1cx - slot) + '" y1="' + fmt(yLight) + '" x2="' + fmt(g1cx + slot) + '" y2="' + fmt(yLight) + '"/>');
    parts.push('<line class="fair-pool" x1="' + fmt(g2cx - slot) + '" y1="' + fmt(yDeep) + '" x2="' + fmt(g2cx + slot) + '" y2="' + fmt(yDeep) + '"/>');
    parts.push('<text class="fair-pool-label" x="' + fmt(g1cx) + '" y="' + fmt(yLight - 6) + '" text-anchor="middle">I-II ' + num(audit.groups.light.sensitivity, 2) + '</text>');
    parts.push('<text class="fair-pool-label" x="' + fmt(g2cx) + '" y="' + fmt(yDeep - 6) + '" text-anchor="middle">V-VI ' + num(audit.groups.deep.sensitivity, 2) + '</text>');
    const gx = s.x(1) + 4;
    parts.push(
      '<line class="fair-gap" x1="' + fmt(gx) + '" y1="' + fmt(yLight) + '" x2="' + fmt(gx) + '" y2="' + fmt(yDeep) + '"/>' +
        '<line class="fair-gap" x1="' + fmt(gx - 4) + '" y1="' + fmt(yLight) + '" x2="' + fmt(gx) + '" y2="' + fmt(yLight) + '"/>' +
        '<line class="fair-gap" x1="' + fmt(gx - 4) + '" y1="' + fmt(yDeep) + '" x2="' + fmt(gx) + '" y2="' + fmt(yDeep) + '"/>'
    );
    parts.push(
      '<text class="fair-gap-label" transform="translate(' + fmt(gx + 7) + ' ' + fmt((yLight + yDeep) / 2) + ') rotate(90)" text-anchor="middle">gap ' +
        num(audit.sensGap, 2) + '</text>'
    );

    // Divider between panels.
    parts.push('<line class="fair-divider" x1="' + fmt(s.x(0)) + '" y1="236" x2="' + fmt(s.x(1)) + '" y2="236"/>');

    // Calibration panel grid, axes and ideal line.
    [0, 0.5, 1].forEach(function (v) {
      parts.push('<line class="fair-grid" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.yCal(v)) + '" x2="' + fmt(s.x(1)) + '" y2="' + fmt(s.yCal(v)) + '"/>');
      parts.push('<text class="fair-tick" x="' + fmt(s.x(0) - 6) + '" y="' + fmt(s.yCal(v) + 4) + '" text-anchor="end">' + num(v, 1) + '</text>');
      parts.push('<text class="fair-tick" x="' + fmt(s.x(v)) + '" y="' + fmt(FAIR.calBottom + 14) + '" text-anchor="middle">' + num(v, 1) + '</text>');
    });
    parts.push('<line class="fair-cal-ideal" x1="' + fmt(s.x(0)) + '" y1="' + fmt(s.yCal(0)) + '" x2="' + fmt(s.x(1)) + '" y2="' + fmt(s.yCal(1)) + '"/>');
    parts.push('<text class="fair-axis" x="' + fmt(s.x(0.5)) + '" y="' + fmt(FAIR.calBottom + 28) + '" text-anchor="middle">mean score per bin</text>');
    parts.push('<text class="fair-axis" transform="translate(12 ' + fmt((FAIR.calTop + FAIR.calBottom) / 2) + ') rotate(-90)" text-anchor="middle">observed positive share</text>');
    parts.push('<text class="fair-axis" x="' + fmt(s.x(1)) + '" y="' + fmt(s.yCal(1) - 8) + '" text-anchor="end">ECE ' + num(audit.ece, 3) + '</text>');

    audit.calibration.bins.forEach(function (b, i) {
      if (b.n === 0) return;
      const cx = s.x(b.meanScore);
      const cy = s.yCal(b.frac);
      const r = 2.5 + Math.min(4, Math.sqrt(b.n) * 0.5);
      parts.push(
        '<circle class="fair-cal-dot' + (i >= 5 ? ' fair-deep' : '') + '" cx="' + fmt(cx) + '" cy="' + fmt(cy) + '" r="' + fmt(r) +
          '"><title>bin ' + i + ': mean score ' + num(b.meanScore, 2) + ', positive share ' + num(b.frac, 2) + ', n ' + b.n + '</title></circle>'
      );
    });

    parts.push('</svg>');
    return parts.join('');
  }

  /* ------------------------------------------------------------------ */
  /* In page self tests                                                   */
  /* ------------------------------------------------------------------ */

  const SHA256_KAT = Object.freeze([
    Object.freeze(['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']),
    Object.freeze(['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad']),
    Object.freeze(['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']),
    Object.freeze(['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'])
  ]);

  function eq(a, b, what) {
    if (a !== b) throw new Error((what || 'mismatch') + ': ' + a + ' !== ' + b);
  }

  function ok(cond, what) {
    if (!cond) throw new Error(what || 'check failed');
  }

  /**
   * Run the self test battery in this page or in Node. Every entry reports
   * { name, ok, detail }; a throw inside a check marks it failed instead of
   * stopping the rest.
   */
  function runSelfTests() {
    const tests = [];
    const push = function (name, fn) {
      try {
        const detail = fn();
        tests.push({ name: name, ok: true, detail: detail || 'ok' });
      } catch (err) {
        tests.push({ name: name, ok: false, detail: String((err && err.message) || err) });
      }
    };

    SHA256_KAT.forEach(function (pair, i) {
      push('SHA-256 FIPS 180-4 KAT ' + (i + 1) + ' of 4', function () {
        const got = sha256Hex(pair[0]);
        eq(got, pair[1], 'digest');
        return got.slice(0, 16) + '...';
      });
    });

    push('ABCDE score is non-decreasing in every letter', function () {
      ['A', 'B', 'C', 'D', 'E'].forEach(function (letter) {
        let prev = -1;
        for (let g = 0; g <= 3; g += 1) {
          const input = { A: 0, B: 0, C: 0, D: 0, E: 0 };
          input[letter] = g;
          const t = abcdeScore(input).total;
          ok(t >= prev - 1e-12, letter + ' grade ' + g + ' lowered the score');
          prev = t;
        }
      });
      return '5 letters x 4 grades';
    });

    push('Evolution weighs more than any other letter', function () {
      ABCDE.forEach(function (def) {
        ok(def.weight <= 2, def.letter + ' weight above Evolution');
      });
      const oneGrade = function (letter) {
        const input = { A: 0, B: 0, C: 0, D: 0, E: 0 };
        input[letter] = 1;
        return abcdeScore(input).total;
      };
      ['A', 'B', 'C', 'D'].forEach(function (letter) {
        ok(oneGrade('E') > oneGrade(letter), 'E grade 1 did not outrank ' + letter);
      });
      return 'E weight ' + ABCDE[4].weight;
    });

    push('ABCDE score stays inside 0 to 100 at the extremes', function () {
      eq(abcdeScore({ A: 0, B: 0, C: 0, D: 0, E: 0 }).total, 0, 'all zero');
      eq(abcdeScore({ A: 3, B: 3, C: 3, D: 3, E: 3 }).total, 100, 'all three');
      return '0 and 100';
    });

    push('Wilson interval keeps lo <= p <= hi', function () {
      for (let n = 1; n <= 120; n += 1) {
        for (let k = 0; k <= n; k += 1) {
          const w = wilsonInterval(k, n);
          ok(w.lo <= w.p + 1e-12 && w.p <= w.hi + 1e-12, 'order broke at ' + k + '/' + n);
          ok(w.lo >= 0 && w.hi <= 1, 'bounds broke at ' + k + '/' + n);
        }
      }
      return '7260 intervals';
    });

    push('Wilson interval shrinks as n grows', function () {
      const w50 = wilsonInterval(30, 60);
      const w500 = wilsonInterval(300, 600);
      ok(w500.hi - w500.lo < w50.hi - w50.lo, 'wider at n 600');
      return 'width ' + num(w500.hi - w500.lo, 3) + ' under ' + num(w50.hi - w50.lo, 3);
    });

    push('ECE stays in [0, 1] and reads 0 for perfect calibration', function () {
      const pairs = [];
      for (let i = 0; i < 500; i += 1) {
        const s = i / 499;
        pairs.push({ score: s, truth: i % 100 < s * 100 ? 1 : 0 });
      }
      const cal = expectedCalibrationError(pairs, 10);
      ok(cal.ece >= 0 && cal.ece <= 1, 'ECE out of bounds');
      const perfect = expectedCalibrationError([{ score: 0, truth: 0 }, { score: 1, truth: 1 }], 10);
      ok(perfect.ece < 1e-9, 'perfect calibration not zero');
      return 'ECE ' + num(cal.ece, 3);
    });

    push('Cohort partitions conserve every record', function () {
      const cohort = buildSyntheticCohort();
      eq(cohort.length, 6 * COHORT_PER_TYPE, 'cohort size');
      const audit = auditFairness(cohort, 0.6);
      audit.perType.forEach(function (t) {
        eq(t.tp + t.fp + t.tn + t.fn, t.n, 'type ' + t.numeral + ' cells');
        eq(t.n, COHORT_PER_TYPE, 'type ' + t.numeral + ' count');
      });
      const sum = audit.perType.reduce(function (acc, t) {
        return acc + t.n;
      }, 0);
      eq(sum, cohort.length, 'partition total');
      return cohort.length + ' records';
    });

    push('Cohort is deterministic for a fixed seed', function () {
      const a = buildSyntheticCohort({ seed: 7 });
      const b = buildSyntheticCohort({ seed: 7 });
      eq(a.length, b.length, 'length');
      for (let i = 0; i < a.length; i += 1) {
        eq(a[i].score, b[i].score, 'record ' + i);
        eq(a[i].truth, b[i].truth, 'truth ' + i);
      }
      return 'seed 7 identical';
    });

    push('CSV escaping neutralizes formula cells', function () {
      ['=1+1', '+SUM(A1)', '-2+3', '@x', '\t=1', ' lead'].forEach(function (bad) {
        const cell = csvCell(bad);
        ok(cell.charAt(0) === "'" || cell.charAt(0) === '"', 'unescaped ' + JSON.stringify(bad));
      });
      eq(csvCell('plain'), 'plain', 'plain cell changed');
      eq(csvCell('a,b'), '"a,b"', 'comma cell');
      eq(csvCell('say "hi"'), '"say ""hi"""', 'quote cell');
      return 'formulas prefixed';
    });

    push('Export digest catches a one character edit', function () {
      const bundle = buildAuditBundle({ abcde: abcdeScore({ A: 1, B: 0, C: 0, D: 0, E: 0 }) });
      const text = exportAuditJson(bundle);
      eq(verifyAuditJson(text).ok, true, 'fresh export did not verify');
      ok(text.indexOf('"A": 1') !== -1, 'export lost the A answer');
      const tampered = text.replace('"A": 1', '"A": 3');
      const r = verifyAuditJson(tampered);
      eq(r.ok, false, 'tamper missed');
      eq(r.reason, 'changed', 'reason');
      return 'flip rejected';
    });

    push('Bookmark codec round trips and rejects junk', function () {
      const state = { a: 3, b: 0, c: 1, d: 2, e: 3, threshold: 55, scale: true };
      const h = formatDermHash(state);
      const back = parseDermHash('#' + h);
      ok(back && back.a === 3 && back.e === 3 && back.threshold === 55 && back.scale === true, 'round trip');
      ['derm=v1,a4,b0,c0,d0,e0,t50,s0', 'derm=v1,a0,b0,c0,d0,e0,t0,s0', 'derm=v2,a0,b0,c0,d0,e0,t50,s0', 'derm=v1,a0,b0,c0,e0,t50,s0', ' derm=v1,a0,b0,c0,d0,e0,t50,s0', '', 'derm='].forEach(function (bad) {
        eq(parseDermHash(bad), null, 'accepted ' + JSON.stringify(bad));
      });
      return h;
    });

    push('Synthetic cohort shows the planted sensitivity gap', function () {
      const audit = auditFairness(buildSyntheticCohort(), 0.6);
      ok(audit.sensGap > 0.05, 'gap not found: ' + audit.sensGap);
      ok(audit.groups.light.sensitivity > audit.groups.deep.sensitivity, 'order');
      return 'gap ' + num(audit.sensGap, 3);
    });

    push('Photo gate fails a flat frame and passes a real specimen', function () {
      const flat = { width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4) };
      for (let i = 0; i < flat.data.length; i += 4) {
        flat.data[i] = 200;
        flat.data[i + 1] = 170;
        flat.data[i + 2] = 150;
        flat.data[i + 3] = 255;
      }
      const flatGate = imageQualityGate(flat, { scaleConfirmed: true });
      ok(flatGate.verdict.id === 'retake', 'flat image passed');
      const spec = E.createSkinSpecimen({ width: 160, height: 200, lab: [60, 12, 20], seed: 5 });
      const gate = imageQualityGate({ width: 160, height: 200, data: spec.data }, { scaleConfirmed: true });
      ok(gate.metrics.lapStd > 0.2, 'specimen too soft: ' + gate.metrics.lapStd);
      return 'flat blocked';
    });

    return tests;
  }

  return {
    LAB_VERSION: LAB_VERSION,
    ABCDE: ABCDE,
    ABCDE_BANDS: ABCDE_BANDS,
    URGENCY_TIERS: URGENCY_TIERS,
    PREP_BASE: PREP_BASE,
    FITZ_TYPES: FITZ_TYPES,
    COHORT_SEED: COHORT_SEED,
    COHORT_PER_TYPE: COHORT_PER_TYPE,
    COHORT_DISCLOSURE: COHORT_DISCLOSURE,
    GATE_DEFAULTS: GATE_DEFAULTS,
    EXPORT_NOTE: EXPORT_NOTE,
    EXPORT_DISCLAIMER: EXPORT_DISCLAIMER,
    SHA256_KAT: SHA256_KAT,
    utf8Bytes: utf8Bytes,
    sha256Bytes: sha256Bytes,
    sha256Hex: sha256Hex,
    abcdeScore: abcdeScore,
    abcdeBand: abcdeBand,
    referralUrgency: referralUrgency,
    visitPrepItems: visitPrepItems,
    visitPrepBrief: visitPrepBrief,
    wilsonInterval: wilsonInterval,
    expectedCalibrationError: expectedCalibrationError,
    buildSyntheticCohort: buildSyntheticCohort,
    auditFairness: auditFairness,
    imageQualityGate: imageQualityGate,
    canonicalJson: canonicalJson,
    buildAuditBundle: buildAuditBundle,
    exportAuditJson: exportAuditJson,
    exportAuditCsv: exportAuditCsv,
    exportAuditMarkdown: exportAuditMarkdown,
    csvCell: csvCell,
    verifyAuditJson: verifyAuditJson,
    formatDermHash: formatDermHash,
    parseDermHash: parseDermHash,
    renderFairnessSvg: renderFairnessSvg,
    runSelfTests: runSelfTests
  };
});
