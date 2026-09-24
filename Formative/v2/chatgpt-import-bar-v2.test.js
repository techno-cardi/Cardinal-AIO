'use strict';

const assert = require('node:assert/strict');
const Scanner = require('./chatgpt-scanner-v2.js');
const Parser = require('./package-parser-v2.js');
const Content = require('./chatgpt-content-v2.js');
const Errors = require('./error-presenter-v2.js');
const Presentation = require('./presentation-v2.js');

class Node {
  constructor(tag, value = '', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.value = value;
    this.attrs = attrs;
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.dataset = {};
    this.listeners = {};
  }
  get parentNode() { return this.parentElement; }
  get nextSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.value = String(value); this.children = []; }
  getAttribute(name) { return this.attrs[name] || null; }
  matches(selector) { return selector === 'article' && this.tagName === 'ARTICLE'; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  insertBefore(child, next) {
    child.remove();
    child.parentElement = this;
    const index = next ? this.children.indexOf(next) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    return child;
  }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.value = ''; this.append(...children); }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  click() { return this.listeners.click?.(); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    const nodes = this.descendants();
    if (selector === 'pre, code') return nodes.filter(node => ['PRE', 'CODE'].includes(node.tagName));
    if (selector === '[data-message-author-role]') return nodes.filter(node => node.attrs['data-message-author-role']);
    if (selector === 'table') return nodes.filter(node => node.tagName === 'TABLE');
    return [];
  }
  compareDocumentPosition(other) {
    let root = this;
    while (root.parentElement) root = root.parentElement;
    const nodes = [root, ...root.descendants()];
    return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2;
  }
}

(async () => {
  const root = new Node('main');
  const assistant = new Node('article', '', { 'data-message-author-role': 'assistant' });
  const tableWrap = new Node('div');
  tableWrap.append(new Node('table', 'Question | Type | Points'));
  const marker = new Node('p', Parser.SENTINEL);
  const pkg = {
    schema: Parser.SCHEMA, protocolVersion: Parser.PROTOCOL_VERSION,
    packageMode: 'full', assessment: { title: 'Examen' },
    sources: [], items: [{
      id: 'q1', kind: 'question', order: 1, subtype: 'longAnswer',
      prompt: 'Explique deux conséquences.', points: { value: 4 },
      grading: {
        mode: 'assisted', expectedAnswer: 'Deux conséquences expliquées.',
        concepts: [{ id: 'thyroid', label: 'Santé', score: 2,
          terms: ['thyroïde', 'cancer de la thyroïde'], riskyTerms: ['cancer'] }]
      }
    }], issues: []
  };
  const code = new Node('pre', JSON.stringify(pkg));
  assistant.append(tableWrap, marker, code);
  root.append(assistant);
  const doc = { documentElement: root, querySelectorAll: selector => root.querySelectorAll(selector), createElement: tag => new Node(tag) };
  let preparations = 0;
  let imports = 0;
  const runtime = {
    id: 'cardinal-test',
    async sendMessage(message) {
      if (message.type === 'CARDINAL_FORMATIVE_IMPORT_APPLY') {
        assert.equal(message.payload.token, 'ready-token');
        imports += 1;
        return { handled: true, ok: true, state: 'completed', token: 'ready-token', view: {
          statusLabel: 'Import vérifié', primaryAction: { id: 'none' }
        } };
      }
      assert.equal(message.type, 'CARDINAL_FORMATIVE_IMPORT_PREPARE');
      preparations += 1;
      return { handled: true, ok: true, state: 'ready', token: 'ready-token', view: {
        statusLabel: 'Prêt', primaryAction: { id: 'import', label: 'Importer dans Formative', enabled: true },
        showCorrectionButton: true, validationRows: Presentation.buildValidationRows(pkg)
      } };
    }
  };
  const bridge = Content.createContentBridge({ document: doc, runtime, scanner: Scanner, parser: Parser, errorPresenter: Errors });
  await bridge.scanNow();
  assert.equal(assistant.children[1].dataset.cardinalFormativeSignature != null, true);
  assert.equal(assistant.children[1].children.some(child => child.tagName === 'BUTTON' && child.textContent === 'Importer dans Formative'), true);
  assert.equal(code.style.display, 'none');
  assert.equal(preparations, 1);
  const reviewButton = assistant.children[1].children.find(child => child.tagName === 'BUTTON' && child.textContent === 'Voir le corrigé préparé');
  reviewButton.click();
  assert(assistant.children[1].textContent.includes('cancer de la thyroïde'));
  assert(assistant.children[1].textContent.includes('Terme à vérifier : cancer'));

  // ChatGPT can replace the response subtree without changing the package.
  // The next scan must restore a bar that React removed from the DOM.
  assistant.children[1].remove();
  await bridge.scanNow();
  assert.equal(assistant.children[1].dataset.cardinalFormativeSignature != null, true);
  assert.equal(assistant.children[1].children.some(child => child.tagName === 'BUTTON' && child.textContent === 'Importer dans Formative'), true);
  const importButton = assistant.children[1].children.find(child => child.tagName === 'BUTTON' && child.textContent === 'Importer dans Formative');
  await importButton.click();
  assert.equal(imports, 1);
  console.log('chatgpt-import-bar-v2: all tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
