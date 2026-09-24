'use strict';

const assert = require('node:assert/strict');
const A = require('./chatgpt-correction-audit-v2.js');

{
  assert.deepEqual(
    A.expandMechanicalVariants('thyroïde'),
    ['thyroïde', 'thyroide']
  );
  const variants = A.expandMechanicalVariants('iode-131');
  assert(variants.includes('iode-131'));
  assert(!variants.includes('iode 131')); // adapter-v2 does not synthesize digit-hyphen variants
}

{
  const item = {
    id: 'q16', kind: 'question', order: 1,
    source: { number: '16' },
    prompt: 'Nomme deux conséquences.',
    subtype: 'longAnswer',
    points: { value: 4 },
    grading: {
      mode: 'assisted',
      caseSensitive: false,
      expectedAnswer: 'Deux conséquences expliquées.',
      concepts: [
        { id: 'thyroid', score: 3.5, terms: ['cancer thyroïde'], riskyTerms: ['cancer'] },
        { id: 'iodine', score: 3, terms: ['iode-131'], riskyTerms: [] }
      ]
    }
  };
  const row = A.formatQuestionAudit(item);
  assert.equal(row.number, '16');
  assert.equal(row.mode, 'Assistée');
  assert.equal(row.expectedAnswer, 'Deux conséquences expliquées.');
  assert(row.groups.some(group => group.score === 3.5 && group.terms.includes('cancer thyroïde')));
  assert(row.groups.some(group => group.score === 3.5 && group.terms.includes('cancer thyroide')));
  assert(row.groups.some(group => group.score === 3 && group.terms.includes('iode-131')));
  assert.deepEqual(row.blanks, []);
  assert.deepEqual(row.riskyTerms, ['cancer']);
}

{
  const item = {
    id: 'q1', kind: 'question', order: 1,
    source: { number: '1' },
    prompt: 'Le réacteur est situé en {{pays}}.',
    subtype: 'fillInTheBlank',
    points: { value: 2 },
    response: {
      blanks: [
        { id: 'pays', answers: ['Ukraine', 'République d’Ukraine'] }
      ]
    },
    grading: { mode: 'auto', caseSensitive: false, concepts: [] }
  };
  const row = A.formatQuestionAudit(item);
  assert.equal(row.groups.length, 0);
  assert.equal(row.blanks.length, 1);
  assert.equal(row.blanks[0].id, 'pays');
  // Case-insensitive deduplication preserves the first/original spelling, just
  // like adapter-v2. Deaccented/apostrophe variants remain distinct outputs.
  assert(row.blanks[0].answers.includes('Ukraine'));
  assert(row.blanks[0].answers.includes('République d’Ukraine'));
  assert(row.blanks[0].answers.includes("Republique d'Ukraine"));
  assert(!row.blanks[0].answers.includes('ukraine'));
}

{
  assert.throws(
    () => A.exactMatches({ grading: { mode: 'auto', caseSensitive: false, concepts: [
      { score: 2, terms: ['graphite'] },
      { score: 1, terms: ['GRAPHITE'] }
    ] } }),
    error => error.code === 'AUDIT_TERM_SCORE_CONFLICT'
  );
}

{
  const rows = A.auditRows({ items: [
    { id: 'section', kind: 'section', order: 1 },
    { id: 'q2', kind: 'question', order: 3, source: { number: '2' }, points: { value: 1 }, grading: { mode: 'manual', concepts: [] } },
    { id: 'q1', kind: 'question', order: 2, source: { number: '1' }, points: { value: 1 }, grading: { mode: 'auto', concepts: [{ score: 1, terms: ['RBMK'] }] } }
  ]});
  assert.deepEqual(rows.map(row => row.number), ['1', '2']);
  assert.equal(rows[1].groups.length, 0);
}

console.log('chatgpt-correction-audit-v2: all tests passed');
