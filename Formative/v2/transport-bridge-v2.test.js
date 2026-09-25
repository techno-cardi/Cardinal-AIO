const assert = require('assert');
const managed = require('./managed-state-v2.js');
const reconciliation = require('./reconciliation-v2.js');
const targetGuard = require('./target-guard-v2.js');
const T = require('./transport-bridge-v2.js');

function tiptap(text) {
  return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content: [
    { type: 'paragraph', attrs: { dir: 'auto', textAlign: null }, content: [{ type: 'text', text }] }
  ] });
}

function raw(id, prompt) {
  return {
    _id: id,
    subtype: 'shortAnswer',
    text: tiptap(prompt),
    details: {
      points: 2, isRequired: true,
      correctAnswers: ['rbmk'], answerChoicePoints: [2],
      isKeywordGrading: true, isPartialCredit: true, isCaseSensitive: false
    }
  };
}

function state(prompt) {
  return managed.managedFromDesiredV1({
    kind: 'question', subtype: 'shortAnswer', prompt, points: 2, isRequired: true,
    grading: { mode: 'keyword-absolute', partialCredit: true, caseSensitive: false, matches: [{ text: 'rbmk', score: 2 }] }
  }).managedState;
}

function gateway(seed = {}) {
  const db = new Map((seed.items || []).map(x => [x._id, JSON.parse(JSON.stringify(x))]));
  const log = [];
  let next = 1;
  return {
    log,
    db,
    async observeTarget() {
      log.push('observe');
      return {
        targetFormativeId: 'F1', urlTargetFormativeId: 'F1', serverTargetFormativeId: 'F1',
        tabId: 10, title: 'Tchernobyl', canEdit: true, authState: 'authenticated',
        pageKind: 'editor', observedAt: Date.now(), explicitTabBinding: true, candidateTargetIds: ['F1'],
        ...(seed.observation || {})
      };
    },
    async listItems() {
      log.push('list');
      return { items: [...db.values()].map(x => JSON.parse(JSON.stringify(x))), snapshotComplete: seed.snapshotComplete !== false };
    },
    async readItem({ formativeItemId }) {
      log.push(`read:${formativeItemId}`);
      return db.has(formativeItemId) ? JSON.parse(JSON.stringify(db.get(formativeItemId))) : null;
    },
    async createItem({ item }) {
      log.push('create');
      const id = `NEW${next++}`;
      db.set(id, raw(id, item.prompt));
      return { formativeItemId: id };
    },
    async updateItem({ formativeItemId, item }) {
      log.push(`update:${formativeItemId}`);
      db.set(formativeItemId, raw(formativeItemId, item.prompt));
      return { formativeItemId };
    },
    async deleteItem({ formativeItemId }) {
      log.push(`delete:${formativeItemId}`);
      db.delete(formativeItemId);
      return { formativeItemId };
    }
  };
}

function bridge(g) {
  return T.createTransport({ gateway: g, managed, reconciliation, targetGuard });
}

const ctx = { targetFormativeId: 'F1', targetTabId: 10, targetTitle: 'Tchernobyl' };

(async () => {
  // UPDATE exact precondition -> mutation -> exact server postcondition.
  {
    const g = gateway({ items: [raw('I1', 'Old?')] });
    const t = bridge(g);
    const op = {
      action: 'UPDATE', operationId: 'UPDATE:q1', fingerprint: 'q1', formativeItemId: 'I1',
      baseline: state('Old?'), desired: state('New?'),
      adaptedItem: { subtype: 'shortAnswer', prompt: 'New?', points: 2 }
    };
    assert.equal((await t.assertOperationPrecondition({ op, context: ctx })).state, 'verified');
    const mutation = await t.applyMutation({ op, context: ctx });
    const observation = await t.readServerForVerification({ op, mutationResult: mutation, context: ctx });
    assert.equal((await t.verifyOperation({ op, serverObservation: observation })).state, 'verified');
  }

  // Teacher edit between dry-run and click blocks before update.
  {
    const g = gateway({ items: [raw('I1', 'Teacher edit?')] });
    const t = bridge(g);
    const op = {
      action: 'UPDATE', fingerprint: 'q1', formativeItemId: 'I1',
      baseline: state('Old?'), desired: state('New?'), adaptedItem: { subtype: 'shortAnswer', prompt: 'New?' }
    };
    const r = await t.assertOperationPrecondition({ op, context: ctx });
    assert.equal(r.state, 'blocked');
    assert.equal(r.code, 'MUTATION_TARGET_CHANGED_SINCE_PREFLIGHT');
    assert.equal(g.log.some(x => x.startsWith('update:')), false);
  }

  // CREATE requires an unchanged complete id snapshot.
  {
    const g = gateway({ items: [raw('OLD', 'Existing?')] });
    const t = bridge(g);
    const op = {
      action: 'CREATE', fingerprint: 'q1', preexistingServerItemIds: [],
      desired: state('New?'), adaptedItem: { subtype: 'shortAnswer', prompt: 'New?', points: 2 }
    };
    const r = await t.assertOperationPrecondition({ op, context: ctx });
    assert.equal(r.state, 'blocked');
    assert.equal(r.code, 'CREATE_TARGET_CHANGED_SINCE_PREFLIGHT');
  }

  // Expired session blocks all mutation paths before any write.
  {
    const g = gateway({ observation: { authState: 'expired' } });
    const t = bridge(g);
    const op = { action: 'CREATE', preexistingServerItemIds: [], desired: state('New?'), adaptedItem: { subtype: 'shortAnswer', prompt: 'New?' } };
    const r = await t.assertOperationPrecondition({ op, context: ctx });
    assert.equal(r.state, 'blocked');
    assert.equal(g.log.includes('create'), false);
  }

  // DELETE is verified only after server re-read confirms absence.
  {
    const g = gateway({ items: [raw('I1', 'Old?')] });
    const t = bridge(g);
    const op = { action: 'DELETE', fingerprint: 'q1', formativeItemId: 'I1', baseline: state('Old?'), server: state('Old?') };
    assert.equal((await t.assertOperationPrecondition({ op, context: ctx })).state, 'verified');
    const mutation = await t.applyMutation({ op, context: ctx });
    const observation = await t.readServerForVerification({ op, mutationResult: mutation, context: ctx });
    assert.equal((await t.verifyOperation({ op, serverObservation: observation })).state, 'verified');
  }

  // Uncertain CREATE reconciliation adopts only a unique new exact candidate.
  {
    const g = gateway({ items: [raw('OLD', 'Existing?'), raw('NEW1', 'New?')] });
    const t = bridge(g);
    const op = {
      action: 'CREATE', fingerprint: 'q1', preexistingServerItemIds: ['OLD'],
      desired: state('New?'), adaptedItem: { subtype: 'shortAnswer', prompt: 'New?' }
    };
    const r = await t.reconcileOperation({ op, context: ctx });
    assert.equal(r.state, 'committed');
    assert.equal(r.formativeItemId, 'NEW1');
  }

  // An exact ID acknowledged by Formative may be safely finished in place,
  // even when its first configuration was only partially applied.
  {
    const g = gateway({ items: [raw('NEW1', 'Partial?'), raw('NEW2', 'Teacher item?')] });
    const t = bridge(g);
    const op = {
      action: 'CREATE', operationId: 'CREATE:q1', fingerprint: 'q1',
      preexistingServerItemIds: [], recoveryFormativeItemId: 'NEW1',
      desired: state('New?'),
      adaptedItem: { subtype: 'shortAnswer', prompt: 'New?', points: 2 }
    };
    const verdict = await t.reconcileOperation({ op, context: ctx });
    assert.equal(verdict.state, 'repairable');
    assert.equal(verdict.formativeItemId, 'NEW1');
    const repaired = await t.repairPartialCreate({ op, formativeItemId: 'NEW1', context: ctx });
    assert.equal(repaired.formativeItemId, 'NEW1');
    assert.equal(g.log.filter(x => x === 'create').length, 0);
    assert.equal(g.log.filter(x => x === 'update:NEW1').length, 1);
  }

  // Incomplete server snapshot never resolves uncertain CREATE/DELETE.
  {
    const g = gateway({ items: [], snapshotComplete: false });
    const t = bridge(g);
    const op = { action: 'CREATE', fingerprint: 'q1', preexistingServerItemIds: [], desired: state('New?'), adaptedItem: { subtype: 'shortAnswer' } };
    const r = await t.reconcileOperation({ op, context: ctx });
    assert.equal(r.state, 'conflict');
  }

  // A request flagged as possibly sent is surfaced as uncertain-capable.
  {
    const g = gateway();
    g.createItem = async () => {
      const e = new Error('timeout');
      e.requestSent = true;
      throw e;
    };
    const t = bridge(g);
    const op = { action: 'CREATE', adaptedItem: { subtype: 'shortAnswer' } };
    await assert.rejects(
      t.applyMutation({ op, context: ctx }),
      error => error.mutationMayHaveCommitted === true
    );
  }

  console.log('transport-bridge-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});