(() => {
  'use strict';

  const DISMISS_STORAGE_KEY = 'cardinal.formative.v2.ui.dismissed';
  const UI_RESCAN_MESSAGE = 'CARDINAL_FORMATIVE_UI_RESCAN';

  function isChatGptUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com');
    } catch {
      return false;
    }
  }

  function isFormativeAssessmentUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'app.formative.com' && /^\/formatives\/[^/]+/.test(url.pathname);
    } catch {
      return false;
    }
  }

  async function activeChatGptTab(tabsApi) {
    const tabs = await tabsApi.query({ active: true, currentWindow: true });
    return tabs.find(tab => Number.isInteger(tab?.id) && isChatGptUrl(tab?.url)) || null;
  }

  async function formativeAssessmentTabs(tabsApi) {
    const tabs = await tabsApi.query({ url: 'https://app.formative.com/*' });
    return tabs.filter(tab => Number.isInteger(tab?.id) && isFormativeAssessmentUrl(tab?.url));
  }

  function formativeStatusText(count) {
    if (count === 0) return 'Aucun Formative d’évaluation ouvert';
    if (count === 1) return '1 Formative d’évaluation ouvert';
    return `${count} Formatives d’évaluation ouverts`;
  }

  function createPopup(options = {}) {
    const doc = options.document || globalThis.document;
    const chromeApi = options.chromeApi || globalThis.chrome;
    if (!doc || !chromeApi?.tabs || !chromeApi?.storage?.local) throw new Error('popup dependencies required');

    const $ = id => doc.getElementById(id);
    const message = text => { const node = $('message'); if (node) node.textContent = text || ''; };

    async function refreshStatus() {
      const [chat, formatives] = await Promise.all([
        activeChatGptTab(chromeApi.tabs),
        formativeAssessmentTabs(chromeApi.tabs)
      ]);
      if ($('formativeStatus')) $('formativeStatus').textContent = formativeStatusText(formatives.length);
      if ($('chatgptStatus')) $('chatgptStatus').textContent = chat
        ? 'Page ChatGPT active détectée.'
        : 'Ouvre la conversation ChatGPT à analyser dans l’onglet actif.';
      if ($('rescan')) $('rescan').disabled = !chat;
      if ($('restore')) $('restore').disabled = !chat;
      return { chat, formatives };
    }

    async function rescan() {
      const tab = await activeChatGptTab(chromeApi.tabs);
      if (!tab) {
        message('Aucune page ChatGPT active.');
        return false;
      }
      try {
        await chromeApi.tabs.sendMessage(tab.id, { type: UI_RESCAN_MESSAGE });
        message('Analyse relancée dans ChatGPT.');
        return true;
      } catch {
        message('Recharge la page ChatGPT puis réessaie.');
        return false;
      }
    }

    async function restoreDismissed() {
      await chromeApi.storage.local.remove(DISMISS_STORAGE_KEY);
      const ok = await rescan();
      if (ok) message('Barres masquées réactivées.');
      return ok;
    }

    function bind() {
      $('rescan')?.addEventListener('click', () => rescan().catch(() => message('Impossible de relancer l’analyse.')));
      $('restore')?.addEventListener('click', () => restoreDismissed().catch(() => message('Impossible de réafficher les barres.')));
      refreshStatus().catch(() => message('État des onglets indisponible.'));
      return api;
    }

    const api = Object.freeze({ bind, refreshStatus, rescan, restoreDismissed });
    return api;
  }

  const api = {
    DISMISS_STORAGE_KEY,
    UI_RESCAN_MESSAGE,
    isChatGptUrl,
    isFormativeAssessmentUrl,
    activeChatGptTab,
    formativeAssessmentTabs,
    formativeStatusText,
    createPopup
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Popup = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    globalThis.document.addEventListener('DOMContentLoaded', () => {
      try { createPopup().bind(); }
      catch (error) { console.error('[Cardinal Formative] popup', error); }
    }, { once: true });
  }
})();
