(() => {
  'use strict';

  const BASE = 'https://svc.goformative.com';
  const CLIENT_LIBRARY = Object.freeze({ name: '@apollo/client', version: '4.2.12' });

  function makeError(message, props = {}) {
    const error = new Error(message);
    Object.assign(error, props);
    return error;
  }

  function endpointFor(kind, operationName, baseUrl = BASE) {
    if (!['query', 'mutation'].includes(kind)) throw new Error('kind must be query or mutation');
    if (!operationName) throw new Error('operationName required');
    return `${String(baseUrl).replace(/\/$/, '')}/graphql/${kind}/${encodeURIComponent(operationName)}`;
  }

  function classifyHttpFailure(status, kind) {
    if (status === 401 || status === 403) {
      return { code: 'SESSION_REAUTH_REQUIRED', mutationMayHaveCommitted: false };
    }
    if (status === 429) {
      return { code: 'FORMATIVE_RATE_LIMITED', mutationMayHaveCommitted: kind === 'mutation' };
    }
    if (status >= 500) {
      return { code: 'FORMATIVE_SERVER_ERROR', mutationMayHaveCommitted: kind === 'mutation' };
    }
    return { code: 'FORMATIVE_HTTP_ERROR', mutationMayHaveCommitted: false };
  }

  function defaultTabIdFactory() {
    try { return globalThis.crypto?.randomUUID?.() || null; }
    catch { return null; }
  }

  function createClient(options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const sessionStore = options.sessionStore;
    const tabIdFactory = options.tabIdFactory || defaultTabIdFactory;
    if (typeof fetchImpl !== 'function') throw new Error('fetch implementation required');
    if (!sessionStore || typeof sessionStore.getRequestHeaders !== 'function') throw new Error('sessionStore.getRequestHeaders required');
    if (typeof tabIdFactory !== 'function') throw new Error('tabIdFactory must be a function');

    async function request(input = {}) {
      const kind = input.kind;
      const operationName = input.operationName;
      const url = endpointFor(kind, operationName, options.baseUrl || BASE);
      const generatedTabId = tabIdFactory();
      const dynamicHeaders = {
        ...(input.extraHeaders || {}),
        ...(generatedTabId ? { 'x-tab-id': String(generatedTabId) } : {})
      };
      const headers = await sessionStore.getRequestHeaders(dynamicHeaders);
      const body = JSON.stringify({
        operationName,
        variables: input.variables || {},
        extensions: {
          clientLibrary: { ...CLIENT_LIBRARY },
          ...(input.extensions || {})
        },
        query: input.query
      });

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers,
          body,
          credentials: 'include',
          cache: 'no-store'
        });
      } catch (cause) {
        // Browser fetch rejection cannot prove whether bytes reached the server.
        // Mutations therefore become UNCERTAIN and are reconciled by server read.
        throw makeError(`Transport Formative interrompu pendant ${operationName}.`, {
          code: 'FORMATIVE_NETWORK_ERROR',
          operationName,
          kind,
          cause,
          requestSent: kind === 'mutation',
          mutationMayHaveCommitted: kind === 'mutation'
        });
      }

      let raw = '';
      try {
        raw = await response.text();
      } catch (cause) {
        throw makeError(`Réponse Formative illisible pour ${operationName}.`, {
          code: 'FORMATIVE_RESPONSE_READ_ERROR',
          operationName,
          kind,
          status: response.status,
          cause,
          requestSent: true,
          mutationMayHaveCommitted: kind === 'mutation'
        });
      }

      let data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch (cause) {
          throw makeError(`Réponse JSON invalide pour ${operationName}.`, {
            code: 'FORMATIVE_INVALID_JSON',
            operationName,
            kind,
            status: response.status,
            cause,
            requestSent: true,
            mutationMayHaveCommitted: kind === 'mutation'
          });
        }
      }

      if (!response.ok) {
        const classified = classifyHttpFailure(response.status, kind);
        throw makeError(`Formative HTTP ${response.status} pour ${operationName}.`, {
          ...classified,
          operationName,
          kind,
          status: response.status,
          graphQLErrors: Array.isArray(data?.errors) ? data.errors : null,
          requestSent: true
        });
      }

      if (Array.isArray(data?.errors) && data.errors.length) {
        throw makeError(`Formative a retourné une erreur GraphQL pour ${operationName}.`, {
          code: 'FORMATIVE_GRAPHQL_ERROR',
          operationName,
          kind,
          status: response.status,
          graphQLErrors: data.errors,
          requestSent: true,
          // GraphQL resolver errors can occur after a side effect. Never replay
          // a mutation purely because an `errors` array exists.
          mutationMayHaveCommitted: kind === 'mutation'
        });
      }

      if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'data')) {
        throw makeError(`Réponse GraphQL sans champ data pour ${operationName}.`, {
          code: 'FORMATIVE_GRAPHQL_DATA_MISSING',
          operationName,
          kind,
          status: response.status,
          requestSent: true,
          mutationMayHaveCommitted: kind === 'mutation'
        });
      }

      return {
        data: data.data,
        extensions: data.extensions || null,
        status: response.status,
        operationName,
        kind
      };
    }

    return {
      query(operationName, query, variables, extraHeaders) {
        return request({ kind: 'query', operationName, query, variables, extraHeaders });
      },
      mutation(operationName, query, variables, extraHeaders) {
        return request({ kind: 'mutation', operationName, query, variables, extraHeaders });
      },
      request
    };
  }

  const api = { BASE, CLIENT_LIBRARY, endpointFor, classifyHttpFailure, defaultTabIdFactory, createClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2GraphQLClient = api;
})();
