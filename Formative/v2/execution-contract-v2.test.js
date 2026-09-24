const assert = require('assert');
const C = require('./execution-contract-v2.js');

function input(overrides = {}) {
  return {
    targetFormativeId: 'F1',
    assessmentFingerprint: 'A1',
    packageMode: 'patch',
    approvedDeleteFingerprints: [],
    plannerOperations: [
      {
        action: 'UPDATE',
        fingerprint: 'q1',
        formativeItemId: 'I1',
        baseline: { prompt: 'old', points: 2 },
        desired: { prompt: 'new', points: 2 }
      }
    ],
    ...overrides
  };
}

// Deterministic across object key order.
{
  const a = C.buildExecutionContract(input());
  const b = C.buildExecutionContract(input({
    plannerOperations: [{
      desired: { points: 2, prompt: 'new' },
      baseline: { points: 2, prompt: 'old' },
      formativeItemId: 'I1',
      fingerprint: 'q1',
      action: 'UPDATE'
    }]
  }));
  assert.equal(a.hash, b.hash);
}

// Desired content is part of the contract.
{
  const a = C.buildExecutionContract(input());
  const b = C.buildExecutionContract(input({
    plannerOperations: [{
      action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1',
      baseline: { prompt: 'old', points: 2 }, desired: { prompt: 'different', points: 2 }
    }]
  }));
  assert.notEqual(a.hash, b.hash);
}

// Target, assessment and package mode are bound.
{
  const base = C.buildExecutionContract(input()).hash;
  assert.notEqual(base, C.buildExecutionContract(input({ targetFormativeId: 'F2' })).hash);
  assert.notEqual(base, C.buildExecutionContract(input({ assessmentFingerprint: 'A2' })).hash);
  assert.notEqual(base, C.buildExecutionContract(input({ packageMode: 'full' })).hash);
}

// Delete approval is explicit contract material; order/duplicates are normalized.
{
  const ops = [{ action: 'DELETE_PROPOSED', fingerprint: 'q3', formativeItemId: 'I3' }];
  const none = C.buildExecutionContract(input({ packageMode: 'full', plannerOperations: ops })).hash;
  const approvedA = C.buildExecutionContract(input({ packageMode: 'full', plannerOperations: ops, approvedDeleteFingerprints: ['q3'] })).hash;
  const approvedB = C.buildExecutionContract(input({ packageMode: 'full', plannerOperations: ops, approvedDeleteFingerprints: ['q3', 'q3'] })).hash;
  assert.notEqual(none, approvedA);
  assert.equal(approvedA, approvedB);
}

// Journal check rejects a changed plan or missing contract hash.
{
  const c = C.buildExecutionContract(input());
  const good = {
    targetFormativeId: 'F1',
    assessmentFingerprint: 'A1',
    packageMode: 'patch',
    executionContractHash: c.hash
  };
  assert.equal(C.validateJournalContract(good, c).ok, true);
  assert.equal(C.validateJournalContract({ ...good, executionContractHash: null }, c).ok, false);
  assert.equal(C.validateJournalContract({ ...good, targetFormativeId: 'F2' }, c).ok, false);
}

// Invalid inputs fail closed.
assert.throws(() => C.buildExecutionContract({ ...input(), targetFormativeId: null }));
assert.throws(() => C.buildExecutionContract({ ...input(), packageMode: 'weird' }));
assert.throws(() => C.buildExecutionContract({ ...input(), plannerOperations: null }));

console.log('execution-contract-v2: all tests passed');