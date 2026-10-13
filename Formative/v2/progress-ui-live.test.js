'use strict';
const assert=require('node:assert/strict');
const C=require('./browser-controller-v2.js');
const T=require('./target-selector-v2.js');
const P=require('./progress-v2.js');
const E=require('./error-presenter-v2.js');
async function trial(mode) {
 const events=[];
 const product={
   prepare:async input=>({ok:true,state:mode==='resume'?'recovery':'ready',mode,targetFormativeId:input.targetFormativeId,targetTabId:input.targetTabId,view:{primaryAction:{id:'import'}}}),
   execute:async (_prepared,input)=>{
     assert.equal(typeof input.onProgress,'function');
     for(const done of [0,1,2,3]) await input.onProgress({phase:done?'verified':'starting',done,total:3,itemId:'q'+done});
     return {state:'completed',view:{statusLabel:'✓ Import vérifié'}};
   },
   confirmReconciliation:async()=>({ok:true,state:'ready'})
 };
 const controller=C.createController({product,targetSelector:T,progressApi:P,errorPresenter:E,
   enumerateTargets:async()=>[{tabId:10,targetFormativeId:'F1',title:'Formative',active:true,canEdit:true,authState:'authenticated',pageKind:'editor'}],
   emitState:async()=>{},progressSinks:[ev=>events.push(ev)],tokenFactory:()=>`ui-${mode}`});
 const prepared=await controller.preparePackage({pkg:{items:[]}});
 const result=await controller.execute(prepared.token);
 assert.equal(result.state,'completed');
 const detail=events.filter(x=>x.itemTotal===3);
 assert.deepEqual(detail.map(x=>x.itemIndex),[0,1,2,3]);
 assert.ok(detail.every(x=>x.stage==='IMPORTING'));
 assert.deepEqual(detail.map(x=>x.percent),[45,59,74,88]);
 assert.deepEqual(detail.map(x=>x.runId),Array(4).fill(prepared.token));
 const completed=events.at(-1);
 assert.equal(completed.stage,'COMPLETED');
 assert.equal(completed.percent,100);
 assert.equal(P.STAGES.RECOVERING.percent,null,'Do not imply 90% completion after interrupted recovery');
}
(async()=>{await trial('new');await trial('resume');console.log('progress-ui-live: PASS')})().catch(e=>{console.error(e);process.exitCode=1});