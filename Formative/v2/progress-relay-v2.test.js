'use strict';

const assert = require('node:assert/strict');
const R = require('./progress-relay-v2.js');

(async () => {
  // The first progress event binds the run to the exact ChatGPT tab that issued
  // PREPARE. Later controller state adds only the chosen Formative tab.
  {
    const sent = [];
    const relay = R.createRelay({
      sendToTab: async (tabId, message) => sent.push({ tabId, message })
    });

    relay.bindCommandContext({ role: 'chatgpt', tabId: 11 });
    await relay.sink({
      schema: 'cardinal.progress/1',
      module: 'formative',
      runId: 'ui-1',
      stage: 'DETECTING',
      percent: 5,
      label: 'Détection'
    });
    assert.deepEqual(sent.map(x => x.tabId), [11]);

    relay.handleState({
      token: 'ui-1',
      targetTabId: 22,
      targetFormativeId: 'form-a',
      prepared: { pkg: { secret: 'must-not-be-stored' } }
    });
    await relay.sink({
      runId: 'ui-1',
      stage: 'IMPORTING',
      percent: 60,
      detail: { itemId: 'q3', action: 'update' }
    });
    assert.deepEqual(sent.slice(-2).map(x => x.tabId), [11, 22]);
    assert.equal(JSON.stringify(relay.snapshot()).includes('must-not-be-stored'), false);
  }

  // Two ChatGPT tabs preparing near each other keep separate run bindings. A
  // later command origin must not steal progress from an older run.
  {
    const sent = [];
    const relay = R.createRelay({ sendToTab: async (tabId, message) => sent.push([tabId, message.payload.runId]) });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 1 });
    await relay.sink({ runId: 'run-a', stage: 'DETECTING' });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 2 });
    await relay.sink({ runId: 'run-b', stage: 'DETECTING' });
    await relay.sink({ runId: 'run-a', stage: 'READY' });
    assert.deepEqual(sent, [[1, 'run-a'], [2, 'run-b'], [1, 'run-a']]);
  }

  // Popup/extension commands clear only the pending origin. They never rebind a
  // new run to a stale ChatGPT tab, but existing run bindings remain valid.
  {
    const sent = [];
    const relay = R.createRelay({ sendToTab: async tabId => sent.push(tabId) });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 7 });
    await relay.sink({ runId: 'existing', stage: 'DETECTING' });
    relay.bindCommandContext({ role: 'extension-page' });
    await relay.sink({ runId: 'popup-run', stage: 'DETECTING' });
    await relay.sink({ runId: 'existing', stage: 'READY' });
    assert.deepEqual(sent, [7, 7]);
  }

  // Missing ChatGPT tab identity fails closed rather than broadcasting progress.
  {
    const relay = R.createRelay({ sendToTab: async () => {} });
    assert.throws(
      () => relay.bindCommandContext({ role: 'chatgpt' }),
      error => error.code === 'IMPORTER_COMMAND_TAB_REQUIRED' && error.mutationMayHaveCommitted === false
    );
  }

  // Technical detail is stripped. Only the small UI detail allow-list survives.
  {
    const sent = [];
    const relay = R.createRelay({ sendToTab: async (_tabId, message) => sent.push(message) });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 8 });
    await relay.sink({
      runId: 'r',
      stage: 'IMPORTING',
      detail: {
        itemId: 'q1',
        action: 'update',
        targetTitle: 'Test',
        authorization: 'Bearer secret',
        journal: { hidden: true },
        pkg: { hidden: true }
      },
      rawServerResponse: { hidden: true }
    });
    const json = JSON.stringify(sent[0]);
    assert(json.includes('q1'));
    assert.equal(json.includes('Bearer secret'), false);
    assert.equal(json.includes('journal'), false);
    assert.equal(json.includes('rawServerResponse'), false);
  }

  // A detached Formative/ChatGPT tab is a display problem only. The relay
  // swallows it and reports the failed destination without throwing.
  {
    const relay = R.createRelay({
      sendToTab: async tabId => {
        if (tabId === 13) throw Object.assign(new Error('No tab'), { code: 'TAB_GONE' });
      }
    });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 13 });
    relay.handleState({ token: 'r', targetTabId: 14, targetFormativeId: 'f' });
    const result = await relay.sink({ runId: 'r', stage: 'IMPORTING' });
    assert.equal(result.sent, 1);
    assert.equal(result.destinations.length, 2);
    assert.equal(result.destinations.find(x => x.tabId === 13).sent, false);
    assert.equal(result.destinations.find(x => x.tabId === 14).sent, true);
  }

  // Closing a tab removes it from all exact routes. No fallback/broadcast is
  // introduced after cleanup.
  {
    const sent = [];
    const relay = R.createRelay({ sendToTab: async tabId => sent.push(tabId) });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 3 });
    await relay.sink({ runId: 'r', stage: 'DETECTING' });
    relay.handleState({ token: 'r', targetTabId: 4 });
    assert(relay.clearTab(3) >= 1);
    await relay.sink({ runId: 'r', stage: 'IMPORTING' });
    assert.deepEqual(sent, [3, 4]);
  }

  // Binding memory is bounded so many old chats cannot grow the service worker
  // indefinitely.
  {
    const relay = R.createRelay({ sendToTab: async () => {}, maxBindings: 2 });
    relay.bindCommandContext({ role: 'chatgpt', tabId: 1 });
    await relay.sink({ runId: 'a', stage: 'DETECTING' });
    await relay.sink({ runId: 'b', stage: 'DETECTING' });
    await relay.sink({ runId: 'c', stage: 'DETECTING' });
    assert.deepEqual(relay.snapshot().bindings.map(x => x.runId), ['b', 'c']);
  }

  console.log('progress-relay-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
