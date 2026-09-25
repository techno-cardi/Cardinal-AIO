const assert = require('assert');
const S = require('./target-selector-v2.js');

function c(tabId, targetFormativeId, title, active = false, overrides = {}) {
  return {
    tabId, targetFormativeId, title, active,
    canEdit: true, authState: 'authenticated', pageKind: 'editor',
    ...overrides
  };
}

// One eligible Formative is selected automatically.
{
  const r = S.choose([c(1, 'F1', 'Lecture', true)]);
  assert.equal(r.state, 'selected');
  assert.equal(r.selected.tabId, 1);
}

// Two different editable targets always require a small explicit chooser.
{
  const r = S.choose([c(1, 'F1', 'Lecture', true), c(2, 'F2', 'Grammaire', false)]);
  assert.equal(r.state, 'choose');
  assert.equal(r.reason, 'MULTIPLE_EDITABLE_TARGETS');
  assert.equal(S.chooserRows(r).length, 2);
}

// Multiple tabs showing the same target may use the single active tab safely.
{
  const r = S.choose([c(1, 'F1', 'Lecture', true), c(2, 'F1', 'Lecture', false)]);
  assert.equal(r.state, 'selected');
  assert.equal(r.reason, 'SAME_TARGET_ACTIVE_TAB');
}

// Explicit selection wins only if that exact editable tab/target pair exists.
{
  const r = S.choose([c(1, 'F1', 'Lecture'), c(2, 'F2', 'Grammaire')], { requestedTabId: 2, requestedTargetId: 'F2' });
  assert.equal(r.state, 'selected');
  assert.equal(r.selected.targetFormativeId, 'F2');
  assert.equal(S.choose([c(2, 'F2', 'Grammaire')], { requestedTabId: 2, requestedTargetId: 'F1' }).state, 'blocked');
}

// URL identity is authoritative even if another observation id is present.
{
  const r = S.choose([c(7, 'stale-observed', 'Lecture', true, {
    urlTargetFormativeId: 'F-url',
    observedTargetFormativeId: 'stale-observed',
    serverTargetFormativeId: 'F-url'
  })]);
  assert.equal(r.state, 'selected');
  assert.equal(r.selected.targetFormativeId, 'F-url');
  assert.equal(r.selected.urlTargetFormativeId, 'F-url');
  assert.equal(r.selected.observedTargetFormativeId, 'stale-observed');
}

// Read-only, logged-out, or unrelated pages are never auto-selected.
{
  const r = S.choose([
    c(1, 'F1', 'Read only', true, { canEdit: false }),
    c(2, 'F2', 'Logged out', false, { authState: 'expired' }),
    c(3, 'F3', 'Other', false, { pageKind: 'other' })
  ]);
  assert.equal(r.state, 'blocked');
  assert.equal(r.reason, 'NO_EDITABLE_FORMATIVE_TAB');
}

console.log('target-selector-v2: all tests passed');