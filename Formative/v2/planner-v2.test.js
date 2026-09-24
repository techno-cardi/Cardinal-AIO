const assert = require('assert');
const P = require('./planner-v2.js');

const state = (prompt, points = 2) => ({ prompt, points, grading: { mode: 'x' } });

// CREATE when no baseline exists.
{
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', sourceItemId: 'q1', managedState: state('new') }],
    baseline: [],
    server: [{ formativeItemId: 'foreign', managedState: state('foreign') }]
  });
  assert.equal(r.counts.CREATE, 1);
  assert.equal(r.foreignServerItemCount, 1);
  assert.equal(r.state, 'ready');
}

// UNCHANGED when server already equals desired.
{
  const desired = state('same');
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: desired }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('old') }],
    server: [{ formativeItemId: 'F1', managedState: desired }]
  });
  assert.equal(r.counts.UNCHANGED, 1);
}

// Safe UPDATE: server still baseline, desired changed.
{
  const old = state('old');
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: state('new') }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: old }],
    server: [{ formativeItemId: 'F1', managedState: old }]
  });
  assert.equal(r.counts.UPDATE, 1);
  assert.equal(r.state, 'ready');
}

// External-only change is preserved rather than overwritten.
{
  const old = state('old');
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: old }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: old }],
    server: [{ formativeItemId: 'F1', managedState: state('teacher edit') }]
  });
  assert.equal(r.counts.PRESERVE_EXTERNAL, 1);
  assert(r.issues.some(x => x.code === 'SERVER_EXTERNAL_CHANGE'));
  assert.equal(r.state, 'review');
}

// True three-way conflict blocks.
{
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: state('new package') }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('baseline') }],
    server: [{ formativeItemId: 'F1', managedState: state('teacher edit') }]
  });
  assert.equal(r.counts.BLOCKED, 1);
  assert(r.issues.some(x => x.code === 'SERVER_THREE_WAY_CONFLICT'));
  assert.equal(r.state, 'blocked');
}

// PATCH never proposes deletion for missing desired items.
{
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('old') }],
    server: [{ formativeItemId: 'F1', managedState: state('old') }]
  });
  assert.equal(r.counts.DELETE_PROPOSED, 0);
}

// FULL may propose, but never execute, deletion of Cardinal-owned items only.
{
  const r = P.planThreeWay({
    packageMode: 'full',
    desired: [],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('old') }],
    server: [
      { formativeItemId: 'F1', managedState: state('old') },
      { formativeItemId: 'FOREIGN', managedState: state('manual question') }
    ]
  });
  assert.equal(r.counts.DELETE_PROPOSED, 1);
  assert.equal(r.foreignServerItemCount, 1);
  assert(r.issues.some(x => x.code === 'DELETE_PROPOSED'));
}

// Deletion proposal with teacher edit is highlighted, still never automatic.
{
  const r = P.planThreeWay({
    packageMode: 'full',
    desired: [],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('old') }],
    server: [{ formativeItemId: 'F1', managedState: state('teacher edit') }]
  });
  const op = r.operations.find(x => x.action === 'DELETE_PROPOSED');
  assert(op && op.externalChanged === true);
  assert(r.issues.some(x => x.code === 'DELETE_PROPOSED_EXTERNAL_CHANGE'));
}

// Missing mapped server item blocks blind recreation.
{
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: state('new') }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: state('old') }],
    server: []
  });
  assert.equal(r.counts.BLOCKED, 1);
  assert(r.issues.some(x => x.code === 'SERVER_ITEM_MISSING'));
}

// Unknown server fields never participate if the caller exposes only managedState.
{
  const managed = state('same');
  const r = P.planThreeWay({
    packageMode: 'patch',
    desired: [{ fingerprint: 'q1', managedState: managed }],
    baseline: [{ fingerprint: 'q1', formativeItemId: 'F1', managedState: managed }],
    server: [{ formativeItemId: 'F1', managedState: managed, rawServerOnlyRubric: { x: 1 } }]
  });
  assert.equal(r.counts.UNCHANGED, 1);
}

console.log('planner-v2: all tests passed');