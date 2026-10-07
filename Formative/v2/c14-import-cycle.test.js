'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const artifact = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
const load = name => require(path.join(artifact, name + '-v2.js'));
const validator = load('validator');
const adapter = load('adapter');
const managed = load('managed-state');
const planner = load('planner');
const baseline = load('baseline-store');
const journal = load('journal');
const preflight = load('preflight');
const contract = load('execution-contract');
const gate = load('run-gate');
const executor = load('executor');
const persistenceApi = load('persistence');
const bootstrap = load('bootstrap-reconciliation');
const orchestratorApi = load('orchestrator');
const identity = load('identity');
const presentation = load('presentation');
const runtimeApi = load('runtime');
const targetGuard = load('target-guard');
const reconciliation = load('reconciliation');
const transportBridge = load('transport-bridge');
const capabilities = load('capabilities');
const legacyContract = require(path.join(artifact, 'legacy-contract-v041.js'));
const primitivesApi = require(path.join(artifact, 'legacy-primitives-v041.js'));
const gatewayApi = load('legacy-gateway');
const serverReadiness = load('server-readiness');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'v2', 'exact-six-cygnes-c14.json'), 'utf8'));
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

// Only the remote GraphQL server is simulated. All validation, planning,
// journals, native mutation builders, target guards and verification are real.
function server() {
  const items = new Map();
  const mutations = [];
  let nextId = 0;
  let wrongTarget = false;
  const client = {
    async query(name, document, variables) {
      assert(document.includes(name));
      assert.equal(variables.formativeId, 'F');
      if (name === 'FormativePermissionCheck') {
        return { data: { formative: { _id: 'F', viewerPermissions: ['edit'] } } };
      }
      if (name === 'FormativeLayout') {
        return { data: { formative: { _id: 'F', title: 'Les Six Cygnes', items: [...items.values()].map(clone) } } };
      }
      throw new Error('Unexpected query: ' + name);
    },
    async mutation(name, document, variables) {
      assert(document.includes(name));
      mutations.push({ name, variables: clone(variables) });
      if (name === 'FormativeTeacherAddFormativeItem') {
        assert.equal(variables.formativeId, 'F');
        const id = 'server-' + (++nextId);
        items.set(id, {
          _id: id, subtype: variables.subtype, type: 'question', text: '',
          details: {
            points: 0, isRequired: true, isKeywordGrading: false, isPartialCredit: false,
            isCaseSensitive: false, showWordCount: false, correctAnswers: [], answerChoicePoints: [], blanks: []
          }
        });
        return { data: { payload: { formativeItem: { _id: id } } } };
      }
      const id = String(variables.formativeItemId || variables.id);
      const item = items.get(id);
      assert(item, 'the native mutation must address an existing server question');
      const input = variables.input || {};
      if (name === 'QuestionEditableUpdateFormativeItem') {
        if (Object.hasOwn(input, 'text')) item.text = input.text;
        for (const [key, value] of Object.entries(input)) {
          if (key !== 'text') item.details[key] = clone(value);
        }
      } else if (name === 'FillInTheBlankEditableContainerMutation') {
        item.text = input.text;
        item.details.blanks = clone(input.blanks);
      } else if (name === 'WithChoicesMutation' || name === 'MatchingEditableDetailsContainerMutation') {
        for (const [key, value] of Object.entries(input)) item.details[key] = clone(value);
      } else {
        throw new Error('Unexpected mutation: ' + name);
      }
      return { data: { payload: { formativeItem: clone(item) } } };
    }
  };
  const reader = {
    async readDetailedSnapshot(id) {
      assert.equal(id, 'F');
      return {
        formative: { _id: 'F', title: 'Les Six Cygnes', items: [...items.values()].map(clone) },
        snapshotComplete: true, detailLevel: 'managed-v2'
      };
    },
    async readItemDetailed(id, itemId) {
      assert.equal(id, 'F');
      return clone(items.get(itemId));
    }
  };
  return {
    items, mutations, client, reader,
    changeTarget() { wrongTarget = true; },
    getPageContext(input) {
      assert.equal(input.targetTabId, 10);
      return {
        targetFormativeId: 'F', urlTargetFormativeId: wrongTarget ? 'OTHER' : 'F',
        tabId: 10, title: 'Les Six Cygnes', pageKind: 'editor',
        explicitTabBinding: true, candidateTargetIds: ['F']
      };
    }
  };
}

function pipeline(remote) {
  let key = 0;
  let run = 0;
  const primitives = primitivesApi.createPrimitives({
    client: remote.client, contract: legacyContract, reader: remote.reader,
    getPageContext: input => remote.getPageContext(input),
    pauseMs: 0, randomKey: () => 'choice-' + (++key)
  });
  const gateway = gatewayApi.createGateway({ legacy: primitives, serverReadiness });
  const persistence = persistenceApi.createPersistence({ adapter: persistenceApi.createMemoryAdapter(), baseline });
  const orchestrator = orchestratorApi.createOrchestrator({
    preflight, executor, contract, journal, baseline, bootstrap, persistence,
    executorInjected: { journal, contract, gate: gate.createGate() },
    runIdFactory: () => 'cycle-' + (++run)
  });
  const runtime = runtimeApi.createRuntime({
    gateway, orchestrator, targetGuard, identity, presentation, transportBridge, managed, reconciliation
  });
  return {
    runtime,
    prepare(pkg) {
      return runtime.prepare({
        pkg, targetFormativeId: 'F', targetTabId: 10,
        capabilities: capabilities.productionQuestionTypes(),
        preflightInjected: { validator, adapter, managed, planner, baseline },
        bootstrapInjected: { validator, adapter, managed, baseline }
      });
    }
  };
}

test('the exact full package creates and verifies 15 native questions, reimports unchanged, then updates Q9 only', async () => {
  const remote = server();
  const product = pipeline(remote);
  const prepared = await product.prepare(source);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.issues));
  assert.equal(prepared.view.create, 15);
  const result = await product.runtime.execute(prepared, { acknowledgeWarnings: true, targetTabId: 10 });
  assert.equal(result.state, 'completed', JSON.stringify({ state: result.state, error: result.error, entry: result.journal?.entries?.find(row => row.state !== 'verified')?.error }));
  assert.equal(result.journal.summary.verified, 15);
  assert.equal(remote.items.size, 15);
  assert.equal(remote.mutations.filter(call => call.name === 'FormativeTeacherAddFormativeItem').length, 15);
  assert.equal([...remote.items.values()].reduce((sum, item) => sum + item.details.points, 0), 60);
  const q9 = [...remote.items.values()].find(item => item.details.points === 5 && item.subtype === 'matching');
  const q10 = [...remote.items.values()].find(item => item.details.points === 4 && item.subtype === 'matching');
  assert(q9 && q10);
  assert.equal(q9.details.choices.length, 5);
  assert.equal(q10.details.choices.length, 4);
  const matchingKeys = [...q9.details.choices];

  const beforeReimport = remote.mutations.length;
  const unchanged = await product.prepare(source);
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.view.create, 0);
  assert.equal(unchanged.view.update, 0);
  assert.equal(unchanged.view.unchanged, 15);
  const noMutation = await product.runtime.execute(unchanged, { acknowledgeWarnings: true, targetTabId: 10 });
  assert.equal(noMutation.state, 'completed');
  assert.equal(remote.mutations.length, beforeReimport);
  assert.equal(remote.items.size, 15);

  const changed = clone(source);
  changed.items[8].points.value = 6;
  changed.assessment.declaredTotalPoints = 61;
  const update = await product.prepare(changed);
  assert.equal(update.ok, true);
  assert.equal(update.view.create, 0);
  assert.equal(update.view.update, 1);
  assert.equal(update.view.unchanged, 14);
  const updated = await product.runtime.execute(update, { acknowledgeWarnings: true, targetTabId: 10 });
  assert.equal(updated.state, 'completed', JSON.stringify({ state: updated.state, error: updated.error }));
  assert.equal(remote.items.size, 15);
  assert.equal(remote.items.get(q9._id).details.points, 6);
  assert.deepEqual(remote.items.get(q9._id).details.choices, matchingKeys);
  assert.equal(remote.mutations.filter(call => call.name === 'FormativeTeacherAddFormativeItem').length, 15);

  remote.items.set('external', {
    _id: 'external', subtype: 'drawing', type: 'question', text: 'Travail ajouté à la main', details: { points: 1 }
  });
  const preserved = await product.prepare(changed);
  assert.equal(preserved.ok, true);
  assert.equal(preserved.view.create, 0);
  assert.equal(preserved.preflight.data.planner.foreignServerItemCount, 1);
  assert(remote.items.has('external'));
  const mutationCount = remote.mutations.length;
  const withForeignItem = await product.runtime.execute(preserved, { acknowledgeWarnings: true, targetTabId: 10 });
  assert.equal(withForeignItem.state, 'completed');
  assert.equal(remote.mutations.length, mutationCount);
  assert(remote.items.has('external'));
  remote.changeTarget();
  const blocked = await product.prepare(changed);
  assert.equal(blocked.ok, false);
  assert.equal(remote.mutations.length, mutationCount);
  assert(remote.items.has('external'));
});

test('the same raw package can reconcile already imported matching questions without guessing or duplicating them', async () => {
  const remote = server();
  const first = pipeline(remote);
  const prepared = await first.prepare(source);
  const imported = await first.runtime.execute(prepared, { acknowledgeWarnings: true, targetTabId: 10 });
  assert.equal(imported.state, 'completed');
  const second = pipeline(remote); // Deliberately empty local baseline.
  const found = await second.prepare(source);
  assert.equal(found.state, 'reconciliation_required', JSON.stringify(found));
  assert.equal(found.reconciliation.proposals.length, 15);
  assert.equal(found.view.reconciliationConflicts, 0);
  assert.equal(remote.items.size, 15);
});
