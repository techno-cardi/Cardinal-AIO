const assert = require('assert');
const pkg = require('../fixtures/v2/valid-patch-q16.json');
const validator = require('./validator-v2.js');
const adapter = require('./adapter-v2.js');
const managed = require('./managed-state-v2.js');
const baseline = require('./baseline-store-v2.js');
const Bootstrap = require('./bootstrap-reconciliation-v2.js');

const deps = { validator, adapter, managed, baseline };
const assessmentFingerprint = 'assessment:F1';
const packageFingerprint = 'package:q16:v1';

function desiredV1() {
  const a = adapter.adaptPackageV2ToV1(pkg, { targetFormativeId: 'F1' });
  assert.equal(a.ok, true);
  return a.packageV1.items.find(x => x.kind === 'question');
}

function serverFromV1(id = 'I16', mutate = null) {
  const item = desiredV1();
  const raw = {
    _id: id,
    subtype: item.subtype,
    text: item.prompt,
    details: {
      points: item.points,
      isRequired: item.isRequired !== false,
      isPartialCredit: item.grading?.partialCredit === true,
      isKeywordGrading: item.grading?.mode === 'keyword-absolute',
      isCaseSensitive: item.grading?.caseSensitive === true,
      correctAnswers: (item.grading?.matches || []).map(x => x.text),
      answerChoicePoints: (item.grading?.matches || []).map(x => x.score),
      showWordCount: item.settings?.showWordCount !== false
    }
  };
  if (mutate) mutate(raw);
  return raw;
}

function analyze(serverItems, legacyHints = []) {
  return Bootstrap.analyze({
    pkg,
    targetFormativeId: 'F1',
    assessmentFingerprint,
    packageFingerprint,
    serverItems,
    legacyHints
  }, deps);
}

function approval(proposal) {
  return { fingerprint: proposal.fingerprint, approvalToken: proposal.approvalToken };
}

(() => {
  // A legacy mapping is not trusted by itself, but exact current server state
  // turns it into a high-confidence explicit adoption proposal.
  {
    const result = analyze([serverFromV1()], [{ logicalId: 'q16', formativeItemId: 'I16' }]);
    assert.equal(result.ok, true);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].match, 'legacy-exact');
    assert.equal(result.proposals[0].confidence, 'high');
    assert.equal(result.proposals[0].requiresExplicitApproval, true);
    assert.equal(result.proposals[0].safeToAdoptDesiredAsBaseline, true);
    assert(result.proposals[0].approvalToken.startsWith('cfi-bootstrap-approval-'));
  }

  // No legacy map: an exact semantic match may be proposed but never silently adopted.
  {
    const result = analyze([serverFromV1()]);
    assert.equal(result.ok, true);
    assert.equal(result.proposals[0].match, 'exact-state');
    assert.equal(result.proposals[0].confidence, 'review');
    assert.equal(result.proposals[0].requiresExplicitApproval, true);
  }

  // A mapped question changed manually: preserve the current server state and
  // require conflict resolution rather than claiming it already equals desired.
  {
    const result = analyze(
      [serverFromV1('I16', raw => { raw.details.points = 3; })],
      [{ logicalId: 'q16', formativeItemId: 'I16' }]
    );
    assert.equal(result.ok, true);
    assert.equal(result.proposals[0].match, 'legacy-changed');
    assert.equal(result.proposals[0].safeToAdoptDesiredAsBaseline, false);
    assert.equal(result.proposals[0].safeToAdoptServerAsBaseline, true);
  }

  // Without a historical mapping, one unique question with the same subtype
  // and prompt can be explicitly linked to its current server state. A later
  // dry-run will then generate UPDATE instead of duplicating it.
  {
    const result = analyze([
      serverFromV1('I16', raw => {
        raw.details.points = 3;
        raw.details.correctAnswers = ['ancienne réponse'];
        raw.details.answerChoicePoints = [3];
      })
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0].match, 'prompt-changed');
    assert.equal(result.proposals[0].safeToAdoptDesiredAsBaseline, false);
    assert.equal(result.proposals[0].safeToAdoptServerAsBaseline, true);
  }

  // Two identical server questions are ambiguous; Cardinal refuses to pick one.
  {
    const result = analyze([serverFromV1('I16A'), serverFromV1('I16B')]);
    assert.equal(result.ok, false);
    assert(result.issues.some(x => x.code === 'BOOTSTRAP_EXACT_MATCH_AMBIGUOUS'));
  }

  // Approved exact proposal becomes a real v2 baseline with the current server
  // managedState, not an unverified old local map.
  {
    const analysis = analyze([serverFromV1()], [{ logicalId: 'q16', formativeItemId: 'I16' }]);
    const record = Bootstrap.buildBaseline({
      analysis,
      targetFormativeId: 'F1',
      assessmentFingerprint,
      approvedProposals: [approval(analysis.proposals[0])],
      packageMode: 'patch',
      assessmentTitle: pkg.assessment.title,
      importerVersion: '0.5-test'
    }, deps);
    assert.equal(record.entries.length, 1);
    assert.equal(record.entries[0].formativeItemId, 'I16');
    assert.equal(record.entries[0].managedState.points, 4);
  }

  // Fingerprint alone is no longer sufficient approval. This prevents a stale
  // click from being applied after the server state changed in another tab.
  {
    const analysis = analyze([serverFromV1()], [{ logicalId: 'q16', formativeItemId: 'I16' }]);
    assert.throws(
      () => Bootstrap.buildBaseline({
        analysis,
        targetFormativeId: 'F1',
        assessmentFingerprint,
        approvedProposals: [{ fingerprint: analysis.proposals[0].fingerprint }]
      }, deps),
      e => e.code === 'BOOTSTRAP_APPROVAL_REQUIRED'
    );
  }

  // A token from an older observation becomes stale if the server state changes.
  {
    const oldAnalysis = analyze([serverFromV1()], [{ logicalId: 'q16', formativeItemId: 'I16' }]);
    const oldApproval = approval(oldAnalysis.proposals[0]);
    const freshAnalysis = analyze(
      [serverFromV1('I16', raw => { raw.details.points = 3; })],
      [{ logicalId: 'q16', formativeItemId: 'I16' }]
    );
    assert.throws(
      () => Bootstrap.buildBaseline({
        analysis: freshAnalysis,
        targetFormativeId: 'F1',
        assessmentFingerprint,
        approvedProposals: [oldApproval]
      }, deps),
      e => e.code === 'BOOTSTRAP_APPROVAL_STALE'
    );
  }

  // A changed linked item is adopted at its CURRENT server state, not at
  // desired state. This makes the next dry-run a genuine UPDATE.
  {
    const analysis = analyze(
      [serverFromV1('I16', raw => { raw.details.points = 3; })],
      [{ logicalId: 'q16', formativeItemId: 'I16' }]
    );
    const record = Bootstrap.buildBaseline({
      analysis,
      targetFormativeId: 'F1',
      assessmentFingerprint,
      approvedProposals: [approval(analysis.proposals[0])]
    }, deps);
    assert.equal(record.entries.length, 1);
    assert.equal(record.entries[0].formativeItemId, 'I16');
    assert.equal(record.entries[0].managedState.points, 3);
    assert.notEqual(record.entries[0].managedState.points, 4);
  }

  console.log('bootstrap-reconciliation-v2: all tests passed');
})();