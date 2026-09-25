(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function requiredFn(obj, name) {
    const fn = obj?.[name];
    if (typeof fn !== 'function') throw new Error(`${name} gateway function required`);
    return fn;
  }

  function serverId(item) {
    return item?._id || item?.id || item?.formativeItemId || null;
  }

  function sortedIds(items) {
    return [...new Set((items || []).map(serverId).filter(Boolean).map(String))].sort();
  }

  function sameIdSet(a, b) {
    const aa = [...new Set((a || []).map(String))].sort();
    const bb = [...new Set((b || []).map(String))].sort();
    return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
  }

  function blocked(code, message, extra = {}) {
    return { state: 'blocked', code, message, ...extra };
  }

  function createTransport(options = {}) {
    const gateway = required(options.gateway, 'gateway');
    const deps = {
      managed: required(options.managed || globalThis.CardinalFormativeV2ManagedState, 'managed-state'),
      reconciliation: required(options.reconciliation || globalThis.CardinalFormativeV2Reconciliation, 'reconciliation'),
      targetGuard: required(options.targetGuard || globalThis.CardinalFormativeV2TargetGuard, 'target-guard')
    };

    const observeTarget = requiredFn(gateway, 'observeTarget');
    const listItems = requiredFn(gateway, 'listItems');
    const readItem = requiredFn(gateway, 'readItem');
    const createItem = requiredFn(gateway, 'createItem');
    const updateItem = requiredFn(gateway, 'updateItem');
    const deleteItem = requiredFn(gateway, 'deleteItem');

    async function assertFreshTarget(context = {}) {
      const observation = await observeTarget({
        targetFormativeId: context.targetFormativeId,
        targetTabId: context.targetTabId ?? null,
        context
      });

      const verdict = deps.targetGuard.evaluateTarget(
        observation || {},
        {
          targetFormativeId: context.targetFormativeId,
          tabId: context.targetTabId ?? null,
          title: context.targetTitle || null
        },
        {
          requireFresh: true,
          maxAgeMs: Number.isFinite(options.targetObservationMaxAgeMs) ? options.targetObservationMaxAgeMs : 15000,
          now: Date.now()
        }
      );

      if (!verdict.ok) {
        const first = verdict.issues.find(x => x.severity === 'blocker') || verdict.issues[0];
        return blocked(first?.code || 'TARGET_GUARD_BLOCKED', first?.message || 'Target guard blocked.', {
          issues: verdict.issues
        });
      }

      return { state: 'verified', issues: verdict.issues || [], observation };
    }

    async function normalizeServerItem(item) {
      if (!item) return { state: 'missing', managedState: null, raw: null };
      const normalized = deps.managed.managedFromServerItem(item);
      if (!normalized?.managedState || normalized.state === 'blocked') {
        return {
          state: 'blocked',
          managedState: normalized?.managedState || null,
          raw: item,
          issues: normalized?.issues || []
        };
      }
      return {
        state: normalized.state,
        managedState: normalized.managedState,
        raw: item,
        issues: normalized.issues || []
      };
    }

    async function assertOperationPrecondition({ op, context = {} }) {
      const target = await assertFreshTarget(context);
      if (target.state !== 'verified') return target;

      if (op.action === 'CREATE') {
        if (!Array.isArray(op.preexistingServerItemIds)) {
          return blocked('CREATE_PREEXISTING_IDS_MISSING', 'Le plan CREATE ne contient pas le snapshot des IDs déjà présents.');
        }
        const snapshot = await listItems({ targetFormativeId: context.targetFormativeId, context });
        if (!snapshot || snapshot.snapshotComplete !== true || !Array.isArray(snapshot.items)) {
          return blocked('CREATE_PREFLIGHT_SNAPSHOT_INCOMPLETE', 'Cardinal doit relire la liste complète des items avant une création.');
        }
        const currentIds = sortedIds(snapshot.items);
        if (!sameIdSet(currentIds, op.preexistingServerItemIds)) {
          return blocked(
            'CREATE_TARGET_CHANGED_SINCE_PREFLIGHT',
            'Le contenu du Formative a changé depuis la préparation. Relancer la vérification avant de créer.',
            { expectedIds: [...op.preexistingServerItemIds].sort(), currentIds }
          );
        }
        return { state: 'verified', targetIssues: target.issues || [] };
      }

      if (!op.formativeItemId) {
        return blocked('MUTATION_ITEM_ID_MISSING', `${op.action} exige un formativeItemId connu.`);
      }

      const raw = await readItem({
        targetFormativeId: context.targetFormativeId,
        formativeItemId: op.formativeItemId,
        context
      });

      if (!raw) {
        return blocked('MUTATION_TARGET_MISSING', 'La question ciblée n’existe plus dans Formative.');
      }

      const normalized = await normalizeServerItem(raw);
      if (normalized.state === 'blocked' || !normalized.managedState) {
        return blocked('MUTATION_TARGET_UNREADABLE', 'Cardinal ne peut pas comparer l’état actuel de la question avec suffisamment de certitude.', {
          issues: normalized.issues || []
        });
      }

      const expectedBefore = op.action === 'DELETE' ? (op.server ?? op.baseline ?? null) : (op.baseline ?? null);
      if (!expectedBefore) {
        return blocked('MUTATION_PRECONDITION_STATE_MISSING', `État attendu avant ${op.action} absent du plan immuable.`);
      }

      if (!deps.reconciliation.equal(normalized.managedState, expectedBefore)) {
        return blocked(
          'MUTATION_TARGET_CHANGED_SINCE_PREFLIGHT',
          'La question a changé depuis le dry-run. Cardinal préserve la modification et bloque l’écriture.'
        );
      }

      return { state: 'verified', targetIssues: target.issues || [] };
    }

    function annotateMutationError(error) {
      if (!error || typeof error !== 'object') return error;
      if (error.mutationMayHaveCommitted !== true) {
        error.mutationMayHaveCommitted = error.requestMayHaveReachedServer === true || error.requestSent === true;
      }
      return error;
    }

    async function repairPartialCreate({ op, formativeItemId, context = {} }) {
      if (op?.action !== 'CREATE' || !formativeItemId || !op?.adaptedItem) {
        const error = new Error('Réparation CREATE invalide.');
        error.code = 'PARTIAL_CREATE_REPAIR_INVALID';
        error.mutationMayHaveCommitted = false;
        throw error;
      }
      const raw = await readItem({ targetFormativeId: context.targetFormativeId, formativeItemId, context });
      const normalized = await normalizeServerItem(raw);
      const expectedSubtype = op.desired?.subtype || op.adaptedItem?.subtype || null;
      if (!raw || !normalized?.managedState || !deps.reconciliation.isBareCreateState?.(normalized.managedState, expectedSubtype)) {
        const error = new Error('L’item partiellement créé a changé. Cardinal refuse de le modifier automatiquement.');
        error.code = 'PARTIAL_CREATE_REPAIR_PRECONDITION_FAILED';
        error.formativeItemId = String(formativeItemId);
        error.mutationMayHaveCommitted = false;
        throw error;
      }
      return updateItem({
        targetFormativeId: context.targetFormativeId,
        formativeItemId: String(formativeItemId),
        item: op.adaptedItem,
        operationId: op.operationId,
        context: { ...context, phase: 'partial-create-repair' }
      });
    }

    async function applyMutation({ op, context = {} }) {
      try {
        if (op.action === 'CREATE') {
          if (!op.adaptedItem) throw new Error('CREATE adaptedItem missing');
          return await createItem({
            targetFormativeId: context.targetFormativeId,
            item: op.adaptedItem,
            operationId: op.operationId,
            context
          });
        }
        if (op.action === 'UPDATE') {
          if (!op.adaptedItem) throw new Error('UPDATE adaptedItem missing');
          return await updateItem({
            targetFormativeId: context.targetFormativeId,
            formativeItemId: op.formativeItemId,
            item: op.adaptedItem,
            operationId: op.operationId,
            context
          });
        }
        if (op.action === 'DELETE') {
          return await deleteItem({
            targetFormativeId: context.targetFormativeId,
            formativeItemId: op.formativeItemId,
            operationId: op.operationId,
            context
          });
        }
        throw new Error(`Unsupported mutation action: ${op.action}`);
      } catch (error) {
        throw annotateMutationError(error);
      }
    }

    async function readServerForVerification({ op, mutationResult, context = {} }) {
      const target = await assertFreshTarget(context);
      if (target.state !== 'verified') {
        const error = new Error(target.message || 'Target changed before verification.');
        error.code = target.code || 'TARGET_GUARD_BLOCKED_AFTER_MUTATION';
        error.phase = 'verify-target';
        throw error;
      }

      if (op.action === 'DELETE') {
        const raw = await readItem({
          targetFormativeId: context.targetFormativeId,
          formativeItemId: op.formativeItemId,
          context
        });
        return { action: 'DELETE', formativeItemId: op.formativeItemId, raw, target };
      }

      const formativeItemId = mutationResult?.formativeItemId || mutationResult?._id || mutationResult?.id || op.formativeItemId || null;
      if (!formativeItemId) {
        return { action: op.action, formativeItemId: null, raw: null, target, errorCode: 'VERIFICATION_ID_MISSING' };
      }
      const raw = await readItem({ targetFormativeId: context.targetFormativeId, formativeItemId, context });
      return { action: op.action, formativeItemId, raw, target };
    }

    async function verifyOperation({ op, serverObservation }) {
      if (op.action === 'DELETE') {
        if (serverObservation?.raw == null) {
          return { state: 'verified', formativeItemId: op.formativeItemId, message: 'Suppression confirmée par relecture serveur.' };
        }
        return { state: 'failed', code: 'DELETE_POSTCONDITION_FAILED', message: 'L’item existe encore après la suppression.' };
      }

      if (!serverObservation?.formativeItemId || !serverObservation?.raw) {
        return { state: 'failed', code: serverObservation?.errorCode || 'POSTCONDITION_ITEM_MISSING', message: 'Impossible de relire l’item créé ou modifié.' };
      }

      const normalized = await normalizeServerItem(serverObservation.raw);
      if (normalized.state !== 'ready' || !normalized.managedState) {
        return {
          state: 'failed',
          code: 'POSTCONDITION_NOT_PROVABLE',
          message: 'La réponse serveur ne peut pas être vérifiée exactement.',
          issues: normalized.issues || []
        };
      }

      if (!deps.reconciliation.equal(normalized.managedState, op.desired)) {
        return { state: 'failed', code: 'POSTCONDITION_MISMATCH', message: 'L’état relu dans Formative ne correspond pas exactement à l’état demandé.' };
      }

      return {
        state: 'verified',
        formativeItemId: serverObservation.formativeItemId,
        serverRevision: serverObservation.raw?.revision || serverObservation.raw?.updatedAt || null,
        message: `${op.action} confirmé par relecture serveur.`
      };
    }

    async function reconcileOperation({ op, context = {} }) {
      const target = await assertFreshTarget(context);
      if (target.state !== 'verified') {
        return {
          state: 'conflict',
          code: target.code || 'RECONCILE_TARGET_BLOCKED',
          message: target.message || 'Impossible de confirmer la cible Formative pendant la reprise.'
        };
      }

      const snapshot = await listItems({ targetFormativeId: context.targetFormativeId, context });
      if (!snapshot || !Array.isArray(snapshot.items)) {
        return { state: 'conflict', code: 'RECONCILE_SERVER_READ_FAILED', message: 'La liste serveur n’a pas pu être relue.' };
      }

      return deps.reconciliation.reconcileOperation({
        op,
        serverItems: snapshot.items,
        snapshotComplete: snapshot.snapshotComplete === true
      }, { managed: deps.managed });
    }

    return {
      assertFreshTarget,
      assertOperationPrecondition,
      applyMutation,
      repairPartialCreate,
      readServerForVerification,
      verifyOperation,
      reconcileOperation
    };
  }

  const api = { serverId, sortedIds, sameIdSet, createTransport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2TransportBridge = api;
})();