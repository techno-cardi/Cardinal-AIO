'use strict';

const assert = require('node:assert/strict');
const production = require('./production-stack-v2.js');

function depsHarness() {
  const trace = [];
  const gateway = {
    marker: 'safe-gateway',
    async observeTarget(input) {
      trace.push(['observe-target', input]);
      return {
        targetFormativeId: input.targetFormativeId || 'form-1',
        urlTargetFormativeId: input.targetFormativeId || 'form-1',
        serverTargetFormativeId: input.targetFormativeId || 'form-1',
        tabId: input.targetTabId ?? 9,
        title: 'Évaluation test',
        canEdit: true,
        authState: 'authenticated',
        pageKind: 'editor',
        observedAt: 12345,
        explicitTabBinding: true,
        candidateTargetIds: [input.targetFormativeId || 'form-1'],
        viewerPermissions: ['edit'],
        authorization: 'Bearer must-not-escape'
      };
    }
  };
  const persistence = {
    async loadHistory(target, assessment) {
      trace.push(['history', target, assessment]);
      return [{ runId: 'old-run' }];
    },
    async loadBaseline(target, assessment) {
      trace.push(['baseline', target, assessment]);
      return { targetFormativeId: target, assessmentFingerprint: assessment };
    }
  };

  const serverStackApi = {
    createServerStack(options) {
      trace.push(['server-stack', options]);
      return {
        gateway,
        async captureSession(headers, meta) {
          trace.push(['capture-session', headers, meta]);
          return { ok: true };
        },
        async clearSession(tabId = null) {
          trace.push(['clear-session', tabId]);
        },
        async sessionDiagnostics(tabId = null) {
          trace.push(['session-diagnostics', tabId]);
          return { available: true, tabId };
        }
      };
    }
  };

  const persistenceApi = {
    createChromeStorageAdapter(area) {
      trace.push(['persistence-adapter', area]);
      return { marker: 'adapter' };
    },
    createPersistence(options) {
      trace.push(['persistence', options]);
      return persistence;
    }
  };

  const orchestrator = {
    async prepare(input) { trace.push(['orchestrator-prepare', input]); return { prepared: true }; },
    async confirmReconciliation(prepared, input) { trace.push(['orchestrator-confirm', prepared, input]); return { ok: true }; },
    async execute(prepared, input) { trace.push(['orchestrator-execute', prepared, input]); return { ok: true }; },
    async discardIncompleteRecovery(input) { trace.push(['discard', input]); return true; }
  };

  const orchestratorApi = {
    createOrchestrator(options) {
      trace.push(['orchestrator-stack', options]);
      assert.equal(options.persistence, persistence);
      return orchestrator;
    }
  };

  const runtime = {
    async prepare(input) { trace.push(['runtime-prepare', input]); return { ok: true, input }; },
    async confirmReconciliation(prepared, input) { trace.push(['runtime-confirm', prepared, input]); return { ok: true, input }; },
    async execute(prepared, input) { trace.push(['runtime-execute', prepared, input]); return { ok: true, input }; }
  };

  const runtimeApi = {
    createRuntime(options) {
      trace.push(['runtime-stack', options]);
      assert.equal(options.orchestrator, orchestrator);
      assert.equal(options.gateway, gateway);
      return runtime;
    }
  };

  const capabilitiesApi = {
    productionQuestionTypes() {
      return ['fillInTheBlank', 'longAnswer', 'shortAnswer'];
    }
  };

  const runGate = {
    async withTargetLock(input, fn) {
      trace.push(['run-gate', input]);
      return fn();
    }
  };

  const runGateApi = {
    createGate() {
      trace.push(['run-gate-create']);
      return runGate;
    }
  };

  return {
    trace,
    gateway,
    persistence,
    runGate,
    deps: {
      serverStackApi,
      persistenceApi,
      baseline: { marker: 'baseline-api' },
      orchestratorApi,
      runtimeApi,
      preflight: { marker: 'preflight' },
      executor: { marker: 'executor' },
      executionContract: { marker: 'contract' },
      journal: { marker: 'journal' },
      bootstrap: { marker: 'bootstrap' },
      targetGuard: { marker: 'target-guard' },
      identity: { marker: 'identity' },
      presentation: { marker: 'presentation' },
      transportBridge: { marker: 'transport' },
      managed: { marker: 'managed' },
      reconciliation: { marker: 'reconciliation' },
      capabilitiesApi,
      runGateApi
    }
  };
}

(async () => {
  {
    const h = depsHarness();
    const sessionArea = { name: 'session' };
    assert.throws(
      () => production.createProductionStack({
        ...h.deps,
        sessionArea,
        persistenceArea: sessionArea,
        getPageContext() {}
      }),
      error => error.code === 'STORAGE_SCOPE_COLLISION'
    );
    assert.equal(h.trace.length, 0, 'storage collision must block before composing any module');
  }

  {
    const h = depsHarness();
    const sessionArea = { name: 'session' };
    const persistenceArea = { name: 'local' };
    const product = production.createProductionStack({
      ...h.deps,
      sessionArea,
      persistenceArea,
      getPageContext() { return { targetFormativeId: 'form-1' }; },
      importerVersion: '0.5.0-test',
      targetObservationMaxAgeMs: 12000,
      historyLimit: 7
    });

    const publicKeys = Object.keys(product).sort();
    assert.deepEqual(publicKeys, [
      'captureSession',
      'clearSession',
      'confirmReconciliation',
      'discardIncompleteRecovery',
      'execute',
      'inspectTarget',
      'loadBaseline',
      'loadImportHistory',
      'prepare',
      'sessionDiagnostics'
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(product, 'gateway'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(product, 'persistence'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(product, 'client'), false);
    assert.equal(Object.isFrozen(product), true);

    const inspected = await product.inspectTarget({ targetFormativeId: 'form-7', targetTabId: 77 });
    assert.equal(inspected.targetFormativeId, 'form-7');
    assert.equal(inspected.tabId, 77);
    assert.equal(inspected.canEdit, true);
    assert.equal(inspected.authState, 'authenticated');
    assert.equal(Object.prototype.hasOwnProperty.call(inspected, 'viewerPermissions'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(inspected, 'authorization'), false);
    assert.equal(Object.isFrozen(inspected), true);

    const preparedResult = await product.prepare({ pkg: { schema: 'x' } });
    assert.deepEqual(preparedResult.input.capabilities, ['fillInTheBlank', 'longAnswer', 'shortAnswer']);

    const explicitCapabilities = await product.prepare({
      pkg: { schema: 'x' },
      capabilities: ['shortAnswer']
    });
    assert.deepEqual(explicitCapabilities.input.capabilities, ['shortAnswer']);

    const prepared = {
      ok: true,
      targetFormativeId: 'form-1',
      runId: 'run-1',
      executionContract: { hash: 'contract-1' }
    };
    const confirmed = await product.confirmReconciliation(prepared, {});
    assert.equal(confirmed.input.importerVersion, '0.5.0-test');
    assert.deepEqual(confirmed.input.capabilities, ['fillInTheBlank', 'longAnswer', 'shortAnswer']);

    const executed = await product.execute(prepared, { acknowledgeWarnings: true });
    assert.equal(executed.input.importerVersion, '0.5.0-test');
    assert.equal(executed.input.acknowledgeWarnings, true);

    const gateTrace = h.trace.find(row => row[0] === 'run-gate');
    assert.equal(gateTrace[1].targetFormativeId, 'form-1');
    assert.equal(gateTrace[1].runId, 'run-1');
    assert.equal(gateTrace[1].executionContractHash, 'contract-1');

    const explicit = await product.execute(prepared, { importerVersion: 'custom', acknowledgeWarnings: true });
    assert.equal(explicit.input.importerVersion, 'custom');

    await assert.rejects(
      product.execute({ ok: true }, {}),
      error => error.code === 'TARGET_REQUIRED' && error.mutationMayHaveCommitted === false
    );

    await product.captureSession(
      { authorization: 'Bearer hidden' },
      { sourceUrl: 'https://app.formative.com/formatives/form-1', tabId: 77 }
    );
    assert.deepEqual(await product.sessionDiagnostics(77), { available: true, tabId: 77 });
    await product.clearSession(77);

    const captureTrace = h.trace.find(row => row[0] === 'capture-session');
    assert.equal(captureTrace[2].tabId, 77);
    const diagnosticsTrace = h.trace.find(row => row[0] === 'session-diagnostics');
    assert.deepEqual(diagnosticsTrace, ['session-diagnostics', 77]);
    const clearTrace = h.trace.find(row => row[0] === 'clear-session');
    assert.deepEqual(clearTrace, ['clear-session', 77]);

    await product.clearSession();
    assert.deepEqual(h.trace.filter(row => row[0] === 'clear-session').at(-1), ['clear-session', null]);

    assert.deepEqual(await product.loadImportHistory('form-1', 'assoc-1'), [{ runId: 'old-run' }]);
    assert.deepEqual(await product.loadBaseline('form-1', 'assoc-1'), {
      targetFormativeId: 'form-1', assessmentFingerprint: 'assoc-1'
    });
    assert.equal(await product.discardIncompleteRecovery({
      targetFormativeId: 'form-1', assessmentFingerprint: 'assoc-1', expectedRunId: 'run-1'
    }), true);

    const serverTrace = h.trace.find(row => row[0] === 'server-stack');
    assert.equal(serverTrace[1].sessionArea, sessionArea);
    const persistenceTrace = h.trace.find(row => row[0] === 'persistence-adapter');
    assert.equal(persistenceTrace[1], persistenceArea);
  }

  console.log('production-stack-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
