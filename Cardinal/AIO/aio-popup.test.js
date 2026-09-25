'use strict';

const assert = require('node:assert/strict');
const Popup = require('./aio-popup.js');
const FormativeContent = require('../../Formative/v2/chatgpt-content-v2.js');
const FormativePopup = require('../../Formative/v2/popup-v2.js');
const PrepareHelper = require('../../Formative/v2/chatgpt-prepare-helper-v2.js');

assert.deepEqual(
  Popup.MODULES.map(module => module.label),
  [
    'Gestion 1.1.9',
    'Correction Formative 1.1.3',
    'Importateur Formative 0.5 RC1',
    'Mozaïk v14',
    'Pont Classroom 1.2.3',
    'Pont ChatGPT 1.1.9'
  ],
  'the RC2 dashboard contract must keep exactly the six documented modules'
);

for (const [url, expected] of [
  ['https://techno-cardi.github.io/Exercices-francais/resultats/', 'gestion'],
  ['https://app.formative.com/formatives/abc/results', 'formative'],
  ['https://chatgpt.com/c/abc', 'chatgpt'],
  ['https://chat.openai.com/c/abc', 'chatgpt'],
  ['https://classroom.google.com/c/MTIz', 'classroom'],
  ['https://mozaikportail.ca/', 'mozaik'],
  ['https://example.com/', 'generic'],
  ['https://evil.example/?next=https://chatgpt.com', 'generic']
]) {
  assert.equal(Popup.classifyContext(url), expected, url);
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://example.com/',
    importerConfirmed: false,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  assert.equal(model.modules.length, 6);
  assert(model.modules.every(module => module.state === 'neutral'));
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://chatgpt.com/c/test',
    importerConfirmed: true,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  const importer = model.modules.find(module => module.id === 'formativeImporter');
  const chatgpt = model.modules.find(module => module.id === 'chatgpt');
  assert.equal(importer.state, 'ok');
  assert.equal(importer.detail, 'Actif');
  assert.equal(chatgpt.state, 'context');
  assert.equal(chatgpt.detail, 'Page ouverte');
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://chatgpt.com/c/test',
    importerConfirmed: true,
    formativeAssessmentCount: 2,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  const importer = model.modules.find(module => module.id === 'formativeImporter');
  assert.equal(importer.detail, 'Actif · 2 évaluations ouvertes');
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://chatgpt.com/c/test',
    importerConfirmed: true,
    formativeAssessmentCount: 2,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  assert.equal(Popup.contextLabel(model.context), 'ChatGPT');
  assert.match(Popup.compactStatus(model), /6 modules intégrés/);
  assert.match(Popup.compactStatus(model), /2 évaluations ouvertes/);
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://classroom.google.com/c/MTIz',
    importerConfirmed: false,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  const classroom = model.modules.find(module => module.id === 'classroom');
  assert.equal(classroom.state, 'attention');
  assert.match(classroom.detail, /liaison/i);
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://classroom.google.com/c/MTIz',
    importerConfirmed: false,
    classroomBridgeConfirmed: true,
    classroomGroupCount: 2
  });
  const classroom = model.modules.find(module => module.id === 'classroom');
  assert.equal(classroom.state, 'ok');
  assert.equal(classroom.detail, 'Actif · 2 liaisons');
}

{
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'aio-popup.js'), 'utf8');
  for (const forbidden of ['innerHTML =', 'eval(', 'new Function(', 'document.write(', 'debugger;']) {
    assert.equal(source.includes(forbidden), false, `forbidden popup construct: ${forbidden}`);
  }
}


assert.equal(Popup.UI_RESCAN_MESSAGE, 'CARDINAL_FORMATIVE_UI_RESCAN');
assert.equal(Popup.PREPARE_MESSAGE, 'CARDINAL_FORMATIVE_PREPARE_CHATGPT');
assert.equal(Popup.PREPARE_MESSAGE, PrepareHelper.PREPARE_MESSAGE);
assert.equal(Popup.DISMISS_STORAGE_KEY, 'cardinal.formative.v2.ui.dismissed');
assert.equal(Popup.UI_RESCAN_MESSAGE, FormativeContent.UI_RESCAN_MESSAGE);
assert.equal(Popup.UI_RESCAN_MESSAGE, FormativePopup.UI_RESCAN_MESSAGE);
assert.equal(Popup.DISMISS_STORAGE_KEY, FormativeContent.DISMISS_STORAGE_KEY);
assert.equal(Popup.DISMISS_STORAGE_KEY, FormativePopup.DISMISS_STORAGE_KEY);

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://chatgpt.com/c/recovery',
    importerConfirmed: true,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  assert.deepEqual(
    model.actions.map(action => action.id),
    ['formative-prepare', 'formative-rescan', 'formative-restore'],
    'ChatGPT context must expose prepare plus the two standalone Formative recovery actions'
  );
}

{
  const model = Popup.buildDashboardModel({
    activeUrl: 'https://app.formative.com/formatives/abc/results',
    importerConfirmed: true,
    classroomBridgeConfirmed: false,
    classroomGroupCount: 0
  });
  assert.deepEqual(model.actions, [], 'Formative recovery actions must remain ChatGPT-only');
}

(async () => {
  {
    let copied = '';
    const field = {
      style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() {}
    };
    const doc = {
      documentElement: { appendChild(node) { copied = node.value; } },
      createElement() { return field; },
      execCommand(command) { return command === 'copy'; }
    };
    assert.equal(await Popup.copyText('Consigne Formative', {
      clipboard: { async writeText() { throw new Error('permission denied'); } }, document: doc
    }), true);
    assert.equal(copied, 'Consigne Formative');
  }
  const sent = [];
  const removed = [];
  const copied = [];
  const chromeApi = {
    tabs: {
      async query(info) {
        if (info.active) return [{ id: 42, url: 'https://chatgpt.com/c/test' }];
        return [];
      },
      async sendMessage(tabId, message) {
        sent.push({ tabId, message });
        if (message.type === Popup.PREPARE_MESSAGE) {
          return { ok: true, prompt: '[Cardinal Formative]\nConsigne compacte' };
        }
        return { ok: true };
      }
    },
    storage: {
      local: {
        async get() { return {}; },
        async remove(key) { removed.push(key); }
      }
    },
    runtime: {
      id: 'cardinal-aio-test',
      async sendMessage() { return { handled: true, ok: true, state: 'idle' }; }
    }
  };

  assert.equal(
    await Popup.runAction('formative-prepare', chromeApi, { copyText: async value => { copied.push(value); return true; } }),
    'Prompt copié. Colle-le à la fin de ta demande ChatGPT.'
  );
  assert.deepEqual(copied, ['[Cardinal Formative]\nConsigne compacte']);
  await assert.rejects(
    Popup.runAction('formative-prepare', chromeApi, { copyText: async () => false }),
    /Impossible de copier le prompt/
  );
  assert.deepEqual(sent.pop(), { tabId: 42, message: { type: Popup.PREPARE_MESSAGE } });

  assert.equal(await Popup.runAction('formative-rescan', chromeApi), 'Analyse relancée dans ChatGPT.');
  assert.deepEqual(sent.pop(), { tabId: 42, message: { type: Popup.UI_RESCAN_MESSAGE } });

  assert.equal(await Popup.runAction('formative-restore', chromeApi), 'Barres masquées réactivées.');
  assert.deepEqual(removed, [Popup.DISMISS_STORAGE_KEY]);
  assert.deepEqual(sent.pop(), { tabId: 42, message: { type: Popup.UI_RESCAN_MESSAGE } });
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});



(async () => {
  let sends = 0;
  const injections = [];
  const chromeApi = {
    tabs: {
      async query(info) {
        if (info.active) return [{ id: 77, url: 'https://chatgpt.com/c/recovery' }];
        return [];
      },
      async sendMessage(tabId, message) {
        assert.equal(tabId, 77);
        assert.equal(message.type, Popup.UI_RESCAN_MESSAGE);
        sends += 1;
        if (sends === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
        return { ok: true, scanned: true, packages: 1, bars: 1 };
      }
    },
    scripting: {
      async executeScript(details) {
        injections.push(details);
        return [];
      }
    }
  };

  assert.equal(
    await Popup.rescanChatGpt(chromeApi),
    'Scanner réinjecté · 1 paquet Cardinal détecté.'
  );
  assert.equal(sends, 2, 'recovery must retry the scan after injection');
  assert.equal(injections.length, 1);
  assert.deepEqual(injections[0].target, { tabId: 77 });
  assert.deepEqual(injections[0].files, Popup.CHATGPT_RECOVERY_SCRIPTS);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

console.log('aio-popup: six-module contextual dashboard contract OK');
