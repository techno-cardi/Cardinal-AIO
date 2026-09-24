'use strict';

const assert = require('node:assert/strict');
const contract = require('./legacy-contract-v041.js');
const legacy = require('./legacy-primitives-v041.js');

// The imported question must retain readable lines for a heading, instruction
// and subparts instead of collapsing the entire prompt into one paragraph.
{
  const doc = JSON.parse(legacy.tiptap('Lis le texte.\n\na) Nomme deux causes.\nb) Justifie ta réponse.'));
  assert.deepEqual(doc.content.map(node => node.type), ['paragraph', 'paragraph', 'paragraph', 'paragraph']);
  assert.equal(doc.content[0].content[0].text, 'Lis le texte.');
  assert.equal(doc.content[1].content.length, 0);
  assert.equal(doc.content[2].content[0].text, 'a) Nomme deux causes.');
  assert.equal(doc.content[3].content[0].text, 'b) Justifie ta réponse.');
}

{
  const doc = JSON.parse(legacy.tiptapWithBlanks([
    { text: 'Complète les phrases.\nLa réponse est ' },
    { blankKey: 'blank-1' },
    { text: '.\nExplique ensuite ton choix.' }
  ]));
  assert.equal(doc.content.length, 3);
  assert.equal(doc.content[0].content[0].text, 'Complète les phrases.');
  assert.equal(doc.content[1].content[1].attrs.id, 'blank-1');
  assert.equal(doc.content[2].content[0].text, 'Explique ensuite ton choix.');
}

function shortKeywordItem(overrides = {}) {
  return {
    kind: 'question',
    subtype: 'shortAnswer',
    prompt: 'Nomme le modérateur.',
    points: 4,
    isRequired: true,
    grading: {
      mode: 'keyword-absolute',
      partialCredit: true,
      caseSensitive: false,
      matches: [
        { text: 'graphite', score: 4, enabled: true },
        { text: 'carbone', score: 2.04, enabled: true },
        { text: 'désactivé', score: 4, enabled: false }
      ]
    },
    ...overrides
  };
}

function longKeywordItem(overrides = {}) {
  return shortKeywordItem({
    subtype: 'longAnswer',
    prompt: 'Explique deux conséquences.',
    settings: { showWordCount: true },
    grading: {
      mode: 'keyword-absolute',
      partialCredit: true,
      caseSensitive: false,
      matches: [
        { text: 'thyroïde', score: 3.5, enabled: true },
        { text: 'irradiation', score: 3, enabled: true }
      ]
    },
    ...overrides
  });
}

function fitbItem(overrides = {}) {
  return {
    kind: 'question',
    subtype: 'fillInTheBlank',
    points: 2,
    isRequired: true,
    grading: { partialCredit: true, partialCreditMode: 'standard' },
    segments: [
      { text: 'Le réacteur est refroidi par ' },
      { blank: { answers: ['eau'] } },
      { text: ' et modéré par ' },
      { blank: { answers: ['graphite'] } }
    ],
    ...overrides
  };
}

function harness(options = {}) {
  const calls = [];
  let mutationNo = 0;
  let generated = 0;
  const currentRaw = options.currentRaw || null;

  const client = {
    async query(operationName, document, variables) {
      calls.push({ kind: 'query', operationName, document, variables });
      if (operationName === 'FormativePermissionCheck') {
        return { data: { formative: { _id: String(variables.formativeId), viewerPermissions: ['edit'] } } };
      }
      if (operationName === 'FormativeLayout') {
        return { data: { formative: { _id: String(variables.formativeId), items: [], title: 'Test' } } };
      }
      throw new Error(`Unexpected query ${operationName}`);
    },
    async mutation(operationName, document, variables) {
      mutationNo += 1;
      calls.push({ kind: 'mutation', mutationNo, operationName, document, variables });
      if (options.failMutationNo === mutationNo) {
        const error = new Error(`simulated mutation failure ${mutationNo}`);
        error.code = 'FORMATIVE_NETWORK_ERROR';
        error.mutationMayHaveCommitted = true;
        error.requestSent = true;
        throw error;
      }
      if (operationName === 'FormativeTeacherAddFormativeItem') {
        return { data: { payload: { formativeItem: { _id: options.createdId || 'created-1' } } } };
      }
      return { data: { payload: { formativeItem: { _id: variables.formativeItemId || variables.id || 'updated-1' } } } };
    }
  };

  const readerCalls = [];
  const reader = {
    async readDetailedSnapshot(formativeId, context) {
      readerCalls.push({ method: 'snapshot', formativeId, context });
      return { formative: { _id: formativeId, items: currentRaw ? [currentRaw] : [] }, snapshotComplete: true, detailLevel: 'managed-v2' };
    },
    async readItemDetailed(formativeId, formativeItemId, context) {
      readerCalls.push({ method: 'item', formativeId, formativeItemId, context });
      return currentRaw;
    }
  };

  const primitives = legacy.createPrimitives({
    client,
    contract,
    reader,
    getPageContext: async input => ({
      targetFormativeId: input?.targetFormativeId || 'form-1',
      urlTargetFormativeId: input?.targetFormativeId || 'form-1',
      pageKind: 'editor',
      tabId: 99,
      explicitTabBinding: true
    }),
    pauseMs: 0,
    randomKey: () => `k${++generated}`
  });

  return { primitives, calls, readerCalls };
}

function mutationCalls(h) {
  return h.calls.filter(x => x.kind === 'mutation');
}

(async () => {
  {
    const h = harness();
    const result = await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: shortKeywordItem(),
      operationId: 'op-short'
    });
    assert.equal(result.formativeItemId, 'created-1');
    const m = mutationCalls(h);
    assert.deepEqual(m.map(x => x.operationName), [
      'FormativeTeacherAddFormativeItem',
      'QuestionEditableUpdateFormativeItem',
      'QuestionEditableUpdateFormativeItem',
      'QuestionEditableUpdateFormativeItem'
    ]);
    assert.equal(m[2].variables.input.points, 4);
    assert.deepEqual(m[3].variables.input.correctAnswers, ['graphite', 'carbone']);
    assert.deepEqual(m[3].variables.input.answerChoicePoints, [4, 2]);
    assert.equal(m[3].variables.input.isKeywordGrading, true);
  }

  {
    const currentRaw = {
      _id: 'q-long',
      subtype: 'longAnswer',
      text: legacy.tiptap('Ancien prompt'),
      details: { isKeywordGrading: true, points: 4 }
    };
    const h = harness({ currentRaw });
    await h.primitives.updateItem({
      targetFormativeId: 'form-1',
      formativeItemId: 'q-long',
      item: longKeywordItem(),
      operationId: 'op-long'
    });
    assert.equal(h.readerCalls.length, 1);
    assert.equal(h.readerCalls[0].context.phase, 'mutation-adapter-precheck');
    const m = mutationCalls(h);
    assert.equal(m.length, 3);
    assert.equal(m[0].variables.input.showWordCount, true);
    assert.equal(m[1].variables.input.points, 4);
    assert.deepEqual(m[2].variables.input.correctAnswers, ['thyroïde', 'irradiation']);
  }

  {
    const h = harness();
    await h.primitives.createItem({ targetFormativeId: 'form-1', item: fitbItem() });
    const m = mutationCalls(h);
    assert.deepEqual(m.map(x => x.operationName), [
      'FormativeTeacherAddFormativeItem',
      'FillInTheBlankEditableContainerMutation',
      'QuestionEditableUpdateFormativeItem',
      'QuestionEditableUpdateFormativeItem'
    ]);
    assert.deepEqual(m[1].variables.input.blanks.map(x => x.key), ['k1', 'k2']);
    assert.deepEqual(m[1].variables.input.blanks.map(x => x.correctAnswers), [['eau'], ['graphite']]);
    assert.equal(m[2].variables.input.isRequired, true);
    assert.equal(m[3].variables.input.points, 2);
  }

  {
    const existingText = legacy.tiptapWithBlanks([
      { text: 'Le réacteur est refroidi par ' },
      { blankKey: 'old-a' },
      { text: ' et modéré par ' },
      { blankKey: 'old-b' }
    ]);
    const currentRaw = {
      _id: 'fitb-1',
      subtype: 'fillInTheBlank',
      text: existingText,
      details: { points: 2, blanks: [] }
    };
    const h = harness({ currentRaw });
    await h.primitives.updateItem({
      targetFormativeId: 'form-1',
      formativeItemId: 'fitb-1',
      item: fitbItem()
    });
    const m = mutationCalls(h);
    assert.equal(m[0].operationName, 'FillInTheBlankEditableContainerMutation');
    assert.deepEqual(m[0].variables.input.blanks.map(x => x.key), ['old-a', 'old-b']);
  }

  {
    const currentRaw = {
      _id: 'fitb-unsafe',
      subtype: 'fillInTheBlank',
      text: legacy.tiptap('Texte sans clés de blancs'),
      details: { points: 2 }
    };
    const h = harness({ currentRaw });
    await assert.rejects(
      h.primitives.updateItem({
        targetFormativeId: 'form-1',
        formativeItemId: 'fitb-unsafe',
        item: fitbItem()
      }),
      error => error.code === 'FITB_EXISTING_KEYS_UNSAFE' && error.mutationMayHaveCommitted === false
    );
    assert.equal(mutationCalls(h).length, 0);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: {
        kind: 'question',
        subtype: 'multipleChoice',
        prompt: 'Choisis B.',
        points: 2,
        isRequired: true,
        grading: { partialCredit: false },
        choices: [
          { text: 'A', correct: false },
          { text: 'B', correct: true }
        ]
      }
    });
    const m = mutationCalls(h);
    assert.deepEqual(m.map(x => x.operationName), [
      'FormativeTeacherAddFormativeItem',
      'QuestionEditableUpdateFormativeItem',
      'WithChoicesMutation',
      'QuestionEditableUpdateFormativeItem'
    ]);
    assert.deepEqual(m[2].variables.input.choiceLabels, ['A', 'B']);
    assert.deepEqual(m[2].variables.input.correctAnswers, ['k2']);
    assert.equal(m[3].variables.input.points, 2);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: {
        kind: 'question',
        subtype: 'multipleSelection',
        prompt: 'Choisis A et C.',
        points: 4,
        isRequired: true,
        grading: { partialCredit: true },
        choices: [
          { text: 'A', correct: true, points: 2 },
          { text: 'B', correct: false },
          { text: 'C', correct: true, points: 2 }
        ]
      }
    });
    const m = mutationCalls(h);
    assert.deepEqual(m[2].variables.input.correctAnswers, ['k1', 'k3']);
    assert.deepEqual(m[3].variables.input.answerChoicePoints, [2, 0, 2]);
    assert.equal(m[3].variables.input.isPartialCredit, true);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: {
        kind: 'question',
        subtype: 'inlineChoice',
        points: 2,
        isRequired: true,
        grading: { partialCredit: true },
        segments: [
          { text: 'Ces ' },
          { blank: { choices: ['déterminant', 'pronom'], correct: 'déterminant' } },
          { text: ' élèves ' },
          { blank: { choices: ['nom', 'verbe'], correct: 'verbe' } }
        ]
      }
    });
    const m = mutationCalls(h);
    assert.deepEqual(m.map(x => x.operationName), [
      'FormativeTeacherAddFormativeItem',
      'FillInTheBlankEditableContainerMutation',
      'QuestionEditableUpdateFormativeItem',
      'QuestionEditableUpdateFormativeItem'
    ]);
    const defs = m[1].variables.input.blanks;
    assert.deepEqual(defs[0].choiceLabels, ['déterminant', 'pronom']);
    assert.deepEqual(defs[0].correctAnswers, [defs[0].choices[0]]);
    assert.deepEqual(defs[1].choiceLabels, ['nom', 'verbe']);
    assert.deepEqual(defs[1].correctAnswers, [defs[1].choices[1]]);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: {
        kind: 'question',
        subtype: 'resequence',
        prompt: 'Remets en ordre.',
        points: 3,
        isRequired: true,
        grading: { partialCredit: true },
        choices: ['A', 'B', 'C']
      }
    });
    const m = mutationCalls(h);
    const choices = m.find(x => x.operationName === 'WithChoicesMutation');
    assert.deepEqual(choices.variables.input.choiceLabels, ['A', 'B', 'C']);
    assert.deepEqual(choices.variables.input.correctAnswers, choices.variables.input.choices);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: {
        kind: 'question',
        subtype: 'matching',
        prompt: 'Associe.',
        points: 2,
        isRequired: true,
        grading: { partialCredit: true },
        pairs: [
          { left: 'Nom', right: 'chat' },
          { left: 'Verbe', right: 'court' }
        ]
      }
    });
    const m = mutationCalls(h);
    const matching = m.find(x => x.operationName === 'MatchingEditableDetailsContainerMutation');
    assert.deepEqual(matching.variables.input.choiceLabels, ['Nom', 'Verbe']);
    assert.deepEqual(matching.variables.input.correctAnswers, matching.variables.input.choices);
    assert.equal(JSON.parse(matching.variables.input.labels[0]).content[0].content[0].text, 'chat');
  }

  {
    const currentRaw = {
      _id: 'manual-transition',
      subtype: 'shortAnswer',
      text: legacy.tiptap('Avant'),
      details: { points: 4, isKeywordGrading: true }
    };
    const h = harness({ currentRaw });
    const manual = shortKeywordItem({
      grading: { mode: 'manual', partialCredit: false, caseSensitive: false, matches: [] }
    });
    await assert.rejects(
      h.primitives.updateItem({
        targetFormativeId: 'form-1',
        formativeItemId: 'manual-transition',
        item: manual
      }),
      error => error.code === 'KEYWORD_TO_MANUAL_TRANSITION_NOT_PROVEN' && error.mutationMayHaveCommitted === false
    );
    assert.equal(mutationCalls(h).length, 0);
  }

  {
    const currentRaw = {
      _id: 'wrong-subtype',
      subtype: 'longAnswer',
      text: legacy.tiptap('Avant'),
      details: { points: 4 }
    };
    const h = harness({ currentRaw });
    await assert.rejects(
      h.primitives.updateItem({
        targetFormativeId: 'form-1',
        formativeItemId: 'wrong-subtype',
        item: shortKeywordItem()
      }),
      error => error.code === 'MUTATION_SUBTYPE_CONFLICT' && error.mutationMayHaveCommitted === false
    );
    assert.equal(mutationCalls(h).length, 0);
  }

  {
    const h = harness({ failMutationNo: 2, createdId: 'created-before-timeout' });
    await assert.rejects(
      h.primitives.createItem({
        targetFormativeId: 'form-1',
        item: shortKeywordItem(),
        operationId: 'op-uncertain'
      }),
      error => {
        assert.equal(error.formativeItemId, 'created-before-timeout');
        assert.equal(error.operationId, 'op-uncertain');
        assert.equal(error.targetFormativeId, 'form-1');
        assert.equal(error.mutationMayHaveCommitted, true);
        return true;
      }
    );
    assert.equal(mutationCalls(h).filter(x => x.operationName === 'FormativeTeacherAddFormativeItem').length, 1);
  }

  {
    const h = harness();
    await h.primitives.createItem({
      targetFormativeId: 'form-1',
      item: { kind: 'text', content: 'Section Compréhension' }
    });
    const m = mutationCalls(h);
    assert.deepEqual(m.map(x => x.operationName), [
      'FormativeTeacherAddFormativeItem',
      'TextEditableUpdate'
    ]);
    const doc = JSON.parse(m[1].variables.text);
    assert.equal(doc.content[0].content[0].text, 'Section Compréhension');
  }

  console.log('legacy-primitives-v041: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
