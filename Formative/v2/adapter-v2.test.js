const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./adapter-v2.js');

function sources() {
  return [
    { id: 'questions', role: 'questionnaire', label: 'Questionnaire', status: 'provided' },
    { id: 'text', role: 'text', label: 'Texte', status: 'provided' }
  ];
}

function baseQuestion(overrides = {}) {
  return {
    id: 'q16',
    kind: 'question',
    order: 2,
    source: {
      sourceRef: 'questions',
      page: 4,
      printedPage: '4',
      number: '16',
      subNumber: null,
      promptExact: '16) Nomme deux conséquences.'
    },
    sourceRefs: ['text'],
    prompt: 'Nomme deux conséquences.',
    subtype: 'longAnswer',
    required: true,
    points: { value: 4, provenance: 'provided', graded: true, bonus: false },
    grading: {
      mode: 'assisted',
      expectedAnswer: 'Deux conséquences sont expliquées.',
      provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
      partialCredit: true,
      caseSensitive: false,
      requirements: [{ type: 'distinctConcepts', count: 2 }],
      concepts: [
        { id: 'thyroid', label: 'Thyroïde', score: 3, provenance: 'sourceExplicit', terms: ['thyroïde', 'cancer thyroïde'], riskyTerms: [] },
        { id: 'stress', label: 'Stress', score: 2.5, provenance: 'sourceExplicit', terms: ['stress', 'anxiété'], riskyTerms: [] }
      ]
    },
    transformations: [{ code: 'removeSourceNumber', description: 'Numéro retiré', requiresReview: false }],
    issues: [],
    ...overrides
  };
}

function pkg(items, mode = 'full') {
  return {
    schema: 'cardinal.formative/2',
    protocolVersion: '2.0.0',
    packageMode: mode,
    assessment: {
      title: 'Tchernobyl',
      language: 'fr-CA',
      sourceMode: 'external-reference-only',
      declaredTotalPoints: { value: 4, provenance: 'provided' }
    },
    sources: sources(),
    items,
    issues: []
  };
}

// Target identity is stable and isolated per Formative.
assert.equal(A.targetAssessmentId('FORMATIVE-123'), A.targetAssessmentId('FORMATIVE-123'));
assert.notEqual(A.targetAssessmentId('FORMATIVE-123'), A.targetAssessmentId('FORMATIVE-456'));

// Prompt wording may evolve without changing identity if page/number stay stable.
{
  const p = pkg([baseQuestion()]);
  const edited = baseQuestion({
    prompt: 'Nomme deux conséquences. Appuie-les sur le texte.',
    source: { ...baseQuestion().source, promptExact: '16) Nomme deux conséquences. Appuie-les sur le texte.' }
  });
  assert.equal(A.itemFingerprint(p, baseQuestion()), A.itemFingerprint(p, edited));
}

// A renamed/relabelled single questionnaire source keeps the same fingerprint.
{
  const p1 = pkg([baseQuestion()]);
  const p2 = pkg([baseQuestion()]);
  p2.sources[0] = { ...p2.sources[0], id: 'questionnaire-x', label: 'Autre nom', fileName: 'nouveau.pdf' };
  p2.items[0].source.sourceRef = 'questionnaire-x';
  assert.equal(A.itemFingerprint(p1, p1.items[0]), A.itemFingerprint(p2, p2.items[0]));
}

// Assisted Free Response becomes keyword grading and keeps accent variants.
{
  const result = A.adaptPackageV2ToV1(pkg([
    { id: 'section', kind: 'section', order: 1, content: 'SANTÉ', issues: [] },
    baseQuestion()
  ]), { targetFormativeId: 'FORMATIVE-123' });

  assert.equal(result.state, 'ready');
  assert.equal(result.packageV1.schema, 'cardinal.formative/1');
  assert.equal(result.packageV1.items[0].kind, 'text');
  const q = result.packageV1.items[1];
  assert.equal(q.subtype, 'longAnswer');
  assert(q.grading.matches.some(x => x.text === 'thyroïde' && x.score === 3));
  assert(q.grading.matches.some(x => x.text === 'thyroide' && x.score === 3));
}

// Manual mode never invents active grading matches.
{
  const manual = baseQuestion({
    grading: {
      mode: 'manual', expectedAnswer: 'Réponse ouverte.',
      provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: false, caseSensitive: false, requirements: [],
      concepts: [{ id: 'x', label: 'X', score: 4, provenance: 'questionIntrinsic', terms: ['mot'], riskyTerms: [] }]
    }
  });
  const result = A.adaptPackageV2ToV1(pkg([manual]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.equal(result.packageV1.items[0].grading.mode, 'manual');
  assert.deepEqual(result.packageV1.items[0].grading.matches, []);
}

// FITB placeholders become v1 segments and gain safe mechanical variants.
{
  const fitb = baseQuestion({
    id: 'q1', order: 1,
    source: { sourceRef: 'questions', page: 1, printedPage: '1', number: '1', subNumber: null, promptExact: '1) Pays actuel: ____.' },
    prompt: 'Pays actuel: {{pays}}.',
    subtype: 'fillInTheBlank',
    points: { value: 2, provenance: 'provided', graded: true, bonus: false },
    grading: {
      mode: 'auto', expectedAnswer: 'Québec', provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { blanks: [{ id: 'pays', answers: ['Québec'], conceptIds: [] }] }
  });
  const result = A.adaptPackageV2ToV1(pkg([fitb]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  const answers = result.packageV1.items[0].segments[1].blank.answers;
  assert(answers.includes('Québec'));
  assert(answers.includes('Quebec'));
}

// Native choice questions keep their closed response structure.
{
  const mc = baseQuestion({
    subtype: 'multipleChoice',
    grading: {
      mode: 'auto', expectedAnswer: 'B', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: false, caseSensitive: false, requirements: [], concepts: []
    },
    response: { options: [
      { id: 'a', text: 'A', correct: false },
      { id: 'b', text: 'B', correct: true }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([mc]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.packageV1.items[0].choices, [
    { text: 'A', correct: false },
    { text: 'B', correct: true }
  ]);
}

{
  const ms = baseQuestion({
    subtype: 'multipleSelection',
    grading: {
      mode: 'auto', expectedAnswer: 'A et C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { options: [
      { id: 'a', text: 'A', correct: true, points: 2 },
      { id: 'b', text: 'B', correct: false },
      { id: 'c', text: 'C', correct: true, points: 2 }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([ms]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.equal(result.packageV1.items[0].choices[0].points, 2);
  assert.equal(result.packageV1.items[0].grading.partialCredit, true);
}

{
  const inline = baseQuestion({
    subtype: 'inlineChoice',
    prompt: 'Ces {{a}} élèves {{b}}.',
    grading: {
      mode: 'auto', expectedAnswer: 'déterminant, verbe', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { dropdowns: [
      { id: 'a', options: ['déterminant', 'pronom'], correct: ['déterminant'] },
      { id: 'b', options: ['nom', 'verbe'], correct: ['verbe'] }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([inline]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  const blanks = result.packageV1.items[0].segments.filter(x => x.blank).map(x => x.blank);
  assert.deepEqual(blanks, [
    { choices: ['déterminant', 'pronom'], correct: 'déterminant' },
    { choices: ['nom', 'verbe'], correct: 'verbe' }
  ]);
}

// Multiple Selection never invents partial-credit weights.
{
  const ms = baseQuestion({
    subtype: 'multipleSelection',
    points: { value: 4, provenance: 'provided', graded: true, bonus: false },
    grading: {
      mode: 'auto', expectedAnswer: 'A et C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false },
      { id: 'c', text: 'C', correct: true }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([ms]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'ADAPTER_MULTISELECT_WEIGHTS_REQUIRED'));
}

{
  const ms = baseQuestion({
    subtype: 'multipleSelection',
    points: { value: 4, provenance: 'provided', graded: true, bonus: false },
    grading: {
      mode: 'auto', expectedAnswer: 'A et C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: false, caseSensitive: false, requirements: [], concepts: []
    },
    response: { options: [
      { id: 'a', text: 'A', correct: true },
      { id: 'b', text: 'B', correct: false },
      { id: 'c', text: 'C', correct: true }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([ms]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.equal(result.packageV1.items[0].grading.partialCredit, false);
  assert(result.packageV1.items[0].choices.every(x => x.points === undefined));
}

// Resequence preserves the pedagogical order as a native ordered choice list.
{
  const q = baseQuestion({
    subtype: 'resequence',
    grading: {
      mode: 'auto', expectedAnswer: 'A, B, C', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { sequence: ['A', 'B', 'C'] }
  });
  const result = A.adaptPackageV2ToV1(pkg([q]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.packageV1.items[0].choices, ['A', 'B', 'C']);
}

// Matching preserves explicit left/right pairs and rejects no hidden rewrite.
{
  const q = baseQuestion({
    subtype: 'matching',
    grading: {
      mode: 'auto', expectedAnswer: 'Nom-chat; Verbe-court', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    },
    response: { pairs: [
      { left: 'Nom', right: 'chat' },
      { left: 'Verbe', right: 'court' }
    ] }
  });
  const result = A.adaptPackageV2ToV1(pkg([q]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.packageV1.items[0].pairs, [
    { left: 'Nom', right: 'chat' },
    { left: 'Verbe', right: 'court' }
  ]);
}

// No concrete target: never invent a lineage.
{
  const result = A.adaptPackageV2ToV1(pkg([baseQuestion()]));
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'ADAPTER_TARGET_REQUIRED'));
}

// Same canonical term cannot silently carry two scores.
{
  const conflict = baseQuestion({
    grading: {
      mode: 'assisted', expectedAnswer: 'x', provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
      partialCredit: true, caseSensitive: false, requirements: [],
      concepts: [
        { id: 'a', label: 'A', score: 4, provenance: 'sourceExplicit', terms: ['thyroïde'], riskyTerms: [] },
        { id: 'b', label: 'B', score: 2, provenance: 'sourceExplicit', terms: ['thyroide'], riskyTerms: [] }
      ]
    }
  });
  const result = A.adaptPackageV2ToV1(pkg([conflict]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'ADAPTER_TERM_SCORE_CONFLICT'));
}

// required:false survives conversion.
{
  const result = A.adaptPackageV2ToV1(pkg([baseQuestion({ required: false })]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  assert.equal(result.packageV1.items[0].isRequired, false);
}

// Auto/assisted with no active concepts must not silently become manual.
{
  const empty = baseQuestion({
    grading: {
      mode: 'auto', expectedAnswer: 'x', provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
      partialCredit: true, caseSensitive: false, requirements: [], concepts: []
    }
  });
  const result = A.adaptPackageV2ToV1(pkg([empty]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'blocked');
  assert(result.issues.some(x => x.code === 'ADAPTER_EMPTY_GRADING'));
}

// Bonus and ungraded semantics remain blocked until their 0.4.1 mapping is proven.
{
  const b = A.adaptPackageV2ToV1(pkg([baseQuestion({ points: { value: 4, provenance: 'provided', graded: true, bonus: true } })]), { targetFormativeId: 'FORMATIVE-123' });
  assert(b.issues.some(x => x.code === 'ADAPTER_BONUS_NOT_PROVEN'));

  const u = A.adaptPackageV2ToV1(pkg([baseQuestion({ points: { value: 0, provenance: 'provided', graded: false, bonus: false } })]), { targetFormativeId: 'FORMATIVE-123' });
  assert(u.issues.some(x => x.code === 'ADAPTER_UNGRADED_NOT_PROVEN'));
}

// Manual FITB is unsafe because the v1 shape necessarily carries accepted answers.
{
  const fitb = baseQuestion({
    subtype: 'fillInTheBlank', prompt: 'Mot: {{x}}', response: { blanks: [{ id: 'x', answers: ['réponse'] }] },
    grading: {
      mode: 'manual', expectedAnswer: 'réponse', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: false, caseSensitive: false, requirements: [], concepts: []
    }
  });
  const result = A.adaptPackageV2ToV1(pkg([fitb]), { targetFormativeId: 'FORMATIVE-123' });
  assert(result.issues.some(x => x.code === 'ADAPTER_MANUAL_FITB_NOT_PROVEN'));
}

// Case-sensitive output preserves case-distinct terms.
{
  const q = baseQuestion({
    grading: {
      mode: 'auto', expectedAnswer: 'ABC', provenance: { kind: 'questionIntrinsic', sourceRefs: [] },
      partialCredit: true, caseSensitive: true, requirements: [],
      concepts: [{ id: 'x', label: 'X', score: 4, provenance: 'questionIntrinsic', terms: ['ABC', 'abc'], riskyTerms: [] }]
    }
  });
  const result = A.adaptPackageV2ToV1(pkg([q]), { targetFormativeId: 'FORMATIVE-123' });
  assert.equal(result.state, 'ready');
  const terms = result.packageV1.items[0].grading.matches.map(x => x.text);
  assert(terms.includes('ABC'));
  assert(terms.includes('abc'));
}


{
  const grammarFixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'v2', 'valid-classes-mots-variables-30.json'),
    'utf8'
  ));
  const result = A.adaptPackageV2ToV1(grammarFixture, { targetFormativeId: 'FORMATIVE-GRAMMAR-30' });
  assert.equal(result.state, 'ready');
  const questions = result.packageV1.items.filter(item => item.kind === 'question');
  assert.equal(questions.length, 8);
  assert.equal(questions.reduce((sum, item) => sum + item.points, 0), 30);
  assert.deepEqual(
    questions.map(item => item.subtype),
    ['inlineChoice', 'longAnswer', 'longAnswer', 'longAnswer', 'longAnswer', 'inlineChoice', 'longAnswer', 'longAnswer']
  );
  assert.equal(questions[0].segments.filter(part => part.blank).length, 8);
  assert.deepEqual(questions[0].segments.filter(part => part.blank)[0].blank, {
    choices: ['nom', 'déterminant', 'adjectif', 'pronom', 'verbe'],
    correct: 'déterminant'
  });
  assert.equal(questions[5].segments.filter(part => part.blank).length, 4);
  assert.deepEqual(questions[5].segments.filter(part => part.blank)[2].blank, {
    choices: ['donneur', 'receveur'],
    correct: 'donneur'
  });
}

console.log('adapter-v2: all tests passed');