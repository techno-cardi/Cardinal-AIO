'use strict';
const assert=require('node:assert/strict');
const exec=require('./executor-v2.js');
const journal=require('./journal-v2.js');
const contract=require('./execution-contract-v2.js');
const gate=require('./run-gate-v2.js');
async function main(){
 const ops=Array.from({length:3},(_,i)=>({operationId:'CREATE:q'+i,action:'CREATE',fingerprint:'q'+i}));
 const events=[],verified=[];
 const callbacks={
  saveJournal:async()=>{},
  assertOperationPrecondition:async()=>({state:'verified'}),
  applyMutation:async({op,onCreated})=>{const id='item-'+op.fingerprint;await onCreated(id);return {formativeItemId:id}},
  readServerForVerification:async({op})=>({id:'item-'+op.fingerprint}),
  verifyOperation:async({serverObservation})=>({state:'verified',formativeItemId:serverObservation.id}),
  commitBaselineVerified:async({op})=>{verified.push(op.fingerprint)},
  reconcileOperation:async()=>({state:'not_committed'})
 };
 const run=(id,onProgress)=>exec.run({runId:id,targetFormativeId:'F1',assessmentFingerprint:'A1',packageMode:'patch',plannerOperations:ops,callbacks,onProgress},{journal,contract,gate:gate.createGate()});
 const result=await run('run-1',ev=>events.push(ev));
 assert.equal(result.state,'completed');
 assert.ok(events.length>=6,JSON.stringify(events));
 assert.deepEqual(events.filter(x=>x.phase==='verified').map(x=>x.done),[1,2,3]);
 assert.deepEqual(events.filter(x=>x.phase==='verified').map(x=>x.total),[3,3,3]);
 assert.deepEqual(verified,['q0','q1','q2']);
 const safe=await run('run-2',()=>{throw Error('UI unavailable')});
 assert.equal(safe.state,'completed');
 console.log('progress-execution-v2: all tests passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});