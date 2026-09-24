const assert = require('assert');
const M = require('./managed-state-v2.js');

function tiptapText(text) {
  return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
  ] });
}

// Short Answer desired/server normalize to identical managed state.
{
  const desired = M.managedFromDesiredV1({
    id: 'q1', kind: 'question', subtype: 'shortAnswer', points: 4, isRequired: true,
    prompt: 'Écris chat.',
    grading: {
      mode: 'keyword-absolute', partialCredit: true, caseSensitive: false,
      matches: [{ text: 'chat', score: 4, enabled: true }, { text: 'Chat', score: 4, enabled: true }]
    },
    settings: { showWordCount: true }
  });
  const server = M.managedFromServerItem({
    _id: 'F1', subtype: 'shortAnswer', text: tiptapText('Écris chat.'),
    details: {
      points: 4, isRequired: true, correctAnswers: ['Chat', 'chat'], answerChoicePoints: [4, 4],
      isKeywordGrading: true, isPartialCredit: true, isCaseSensitive: false
    }
  });
  assert.equal(desired.state, 'ready');
  assert.equal(server.state, 'ready');
  assert.deepEqual(server.managedState, desired.managedState);
}

// Long Answer showWordCount is part of owned state.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'longAnswer', points: 3, isRequired: false,
    prompt: 'Explique.', grading: { mode: 'manual', matches: [], partialCredit: false, caseSensitive: false },
    settings: { showWordCount: true }
  });
  const server = M.managedFromServerItem({
    subtype: 'longAnswer', text: tiptapText('Explique.'),
    details: { points: 3, isRequired: false, isKeywordGrading: false, isPartialCredit: false, isCaseSensitive: false, showWordCount: true }
  });
  assert.deepEqual(server.managedState, desired.managedState);
}

// FITB random server keys normalize by semantic blank order.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'fillInTheBlank', points: 2, isRequired: true,
    grading: { partialCredit: true },
    segments: [
      { text: 'Pays ' }, { blank: { answers: ['Québec', 'Quebec'] } },
      { text: ' année ' }, { blank: { answers: ['1986'] } }, { text: '.' }
    ]
  });

  const serverDoc = JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [
      { type: 'text', text: 'Pays ' },
      { type: 'blankItem', attrs: { dir: 'auto', id: 'rndA', index: null, type: 'text' } },
      { type: 'text', text: ' année ' },
      { type: 'blankItem', attrs: { dir: 'auto', id: 'rndB', index: null, type: 'text' } },
      { type: 'text', text: '.' }
    ] }
  ] });

  const server = M.managedFromServerItem({
    subtype: 'fillInTheBlank', text: serverDoc,
    details: {
      points: 2, isRequired: true, isPartialCredit: true,
      blanks: [
        { key: 'rndB', correctAnswers: ['1986'] },
        { key: 'rndA', correctAnswers: ['Quebec', 'Québec'] }
      ]
    }
  });

  assert.equal(server.state, 'ready');
  assert.deepEqual(server.managedState, desired.managedState);
}

// Multiple Choice desired/server normalize by semantic labels rather than random server keys.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'multipleChoice', points: 2, isRequired: true,
    prompt: 'Choisis.', grading: { partialCredit: false },
    choices: [
      { text: 'A', correct: false },
      { text: 'B', correct: true }
    ]
  });
  const server = M.managedFromServerItem({
    subtype: 'multipleChoice', text: tiptapText('Choisis.'),
    details: {
      points: 2, isRequired: true, isPartialCredit: false,
      choiceLabels: ['A', 'B'], choices: ['x7', 'y9'], correctAnswers: ['y9']
    }
  });
  assert.equal(desired.state, 'ready');
  assert.equal(server.state, 'ready');
  assert.deepEqual(server.managedState, desired.managedState);
}

// Multiple Selection preserves per-choice scores and partial-credit semantics.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'multipleSelection', points: 4, isRequired: true,
    prompt: 'Choisis tout.', grading: { partialCredit: true },
    choices: [
      { text: 'A', correct: true, points: 2 },
      { text: 'B', correct: false },
      { text: 'C', correct: true, points: 2 }
    ]
  });
  const server = M.managedFromServerItem({
    subtype: 'multipleSelection', text: tiptapText('Choisis tout.'),
    details: {
      points: 4, isRequired: true, isPartialCredit: true,
      choiceLabels: ['A', 'B', 'C'], choices: ['k1', 'k2', 'k3'],
      correctAnswers: ['k1', 'k3'], answerChoicePoints: [2, 0, 2]
    }
  });
  assert.deepEqual(server.managedState, desired.managedState);
}

// Inline Choice normalizes random blank/choice keys to visible options + correct value.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'inlineChoice', points: 2, isRequired: true,
    grading: { partialCredit: true },
    segments: [
      { text: 'Ces ' },
      { blank: { choices: ['déterminant', 'pronom'], correct: 'déterminant' } },
      { text: ' élèves ' },
      { blank: { choices: ['nom', 'verbe'], correct: 'verbe' } }
    ]
  });
  const serverDoc = JSON.stringify({ type: 'doc', content: [{
    type: 'paragraph', content: [
      { type: 'text', text: 'Ces ' },
      { type: 'blankItem', attrs: { id: 'bA' } },
      { type: 'text', text: ' élèves ' },
      { type: 'blankItem', attrs: { id: 'bB' } }
    ]
  }]});
  const server = M.managedFromServerItem({
    subtype: 'inlineChoice', text: serverDoc,
    details: {
      points: 2, isRequired: true, isPartialCredit: true,
      blanks: [
        { key: 'bA', choiceLabels: ['déterminant', 'pronom'], choices: ['a1', 'a2'], correctAnswers: ['a1'] },
        { key: 'bB', choiceLabels: ['nom', 'verbe'], choices: ['b1', 'b2'], correctAnswers: ['b2'] }
      ]
    }
  });
  assert.equal(server.state, 'ready');
  assert.deepEqual(server.managedState, desired.managedState);
}

// Resequence ignores opaque keys and recovers the correct semantic order.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'resequence', points: 3, isRequired: true,
    prompt: 'Ordre.', grading: { partialCredit: true },
    choices: ['A', 'B', 'C']
  });
  const server = M.managedFromServerItem({
    subtype: 'resequence', text: tiptapText('Ordre.'),
    details: {
      points: 3, isRequired: true, isPartialCredit: true,
      choiceLabels: ['B', 'C', 'A'],
      choices: ['k2', 'k3', 'k1'],
      correctAnswers: ['k1', 'k2', 'k3']
    }
  });
  assert.deepEqual(server.managedState, desired.managedState);
}

// Matching recovers semantic pairs from right-label order + correct key mapping.
{
  const desired = M.managedFromDesiredV1({
    kind: 'question', subtype: 'matching', points: 2, isRequired: true,
    prompt: 'Associe.', grading: { partialCredit: true },
    pairs: [
      { left: 'Nom', right: 'chat' },
      { left: 'Verbe', right: 'court' }
    ]
  });
  const server = M.managedFromServerItem({
    subtype: 'matching', text: tiptapText('Associe.'),
    details: {
      points: 2, isRequired: true, isPartialCredit: true,
      choiceLabels: ['Verbe', 'Nom'],
      choices: ['k2', 'k1'],
      labels: [tiptapText('chat'), tiptapText('court')],
      correctAnswers: ['k1', 'k2']
    }
  });
  assert.deepEqual(server.managedState, desired.managedState);
}

// Unknown server-only fields are intentionally absent from managedState.
{
  const r = M.managedFromServerItem({
    subtype: 'shortAnswer', text: tiptapText('Q'),
    details: {
      points: 1, isRequired: true, isKeywordGrading: false, isPartialCredit: false,
      isCaseSensitive: false, rubric: { secret: 'preserve me' }, media: { x: 1 }
    }
  });
  assert.equal(r.managedState.rubric, undefined);
  assert.equal(r.managedState.media, undefined);
}

// Keyword server arrays with different lengths are unsafe.
{
  const r = M.managedFromServerItem({
    subtype: 'shortAnswer', text: tiptapText('Q'),
    details: {
      points: 2, isRequired: true, isKeywordGrading: true, isPartialCredit: true,
      isCaseSensitive: false, correctAnswers: ['a', 'b'], answerChoicePoints: [2]
    }
  });
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'SERVER_KEYWORD_SCORE_LENGTH_MISMATCH'));
}

// Still-unproven subtype is blocked instead of guessed.
{
  const r = M.managedFromServerItem({ subtype: 'categorize', details: {} });
  assert.equal(r.state, 'blocked');
}

console.log('managed-state-v2: all tests passed');
