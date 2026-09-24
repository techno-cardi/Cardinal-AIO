(() => {
  'use strict';

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = canonicalize(value[key]);
      }
      return out;
    }
    return value;
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function fnv1a64(value) {
    const text = asString(value);
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      hash ^= BigInt(code & 0xff);
      hash = BigInt.asUintN(64, hash * prime);
      if (code > 0xff) {
        hash ^= BigInt((code >>> 8) & 0xff);
        hash = BigInt.asUintN(64, hash * prime);
      }
    }

    return hash.toString(16).padStart(16, '0');
  }

  function hash128(value) {
    const text = asString(value);
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  function operationId(op, index) {
    return op?.operationId || `${op?.action || 'OP'}:${op?.fingerprint || index}`;
  }

  function operationMaterial(op, index) {
    return {
      operationId: operationId(op, index),
      action: op?.action || null,
      fingerprint: op?.fingerprint || null,
      formativeItemId: op?.formativeItemId || null,
      sourceItemId: op?.sourceItemId || null,
      reason: op?.reason || null,
      externalChanged: op?.externalChanged === true,
      baseline: op?.baseline ?? null,
      server: op?.server ?? null,
      desired: op?.desired ?? null,
      adaptedItem: op?.adaptedItem ?? null,
      // Required to reconcile a timed-out CREATE without accidentally adopting
      // a preexisting teacher/foreign item that happens to be identical.
      preexistingServerItemIds: [...new Set(op?.preexistingServerItemIds || [])].sort()
    };
  }

  function buildExecutionContract(input = {}) {
    if (!input.targetFormativeId) throw new Error('targetFormativeId required');
    if (!['full', 'patch'].includes(input.packageMode)) throw new Error('packageMode must be full or patch');
    if (!Array.isArray(input.plannerOperations)) throw new Error('plannerOperations required');

    const approvedDeleteFingerprints = [...new Set(input.approvedDeleteFingerprints || [])].sort();
    const material = {
      schema: 'cardinal.formative.execution-contract/2',
      version: '2.0.0',
      targetFormativeId: asString(input.targetFormativeId),
      assessmentFingerprint: input.assessmentFingerprint == null ? null : asString(input.assessmentFingerprint),
      packageMode: input.packageMode,
      approvedDeleteFingerprints,
      operations: input.plannerOperations.map(operationMaterial)
    };

    const canonical = canonicalJson(material);
    return {
      ...material,
      hash: `cfi-run-${hash128(canonical)}`,
      operationCount: material.operations.length
    };
  }

  function validateJournalContract(journal, contract) {
    const issues = [];
    if (!journal) return { ok: false, code: 'JOURNAL_REQUIRED', issues: ['journal required'] };
    if (!contract) return { ok: false, code: 'EXECUTION_CONTRACT_REQUIRED', issues: ['execution contract required'] };

    if (!journal.executionContractHash) {
      issues.push('Journal does not contain executionContractHash.');
    } else if (journal.executionContractHash !== contract.hash) {
      issues.push('Journal execution contract differs from the current plan.');
    }

    if (asString(journal.targetFormativeId) !== asString(contract.targetFormativeId)) {
      issues.push('Journal targetFormativeId differs from current target.');
    }

    if ((journal.assessmentFingerprint || null) !== (contract.assessmentFingerprint || null)) {
      issues.push('Journal assessmentFingerprint differs from current assessment.');
    }

    if ((journal.packageMode || null) !== (contract.packageMode || null)) {
      issues.push('Journal packageMode differs from current package mode.');
    }

    return {
      ok: issues.length === 0,
      code: issues.length ? 'EXECUTION_CONTRACT_MISMATCH' : null,
      issues
    };
  }

  const api = {
    canonicalize,
    canonicalJson,
    hash128,
    operationId,
    operationMaterial,
    buildExecutionContract,
    validateJournalContract
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ExecutionContract = api;
})();