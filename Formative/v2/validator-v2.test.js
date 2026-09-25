const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const V2 = require('./validator-v2.js');

function baseQuestion(overrides = {}) {
  return {
    id: 'q1',
    kind: 'question',
    order: 1,
    source: {
      sourceRef: 'questions',
      page: 1,
      printedPage: null,
      number: '1',
      subNumber: null,
      promptExact: '1) Quel type de réacteur est impliqué?'
    },
    sourceRefs: ['texte'],
    prompt: 'Quel type de réacteur est impliqué?',
    subtype: 'shortAnswer',
    required: true,
    points: { value: 2, provenance: 'provided', graded: true, bonus: false },
    grading: {
      mode: 'auto',
      expectedAnswer: 'RBMK au graphite',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['texte'] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [],
      concepts: [
        { id: 'rbmk', label: 'RBMK', score: 2, provenance: 'sourceExplicit', terms: ['RBMK'], riskyTerms: [] },
        { id: 'graphite', label: 'Graphite', score: 2, provenance: 'sourceExplicit', terms: ['graphite'], riskyTerms: [] }
      ]
    },
    transformations: [
      { code: 'removeSourceNumber', description: 'Numéro retiré', requiresReview: false }
    ],
    issues: [],
    ...overrides
  };
}

function pkg(items, overrides = {}) {
  return {
    schema: 'cardinal.formative/2',
    protocolVersion: '2.0.0',
    packageMode: 'full',
    assessment: {
      title: 'Fixture',
      language: 'fr-CA',
      sourceMode: 'external-reference-only',
      declaredTotalPoints: { value: 2, provenance: 'provided' }
    },
    sources: [
      { id: 'questions', role: 'questionnaire', label: 'Questions', fileName: 'q.pdf', status: 'provided' },
      { id: 'texte', role: 'text', label: 'Texte', fileName: 't.pdf', status: 'provided' }
    ],
    items,
    issues: [],
    ...overrides
  };
}

{
  const result = V2.validatePackageV2(pkg([baseQuestion()]));
  assert.equal(result.state, 'ready');
  assert.equal(result.stats.total, 2);
}

{
  const q = baseQuestion({
    grading: {
      mode: 'auto',
      expectedAnswer: 'x',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['texte'] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [],
      concepts: [
        { id: 'a', label: 'A', score: 2, provenance: 'sourceExplicit', terms: ['graphite'], riskyTerms: [] },
        { id: 'b', label: 'B', score: 1, provenance: 'sourceExplicit', terms: ['graphité'], riskyTerms: [] }
      ]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'TERM_SCORE_CONFLICT'));
}

// A missing full-score Keyword is a transport concern, not a pedagogical veto.
// The adapter will add the complete expected answer as a technical anchor.
{
  const q = baseQuestion({
    grading: {
      mode: 'auto',
      expectedAnswer: 'Deux indices partiels.',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['texte'] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [],
      concepts: [
        { id: 'a', label: 'A', score: 1, provenance: 'sourceExplicit', terms: ['indice-a'], riskyTerms: [] },
        { id: 'b', label: 'B', score: 1, provenance: 'sourceExplicit', terms: ['indice-b'], riskyTerms: [] }
      ]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'review');
  assert(result.issues.some(x => x.code === 'KEYWORD_MAX_SCORE_MISMATCH' && x.severity === 'warning'));
}

{
  const q = baseQuestion({
    subtype: 'fillInTheBlank',
    prompt: 'Pays {{pays}} année {{annee}}',
    response: { blanks: [{ id: 'pays', answers: ['Ukraine'], conceptIds: [] }] },
    grading: {
      mode: 'auto',
      expectedAnswer: 'Ukraine 1986',
      provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [],
      concepts: []
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'PLACEHOLDER_MISMATCH'));
}

{
  const q = baseQuestion({
    grading: {
      mode: 'auto',
      expectedAnswer: 'x',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['texte'] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [{ type: 'distinctConcepts', count: 2, note: 'Deux éléments' }],
      concepts: [{ id: 'a', label: 'A', score: 1, provenance: 'sourceExplicit', terms: ['rbmk'], riskyTerms: [] }]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'review');
  assert(result.issues.some(x => x.code === 'ASSISTED_REQUIRED' && x.severity === 'warning'));
}

// A constructed answer cannot claim useful automatic or assisted keyword
// correction while providing no concepts for Formative to match.
{
  const q = baseQuestion({
    grading: {
      mode: 'assisted', expectedAnswer: 'Réponse complète',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['texte'] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'review');
  assert(result.issues.some(x => x.code === 'MISSING_KEYWORD_CONCEPTS' && x.severity === 'warning'));
}

{
  const q = baseQuestion();
  const patch = pkg([q], {
    packageMode: 'patch',
    assessment: { title: 'Fixture', language: 'fr-CA', sourceMode: 'external-reference-only' }
  });
  const result = V2.validatePackageV2(patch);
  assert.equal(result.state, 'ready');
}

{
  const q = baseQuestion({
    subtype: 'multipleChoice',
    grading: {
      mode: 'auto', expectedAnswer: 'B', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: false, caseSensitive: false, requirements: [], concepts: []
    },
    response: {
      options: [
        { id: 'a', text: '', correct: false },
        { id: 'b', text: 'B', correct: true }
      ]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'CHOICE_TEXT_EMPTY'));
}

{
  const q = baseQuestion({
    subtype: 'multipleSelection',
    grading: {
      mode: 'auto', expectedAnswer: 'A et C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: {
      options: [
        { id: 'a', text: 'A', correct: true },
        { id: 'b', text: 'B', correct: false },
        { id: 'c', text: 'C', correct: true }
      ]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'MULTISELECT_WEIGHTS_REQUIRED'));
}

{
  const q = baseQuestion({
    subtype: 'multipleSelection',
    grading: {
      mode: 'auto', expectedAnswer: 'A et C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: {
      options: [
        { id: 'a', text: 'A', correct: true, points: 1 },
        { id: 'b', text: 'B', correct: false },
        { id: 'c', text: 'C', correct: true, points: 1 }
      ]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'ready');
}

{
  const q = baseQuestion();
  const malformed = pkg([q], {
    assessment: {
      title: 'Fixture',
      language: 'fr-CA',
      sourceMode: 'external-reference-only',
      declaredTotalPoints: 2
    }
  });
  const result = V2.validatePackageV2(malformed);
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'DECLARED_TOTAL_INVALID'));
}

{
  const q = baseQuestion({
    grading: {
      ...baseQuestion().grading,
      provenance: { kind: 'answerKey', sourceRefs: ['texte'] }
    },
    transformations: [
      { type: 'splitQuestion', description: 'Découpage', requiresReview: false }
    ]
  });
  const malformed = pkg([q], {
    sources: [
      { id: 'questions', role: 'questionnaire', status: 'provided' },
      { id: 'texte', role: 'text', label: 'Texte', status: 'provided' }
    ]
  });
  const result = V2.validatePackageV2(malformed);
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'GRADING_PROVENANCE_INVALID'));
  assert(result.issues.some(x => x.code === 'TRANSFORMATION_INVALID'));
  assert(result.issues.some(x => x.code === 'BLOCKED_STRUCTURE' && x.sourceRef === 'questions'));
}

{
  const q = baseQuestion({
    subtype: 'inlineChoice',
    prompt: 'Classe {{mot}}.',
    grading: {
      mode: 'auto', expectedAnswer: 'nom', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: {
      dropdowns: [{
        id: 'mot',
        options: ['nom', 'nom'],
        correct: ['nom', 'nom']
      }]
    }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'PLACEHOLDER_MISMATCH'));
}

{
  const q = baseQuestion({
    subtype: 'resequence',
    grading: {
      mode: 'auto', expectedAnswer: 'A, B', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { sequence: ['A', 'A'] }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'BLOCKED_STRUCTURE' || x.code === 'UNSUPPORTED_SUBTYPE'));
}

{
  const q = baseQuestion({
    subtype: 'matching',
    grading: {
      mode: 'auto', expectedAnswer: 'x', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { pairs: [
      { left: 'Nom', right: 'chat' },
      { left: 'Nom', right: 'court' }
    ] }
  });
  const result = V2.validatePackageV2(pkg([q]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'BLOCKED_STRUCTURE'));
}

{
  const variants = V2.expandMechanicalVariants('grand-mère');
  assert(variants.includes('grand-mère'));
  assert(variants.includes('grand-mere'));
  assert(variants.includes('grand mère'));
}


{
  const grammarFixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'v2', 'valid-classes-mots-variables-30.json'),
    'utf8'
  ));
  const result = V2.validatePackageV2(grammarFixture, {
    capabilities: ['shortAnswer', 'longAnswer', 'fillInTheBlank', 'multipleChoice', 'multipleSelection', 'inlineChoice']
  });
  assert.equal(result.state, 'review');
  assert.equal(result.stats.total, 30);
  assert.equal(result.stats.questions, 8);
  assert.equal(result.stats.blockers, 0);
  assert(result.issues.filter(x => x.code === 'TRANSFORMATION_REVIEW_REQUIRED').length >= 2);
}

console.log('validator-v2: all tests passed');
