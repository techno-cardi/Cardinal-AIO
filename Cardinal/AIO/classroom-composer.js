(() => {
  'use strict';
  const MAX_TEXT = 22000;
  const $ = (tag, text = '', cls = '') => { const n=document.createElement(tag); if(text)n.textContent=text; if(cls)n.className=cls; return n; };
  function safe(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function format(title, input){
    const clean=String(input||'').replace(/\r\n?/g,'\n').trim();
    if(!clean)throw Error('Aucun message à publier. Vérifie la récupération dans ChatGPT.');
    const paragraphs=clean.split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);
    const t=String(title||'Annonce aux élèves').trim().slice(0,140);
    // Classroom supprime les marges des paragraphes : doubles <br> explicites.
    const html='<p><b><u>'+safe(t)+'</u></b><br><br></p>'+paragraphs.map((p,i)=>'<p>'+p.split('\n').map(safe).join('<br>')+(i<paragraphs.length-1?'<br><br>':'')+'</p>').join('');
    return {title:t,richHtml:html,text:t+'\n\n'+paragraphs.join('\n\n'),probes:paragraphs.filter(x=>x.length>14).slice(0,5)};
  }
  // Fonction autonome sérialisable par chrome.scripting.executeScript, sans dépendance à l'extension.
  function readFromChatGPT(){
    const visible=(n)=>!!(n&&n.isConnected&&n.getClientRects?.().length && (n.innerText||n.textContent||'').trim());
    const raw=(n)=>String(n?.innerText||n?.textContent||'').trim();
    const sel=String(window.getSelection?.()?.toString()||'').trim();
    if(sel.length>=12)return {text:sel,kind:'sélection'};
    const writingSelector='[data-testid*="writing" i], [data-testid*="artifact" i], [class*="writing-block" i], [class*="WritingBlock"], [data-testid*="document" i]';
    const turns=[...document.querySelectorAll('[data-message-author-role="assistant"], [data-role="assistant"], [data-testid*="assistant-message"], article[data-author="assistant"]')].filter(visible);
    let scope=turns.at(-1);
    if(!scope){
      const wrappers=[...document.querySelectorAll('[data-testid*="conversation-turn"], article, [data-testid*="conversation-item"]')].filter(visible);
      scope=wrappers.filter(n=>n.querySelector('[data-message-author-role="assistant"], [data-role="assistant"]')||/assistant/i.test(n.getAttribute('data-testid')||'')).at(-1);
    }
    // Certaines interfaces de ChatGPT n'ajoutent aucun data-message-author-role.
    const root=scope||document.querySelector('main')||document.body;
    const writing=[...root.querySelectorAll(writingSelector)].filter(n=>visible(n)&&raw(n).length>=15&&!n.closest('nav,aside,form'));
    let target=writing.at(-1);
    if(!target){
      const markdown=[...root.querySelectorAll('.markdown,.prose,[data-testid*="markdown"], [data-testid*="message-content"], [class*="markdown-body"]')].filter(n=>visible(n)&&raw(n).length>=15&&!n.closest('nav,aside,form'));
      target=markdown.at(-1);
    }
    if(!target)target=scope;
    if(!target){
      // Dernier recours : récupérer la dernière zone textuelle placée juste avant les actions de copie.
      const buttons=[...root.querySelectorAll('button[aria-label*="copier" i],button[aria-label*="copy" i],[data-testid*="copy" i]')].filter(visible);
      const b=buttons.at(-1);
      target=b?.closest('[data-testid*="conversation-turn"],article,[data-message-author-role],section')||null;
    }
    if(!target)return {text:'',error:'Aucun bloc de réponse repéré. Sélectionne le passage avec la souris et réessaie.'};
    const blocks=[...target.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')].filter(n=>visible(n)&&!n.parentElement?.closest('h1,h2,h3,h4,p,li,blockquote,pre')&&!n.closest('nav,aside,form'));
    let text=blocks.length?blocks.map(raw).filter(Boolean).join('\n\n'):raw(target);
    text=text.replace(/\n{4,}/g,'\n\n').trim();
    if(text.length>22000)return {text:'',error:'Texte trop long : sélectionne seulement le passage à envoyer.'};
    return {text,kind:writing.length?'boîte de rédaction':'dernière réponse'};
  }
  async function getDraft(){
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(tab.url||''))throw Error('Ouvre la conversation ChatGPT dans l’onglet actif.');
    const output=await chrome.scripting.executeScript({target:{tabId:tab.id},func:readFromChatGPT});
    const r=output?.[0]?.result;
    if(!r?.text)throw Error(r?.error||'Aucune réponse détectée. Sélectionne le texte dans ChatGPT, puis réessaie.');
    return {text:r.text,kind:r.kind,tabId:tab.id};
  }
  function optionsFrom(map){return Object.entries(map||{}).filter(([group,value])=>/^\d{1,3}$/.test(group)&&/^\d+$/.test(String(value?.courseId||''))&&/^https:\/\/classroom\.google\.com\/c\//.test(String(value?.alternateLink||''))).sort((a,b)=>Number(a[0])-Number(b[0]));}
  async function copyRich(fmt){
    // Le presse-papiers HTML est requis pour les publications automatiques du pont Classroom.
    if(navigator.clipboard?.write&&globalThis.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([fmt.richHtml],{type:'text/html'}),'text/plain':new Blob([fmt.text],{type:'text/plain'})})]);
      return;
    }
    const holder=$('div');holder.innerHTML=fmt.richHtml;holder.contentEditable='true';holder.style='position:fixed;left:-99999px;top:0';document.body.append(holder);
    const sel=window.getSelection(),rg=document.createRange();rg.selectNodeContents(holder);sel.removeAllRanges();sel.addRange(rg);
    const ok=document.execCommand('copy');sel.removeAllRanges();holder.remove();
    if(!ok)throw Error('Impossible de copier le format HTML dans le presse-papiers.');
  }
  function mount(card, message, doc=globalThis.document, chromeApi=globalThis.chrome, mapKey=''){
    const container=$('section','','classroom-composer');
    const label=$('p','Publication Classroom depuis ChatGPT','classroom-title');
    const open=$('button','Préparer une publication','action');open.type='button';
    const panel=$('div','','classroom-panel');panel.hidden=true;
    const status=$('p','','classroom-status');status.setAttribute('role','status');
    const titleLabel=$('label','Titre');const title=$('input');title.type='text';title.value='Annonce aux élèves';title.maxLength=140;
    const bodyLabel=$('label','Texte récupéré - modifiable');const body=$('textarea');body.rows=10;body.maxLength=MAX_TEXT;
    const groupLabel=$('label','Groupe Classroom');const select=$('select');
    const refresh=$('button','Relire ChatGPT','action');refresh.type='button';
    const copy=$('button','Copier HTML','action');copy.type='button';
    const publish=$('button','Publier','action');publish.type='button';
    const buttons=$('div','','classroom-buttons');buttons.append(refresh,copy,publish);
    titleLabel.append(title);bodyLabel.append(body);groupLabel.append(select);
    panel.append(status,titleLabel,bodyLabel,groupLabel,buttons);
    container.append(label,open,panel);
    const style=$('style');style.textContent=`.classroom-composer{margin-top:12px;padding:9px;border:1px solid #d1dbe5;border-radius:10px;background:#f8fbff}.classroom-title{font-size:12px;font-weight:700}.classroom-panel{display:grid;gap:10px}.classroom-panel[hidden]{display:none}.classroom-panel label{font:11px/1.6 system-ui;display:grid;gap:4px}.classroom-panel input,.classroom-panel textarea,.classroom-panel select{box-sizing:border-box;width:100%;max-width:100%;font:12px system-ui;padding:7px;border:1px solid #adbdcb;border-radius:7px}.classroom-panel textarea{white-space:pre-wrap;resize:vertical}.classroom-buttons{display:flex;flex-wrap:wrap;gap:5px}.classroom-buttons button{flex:1}.classroom-status{font:11px/1.5 system-ui;color:#3e546b;white-space:pre-wrap}`;
    card.append(style,container);
    let sourceTabId=null;
    async function fillGroups(){
      select.replaceChildren();const def=$('option','Choisir un groupe');def.value='';select.append(def);
      const stored=await chrome.storage.local.get(mapKey);const linked=optionsFrom(stored?.[mapKey]);
      for(const [num,data] of linked){const o=$('option',`Groupe ${num} - ${data.courseName||'Classroom'}`);o.value=num;select.append(o)}
      publish.disabled=!linked.length;
      if(!linked.length)status.textContent='Aucun groupe Classroom lié : ouvre l’agenda pour synchroniser les groupes.';
    }
    async function load(){
      refresh.disabled=true;status.textContent='Recherche de la dernière réponse…';
      try{const draft=await getDraft();body.value=draft.text;sourceTabId=draft.tabId;status.textContent=`Récupération : ${draft.kind}. Vérifie le contenu avant publication.`}
      catch(e){status.textContent=(e?.message||String(e))+' Tu peux également coller manuellement ton texte ici.';}
      finally{refresh.disabled=false}
    }
    open.addEventListener('click',async()=>{panel.hidden=false;await fillGroups();await load()});
    refresh.addEventListener('click',load);
    copy.addEventListener('click',async()=>{try{await copyRich(format(title.value,body.value));status.textContent='Copié en HTML avec espaces. Dans Classroom, colle avec Ctrl + V.'}catch(e){status.textContent=e.message}});
    publish.addEventListener('click',async()=>{
      if(!select.value){status.textContent='Choisis un groupe Classroom.';return}
      if(!Number.isInteger(sourceTabId)){status.textContent='Relis ChatGPT pour confirmer la source, puis réessaie.';return}
      if(!confirm(`Publier cette annonce dans le groupe ${select.value} ?`))return;
      publish.disabled=true;
      try{
        const fmt=format(title.value,body.value);await copyRich(fmt);
        const x=await chrome.runtime.sendMessage({type:'PDC_NATIVE_PREPARE',payload:{requestId:`cardinal-aio-${Date.now()}`,createdAt:Date.now(),group:select.value,sourceTabId,title:fmt.title,text:fmt.text,probes:fmt.probes}});
        if(!x?.ok)throw Error(x?.error||'La publication n’a pas été acceptée.');
        status.textContent='Classroom a été ouvert. La publication doit encore être confirmée par le pont.';
      }catch(e){status.textContent=e.message||String(e)}finally{publish.disabled=false}
    });
    return {open,body,select,publish};
  }
  function paragraphs(body){return String(body||'').replace(/\r\n?/g,'\n').split(/\n\s*\n+/).map(x=>x.trim()).filter(Boolean);}
  function groupOptions(stored,mapKey=''){return optionsFrom(stored?.[mapKey]);}
  const api=Object.freeze({format,formatAnnouncement:format,paragraphs,groupOptions,readFromChatGPT,mount});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  globalThis.CardinalClassroomComposer=api;
})();