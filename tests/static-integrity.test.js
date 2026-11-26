"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function visibleMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
}

function htmlTags(html) {
  const out = [];
  const clean = visibleMarkup(html);
  for (const match of clean.matchAll(/<([A-Za-z][\w:-]*)(\s[^<>]*)?>/g)) {
    const attrs = {};
    for (const attr of (match[2] || '').matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g)) {
      attrs[attr[1].toLowerCase()] = attr[3] ?? attr[4] ?? attr[2]?.replace(/^"|^'|"$|'$/g, '') ?? '';
    }
    out.push({ tag: match[1].toLowerCase(), attrs });
  }
  return out;
}

function printCss(css) {
  const chunks = [];
  for (const match of css.matchAll(/@media\s+([^{]+)\{/gi)) {
    if (!/print/i.test(match[1])) continue;
    let depth = 1;
    let at = match.index + match[0].length;
    while (at < css.length && depth) {
      if (css[at] === '{') depth += 1;
      if (css[at] === '}') depth -= 1;
      at += 1;
    }
    chunks.push(css.slice(match.index, at));
  }
  return chunks.join('\n');
}

function assertStaticHtmlIntegrity(html) {
  const nodes = htmlTags(html);
  const ids = new Map();
  for (const node of nodes) {
    if (!node.attrs.id) continue;
    ids.set(node.attrs.id, (ids.get(node.attrs.id) || 0) + 1);
  }
  assert.deepEqual([...ids].filter(([, count]) => count > 1), [], 'duplicate DOM ids');
  for (const node of nodes) {
    for (const attr of ['aria-labelledby', 'aria-controls', 'aria-describedby']) {
      if (!node.attrs[attr]) continue;
      for (const id of node.attrs[attr].split(/\s+/).filter(Boolean)) {
        assert.ok(ids.has(id), `${attr} references missing #${id}`);
      }
    }
    if (node.tag === 'label' && node.attrs.for) assert.ok(ids.has(node.attrs.for), `label references missing #${node.attrs.for}`);
  }
}

function assertLocalRuntimeAssets(html) {
  for (const node of htmlTags(html)) {
    const rel = node.attrs.rel || '';
    const resourceLink = node.tag === 'link' && /stylesheet|icon|manifest|preload|apple-touch-icon|mask-icon/.test(rel);
    const attr = node.tag === 'script' ? 'src' : node.tag === 'img' ? 'src' : resourceLink ? 'href' : null;
    if (!attr || !node.attrs[attr]) continue;
    const url = node.attrs[attr].trim();
    if (!url || url.startsWith('#') || /^(data|blob|mailto|tel|javascript):/i.test(url)) continue;
    assert.ok(!/^(?:https?:)?\/\//i.test(url), `${node.tag} loads external runtime asset ${url}`);
    const local = decodeURIComponent(url.split('#')[0].split('?')[0]);
    assert.ok(fs.existsSync(path.join(ROOT, local.replace(/^\/+/, ''))), `${node.tag} references missing ${url}`);
  }
}


const html = read('index.html');
const css = read('styles.css');
const print = printCss(css);

test('static integrity: ids, ARIA references and local runtime assets are sound', () => {
  assertStaticHtmlIntegrity(html);
  assertLocalRuntimeAssets(html);
});

test('print integrity: the visible receipt is light, unclipped and ink safe', () => {
  assert.match(print, /#youcam \.code\.receipt\s*\{[^}]*background:\s*var\(--color-paper\);[^}]*color:\s*var\(--color-ink\);/);
  assert.match(print, /#youcam \.code\.receipt\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/);
});
