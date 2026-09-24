(() => {
  'use strict';

  if (window.__cardinalFormativeSessionMainV2) return;
  window.__cardinalFormativeSessionMainV2 = true;

  const EVENT_TYPE = 'CARDINAL_FORMATIVE_SESSION_HEADERS_V2';
  const GRAPHQL_ORIGIN = 'https://svc.goformative.com';
  const GRAPHQL_PATH = '/graphql';
  const ALLOWED = new Set([
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

  function normalizeHeaders(source) {
    const out = {};
    if (!source) return out;
    try {
      const headers = source instanceof Headers ? source : new Headers(source);
      for (const [rawName, rawValue] of headers.entries()) {
        const name = String(rawName || '').toLowerCase();
        const value = String(rawValue || '').trim();
        if (ALLOWED.has(name) && value) out[name] = value;
      }
    } catch {}
    return out;
  }

  function mergeHeaders(...sources) {
    return Object.assign({}, ...sources.map(normalizeHeaders));
  }

  function isGraphqlUrl(value) {
    try {
      const raw = typeof value === 'string'
        ? value
        : value?.url || String(value || '');
      const url = new URL(String(raw), window.location.href);
      return url.origin === GRAPHQL_ORIGIN && (url.pathname === GRAPHQL_PATH || url.pathname.startsWith(`${GRAPHQL_PATH}/`));
    } catch {
      return false;
    }
  }

  function emit(headers) {
    if (!headers?.authorization && !headers?.['x-session-id']) return;
    try {
      window.postMessage({ type: EVENT_TYPE, headers }, window.location.origin);
    } catch {}
  }

  const previousFetch = window.fetch;
  if (typeof previousFetch === 'function') {
    window.fetch = function cardinalFormativeFetch(input, init) {
      try {
        if (isGraphqlUrl(input)) {
          const inherited = typeof Request !== 'undefined' && input instanceof Request
            ? input.headers
            : null;
          emit(mergeHeaders(inherited, init?.headers));
        }
      } catch {}
      return previousFetch.apply(this, arguments);
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    const setRequestHeader = XHR.prototype.setRequestHeader;
    const send = XHR.prototype.send;
    const URL_KEY = Symbol('cardinalFormativeUrl');
    const HEADERS_KEY = Symbol('cardinalFormativeHeaders');

    if (typeof open === 'function') {
      XHR.prototype.open = function cardinalFormativeOpen(method, url) {
        try {
          this[URL_KEY] = String(url || '');
          this[HEADERS_KEY] = {};
        } catch {}
        return open.apply(this, arguments);
      };
    }

    if (typeof setRequestHeader === 'function') {
      XHR.prototype.setRequestHeader = function cardinalFormativeHeader(name, value) {
        try {
          const normalized = String(name || '').toLowerCase();
          if (ALLOWED.has(normalized) && value != null) {
            this[HEADERS_KEY] ||= {};
            this[HEADERS_KEY][normalized] = String(value).trim();
          }
        } catch {}
        return setRequestHeader.apply(this, arguments);
      };
    }

    if (typeof send === 'function') {
      XHR.prototype.send = function cardinalFormativeSend() {
        try {
          if (isGraphqlUrl(this[URL_KEY])) emit({ ...(this[HEADERS_KEY] || {}) });
        } catch {}
        return send.apply(this, arguments);
      };
    }
  }
})();
