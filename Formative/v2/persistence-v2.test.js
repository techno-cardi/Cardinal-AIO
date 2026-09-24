const assert = require('assert');
const baseline = require('./baseline-store-v2.js');
const journal = require('./journal-v2.js');
const P = require('./persistence-v2.js');

function managed(prompt) {
  return { subtype: 'shortAnswer', prompt, points: 2 };
}

function makeJournal(runId = 'r1') {
  return journal.createJournal({
    runId,
    targetFormativeId: 'F',
    assessmentFingerprint: 'A',
    packageMode: 'patch',
    executionContractHash: `contract-${runId}`,
    operations: [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }]
  });
}

(async () => {
  // Baseline writes are monotonic and stale writes are refused.
  {
    const adapter = P.createMemoryAdapter();
    const store = P.createPersistence({ adapter, baseline });
    let b0 = baseline.createBaseline({
      targetFormativeId: 'F', assessmentFingerprint: 'A',
      entries: [{ fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('old') }]
    });
    await store.saveBaseline(b0);
    assert.equal((await store.loadBaseline('F', 'A')).generation, 0);

    const b1 = baseline.updateAfterVerified(b0, [{ fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('new') }]);
    assert.equal(b1.generation, 1);
    await store.saveBaseline(b1);
    assert.equal((await store.loadBaseline('F', 'A')).entries[0].managedState.prompt, 'new');

    await assert.rejects(store.saveBaseline(b0), error => error.code === 'STALE_BASELINE_WRITE');
    await assert.rejects(store.saveBaseline({ ...b1, metadata: { changed: true } }), error => error.code === 'BASELINE_GENERATION_COLLISION');
  }

  // First baseline must start at generation 0 and generation gaps are blocked.
  {
    const store = P.createPersistence({ adapter: P.createMemoryAdapter(), baseline });
    const bad = baseline.createBaseline({ targetFormativeId: 'F', assessmentFingerprint: 'A', entries: [] });
    bad.generation = 2;
    await assert.rejects(store.saveBaseline(bad), error => error.code === 'BASELINE_INITIAL_GENERATION_INVALID');
  }

  // Journal sequence is monotonic; stale/colliding writes cannot overwrite newer recovery state.
  {
    const adapter = P.createMemoryAdapter();
    const store = P.createPersistence({ adapter, baseline });
    const j0 = makeJournal('r1');
    await store.saveJournal(j0);
    let j1 = journal.startOperation(j0, 'UPDATE:q1');
    assert.equal(j1.sequence, 1);
    await store.saveJournal(j1);

    await assert.rejects(store.saveJournal(j0), error => error.code === 'STALE_JOURNAL_WRITE');
    await assert.rejects(store.saveJournal({ ...j1, updatedAt: '2099-01-01T00:00:00.000Z' }), error => error.code === 'JOURNAL_SEQUENCE_COLLISION');
  }

  // A different run cannot silently replace an incomplete journal.
  {
    const adapter = P.createMemoryAdapter();
    const store = P.createPersistence({ adapter, baseline });
    await store.saveJournal(makeJournal('r1'));
    await assert.rejects(store.saveJournal(makeJournal('r2')), error => error.code === 'INCOMPLETE_JOURNAL_REQUIRES_RECOVERY');

    await store.saveJournal(makeJournal('r2'), { replaceIncomplete: true });
    assert.equal((await store.loadJournal('F', 'A')).runId, 'r2');
    assert.equal((await store.loadHistory('F', 'A'))[0].runId, 'r1');
  }

  // Completed journals are archived and can be superseded safely.
  {
    const adapter = P.createMemoryAdapter();
    const store = P.createPersistence({ adapter, baseline, historyLimit: 3 });
    let j = makeJournal('done');
    await store.saveJournal(j);
    j = journal.startOperation(j, 'UPDATE:q1');
    await store.saveJournal(j);
    j = journal.markVerified(j, 'UPDATE:q1', { formativeItemId: 'I1', verified: true });
    await store.saveJournal(j);
    assert.equal(P.journalCompleted(j), true);
    assert.equal((await store.loadHistory('F', 'A'))[0].runId, 'done');

    await store.saveJournal(makeJournal('next'));
    assert.equal((await store.loadJournal('F', 'A')).runId, 'next');
  }

  // Incomplete clear is explicit and run-aware.
  {
    const store = P.createPersistence({ adapter: P.createMemoryAdapter(), baseline });
    await store.saveJournal(makeJournal('r1'));
    await assert.rejects(store.clearJournal('F', 'A'), error => error.code === 'JOURNAL_CLEAR_REQUIRES_EXPLICIT_INCOMPLETE_APPROVAL');
    await assert.rejects(
      store.clearJournal('F', 'A', { allowIncomplete: true, expectedRunId: 'other' }),
      error => error.code === 'JOURNAL_CLEAR_RUN_MISMATCH'
    );
    assert.equal(await store.clearJournal('F', 'A', { allowIncomplete: true, expectedRunId: 'r1' }), true);
    assert.equal(await store.loadJournal('F', 'A'), null);
  }

  // Persistence strips secret-shaped fields and redacts obvious bearer/JWT strings.
  {
    const cleaned = P.sanitize({
      safe: 1,
      authorization: 'Bearer VERYSECRET',
      nested: { token: 'abc', message: 'Authorization failed: Bearer abcdefghijklmnopqrstuvwxyz' },
      jwtMessage: 'eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop'
    });
    assert.equal(cleaned.authorization, undefined);
    assert.equal(cleaned.nested.token, undefined);
    assert(!cleaned.nested.message.includes('abcdefghijklmnopqrstuvwxyz'));
    assert.equal(cleaned.jwtMessage, '[REDACTED_JWT]');
  }

  // Deterministic namespaces do not collide across targets/assessments.
  assert.equal(P.journalKey('F1', 'A1'), P.journalKey('F1', 'A1'));
  assert.notEqual(P.journalKey('F1', 'A1'), P.journalKey('F2', 'A1'));
  assert.notEqual(P.journalKey('F1', 'A1'), P.journalKey('F1', 'A2'));

  console.log('persistence-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});