(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function targetTabIdFrom(input = {}) {
    return input?.targetTabId ?? input?.context?.targetTabId ?? null;
  }

  function createServerStack(options = {}) {
    const deps = {
      sessionApi: required(options.sessionApi || globalThis.CardinalFormativeV2SessionStore, 'session-store'),
      graphqlApi: required(options.graphqlApi || globalThis.CardinalFormativeV2GraphQLClient, 'graphql-client'),
      readerApi: required(options.readerApi || globalThis.CardinalFormativeV2Reader, 'formative-reader'),
      primitiveApi: required(options.primitiveApi || globalThis.CardinalFormativeV2LegacyPrimitives, 'legacy-primitives'),
      mutationGuard: required(options.mutationGuard || globalThis.CardinalFormativeV2MutationInputGuard, 'mutation-input-guard'),
      gatewayApi: required(options.gatewayApi || globalThis.CardinalFormativeV2LegacyGateway, 'legacy-gateway'),
      readiness: required(options.readiness || globalThis.CardinalFormativeV2ServerReadiness, 'server-readiness'),
      contract: required(options.contract || globalThis.CardinalFormativeV041Contract, '0.4.1 contract'),
      hostCompat: options.hostCompat || globalThis.CardinalFormativeV2HostCompat || null
    };

    const sessionArea = required(options.sessionArea, 'chrome.storage.session area');
    const getPageContext = required(options.getPageContext, 'getPageContext');

    if (deps.hostCompat && typeof deps.hostCompat.validateImporterSurface === 'function') {
      const surface = options.importerSurface || deps.hostCompat.recommendedSurface?.();
      if (!surface) throw new Error('importer surface required by host compatibility guard');
      const compatibility = deps.hostCompat.validateImporterSurface(surface);
      if (!compatibility.ok) {
        const error = new Error('Le module Formative v2 entre en collision avec Gestion des notes.');
        error.code = 'HOST_COMPATIBILITY_BLOCKED';
        error.issues = compatibility.issues || [];
        throw error;
      }
    }

    const sessionStore = deps.sessionApi.createStore(sessionArea);
    if (typeof sessionStore.withTabScope !== 'function') {
      throw new Error('session-store.withTabScope required');
    }

    const client = deps.graphqlApi.createClient({
      fetchImpl: options.fetchImpl || globalThis.fetch,
      sessionStore,
      baseUrl: options.baseUrl
    });
    const reader = deps.readerApi.createReader({
      client,
      serverReadiness: deps.readiness
    });

    const rawPrimitives = deps.primitiveApi.createPrimitives({
      client,
      contract: deps.contract,
      reader,
      getPageContext,
      randomKey: options.randomKey,
      pause: options.pause,
      pauseMs: options.pauseMs
    });

    // Critical composition invariant: production gateway receives only the
    // guarded wrapper. Raw mutation primitives never escape this stack.
    const guardedPrimitives = deps.mutationGuard.createGuardedPrimitives(rawPrimitives);
    const rawGateway = deps.gatewayApi.createGateway({
      legacy: guardedPrimitives,
      serverReadiness: deps.readiness
    });

    // The proven 0.4.1 GraphQL helpers do not carry a browser-tab argument on
    // every nested request. Scope the entire guarded gateway call instead of
    // rewriting those primitives. This guarantees that permission reads,
    // snapshots and mutations all consume the session captured from the exact
    // Formative tab selected by the user.
    const gateway = Object.freeze(Object.fromEntries([
      'observeTarget',
      'listItems',
      'readItem',
      'createItem',
      'updateItem',
      'deleteItem'
    ].map(name => {
      const fn = rawGateway?.[name];
      if (typeof fn !== 'function') throw new Error(`gateway.${name} required`);
      return [name, input => sessionStore.withTabScope(targetTabIdFrom(input), () => fn(input))];
    })));

    return Object.freeze({
      gateway,
      sessionStore,
      captureSession(headers, meta = {}) {
        return sessionStore.capture(headers, meta);
      },
      clearSession(tabId = null) {
        return sessionStore.clear(tabId);
      },
      sessionDiagnostics(tabId = null) {
        return sessionStore.diagnostics(tabId);
      }
    });
  }

  const api = { targetTabIdFrom, createServerStack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ServerStack = api;
})();
