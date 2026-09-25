(() => {
  'use strict';

  if (globalThis.CardinalDiagnostics) return;

  const LOG_KEY = 'cardinal.diagnostics.v1.logs';
  const MODE_KEY = 'cardinal.diagnostics.v1.deep';
  const MAX_LOGS = 500;
  const MAX_AGE_MS = 48 * 60 * 60 * 1000;
  const OWN_TYPES = new Set([
    'CARDINAL_DIAGNOSTIC_RECORD',
    'CARDINAL_DIAGNOSTIC_EXPORT',
    'CARDINAL_DIAGNOSTIC_CLEAR',
    'CARDINAL_DIAGNOSTIC_GET_MODE',
    'CARDINAL_DIAGNOSTIC_SET_MODE'
  ]);

  const SECRET_KEY_RE = /(?:^|[_-])(authorization|cookie|set-cookie|password|passwd|secret|bearer|access[_-]?token|refresh[_-]?token|api[_-]?key|csrf|xsrf)(?:$|[_-])/i;
  const PII_KEY_RE = /(?:^|[_-])(email|first[_-]?name|last[_-]?name|full[_-]?name|display[_-]?name|student[_-]?name|student[_-]?id|teacher[_-]?id|user[_-]?id)(?:$|[_-])/i;
  const LONG_ID_RE = /^[A-Za-z0-9_-]{10,120}$/;
  let writeChain = Promise.resolve();

  function nowIso() { return new Date().toISOString(); }

  function oneLine(value, max = 500) {
    let text = String(value ?? '').replace(/\s+/g, ' ').trim();
    text = text
      .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED_SECRET]')
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function safeUrl(value) {
    try {
      const u = new URL(String(value || ''));
      const allowed = new Set(['selectedAssignmentId','selectedFormativeItemId','formativeImport','formativeFeedback']);
      const params = [];
      for (const [key, val] of u.searchParams.entries()) {
        if (!allowed.has(key)) continue;
        params.push(`${key}=${encodeURIComponent(oneLine(val, 120))}`);
      }
      return `${u.origin}${u.pathname}${params.length ? `?${params.join('&')}` : ''}`;
    } catch { return oneLine(value, 300); }
  }

  function sanitize(value, key = '', depth = 0, seen = new WeakSet()) {
    if (value == null) return value;
    if (SECRET_KEY_RE.test(String(key || ''))) return '[REDACTED_SECRET]';
    if (PII_KEY_RE.test(String(key || ''))) return '[REDACTED_PII]';
    if (depth > 6) return '[MAX_DEPTH]';
    if (typeof value === 'string') {
      if (/url$/i.test(key) || key === 'url' || key === 'route') return safeUrl(value);
      return oneLine(value, 1200);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value !== 'object') return oneLine(value, 300);
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value)) {
      const rows = value.slice(0, 40).map((item, index) => sanitize(item, `${key}[${index}]`, depth + 1, seen));
      if (value.length > 40) rows.push(`[+${value.length - 40} more]`);
      return rows;
    }
    const out = {};
    let count = 0;
    for (const [k, v] of Object.entries(value)) {
      if (count++ >= 80) { out.__truncatedKeys = true; break; }
      out[k] = sanitize(v, k, depth + 1, seen);
    }
    return out;
  }

  function compactData(data) {
    const safe = sanitize(data);
    try {
      const json = JSON.stringify(safe);
      if (json.length <= 12000) return safe;
      return { truncated: true, preview: json.slice(0, 12000) };
    } catch { return { unreadable: true }; }
  }

  async function readLogs() {
    try {
      const row = await chrome.storage.session.get(LOG_KEY);
      const list = Array.isArray(row?.[LOG_KEY]) ? row[LOG_KEY] : [];
      const cutoff = Date.now() - MAX_AGE_MS;
      return list.filter(item => Number(item?.ts || 0) >= cutoff).slice(-MAX_LOGS);
    } catch { return []; }
  }

  function record(scope, event, data = {}, level = 'info') {
    const entry = {
      ts: Date.now(),
      at: nowIso(),
      scope: oneLine(scope || 'unknown', 80),
      event: oneLine(event || 'event', 120),
      level: oneLine(level || 'info', 20),
      data: compactData(data)
    };
    writeChain = writeChain.then(async () => {
      try {
        const list = await readLogs();
        list.push(entry);
        await chrome.storage.session.set({ [LOG_KEY]: list.slice(-MAX_LOGS) });
      } catch {}
    });
    return entry;
  }

  async function getMode() {
    try {
      const row = await chrome.storage.local.get(MODE_KEY);
      return row?.[MODE_KEY] === true;
    } catch { return false; }
  }

  async function setMode(enabled) {
    await chrome.storage.local.set({ [MODE_KEY]: enabled === true });
    record('diagnostics', 'mode.changed', { enabled: enabled === true });
    return enabled === true;
  }

  async function clear() {
    try { await chrome.storage.session.remove(LOG_KEY); } catch {}
    return true;
  }

  function senderSummary(sender = {}) {
    return {
      tabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
      url: safeUrl(sender?.url || sender?.documentUrl || sender?.tab?.url || ''),
      frameId: Number.isInteger(sender?.frameId) ? sender.frameId : null
    };
  }

  function contextSummary(ctx) {
    if (!ctx || typeof ctx !== 'object') return null;
    const qs = Array.isArray(ctx.questions) ? ctx.questions : (ctx.question ? [ctx.question] : []);
    return {
      version: ctx.version || null,
      createdAt: ctx.createdAt || null,
      batchId: ctx.batchId || null,
      sessionId: ctx.sessionId || null,
      formativeId: ctx.formativeId || null,
      assignmentId: ctx.assignmentId || null,
      sectionId: ctx.sectionId || null,
      sectionTitle: ctx.sectionTitle || null,
      mode: ctx.mode || null,
      notePublishingBlocked: ctx.notePublishingBlocked === true,
      reviewAlreadyGraded: ctx.reviewAlreadyGraded === true,
      selectedQuestionIds: Array.isArray(ctx.selectedQuestionIds) ? ctx.selectedQuestionIds.map(String) : [],
      questionCount: qs.length,
      questions: qs.slice(0, 80).map(q => ({
        id: q?.id || null,
        number: q?.number ?? null,
        subtype: q?.subtype || null,
        points: q?.points ?? null,
        answerCount: Array.isArray(q?.answers) ? q.answers.length : 0,
        structuredReadGapCount: Array.isArray(q?.answers) ? q.answers.filter(a => Array.isArray(a?.unresolvedTokens) && a.unresolvedTokens.filter(Boolean).length).length : 0
      }))
    };
  }

  function pendingPreviewSummary(preview) {
    if (!preview || typeof preview !== 'object') return null;
    return {
      createdAt: preview.createdAt || null,
      rowCount: Array.isArray(preview.rows) ? preview.rows.length : 0,
      context: contextSummary(preview.context),
      recognized: preview.recognized ?? null,
      unmatched: preview.unmatched ?? null,
      ambiguous: preview.ambiguous ?? null,
      invalid: preview.invalid ?? null,
      missing: preview.missing ?? null
    };
  }

  async function selectedStorageSummaries() {
    const out = {};
    try {
      const local = await chrome.storage.local.get([
        'cardinal_simple_pending_preview_v092',
        'cardinal_simple_formative_context_v0933'
      ]);
      out.pendingPreview = pendingPreviewSummary(local?.cardinal_simple_pending_preview_v092);
      out.simpleContext = contextSummary(local?.cardinal_simple_formative_context_v0933);
    } catch (error) {
      out.localStorageError = oneLine(error?.message || error, 500);
    }
    try {
      const session = await chrome.storage.session.get(null);
      out.sessionKeys = Object.keys(session || {}).filter(k => /^cardinal/i.test(k)).sort();
    } catch (error) {
      out.sessionStorageError = oneLine(error?.message || error, 500);
    }
    return out;
  }

  function pageNetworkDiagnostics(deep = false) {
    const secretRe = /authorization|cookie|password|secret|bearer|token|csrf|xsrf/i;
    const piiRe = /email|firstname|lastname|fullname|displayname|studentname|studentid|teacherid|userid/i;
    const userBranchRe = /(?:^|\.)(students?|users?)(?:\.|$)/i;
    const answerBranchRe = /(?:^|\.)(answers?|responses?|submissions?|feedback)(?:\.|$)/i;
    const cache = Array.isArray(window.__cardinalFormativeGraphqlCache) ? window.__cardinalFormativeGraphqlCache : [];

    function safeScalar(value, path, key) {
      if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
      const text = String(value);
      if (secretRe.test(key)) return '[REDACTED_SECRET]';
      if (piiRe.test(key)) return '[REDACTED_PII]';
      if (userBranchRe.test(path) && !/^(_id|id|points|possiblePoints|questionNumber|type|subtype)$/i.test(key)) {
        return `<redacted-user-value len=${text.length}>`;
      }
      if (answerBranchRe.test(path) && !/^(_id|id|key|choiceId|blankId|formativeItemId|points|possiblePoints|questionNumber|type|subtype)$/i.test(key)) {
        return `<redacted-answer-value len=${text.length}>`;
      }
      if (text.length <= 80) return text;
      return `<string len=${text.length}>`;
    }

    function shape(value, path = 'data', depth = 0) {
      if (depth > 5) return '[MAX_DEPTH]';
      if (value == null || typeof value !== 'object') {
        const key = path.split('.').pop() || '';
        return safeScalar(value, path, key);
      }
      if (Array.isArray(value)) {
        return {
          __type: 'array',
          length: value.length,
          sample: value.slice(0, deep ? 4 : 1).map((v, i) => shape(v, `${path}[${i}]`, depth + 1))
        };
      }
      const out = {};
      const entries = Object.entries(value);
      for (const [key, val] of entries.slice(0, deep ? 50 : 24)) {
        if (secretRe.test(key)) { out[key] = '[REDACTED_SECRET]'; continue; }
        if (piiRe.test(key)) { out[key] = '[REDACTED_PII]'; continue; }
        out[key] = shape(val, `${path}.${key}`, depth + 1);
      }
      if (entries.length > (deep ? 50 : 24)) out.__truncatedKeys = entries.length - (deep ? 50 : 24);
      return out;
    }

    const host = document.getElementById('cardinal-formative-simple-092');
    const root = host?.shadowRoot || null;
    const buttonState = id => {
      const el = root?.getElementById?.(id);
      return el ? { exists:true, disabled:!!el.disabled, hidden:el.classList?.contains('hidden') || el.style?.display === 'none', text:String(el.textContent || '').trim().slice(0,120) } : { exists:false };
    };
    const params = new URLSearchParams(location.search);
    return {
      url: location.origin + location.pathname + location.search,
      title: document.title,
      readyState: document.readyState,
      selectedAssignmentId: params.get('selectedAssignmentId') || null,
      selectedFormativeItemId: params.get('selectedFormativeItemId') || null,
      globals: {
        networkCaptureInstalled: window.__cardinalFormativeNetworkCaptureInstalled === true,
        graphqlCacheCount: cache.length
      },
      cardinalUi: {
        hostExists: !!host,
        shadowExists: !!root,
        correctBtn: buttonState('correctBtn'),
        gestionBtn: buttonState('gestionBtn'),
        copyOpenBtn: buttonState('copyOpenBtn'),
        publishBtn: buttonState('publishBtn'),
        chooseModalOpen: !!root?.getElementById?.('chooseModal')?.classList?.contains('show'),
        previewModalOpen: !!root?.getElementById?.('previewModal')?.classList?.contains('show'),
        sectionValue: root?.getElementById?.('sectionSelect')?.value || null,
        selectedQuestionCount: root ? [...root.querySelectorAll('input[data-qid]:checked')].length : 0,
        totalQuestionCheckboxes: root ? root.querySelectorAll('input[data-qid]').length : 0,
        chooserStatus: String(root?.getElementById?.('chooseStatus')?.textContent || '').trim().slice(0,500),
        statusMessage: String(root?.getElementById?.('statusMsg')?.textContent || '').trim().slice(0,500)
      },
      network: cache.slice(-24).map(row => ({
        ts: row?.ts || null,
        operationName: String(row?.operationName || ''),
        variableKeys: row?.variables && typeof row.variables === 'object' ? Object.keys(row.variables) : [],
        variables: deep ? shape(row?.variables || {}, 'variables', 0) : undefined,
        queryPreview: deep ? String(row?.query || '').replace(/\s+/g,' ').slice(0,500) : undefined,
        responseShape: shape(row?.data, 'data', 0),
        errors: Array.isArray(row?.errors) ? row.errors.slice(0,5).map(e => String(e?.message || e || '').slice(0,300)) : [],
        networkError: row?.networkError ? String(row.networkError).slice(0,300) : null,
        status: row?.status ?? null
      }))
    };
  }

  function chatGptPageDiagnostics() {
    const text = String(document.body?.innerText || '');
    const cardinalNodes = [...document.querySelectorAll('[data-cardinal-formative-bar],[data-cardinal-formative-review],[data-cardinal-formative-inline]')];
    const batches = [...new Set([...text.matchAll(/CARDINAL_BATCH_ID\s*:\s*([A-Za-z0-9-]{8,})/gi)].map(m => m[1]))].slice(-20);
    return {
      url: location.origin + location.pathname,
      title: document.title,
      readyState: document.readyState,
      packageSentinelCount: (text.match(/CARDINAL_FORMATIVE_PACKAGE_V2/g) || []).length,
      batchIdsVisible: batches,
      markdownTableCount: document.querySelectorAll('table').length,
      codeBlockCount: document.querySelectorAll('pre,code').length,
      cardinalNodeCount: cardinalNodes.length,
      visibleCardinalTexts: cardinalNodes.slice(-10).map(node => String(node.textContent || '').replace(/\s+/g,' ').trim().slice(0,400))
    };
  }

  function gestionPageDiagnostics() {
    const dialog = document.getElementById('formativeImportDialog');
    const boxes = [...document.querySelectorAll('#formativeQuestionList input[type="checkbox"]')];
    return {
      url: location.origin + location.pathname + location.search,
      title: document.title,
      readyState: document.readyState,
      formativeDialog: {
        exists: !!dialog,
        open: !!dialog?.open,
        questionCount: boxes.length,
        selectedQuestionCount: boxes.filter(x => x.checked).length,
        destinationValue: document.getElementById('formativeDestination')?.value || null,
        importGradesChecked: document.getElementById('formativeImportGrades')?.checked ?? null,
        stateText: String(document.getElementById('formativeImportState')?.textContent || '').trim().slice(0,400),
        warningText: String(document.getElementById('formativeImportWarning')?.textContent || '').trim().slice(0,500)
      },
      sessionMarkers: {
        pendingFormativeImport: !!sessionStorage.getItem('pending_formative_import'),
        globalFormativeImport: !!sessionStorage.getItem('cardinal_global_formative_import'),
        pendingFeedback: !!sessionStorage.getItem('pending_formative_chatgpt_feedback')
      }
    };
  }

  async function executePageDiagnostic(tab, kind, deep) {
    if (!Number.isInteger(tab?.id)) return null;
    try {
      let func = null;
      let world = 'ISOLATED';
      if (kind === 'formative') { func = pageNetworkDiagnostics; world = 'MAIN'; }
      else if (kind === 'chatgpt') func = chatGptPageDiagnostics;
      else if (kind === 'gestion') func = gestionPageDiagnostics;
      if (!func) return null;
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world,
        func,
        args: kind === 'formative' ? [deep === true] : []
      });
      return result?.[0]?.result || null;
    } catch (error) {
      return { error: oneLine(error?.message || error, 800) };
    }
  }

  async function bridgePings(tab, kind) {
    if (!Number.isInteger(tab?.id)) return null;
    try {
      if (kind === 'formative') {
        const ping = await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_PING' });
        let state = null;
        try { state = await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_SIMPLE_DIAGNOSTICS' }); } catch {}
        return sanitize({ ping, state });
      }
      if (kind === 'chatgpt') {
        const ping = await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_CHATGPT_BRIDGE_PING' });
        let state = null;
        try { state = await chrome.tabs.sendMessage(tab.id, { type:'CARDINAL_CHATGPT_DIAGNOSTICS' }); } catch {}
        return sanitize({ ping, state });
      }
      return null;
    } catch (error) {
      return { ok:false, error:oneLine(error?.message || error, 500) };
    }
  }

  function tabKind(url) {
    try {
      const u = new URL(String(url || ''));
      if (u.hostname === 'app.formative.com' && /^\/formatives\//i.test(u.pathname)) return 'formative';
      if (u.hostname === 'chatgpt.com' || u.hostname === 'chat.openai.com') return 'chatgpt';
      if (u.hostname === 'techno-cardi.github.io' && u.pathname.startsWith('/Exercices-francais/resultats')) return 'gestion';
      if (u.hostname === 'mozaikportail.ca') return 'mozaik';
    } catch {}
    return 'other';
  }

  async function exportBundle(options = {}) {
    await writeChain.catch(() => {});
    const deep = options.deep === true || await getMode();
    const tabs = await chrome.tabs.query({});
    const relevantTabs = tabs.filter(tab => ['formative','chatgpt','gestion','mozaik'].includes(tabKind(tab.url)));
    const pageDiagnostics = [];
    for (const tab of relevantTabs) {
      const kind = tabKind(tab.url);
      const row = {
        tabId: tab.id,
        active: !!tab.active,
        windowId: tab.windowId,
        kind,
        url: safeUrl(tab.url),
        title: kind === 'chatgpt' ? '[REDACTED_CHAT_TITLE]' : oneLine(tab.title, 200),
        status: tab.status || null,
        bridge: await bridgePings(tab, kind)
      };
      if (kind === 'formative' || kind === 'chatgpt' || kind === 'gestion') {
        row.page = sanitize(await executePageDiagnostic(tab, kind, deep));
      }
      pageDiagnostics.push(row);
    }

    let importer = null;
    try {
      const app = globalThis.__cardinalFormativeV2App;
      importer = {
        importerVersion: globalThis.CardinalFormativeV2Background?.IMPORTER_VERSION || null,
        controllerSnapshot: sanitize(app?.controller?.snapshot?.() || null),
        sessionDiagnostics: sanitize(await app?.product?.sessionDiagnostics?.() || null)
      };
    } catch (error) {
      importer = { error:oneLine(error?.message || error, 500) };
    }

    const logs = await readLogs();
    const storage = await selectedStorageSummaries();
    const manifest = chrome.runtime.getManifest();
    const bundle = {
      schema: 'cardinal.diagnostics/1',
      generatedAt: nowIso(),
      deepMode: deep,
      privacy: {
        secretsIncluded: false,
        authorizationIncluded: false,
        cookiesIncluded: false,
        note: 'Les secrets et principaux identifiants personnels sont masqués. Les identifiants techniques Cardinal/Formative utiles au diagnostic peuvent rester visibles.'
      },
      extension: {
        id: chrome.runtime.id,
        name: manifest.name,
        version: manifest.version,
        versionName: manifest.version_name || null,
        manifestVersion: manifest.manifest_version,
        serviceWorker: manifest.background?.service_worker || null,
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        hostPermissions: Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [],
        contentScriptCount: Array.isArray(manifest.content_scripts) ? manifest.content_scripts.length : 0,
        contentScripts: (manifest.content_scripts || []).map(row=>({matches:row.matches||[],js:row.js||[],runAt:row.run_at||null,world:row.world||'ISOLATED'})),
        userAgent: navigator.userAgent
      },
      activeTabId: Number.isInteger(options.activeTabId) ? options.activeTabId : null,
      relevantTabs: pageDiagnostics,
      importer,
      health: {
        formativeTabCount: pageDiagnostics.filter(x=>x.kind==='formative').length,
        chatgptTabCount: pageDiagnostics.filter(x=>x.kind==='chatgpt').length,
        gestionTabCount: pageDiagnostics.filter(x=>x.kind==='gestion').length,
        multipleFormativeTabs: pageDiagnostics.filter(x=>x.kind==='formative').length > 1,
        formativeBridgeFailures: pageDiagnostics.filter(x=>x.kind==='formative' && x.bridge?.ping?.ok!==true).map(x=>x.tabId),
        chatgptBridgeFailures: pageDiagnostics.filter(x=>x.kind==='chatgpt' && x.bridge?.ping?.ok!==true).map(x=>x.tabId),
        sessionAvailable: importer?.sessionDiagnostics?.available === true,
        pendingPreview: !!storage?.pendingPreview,
        activeCorrectionContext: !!storage?.simpleContext
      },
      storage: sanitize(storage),
      logs
    };
    record('diagnostics', 'export.created', { deep, relevantTabCount: relevantTabs.length, logCount: logs.length });
    return bundle;
  }

  function attachRuntime() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const type = String(message?.type || '');

      if (type && !OWN_TYPES.has(type)) {
        record('runtime', 'message.received', {
          type,
          sender: senderSummary(sender),
          payloadKeys: message?.payload && typeof message.payload === 'object' ? Object.keys(message.payload).slice(0,40) : [],
          topLevelKeys: Object.keys(message || {}).slice(0,40)
        });
        return false;
      }

      if (type === 'CARDINAL_DIAGNOSTIC_RECORD') {
        record(message.scope || 'content', message.event || 'event', message.data || {}, message.level || 'info');
        sendResponse?.({ ok:true });
        return false;
      }
      if (type === 'CARDINAL_DIAGNOSTIC_GET_MODE') {
        getMode().then(enabled => sendResponse({ ok:true, enabled })).catch(error => sendResponse({ ok:false, message:oneLine(error?.message || error) }));
        return true;
      }
      if (type === 'CARDINAL_DIAGNOSTIC_SET_MODE') {
        setMode(message.enabled === true).then(enabled => sendResponse({ ok:true, enabled })).catch(error => sendResponse({ ok:false, message:oneLine(error?.message || error) }));
        return true;
      }
      if (type === 'CARDINAL_DIAGNOSTIC_CLEAR') {
        clear().then(() => sendResponse({ ok:true })).catch(error => sendResponse({ ok:false, message:oneLine(error?.message || error) }));
        return true;
      }
      if (type === 'CARDINAL_DIAGNOSTIC_EXPORT') {
        exportBundle({ activeTabId:Number(message.activeTabId), deep:message.deep === true })
          .then(bundle => sendResponse({ ok:true, bundle }))
          .catch(error => sendResponse({ ok:false, message:oneLine(error?.message || error, 1000) }));
        return true;
      }
      return false;
    });

    try {
      self.addEventListener('error', event => record('service-worker', 'error', { message:event?.message || 'worker error', filename:event?.filename, lineno:event?.lineno, colno:event?.colno }, 'error'));
      self.addEventListener('unhandledrejection', event => record('service-worker', 'unhandledrejection', { reason:oneLine(event?.reason?.message || event?.reason || '', 1200) }, 'error'));
    } catch {}

    try {
      const filter = { urls:['https://svc.goformative.com/graphql*'] };
      chrome.webRequest?.onCompleted?.addListener?.(details => {
        record('network', 'graphql.completed', { tabId:details.tabId, method:details.method, statusCode:details.statusCode, url:safeUrl(details.url), fromCache:details.fromCache === true });
      }, filter);
      chrome.webRequest?.onErrorOccurred?.addListener?.(details => {
        record('network', 'graphql.error', { tabId:details.tabId, method:details.method, error:details.error, url:safeUrl(details.url) }, 'error');
      }, filter);
    } catch {}
  }

  const api = Object.freeze({
    LOG_KEY,
    MODE_KEY,
    record,
    sanitize,
    getMode,
    setMode,
    clear,
    exportBundle
  });
  globalThis.CardinalDiagnostics = api;
  attachRuntime();
  record('service-worker', 'diagnostics.ready', { build: (() => { try { const m=chrome.runtime.getManifest(); return m.version_name || m.version; } catch { return ''; } })() });
})();