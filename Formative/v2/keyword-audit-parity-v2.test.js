'use strict';

const assert = require('node:assert/strict');
const Adapter = require('./adapter-v2.js');
const Audit = require('./chatgpt-correction-audit-v2.js');

function basePackage(terms, options = {}) {
  return {
    schema: 'cardinal.formative/2',
    protocolVersion: '2.0.0',
    packageMode: 'patch',
    assessment: {
      title: 'Audit parity',
      language: 'fr-CA',
      sourceMode: 'external-reference-only'
    },
    sources: [
      { id: 'questions', role: 'questionnaire', label: 'Questions', status: 'provided', semanticFingerprint: 'audit-parity-v1' }
    ],
    items: [
      {
        id: 'q1',
        kind: 'question',
        order: 1,
        source: {
          sourceRef: 'questions',
          page: 1,
          printedPage: null,
          number: '1',
          subNumber: null,
          promptExact: '1) Réponds à la question.'
        },
        sourceRefs: [],
        prompt: 'Réponds à la question.',
        subtype: 'shortAnswer',
        required: true,
        points: { value: 4, provenance: 'provided', graded: true, bonus: false },
        grading: {
          mode: 'auto',
          expectedAnswer: 'Réponse test',
          provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
          partialCredit: true,
          caseSensitive: options.caseSensitive === true,
          requirements: [],
          concepts: terms.map((row, index) => ({
            id: `c${index + 1}`,
            label: row.label || row.term,
            description: '',
            score: row.score,
            provenance: 'questionIntrinsic',
            terms: [row.term],
            riskyTerms: []
          }))
        },
        transformations: [
          { code: 'removeSourceNumber', description: 'Numéro source retiré.', requiresReview: false }
        ],
        issues: []
      }
    ],
    issues: []
  };
}

function fitbPackage() {
  const pkg = basePackage([]);
  pkg.items[0] = {
    ...pkg.items[0],
    source: { ...pkg.items[0].source, promptExact: '1) Pays: {{pays}}. Concept: {{concept}}.' },
    prompt: 'Pays: {{pays}}. Concept: {{concept}}.',
    subtype: 'fillInTheBlank',
    grading: {
      mode: 'auto',
      expectedAnswer: 'Ukraine; santé mentale',
      provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [],
      concepts: []
    },
    response: {
      blanks: [
        { id: 'pays', answers: ['Ukraine'], conceptIds: [] },
        { id: 'concept', answers: ['santé-mentale', 'Santé mentale'], conceptIds: [] }
      ]
    }
  };
  return pkg;
}

function normalized(rows) {
  return rows
    .map(row => ({ text: String(row.text), score: Number(row.score) }))
    .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text, 'fr'));
}

function adapterResult(pkg) {
  const result = Adapter.adaptPackageV2ToV1(pkg, { targetFormativeId: 'form-parity' });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  return result.packageV1.items.find(row => row.kind === 'question');
}

function adapterMatches(pkg) {
  return adapterResult(pkg).grading.matches;
}

for (const fixture of [
  {
    name: 'accents',
    terms: [
      { term: 'thyroïde', score: 3.5 },
      { term: 'brûlures', score: 3 }
    ]
  },
  {
    name: 'apostrophes',
    terms: [
      { term: "l’exposition", score: 2.5 },
      { term: 'd’accord', score: 1.5 }
    ]
  },
  {
    name: 'letter hyphen',
    terms: [
      { term: 'santé-mentale', score: 3 }
    ]
  },
  {
    name: 'digit hyphen stays literal',
    terms: [
      { term: 'iode-131', score: 3 }
    ]
  },
  {
    name: 'case insensitive collapse',
    terms: [
      { term: 'RBMK', score: 4 },
      { term: 'graphite', score: 3 }
    ]
  }
]) {
  const pkg = basePackage(fixture.terms);
  const sourceItem = pkg.items[0];
  assert.deepEqual(
    normalized(Audit.exactMatches(sourceItem)),
    normalized(adapterMatches(pkg)),
    `audit/adapter grading drift for ${fixture.name}`
  );
}

{
  const pkg = basePackage([
    { term: 'RBMK', score: 4 },
    { term: 'rbmk', score: 4 }
  ], { caseSensitive: true });
  assert.deepEqual(
    normalized(Audit.exactMatches(pkg.items[0])),
    normalized(adapterMatches(pkg)),
    'case-sensitive audit must remain identical to adapter output'
  );
}

// Explicitly freeze the present behaviour: digit hyphens are not expanded to
// spaces mechanically. If we decide to support “iode 131”, adapter + audit must
// change together and this regression should be intentionally updated.
{
  const pkg = basePackage([{ term: 'iode-131', score: 3 }]);
  const matches = normalized(adapterMatches(pkg));
  assert(matches.some(row => row.text === 'iode-131'));
  assert(!matches.some(row => row.text === 'iode 131'));
}

// FITB answer lists are not concept keywords. The audit must mirror the exact
// blank answers emitted by adapter-v2, including mechanical variants and
// deduplication, so the teacher sees the real correction before import.
{
  const pkg = fitbPackage();
  const adapted = adapterResult(pkg);
  const sentAnswers = adapted.segments
    .filter(segment => segment.blank)
    .map(segment => segment.blank.answers);
  const auditAnswers = Audit.exactBlankAnswers(pkg.items[0]).map(row => row.answers);
  assert.deepEqual(auditAnswers, sentAnswers);
}

console.log('keyword-audit-parity-v2: all tests passed');
