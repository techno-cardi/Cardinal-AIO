(() => {
  'use strict';

  const DEFAULT_MESSAGE_TYPE = 'CARDINAL_FORMATIVE_IMPORT_PROGRESS';
  const SOURCE_CHATGPT = 'chatgpt';
  const SOURCE_EXTENSION = 'extension-page';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function text(value, max = 500) {
    if (value == null) return null;
    return String(value).slice(0, max);
  }

  function safeNumber(value) {
    return Number.isFinite(value) ? Number(value) : null;
  }

  // Progress detail is deliberately tiny. It must never become a side channel
  // for packages, journals, GraphQL payloads, auth headers or server snapshots.
  function sanitizeDetail(detail) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
    const out = {};
    for (const key of ['itemId', 'action', 'message', 'targetTitle']) {
      const value = detail[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = typeof value === 'string' ? value.slice(0, 500) : value;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  function sanitizeProgress(event = {}) {
    return {
      schema: event.schema === 'cardinal.progress/1' ? event.schema : 'cardinal.progress/1',
      module: 'formative',
      runId: text(event.runId, 240),
      stage: text(event.stage, 80),
      order: safeNumber(event.order),
      percent: safeNumber(event.percent),
      label: text(event.label, 500),
      detail: sanitizeDetail(event.detail),
      itemId: text(event.itemId, 240),
      itemIndex: safeNumber(event.itemIndex),
      itemTotal: safeNumber(event.itemTotal),
      terminal: event.terminal === true,
      severity: text(event.severity, 40),
      at: text(event.at, 100)
    };
  }

  function createRelay(options = {}) {
    const sendToTab = required(options.sendToTab, 'sendToTab');
    if (typeof sendToTab !== 'function') throw new Error('sendToTab must be a function');

    const messageType = options.messageType || DEFAULT_MESSAGE_TYPE;
    const maxBindings = Number.isInteger(options.maxBindings) && options.maxBindings > 0
      ? options.maxBindings
      : 16;

    // The command origin is intentionally volatile. A service-worker restart
    // loses it, which is safer than guessing which ChatGPT tab should receive a
    // later progress event.
    let commandOriginTabId = null;
    const bindings = new Map();

    function trimBindings() {
      while (bindings.size > maxBindings) {
        const oldest = bindings.keys().next().value;
        bindings.delete(oldest);
      }
    }

    function bindCommandContext(context = {}) {
      const role = context.role || 'unknown';
      if (role === SOURCE_CHATGPT) {
        if (!validTabId(context.tabId)) {
          const error = new Error('A trusted ChatGPT tab id is required to bind importer progress.');
          error.code = 'IMPORTER_COMMAND_TAB_REQUIRED';
          error.mutationMayHaveCommitted = false;
          throw error;
        }
        commandOriginTabId = context.tabId;
        return { role, tabId: commandOriginTabId };
      }

      // Popup/extension-page commands must not inherit whichever ChatGPT tab
      // happened to be active previously. Existing run bindings stay intact.
      if (role === SOURCE_EXTENSION) {
        commandOriginTabId = null;
        return { role, tabId: null };
      }

      // Untrusted surfaces never alter routing state.
      return { role, tabId: null, ignored: true };
    }

    function ensureBinding(runId) {
      const key = String(runId || '').trim();
      if (!key) return null;
      let binding = bindings.get(key);
      if (!binding) {
        binding = {
          runId: key,
          chatgptTabId: validTabId(commandOriginTabId) ? commandOriginTabId : null,
          targetTabId: null,
          targetFormativeId: null,
          updatedAt: Date.now()
        };
        bindings.set(key, binding);
        trimBindings();
      }
      return binding;
    }

    // Browser-controller emitState may contain the full prepared object. Never
    // store or forward it. Only capture identifiers required for exact routing.
    function handleState(state = {}) {
      const runId = String(state.token || state.runId || '').trim();
      if (!runId) return null;
      const binding = ensureBinding(runId);
      if (!binding) return null;

      if (validTabId(state.targetTabId)) binding.targetTabId = state.targetTabId;
      if (state.targetFormativeId) binding.targetFormativeId = String(state.targetFormativeId);
      binding.updatedAt = Date.now();
      return { ...binding };
    }

    async function safeSend(tabId, payload) {
      if (!validTabId(tabId)) return { sent: false, reason: 'no-tab' };
      try {
        await Promise.resolve(sendToTab(tabId, payload));
        return { sent: true, tabId };
      } catch (error) {
        // Detached/navigated tabs are a UI failure only. They must never abort
        // or retry a Formative mutation.
        return {
          sent: false,
          tabId,
          reason: 'send-failed',
          code: error?.code || null
        };
      }
    }

    async function sink(rawEvent = {}) {
      const event = sanitizeProgress(rawEvent);
      const binding = ensureBinding(event.runId);
      if (!binding) return { sent: 0, destinations: [] };

      const payload = Object.freeze({
        type: messageType,
        payload: event
      });

      const destinations = [];
      const seen = new Set();
      for (const tabId of [binding.chatgptTabId, binding.targetTabId]) {
        if (!validTabId(tabId) || seen.has(tabId)) continue;
        seen.add(tabId);
        destinations.push(await safeSend(tabId, payload));
      }
      return {
        sent: destinations.filter(row => row.sent).length,
        destinations
      };
    }

    function clearTab(tabId) {
      if (!validTabId(tabId)) return 0;
      if (commandOriginTabId === tabId) commandOriginTabId = null;
      let changed = 0;
      for (const binding of bindings.values()) {
        if (binding.chatgptTabId === tabId) {
          binding.chatgptTabId = null;
          changed += 1;
        }
        if (binding.targetTabId === tabId) {
          binding.targetTabId = null;
          changed += 1;
        }
      }
      return changed;
    }

    function snapshot() {
      return {
        commandOriginTabId,
        bindings: [...bindings.values()].map(row => ({ ...row }))
      };
    }

    return Object.freeze({
      bindCommandContext,
      handleState,
      sink,
      clearTab,
      snapshot
    });
  }

  const api = {
    DEFAULT_MESSAGE_TYPE,
    sanitizeDetail,
    sanitizeProgress,
    createRelay
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ProgressRelay = api;
})();
