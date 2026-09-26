const assert = require('assert');
const validator = require('./validator-v2.js');
const adapter = require('./adapter-v2.js');
const managed = require('./managed-state-v2.js');
const planner = require('./planner-v2.js');
const baseline = require('./baseline-store-v2.js');
const preflight = require('./preflight-v2.js');

const deps = { validator, adapter, managed, planner, baseline };

function tiptapText(text) {
  return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
  ] });
}

function v2(prompt = 'Quel type de réacteur est impliqué?', mode = 'patch') {
  return {
    schema: 'cardinal.formative/2', protocolVersion: '2.0.0', packageMode: mode,
    assessment: { title: 'Tchernobyl', language: 'fr-CA', sourceMode: 'external-reference-only' },
    sources: [
      { id: 'questions', role: 'questionnaire', label: 'Questions', status: 'provided' },
      { id: 'text', role: 'text', label: 'Texte', status: 'provided' }
    ],
    items: [{
      id: 'q3', kind: 'question', order: 1,
      source: { sourceRef: 'questions', page: 1, printedPage: '1', number: '3', subNumber: null, promptExact: `3) ${prompt}` },
      sourceRefs: ['text'], prompt, subtype: 'shortAnswer', required: true,
      points: { value: 2, provenance: 'provided', graded: true, bonus: false },
      grading: {
        mode: 'auto', expectedAnswer: 'RBMK graphite',
        provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
        partialCredit: true, caseSensitive: false, requirements: [],
        concepts: [
          { id: 'rbmk', label: 'RBMK', score: 2, provenance: 'sourceExplicit', terms: ['RBMK'], riskyTerms: [] },
          { id: 'graphite', label: 'Graphite', score: 2, provenance: 'sourceExplicit', terms: ['graphite'], riskyTerms: [] }
        ]
      },
      transformations: [{ code: 'removeSourceNumber', description: 'Numéro retiré', requiresReview: false }],
      issues: []
    }],
    issues: []
  };
}

function serverItem(prompt, formativeItemId = 'I3') {
  return {
    _id: formativeItemId,
    subtype: 'shortAnswer',
    text: tiptapText(prompt),
    details: {
      points: 2, isRequired: true,
      correctAnswers: ['rbmk', 'graphite'], answerChoicePoints: [2, 2],
      isKeywordGrading: true, isPartialCredit: true, isCaseSensitive: false
    }
  };
}

function baselineFor(pkg, target = 'F1', serverPrompt = pkg.items[0].prompt) {
  const adapted = adapter.adaptPackageV2ToV1(pkg, { targetFormativeId: target });
  const desired = managed.managedFromDesiredV1(adapted.packageV1.items[0]).managedState;
  return baseline.createBaseline({
    targetFormativeId: target,
    assessmentFingerprint: 'A1',
    entries: [{
      fingerprint: adapted.identity[0].fingerprint,
      sourceItemId: pkg.items[0].id,
      formativeItemId: 'I3',
      subtype: 'shortAnswer',
      managedState: desired
    }]
  });
}

// Blank target + no baseline is a safe CREATE dry-run.
{
  const r = preflight.preflightPackageV2({
    pkg: v2(), targetFormativeId: 'F1', targetTitle: 'Tchernobyl',
    assessmentFingerprint: 'A1', baselineRecord: null, serverItems: []
  }, deps);
  assert.equal(r.state, 'ready');
  assert.equal(r.data.planner.counts.CREATE, 1);
  assert.equal(r.data.ui.status, '✓ Prêt');
}

// Regression for the 2026-09-25 failure: a valid ten-question package
// targeting an empty Formative must reach the planner. One warning may put the
// package in review, but Cardinal must never collapse it to a global blocker
// before a single question is attempted.
{
  const seed = v2('Question 1?', 'full');
  const items = Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    const mode = n % 3 === 0 ? 'manual' : n % 3 === 1 ? 'auto' : 'assisted';
    const grading = mode === 'manual'
      ? {
          mode,
          expectedAnswer: `Réponse attendue ${n}`,
          provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
          partialCredit: false,
          caseSensitive: false,
          requirements: [],
          concepts: []
        }
      : {
          mode,
          expectedAnswer: `Réponse attendue ${n}`,
          provenance: { kind: 'sourceExplicit', sourceRefs: ['text'] },
          partialCredit: true,
          caseSensitive: false,
          requirements: mode === 'assisted' ? [{ type: 'mustAddress', text: 'Répondre complètement' }] : [],
          concepts: [{
            id: `concept-${n}`,
            label: `Concept ${n}`,
            score: 2,
            provenance: 'sourceExplicit',
            terms: [`mot-${n}`],
            riskyTerms: []
          }]
        };
    return {
      ...seed.items[0],
      id: `q${n}`,
      order: n,
      source: {
        ...seed.items[0].source,
        number: String(n),
        promptExact: `${n}) Question ${n}?`
      },
      prompt: `Question ${n}?`,
      grading
    };
  });
  const pkg10 = { ...seed, items };
  const r = preflight.preflightPackageV2({
    pkg: pkg10,
    targetFormativeId: 'F1',
    targetTitle: 'Questionnaire 10',
    assessmentFingerprint: 'A10',
    baselineRecord: null,
    serverItems: []
  }, deps);
  assert.equal(r.ok, true);
  assert.notEqual(r.state, 'blocked');
  assert.equal(r.data.validation.stats.questions, 10);
  assert.equal(r.data.planner.counts.CREATE, 10);
  assert.equal(r.data.ui.questions, 10);
  assert.equal(r.data.ui.blockers, 0);
}

// Non-empty target without baseline blocks initial blind creation.
{
  const r = preflight.preflightPackageV2({
    pkg: v2(), targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    baselineRecord: null, serverItems: [serverItem('Une question manuelle', 'FOREIGN')]
  }, deps);
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'INITIAL_NONEMPTY_TARGET_REQUIRES_RECONCILIATION'));
}

// Baseline + identical server/desired => UNCHANGED.
{
  const pkg = v2();
  const b = baselineFor(pkg);
  const r = preflight.preflightPackageV2({
    pkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    baselineRecord: b, serverItems: [serverItem(pkg.items[0].prompt)]
  }, deps);
  assert.equal(r.state, 'ready');
  assert.equal(r.data.planner.counts.UNCHANGED, 1);
}

// Desired changed while server remains baseline => UPDATE.
{
  const oldPkg = v2('Quel type de réacteur est impliqué?');
  const b = baselineFor(oldPkg);
  const newPkg = v2('Quel type de réacteur est impliqué? Donne aussi le modérateur.');
  // source location remains number 3, therefore same fingerprint.
  const r = preflight.preflightPackageV2({
    pkg: newPkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    baselineRecord: b, serverItems: [serverItem(oldPkg.items[0].prompt)]
  }, deps);
  assert.equal(r.state, 'ready');
  assert.equal(r.data.planner.counts.UPDATE, 1);
}

// Teacher edit only => preserved and review, not overwritten.
{
  const pkg = v2();
  const b = baselineFor(pkg);
  const r = preflight.preflightPackageV2({
    pkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    baselineRecord: b, serverItems: [serverItem('QUESTION MODIFIÉE MANUELLEMENT')]
  }, deps);
  assert.equal(r.state, 'review');
  assert.equal(r.data.planner.counts.PRESERVE_EXTERNAL, 1);
}

// Teacher edit + package edit => true conflict and block.
{
  const oldPkg = v2('Question originale?');
  const b = baselineFor(oldPkg);
  const newPkg = v2('Question nouvelle?');
  const r = preflight.preflightPackageV2({
    pkg: newPkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1',
    baselineRecord: b, serverItems: [serverItem('Question modifiée par le prof?')]
  }, deps);
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'SERVER_THREE_WAY_CONFLICT'));
}

// Foreign unsupported item does not block a known Cardinal item, but is preserved/warned.
{
  const pkg = v2();
  const b = baselineFor(pkg);
  const r = preflight.preflightPackageV2({
    pkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1', baselineRecord: b,
    serverItems: [
      serverItem(pkg.items[0].prompt),
      { _id: 'FOREIGN', subtype: 'matching', text: '', details: {} }
    ]
  }, deps);
  assert.notEqual(r.state, 'blocked');
  assert.equal(r.data.planner.foreignServerItemCount, 1);
  assert(r.issues.some(x => String(x.code).startsWith('FOREIGN_')));
}

// Baseline bound to another target is blocked.
{
  const pkg = v2();
  const b = baselineFor(pkg, 'OTHER');
  const r = preflight.preflightPackageV2({
    pkg, targetFormativeId: 'F1', assessmentFingerprint: 'A1', baselineRecord: b,
    serverItems: []
  }, deps);
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'BASELINE_INVALID'));
}

console.log('preflight-v2: all tests passed');