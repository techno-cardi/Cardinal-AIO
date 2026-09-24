'use strict';

const assert = require('node:assert/strict');
const appApi = require('./extension-app-v2.js');
const targetEnumeratorApi = require('./target-enumerator-v2.js');
const targetSelector = require('./target-selector-v2.js');
const sessionBootstrapApi = require('./session-bootstrap-v2.js');
const sessionCaptureBridgeApi = require('./session-capture-bridge-v2.js');
const progressApi = require('./progress-v2.js');
const errorPresenter = require('./error-presenter-v2.js');
const progressRelayApi = require('./progress-relay-v2.js');
const controllerApi = require('./browser-controller-v2.js');
const routerApi = require('./runtime-message-router-v2.js');
const serviceWorkerBridgeApi = require('./service-worker-bridge-v2.js');

function memoryArea() {
  const map = new Map();
  return {
    async get(key) {
      if (key == null) return Object.fromEntries(map);
      if (Array.isArray(key)) {
        const out = {};
        for (const item of key) if (map.has(item)) out[item] = map.get(item);
        return out;
      }
      return map.has(key) ? { [key]: map.get(key) } : {};
    },
    async set(values) { for (const [key, value] of Object.entries(values || {})) map.set(key, value); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); }
  };
}

function chromeHarness() {
  const sent = [];
  const reloads = [];
  const tabs = new Map([
    [10, { id: 10, url: 'https://chatgpt.com/c/abc', title: 'ChatGPT', active: true }],
    [20, { id: 20, url: 'https://app.formative.com/formatives/form-a', title: 'Évaluation A', active: false }]
  ]);
  const runtimeListeners = new Set();
  const removedListeners = new Set();
  const updatedListeners = new Set();

  const chromeApi = {
    runtime: {
      id: 'ext-1',
      onMessage: {
        addListener(fn) { runtimeListeners.add(fn); },
        removeListener(fn) { runtimeListeners.delete(fn); }
      }
    },
    tabs: {
      async get(tabId) {
        if (!tabs.has(tabId)) throw new Error('No tab');
        return { ...tabs.get(tabId) };
      },
      async query() {
        return [...tabs.values()].filter(tab => String(tab.url).startsWith('https://app.formative.com/'));
      },
      async sendMessage(tabId, message) {
        if (!tabs.has(tabId)) throw new Error('No tab');
        sent.push({ tabId, message });
      },
      async reload(tabId) {
        reloads.push(tabId);
        for (const listener of [...updatedListeners]) listener(tabId, { status: 'loading' });
        queueMicrotask(() => {
          for (const listener of [...updatedListeners]) listener(tabId, { status: 'complete' });
        });
      },
      onUpdated: {
        addListener(fn) { updatedListeners.add(fn); },
        removeListener(fn) { updatedListeners.delete(fn); }
      },
      onRemoved: {
        addListener(fn) { removedListeners.add(fn); },
        removeListener(fn) { removedListeners.delete(fn); }
      }
    },
    storage: {
      session: memoryArea(),
      local: memoryArea()
    }
  };

  async function dispatch(message, sender) {
    const listeners = [...runtimeListeners];
    let asyncResponse = null;
    for (const listener of listeners) {
      let syncValue;
      const responsePromise = new Promise(resolve => {
        const keep = listener(message, sender, value => {
          syncValue = value;
          resolve({ responded: true, value });
        });
        if (keep !== true) resolve({ responded: syncValue !== undefined, value: syncValue });
      });
      const result = await responsePromise;
      if (result.responded) asyncResponse = result.value;
    }
    return asyncResponse;
  }

  async function dispatchTabRemoved(tabId) {
    for (const listener of [...removedListeners]) listener(tabId, { isWindowClosing: false, windowId: 1 });
    await new Promise(resolve => setImmediate(resolve));
  }

  return {
    chromeApi,
    tabs,
    sent,
    reloads,
    runtimeListeners,
    removedListeners,
    updatedListeners,
    dispatch,
    dispatchTabRemoved
  };
}

function productHarness(options = {}) {
  const calls = [];
  let inspectCount = 0;
  const product = {
    async inspectTarget(input) {
      inspectCount += 1;
      calls.push(['inspectTarget', input]);
      if (options.failFirstInspectWithSession && inspectCount === 1) {
        const error = new Error('session missing');
        error.code = 'SESSION_REAUTH_REQUIRED';
        throw error;
      }
      return {
        targetFormativeId: input.targetFormativeId,
        urlTargetFormativeId: input.targetFormativeId,
        serverTargetFormativeId: input.targetFormativeId,
        tabId: input.targetTabId,
        title: 'Évaluation A',
        canEdit: true,
        authState: 'authenticated',
        pageKind: 'editor',
        observedAt: Date.now(),
        explicitTabBinding: true,
        candidateTargetIds: [input.targetFormativeId]
      };
    },
    async prepare(input) {
      calls.push(['prepare', input]);
      return {
        ok: true,
        state: 'ready',
        targetFormativeId: input.targetFormativeId,
        targetTabId: input.targetTabId,
        packageFingerprint: 'pkg-1',
        runId: 'run-1',
        view: {
          statusLabel: '✓ Prêt',
          primaryAction: { id: 'import', label: 'Importer dans Formative', enabled: true }
        }
      };
    },
    async execute(prepared, input) {
      calls.push(['execute', prepared, input]);
      return {
        state: 'completed',
        view: { statusLabel: '✓ Import vérifié', primaryAction: { id: 'reimport', enabled: true } }
      };
    },
    async confirmReconciliation(prepared, input) {
      calls.push(['confirm', prepared, input]);
      return { ...prepared, ok: true, state: 'ready' };
    },
    async captureSession(headers, meta) {
      calls.push(['captureSession', headers, meta]);
      return { ok: true };
    },
    async clearSession(tabId = null) {
      calls.push(['clearSession', tabId]);
    }
  };
  return { product, calls };
}

const productionStackStub = { createProductionStack() { throw new Error('must not be called with injected product'); } };

function createApp(h, p, extra = {}) {
  let token = 0;
  return appApi.createApp({
    chromeApi: h.chromeApi,
    product: p.product,
    productionStackApi: productionStackStub,
    targetEnumeratorApi,
    targetSelector,
    sessionBootstrapApi,
    sessionCaptureBridgeApi,
    progressApi,
    errorPresenter,
    progressRelayApi,
    controllerApi,
    routerApi,
    serviceWorkerBridgeApi,
    tokenFactory: () => `ui-${++token}`,
    importerVersion: '0.5.0-test',
    sessionBootstrapPause: async () => {},
    sessionBootstrapTimeoutMs: 20,
    ...extra
  });
}

const PKG = { schema: 'cardinal.formative/2', protocolVersion: '2.0.0', packageMode: 'full', assessment: {}, sources: [], items: [], issues: [] };

(async () => {
  {
    const h = chromeHarness();
    const reader = appApi.createPageContextReader(h.chromeApi.tabs, targetEnumeratorApi);
    const ok = await reader({ targetTabId: 20, targetFormativeId: 'form-a' });
    assert.equal(ok.targetFormativeId, 'form-a');
    assert.equal(ok.explicitTabBinding, true);

    h.tabs.set(20, { id: 20, url: 'https://app.formative.com/formatives/form-b', title: 'B' });
    await assert.rejects(
      reader({ targetTabId: 20, targetFormativeId: 'form-a' }),
      error => error.code === 'REQUESTED_TARGET_TAB_MISMATCH' && error.mutationMayHaveCommitted === false
    );

    h.tabs.delete(20);
    await assert.rejects(
      reader({ targetTabId: 20, targetFormativeId: 'form-a' }),
      error => error.code === 'REQUESTED_TAB_NOT_FOUND'
    );
  }

  // Importer and session capture use separate listeners and do not consume
  // Gestion des notes / Mozaïk messages. Both tab lifecycle listeners must
  // coexist: one clears progress routing, the other clears volatile auth.
  {
    const h = chromeHarness();
    const p = productHarness();
    const app = createApp(h, p);
    app.attach();
    assert.equal(h.runtimeListeners.size, 2);
    assert.equal(h.removedListeners.size, 2);
    assert.equal(h.updatedListeners.size, 1);

    const response = await h.dispatch({
      type: routerApi.TYPES.PREPARE,
      requestId: 'req-1',
      payload: { pkg: PKG }
    }, {
      id: 'ext-1',
      url: 'https://chatgpt.com/c/abc',
      tab: { id: 10 }
    });

    assert.equal(response.ok, true);
    assert.equal(response.targetFormativeId, 'form-a');
    assert.equal(response.targetTabId, 20);
    assert.equal(p.calls.filter(x => x[0] === 'prepare').length, 1);

    const apply = await h.dispatch({
      type: routerApi.TYPES.APPLY,
      payload: { token: response.token }
    }, {
      id: 'ext-1',
      url: 'https://chatgpt.com/c/abc',
      tab: { id: 10 }
    });
    assert.equal(apply.state, 'completed');

    const destinations = new Set(h.sent.map(row => row.tabId));
    assert(destinations.has(10));
    assert(destinations.has(20));
    for (const row of h.sent) assert.equal(row.message.type, 'CARDINAL_FORMATIVE_IMPORT_PROGRESS');

    const before = p.calls.length;
    const hostResult = await h.dispatch({ type: 'MOZAIK_EXTENSION_SYNC' }, { id: 'ext-1' });
    assert.equal(hostResult, null);
    assert.equal(p.calls.length, before);

    const captured = await h.dispatch({
      type: sessionCaptureBridgeApi.MESSAGE_TYPE,
      headers: { authorization: 'Bearer local', 'x-session-id': 's' }
    }, {
      id: 'ext-1',
      url: 'https://app.formative.com/formatives/form-a',
      tab: { id: 20, url: 'https://app.formative.com/formatives/form-a' }
    });
    assert.equal(captured.ok, true);
    assert.equal(p.calls.filter(x => x[0] === 'captureSession').length, 1);
    assert.equal(p.calls.find(x => x[0] === 'captureSession')[2].tabId, 20);

    await h.dispatchTabRemoved(20);
    assert.deepEqual(p.calls.filter(x => x[0] === 'clearSession'), [['clearSession', 20]]);

    assert.equal(app.detach(), true);
    assert.equal(h.runtimeListeners.size, 0);
    assert.equal(h.removedListeners.size, 0);
    assert.equal(h.updatedListeners.size, 0);
  }

  // A cold 0.5.x session gets one safe bootstrap reload during target probing.
  // The navigation invalidates stale auth for that tab before the newly loaded
  // Formative page captures its current session. The import command is not replayed.
  {
    const h = chromeHarness();
    const p = productHarness({ failFirstInspectWithSession: true });
    const app = createApp(h, p);
    app.attach();

    const response = await h.dispatch({
      type: routerApi.TYPES.PREPARE,
      requestId: 'bootstrap-1',
      payload: { pkg: PKG }
    }, {
      id: 'ext-1',
      url: 'https://chatgpt.com/c/bootstrap',
      tab: { id: 10 }
    });

    assert.equal(response.ok, true);
    assert.deepEqual(h.reloads, [20]);
    assert.deepEqual(p.calls.filter(x => x[0] === 'clearSession'), [['clearSession', 20]]);
    assert.equal(p.calls.filter(x => x[0] === 'inspectTarget').length, 2);
    assert.equal(p.calls.filter(x => x[0] === 'prepare').length, 1);
    app.detach();
    assert.equal(h.removedListeners.size, 0);
    assert.equal(h.updatedListeners.size, 0);
  }

  console.log('extension-app-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
