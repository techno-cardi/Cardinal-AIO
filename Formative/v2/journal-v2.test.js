const assert = require('assert');
const J = require('./journal-v2.js');

function make() {
  return J.createJournal({
    runId: 'run-1',
    targetFormativeId: 'F',
    assessmentFingerprint: 'A',
    packageMode: 'patch',
    operations: [
      { operationId: 'op1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' },
      { operationId: 'op2', action: 'UNCHANGED', fingerprint: 'q2', formativeItemId: 'I2' },
      { operationId: 'op3', action: 'CREATE', fingerprint: 'q3' }
    ]
  }, Date.parse('2026-09-20T20:00:00Z'));
}

// UNCHANGED is already safely skipped; pending operations remain resumable.
{
  const j = make();
  assert.equal(j.operations[1].status, J.STATUS.SKIPPED);
  const plan = J.resumePlan(j);
  assert.equal(plan.find(x => x.operationId === 'op1').decision, 'RUN');
  assert.equal(plan.find(x => x.operationId === 'op2').decision, 'SKIP');
}

// Verified item is never re-run.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markVerified(j, 'op1', { formativeItemId: 'I1', action: 'UPDATE', verified: true });
  assert.equal(J.resumePlan(j).find(x => x.operationId === 'op1').decision, 'SKIP');
}

// A pre-mutation/local failure can retry.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markFailed(j, 'op1', { code: 'VALIDATION', message: 'No request sent' }, { mutationMayHaveCommitted: false });
  assert.equal(j.operations[0].status, J.STATUS.FAILED);
  assert.equal(J.resumePlan(j)[0].decision, 'RETRY');
  j = J.startOperation(j, 'op1');
  assert.equal(j.operations[0].attempts, 2);
}

// Timeout after request becomes UNCERTAIN and must never blindly retry.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markFailed(j, 'op1', { code: 'TIMEOUT', message: 'Response lost' }, { mutationMayHaveCommitted: true });
  assert.equal(j.operations[0].status, J.STATUS.UNCERTAIN);
  assert.equal(J.resumePlan(j)[0].decision, 'RECONCILE');
  assert.throws(() => J.startOperation(j, 'op1'));
}

// A successful server mutation acknowledgement is durable before post-verification.
{
  let j = make();
  j = J.startOperation(j, 'op3');
  j = J.recordMutationResult(j, 'op3', {
    formativeItemId: 'NEW1',
    authorization: 'SECRET'
  });
  assert.equal(j.operations[2].mutationResult.formativeItemId, 'NEW1');
  assert.equal(j.operations[2].mutationResult.authorization, undefined);
  j = J.markFailed(j, 'op3', { code: 'POSTCONDITION_MISMATCH' }, { mutationMayHaveCommitted: true });
  assert.equal(j.operations[2].mutationResult.formativeItemId, 'NEW1');
  assert.equal(J.resumePlan(j)[2].decision, 'RECONCILE');
}

// Server reread may confirm uncertain mutation committed.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markFailed(j, 'op1', 'timeout', { mutationMayHaveCommitted: true });
  j = J.reconcileUncertain(j, 'op1', { state: 'committed', result: { formativeItemId: 'I1', verified: true, reconciled: true } });
  assert.equal(j.operations[0].status, J.STATUS.VERIFIED);
}

// Or prove it did not commit, enabling a later controlled retry.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markFailed(j, 'op1', 'timeout', { mutationMayHaveCommitted: true });
  j = J.reconcileUncertain(j, 'op1', { state: 'not_committed' });
  assert.equal(j.operations[0].status, J.STATUS.FAILED);
  assert.equal(J.resumePlan(j)[0].decision, 'RETRY');
}

// Persisted IN_PROGRESS can be reconciled directly after a crash.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.reconcileUncertain(j, 'op1', { state: 'not_committed' });
  assert.equal(j.operations[0].status, J.STATUS.FAILED);
  assert.equal(J.resumePlan(j)[0].decision, 'RETRY');
}

// Persisted IN_PROGRESS after crash/restart is treated as uncertain.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  const plan = J.resumePlan(j);
  assert.equal(plan[0].decision, 'RECONCILE');
  assert.equal(plan[0].reason, 'INTERRUPTED_IN_PROGRESS');
}

// Result journal stores only whitelisted non-secret result fields.
{
  let j = make();
  j = J.startOperation(j, 'op1');
  j = J.markVerified(j, 'op1', {
    formativeItemId: 'I1',
    verified: true,
    authorization: 'SECRET',
    headers: { authorization: 'SECRET' }
  });
  assert.equal(j.operations[0].result.authorization, undefined);
  assert.equal(j.operations[0].result.headers, undefined);
}

console.log('journal-v2: all tests passed');