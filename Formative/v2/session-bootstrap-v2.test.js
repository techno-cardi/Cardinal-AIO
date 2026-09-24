'use strict';

const assert = require('node:assert/strict');
const B = require('./session-bootstrap-v2.js');

function memoryArea(initial = {}) {
  const map = new Map(Object.entries(JSON.parse(JSON.stringify(initial))));
  return {
    async get(key) { return map.has(key) ? { [key]: JSON.parse(JSON.stringify(map.get(key))) } : {}; },
    async set(values) { for (const [key, value] of Object.entries(values || {})) map.set(key, JSON.parse(JSON.stringify(value))); },
    async remove(key) { map.delete(key); },
    dump(key) { return map.get(key); }
  };
}

function tabsHarness() {
  const listeners = new Set();
  const reloads = [];
  const tabs = [
    { id: 20, url: 'https://app.formative.com/formatives/a', active: false },
    { id: 30, url: 'https://app.formative.com/formatives/b', active: true }
  ];
  return {
    reloads,
    api: {
      async query() { return tabs.map(x => ({ ...x })); },
      async reload(tabId) {
        reloads.push(tabId);
        queueMicrotask(() => {
          for (const listener of [...listeners]) listener(tabId, { status: 'complete' });
        });
      },
      onUpdated: {
        addListener(fn) { listeners.add(fn); },
        removeListener(fn) { listeners.delete(fn); }
      }
    }
  };
}

(async () => {
  assert.equal(B.isSessionError({ code: 'SESSION_REAUTH_REQUIRED' }), true);
  assert.equal(B.isSessionError({ reason: 'SESSION_REAUTH_REQUIRED' }), true);
  assert.equal(B.isSessionError({ code: 'OTHER' }), false);

  assert.deepEqual(B.failureTabIds({ targetProbeFailures: [
    { tabId: 20 }, { tabId: -1 }, { tabId: 30 }, { tabId: '40' }
  ] }), [20, 30]);

  // The active failing Formative tab is preferred, never an unrelated tab.
  {
    const h = tabsHarness();
    const chosen = await B.chooseReloadTab(h.api, {
      targetProbeFailures: [{ tabId: 20 }, { tabId: 30 }]
    });
    assert.equal(chosen, 30);
  }

  // Old single-record draft migrates into the per-tab structure.
  assert.deepEqual(B.normalizeRecord({ tabId: 20, at: 123 }), {
    tabs: { '20': { at: 123 } }
  });

  // A missing session triggers exactly one reload, then retries the read once.
  {
    const h = tabsHarness();
    const area = memoryArea();
    let now = 1000;
    let calls = 0;
    const bootstrap = B.createBootstrap({
      tabsApi: h.api,
      sessionArea: area,
      cooldownMs: 30000,
      timeoutMs: 20,
      pause: async () => {},
      now: () => now
    });
    const enumerate = bootstrap.wrapEnumerate(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('session missing');
        error.code = 'SESSION_REAUTH_REQUIRED';
        error.targetProbeFailures = [{ tabId: 20 }];
        throw error;
      }
      return ['ok'];
    });

    assert.deepEqual(await enumerate(), ['ok']);
    assert.equal(calls, 2);
    assert.deepEqual(h.reloads, [20]);
    assert.equal(await bootstrap.canReload(20), false);

    // The same tab cannot loop immediately.
    const result = await bootstrap.bootstrap(Object.assign(new Error('again'), {
      code: 'SESSION_REAUTH_REQUIRED',
      targetProbeFailures: [{ tabId: 20 }]
    }));
    assert.equal(result.attempted, false);
    assert.equal(result.reason, 'cooldown');
    assert.deepEqual(h.reloads, [20]);

    // A different Formative tab has its own cooldown bucket.
    const other = await bootstrap.bootstrap(Object.assign(new Error('other'), {
      code: 'SESSION_REAUTH_REQUIRED',
      targetProbeFailures: [{ tabId: 30 }]
    }));
    assert.equal(other.attempted, true);
    assert.deepEqual(h.reloads, [20, 30]);

    now += 30001;
    assert.equal(await bootstrap.canReload(20), true);
  }

  // The wrapper never retries non-session failures.
  {
    const h = tabsHarness();
    const bootstrap = B.createBootstrap({
      tabsApi: h.api,
      sessionArea: memoryArea(),
      pause: async () => {},
      timeoutMs: 10
    });
    let calls = 0;
    await assert.rejects(
      bootstrap.wrapEnumerate(async () => {
        calls += 1;
        const error = new Error('server down');
        error.code = 'FORMATIVE_SERVER_ERROR';
        throw error;
      })(),
      error => error.code === 'FORMATIVE_SERVER_ERROR'
    );
    assert.equal(calls, 1);
    assert.deepEqual(h.reloads, []);
  }

  // The second session failure after the bootstrap is surfaced; no loop.
  {
    const h = tabsHarness();
    const bootstrap = B.createBootstrap({
      tabsApi: h.api,
      sessionArea: memoryArea(),
      pause: async () => {},
      timeoutMs: 10
    });
    let calls = 0;
    await assert.rejects(
      bootstrap.wrapEnumerate(async () => {
        calls += 1;
        const error = new Error('still missing');
        error.code = 'SESSION_REAUTH_REQUIRED';
        error.targetProbeFailures = [{ tabId: 20 }];
        throw error;
      })(),
      error => error.code === 'SESSION_REAUTH_REQUIRED'
    );
    assert.equal(calls, 2);
    assert.deepEqual(h.reloads, [20]);
  }

  console.log('session-bootstrap-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
