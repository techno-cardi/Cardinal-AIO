(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function makeError(code, message, extra = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.mutationMayHaveCommitted = false;
    Object.assign(error, extra);
    return error;
  }

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function createPageContextReader(tabsApi, targetEnumeratorApi) {
    required(tabsApi, 'chrome.tabs');
    required(targetEnumeratorApi, 'target-enumerator');
    if (typeof tabsApi.get !== 'function') throw new Error('chrome.tabs.get required');
    if (typeof targetEnumeratorApi.formativeIdFromUrl !== 'function') {
      throw new Error('target-enumerator.formativeIdFromUrl required');
    }

    return async function getPageContext(input = {}) {
      const tabId = input.targetTabId;
      if (!validTabId(tabId)) {
        throw makeError(
          'TARGET_TAB_BINDING_REQUIRED',
          'Cardinal exige un onglet Formative explicite avant de relire la cible.'
        );
      }

      let tab;
      try {
        tab = await tabsApi.get(tabId);
      } catch (cause) {
        throw makeError('REQUESTED_TAB_NOT_FOUND', 'L’onglet Formative choisi n’existe plus.', { cause });
      }

      const urlTargetFormativeId = targetEnumeratorApi.formativeIdFromUrl(tab?.url);
      if (!urlTargetFormativeId) {
        throw makeError(
          'TARGET_TAB_CHANGED',
          'L’onglet choisi n’affiche plus une évaluation Formative modifiable.',
          { tabId }
        );
      }

      const expected = input.targetFormativeId ? String(input.targetFormativeId) : null;
      if (expected && String(urlTargetFormativeId) !== expected) {
        throw makeError(
          'REQUESTED_TARGET_TAB_MISMATCH',
          'L’onglet choisi affiche maintenant un autre Formative.',
          { tabId, expectedTargetFormativeId: expected, urlTargetFormativeId }
        );
      }

      return {
        tabId,
        targetFormativeId: String(urlTargetFormativeId),
        urlTargetFormativeId: String(urlTargetFormativeId),
        title: tab?.title || null,
        pageKind: 'editor',
        explicitTabBinding: true,
        candidateTargetIds: [String(urlTargetFormativeId)]
      };
    };
  }

  function createApp(options = {}) {
    const chromeApi = required(options.chromeApi || globalThis.chrome, 'chrome API');
    const deps = {
      productionStackApi: required(options.productionStackApi || globalThis.CardinalFormativeV2ProductionStack, 'production-stack'),
      targetEnumeratorApi: required(options.targetEnumeratorApi || globalThis.CardinalFormativeV2TargetEnumerator, 'target-enumerator'),
      targetSelector: required(options.targetSelector || globalThis.CardinalFormativeV2TargetSelector, 'target-selector'),
      sessionBootstrapApi: required(options.sessionBootstrapApi || globalThis.CardinalFormativeV2SessionBootstrap, 'session-bootstrap'),
      sessionCaptureBridgeApi: required(options.sessionCaptureBridgeApi || globalThis.CardinalFormativeV2SessionCaptureBridge, 'session-capture-bridge'),
      progressApi: required(options.progressApi || globalThis.CardinalProgress, 'progress'),
      errorPresenter: required(options.errorPresenter || globalThis.CardinalFormativeV2ErrorPresenter, 'error-presenter'),
      progressRelayApi: required(options.progressRelayApi || globalThis.CardinalFormativeV2ProgressRelay, 'progress-relay'),
      controllerApi: required(options.controllerApi || globalThis.CardinalFormativeV2BrowserController, 'browser-controller'),
      routerApi: required(options.routerApi || globalThis.CardinalFormativeV2RuntimeMessageRouter, 'runtime-message-router'),
      serviceWorkerBridgeApi: required(options.serviceWorkerBridgeApi || globalThis.CardinalFormativeV2ServiceWorkerBridge, 'service-worker-bridge')
    };

    required(chromeApi.runtime, 'chrome.runtime');
    required(chromeApi.tabs, 'chrome.tabs');
    const sessionArea = required(chromeApi.storage?.session, 'chrome.storage.session');

    const getPageContext = options.getPageContext || createPageContextReader(chromeApi.tabs, deps.targetEnumeratorApi);

    const product = options.product || deps.productionStackApi.createProductionStack({
      ...(options.productionOptions || {}),
      sessionArea,
      persistenceArea: required(chromeApi.storage?.local, 'chrome.storage.local'),
      getPageContext,
      importerVersion: options.importerVersion || '0.5.x-dev'
    });

    const relay = options.relay || deps.progressRelayApi.createRelay({
      sendToTab: (tabId, message) => chromeApi.tabs.sendMessage(tabId, message),
      maxBindings: options.maxProgressBindings
    });

    const enumerator = options.enumerator || deps.targetEnumeratorApi.createEnumerator({
      tabsApi: chromeApi.tabs,
      product
    });

    const sessionBootstrap = options.sessionBootstrap || deps.sessionBootstrapApi.createBootstrap({
      tabsApi: chromeApi.tabs,
      sessionArea,
      cooldownMs: options.sessionBootstrapCooldownMs,
      timeoutMs: options.sessionBootstrapTimeoutMs,
      pause: options.sessionBootstrapPause,
      now: options.now
    });

    const enumerateTargets = options.enumerateTargets || sessionBootstrap.wrapEnumerate(
      () => enumerator.enumerate()
    );

    const controller = options.controller || deps.controllerApi.createController({
      product,
      targetSelector: deps.targetSelector,
      progressApi: deps.progressApi,
      errorPresenter: deps.errorPresenter,
      enumerateTargets,
      emitState: state => relay.handleState(state),
      progressSinks: [event => relay.sink(event)],
      tokenFactory: options.tokenFactory
    });

    const router = options.router || deps.routerApi.createRouter({
      controller,
      errorPresenter: deps.errorPresenter,
      extensionId: chromeApi.runtime.id || null,
      maxPackageBytes: options.maxPackageBytes
    });

    const bridge = options.bridge || deps.serviceWorkerBridgeApi.createBridge({
      router,
      relay,
      errorPresenter: deps.errorPresenter,
      tabsApi: chromeApi.tabs
    });

    const sessionCaptureBridge = options.sessionCaptureBridge || deps.sessionCaptureBridgeApi.createBridge({
      product,
      runtime: chromeApi.runtime,
      webRequest: chromeApi.webRequest || null,
      tabsApi: chromeApi.tabs,
      console: options.console || globalThis.console
    });

    let detachBridge = null;
    let detachSessionCapture = null;

    function attach() {
      if (!detachBridge) detachBridge = bridge.attach(chromeApi.runtime);
      if (!detachSessionCapture) detachSessionCapture = sessionCaptureBridge.attach();
      return detach;
    }

    function detach() {
      let changed = false;
      if (detachBridge) {
        const fn = detachBridge;
        detachBridge = null;
        fn();
        changed = true;
      }
      if (detachSessionCapture) {
        const fn = detachSessionCapture;
        detachSessionCapture = null;
        fn();
        changed = true;
      }
      return changed;
    }

    return Object.freeze({
      product,
      relay,
      enumerator,
      sessionBootstrap,
      enumerateTargets,
      controller,
      router,
      bridge,
      sessionCaptureBridge,
      getPageContext,
      attach,
      detach
    });
  }

  const api = { createPageContextReader, createApp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ExtensionApp = api;
})();