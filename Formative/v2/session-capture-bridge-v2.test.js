'use strict';

const assert = require('node:assert/strict');
const S = require('./session-capture-bridge-v2.js');

(async () => {
  assert.equal(S.isFormativePageUrl('https://app.formative.com/formatives/a'), true);
  assert.equal(S.isFormativePageUrl('http://app.formative.com/formatives/a'), false);
  assert.equal(S.isFormativePageUrl('https://evil.example/?app.formative.com'), false);

  assert.equal(S.isFormativeSender({ tab: { id: 20 }, url: 'https://app.formative.com/formatives/a' }), true);
  assert.equal(S.isFormativeSender({ tab: { id: 20 }, url: 'https://chatgpt.com/c/a' }), false);
  assert.equal(S.isFormativeSender({ tab: { id: -1 }, url: 'https://app.formative.com/formatives/a' }), false);

  assert.equal(S.isTrustedFormativeRequest({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    initiator: 'https://app.formative.com'
  }), true);
  assert.equal(S.isTrustedFormativeRequest({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout'
  }), false, 'passive capture without initiator provenance must fail closed');
  assert.equal(S.isTrustedFormativeRequest({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    initiator: 'https://chatgpt.com'
  }), false);

  assert.deepEqual(S.requestHeadersObject([
    { name: 'Authorization', value: 'Bearer x' },
    { name: 'X-Session-Id', value: 's' },
    { name: '', value: 'ignored' }
  ]), { authorization: 'Bearer x', 'x-session-id': 's' });

  const captures = [];
  const clearedTabs = [];
  const product = {
    async captureSession(headers, meta) {
      captures.push({ headers, meta });
      return { ok: true };
    },
    async clearSession(tabId) {
      clearedTabs.push(tabId);
    }
  };

  let runtimeListener = null;
  let requestListener = null;
  let removedListener = null;
  let updatedListener = null;
  let requestExtra = null;
  const runtime = {
    onMessage: {
      addListener(fn) { runtimeListener = fn; },
      removeListener(fn) { if (runtimeListener === fn) runtimeListener = null; }
    }
  };
  const webRequest = {
    onBeforeSendHeaders: {
      addListener(fn, filter, extra) {
        requestListener = fn;
        requestExtra = extra;
        assert.deepEqual(filter, { urls: ['https://svc.goformative.com/*'] });
      },
      removeListener(fn) { if (requestListener === fn) requestListener = null; }
    }
  };
  const tabsApi = {
    onRemoved: {
      addListener(fn) { removedListener = fn; },
      removeListener(fn) { if (removedListener === fn) removedListener = null; }
    },
    onUpdated: {
      addListener(fn) { updatedListener = fn; },
      removeListener(fn) { if (updatedListener === fn) updatedListener = null; }
    }
  };

  const bridge = S.createBridge({ product, runtime, webRequest, tabsApi, console: { warn() {} } });
  const detach = bridge.attach();
  assert.equal(typeof runtimeListener, 'function');
  assert.equal(typeof requestListener, 'function');
  assert.equal(typeof removedListener, 'function');
  assert.equal(typeof updatedListener, 'function');
  assert(requestExtra.includes('requestHeaders'));

  // Host messages are not consumed.
  assert.equal(runtimeListener({ type: 'MOZAIK_EXTENSION_SYNC' }, {}, () => {}), false);

  // Only an actual Formative content-script sender may submit captured headers.
  let rejected = null;
  assert.equal(runtimeListener({
    type: S.MESSAGE_TYPE,
    headers: { authorization: 'Bearer bad' }
  }, {
    url: 'https://chatgpt.com/c/a',
    tab: { id: 10, url: 'https://chatgpt.com/c/a' }
  }, value => { rejected = value; }), false);
  assert.equal(rejected.reason, 'SESSION_CAPTURE_SENDER_REJECTED');
  assert.equal(captures.length, 0);

  const accepted = await new Promise(resolve => {
    const keep = runtimeListener({
      type: S.MESSAGE_TYPE,
      headers: { authorization: 'Bearer content', 'x-session-id': 'content-s' }
    }, {
      url: 'https://app.formative.com/formatives/a',
      tab: { id: 20, url: 'https://app.formative.com/formatives/a' }
    }, resolve);
    assert.equal(keep, true);
  });
  assert.equal(accepted.ok, true);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].meta.source, 'content-bridge');
  assert.equal(captures[0].meta.tabId, 20);

  // Passive webRequest capture is restricted to authenticated GraphQL traffic
  // whose browser origin is explicitly a Formative page.
  requestListener({
    tabId: 20,
    url: 'https://svc.goformative.com/not-graphql',
    initiator: 'https://app.formative.com',
    requestHeaders: [{ name: 'authorization', value: 'Bearer nope' }]
  });
  requestListener({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    initiator: 'https://app.formative.com',
    requestHeaders: [{ name: 'Accept', value: '*/*' }]
  });
  requestListener({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    requestHeaders: [{ name: 'Authorization', value: 'Bearer no-origin' }]
  });
  requestListener({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    initiator: 'https://chatgpt.com',
    requestHeaders: [{ name: 'Authorization', value: 'Bearer wrong-origin' }]
  });
  assert.equal(captures.length, 1);

  requestListener({
    tabId: 20,
    url: 'https://svc.goformative.com/graphql/query/FormativeLayout',
    documentUrl: 'https://app.formative.com/formatives/a',
    requestHeaders: [
      { name: 'Authorization', value: 'Bearer web' },
      { name: 'X-Session-Id', value: 'web-s' }
    ]
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(captures.length, 2);
  assert.equal(captures[1].headers.authorization, 'Bearer web');
  assert.equal(captures[1].meta.source, 'webRequest');
  assert.equal(captures[1].meta.tabId, 20);
  assert.equal(captures[1].meta.sourceUrl, 'https://app.formative.com/formatives/a');

  // A completed/title-only update must not disturb the active session. A new
  // document load can represent reload, logout/login or account switch, so it
  // invalidates the previous tab-bound auth before the new page recaptures it.
  updatedListener(20, { status: 'complete' });
  updatedListener(20, { title: 'Évaluation A' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clearedTabs, []);

  updatedListener(20, { status: 'loading' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clearedTabs, [20]);

  // Closing a tab also disposes only that tab's volatile auth record.
  removedListener(20);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clearedTabs, [20, 20]);

  detach();
  assert.equal(runtimeListener, null);
  assert.equal(requestListener, null);
  assert.equal(removedListener, null);
  assert.equal(updatedListener, null);

  console.log('session-capture-bridge-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
