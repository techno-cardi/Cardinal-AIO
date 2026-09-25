'use strict';

const assert = require('node:assert/strict');
const T = require('./target-enumerator-v2.js');

{
  assert.equal(T.formativeIdFromUrl('https://app.formative.com/formatives/abc123/edit'), 'abc123');
  assert.equal(T.formativeIdFromUrl('https://app.formative.com/formatives/a%20b'), 'a b');
  assert.equal(T.formativeIdFromUrl('https://app.formative.com/dashboard'), null);
  assert.equal(T.formativeIdFromUrl('https://evil.example/formatives/abc123'), null);
  assert.equal(T.formativeIdFromUrl('not a url'), null);
  const expired = T.expiredSessionError(8, 'f');
  assert.equal(expired.code, 'SESSION_REAUTH_REQUIRED');
  assert.equal(expired.mutationMayHaveCommitted, false);
}

(async () => {
  // Dashboard tabs are ignored; assessment tabs are inspected read-only and
  // browser active state is preserved for the chooser.
  {
    const calls = [];
    const tabsApi = {
      async query(info) {
        calls.push(['query', info]);
        return [
          { id: 1, url: 'https://app.formative.com/dashboard', title: 'Dashboard', active: false },
          { id: 2, url: 'https://app.formative.com/formatives/form-a/edit', title: 'Tab title', active: true },
          { id: 3, url: 'https://example.com/formatives/nope', title: 'Nope', active: false }
        ];
      }
    };
    const product = {
      async inspectTarget(input) {
        calls.push(['inspect', input]);
        return {
          targetFormativeId: input.targetFormativeId,
          serverTargetFormativeId: input.targetFormativeId,
          urlTargetFormativeId: input.targetFormativeId,
          tabId: input.targetTabId,
          title: 'Évaluation A',
          canEdit: true,
          authState: 'authenticated',
          pageKind: 'editor',
          observedAt: 123
        };
      }
    };

    const enumerator = T.createEnumerator({ tabsApi, product });
    const rows = await enumerator.enumerate();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tabId, 2);
    assert.equal(rows[0].targetFormativeId, 'form-a');
    assert.equal(rows[0].title, 'Évaluation A');
    assert.equal(rows[0].active, true);
    assert.equal(calls.filter(x => x[0] === 'inspect').length, 1);
  }

  // The concrete tab URL is the target identity. A page/server observation
  // is kept as evidence but can never silently replace that identity.
  {
    const tabsApi = {
      async query() {
        return [{ id: 22, url: 'https://app.formative.com/formatives/url-id/edit', active: true }];
      }
    };
    const product = {
      async inspectTarget(input) {
        return {
          targetFormativeId: 'observed-id',
          urlTargetFormativeId: 'url-id',
          serverTargetFormativeId: 'server-id',
          tabId: input.targetTabId,
          title: 'Observed',
          canEdit: true,
          authState: 'authenticated',
          pageKind: 'editor'
        };
      }
    };
    const rows = await T.createEnumerator({ tabsApi, product }).enumerate();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].targetFormativeId, 'url-id');
    assert.equal(rows[0].urlTargetFormativeId, 'url-id');
    assert.equal(rows[0].observedTargetFormativeId, 'observed-id');
    assert.equal(rows[0].serverTargetFormativeId, 'server-id');
  }

  // One broken/expired tab does not hide another valid target.
  {
    const tabsApi = {
      async query() {
        return [
          { id: 1, url: 'https://app.formative.com/formatives/broken', active: false },
          { id: 2, url: 'https://app.formative.com/formatives/good', active: true }
        ];
      }
    };
    const product = {
      async inspectTarget(input) {
        if (input.targetFormativeId === 'broken') {
          return {
            targetFormativeId: 'broken', tabId: input.targetTabId, title: 'Broken',
            canEdit: null, authState: 'expired', pageKind: 'editor'
          };
        }
        return {
          targetFormativeId: 'good', tabId: input.targetTabId, title: 'Good',
          canEdit: true, authState: 'authenticated', pageKind: 'editor'
        };
      }
    };
    const rows = await T.createEnumerator({ tabsApi, product }).enumerate();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].targetFormativeId, 'good');
  }

  // Production observeTarget returns authState=expired rather than throwing.
  // The enumerator converts that observation back into the recovery signal
  // consumed by the bounded session bootstrap.
  {
    const tabsApi = {
      async query() {
        return [{ id: 9, url: 'https://app.formative.com/formatives/form-x', active: true }];
      }
    };
    const product = {
      async inspectTarget(input) {
        return {
          targetFormativeId: input.targetFormativeId,
          tabId: input.targetTabId,
          title: 'X',
          canEdit: null,
          authState: 'expired',
          pageKind: 'editor'
        };
      }
    };

    await assert.rejects(
      T.createEnumerator({ tabsApi, product }).enumerate(),
      error => {
        assert.equal(error.code, 'SESSION_REAUTH_REQUIRED');
        assert.equal(error.mutationMayHaveCommitted, false);
        assert.equal(error.targetProbeFailures.length, 1);
        assert.equal(error.targetProbeFailures[0].tabId, 9);
        assert.equal(error.targetProbeFailures[0].targetFormativeId, 'form-x');
        return true;
      }
    );
  }

  // A directly thrown session failure is preserved too.
  {
    const tabsApi = {
      async query() {
        return [{ id: 10, url: 'https://app.formative.com/formatives/form-y', active: true }];
      }
    };
    const product = {
      async inspectTarget() {
        const error = new Error('expired');
        error.code = 'SESSION_REAUTH_REQUIRED';
        throw error;
      }
    };

    await assert.rejects(
      T.createEnumerator({ tabsApi, product }).enumerate(),
      error => error.code === 'SESSION_REAUTH_REQUIRED' && error.targetProbeFailures?.[0]?.targetFormativeId === 'form-y'
    );
  }

  // Dashboard-only state is a legitimate empty list.
  {
    const tabsApi = {
      async query() {
        return [{ id: 4, url: 'https://app.formative.com/dashboard', active: true }];
      }
    };
    const product = { async inspectTarget() { throw new Error('must not be called'); } };
    const rows = await T.createEnumerator({ tabsApi, product }).enumerate();
    assert.deepEqual(rows, []);
  }

  console.log('target-enumerator-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});