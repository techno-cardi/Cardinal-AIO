'use strict';

const assert = require('node:assert/strict');
const compat = require('./host-compat-v2.js');
const runtimeRouter = require('./runtime-message-router-v2.js');

(function recommendedSurfacePasses() {
  const surface = compat.recommendedSurface();
  const result = compat.validateImporterSurface(surface);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.issues.length, 0);
})();

(function runtimeRouterCommandsAreDeclaredAndNamespaced() {
  const surface = compat.recommendedSurface();
  const declared = new Set(surface.messageTypes);
  for (const type of runtimeRouter.OWNED_TYPES) {
    assert(declared.has(type), `host contract missing runtime message ${type}`);
    assert(type.startsWith(compat.IMPORTER_MESSAGE_PREFIX));
    assert.equal(compat.HOST.mozaik.messageTypes.includes(type), false);
    assert.equal(compat.HOST.formativeCorrection.messageTypes.includes(type), false);
  }
})();

(function mozaikOwnershipCannotBeStolen() {
  const surface = compat.recommendedSurface();
  surface.domIds.push('syncMozaikBtn');
  surface.messageTypes.push('START_MOZAIK_SYNC');
  surface.windowSources.push('cardinal-mozaik-console');
  surface.mozaikButtonPolicy = 'attach-click-handler';
  const result = compat.validateImporterSurface(surface);
  const codes = new Set(result.issues.map(x => x.code));
  assert.equal(result.ok, false);
  assert(codes.has('HOST_DOM_COLLISION'));
  assert(codes.has('HOST_MESSAGE_COLLISION'));
  assert(codes.has('HOST_SOURCE_COLLISION'));
  assert(codes.has('MOZAIK_BUTTON_OWNERSHIP'));
})();

(function formativeCorrectionWorkflowCannotBeShadowed() {
  const surface = compat.recommendedSurface();
  surface.messageTypes.push('FORMATIVE_REQUEST');
  surface.storageKeys.push('pending_formative_import');
  surface.domIds.push('formativeImportDialog');
  const result = compat.validateImporterSurface(surface);
  const codes = new Set(result.issues.map(x => x.code));
  assert(codes.has('HOST_MESSAGE_COLLISION'));
  assert(codes.has('HOST_STORAGE_COLLISION'));
  assert(codes.has('HOST_DOM_COLLISION'));
})();

(function serviceWorkerMustDelegateUnknownMessages() {
  const surface = compat.recommendedSurface();
  surface.runtimeRouting = 'catch-all';
  const result = compat.validateImporterSurface(surface);
  assert(result.issues.some(x => x.code === 'RUNTIME_ROUTER_MUST_DELEGATE'));
})();

(function importerMustStayOffGestionPage() {
  const surface = compat.recommendedSurface();
  surface.contentScriptRoles.push('gestion-des-notes');
  const result = compat.validateImporterSurface(surface);
  assert(result.issues.some(x => x.code === 'IMPORTER_GESTION_INJECTION_FORBIDDEN'));
})();

(function authAndObserverPoliciesAreFailClosed() {
  const surface = compat.recommendedSurface();
  surface.authIsolation = 'shared-local-storage';
  surface.formativeObserverPolicy = 'rewrite-app-dom';
  const result = compat.validateImporterSurface(surface);
  const codes = new Set(result.issues.map(x => x.code));
  assert(codes.has('AUTH_ISOLATION_REQUIRED'));
  assert(codes.has('FORMATIVE_OBSERVER_POLICY'));
})();

(function v14BoundedTimeoutsStayDocumented() {
  assert.deepEqual(compat.HOST.mozaik.boundedTimeoutMs, {
    extensionReady: 1800,
    flushGradeSaves: 7000,
    prepareJob: 10000,
    claimExactJob: 10000,
    extensionSync: 35000,
    completeJob: 10000,
    closeFailedJob: 5000
  });
  assert.equal(compat.HOST.mozaik.ownerDatasetValue, 'v14');
})();

console.log('host-compat-v2: all tests passed');
