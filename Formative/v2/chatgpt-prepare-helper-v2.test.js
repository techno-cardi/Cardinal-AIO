'use strict';

const assert = require('node:assert/strict');
const H = require('./chatgpt-prepare-helper-v2.js');
const Capabilities = require('./capabilities-v2.js');

(async () => {
  assert.equal(H.isChatGptLocation({ hostname: 'chatgpt.com' }), true);
  assert.equal(H.isChatGptLocation({ hostname: 'chat.openai.com' }), true);
  assert.equal(H.isChatGptLocation({ hostname: 'example.com' }), false);
  assert.equal(H.isAioRuntime({ getManifest() { return { description: 'Cardinal AIO: test' }; } }), true);
  assert.equal(H.isAioRuntime({ getManifest() { return { description: 'Cardinal Formative standalone' }; } }), false);

  assert.deepEqual(
    [...H.PRODUCTION_TYPES].sort(),
    Capabilities.productionQuestionTypes(),
    'the compact ChatGPT contract must advertise exactly the production-safe question types'
  );

  {
    const text = H.triggerText('Prépare cet examen pour Formative.');
    assert(text.startsWith('Prépare cet examen pour Formative.'));
    assert(text.includes(H.PROMPT_MARKER));
    assert(text.includes('CARDINAL_FORMATIVE_COMPACT_V2'));
    assert(text.includes('PDF/DOCX'));
    assert.deepEqual(H.PRODUCTION_TYPES, [
      'shortAnswer', 'longAnswer', 'fillInTheBlank',
      'multipleChoice', 'multipleSelection', 'inlineChoice',
      'resequence', 'matching'
    ]);
    assert(text.includes('PROVEN ici: shortAnswer,longAnswer,fillInTheBlank,multipleChoice,multipleSelection,inlineChoice,resequence,matching'));
    assert(text.includes('menu/catégorie par champ=inlineChoice'));
    assert(text.includes('resequence=>response.sequence[texte]'));
    assert(text.includes('matching=>response.pairs[{left,right}]'));
    assert(text.includes('response.options[{id,text,correct,points?}]'));
    assert(text.includes('TOTAL_POINTS_MISMATCH'));
    assert(text.includes('concepts[{id,label,score,provenance,terms,riskyTerms}]'));
    assert(text.includes('score absolu par match'));
    assert(text.includes('termes discriminants'));
    assert(text.includes('réponse complexe'));
    assert(text.includes('PDF/DOCX'));
    assert(text.includes('paragraphes'));
    assert(text.includes('indépendamment de tout pointage'));
    assert(text.includes('critères de réussite'));
    assert(text.includes('équivalence sémantique'));
    assert(text.includes('traitement cohérent'));
    assert(text.includes('chaque élément séparément'));
    assert(text.includes('ambiguïté raisonnable'));
    assert(text.includes('deuxième passe silencieuse'));
    assert(text.includes('source nécessaire manque'));
    assert(text.includes('référence pédagogique prioritaire'));
    assert(text.includes('angles morts pédagogiques'));
    assert(text.length <= H.MAX_PREPARE_TEXT_CHARS);
    assert(H.COMPACT_PROTOCOL.length < 3500, 'compact contract must stay far below the old 14k prompt');
    assert.equal(H.triggerText(text), text, 'clicking twice must not duplicate the Cardinal instruction');

    const empty = H.triggerText('');
    assert(empty.startsWith('Prépare le dernier examen, questionnaire ou document pédagogique pertinent'));
    assert(empty.length <= H.MAX_PREPARE_TEXT_CHARS);

    const pastedExam = 'Examen à convertir\n' + 'Question détaillée.\n'.repeat(400);
    const longRequest = H.triggerText(pastedExam);
    assert(longRequest.startsWith(pastedExam));
    assert.equal(longRequest.split('CARDINAL_FORMATIVE_COMPACT_V2').length, 2);
    assert(longRequest.length > H.MAX_PREPARE_TEXT_CHARS,
      'the cap protects Cardinal’s added instructions, not the teacher’s source text');
    const appended = H.clipboardText('Transforme la réponse précédente en examen.');
    assert(appended.startsWith(H.PROMPT_MARKER));
    assert(!appended.includes('Transforme la réponse précédente en examen.'));
    assert(appended.length <= H.MAX_PREPARE_TEXT_CHARS);
    assert(H.clipboardText('').startsWith('Prépare le dernier examen'));
    assert.throws(() => H.clipboardText(`${H.PROMPT_MARKER} déjà collé`),
      error => error.code === 'CARDINAL_PREPARE_ALREADY_PRESENT');
  }

  {
    const copied = [];
    const editor = { value: 'Transforme ce PDF et la réponse précédente.' };
    const doc = {
      body: { appendChild() {} }, documentElement: {},
      createElement() { return { style: {}, setAttribute() {} }; },
      getElementById() { return null; }
    };
    const helper = H.createHelper({
      document: doc, runtime: {}, floatingButton: false,
      copyText: async value => { copied.push(value); return true; },
      setTimeout() {}
    });
    assert.equal(await helper.prepare(editor), true);
    assert.equal(editor.value, 'Transforme ce PDF et la réponse précédente.');
    assert.equal(copied.length, 1);
    assert(copied[0].startsWith(H.PROMPT_MARKER));
    assert(!copied[0].includes(editor.value));
  }

  {
    const editor = { value: 'Bonjour', dispatchEvent() {}, focus() {} };
    assert.equal(H.editorText(editor), 'Bonjour');
    assert.equal(H.setEditorText(editor, 'Texte', { window: { Event: class { constructor(type) { this.type = type; } } } }), true);
    assert.equal(editor.value, 'Texte');
  }

  {
    const runtime = { getURL(name) { return `chrome-extension://id/${name}`; } };
    let requested = null;
    const text = await H.loadProtocol(runtime, async url => {
      requested = url;
      return {
        ok: true,
        async text() { return 'Version du protocole: 2.0.0\ncardinal.formative/2'; }
      };
    });
    assert.equal(requested, `chrome-extension://id/${H.PROTOCOL_FILE_NAME}`);
    assert(text.includes('cardinal.formative/2'));

    await assert.rejects(
      H.loadProtocol(runtime, async () => ({ ok: true, async text() { return 'bad'; } })),
      error => error.code === 'CARDINAL_PROTOCOL_ASSET_INVALID'
    );
  }

  {
    class FakeFile {
      constructor(parts, name, options = {}) {
        this.parts = parts;
        this.name = name;
        this.type = options.type;
        this.lastModified = options.lastModified;
      }
    }
    class FakeDataTransfer {
      constructor() {
        this._files = [];
        this.items = { add: file => this._files.push(file) };
      }
      get files() { return this._files; }
    }
    class FakeEvent {
      constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles; }
    }

    const existing = new FakeFile(['pdf'], 'questions.pdf', { type: 'application/pdf' });
    const events = [];
    const input = {
      files: [existing],
      dispatchEvent(event) { events.push(event.type); }
    };
    const result = H.mergeProtocolFile(input, 'Version du protocole: 2.0.0\ncardinal.formative/2', {
      DataTransfer: FakeDataTransfer,
      File: FakeFile,
      Event: FakeEvent
    });
    assert.equal(result.changed, true);
    assert.deepEqual(input.files.map(file => file.name), ['questions.pdf', H.PROTOCOL_FILE_NAME]);
    assert.deepEqual(events, ['input', 'change']);

    const again = H.mergeProtocolFile(input, 'x', {
      DataTransfer: FakeDataTransfer,
      File: FakeFile,
      Event: FakeEvent
    });
    assert.equal(again.changed, false);
    assert.deepEqual(input.files.map(file => file.name), ['questions.pdf', H.PROTOCOL_FILE_NAME]);
  }

  {
    const input = { files: [] };
    const form = {
      innerText: '',
      querySelector(selector) { return selector === 'input[type="file"]' ? input : null; }
    };
    const editor = {
      innerText: '',
      closest(selector) { return selector === 'form' ? form : null; }
    };
    const doc = {
      body: { innerText: `Ancien message avec ${H.PROTOCOL_FILE_NAME}` },
      querySelectorAll() { return [input]; }
    };
    assert.equal(
      H.composerContainsProtocol(doc, editor),
      false,
      'a historical protocol mention elsewhere in the chat must not count as a current attachment'
    );

    input.files = [{ name: H.PROTOCOL_FILE_NAME }];
    assert.equal(
      H.inputContainsProtocol(doc, editor),
      true,
      'the hidden file control may contain the protocol'
    );
    assert.equal(
      H.composerContainsProtocol(doc, editor),
      false,
      'the hidden file control alone must not masquerade as a visible ChatGPT attachment'
    );
    form.innerText = `Pièce jointe: ${H.PROTOCOL_FILE_NAME}`;
    assert.equal(H.composerContainsProtocol(doc, editor), true, 'the active composer must visibly show the attachment');
  }

  {
    const input = { files: [] };
    const draft = `Déjà préparé: ${H.PROTOCOL_FILE_NAME}`;
    const form = {
      innerText: draft,
      querySelector(selector) { return selector === 'input[type="file"]' ? input : null; }
    };
    const editor = {
      innerText: draft,
      closest(selector) { return selector === 'form' ? form : null; }
    };
    const doc = { querySelectorAll() { return [input]; } };
    assert.equal(
      H.composerContainsProtocol(doc, editor),
      false,
      'the filename inside the draft instruction alone must not masquerade as an attachment'
    );
    form.innerText = `${draft}\nPièce jointe: ${H.PROTOCOL_FILE_NAME}`;
    assert.equal(H.composerContainsProtocol(doc, editor), true, 'an attachment chip in the active form must count');
  }

  {
    let formText = '';
    let polls = 0;
    const input = { files: [] };
    const form = {
      get innerText() { return formText; },
      querySelector(selector) { return selector === 'input[type="file"]' ? input : null; }
    };
    const editor = {
      innerText: '',
      closest(selector) { return selector === 'form' ? form : null; }
    };
    const doc = {
      body: { innerText: `Historique: ${H.PROTOCOL_FILE_NAME}` },
      querySelectorAll() { return [input]; }
    };
    const visible = await H.waitForProtocolVisible(doc, {
      editor,
      timeoutMs: 100,
      intervalMs: 1,
      pause: async () => {
        polls += 1;
        if (polls === 2) formText = `Pièce jointe: ${H.PROTOCOL_FILE_NAME}`;
      }
    });
    assert.equal(visible, true);
    assert.equal(polls, 2, 'historical page text must not short-circuit the active-composer wait');
  }

  {
    const doc = {
      querySelector(selector) {
        if (selector === '#prompt-textarea') return { id: 'prompt-textarea' };
        return null;
      }
    };
    assert.equal(H.findEditor(doc).id, 'prompt-textarea');
  }

  // ChatGPT can emit hundreds of DOM mutations while streaming. All mutation,
  // resize and scroll signals within one frame must coalesce into one layout pass.
  {
    let rectReads = 0;
    let observerCallback = null;
    const frameQueue = [];
    const listeners = new Map();
    const form = { querySelector() { return null; } };
    const editor = {
      value: '',
      closest(selector) { return selector === 'form' ? form : null; },
      getBoundingClientRect() {
        rectReads += 1;
        return { left: 100, top: 300, width: 500 };
      }
    };

    function element() {
      return {
        style: {},
        isConnected: false,
        setAttribute() {},
        addEventListener() {},
        remove() { this.isConnected = false; }
      };
    }

    const doc = {
      body: {
        appendChild(node) { node.isConnected = true; }
      },
      documentElement: {},
      querySelector(selector) { return selector === '#prompt-textarea' ? editor : null; },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      createElement() { return element(); }
    };
    const win = {
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }
    };
    class FakeMutationObserver {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { observerCallback = null; }
    }

    const helper = H.createHelper({
      document: doc,
      runtime: {
        getURL() { return 'chrome-extension://id/protocol'; },
        getManifest() { return { description: 'Cardinal Formative standalone' }; },
        onMessage: { addListener() {}, removeListener() {} }
      },
      floatingButton: true,
      location: { hostname: 'chatgpt.com' },
      window: win,
      MutationObserver: FakeMutationObserver,
      requestAnimationFrame(callback) { frameQueue.push(callback); }
    }).start();

    assert.equal(rectReads, 1, 'start performs one immediate placement');
    for (let i = 0; i < 50; i++) observerCallback();
    listeners.get('resize')();
    listeners.get('scroll')();
    assert.equal(frameQueue.length, 1, 'a mutation storm should schedule only one frame');
    assert.equal(rectReads, 1, 'no layout read should happen before the scheduled frame');

    frameQueue.shift()();
    assert.equal(rectReads, 2, 'the coalesced frame performs exactly one new placement');

    helper.stop();
    assert.equal(listeners.size, 0);
  }

  // AIO must remain buttonless on the ChatGPT page and own preparation through
  // an exact runtime message instead of a persistent floating control.
  {
    let listener = null;
    let appended = 0;
    const editor = {
      value: '',
      closest(selector) {
        if (selector !== 'form') return null;
        return {
          innerText: '',
          querySelector() { return null; }
        };
      }
    };
    const doc = {
      body: { appendChild() { appended += 1; } },
      documentElement: {},
      querySelector(selector) { return selector === '#prompt-textarea' ? editor : null; },
      querySelectorAll() { return []; },
      getElementById() { return null; },
      createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, remove() {} }; }
    };
    const runtime = {
      getURL() { return 'chrome-extension://id/protocol'; },
      getManifest() { return { description: 'Cardinal AIO: test' }; },
      onMessage: {
        addListener(fn) { listener = fn; },
        removeListener(fn) { if (listener === fn) listener = null; }
      }
    };
    let fetchCalls = 0;
    const helper = H.createHelper({
      document: doc,
      runtime,
      fetch: async () => {
        fetchCalls += 1;
        throw new Error('prepare must not fetch the large protocol asset');
      },
      location: { hostname: 'chatgpt.com' },
      window: {
        Event: class { constructor(type) { this.type = type; } },
        addEventListener() {},
        removeEventListener() {}
      },
      MutationObserver: null,
      setTimeout() {}
    }).start();

    assert.equal(appended, 0, 'AIO must not append the persistent prepare button');
    assert.equal(typeof listener, 'function', 'AIO must expose the runtime preparation action');
    let foreignClaimed = listener({ type: 'OTHER_MESSAGE' }, {}, () => {});
    assert.equal(foreignClaimed, false, 'foreign runtime messages must not be claimed');

    const prepared = await new Promise(resolve => {
      const claimed = listener({ type: H.PREPARE_MESSAGE }, {}, resolve);
      assert.equal(claimed, true, 'the exact prepare message must be claimed asynchronously');
    });
    assert.equal(prepared.ok, true);
    assert.equal(editor.value, '', 'AIO must not inject text into the ChatGPT composer');
    assert.match(prepared.prompt, /CARDINAL_FORMATIVE_COMPACT_V2/);
    assert.match(prepared.prompt, /Prépare le dernier examen, questionnaire ou document pédagogique pertinent/);
    assert(prepared.prompt.length <= H.MAX_PREPARE_TEXT_CHARS);
    assert.equal(fetchCalls, 0, 'prepare must not load or attach the large markdown protocol');
    assert.doesNotMatch(prepared.prompt, /DÉBUT DU PROTOCOLE CARDINAL FORMATIF/);
    assert.doesNotMatch(prepared.prompt, /visible dans les pièces jointes de ce message/);

    helper.stop();
    assert.equal(listener, null);
  }

  console.log('chatgpt-prepare-helper-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
