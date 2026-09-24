const assert = require('assert');
const G = require('./graphql-client-v2.js');

function sessionStoreHarness() {
  const calls = [];
  return {
    calls,
    store: {
      async getRequestHeaders(extra = {}) {
        calls.push(extra);
        return {
          authorization: 'Bearer local',
          'content-type': 'application/json',
          'x-tab-id': extra['x-tab-id'] || 'captured-old'
        };
      }
    }
  };
}

function response(status, body, options = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      if (options.textError) throw new Error('read failed');
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

(async () => {
  // Happy query keeps the proven 0.4.1 Apollo request envelope and generates a
  // fresh x-tab-id instead of replaying the captured browser value.
  {
    let request = null;
    const session = sessionStoreHarness();
    const client = G.createClient({
      sessionStore: session.store,
      tabIdFactory: () => 'fresh-tab-id',
      fetchImpl: async (url, init) => {
        request = { url, init };
        return response(200, { data: { formative: { _id: 'F' } } });
      }
    });
    const r = await client.query('FormativePermissionCheck', 'query X { x }', { formativeId: 'F' });
    assert.equal(r.data.formative._id, 'F');
    assert(request.url.endsWith('/graphql/query/FormativePermissionCheck'));
    assert.equal(request.init.credentials, 'include');
    assert.equal(request.init.cache, 'no-store');
    assert.equal(request.init.headers['x-tab-id'], 'fresh-tab-id');
    assert.equal(session.calls[0]['x-tab-id'], 'fresh-tab-id');
    const body = JSON.parse(request.init.body);
    assert.equal(body.operationName, 'FormativePermissionCheck');
    assert.deepEqual(body.variables, { formativeId: 'F' });
    assert.deepEqual(body.extensions.clientLibrary, { name: '@apollo/client', version: '4.2.12' });
    assert.equal(body.query, 'query X { x }');
  }

  const sessionStore = sessionStoreHarness().store;
  const deterministic = { sessionStore, tabIdFactory: () => 'test-tab' };

  // Authentication failures are safe to retry after login because server explicitly rejected them.
  {
    const client = G.createClient({ ...deterministic, fetchImpl: async () => response(401, { errors: [{ message: 'unauthorized' }] }) });
    await assert.rejects(
      client.mutation('X', 'mutation X { x }', {}),
      e => e.code === 'SESSION_REAUTH_REQUIRED' && e.mutationMayHaveCommitted === false
    );
  }

  // Network failure during a mutation is always uncertain; never blind-retry.
  {
    const client = G.createClient({ ...deterministic, fetchImpl: async () => { throw new Error('network'); } });
    await assert.rejects(
      client.mutation('X', 'mutation X { x }', {}),
      e => e.code === 'FORMATIVE_NETWORK_ERROR' && e.mutationMayHaveCommitted === true
    );
  }

  // Same network failure on a read query is not a possibly committed mutation.
  {
    const client = G.createClient({ ...deterministic, fetchImpl: async () => { throw new Error('network'); } });
    await assert.rejects(
      client.query('X', 'query X { x }', {}),
      e => e.code === 'FORMATIVE_NETWORK_ERROR' && e.mutationMayHaveCommitted === false
    );
  }

  // GraphQL mutation errors remain uncertain because resolver side effects cannot be ruled out.
  {
    const client = G.createClient({ ...deterministic, fetchImpl: async () => response(200, { data: { x: null }, errors: [{ message: 'resolver failed' }] }) });
    await assert.rejects(
      client.mutation('X', 'mutation X { x }', {}),
      e => e.code === 'FORMATIVE_GRAPHQL_ERROR' && e.mutationMayHaveCommitted === true
    );
  }

  // Malformed success response after mutation is also uncertain.
  {
    const client = G.createClient({ ...deterministic, fetchImpl: async () => response(200, '<html>oops</html>') });
    await assert.rejects(
      client.mutation('X', 'mutation X { x }', {}),
      e => e.code === 'FORMATIVE_INVALID_JSON' && e.mutationMayHaveCommitted === true
    );
  }

  // Server 500 mutation may have executed; 400 is treated as rejected input.
  {
    const c500 = G.createClient({ ...deterministic, fetchImpl: async () => response(500, { data: null }) });
    await assert.rejects(c500.mutation('X', 'mutation X { x }', {}), e => e.mutationMayHaveCommitted === true);
    const c400 = G.createClient({ ...deterministic, fetchImpl: async () => response(400, { data: null }) });
    await assert.rejects(c400.mutation('X', 'mutation X { x }', {}), e => e.mutationMayHaveCommitted === false);
  }

  // Explicit request headers are retained while x-tab-id remains per-request.
  {
    const session = sessionStoreHarness();
    const client = G.createClient({
      sessionStore: session.store,
      tabIdFactory: () => 'dynamic',
      fetchImpl: async () => response(200, { data: { x: true } })
    });
    await client.request({
      kind: 'query',
      operationName: 'X',
      query: 'query X { x }',
      extraHeaders: { accept: 'application/json', 'x-tab-id': 'caller-old' }
    });
    assert.equal(session.calls[0].accept, 'application/json');
    assert.equal(session.calls[0]['x-tab-id'], 'dynamic');
  }

  console.log('graphql-client-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});