'use strict';

const assert = require('node:assert/strict');
const contract = require('./legacy-contract-v041.js');
const primitivesApi = require('./legacy-primitives-v041.js');
const gatewayApi = require('./legacy-gateway-v2.js');
const managed = require('./managed-state-v2.js');
const reconciliation = require('./reconciliation-v2.js');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeServer() {
  const items = new Map();
  const calls = [];
  let nextId = 1;

  function itemFor(id) {
    return items.get(String(id)) || null;
  }

  const client = {
    async query(operationName, document, variables) {
      calls.push({ kind: 'query', operationName, variables: clone(variables) });
      if (operationName === 'FormativePermissionCheck') {
        return {
          data: {
            formative: { _id: String(variables.formativeId), viewerPermissions: ['edit'] }
          }
        };
      }
      if (operationName === 'FormativeLayout') {
        return {
          data: {
            formative: {
              _id: String(variables.formativeId),
              title: 'Formative test intégré',
              viewerPermissions: ['edit'],
              items: [...items.values()].map(clone)
            }
          }
        };
      }
      throw new Error(`Unexpected query ${operationName}`);
    },

    async mutation(operationName, document, variables) {
      calls.push({ kind: 'mutation', operationName, variables: clone(variables) });

      if (operationName === 'FormativeTeacherAddFormativeItem') {
        const id = `srv-${nextId++}`;
        items.set(id, {
          _id: id,
          subtype: variables.subtype,
          type: variables.subtype === 'functionalizedText' ? 'content' : 'question',
          text: '',
          parentId: variables.parentId || null,
          details: {
            points: 0,
            isRequired: variables.input?.isRequired !== false,
            isKeywordGrading: false,
            isPartialCredit: false,
            isCaseSensitive: false,
            showWordCount: false,
            correctAnswers: [],
            answerChoicePoints: [],
            blanks: []
          }
        });
        return { data: { payload: { formativeItem: { _id: id } } } };
      }

      if (operationName === 'QuestionEditableUpdateFormativeItem') {
        const item = itemFor(variables.formativeItemId);
        if (!item) throw new Error('missing update target');
        const input = variables.input || {};
        if (Object.prototype.hasOwnProperty.call(input, 'text')) item.text = input.text;
        const detailFields = [
          'points', 'isRequired', 'isKeywordGrading', 'isPartialCredit',
          'isCaseSensitive', 'showWordCount', 'correctAnswers',
          'answerChoicePoints', 'partialCreditMode'
        ];
        for (const field of detailFields) {
          if (Object.prototype.hasOwnProperty.call(input, field)) item.details[field] = clone(input[field]);
        }
        return { data: { updateFormativeItem: { formativeItem: clone(item) } } };
      }

      if (operationName === 'FillInTheBlankEditableContainerMutation') {
        const item = itemFor(variables.formativeItemId);
        if (!item) throw new Error('missing FITB target');
        item.text = variables.input.text;
        item.details.blanks = clone(variables.input.blanks || []);
        return { data: { payload: { formativeItem: clone(item) } } };
      }

      if (operationName === 'TextEditableUpdate') {
        const item = itemFor(variables.formativeItemId);
        if (!item) throw new Error('missing text target');
        item.text = variables.text;
        return { data: { updateFormativeItem: { formativeItem: clone(item) } } };
      }

      throw new Error(`Unexpected mutation ${operationName}`);
    }
  };

  const reader = {
    async readDetailedSnapshot(formativeId) {
      return {
        formative: {
          _id: String(formativeId),
          title: 'Formative test intégré',
          items: [...items.values()].map(clone)
        },
        snapshotComplete: true,
        detailLevel: 'managed-v2'
      };
    },
    async readItemDetailed(formativeId, formativeItemId) {
      return clone(itemFor(formativeItemId));
    }
  };

  return { items, calls, client, reader };
}

function keywordQuestion(prompt, points, terms, subtype = 'shortAnswer') {
  return {
    id: `fp-${subtype}`,
    kind: 'question',
    subtype,
    prompt,
    points,
    isRequired: true,
    settings: subtype === 'longAnswer' ? { showWordCount: true } : undefined,
    grading: {
      mode: 'keyword-absolute',
      partialCredit: true,
      caseSensitive: false,
      matches: terms.map(([text, score]) => ({ text, score, enabled: true }))
    }
  };
}

function fitbQuestion() {
  return {
    id: 'fp-fitb',
    kind: 'question',
    subtype: 'fillInTheBlank',
    points: 2,
    isRequired: true,
    grading: { partialCredit: true, partialCreditMode: 'standard' },
    segments: [
      { text: 'Refroidi par ' },
      { blank: { answers: ['eau'] } },
      { text: ', modéré par ' },
      { blank: { answers: ['graphite'] } }
    ]
  };
}

(async () => {
  const server = makeServer();
  let generatedKey = 0;
  const primitives = primitivesApi.createPrimitives({
    client: server.client,
    contract,
    reader: server.reader,
    getPageContext: async input => ({
      targetFormativeId: input?.targetFormativeId || 'form-1',
      urlTargetFormativeId: input?.targetFormativeId || 'form-1',
      tabId: input?.targetTabId ?? 7,
      title: 'Formative test intégré',
      pageKind: 'editor',
      explicitTabBinding: input?.targetTabId != null,
      candidateTargetIds: [String(input?.targetFormativeId || 'form-1')]
    }),
    pauseMs: 0,
    randomKey: () => `stable-${++generatedKey}`
  });

  const readiness = {
    checkSnapshot() { return { ok: true, state: 'ready', issues: [] }; },
    checkItem() { return { ok: true, state: 'ready', issues: [] }; }
  };

  const gateway = gatewayApi.createGateway({ legacy: primitives, serverReadiness: readiness });

  const target = await gateway.observeTarget({ targetFormativeId: 'form-1', targetTabId: 7 });
  assert.equal(target.authState, 'authenticated');
  assert.equal(target.canEdit, true);
  assert.equal(target.targetFormativeId, 'form-1');

  const desired1 = keywordQuestion('Quel matériau modère la réaction?', 4, [
    ['graphite', 4],
    ['carbone', 2]
  ]);

  const created = await gateway.createItem({
    targetFormativeId: 'form-1',
    item: desired1,
    operationId: 'create-short'
  });
  assert.equal(created.formativeItemId, 'srv-1');

  const read1 = await gateway.readItem({
    targetFormativeId: 'form-1',
    formativeItemId: 'srv-1'
  });
  const desiredState1 = managed.managedFromDesiredV1(desired1);
  const serverState1 = managed.managedFromServerItem(read1);
  assert.equal(desiredState1.state, 'ready');
  assert.equal(serverState1.state, 'ready');
  assert.equal(reconciliation.equal(serverState1.managedState, desiredState1.managedState), true);

  const desired2 = keywordQuestion('Quel matériau agit comme modérateur dans ce réacteur?', 5, [
    ['graphite', 5],
    ['carbone', 2.5]
  ]);

  await gateway.updateItem({
    targetFormativeId: 'form-1',
    formativeItemId: 'srv-1',
    item: desired2,
    operationId: 'update-short'
  });

  const read2 = await gateway.readItem({
    targetFormativeId: 'form-1',
    formativeItemId: 'srv-1'
  });
  const desiredState2 = managed.managedFromDesiredV1(desired2);
  const serverState2 = managed.managedFromServerItem(read2);
  assert.equal(reconciliation.equal(serverState2.managedState, desiredState2.managedState), true);

  const fitb = fitbQuestion();
  const fitbCreated = await gateway.createItem({
    targetFormativeId: 'form-1',
    item: fitb,
    operationId: 'create-fitb'
  });
  assert.equal(fitbCreated.formativeItemId, 'srv-2');
  const beforeFitb = await gateway.readItem({ targetFormativeId: 'form-1', formativeItemId: 'srv-2' });
  const originalKeys = primitivesApi.blankKeysFromTiptap(beforeFitb.text);
  assert.deepEqual(originalKeys, ['stable-1', 'stable-2']);

  const changedFitb = {
    ...fitb,
    segments: [
      { text: 'Le refroidissement utilise ' },
      { blank: { answers: ['eau', 'H2O'] } },
      { text: ' et la modération utilise ' },
      { blank: { answers: ['graphite'] } }
    ]
  };
  await gateway.updateItem({
    targetFormativeId: 'form-1',
    formativeItemId: 'srv-2',
    item: changedFitb,
    operationId: 'update-fitb'
  });
  const afterFitb = await gateway.readItem({ targetFormativeId: 'form-1', formativeItemId: 'srv-2' });
  assert.deepEqual(primitivesApi.blankKeysFromTiptap(afterFitb.text), originalKeys);
  const desiredFitbState = managed.managedFromDesiredV1(changedFitb);
  const serverFitbState = managed.managedFromServerItem(afterFitb);
  assert.equal(reconciliation.equal(serverFitbState.managedState, desiredFitbState.managedState), true);

  const callsBeforeBlockedTransition = server.calls.length;
  await assert.rejects(
    gateway.updateItem({
      targetFormativeId: 'form-1',
      formativeItemId: 'srv-1',
      item: {
        ...desired2,
        grading: { mode: 'manual', partialCredit: false, caseSensitive: false, matches: [] }
      },
      operationId: 'unsafe-keyword-to-manual'
    }),
    error => error.code === 'KEYWORD_TO_MANUAL_TRANSITION_NOT_PROVEN'
  );
  assert.equal(server.calls.length, callsBeforeBlockedTransition, 'blocked transition must not send GraphQL requests');

  const snapshot = await gateway.listItems({ targetFormativeId: 'form-1' });
  assert.equal(snapshot.snapshotComplete, true);
  assert.equal(snapshot.managedDetailComplete, true);
  assert.equal(snapshot.items.length, 2);

  console.log('legacy-stack-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
