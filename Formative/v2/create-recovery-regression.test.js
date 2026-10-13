'use strict';
const assert = require('node:assert/strict');
const executor = require('./executor-v2.js');
const journal = require('./journal-v2.js');
const contract = require('./execution-contract-v2.js');
const gate = require('./run-gate-v2.js');
const bridge = require('./transport-bridge-v2.js');
const managed = require('./managed-state-v2.js');
const reconciliation = require('./reconciliation-v2.js');
const targetGuard = require('./target-guard-v2.js');

function raw(id, content) {
  return { _id: id, subtype: 'functionalizedText',
    text: JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:content}]}]}) };
}
function operation(label) {
  return { operationId:'CREATE:'+label, action:'CREATE', fingerprint:label,
    preexistingServerItemIds: [], desired: {kind:'text',subtype:'functionalizedText',content:label},
    adaptedItem:{kind:'text',content:label} };
}
function fixture({failSecond=false, insertExternal=false}={}) {
  const db=new Map(), events=[];
  let count=0, stored=null, failOnce=failSecond;
  const g={
    async observeTarget(){return {
      targetFormativeId:'F1',urlTargetFormativeId:'F1',serverTargetFormativeId:'F1',
      tabId:10,title:'Import Test',canEdit:true,authState:'authenticated',
      pageKind:'editor',observedAt:Date.now(),explicitTabBinding:true,candidateTargetIds:['F1']
    };},
    async listItems(){return {snapshotComplete:true,items:[...db.values()]};},
    async readItem({formativeItemId}){return db.get(formativeItemId)||null;},
    async createItem({item,onCreated}) {
      count++;const id='new-'+count;events.push('create:'+id);
      db.set(id,raw(id,failOnce?'partiel':item.content));
      if(onCreated) await onCreated(id);
      if(failOnce){ failOnce=false;const e=new Error('Échec après création, avant configuration');
        e.formativeItemId=id;e.mutationMayHaveCommitted=true;throw e; }
      return {formativeItemId:id};
    },
    async updateItem({formativeItemId,item}) {
      events.push('update:'+formativeItemId);db.set(formativeItemId,raw(formativeItemId,item.content));
      return {formativeItemId};
    },
    async deleteItem(){throw Error('No delete');}
  };
  const t=bridge.createTransport({gateway:g,managed,reconciliation,targetGuard});
  const callbacks={
    saveJournal: async j=>{
      stored=structuredClone(j);
      if(insertExternal && j.summary.verified===1 && !db.has('foreign')) db.set('foreign',raw('foreign','externe'));
    },
    assertOperationPrecondition:t.assertOperationPrecondition,
    applyMutation:t.applyMutation,
    readServerForVerification:t.readServerForVerification,
    verifyOperation:t.verifyOperation,
    reconcileOperation:t.reconcileOperation,
    commitBaselineVerified:async()=>{}
  };
  const ops=[operation('alpha'),operation('beta')];
  async function run(prior) {
    return executor.run({
      runId:'run-recovery',journal:prior||null,targetFormativeId:'F1',assessmentFingerprint:'A1',
      packageMode:'patch',plannerOperations:ops,callbacks,
      context:{targetFormativeId:'F1',targetTabId:10,targetTitle:'Import Test'}
    },{journal,contract,gate:gate.createGate()});
  }
  return {db,events,run,get stored(){return stored;}};
}

(async()=>{
  const success=fixture();
  const result=await success.run();
  assert.equal(result.state,'completed','Deux créations successives doivent être autorisées et vérifiées');
  assert.deepEqual(success.events,['create:new-1','create:new-2']);

  const partial=fixture({failSecond:true});
  const first=await partial.run();
  assert.equal(first.state,'uncertain','Une création incomplète est un état incertain');
  assert.equal(first.journal.operations[0].formativeItemId,'new-1',
    'L’ID créé doit être sauvegardé durablement même si la configuration échoue');
  const repaired=await partial.run(partial.stored);
  assert.equal(repaired.state,'completed','Reprise doit compléter la question déjà créée');
  assert.deepEqual(partial.events,['create:new-1','update:new-1','create:new-2'],
    'Ne jamais recréer une question déjà partiellement créée');

  const foreign=fixture({insertExternal:true});
  const protectedRun=await foreign.run();
  assert.notEqual(protectedRun.state,'completed','Un item externe ajouté en cours de route doit bloquer la création');
  assert.deepEqual(foreign.events,['create:new-1']);
  console.log('create-recovery regression: OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
