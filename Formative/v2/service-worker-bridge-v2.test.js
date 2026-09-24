'use strict';

const assert = require('node:assert/strict');
const bridgeApi = require('./service-worker-bridge-v2.js');
const routerApi = require('./runtime-message-router-v2.js');
const errorPresenter = require('./error-presenter-v2.js');

function harness() {
  const controllerCalls = [];
  const relayCalls = [];
  const controller = {
    async preparePackage(payload) {
      controllerCalls.push(['prepare', payload]);
      return {
        ok: true,
        state: 'ready',
        token: 'ui-1',
        targetFormativeId: 'form-1',
        targetTabId: 30,
        prepared: { packageFingerprint: 'pkg-1', runId: 'run-1' },
        view: { statusLabel: '✓ Prêt' }
      };
    },
    async execute(token, input) {
      controllerCalls.push(['execute', token, input]);
      return { ok: true, state: 'completed', token, view: { statusLabel: '✓ Import vérifié' } };
    },
    async reprepare(token) {
      controllerCalls.push(['reprepare', token]);
      return { ok: true, state: 'ready', token: 'ui-2', view: { statusLabel: '✓ Prêt' } };
    },
    async confirmReconciliation(token, input) {
      controllerCalls.push(['reconcile', token, input]);
      return { ok: true, state: 'ready', token, view: { statusLabel: '✓ Prêt' } };
    },
    dismiss(token) {
      controllerCalls.push(['dismiss', token]);
      return true;
    },
    snapshot() {
      controllerCalls.push(['snapshot']);
      return null;
    }
  };

  const router = routerApi.createRouter({
    controller,
    errorPresenter,
    extensionId: 'ext-1'
  });

  const relay = {
    bindCommandContext(context) {
      relayCalls.push(['bind', { ...context }]);
      if (context.role === 'chatgpt' && !Number.isInteger(context.tabId)) {
        const error = new Error('tab required');
        error.code = 'IMPORTER_COMMAND_TAB_REQUIRED';
        error.mutationMayHaveCommitted = false;
        throw error;
      }
    },
    clearTab(tabId) {
      relayCalls.push(['clear', tabId]);
      return 1;
    }
  };

  let removedListener = null;
  const tabsApi = {
    onRemoved: {
      addListener(fn) { removedListener = fn; },
      removeListener(fn) {
        relayCalls.push(['remove-tab-listener', fn === removedListener]);
      }
    }
  };

  const bridge = bridgeApi.createBridge({ router, relay, errorPresenter, tabsApi });
  return { bridge, router, relay, controllerCalls, relayCalls, tabsApi, getRemovedListener: () => removedListener };
}

const chatgptSender = {
  id: 'ext-1',
  url: 'https://chatgpt.com/c/abc',
  tab: { id: 10 }
};
const formativeSender = {
  id: 'ext-1',
  url: 'https://app.formative.com/formatives/form-1',
  tab: { id: 30 }
};
const popupSender = {
  id: 'ext-1',
  url: 'chrome-extension://ext-1/popup.html'
};

(async () => {
  // ChatGPT commands bind the exact originating tab before entering the router.
  {
    const h = harness();
    const result = await h.bridge.route({
      type: routerApi.TYPES.PREPARE,
      requestId: 'req-1',
      payload: { pkg: { schema: 'cardinal.formative/2', items: [] } }
    }, chatgptSender);
    assert.equal(result.ok, true);
    assert.deepEqual(h.relayCalls[0], ['bind', {
      role: 'chatgpt',
      tabId: 10,
      type: routerApi.TYPES.PREPARE,
      requestId: 'req-1'
    }]);
    assert.equal(h.controllerCalls.filter(x => x[0] === 'prepare').length, 1);
  }

  // Missing sender.tab.id fails before the router/controller. Cardinal does not
  // accept a ChatGPT mutation command if it cannot route state back exactly.
  {
    const h = harness();
    const result = await h.bridge.route({
      type: routerApi.TYPES.PREPARE,
      requestId: 'req-no-tab',
      payload: { pkg: { schema: 'x' } }
    }, { id: 'ext-1', url: 'https://chatgpt.com/c/no-tab' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'IMPORTER_COMMAND_TAB_REQUIRED');
    assert.equal(result.requestId, 'req-no-tab');
    assert.equal(h.controllerCalls.length, 0);
  }

  // Formative cannot influence progress routing and still cannot issue APPLY.
  {
    const h = harness();
    const result = await h.bridge.route({
      type: routerApi.TYPES.APPLY,
      payload: { token: 'ui-1' }
    }, formativeSender);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'IMPORTER_COMMAND_SOURCE_FORBIDDEN');
    assert.equal(h.relayCalls.filter(x => x[0] === 'bind').length, 0);
    assert.equal(h.controllerCalls.length, 0);
  }

  // Popup controls are allowed by the router but explicitly clear pending
  // ChatGPT-origin routing through the relay's extension-page binding policy.
  {
    const h = harness();
    const result = await h.bridge.route({ type: routerApi.TYPES.STATUS }, popupSender);
    assert.equal(result.ok, true);
    assert.equal(result.state, 'idle');
    assert.deepEqual(h.relayCalls[0][1], {
      role: 'extension-page',
      tabId: null,
      type: routerApi.TYPES.STATUS,
      requestId: null
    });
  }

  // Existing Gestion/Mozaïk messages remain completely unowned.
  {
    const h = harness();
    for (const message of [
      { type: 'MOZAIK_EXTENSION_SYNC' },
      { type: 'FORMATIVE_REQUEST' },
      { type: 'FORMATIVE_IMPORT_AVAILABLE' },
      { type: 'CARDINAL_FORMATIVE_IMPORT_FUTURE_UNKNOWN' }
    ]) {
      assert.deepEqual(await h.bridge.route(message, chatgptSender), { handled: false });
    }
    assert.equal(h.relayCalls.length, 0);
    assert.equal(h.controllerCalls.length, 0);
  }

  // attach follows Chrome semantics and cleans relay routes when a tab closes.
  {
    const h = harness();
    let messageListener = null;
    let removedMessageListener = null;
    const runtime = {
      onMessage: {
        addListener(fn) { messageListener = fn; },
        removeListener(fn) { removedMessageListener = fn; }
      }
    };
    const detach = h.bridge.attach(runtime);
    assert.equal(typeof messageListener, 'function');
    assert.equal(typeof h.getRemovedListener(), 'function');

    assert.equal(messageListener({ type: 'MOZAIK_EXTENSION_SYNC' }, chatgptSender, () => {}), false);
    const response = await new Promise(resolve => {
      const keepPort = messageListener({ type: routerApi.TYPES.STATUS }, chatgptSender, resolve);
      assert.equal(keepPort, true);
    });
    assert.equal(response.ok, true);

    h.getRemovedListener()(10);
    assert(h.relayCalls.some(x => x[0] === 'clear' && x[1] === 10));

    detach();
    assert.equal(removedMessageListener, messageListener);
    assert(h.relayCalls.some(x => x[0] === 'remove-tab-listener' && x[1] === true));
  }

  console.log('service-worker-bridge-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
