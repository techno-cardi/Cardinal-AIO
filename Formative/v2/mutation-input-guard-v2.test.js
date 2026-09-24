'use strict';

const assert = require('node:assert/strict');
const guard = require('./mutation-input-guard-v2.js');

function validKeyword(overrides = {}) {
  return {
    kind: 'question',
    subtype: 'shortAnswer',
    prompt: 'Nomme le modérateur.',
    points: 4,
    grading: {
      mode: 'keyword-absolute',
      partialCredit: true,
      caseSensitive: false,
      matches: [
        { text: 'graphite', score: 4, enabled: true },
        { text: 'carbone', score: 2, enabled: true }
      ]
    },
    ...overrides
  };
}

(function validInputsPass() {
  assert.equal(guard.validateLegacyItem(validKeyword()).ok, true);
  assert.equal(guard.validateLegacyItem({
    kind: 'question',
    subtype: 'longAnswer',
    prompt: 'Explique.',
    points: 3.5,
    grading: { mode: 'manual', partialCredit: false, caseSensitive: false, matches: [] }
  }).ok, true);
  assert.equal(guard.validateLegacyItem({
    kind: 'question',
    subtype: 'fillInTheBlank',
    points: 2,
    grading: { partialCredit: true, partialCreditMode: 'standard' },
    segments: [
      { text: 'Refroidi par ' },
      { blank: { answers: ['eau'] } }
    ]
  }).ok, true);
  assert.equal(guard.validateLegacyItem({ kind: 'text', content: 'Compréhension' }).ok, true);
})();

(function emptyKeywordBlocks() {
  assert.throws(
    () => guard.validateLegacyItem(validKeyword({ grading: { mode: 'keyword-absolute', matches: [] } })),
    error => error.code === 'MUTATION_KEYWORD_EMPTY' && error.mutationMayHaveCommitted === false
  );
})();

(function invalidKeywordScoresBlock() {
  assert.throws(
    () => guard.validateLegacyItem(validKeyword({
      grading: { mode: 'keyword-absolute', matches: [{ text: 'graphite', score: 3.25, enabled: true }] }
    })),
    error => error.code === 'MUTATION_KEYWORD_SCORE_PRECISION'
  );
  assert.throws(
    () => guard.validateLegacyItem(validKeyword({
      grading: { mode: 'keyword-absolute', matches: [{ text: 'graphite', score: 5, enabled: true }] }
    })),
    error => error.code === 'MUTATION_KEYWORD_SCORE_RANGE'
  );
})();

(function duplicateKeywordScoreConflictBlocks() {
  assert.throws(
    () => guard.validateLegacyItem(validKeyword({
      grading: {
        mode: 'keyword-absolute',
        caseSensitive: false,
        matches: [
          { text: 'Graphite', score: 4, enabled: true },
          { text: 'graphite', score: 2, enabled: true }
        ]
      }
    })),
    error => error.code === 'MUTATION_KEYWORD_SCORE_CONFLICT'
  );
})();

(function manualWithStaleMatchesBlocks() {
  assert.throws(
    () => guard.validateLegacyItem(validKeyword({
      grading: { mode: 'manual', matches: [{ text: 'graphite', score: 4, enabled: true }] }
    })),
    error => error.code === 'MUTATION_MANUAL_WITH_ACTIVE_MATCHES'
  );
})();

(function malformedFitbBlocks() {
  assert.throws(
    () => guard.validateLegacyItem({
      kind: 'question', subtype: 'fillInTheBlank', points: 2,
      grading: { partialCredit: true },
      segments: [{ text: 'Aucun blanc' }]
    }),
    error => error.code === 'MUTATION_FITB_EMPTY'
  );
  assert.throws(
    () => guard.validateLegacyItem({
      kind: 'question', subtype: 'fillInTheBlank', points: 2,
      grading: { partialCredit: true },
      segments: [{ blank: { answers: [] } }]
    }),
    error => error.code === 'MUTATION_FITB_ANSWERS_EMPTY'
  );
  assert.throws(
    () => guard.validateLegacyItem({
      kind: 'question', subtype: 'fillInTheBlank', points: 2,
      grading: { mode: 'manual', partialCredit: false },
      segments: [{ blank: { answers: ['eau'] } }]
    }),
    error => error.code === 'MUTATION_MANUAL_FITB_UNSUPPORTED'
  );
})();

(async function guardedWrapperNeverDelegatesInvalidCreate() {
  const calls = [];
  const raw = {
    getPageContext() {},
    permissionCheck() {},
    readLayout() {},
    readDetailedSnapshot() {},
    readItemDetailed() {},
    async createItem(input) { calls.push({ action: 'create', input }); return { formativeItemId: 'x' }; },
    async updateItem(input) { calls.push({ action: 'update', input }); return { formativeItemId: 'x' }; }
  };
  const guarded = guard.createGuardedPrimitives(raw);

  await assert.rejects(
    guarded.createItem({
      targetFormativeId: 'form-1',
      item: validKeyword({ grading: { mode: 'keyword-absolute', matches: [] } })
    }),
    error => error.code === 'MUTATION_KEYWORD_EMPTY'
  );
  assert.equal(calls.length, 0);

  await guarded.createItem({ targetFormativeId: 'form-1', item: validKeyword() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'create');
})().then(() => {
  console.log('mutation-input-guard-v2: all tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
