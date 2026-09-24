'use strict';

const assert = require('node:assert/strict');
const S = require('./chatgpt-scanner-v2.js');
const P = require('./package-parser-v2.js');

class MockNode {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.attrs = { ...(options.attrs || {}) };
    this.textContent = options.text || '';
    this.children = [];
    this.parentElement = null;
    this.order = options.order || 0;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  matches(selector) {
    return selector === 'article' && this.tagName === 'ARTICLE';
  }
  descendants() {
    const out = [];
    const walk = node => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(selector) {
    const all = this.descendants();
    if (selector === 'pre, code') return all.filter(n => ['PRE', 'CODE'].includes(n.tagName));
    if (selector === '[data-message-author-role]') {
      return all.filter(n => n.getAttribute('data-message-author-role'));
    }
    if (selector === 'table') return all.filter(n => n.tagName === 'TABLE');
    return [];
  }
  compareDocumentPosition(other) {
    if (this.order < other.order) return 4; // DOCUMENT_POSITION_FOLLOWING
    if (this.order > other.order) return 2; // DOCUMENT_POSITION_PRECEDING
    return 0;
  }
}

function packageText(mode = 'full') {
  return `${P.SENTINEL}\n${JSON.stringify({
    schema: 'cardinal.formative/2',
    protocolVersion: '2.0.0',
    packageMode: mode,
    assessment: { title: 'Test' },
    sources: [], items: [], issues: []
  })}`;
}

// ChatGPT renders the compact prompt's marker as a paragraph and the JSON as
// a separate code block. The visible human table must not be part of the
// technical block or determine whether the package is importable.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const tableWrap = new MockNode('div', { order: 10 });
  const table = new MockNode('table', { text: 'Question | Type | Points', order: 11 });
  const marker = new MockNode('p', { text: P.SENTINEL, order: 20 });
  const json = new MockNode('pre', { text: packageText().split('\n')[1], order: 30 });
  tableWrap.append(table);
  assistant.append(tableWrap, marker, json);
  assistant.textContent = `Question | Type | Points\n${marker.textContent}\n${json.textContent}`;
  root.append(assistant);

  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.state, 'found');
  assert.equal(result.messages[0].parse.package.pkg.schema, P.SCHEMA);
  assert.equal(result.messages[0].technicalNode, json);
  const placement = S.placementAnchor(result.messages[0].messageRoot, result.messages[0].technicalNode);
  assert.equal(placement.mode, 'after-validation-table');
  assert.equal(placement.anchor, tableWrap);
}

// Strong author-role ancestors: assistant accepted, user ignored. Nested <code>
// inside <pre> is deduplicated so the package is not seen twice.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const pre = new MockNode('pre', { text: packageText(), order: 20 });
  const code = new MockNode('code', { text: packageText(), order: 21 });
  pre.append(code);
  assistant.append(pre);

  const user = new MockNode('div', { attrs: { 'data-message-author-role': 'user' } });
  user.append(new MockNode('pre', { text: packageText('patch'), order: 5 }));
  root.append(user, assistant);

  const collected = S.collectCandidates(root, P);
  assert.equal(collected.candidates.length, 1);
  assert.equal(collected.candidates[0].node, pre);
  assert.equal(collected.ignored.length, 1);
  assert.equal(collected.ignored[0].reason, 'user-message');

  const scan = S.scan(root, P);
  assert.equal(scan.messages.length, 1);
  assert.equal(scan.messages[0].parse.ok, true);
  assert.equal(scan.messages[0].parse.package.pkg.packageMode, 'full');
}

// The marker can itself be styled as inline code while the JSON is fenced
// separately. The two pieces still form one package in one assistant answer.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const marker = new MockNode('code', { text: P.SENTINEL, order: 10 });
  const json = new MockNode('pre', { text: packageText().split('\n')[1], order: 20 });
  assistant.append(marker, json);
  assistant.textContent = `${marker.textContent}\n${json.textContent}`;
  root.append(assistant);
  const result = S.scan(root, P);
  assert.equal(result.messages[0].parse.state, 'found');
  assert.equal(result.messages[0].technicalNode, json);
}

// A second marker in the same answer remains ambiguous even when one marker
// is inline and a later fenced block holds a complete package.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const marker = new MockNode('code', { text: P.SENTINEL, order: 10 });
  const complete = new MockNode('pre', { text: packageText(), order: 20 });
  assistant.append(marker, complete);
  assistant.textContent = `${marker.textContent}\n${complete.textContent}`;
  root.append(assistant);
  const result = S.scan(root, P);
  assert.equal(result.messages[0].parse.state, 'invalid');
  assert.equal(result.messages[0].parse.error.code, 'PACKAGE_SENTINEL_AMBIGUOUS');
}

// Article fallback is allowed only when exactly one role can be proven within
// that article. This tolerates ChatGPT wrapper changes without accepting a
// package from an unproven/user DOM region.
{
  const root = new MockNode('main');
  const article = new MockNode('article');
  article.append(
    new MockNode('span', { attrs: { 'data-message-author-role': 'assistant' } }),
    new MockNode('pre', { text: packageText(), order: 20 })
  );
  root.append(article);

  const collected = S.collectCandidates(root, P);
  assert.equal(collected.candidates.length, 1);
  assert.equal(collected.candidates[0].context.evidence, 'article-descendant-role');
}

// Mixed or role-less article fails closed.
{
  const root = new MockNode('main');
  const mixed = new MockNode('article');
  mixed.append(
    new MockNode('span', { attrs: { 'data-message-author-role': 'assistant' } }),
    new MockNode('span', { attrs: { 'data-message-author-role': 'user' } }),
    new MockNode('pre', { text: packageText(), order: 20 })
  );
  const unknown = new MockNode('article');
  unknown.append(new MockNode('pre', { text: packageText(), order: 40 }));
  root.append(mixed, unknown);

  const collected = S.collectCandidates(root, P);
  assert.equal(collected.candidates.length, 0);
  assert.equal(collected.ignored.length, 2);
  assert(collected.ignored.every(row => row.reason === 'assistant-not-proven'));
}

// Two technical packages in the same assistant message remain an explicit
// ambiguity rather than “last one wins”.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  assistant.append(
    new MockNode('pre', { text: packageText('full'), order: 10 }),
    new MockNode('pre', { text: packageText('patch'), order: 20 })
  );
  root.append(assistant);
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.ok, false);
  assert.equal(result.messages[0].parse.state, 'ambiguous');
  assert.equal(result.messages[0].parse.error.code, 'PACKAGE_MULTIPLE_CANDIDATES');
}

// Placement is after the last validation table before the technical package,
// and after that table's direct branch rather than inside <table> markup.
{
  const message = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const intro = new MockNode('div', { order: 1 });
  const firstWrap = new MockNode('div', { order: 5 });
  const firstTable = new MockNode('table', { order: 6 });
  firstWrap.append(firstTable);
  const validationWrap = new MockNode('div', { order: 10 });
  const validationTable = new MockNode('table', { order: 11 });
  validationWrap.append(validationTable);
  const technicalWrap = new MockNode('div', { order: 20 });
  const technical = new MockNode('pre', { text: packageText(), order: 21 });
  technicalWrap.append(technical);
  message.append(intro, firstWrap, validationWrap, technicalWrap);

  const placement = S.placementAnchor(message, technical);
  assert.equal(placement.mode, 'after-validation-table');
  assert.equal(placement.table, validationTable);
  assert.equal(placement.anchor, validationWrap);
  assert.equal(placement.parent, message);
}

// Without a preceding table, UI belongs immediately before the technical block
// rather than at the top/bottom of the whole conversation.
{
  const message = new MockNode('div', { attrs: { 'data-message-author-role': 'assistant' } });
  const technicalWrap = new MockNode('div', { order: 20 });
  const technical = new MockNode('pre', { text: packageText(), order: 21 });
  technicalWrap.append(technical);
  message.append(technicalWrap);
  const placement = S.placementAnchor(message, technical);
  assert.equal(placement.mode, 'before-technical');
  assert.equal(placement.anchor, technical);
  assert.equal(placement.parent, technicalWrap);
}

console.log('chatgpt-scanner-v2: all tests passed');
