(() => {
  const BRIDGE_VERSION = '1.1.13';
  const EXTENSION_BUILD = (() => {
    try {
      const manifest = chrome.runtime?.getManifest?.() || {};
      return String(manifest.version_name || manifest.version || '');
    } catch { return ''; }
  })();
  const INSTANCE_TOKEN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.__cardinalFormativeSimpleActiveToken = INSTANCE_TOKEN;

  const formativeId = location.pathname.match(/\/formatives\/([^/]+)\/results/)?.[1] || '';
  if (!formativeId) return;

  const HOST_ID = 'cardinal-formative-simple-092';
  // Après un rechargement de l’extension, un ancien host peut rester dans la page
  // alors que son contexte chrome.runtime est mort. On le remplace explicitement.
  try { document.getElementById(HOST_ID)?.remove(); } catch {}
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;display:none;position:fixed;inset:0;width:auto;height:auto;overflow:hidden;pointer-events:none;contain:layout style paint;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode:'open' });

  root.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .launcher{display:none!important;position:fixed;right:18px;bottom:18px;z-index:2147483646;gap:8px;align-items:center;pointer-events:auto}
      button{border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer;font-size:13px}
      button.primary{background:#132a4a;color:#fff;box-shadow:0 8px 24px rgba(15,35,64,.24)}
      button.secondary{background:#fff;color:#132a4a;border:1px solid #cad5e4;box-shadow:0 5px 16px rgba(15,35,64,.12)}
      button:disabled{opacity:.5;cursor:wait}
      .modal{position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;padding:18px;overscroll-behavior:contain;pointer-events:auto}
      .hidden{display:none!important}
      .card{width:min(840px,96vw);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.25);color:#172033}
      .head{padding:18px 20px 14px;border-bottom:1px solid #e7ecf3;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
      .head h2{font-size:19px;margin:2px 0}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#66758a;font-weight:800}
      .body{padding:18px 20px;display:grid;gap:14px}.actions{padding:14px 20px 18px;border-top:1px solid #e7ecf3;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
      label{font-size:12px;font-weight:750;color:#40516a;display:grid;gap:6px}.select{width:100%;border:1px solid #cbd5e1;border-radius:10px;padding:9px 10px;background:#fff;color:#172033}
      .notice{border:1px solid #dbe4f0;background:#f7f9fc;border-radius:12px;padding:11px 12px;font-size:13px;line-height:1.45;white-space:pre-wrap}
      .notice.ok{border-color:#b7e4cb;background:#f2fbf6}.notice.warn{border-color:#f0d7a6;background:#fff9ed}.notice.err{border-color:#efb8b8;background:#fff5f5;color:#8e2424}
      .summary{display:flex;gap:8px;flex-wrap:wrap}.pill{border-radius:999px;padding:6px 9px;background:#edf2f8;font-size:12px;font-weight:700;color:#415269}
      table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:8px 7px;border-bottom:1px solid #e8edf4;vertical-align:top}th{position:sticky;top:0;background:#fff;color:#526278}.grade{white-space:nowrap;font-weight:750}.comment{max-width:360px;white-space:pre-wrap}
      .preview-controls{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.preview-controls button{padding:7px 10px;border-radius:9px;background:#f2f5f9;color:#31445f;border:1px solid #d5deea;font-size:12px}.preview-question-list{display:grid;gap:8px;max-height:52vh;overflow:auto;padding-right:2px}.question-preview{border:1px solid #dbe4f0;border-radius:12px;background:#fbfcfe;overflow:hidden}.question-preview[data-open="1"]{background:#fff}.question-preview-toggle{width:100%;border:0;border-radius:0;background:transparent!important;box-shadow:none!important;cursor:pointer;padding:10px 12px;font-size:12px;font-weight:800;color:#26384f;display:flex;gap:8px;align-items:center;justify-content:space-between;text-align:left}.question-preview-toggle:before{content:'▸';font-size:12px;color:#65758b}.question-preview[data-open="1"] .question-preview-toggle:before{content:'▾'}.question-preview-toggle .q-summary{flex:1}.question-preview-body{display:none}.question-preview[data-open="1"] .question-preview-body{display:block}.question-preview .q-issues{margin:0 10px 8px}.student-list{border-top:1px solid #e7edf5}.student-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:8px;align-items:start;padding:9px 11px;border-top:1px solid #eef2f7}.student-row:first-child{border-top:0}.student-name{font-weight:750;color:#27364a}.student-old{font-size:11px;color:#7b8797;margin-top:2px}.student-score{font-weight:800;white-space:nowrap;color:#24344a}.student-comment{grid-column:2 / 4;white-space:pre-wrap;font-size:12px;line-height:1.4;color:#44556d;margin-top:-2px}.preview-empty{font-size:12px;color:#68778b;padding:12px;border:1px dashed #cbd5e1;border-radius:10px;text-align:center}
      .switches{display:flex;gap:18px;flex-wrap:wrap;font-size:13px}.switches label{display:flex;align-items:center;gap:7px;font-weight:650;color:#27364a}
      .close{background:transparent;color:#526278;padding:5px 8px;font-size:20px}
      .small{font-size:12px;color:#68778b;line-height:1.4}
      .detected{font-size:12px;color:#315070;font-weight:650}
      .question-list{display:grid;gap:6px;max-height:280px;overflow:auto;border:1px solid #dbe4f0;border-radius:12px;padding:8px;background:#fbfcfe}
      .question-item{display:grid;grid-template-columns:22px minmax(0,1fr);gap:5px 8px;padding:7px 8px;border-radius:8px;color:#27364a;font-weight:650}
      .question-item:hover{background:#f1f5f9}.question-item input{margin-top:4px}
      .question-choice-toggle{grid-column:2;width:100%;border:0;border-radius:0;background:transparent!important;box-shadow:none!important;padding:0!important;color:#27364a!important;display:flex;gap:7px;align-items:flex-start;text-align:left;font-size:12px;line-height:1.25;font-weight:750;min-width:0}
      .question-choice-toggle:before{content:'▸';color:#66758a;flex:0 0 auto}.question-item[data-open="1"] .question-choice-toggle:before{content:'▾'}
      .question-choice-title{display:block;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .question-item[data-open="1"] .question-choice-title{white-space:normal;overflow:visible}
      .question-choice-body{grid-column:2;display:none;font-size:11px;line-height:1.38;color:#607086;font-weight:550;padding:2px 2px 4px 18px;white-space:pre-wrap}
      .question-item[data-open="1"] .question-choice-body{display:block}
      .question-select-actions{display:flex;gap:6px;align-items:center;margin-bottom:7px;flex-wrap:wrap}.question-select-actions button{padding:6px 9px;border-radius:8px;background:#eef3f8;color:#31445f;border:1px solid #d5deea;font-size:11px}.question-select-status{margin-left:auto;font-size:11px;color:#607086;font-weight:700}
    </style>
    <div class="launcher">
      <button id="correctBtn" class="primary">Corriger avec ChatGPT</button>
      <button id="gestionBtn" class="secondary">Résultat global → Gestion</button>
    </div>

    <div id="chooseModal" class="modal hidden">
      <div class="card">
        <div class="head"><div><div class="eyebrow">Correction assistée</div><h2>Choisir la question</h2></div><button class="close" data-close="chooseModal">×</button></div>
        <div class="body">
          <div id="detectedText" class="detected"></div>
          <label>Classe<select id="sectionSelect" class="select"></select></label>
          <label id="singleQuestionLabel">Question<select id="questionSelect" class="select"></select></label>
          <div id="multiQuestionBlock" class="hidden">
            <div class="small" style="font-weight:750;color:#40516a;margin-bottom:6px">Questions à inclure</div>
            <div class="question-select-actions"><button id="selectAllQuestions" type="button">Sélectionner toutes</button><button id="selectNoQuestions" type="button">Tout désélectionner</button><span id="questionSelectStatus" class="question-select-status"></span></div>
            <div id="questionChecks" class="question-list"></div>
          </div>
          <div class="notice">L’extension détecte automatiquement la classe et la question ouvertes dans Formative quand elles sont présentes dans l’URL. Tu peux simplement confirmer.</div>
          <div class="switches">
            <label><input id="commentsOnly" type="checkbox"> Commentaires seulement</label>
            <label><input id="multiQuestion" type="checkbox"> Plusieurs questions</label>
            <label id="includeGradedLabel"><input id="includeGraded" type="checkbox"> Inclure aussi les réponses déjà notées par Formative pour vérifier ou revoir l’autocorrection</label>
          </div>
          <div id="chooseStatus" class="notice hidden"></div>
        </div>
        <div class="actions"><button class="secondary" data-close="chooseModal">Annuler</button><button id="copyOpenBtn" class="primary">Copier et ouvrir ChatGPT</button></div>
      </div>
    </div>

    <div id="globalModal" class="modal hidden">
      <div class="card" style="width:min(520px,94vw)">
        <div class="head"><div><div class="eyebrow">Résultat global</div><h2>Choisir la classe à importer</h2></div><button class="close" data-close="globalModal">×</button></div>
        <div class="body">
          <div class="small">Ce Formative est associé à plusieurs classes. Choisis exactement celle dont tu veux envoyer le résultat global vers Gestion des notes.</div>
          <label>Classe<select id="globalSectionSelect" class="select"></select></label>
          <div id="globalStatus" class="notice hidden"></div>
        </div>
        <div class="actions"><button class="secondary" data-close="globalModal">Annuler</button><button id="globalSendBtn" class="primary">Importer ce groupe</button></div>
      </div>
    </div>

    <div id="previewModal" class="modal hidden">
      <div class="card">
        <div class="head"><div><div class="eyebrow">Retour de ChatGPT</div><h2 id="previewTitle">Vérifier avant publication</h2></div><button class="close" data-close="previewModal">×</button></div>
        <div class="body">
          <div id="previewSummary" class="summary"></div>
          <div id="previewWarning" class="notice warn hidden"></div>
          <div class="switches">
            <label><input id="publishNotes" type="checkbox" checked> Publier les notes</label>
            <label><input id="publishComments" type="checkbox"> Publier les commentaires</label>
          </div>
          <div id="previewControls" class="preview-controls">
            <button id="previewOpenAll" type="button">Tout ouvrir</button>
            <button id="previewCloseAll" type="button">Tout fermer</button>
            <button id="previewProblemsOnly" type="button">Afficher seulement les problèmes</button>
          </div>
          <div id="previewQuestions" class="preview-question-list"></div>
          <div id="previewNoProblems" class="preview-empty hidden">Aucun problème technique dans ce lot.</div>
          <div id="publishStatus" class="notice hidden"></div>
        </div>
        <div class="actions"><button id="cancelPreviewBtn" class="secondary" data-close="previewModal">Annuler</button><button id="publishBtn" class="primary">Publier dans Formative</button></div>
      </div>
    </div>

    <div id="statusModal" class="modal hidden">
      <div class="card" style="width:min(520px,94vw)">
        <div class="head"><div><div class="eyebrow">Cardinal</div><h2 id="statusTitle">Traitement</h2></div><button class="close" data-close="statusModal">×</button></div>
        <div class="body"><div id="statusText" class="notice"></div></div>
        <div class="actions"><button class="primary" data-close="statusModal">Fermer</button></div>
      </div>
    </div>`;

  const $ = id => root.getElementById(id);
  let catalog = null;
  let pendingPreview = null;

  function diagnosticRecord(event,data={},level='info'){
    try{
      chrome.runtime?.sendMessage?.({type:'CARDINAL_DIAGNOSTIC_RECORD',scope:'formative-ui',event,data,level}).catch(()=>{});
    }catch{}
  }
  try{
    window.addEventListener('error',event=>diagnosticRecord('window.error',{message:event?.message||'Erreur JavaScript',filename:event?.filename||null,lineno:event?.lineno||null,colno:event?.colno||null},'error'));
    window.addEventListener('unhandledrejection',event=>diagnosticRecord('window.unhandledrejection',{message:event?.reason?.message||String(event?.reason||'')},'error'));
  }catch{}
  const CHOOSER_STATE_KEY = `cardinal.formative.correctionChooser.v116.${formativeId}`;
  const GLOBAL_STATE_KEY = `cardinal.formative.globalChooser.v113.${formativeId}`;

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function fmt(v){if(v===null||v===undefined||v==='')return '-';const n=Number(v);return Number.isFinite(n)?n.toLocaleString('fr-CA',{maximumFractionDigits:2}):String(v);}
  function previewIssueQuestionNumber(value){
    const m=String(value||'').match(/\bQ\s*(\d{1,3})\b/i);
    return m?String(Number(m[1])):'';
  }
  function previewTechnicalIssues(preview){
    const out=[];
    const push=(kind,value)=>{const text=String(value||'').trim();if(text)out.push({kind,text,questionNumber:previewIssueQuestionNumber(text)});};
    (preview?.unmatched||[]).forEach(v=>push('Élève introuvable',v));
    (preview?.ambiguous||[]).forEach(v=>push('Correspondance ambiguë',v));
    (preview?.invalid||[]).forEach(v=>push('Donnée invalide',v));
    (preview?.missingRows||[]).forEach(v=>push('Ligne manquante',v));
    (preview?.missingQuestions||[]).forEach(v=>push('Question manquante',`Q${v} · aucune ligne reçue`));
    return out;
  }
  function previewQuestionGroups(preview){
    const questions=Array.isArray(preview?.context?.questions)&&preview.context.questions.length?preview.context.questions:(preview?.context?.question?[preview.context.question]:[]);
    const order=new Map(questions.map((q,i)=>[String(q.id||''),i]));
    const groups=new Map();
    const ensure=(qid,number,label,max)=>{
      const key=String(qid||number||'unknown');
      if(!groups.has(key))groups.set(key,{key,questionId:String(qid||''),number:String(number||'?'),label:String(label||''),possiblePoints:Number(max),rows:[],issues:[]});
      return groups.get(key);
    };
    for(const q of questions)ensure(q?.id,q?.number,q?.text,q?.possiblePoints);
    (preview?.rows||[]).forEach((row,index)=>{
      const g=ensure(row?.questionId||row?.formativeItemId,row?.questionNumber,row?.questionLabel,row?.possiblePoints);
      g.rows.push({row,index});
    });
    const issues=previewTechnicalIssues(preview);
    const onlyQuestion=groups.size===1?[...groups.values()][0]:null;
    for(const issue of issues){
      let target=null;
      if(issue.questionNumber){
        target=[...groups.values()].find(g=>String(Number(g.number||0))===issue.questionNumber)||null;
        if(!target)target=ensure('',issue.questionNumber,'',NaN);
      } else if(onlyQuestion)target=onlyQuestion;
      if(target)target.issues.push(issue);
    }
    return [...groups.values()].sort((a,b)=>{
      const ai=order.has(a.questionId)?order.get(a.questionId):Number.MAX_SAFE_INTEGER;
      const bi=order.has(b.questionId)?order.get(b.questionId):Number.MAX_SAFE_INTEGER;
      if(ai!==bi)return ai-bi;
      return Number(a.number||0)-Number(b.number||0);
    });
  }
  function params(){
    const u=new URL(location.href);
    const routeQuestion=(u.pathname.match(/\/formatives\/[^/]+\/results\/([^/?#]+)/i)||[])[1]||'';
    return{
      assignmentId:u.searchParams.get('selectedAssignmentId')||'',
      questionId:u.searchParams.get('selectedFormativeItemId')||'',
      routeQuestion:decodeURIComponent(routeQuestion)
    };
  }
  async function request(action,payload={}){
    if (!globalThis.chrome?.runtime?.id || !globalThis.chrome?.runtime?.sendMessage) {
      return {ok:false,message:'Le pont Cardinal n’est plus actif dans cet onglet. Rouvre Cardinal pour le réinitialiser.'};
    }
    try {
      return await chrome.runtime.sendMessage({type:'FORMATIVE_REQUEST',action,payload});
    } catch (error) {
      const msg=String(error?.message||error||'');
      if (/extension context invalidated/i.test(msg)) {
        return {ok:false,message:'Cardinal vient d’être rechargé et cet onglet utilise encore un ancien contexte. Rouvre le popup Cardinal et relance l’action.'};
      }
      return {ok:false,message:msg||'Le pont Cardinal n’a pas pu joindre l’extension.'};
    }
  }
  async function copyText(text){
    try { await navigator.clipboard.writeText(String(text||'')); return true; } catch {}
    try {
      const ta=document.createElement('textarea');
      ta.value=String(text||'');ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.left='-9999px';ta.style.top='0';
      document.documentElement.appendChild(ta);ta.select();ta.setSelectionRange(0,ta.value.length);
      const ok=document.execCommand('copy');ta.remove();if(ok)return true;
    } catch {}
    return false;
  }
  function syncHostVisibility(){
    const visible=[...root.querySelectorAll('.modal')].some(m=>!m.classList.contains('hidden'));
    host.style.display=visible?'block':'none';
  }
  function close(id){$(id)?.classList.add('hidden');syncHostVisibility();}
  function open(id){host.style.display='block';$(id)?.classList.remove('hidden');}
  root.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(b.dataset.close)));
  root.querySelectorAll('.modal').forEach(m=>m.addEventListener('pointerdown',e=>{if(e.target===m)close(m.id);}));
  function loadChooserState(){
    try{
      const value=JSON.parse(sessionStorage.getItem(CHOOSER_STATE_KEY)||'null');
      return value&&typeof value==='object'?value:null;
    }catch{return null;}
  }
  function updateQuestionSelectionStatus(){
    const boxes=[...root.querySelectorAll('.questionCheck')];
    const selected=boxes.filter(box=>box.checked).length;
    if($('questionSelectStatus'))$('questionSelectStatus').textContent=`${selected}/${boxes.length} sélectionnée${selected===1?'':'s'}`;
  }
  function saveChooserState(){
    try{
      sessionStorage.setItem(CHOOSER_STATE_KEY,JSON.stringify({
        assignmentId:String($('sectionSelect')?.value||''),
        questionId:String($('questionSelect')?.value||''),
        multiQuestion:!!$('multiQuestion')?.checked,
        commentsOnly:!!$('commentsOnly')?.checked,
        includeGraded:!!$('includeGraded')?.checked,
        selectedQuestionIds:[...root.querySelectorAll('.questionCheck:checked')].map(box=>String(box.value||'')).filter(Boolean)
      }));
    }catch{}
  }
  function setQuestionChooserExpanded(node,openState){
    if(!node)return;
    const isOpen=!!openState;
    node.dataset.open=isOpen?'1':'0';
    const toggle=node.querySelector('.question-choice-toggle');
    if(toggle)toggle.setAttribute('aria-expanded',isOpen?'true':'false');
  }
  $('multiQuestion')?.addEventListener('change',()=>{
    if($('multiQuestion').checked && !root.querySelector('.questionCheck:checked')){
      const current=$('questionSelect')?.value;const box=[...root.querySelectorAll('.questionCheck')].find(x=>String(x.value)===String(current));if(box)box.checked=true;
    }
    syncCorrectionModeUi();updateQuestionSelectionStatus();saveChooserState();
  });
  $('commentsOnly')?.addEventListener('change',()=>{syncCorrectionModeUi();saveChooserState();});
  $('includeGraded')?.addEventListener('change',saveChooserState);
  $('sectionSelect')?.addEventListener('change',()=>{saveChooserState();diagnosticRecord('selection.section.changed',{sectionValue:$('sectionSelect')?.value||null});});
  $('selectAllQuestions')?.addEventListener('click',()=>{root.querySelectorAll('.questionCheck').forEach(box=>{box.checked=true;});updateQuestionSelectionStatus();saveChooserState();diagnosticRecord('selection.all',{selectedQuestionIds:selectedQuestionIds()});});
  $('selectNoQuestions')?.addEventListener('click',()=>{root.querySelectorAll('.questionCheck').forEach(box=>{box.checked=false;});updateQuestionSelectionStatus();saveChooserState();diagnosticRecord('selection.none',{});});
  $('questionChecks')?.addEventListener('change',event=>{if(event.target?.classList?.contains('questionCheck')){updateQuestionSelectionStatus();saveChooserState();}});
  $('questionChecks')?.addEventListener('click',event=>{
    const toggle=event.target?.closest?.('.question-choice-toggle');
    if(!toggle)return;
    const node=toggle.closest('.question-item');
    setQuestionChooserExpanded(node,node?.dataset?.open!=='1');
  });
  $('questionSelect')?.addEventListener('change',()=>{
    const current=$('questionSelect').value;
    if($('multiQuestion')?.checked){
      const box=[...root.querySelectorAll('.questionCheck')].find(x=>String(x.value)===String(current));if(box)box.checked=true;
      updateQuestionSelectionStatus();
    }
    saveChooserState();
  });
  $('cancelPreviewBtn')?.addEventListener('click', async()=>{
    pendingPreview=null;
    if(globalThis.chrome?.runtime?.sendMessage){
      await chrome.runtime.sendMessage({type:'CARDINAL_DISCARD_PENDING_PREVIEW'}).catch(()=>{});
    }
  });

  function showStatus(title,text,kind=''){
    $('statusTitle').textContent=title;$('statusText').textContent=text;$('statusText').className=`notice ${kind}`;open('statusModal');
  }

  async function loadCatalog(){
    const r=await request('aiSectionsV2',{formativeId});
    if(!r?.ok)throw new Error(r?.message||'Impossible de lire Formative.');
    catalog=r;return r;
  }

  function pickSection(cat){
    const sections=Array.isArray(cat?.sections)?cat.sections:[];
    const p=params();
    const saved=loadChooserState();
    const current=String($('sectionSelect')?.value||'');
    const assignmentCandidates=[
      p.assignmentId,
      cat?.activeAssignmentId,
      current,
      saved?.assignmentId
    ].map(value=>String(value||'')).filter(Boolean);
    for(const id of assignmentCandidates){
      const hit=sections.find(x=>String(x.assignmentId)===id);
      if(hit)return hit;
    }
    const sectionCandidates=[cat?.activeSectionId].map(value=>String(value||'')).filter(Boolean);
    for(const id of sectionCandidates){
      const hit=sections.find(x=>String(x.sectionId)===id);
      if(hit)return hit;
    }
    return sections.length===1?sections[0]:null;
  }
  function pickQuestion(cat){
    const p=params();
    return (cat.questions||[]).find(x=>String(x.id)===String(p.questionId))
      || (cat.questions||[]).find(x=>p.routeQuestion&&(String(x.id)===String(p.routeQuestion)||String(x.number)===String(p.routeQuestion)))
      || ((cat.questions||[]).length===1?cat.questions[0]:null);
  }

  function fillChooser(cat){
    const ps=pickSection(cat),pq=pickQuestion(cat),saved=loadChooserState();
    $('sectionSelect').innerHTML=(cat.sections||[]).map(x=>`<option value="${esc(x.assignmentId)}" data-section="${esc(x.sectionId)}">${esc(x.title)}${x.studentCount?` (${x.studentCount} élèves)`:''}</option>`).join('');
    const savedSection=(cat.sections||[]).find(x=>String(x.assignmentId)===String(saved?.assignmentId||''));
    if(savedSection)$('sectionSelect').value=savedSection.assignmentId;
    else if(ps)$('sectionSelect').value=ps.assignmentId;
    $('questionSelect').innerHTML=(cat.questions||[]).map(q=>`<option value="${esc(q.id)}">Q${esc(q.number||'?')} · ${esc(q.label||'Question')} · /${esc(fmt(q.possiblePoints))}</option>`).join('');
    const savedQuestion=(cat.questions||[]).find(q=>String(q.id)===String(saved?.questionId||''));
    if(savedQuestion)$('questionSelect').value=savedQuestion.id;
    else if(pq)$('questionSelect').value=pq.id;
    const validIds=new Set((cat.questions||[]).map(q=>String(q.id)));
    const savedIds=new Set((saved?.selectedQuestionIds||[]).map(String).filter(id=>validIds.has(id)));
    const defaultId=String(savedQuestion?.id||pq?.id||'');
    $('questionChecks').innerHTML=(cat.questions||[]).map(q=>{
      const checked=savedIds.size?savedIds.has(String(q.id)):String(q.id)===defaultId;
      const title=`Q${q.number||'?'} · ${q.label||'Question'} · /${fmt(q.possiblePoints)}`;
      return `<div class="question-item" data-open="0" data-question-id="${esc(q.id)}"><input class="questionCheck" type="checkbox" value="${esc(q.id)}" ${checked?'checked':''}><button type="button" class="question-choice-toggle" aria-expanded="false" title="Afficher ou masquer la question complète"><span class="question-choice-title">${esc(title)}</span></button><div class="question-choice-body">${esc(q.label||'Question')}</div></div>`;
    }).join('');
    if(saved){
      $('multiQuestion').checked=!!saved.multiQuestion;
      $('commentsOnly').checked=!!saved.commentsOnly;
      $('includeGraded').checked=!!saved.includeGraded;
    }
    syncCorrectionModeUi();updateQuestionSelectionStatus();
    const detected=[];if(ps)detected.push(`Classe détectée : ${ps.title}`);if(pq)detected.push(`Question détectée : Q${pq.number||'?'}`);
    $('detectedText').textContent=detected.length?detected.join(' · '):'Aucune sélection unique détectée, choisis simplement ci-dessous.';
  }

  function selectedQuestionIds(){
    if(!$('multiQuestion')?.checked) return [$('questionSelect').value].filter(Boolean);
    return [...root.querySelectorAll('.questionCheck:checked')].map(x=>String(x.value||'')).filter(Boolean);
  }

  function syncCorrectionModeUi(){
    const multi=!!$('multiQuestion')?.checked;
    const commentsOnly=!!$('commentsOnly')?.checked;
    $('singleQuestionLabel')?.classList.toggle('hidden',multi);
    $('multiQuestionBlock')?.classList.toggle('hidden',!multi);
    $('includeGradedLabel')?.classList.toggle('hidden',commentsOnly);
  }

  async function makeStableBatchId(parts){
    const payload=JSON.stringify(parts);
    try{
      const bytes=new TextEncoder().encode(payload);
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      const hex=[...new Uint8Array(digest)].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
      return `cardinal-${hex}`;
    }catch{
      // Deterministic fallback if SubtleCrypto is unavailable.
      let h1=2166136261>>>0,h2=2246822519>>>0;
      for(let i=0;i<payload.length;i++){
        const c=payload.charCodeAt(i);
        h1=Math.imul(h1^c,16777619)>>>0;
        h2=Math.imul(h2^c,3266489917)>>>0;
      }
      return `cardinal-${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}`;
    }
  }

  function buildPrompt(ctx){
    const questions=Array.isArray(ctx.questions)&&ctx.questions.length?ctx.questions:(ctx.question?[ctx.question]:[]);
    const multi=questions.length>1;
    const commentsOnly=ctx.mode==='comments';
    const lines=[];
    lines.push(commentsOnly
      ? 'Je veux produire seulement des commentaires de rétroaction pour les réponses ci-dessous. Ne propose pas de notes et ne modifie aucun pointage.'
      : (multi
        ? 'Je veux corriger plusieurs questions avec toi en une seule fois. Tu peux proposer une correction, puis je pourrai te donner un barème, des exemples, un corrigé ou te demander d’ajuster certaines notes avant de finaliser.'
        : 'Je veux corriger cette question avec toi. Tu peux me proposer une correction, puis je pourrai te donner un barème, des exemples, ou te demander d’ajuster certaines notes avant de finaliser.'));
    lines.push('');
    lines.push('PROTOCOLE CARDINAL D’ÉVALUATION v1.1 — OBLIGATOIRE');
    lines.push('Objectif : produire une correction rigoureuse, juste, équitable, professionnelle et reproductible, même dans un nouveau chat ou un autre compte ChatGPT.');
    lines.push('1. Corrige d’abord de façon indépendante des pointages actuels de Formative. Ils sont une référence après coup seulement et ne doivent jamais servir de point d’ancrage.');
    lines.push('2. Avant de noter les élèves, établis silencieusement les critères de réussite uniquement à partir de la consigne, de la référence de correction détectée et des sources réellement fournies.');
    lines.push('3. N’invente jamais un fait du texte, un numéro de ligne ou de page, la présence d’un mot, une intention de l’auteur ou tout autre élément qui n’est pas vérifiable dans les informations fournies.');
    lines.push('4. Si la question dépend d’un texte, d’un passage, de lignes, de pages ou d’une autre source qui n’est pas fournie, et que cette source est nécessaire pour établir la note avec certitude, ne devine pas et ne produis pas de notes définitives. Indique clairement quelle source manque.');
    lines.push('5. Évalue le sens de la réponse, pas une correspondance mécanique de mots-clés, sauf si l’exactitude lexicale, grammaticale ou orthographique fait explicitement partie de ce qui est évalué. Une faute qui laisse l’intention sans ambiguïté ne doit pas changer la note si la langue n’est pas l’objet évalué.');
    lines.push('6. Deux réponses identiques ou sémantiquement équivalentes doivent recevoir le même traitement. Applique les mêmes tolérances, exigences et critères à tous les élèves, sans tenir compte de leur nom ni de leur pointage actuel.');
    lines.push('7. Pour une réponse à plusieurs éléments, évalue chaque élément séparément, ne compte un même élément qu’une seule fois et n’accorde pas de crédit supplémentaire pour une répétition.');
    lines.push('8. Si la consigne elle-même comporte une ambiguïté raisonnable, n’en fais pas porter la conséquence à un élève. Choisis une interprétation défendable et applique-la uniformément à tous.');
    lines.push('9. Avant de rendre le tableau final, effectue silencieusement une deuxième passe de cohérence : compare les cas similaires, les réponses équivalentes, les notes proches des seuils et les écarts avec Formative. Corrige toute incohérence détectée avant de répondre.');
    lines.push('10. Chaque décision finale doit pouvoir être justifiée par la consigne et les preuves disponibles. Si ce n’est pas possible avec assez de certitude, signale le manque d’information au lieu de fabriquer une décision.');
    lines.push('11. Si l’enseignant fournit ensuite un corrigé, un barème, une réponse attendue ou des exemples de correction, traite-les comme la référence pédagogique principale pour établir les attentes. Accepte les réponses sémantiquement équivalentes lorsqu’une formulation exacte n’est pas exigée. Si cette référence entre clairement en conflit avec la consigne ou une source vérifiable, signale le conflit au lieu de le résoudre arbitrairement.');
    lines.push('12. STYLE DES COMMENTAIRES : écris comme un enseignant de français du secondaire au Québec qui connaît ses élèves, dans un ton naturel, direct et professionnel. La plupart des commentaires devraient tenir en une à trois phrases. Évite les formulations génériques, trop lisses ou institutionnelles et varie réellement tes formulations d’un élève à l’autre.');
    lines.push('13. Tu peux commencer certains commentaires par « Salut », « Wow, c’est très bien », « C’est bon » ou, de temps en temps, par le prénom de l’élève, mais pas systématiquement. N’utilise pas d’émojis. N’ajoute pas volontairement de fautes pour paraître humain.');
    lines.push('14. Privilégie des formulations naturelles comme « Oublie pas de… », « Fais attention à… », « Pense à… », « Essaie de… », « Pour améliorer ta réponse… » ou « Fais en sorte que… » quand elles conviennent. Évite de répéter mécaniquement la même structure et évite le tiret cadratin.');
    lines.push('15. EXIGENCE DE CITATION POUR L’ÉLÈVE : lorsqu’un élève cite un texte, sa citation doit être entre guillemets français « … ». Si le texte fourni comporte des numéros de lignes, l’élève doit aussi indiquer la ou les lignes de son extrait. S’il cite sans indiquer les lignes alors qu’elles sont disponibles, signale-le naturellement dans le commentaire, par exemple : « Oublie pas d’indiquer la ou les lignes après ta citation. » ou « Pense à mettre les lignes de ton extrait. » N’invente jamais un numéro de ligne ou de page. Si le texte ne comporte pas de lignes numérotées, ne fais pas ce rappel. À moins que la consigne ou le barème l’exige explicitement pour la note, ce rappel ne doit pas entraîner automatiquement une perte de points.');
    lines.push('16. Quand c’est utile pour expliquer précisément ce qui fonctionne ou ce qui doit être corrigé, tu peux citer brièvement un extrait réellement disponible dans les sources. Utilise alors les guillemets français « … » et n’invente jamais une citation. L’objectif principal demeure toutefois de vérifier que l’élève, lui, indique les lignes lorsqu’il cite un texte numéroté.');
    lines.push('17. Si des échanges précédents de Formative sont fournis pour un élève, tiens-en compte et ne répète pas inutilement un commentaire déjà donné. Tu peux dire qu’il a bien amélioré un point seulement si l’historique et la réponse actuelle le montrent réellement. Si l’enseignant a déjà répondu au point soulevé et qu’il n’y a rien d’utile à ajouter, une formulation naturelle comme « J’ai rien à ajouter ici, c’est bon. » est acceptable. Ne prétends jamais qu’une discussion a eu lieu si aucun historique n’est fourni.');
    lines.push('18. Lorsqu’un bloc « CONTEXTE FOURNI À L’ÉLÈVE » est présent, il fait partie intégrante de la question. Utilise-le pour comprendre et corriger la question. Si Cardinal indique qu’un contexte parent ou un média n’a pas pu être relu, traite cette source comme manquante et ne l’invente pas.');
    lines.push('19. COMMENTAIRES ET POINTAGES SONT INDÉPENDANTS : lorsqu’un commentaire est demandé, ne jamais exclure un élève uniquement parce que sa réponse possède déjà un pointage dans Formative, y compris 0. Une réponse vide ou marquée « (vide) » reste admissible à un commentaire si Cardinal l’a fournie. Le pointage existant doit rester inchangé lorsqu’aucune nouvelle note n’est explicitement fournie. Un commentaire-synthèse demandé à une question peut s’appuyer sur les autres réponses de l’élève présentes dans ce lot.');
    if(commentsOnly){
      lines.push('20. MODE COMMENTAIRES SEULEMENT : formule une rétroaction utile, précise et actionnable à partir des réponses disponibles de l’élève. Ne donne aucune note, aucun score et aucun pourcentage. Tous les élèves transmis par Cardinal restent admissibles, même si la réponse de la question commentée est vide et déjà notée 0.');
    }
    lines.push('');
    lines.push(`Évaluation : ${ctx.title}`);
    lines.push(`Classe : ${ctx.sectionTitle}`);
    lines.push(`CARDINAL_BATCH_ID: ${ctx.batchId||ctx.sessionId}`);
    if(multi) {
      lines.push(`Questions sélectionnées : ${questions.map(q=>`Q${q.number||'?'}`).join(', ')}`);
      lines.push('');
      lines.push('PRÉSENTATION ATTENDUE POUR LA CORRECTION MULTI-QUESTION');
      lines.push('Présente d’abord la correction question par question, en prose compacte et lisible. Pour chaque question, résume les attentes ou critères utiles, puis signale seulement les cas qui méritent une explication ou une vérification.');
      lines.push('N’utilise aucun tableau avec des colonnes Élève, Note ou Commentaire dans cette partie. Le seul tableau importable doit être le tableau final unique demandé plus bas.');
    }
    lines.push('');

    for(const q of questions){
      lines.push(multi?`===== QUESTION Q${q.number||'?'} =====`:`Question ${q.number||''} sur ${fmt(q.possiblePoints)} points`);
      if(multi) lines.push(`Valeur : ${fmt(q.possiblePoints)} point${Number(q.possiblePoints)===1?'':'s'}`);
      const parentContext=Array.isArray(q.parentContext)?q.parentContext.filter(block=>block&&(block.text||block.hasMedia)):[];
      if(parentContext.length||q.parentContextMissing){
        lines.push('CONTEXTE FOURNI À L’ÉLÈVE');
        parentContext.forEach((block,index)=>{
          if(index>0) lines.push('');
          if(block.text) lines.push(block.text);
          if(block.hasMedia){
            const media=(Array.isArray(block.mediaTypes)?block.mediaTypes:[]).filter(Boolean).join(', ');
            lines.push(media?`[Média Formative présent dans ce contexte : ${media}. Son contenu n’est pas transcrit ici.]`:'[Média Formative présent dans ce contexte. Son contenu n’est pas transcrit ici.]');
          }
        });
        if(q.parentContextMissing) lines.push('[Cardinal a détecté un contexte parent Formative, mais n’a pas pu en relire tout le contenu. Traite la source manquante comme un blocage pour toute décision qui en dépend.]');
        lines.push('');
        lines.push('QUESTION');
      }
      lines.push(q.text||'');
      if(q.questionType) lines.push(`Type Formative : ${q.questionType}`);
      if(Array.isArray(q.expectedAnswers)&&q.expectedAnswers.length){
        lines.push('Référence de correction détectée dans Formative :');
        q.expectedAnswers.forEach((x,i)=>lines.push(`${i+1}. ${x}`));
      }
      lines.push('');
      if(!commentsOnly && ctx.reviewAlreadyGraded){
        lines.push('MODE RÉVISION : certains pointages ci-dessous viennent déjà de Formative. Ils sont fournis comme référence seulement et peuvent être remis en question.');
        lines.push('');
      } else if(!commentsOnly && Number(q.skippedAlreadyGraded||0)>0){
        lines.push(`${q.skippedAlreadyGraded} réponse(s) ont déjà un pointage dans Formative : elles sont exclues de la réévaluation de la NOTE, mais restent présentes comme contexte si un COMMENTAIRE est demandé.`);
        lines.push('');
      }
      lines.push('RÉPONSES DES ÉLÈVES');
      lines.push('');
      if(!(q.answers||[]).length){
        lines.push('Aucune réponse Formative n’existe pour cette question dans la classe sélectionnée. Il n’y a donc aucune cible de note ou de commentaire importable pour cette question.');
        lines.push('');
      }
      for(const a of q.answers||[]){
        if(a.hasMedia)continue;
        const blankResponse=a.responseBlank===true||!answerHasStudentContent(a);
        lines.push(`Élève : ${a.studentName}`);
        const structured=Array.isArray(a.structuredAnswers)?a.structuredAnswers.filter(x=>String(x||'').trim()&&String(x||'').trim()!=='(vide)'):[];
        if(!blankResponse&&structured.length>1){
          lines.push('Réponses structurées :');
          structured.forEach((x,i)=>lines.push(`${i+1}. ${x}`));
        }else if(blankResponse){
          lines.push('Réponse : (vide)');
        }else{
          lines.push(`Réponse : ${a.answerText}`);
        }
        if(!commentsOnly && a.gradeEligible===false){
          lines.push('Statut Cardinal : CONTEXTE POUR COMMENTAIRE SEULEMENT. Ne propose pas de nouvelle note pour cette réponse dans ce lot.');
        }
        if(Array.isArray(a.unresolvedTokens)&&a.unresolvedTokens.length){
          lines.push(`Note technique Cardinal : ${a.unresolvedTokens.length} identifiant(s) interne(s) n’ont pas pu être résolus et ont été ignorés.`);
        }
        const previousFeedback=Array.isArray(a.feedbackHistory)?a.feedbackHistory.filter(x=>x&&x.text):[];
        if(previousFeedback.length){
          lines.push('Échanges précédents dans Formative :');
          previousFeedback.forEach(x=>lines.push(`${x.role==='enseignant'?'Enseignant':(x.role==='élève'?'Élève':'Échange')} : ${x.text}`));
        }
        if(a.currentPoints!==null && a.currentPoints!==undefined && Number.isFinite(Number(a.currentPoints))){
          if(commentsOnly){
            lines.push(`Pointage actuel Formative : ${fmt(a.currentPoints)} / ${fmt(q.possiblePoints)} (information seulement; ce mode ne modifiera pas la note).`);
          }else if(ctx.reviewAlreadyGraded){
            lines.push(`Pointage actuel Formative : ${fmt(a.currentPoints)} / ${fmt(q.possiblePoints)}`);
          }else if(a.gradeEligible===false){
            lines.push(`Pointage actuel Formative : ${fmt(a.currentPoints)} / ${fmt(q.possiblePoints)} (à conserver; le commentaire est indépendant du pointage).`);
          }
        }
        lines.push('');
      }
    }

    lines.push('INSTRUCTION POUR LE RETOUR VERS FORMATIVE');
    if(commentsOnly){
      if(multi){
        lines.push('Termine chacune de tes réponses finales par UN tableau Markdown complet avec exactement ces colonnes : Question | Élève | Commentaire.');
        lines.push('Dans la colonne Question, écris Q suivi du numéro, par exemple Q3. Une ligne correspond à un élève pour une question. Ne mets aucune colonne Note.');
      }else{
        lines.push('Termine chacune de tes réponses finales par un tableau Markdown complet avec exactement ces colonnes : Élève | Commentaire.');
        lines.push('Ne mets aucune colonne Note, aucun score et aucun pourcentage.');
      }
      lines.push('Garde le nom de chaque élève exactement comme il est écrit ci-dessus. Une réponse marquée « (vide) » est une réponse présente et reste admissible à un commentaire. Un pointage actuel, y compris 0, ne doit jamais faire exclure l’élève.');
      lines.push('Si je demande un commentaire-synthèse à une question précise, tous les élèves transmis pour cette question peuvent recevoir ce commentaire, même ceux dont la réponse y est vide; utilise alors l’ensemble de leurs réponses disponibles dans le lot.');
      lines.push('Si je te demande ensuite de réviser les commentaires, renvoie à nouveau le tableau complet révisé à la fin.');
    }else if(multi){
      lines.push('Dès que tu proposes ou modifies des notes, termine chacune de tes réponses de correction par UN tableau Markdown complet avec exactement ces colonnes : Question | Élève | Note | Commentaire.');
      lines.push('Dans la colonne Question, écris Q suivi du numéro, par exemple Q3. Pour une ligne où tu proposes une nouvelle note, la note doit être numérique sur le maximum propre à cette question.');
      lines.push('Garde le nom de chaque élève exactement comme il est écrit ci-dessus. Si je demande uniquement un commentaire pour une réponse marquée « CONTEXTE POUR COMMENTAIRE SEULEMENT », laisse la cellule Note vide : cela signifie conserver le pointage Formative existant, jamais le remplacer par 0.');
      lines.push('Si je te demande ensuite de réviser, renvoie à nouveau le tableau complet pour TOUTES les questions sélectionnées afin que Cardinal puisse les renvoyer en un seul lot.');
      lines.push('Ne mets jamais une note à un élève dont la réponse est absente de la question correspondante.');
    }else{
      const q=questions[0]||{};
      lines.push('Dès que tu proposes ou modifies des notes, termine chacune de tes réponses de correction par un tableau Markdown complet avec exactement ces colonnes : Élève | Note | Commentaire. Je ne dois pas avoir à te redemander un format importable.');
      lines.push(`Pour une ligne où tu proposes une nouvelle note, la note doit être numérique sur ${fmt(q.possiblePoints)}. Garde le nom de chaque élève exactement comme il est écrit ci-dessus. Si je demande uniquement un commentaire pour une réponse marquée « CONTEXTE POUR COMMENTAIRE SEULEMENT », laisse la cellule Note vide afin de conserver le pointage existant.`);
      lines.push('Si je te demande ensuite de réviser, d’être plus sévère, d’appliquer un barème, de te baser sur des exemples ou de changer certaines notes, réévalue ce qui est pertinent et renvoie à nouveau le tableau complet révisé à la fin.');
      lines.push('Ne mets jamais une note à un élève dont la réponse est absente de la liste.');
    }
    if(!commentsOnly) lines.push('Pour une question à plusieurs champs, trous, choix ou éléments, évalue chaque élément séparément selon le sens de la réponse. Ne te limite pas à une correspondance exacte avec les mots-clés du corrigé Formative : accepte les formulations sémantiquement équivalentes lorsqu’elles répondent réellement à la consigne. Évite toutefois de compter deux fois le même élément répété dans plusieurs champs.');
    lines.push('Si je te demande explicitement, dans un suivi, de commenter seulement certains élèves et de ne rien envoyer aux autres, retourne uniquement les élèves concernés. N’ajoute pas de lignes vides pour compléter le lot et ne crée aucune note.');
    lines.push(`Juste avant le tableau final importable, recopie exactement cette ligne sur une ligne séparée : CARDINAL_BATCH_ID: ${ctx.batchId||ctx.sessionId}`);
    lines.push('Cardinal utilisera un tampon local : aucun résultat n’est écrit dans Formative avant la prévisualisation et la confirmation finale.');
    return lines.join('\n');
  }

  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

  function answerHasStudentContent(answer){
    if(!answer)return false;
    const structured=Array.isArray(answer.structuredAnswers)?answer.structuredAnswers.map(v=>String(v??'').trim()).filter(Boolean):[];
    if(structured.length && structured.every(v=>/^\(vide\)$/i.test(v))) return false;
    const text=String(answer.answerText||'').trim();
    if(!text)return false;
    const compact=text.replace(/(?:^|\n)\s*\d+\.\s*/g,' ').replace(/\s+/g,' ').trim();
    if(/^(?:\(vide\)\s*)+$/i.test(compact)) return false;
    return true;
  }

  function structuredReadGaps(prepared, questionIds){
    const wanted=new Set((questionIds||[]).map(String));
    const gaps=[];
    for(const q of prepared?.questions||[]){
      if(wanted.size&&!wanted.has(String(q.id)))continue;
      const unresolved=(q.answers||[]).filter(a=>{
        if(a?.hasMedia||!a?.studentName||a?.answerText)return false;
        const tokens=Array.isArray(a?.unresolvedTokens)?a.unresolvedTokens.filter(Boolean):[];
        return tokens.length>0;
      });
      if(unresolved.length)gaps.push({
        id:String(q.id||''),
        number:String(q.number||'?'),
        count:unresolved.length,
        students:unresolved.map(a=>String(a.studentName||'')).filter(Boolean)
      });
    }
    return gaps;
  }

  function answerReadQuality(answer){
    if(!answer)return -1;
    const text=String(answer.answerText||'').trim();
    const unresolved=Array.isArray(answer.unresolvedTokens)?answer.unresolvedTokens.filter(Boolean).length:0;
    const structured=Array.isArray(answer.structuredAnswers)?answer.structuredAnswers.filter(v=>String(v||'').trim()).length:0;
    return (text?100000+Math.min(text.length,5000):0)+(structured*100)-(unresolved*1000);
  }

  function mergePreparedReadable(base,next){
    if(!base)return next;
    if(!next)return base;
    const baseQuestions=new Map((base.questions||[]).map(q=>[String(q.id||''),q]));
    const mergedQuestions=(next.questions||[]).map(nextQ=>{
      const prevQ=baseQuestions.get(String(nextQ.id||''));
      if(!prevQ)return nextQ;
      const prevAnswers=new Map((prevQ.answers||[]).map(a=>[String(a.answerId||`${a.studentId||''}`),a]));
      const answers=(nextQ.answers||[]).map(nextA=>{
        const key=String(nextA.answerId||`${nextA.studentId||''}`);
        const prevA=prevAnswers.get(key);
        return prevA&&answerReadQuality(prevA)>answerReadQuality(nextA)?prevA:nextA;
      });
      for(const prevA of prevQ.answers||[]){
        const key=String(prevA.answerId||`${prevA.studentId||''}`);
        if(!answers.some(a=>String(a.answerId||`${a.studentId||''}`)===key))answers.push(prevA);
      }
      return {...prevQ,...nextQ,answers};
    });
    for(const prevQ of base.questions||[]){
      if(!mergedQuestions.some(q=>String(q.id||'')===String(prevQ.id||'')))mergedQuestions.push(prevQ);
    }
    return {...base,...next,questions:mergedQuestions};
  }

  async function prepareWithReadableRetry(payload, attempts=3){
    let best=null;
    for(let attempt=1;attempt<=attempts;attempt++){
      const current=await request('aiPrepareV2',payload);
      if(!current?.ok)return current;
      best=mergePreparedReadable(best,current);
      const gaps=structuredReadGaps(best,payload.questionIds);
      if(!gaps.length)return best;
      if(attempt<attempts){
        $('chooseStatus').textContent=`Cardinal complète automatiquement les réponses structurées (${gaps.map(g=>`Q${g.number}`).join(', ')}). Nouvelle lecture ${attempt+1}/${attempts}…`;
        $('chooseStatus').className='notice warn';$('chooseStatus').classList.remove('hidden');
        await wait(250*attempt);
      }else{
        best.structuredReadGaps=gaps;
      }
    }
    return best;
  }

  async function prepareAndCopy(){
    $('copyOpenBtn').disabled=true;$('chooseStatus').classList.add('hidden');
    diagnosticRecord('prepare.start',{formativeId,sectionValue:$('sectionSelect')?.value||null,selectedQuestionIds:selectedQuestionIds(),commentsOnly:!!$('commentsOnly')?.checked,includeGraded:!!$('includeGraded')?.checked});
    try{
      if(!catalog)await loadCatalog();
      const assignmentId=$('sectionSelect').value;const sec=(catalog.sections||[]).find(x=>String(x.assignmentId)===String(assignmentId));
      const questionIds=selectedQuestionIds();
      if(!sec||!questionIds.length)throw new Error('Choisis une classe et au moins une question.');
      const commentsOnly=!!$('commentsOnly')?.checked;
      const requestedMode=commentsOnly?'comments':'notes';
      let prepared;
      let notePublishingBlocked=false;
      let r=await prepareWithReadableRetry({formativeId,assignmentId:sec.assignmentId,sectionId:sec.sectionId,questionIds,mode:requestedMode});
      if(!r?.ok && !commentsOnly){
        const fallback=await prepareWithReadableRetry({formativeId,assignmentId:sec.assignmentId,sectionId:sec.sectionId,questionIds,mode:'comments'});
        if(!fallback?.ok)throw new Error(r?.message||fallback?.message||'Impossible de préparer ces questions.');
        prepared=fallback;notePublishingBlocked=true;
      }else if(!r?.ok){
        throw new Error(r?.message||'Impossible de préparer ces questions.');
      }else prepared=r;

      const preparedById=new Map((prepared.questions||[]).map(q=>[String(q.id),q]));
      const selectedCatalog=(catalog.questions||[]).filter(q=>questionIds.includes(String(q.id)));
      if(selectedCatalog.length!==questionIds.length){
        const known=new Set(selectedCatalog.map(q=>String(q.id)));
        const missingIds=questionIds.filter(id=>!known.has(String(id)));
        throw new Error(`La sélection locale contient ${missingIds.length} question${missingIds.length===1?'':'s'} qui ne sont plus dans le catalogue Formative. Rouvre le sélecteur avant de continuer.`);
      }
      const missingPrepared=selectedCatalog.filter(q=>!preparedById.has(String(q.id)));
      if(missingPrepared.length){
        throw new Error(`Cardinal n’a pas réussi à relire ${missingPrepared.map(q=>`Q${q.number||'?'}`).join(', ')}. Aucun prompt partiel n’a été créé. Reclique pour relancer uniquement la lecture.`);
      }
      const selected=selectedCatalog.map(q=>preparedById.get(String(q.id)));
      if(!selected.length)throw new Error('Les questions sélectionnées n’ont pas pu être relues.');
      diagnosticRecord('prepare.read.complete',{requestedQuestionCount:questionIds.length,preparedQuestionCount:(prepared.questions||[]).length,selectedQuestionCount:selected.length,assignmentId:prepared.assignmentId||sec.assignmentId||null,sectionId:prepared.sectionId||sec.sectionId||null});

      const remainingStructuredGaps=structuredReadGaps(prepared,questionIds);
      if(remainingStructuredGaps.length){
        const detail=remainingStructuredGaps.map(g=>{
          const names=(g.students||[]).slice(0,3).join(', ');
          return `Q${g.number} (${g.count} réponse${g.count===1?'':'s'}${names?` : ${names}${g.students.length>3?'…':''}`:''})`;
        }).join(', ');
        throw new Error(`Cardinal n’a pas pu décoder ${detail}. Les réponses vides ne sont plus considérées comme des erreurs. Ta classe et toutes tes questions restent mémorisées : reclique sur « Copier et ouvrir ChatGPT » pour relancer uniquement la lecture, sans refaire la sélection.`);
      }

      let includeGraded=!commentsOnly && !!$('includeGraded')?.checked;
      const promptQuestions=[];
      let totalReadable=0,totalAlreadyGraded=0,totalUngraded=0,totalGradeEligible=0,totalCommentEligible=0,totalBlankCommentEligible=0;
      for(const q of selected){
        // IMPORTANT: note eligibility and comment eligibility are distinct.
        // Every real Formative answer node stays available for comments, even when
        // already graded (including 0) or textually blank. Existing grading only
        // controls whether ChatGPT may propose a NEW NOTE for that row.
        const readable=(q.answers||[]).filter(a=>!a.hasMedia&&a.studentName);
        const alreadyGraded=readable.filter(a=>a.currentPoints!==null&&a.currentPoints!==undefined&&Number.isFinite(Number(a.currentPoints)));
        const ungraded=readable.filter(a=>a.currentPoints===null||a.currentPoints===undefined||!Number.isFinite(Number(a.currentPoints)));
        totalReadable+=readable.length;totalAlreadyGraded+=alreadyGraded.length;totalUngraded+=ungraded.length;
        const answersForPrompt=readable.map(a=>{
          const hasText=answerHasStudentContent(a);
          const currentlyGraded=a.currentPoints!==null&&a.currentPoints!==undefined&&Number.isFinite(Number(a.currentPoints));
          const gradeEligible=!commentsOnly&&hasText&&(includeGraded||!currentlyGraded);
          if(gradeEligible)totalGradeEligible++;
          totalCommentEligible++;
          if(!hasText)totalBlankCommentEligible++;
          return {...a,gradeEligible,commentEligible:true,responseBlank:!hasText,preserveExistingPoints:currentlyGraded&&!includeGraded};
        });
        const noteExcludedAlreadyGraded=commentsOnly||includeGraded?0:alreadyGraded.filter(answerHasStudentContent).length;
        // A selected question stays in the batch even when it has no grade target.
        // Comment targets, including blank/0 answers, remain attached to the batch.
        promptQuestions.push({...q,answers:answersForPrompt,skippedAlreadyGraded:noteExcludedAlreadyGraded,selectedNoEligibleAnswers:!answersForPrompt.some(a=>a.gradeEligible)});
      }

      if(!commentsOnly && totalReadable>0 && totalAlreadyGraded===totalReadable && !includeGraded){
        includeGraded=confirm(`${selected.length>1?'Les questions sélectionnées sont':'Cette question est'} déjà notée${selected.length>1?'s':''} dans Formative (${totalAlreadyGraded}/${totalReadable}).\n\nVeux-tu quand même envoyer les réponses et les pointages actuels à ChatGPT pour vérifier ou revoir l’autocorrection?`);
        if(includeGraded){
          $('includeGraded').checked=true;
          return await prepareAndCopy();
        }
        throw new Error('Aucune réponse non notée à corriger. Coche « Inclure aussi les réponses déjà notées par Formative » si tu veux revoir l’autocorrection.');
      }

      if(totalCommentEligible===0){
        const hasChoiceLike=selected.some(q=>(q.answers||[]).some(a=>Array.isArray(a?.unresolvedTokens)&&a.unresolvedTokens.filter(Boolean).length));
        if(hasChoiceLike) throw new Error('Cardinal n’a pas pu traduire les réponses structurées après plusieurs lectures serveur. Les sélections sont conservées : clique de nouveau sur « Copier et ouvrir ChatGPT » pour réessayer.');
        throw new Error('Aucune réponse Formative exploitable n’a été trouvée pour les questions sélectionnées.');
      }
      if(!commentsOnly&&totalGradeEligible===0){
        throw new Error('Aucune réponse écrite n’est admissible à une nouvelle note dans ce lot. Pour produire des commentaires sans modifier les pointages existants, active « Commentaires seulement ».');
      }

      // Batch identity is based on what the teacher selected, not on the subset of
      // questions that happen to contain an eligible response at this instant.
      const selectedStableIds=selected.map(q=>String(q.id)).sort();
      const stableBatchId=await makeStableBatchId({
        formativeId:String(formativeId||''),
        assignmentId:String(prepared.assignmentId||sec.assignmentId||''),
        sectionId:String(prepared.sectionId||sec.sectionId||''),
        mode:commentsOnly?'comments':'notes',
        selectedQuestionIds:selectedStableIds
      });
      const ctx={
        version:'CARDINAL_BATCH_V113',createdAt:Date.now(),sessionId:crypto.randomUUID(),batchId:stableBatchId,formativeId,title:prepared.title,
        assignmentId:prepared.assignmentId,sectionId:prepared.sectionId,sectionTitle:prepared.sectionTitle,groupCode:prepared.groupCode,
        notePublishingBlocked:commentsOnly||notePublishingBlocked,
        reviewAlreadyGraded:includeGraded,
        mode:commentsOnly?'comments':'notes',
        multiQuestion:selected.length>1,
        selectedQuestionIds:selected.map(q=>String(q.id)),
        questions:promptQuestions,
        question:promptQuestions.length===1?promptQuestions[0]:null
      };
      const prompt=buildPrompt(ctx);
      $('chooseStatus').textContent=commentsOnly
        ? `${selected.length}/${questionIds.length} questions sélectionnées · ${totalCommentEligible} réponse${totalCommentEligible===1?'':'s'} disponible${totalCommentEligible===1?'':'s'} pour commentaires${totalBlankCommentEligible?` · ${totalBlankCommentEligible} vide${totalBlankCommentEligible===1?'':'s'} incluse${totalBlankCommentEligible===1?'':'s'}`:''}.`
        : `${selected.length}/${questionIds.length} questions sélectionnées · ${totalGradeEligible} réponse${totalGradeEligible===1?'':'s'} admissible${totalGradeEligible===1?'':'s'} à une nouvelle note · ${totalCommentEligible} disponible${totalCommentEligible===1?'':'s'} pour commentaires.`;
      $('chooseStatus').className='notice ok';$('chooseStatus').classList.remove('hidden');
      if(!await copyText(prompt))throw new Error('Je n’ai pas réussi à copier les réponses. Réessaie après avoir autorisé le presse-papiers pour Formative.');
      if(!globalThis.chrome?.runtime?.sendMessage) throw new Error('Le pont Cardinal n’est plus actif. Recharge Formative puis réessaie.');
      const sr=await chrome.runtime.sendMessage({type:'CARDINAL_SAVE_SIMPLE_CONTEXT',context:ctx});
      if(!sr?.ok)throw new Error(sr?.message||'Impossible de mémoriser le lot de correction.');
      close('chooseModal');
      const openResult=await chrome.runtime.sendMessage({type:'CARDINAL_OPEN_CHATGPT'});
      diagnosticRecord('prepare.success',{batchId:ctx.batchId,sessionId:ctx.sessionId,questionCount:selected.length,gradeEligible:totalGradeEligible,commentEligible:totalCommentEligible,blankCommentEligible:totalBlankCommentEligible,chatgptOpened:openResult?.ok===true});
      if(!openResult?.ok)showStatus('Réponses copiées','Les réponses sont dans le presse-papiers. Ouvre ChatGPT et colle-les.','ok');
    }catch(e){diagnosticRecord('prepare.error',{message:e?.message||String(e),selectedQuestionIds:selectedQuestionIds(),sectionValue:$('sectionSelect')?.value||null},'error');$('chooseStatus').textContent=e?.message||String(e);$('chooseStatus').className='notice err';$('chooseStatus').classList.remove('hidden');}
    finally{$('copyOpenBtn').disabled=false;}
  }


  async function openCorrection(){
    const b=$('correctBtn');b.disabled=true;
    diagnosticRecord('correction.open.start',{formativeId});
    try{const c=await loadCatalog();diagnosticRecord('correction.catalog.loaded',{sectionCount:(c.sections||[]).length,questionCount:(c.questions||[]).length,activeAssignmentId:c.activeAssignmentId||null,activeSectionId:c.activeSectionId||null});fillChooser(c);open('chooseModal');diagnosticRecord('correction.modal.opened',{sectionValue:$('sectionSelect')?.value||null,selectedQuestionIds:selectedQuestionIds()});}
    catch(e){diagnosticRecord('correction.open.error',{message:e?.message||String(e)},'error');showStatus('Formative',e?.message||String(e),'err');}
    finally{b.disabled=false;}
  }

  let previewProblemsOnly=false;

  function renderPreviewGroups(preview){
    const groups=previewQuestionGroups(preview);
    const problemsOnly=previewProblemsOnly===true;
    let visibleCount=0;
    $('previewQuestions').innerHTML=groups.map(group=>{
      const hasProblem=group.issues.length>0;
      if(problemsOnly&&!hasProblem)return '';
      visibleCount++;
      const graded=group.rows.filter(({row})=>row.points!==null&&row.points!==undefined&&Number.isFinite(Number(row.points)));
      const comments=group.rows.filter(({row})=>String(row.comment||'').trim()).length;
      const avg=graded.length?graded.reduce((sum,{row})=>sum+Number(row.points),0)/graded.length:null;
      const max=Number.isFinite(Number(group.possiblePoints))?Number(group.possiblePoints):null;
      const stats=[`${group.rows.length} élève${group.rows.length===1?'':'s'}`];
      if(max!==null)stats.push(`/${fmt(max)}`);
      if(avg!==null&&max!==null)stats.push(`moyenne ${fmt(avg)}/${fmt(max)}`);
      if(comments)stats.push(`${comments} commentaire${comments===1?'':'s'}`);
      if(hasProblem)stats.push(`${group.issues.length} problème${group.issues.length===1?'':'s'} technique${group.issues.length===1?'':'s'}`);
      const issueHtml=hasProblem?`<div class="q-issues notice err">${group.issues.map(x=>esc(`${x.kind} : ${x.text}`)).join('<br>')}</div>`:'';
      const rowsHtml=group.rows.map(({row,index})=>`<div class="student-row"><input type="checkbox" class="rowCheck" data-index="${index}" checked><div><div class="student-name">${esc(row.studentName)}</div><div class="student-old">Ancienne : ${esc(fmt(row.originalPoints))}</div></div><div class="student-score">${row.points===null||row.points===undefined?'-':`${esc(fmt(row.points))}/${esc(fmt(row.possiblePoints))}`}</div>${String(row.comment||'').trim()?`<div class="student-comment">${esc(row.comment)}</div>`:''}</div>`).join('')||'<div class="preview-empty" style="margin:10px">Aucune correction reconnue pour cette question.</div>';
      return `<div class="question-preview" data-open="0" data-has-problem="${hasProblem?'1':'0'}" data-question-number="${esc(group.number)}"><button type="button" class="question-preview-toggle" aria-expanded="false"><span class="q-summary">Q${esc(group.number)} · ${esc(stats.join(' · '))}</span></button><div class="question-preview-body">${issueHtml}<div class="student-list">${rowsHtml}</div></div></div>`;
    }).join('');
    $('previewNoProblems').classList.toggle('hidden',!(problemsOnly&&visibleCount===0));
    $('previewProblemsOnly').textContent=problemsOnly?'Afficher toutes les questions':'Afficher seulement les problèmes';
  }

  function renderPreview(preview){
    pendingPreview=preview;
    previewProblemsOnly=false;
    const questions=Array.isArray(preview.context?.questions)&&preview.context.questions.length?preview.context.questions:(preview.context?.question?[preview.context.question]:[]);
    const rows=preview.rows||[];
    const questionCount=new Set(rows.map(r=>String(r.questionId||r.formativeItemId||'')).filter(Boolean)).size || questions.length || 1;
    const singleQ=questionCount===1?(rows[0]?.questionNumber||questions[0]?.number||'?'):null;
    $('previewTitle').textContent=questionCount>1?`${questionCount} questions · vérifier le lot avant publication`:`Q${singleQ||'?'} · vérifier avant publication`;
    const notes=rows.filter(r=>r.points!==null&&r.points!==undefined).length;
    const comments=rows.filter(r=>String(r.comment||'').trim()).length;
    $('previewSummary').innerHTML=`<span class="pill">${questionCount} question${questionCount===1?'':'s'}</span><span class="pill">${rows.length} correction${rows.length===1?'':'s'}</span><span class="pill">${notes} note${notes===1?'':'s'}</span><span class="pill">${comments} commentaire${comments===1?'':'s'}</span><span class="pill">Tampon local · aucune écriture avant Publier</span>`;
    const problems=[];
    if(preview.unmatched?.length)problems.push(`${preview.unmatched.length} nom${preview.unmatched.length===1?' non reconnu':'s non reconnus'} : ${preview.unmatched.slice(0,6).join(', ')}`);
    if(preview.ambiguous?.length)problems.push(`${preview.ambiguous.length} correspondance${preview.ambiguous.length===1?' ambiguë':'s ambiguës'} : ${preview.ambiguous.slice(0,6).join(', ')}`);
    if(preview.invalid?.length)problems.push(`${preview.invalid.length} ligne${preview.invalid.length===1?' invalide':'s invalides'} : ${preview.invalid.slice(0,4).join(', ')}`);
    if(preview.missingQuestions?.length)problems.push(`Import partiel : aucune ligne reçue pour ${preview.missingQuestions.map(q=>`Q${q}`).join(', ')}. Ces questions resteront inchangées dans Formative.`);
    if(preview.missingRows?.length)problems.push(`Import partiel : ${preview.missingRows.length} réponse${preview.missingRows.length===1?' attendue':'s attendues'} n${preview.missingRows.length===1?'’a':'’ont'} pas de ligne dans le tableau final. Elles resteront inchangées : ${preview.missingRows.slice(0,8).join(', ')}${preview.missingRows.length>8?'…':''}`);
    $('previewWarning').textContent=problems.join('\n');$('previewWarning').classList.toggle('hidden',!problems.length);
    const commentsOnly=preview.context?.mode==='comments';
    $('publishNotes').checked=!commentsOnly&&notes>0&&!preview.context?.notePublishingBlocked;$('publishNotes').disabled=commentsOnly||!!preview.context?.notePublishingBlocked||!notes;
    $('publishComments').checked=comments>0;$('publishComments').disabled=!comments;
    $('publishBtn').disabled=!!preview.blockPublication;
    renderPreviewGroups(preview);
    $('publishStatus').classList.add('hidden');open('previewModal');
  }


  async function publishPreview(){
    if(!pendingPreview)return;
    if(pendingPreview.blockPublication){
      $('publishStatus').textContent='Publication bloquée par l’intégrité technique du lot. Corrige les lignes non reconnues, ambiguës ou invalides avant de publier.';
      $('publishStatus').className='notice err';
      $('publishStatus').classList.remove('hidden');
      return;
    }
    const publishNotes=$('publishNotes').checked,publishComments=$('publishComments').checked;
    if(!publishNotes&&!publishComments){$('publishStatus').textContent='Choisis Notes, Commentaires, ou les deux.';$('publishStatus').className='notice err';$('publishStatus').classList.remove('hidden');return;}
    const selected=new Set([...root.querySelectorAll('.rowCheck:checked')].map(x=>Number(x.dataset.index)));
    const corrections=(pendingPreview.rows||[]).filter((_,i)=>selected.has(i)).map(r=>({...r,publishNote:publishNotes&&r.points!==null&&r.points!==undefined,publishComment:publishComments&&!!String(r.comment||'').trim()}));
    if(!corrections.length)return;
    const b=$('publishBtn');b.disabled=true;$('publishStatus').textContent='Vérification de Formative avant écriture…';$('publishStatus').className='notice';$('publishStatus').classList.remove('hidden');
    try{
      const c=pendingPreview.context;
      const publishPayload={sessionId:c.sessionId,formativeId:c.formativeId,assignmentId:c.assignmentId,sectionId:c.sectionId,groupCode:c.groupCode,corrections,publishNotes,publishComments,copyCommentsToGestion:false};
      let r=await request('aiPublishV2',publishPayload);
      if(!r?.ok||!r.publishOk){
        const errs=Array.isArray(r?.errors)?r.errors:[];
        const stale=errs.filter(x=>x?.kind==='stale-answer');
        const other=errs.filter(x=>x?.kind!=='stale-answer');
        if(stale.length&&!other.length){
          const names=[...new Set(stale.map(x=>String(x?.studentName||'').trim()).filter(Boolean))];
          const details=stale.map(x=>x?.message).filter(Boolean).join('\n');
          const label=names.length?names.join(', '):`${stale.length} réponse${stale.length===1?'':'s'}`;
          const force=window.confirm(`La réponse de ${stale.length===1?'cet élève':'ces élèves'} a changé depuis la préparation :\n\n${label}\n\nLa note et le commentaire ont été préparés à partir de l’ancienne réponse.\n\nOK = publier quand même\nAnnuler = ne rien publier`);
          if(!force){
            $('publishStatus').textContent=`Publication annulée. Réponse${stale.length===1?'':'s'} modifiée${stale.length===1?'':'s'} : ${label}.`;
            $('publishStatus').className='notice warn';
            return;
          }
          $('publishStatus').textContent=`Publication forcée après confirmation. Je revérifie les autres conflits…`;
          $('publishStatus').className='notice warn';
          r=await request('aiPublishV2',{...publishPayload,allowChangedAnswers:true});
        }
      }
      if(!r?.ok||!r.publishOk){const msg=(r?.errors||[]).slice(0,8).map(x=>x.message).join('\n')||r?.message||'Publication bloquée.';throw new Error(msg);}
      const doneText=publishNotes
        ? `Terminé : ${r.notesUpdated||0} note${Number(r.notesUpdated||0)===1?'':'s'} mise${Number(r.notesUpdated||0)===1?'':'s'} à jour${r.notesAlready?`, ${r.notesAlready} déjà correcte${r.notesAlready===1?'':'s'}`:''}${r.notesVerified?' · relecture serveur confirmée':''}${publishComments?` · ${r.commentsAdded||0} commentaire${Number(r.commentsAdded||0)===1?'':'s'} ajouté${Number(r.commentsAdded||0)===1?'':'s'}`:''}.`
        : `Terminé : ${r.commentsAdded||0} commentaire${Number(r.commentsAdded||0)===1?'':'s'} ajouté${Number(r.commentsAdded||0)===1?'':'s'}${r.commentsSkippedDuplicate?` · ${r.commentsSkippedDuplicate} déjà présent${r.commentsSkippedDuplicate===1?'':'s'}`:''}.`;
      $('publishStatus').textContent=doneText;
      $('publishStatus').className='notice ok';
      pendingPreview=null;
      if(globalThis.chrome?.runtime?.sendMessage) await chrome.runtime.sendMessage({type:'CARDINAL_CLEAR_SIMPLE_CONTEXT'}).catch(()=>{});
      close('previewModal');
      showStatus('Publication terminée',doneText,'ok');
    }catch(e){$('publishStatus').textContent=e?.message||String(e);$('publishStatus').className='notice err';}
    finally{b.disabled=false;}
  }

  function loadGlobalState(){
    try{
      const value=JSON.parse(sessionStorage.getItem(GLOBAL_STATE_KEY)||'null');
      return value&&typeof value==='object'?value:null;
    }catch{return null;}
  }

  function fillGlobalChooser(cat){
    const sections=Array.isArray(cat?.sections)?cat.sections:[];
    const saved=loadGlobalState();
    $('globalSectionSelect').innerHTML=sections.map(x=>`<option value="${esc(x.assignmentId)}">${esc(x.title||'Classe')}${x.studentCount?` (${x.studentCount} élèves)`:''}</option>`).join('');
    const wanted=[saved?.assignmentId,loadChooserState()?.assignmentId,cat?.activeAssignmentId]
      .map(value=>String(value||''))
      .find(id=>sections.some(x=>String(x.assignmentId)===id));
    if(wanted)$('globalSectionSelect').value=wanted;
    $('globalStatus').classList.add('hidden');
    diagnosticRecord('global.chooser.opened',{sections:sections.map(x=>({assignmentId:x.assignmentId,sectionId:x.sectionId,title:x.title||null,studentCount:Number(x.studentCount||0)})),preselectedAssignmentId:$('globalSectionSelect').value||null});
  }

  async function sendGlobalSection(sec){
    const b=$('globalSendBtn');
    if(b)b.disabled=true;
    const status=$('globalStatus');
    if(status){status.textContent='Lecture des résultats du groupe…';status.className='notice';status.classList.remove('hidden');}
    diagnosticRecord('global.send.start',{formativeId,assignmentId:sec?.assignmentId||null,sectionId:sec?.sectionId||null,title:sec?.title||null});
    try{
      if(!sec?.assignmentId||!sec?.sectionId)throw new Error('Classe Formative invalide.');
      try{sessionStorage.setItem(GLOBAL_STATE_KEY,JSON.stringify({assignmentId:String(sec.assignmentId),sectionId:String(sec.sectionId),title:String(sec.title||'')}));}catch{}
      diagnosticRecord('global.section.selected',{assignmentId:sec.assignmentId,sectionId:sec.sectionId,title:sec.title||null});
      const r=await request('sendGlobalToGestionV3',{formativeId,assignmentId:sec.assignmentId,sectionId:sec.sectionId});
      if(!r?.ok)throw new Error(r?.message||'Impossible de transmettre les résultats.');
      diagnosticRecord('global.send.success',{assignmentId:sec.assignmentId,sectionId:sec.sectionId,studentCount:r.studentCount||0,questionCount:r.questionCount||0});
      if(status){status.textContent=`${sec.title||'Classe'} : ${r.studentCount||0} élève${Number(r.studentCount||0)===1?'':'s'} transmis vers Gestion des notes.`;status.className='notice ok';}
      setTimeout(()=>close('globalModal'),900);
    }catch(e){
      diagnosticRecord('global.send.error',{assignmentId:sec?.assignmentId||null,sectionId:sec?.sectionId||null,message:e?.message||String(e)},'error');
      if(status){status.textContent=e?.message||String(e);status.className='notice err';status.classList.remove('hidden');}
    }finally{if(b)b.disabled=false;}
  }

  async function sendGlobal(){
    const launcher=$('gestionBtn');
    if(launcher)launcher.disabled=true;
    diagnosticRecord('global.chooser.start',{formativeId});
    try{
      const c=await loadCatalog();
      const sections=Array.isArray(c.sections)?c.sections:[];
      diagnosticRecord('global.catalog.loaded',{sectionCount:sections.length,sections:sections.map(x=>({assignmentId:x.assignmentId,sectionId:x.sectionId,title:x.title||null,studentCount:Number(x.studentCount||0)})),activeAssignmentId:c.activeAssignmentId||null,activeSectionId:c.activeSectionId||null});
      if(!sections.length)throw new Error('Aucune classe assignée à ce Formative n’a été trouvée.');
      fillGlobalChooser(c);
      open('globalModal');
    }catch(e){
      diagnosticRecord('global.chooser.error',{message:e?.message||String(e)},'error');
      showStatus('Gestion des notes',e?.message||String(e),'err');
    }finally{if(launcher)launcher.disabled=false;}
  }

  async function confirmGlobalSelection(){
    const c=catalog||await loadCatalog();
    const assignmentId=String($('globalSectionSelect')?.value||'');
    const sec=(c.sections||[]).find(x=>String(x.assignmentId)===assignmentId);
    if(!sec){
      $('globalStatus').textContent='Choisis une classe valide.';
      $('globalStatus').className='notice err';
      $('globalStatus').classList.remove('hidden');
      return;
    }
    await sendGlobalSection(sec);
  }

  $('correctBtn').addEventListener('click',openCorrection);
  $('copyOpenBtn').addEventListener('click',prepareAndCopy);
  function setPreviewExpanded(node,openState){
    if(!node)return;
    const isOpen=!!openState;
    node.dataset.open=isOpen?'1':'0';
    const toggle=node.querySelector('.question-preview-toggle');
    if(toggle)toggle.setAttribute('aria-expanded',isOpen?'true':'false');
  }
  $('previewQuestions').addEventListener('click',event=>{
    const toggle=event.target?.closest?.('.question-preview-toggle');
    if(!toggle)return;
    const node=toggle.closest('.question-preview');
    setPreviewExpanded(node,node?.dataset?.open!=='1');
  });
  $('previewOpenAll').addEventListener('click',()=>{root.querySelectorAll('#previewQuestions .question-preview').forEach(node=>setPreviewExpanded(node,true));});
  $('previewCloseAll').addEventListener('click',()=>{root.querySelectorAll('#previewQuestions .question-preview').forEach(node=>setPreviewExpanded(node,false));});
  $('previewProblemsOnly').addEventListener('click',()=>{previewProblemsOnly=!previewProblemsOnly;if(pendingPreview)renderPreviewGroups(pendingPreview);});
  $('publishBtn').addEventListener('click',publishPreview);
  $('gestionBtn').addEventListener('click',sendGlobal);
  $('globalSendBtn')?.addEventListener('click',confirmGlobalSelection);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse)=>{
    if(window.__cardinalFormativeSimpleActiveToken!==INSTANCE_TOKEN) return;
    if(message?.type==='CARDINAL_SIMPLE_PING'){
      sendResponse({ok:true,bridgeVersion:BRIDGE_VERSION,extensionBuild:EXTENSION_BUILD,instanceToken:INSTANCE_TOKEN});
      return;
    }
    if(message?.type==='CARDINAL_SIMPLE_DIAGNOSTICS'){
      sendResponse({
        ok:true,bridgeVersion:BRIDGE_VERSION,extensionBuild:EXTENSION_BUILD,instanceToken:INSTANCE_TOKEN,formativeId,
        catalogLoaded:!!catalog,sectionCount:(catalog?.sections||[]).length,questionCount:(catalog?.questions||[]).length,
        sections:(catalog?.sections||[]).map(x=>({assignmentId:x.assignmentId,sectionId:x.sectionId,title:x.title||null,studentCount:Number(x.studentCount||0)})),
        activeAssignmentId:catalog?.activeAssignmentId||null,activeSectionId:catalog?.activeSectionId||null,
        sectionValue:$('sectionSelect')?.value||null,selectedQuestionIds:selectedQuestionIds(),
        chooseModalOpen:!$('chooseModal')?.classList.contains('hidden'),globalModalOpen:!$('globalModal')?.classList.contains('hidden'),globalSectionValue:$('globalSectionSelect')?.value||null,previewModalOpen:!$('previewModal')?.classList.contains('hidden'),
        chooserState:loadChooserState()||null,pendingPreview:!!pendingPreview
      });
      return;
    }
    if(message?.type==='CARDINAL_SIMPLE_IMPORT_PREVIEW'&&message.preview){renderPreview(message.preview);return;}
    if(message?.type==='CARDINAL_FORMATIVE_UI'&&message.message){
      // Keep background status messages unobtrusive unless they are errors.
      if(message.status==='error')showStatus(message.title||'Formative',message.message,'err');
    }
  });

  // Restore a pending ChatGPT import if the page was reloaded before the preview appeared.
  chrome.storage.local.get('cardinal_simple_pending_preview_v092').then(async o=>{
    const p=o?.cardinal_simple_pending_preview_v092;
    const fresh=!!p?.createdAt && Date.now()-Number(p.createdAt)<=12*60*60*1000;
    if(!fresh){
      if(p) await chrome.runtime.sendMessage({type:'CARDINAL_DISCARD_PENDING_PREVIEW'}).catch(()=>{});
      return;
    }
    if(p?.context?.formativeId===formativeId)renderPreview(p);
  }).catch(()=>{});
})();