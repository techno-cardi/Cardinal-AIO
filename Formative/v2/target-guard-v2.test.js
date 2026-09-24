const assert = require('assert');
const G = require('./target-guard-v2.js');

const NOW = Date.parse('2026-09-21T12:00:00Z');

function obs(overrides = {}) {
  return {
    targetFormativeId: 'F1',
    urlTargetFormativeId: 'F1',
    serverTargetFormativeId: 'F1',
    tabId: 10,
    title: 'Tchernobyl',
    canEdit: true,
    authState: 'authenticated',
    pageKind: 'editor',
    observedAt: NOW - 1000,
    explicitTabBinding: true,
    candidateTargetIds: ['F1'],
    ...overrides
  };
}

function expected(overrides = {}) {
  return { targetFormativeId: 'F1', tabId: 10, title: 'Tchernobyl', ...overrides };
}

// Exact fresh writable target is ready.
{
  const r = G.evaluateTarget(obs(), expected(), { now: NOW });
  assert.equal(r.state, 'ready');
}

// Any disagreement in authoritative ids blocks before mutation.
{
  const r = G.evaluateTarget(obs({ serverTargetFormativeId: 'OTHER' }), expected(), { now: NOW });
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'TARGET_ID_MISMATCH'));
}

// Wrong Chrome tab blocks even if the assessment id coincidentally matches.
{
  const r = G.evaluateTarget(obs({ tabId: 11 }), expected(), { now: NOW });
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'TARGET_TAB_CHANGED'));
}

// Multiple targets without an explicit tab binding are ambiguous.
{
  const r = G.evaluateTarget(obs({ explicitTabBinding: false, candidateTargetIds: ['F1', 'F2'] }), expected({ tabId: null }), { now: NOW });
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'TARGET_TAB_AMBIGUOUS'));
}

// Session and permission must both be positively proven.
{
  assert.equal(G.evaluateTarget(obs({ authState: 'expired' }), expected(), { now: NOW }).state, 'blocked');
  assert.equal(G.evaluateTarget(obs({ authState: 'unknown' }), expected(), { now: NOW }).state, 'blocked');
  assert.equal(G.evaluateTarget(obs({ canEdit: false }), expected(), { now: NOW }).state, 'blocked');
  assert.equal(G.evaluateTarget(obs({ canEdit: null }), expected(), { now: NOW }).state, 'blocked');
}

// Stale observation is never reused for a write.
{
  const r = G.evaluateTarget(obs({ observedAt: NOW - 60000 }), expected(), { now: NOW, maxAgeMs: 15000 });
  assert.equal(r.state, 'blocked');
  assert(r.issues.some(x => x.code === 'TARGET_OBSERVATION_STALE'));
}

// Renaming an assessment is a warning, not an id mismatch.
{
  const r = G.evaluateTarget(obs({ title: 'Nouveau titre' }), expected(), { now: NOW });
  assert.equal(r.state, 'review');
  assert(r.issues.some(x => x.code === 'TARGET_TITLE_CHANGED'));
}

console.log('target-guard-v2: all tests passed');