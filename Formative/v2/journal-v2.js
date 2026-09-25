(() => {
  'use strict';

  const STATUS = Object.freeze({
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    VERIFIED: 'VERIFIED',
    FAILED: 'FAILED',
    UNCERTAIN: 'UNCERTAIN',
    BLOCKED: 'BLOCKED',
    SKIPPED: 'SKIPPED'
  });

  const TERMINAL_SAFE = new Set([STATUS.VERIFIED, STATUS.SKIPPED]);

  function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cleanError(error) {
    if (!error) return null;
    if (typeof error === 'string') return { message: error.slice(0, 1000) };
    const gql = Array.isArray(error.graphQLErrors)
      ? error.graphQLErrors.slice(0, 4).map(row => ({
          message: row?.message ? String(row.message).slice(0, 500) : null,
          code: row?.extensions?.code ? String(row.extensions.code).slice(0, 120) : null
        }))
      : null;
    return {
      code: error.code ? String(error.code).slice(0, 120) : null,
      message: error.message ? String(error.message).slice(0, 1000) : String(error).slice(0, 1000),
      phase: error.phase ? String(error.phase).slice(0, 120) : null,
      operationName: error.operationName ? String(error.operationName).slice(0, 160) : null,
      status: Number.isFinite(Number(error.status)) ? Number(error.status) : null,
      formativeItemId: error.formativeItemId ? String(error.formativeItemId).slice(0, 200) : null,
      graphQLErrors: gql
    };
  }

  function isSummaryComplete(summary) {
    return summary.remaining === 0 && summary.uncertain === 0 && summary.failed === 0 && summary.blocked === 0;
  }

  function createJournal(input = {}, now = Date.now()) {
    if (!input.runId) throw new Error('runId required');
    if (!input.targetFormativeId) throw new Error('targetFormativeId required');
    if (!Array.isArray(input.operations)) throw new Error('operations required');
    if (input.executionPlan != null && !Array.isArray(input.executionPlan)) throw new Error('executionPlan must be an array');

    const seen = new Set();
    const operations = input.operations.map((op, index) => {
      const operationId = op.operationId || `${op.action || 'OP'}:${op.fingerprint || index}`;
      if (seen.has(operationId)) throw new Error(`duplicate operationId: ${operationId}`);
      seen.add(operationId);

      return {
        operationId,
        index,
        action: op.action || null,
        fingerprint: op.fingerprint || null,
        formativeItemId: op.formativeItemId || null,
        status: op.action === 'UNCHANGED' ? STATUS.SKIPPED : op.action === 'BLOCKED' ? STATUS.BLOCKED : STATUS.PENDING,
        attempts: 0,
        startedAt: null,
        finishedAt: op.action === 'UNCHANGED' || op.action === 'BLOCKED' ? nowIso(now) : null,
        lastError: op.action === 'BLOCKED' ? cleanError({ code: 'PLANNER_BLOCKED', message: 'Operation blocked by planner.' }) : null,
        result: op.action === 'UNCHANGED' ? { reason: 'UNCHANGED' } : null,
        mutationResult: null,
        mutationMayHaveCommitted: false
      };
    });
    const summary = summarizeOperations(operations);

    return {
      schema: 'cardinal.formative.import-journal/2',
      version: '2.0.0',
      sequence: 0,
      runId: input.runId,
      assessmentFingerprint: input.assessmentFingerprint || null,
      targetFormativeId: input.targetFormativeId,
      packageMode: input.packageMode || null,
      executionContractHash: input.executionContractHash || null,
      // Immutable sanitized plan snapshot. This is intentionally persisted so a
      // service-worker/browser restart can resume the exact old run even if the
      // current server state would now produce a different fresh planner diff.
      executionPlan: clone(input.executionPlan || []),
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      completedAt: isSummaryComplete(summary) ? nowIso(now) : null,
      operations,
      summary
    };
  }

  function findOperation(journal, operationId) {
    const op = journal?.operations?.find(x => x.operationId === operationId);
    if (!op) throw new Error(`unknown operationId: ${operationId}`);
    return op;
  }

  function mutate(journal, fn, now = Date.now()) {
    const next = clone(journal);
    fn(next);
    next.sequence = Number.isInteger(next.sequence) && next.sequence >= 0 ? next.sequence + 1 : 1;
    next.updatedAt = nowIso(now);
    next.summary = summarizeOperations(next.operations || []);
    if (isSummaryComplete(next.summary)) {
      next.completedAt = next.completedAt || nowIso(now);
    } else {
      next.completedAt = null;
    }
    return next;
  }

  function startOperation(journal, operationId, now = Date.now()) {
    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (![STATUS.PENDING, STATUS.FAILED].includes(op.status)) {
        throw new Error(`cannot start ${operationId} from ${op.status}`);
      }
      if (op.status === STATUS.FAILED && op.mutationMayHaveCommitted) {
        throw new Error(`cannot retry ${operationId}: previous mutation may have committed`);
      }
      op.status = STATUS.IN_PROGRESS;
      op.attempts += 1;
      op.startedAt = nowIso(now);
      op.finishedAt = null;
      op.lastError = null;
      op.result = null;
      op.mutationResult = null;
      op.mutationMayHaveCommitted = false;
    }, now);
  }

  function recordMutationResult(journal, operationId, result = {}, now = Date.now()) {
    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (op.status !== STATUS.IN_PROGRESS) {
        throw new Error(`cannot record mutation result for ${operationId} from ${op.status}`);
      }
      op.mutationResult = sanitizeResult(result);
      op.mutationMayHaveCommitted = true;
    }, now);
  }

  function markVerified(journal, operationId, result = {}, now = Date.now()) {
    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (![STATUS.IN_PROGRESS, STATUS.UNCERTAIN].includes(op.status)) {
        throw new Error(`cannot verify ${operationId} from ${op.status}`);
      }
      op.status = STATUS.VERIFIED;
      op.finishedAt = nowIso(now);
      op.lastError = null;
      op.result = sanitizeResult(result);
      op.mutationMayHaveCommitted = false;
    }, now);
  }

  function markFailed(journal, operationId, error, options = {}, now = Date.now()) {
    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (![STATUS.PENDING, STATUS.FAILED, STATUS.IN_PROGRESS].includes(op.status)) {
        throw new Error(`cannot fail ${operationId} from ${op.status}`);
      }

      const mayHaveCommitted = options.mutationMayHaveCommitted === true;
      if (mayHaveCommitted && op.status !== STATUS.IN_PROGRESS) {
        throw new Error(`cannot mark ${operationId} uncertain before mutation started`);
      }

      op.status = mayHaveCommitted ? STATUS.UNCERTAIN : STATUS.FAILED;
      op.finishedAt = nowIso(now);
      op.lastError = cleanError(error);
      op.result = null;
      if (!mayHaveCommitted) op.mutationResult = null;
      op.mutationMayHaveCommitted = mayHaveCommitted;
    }, now);
  }

  function markBlocked(journal, operationId, error, now = Date.now()) {
    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (TERMINAL_SAFE.has(op.status)) throw new Error(`cannot block ${operationId} from ${op.status}`);
      op.status = STATUS.BLOCKED;
      op.finishedAt = nowIso(now);
      op.lastError = cleanError(error);
      op.result = null;
      op.mutationMayHaveCommitted = false;
    }, now);
  }

  function reconcileUncertain(journal, operationId, serverVerdict, now = Date.now()) {
    if (!['committed', 'not_committed', 'conflict'].includes(serverVerdict?.state)) {
      throw new Error('serverVerdict.state must be committed, not_committed or conflict');
    }

    if (serverVerdict.state === 'committed') {
      return markVerified(journal, operationId, serverVerdict.result || { reconciled: true }, now);
    }

    return mutate(journal, next => {
      const op = findOperation(next, operationId);
      if (op.status !== STATUS.UNCERTAIN) throw new Error(`cannot reconcile ${operationId} from ${op.status}`);

      if (serverVerdict.state === 'not_committed') {
        op.status = STATUS.FAILED;
        op.mutationMayHaveCommitted = false;
        op.mutationResult = null;
        op.lastError = cleanError({
          code: 'RECONCILED_NOT_COMMITTED',
          message: serverVerdict.message || 'Server reread confirms mutation did not commit.'
        });
        op.finishedAt = nowIso(now);
        return;
      }

      op.status = STATUS.BLOCKED;
      op.mutationMayHaveCommitted = false;
      op.lastError = cleanError({
        code: 'RECONCILIATION_CONFLICT',
        message: serverVerdict.message || 'Server state cannot be safely reconciled.'
      });
      op.finishedAt = nowIso(now);
    }, now);
  }

  function resumePlan(journal) {
    const out = [];
    for (const op of journal?.operations || []) {
      switch (op.status) {
        case STATUS.VERIFIED:
        case STATUS.SKIPPED:
          out.push({ operationId: op.operationId, decision: 'SKIP' });
          break;
        case STATUS.PENDING:
          out.push({ operationId: op.operationId, decision: 'RUN' });
          break;
        case STATUS.FAILED:
          out.push({ operationId: op.operationId, decision: op.mutationMayHaveCommitted ? 'RECONCILE' : 'RETRY', reason: op.lastError?.code || null });
          break;
        case STATUS.UNCERTAIN:
          out.push({ operationId: op.operationId, decision: 'RECONCILE', reason: 'MUTATION_MAY_HAVE_COMMITTED' });
          break;
        case STATUS.BLOCKED:
          out.push({ operationId: op.operationId, decision: 'BLOCKED', reason: op.lastError?.code || null });
          break;
        case STATUS.IN_PROGRESS:
          // Persisted IN_PROGRESS after crash/restart is inherently uncertain.
          out.push({ operationId: op.operationId, decision: 'RECONCILE', reason: 'INTERRUPTED_IN_PROGRESS' });
          break;
        default:
          out.push({ operationId: op.operationId, decision: 'BLOCKED', reason: 'UNKNOWN_STATUS' });
      }
    }
    return out;
  }

  function summarizeOperations(operations) {
    const counts = {};
    for (const value of Object.values(STATUS)) counts[value] = 0;
    for (const op of operations || []) counts[op.status] = (counts[op.status] || 0) + 1;
    return {
      total: (operations || []).length,
      verified: counts[STATUS.VERIFIED],
      skipped: counts[STATUS.SKIPPED],
      failed: counts[STATUS.FAILED],
      uncertain: counts[STATUS.UNCERTAIN] + counts[STATUS.IN_PROGRESS],
      blocked: counts[STATUS.BLOCKED],
      remaining: counts[STATUS.PENDING],
      counts
    };
  }

  function sanitizeResult(result) {
    if (!result || typeof result !== 'object') return result == null ? null : String(result).slice(0, 1000);
    const allowed = {};
    for (const key of ['formativeItemId', 'action', 'verified', 'serverRevision', 'message', 'reconciled']) {
      if (result[key] !== undefined) allowed[key] = result[key];
    }
    return allowed;
  }

  const api = {
    STATUS,
    createJournal,
    startOperation,
    recordMutationResult,
    markVerified,
    markFailed,
    markBlocked,
    reconcileUncertain,
    resumePlan,
    summarizeOperations,
    isSummaryComplete
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Journal = api;
})();