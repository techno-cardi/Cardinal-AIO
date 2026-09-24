(() => {
  'use strict';

  const MESSAGE_TYPE = 'CARDINAL_FORMATIVE_CAPTURE_HEADERS';
  const FORMATIVE_ORIGIN = 'https://app.formative.com';

  function originOf(value) {
    try { return new URL(String(value || '')).origin; } catch { return null; }
  }

  function createBridge(options = {}) {
    const product = options.product;
    const runtime = options.runtime || globalThis.chrome?.runtime;
    if (!product || typeof product.captureSession !== 'function') {
      throw new Error('product.captureSession required');
    }
    if (!runtime?.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      throw new Error('runtime.onMessage required');
    }

    const extensionId = options.extensionId || runtime.id || null;

    function owns(message) {
      return message?.type === MESSAGE_TYPE;
    }

    function trustedSender(sender = {}) {
      if (extensionId && sender?.id && sender.id !== extensionId) return false;
      return originOf(sender?.url) === FORMATIVE_ORIGIN && Number.isInteger(sender?.tab?.id) && sender.tab.id >= 0;
    }

    async function route(message, sender = {}) {
      if (!owns(message)) return { handled: false };
      if (!trustedSender(sender)) {
        return {
          handled: true,
          ok: false,
          reason: 'FORMATIVE_SESSION_CAPTURE_SOURCE_FORBIDDEN'
        };
      }

      try {
        await product.captureSession(message.headers, {
          sourceUrl: sender.url
        });
        return { handled: true, ok: true };
      } catch (error) {
        return {
          handled: true,
          ok: false,
          reason: error?.code || 'FORMATIVE_SESSION_CAPTURE_INVALID'
        };
      }
    }

    function attach() {
      const listener = (message, sender, sendResponse) => {
        if (!owns(message)) return false;
        route(message, sender).then(sendResponse, error => sendResponse({
          handled: true,
          ok: false,
          reason: error?.code || 'FORMATIVE_SESSION_CAPTURE_INVALID'
        }));
        return true;
      };
      runtime.onMessage.addListener(listener);
      return () => runtime.onMessage.removeListener?.(listener);
    }

    return Object.freeze({ owns, trustedSender, route, attach });
  }

  const api = { MESSAGE_TYPE, FORMATIVE_ORIGIN, createBridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2LegacySessionBridge = api;
})();
