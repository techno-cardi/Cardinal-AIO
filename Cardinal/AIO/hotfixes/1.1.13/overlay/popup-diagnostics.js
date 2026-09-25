(() => {
  'use strict';
  if (window.CardinalPopupDiagnostics) return;

  const $ = id => document.getElementById(id);

  function record(event, data = {}, level = 'info') {
    try {
      chrome.runtime.sendMessage({ type:'CARDINAL_DIAGNOSTIC_RECORD', scope:'popup', event, data, level }).catch(() => {});
    } catch {}
  }

  function status(text) {
    const el = $('diagnosticStatus');
    if (el) el.textContent = String(text || '');
  }

  async function activeTab() {
    try {
      const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
      return tabs?.[0] || null;
    } catch { return null; }
  }

  function filename() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `Cardinal-diagnostic-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
  }

  async function initialize() {
    const toggle = $('diagnosticDeep');
    const exportBtn = $('diagnosticExport');
    const clearBtn = $('diagnosticClear');
    if (!toggle || !exportBtn || !clearBtn) return;

    try {
      const r = await chrome.runtime.sendMessage({ type:'CARDINAL_DIAGNOSTIC_GET_MODE' });
      toggle.checked = r?.enabled === true;
      status(toggle.checked
        ? 'Mode approfondi actif. Les réponses réseau sont exportées sous forme nettoyée et structurée.'
        : 'Journal léger actif. Les secrets d’authentification ne sont jamais inclus.');
    } catch (error) {
      status(`Diagnostic indisponible: ${error?.message || String(error)}`);
    }

    toggle.addEventListener('change', async () => {
      status('Mise à jour du mode diagnostic…');
      try {
        const r = await chrome.runtime.sendMessage({ type:'CARDINAL_DIAGNOSTIC_SET_MODE', enabled:toggle.checked });
        if (!r?.ok) throw new Error(r?.message || 'Impossible de changer le mode diagnostic.');
        status(toggle.checked
          ? 'Mode approfondi actif. Les réponses réseau sont exportées sous forme nettoyée et structurée.'
          : 'Journal léger actif. Les secrets d’authentification ne sont jamais inclus.');
      } catch (error) {
        status(error?.message || String(error));
      }
    });

    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      status('Collecte des logs, pages, bridges et réponses réseau…');
      try {
        const tab = await activeTab();
        record('export.clicked', { activeTabId:tab?.id || null, deep:toggle.checked });
        const r = await chrome.runtime.sendMessage({
          type:'CARDINAL_DIAGNOSTIC_EXPORT',
          activeTabId:tab?.id || null,
          deep:toggle.checked
        });
        if (!r?.ok || !r.bundle) throw new Error(r?.message || 'Impossible de produire le diagnostic.');
        const json = JSON.stringify(r.bundle, null, 2);
        const blob = new Blob([json], { type:'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename();
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        const h=r.bundle.health||{};
        const bridgeProblems=(h.formativeBridgeFailures||[]).length+(h.chatgptBridgeFailures||[]).length;
        status(`Diagnostic téléchargé · Formative: ${h.formativeTabCount||0} onglet(s) · session: ${h.sessionAvailable?'OK':'absente'} · bridges: ${bridgeProblems?'problème détecté':'OK'}. Joins-moi le JSON.`);
      } catch (error) {
        status(error?.message || String(error));
      } finally {
        exportBtn.disabled = false;
      }
    });

    clearBtn.addEventListener('click', async () => {
      clearBtn.disabled = true;
      status('Effacement des logs…');
      try {
        const r = await chrome.runtime.sendMessage({ type:'CARDINAL_DIAGNOSTIC_CLEAR' });
        if (!r?.ok) throw new Error(r?.message || 'Impossible d’effacer les logs.');
        status('Logs effacés. Le prochain essai repart avec un journal propre.');
      } catch (error) {
        status(error?.message || String(error));
      } finally {
        clearBtn.disabled = false;
      }
    });
  }

  window.CardinalPopupDiagnostics = Object.freeze({ record, status, initialize });
  initialize().catch(error => status(error?.message || String(error)));
})();