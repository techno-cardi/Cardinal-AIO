(() => {
  'use strict';

  function requiredFn(source, name) {
    const fn = source?.[name];
    if (typeof fn !== 'function') throw new Error(`${name} legacy primitive required`);
    return fn;
  }

  function idOf(item) {
    return item?._id || item?.id || item?.formativeItemId || null;
  }

  function normalizePermission(raw, expectedId) {
    const formative = raw?.formative || raw?.data?.formative || raw;
    const id = formative?._id || formative?.id || raw?.formativeId || null;
    const permissions = Array.isArray(formative?.viewerPermissions)
      ? formative.viewerPermissions
      : Array.isArray(raw?.viewerPermissions) ? raw.viewerPermissions : [];

    if (!id) return { authState: 'unknown', canEdit: null, targetFormativeId: null };
    if (expectedId && String(id) !== String(expectedId)) {
      return { authState: 'authenticated', canEdit: false, targetFormativeId: String(id), mismatch: true };
    }
    return {
      authState: 'authenticated',
      canEdit: permissions.includes('edit'),
      targetFormativeId: String(id),
      viewerPermissions: permissions
    };
  }

  function normalizeLayout(raw, expectedId) {
    const formative = raw?.formative || raw?.data?.formative || raw;
    const id = formative?._id || formative?.id || raw?.formativeId || null;
    const candidateLists = [
      formative?.items,
      formative?.formativeItems,
      raw?.items,
      raw?.formativeItems
    ];
    const items = candidateLists.find(Array.isArray) || null;
    const complete = raw?.snapshotComplete === true || formative?.snapshotComplete === true || raw?.complete === true;

    return {
      targetFormativeId: id ? String(id) : expectedId ? String(expectedId) : null,
      title: formative?.title || formative?.name || raw?.title || null,
      items,
      snapshotComplete: Boolean(complete && Array.isArray(items)),
      serverRevision: formative?.updatedAt || raw?.serverRevision || null,
      detailLevel: raw?.detailLevel || formative?.detailLevel || null
    };
  }

  function detailReaderRequiredError() {
    const error = new Error('Une relecture détaillée Formative est requise avant de comparer ou modifier une question existante.');
    error.code = 'SERVER_DETAIL_READER_REQUIRED';
    error.mutationMayHaveCommitted = false;
    return error;
  }

  function createGateway(options = {}) {
    const legacy = options.legacy;
    if (!legacy) throw new Error('legacy primitives required');

    const readiness = options.serverReadiness || globalThis.CardinalFormativeV2ServerReadiness || null;
    const getPageContext = requiredFn(legacy, 'getPageContext');
    const permissionCheck = requiredFn(legacy, 'permissionCheck');
    const readLayout = requiredFn(legacy, 'readLayout');
    const readDetailedSnapshot = typeof legacy.readDetailedSnapshot === 'function' ? legacy.readDetailedSnapshot : null;
    const readItemDetailed = typeof legacy.readItemDetailed === 'function' ? legacy.readItemDetailed : null;
    const createItemLegacy = requiredFn(legacy, 'createItem');
    const updateItemLegacy = requiredFn(legacy, 'updateItem');
    const deleteItemLegacy = typeof legacy.deleteItem === 'function' ? legacy.deleteItem : null;

    async function observeTarget(input = {}) {
      const page = await getPageContext(input);
      const targetFormativeId = input.targetFormativeId || page?.targetFormativeId || page?.formativeId || null;
      if (!targetFormativeId) {
        return {
          targetFormativeId: null,
          urlTargetFormativeId: page?.urlTargetFormativeId || null,
          serverTargetFormativeId: null,
          tabId: page?.tabId ?? null,
          title: page?.title || null,
          canEdit: null,
          authState: 'unknown',
          pageKind: page?.pageKind || 'other',
          observedAt: Date.now(),
          explicitTabBinding: Boolean(input.targetTabId != null),
          candidateTargetIds: page?.candidateTargetIds || []
        };
      }

      let permission;
      try {
        permission = normalizePermission(await permissionCheck(targetFormativeId), targetFormativeId);
      } catch (error) {
        if (error?.code === 'SESSION_REAUTH_REQUIRED' || error?.status === 401 || error?.status === 403) {
          return {
            targetFormativeId: String(targetFormativeId),
            urlTargetFormativeId: page?.urlTargetFormativeId || String(targetFormativeId),
            serverTargetFormativeId: null,
            tabId: page?.tabId ?? null,
            title: page?.title || null,
            canEdit: null,
            authState: 'expired',
            pageKind: page?.pageKind || 'editor',
            observedAt: Date.now(),
            explicitTabBinding: Boolean(input.targetTabId != null),
            candidateTargetIds: page?.candidateTargetIds || [String(targetFormativeId)]
          };
        }
        throw error;
      }

      return {
        targetFormativeId: String(targetFormativeId),
        urlTargetFormativeId: page?.urlTargetFormativeId || String(targetFormativeId),
        serverTargetFormativeId: permission.targetFormativeId,
        tabId: page?.tabId ?? null,
        title: page?.title || null,
        canEdit: permission.canEdit,
        authState: permission.authState,
        pageKind: page?.pageKind || 'editor',
        observedAt: Date.now(),
        explicitTabBinding: Boolean(input.targetTabId != null || page?.explicitTabBinding === true),
        candidateTargetIds: page?.candidateTargetIds || [String(targetFormativeId)]
      };
    }

    function verifyTarget(layout, targetFormativeId) {
      if (layout.targetFormativeId && String(layout.targetFormativeId) !== String(targetFormativeId)) {
        const error = new Error('Layout Formative returned another target id.');
        error.code = 'TARGET_ID_MISMATCH';
        throw error;
      }
    }

    function assessDetail(items) {
      if (!Array.isArray(items)) {
        return { managedDetailComplete: false, detailState: 'blocked', detailIssues: [] };
      }
      if (items.length === 0) {
        return { managedDetailComplete: true, detailState: 'ready', detailIssues: [] };
      }
      if (!readiness || typeof readiness.checkSnapshot !== 'function') {
        return {
          managedDetailComplete: false,
          detailState: 'blocked',
          detailIssues: [{ severity: 'blocker', code: 'SERVER_READINESS_VALIDATOR_REQUIRED', message: 'Validateur de relecture serveur détaillée indisponible.' }]
        };
      }
      const verdict = readiness.checkSnapshot(items);
      return {
        managedDetailComplete: verdict.ok === true,
        detailState: verdict.state,
        detailIssues: verdict.issues || []
      };
    }

    async function listItems({ targetFormativeId, context } = {}) {
      let raw;
      let usedDetailed = false;
      if (readDetailedSnapshot) {
        raw = await readDetailedSnapshot(targetFormativeId, context);
        usedDetailed = true;
      } else {
        raw = await readLayout(targetFormativeId, context);
      }

      const layout = normalizeLayout(raw, targetFormativeId);
      verifyTarget(layout, targetFormativeId);
      const items = Array.isArray(layout.items) ? layout.items : [];
      const detail = usedDetailed
        ? assessDetail(items)
        : items.length === 0
          ? { managedDetailComplete: true, detailState: 'ready', detailIssues: [] }
          : {
              managedDetailComplete: false,
              detailState: 'blocked',
              detailIssues: [{
                severity: 'blocker',
                code: 'SERVER_DETAIL_READER_REQUIRED',
                message: 'Le Formative contient déjà des items; une relecture détaillée est requise avant tout diff.'
              }]
            };

      return {
        items,
        snapshotComplete: layout.snapshotComplete,
        serverRevision: layout.serverRevision,
        title: layout.title,
        detailLevel: usedDetailed ? (layout.detailLevel || 'managed-v2') : 'layout',
        ...detail
      };
    }

    async function readItem({ targetFormativeId, formativeItemId, context } = {}) {
      if (!formativeItemId) {
        const error = new Error('formativeItemId required');
        error.code = 'FORMATIVE_ITEM_ID_REQUIRED';
        throw error;
      }

      let item = null;
      if (readItemDetailed) {
        const raw = await readItemDetailed(targetFormativeId, formativeItemId, context);
        const candidate = raw?.formativeItem || raw?.item || raw?.data?.formativeItem || raw;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) item = candidate;
      } else if (readDetailedSnapshot) {
        const raw = await readDetailedSnapshot(targetFormativeId, context);
        const layout = normalizeLayout(raw, targetFormativeId);
        verifyTarget(layout, targetFormativeId);
        if (layout.snapshotComplete !== true || !Array.isArray(layout.items)) {
          const error = new Error('Complete detailed Formative snapshot required to read a mutation target.');
          error.code = 'PREFLIGHT_SERVER_SNAPSHOT_INCOMPLETE';
          throw error;
        }
        item = layout.items.find(current => String(idOf(current)) === String(formativeItemId)) || null;
      } else {
        throw detailReaderRequiredError();
      }

      if (!item) return null;
      if (String(idOf(item)) !== String(formativeItemId)) {
        const error = new Error('Detailed reader returned another Formative item.');
        error.code = 'FORMATIVE_ITEM_ID_MISMATCH';
        throw error;
      }
      if (!readiness || typeof readiness.checkItem !== 'function') {
        const error = new Error('Server readiness validator required for detailed item reads.');
        error.code = 'SERVER_READINESS_VALIDATOR_REQUIRED';
        throw error;
      }
      const verdict = readiness.checkItem(item, { claimed: true });
      if (!verdict.ok) {
        const error = new Error('Detailed Formative item read is incomplete for a safe semantic diff.');
        error.code = 'SERVER_ITEM_DETAIL_INCOMPLETE';
        error.issues = verdict.issues || [];
        throw error;
      }
      return item;
    }

    async function createItem(input) {
      return createItemLegacy(input);
    }

    async function updateItem(input) {
      return updateItemLegacy(input);
    }

    async function deleteItem(input) {
      if (!deleteItemLegacy) {
        const error = new Error('Delete mutation is not exposed by the proven legacy bridge.');
        error.code = 'DELETE_NOT_PROVEN';
        error.mutationMayHaveCommitted = false;
        throw error;
      }
      return deleteItemLegacy(input);
    }

    return { observeTarget, listItems, readItem, createItem, updateItem, deleteItem };
  }

  const api = { idOf, normalizePermission, normalizeLayout, detailReaderRequiredError, createGateway };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2LegacyGateway = api;
})();