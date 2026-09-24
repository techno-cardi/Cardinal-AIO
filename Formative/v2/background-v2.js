(() => {
  'use strict';

  const CORE_SCRIPTS = Object.freeze([
    'identity-v2.js',
    'capabilities-v2.js',
    'validator-v2.js',
    'adapter-v2.js',
    'baseline-store-v2.js',
    'managed-state-v2.js',
    'reconciliation-v2.js',
    'planner-v2.js',
    'preflight-v2.js',
    'execution-contract-v2.js',
    'journal-v2.js',
    'executor-v2.js',
    'persistence-v2.js',
    'target-guard-v2.js',
    'transport-bridge-v2.js',
    'bootstrap-reconciliation-v2.js',
    'orchestrator-v2.js',
    'runtime-v2.js',
    'presentation-v2.js',
    'session-store-v2.js',
    'graphql-client-v2.js',
    'server-readiness-v2.js',
    'formative-reader-v2.js',
    'legacy-contract-v041.js',
    'legacy-primitives-v041.js',
    'mutation-input-guard-v2.js',
    'legacy-gateway-v2.js',
    'host-compat-v2.js',
    'server-stack-v2.js',
    'run-gate-v2.js',
    'production-stack-v2.js',
    'progress-v2.js',
    'progress-relay-v2.js',
    'error-presenter-v2.js',
    'target-selector-v2.js',
    'target-enumerator-v2.js',
    'session-bootstrap-v2.js',
    'session-capture-bridge-v2.js',
    'browser-controller-v2.js',
    'runtime-message-router-v2.js',
    'service-worker-bridge-v2.js',
    'extension-app-v2.js'
  ]);

  const IMPORTER_VERSION = '0.5.0-rc1';
  const GLOBAL_APP_KEY = '__cardinalFormativeV2App';

  function loadDependencies(loader = globalThis.importScripts) {
    if (typeof loader !== 'function') {
      throw new Error('importScripts unavailable in Formative v2 service worker');
    }
    loader(...CORE_SCRIPTS);
    return CORE_SCRIPTS;
  }

  function start(options = {}) {
    if (globalThis[GLOBAL_APP_KEY]) return globalThis[GLOBAL_APP_KEY];
    const appApi = options.appApi || globalThis.CardinalFormativeV2ExtensionApp;
    if (!appApi || typeof appApi.createApp !== 'function') {
      throw new Error('CardinalFormativeV2ExtensionApp.createApp unavailable');
    }
    const app = appApi.createApp({
      importerVersion: options.importerVersion || IMPORTER_VERSION,
      ...(options.appOptions || {})
    });
    if (!app || typeof app.attach !== 'function') {
      throw new Error('Formative v2 extension app attach unavailable');
    }
    app.attach();
    globalThis[GLOBAL_APP_KEY] = app;
    return app;
  }

  function boot() {
    if (globalThis[GLOBAL_APP_KEY]) return globalThis[GLOBAL_APP_KEY];
    loadDependencies();
    return start();
  }

  const api = { CORE_SCRIPTS, IMPORTER_VERSION, GLOBAL_APP_KEY, loadDependencies, start, boot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Background = api;

  // In Chrome MV3 this file is the service worker entrypoint. Node tests do not
  // provide importScripts, so loading the module remains side-effect free there.
  if (typeof globalThis.importScripts === 'function' && typeof globalThis.chrome !== 'undefined') {
    boot();
  }
})();
