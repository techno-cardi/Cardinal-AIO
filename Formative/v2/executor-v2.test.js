const assert = require('assert');
const journal = require('./journal-v2.js');
const contract = require('./execution-contract-v2.js');
const gateApi = require('./run-gate-v2.js');
const E = require('./executor-v2.js');

function deps(gate = gateApi.createGate()) {
  return { journal, contract, gate };
}

function callbacks(log, options = {}) {
  let saveCount = 0;
  return {
    saveJournal: async j => {
      saveCount += 1;
      log.push(`save:${j.operations.map(x => `${x.operationId}:${x.status}`).join(',')}`);
      if (options.failSaveAt === saveCount) throw new Error('journal storage unavailable');
    },
    assertOperationPrecondition: async ({ op, context }) => {
      log.push(`precondition:${op.operationId}:${context.targetFormativeId}`);
      if (options.preconditionError) throw options.preconditionError;
      if (options.preconditionBlocked) return { state: 'blocked', code: 'SERVER_CHANGED_AFTER_PREFLIGHT', message: 'manual edit detected' };
      return { state: 'verified' };
    },
    applyMutation: async ({ op }) => {
      log.push(`mutate:${op.operationId}`);
      if (options.waitMutation) await options.waitMutation;
      if (options.mutationError) throw options.mutationError;
      return { formativeItemId: op.formativeItemId || 'CREATED' };
    },
    readServerForVerification: async ({ op }) => {
      log.push(`read:${op.operationId}`);
      return { id: op.formativeItemId || 'CREATED', matchesDesired: options.matchesDesired !== false };
    },
    verifyOperation: async ({ op, serverObservation }) => {
      log.push(`verify:${op.operationId}`);
      if (!serverObservation.matchesDesired) return { state: 'failed', code: 'MISMATCH' };
      return { state: 'verified', formativeItemId: serverObservation.id, serverRevision: 'r1' };
    },
    commitBaselineVerified: async ({ op }) => {
      log.push(`baseline:${op.operationId}`);
      if (options.baselineError) throw options.baselineError;
    },
    reconcileOperation: async ({ op }) => {
      log.push(`reconcile:${op.operationId}`);
      return options.reconcileVerdict || { state: 'committed', formativeItemId: op.formativeItemId || 'CREATED', serverRevision: 'r2' };
    }
  };
}

function makeContract(ops, packageMode = 'patch', approvals = []) {
  return contract.buildExecutionContract({
    targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode,
    plannerOperations: ops, approvedDeleteFingerprints: approvals
  });
}

function makeUncertainJournal(ops) {
  const c = makeContract(ops);
  let j = journal.createJournal({
    runId: 'resume', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
    executionContractHash: c.hash,
    operations: ops.map((op, i) => ({
      operationId: op.operationId || `${op.action}:${op.fingerprint || i}`,
      action: op.action,
      fingerprint: op.fingerprint,
      formativeItemId: op.formativeItemId || null
    }))
  });
  const id = j.operations[0].operationId;
  j = journal.startOperation(j, id);
  return journal.markFailed(j, id, { code: 'TIMEOUT' }, { mutationMayHaveCommitted: true });
}

(async () => {
  // Delete is never executable without explicit approval.
  {
    const ops = [
      { action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' },
      { action: 'DELETE_PROPOSED', fingerprint: 'q2', formativeItemId: 'I2' }
    ];
    assert.deepEqual(E.executableOperations(ops).operations.map(x => x.action), ['UPDATE']);
    assert.deepEqual(E.executableOperations(ops, { approvedDeleteFingerprints: ['q2'] }).operations.map(x => x.action), ['UPDATE', 'DELETE']);
  }

  // Later CREATEs accept only IDs created and server-verified earlier in
  // this same run. Pending/failed creations and unrelated items remain unsafe.
  {
    const op = {
      operationId: 'CREATE:q2',
      action: 'CREATE',
      fingerprint: 'q2',
      preexistingServerItemIds: ['OLD']
    };
    const j = {
      operations: [
        {
          operationId: 'CREATE:q1',
          action: 'CREATE',
          status: journal.STATUS.VERIFIED,
          result: { formativeItemId: 'NEW1' }
        },
        {
          operationId: 'CREATE:q3',
          action: 'CREATE',
          status: journal.STATUS.PENDING,
          result: { formativeItemId: 'NOT-YET' }
        }
      ]
    };
    assert.deepEqual(
      E.runVerifiedCreatedIds(j, deps(), 'CREATE:q2'),
      ['NEW1']
    );
    assert.deepEqual(
      E.withRunCreatedIds(op, j, deps()).preexistingServerItemIds,
      ['NEW1', 'OLD']
    );
    assert.deepEqual(op.preexistingServerItemIds, ['OLD'], 'immutable plan must stay unchanged');
  }

  // Happy path ordering: precondition -> durable IN_PROGRESS -> mutation -> verify -> baseline -> VERIFIED.
  {
    const log = [];
    const r = await E.run({
      runId: 'success', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', baseline: { prompt: 'old' }, desired: { prompt: 'new' } }],
      callbacks: callbacks(log)
    }, deps());
    assert.equal(r.state, 'completed');
    const pos = prefix => log.findIndex(x => x.startsWith(prefix));
    assert(pos('precondition:') < pos('mutate:'));
    assert(pos('mutate:') < pos('read:'));
    assert(pos('read:') < pos('verify:'));
    assert(pos('verify:') < pos('baseline:'));
    assert.equal(r.journal.operations[0].status, journal.STATUS.VERIFIED);
    assert.equal(r.journal.executionContractHash, r.executionContractHash);
  }

  // Manual/server drift after dry-run blocks before mutation.
  {
    const log = [];
    const r = await E.run({
      runId: 'precondition-block', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks(log, { preconditionBlocked: true })
    }, deps());
    assert.equal(r.state, 'blocked');
    assert.equal(r.reason, 'PRECONDITION_BLOCKED');
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
    assert.equal(r.journal.operations[0].status, journal.STATUS.BLOCKED);
  }

  // Precondition transport failure is retryable and known not committed.
  {
    const log = [];
    const r = await E.run({
      runId: 'precondition-fail', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks(log, { preconditionError: new Error('read unavailable') })
    }, deps());
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'PRECONDITION_FAILED');
    assert.equal(r.journal.operations[0].status, journal.STATUS.FAILED);
    assert.equal(r.journal.operations[0].mutationMayHaveCommitted, false);
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
  }

  // Mutation failure before commit remains FAILED; timeout after possible commit is UNCERTAIN.
  {
    const safe = new Error('before send');
    safe.mutationMayHaveCommitted = false;
    const r1 = await E.run({
      runId: 'safe-fail', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks([], { mutationError: safe })
    }, deps());
    assert.equal(r1.state, 'failed');
    assert.equal(r1.journal.operations[0].status, journal.STATUS.FAILED);

    const uncertain = new Error('timeout');
    uncertain.mutationMayHaveCommitted = true;
    const r2 = await E.run({
      runId: 'uncertain', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks([], { mutationError: uncertain })
    }, deps());
    assert.equal(r2.state, 'uncertain');
    assert.equal(r2.journal.operations[0].status, journal.STATUS.UNCERTAIN);
  }

  // Resume uncertain committed => reconcile only, no mutation replay.
  {
    const log = [];
    const ops = [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }];
    const r = await E.run({ journal: makeUncertainJournal(ops), plannerOperations: ops, callbacks: callbacks(log) }, deps());
    assert.equal(r.state, 'completed');
    assert.equal(log.filter(x => x.startsWith('reconcile:')).length, 1);
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
  }

  // Resume uncertain proven not committed => exactly one retry, after fresh precondition.
  {
    const log = [];
    const ops = [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }];
    const r = await E.run({
      journal: makeUncertainJournal(ops), plannerOperations: ops,
      callbacks: callbacks(log, { reconcileVerdict: { state: 'not_committed' } })
    }, deps());
    assert.equal(r.state, 'completed');
    assert.equal(log.filter(x => x.startsWith('reconcile:')).length, 1);
    assert.equal(log.filter(x => x.startsWith('precondition:')).length, 1);
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 1);
  }

  // Persisted journal is bound to exact desired plan and delete approvals.
  {
    const original = [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', desired: { prompt: 'A' } }];
    const changed = [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', desired: { prompt: 'B' } }];
    const r = await E.run({ journal: makeUncertainJournal(original), plannerOperations: changed, callbacks: callbacks([]) }, deps());
    assert.equal(r.state, 'blocked');
    assert.equal(r.reason, 'EXECUTION_CONTRACT_MISMATCH');
  }

  // Verification or baseline failure after mutation cannot trigger a blind retry.
  {
    const r1 = await E.run({
      runId: 'verify-fail', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks([], { matchesDesired: false })
    }, deps());
    assert.equal(r1.state, 'uncertain');

    const r2 = await E.run({
      runId: 'baseline-fail', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks([], { baselineError: new Error('storage unavailable') })
    }, deps());
    assert.equal(r2.state, 'uncertain');
  }

  // Journal must be durable before any mutation.
  {
    const log = [];
    const r = await E.run({
      runId: 'save-fail', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks(log, { failSaveAt: 2 })
    }, deps());
    assert.equal(r.state, 'failed');
    assert.equal(r.reason, 'JOURNAL_PERSIST_FAILED_BEFORE_MUTATION');
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
  }

  // Same target is locked while an import is active. Another target remains independent.
  {
    const gate = gateApi.createGate();
    let releaseMutation;
    const waitMutation = new Promise(resolve => { releaseMutation = resolve; });
    const firstLog = [];
    const p1 = E.run({
      runId: 'concurrent-1', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }],
      callbacks: callbacks(firstLog, { waitMutation })
    }, deps(gate));

    // Wait until the first run has entered mutation while still holding the gate.
    while (!firstLog.some(x => x.startsWith('mutate:'))) await new Promise(resolve => setTimeout(resolve, 0));

    const second = await E.run({
      runId: 'concurrent-2', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q2', formativeItemId: 'I2' }],
      callbacks: callbacks([])
    }, deps(gate));
    assert.equal(second.state, 'busy');
    assert.equal(second.reason, 'TARGET_IMPORT_ALREADY_RUNNING');

    const otherTarget = await E.run({
      runId: 'concurrent-other', targetFormativeId: 'F2', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [], callbacks: callbacks([])
    }, deps(gate));
    assert.equal(otherTarget.state, 'completed');

    releaseMutation();
    const first = await p1;
    assert.equal(first.state, 'completed');
    assert.equal(gate.isLocked('F'), false);
  }

  console.log('executor-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});