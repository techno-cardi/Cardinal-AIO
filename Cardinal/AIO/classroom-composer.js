(() => {
  'use strict';
  const MODULE = 'CardinalClassroomComposer';
  const MAP_KEY = 'pdcNativeClassroomGroupMapV1';
  const PREPARE = 'PDC_NATIVE_PREPARE';
  const MAX_CHARS = 18000;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }
  function paragraphs(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
      .split(/\n\s*\n+/).map(x => x.trim()).filter(Boolean);
  }
  function formatAnnouncement(title, body) {
    const clean = paragraphs(body);
    if (!clean.length) throw new Error('Aucun message à publier.');
    const heading = String(title || 'Message aux élèves').trim().slice(0, 140);
    // Classroom rend souvent les <p> sans margin. Deux <br> explicites
    // sont inclus dans chaque paragraphe (sauf le dernier) pour l'espacement.
    const richHtml = `<p><b><u>${escapeHtml(heading)}</u></b><br><br></p>` +
      clean.map((part, index) => `<p>${part.split('\n').map(escapeHtml).join('<br>')}${index < clean.length - 1 ? '<br><br>' : ''}</p>`).join('');
    const text = heading + '\n\n' + clean.join('\n\n');
    return { richHtml, text, title: heading, probes: clean.filter(x => x.length > 12).slice(0, 4) };
  }
  // Cette fonction est exécutée dans l'onglet ChatGPT par chrome.scripting.
  // Aucune extraction en arrière-plan : le professeur déclenche l'action.
  function readChatGptPage() {
    const selection = window.getSelection();
    const selectedText = String(selection?.toString() || '').trim();
    if (selectedText.length >= 20) {
      return { text: selectedText.slice(0, 18000), kind: 'selection' };
    }
    const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (!assistants.length) return { text: '', error: 'Aucune réponse ChatGPT détectée.' };
    const last = assistants[assistants.length - 1];
    const writing = [...last.querySelectorAll('[data-testid*="writing-block"], [data-testid*="writing_block"], [data-testid*="writingBlock"], [data-testid*="writing"], [data-testid*="artifact"]')]
      .filter(x => (x.innerText || x.textContent || '').trim().length > 20);
    const readable = [...last.querySelectorAll('.markdown, .prose, [data-testid*="markdown"]')]
      .filter(x => (x.innerText || x.textContent || '').trim().length > 20);
    const target = writing[writing.length - 1] || readable[readable.length - 1] || last;
    const clone = target.cloneNode(true);
    clone.querySelectorAll('button, nav, aside, script, style, svg, [role="toolbar"], [aria-hidden="true"], [data-testid*="toolbar"]').forEach(x => x.remove());
    const blocks = [...clone.querySelectorAll('h1,h2,h3,h4,p,li,blockquote')].filter(x =>
      !x.parentElement?.closest('h1,h2,h3,h4,p,li,blockquote'));
    let text = blocks.map(x => String(x.innerText || x.textContent || '').trim()).filter(Boolean).join('\n\n');
    if (!text.trim()) text = String(clone.innerText || clone.textContent || '').trim();
    if (text.length > 18000) return { error: 'La réponse dépasse 18 000 caractères. Sélectionne seulement le passage à publier.' };
    return { text, kind: writing.length ? 'bloc de rédaction' : 'dernière réponse' };
  }
  async function draftFromTab(chromeApi) {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    const tab = tabs.find(x => Number.isInteger(x?.id) && /^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(String(x.url || '')));
    if (!tab) throw new Error('Ouvre d’abord une conversation ChatGPT.');
    if (!chromeApi.scripting?.executeScript) throw new Error('La permission Chrome « scripting » manque.');
    const executed = await chromeApi.scripting.executeScript({target:{tabId:tab.id},func:readChatGptPage});
    const result = executed?.[0]?.result || {};
    if (result.error) throw new Error(result.error);
    if (!String(result.text||'').trim()) throw new Error('Bloc vide. Sélectionne le texte dans ChatGPT et recommence.');
    return {text: result.text, kind:result.kind, tabId:tab.id};
  }
  async function copyRich(doc, richHtml, text, clipboard = globalThis.navigator?.clipboard) {
    if (typeof ClipboardItem !== 'undefined' && clipboard?.write) {
      try {
        await clipboard.write([new ClipboardItem({
          'text/html': new Blob([richHtml], {type:'text/html'}),
          'text/plain': new Blob([text], {type:'text/plain'})
        })]);
        return true;
      } catch (_) { /* retour à la copie HTML native */ }
    }
    const tmp = doc.createElement('div');
    tmp.contentEditable = 'true'; tmp.innerHTML = richHtml;
    tmp.style.cssText = 'position:fixed;left:-99999px;top:0';
    (doc.body || doc.documentElement).appendChild(tmp);
    const range = doc.createRange(); range.selectNodeContents(tmp);
    const sel = doc.getSelection ? doc.getSelection() : globalThis.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    const ok = doc.execCommand('copy') === true;
    sel.removeAllRanges(); tmp.remove();
    return ok;
  }
  function groupOptions(stored) {
    const map = stored?.[MAP_KEY];
    return Object.entries(map && typeof map === 'object' ? map : {})
      .filter(([group, value]) => /^\d{1,3}$/.test(group) && /^\d+$/.test(String(value?.courseId || ''))
        && /^https:\/\/classroom\.google\.com\/c\//.test(String(value?.alternateLink || '')))
      .sort((a,b) => Number(a[0]) - Number(b[0]));
  }
  function create(doc, tag, label, className) {
    const n = doc.createElement(tag);
    if (label) n.textContent = label;
    if (className) n.className = className;
    return n;
  }
  function mount(card, message, doc = globalThis.document, chromeApi = globalThis.chrome) {
    const area = create(doc, 'div', '', 'classroom-area'); area.hidden = true;
    const status = create(doc, 'p', '', 'classroom-status'); status.setAttribute('role','status');
    const desc = create(doc, 'p', 'Relis ou adapte ce texte avant de le publier.', 'classroom-help');
    const titleInput = create(doc,'input'); titleInput.type='text'; titleInput.value='Annonce aux élèves'; titleInput.maxLength=140;
    titleInput.setAttribute('aria-label','Titre de l’annonce');
    const editor = create(doc,'textarea'); editor.rows=9; editor.maxLength=MAX_CHARS;
    editor.setAttribute('aria-label','Texte de la publication');
    const groupLabel = create(doc,'label','Groupe Classroom :');
    const groupSelect = create(doc,'select'); groupSelect.setAttribute('aria-label','Groupe Classroom');
    groupLabel.append(groupSelect);
    const controls = create(doc,'div','','classroom-controls');
    const copy = create(doc,'button','Copier HTML avec espacements','action'); copy.type='button';
    const publish = create(doc,'button','Publier dans Classroom','action'); publish.type='button';
    controls.append(copy,publish); area.append(desc,titleInput,editor,groupLabel,controls,status);
    const open = create(doc,'button','Classroom : dernière réponse ou sélection','action'); open.type='button';
    open.addEventListener('click',async () => {
      open.disabled = true; status.textContent = '';
      try {
        const draft = await draftFromTab(chromeApi);
        editor.value=draft.text;
        groupSelect.replaceChildren();
        const opt = create(doc,'option','Choisir un groupe'); opt.value='';groupSelect.append(opt);
        const linked=groupOptions(await chromeApi.storage.local.get(MAP_KEY));
        for(const [num,link] of linked){const o=create(doc,'option',`Groupe ${num} - ${link.courseName||'Classroom'}`);o.value=num;groupSelect.append(o);}
        publish.disabled = !linked.length;
        area.hidden=false;
        area.dataset.sourceTabId=String(draft.tabId);
        status.textContent=`Source : ${draft.kind}. ${linked.length} groupe(s) lié(s).`;
      } catch(e) {area.hidden=false;status.textContent=e.message||String(e);}
      finally {open.disabled=false;}
    });
    copy.addEventListener('click',async()=>{
      copy.disabled=true;
      try{const value=formatAnnouncement(titleInput.value,editor.value);
        const ok=await copyRich(doc,value.richHtml,value.text);
        if(!ok)throw new Error('Copie refusée par Chrome.');
        status.textContent='HTML copié avec des lignes d’espacement. Colle avec Ctrl + V.';
      }catch(e){status.textContent=e.message||String(e);}finally{copy.disabled=false;}
    });
    publish.addEventListener('click',async()=>{
      if (!groupSelect.value) {status.textContent='Choisis d’abord un groupe Classroom lié.';return;}
      if (!globalThis.confirm(`Publier cette annonce dans le groupe ${groupSelect.value} ?`))return;
      publish.disabled=true;
      try{
        const fmt=formatAnnouncement(titleInput.value,editor.value);
        if(!await copyRich(doc,fmt.richHtml,fmt.text))throw new Error('Le HTML n’a pas été copié : aucune publication lancée.');
        const group=groupSelect.value;
        const result=await chromeApi.runtime.sendMessage({type:PREPARE,payload:{
          requestId:`cardinal-chatgpt-${Date.now()}`,createdAt:Date.now(),group,
          sourceTabId:Number(area.dataset.sourceTabId),
          title:fmt.title,text:fmt.text,probes:fmt.probes
        }});
        if(!result?.ok)throw new Error(result?.error||'Le pont Classroom a refusé la publication.');
        status.textContent='Classroom s’ouvre. Le pont vérifiera la publication.';
      }catch(e){status.textContent=e.message||String(e);}
      finally{publish.disabled=false;}
    });
    const style=create(doc,'style');style.textContent=[
      '.classroom-area{display:grid;gap:7px;border-top:1px solid #ced6e0;margin-top:8px;padding-top:8px}',
      '.classroom-area[hidden]{display:none}',
      '.classroom-area input,.classroom-area textarea,.classroom-area select{width:100%;box-sizing:border-box;border:1px solid #b4c6d7;border-radius:7px;padding:7px;font:12px/1.5 system-ui;background:#fff;color:#172033}',
      '.classroom-area textarea{min-height:120px;resize:vertical;white-space:pre-wrap}',
      '.classroom-area label,.classroom-help,.classroom-status{font:11px/1.45 system-ui;color:#526174;margin:2px 0}',
      '.classroom-controls{display:flex;gap:6px}.classroom-controls button{flex:1;white-space:normal}',
      '@media(prefers-color-scheme:dark){.classroom-area input,.classroom-area textarea,.classroom-area select{background:#202733;color:#fff;border-color:#465366}}'
    ].join('');
    card.append(style,open,area);
    return {open,area,editor,groupSelect,titleInput,copy,publish};
  }
  const api = Object.freeze({formatAnnouncement,paragraphs,groupOptions,readChatGptPage,draftFromTab,copyRich,mount});
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  if (typeof globalThis !== 'undefined') globalThis[MODULE]=api;
})();