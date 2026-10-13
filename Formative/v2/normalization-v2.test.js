'use strict';
const assert = require('node:assert/strict');
const validator = require('./validator-v2.js');
const adapter = require('./adapter-v2.js');
const managed = require('./managed-state-v2.js');
const baseline = require('./baseline-store-v2.js');
const planner = require('./planner-v2.js');
const preflight = require('./preflight-v2.js');

function createQuestion(id, order, options = {}) {
  const subtype = options.subtype || 'longAnswer';
  return {
    id, order, kind: 'question',
    source: {
      sourceRef: 'questionnaire', page: null, printedPage: null,
      number: options.number || id, subNumber: null, promptExact: id + ' : question'
    },
    sourceRefs: ['texte', 'corrige'],
    prompt: id + ' : question',
    subtype, required: true,
    points: {
      value: options.value === undefined ? null : options.value,
      provenance: options.provenance || 'notSpecified',
      graded: true, bonus: false
    },
    grading: {
      mode: options.mode || 'assisted',
      expectedAnswer: 'Réponse attendue, à expliquer.',
      provenance: { kind: 'teacherApproved', sourceRefs: ['texte', 'corrige'] },
      partialCredit: true, caseSensitive: false,
      requirements: options.requirements || ['personnage', 'catégorie', 'trait', 'preuve'],
      concepts: options.concepts === undefined
        ? [
          { id: 'personnage', label: 'Personnage', score: null, provenance: 'teacherApproved', terms: [id + ' personnage'] },
          { id: 'trait', label: 'Trait', score: null, provenance: 'teacherApproved', terms: [id + ' trait'] },
          { id: 'preuve', label: 'Preuve', score: null, provenance: 'teacherApproved', terms: [id + ' preuve'] }
        ] : options.concepts
    },
    transformations: [], issues: []
  };
}
function packageFor(items, assessment = {}) {
  return {
    schema: 'cardinal.formative/2', protocolVersion: '2.0.0',
    packageMode: 'full',
    assessment: { title: 'Test Six Cygnes', language: 'fr-CA', sourceMode: 'external-reference-only', ...assessment },
    sources: [
      { id: 'questionnaire', role: 'questionnaire', label: 'Questionnaire', status: 'provided' },
      { id: 'texte', role: 'text', label: 'Conte', status: 'external' },
      { id: 'corrige', role: 'answerKey', label: 'Corrigé', status: 'provided' }
    ],
    items, issues: []
  };
}
{
  const original = [];
  for (let i = 1; i <= 8; i++) {
    original.push(createQuestion('A' + i, i, { number: 'Extrait ' + i }));
  }
  for (let i = 1; i <= 5; i++) {
    original.push(createQuestion('B' + i, i + 8, {
      value: 0, provenance: 'proposed', subtype: 'shortAnswer',
      requirements: ['bonne réponse'],
      concepts: [{ id: 'role', label: 'Rôle', score: 0, provenance: 'teacherApproved', terms: ['réponse ' + i] }]
    }));
  }
  for (let i = 6; i <= 8; i++) {
    original.push(createQuestion('B' + i, i + 8, { value: 0, provenance: 'proposed' }));
  }
  const source = packageFor(original);
  const { pkg, issues } = validator.normalizePackageV2(source);
  assert.equal(source.items[0].points.value, null, 'never mutate user-provided package');
  assert.equal(pkg.items.length, 16);
  assert(pkg.items.every(x => x.points.value > 0 && x.points.provenance === 'proposed'));
  assert(pkg.items.every(x => x.grading.concepts.every(c => Number.isFinite(c.score) && c.score > 0)));
  assert(issues.some(x => x.code === 'AUTO_POINTS_PROPOSED'));
  assert.notEqual(validator.validatePackageV2(pkg).state, 'blocked');

  const p = preflight.preflightPackageV2({
    pkg: source, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    targetTitle: 'Six Cygnes', serverItems: []
  }, { validator, adapter, managed, baseline, planner });
  assert(p.ok, 'a structurally repairable 16-question package must preflight successfully');
  assert.equal(p.data.planner.counts.CREATE, 16);
  assert.equal(p.state, 'review', 'proposed scoring is disclosed before publication');
  assert.equal(p.data.normalizedPkg.items.length, 16);
}
{
  const q = createQuestion('C1', 1, {
    value: 6, provenance: 'provided',
    concepts: [
      { id: 'a', label: 'Cause', score: 2, provenance: 'sourceExplicit', terms: ['même arme', 'balistique'] },
      { id: 'b', label: 'Limite', score: 1, provenance: 'sourceExplicit', terms: ['même arme', 'tireur non identifié'] },
      { id: 'c', label: 'Référence', score: null, provenance: 'sourceExplicit', terms: [] }
    ]
  });
  const result = validator.normalizePackageV2(packageFor([q]));
  const corrected = result.pkg.items[0];
  assert.equal(corrected.points.value, 6);
  assert.equal(corrected.points.provenance, 'provided');
  assert.equal(corrected.grading.concepts.length, 2);
  assert.equal(corrected.grading.concepts[1].terms.length, 1);
  assert(result.issues.some(x => x.code === 'AUTO_DUPLICATE_KEYWORD'));
  assert(result.issues.some(x => x.code === 'AUTO_EMPTY_CONCEPT'));
  assert(validator.validatePackageV2(result.pkg).ok);
}
{
  const q = createQuestion('D1', 1, { value: 3, provenance: 'provided', mode: 'manual' });
  const result = validator.normalizePackageV2(packageFor([q]));
  assert.equal(result.pkg.items[0].grading.mode, 'manual');
  assert.equal(result.pkg.items[0].grading.concepts.length, 0);
  assert(validator.validatePackageV2(result.pkg).ok);
}
{
  const q = createQuestion('E1', 1, {
    value: 0, provenance: 'provided', subtype: 'multipleChoice',
    concepts: [], requirements: []
  });
  const result = validator.normalizePackageV2(packageFor([q]));
  assert.equal(result.pkg.items[0].points.value, 0, 'deliberately provided zero remains zero');
}
{
  const q = createQuestion('F1', 1);
  const source = packageFor([q], { declaredTotalPoints: { value: 20, provenance: 'provided' } });
  const corrected = validator.normalizePackageV2(source);
  assert.equal(corrected.pkg.assessment.declaredTotalPoints.value, 20, 'never alter official totals');
  const result = validator.validatePackageV2(corrected.pkg);
  assert(result.issues.some(x => x.code === 'TOTAL_POINTS_MISMATCH'), 'real conflict must be visible');
}
{
  const q = createQuestion('G1', 1, { value: 0, provenance: 'notSpecified' });
  const once = validator.normalizePackageV2(packageFor([q])).pkg;
  const twice = validator.normalizePackageV2(once).pkg;
  assert.deepEqual(twice, once, 'auto-repair must be idempotent');
}
console.log('normalization-v2: all tests passed');