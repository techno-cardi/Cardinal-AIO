(() => {
  'use strict';

  // STORAGE_KEY is retained only so older single-session drafts can be cleaned
  // up safely. Production v2 records are stored independently per browser tab.
  const STORAGE_KEY = 'cardinal.formative.v2.session';
  const STORAGE_PREFIX = `${STORAGE_KEY}.tab.`;
  const ALLOWED_HEADERS = Object.freeze([
    'accept',
    'authorization',
    'content-type',
    'x-anonymous-id',
    'x-app-version',
    'x-ntp-t0',
    'x-session-id',
    'x-tab-id',
    'x-user-id'
  ]);
  const ALLOWED_HEADER_SET = new Set(ALLOWED_HEADERS);

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function tabBindingError() {
    const error = new Error('Une session Formative doit être liée à un onglet explicite.');
    error.code = 'SESSION_TAB_BINDING_REQUIRED';
    error.mutationMayHaveCommitted = false;
    return error;
  }

  function storageKeyForTab(tabId) {
    if (!validTabId(tabId)) throw tabBindingError();
    return `${STORAGE_PREFIX}${tabId}`;
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeHeaders(input) {
    const src = typeof Headers !== 'undefined' && input instanceof Headers
      ? [...input.entries()]
      : Array.isArray(input)
        ? input.map(row => [row?.name, row?.value])
        : Object.entries(input || {});

    const out = {};
    for (const [rawName, rawValue] of src) {
      const name = normalizeName(rawName);
      if (!ALLOWED_HEADER_SET.has(name) || rawValue == null) continue;
      const value = String(rawValue).trim();
      if (!value) continue;
      out[name] = value;
    }
    return out;
  }

  function validateRecord(record) {
    const issues = [];
    if (!record || typeof record !== 'object') return { ok: false, issues: ['session record missing'] };
    if (record.schema !== 'cardinal.formative.session/2') issues.push('invalid schema');
    if (!validTabId(record.tabId)) issues.push('tabId missing');
    if (!Number.isFinite(record.capturedAt)) issues.push('capturedAt missing');
    if (!record.headers || typeof record.headers !== 'object') issues.push('headers missing');
    const keys = Object.keys(record.headers || {});
    for (const key of keys) {
      if (!ALLOWED_HEADER_SET.has(key)) issues.push(`forbidden header ${key}`);
    }
    if (!record.headers?.authorization && !record.headers?.['x-session-id']) {
      issues.push('no authentication/session header captured');
    }
    return { ok: issues.length === 0, issues };
  }

  function createRecord(headers, meta = {}, now = Date.now()) {
    if (!validTabId(meta.tabId)) throw tabBindingError();
    const record = {
      schema: 'cardinal.formative.session/2',
      version: '2.0.0',
      tabId: meta.tabId,
      capturedAt: now,
      sourceUrl: meta.sourceUrl ? String(meta.sourceUrl).slice(0, 500) : null,
      source: meta.source ? String(meta.source).slice(0, 80) : null,
      headers: normalizeHeaders(headers)
    };
    const check = validateRecord(record);
    if (!check.ok) {
      const error = new Error(`Invalid Formative session capture: ${check.issues.join('; ')}`);
      error.code = 'FORMATIVE_SESSION_CAPTURE_INVALID';
      error.mutationMayHaveCommitted = false;
      throw error;
    }
    return record;
  }

  function diagnostics(record, now = Date.now()) {
    if (!record) {
      return {
        available: false,
        tabId: null,
        capturedAt: null,
        ageMs: null,
        headerNames: [],
        hasAuthorization: false,
        hasSessionId: false,
        hasUserId: false
      };
    }
    return {
      available: validateRecord(record).ok,
      tabId: validTabId(record.tabId) ? record.tabId : null,
      capturedAt: Number.isFinite(record.capturedAt) ? new Date(record.capturedAt).toISOString() : null,
      ageMs: Number.isFinite(record.capturedAt) ? Math.max(0, now - record.capturedAt) : null,
      headerNames: Object.keys(record.headers || {}).sort(),
      hasAuthorization: Boolean(record.headers?.authorization),
      hasSessionId: Boolean(record.headers?.['x-session-id']),
      hasUserId: Boolean(record.headers?.['x-user-id'])
    };
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createMemoryArea(initial = {}) {
    const map = new Map(Object.entries(clone(initial || {})));
    return {
      async get(keys) {
        if (keys == null) return Object.fromEntries([...map].map(([k, v]) => [k, clone(v)]));
        const wanted = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of wanted) {
          if (map.has(key)) out[key] = clone(map.get(key));
        }
        return out;
      },
      async set(values) {
        for (const [k, v] of Object.entries(values || {})) map.set(k, clone(v));
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key);
      }
    };
  }

  function createStore(area) {
    if (!area || typeof area.get !== 'function' || typeof area.set !== 'function' || typeof area.remove !== 'function') {
      throw new Error('chrome.storage.session compatible area required');
    }

    // GraphQL code inherited from the proven 0.4.1 bridge does not carry a tab
    // parameter on every helper. Keep that bridge unchanged and scope the whole
    // guarded gateway call instead. The queue prevents two tabs from ever
    // sharing the same volatile active scope concurrently.
    let activeTabId = null;
    let scopeTail = Promise.resolve();

    async function load(tabId) {
      if (!validTabId(tabId)) return null;
      const key = storageKeyForTab(tabId);
      const value = await area.get(key);
      const record = value?.[key] || null;
      if (!record) return null;
      const check = validateRecord(record);
      if (!check.ok || record.tabId !== tabId) {
        await area.remove(key);
        return null;
      }
      return record;
    }

    async function capture(headers, meta = {}) {
      const next = createRecord(headers, meta);
      const key = storageKeyForTab(next.tabId);
      const current = await load(next.tabId);
      // A late passive webRequest event from the same tab must not overwrite a
      // newer capture. Sessions belonging to other tabs live under other keys.
      if (current && Number(current.capturedAt) > Number(next.capturedAt)) return current;
      await area.set({ [key]: next });
      // Never migrate the old global record because its originating tab/account
      // cannot be proven. Remove it opportunistically instead.
      try { await area.remove(STORAGE_KEY); } catch {}
      return next;
    }

    async function clear(tabId = null) {
      if (validTabId(tabId)) {
        await area.remove(storageKeyForTab(tabId));
        return;
      }
      const all = await area.get(null);
      const keys = Object.keys(all || {}).filter(key => key === STORAGE_KEY || key.startsWith(STORAGE_PREFIX));
      if (keys.length) await area.remove(keys);
    }

    async function withTabScope(tabId, fn) {
      if (!validTabId(tabId)) throw tabBindingError();
      if (typeof fn !== 'function') throw new Error('session scoped callback required');

      let release;
      const previous = scopeTail;
      scopeTail = new Promise(resolve => { release = resolve; });
      await previous;

      activeTabId = tabId;
      try {
        return await fn();
      } finally {
        activeTabId = null;
        release();
      }
    }

    async function getRequestHeaders(extra = {}) {
      if (!validTabId(activeTabId)) throw tabBindingError();
      const record = await load(activeTabId);
      if (!record) {
        const error = new Error('Aucune session Formative capturée pour l’onglet choisi.');
        error.code = 'SESSION_REAUTH_REQUIRED';
        error.targetTabId = activeTabId;
        error.mutationMayHaveCommitted = false;
        throw error;
      }
      return {
        ...record.headers,
        accept: record.headers.accept || 'application/graphql-response+json,application/json;q=0.9',
        'content-type': 'application/json',
        ...normalizeHeaders(extra)
      };
    }

    async function sessionDiagnostics(tabId = null) {
      if (validTabId(tabId)) return diagnostics(await load(tabId));

      const all = await area.get(null);
      const records = [];
      const invalidKeys = [];
      for (const [key, value] of Object.entries(all || {})) {
        if (!key.startsWith(STORAGE_PREFIX)) continue;
        const check = validateRecord(value);
        if (check.ok && key === storageKeyForTab(value.tabId)) records.push(value);
        else invalidKeys.push(key);
      }
      if (invalidKeys.length) await area.remove(invalidKeys);
      records.sort((a, b) => Number(b.capturedAt) - Number(a.capturedAt));
      const newest = records[0] || null;
      const headerNames = [...new Set(records.flatMap(record => Object.keys(record.headers || {})))].sort();
      return {
        available: records.length > 0,
        sessionCount: records.length,
        tabIds: records.map(record => record.tabId).sort((a, b) => a - b),
        capturedAt: newest ? new Date(newest.capturedAt).toISOString() : null,
        ageMs: newest ? Math.max(0, Date.now() - newest.capturedAt) : null,
        headerNames,
        hasAuthorization: records.some(record => Boolean(record.headers?.authorization)),
        hasSessionId: records.some(record => Boolean(record.headers?.['x-session-id'])),
        hasUserId: records.some(record => Boolean(record.headers?.['x-user-id']))
      };
    }

    return {
      load,
      capture,
      clear,
      withTabScope,
      getRequestHeaders,
      diagnostics: sessionDiagnostics
    };
  }

  const api = {
    STORAGE_KEY,
    STORAGE_PREFIX,
    ALLOWED_HEADERS,
    validTabId,
    storageKeyForTab,
    normalizeHeaders,
    validateRecord,
    createRecord,
    diagnostics,
    createMemoryArea,
    createStore
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2SessionStore = api;
})();
