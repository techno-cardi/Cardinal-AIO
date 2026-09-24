const assert = require('assert');
const G = require('./run-gate-v2.js');

(async () => {
  // Same target cannot be acquired twice concurrently.
  {
    const gate = G.createGate();
    const a = gate.tryAcquire({ targetFormativeId: 'F1', runId: 'r1', executionContractHash: 'h1' });
    const b = gate.tryAcquire({ targetFormativeId: 'F1', runId: 'r2', executionContractHash: 'h2' });
    assert.equal(a.acquired, true);
    assert.equal(b.acquired, false);
    assert.equal(b.reason, 'TARGET_IMPORT_ALREADY_RUNNING');
    assert.equal(gate.snapshot().length, 1);
  }

  // Different targets can run independently.
  {
    const gate = G.createGate();
    const a = gate.tryAcquire({ targetFormativeId: 'F1' });
    const b = gate.tryAcquire({ targetFormativeId: 'F2' });
    assert.equal(a.acquired, true);
    assert.equal(b.acquired, true);
    assert.equal(gate.snapshot().length, 2);
  }

  // Only the owner token can release a lock.
  {
    const gate = G.createGate();
    const a = gate.tryAcquire({ targetFormativeId: 'F1' });
    assert.equal(gate.release('wrong-token'), false);
    assert.equal(gate.isLocked('F1'), true);
    assert.equal(gate.release(a.token), true);
    assert.equal(gate.isLocked('F1'), false);
    assert.equal(gate.tryAcquire({ targetFormativeId: 'F1' }).acquired, true);
  }

  // withTargetLock always releases, including thrown errors.
  {
    const gate = G.createGate();
    await assert.rejects(
      gate.withTargetLock({ targetFormativeId: 'F1' }, async () => {
        assert.equal(gate.isLocked('F1'), true);
        throw new Error('boom');
      }),
      /boom/
    );
    assert.equal(gate.isLocked('F1'), false);
  }

  // Target identity is mandatory.
  assert.throws(() => G.createGate().tryAcquire({}), /targetFormativeId required/);

  console.log('run-gate-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});