const assert = require('assert');
const J = require('./journal-v2.js');

// Empty/no-op run is complete immediately and must not block the next import.
{
  const j = J.createJournal({
    runId: 'empty',
    targetFormativeId: 'F',
    assessmentFingerprint: 'A',
    packageMode: 'patch',
    executionContractHash: 'h',
    operations: []
  }, Date.parse('2026-09-21T12:00:00Z'));
  assert(j.completedAt);
  assert.equal(j.summary.remaining, 0);
  assert.equal(J.isSummaryComplete(j.summary), true);
}

// All-UNCHANGED run is also complete immediately.
{
  const j = J.createJournal({
    runId: 'unchanged',
    targetFormativeId: 'F',
    assessmentFingerprint: 'A',
    packageMode: 'full',
    executionContractHash: 'h',
    operations: [
      { operationId: 'q1', action: 'UNCHANGED', fingerprint: 'q1', formativeItemId: 'I1' },
      { operationId: 'q2', action: 'UNCHANGED', fingerprint: 'q2', formativeItemId: 'I2' }
    ]
  });
  assert(j.completedAt);
  assert.equal(j.operations.every(x => x.status === J.STATUS.SKIPPED), true);
}

// BLOCKED is terminal for execution but not a successful completed journal.
{
  const j = J.createJournal({
    runId: 'blocked',
    targetFormativeId: 'F',
    assessmentFingerprint: 'A',
    packageMode: 'patch',
    executionContractHash: 'h',
    operations: [{ operationId: 'q1', action: 'BLOCKED', fingerprint: 'q1' }]
  });
  assert.equal(j.completedAt, null);
  assert.equal(j.summary.blocked, 1);
}

console.log('journal-noop-v2: all tests passed');