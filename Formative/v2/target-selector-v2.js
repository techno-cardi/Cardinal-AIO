(() => {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function uniqueByTab(candidates) {
    const out = [];
    const seen = new Set();
    for (const raw of candidates || []) {
      const tabId = raw?.tabId;
      if (tabId == null || seen.has(String(tabId))) continue;
      seen.add(String(tabId));
      out.push({
        tabId,
        targetFormativeId: text(raw.targetFormativeId) || null,
        title: text(raw.title) || 'Formative sans titre',
        active: raw.active === true,
        canEdit: raw.canEdit === true,
        authState: raw.authState || 'unknown',
        pageKind: raw.pageKind || null
      });
    }
    return out;
  }

  function eligible(candidate) {
    return Boolean(
      candidate?.targetFormativeId &&
      candidate?.canEdit === true &&
      candidate?.authState === 'authenticated' &&
      ['editor', 'assessment'].includes(candidate?.pageKind)
    );
  }

  function choose(candidates, input = {}) {
    const all = uniqueByTab(candidates);
    const usable = all.filter(eligible);
    const requestedTabId = input.requestedTabId ?? null;
    const requestedTargetId = text(input.requestedTargetId) || null;

    if (requestedTabId != null) {
      const tab = all.find(x => Number(x.tabId) === Number(requestedTabId));
      if (!tab) return { state: 'blocked', reason: 'REQUESTED_TAB_NOT_FOUND', candidates: all };
      if (!eligible(tab)) return { state: 'blocked', reason: 'REQUESTED_TAB_NOT_EDITABLE', candidates: all, selected: tab };
      if (requestedTargetId && tab.targetFormativeId !== requestedTargetId) {
        return { state: 'blocked', reason: 'REQUESTED_TARGET_TAB_MISMATCH', candidates: all, selected: tab };
      }
      return { state: 'selected', reason: 'EXPLICIT_TAB', selected: tab, candidates: all };
    }

    if (requestedTargetId) {
      const matching = usable.filter(x => x.targetFormativeId === requestedTargetId);
      if (matching.length === 1) return { state: 'selected', reason: 'EXPLICIT_TARGET', selected: matching[0], candidates: all };
      if (matching.length > 1) {
        const active = matching.filter(x => x.active);
        if (active.length === 1) return { state: 'selected', reason: 'EXPLICIT_TARGET_ACTIVE_TAB', selected: active[0], candidates: all };
        return { state: 'choose', reason: 'MULTIPLE_TABS_SAME_TARGET', candidates: matching };
      }
      return { state: 'blocked', reason: 'REQUESTED_TARGET_NOT_OPEN', candidates: all };
    }

    if (usable.length === 0) {
      return { state: 'blocked', reason: all.length ? 'NO_EDITABLE_FORMATIVE_TAB' : 'NO_FORMATIVE_TAB', candidates: all };
    }
    if (usable.length === 1) {
      return { state: 'selected', reason: 'ONLY_ELIGIBLE_TARGET', selected: usable[0], candidates: all };
    }

    // Even an active tab is not enough to silently choose when another
    // different editable assessment is open. The user sees a tiny chooser.
    const targetIds = new Set(usable.map(x => x.targetFormativeId));
    if (targetIds.size > 1) {
      return { state: 'choose', reason: 'MULTIPLE_EDITABLE_TARGETS', candidates: usable };
    }

    const active = usable.filter(x => x.active);
    if (active.length === 1) {
      return { state: 'selected', reason: 'SAME_TARGET_ACTIVE_TAB', selected: active[0], candidates: usable };
    }

    return { state: 'choose', reason: 'MULTIPLE_TABS_SAME_TARGET', candidates: usable };
  }

  function chooserRows(result) {
    if (result?.state !== 'choose') return [];
    return (result.candidates || []).map(x => ({
      tabId: x.tabId,
      targetFormativeId: x.targetFormativeId,
      title: x.title,
      subtitle: x.targetFormativeId ? `ID ${x.targetFormativeId}` : 'ID inconnu',
      active: x.active === true
    }));
  }

  const api = { uniqueByTab, eligible, choose, chooserRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2TargetSelector = api;
})();