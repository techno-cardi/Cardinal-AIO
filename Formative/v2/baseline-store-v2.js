(() => {
  'use strict';

  const SCHEMA = 'cardinal.formative.baseline/2';
  const VERSION = '2.0.0';
  const STORAGE_PREFIX = 'cardinal.formative.v2.baseline:';

  function asString(value) {
    return value == null ? '' : String(value);
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

  function stableKeyToken(value) {
    const text = asString(value);
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  function storageKey(targetFormativeId, assessmentFingerprint) {
    if (!targetFormativeId) throw new Error('targetFormativeId required');
    if (!assessmentFingerprint) throw new Error('assessmentFingerprint required');
    return `${STORAGE_PREFIX}${stableKeyToken(`${targetFormativeId}|${assessmentFingerprint}`)}`;
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stripSecrets(value) {
    const forbidden = /authorization|cookie|token|x-session-id|x-user-id|headers|password|secret/i;

    function walk(node) {
      if (Array.isArray(node)) return node.map(walk);
      if (!node || typeof node !== 'object') return node;
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        if (forbidden.test(key)) continue;
        out[key] = walk(child);
      }
      return out;
    }

    return walk(value);
  }

  function validateEntry(entry) {
    const issues = [];
    if (!entry?.fingerprint) issues.push('fingerprint missing');
    if (!entry?.formativeItemId) issues.push('formativeItemId missing');
    if (!entry?.managedState || typeof entry.managedState !== 'object') issues.push('managedState missing');
    return issues;
  }

  function validateBaseline(record, expected = {}) {
    const issues = [];

    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return { ok: false, issues: ['baseline must be an object'] };
    }
    if (record.schema !== SCHEMA) issues.push(`schema expected ${SCHEMA}`);
    if (record.version !== VERSION) issues.push(`version expected ${VERSION}`);
    if (!Number.isInteger(record.generation) || record.generation < 0) issues.push('generation must be an integer >= 0');
    if (!record.targetFormativeId) issues.push('targetFormativeId missing');
    if (!record.assessmentFingerprint) issues.push('assessmentFingerprint missing');
    if (!Array.isArray(record.entries)) issues.push('entries must be an array');

    if (expected.targetFormativeId && record.targetFormativeId !== expected.targetFormativeId) {
      issues.push('targetFormativeId mismatch');
    }
    if (expected.assessmentFingerprint && record.assessmentFingerprint !== expected.assessmentFingerprint) {
      issues.push('assessmentFingerprint mismatch');
    }

    const fps = new Set();
    const ids = new Set();
    for (const entry of record.entries || []) {
      for (const problem of validateEntry(entry)) issues.push(`${entry?.fingerprint || '?'}: ${problem}`);
      if (entry?.fingerprint) {
        if (fps.has(entry.fingerprint)) issues.push(`duplicate fingerprint ${entry.fingerprint}`);
        fps.add(entry.fingerprint);
      }
      if (entry?.formativeItemId) {
        if (ids.has(entry.formativeItemId)) issues.push(`duplicate formativeItemId ${entry.formativeItemId}`);
        ids.add(entry.formativeItemId);
      }
    }

    return { ok: issues.length === 0, issues };
  }

  function createBaseline(input = {}, now = Date.now()) {
    if (!input.targetFormativeId) throw new Error('targetFormativeId required');
    if (!input.assessmentFingerprint) throw new Error('assessmentFingerprint required');

    const record = {
      schema: SCHEMA,
      version: VERSION,
      generation: 0,
      targetFormativeId: input.targetFormativeId,
      assessmentFingerprint: input.assessmentFingerprint,
      sourceProtocolVersion: input.sourceProtocolVersion || '2.0.0',
      packageModeLastConfirmed: input.packageMode || null,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      entries: normalizeEntries(input.entries || []),
      metadata: stripSecrets({
        assessmentTitle: input.assessmentTitle || null,
        sourceFingerprints: input.sourceFingerprints || [],
        importerVersion: input.importerVersion || null
      })
    };

    const check = validateBaseline(record);
    if (!check.ok) throw new Error(`invalid baseline: ${check.issues.join('; ')}`);
    return record;
  }

  function normalizeEntries(entries) {
    return [...entries]
      .map(entry => stripSecrets({
        fingerprint: entry.fingerprint,
        sourceItemId: entry.sourceItemId || null,
        formativeItemId: entry.formativeItemId,
        subtype: entry.subtype || null,
        managedState: clone(entry.managedState),
        verifiedAt: entry.verifiedAt || null,
        serverRevision: entry.serverRevision || null
      }))
      .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  }

  function updateAfterVerified(record, verifiedEntries, options = {}, now = Date.now()) {
    const check = validateBaseline(record);
    if (!check.ok) throw new Error(`invalid baseline: ${check.issues.join('; ')}`);

    const next = clone(record);
    const byFp = new Map(next.entries.map(x => [x.fingerprint, x]));

    for (const raw of verifiedEntries || []) {
      const clean = stripSecrets(raw);
      if (!clean?.fingerprint || !clean?.formativeItemId || !clean?.managedState) {
        throw new Error('verified entry requires fingerprint, formativeItemId and managedState');
      }

      const existing = byFp.get(clean.fingerprint);
      if (existing && existing.formativeItemId !== clean.formativeItemId) {
        throw new Error(`fingerprint ${clean.fingerprint} changed formativeItemId; explicit reconciliation required`);
      }

      byFp.set(clean.fingerprint, {
        fingerprint: clean.fingerprint,
        sourceItemId: clean.sourceItemId || existing?.sourceItemId || null,
        formativeItemId: clean.formativeItemId,
        subtype: clean.subtype || existing?.subtype || null,
        managedState: clone(clean.managedState),
        verifiedAt: clean.verifiedAt || new Date(now).toISOString(),
        serverRevision: clean.serverRevision || null
      });
    }

    if (Array.isArray(options.confirmedDeletedFingerprints)) {
      for (const fingerprint of options.confirmedDeletedFingerprints) {
        byFp.delete(fingerprint);
      }
    }

    next.entries = normalizeEntries([...byFp.values()]);
    next.generation = record.generation + 1;
    next.updatedAt = new Date(now).toISOString();
    if (options.packageMode) next.packageModeLastConfirmed = options.packageMode;
    if (options.importerVersion) next.metadata.importerVersion = options.importerVersion;

    const nextCheck = validateBaseline(next);
    if (!nextCheck.ok) throw new Error(`updated baseline invalid: ${nextCheck.issues.join('; ')}`);
    return next;
  }

  function toPlannerBaseline(record) {
    const check = validateBaseline(record);
    if (!check.ok) throw new Error(`invalid baseline: ${check.issues.join('; ')}`);
    return record.entries.map(entry => ({
      fingerprint: entry.fingerprint,
      formativeItemId: entry.formativeItemId,
      managedState: clone(entry.managedState),
      sourceItemId: entry.sourceItemId || null
    }));
  }

  function buildBaselineFromVerifiedRun(input = {}, now = Date.now()) {
    const entries = [];
    for (const row of input.verified || []) {
      if (!row?.fingerprint || !row?.formativeItemId || !row?.managedState) continue;
      entries.push({
        fingerprint: row.fingerprint,
        sourceItemId: row.sourceItemId || null,
        formativeItemId: row.formativeItemId,
        subtype: row.subtype || null,
        managedState: row.managedState,
        verifiedAt: row.verifiedAt || new Date(now).toISOString(),
        serverRevision: row.serverRevision || null
      });
    }

    return createBaseline({
      targetFormativeId: input.targetFormativeId,
      assessmentFingerprint: input.assessmentFingerprint,
      sourceProtocolVersion: input.sourceProtocolVersion || '2.0.0',
      packageMode: input.packageMode || null,
      assessmentTitle: input.assessmentTitle || null,
      sourceFingerprints: input.sourceFingerprints || [],
      importerVersion: input.importerVersion || null,
      entries
    }, now);
  }

  /**
   * 0.4.1 local maps cannot be promoted to v2 baseline just from logical IDs.
   * They may help discovery, but a v2 baseline is authoritative only after
   * current server state has been read and independently verified.
   */
  function legacyMigrationHint(legacyMap) {
    const candidates = [];
    for (const [logicalId, value] of Object.entries(legacyMap || {})) {
      if (!value?.formativeItemId) continue;
      candidates.push({
        logicalId,
        formativeItemId: value.formativeItemId,
        safeToTrustAsBaseline: false,
        requiredNextStep: 'READ_SERVER_AND_RECONCILE'
      });
    }
    return candidates;
  }

  const api = {
    SCHEMA,
    VERSION,
    STORAGE_PREFIX,
    storageKey,
    stripSecrets,
    validateBaseline,
    createBaseline,
    updateAfterVerified,
    toPlannerBaseline,
    buildBaselineFromVerifiedRun,
    legacyMigrationHint
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Baseline = api;
})();