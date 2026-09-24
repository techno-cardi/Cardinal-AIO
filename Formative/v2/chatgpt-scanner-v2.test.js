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
    this.style = {};
    this.order = options.order || 0;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
    return this;
  }
  get childNodes() { return this.children; }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  getAttributeNames() {
    return Object.keys(this.attrs);
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
    if (selector === '[data-message-author-role]') return all.filter(n => n.getAttribute('data-message-author-role'));
    if (selector === '[data-turn]') return all.filter(n => n.getAttribute('data-turn'));
    if (selector === '[data-role]') return all.filter(n => n.getAttribute('data-role'));
    if (selector === '[data-message-author]') return all.filter(n => n.getAttribute('data-message-author'));
    if (selector === '[data-chatgpt-search-unit-key]') return all.filter(n => n.getAttribute('data-chatgpt-search-unit-key'));
    if (selector === '[data-content-search-unit-key]') return all.filter(n => n.getAttribute('data-content-search-unit-key'));
    if (selector === '[data-conversation-role]') return all.filter(n => n.getAttribute('data-conversation-role'));
    if (selector === '[data-markdown-text-style]') return all.filter(n => n.getAttribute('data-markdown-text-style'));
    if (selector === '[data-user-message-bubble]') return all.filter(n => n.getAttribute('data-user-message-bubble') != null);
    if (selector === '[data-testid^="conversation-turn-"]') {
      return all.filter(n => String(n.getAttribute('data-testid') || '').startsWith('conversation-turn-'));
    }
    if (selector === 'article') return all.filter(n => n.tagName === 'ARTICLE');
    if (selector === 'button[data-testid="copy-turn-action-button"]') {
      return all.filter(n => n.tagName === 'BUTTON' && n.getAttribute('data-testid') === 'copy-turn-action-button');
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
  assert.equal(collected.candidates[0].context.role, 'assistant');
  assert(['explicit-role', 'article-descendant-role'].includes(collected.candidates[0].context.evidence));
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



// Current ChatGPT variants can expose section[data-turn] without
// data-message-author-role. A complete Cardinal package rendered as ordinary
// text must still be discovered without requiring <pre>/<code>.
{
  const root = new MockNode('main');
  const assistant = new MockNode('section', {
    attrs: { 'data-turn': 'assistant' },
    text: packageText(),
    order: 20
  });
  root.append(assistant);

  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.state, 'found');
  assert.equal(result.messages[0].parse.package.pkg.schema, P.SCHEMA);
  assert.equal(result.messages[0].technicalNode, null);
  const placement = S.placementAnchor(result.messages[0].messageRoot, null);
  assert.equal(placement.mode, 'append-end');
}

// The same text in an explicit user turn is never executable.
{
  const root = new MockNode('main');
  root.append(new MockNode('section', {
    attrs: { 'data-turn': 'user' },
    text: packageText(),
    order: 20
  }));
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 0);
  assert.equal(result.ignored.some(row => row.reason === 'user-message'), true);
}

// A conversation-turn wrapper can be identified as assistant by a durable
// assistant-only action signal even when role attributes disappear.
{
  const root = new MockNode('main');
  const turn = new MockNode('div', {
    attrs: { 'data-testid': 'conversation-turn-42' },
    text: packageText(),
    order: 20
  });
  turn.append(new MockNode('button', {
    attrs: { 'data-testid': 'copy-turn-action-button' },
    order: 21
  }));
  root.append(turn);
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.state, 'found');
}



// ChatGPT 2026-09 can remove data-message-author-role while keeping explicit
// search-unit message markers. Assistant packages must still be discovered.
{
  const root = new MockNode('main');
  root.append(new MockNode('div', {
    attrs: { 'data-chatgpt-search-unit-key': 'conversation:assistant' },
    text: packageText(),
    order: 40
  }));
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.state, 'found');
}

// Alternative current marker used by some ChatGPT surfaces.
{
  const root = new MockNode('main');
  root.append(new MockNode('div', {
    attrs: { 'data-markdown-text-style': 'assistant-message' },
    text: packageText(),
    order: 40
  }));
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].parse.state, 'found');
}

// New user bubble marker remains fail-closed even if it contains a valid
// Cardinal package copied by the teacher.
{
  const root = new MockNode('main');
  root.append(new MockNode('div', {
    attrs: { 'data-user-message-bubble': '' },
    text: packageText(),
    order: 40
  }));
  const result = S.scan(root, P);
  assert.equal(result.messages.length, 0);
  assert.equal(result.ignored.some(row => row.reason === 'user-message'), true);
}



// Cardinal must keep finding the same package after it has rendered its own
// bar and hidden the technical block. This reproduces the real "bar flashes
// for one second then disappears" regression.
{
  const root = new MockNode('main');
  const assistant = new MockNode('div', {
    attrs: { 'data-chatgpt-search-unit-key': 'conversation:assistant' }
  });
  const markerLine = new MockNode('p', { text: P.SENTINEL, order: 10 });
  const technical = new MockNode('pre', { text: packageText().split('\n')[1], order: 20 });
  assistant.append(markerLine, technical);
  root.append(assistant);

  const before = S.scan(root, P);
  assert.equal(before.messages.length, 1);
  assert.equal(before.messages[0].parse.state, 'found');

  technical.style.display = 'none';
  const cardinalBar = new MockNode('div', {
    attrs: { 'data-cardinal-formative-signature': 'sig-1' },
    text: 'Importer dans Formative',
    order: 15
  });
  assistant.children.splice(1, 0, cardinalBar);
  cardinalBar.parentElement = assistant;

  assert.equal(S.isCardinalUiElement(cardinalBar), true);
  assert.equal(S.visibleText(assistant).includes('Importer dans Formative'), false);

  const after = S.scan(root, P);
  assert.equal(after.messages.length, 1);
  assert.equal(after.messages[0].parse.state, 'found');
}

console.log('chatgpt-scanner-v2: all tests passed');
