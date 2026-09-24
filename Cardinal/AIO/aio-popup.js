(() => {
  'use strict';

  const GROUP_MAP_KEY = 'pdcNativeClassroomGroupMapV1';
  const IMPORTER_STATUS = 'CARDINAL_FORMATIVE_IMPORT_STATUS';
  const CLASSROOM_STATUS = 'PDC_NATIVE_STATUS';
  const UI_RESCAN_MESSAGE = 'CARDINAL_FORMATIVE_UI_RESCAN';
  const PREPARE_MESSAGE = 'CARDINAL_FORMATIVE_PREPARE_CHATGPT';
  const DISMISS_STORAGE_KEY = 'cardinal.formative.v2.ui.dismissed';

  const MODULES = Object.freeze([
    Object.freeze({ id: 'gestion', label: 'Gestion 1.1.9' }),
    Object.freeze({ id: 'formativeCorrection', label: 'Correction Formative 1.1.3' }),
    Object.freeze({ id: 'formativeImporter', label: 'Importateur Formative 0.5 RC1' }),
    Object.freeze({ id: 'mozaik', label: 'Mozaïk v14' }),
    Object.freeze({ id: 'classroom', label: 'Pont Classroom 1.2.3' }),
    Object.freeze({ id: 'chatgpt', label: 'Pont ChatGPT 1.1.9' })
  ]);

  function classifyContext(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return 'generic';
      if (url.hostname === 'techno-cardi.github.io' && url.pathname.startsWith('/Exercices-francais/resultats')) return 'gestion';
      if (url.hostname === 'app.formative.com' && /^\/formatives\/[^/]+/i.test(url.pathname)) return 'formative';
      if (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') return 'chatgpt';
      if (url.hostname === 'classroom.google.com') return 'classroom';
      if (url.hostname === 'mozaikportail.ca') return 'mozaik';
    } catch {}
    return 'generic';
  }

  function plural(count, singular, pluralForm) {
    return count === 1 ? singular : pluralForm;
  }

  function buildDashboardModel(options = {}) {
    const context = classifyContext(options.activeUrl);
    const modules = MODULES.map(module => ({
      ...module,
      state: 'neutral',
      detail: 'Inclus'
    }));

    const byId = new Map(modules.map(module => [module.id, module]));
    const contextOwner = {
      gestion: 'gestion',
      formative: 'formativeCorrection',
      mozaik: 'mozaik',
      classroom: 'classroom',
      chatgpt: 'chatgpt'
    }[context];

    if (contextOwner) {
      byId.get(contextOwner).state = 'context';
      byId.get(contextOwner).detail = 'Page ouverte';
    }

    if (options.importerConfirmed === true) {
      const importer = byId.get('formativeImporter');
      importer.state = 'ok';
      const openCount = Math.max(0, Number(options.formativeAssessmentCount || 0));
      importer.detail = openCount > 0
        ? `Actif · ${openCount} ${plural(openCount, 'évaluation ouverte', 'évaluations ouvertes')}`
        : 'Actif';
    }

    const groupCount = Math.max(0, Number(options.classroomGroupCount || 0));
    const classroom = byId.get('classroom');
    if (options.classroomBridgeConfirmed === true) {
      classroom.state = 'ok';
      classroom.detail = groupCount
        ? `Actif · ${groupCount} ${plural(groupCount, 'liaison', 'liaisons')}`
        : 'Actif';
    } else if (context === 'classroom' && groupCount === 0) {
      classroom.state = 'attention';
      classroom.detail = 'Liaison à apprendre';
    } else if (groupCount > 0) {
      classroom.detail = `${groupCount} ${plural(groupCount, 'liaison mémorisée', 'liaisons mémorisées')}`;
    }

    const actions = context === 'chatgpt'
      ? [
          Object.freeze({ id: 'formative-prepare', label: 'Copier le prompt Formative', primary: true }),
          Object.freeze({ id: 'formative-rescan', label: 'Analyser cette page' }),
          Object.freeze({ id: 'formative-restore', label: 'Réafficher les barres masquées' })
        ]
      : [];

    return Object.freeze({
      context,
      modules: modules.map(module => Object.freeze({ ...module })),
      actions: Object.freeze(actions)
    });
  }

  async function readClassroomGroupCount(chromeApi) {
    try {
      const stored = await chromeApi.storage?.local?.get?.(GROUP_MAP_KEY);
      const map = stored?.[GROUP_MAP_KEY];
      return map && typeof map === 'object' ? Object.keys(map).length : 0;
    } catch {
      return 0;
    }
  }

  async function importerIsConfirmed(chromeApi) {
    try {
      const response = await chromeApi.runtime?.sendMessage?.({
        type: IMPORTER_STATUS,
        requestId: `popup-${Date.now()}`,
        payload: {}
      });
      return response?.handled === true;
    } catch {
      return false;
    }
  }

  async function classroomBridgeIsConfirmed(chromeApi, tab, context) {
    if (context !== 'classroom' || !Number.isInteger(tab?.id)) return false;
    try {
      const response = await chromeApi.tabs?.sendMessage?.(tab.id, { type: CLASSROOM_STATUS });
      return response?.ok === true;
    } catch {
      return false;
    }
  }

  async function formativeAssessmentCount(chromeApi) {
    if (!chromeApi?.tabs?.query) return 0;
    try {
      const tabs = await chromeApi.tabs.query({ url: 'https://app.formative.com/*' });
      return tabs.filter(tab => Number.isInteger(tab?.id) && classifyContext(tab?.url) === 'formative').length;
    } catch {
      return 0;
    }
  }

  async function activeChatGptTab(chromeApi) {
    if (!chromeApi?.tabs?.query) return null;
    try {
      const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
      return tabs.find(tab => Number.isInteger(tab?.id) && classifyContext(tab?.url) === 'chatgpt') || null;
    } catch {
      return null;
    }
  }

  async function rescanChatGpt(chromeApi) {
    const tab = await activeChatGptTab(chromeApi);
    if (!tab) throw new Error('Aucune page ChatGPT active.');
    await chromeApi.tabs.sendMessage(tab.id, { type: UI_RESCAN_MESSAGE });
    return 'Analyse relancée dans ChatGPT.';
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

  async function prepareChatGpt(chromeApi, options = {}) {
    const tab = await activeChatGptTab(chromeApi);
    if (!tab) throw new Error('Aucune page ChatGPT active.');
    let response;
    try {
      response = await chromeApi.tabs.sendMessage(tab.id, { type: PREPARE_MESSAGE });
    } catch {
      throw new Error('Recharge la page ChatGPT puis réessaie.');
    }
    if (response?.ok !== true) {
      throw new Error(response?.message || 'Préparation Formative impossible.');
    }
    if (!response.prompt || typeof response.prompt !== 'string') {
      throw new Error('Cardinal n’a reçu aucun prompt Formative à copier.');
    }
    const copied = await (options.copyText || copyText)(response.prompt, options);
    if (!copied) throw new Error('Impossible de copier le prompt. Autorise le presse-papiers puis réessaie.');
    return 'Prompt copié. Colle-le à la fin de ta demande ChatGPT.';
  }

  async function runAction(actionId, chromeApi, options = {}) {
    if (actionId === 'formative-prepare') return prepareChatGpt(chromeApi, options);
    if (actionId === 'formative-rescan') return rescanChatGpt(chromeApi);
    if (actionId === 'formative-restore') {
      await chromeApi.storage?.local?.remove?.(DISMISS_STORAGE_KEY);
      await rescanChatGpt(chromeApi);
      return 'Barres masquées réactivées.';
    }
    throw new Error('Action Cardinal AIO inconnue.');
  }

  async function inspectRuntime(chromeApi) {
    if (!chromeApi?.tabs) {
      return buildDashboardModel({});
    }
    let activeTab = null;
    try {
      const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
      activeTab = tabs.find(tab => Number.isInteger(tab?.id)) || tabs[0] || null;
    } catch {}

    const activeUrl = String(activeTab?.url || '');
    const context = classifyContext(activeUrl);
    const [importerConfirmed, formativeAssessmentCountValue, classroomGroupCount, classroomBridgeConfirmed] = await Promise.all([
      importerIsConfirmed(chromeApi),
      formativeAssessmentCount(chromeApi),
      readClassroomGroupCount(chromeApi),
      classroomBridgeIsConfirmed(chromeApi, activeTab, context)
    ]);

    return buildDashboardModel({
      activeUrl,
      importerConfirmed,
      formativeAssessmentCount: formativeAssessmentCountValue,
      classroomBridgeConfirmed,
      classroomGroupCount
    });
  }

  function element(doc, tag, text = '') {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function contextLabel(context) {
    return ({
      chatgpt: 'ChatGPT',
      formative: 'Formative',
      gestion: 'Gestion',
      classroom: 'Classroom',
      mozaik: 'Mozaïk',
      generic: 'Général'
    })[context] || 'Cardinal';
  }

  function compactStatus(model) {
    const parts = ['6 modules intégrés'];
    const importer = model.modules.find(module => module.id === 'formativeImporter');
    const classroom = model.modules.find(module => module.id === 'classroom');
    if (importer?.state === 'ok') {
      parts.push(importer.detail === 'Actif' ? 'Importateur actif' : importer.detail.replace(/^Actif · /, ''));
    }
    if (classroom?.state === 'attention') parts.push('Classroom à relier');
    return parts.join(' · ');
  }

  function render(host, model, doc = globalThis.document, chromeApi = globalThis.chrome) {
    if (!host || !doc) return false;
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const style = element(doc, 'style');
    style.textContent = [
      ':host{all:initial;display:block;margin:8px 10px 10px}',
      '.card{box-sizing:border-box;width:100%;border:1px solid #cbd5e1;border-radius:11px;background:#fff;color:#172033;padding:8px 9px;font:12px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.head{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{font-weight:800;font-size:13px}.context{color:#64748b;font-size:11px}',
      '.status{margin-top:3px;color:#526174;font-size:10.5px}',
      '.main-actions{margin-top:7px}.action{box-sizing:border-box;width:100%;text-align:left;padding:7px 9px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:inherit;cursor:pointer;font:650 11px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.action:hover{background:#f1f5f9}.action:disabled{opacity:.55;cursor:default}.action.primary{background:#132a4a;color:#fff;border-color:#132a4a;font-size:12px}.action.primary:hover{background:#1c3a63}',
      'details{margin-top:6px;border-top:1px solid #e2e8f0;padding-top:5px}summary{cursor:pointer;color:#475569;font-size:10.5px;font-weight:650;list-style-position:inside}.toolgrid{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:5px}',
      '.modulelist{display:grid;gap:3px;margin-top:5px}.module{display:flex;justify-content:space-between;gap:8px;padding:2px 0}.name{font-weight:650}.detail{color:#64748b;text-align:right}.module[data-state="ok"] .detail{color:#17633a}.module[data-state="attention"] .detail{color:#76530b}.module[data-state="context"] .detail{color:#24578f}',
      '.message:empty{display:none}.message{margin-top:6px;color:#526174;font-size:10.5px}',
      '@media (prefers-color-scheme:dark){.card{background:#171b22;color:#f4f7fb;border-color:#475569}.context,.status,.detail,.message,summary{color:#bdc9d8}details{border-color:#334155}.action{background:#202733;border-color:#465366}.action:hover{background:#283243}.action.primary{background:#315b8c;border-color:#315b8c}.module[data-state="ok"] .detail{color:#85d2a7}.module[data-state="attention"] .detail{color:#e7c46f}.module[data-state="context"] .detail{color:#8fb9ec}}'
    ].join('');

    const card = element(doc, 'section');
    card.className = 'card';
    card.setAttribute('aria-label', 'État des modules Cardinal AIO');

    const head = element(doc, 'div');
    head.className = 'head';
    const title = element(doc, 'div', 'Cardinal AIO');
    title.className = 'title';
    const context = element(doc, 'div', contextLabel(model.context));
    context.className = 'context';
    head.append(title, context);

    const status = element(doc, 'div', compactStatus(model));
    status.className = 'status';
    card.append(head, status);

    const message = element(doc, 'div');
    message.className = 'message';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');

    const mainActions = model.actions.filter(action => action.primary === true);
    if (mainActions.length) {
      const wrap = element(doc, 'div');
      wrap.className = 'main-actions';
      for (const action of mainActions) {
        const button = element(doc, 'button', action.label);
        button.className = 'action primary';
        button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            message.textContent = await runAction(action.id, chromeApi);
          } catch (error) {
            message.textContent = error?.message || String(error);
          } finally {
            button.disabled = false;
          }
        });
        wrap.appendChild(button);
      }
      card.appendChild(wrap);
    }

    const secondaryActions = model.actions.filter(action => action.primary !== true);
    if (secondaryActions.length) {
      const tools = element(doc, 'details');
      const summary = element(doc, 'summary', 'Outils Formative');
      const grid = element(doc, 'div');
      grid.className = 'toolgrid';
      for (const action of secondaryActions) {
        const button = element(doc, 'button', action.label);
        button.className = 'action';
        button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            message.textContent = await runAction(action.id, chromeApi);
          } catch (error) {
            message.textContent = error?.message || String(error);
          } finally {
            button.disabled = false;
          }
        });
        grid.appendChild(button);
      }
      tools.append(summary, grid);
      card.appendChild(tools);
    }

    const details = element(doc, 'details');
    const detailsSummary = element(doc, 'summary', 'État des modules');
    const moduleList = element(doc, 'div');
    moduleList.className = 'modulelist';
    for (const module of model.modules) {
      const row = element(doc, 'div');
      row.className = 'module';
      row.dataset.state = module.state;
      const name = element(doc, 'span', module.label);
      name.className = 'name';
      const detail = element(doc, 'span', module.detail);
      detail.className = 'detail';
      row.append(name, detail);
      moduleList.appendChild(row);
    }
    details.append(detailsSummary, moduleList);
    card.append(details, message);

    root.replaceChildren(style, card);
    return true;
  }

  async function start(options = {}) {
    const doc = options.document || globalThis.document;
    const chromeApi = options.chromeApi || globalThis.chrome;
    const host = options.host || doc?.getElementById?.('cardinal-aio-dashboard');
    if (!host) return false;
    const model = await inspectRuntime(chromeApi);
    return render(host, model, doc, chromeApi);
  }

  const api = {
    GROUP_MAP_KEY,
    IMPORTER_STATUS,
    CLASSROOM_STATUS,
    UI_RESCAN_MESSAGE,
    PREPARE_MESSAGE,
    DISMISS_STORAGE_KEY,
    MODULES,
    classifyContext,
    buildDashboardModel,
    readClassroomGroupCount,
    importerIsConfirmed,
    classroomBridgeIsConfirmed,
    formativeAssessmentCount,
    activeChatGptTab,
    rescanChatGpt,
    copyText,
    prepareChatGpt,
    runAction,
    inspectRuntime,
    contextLabel,
    compactStatus,
    render,
    start
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalAioPopup = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    if (globalThis.document.readyState === 'loading') {
      globalThis.document.addEventListener('DOMContentLoaded', () => {
        start().catch(error => console.error('[Cardinal AIO popup]', error));
      }, { once: true });
    } else {
      start().catch(error => console.error('[Cardinal AIO popup]', error));
    }
  }
})();
