const assert = require('assert');
const C = require('./capabilities-v2.js');

// Production means the complete safe v2 pipeline, not only archived transport.
{
  const types = C.productionQuestionTypes();
  assert.deepEqual(types, [
    'fillInTheBlank',
    'inlineChoice',
    'longAnswer',
    'multipleChoice',
    'multipleSelection',
    'resequence',
    'shortAnswer',
    'matching'
  ].sort());
  assert.equal(types.includes('resequence'), true);
  assert.equal(types.includes('matching'), true);
}

{
  assert.equal(C.mutationDecision('shortAnswer', 'CREATE').ok, true);
  assert.equal(C.mutationDecision('shortAnswer', 'UPDATE').ok, true);
  assert.equal(C.mutationDecision('multipleChoice', 'CREATE').ok, true);
  assert.equal(C.mutationDecision('multipleSelection', 'UPDATE').ok, true);
  assert.equal(C.mutationDecision('inlineChoice', 'READ').ok, true);
  assert.equal(C.mutationDecision('matching', 'CREATE').ok, true);
  assert.equal(C.mutationDecision('resequence', 'UPDATE').ok, true);
  assert.equal(C.mutationDecision('categorize', 'UPDATE').ok, false);
  assert.equal(C.mutationDecision('categorize', 'UPDATE').code, 'CAPABILITY_PARTIAL');
}

// Lower-level 0.4.1 evidence remains documented without leaking into the
// production-capable list.
{
  assert.equal(C.legacyTransportCan('multipleChoice', 'create'), true);
  assert.equal(C.legacyTransportCan('multipleChoice', 'update'), true);
  assert.equal(C.can('multipleChoice', 'create'), true);
}

// Unknown future Formative subtype fails closed.
{
  const r = C.mutationDecision('brandNewFutureSubtype', 'CREATE');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CAPABILITY_NOT_PROVEN');
  assert.equal(C.legacyTransportCan('brandNewFutureSubtype', 'create'), false);
}

// A raw server-read observation is not the same thing as a complete managed
// read safe enough for three-way diff.
{
  assert.equal(C.legacyTransportCan('dragAndDrop', 'read'), true);
  assert.equal(C.can('dragAndDrop', 'read', { allowPartial: true }), false);
  assert.equal(C.can('dragAndDrop', 'create', { allowPartial: true }), false);
}

console.log('capabilities-v2: all tests passed');