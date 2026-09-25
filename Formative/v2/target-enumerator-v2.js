(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function formativeIdFromUrl(value) {
    const url = String(value || '');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'app.formative.com') return null;
      const match = parsed.pathname.match(/^\/formatives\/([^/]+)/i);
      return match?.[1] ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function safeCode(error) {
    return error?.code || error?.reason || 'TARGET_PROBE_FAILED';
  }

  function expiredSessionError(tabId, targetFormativeId) {
    const error = new Error('La session Formative doit être recapturée avant de vérifier cette évaluation.');
    error.code = 'SESSION_REAUTH_REQUIRED';
    error.mutationMayHaveCommitted = false;
    error.tabId = tabId;
    error.targetFormativeId = targetFormativeId;
    return error;
  }

  function createEnumerator(options = {}) {
    const tabsApi = required(options.tabsApi, 'chrome.tabs');
    const product = required(options.product, 'production product facade');
    if (typeof tabsApi.query !== 'function') throw new Error('chrome.tabs.query required');
    if (typeof product.inspectTarget !== 'function') throw new Error('product.inspectTarget required');

    const queryInfo = options.queryInfo || { url: ['https://app.formative.com/*'] };

    async function enumerate() {
      const tabs = await tabsApi.query(queryInfo);
      const candidates = [];
      const probeErrors = [];

      for (const tab of Array.isArray(tabs) ? tabs : []) {
        const targetFormativeId = formativeIdFromUrl(tab?.url);
        if (!targetFormativeId || tab?.id == null) continue;

        try {
          const observation = await product.inspectTarget({
            targetFormativeId,
            targetTabId: tab.id
          });

          // The production gateway intentionally converts a 401/403/missing
          // captured session into an observation instead of throwing. For
          // discovery, however, an expired observation is a recoverable probe
          // failure: session-bootstrap needs this signal to perform its single
          // bounded Formative reload and then retry the read once.
          if (observation?.authState === 'expired') {
            throw expiredSessionError(tab.id, targetFormativeId);
          }

          const observedTargetFormativeId = observation?.targetFormativeId || null;
          const urlTargetFormativeId = observation?.urlTargetFormativeId || targetFormativeId;

          candidates.push({
            tabId: tab.id,
            // The URL identifies what this concrete browser tab is displaying.
            // Server/page observations are verification signals and must never
            // silently replace the tab identity used by the chooser.
            targetFormativeId: String(targetFormativeId),
            title: observation?.title || tab?.title || 'Formative sans titre',
            active: tab?.active === true,
            canEdit: observation?.canEdit === true ? true : observation?.canEdit === false ? false : null,
            authState: observation?.authState || 'unknown',
            pageKind: observation?.pageKind || 'editor',
            observedAt: observation?.observedAt || null,
            observedTargetFormativeId: observedTargetFormativeId ? String(observedTargetFormativeId) : null,
            serverTargetFormativeId: observation?.serverTargetFormativeId || null,
            urlTargetFormativeId: String(urlTargetFormativeId)
          });
        } catch (error) {
          probeErrors.push({
            tabId: tab.id,
            targetFormativeId,
            code: safeCode(error),
            error
          });
        }
      }

      // A dashboard-only window legitimately yields zero candidates. But if we
      // found assessment URLs and every permission probe failed, surface the
      // actual failure instead of pretending that no Formative is open.
      if (!candidates.length && probeErrors.length) {
        const sessionFailure = probeErrors.find(row => row.code === 'SESSION_REAUTH_REQUIRED');
        const chosen = sessionFailure || probeErrors[0];
        const first = chosen.error instanceof Error
          ? chosen.error
          : new Error(chosen.code);
        if (!first.code) first.code = chosen.code;
        first.targetProbeFailures = probeErrors.map(row => ({
          tabId: row.tabId,
          targetFormativeId: row.targetFormativeId,
          code: row.code
        }));
        throw first;
      }

      return candidates;
    }

    return Object.freeze({ enumerate });
  }

  const api = { formativeIdFromUrl, safeCode, expiredSessionError, createEnumerator };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2TargetEnumerator = api;
})();
