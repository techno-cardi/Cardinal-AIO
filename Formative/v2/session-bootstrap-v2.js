(() => {
  'use strict';

  const STORAGE_KEY = 'cardinal.formative.v2.sessionBootstrap';
  const DEFAULT_COOLDOWN_MS = 30000;
  const DEFAULT_TIMEOUT_MS = 9000;

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function isSessionError(error) {
    return error?.code === 'SESSION_REAUTH_REQUIRED' ||
      error?.reason === 'SESSION_REAUTH_REQUIRED';
  }

  async function readRecord(area) {
    if (!area || typeof area.get !== 'function') return null;
    try {
      const value = await area.get(STORAGE_KEY);
      return value?.[STORAGE_KEY] || null;
    } catch {
      return null;
    }
  }

  async function writeRecord(area, record) {
    if (!area || typeof area.set !== 'function') return;
    try { await area.set({ [STORAGE_KEY]: record }); } catch {}
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== 'object') return { tabs: {} };
    if (record.tabs && typeof record.tabs === 'object') return { tabs: { ...record.tabs } };
    // Migration from the first v2 draft that stored a single global record.
    if (validTabId(record.tabId) && Number.isFinite(record.at)) {
      return { tabs: { [String(record.tabId)]: { at: Number(record.at) } } };
    }
    return { tabs: {} };
  }

  function failureTabIds(error) {
    return (Array.isArray(error?.targetProbeFailures) ? error.targetProbeFailures : [])
      .map(row => row?.tabId)
      .filter(validTabId);
  }

  async function chooseReloadTab(tabsApi, error) {
    const failureIds = new Set(failureTabIds(error));
    if (!failureIds.size) return null;

    let tabs = [];
    try { tabs = await tabsApi.query({ url: ['https://app.formative.com/*'] }); }
    catch {}

    const matching = (Array.isArray(tabs) ? tabs : []).filter(tab => failureIds.has(tab?.id));
    const active = matching.find(tab => tab?.active === true && validTabId(tab?.id));
    if (active) return active.id;
    const first = matching.find(tab => validTabId(tab?.id));
    if (first) return first.id;
    return [...failureIds][0] ?? null;
  }

  function waitForComplete(tabsApi, tabId, timeoutMs) {
    return new Promise(resolve => {
      let finished = false;
      let timer = null;
      const done = () => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        try { tabsApi.onUpdated?.removeListener?.(listener); } catch {}
        resolve();
      };
      const listener = (updatedId, changeInfo) => {
        if (updatedId === tabId && changeInfo?.status === 'complete') done();
      };
      tabsApi.onUpdated?.addListener?.(listener);
      timer = setTimeout(done, timeoutMs);
    });
  }

  function createBootstrap(options = {}) {
    const tabsApi = required(options.tabsApi, 'chrome.tabs');
    const sessionArea = required(options.sessionArea, 'chrome.storage.session');
    if (typeof tabsApi.reload !== 'function') throw new Error('chrome.tabs.reload required');
    if (typeof tabsApi.query !== 'function') throw new Error('chrome.tabs.query required');

    const cooldownMs = Number.isFinite(options.cooldownMs) ? Math.max(0, options.cooldownMs) : DEFAULT_COOLDOWN_MS;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const pause = typeof options.pause === 'function'
      ? options.pause
      : ms => new Promise(resolve => setTimeout(resolve, ms));
    const now = typeof options.now === 'function' ? options.now : () => Date.now();

    async function canReload(tabId) {
      if (!validTabId(tabId)) return false;
      const record = normalizeRecord(await readRecord(sessionArea));
      const row = record.tabs[String(tabId)] || null;
      if (!row || !Number.isFinite(row.at)) return true;
      return now() - Number(row.at) >= cooldownMs;
    }

    async function markReload(tabId) {
      const record = normalizeRecord(await readRecord(sessionArea));
      record.tabs[String(tabId)] = { at: now() };
      // Keep the record bounded in case Chrome reuses many tab ids over time.
      const rows = Object.entries(record.tabs)
        .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
        .slice(0, 24);
      await writeRecord(sessionArea, { tabs: Object.fromEntries(rows) });
    }

    async function bootstrap(error) {
      if (!isSessionError(error)) return { attempted: false, reason: 'not-session-error' };
      const tabId = await chooseReloadTab(tabsApi, error);
      if (!validTabId(tabId)) return { attempted: false, reason: 'no-target-tab' };
      if (!(await canReload(tabId))) {
        return { attempted: false, reason: 'cooldown', tabId };
      }

      await markReload(tabId);
      const complete = waitForComplete(tabsApi, tabId, timeoutMs);
      await tabsApi.reload(tabId);
      await complete;
      // Let the document_start session bridge deliver its capture before the
      // permission probe runs again.
      await pause(250);
      return { attempted: true, tabId };
    }

    function wrapEnumerate(enumerate) {
      if (typeof enumerate !== 'function') throw new Error('enumerate function required');
      return async function enumerateWithBootstrap() {
        try {
          return await enumerate();
        } catch (error) {
          const result = await bootstrap(error);
          if (!result.attempted) throw error;
          // Retry reads exactly once after the reload. A second session failure
          // is surfaced to the user and is never converted into a reload loop.
          return enumerate();
        }
      };
    }

    return Object.freeze({ bootstrap, wrapEnumerate, canReload, markReload });
  }

  const api = {
    STORAGE_KEY,
    DEFAULT_COOLDOWN_MS,
    DEFAULT_TIMEOUT_MS,
    isSessionError,
    normalizeRecord,
    failureTabIds,
    chooseReloadTab,
    createBootstrap
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2SessionBootstrap = api;
})();
