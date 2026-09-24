(() => {
  'use strict';

  if (globalThis.__cardinalFormativeSessionContentV2) return;
  globalThis.__cardinalFormativeSessionContentV2 = true;

  const EVENT_TYPE = 'CARDINAL_FORMATIVE_SESSION_HEADERS_V2';
  const MESSAGE_TYPE = 'CARDINAL_FORMATIVE_CAPTURE_HEADERS';

  function validPayload(event) {
    if (event?.source !== window) return null;
    if (event?.origin !== window.location.origin) return null;
    if (event?.data?.type !== EVENT_TYPE) return null;
    const headers = event?.data?.headers;
    if (!headers || typeof headers !== 'object') return null;
    if (!headers.authorization && !headers['x-session-id']) return null;
    return headers;
  }

  window.addEventListener('message', event => {
    const headers = validPayload(event);
    if (!headers) return;
    try {
      const promise = chrome.runtime?.sendMessage?.({ type: MESSAGE_TYPE, headers });
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch {}
  });
})();
