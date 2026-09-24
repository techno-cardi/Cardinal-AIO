'use strict';

const assert = require('node:assert/strict');
const P = require('./popup-v2.js');
const Chat = require('./chatgpt-content-v2.js');

(async () => {
  assert.equal(P.UI_RESCAN_MESSAGE, Chat.UI_RESCAN_MESSAGE);
  assert.equal(P.DISMISS_STORAGE_KEY, Chat.DISMISS_STORAGE_KEY);

  assert.equal(P.isChatGptUrl('https://chatgpt.com/c/abc'), true);
  assert.equal(P.isChatGptUrl('https://chat.openai.com/c/abc'), true);
  assert.equal(P.isChatGptUrl('https://evil.example/chatgpt.com'), false);
  assert.equal(P.isChatGptUrl('not a url'), false);

  assert.equal(P.isFormativeAssessmentUrl('https://app.formative.com/formatives/abc/edit'), true);
  assert.equal(P.isFormativeAssessmentUrl('https://app.formative.com/dashboard'), false);
  assert.equal(P.isFormativeAssessmentUrl('https://evil.example/formatives/abc'), false);

  {
    const calls = [];
    const tabsApi = {
      async query(info) {
        calls.push(info);
        if (info.active) {
          return [
            { id: 1, url: 'https://example.com/' },
            { id: 2, url: 'https://chatgpt.com/c/abc' }
          ];
        }
        return [
          { id: 3, url: 'https://app.formative.com/dashboard' },
          { id: 4, url: 'https://app.formative.com/formatives/f1' },
          { id: 5, url: 'https://app.formative.com/formatives/f2/edit' }
        ];
      }
    };

    const active = await P.activeChatGptTab(tabsApi);
    assert.equal(active.id, 2);
    const formatives = await P.formativeAssessmentTabs(tabsApi);
    assert.deepEqual(formatives.map(x => x.id), [4, 5]);
    assert.equal(P.formativeStatusText(0), 'Aucun Formative d’évaluation ouvert');
    assert.equal(P.formativeStatusText(1), '1 Formative d’évaluation ouvert');
    assert.equal(P.formativeStatusText(2), '2 Formatives d’évaluation ouverts');
  }

  {
    const removed = [];
    const sent = [];
    const nodes = new Map([
      ['formativeStatus', { textContent: '' }],
      ['chatgptStatus', { textContent: '' }],
      ['rescan', { disabled: false, addEventListener() {} }],
      ['restore', { disabled: false, addEventListener() {} }],
      ['message', { textContent: '' }]
    ]);
    const document = { getElementById(id) { return nodes.get(id) || null; } };
    const chromeApi = {
      tabs: {
        async query(info) {
          if (info.active) return [{ id: 7, url: 'https://chatgpt.com/c/test' }];
          return [{ id: 8, url: 'https://app.formative.com/formatives/f1' }];
        },
        async sendMessage(tabId, message) { sent.push({ tabId, message }); }
      },
      storage: { local: { async remove(key) { removed.push(key); } } }
    };

    const popup = P.createPopup({ document, chromeApi });
    const status = await popup.refreshStatus();
    assert.equal(status.chat.id, 7);
    assert.equal(status.formatives.length, 1);
    assert.equal(nodes.get('formativeStatus').textContent, '1 Formative d’évaluation ouvert');
    assert.equal(await popup.restoreDismissed(), true);
    assert.deepEqual(removed, [P.DISMISS_STORAGE_KEY]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].tabId, 7);
    assert.equal(sent[0].message.type, P.UI_RESCAN_MESSAGE);
  }

  // A non-ChatGPT active tab must not receive an importer message.
  {
    let sent = false;
    const nodes = new Map([
      ['formativeStatus', { textContent: '' }],
      ['chatgptStatus', { textContent: '' }],
      ['rescan', { disabled: false, addEventListener() {} }],
      ['restore', { disabled: false, addEventListener() {} }],
      ['message', { textContent: '' }]
    ]);
    const popup = P.createPopup({
      document: { getElementById(id) { return nodes.get(id) || null; } },
      chromeApi: {
        tabs: {
          async query(info) { return info.active ? [{ id: 9, url: 'https://example.com/' }] : []; },
          async sendMessage() { sent = true; }
        },
        storage: { local: { async remove() {} } }
      }
    });
    assert.equal(await popup.rescan(), false);
    assert.equal(sent, false);
    assert.equal(nodes.get('message').textContent, 'Aucune page ChatGPT active.');
  }

  console.log('popup-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
