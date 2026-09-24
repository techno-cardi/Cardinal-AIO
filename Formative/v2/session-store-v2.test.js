'use strict';

const assert = require('node:assert/strict');
const S = require('./session-store-v2.js');

(async () => {
  // Only proven/allowed headers survive capture; cookies and arbitrary fields do not.
  {
    const record = S.createRecord({
      Authorization: 'Bearer SECRET',
      'X-Session-Id': 'SID',
      'X-User-Id': 'UID',
      Cookie: 'NOPE',
      'X-Random': 'NOPE'
    }, { tabId: 7, source: 'unit' }, 1000);
    assert.equal(record.tabId, 7);
    assert.equal(record.headers.authorization, 'Bearer SECRET');
    assert.equal(record.headers.cookie, undefined);
    assert.equal(record.headers['x-random'], undefined);
  }

  // An unbound capture is unsafe because its account/tab provenance is unknown.
  {
    assert.throws(
      () => S.createRecord({ authorization: 'Bearer A' }, {}, 1000),
      error => error.code === 'SESSION_TAB_BINDING_REQUIRED' && error.mutationMayHaveCommitted === false
    );
  }

  // Diagnostics reveal only presence/header names, never values.
  {
    const record = S.createRecord(
      { authorization: 'Bearer SECRET', 'x-session-id': 'SID' },
      { tabId: 8 },
      1000
    );
    const d = S.diagnostics(record, 1500);
    assert.equal(d.available, true);
    assert.equal(d.tabId, 8);
    assert.equal(d.ageMs, 500);
    assert.equal(JSON.stringify(d).includes('SECRET'), false);
    assert.equal(JSON.stringify(d).includes('SID'), false);
  }

  // Storage restores the exact tab session after service worker sleep.
  {
    const area = S.createMemoryArea();
    const store1 = S.createStore(area);
    await store1.capture(
      { authorization: 'Bearer A', 'x-session-id': 'S' },
      { tabId: 4 }
    );
    const store2 = S.createStore(area);
    const headers = await store2.withTabScope(4, () => store2.getRequestHeaders());
    assert.equal(headers.authorization, 'Bearer A');
    assert.equal(headers['x-session-id'], 'S');
    assert.equal(headers['content-type'], 'application/json');
  }

  // No GraphQL request may consume a session outside an explicit tab scope.
  {
    const area = S.createMemoryArea();
    const store = S.createStore(area);
    await store.capture({ authorization: 'Bearer A' }, { tabId: 4 });
    await assert.rejects(
      store.getRequestHeaders(),
      error => error.code === 'SESSION_TAB_BINDING_REQUIRED'
    );
  }

  // Two Formative tabs can hold different accounts/sessions without leakage.
  // Scoped operations are deliberately serialized so legacy nested GraphQL calls
  // cannot switch active tabs midway through one guarded gateway operation.
  {
    const area = S.createMemoryArea();
    const store = S.createStore(area);
    await store.capture({ authorization: 'Bearer TAB4', 'x-session-id': 'S4' }, { tabId: 4 });
    await store.capture({ authorization: 'Bearer TAB9', 'x-session-id': 'S9' }, { tabId: 9 });

    const order = [];
    const first = store.withTabScope(4, async () => {
      order.push('4:start');
      await new Promise(resolve => setImmediate(resolve));
      const headers = await store.getRequestHeaders();
      order.push('4:end');
      return headers.authorization;
    });
    const second = store.withTabScope(9, async () => {
      order.push('9:start');
      const headers = await store.getRequestHeaders();
      order.push('9:end');
      return headers.authorization;
    });

    assert.deepEqual(await Promise.all([first, second]), ['Bearer TAB4', 'Bearer TAB9']);
    assert.deepEqual(order, ['4:start', '4:end', '9:start', '9:end']);

    const aggregate = await store.diagnostics();
    assert.equal(aggregate.available, true);
    assert.equal(aggregate.sessionCount, 2);
    assert.deepEqual(aggregate.tabIds, [4, 9]);
    assert.equal(JSON.stringify(aggregate).includes('TAB4'), false);
    assert.equal(JSON.stringify(aggregate).includes('TAB9'), false);
  }

  // Invalid/corrupt per-tab state is removed rather than reused.
  {
    const key = S.storageKeyForTab(3);
    const area = S.createMemoryArea({ [key]: { bad: true } });
    const store = S.createStore(area);
    assert.equal(await store.load(3), null);
    await assert.rejects(
      store.withTabScope(3, () => store.getRequestHeaders()),
      error => error.code === 'SESSION_REAUTH_REQUIRED' && error.targetTabId === 3
    );
  }

  // The obsolete global v2 draft is never migrated to a selected tab because
  // its original browser/account provenance cannot be proven.
  {
    const old = {
      schema: 'cardinal.formative.session/2',
      version: '2.0.0',
      capturedAt: 1000,
      sourceUrl: 'https://app.formative.com/formatives/unknown',
      headers: { authorization: 'Bearer LEGACY' }
    };
    const area = S.createMemoryArea({ [S.STORAGE_KEY]: old });
    const store = S.createStore(area);
    assert.equal(await store.load(10), null);
    await assert.rejects(
      store.withTabScope(10, () => store.getRequestHeaders()),
      error => error.code === 'SESSION_REAUTH_REQUIRED'
    );
  }

  // Clearing one closed tab preserves the session of other open Formative tabs;
  // a global clear remains available for explicit logout/recovery actions.
  {
    const area = S.createMemoryArea();
    const store = S.createStore(area);
    await store.capture({ authorization: 'Bearer A' }, { tabId: 1 });
    await store.capture({ authorization: 'Bearer B' }, { tabId: 2 });

    await store.clear(1);
    assert.equal(await store.load(1), null);
    assert.equal((await store.load(2)).headers.authorization, 'Bearer B');

    await store.clear();
    assert.equal(await store.load(2), null);
    assert.equal((await store.diagnostics()).sessionCount, 0);
  }

  console.log('session-store-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
