'use strict';

const assert = require('node:assert/strict');
const B = require('./background-v2.js');

(() => {
  assert.equal(B.IMPORTER_VERSION, '0.5.0-rc1');
  assert(Object.isFrozen(B.CORE_SCRIPTS));
  assert(B.CORE_SCRIPTS.includes('extension-app-v2.js'));
  assert(B.CORE_SCRIPTS.includes('session-capture-bridge-v2.js'));
  assert(B.CORE_SCRIPTS.includes('session-bootstrap-v2.js'));
  assert(B.CORE_SCRIPTS.includes('legacy-primitives-v041.js'));
  assert(B.CORE_SCRIPTS.includes('legacy-contract-v041.js'));
  assert.equal(B.CORE_SCRIPTS.includes('legacy-session-bridge-v2.js'), false,
    'the replacement session bridge must be the only capture listener in the build');
  assert.equal(B.CORE_SCRIPTS.some(name => name.endsWith('.test.js')), false);
  assert.equal(new Set(B.CORE_SCRIPTS).size, B.CORE_SCRIPTS.length);
  assert.equal(B.CORE_SCRIPTS[B.CORE_SCRIPTS.length - 1], 'extension-app-v2.js');

  // The loader receives the complete dependency list in one deterministic call.
  let loaded = null;
  B.loadDependencies((...names) => { loaded = names; });
  assert.deepEqual(loaded, [...B.CORE_SCRIPTS]);

  // Starting is idempotent across MV3 service-worker code paths.
  delete globalThis[B.GLOBAL_APP_KEY];
  let created = 0;
  let attached = 0;
  const app = { attach() { attached += 1; } };
  const appApi = {
    createApp(options) {
      created += 1;
      assert.equal(options.importerVersion, B.IMPORTER_VERSION);
      return app;
    }
  };
  assert.equal(B.start({ appApi }), app);
  assert.equal(B.start({ appApi }), app);
  assert.equal(created, 1);
  assert.equal(attached, 1);
  delete globalThis[B.GLOBAL_APP_KEY];

  console.log('background-v2: all tests passed');
})();
