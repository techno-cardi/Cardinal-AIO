(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function withImporterVersion(input, importerVersion) {
    if (!importerVersion || input?.importerVersion) return input || {};
    return { ...(input || {}), importerVersion };
  }

  function withProductionCapabilities(input, capabilitiesApi) {
    const current = input || {};
    if (Array.isArray(current.capabilities)) return current;
    return {
      ...current,
      capabilities: capabilitiesApi.productionQuestionTypes()
    };
  }

  function targetFrom(prepared, input) {
    return String(
      prepared?.targetFormativeId ||
      input?.targetFormativeId ||
      ''
    ).trim();
  }

  function targetRequiredError() {
    const error = new Error('Une cible Formative explicite est requise avant toute exécution.');
    error.code = 'TARGET_REQUIRED';
    error.mutationMayHaveCommitted = false;
    return error;
  }

  function publicTargetObservation(observation = {}) {
    return Object.freeze({
      targetFormativeId: observation.targetFormativeId || null,
      urlTargetFormativeId: observation.urlTargetFormativeId || null,
      serverTargetFormativeId: observation.serverTargetFormativeId || null,
      tabId: observation.tabId ?? null,
      title: observation.title || null,
      canEdit: observation.canEdit === true ? true : observation.canEdit === false ? false : null,
      authState: observation.authState || 'unknown',
      pageKind: observation.pageKind || 'other',
      observedAt: Number.isFinite(observation.observedAt) ? observation.observedAt : null,
      explicitTabBinding: observation.explicitTabBinding === true,
      candidateTargetIds: Array.isArray(observation.candidateTargetIds)
        ? [...new Set(observation.candidateTargetIds.filter(Boolean).map(String))]
        : []
    });
  }

  function createProductionStack(options = {}) {
    const deps = {
      serverStackApi: required(options.serverStackApi || globalThis.CardinalFormativeV2ServerStack, 'server-stack'),
      persistenceApi: required(options.persistenceApi || globalThis.CardinalFormativeV2Persistence, 'persistence'),
      baseline: required(options.baseline || globalThis.CardinalFormativeV2Baseline, 'baseline'),
      orchestratorApi: required(options.orchestratorApi || globalThis.CardinalFormativeV2Orchestrator, 'orchestrator'),
      runtimeApi: required(options.runtimeApi || globalThis.CardinalFormativeV2Runtime, 'runtime'),
      preflight: required(options.preflight || globalThis.CardinalFormativeV2Preflight, 'preflight'),
      executor: required(options.executor || globalThis.CardinalFormativeV2Executor, 'executor'),
      executionContract: required(options.executionContract || globalThis.CardinalFormativeV2ExecutionContract, 'execution-contract'),
      journal: required(options.journal || globalThis.CardinalFormativeV2Journal, 'journal'),
      bootstrap: options.bootstrap || globalThis.CardinalFormativeV2Bootstrap || null,
      targetGuard: required(options.targetGuard || globalThis.CardinalFormativeV2TargetGuard, 'target-guard'),
      identity: required(options.identity || globalThis.CardinalFormativeV2Identity, 'identity'),
      presentation: required(options.presentation || globalThis.CardinalFormativeV2Presentation, 'presentation'),
      transportBridge: required(options.transportBridge || globalThis.CardinalFormativeV2TransportBridge, 'transport-bridge'),
      managed: required(options.managed || globalThis.CardinalFormativeV2ManagedState, 'managed-state'),
      reconciliation: required(options.reconciliation || globalThis.CardinalFormativeV2Reconciliation, 'reconciliation'),
      capabilities: required(options.capabilitiesApi || globalThis.CardinalFormativeV2Capabilities, 'capabilities'),
      runGateApi: required(options.runGateApi || globalThis.CardinalFormativeV2RunGate, 'run-gate')
    };

    if (typeof deps.capabilities.productionQuestionTypes !== 'function') {
      throw new Error('capabilities.productionQuestionTypes required');
    }
    if (typeof deps.runGateApi.createGate !== 'function' && !options.runGate) {
      throw new Error('run-gate createGate required');
    }

    const sessionArea = required(options.sessionArea, 'chrome.storage.session area');
    const persistenceArea = required(options.persistenceArea, 'chrome.storage.local area');
    const getPageContext = required(options.getPageContext, 'getPageContext');

    if (sessionArea === persistenceArea) {
      const error = new Error('Formative session storage and persistent import storage must be distinct.');
      error.code = 'STORAGE_SCOPE_COLLISION';
      throw error;
    }

    const server = deps.serverStackApi.createServerStack({
      ...options.serverOptions,
      sessionArea,
      getPageContext,
      importerSurface: options.importerSurface,
      fetchImpl: options.fetchImpl,
      baseUrl: options.baseUrl,
      pause: options.pause,
      pauseMs: options.pauseMs,
      randomKey: options.randomKey
    });

    const persistenceAdapter = deps.persistenceApi.createChromeStorageAdapter(persistenceArea);
    const persistence = deps.persistenceApi.createPersistence({
      adapter: persistenceAdapter,
      baseline: deps.baseline,
      historyLimit: options.historyLimit
    });

    const orchestrator = deps.orchestratorApi.createOrchestrator({
      preflight: deps.preflight,
      executor: deps.executor,
      contract: deps.executionContract,
      journal: deps.journal,
      baseline: deps.baseline,
      bootstrap: deps.bootstrap,
      persistence,
      executorInjected: options.executorInjected,
      runIdFactory: options.runIdFactory
    });

    const runtime = deps.runtimeApi.createRuntime({
      orchestrator,
      gateway: server.gateway,
      targetGuard: deps.targetGuard,
      identity: deps.identity,
      presentation: deps.presentation,
      transportBridge: deps.transportBridge,
      managed: deps.managed,
      reconciliation: deps.reconciliation,
      targetObservationMaxAgeMs: options.targetObservationMaxAgeMs
    });

    const runGate = options.runGate || deps.runGateApi.createGate();
    if (!runGate || typeof runGate.withTargetLock !== 'function') {
      throw new Error('run-gate withTargetLock required');
    }

    const importerVersion = options.importerVersion || null;

    return Object.freeze({
      async inspectTarget(input = {}) {
        const observation = await server.gateway.observeTarget({
          targetFormativeId: input.targetFormativeId || null,
          targetTabId: input.targetTabId ?? null,
          context: { phase: 'target-discovery' }
        });
        return publicTargetObservation(observation);
      },
      prepare(input = {}) {
        return runtime.prepare(withProductionCapabilities(input, deps.capabilities));
      },
      confirmReconciliation(prepared, input = {}) {
        const enriched = withImporterVersion(
          withProductionCapabilities(input, deps.capabilities),
          importerVersion
        );
        return runtime.confirmReconciliation(prepared, enriched);
      },
      execute(prepared, input = {}) {
        const targetFormativeId = targetFrom(prepared, input);
        if (!targetFormativeId) return Promise.reject(targetRequiredError());

        const enriched = withImporterVersion(input, importerVersion);
        return runGate.withTargetLock({
          targetFormativeId,
          runId: prepared?.runId || prepared?.journal?.runId || null,
          executionContractHash: prepared?.executionContract?.hash || prepared?.journal?.executionContractHash || null
        }, () => runtime.execute(prepared, enriched));
      },
      discardIncompleteRecovery(input = {}) {
        return orchestrator.discardIncompleteRecovery(input);
      },
      captureSession(headers, meta = {}) {
        return server.captureSession(headers, meta);
      },
      clearSession(tabId = null) {
        return server.clearSession(tabId);
      },
      sessionDiagnostics(tabId = null) {
        return server.sessionDiagnostics(tabId);
      },
      loadImportHistory(targetFormativeId, assessmentFingerprint) {
        return persistence.loadHistory(targetFormativeId, assessmentFingerprint);
      },
      loadBaseline(targetFormativeId, assessmentFingerprint) {
        return persistence.loadBaseline(targetFormativeId, assessmentFingerprint);
      }
    });
  }

  const api = {
    createProductionStack,
    withProductionCapabilities,
    publicTargetObservation
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ProductionStack = api;
})();
