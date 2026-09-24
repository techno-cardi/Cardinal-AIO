(() => {
  'use strict';

  const JOURNAL_SCHEMA = 'cardinal.formative.import-journal/2';
  const JOURNAL_VERSION = '2.0.0';
  const JOURNAL_PREFIX = 'cardinal.formative.v2.journal:';
  const HISTORY_PREFIX = 'cardinal.formative.v2.history:';
  const DEFAULT_HISTORY_LIMIT = 5;

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

  function stableToken(value) {
    const text = asString(value);
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  function keyMaterial(targetFormativeId, assessmentFingerprint) {
    if (!targetFormativeId) throw new Error('targetFormativeId required');
    if (!assessmentFingerprint) throw new Error('assessmentFingerprint required');
    return stableToken(`${targetFormativeId}|${assessmentFingerprint}`);
  }

  function journalKey(targetFormativeId, assessmentFingerprint) {
    return `${JOURNAL_PREFIX}${keyMaterial(targetFormativeId, assessmentFingerprint)}`;
  }

  function historyKey(targetFormativeId, assessmentFingerprint) {
    return `${HISTORY_PREFIX}${keyMaterial(targetFormativeId, assessmentFingerprint)}`;
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

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function redactString(value) {
    return asString(value)
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}/gi, 'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
  }

  function sanitize(value) {
    const forbidden = /authorization|cookie|token|x-session-id|x-user-id|headers|password|secret/i;

    function walk(node) {
      if (typeof node === 'string') return redactString(node);
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

  function validateJournal(record, expected = {}) {
    const issues = [];
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, issues: ['journal must be an object'] };
    if (record.schema !== JOURNAL_SCHEMA) issues.push(`schema expected ${JOURNAL_SCHEMA}`);
    if (record.version !== JOURNAL_VERSION) issues.push(`version expected ${JOURNAL_VERSION}`);
    if (!Number.isInteger(record.sequence) || record.sequence < 0) issues.push('sequence must be an integer >= 0');
    if (!record.runId) issues.push('runId missing');
    if (!record.targetFormativeId) issues.push('targetFormativeId missing');
    if (!record.assessmentFingerprint) issues.push('assessmentFingerprint missing');
    if (!['full', 'patch'].includes(record.packageMode)) issues.push('packageMode invalid');
    if (!record.executionContractHash) issues.push('executionContractHash missing');
    if (!Array.isArray(record.operations)) issues.push('operations must be an array');

    if (expected.targetFormativeId && record.targetFormativeId !== expected.targetFormativeId) issues.push('targetFormativeId mismatch');
    if (expected.assessmentFingerprint && record.assessmentFingerprint !== expected.assessmentFingerprint) issues.push('assessmentFingerprint mismatch');
    if (expected.runId && record.runId !== expected.runId) issues.push('runId mismatch');

    const operationIds = new Set();
    const validStatuses = new Set(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED', 'UNCERTAIN', 'BLOCKED', 'SKIPPED']);
    for (const op of record.operations || []) {
      if (!op?.operationId) issues.push('operationId missing');
      else if (operationIds.has(op.operationId)) issues.push(`duplicate operationId ${op.operationId}`);
      else operationIds.add(op.operationId);
      if (!validStatuses.has(op?.status)) issues.push(`invalid operation status ${op?.status}`);
    }

    return { ok: issues.length === 0, issues };
  }

  function journalCompleted(record) {
    return Boolean(record?.completedAt) &&
      Number(record?.summary?.remaining || 0) === 0 &&
      Number(record?.summary?.uncertain || 0) === 0 &&
      Number(record?.summary?.failed || 0) === 0 &&
      Number(record?.summary?.blocked || 0) === 0;
  }

  function summaryForHistory(record) {
    return sanitize({
      runId: record.runId,
      targetFormativeId: record.targetFormativeId,
      assessmentFingerprint: record.assessmentFingerprint,
      packageMode: record.packageMode,
      executionContractHash: record.executionContractHash,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      completedAt: record.completedAt,
      summary: clone(record.summary)
    });
  }

  function requireAdapter(adapter) {
    if (!adapter || typeof adapter.get !== 'function' || typeof adapter.set !== 'function' || typeof adapter.remove !== 'function') {
      throw new Error('storage adapter with get/set/remove required');
    }
    return adapter;
  }

  function createMemoryAdapter(initial = {}) {
    const map = new Map(Object.entries(clone(initial) || {}));
    return {
      async get(key) { return map.has(key) ? clone(map.get(key)) : null; },
      async set(key, value) { map.set(key, clone(value)); },
      async remove(key) { map.delete(key); },
      snapshot() { return Object.fromEntries([...map.entries()].map(([k, v]) => [k, clone(v)])); }
    };
  }

  function createChromeStorageAdapter(area) {
    if (!area || typeof area.get !== 'function' || typeof area.set !== 'function' || typeof area.remove !== 'function') {
      throw new Error('chrome.storage area required');
    }
    return {
      async get(key) {
        const result = await area.get(key);
        return result?.[key] ?? null;
      },
      async set(key, value) {
        await area.set({ [key]: value });
      },
      async remove(key) {
        await area.remove(key);
      }
    };
  }

  function createPersistence(options = {}) {
    const adapter = requireAdapter(options.adapter);
    const baseline = options.baseline || globalThis.CardinalFormativeV2Baseline;
    if (!baseline) throw new Error('baseline dependency required');
    const historyLimit = Number.isInteger(options.historyLimit) && options.historyLimit >= 0 ? options.historyLimit : DEFAULT_HISTORY_LIMIT;

    async function loadBaseline(targetFormativeId, assessmentFingerprint) {
      const key = baseline.storageKey(targetFormativeId, assessmentFingerprint);
      const record = await adapter.get(key);
      if (record == null) return null;
      const check = baseline.validateBaseline(record, { targetFormativeId, assessmentFingerprint });
      if (!check.ok) {
        const error = new Error(`Stored baseline invalid: ${check.issues.join('; ')}`);
        error.code = 'STORED_BASELINE_INVALID';
        throw error;
      }
      return clone(record);
    }

    async function saveBaseline(record) {
      const clean = sanitize(record);
      const check = baseline.validateBaseline(clean);
      if (!check.ok) {
        const error = new Error(`Refusing invalid baseline: ${check.issues.join('; ')}`);
        error.code = 'BASELINE_INVALID';
        throw error;
      }

      const key = baseline.storageKey(clean.targetFormativeId, clean.assessmentFingerprint);
      const existing = await adapter.get(key);
      if (existing) {
        const existingCheck = baseline.validateBaseline(existing, {
          targetFormativeId: clean.targetFormativeId,
          assessmentFingerprint: clean.assessmentFingerprint
        });
        if (!existingCheck.ok) {
          const error = new Error(`Existing baseline invalid: ${existingCheck.issues.join('; ')}`);
          error.code = 'STORED_BASELINE_INVALID';
          throw error;
        }

        if (clean.generation < existing.generation) {
          const error = new Error('Refusing stale baseline write.');
          error.code = 'STALE_BASELINE_WRITE';
          throw error;
        }
        if (clean.generation === existing.generation && canonicalJson(clean) !== canonicalJson(existing)) {
          const error = new Error('Same baseline generation contains different content.');
          error.code = 'BASELINE_GENERATION_COLLISION';
          throw error;
        }
        if (clean.generation > existing.generation + 1) {
          const error = new Error('Baseline generation gap detected.');
          error.code = 'BASELINE_GENERATION_GAP';
          throw error;
        }
      } else if (clean.generation !== 0) {
        const error = new Error('First stored baseline must start at generation 0.');
        error.code = 'BASELINE_INITIAL_GENERATION_INVALID';
        throw error;
      }

      await adapter.set(key, clean);
      return clone(clean);
    }

    async function loadJournal(targetFormativeId, assessmentFingerprint) {
      const key = journalKey(targetFormativeId, assessmentFingerprint);
      const record = await adapter.get(key);
      if (record == null) return null;
      const check = validateJournal(record, { targetFormativeId, assessmentFingerprint });
      if (!check.ok) {
        const error = new Error(`Stored journal invalid: ${check.issues.join('; ')}`);
        error.code = 'STORED_JOURNAL_INVALID';
        throw error;
      }
      return clone(record);
    }

    async function archiveJournal(record) {
      if (!record || historyLimit === 0) return;
      const key = historyKey(record.targetFormativeId, record.assessmentFingerprint);
      const existing = await adapter.get(key);
      const history = Array.isArray(existing) ? existing : [];
      const next = [summaryForHistory(record), ...history.filter(x => x?.runId !== record.runId)].slice(0, historyLimit);
      await adapter.set(key, next);
    }

    async function saveJournal(record, saveOptions = {}) {
      const clean = sanitize(record);
      const check = validateJournal(clean);
      if (!check.ok) {
        const error = new Error(`Refusing invalid journal: ${check.issues.join('; ')}`);
        error.code = 'JOURNAL_INVALID';
        throw error;
      }

      const key = journalKey(clean.targetFormativeId, clean.assessmentFingerprint);
      const existing = await adapter.get(key);
      if (existing) {
        const existingCheck = validateJournal(existing, {
          targetFormativeId: clean.targetFormativeId,
          assessmentFingerprint: clean.assessmentFingerprint
        });
        if (!existingCheck.ok) {
          const error = new Error(`Existing journal invalid: ${existingCheck.issues.join('; ')}`);
          error.code = 'STORED_JOURNAL_INVALID';
          throw error;
        }

        if (existing.runId !== clean.runId) {
          if (!journalCompleted(existing) && saveOptions.replaceIncomplete !== true) {
            const error = new Error('An incomplete import journal already exists and must be resumed or explicitly replaced.');
            error.code = 'INCOMPLETE_JOURNAL_REQUIRES_RECOVERY';
            error.existingRunId = existing.runId;
            throw error;
          }
          await archiveJournal(existing);
        } else {
          if (existing.executionContractHash !== clean.executionContractHash) {
            const error = new Error('Journal execution contract changed within the same run.');
            error.code = 'JOURNAL_CONTRACT_CHANGED';
            throw error;
          }
          if (clean.sequence < existing.sequence) {
            const error = new Error('Refusing stale journal write.');
            error.code = 'STALE_JOURNAL_WRITE';
            throw error;
          }
          if (clean.sequence === existing.sequence && canonicalJson(clean) !== canonicalJson(existing)) {
            const error = new Error('Same journal sequence contains different content.');
            error.code = 'JOURNAL_SEQUENCE_COLLISION';
            throw error;
          }
          if (clean.sequence > existing.sequence + 1) {
            const error = new Error('Journal sequence gap detected.');
            error.code = 'JOURNAL_SEQUENCE_GAP';
            throw error;
          }
        }
      } else if (clean.sequence !== 0) {
        const error = new Error('First stored journal must start at sequence 0.');
        error.code = 'JOURNAL_INITIAL_SEQUENCE_INVALID';
        throw error;
      }

      await adapter.set(key, clean);
      if (journalCompleted(clean)) await archiveJournal(clean);
      return clone(clean);
    }

    async function clearJournal(targetFormativeId, assessmentFingerprint, clearOptions = {}) {
      const key = journalKey(targetFormativeId, assessmentFingerprint);
      const existing = await adapter.get(key);
      if (!existing) return false;
      if (clearOptions.expectedRunId && existing.runId !== clearOptions.expectedRunId) {
        const error = new Error('Journal runId changed; refusing to clear another run.');
        error.code = 'JOURNAL_CLEAR_RUN_MISMATCH';
        throw error;
      }
      if (!journalCompleted(existing) && clearOptions.allowIncomplete !== true) {
        const error = new Error('Incomplete journal cannot be cleared without explicit allowIncomplete.');
        error.code = 'JOURNAL_CLEAR_REQUIRES_EXPLICIT_INCOMPLETE_APPROVAL';
        throw error;
      }
      await archiveJournal(existing);
      await adapter.remove(key);
      return true;
    }

    async function loadHistory(targetFormativeId, assessmentFingerprint) {
      const value = await adapter.get(historyKey(targetFormativeId, assessmentFingerprint));
      return Array.isArray(value) ? clone(value) : [];
    }

    return {
      loadBaseline,
      saveBaseline,
      loadJournal,
      saveJournal,
      clearJournal,
      loadHistory,
      journalKey,
      historyKey
    };
  }

  const api = {
    JOURNAL_SCHEMA,
    JOURNAL_VERSION,
    JOURNAL_PREFIX,
    HISTORY_PREFIX,
    journalKey,
    historyKey,
    sanitize,
    validateJournal,
    journalCompleted,
    createMemoryAdapter,
    createChromeStorageAdapter,
    createPersistence
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Persistence = api;
})();