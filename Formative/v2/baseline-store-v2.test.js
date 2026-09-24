const assert = require('assert');
const B = require('./baseline-store-v2.js');

const managed = prompt => ({ subtype: 'shortAnswer', prompt, points: 2 });

// Stable namespaced storage key.
assert.equal(B.storageKey('F1', 'A1'), B.storageKey('F1', 'A1'));
assert.notEqual(B.storageKey('F1', 'A1'), B.storageKey('F2', 'A1'));
assert.notEqual(B.storageKey('F1', 'A1'), B.storageKey('F1', 'A2'));

// Creation is valid and deterministic in entry ordering.
{
  const b = B.createBaseline({
    targetFormativeId: 'F1',
    assessmentFingerprint: 'A1',
    packageMode: 'full',
    assessmentTitle: 'Test',
    entries: [
      { fingerprint: 'q2', formativeItemId: 'I2', managedState: managed('B') },
      { fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('A') }
    ]
  }, Date.parse('2026-09-20T20:00:00Z'));

  assert(B.validateBaseline(b).ok);
  assert.deepEqual(b.entries.map(x => x.fingerprint), ['q1', 'q2']);
}

// Sensitive-looking fields are stripped recursively.
{
  const b = B.createBaseline({
    targetFormativeId: 'F1',
    assessmentFingerprint: 'A1',
    entries: [{
      fingerprint: 'q1', formativeItemId: 'I1',
      managedState: { prompt: 'Q', authorization: 'SECRET', nested: { token: 'SECRET', safe: 1 } }
    }]
  });
  assert.equal(b.entries[0].managedState.authorization, undefined);
  assert.equal(b.entries[0].managedState.nested.token, undefined);
  assert.equal(b.entries[0].managedState.nested.safe, 1);
}

// Verified update changes managed state but never silently remaps to another Formative item.
{
  let b = B.createBaseline({
    targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    entries: [{ fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('old') }]
  });

  b = B.updateAfterVerified(b, [{
    fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('new'), serverRevision: 'r2'
  }]);
  assert.equal(b.entries[0].managedState.prompt, 'new');
  assert.equal(b.entries[0].serverRevision, 'r2');

  assert.throws(() => B.updateAfterVerified(b, [{
    fingerprint: 'q1', formativeItemId: 'DIFFERENT', managedState: managed('x')
  }]));
}

// Confirmed deletion is explicit.
{
  let b = B.createBaseline({
    targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    entries: [
      { fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('A') },
      { fingerprint: 'q2', formativeItemId: 'I2', managedState: managed('B') }
    ]
  });
  b = B.updateAfterVerified(b, [], { confirmedDeletedFingerprints: ['q2'] });
  assert.deepEqual(b.entries.map(x => x.fingerprint), ['q1']);
}

// Planner projection includes only authoritative managed state/mapping.
{
  const b = B.createBaseline({
    targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    entries: [{ fingerprint: 'q1', sourceItemId: 'source-q1', formativeItemId: 'I1', managedState: managed('A') }]
  });
  assert.deepEqual(B.toPlannerBaseline(b), [{
    fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('A'), sourceItemId: 'source-q1'
  }]);
}

// Legacy 0.4.1 mapping is a hint only, never promoted blindly to v2 baseline.
{
  const hint = B.legacyMigrationHint({
    q16: { formativeItemId: 'I16' },
    broken: {}
  });
  assert.equal(hint.length, 1);
  assert.equal(hint[0].safeToTrustAsBaseline, false);
  assert.equal(hint[0].requiredNextStep, 'READ_SERVER_AND_RECONCILE');
}

// Duplicate fingerprints/server ids are invalid.
{
  const b = {
    schema: B.SCHEMA, version: B.VERSION, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    entries: [
      { fingerprint: 'q1', formativeItemId: 'I1', managedState: managed('A') },
      { fingerprint: 'q1', formativeItemId: 'I2', managedState: managed('B') }
    ]
  };
  assert.equal(B.validateBaseline(b).ok, false);
}

console.log('baseline-store-v2: all tests passed');