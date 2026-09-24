(() => {
  'use strict';

  const MESSAGE_TYPE = 'CARDINAL_FORMATIVE_CAPTURE_HEADERS';
  const GRAPHQL_ORIGIN = 'https://svc.goformative.com';
  const GRAPHQL_PATH = '/graphql';
  const GRAPHQL_PREFIX = `${GRAPHQL_ORIGIN}${GRAPHQL_PATH}`;

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function validTabId(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function isFormativePageUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'app.formative.com';
    } catch {
      return false;
    }
  }

  function isFormativeSender(sender = {}) {
    if (!validTabId(sender?.tab?.id)) return false;
    return isFormativePageUrl(sender?.url || sender?.tab?.url || '');
  }

  function isGraphqlRequestUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.origin === GRAPHQL_ORIGIN
        && (url.pathname === GRAPHQL_PATH || url.pathname.startsWith(`${GRAPHQL_PATH}/`));
    } catch {
      return false;
    }
  }

  function isTrustedFormativeRequest(details = {}) {
    if (!validTabId(details.tabId)) return false;
    if (!isGraphqlRequestUrl(details.url)) return false;
    return [details.initiator, details.documentUrl, details.originUrl]
      .filter(Boolean)
      .some(isFormativePageUrl);
  }

  function requestHeadersObject(rows) {
    const out = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row?.name || '').trim().toLowerCase();
      const value = row?.value == null ? '' : String(row.value).trim();
      if (!name || !value) continue;
      out[name] = value;
    }
    return out;
  }

  function createBridge(options = {}) {
    const product = required(options.product, 'production product facade');
    if (typeof product.captureSession !== 'function') throw new Error('product.captureSession required');

    const runtime = options.runtime || null;
    const webRequest = options.webRequest || null;
    const tabsApi = options.tabsApi || null;
    const consoleApi = options.console || globalThis.console;

    async function capture(headers, meta = {}) {
      return product.captureSession(headers, {
        sourceUrl: meta.sourceUrl || null,
        tabId: validTabId(meta.tabId) ? meta.tabId : null,
        source: meta.source || null
      });
    }

    function runtimeListener(message, sender, sendResponse) {
      if (message?.type !== MESSAGE_TYPE) return false;
      if (!isFormativeSender(sender)) {
        try { sendResponse?.({ handled: true, ok: false, reason: 'SESSION_CAPTURE_SENDER_REJECTED' }); } catch {}
        return false;
      }
      const headers = message?.headers || message?.payload?.headers || null;
      if (!headers || typeof headers !== 'object') {
        try { sendResponse?.({ handled: true, ok: false, reason: 'SESSION_CAPTURE_HEADERS_REQUIRED' }); } catch {}
        return false;
      }
      Promise.resolve(capture(headers, {
        sourceUrl: sender?.url || sender?.tab?.url || null,
        tabId: sender?.tab?.id,
        source: 'content-bridge'
      }))
        .then(() => sendResponse?.({ handled: true, ok: true }))
        .catch(error => {
          try { consoleApi?.warn?.('[Cardinal Formative] session capture rejected', error?.code || error?.message || error); } catch {}
          try { sendResponse?.({ handled: true, ok: false, reason: error?.code || 'SESSION_CAPTURE_FAILED' }); } catch {}
        });
      return true;
    }

    function webRequestListener(details = {}) {
      // webRequest is only a fallback. MAIN-world fetch/XHR capture is the
      // primary path and proves provenance more directly. Fail closed when
      // Chrome does not tell us which Formative page initiated this request.
      if (!isTrustedFormativeRequest(details)) return;
      const headers = requestHeadersObject(details.requestHeaders);
      if (!headers.authorization && !headers['x-session-id']) return;
      Promise.resolve(capture(headers, {
        sourceUrl: details.documentUrl || details.originUrl || details.initiator || details.url,
        tabId: details.tabId,
        source: 'webRequest'
      })).catch(error => {
        try { consoleApi?.warn?.('[Cardinal Formative] webRequest session capture rejected', error?.code || error?.message || error); } catch {}
      });
    }

    function clearTabSession(tabId, label) {
      if (!validTabId(tabId) || typeof product.clearSession !== 'function') return;
      Promise.resolve(product.clearSession(tabId)).catch(error => {
        try { consoleApi?.warn?.(`[Cardinal Formative] ${label} session cleanup failed`, error?.code || error?.message || error); } catch {}
      });
    }

    function tabRemovedListener(tabId) {
      clearTabSession(tabId, 'tab');
    }

    function tabUpdatedListener(tabId, changeInfo = {}) {
      // A reload/navigation can also represent logout/login or an account switch.
      // Drop the previous tab-bound session at the start of a new document. The
      // MAIN-world capture will repopulate it from the new page before server use.
      if (changeInfo?.status !== 'loading') return;
      clearTabSession(tabId, 'navigation');
    }

    function attach() {
      let runtimeAttached = false;
      let webRequestAttached = false;
      let tabsRemovedAttached = false;
      let tabsUpdatedAttached = false;
      let webRequestSpec = null;

      if (runtime?.onMessage?.addListener) {
        runtime.onMessage.addListener(runtimeListener);
        runtimeAttached = true;
      }

      if (webRequest?.onBeforeSendHeaders?.addListener) {
        const filter = { urls: ['https://svc.goformative.com/*'] };
        try {
          webRequest.onBeforeSendHeaders.addListener(
            webRequestListener,
            filter,
            ['requestHeaders', 'extraHeaders']
          );
          webRequestSpec = { filter, extra: ['requestHeaders', 'extraHeaders'] };
          webRequestAttached = true;
        } catch {
          try {
            webRequest.onBeforeSendHeaders.addListener(
              webRequestListener,
              filter,
              ['requestHeaders']
            );
            webRequestSpec = { filter, extra: ['requestHeaders'] };
            webRequestAttached = true;
          } catch {}
        }
      }

      if (typeof product.clearSession === 'function') {
        if (tabsApi?.onRemoved?.addListener) {
          tabsApi.onRemoved.addListener(tabRemovedListener);
          tabsRemovedAttached = true;
        }
        if (tabsApi?.onUpdated?.addListener) {
          tabsApi.onUpdated.addListener(tabUpdatedListener);
          tabsUpdatedAttached = true;
        }
      }

      return () => {
        if (runtimeAttached && runtime?.onMessage?.removeListener) {
          try { runtime.onMessage.removeListener(runtimeListener); } catch {}
        }
        if (webRequestAttached && webRequest?.onBeforeSendHeaders?.removeListener) {
          try { webRequest.onBeforeSendHeaders.removeListener(webRequestListener); } catch {}
        }
        if (tabsRemovedAttached && tabsApi?.onRemoved?.removeListener) {
          try { tabsApi.onRemoved.removeListener(tabRemovedListener); } catch {}
        }
        if (tabsUpdatedAttached && tabsApi?.onUpdated?.removeListener) {
          try { tabsApi.onUpdated.removeListener(tabUpdatedListener); } catch {}
        }
        return Boolean(
          runtimeAttached || webRequestAttached || tabsRemovedAttached || tabsUpdatedAttached || webRequestSpec
        );
      };
    }

    return Object.freeze({
      capture,
      runtimeListener,
      webRequestListener,
      tabRemovedListener,
      tabUpdatedListener,
      attach
    });
  }

  const api = {
    MESSAGE_TYPE,
    GRAPHQL_PREFIX,
    validTabId,
    isFormativePageUrl,
    isFormativeSender,
    isGraphqlRequestUrl,
    isTrustedFormativeRequest,
    requestHeadersObject,
    createBridge
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2SessionCaptureBridge = api;
})();
