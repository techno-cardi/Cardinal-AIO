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
const orchestratorApi = require('./orchestrator-v2.js');

const preflightDeps = { validator, adapter, managed, planner, baseline };

function pkg(prompt = 'Quel type de réacteur est impliqué?', mode = 'patch') {
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

function tiptapText(text) {
  return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
  ] });
}

function serverItem(prompt, id = 'I3') {
  return {
    _id: id, subtype: 'shortAnswer', text: tiptapText(prompt),
    details: {
      points: 2, isRequired: true,
      correctAnswers: ['rbmk', 'graphite'], answerChoicePoints: [2, 2],
      isKeywordGrading: true, isPartialCredit: true, isCaseSensitive: false
    }
  };
}

function makePersistence() {
  return persistenceApi.createPersistence({ adapter: persistenceApi.createMemoryAdapter(), baseline });
}

function makeOrchestrator(persistence, overrides = {}) {
  return orchestratorApi.createOrchestrator({
    preflight: overrides.preflight || preflight,
    executor,
    contract,
    journal,
    baseline,
    persistence,
    executorInjected: { journal, contract, gate: overrides.gate || gateApi.createGate() },
    runIdFactory: overrides.runIdFactory || (() => 'run-fixed')
  });
}

function transport(log, options = {}) {
  return {
    assertOperationPrecondition: async ({ op }) => {
      log.push(`pre:${op.action}:${op.fingerprint}`);
      return options.precondition || { state: 'verified' };
    },
    applyMutation: async ({ op }) => {
      log.push(`mutate:${op.action}:${op.fingerprint}`);
      if (options.mutationError) throw options.mutationError;
      assert(op.adaptedItem || op.action === 'DELETE', 'exact adapted item must reach transport');
      return { formativeItemId: op.formativeItemId || options.createdId || 'I-created' };
    },
    readServerForVerification: async ({ op, mutationResult }) => {
      log.push(`read:${op.action}:${op.fingerprint}`);
      return { id: mutationResult?.formativeItemId || op.formativeItemId, matchesDesired: true };
    },
    verifyOperation: async ({ op, serverObservation }) => {
      log.push(`verify:${op.action}:${op.fingerprint}`);
      return { state: 'verified', formativeItemId: serverObservation.id, serverRevision: `rev-${op.fingerprint}` };
    },
    reconcileOperation: async ({ op }) => {
      log.push(`reconcile:${op.action}:${op.fingerprint}`);
      return options.reconcileVerdict || { state: 'committed', formativeItemId: op.formativeItemId || 'I-created', serverRevision: 'rev-recovered' };
    }
  };
}

function baselineFor(sourcePkg, target = 'F') {
  const adapted = adapter.adaptPackageV2ToV1(sourcePkg, { targetFormativeId: target });
  const desired = managed.managedFromDesiredV1(adapted.packageV1.items[0]).managedState;
  return baseline.createBaseline({
    targetFormativeId: target, assessmentFingerprint: 'A',
    entries: [{ fingerprint: adapted.identity[0].fingerprint, sourceItemId: 'q3', formativeItemId: 'I3', subtype: 'shortAnswer', managedState: desired }]
  });
}

(async () => {
  // Blank target -> prepare CREATE -> execute -> verified baseline + completed journal.
  {
    const persistence = makePersistence();
    const O = makeOrchestrator(persistence);
    const prepared = await O.prepare({
      pkg: pkg(), targetFormativeId: 'F', targetTitle: 'Tchernobyl', assessmentFingerprint: 'A',
      serverItems: [], preflightInjected: preflightDeps
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.mode, 'new');
    assert.equal(prepared.preflight.data.planner.counts.CREATE, 1);
    assert(prepared.plannerOperations[0].adaptedItem, 'adapted payload must be frozen into execution plan');
    assert(prepared.executionContract.operations[0].adaptedItem, 'adapted payload must be bound by contract');

    const log = [];
    const result = await O.execute(prepared, { transport: transport(log), importerVersion: '0.5-test' });
    assert.equal(result.state, 'completed');
    assert.equal(log.filter(x => x.startsWith('mutate:CREATE')).length, 1);

    const storedBaseline = await persistence.loadBaseline('F', 'A');
    assert(storedBaseline);
    assert.equal(storedBaseline.entries.length, 1);
    assert.equal(storedBaseline.entries[0].formativeItemId, 'I-created');
    assert.equal(storedBaseline.generation, 0);

    const storedJournal = await persistence.loadJournal('F', 'A');
    assert(storedJournal.completedAt);
    assert.equal(storedJournal.operations[0].status, journal.STATUS.VERIFIED);
    assert.equal(storedJournal.executionPlan.length, 1);
  }

  // A review state cannot mutate until user explicitly confirms the import.
  {
    const persistence = makePersistence();
    const sourcePkg = pkg();
    await persistence.saveBaseline(baselineFor(sourcePkg));
    const O = makeOrchestrator(persistence);
    const prepared = await O.prepare({
      pkg: sourcePkg, targetFormativeId: 'F', assessmentFingerprint: 'A',
      serverItems: [serverItem('QUESTION MODIFIÉE MANUELLEMENT')], preflightInjected: preflightDeps
    });
    assert.equal(prepared.state, 'review');
    const log = [];
    const blocked = await O.execute(prepared, { transport: transport(log) });
    assert.equal(blocked.state, 'review_required');
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);

    const accepted = await O.execute(prepared, { acknowledgeWarnings: true, transport: transport(log) });
    assert.equal(accepted.state, 'completed');
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
  }

  // Recovery journal takes priority over fresh preflight and preserves exact old execution plan.
  {
    const persistence = makePersistence();
    const oldPlan = [{
      operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1',
      baseline: { kind: 'question', subtype: 'shortAnswer', prompt: 'old' },
      desired: { kind: 'question', subtype: 'shortAnswer', prompt: 'new' },
      adaptedItem: { id: 'adapted-q1', kind: 'question', subtype: 'shortAnswer', prompt: 'new', points: 2, grading: { mode: 'manual', matches: [] } }
    }];
    const c = contract.buildExecutionContract({
      targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch', plannerOperations: oldPlan, approvedDeleteFingerprints: []
    });
    let j = journal.createJournal({
      runId: 'interrupted', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      executionContractHash: c.hash, executionPlan: oldPlan,
      operations: executor.makeJournalOperations(oldPlan)
    });
    await persistence.saveJournal(j);
    j = journal.startOperation(j, 'UPDATE:q1');
    await persistence.saveJournal(j);

    let preflightCalls = 0;
    const preflightNever = { preflightPackageV2() { preflightCalls += 1; throw new Error('fresh preflight must not run during recovery'); } };
    const O = makeOrchestrator(persistence, { preflight: preflightNever });
    const prepared = await O.prepare({ pkg: pkg('A NEWER USER REQUEST'), targetFormativeId: 'F', assessmentFingerprint: 'A', serverItems: [] });
    assert.equal(prepared.state, 'recovery');
    assert.equal(prepared.journal.runId, 'interrupted');
    assert.deepEqual(prepared.plannerOperations, oldPlan);
    assert.equal(preflightCalls, 0);

    const log = [];
    const result = await O.execute(prepared, { transport: transport(log, { reconcileVerdict: { state: 'committed', formativeItemId: 'I1' } }) });
    assert.equal(result.state, 'completed');
    assert.equal(log.filter(x => x.startsWith('reconcile:')).length, 1);
    assert.equal(log.filter(x => x.startsWith('mutate:')).length, 0);
  }

  // Incomplete journal without immutable plan fails closed rather than recomputing a potentially unsafe plan.
  {
    const persistence = makePersistence();
    const oldContract = contract.buildExecutionContract({
      targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      plannerOperations: [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }]
    });
    const broken = journal.createJournal({
      runId: 'legacy-broken', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      executionContractHash: oldContract.hash,
      operations: [{ operationId: 'UPDATE:q1', action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }]
    });
    await persistence.saveJournal(broken);

    const O = makeOrchestrator(persistence);
    const prepared = await O.prepare({ pkg: pkg(), targetFormativeId: 'F', assessmentFingerprint: 'A', serverItems: [], preflightInjected: preflightDeps });
    assert.equal(prepared.state, 'recovery_blocked');
    assert.equal(prepared.reason, 'RECOVERY_PLAN_MISSING');
  }

  // A journal that is already BLOCKED with no uncertain write is safe to
  // discard. A fresh dry-run must replace the dead recovery loop.
  {
    const persistence = makePersistence();
    const sourcePkg = pkg();
    const prepared0 = await makeOrchestrator(persistence).prepare({
      pkg: sourcePkg,
      targetFormativeId: 'F',
      assessmentFingerprint: 'A',
      serverItems: [],
      preflightInjected: preflightDeps
    });
    let stuck = journal.createJournal({
      runId: 'stuck-blocked',
      targetFormativeId: 'F',
      assessmentFingerprint: 'A',
      packageMode: 'patch',
      executionContractHash: prepared0.executionContract.hash,
      executionPlan: prepared0.plannerOperations,
      operations: executor.makeJournalOperations(prepared0.plannerOperations)
    });
    await persistence.saveJournal(stuck);
    stuck = journal.markBlocked(
      stuck,
      stuck.operations[0].operationId,
      { code: 'CREATE_TARGET_CHANGED_SINCE_PREFLIGHT', message: 'old dead plan' }
    );
    await persistence.saveJournal(stuck);

    const O = makeOrchestrator(persistence, { runIdFactory: () => 'fresh-after-stuck' });
    const prepared = await O.prepare({
      pkg: sourcePkg,
      targetFormativeId: 'F',
      assessmentFingerprint: 'A',
      serverItems: [],
      preflightInjected: preflightDeps
    });
    assert.equal(prepared.mode, 'new');
    assert.equal(prepared.runId, 'fresh-after-stuck');
    assert.equal(prepared.abandonedRecovery.runId, 'stuck-blocked');
    assert.equal(await persistence.loadJournal('F', 'A'), null);
  }

  // A completed old journal does not hijack a future fresh import.
  {
    const persistence = makePersistence();
    const completed = journal.createJournal({
      runId: 'done', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      executionContractHash: contract.buildExecutionContract({ targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch', plannerOperations: [] }).hash,
      executionPlan: [], operations: []
    });
    await persistence.saveJournal(completed);

    const O = makeOrchestrator(persistence, { runIdFactory: () => 'fresh' });
    const prepared = await O.prepare({ pkg: pkg(), targetFormativeId: 'F', assessmentFingerprint: 'A', serverItems: [], preflightInjected: preflightDeps });
    assert.equal(prepared.mode, 'new');
    assert.equal(prepared.runId, 'fresh');
  }

  // Discarding recovery is explicit and bound to the exact run id.
  {
    const persistence = makePersistence();
    const plan = [{ action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1' }];
    const c = contract.buildExecutionContract({ targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch', plannerOperations: plan });
    const j = journal.createJournal({
      runId: 'recover-me', targetFormativeId: 'F', assessmentFingerprint: 'A', packageMode: 'patch',
      executionContractHash: c.hash, executionPlan: plan, operations: executor.makeJournalOperations(plan)
    });
    await persistence.saveJournal(j);
    const O = makeOrchestrator(persistence);
    await assert.rejects(
      O.discardIncompleteRecovery({ targetFormativeId: 'F', assessmentFingerprint: 'A', expectedRunId: 'wrong' }),
      error => error.code === 'JOURNAL_CLEAR_RUN_MISMATCH'
    );
    assert.equal(await O.discardIncompleteRecovery({ targetFormativeId: 'F', assessmentFingerprint: 'A', expectedRunId: 'recover-me' }), true);
  }

  console.log('orchestrator-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});