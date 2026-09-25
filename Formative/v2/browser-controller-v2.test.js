'use strict';

const assert = require('node:assert/strict');
const controllerApi = require('./browser-controller-v2.js');
const targetSelector = require('./target-selector-v2.js');
const progressApi = require('./progress-v2.js');
const errorPresenter = require('./error-presenter-v2.js');

function makeHarness(options = {}) {
  const calls = [];
  const states = [];
  const progress = [];
  let executeImpl = options.executeImpl || (async prepared => ({
    state: 'completed',
    view: { statusLabel: '✓ Import vérifié' },
    prepared
  }));

  const product = {
    async prepare(input) {
      calls.push(['prepare', input]);
      const prepareNo = calls.filter(x => x[0] === 'prepare').length;
      if (options.recoveryOnFirstPrepare === true && prepareNo === 1) {
        return {
          ok: true,
          state: 'recovery',
          mode: 'resume',
          targetFormativeId: input.targetFormativeId,
          targetTabId: input.targetTabId,
          assessmentFingerprint: 'assessment-a',
          packageFingerprint: 'pkg-recovery',
          runId: 'run-old',
          journal: {
            runId: 'run-old',
            summary: { verified: 0, remaining: 2, uncertain: 1, failed: 0 },
            operations: [
              {
                operationId: 'update:q1',
                action: 'UPDATE',
                formativeItemId: 'existing-q1',
                status: 'UNCERTAIN',
                mutationMayHaveCommitted: true
              },
              {
                operationId: 'create:q2',
                action: 'CREATE',
                formativeItemId: null,
                status: 'PENDING',
                mutationMayHaveCommitted: false
              }
            ]
          },
          view: { statusLabel: '↻ Reprise requise', primaryAction: { id: 'reimport' } }
        };
      }
      return {
        ok: true,
        state: options.preparedState || 'ready',
        mode: options.preparedMode || 'new',
        targetFormativeId: input.targetFormativeId,
        targetTabId: input.targetTabId,
        packageFingerprint: `pkg-${prepareNo}`,
        runId: `run-${prepareNo}`,
        view: { statusLabel: '✓ Prêt', primaryAction: { id: 'import' } }
      };
    },
    async execute(prepared, input) {
      calls.push(['execute', prepared, input]);
      return executeImpl(prepared, input);
    },
    async confirmReconciliation(prepared, input) {
      calls.push(['confirm', prepared, input]);
      return {
        ...prepared,
        ok: true,
        state: 'ready',
        mode: 'new',
        view: { statusLabel: '✓ Prêt', primaryAction: { id: 'import' } }
      };
    },
    async discardIncompleteRecovery(input) {
      calls.push(['discard', input]);
      return true;
    }
  };

  let targets = options.targets || [{
    tabId: 10,
    targetFormativeId: 'form-a',
    title: 'Évaluation A',
    active: true,
    canEdit: true,
    authState: 'authenticated',
    pageKind: 'editor'
  }];

  let tokenNumber = 0;
  const controller = controllerApi.createController({
    product,
    targetSelector,
    progressApi,
    errorPresenter,
    enumerateTargets: async () => targets,
    tokenFactory: () => `ui-${++tokenNumber}`,
    emitState: async state => states.push(state),
    progressSinks: [event => progress.push(event)]
  });

  return {
    controller,
    calls,
    states,
    progress,
    setTargets(next) { targets = next; },
    setExecuteImpl(fn) { executeImpl = fn; }
  };
}

(async () => {
  // Multiple different editable targets always produce a chooser, never a
  // silent active-tab selection and never a product.prepare call.
  {
    const h = makeHarness({ targets: [
      { tabId: 1, targetFormativeId: 'a', title: 'A', active: true, canEdit: true, authState: 'authenticated', pageKind: 'editor' },
      { tabId: 2, targetFormativeId: 'b', title: 'B', active: false, canEdit: true, authState: 'authenticated', pageKind: 'editor' }
    ] });
    const result = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    assert.equal(result.state, 'target_selection_required');
    assert.equal(result.chooserRows.length, 2);
    assert.equal(h.calls.filter(x => x[0] === 'prepare').length, 0);
  }

  // Explicit target/tab reaches the product facade and binds a one-use UI token
  // to that prepared state.
  {
    const h = makeHarness();
    const prepared = await h.controller.preparePackage({
      pkg: { schema: 'x' },
      requestedTabId: 10,
      requestedTargetId: 'form-a'
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.token, 'ui-1');
    assert.equal(prepared.targetFormativeId, 'form-a');
    assert.equal(h.calls[0][0], 'prepare');
    assert.equal(h.calls[0][1].targetTabId, 10);
    assert.equal(h.calls[0][1].targetFormativeId, 'form-a');
  }

  // Preparing again invalidates old buttons. The stale button cannot execute a
  // mutation against either the old or the new target.
  {
    const h = makeHarness();
    const first = await h.controller.preparePackage({ pkg: { schema: 'a' } });
    const second = await h.controller.preparePackage({ pkg: { schema: 'b' } });
    assert.notEqual(first.token, second.token);

    const stale = await h.controller.execute(first.token);
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, 'STALE_UI_ACTION');
    assert.equal(h.calls.filter(x => x[0] === 'execute').length, 0);

    const done = await h.controller.execute(second.token);
    assert.equal(done.state, 'completed');
    assert.equal(h.calls.filter(x => x[0] === 'execute').length, 1);
  }

  // Double click while a mutation is in flight results in exactly one product
  // execution. The second click is informational, never an automatic retry.
  {
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const h = makeHarness({
      executeImpl: async () => {
        await barrier;
        return { state: 'completed', view: { statusLabel: '✓ Import vérifié' } };
      }
    });
    const prepared = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    const firstExecution = h.controller.execute(prepared.token);
    await new Promise(resolve => setImmediate(resolve));

    const secondExecution = await h.controller.execute(prepared.token);
    assert.equal(secondExecution.ok, false);
    assert.equal(secondExecution.reason, 'TARGET_IMPORT_ALREADY_RUNNING');
    assert.equal(h.calls.filter(x => x[0] === 'execute').length, 1);

    release();
    const completed = await firstExecution;
    assert.equal(completed.state, 'completed');
  }

  // Reimport/retry is always a fresh prepare and server read. It never replays
  // the old prepared object/runId directly.
  {
    const h = makeHarness();
    const first = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    await h.controller.execute(first.token);
    const executesBefore = h.calls.filter(x => x[0] === 'execute').length;
    const preparesBefore = h.calls.filter(x => x[0] === 'prepare').length;

    const refreshed = await h.controller.reprepare(first.token);
    assert.equal(refreshed.ok, true);
    assert.notEqual(refreshed.token, first.token);
    assert.equal(h.calls.filter(x => x[0] === 'prepare').length, preparesBefore + 1);
    assert.equal(h.calls.filter(x => x[0] === 'execute').length, executesBefore);
  }

  // An update-only uncertain recovery can be explicitly abandoned for a fresh
  // server read without risking duplication. The baseline stays in place.
  {
    const h = makeHarness({ recoveryOnFirstPrepare: true });
    const first = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    assert.equal(first.state, 'recovery');
    assert.equal(controllerApi.canFreshReprepareRecovery(first.prepared), true);

    const refreshed = await h.controller.reprepare(first.token);
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.state, 'ready');
    const discard = h.calls.find(x => x[0] === 'discard');
    assert(discard);
    assert.equal(discard[1].targetFormativeId, 'form-a');
    assert.equal(discard[1].assessmentFingerprint, 'assessment-a');
    assert.equal(discard[1].expectedRunId, 'run-old');
    assert.equal(h.calls.filter(x => x[0] === 'prepare').length, 2);
  }

  // An uncertain CREATE cannot be discarded for a fresh prepare because it
  // could already exist on the server and would risk duplication.
  {
    assert.equal(controllerApi.canFreshReprepareRecovery({
      ok: true,
      state: 'recovery',
      mode: 'resume',
      journal: {
        summary: { verified: 0 },
        operations: [{
          action: 'CREATE',
          formativeItemId: 'maybe-created',
          status: 'UNCERTAIN',
          mutationMayHaveCommitted: true
        }]
      }
    }), false);
  }

  // Dismissing the ChatGPT surface is UI-only. It does not clear current state
  // and does not call any mutation/recovery operation.
  {
    const h = makeHarness();
    const prepared = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    const before = h.calls.length;
    assert.equal(h.controller.dismiss(prepared.token), true);
    assert.equal(h.calls.length, before);
    assert.equal(h.controller.snapshot().token, prepared.token);
  }

  // Reconciliation stays tied to the same prepared token and target; the
  // product facade performs the fresh server re-read internally.
  {
    const h = makeHarness({ preparedState: 'reconciliation_required' });
    const prepared = await h.controller.preparePackage({ pkg: { schema: 'x' } });
    const next = await h.controller.confirmReconciliation(prepared.token, {
      approvedProposals: [{ fingerprint: 'f1', approvalToken: 'a1' }]
    });
    assert.equal(next.ok, true);
    assert.equal(next.state, 'ready');
    assert.equal(h.calls.filter(x => x[0] === 'confirm').length, 1);
  }

  console.log('browser-controller-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});