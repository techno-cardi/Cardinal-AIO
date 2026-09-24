(() => {
  'use strict';

  function requiredFn(callbacks, name) {
    const fn = callbacks?.[name];
    if (typeof fn !== 'function') throw new Error(`${name} callback required`);
    return fn;
  }

  function operationId(op, index) {
    return op.operationId || `${op.action || 'OP'}:${op.fingerprint || index}`;
  }

  function executableOperations(plannerOperations, options = {}) {
    const approvedDeletes = new Set(options.approvedDeleteFingerprints || []);
    const operations = [];
    const blocked = [];

    (plannerOperations || []).forEach((op, index) => {
      const id = operationId(op, index);

      if (op.action === 'CREATE' || op.action === 'UPDATE') {
        operations.push({ ...op, operationId: id });
        return;
      }

      if (op.action === 'DELETE_PROPOSED') {
        if (approvedDeletes.has(op.fingerprint)) {
          operations.push({ ...op, action: 'DELETE', operationId: id });
        } else {
          blocked.push({ ...op, operationId: id, executionDecision: 'REQUIRES_EXPLICIT_DELETE_APPROVAL' });
        }
        return;
      }

      if (op.action === 'BLOCKED') {
        blocked.push({ ...op, operationId: id, executionDecision: 'BLOCKED_BY_PLANNER' });
      }
    });

    return { operations, blocked };
  }

  function makeJournalOperations(plannerOperations, options = {}) {
    const approvedDeletes = new Set(options.approvedDeleteFingerprints || []);
    return (plannerOperations || []).map((op, index) => {
      let action = op.action;
      if (action === 'DELETE_PROPOSED') {
        action = approvedDeletes.has(op.fingerprint) ? 'DELETE' : 'UNCHANGED';
      }
      if (action === 'PRESERVE_EXTERNAL') action = 'UNCHANGED';
      if (action === 'BLOCKED') action = 'BLOCKED';
      return {
        operationId: operationId(op, index),
        action,
        fingerprint: op.fingerprint || null,
        formativeItemId: op.formativeItemId || null
      };
    });
  }

  async function persistJournal(callbacks, journal) {
    await requiredFn(callbacks, 'saveJournal')(journal);
    return journal;
  }

  function findJournalOp(journal, operationIdValue) {
    const op = journal?.operations?.find(x => x.operationId === operationIdValue);
    if (!op) throw new Error(`journal operation missing: ${operationIdValue}`);
    return op;
  }

  function errorFromVerdict(verdict, fallbackCode, fallbackMessage, phase) {
    const error = new Error(verdict?.message || fallbackMessage);
    error.code = verdict?.code || fallbackCode;
    error.phase = phase;
    return error;
  }

  async function verifyPrecondition({ op, journal, callbacks, deps, context }) {
    let verdict;
    try {
      verdict = await requiredFn(callbacks, 'assertOperationPrecondition')({ op, context });
    } catch (error) {
      error.phase = error.phase || 'precondition';
      journal = deps.journal.markFailed(
        journal,
        op.operationId,
        error,
        { mutationMayHaveCommitted: false }
      );
      await persistJournal(callbacks, journal);
      return { journal, ok: false, stopped: true, reason: 'PRECONDITION_FAILED', error };
    }

    if (!verdict || verdict.state !== 'verified') {
      const error = errorFromVerdict(
        verdict,
        'OPERATION_PRECONDITION_BLOCKED',
        'Server state changed after preflight. Mutation blocked before write.',
        'precondition'
      );
      journal = deps.journal.markBlocked(journal, op.operationId, error);
      await persistJournal(callbacks, journal);
      return { journal, ok: false, stopped: true, reason: 'PRECONDITION_BLOCKED', error };
    }

    return { journal, ok: true, stopped: false, verdict };
  }

  async function verifyAndCommit({ op, mutationResult, journal, callbacks, deps, context }) {
    const readServerForVerification = requiredFn(callbacks, 'readServerForVerification');
    const commitBaselineVerified = requiredFn(callbacks, 'commitBaselineVerified');

    const serverObservation = await readServerForVerification({ op, mutationResult, context });
    const verdict = await requiredFn(callbacks, 'verifyOperation')({
      op,
      mutationResult,
      serverObservation,
      context
    });

    if (!verdict || verdict.state !== 'verified') {
      throw errorFromVerdict(verdict, 'SERVER_VERIFICATION_FAILED', 'Server verification failed', 'verify');
    }

    // Ordering invariant:
    // 1) server verified
    // 2) baseline updated idempotently
    // 3) journal becomes VERIFIED last
    // If the worker dies between 2 and 3, persisted IN_PROGRESS forces a
    // reconciliation, never a second blind mutation.
    await commitBaselineVerified({
      op,
      mutationResult,
      serverObservation,
      verdict,
      context
    });

    journal = deps.journal.markVerified(
      journal,
      op.operationId,
      {
        formativeItemId: verdict.formativeItemId || mutationResult?.formativeItemId || op.formativeItemId || null,
        action: op.action,
        verified: true,
        serverRevision: verdict.serverRevision || null,
        message: verdict.message || null
      }
    );
    await persistJournal(callbacks, journal);
    return journal;
  }

  async function executeOne({ op, journal, callbacks, deps, context }) {
    // Critical TOCTOU guard: preflight may be seconds old. Re-read/assert the
    // exact target/item immediately before changing the journal to IN_PROGRESS
    // and before sending any mutation. A manual server edit blocks the write.
    const precondition = await verifyPrecondition({ op, journal, callbacks, deps, context });
    journal = precondition.journal;
    if (precondition.stopped) return precondition;

    journal = deps.journal.startOperation(journal, op.operationId);
    try {
      await persistJournal(callbacks, journal); // durable IN_PROGRESS before request
    } catch (error) {
      error.phase = error.phase || 'journal-before-mutation';
      return { journal, stopped: true, reason: 'JOURNAL_PERSIST_FAILED_BEFORE_MUTATION', error };
    }

    let mutationResult;
    try {
      mutationResult = await requiredFn(callbacks, 'applyMutation')({ op, context });
    } catch (error) {
      const mayHaveCommitted = error?.mutationMayHaveCommitted === true;
      journal = deps.journal.markFailed(
        journal,
        op.operationId,
        error,
        { mutationMayHaveCommitted: mayHaveCommitted }
      );
      try {
        await persistJournal(callbacks, journal);
      } catch (persistError) {
        persistError.phase = persistError.phase || 'journal-after-mutation-error';
        return {
          journal,
          stopped: true,
          reason: mayHaveCommitted ? 'UNCERTAIN_UNPERSISTED' : 'FAILED_UNPERSISTED',
          error: persistError,
          originalError: error
        };
      }
      return { journal, stopped: true, reason: mayHaveCommitted ? 'UNCERTAIN' : 'FAILED', error };
    }

    try {
      journal = await verifyAndCommit({ op, mutationResult, journal, callbacks, deps, context });
      return { journal, stopped: false };
    } catch (error) {
      // Mutation already returned. A verification/baseline/journal failure must
      // never trigger a fresh mutation. Mark uncertain and reconcile from server.
      journal = deps.journal.markFailed(
        journal,
        op.operationId,
        error,
        { mutationMayHaveCommitted: true }
      );
      try {
        await persistJournal(callbacks, journal);
      } catch (persistError) {
        persistError.phase = persistError.phase || 'journal-after-possible-commit';
        return {
          journal,
          stopped: true,
          reason: 'UNCERTAIN_UNPERSISTED',
          error: persistError,
          originalError: error
        };
      }
      return { journal, stopped: true, reason: 'UNCERTAIN', error };
    }
  }

  async function reconcileOne({ op, journal, callbacks, deps, context }) {
    const verdict = await requiredFn(callbacks, 'reconcileOperation')({ op, context });

    if (!verdict || !['committed', 'not_committed', 'conflict'].includes(verdict.state)) {
      throw new Error('reconcileOperation must return committed, not_committed or conflict');
    }

    if (verdict.state === 'committed') {
      // Baseline must be repaired before marking journal verified, for the same
      // crash-safety ordering as normal verification.
      await requiredFn(callbacks, 'commitBaselineVerified')({
        op,
        mutationResult: verdict.mutationResult || null,
        serverObservation: verdict.serverObservation || null,
        verdict: verdict.verification || {
          state: 'verified',
          formativeItemId: verdict.formativeItemId || op.formativeItemId || null,
          serverRevision: verdict.serverRevision || null,
          message: 'Recovered by reconciliation'
        },
        context
      });
    }

    journal = deps.journal.reconcileUncertain(
      journal,
      op.operationId,
      verdict.state === 'committed'
        ? {
            state: 'committed',
            result: {
              formativeItemId: verdict.formativeItemId || op.formativeItemId || null,
              action: op.action,
              verified: true,
              serverRevision: verdict.serverRevision || null,
              reconciled: true
            }
          }
        : { state: verdict.state, message: verdict.message || null }
    );

    await persistJournal(callbacks, journal);
    return journal;
  }

  function publicStateForStop(reason) {
    if (reason === 'UNCERTAIN' || reason === 'UNCERTAIN_UNPERSISTED') return 'uncertain';
    if (reason === 'PRECONDITION_BLOCKED') return 'blocked';
    return 'failed';
  }

  async function runAcquired({
    input,
    deps,
    callbacks,
    plannerOperations,
    targetFormativeId,
    assessmentFingerprint,
    packageMode,
    approvedDeleteFingerprints,
    executionContract,
    execution,
    context
  }) {
    let journal = input.journal;
    if (!journal) {
      journal = deps.journal.createJournal({
        runId: input.runId,
        targetFormativeId,
        assessmentFingerprint,
        packageMode,
        executionContractHash: executionContract.hash,
        operations: makeJournalOperations(plannerOperations, { approvedDeleteFingerprints })
      });
      try {
        await persistJournal(callbacks, journal);
      } catch (error) {
        return {
          ok: false,
          state: 'failed',
          journal,
          blocked: execution.blocked,
          reason: 'INITIAL_JOURNAL_PERSIST_FAILED',
          error
        };
      }
    } else {
      const contractCheck = deps.contract.validateJournalContract(journal, executionContract);
      if (!contractCheck.ok) {
        return {
          ok: false,
          state: 'blocked',
          journal,
          blocked: execution.blocked,
          reason: contractCheck.code || 'EXECUTION_CONTRACT_MISMATCH',
          contractIssues: contractCheck.issues || []
        };
      }
    }

    const executableById = new Map(execution.operations.map(op => [op.operationId, op]));
    const resume = deps.journal.resumePlan(journal);

    for (const step of resume) {
      if (step.decision === 'SKIP') continue;
      if (step.decision === 'BLOCKED') {
        return { ok: false, state: 'blocked', journal, blocked: execution.blocked, reason: step.reason || 'JOURNAL_BLOCKED' };
      }

      const op = executableById.get(step.operationId);
      if (!op) {
        // This includes unapproved DELETE_PROPOSED or PRESERVE_EXTERNAL. They
        // are represented as SKIPPED in fresh journals. If a persisted journal
        // asks to run one, refuse rather than invent a mutation.
        return { ok: false, state: 'blocked', journal, blocked: execution.blocked, reason: `NO_EXECUTABLE_OPERATION:${step.operationId}` };
      }

      if (step.decision === 'RECONCILE') {
        try {
          journal = await reconcileOne({ op, journal, callbacks, deps, context });
        } catch (error) {
          return { ok: false, state: 'blocked', journal, blocked: execution.blocked, reason: 'RECONCILIATION_FAILED', error };
        }

        const after = findJournalOp(journal, op.operationId);
        if (after.status === deps.journal.STATUS.FAILED) {
          // Proven not committed: retry is now safe, but only after the fresh
          // operation precondition passes again.
          const result = await executeOne({ op, journal, callbacks, deps, context });
          journal = result.journal;
          if (result.stopped) return { ok: false, state: publicStateForStop(result.reason), journal, blocked: execution.blocked, reason: result.reason, error: result.error };
        } else if (after.status !== deps.journal.STATUS.VERIFIED) {
          return { ok: false, state: 'blocked', journal, blocked: execution.blocked, reason: 'RECONCILIATION_BLOCKED' };
        }
        continue;
      }

      if (step.decision === 'RUN' || step.decision === 'RETRY') {
        const result = await executeOne({ op, journal, callbacks, deps, context });
        journal = result.journal;
        if (result.stopped) {
          return {
            ok: false,
            state: publicStateForStop(result.reason),
            journal,
            blocked: execution.blocked,
            reason: result.reason,
            error: result.error
          };
        }
      }
    }

    const finalResume = deps.journal.resumePlan(journal);
    const pendingUnsafe = finalResume.filter(x => !['SKIP'].includes(x.decision));

    return {
      ok: pendingUnsafe.length === 0,
      state: pendingUnsafe.length ? 'review' : 'completed',
      journal,
      blocked: execution.blocked,
      pending: pendingUnsafe,
      executionContractHash: executionContract.hash
    };
  }

  /**
   * Execute/resume an already-approved planner result.
   * The function itself knows nothing about Formative transport; all side
   * effects are injected and therefore testable.
   */
  async function run(input = {}, injected = {}) {
    const gateApi = injected.gateApi || globalThis.CardinalFormativeV2RunGate;
    const deps = {
      journal: injected.journal || globalThis.CardinalFormativeV2Journal,
      contract: injected.contract || globalThis.CardinalFormativeV2ExecutionContract,
      gate: injected.gate || gateApi?.defaultGate || null
    };
    if (!deps.journal) throw new Error('journal dependency required');
    if (!deps.contract) throw new Error('execution contract dependency required');
    if (!deps.gate) throw new Error('run gate dependency required');

    const callbacks = input.callbacks || {};
    const plannerOperations = input.plannerOperations || [];
    const targetFormativeId = input.targetFormativeId || input.journal?.targetFormativeId || null;
    const assessmentFingerprint = input.assessmentFingerprint !== undefined
      ? input.assessmentFingerprint
      : (input.journal?.assessmentFingerprint || null);
    const packageMode = input.packageMode || input.journal?.packageMode || null;
    const runId = input.runId || input.journal?.runId || null;
    const approvedDeleteFingerprints = input.approvedDeleteFingerprints || [];

    let executionContract;
    try {
      executionContract = deps.contract.buildExecutionContract({
        targetFormativeId,
        assessmentFingerprint,
        packageMode,
        plannerOperations,
        approvedDeleteFingerprints
      });
    } catch (error) {
      return {
        ok: false,
        state: 'blocked',
        journal: input.journal || null,
        blocked: [],
        reason: 'INVALID_EXECUTION_CONTRACT_INPUT',
        error
      };
    }

    const execution = executableOperations(plannerOperations, { approvedDeleteFingerprints });

    if (execution.blocked.some(x => x.action === 'BLOCKED')) {
      return {
        ok: false,
        state: 'blocked',
        journal: input.journal || null,
        blocked: execution.blocked,
        reason: 'PLANNER_BLOCKED'
      };
    }

    const claim = deps.gate.tryAcquire({
      targetFormativeId,
      runId,
      executionContractHash: executionContract.hash
    });
    if (!claim.acquired) {
      return {
        ok: false,
        state: 'busy',
        journal: input.journal || null,
        blocked: execution.blocked,
        reason: claim.reason || 'TARGET_IMPORT_ALREADY_RUNNING',
        activeRun: claim.active || null
      };
    }

    const context = {
      ...(input.context || {}),
      runId,
      targetFormativeId,
      assessmentFingerprint,
      packageMode,
      executionContractHash: executionContract.hash
    };

    try {
      return await runAcquired({
        input,
        deps,
        callbacks,
        plannerOperations,
        targetFormativeId,
        assessmentFingerprint,
        packageMode,
        approvedDeleteFingerprints,
        executionContract,
        execution,
        context
      });
    } finally {
      deps.gate.release(claim.token);
    }
  }

  const api = {
    executableOperations,
    makeJournalOperations,
    run
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Executor = api;
})();