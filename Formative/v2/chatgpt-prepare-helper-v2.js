(() => {
  'use strict';

  const BUTTON_ID = 'cardinalFormativePrepareButton';
  const TOAST_ID = 'cardinalFormativePrepareToast';
  const PROTOCOL_FILE_NAME = 'CARDINAL_FORMATIVE_PROTOCOL_V2.md';
  const PROMPT_MARKER = '[Cardinal Formative]';
  const PREPARE_MESSAGE = 'CARDINAL_FORMATIVE_PREPARE_CHATGPT';
  const PRODUCTION_TYPES = Object.freeze([
    'shortAnswer',
    'longAnswer',
    'fillInTheBlank',
    'multipleChoice',
    'multipleSelection',
    'inlineChoice',
    'resequence',
    'matching'
  ]);
  const MAX_PREPARE_TEXT_CHARS = 5200;
  const COMPACT_PROTOCOL = [
    'CARDINAL_FORMATIVE_COMPACT_V2',
    'Convertis fidèlement la demande actuelle en paquet Cardinal Formative. Ne mélange pas un ancien examen/document du chat sauf si la demande le vise.',
    'SORTIE: 1) tableau humain compact; 2) ligne CARDINAL_FORMATIVE_PACKAGE_V2; 3) un seul JSON.',
    'JSON: schema="cardinal.formative/2", protocolVersion="2.0.0", packageMode="full" sauf patch demandé, assessment, sources, items, issues. assessment: title, language="fr-CA", sourceMode="external-reference-only" ou "embedded" si passageGroup, declaredTotalPoints={value,provenance} si connu, jamais un nombre seul.',
    'Sources: seulement celles réellement utiles, forme {id,role,label,status}; roles questionnaire/text/answerKey/rubric/appendix/unknown; status provided/missing/external. N’utilise pas description à la place de label. Corrigé/barème fourni = référence prioritaire.',
    'Items: section, instruction ou question; id/order uniques. Question: source{sourceRef,page,printedPage,number,subNumber,promptExact}, sourceRefs,prompt,subtype,required,points{value,provenance,graded:true,bonus:false},grading,transformations,issues.',
    'TYPE IDÉAL D’ABORD: choix unique=multipleChoice; choix multiples=multipleSelection; menu/catégorie par champ=inlineChoice; association=matching; ordre=resequence; champs texte déterministes=fillInTheBlank; réponse courte unique=shortAnswer; justification/raisonnement/rédaction=longAnswer.',
    'PROVEN ici: shortAnswer,longAnswer,fillInTheBlank,multipleChoice,multipleSelection,inlineChoice,resequence,matching. Tout autre subtype reste bloqué sauf fallback PROVEN réellement équivalent, déclaré avec idealSubtype+compromis+requiresReview=true.',
    'Ne convertis pas un type structuré en longAnswer pour importer; ne remplace pas un dropdown fermé par un champ texte.',
    'Structures: QCM=>response.options[{id,text,correct,points?}]. multipleSelection avec partialCredit=true: chaque bonne option DOIT avoir points explicite et la somme des bonnes options DOIT égaler points.value; sinon partialCredit=false, jamais de pondération arbitraire. inlineChoice=>{{id}}+response.dropdowns[{id,options,correct:[valeur]}], avec un libellé humain visible autour de chaque placeholder; jamais {{a}} {{b}} seuls. fillInTheBlank=>{{id}}+response.blanks[{id,answers,conceptIds:[]}]. resequence=>response.sequence[texte]. matching=>response.pairs[{left,right}].',
    'Question mixte: découpe seulement si la source/barème permet une répartition de points certaine. Sinon garde-la groupée. Ne crée jamais de pondération interne arbitraire.',
    'Conserve options, bonnes réponses, ordre pertinent, points, crédit partiel et total. N’invente ni distracteurs ni réponses. Si total incohérent: issue TOTAL_POINTS_MISMATCH.',
    'Correction: grading={mode,expectedAnswer,provenance:{kind,sourceRefs},partialCredit,caseSensitive,requirements,concepts}. provenance.kind seulement: providedAnswerKey/sourceExplicit/sourceInferred/questionIntrinsic/teacherApproved/sourceMissing; jamais "answerKey". Corrigé fourni > source explicite > inférence > question; n’invente rien. short/long auto/assisted: concepts[{id,label,score,provenance,terms,riskyTerms}], 2-5 termes discriminants réels par idée si disponibles; évite mots génériques et faux synonymes.',
    'Keyword: score absolu par match, jamais cumulatif; un mot seul ne vaut pas toute réponse complexe. Négation, plusieurs éléments, justification ou relation => assisted + requirements + scores prudents. manual si correction fiable impossible; expectedAnswer complet même en assisted.',
    'Présentation: sections/consignes non notées; prompt en courts paragraphes et sous-parties sur lignes distinctes, sans HTML/tableau Markdown. transformations utilise toujours {code,description,requiresReview}; code=splitQuestion/changeResponseType/other pour transformation de fond; code=removeSourceNumber avec requiresReview=false pour numéro retiré. N’utilise jamais type à la place de code.',
    'Images/tableaux/extraits/médias: conserve la dépendance. Source/média nécessaire manquant => sourceMissing/SOURCE_REQUIRED ou MEDIA_DEPENDENCY_MISSING; jamais d’invention.',
    'Vérifie avant sortie: toutes les questions, sous-parties, ordre, sources, total, points, types, réponses, JSON valide, aucun ID/session Formative inventé.'
  ].join('\n');

  function oneLine(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  }

  function isChatGptLocation(locationApi = globalThis.location) {
    const host = String(locationApi?.hostname || '');
    return host === 'chatgpt.com' || host === 'chat.openai.com';
  }

  function isAioRuntime(runtime = globalThis.chrome?.runtime) {
    try {
      return /^Cardinal AIO:/i.test(String(runtime?.getManifest?.()?.description || ''));
    } catch {
      return false;
    }
  }

  function findEditor(doc) {
    const preferred = doc.querySelector?.('#prompt-textarea');
    if (preferred) return preferred;
    const selectors = [
      'form textarea',
      'form [contenteditable="true"][data-lexical-editor="true"]',
      'form [contenteditable="true"]'
    ];
    for (const selector of selectors) {
      const candidate = doc.querySelector?.(selector);
      if (candidate) return candidate;
    }
    return null;
  }

  function findFileInput(doc, editor) {
    const form = editor?.closest?.('form') || null;
    const local = form?.querySelector?.('input[type="file"]');
    if (local) return local;
    const all = [...(doc.querySelectorAll?.('input[type="file"]') || [])];
    return all.find(input => input?.disabled !== true) || null;
  }

  function editorText(editor) {
    if (!editor) return '';
    if (typeof editor.value === 'string') return editor.value;
    return editor.innerText || editor.textContent || '';
  }

  function triggerText(existing = '') {
    const current = String(existing || '').trim();
    if (current.includes(PROMPT_MARKER)) return current;
    const request = current || 'Prépare le dernier examen, questionnaire ou document pédagogique pertinent de cette conversation pour Formative.';
    const added = [
      PROMPT_MARKER,
      'Utilise la demande actuelle, le contenu pédagogique pertinent déjà présent dans cette conversation et les PDF/DOCX/pièces jointes pertinentes.',
      COMPACT_PROTOCOL
    ].join('\n');
    if (added.length > MAX_PREPARE_TEXT_CHARS) {
      const error = new Error('La consigne Cardinal compacte dépasse sa limite de sécurité.');
      error.code = 'CARDINAL_PREPARE_TEXT_TOO_LARGE';
      throw error;
    }
    return `${request}\n\n${added}`;
  }

  function clipboardText(existing = '') {
    const current = String(existing || '').trim();
    if (current.includes(PROMPT_MARKER)) {
      const error = new Error('La consigne Cardinal est déjà dans ton brouillon ChatGPT.');
      error.code = 'CARDINAL_PREPARE_ALREADY_PRESENT';
      throw error;
    }
    const full = triggerText(current);
    return current ? full.slice(current.length + 2) : full;
  }

  async function copyText(value, options = {}) {
    const clipboard = options.clipboard || globalThis.navigator?.clipboard;
    const doc = options.document || globalThis.document;
    try {
      if (typeof clipboard?.writeText === 'function') {
        await clipboard.writeText(String(value));
        return true;
      }
    } catch {}
    try {
      const field = doc.createElement('textarea');
      field.value = String(value);
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.left = '-9999px';
      (doc.documentElement || doc.body).appendChild(field);
      field.select();
      field.setSelectionRange(0, field.value.length);
      const copied = doc.execCommand('copy') === true;
      field.remove();
      return copied;
    } catch {
      return false;
    }
  }

  function dispatchInput(editor, windowApi = globalThis.window) {
    const EventCtor = windowApi?.Event || globalThis.Event;
    if (typeof EventCtor === 'function') {
      editor.dispatchEvent?.(new EventCtor('input', { bubbles: true }));
      editor.dispatchEvent?.(new EventCtor('change', { bubbles: true }));
    }
  }

  function setEditorText(editor, text, options = {}) {
    if (!editor) return false;
    const win = options.window || globalThis.window;
    const doc = options.document || editor.ownerDocument || globalThis.document;
    const value = String(text || '');

    if (typeof editor.value === 'string') {
      let usedNativeSetter = false;
      try {
        const proto = win?.HTMLTextAreaElement?.prototype;
        const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(editor, value);
          usedNativeSetter = true;
        }
      } catch {}
      if (!usedNativeSetter) editor.value = value;
      dispatchInput(editor, win);
      editor.focus?.();
      return true;
    }

    if (editor.isContentEditable || editor.getAttribute?.('contenteditable') === 'true') {
      editor.focus?.();
      let inserted = false;
      try {
        const selection = win?.getSelection?.();
        if (selection && doc?.createRange) {
          const range = doc.createRange();
          range.selectNodeContents(editor);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (typeof doc?.execCommand === 'function') {
          inserted = doc.execCommand('insertText', false, value) === true;
        }
      } catch {}
      if (!inserted) editor.textContent = value;
      dispatchInput(editor, win);
      return true;
    }
    return false;
  }

  async function loadProtocol(runtime, fetchImpl = globalThis.fetch) {
    if (!runtime?.getURL || typeof fetchImpl !== 'function') {
      const error = new Error('Le protocole Cardinal embarqué est indisponible.');
      error.code = 'CARDINAL_PROTOCOL_ASSET_UNAVAILABLE';
      throw error;
    }
    const url = runtime.getURL(PROTOCOL_FILE_NAME);
    const response = await fetchImpl(url);
    if (!response?.ok) {
      const error = new Error('Cardinal n’a pas pu lire son protocole Formative embarqué.');
      error.code = 'CARDINAL_PROTOCOL_ASSET_READ_FAILED';
      throw error;
    }
    const text = await response.text();
    if (!text.includes('cardinal.formative/2') || !text.includes('Version du protocole: 2.0.0')) {
      const error = new Error('Le protocole Cardinal embarqué semble incomplet ou incompatible.');
      error.code = 'CARDINAL_PROTOCOL_ASSET_INVALID';
      throw error;
    }
    return text;
  }

  function inputContainsProtocol(doc, editor) {
    const input = findFileInput(doc, editor);
    return [...(input?.files || [])].some(file => file?.name === PROTOCOL_FILE_NAME);
  }

  function composerContainsProtocol(doc, editor) {
    if (!editor) return false;
    const form = editor.closest?.('form') || null;
    if (!form) return false;
    let visibleText = String(form.innerText || form.textContent || '');
    const draftText = editorText(editor);
    if (draftText) visibleText = visibleText.replace(draftText, '');
    return visibleText.includes(PROTOCOL_FILE_NAME);
  }

  function mergeProtocolFile(input, protocolText, options = {}) {
    const DataTransferCtor = options.DataTransfer || globalThis.DataTransfer;
    const FileCtor = options.File || globalThis.File;
    if (!input || typeof DataTransferCtor !== 'function' || typeof FileCtor !== 'function') {
      const error = new Error('Le contrôle de pièces jointes ChatGPT n’est pas accessible.');
      error.code = 'CHATGPT_FILE_ATTACH_UNAVAILABLE';
      throw error;
    }

    const existing = [...(input.files || [])];
    if (existing.some(file => file?.name === PROTOCOL_FILE_NAME)) return { changed: false, files: existing };

    const transfer = new DataTransferCtor();
    for (const file of existing) transfer.items.add(file);
    transfer.items.add(new FileCtor([protocolText], PROTOCOL_FILE_NAME, {
      type: 'text/markdown',
      lastModified: Date.now()
    }));

    try {
      let assigned = false;
      const InputCtor = options.HTMLInputElement || globalThis.HTMLInputElement;
      const setter = InputCtor?.prototype && Object.getOwnPropertyDescriptor(InputCtor.prototype, 'files')?.set;
      if (typeof setter === 'function') {
        setter.call(input, transfer.files);
        assigned = true;
      }
      if (!assigned) input.files = transfer.files;
    } catch (cause) {
      const error = new Error('ChatGPT a refusé l’ajout automatique du protocole Cardinal.');
      error.code = 'CHATGPT_FILE_ATTACH_REJECTED';
      error.cause = cause;
      throw error;
    }

    const EventCtor = options.Event || globalThis.Event;
    if (typeof EventCtor === 'function') {
      input.dispatchEvent?.(new EventCtor('input', { bubbles: true }));
      input.dispatchEvent?.(new EventCtor('change', { bubbles: true }));
    }
    return { changed: true, files: [...(transfer.files || [])] };
  }

  async function waitForProtocolVisible(doc, options = {}) {
    const editor = options.editor || findEditor(doc);
    if (composerContainsProtocol(doc, editor)) return true;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 8000;
    const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 160;
    const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await pause(intervalMs);
      if (composerContainsProtocol(doc, editor)) return true;
    }
    return false;
  }

  function createHelper(options = {}) {
    const doc = options.document || globalThis.document;
    const runtime = options.runtime || globalThis.chrome?.runtime;
    const locationApi = options.location || globalThis.location;
    const MutationObserverApi = options.MutationObserver || globalThis.MutationObserver;
    const fetchImpl = options.fetch || globalThis.fetch;
    const win = options.window || globalThis.window;
    const floatingButton = options.floatingButton !== undefined
      ? options.floatingButton === true
      : !isAioRuntime(runtime);
    const deferLayout = options.requestAnimationFrame || win?.requestAnimationFrame?.bind(win) ||
      (callback => (options.setTimeout || globalThis.setTimeout)?.(callback, 0));
    if (!doc || !runtime) throw new Error('ChatGPT prepare helper dependencies unavailable');

    let button = null;
    let toast = null;
    let observer = null;
    let busy = false;
    let started = false;
    let layoutPending = false;
    let messageListener = null;
    let lastErrorMessage = '';

    function ensureToast() {
      if (toast?.isConnected) return toast;
      toast = doc.getElementById?.(TOAST_ID) || doc.createElement('div');
      toast.id = TOAST_ID;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      Object.assign(toast.style, {
        position: 'fixed',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '9px 11px',
        borderRadius: '9px',
        border: '1px solid rgba(128,128,128,.35)',
        background: 'Canvas',
        color: 'CanvasText',
        boxShadow: '0 6px 24px rgba(0,0,0,.18)',
        font: '12px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        display: 'none'
      });
      (doc.body || doc.documentElement).appendChild(toast);
      return toast;
    }

    function showToast(text, editor) {
      const node = ensureToast();
      node.textContent = text;
      const rect = editor?.getBoundingClientRect?.();
      if (rect && Number.isFinite(rect.left)) {
        node.style.left = `${Math.max(12, Math.min(rect.left, (win?.innerWidth || 1200) - 380))}px`;
        node.style.bottom = `${Math.max(92, (win?.innerHeight || 800) - rect.top + 48)}px`;
      } else {
        node.style.right = '18px';
        node.style.bottom = '136px';
      }
      node.style.display = 'block';
      (options.setTimeout || globalThis.setTimeout)?.(() => { if (node) node.style.display = 'none'; }, 5500);
    }

    function placeButton(editor) {
      if (!button || !editor) return;
      const rect = editor.getBoundingClientRect?.();
      if (!rect || !Number.isFinite(rect.left) || rect.width <= 0) {
        button.style.display = 'none';
        return;
      }
      button.style.display = 'block';
      button.style.left = `${Math.max(12, rect.left)}px`;
      button.style.top = `${Math.max(8, rect.top - 40)}px`;
      button.style.maxWidth = `${Math.max(180, Math.min(270, rect.width))}px`;
    }

    async function prepare(editor) {
      if (busy) {
        lastErrorMessage = 'Une préparation Formative est déjà en cours.';
        return false;
      }
      busy = true;
      if (button) {
        button.disabled = true;
        button.textContent = 'Copie…';
      }
      try {
        lastErrorMessage = '';
        const prompt = clipboardText(editorText(editor));
        const copied = await (options.copyText || copyText)(prompt, { document: doc, clipboard: options.clipboard });
        if (!copied) {
          const error = new Error('Cardinal n’a pas pu copier le prompt. Autorise le presse-papiers puis réessaie.');
          error.code = 'CARDINAL_PREPARE_COPY_FAILED';
          throw error;
        }
        showToast('Prompt copié. Colle-le à la fin de ta demande ChatGPT, puis envoie.', editor);
        return true;
      } catch (error) {
        lastErrorMessage = error?.message || 'Préparation Formative impossible.';
        showToast(lastErrorMessage, editor);
        return false;
      } finally {
        busy = false;
        if (button) {
          button.disabled = false;
          button.textContent = 'Copier le prompt Formative';
        }
      }
    }

    function ensureButton() {
      if (!floatingButton || !isChatGptLocation(locationApi)) return null;
      const editor = findEditor(doc);
      if (!editor) {
        if (button) button.style.display = 'none';
        return null;
      }
      if (!button?.isConnected) {
        button = doc.getElementById?.(BUTTON_ID) || doc.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Copier le prompt Formative';
        button.title = 'Copie la consigne compacte à coller dans ChatGPT';
        Object.assign(button.style, {
          position: 'fixed',
          zIndex: '2147483646',
          padding: '8px 11px',
          borderRadius: '9px',
          border: '1px solid rgba(128,128,128,.38)',
          background: 'Canvas',
          color: 'CanvasText',
          boxShadow: '0 4px 16px rgba(0,0,0,.13)',
          font: '12px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          cursor: 'pointer'
        });
        button.addEventListener('click', () => {
          const current = findEditor(doc);
          if (current) prepare(current);
        });
        (doc.body || doc.documentElement).appendChild(button);
      }
      placeButton(editor);
      return button;
    }

    function scheduleEnsureButton() {
      if (!floatingButton || !started || layoutPending) return false;
      layoutPending = true;
      deferLayout(() => {
        layoutPending = false;
        if (started) ensureButton();
      });
      return true;
    }

    function start() {
      if (started) return api;
      started = true;

      messageListener = (message, _sender, sendResponse) => {
        if (message?.type !== PREPARE_MESSAGE) return false;
        const current = findEditor(doc);
        if (!current) {
          sendResponse?.({ ok: false, message: 'Cardinal ne trouve pas la zone de texte ChatGPT. Recharge la conversation puis réessaie.' });
          return false;
        }
        Promise.resolve().then(() => clipboardText(editorText(current)))
          .then(prompt => sendResponse?.({ ok: true, prompt }))
          .catch(error => sendResponse?.({ ok: false, message: error?.message || String(error) }));
        return true;
      };
      runtime.onMessage?.addListener?.(messageListener);

      if (floatingButton) {
        ensureButton();
        if (MutationObserverApi) {
          observer = new MutationObserverApi(scheduleEnsureButton);
          observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
        }
        win?.addEventListener?.('resize', scheduleEnsureButton, { passive: true });
        win?.addEventListener?.('scroll', scheduleEnsureButton, { passive: true });
      }
      return api;
    }

    function stop() {
      if (!started) return false;
      started = false;
      observer?.disconnect?.();
      observer = null;
      if (messageListener) runtime.onMessage?.removeListener?.(messageListener);
      messageListener = null;
      win?.removeEventListener?.('resize', scheduleEnsureButton);
      win?.removeEventListener?.('scroll', scheduleEnsureButton);
      button?.remove?.();
      toast?.remove?.();
      button = null;
      toast = null;
      return true;
    }

    const api = Object.freeze({ start, stop, ensureButton, scheduleEnsureButton, prepare });
    return api;
  }

  const api = {
    BUTTON_ID,
    TOAST_ID,
    PROTOCOL_FILE_NAME,
    PROMPT_MARKER,
    PREPARE_MESSAGE,
    PRODUCTION_TYPES,
    MAX_PREPARE_TEXT_CHARS,
    COMPACT_PROTOCOL,
    isChatGptLocation,
    isAioRuntime,
    findEditor,
    findFileInput,
    editorText,
    triggerText,
    clipboardText,
    copyText,
    setEditorText,
    loadProtocol,
    inputContainsProtocol,
    composerContainsProtocol,
    mergeProtocolFile,
    waitForProtocolVisible,
    createHelper
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2PrepareHelper = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    try {
      globalThis.__cardinalFormativePrepareHelperV2 ||= createHelper().start();
    } catch (error) {
      console.error('[Cardinal Formative] prepare helper', error);
    }
  }
})();
