'use strict';

const assert = require('node:assert/strict');
const R = require('./runtime-message-router-v2.js');
const errorPresenter = require('./error-presenter-v2.js');

function harness(options = {}) {
  const calls = [];
  let snapshot = null;
  const controller = {
    async preparePackage(payload) {
      calls.push(['prepare', payload]);
      snapshot = {
        token: 'ui-1', targetFormativeId: 'form-1', targetTabId: 9,
        state: 'ready', view: { statusLabel: '✓ Prêt' }
      };
      return {
        ok: true,
        state: 'ready',
        token: 'ui-1',
        targetFormativeId: 'form-1',
        targetTabId: 9,
        prepared: {
          packageFingerprint: 'pkg-1',
          runId: 'run-1',
          pkg: { giant: 'must-not-escape' },
          secretInternalObject: true
        },
        view: { statusLabel: '✓ Prêt' }
      };
    },
    async execute(token, input) {
      calls.push(['execute', token, input]);
      return {
        ok: true,
        state: 'completed',
        token,
        targetFormativeId: 'form-1',
        targetTabId: 9,
        result: {
          view: { statusLabel: '✓ Import vérifié' },
          journal: { operations: [{ technical: 'must-not-escape' }] }
        }
      };
    },
    async reprepare(token) {
      calls.push(['reprepare', token]);
      return { ok: true, state: 'ready', token: 'ui-2', view: { statusLabel: '✓ Prêt' } };
    },
    async confirmReconciliation(token, input) {
      calls.push(['reconcile', token, input]);
      return { ok: true, state: 'ready', token, view: { statusLabel: '✓ Prêt' } };
    },
    dismiss(token) {
      calls.push(['dismiss', token]);
      return token === 'ui-1';
    },
    snapshot() {
      calls.push(['snapshot']);
      return snapshot;
    }
  };

  const router = R.createRouter({
    controller,
    errorPresenter,
    extensionId: 'ext-1',
    maxPackageBytes: options.maxPackageBytes || 1024 * 1024
  });
  return { router, controller, calls, setSnapshot(value) { snapshot = value; } };
}

const chatgptSender = { id: 'ext-1', url: 'https://chatgpt.com/c/abc' };
const oldChatgptSender = { id: 'ext-1', url: 'https://chat.openai.com/c/abc' };
const formativeSender = { id: 'ext-1', url: 'https://app.formative.com/formatives/form-1' };
const popupSender = { id: 'ext-1', url: 'chrome-extension://ext-1/popup.html' };

(async () => {
  // Role classification is exact and does not treat arbitrary HTTPS pages as a
  // trusted command surface.
  {
    assert.equal(R.senderRole(chatgptSender, 'ext-1'), R.SOURCE_CHATGPT);
    assert.equal(R.senderRole(oldChatgptSender, 'ext-1'), R.SOURCE_CHATGPT);
    assert.equal(R.senderRole(formativeSender, 'ext-1'), R.SOURCE_FORMATIVE);
    assert.equal(R.senderRole(popupSender, 'ext-1'), R.SOURCE_EXTENSION);
    assert.equal(R.senderRole({ id: 'ext-1', url: 'https://example.com/' }, 'ext-1'), R.SOURCE_UNKNOWN);
    assert.equal(R.senderRole({ id: 'other', url: 'https://chatgpt.com/' }, 'ext-1'), R.SOURCE_UNKNOWN);
  }

  // Exact ownership only: existing Gestion/Formative and Mozaïk messages must
  // flow past this router untouched. Even an unknown future importer-prefixed
  // message is delegated instead of being swallowed by a catch-all.
  {
    const h = harness();
    for (const message of [
      { type: 'MOZAIK_EXTENSION_SYNC' },
      { type: 'FORMATIVE_REQUEST' },
      { type: 'FORMATIVE_IMPORT_AVAILABLE' },
      { type: 'CARDINAL_FORMATIVE_IMPORT_FUTURE_THING' },
      { type: 'unrelated' },
      null
    ]) {
      assert.equal(h.router.owns(message), false);
      assert.deepEqual(await h.router.route(message, chatgptSender), { handled: false });
    }
    assert.equal(h.calls.length, 0);
  }

  // Prepare from ChatGPT works, requestId is correlated, but the technical
  // prepared object/package never escapes back to the content script.
  {
    const h = harness();
    const response = await h.router.route({
      type: R.TYPES.PREPARE,
      requestId: 'req-1',
      payload: { pkg: { schema: 'cardinal.formative/2', items: [] } }
    }, chatgptSender);
    assert.equal(response.handled, true);
    assert.equal(response.ok, true);
    assert.equal(response.requestId, 'req-1');
    assert.equal(response.token, 'ui-1');
    assert.equal(response.packageFingerprint, 'pkg-1');
    assert.equal(response.runId, 'run-1');
    assert.equal(Object.prototype.hasOwnProperty.call(response, 'prepared'), false);
    assert.equal(JSON.stringify(response).includes('must-not-escape'), false);
    assert.equal(h.calls.filter(row => row[0] === 'prepare').length, 1);
  }

  // Apply returns only user-facing state/view, not the executor journal.
  {
    const h = harness();
    const response = await h.router.route({
      type: R.TYPES.APPLY,
      requestId: 'req-2',
      payload: { token: 'ui-1', acknowledgeWarnings: true }
    }, chatgptSender);
    assert.equal(response.ok, true);
    assert.equal(response.state, 'completed');
    assert.equal(response.view.statusLabel, '✓ Import vérifié');
    assert.equal(JSON.stringify(response).includes('must-not-escape'), false);
    assert.deepEqual(h.calls.find(row => row[0] === 'execute').slice(1), [
      'ui-1', { acknowledgeWarnings: true }
    ]);
  }

  // Reprepare and reconciliation remain explicit, token-bound commands.
  {
    const h = harness();
    const reprepare = await h.router.route({
      type: R.TYPES.REPREPARE,
      payload: { token: 'ui-1' }
    }, chatgptSender);
    assert.equal(reprepare.token, 'ui-2');

    const reconcile = await h.router.route({
      type: R.TYPES.RECONCILE,
      payload: {
        token: 'ui-1',
        approvedProposals: [{ fingerprint: 'f1', approvalToken: 'a1' }],
        separateProposals: []
      }
    }, chatgptSender);
    assert.equal(reconcile.ok, true);
    const call = h.calls.find(row => row[0] === 'reconcile');
    assert.equal(call[1], 'ui-1');
    assert.deepEqual(call[2].approvedProposals, [{ fingerprint: 'f1', approvalToken: 'a1' }]);
  }

  // Dismiss is routed to the UI-only controller operation.
  {
    const h = harness();
    const response = await h.router.route({
      type: R.TYPES.DISMISS,
      payload: { token: 'ui-1' }
    }, chatgptSender);
    assert.equal(response.ok, true);
    assert.equal(response.state, 'dismissed');
    assert.equal(h.calls.filter(row => row[0] === 'dismiss').length, 1);
  }

  // After a service-worker restart the new controller has no volatile UI state.
  // STATUS must truthfully report idle so the content script can re-prepare its
  // package; it must not fabricate a resumable in-memory token.
  {
    const h = harness();
    const response = await h.router.route({ type: R.TYPES.STATUS, payload: {} }, chatgptSender);
    assert.equal(response.ok, true);
    assert.equal(response.state, 'idle');
    assert.equal(response.token, undefined);
  }

  // Formative content scripts may display progress/session UI but cannot issue
  // mutation commands through the ChatGPT command router.
  {
    const h = harness();
    const response = await h.router.route({
      type: R.TYPES.APPLY,
      payload: { token: 'ui-1' }
    }, formativeSender);
    assert.equal(response.ok, false);
    assert.equal(response.reason, 'IMPORTER_COMMAND_SOURCE_FORBIDDEN');
    assert.equal(h.calls.length, 0);
  }

  // Same-extension popup/extension pages may act as a recovery/control surface.
  {
    const h = harness();
    const response = await h.router.route({ type: R.TYPES.STATUS }, popupSender);
    assert.equal(response.ok, true);
    assert.equal(response.state, 'idle');
  }

  // Wrong extension id and unrelated webpages fail closed even when they know
  // an exact importer message type.
  {
    const h = harness();
    for (const sender of [
      { id: 'other', url: 'https://chatgpt.com/c/x' },
      { id: 'ext-1', url: 'https://example.com/' }
    ]) {
      const response = await h.router.route({
        type: R.TYPES.PREPARE,
        payload: { pkg: { schema: 'x' } }
      }, sender);
      assert.equal(response.ok, false);
      assert.equal(response.reason, 'IMPORTER_COMMAND_SOURCE_FORBIDDEN');
    }
    assert.equal(h.calls.length, 0);
  }

  // Missing or absurdly large packages are rejected before the controller sees
  // them. This also bounds accidental runtime-message amplification.
  {
    const h = harness({ maxPackageBytes: 100 });
    const missing = await h.router.route({ type: R.TYPES.PREPARE, payload: {} }, chatgptSender);
    assert.equal(missing.reason, 'PACKAGE_REQUIRED');

    const huge = await h.router.route({
      type: R.TYPES.PREPARE,
      payload: { pkg: { blob: 'x'.repeat(500) } }
    }, chatgptSender);
    assert.equal(huge.reason, 'PACKAGE_TOO_LARGE');
    assert.equal(h.calls.length, 0);
  }

  // attach() follows Chrome runtime semantics: unowned messages synchronously
  // return false; owned async messages return true and answer later.
  {
    const h = harness();
    let listener = null;
    let removed = null;
    const runtime = {
      onMessage: {
        addListener(fn) { listener = fn; },
        removeListener(fn) { removed = fn; }
      }
    };
    const detach = h.router.attach(runtime);
    assert.equal(typeof listener, 'function');
    assert.equal(listener({ type: 'MOZAIK_EXTENSION_SYNC' }, chatgptSender, () => {}), false);

    const response = await new Promise(resolve => {
      const keepPort = listener({ type: R.TYPES.STATUS }, chatgptSender, resolve);
      assert.equal(keepPort, true);
    });
    assert.equal(response.handled, true);
    assert.equal(response.state, 'idle');

    detach();
    assert.equal(removed, listener);
  }

  

(async () => {
  const calls = [];
  const controller = {
    async preparePackage() { return { ok: true }; },
    async execute() { return { ok: true }; },
    async reprepare(token, pkg) {
      calls.push({ token, pkg });
      return { ok: true, token: 'next' };
    },
    async confirmReconciliation() { return { ok: true }; },
    dismiss() { return true; },
    snapshot() { return null; }
  };
  const router = R.createRouter({ controller });
  const pkg = { schema: 'cardinal.formative/2', packageMode: 'patch' };
  const result = await router.handle({
    type: 'CARDINAL_FORMATIVE_IMPORT_REPREPARE',
    payload: { token: 'old', pkg }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ token: 'old', pkg }]);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

console.log('runtime-message-router-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});