(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function requestIdOf(message) {
    return message?.requestId ? String(message.requestId).slice(0, 200) : null;
  }

  function createBridge(options = {}) {
    const router = required(options.router, 'runtime router');
    const relay = required(options.relay, 'progress relay');
    const errorPresenter = required(options.errorPresenter || globalThis.CardinalFormativeV2ErrorPresenter, 'error-presenter');
    const tabsApi = options.tabsApi || null;

    for (const name of ['owns', 'route', 'senderRole']) {
      if (typeof router[name] !== 'function') throw new Error(`router.${name} required`);
    }
    for (const name of ['bindCommandContext', 'clearTab']) {
      if (typeof relay[name] !== 'function') throw new Error(`relay.${name} required`);
    }

    function blocked(message, error) {
      const code = error?.code || 'UNKNOWN_ERROR';
      return {
        handled: true,
        requestId: requestIdOf(message),
        ok: false,
        state: 'blocked',
        reason: code,
        error: errorPresenter.present(error || { code })
      };
    }

    function bindSender(message, sender = {}) {
      const role = router.senderRole(sender);
      if (role === 'chatgpt') {
        const tabId = sender?.tab?.id;
        if (!Number.isInteger(tabId) || tabId < 0) {
          const error = new Error('La commande ChatGPT n’est pas liée à un onglet de navigateur identifiable.');
          error.code = 'IMPORTER_COMMAND_TAB_REQUIRED';
          error.mutationMayHaveCommitted = false;
          throw error;
        }
        relay.bindCommandContext({
          role,
          tabId,
          type: message?.type || null,
          requestId: requestIdOf(message)
        });
        return { role, tabId };
      }

      if (role === 'extension-page') {
        relay.bindCommandContext({
          role,
          tabId: null,
          type: message?.type || null,
          requestId: requestIdOf(message)
        });
        return { role, tabId: null };
      }

      // Formative/unknown senders are deliberately not allowed to influence the
      // progress route before the runtime router rejects their command.
      return { role, tabId: sender?.tab?.id ?? null, ignored: true };
    }

    async function route(message, sender = {}) {
      if (!router.owns(message)) return { handled: false };
      try {
        bindSender(message, sender);
      } catch (error) {
        return blocked(message, error);
      }
      return router.route(message, sender);
    }

    function attach(runtime) {
      required(runtime?.onMessage, 'runtime.onMessage');
      if (typeof runtime.onMessage.addListener !== 'function') {
        throw new Error('runtime.onMessage.addListener required');
      }

      const listener = (message, sender, sendResponse) => {
        // This preserves coexistence with Gestion des notes / Mozaïk. Unknown
        // messages are never consumed and other listeners may handle them.
        if (!router.owns(message)) return false;
        route(message, sender)
          .then(sendResponse)
          .catch(error => sendResponse(blocked(message, error)));
        return true;
      };
      runtime.onMessage.addListener(listener);

      let removedListener = null;
      if (tabsApi?.onRemoved && typeof tabsApi.onRemoved.addListener === 'function') {
        removedListener = tabId => {
          try { relay.clearTab(tabId); } catch {}
        };
        tabsApi.onRemoved.addListener(removedListener);
      }

      return () => {
        if (typeof runtime.onMessage.removeListener === 'function') {
          runtime.onMessage.removeListener(listener);
        }
        if (
          removedListener &&
          tabsApi?.onRemoved &&
          typeof tabsApi.onRemoved.removeListener === 'function'
        ) {
          tabsApi.onRemoved.removeListener(removedListener);
        }
      };
    }

    return Object.freeze({
      route,
      attach,
      bindSender
    });
  }

  const api = { createBridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ServiceWorkerBridge = api;
})();
