(() => {
  const BRIDGE_VERSION = '1.1.8';
  const HOST_ID = 'cardinal-chatgpt-bridge-1180';
  const RELOAD_QUEUE_KEY = 'cardinal_chatgpt_reload_queue_v1180';
  const INLINE_BAR_ATTR = 'data-cardinal-results-bar-v118';

  // Same live extension context: don't create a duplicate instance.
  if (window.__cardinalChatGptBridgeVersion === BRIDGE_VERSION) return;
  window.__cardinalChatGptBridgeVersion = BRIDGE_VERSION;

  // After an unpacked-extension reload, every previous Cardinal content script can
  // keep running in the page with a dead chrome.runtime. Hide ALL older Cardinal
  // ChatGPT hosts, regardless of their version. This prevents a anciennes versions
  // button from surviving beside the fresh bridge.
  const staleHosts = [
    ...document.querySelectorAll('[id^="cardinal-chatgpt-bridge-"]'),
    document.getElementById('cardinal-chatgpt-bridge-092')
  ].filter(Boolean);
  for (const stale of [...new Set(staleHosts)]) {
    try {
      const oldId = stale.id || 'cardinal-chatgpt-bridge';
      stale.id = `${oldId}-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      stale.style.setProperty('display', 'none', 'important');
      stale.style.setProperty('visibility', 'hidden', 'important');
      stale.style.setProperty('pointer-events', 'none', 'important');
    } catch {}
  }

  const host=document.createElement('div');
  host.id=HOST_ID;
  host.style.all='initial';
  document.documentElement.appendChild(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`
  <style>
    *{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647}.btn{border:0;border-radius:12px;background:#132a4a;color:#fff;padding:11px 15px;font-weight:750;cursor:pointer;box-shadow:0 8px 26px rgba(15,35,64,.28);font-size:13px}.btn:disabled{opacity:.55;cursor:wait}
    .panel{position:fixed;right:18px;bottom:68px;z-index:2147483647;width:min(440px,calc(100vw - 36px));background:#fff;color:#172033;border:1px solid #d9e1ec;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.2);padding:14px;display:grid;gap:10px}.hidden{display:none!important}.title{font-weight:800;font-size:14px}.small{font-size:12px;line-height:1.45;color:#5b6b80;white-space:pre-wrap}.ok{color:#17653a}.err{color:#9b2626}.ta{width:100%;min-height:150px;border:1px solid #cbd5e1;border-radius:10px;padding:9px;resize:vertical;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.actions{display:flex;gap:8px;justify-content:flex-end}.secondary{border:1px solid #cbd5e1;background:#fff;color:#24364f;border-radius:9px;padding:8px 11px;font-weight:700;cursor:pointer}.primary{border:0;background:#132a4a;color:#fff;border-radius:9px;padding:8px 11px;font-weight:700;cursor:pointer}
  </style>
  <div class="wrap"><button id="sendBtn" class="btn hidden">Envoyer les résultats dans Formative</button></div>
  <div id="panel" class="panel hidden"><div class="title">Résultats pour Formative</div><div id="msg" class="small"></div><textarea id="paste" class="ta hidden" placeholder="Si la détection automatique ne trouve pas le tableau, colle ici la réponse finale de ChatGPT."></textarea><div class="actions"><button id="cancel" class="secondary">Fermer</button><button id="parsePaste" class="primary hidden">Envoyer ce texte</button></div></div>`;
  const $=id=>root.getElementById(id);
  let cachedContext=null;
  let contextRefreshInFlight=false;
  let lastContextRefresh=0;

  function diagnosticRecord(event,data={},level='info'){
    try{chrome.runtime?.sendMessage?.({type:'CARDINAL_DIAGNOSTIC_RECORD',scope:'chatgpt-correction',event,data,level}).catch(()=>{});}catch{}
  }
  try{
    window.addEventListener('error',event=>diagnosticRecord('window.error',{message:event?.message||'Erreur JavaScript',filename:event?.filename||null,lineno:event?.lineno||null,colno:event?.colno||null},'error'));
    window.addEventListener('unhandledrejection',event=>diagnosticRecord('window.unhandledrejection',{message:event?.reason?.message||String(event?.reason||'')},'error'));
  }catch{}

  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
  function cleanCell(v){return String(v??'').replace(/\s+/g,' ').trim();}
  function isVisible(node){
    if(!node || !(node instanceof Element)) return false;
    const r=node.getBoundingClientRect();
    const st=getComputedStyle(node);
    return st.display!=="none" && st.visibility!=="hidden" && r.width>0 && r.height>0;
  }
  function turnRole(turn){
    if(!turn) return '';
    const own=String(turn.getAttribute?.('data-message-author-role')||'').toLowerCase();
    if(own==='assistant'||own==='user') return own;

    const marked=turn.querySelector?.('[data-message-author-role="assistant"],[data-message-author-role="user"]');
    const nested=String(marked?.getAttribute?.('data-message-author-role')||'').toLowerCase();
    if(nested==='assistant'||nested==='user') return nested;

    if(turn.matches?.('[data-testid="user-message"]') || turn.querySelector?.('[data-testid="user-message"]')) return 'user';
    if(turn.matches?.('[data-testid="assistant-message"]') || turn.querySelector?.('[data-testid="assistant-message"]')) return 'assistant';

    if(/:assistant$/i.test(String(turn.getAttribute?.('data-chatgpt-search-unit-key')||''))) return 'assistant';
    if(/:assistant$/i.test(String(turn.getAttribute?.('data-content-search-unit-key')||''))) return 'assistant';
    if(turn.hasAttribute?.('data-user-message-bubble') || turn.querySelector?.('[data-user-message-bubble]')) return 'user';

    const testid=String(turn.getAttribute?.('data-testid')||'').toLowerCase();
    if(testid.includes('assistant')) return 'assistant';
    if(testid.includes('user')) return 'user';

    // Be conservative. A rendered Markdown/prose block is a strong assistant signal.
    // An unknown last turn must NOT inherit the previous assistant table.
    if(turn.querySelector?.('.markdown, .prose, [class*="markdown"], [class*="prose"]')) return 'assistant';
    return '';
  }

  function conversationTurns(){
    const selectors=[
      'main [data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]'
    ];
    for(const selector of selectors){
      const all=[...document.querySelectorAll(selector)];
      if(!all.length) continue;
      // Keep only outermost turn containers if the DOM ever nests matching nodes.
      const outer=all.filter(node=>!all.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : all;
    }

    const units=[...document.querySelectorAll(
      '[data-chatgpt-search-unit-key$=":assistant"],[data-content-search-unit-key$=":assistant"],[data-user-message-bubble]'
    )];
    if(units.length){
      const outer=units.filter(node=>!units.some(other=>other!==node && other.contains(node)));
      return outer.length ? outer : units;
    }
    return [];
  }

  // A table is actionable only when it belongs to the CURRENT LAST conversation
  // turn and that turn is confidently identified as assistant. Never search backward
  // for an older assistant table after the user has spoken or after a text-only reply.
  function latestAssistantContainer(){
    const turns=conversationTurns();
    if(turns.length){
      const last=turns[turns.length-1];
      return turnRole(last)==='assistant' ? last : null;
    }

    // Fallback only when ChatGPT exposes no conversation-turn containers at all.
    // Scope to the exact last role node, never to a broad <article> ancestor that
    // could contain multiple messages and an older grading table.
    const roleNodes=[...document.querySelectorAll('[data-message-author-role="assistant"],[data-message-author-role="user"]')];
    if(roleNodes.length){
      const latest=roleNodes[roleNodes.length-1];
      const role=String(latest.getAttribute('data-message-author-role')||'').toLowerCase();
      return role==='assistant' ? latest : null;
    }

    // If the DOM shape is unknown, hide the action rather than risk publishing a
    // stale table from an earlier response.
    return null;
  }

  function extractQuestionNumber(text){
    const raw=String(text||'');
    const patterns=[
      /\bquestion\s*#?\s*(\d{1,3})\b/i,
      /\bq\s*#?\s*(\d{1,3})\b/i
    ];
    for(const re of patterns){
      const m=raw.match(re);
      if(m) return String(Number(m[1]));
    }
    return '';
  }

  function inferConversationQuestionNumber(){
    const turns=conversationTurns();
    if(turns.length){
      // Look only at the most recent local conversation window. This lets follow-ups
      // such as "redonne moi Q3" remain bound to Q3, while preventing an older Q2
      // context from silently receiving a newer Q3 table.
      for(let i=turns.length-1,seen=0;i>=0&&seen<8;i--,seen++){
        const q=extractQuestionNumber(turns[i].innerText||turns[i].textContent||'');
        if(q) return q;
      }
    }
    const last=latestAssistantContainer();
    return extractQuestionNumber(last?.innerText||last?.textContent||'');
  }

  function inferConversationBatchId(){
    // New batches ask ChatGPT to echo the id immediately before the final table.
    // Prefer the latest assistant turn because large user pastes can be converted
    // into an attachment and disappear from the visible DOM.
    const last=latestAssistantContainer();
    if(last){
      const text=String(last.innerText||last.textContent||'');
      const m=text.match(/CARDINAL_BATCH_ID\s*:\s*([A-Za-z0-9-]{8,})/i);
      if(m) return m[1];
    }

    const turns=conversationTurns();
    for(let i=turns.length-1;i>=0;i--){
      if(turnRole(turns[i])!=='user') continue;
      const text=String(turns[i].innerText||turns[i].textContent||'');
      const m=text.match(/CARDINAL_BATCH_ID\s*:\s*([A-Za-z0-9-]{8,})/i);
      if(m) return m[1];
    }
    return '';
  }

  function rowsAreCommentsOnly(rows){
    return Array.isArray(rows) && rows.length>0 && rows.every(r=>{
      const grade=String(r?.grade ?? r?.note ?? '').trim();
      const comment=String(r?.comment ?? r?.feedback ?? r?.commentaire ?? '').trim();
      return !grade && !!comment;
    });
  }

  function structuralBatchMatch(rows,ctx,{allowSubset=false}={}){
    const questions=contextQuestions(ctx);
    if(!questions.length || !Array.isArray(rows) || !rows.length) return false;

    const multi=questions.length>1;
    const expected=new Map();
    const qNumbers=new Set();

    for(const q of questions){
      const qn=String(Number(q?.number||''));
      if(!qn || qn==='NaN') return false;
      qNumbers.add(qn);
      for(const a of Array.isArray(q?.answers)?q.answers:[]){
        const student=norm(a?.studentName||'');
        if(!student) continue;
        const key=`${qn}|${student}`;
        expected.set(key,(expected.get(key)||0)+1);
      }
    }
    const expectedTotal=[...expected.values()].reduce((a,b)=>a+b,0);
    if(!expected.size || (!allowSubset && rows.length!==expectedTotal) || (allowSubset && rows.length>expectedTotal)) return false;

    const actual=new Map();
    for(const r of rows){
      let qn='';
      if(multi){
        const m=String(r?.question||'').match(/(?:question|q)?\s*#?\s*(\d{1,3})/i);
        qn=m?String(Number(m[1])):'';
      }else{
        qn=String(Number(questions[0]?.number||''));
      }
      if(!qn || !qNumbers.has(qn)) return false;
      const student=norm(r?.name||'');
      if(!student) return false;
      const key=`${qn}|${student}`;
      if(!expected.has(key)) return false;
      const next=(actual.get(key)||0)+1;
      if(next>Number(expected.get(key)||0)) return false;
      actual.set(key,next);
    }

    if(allowSubset) return actual.size>0;
    if(actual.size!==expected.size) return false;
    for(const [key,count] of expected){
      if(actual.get(key)!==count) return false;
    }
    return true;
  }


  async function refreshContextHint(force=false){
    const now=Date.now();
    if(contextRefreshInFlight) return cachedContext;
    if(!force && now-lastContextRefresh<1200) return cachedContext;
    contextRefreshInFlight=true;
    lastContextRefresh=now;
    try{
      const r=await chrome.runtime.sendMessage({type:'CARDINAL_GET_SIMPLE_CONTEXT'});
      cachedContext=r?.ok?r.context:null;
    }catch(e){
      cachedContext=null;
    }finally{
      contextRefreshInFlight=false;
    }
    refreshButton();
    return cachedContext;
  }

  function columnIndexes(headers){
    const h=headers.map(norm);
    const nameIdx=h.findIndex(x=>x==='eleve'||x==='nom'||x.includes('eleve')||x.includes('student'));
    const questionIdx=h.findIndex(x=>x==='question'||x==='q'||x.startsWith('question ')||x.includes('numero question'));
    const gradeIdx=h.findIndex(x=>x==='note'||x.includes('note')||x.includes('resultat')||x.includes('score'));
    const commentIdx=h.findIndex(x=>x.includes('comment')||x.includes('retroaction')||x.includes('feedback'));
    return {nameIdx,questionIdx,gradeIdx,commentIdx,valid:nameIdx>=0&&(gradeIdx>=0||commentIdx>=0)};
  }

  function rowFromCells(cells,idx){
    const name=cells[idx.nameIdx]||'';
    const question=idx.questionIdx>=0?(cells[idx.questionIdx]||''):'';
    const grade=idx.gradeIdx>=0?(cells[idx.gradeIdx]||''):'';
    const comment=idx.commentIdx>=0?(cells[idx.commentIdx]||''):'';
    if(!name||(!grade&&!comment))return null;
    return {name,question,grade,comment};
  }

  function parseTable(table){
    let idx=columnIndexes([...table.querySelectorAll('thead th')].map(x=>x.textContent));
    const bodyRows=[...table.querySelectorAll('tbody tr')];
    if(!idx.valid&&bodyRows.length){
      const first=[...bodyRows[0].querySelectorAll('td,th')].map(x=>x.textContent);
      const candidate=columnIndexes(first);
      if(candidate.valid){idx=candidate;bodyRows.shift();}
    }
    if(!idx.valid)return [];
    const rows=[];
    for(const tr of bodyRows){
      const cells=[...tr.querySelectorAll('td,th')].map(x=>cleanCell(x.textContent));
      if(!cells.length)continue;
      const row=rowFromCells(cells,idx);if(row)rows.push(row);
    }
    return rows;
  }

  function parseMarkdownText(text){
    const raw=String(text||'');
    const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const all=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];if(!line.includes('|'))continue;
      const headers=line.replace(/^\||\|$/g,'').split('|').map(cleanCell);
      const idx=columnIndexes(headers);
      if(!idx.valid)continue;
      const rows=[];
      let j=i+1;
      for(;j<lines.length;j++){
        const l=lines[j];if(!l.includes('|')){if(rows.length)break;continue;}
        const cells=l.replace(/^\||\|$/g,'').split('|').map(cleanCell);
        if(cells.every(c=>/^:?-{2,}:?$/.test(c)))continue;
        const row=rowFromCells(cells,idx);if(row)rows.push(row);
      }
      if(rows.length){all.push(...rows);i=j-1;}
    }
    if(all.length)return all;

    const tsv=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(tsv.length>=2){
      const idx=columnIndexes(tsv[0].split(/\t+/));
      if(idx.valid){
        const rows=[];
        for(const line of tsv.slice(1)){
          const row=rowFromCells(line.split(/\t+/).map(cleanCell),idx);if(row)rows.push(row);
        }
        if(rows.length)return rows;
      }
    }
    return [];
  }

  function parseLatestAssistant(){
    const last=latestAssistantContainer();
    if(!last)return [];
    const tables=[...last.querySelectorAll('table')];
    if(last.matches?.('table'))tables.push(last);
    const combined=[];
    for(const table of tables){
      const rows=parseTable(table);
      if(rows.length)combined.push(...rows);
    }
    if(combined.length)return combined;
    return parseMarkdownText(last.innerText||last.textContent||'');
  }


  function assistantContainerFor(node){
    if(!node) return null;
    const turns=conversationTurns();
    for(const turn of turns){
      if(turn.contains(node) && turnRole(turn)==='assistant') return turn;
    }
    const roleNode=node.closest?.('[data-message-author-role="assistant"]');
    if(roleNode) return roleNode;
    const article=node.closest?.('article');
    if(article && turnRole(article)==='assistant') return article;
    return null;
  }

  function extractBatchId(text){
    const m=String(text||'').match(/CARDINAL_BATCH_ID\s*:\s*([A-Za-z0-9-]{8,})/i);
    return m?m[1]:'';
  }

  function questionNumberForBatch(batchId){
    const wanted=String(batchId||'').trim();
    if(!wanted) return '';
    const turns=conversationTurns();
    for(const preferredRole of ['user','assistant']){
      for(let i=turns.length-1;i>=0;i--){
        if(turnRole(turns[i])!==preferredRole) continue;
        const turnText=String(turns[i].innerText||turns[i].textContent||'');
        if(extractBatchId(turnText)!==wanted) continue;
        const q=extractQuestionNumber(turnText);
        if(q) return q;
      }
    }
    return '';
  }

  function promptTextForBatch(batchId,message){
    const wanted=String(batchId||'').trim();
    if(!wanted) return '';
    const turns=conversationTurns();
    const idx=message?turns.findIndex(t=>t===message || t.contains(message) || message.contains?.(t)):-1;
    const start=idx>=0?idx-1:turns.length-1;
    for(let i=start;i>=0;i--){
      if(turnRole(turns[i])!=='user') continue;
      const text=String(turns[i].innerText||turns[i].textContent||'');
      if(extractBatchId(text)===wanted) return text;
    }
    return '';
  }

  function normalizeLotEvidence(value){
    return String(value||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .replace(/[’']/g,' ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function promptMatchesActiveLot(binding,ctx){
    const raw=normalizeLotEvidence(binding?.promptText||'');
    if(!raw) return false;
    const title=normalizeLotEvidence(ctx?.title||'');
    const section=normalizeLotEvidence(ctx?.sectionTitle||'');
    if(title.length>=6 && !raw.includes(title)) return false;
    if(section.length>=6 && !raw.includes(section)) return false;
    const questions=contextQuestions(ctx);
    if(!questions.length) return false;
    for(const q of questions){
      const number=String(Number(q?.number||''));
      if(!number || number==='NaN') return false;
      if(!raw.includes(`question q${number}`) && !raw.includes(`question ${number}`)) return false;
      const qText=normalizeLotEvidence(q?.text||'');
      if(qText.length>=18){
        const evidence=qText.slice(0,Math.min(72,qText.length));
        if(!raw.includes(evidence)) return false;
      }
    }
    return true;
  }

  const REBOUND_STORAGE_KEY='cardinal.formative.batchRebind.v118';

  function rebindToken(oldBatch,newBatch,rows){
    return `${String(oldBatch||'')}|${String(newBatch||'')}|${rowsSignature(rows)}`;
  }

  function isRememberedRebind(oldBatch,newBatch,rows){
    try{
      const root=JSON.parse(sessionStorage.getItem(REBOUND_STORAGE_KEY)||'{}');
      const token=rebindToken(oldBatch,newBatch,rows);
      const at=Number(root?.[token]||0);
      return at>0 && Date.now()-at<24*60*60*1000;
    }catch{return false;}
  }

  function rememberRebind(oldBatch,newBatch,rows){
    try{
      const root=JSON.parse(sessionStorage.getItem(REBOUND_STORAGE_KEY)||'{}');
      const now=Date.now();
      for(const [key,at] of Object.entries(root)){
        if(now-Number(at||0)>24*60*60*1000) delete root[key];
      }
      root[rebindToken(oldBatch,newBatch,rows)]=now;
      sessionStorage.setItem(REBOUND_STORAGE_KEY,JSON.stringify(root));
    }catch{}
  }

  function activeLotLabel(ctx){
    const qs=contextQuestions(ctx).map(q=>`Q${String(q?.number||'?')}`).join(', ');
    return [String(ctx?.title||'').trim(),String(ctx?.sectionTitle||'').trim(),qs].filter(Boolean).join(' · ');
  }

  // Bind an inline action to the table's own conversation neighborhood, never to
  // whatever the newest ChatGPT answer happens to be when the teacher clicks it.
  function localBindingFor(node){
    const message=assistantContainerFor(node);
    let batchId=extractBatchId(message?.innerText||message?.textContent||'');
    let batchConfidence=batchId?'message':'';
    let questionNumber=batchId?questionNumberForBatch(batchId):extractQuestionNumber(message?.innerText||message?.textContent||'');
    const turns=conversationTurns();
    const idx=message?turns.findIndex(t=>t===message || t.contains(message) || message.contains?.(t)):-1;
    if(idx>=0 && (!batchId || !questionNumber)){
      let seen=0;
      let crossedAssistant=false;
      for(let i=idx-1;i>=0 && seen<10;i--,seen++){
        const role=turnRole(turns[i]);
        const text=String(turns[i].innerText||turns[i].textContent||'');
        if(!batchId){
          const b=extractBatchId(text);
          if(b){
            batchId=b;
            batchConfidence=!crossedAssistant && role==='user'?'prompt':'history';
            questionNumber=questionNumberForBatch(b)||questionNumber;
          }
        }
        if(!questionNumber){
          const q=extractQuestionNumber(text);
          if(q) questionNumber=q;
        }
        if(batchId && questionNumber) break;
        if(role==='assistant') crossedAssistant=true;
      }
    }
    const promptText=batchId?promptTextForBatch(batchId,message):'';
    return {message,batchId,batchConfidence,questionNumber,promptText,isInline:true};
  }

  function rowsSignature(rows){
    const raw=JSON.stringify((rows||[]).map(r=>[
      norm(r?.name), cleanCell(r?.question), cleanCell(r?.grade), cleanCell(r?.comment)
    ]));
    let h=2166136261;
    for(let i=0;i<raw.length;i++){
      h^=raw.charCodeAt(i);
      h=Math.imul(h,16777619);
    }
    return (h>>>0).toString(36);
  }

  function inlineBarForTable(table){
    const tableId=String(table?.dataset?.cardinalResultsTableIdV118||'');
    if(!tableId) return null;
    const message=assistantContainerFor(table);
    const scope=message||document;
    return [...scope.querySelectorAll(`[${INLINE_BAR_ATTR}]`)]
      .find(bar=>bar.dataset.tableId===tableId) || null;
  }

  function setInlineStatus(bar,text,type=''){
    const status=bar?.querySelector?.('[data-cardinal-inline-status]');
    if(!status) return;
    status.textContent=String(text||'');
    status.style.display=text?'block':'none';
    status.style.color=type==='error'?'#9b2626':(type==='ok'?'#17653a':'inherit');
  }

  function placeInlineBar(table,bar){
    // ChatGPT often wraps tables in an overflow container. Place the Cardinal box
    // after that local table branch so it stays visually attached to the table.
    let host=table;
    for(let i=0;i<3 && host?.parentElement;i++){
      const parent=host.parentElement;
      if(parent.querySelectorAll?.('table').length!==1) break;
      const cls=String(parent.className||'');
      if(/overflow|table/i.test(cls) && !/markdown|prose/i.test(cls)) host=parent;
      else break;
    }
    host.insertAdjacentElement('afterend',bar);
  }

  function buildInlineBar(table,rows){
    const binding=localBindingFor(table);
    const commentsOnly=rowsAreCommentsOnly(rows);
    const sig=rowsSignature(rows);
    table.dataset.cardinalResultsSigV118=sig;
    if(!table.dataset.cardinalResultsTableIdV118){
      table.dataset.cardinalResultsTableIdV118=`crt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
    }
    const tableId=table.dataset.cardinalResultsTableIdV118;

    const bar=document.createElement('div');
    bar.setAttribute(INLINE_BAR_ATTR,'1');
    bar.dataset.tableSignature=sig;
    bar.dataset.tableId=tableId;
    bar.style.cssText=[
      'display:grid','gap:7px','padding:10px 12px','margin:8px 0 14px',
      'border:1px solid rgba(127,127,127,.30)','border-radius:12px',
      'background:rgba(127,127,127,.055)','font:600 13px/1.3 system-ui,sans-serif'
    ].join(';');

    const top=document.createElement('div');
    top.style.cssText='display:flex;align-items:center;gap:10px;min-width:0';
    const info=document.createElement('span');
    info.style.cssText='opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    const count=rows.length;
    const q=binding.questionNumber?` · Q${binding.questionNumber}`:'';
    info.textContent=commentsOnly
      ? `Cardinal · ${count} commentaire${count===1?'':'s'}${q}`
      : `Cardinal · ${count} résultat${count===1?'':'s'}${q}`;

    const button=document.createElement('button');
    button.type='button';
    button.textContent='Envoyer dans Formative';
    button.style.cssText=[
      'margin-left:auto','padding:8px 12px','border-radius:8px','border:0',
      'background:#132a4a','color:#fff','font:700 13px system-ui,sans-serif',
      'cursor:pointer','white-space:nowrap'
    ].join(';');

    const status=document.createElement('div');
    status.setAttribute('data-cardinal-inline-status','1');
    status.style.cssText='display:none;font:500 12px/1.4 system-ui,sans-serif;opacity:.86;white-space:pre-wrap';

    button.addEventListener('click',async()=>{
      if(button.disabled) return;
      button.disabled=true;
      button.style.opacity='.62';
      button.style.cursor='wait';
      setInlineStatus(bar,'Je prépare ce tableau précis pour Formative…');
      try{
        const freshRows=parseTable(table);
        if(!freshRows.length) throw new Error('Ce tableau n’est plus lisible. Recharge la page ChatGPT puis réessaie.');
        const freshBinding=localBindingFor(table);
        const r=await sendRows(freshRows,'Tableau ChatGPT',freshBinding,{bar});
        if(r?.reloading) return;
        const issueCount=Number(r?.unmatched||0)+Number(r?.ambiguous||0)+Number(r?.invalid||0)+Number(r?.missing||0);
        setInlineStatus(
          bar,
          `${r?.recognized||0} ligne${Number(r?.recognized||0)===1?'':'s'} reconnue${Number(r?.recognized||0)===1?'':'s'}. Formative est ouvert pour la vérification.${issueCount?`\nÀ corriger avant publication : ${issueCount} problème${issueCount===1?'':'s'}.`:''}`,
          issueCount?'':'ok'
        );
        button.textContent='Renvoyer dans Formative';
      }catch(e){
        setInlineStatus(bar,e?.message||String(e),'error');
      }finally{
        button.disabled=false;
        button.style.opacity='1';
        button.style.cursor='pointer';
      }
    });

    top.append(info,button);
    bar.append(top,status);
    placeInlineBar(table,bar);
    return bar;
  }

  function scanInlineBars(){
    const validTables=new Set();
    for(const turn of conversationTurns()){
      if(turnRole(turn)!=='assistant') continue;
      const tables=[...turn.querySelectorAll('table')];
      for(const table of tables){
        const rows=parseTable(table);
        if(!rows.length) continue;
        validTables.add(table);
        const sig=rowsSignature(rows);
        let bar=inlineBarForTable(table);
        if(bar && bar.dataset.tableSignature===sig) continue;
        if(bar) bar.remove();
        buildInlineBar(table,rows);
      }
    }

    // Fallback for DOM variants without conversation-turn wrappers.
    if(!conversationTurns().length){
      const assistants=[...document.querySelectorAll('[data-message-author-role="assistant"]')];
      for(const turn of assistants){
        for(const table of turn.querySelectorAll('table')){
          const rows=parseTable(table);
          if(!rows.length) continue;
          const sig=rowsSignature(rows);
          let bar=inlineBarForTable(table);
          if(bar && bar.dataset.tableSignature===sig) continue;
          if(bar) bar.remove();
          buildInlineBar(table,rows);
        }
      }
    }
  }


  function contextQuestions(ctx=cachedContext){
    return Array.isArray(ctx?.questions)&&ctx.questions.length?ctx.questions:(ctx?.question?[ctx.question]:[]);
  }

  function refreshButton(){
    const questions=contextQuestions();
    const hasContext=questions.length>0;
    const rows=hasContext?parseLatestAssistant():[];
    const hasResultsTable=hasContext&&rows.length>0;
    if($('sendBtn')){
      const commentsOnly=rows.length>0&&rows.every(r=>!String(r.grade||'').trim())&&rows.some(r=>String(r.comment||'').trim());
      const rowCount=rows.length;
      if(questions.length>1) {
        $('sendBtn').textContent=commentsOnly
          ? `Envoyer ${rowCount} commentaire${rowCount===1?'':'s'} · ${questions.length} questions`
          : `Envoyer ${rowCount} résultat${rowCount===1?'':'s'} · ${questions.length} questions`;
      } else {
        const q=String(questions[0]?.number||'').trim();
        $('sendBtn').textContent=commentsOnly
          ? `Envoyer ${rowCount} commentaire${rowCount===1?'':'s'}${q?` · Q${q}`:''}`
          : `Envoyer ${rowCount} résultat${rowCount===1?'':'s'}${q?` · Q${q}`:''}`;
      }
    }
    const latest=latestAssistantContainer();
    const hasInlineLatest=!!latest?.querySelector?.(`[${INLINE_BAR_ATTR}]`);
    $('sendBtn')?.classList.toggle('hidden',!hasResultsTable||hasInlineLatest);
    if(!hasResultsTable && !$('panel')?.classList.contains('hidden')) $('panel').classList.add('hidden');
    return hasResultsTable;
  }


  function isContextInvalidated(error){
    const msg=String(error?.message||error||'');
    return /extension context invalidated/i.test(msg);
  }

  function queueReloadRecovery(rows,source,error,binding=null){
    // Never reload ChatGPT automatically. Extension updates can invalidate an
    // already-running content-script context; navigating the page here can loop
    // and hammer ChatGPT conversation endpoints. Preserve nothing for auto-replay.
    try { sessionStorage.removeItem(RELOAD_QUEUE_KEY); } catch {}
    $('panel').classList.remove('hidden');
    $('paste').classList.add('hidden');
    $('parsePaste').classList.add('hidden');
    $('msg').className='small err';
    $('msg').textContent='Cardinal a été mis à jour pendant que cette page était ouverte. Recharge ChatGPT manuellement une seule fois, puis relance l’envoi. Aucun résultat n’a été envoyé automatiquement.';
    return {ok:false,reloading:false,contextInvalidated:true};
  }

  async function sendRows(rows,source='ChatGPT',binding=null,inlineUi=null){
    if(!rows.length)throw new Error('Aucun tableau de notes ou de commentaires compatible n’a été trouvé.');
    diagnosticRecord('send.start',{rowCount:rows.length,source,bindingBatchId:binding?.batchId||null,bindingQuestionNumber:binding?.questionNumber||null,bindingConfidence:binding?.batchConfidence||null,isInline:binding?.isInline===true});

    let ctxResult;
    try {
      ctxResult=await chrome.runtime.sendMessage({type:'CARDINAL_GET_SIMPLE_CONTEXT'});
    } catch(error) {
      if(isContextInvalidated(error)) {
        queueReloadRecovery(rows,source,error,binding);
        return {ok:false,reloading:true};
      }
      throw error;
    }
    const ctx=ctxResult?.ok?ctxResult.context:null;
    const questions=contextQuestions(ctx);
    if(!questions.length || !ctx?.sessionId){
      cachedContext=null;refreshButton();
      throw new Error('Aucun lot Formative actif. Retourne dans Formative et utilise « Préparer une correction ».');
    }
    cachedContext=ctx;refreshButton();
    diagnosticRecord('context.loaded',{version:ctx?.version||null,batchId:ctx?.batchId||null,sessionId:ctx?.sessionId||null,formativeId:ctx?.formativeId||null,questionCount:questions.length,mode:ctx?.mode||null});

    let batchBindingRecovered=false;
    let batchBindingPartial=false;
    let exactBatchBinding=false;
    const commentsOnlyRows=rowsAreCommentsOnly(rows);
    if(/^CARDINAL_BATCH_V11(?:0|3)$/.test(String(ctx?.version||''))){
      const conversationBatch=String(binding ? (binding.batchId||'') : (inferConversationBatchId()||''));
      const expectedBatch=String(ctx?.batchId||ctx?.sessionId||'');
      exactBatchBinding=!!conversationBatch && conversationBatch===expectedBatch;
      if(!exactBatchBinding){
        // A new preparation creates a fresh session. The stable batch id should stay
        // identical for the same target, but older Cardinal versions and review-mode
        // changes can still leave a valid table carrying an older id. Never force the
        // teacher to regenerate the correction when the active lot can be proven to
        // target exactly the same question/student structure.
        const exactStructure=structuralBatchMatch(rows,ctx);
        const safeActiveSubset=structuralBatchMatch(rows,ctx,{allowSubset:true});
        const explicitMismatch=binding?.isInline && /^(?:message|prompt)$/.test(String(binding?.batchConfidence||'')) && conversationBatch && conversationBatch!==expectedBatch;
        if(explicitMismatch){
          // Batch ids are correlation hints, not pedagogical identity. If every row
          // maps unambiguously to a question/student that exists in the freshly
          // prepared active lot, keep the teacher's work and continue to preview.
          // The worker still rejects unknown/ambiguous/invalid targets, and a
          // partial table is shown as a partial import rather than silently filled.
          if(!safeActiveSubset){
            throw new Error('Sécurité Cardinal : certaines lignes de ce tableau ne correspondent pas au lot Formative actif. Les lignes inconnues doivent être corrigées avant l’envoi.');
          }
          rememberRebind(conversationBatch,expectedBatch,rows);
          batchBindingRecovered=true;
          batchBindingPartial=!exactStructure;
        }
        if(!batchBindingRecovered){
          // Large pastes can become attachments, making the id invisible in the DOM.
          // Accept any non-empty subset only when every supplied row maps to the
          // active lot. Completeness is verified and displayed in the preview.
          if(!safeActiveSubset){
            if(!conversationBatch){
              throw new Error('Sécurité Cardinal : l’identifiant du lot n’est pas lisible et certaines lignes ne correspondent pas au lot Formative actif.');
            }
            throw new Error('Sécurité Cardinal : certaines lignes de ce tableau ne correspondent pas au lot Formative actif.');
          }
          batchBindingRecovered=true;
          batchBindingPartial=!exactStructure;
        }
      }
    }

    diagnosticRecord('batch.binding.checked',{exactBatchBinding,batchBindingRecovered,batchBindingPartial,commentsOnlyRows,conversationBatch:String(binding ? (binding.batchId||'') : (inferConversationBatchId()||'')),expectedBatch:String(ctx?.batchId||ctx?.sessionId||'')});
    const allowedNumbers=new Set(questions.map(q=>String(Number(q?.number))).filter(x=>x&&x!=='NaN'));
    if(questions.length>1){
      const missing=rows.filter(r=>!String(r.question||'').trim());
      if(missing.length) throw new Error('Ce lot contient plusieurs questions. Le tableau final doit avoir une colonne « Question » avec Q suivi du numéro pour chaque ligne.');
      const unknown=[];
      for(const r of rows){
        const m=String(r.question||'').match(/(?:question|q)?\s*#?\s*(\d{1,3})/i);
        const n=m?String(Number(m[1])):'';
        if(!n||!allowedNumbers.has(n)) unknown.push(String(r.question||'?'));
      }
      if(unknown.length) throw new Error(`Question(s) non reconnue(s) dans le tableau : ${[...new Set(unknown)].slice(0,6).join(', ')}.`);
    }else{
      const targetQ=String(questions[0]?.number||'').trim();
      const conversationQ=String(binding ? (binding.questionNumber||'') : (inferConversationQuestionNumber()||''));
      if(!exactBatchBinding && conversationQ && targetQ && String(Number(conversationQ))!==String(Number(targetQ))){
        throw new Error(`Sécurité Cardinal : le tableau actuel parle de Q${conversationQ}, mais la question encore en mémoire est Q${targetQ}. Reprépare Q${conversationQ} dans Formative avant de publier.`);
      }
    }

    let r;
    try {
      r=await chrome.runtime.sendMessage({
        type:'CARDINAL_CHATGPT_RESULTS',
        payload:{
          rows,
          source,
          questionNumberHint:questions.length===1?String(questions[0]?.number||''):'',
          questionNumbersHint:questions.map(q=>String(q?.number||'')),
          contextSessionId:String(ctx.sessionId||''),
          batchIdHint:String(ctx.batchId||ctx.sessionId||''),
          batchBindingRecovered,
          allowPartialComments:commentsOnlyRows,
          batchBindingPartial
        }
      });
    } catch(error) {
      if(isContextInvalidated(error)) {
        queueReloadRecovery(rows,source,error,binding);
        return {ok:false,reloading:true};
      }
      throw error;
    }
    if(!r?.ok){diagnosticRecord('send.worker.rejected',{message:r?.message||null,recognized:r?.recognized||0,unmatched:r?.unmatched||0,ambiguous:r?.ambiguous||0,invalid:r?.invalid||0,missing:r?.missing||0},'error');throw new Error(r?.message||'Impossible de préparer le tampon Formative.');}
    diagnosticRecord('send.worker.accepted',{recognized:r.recognized||0,questionCount:r.questionCount||0,unmatched:r.unmatched||0,ambiguous:r.ambiguous||0,invalid:r.invalid||0,missing:r.missing||0,batchBindingRecovered,batchBindingPartial});
    const issueCount=Number(r.unmatched||0)+Number(r.ambiguous||0)+Number(r.invalid||0)+Number(r.missing||0);
    const successText=`${r.recognized||0} ligne${Number(r.recognized||0)===1?'':'s'} reconnue${Number(r.recognized||0)===1?'':'s'}${r.questionCount?` sur ${r.questionCount} question${Number(r.questionCount)===1?'':'s'}`:''}. Le lot est dans le tampon Cardinal et Formative est ouvert pour la vérification.${batchBindingPartial?'\nLiaison du lot récupérée pour un tableau partiel. La prévisualisation indiquera exactement ce qui sera publié.':(batchBindingRecovered?'\nLiaison du lot récupérée par correspondance exacte des questions et des élèves.':'')}${issueCount?`\nÀ corriger avant publication : ${issueCount} problème${issueCount===1?'':'s'} dans le lot.`:''}`;
    if(inlineUi?.bar){
      setInlineStatus(inlineUi.bar,successText,issueCount?'':'ok');
    }else{
      $('msg').textContent=successText;
      $('msg').className='small ok';
      $('paste').classList.add('hidden');
      $('parsePaste').classList.add('hidden');
      $('panel').classList.remove('hidden');
    }
    return r;
  }


  $('sendBtn').addEventListener('click',async()=>{
    const b=$('sendBtn');b.disabled=true;$('panel').classList.remove('hidden');$('paste').classList.add('hidden');$('parsePaste').classList.add('hidden');$('msg').className='small';$('msg').textContent='Je lis le dernier tableau de correction…';
    try{
      const rows=parseLatestAssistant();
      if(!rows.length){
        $('msg').textContent='Je n’ai pas trouvé de tableau compatible de notes ou de commentaires dans la dernière réponse. Colle la réponse finale ci-dessous.';
        $('msg').className='small err';$('paste').classList.remove('hidden');$('parsePaste').classList.remove('hidden');return;
      }
      await sendRows(rows,'Dernière réponse ChatGPT');
    } catch(e){
      $('msg').textContent=e?.message||String(e);$('msg').className='small err';$('paste').classList.remove('hidden');$('parsePaste').classList.remove('hidden');
    } finally { b.disabled=false; }
  });

  $('parsePaste').addEventListener('click',async()=>{
    try{
      const rows=parseMarkdownText($('paste').value);
      await sendRows(rows,'Texte collé dans ChatGPT');
    }catch(e){$('msg').textContent=e?.message||String(e);$('msg').className='small err';}
  });
  $('cancel').addEventListener('click',()=>$('panel').classList.add('hidden'));

  document.addEventListener('pointerdown',e=>{
    if($('panel').classList.contains('hidden'))return;
    const path=typeof e.composedPath==='function'?e.composedPath():[];
    if(!path.includes(host))$('panel').classList.add('hidden');
  },true);

  try {
    chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{
      if(message?.type==='CARDINAL_CHATGPT_BRIDGE_PING'){
        sendResponse?.({ok:true,bridgeVersion:BRIDGE_VERSION});
        return;
      }
      if(message?.type==='CARDINAL_CHATGPT_DIAGNOSTICS'){
        sendResponse?.({ok:true,bridgeVersion:BRIDGE_VERSION,cachedContext:cachedContext?{version:cachedContext.version||null,batchId:cachedContext.batchId||null,sessionId:cachedContext.sessionId||null,formativeId:cachedContext.formativeId||null,mode:cachedContext.mode||null,questionCount:contextQuestions(cachedContext).length}:null,sendButtonVisible:!$('sendBtn')?.classList.contains('hidden'),panelVisible:!$('panel')?.classList.contains('hidden'),latestRows:parseLatestAssistant().length});
        return;
      }
      if(message?.type==='CARDINAL_SIMPLE_CONTEXT_CLEARED'){
        cachedContext=null;
        $('panel').classList.add('hidden');
        refreshButton();
      }
    });
  } catch {}

  async function resumeReloadQueue(){
    // Legacy pending auto-replay is intentionally discarded. A previous AIO
    // version may have left this key behind; never turn it into a new send or
    // page reload.
    try { sessionStorage.removeItem(RELOAD_QUEUE_KEY); } catch {}
    return;
  }

  let inlineScanTimer=null;
  const inlineObserver=new MutationObserver(()=>{
    clearTimeout(inlineScanTimer);
    inlineScanTimer=setTimeout(()=>{
      scanInlineBars();
      refreshButton();
    },180);
  });
  inlineObserver.observe(document.documentElement,{childList:true,subtree:true,characterData:true});

  scanInlineBars();
  refreshButton();
  refreshContextHint(true);
  setInterval(()=>{scanInlineBars();refreshButton();},900);
  setInterval(()=>refreshContextHint(false),1500);
  setTimeout(resumeReloadQueue,900);
})();