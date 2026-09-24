const assert = require('assert');
const managed = require('./managed-state-v2.js');
const R = require('./reconciliation-v2.js');

function tiptapText(text) {
  return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
  ] });
}

function serverItem(id, prompt = 'Question?', points = 2, subtype = 'shortAnswer') {
  return {
    _id: id,
    subtype,
    text: tiptapText(prompt),
    details: subtype === 'functionalizedText' ? {} : {
      points,
      isRequired: true,
      correctAnswers: ['rbmk'],
      answerChoicePoints: [2],
      isKeywordGrading: true,
      isPartialCredit: true,
      isCaseSensitive: false
    }
  };
}

function desired(prompt = 'Question?', points = 2) {
  return managed.managedFromDesiredV1({
    kind: 'question', subtype: 'shortAnswer', prompt, points, isRequired: true,
    grading: {
      mode: 'keyword-absolute', partialCredit: true, caseSensitive: false,
      matches: [{ text: 'rbmk', score: 2, enabled: true }]
    }
  }).managedState;
}

const deps = { managed };

// UPDATE: desired server state proves commit.
{
  const op = { action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', baseline: desired('Old?'), desired: desired('New?') };
  const r = R.reconcileOperation({ op, serverItems: [serverItem('I1', 'New?')], snapshotComplete: true }, deps);
  assert.equal(r.state, 'committed');
  assert.equal(r.formativeItemId, 'I1');
}

// UPDATE: exact baseline proves not committed and permits one controlled retry.
{
  const op = { action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', baseline: desired('Old?'), desired: desired('New?') };
  const r = R.reconcileOperation({ op, serverItems: [serverItem('I1', 'Old?')], snapshotComplete: true }, deps);
  assert.equal(r.state, 'not_committed');
}

// UPDATE: third state or missing target is conflict, never guessed.
{
  const op = { action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1', baseline: desired('Old?'), desired: desired('New?') };
  assert.equal(R.reconcileOperation({ op, serverItems: [serverItem('I1', 'Teacher edit?')], snapshotComplete: true }, deps).state, 'conflict');
  assert.equal(R.reconcileOperation({ op, serverItems: [], snapshotComplete: true }, deps).state, 'conflict');
}

// DELETE: absence in a complete snapshot proves commit; baseline still present proves not committed.
{
  const op = { action: 'DELETE', fingerprint: 'q1', formativeItemId: 'I1', baseline: desired('Old?') };
  assert.equal(R.reconcileOperation({ op, serverItems: [], snapshotComplete: true }, deps).state, 'committed');
  assert.equal(R.reconcileOperation({ op, serverItems: [serverItem('I1', 'Old?')], snapshotComplete: true }, deps).state, 'not_committed');
  assert.equal(R.reconcileOperation({ op, serverItems: [], snapshotComplete: false }, deps).state, 'conflict');
}

// CREATE: preexisting identical item is never adopted as Cardinal's timed-out creation.
{
  const op = {
    action: 'CREATE', fingerprint: 'q1', desired: desired('New?'),
    adaptedItem: { subtype: 'shortAnswer' }, preexistingServerItemIds: ['OLD1']
  };
  const r = R.reconcileOperation({ op, serverItems: [serverItem('OLD1', 'New?')], snapshotComplete: true }, deps);
  assert.equal(r.state, 'not_committed');
}

// CREATE: exactly one new same-subtype item matching desired is safely adopted.
{
  const op = {
    action: 'CREATE', fingerprint: 'q1', desired: desired('New?'),
    adaptedItem: { subtype: 'shortAnswer' }, preexistingServerItemIds: ['OLD1']
  };
  const r = R.reconcileOperation({
    op,
    serverItems: [serverItem('OLD1', 'Something old?'), serverItem('NEW1', 'New?')],
    snapshotComplete: true
  }, deps);
  assert.equal(r.state, 'committed');
  assert.equal(r.formativeItemId, 'NEW1');
}

// CREATE: one new same-subtype item with different content could be Cardinal's item edited after commit -> conflict.
{
  const op = {
    action: 'CREATE', fingerprint: 'q1', desired: desired('New?'),
    adaptedItem: { subtype: 'shortAnswer' }, preexistingServerItemIds: []
  };
  const r = R.reconcileOperation({ op, serverItems: [serverItem('NEW1', 'Edited after create?')], snapshotComplete: true }, deps);
  assert.equal(r.state, 'conflict');
  assert.equal(r.code, 'CREATE_CANDIDATE_DIVERGED');
}

// CREATE: multiple new items of same subtype are ambiguous even if one matches exactly.
{
  const op = {
    action: 'CREATE', fingerprint: 'q1', desired: desired('New?'),
    adaptedItem: { subtype: 'shortAnswer' }, preexistingServerItemIds: []
  };
  const r = R.reconcileOperation({
    op,
    serverItems: [serverItem('NEW1', 'New?'), serverItem('NEW2', 'Teacher item?')],
    snapshotComplete: true
  }, deps);
  assert.equal(r.state, 'conflict');
  assert.equal(r.code, 'CREATE_MULTIPLE_NEW_CANDIDATES');
}

// CREATE: unrelated subtype does not create false ambiguity; incomplete snapshot always blocks.
{
  const op = {
    action: 'CREATE', fingerprint: 'q1', desired: desired('New?'),
    adaptedItem: { subtype: 'shortAnswer' }, preexistingServerItemIds: []
  };
  assert.equal(R.reconcileOperation({ op, serverItems: [serverItem('M1', 'x', 2, 'functionalizedText')], snapshotComplete: true }, deps).state, 'not_committed');
  assert.equal(R.reconcileOperation({ op, serverItems: [], snapshotComplete: false }, deps).state, 'conflict');
}

console.log('reconciliation-v2: all tests passed');