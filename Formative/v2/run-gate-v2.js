(() => {
  'use strict';

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function createGate() {
    const active = new Map();
    let sequence = 0;

    function tryAcquire(input = {}) {
      const targetFormativeId = asString(input.targetFormativeId).trim();
      if (!targetFormativeId) throw new Error('targetFormativeId required');

      const existing = active.get(targetFormativeId);
      if (existing) {
        return {
          acquired: false,
          reason: 'TARGET_IMPORT_ALREADY_RUNNING',
          active: { ...existing }
        };
      }

      sequence += 1;
      const token = `cfi-gate-${Date.now().toString(36)}-${sequence.toString(36)}`;
      const record = {
        token,
        targetFormativeId,
        runId: input.runId == null ? null : asString(input.runId),
        executionContractHash: input.executionContractHash == null ? null : asString(input.executionContractHash),
        acquiredAt: new Date().toISOString()
      };
      active.set(targetFormativeId, record);

      return {
        acquired: true,
        token,
        active: { ...record }
      };
    }

    function release(token) {
      const wanted = asString(token);
      if (!wanted) return false;

      for (const [target, record] of active.entries()) {
        if (record.token !== wanted) continue;
        active.delete(target);
        return true;
      }
      return false;
    }

    function isLocked(targetFormativeId) {
      return active.has(asString(targetFormativeId).trim());
    }

    function snapshot() {
      return [...active.values()].map(record => ({ ...record }));
    }

    async function withTargetLock(input, fn) {
      if (typeof fn !== 'function') throw new Error('fn required');
      const claim = tryAcquire(input);
      if (!claim.acquired) {
        const error = new Error('An import is already running for this Formative target.');
        error.code = claim.reason;
        error.active = claim.active;
        throw error;
      }

      try {
        return await fn(claim);
      } finally {
        release(claim.token);
      }
    }

    return {
      tryAcquire,
      release,
      isLocked,
      snapshot,
      withTargetLock
    };
  }

  const defaultGate = createGate();
  const api = { createGate, defaultGate };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2RunGate = api;
})();