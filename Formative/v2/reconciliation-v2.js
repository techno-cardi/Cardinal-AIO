(() => {
  'use strict';

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = canonicalize(value[key]);
      }
      return out;
    }
    return value;
  }

  function equal(a, b) {
    return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
  }

  function result(state, extra = {}) {
    return { state, ...extra };
  }

  function normalizeServer(item, managed) {
    const normalized = managed.managedFromServerItem(item);
    return {
      item,
      formativeItemId: item?._id || item?.id || null,
      subtype: item?.subtype || null,
      normalized
    };
  }

  function reconcileKnownId(op, rows, options = {}) {
    const row = rows.find(x => x.formativeItemId === op.formativeItemId);

    if (op.action === 'DELETE') {
      if (!row) {
        if (options.snapshotComplete !== true) {
          return result('conflict', { code: 'DELETE_SNAPSHOT_INCOMPLETE', message: 'Impossible de confirmer la suppression avec une lecture serveur incomplète.' });
        }
        return result('committed', { formativeItemId: op.formativeItemId, message: 'Item absent du serveur dans une lecture complète.' });
      }
      if (!row.normalized?.managedState || row.normalized.state === 'blocked') {
        return result('conflict', { code: 'DELETE_TARGET_UNREADABLE', formativeItemId: op.formativeItemId, message: 'Item toujours présent mais son état ne peut pas être comparé de façon sûre.' });
      }
      if (op.baseline && equal(row.normalized.managedState, op.baseline)) {
        return result('not_committed', { formativeItemId: op.formativeItemId, message: 'Item encore présent dans son état baseline.' });
      }
      return result('conflict', { code: 'DELETE_TARGET_CHANGED', formativeItemId: op.formativeItemId, message: 'Item encore présent mais modifié; ne pas rejouer la suppression automatiquement.' });
    }

    if (!row) {
      return result('conflict', { code: 'UPDATE_TARGET_MISSING', formativeItemId: op.formativeItemId, message: 'La question ciblée a disparu; impossible de déduire si la mutation a été appliquée.' });
    }
    if (!row.normalized?.managedState || row.normalized.state === 'blocked') {
      return result('conflict', { code: 'UPDATE_TARGET_UNREADABLE', formativeItemId: op.formativeItemId, message: 'État serveur non comparable de façon sûre.' });
    }
    if (op.desired && equal(row.normalized.managedState, op.desired)) {
      return result('committed', { formativeItemId: op.formativeItemId, serverObservation: row.item, message: 'Le serveur correspond exactement à l’état désiré.' });
    }
    if (op.baseline && equal(row.normalized.managedState, op.baseline)) {
      return result('not_committed', { formativeItemId: op.formativeItemId, serverObservation: row.item, message: 'Le serveur correspond encore exactement à la baseline.' });
    }
    return result('conflict', { code: 'UPDATE_STATE_DIVERGED', formativeItemId: op.formativeItemId, serverObservation: row.item, message: 'Le serveur ne correspond ni à la baseline ni à l’état désiré.' });
  }


  function isBareCreateState(state, expectedSubtype) {
    if (!state || state.kind !== 'question' || String(state.subtype || '') !== String(expectedSubtype || '')) return false;
    if (String(state.prompt || state.template || '').trim()) return false;
    if (Array.isArray(state.choices) && state.choices.length) return false;
    if (Array.isArray(state.sequence) && state.sequence.some(Boolean)) return false;
    if (Array.isArray(state.pairs) && state.pairs.length) return false;
    if (Array.isArray(state.blanks) && state.blanks.some(blank => (blank?.answers || blank?.choices || []).length)) return false;
    if (Array.isArray(state?.grading?.matches) && state.grading.matches.length) return false;
    if (state?.grading?.isKeywordGrading === true) return false;
    return true;
  }

  function reconcileCreate(op, rows, options = {}) {
    if (options.snapshotComplete !== true) {
      return result('conflict', { code: 'CREATE_SNAPSHOT_INCOMPLETE', message: 'Une création incertaine exige une lecture complète du Formative avant toute décision.' });
    }
    if (!op.desired || typeof op.desired !== 'object') {
      return result('conflict', { code: 'CREATE_DESIRED_MISSING', message: 'État désiré absent du journal de reprise.' });
    }

    const preexisting = new Set(op.preexistingServerItemIds || []);
    const expectedSubtype = op.desired.subtype || op.adaptedItem?.subtype || null;
    if (!expectedSubtype) {
      return result('conflict', { code: 'CREATE_SUBTYPE_MISSING', message: 'Subtype attendu absent du plan immuable.' });
    }

    const newSameSubtype = rows.filter(row =>
      row.formativeItemId && !preexisting.has(row.formativeItemId) && row.subtype === expectedSubtype
    );

    if (newSameSubtype.length === 0) {
      return result('not_committed', { message: 'Aucun nouvel item du subtype attendu depuis le snapshot de départ.' });
    }

    // Without a durable server-side Cardinal marker, more than one new item of
    // the same subtype is ambiguous. One could be Cardinal and another a manual
    // teacher creation, or Cardinal's item could have been edited after create.
    if (newSameSubtype.length !== 1) {
      return result('conflict', {
        code: 'CREATE_MULTIPLE_NEW_CANDIDATES',
        candidateIds: newSameSubtype.map(x => x.formativeItemId),
        message: 'Plusieurs nouveaux items du même subtype existent; adoption automatique interdite.'
      });
    }

    const candidate = newSameSubtype[0];
    if (!candidate.normalized?.managedState || candidate.normalized.state === 'blocked') {
      return result('conflict', {
        code: 'CREATE_CANDIDATE_UNREADABLE',
        candidateIds: [candidate.formativeItemId],
        message: 'Le seul nouvel item candidat ne peut pas être normalisé de façon sûre.'
      });
    }

    if (!equal(candidate.normalized.managedState, op.desired)) {
      const createdAt = Number(candidate.item?.updatedAt || 0);
      const failedAt = Number.isFinite(Date.parse(op.uncertainFinishedAt || '')) ? Date.parse(op.uncertainFinishedAt) : 0;
      const nearFailure = !createdAt || !failedAt || Math.abs(createdAt - failedAt) <= 5 * 60 * 1000;
      const exactFailedId = op.recoveryFormativeItemId && String(op.recoveryFormativeItemId) === String(candidate.formativeItemId);
      if ((exactFailedId || nearFailure) && isBareCreateState(candidate.normalized.managedState, expectedSubtype)) {
        return result('repairable', {
          formativeItemId: candidate.formativeItemId,
          serverObservation: candidate.item,
          message: 'Cardinal a retrouvé l’item créé juste avant l’échec de configuration. Il peut terminer cet item sans le recréer.'
        });
      }
      return result('conflict', {
        code: 'CREATE_CANDIDATE_DIVERGED',
        candidateIds: [candidate.formativeItemId],
        serverObservation: candidate.item,
        message: 'Un nouvel item du subtype attendu existe mais son contenu diffère; ne pas recréer automatiquement.'
      });
    }

    return result('committed', {
      formativeItemId: candidate.formativeItemId,
      serverObservation: candidate.item,
      message: 'Un seul nouvel item du subtype attendu correspond exactement à l’état désiré.'
    });
  }

  function reconcileOperation(input = {}, injected = {}) {
    const managed = injected.managed || globalThis.CardinalFormativeV2ManagedState;
    if (!managed) throw new Error('managed-state dependency required');
    const op = input.op;
    if (!op || !['CREATE', 'UPDATE', 'DELETE'].includes(op.action)) {
      return result('conflict', { code: 'RECONCILE_ACTION_UNSUPPORTED', message: `Action non réconciliable: ${op?.action || 'absente'}.` });
    }
    if (!Array.isArray(input.serverItems)) {
      return result('conflict', { code: 'RECONCILE_SERVER_ITEMS_REQUIRED', message: 'serverItems doit être un tableau issu d’une relecture serveur.' });
    }

    const rows = input.serverItems.map(item => normalizeServer(item, managed));
    const options = { snapshotComplete: input.snapshotComplete === true };

    if (op.action === 'CREATE') return reconcileCreate(op, rows, options);
    if (!op.formativeItemId) {
      return result('conflict', { code: 'RECONCILE_FORMATIVE_ITEM_ID_REQUIRED', message: `${op.action} exige un formativeItemId connu.` });
    }
    return reconcileKnownId(op, rows, options);
  }

  const api = { canonicalize, equal, isBareCreateState, reconcileOperation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Reconciliation = api;
})();