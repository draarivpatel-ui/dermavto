'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../engine.js');
const F = require('../fairness-lab.js');

describe('revamp regressions', () => {
  it('rgbToHex never emits NaN channel text', () => {
    assert.match(E.rgbToHex(NaN, 0, 0), /^#[0-9a-f]{6}$/);
    assert.equal(E.rgbToHex(NaN, 0, 0), '#000000');
    assert.equal(E.rgbToHex(undefined, Infinity, -Infinity), '#00ff00');
  });

  it('canonicalJson rejects cyclic input with a controlled error', () => {
    const x = {};
    x.self = x;
    assert.throws(() => F.canonicalJson(x), /cyclic/i);
  });

  it('fairness records reject scores outside the unit interval', () => {
    const bad = [
      { id: 'a', type: 1, truth: 1, score: 1.2 },
      { id: 'b', type: 6, truth: 0, score: 0.2 }
    ];
    assert.throws(() => F.auditFairness(bad, 0.6), TypeError);
    const low = [
      { id: 'a', type: 1, truth: 1, score: 0.8 },
      { id: 'b', type: 6, truth: 0, score: -0.1 }
    ];
    assert.throws(() => F.auditFairness(low, 0.6), TypeError);
  });

  it('wilsonInterval ignores a hostile z value and stays finite', () => {
    const w = F.wilsonInterval(5, 10, NaN);
    assert.ok(Number.isFinite(w.lo) && Number.isFinite(w.hi) && Number.isFinite(w.p));
    assert.ok(w.lo >= 0 && w.hi <= 1);
    const neg = F.wilsonInterval(5, 10, -1);
    assert.ok(Number.isFinite(neg.lo) && Number.isFinite(neg.hi));
  });

  it('photo scale confirmation fails closed unless exactly true', () => {
    const spec = E.createSkinSpecimen({ width: 480, height: 480 });
    const gate = F.imageQualityGate({ width: 480, height: 480, data: spec.data }, { scaleConfirmed: 'true' });
    const scale = gate.checks.find((c) => c.id === 'scale');
    assert.equal(scale.pass, false);
    assert.equal(scale.value, 'not confirmed');
  });

  it('enabling the patch picker moves keyboard focus to its arrow-key target', () => {
    const app = fs.readFileSync('app.js', 'utf8');
    const click = app.match(/els\.sampleToggle\.addEventListener\('click', function \(\) \{[\s\S]*?\n    \}\);/)[0];
    assert.match(click, /els\.picker\.focus\(\)/);
  });
});
