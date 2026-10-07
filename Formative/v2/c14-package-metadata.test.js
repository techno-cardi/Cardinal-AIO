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
const original = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'v2', 'exact-six-cygnes-c14.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const injected = { validator, adapter, managed, planner, baseline };

function dryRun(pkg, validatorApi = validator) {
  return preflight.preflightPackageV2({
    pkg, targetFormativeId: 'F', assessmentFingerprint: 'A', serverItems: [],
    capabilities: capabilities.productionQuestionTypes()
  }, { ...injected, validator: validatorApi });
}

function runtime() {
  const persistence = persistenceApi.createPersistence({
    adapter: persistenceApi.createMemoryAdapter(), baseline
  });
  const orchestrator = orchestratorApi.createOrchestrator({
    preflight, executor, contract, journal, baseline, bootstrap, persistence
  });
  const gateway = {
    async observeTarget() {
      return {
        targetFormativeId: 'F', urlTargetFormativeId: 'F', serverTargetFormativeId: 'F',
        tabId: 10, title: 'Les Six Cygnes', canEdit: true, authState: 'authenticated',
        pageKind: 'editor', observedAt: Date.now(), explicitTabBinding: true,
        candidateTargetIds: ['F']
      };
    },
    async listItems() {
      return { items: [], snapshotComplete: true, managedDetailComplete: true };
    }
  };
  return runtimeApi.createRuntime({
    gateway, orchestrator, targetGuard, identity, presentation, transportBridge, managed, reconciliation
  });
}

test('the real source package reproduces the exact diagnostic fingerprint and 34 strict format blockers', () => {
  assert.equal(identity.packageContentFingerprint(original), 'cfi-package-a0ee7d930240324cf3c0b8c958b3d543');
  const result = validator.validatePackageV2(original);
  assert.equal(result.stats.blockers, 34);
  assert.equal(result.stats.questions, 15);
});

test('the entire source package prepares 15 CREATE operations and all 60 points without losing Q9 or Q10', () => {
  const before = JSON.stringify(original);
  const result = dryRun(original);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.data.ui.questions, 15);
  assert.equal(result.data.validation.stats.total, 60);
  assert.equal(result.data.planner.counts.CREATE, 15);
  assert.equal(result.data.ui.blockers, 0);
  assert.equal(result.data.desired.find(row => row.sourceItemId === 'q9').adaptedItem.pairs.length, 5);
  assert.equal(result.data.desired.find(row => row.sourceItemId === 'q10').adaptedItem.pairs.length, 4);
  assert(!result.issues.some(issue => /^MEDIA_DEPENDENCY/.test(issue.code)));
  assert.equal(JSON.stringify(original), before, 'validation must never rewrite the original package');
  const oldIdentity = adapter.adaptPackageV2ToV1(original, { targetFormativeId: 'F' }).identity;
  assert.deepEqual(result.data.adapted.identity, oldIdentity, 'existing item mappings must survive metadata normalization');
});

test('metadata aliases are optional at the strict validator and do not change any question content or score', () => {
  const result = validator.validatePackageV2(original, { normalizeKnownAliases: true });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.stats.total, 60);
  assert.equal(result.stats.questions, 15);
  assert.equal(validator.validatePackageV2(original).stats.blockers, 34);
});

test('the exact packet retains the prepared array answers for Q1 and Q4 in the correction preview', () => {
  const rows = presentation.buildValidationRows(original);
  for (const id of ['q1', 'q4']) {
    const answer = original.items.find(item => item.id === id).grading.expectedAnswer;
    assert(Array.isArray(answer));
    const expected = String(answer).replace(/\s+/g, ' ').trim();
    const row = rows.find(item => item.itemId === id);
    assert.equal(row.correction.expectedAnswer, expected);
    assert.equal(row.correctionSummary, expected);
  }
});

test('unknown provenance values and genuinely missing source labels still block', () => {
  for (const change of [
    pkg => { pkg.items[0].points.provenance = 'unknown'; },
    pkg => { pkg.items[0].grading.provenance.kind = 'unknown'; },
    pkg => { delete pkg.sources[0].title; }
  ]) {
    const pkg = clone(original);
    change(pkg);
    const result = dryRun(pkg);
    assert.equal(result.ok, false);
    assert(result.issues.some(issue => issue.severity === 'blocker'));
  }
});

test('numeric total compatibility does not erase a real mismatch, invalid points, or an unanswered blank', () => {
  for (const [change, code] of [
    [pkg => { pkg.assessment.declaredTotalPoints = 61; }, 'TOTAL_POINTS_MISMATCH'],
    [pkg => { pkg.items[0].points.value = -1; }, 'INVALID_POINTS'],
    [pkg => { pkg.items[2].response.blanks[0].answers = []; }, 'PLACEHOLDER_MISMATCH']
  ]) {
    const pkg = clone(original);
    change(pkg);
    const result = dryRun(pkg);
    assert.equal(result.ok, false);
    assert(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues));
  }
});

test('a missing real diagram remains blocked while literary diagram concepts do not', () => {
  const pkg = clone(original);
  pkg.items[8].prompt = 'Observe le schéma ci-dessous et associe chaque élément.';
  pkg.sources.find(source => source.id === 'six_cygnes').status = 'missing';
  const result = dryRun(pkg);
  assert.equal(result.ok, false);
  assert(result.issues.some(issue => issue.code === 'MEDIA_DEPENDENCY_MISSING' && issue.itemId === 'q9'));
});

test('a blocked full preparation retains all 15 rows, the 34 causes, and the true blocker count', async () => {
  const strictValidator = {
    validatePackageV2(pkg, options) {
      return validator.validatePackageV2(pkg, { ...options, normalizeKnownAliases: false });
    }
  };
  const prepared = await runtime().prepare({
    pkg: original, targetFormativeId: 'F', targetTabId: 10,
    preflightInjected: { ...injected, validator: strictValidator },
    bootstrapInjected: injected, capabilities: capabilities.productionQuestionTypes()
  });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.view.questions, 15);
  assert.equal(prepared.view.validationRows.length, 15);
  assert.equal(prepared.view.blockers, 34);
  assert.equal(prepared.view.issues.filter(issue => issue.severity === 'blocker').length, 34);
  assert(prepared.view.validationRows.find(row => row.itemId === 'q1').issues.length > 0);
  assert.equal(prepared.view.primaryAction.enabled, false);
});

test('the real runtime and orchestrator enable importing the unchanged 15-question source package', async () => {
  const prepared = await runtime().prepare({
    pkg: original, targetFormativeId: 'F', targetTabId: 10,
    preflightInjected: injected, bootstrapInjected: injected,
    capabilities: capabilities.productionQuestionTypes()
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.view.questions, 15);
  assert.equal(prepared.view.create, 15);
  assert.equal(prepared.view.blockers, 0);
  assert.equal(prepared.view.validationRows.length, 15);
  assert.equal(prepared.view.primaryAction.enabled, true);
});

test('the blocked view survives a rejected null item and shows the real causes', async () => {
  const pkg = clone(original);
  pkg.items.push(null);
  const prepared = await runtime().prepare({
    pkg, targetFormativeId: 'F', targetTabId: 10,
    preflightInjected: injected, bootstrapInjected: injected,
    capabilities: capabilities.productionQuestionTypes()
  });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.view.blockers, 3);
  assert.equal(prepared.view.validationRows.length, 15);
  assert.equal(prepared.view.primaryAction.enabled, false);
});

test('the blocked view survives rejected concept metadata', async () => {
  const pkg = clone(original);
  pkg.items[6].grading.concepts = 'invalid';
  const prepared = await runtime().prepare({
    pkg, targetFormativeId: 'F', targetTabId: 10,
    preflightInjected: injected, bootstrapInjected: injected,
    capabilities: capabilities.productionQuestionTypes()
  });
  assert.equal(prepared.ok, false);
  assert(prepared.view.blockers > 0);
  assert.equal(prepared.view.validationRows.length, 15);
  assert.equal(prepared.view.primaryAction.enabled, false);
});

test('the displayed blocker count includes reconciliation causes as well as preflight causes', () => {
  const issue = n => ({ code: 'BLOCK_' + n, severity: 'blocker', message: 'Cause ' + n });
  const view = presentation.buildPreparedView({
    ok: false, state: 'blocked', pkg: original,
    preflight: { data: { ui: { status: '✓ Prêt', blockers: 1, warnings: 0 } }, issues: [issue(1)] },
    issues: [issue(1), issue(2), issue(3)]
  });
  assert.equal(view.blockers, 3);
  assert.equal(view.issues.length, 3);
  assert.equal(view.primaryAction.enabled, false);
  assert.equal(view.statusLabel, '✕ Bloqué');
});

test('malformed JSON values remain visible as blockers without coercion crashes', async () => {
  for (const change of [
    pkg => { pkg.items[0].order = { toString: null }; },
    pkg => { pkg.items[0].points.value = { toString: null }; },
    pkg => { pkg.items[0].grading.mode = 'invalid'; pkg.items[0].grading.expectedAnswer = { toString: null }; }
  ]) {
    const pkg = clone(original);
    change(pkg);
    const prepared = await runtime().prepare({
      pkg, targetFormativeId: 'F', targetTabId: 10,
      preflightInjected: injected, bootstrapInjected: injected,
      capabilities: capabilities.productionQuestionTypes()
    });
    assert.equal(prepared.ok, false);
    assert(prepared.view.blockers > 0);
    assert.equal(prepared.view.validationRows.length, 15);
    assert.equal(prepared.view.primaryAction.enabled, false);
  }
});

test('the ChatGPT bar exposes the actual blocking messages as text', async () => {
  const content = load('chatgpt-content');
  const elements = [];
  function element(tag) {
    const node = {
      tag, style: {}, dataset: {}, children: [], textContent: '', isConnected: true,
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      append(...children) { children.forEach(child => this.appendChild(child)); },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      addEventListener() {}, setAttribute() {}, remove() { this.isConnected = false; },
      querySelector() { return null; }
    };
    elements.push(node);
    return node;
  }
  const issues = [
    { severity: 'blocker', code: 'TOTAL_POINTS_MISMATCH', message: 'Le total annoncé ne correspond pas aux points des questions.' },
    { severity: 'blocker', code: 'MISSING_KEYWORD_CONCEPTS', itemId: 'q7', message: 'Le corrigé de cette question est incomplet.' }
  ];
  const bridge = content.createContentBridge({
    document: { documentElement: {}, querySelectorAll() { return []; }, createElement: element },
    runtime: {
      id: 'test-extension',
      async sendMessage() {
        return {
          handled: true, ok: false, state: 'blocked', token: 'test-blocked',
          view: { statusLabel: 'Bloqué', blockers: 2, issues, primaryAction: { id: 'none', enabled: false } }
        };
      },
      onMessage: { addListener() {}, removeListener() {} }
    },
    scanner: {
      scan() {
        return {
          messages: [{
            messageRoot: null, technicalNode: null,
            parse: { state: 'found', package: { pkg: original, rawJson: JSON.stringify(original) } }
          }], ignored: []
        };
      },
      placementAnchor() { return { mode: 'append-end', anchor: null, parent: null, table: null }; }
    },
    parser: { SENTINEL: 'CARDINAL_FORMATIVE_PACKAGE_V2' },
    errorPresenter: { present(error) { return { message: error.message }; } },
    MutationObserver: null, storage: null
  });
  await bridge.scanNow();
  const text = elements.map(node => node.textContent).join(' ');
  for (const issue of issues) assert(text.includes(issue.message), 'a blocker count without its cause is not useful');
  assert(elements.some(node => node.tag === 'details'));
  bridge.stop();
});
