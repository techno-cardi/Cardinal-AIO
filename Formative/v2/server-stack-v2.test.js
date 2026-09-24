'use strict';

const assert = require('node:assert/strict');
const serverStackApi = require('./server-stack-v2.js');
const sessionApi = require('./session-store-v2.js');
const graphqlApi = require('./graphql-client-v2.js');
const readerApi = require('./formative-reader-v2.js');
const primitiveApi = require('./legacy-primitives-v041.js');
const mutationGuard = require('./mutation-input-guard-v2.js');
const gatewayApi = require('./legacy-gateway-v2.js');
const readiness = require('./server-readiness-v2.js');
const contract = require('./legacy-contract-v041.js');
const hostCompat = require('./host-compat-v2.js');

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); }
  };
}

(async () => {
  const requests = [];
  let created = 0;

  async function fetchImpl(url, options) {
    const body = JSON.parse(options.body);
    requests.push({ url, headers: { ...options.headers }, body });

    if (body.operationName === 'FormativePermissionCheck') {
      return response({
        data: {
          formative: { _id: body.variables.formativeId, viewerPermissions: ['edit'] },
          assignmentForStudent: null,
          viewer: { _id: 'teacher-1', sectionInvites: [] }
        }
      });
    }

    if (body.operationName === 'FormativeTeacherAddFormativeItem') {
      created += 1;
      return response({ data: { payload: { formativeItem: { _id: `created-${created}` } } } });
    }

    if (body.operationName === 'QuestionEditableUpdateFormativeItem') {
      return response({ data: { updateFormativeItem: { formativeItem: { _id: body.variables.formativeItemId } } } });
    }

    if (body.operationName === 'TextEditableUpdate') {
      return response({ data: { updateFormativeItem: { formativeItem: { _id: body.variables.formativeItemId } } } });
    }

    throw new Error(`Unexpected operation: ${body.operationName}`);
  }

  const stack = serverStackApi.createServerStack({
    sessionApi,
    graphqlApi,
    readerApi,
    primitiveApi,
    mutationGuard,
    gatewayApi,
    readiness,
    contract,
    hostCompat,
    sessionArea: sessionApi.createMemoryArea(),
    fetchImpl,
    getPageContext: async input => ({
      targetFormativeId: input?.targetFormativeId || 'form-1',
      urlTargetFormativeId: input?.targetFormativeId || 'form-1',
      tabId: input?.targetTabId ?? 5,
      title: 'Évaluation test',
      pageKind: 'editor',
      explicitTabBinding: true,
      candidateTargetIds: [String(input?.targetFormativeId || 'form-1')]
    }),
    pauseMs: 0
  });

  assert.equal(Object.prototype.hasOwnProperty.call(stack, 'rawPrimitives'), false);
  assert.equal(serverStackApi.targetTabIdFrom({ targetTabId: 5 }), 5);
  assert.equal(serverStackApi.targetTabIdFrom({ context: { targetTabId: 6 } }), 6);

  await stack.captureSession({
    authorization: 'Bearer tab-five',
    'x-session-id': 'session-5',
    'x-user-id': 'teacher-1'
  }, { sourceUrl: 'https://app.formative.com/formatives/form-1', tabId: 5 });

  await stack.captureSession({
    authorization: 'Bearer tab-six',
    'x-session-id': 'session-6',
    'x-user-id': 'teacher-2'
  }, { sourceUrl: 'https://app.formative.com/formatives/form-2', tabId: 6 });

  const diag = await stack.sessionDiagnostics();
  assert.equal(diag.available, true);
  assert.equal(diag.sessionCount, 2);
  assert.deepEqual(diag.tabIds, [5, 6]);
  assert.equal((await stack.sessionDiagnostics(5)).tabId, 5);

  const observed = await stack.gateway.observeTarget({ targetFormativeId: 'form-1', targetTabId: 5 });
  assert.equal(observed.authState, 'authenticated');
  assert.equal(observed.canEdit, true);
  assert.match(requests[0].url, /\/graphql\/query\/FormativePermissionCheck$/);
  assert.equal(requests[0].headers.authorization, 'Bearer tab-five');

  // A second selected tab must consume only that tab's captured account/session.
  await stack.gateway.observeTarget({ targetFormativeId: 'form-2', targetTabId: 6 });
  assert.equal(requests.at(-1).headers.authorization, 'Bearer tab-six');
  await stack.gateway.observeTarget({ targetFormativeId: 'form-1', targetTabId: 5 });
  assert.equal(requests.at(-1).headers.authorization, 'Bearer tab-five');

  // Server access without an explicit target tab is blocked before GraphQL.
  const beforeMissingScope = requests.length;
  await assert.rejects(
    stack.gateway.createItem({
      targetFormativeId: 'form-1',
      item: { kind: 'text', content: 'Ne doit pas partir' }
    }),
    error => error.code === 'SESSION_TAB_BINDING_REQUIRED' && error.mutationMayHaveCommitted === false
  );
  assert.equal(requests.length, beforeMissingScope);

  const requestCountBeforeInvalid = requests.length;
  await assert.rejects(
    stack.gateway.createItem({
      targetFormativeId: 'form-1',
      context: { targetTabId: 5 },
      item: {
        kind: 'question',
        subtype: 'shortAnswer',
        prompt: 'Question invalide',
        points: 4,
        grading: { mode: 'keyword-absolute', matches: [] }
      }
    }),
    error => error.code === 'MUTATION_KEYWORD_EMPTY' && error.mutationMayHaveCommitted === false
  );
  assert.equal(requests.length, requestCountBeforeInvalid, 'invalid mutation must not reach GraphQL');

  const createdResult = await stack.gateway.createItem({
    targetFormativeId: 'form-1',
    context: { targetTabId: 5 },
    item: {
      kind: 'question',
      subtype: 'shortAnswer',
      prompt: 'Quel matériau modère la réaction?',
      points: 4,
      isRequired: true,
      grading: {
        mode: 'keyword-absolute',
        partialCredit: true,
        caseSensitive: false,
        matches: [
          { text: 'graphite', score: 4, enabled: true },
          { text: 'carbone', score: 2, enabled: true }
        ]
      }
    },
    operationId: 'op-create'
  });

  assert.equal(createdResult.formativeItemId, 'created-1');
  const createRequests = requests.filter(row => row.body.operationName === 'FormativeTeacherAddFormativeItem');
  assert.equal(createRequests.length, 1);
  assert.equal(createRequests[0].headers.authorization, 'Bearer tab-five');
  assert.equal(requests.filter(row => row.body.operationName === 'QuestionEditableUpdateFormativeItem').length, 3);

  // Closing/logging out one tab does not invalidate another Formative tab.
  await stack.clearSession(5);
  const expired = await stack.gateway.observeTarget({ targetFormativeId: 'form-1', targetTabId: 5 });
  assert.equal(expired.authState, 'expired');
  assert.equal(expired.canEdit, null);
  assert.equal(expired.targetFormativeId, 'form-1');

  const stillAuthenticated = await stack.gateway.observeTarget({ targetFormativeId: 'form-2', targetTabId: 6 });
  assert.equal(stillAuthenticated.authState, 'authenticated');
  assert.equal(requests.at(-1).headers.authorization, 'Bearer tab-six');

  console.log('server-stack-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
