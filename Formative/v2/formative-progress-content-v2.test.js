'use strict';

const assert = require('node:assert/strict');
const U = require('./formative-progress-content-v2.js');

{
  assert.equal(U.displayDuration({ stage: 'COMPLETED' }), 5500);
  assert.equal(U.displayDuration({ stage: 'FAILED' }), 9000);
  assert.equal(U.displayDuration({ stage: 'BLOCKED' }), 9000);
  assert.equal(U.displayDuration({ stage: 'IMPORTING' }), null);
}

{
  assert.equal(U.isFormativeProgress({
    type: U.MESSAGE_TYPE,
    payload: { schema: 'cardinal.progress/1', module: 'formative' }
  }), true);
  assert.equal(U.isFormativeProgress({
    type: 'MOZAIK_EXTENSION_PROGRESS',
    payload: { schema: 'cardinal.progress/1', module: 'formative' }
  }), false);
  assert.equal(U.isFormativeProgress({
    type: U.MESSAGE_TYPE,
    payload: { schema: 'cardinal.progress/1', module: 'mozaik' }
  }), false);
}

console.log('formative-progress-content-v2: all tests passed');
