const assert = require('assert');
const targetGuard = require('./target-guard-v2.js');
const identity = require('./identity-v2.js');
const presentation = require('./presentation-v2.js');
const managed = require('./managed-state-v2.js');
const reconciliation = require('./reconciliation-v2.js');
const runtimeApi = require('./runtime-v2.js');

function pkg() {
  return {
    schema: 'cardinal.formative/2', protocolVersion: '2.0.0', packageMode: 'patch',
    assessment: { title: 'Test', language: 'fr-CA', sourceMode: 'external-reference-only' },
    sources: [], items: [], issues: []
  };
}

function gateway(overrides = {}) {
  const log = [];
  return {
    log,
    async observeTarget() {
      log.push('observe');
      return {
        targetFormativeId: 'F1', urlTargetFormativeId: 'F1', serverTargetFormativeId: 'F1',
        tabId: 10, title: 'Mon Formative', canEdit: true, authState: 'authenticated',
        pageKind: 'editor', observedAt: Date.now(), explicitTabBinding: true, candidateTargetIds: ['F1'],
        ...(overrides.observation || {})
      };
    },
    async listItems() {
      log.push('list');
      const items = overrides.items || [];
      return {
        items,
        snapshotComplete: overrides.snapshotComplete !== false,
        managedDetailComplete: overrides.managedDetailComplete !== false,
        detailLevel: overrides.detailLevel || 'managed-v2',
        detailIssues: overrides.detailIssues || [],
        serverRevision: 'rev1'
      };
    }
  };
}

function orchestrator() {
  const calls = [];
  return {
    calls,
    async prepare(input) {
      calls.push({ kind: 'prepare', input });
      return {
        ok: true, state: 'ready', mode: 'new',
        targetFormativeId: input.targetFormativeId,
        targetTabId: input.targetTabId,
        targetTitle: input.targetTitle,
        assessmentFingerprint: input.assessmentFingerprint,
        pkg: input.pkg,
        preflight: { data: { ui: { status: '✓ Prêt', questions: 0, warnings: 0, blockers: 0 } } }
      };
    },
    async confirmReconciliation(prepared, input) {
      calls.push({ kind: 'confirmReconciliation', prepared, input });
      return { ok: true, state: 'reconciled', baselineRecord: { entries: [] } };
    },
    async execute(prepared, input) {
      calls.push({ kind: 'execute', prepared, input });
      return { ok: true, state: 'completed', journal: { summary: { verified: 1, skipped: 0 } } };
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

function runtime(g, o) {
  return runtimeApi.createRuntime({
    gateway: g, orchestrator: o, targetGuard, identity, presentation,
    transportBridge: fakeTransportBridge, managed, reconciliation
  });
}

(async () => {
  // One unambiguous open Formative is resolved automatically; no manual id entry required.
  {
    const g = gateway();
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.targetFormativeId, 'F1');
    assert.equal(prepared.targetTabId, 10);
    assert.equal(prepared.targetTitle, 'Mon Formative');
    assert.equal(prepared.assessmentFingerprint, identity.associationFingerprintForTarget('F1'));
    assert(prepared.packageFingerprint.startsWith('cfi-package-'));
    assert.equal(prepared.serverDetailLevel, 'managed-v2');
    assert.equal(prepared.view.primaryAction.label, 'Importer dans Formative');
    assert.deepEqual(g.log, ['observe', 'list']);
    assert(o.calls[0].input.packageFingerprint.startsWith('cfi-package-'));
  }

  // Conflicting page/server ids block before even reading assessment items.
  {
    const g = gateway({ observation: { serverTargetFormativeId: 'OTHER' } });
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.state, 'blocked');
    assert.equal(g.log.includes('list'), false);
    assert.equal(o.calls.length, 0);
  }

  // Runtime-level blocks must expose their exact issue in the view so the
  // ChatGPT bar can never collapse to an opaque "1 blocage".
  {
    const g = gateway({ observation: { serverTargetFormativeId: 'OTHER' } });
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.state, 'blocked');
    assert(Array.isArray(prepared.view.issues));
    assert(prepared.view.issues.length >= 1);
    assert.equal(prepared.view.globalIssues[0].message, prepared.issues[0].message);
  }

  // Partial GraphQL/paginated snapshots never become dry-runs.
  {
    const g = gateway({ snapshotComplete: false });
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.state, 'blocked');
    assert.equal(prepared.reason, 'PREFLIGHT_SERVER_SNAPSHOT_INCOMPLETE');
    assert.equal(o.calls.length, 0);
  }

  // A non-empty shallow snapshot is blocked before semantic comparison.
  {
    const g = gateway({
      items: [{ _id: 'I1', subtype: 'shortAnswer', text: 'x', details: { points: 4 } }],
      managedDetailComplete: false,
      detailLevel: 'layout',
      detailIssues: [{ severity: 'blocker', code: 'SERVER_DETAIL_READER_REQUIRED', message: 'detail required' }]
    });
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.state, 'blocked');
    assert.equal(prepared.reason, 'PREFLIGHT_SERVER_DETAIL_INCOMPLETE');
    assert(prepared.issues.some(x => x.code === 'SERVER_DETAIL_READER_REQUIRED'));
    assert.equal(o.calls.length, 0);
  }

  // Empty targets do not need item-detail fields to prove there is nothing to overwrite.
  {
    const g = gateway({ items: [], managedDetailComplete: false, detailLevel: 'layout' });
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    assert.equal(prepared.ok, true);
  }

  // Explicit different target than observed page blocks rather than silently switching.
  {
    const g = gateway();
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg(), targetFormativeId: 'F2' });
    assert.equal(prepared.state, 'blocked');
    assert.equal(o.calls.length, 0);
  }

  // Execute wires the guarded transport and returns a user-facing completed view.
  {
    const g = gateway();
    const o = orchestrator();
    const R = runtime(g, o);
    const prepared = await R.prepare({ pkg: pkg() });
    const result = await R.execute(prepared, { importerVersion: '0.5-test' });
    assert.equal(result.state, 'completed');
    assert.equal(result.view.statusLabel, '✓ Import vérifié');
    const call = o.calls.find(x => x.kind === 'execute');
    assert(call.input.transport);
  }

  console.log('runtime-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});