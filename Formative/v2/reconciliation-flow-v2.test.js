const assert = require('assert');
const validator = require('./validator-v2.js');
const adapter = require('./adapter-v2.js');
const managed = require('./managed-state-v2.js');
const planner = require('./planner-v2.js');
const baseline = require('./baseline-store-v2.js');
const journal = require('./journal-v2.js');
const preflight = require('./preflight-v2.js');
const contract = require('./execution-contract-v2.js');
const gateApi = require('./run-gate-v2.js');
const executor = require('./executor-v2.js');
const persistenceApi = require('./persistence-v2.js');
const bootstrap = require('./bootstrap-reconciliation-v2.js');
const orchestratorApi = require('./orchestrator-v2.js');
const identity = require('./identity-v2.js');
const presentation = require('./presentation-v2.js');
const runtimeApi = require('./runtime-v2.js');
const targetGuard = require('./target-guard-v2.js');
const reconciliation = require('./reconciliation-v2.js');

const preflightInjected = { validator, adapter, managed, planner, baseline };
const bootstrapInjected = { validator, adapter, managed, baseline };

function pkg(prompt = 'Quel type de réacteur est impliqué?') {
  return {
    schema: 'cardinal.formative/2', protocolVersion: '2.0.0', packageMode: 'patch',
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

function tiptapText(text) {
  return JSON.stringify({
    type: 'doc', attrs: { dir: 'auto' }, content: [
      { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
    ]
  });
}

function serverItem(prompt = 'Quel type de réacteur est impliqué?', id = 'I3', mutate = null) {
  const raw = {
    _id: id,
    subtype: 'shortAnswer',
    text: tiptapText(prompt),
    details: {
      points: 2,
      isRequired: true,
      correctAnswers: ['rbmk', 'graphite'],
      answerChoicePoints: [2, 2],
      isKeywordGrading: true,
      isPartialCredit: true,
      isCaseSensitive: false
    }
  };
  if (mutate) mutate(raw);
  return raw;
}

function makePersistence() {
  return persistenceApi.createPersistence({ adapter: persistenceApi.createMemoryAdapter(), baseline });
}

function makeOrchestrator(persistence) {
  return orchestratorApi.createOrchestrator({
    preflight,
    executor,
    contract,
    journal,
    baseline,
    bootstrap,
    persistence,
    executorInjected: { journal, contract, gate: gateApi.createGate() },
    runIdFactory: () => 'reconciliation-flow-run'
  });
}

function makeGateway(initialItems) {
  let items = initialItems;
  const log = [];
  return {
    log,
    setItems(next) { items = next; },
    async observeTarget() {
      log.push('observe');
      return {
        targetFormativeId: 'F', urlTargetFormativeId: 'F', serverTargetFormativeId: 'F',
        tabId: 10, title: 'Tchernobyl', canEdit: true, authState: 'authenticated',
        pageKind: 'editor', observedAt: Date.now(), explicitTabBinding: true, candidateTargetIds: ['F']
      };
    },
    async listItems() {
      log.push('list');
      return {
        items,
        snapshotComplete: true,
        managedDetailComplete: true,
        detailLevel: 'managed-v2',
        detailIssues: [],
        serverRevision: `r${log.length}`
      };
    }
  };
}

const fakeTransportBridge = {
  createTransport() {
    return {
      assertOperationPrecondition() {}, applyMutation() {}, readServerForVerification() {}, verifyOperation() {}, reconcileOperation() {}
    };
  }
};

function makeRuntime(gateway, orchestrator) {
  return runtimeApi.createRuntime({
    gateway,
    orchestrator,
    targetGuard,
    identity,
    presentation,
    transportBridge: fakeTransportBridge,
    managed,
    reconciliation
  });
}

function prepareArgs(sourcePkg, extra = {}) {
  return {
    pkg: sourcePkg,
    preflightInjected,
    bootstrapInjected,
    ...extra
  };
}

(async () => {
  // Existing exact question + no v2 baseline -> friendly reconciliation, then
  // one click links it and a fresh dry-run proves UNCHANGED instead of CREATE.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem()]);
    const R = makeRuntime(G, O);

    const first = await R.prepare(prepareArgs(pkg()));
    assert.equal(first.state, 'reconciliation_required');
    assert.equal(first.mode, 'bootstrap');
    assert.equal(first.view.statusLabel, '⚠ Questions existantes à relier');
    assert.equal(first.view.primaryAction.label, 'Relier et continuer');
    assert.equal(first.view.suggestedLinks.length, 1);

    const next = await R.confirmReconciliation(first, {
      useSuggestedLinks: true,
      importerVersion: '0.5-test',
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(next.ok, true);
    assert.equal(next.mode, 'new');
    assert.equal(next.preflight.data.planner.counts.UNCHANGED, 1);
    assert.equal(next.preflight.data.planner.counts.CREATE, 0);
    const stored = await persistence.loadBaseline('F', identity.associationFingerprintForTarget('F'));
    assert.equal(stored.entries.length, 1);
    assert.equal(stored.entries[0].formativeItemId, 'I3');
  }

  // State changes after the teacher saw the reconciliation screen -> old click
  // is rejected and no baseline is persisted.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem()]);
    const R = makeRuntime(G, O);
    const first = await R.prepare(prepareArgs(pkg()));
    G.setItems([serverItem('Quel type de réacteur est impliqué?', 'I3', raw => { raw.details.points = 3; })]);

    const result = await R.confirmReconciliation(first, {
      useSuggestedLinks: true,
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'reconciliation_changed');
    assert.equal(await persistence.loadBaseline('F', identity.associationFingerprintForTarget('F')), null);
  }

  // Non-empty target with no exact match: explicit confirmation preserves the
  // existing item as foreign and prepares only the new CREATE.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem('Une autre question', 'FOREIGN')]);
    const R = makeRuntime(G, O);

    const first = await R.prepare(prepareArgs(pkg()));
    assert.equal(first.state, 'reconciliation_required');
    assert.equal(first.view.reconciliationProposals, 0);
    assert.equal(first.view.primaryAction.label, 'Conserver l’existant et continuer');

    const next = await R.confirmReconciliation(first, {
      useSuggestedLinks: true,
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(next.ok, true);
    assert.equal(next.preflight.data.planner.counts.CREATE, 1);
    assert.equal(next.preflight.data.planner.foreignServerItemCount, 1);
    const stored = await persistence.loadBaseline('F', identity.associationFingerprintForTarget('F'));
    assert.equal(stored.entries.length, 0);
  }

  // Two identical server candidates are ambiguous. There is no one-click path
  // that could arbitrarily adopt one of them.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem(undefined, 'I3A'), serverItem(undefined, 'I3B')]);
    const R = makeRuntime(G, O);
    const prepared = await R.prepare(prepareArgs(pkg()));
    assert.equal(prepared.ok, false);
    assert.equal(prepared.reason, 'RECONCILIATION_BLOCKED');
    assert(prepared.issues.some(issue => issue.code === 'BOOTSTRAP_EXACT_MATCH_AMBIGUOUS'));
  }

  // A legacy-mapped item that changed can be explicitly linked to its CURRENT
  // server state. Linking itself performs no mutation; the fresh dry-run that
  // follows must surface one UPDATE toward the desired package.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem(undefined, 'I3', raw => { raw.details.points = 3; })]);
    const R = makeRuntime(G, O);
    const prepared = await R.prepare(prepareArgs(pkg(), {
      legacyHints: [{ logicalId: 'q3', formativeItemId: 'I3' }]
    }));
    assert.equal(prepared.state, 'reconciliation_required');
    assert.equal(prepared.view.reconciliationConflicts, 0);
    assert.equal(prepared.view.reconciliationUpdates, 1);
    assert.equal(prepared.view.primaryAction.label, 'Relier puis préparer les mises à jour');

    const result = await R.confirmReconciliation(prepared, {
      useSuggestedLinks: true,
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(result.ok, true);
    assert.equal(result.preflight.data.planner.counts.UPDATE, 1);
    const stored = await persistence.loadBaseline('F', identity.associationFingerprintForTarget('F'));
    assert.equal(stored.entries.length, 1);
    assert.equal(stored.entries[0].formativeItemId, 'I3');
    assert.equal(stored.entries[0].managedState.points, 3);
  }

  // Even without a legacy mapping, one unique same-prompt/same-subtype item can
  // be linked explicitly and then updated instead of duplicated.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem(undefined, 'I3', raw => { raw.details.points = 3; })]);
    const R = makeRuntime(G, O);
    const prepared = await R.prepare(prepareArgs(pkg()));
    assert.equal(prepared.state, 'reconciliation_required');
    assert.equal(prepared.reconciliation.proposals[0].match, 'prompt-changed');
    assert.equal(prepared.view.reconciliationUpdates, 1);

    const result = await R.confirmReconciliation(prepared, {
      useSuggestedLinks: true,
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(result.ok, true);
    assert.equal(result.preflight.data.planner.counts.UPDATE, 1);
  }

  // Teacher may explicitly say an exact-looking server question is unrelated.
  // Cardinal then preserves it as foreign and plans a distinct CREATE.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const G = makeGateway([serverItem()]);
    const R = makeRuntime(G, O);
    const first = await R.prepare(prepareArgs(pkg()));
    const fp = first.reconciliation.proposals[0].fingerprint;

    const next = await R.confirmReconciliation(first, {
      useSuggestedLinks: true,
      keepSeparateFingerprints: [fp],
      preflightInjected,
      bootstrapInjected
    });
    assert.equal(next.ok, true);
    assert.equal(next.preflight.data.planner.counts.CREATE, 1);
    assert.equal(next.preflight.data.planner.foreignServerItemCount, 1);
  }

  console.log('reconciliation-flow-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});