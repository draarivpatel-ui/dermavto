'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

describe('repository files', () => {
  ['README.md', 'NOTES.md', 'DESIGN.md', 'LICENSE', 'video/SUBMISSION.md', 'video/narration.txt', '.nojekyll', 'og.png',
    'tokens.css', 'styles.css', 'engine.js', 'render.js', 'app.js', 'youcam-live.js', 'index.html'].forEach((name) => {
    it('has ' + name, () => {
      assert.ok(fs.existsSync(path.join(ROOT, name)), name);
    });
  });

  it('uses the MIT licence', () => {
    assert.match(read('LICENSE'), /^MIT License/);
    assert.match(read('LICENSE'), /Permission is hereby granted, free of charge/);
  });

  it('declares a node test script and the MIT licence in package.json', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.license, 'MIT');
    assert.match(pkg.scripts.test, /node --test/);
    assert.equal(pkg.homepage, 'https://aariv.me/dermavto/');
    assert.equal(pkg.repository.url, 'https://github.com/draarivpatel-ui/dermavto.git');
  });

  it('links every README screenshot to a file that exists', () => {
    const links = [...read('README.md').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(links.length >= 2);
    links.forEach((l) => assert.ok(fs.existsSync(path.join(ROOT, l)), l));
  });
});

describe('voiceover script', () => {
  const narration = read('video/narration.txt').trim();

  it('is exactly 55 words', () => {
    assert.equal(narration.split(/\s+/).length, 55);
  });

  it('has no hyphen of any kind', () => {
    assert.equal(narration.includes('-'), false);
    const dashes = new RegExp('[' + String.fromCharCode(0x2010) + '-' + String.fromCharCode(0x2015) + String.fromCharCode(0x2212) + ']');
    assert.equal(dashes.test(narration), false);
  });

  it('says try on and not try-on, and avoids the jargon the brief banned', () => {
    assert.match(narration, /try on/);
    assert.doesNotMatch(narration, /client side|clientside/i);
  });

  it('appears word for word in SUBMISSION.md', () => {
    assert.ok(read('video/SUBMISSION.md').includes(narration));
  });
});

describe('privacy and honesty of the written files', () => {
  const files = ['README.md', 'NOTES.md', 'DESIGN.md', 'video/SUBMISSION.md', 'index.html', 'package.json'];

  it('contains no private email address or API key', () => {
    files.forEach((f) => {
      const text = read(f);
      assert.doesNotMatch(text, /gmail\.com/i, f);
      assert.doesNotMatch(text, /Bearer (?!YOUR_API_KEY)[A-Za-z0-9]{12,}/, f);
    });
  });

  it('states the v1.0 versus v2.0 reconciliation with its date', () => {
    const notes = read('NOTES.md');
    assert.match(notes, /\/s2s\/v2\.0\/task\/skin-analysis/);
    assert.match(notes, /25 October 2026/);
    assert.match(read('README.md'), /The paths are `v2\.0`/);
  });

  it('says plainly what was not checked against the real service', () => {
    assert.match(read('README.md'), /Not checked/);
    assert.match(read('NOTES.md'), /Not verified/);
  });

  it('keeps the cosmetic and educational disclaimer in the README', () => {
    assert.match(read('README.md'), /cosmetic and educational colour measurements/);
  });

  it('has no unfinished markers', () => {
    ['README.md', 'NOTES.md', 'DESIGN.md', 'video/SUBMISSION.md', 'index.html', 'app.js', 'engine.js', 'render.js', 'youcam-live.js', 'styles.css'].forEach((f) => {
      assert.doesNotMatch(read(f), /\b(TODO|FIXME|XXX|lorem ipsum|placeholder text)\b/i, f);
    });
  });
});
