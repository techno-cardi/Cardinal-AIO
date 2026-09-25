(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function makeError(code, message, extra = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.mutationMayHaveCommitted = false;
    Object.assign(error, extra);
    return error;
  }

  function canFreshReprepareRecovery(prepared = {}) {
    if (prepared?.mode !== 'resume' || prepared?.state !== 'recovery') return false;
    const journal = prepared?.journal;
    if (!journal || !Array.isArray(journal.operations)) return false;
    if (Number(journal?.summary?.verified || 0) !== 0) return false;

    for (const op of journal.operations) {
      if (op?.status === 'VERIFIED') return false;
      const mayHaveCommitted =
        op?.status === 'UNCERTAIN' ||
        op?.status === 'IN_PROGRESS' ||
        (op?.status === 'FAILED' && op?.mutationMayHaveCommitted === true);

      if (mayHaveCommitted && (op?.action !== 'UPDATE' || !op?.formativeItemId)) {
        return false;
      }
    }
    return true;
  }

  function defaultToken(sequence) {
    if (globalThis.crypto?.randomUUID) return `cfi-ui-${globalThis.crypto.randomUUID()}`;
    return `cfi-ui-${Date.now().toString(36)}-${sequence.toString(36)}`;
  }

  function createController(options = {}) {
    const deps = {
      product: required(options.product, 'production product facade'),
      targetSelector: required(options.targetSelector || globalThis.CardinalFormativeV2TargetSelector, 'target-selector'),
      progressApi: required(options.progressApi || globalThis.CardinalProgress, 'progress'),
      errorPresenter: required(options.errorPresenter || globalThis.CardinalFormativeV2ErrorPresenter, 'error-presenter'),
      enumerateTargets: required(options.enumerateTargets, 'enumerateTargets')
    };

    for (const name of ['prepare', 'execute', 'confirmReconciliation']) {
      if (typeof deps.product[name] !== 'function') throw new Error(`product.${name} required`);
    }
    if (typeof deps.targetSelector.choose !== 'function' || typeof deps.targetSelector.chooserRows !== 'function') {
      throw new Error('target-selector choose/chooserRows required');
    }

    const emitState = typeof options.emitState === 'function' ? options.emitState : async () => {};
    const progressSinks = Array.isArray(options.progressSinks) ? options.progressSinks : [];
    const reportProgress = deps.progressApi.makeReporter(progressSinks);
    const tokenFactory = options.tokenFactory || defaultToken;

    let sequence = 0;
    let current = null;
    let mutating = false;
    let preparing = false;

    function publicSnapshot() {
      if (!current) return null;
      return {
        token: current.token,
        targetFormativeId: current.targetFormativeId,
        targetTabId: current.targetTabId,
        packageFingerprint: current.prepared?.packageFingerprint || null,
        state: current.prepared?.state || current.state || null,
        view: current.prepared?.view || current.view || null,
        mutating,
        preparing
      };
    }

    async function publish(payload) {
      await Promise.resolve(emitState(payload));
      return payload;
    }

    async function failure(error, context = {}) {
      const presented = deps.errorPresenter.present(error || { code: 'UNKNOWN_ERROR' });
      const payload = {
        ok: false,
        state: context.state || 'blocked',
        reason: error?.code || error?.reason || 'UNKNOWN_ERROR',
        error: presented,
        token: context.token || current?.token || null,
        targetFormativeId: context.targetFormativeId || current?.targetFormativeId || null,
        targetTabId: context.targetTabId ?? current?.targetTabId ?? null
      };
      await publish(payload);
      return payload;
    }

    async function chooseTarget(input = {}) {
      const candidates = await deps.enumerateTargets();
      const result = deps.targetSelector.choose(candidates, {
        requestedTabId: input.requestedTabId ?? null,
        requestedTargetId: input.requestedTargetId || null
      });

      if (result.state === 'selected') return { ok: true, selected: result.selected, selector: result };
      if (result.state === 'choose') {
        const payload = {
          ok: false,
          state: 'target_selection_required',
          reason: result.reason,
          chooserRows: deps.targetSelector.chooserRows(result),
          error: deps.errorPresenter.present({ code: result.reason })
        };
        await publish(payload);
        return payload;
      }

      const error = makeError(result.reason || 'TARGET_SELECTION_REQUIRED', result.reason || 'Target selection blocked', {
        selector: result
      });
      return failure(error, { state: 'blocked' });
    }

    async function preparePackage(input = {}) {
      if (!input.pkg) return failure(makeError('PACKAGE_REQUIRED', 'Aucun paquet à préparer.'));
      if (mutating) {
        return failure(makeError(
          'TARGET_IMPORT_ALREADY_RUNNING',
          'Un import est déjà en cours; la préparation d’un autre paquet est bloquée jusqu’à sa fin.'
        ), { state: 'busy' });
      }

      preparing = true;
      sequence += 1;
      const localSequence = sequence;
      const token = tokenFactory(localSequence);

      try {
        await reportProgress({ stage: 'DETECTING', runId: token });
        const target = await chooseTarget(input);
        if (!target.ok) return target;

        // If another prepare starts while target enumeration is resolving, the
        // older result is stale and must never replace the newer UI state.
        if (localSequence !== sequence) {
          return failure(makeError('STALE_PREPARATION', 'Une préparation plus récente a remplacé celle-ci.'), {
            state: 'stale', token
          });
        }

        const selected = target.selected;
        await reportProgress({ stage: 'CHECKING_TARGET', runId: token });
        await reportProgress({ stage: 'READING_SERVER', runId: token });

        const prepared = await deps.product.prepare({
          pkg: input.pkg,
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.tabId,
          targetTitle: selected.title || null,
          assessmentFingerprint: input.assessmentFingerprint || undefined,
          legacyHints: input.legacyHints || [],
          approvedDeleteFingerprints: input.approvedDeleteFingerprints || [],
          preflightInjected: input.preflightInjected,
          bootstrapInjected: input.bootstrapInjected
        });

        if (localSequence !== sequence) {
          return failure(makeError('STALE_PREPARATION', 'Une préparation plus récente a remplacé celle-ci.'), {
            state: 'stale', token,
            targetFormativeId: selected.targetFormativeId,
            targetTabId: selected.tabId
          });
        }

        current = {
          token,
          pkg: input.pkg,
          originalInput: {
            pkg: input.pkg,
            requestedTabId: selected.tabId,
            requestedTargetId: selected.targetFormativeId,
            assessmentFingerprint: input.assessmentFingerprint || undefined,
            legacyHints: input.legacyHints || [],
            approvedDeleteFingerprints: input.approvedDeleteFingerprints || [],
            preflightInjected: input.preflightInjected,
            bootstrapInjected: input.bootstrapInjected
          },
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.tabId,
          targetTitle: selected.title || null,
          prepared,
          state: prepared?.state || (prepared?.ok ? 'ready' : 'blocked')
        };

        await reportProgress({
          stage: prepared?.ok ? 'READY' : 'BLOCKED',
          runId: token,
          label: prepared?.view?.statusLabel || undefined
        });

        return publish({
          ok: prepared?.ok === true,
          state: current.state,
          token,
          targetFormativeId: current.targetFormativeId,
          targetTabId: current.targetTabId,
          prepared,
          view: prepared?.view || null
        });
      } catch (error) {
        await reportProgress({ stage: 'BLOCKED', runId: token, label: 'Préparation interrompue' });
        return failure(error, { state: 'blocked', token });
      } finally {
        if (localSequence === sequence) preparing = false;
      }
    }

    function requireCurrent(token) {
      if (!current) throw makeError('PREPARATION_REQUIRED', 'Prépare le paquet avant l’import.');
      if (!token || token !== current.token) {
        throw makeError(
          'STALE_UI_ACTION',
          'Ce bouton appartient à une ancienne préparation. Utilise le bouton du résultat le plus récent.'
        );
      }
      return current;
    }

    async function execute(token, input = {}) {
      let selected;
      try {
        selected = requireCurrent(token);
      } catch (error) {
        return failure(error, { state: 'stale', token });
      }

      if (mutating) {
        return failure(makeError(
          'TARGET_IMPORT_ALREADY_RUNNING',
          'Un import est déjà en cours pour cette préparation.'
        ), { state: 'busy', token });
      }

      mutating = true;
      await publish({
        ok: true,
        state: 'importing',
        token,
        targetFormativeId: selected.targetFormativeId,
        targetTabId: selected.targetTabId,
        view: { ...(selected.prepared?.view || {}), state: 'importing' }
      });

      try {
        await reportProgress({ stage: selected.prepared?.mode === 'resume' ? 'RECOVERING' : 'IMPORTING', runId: token });
        const result = await deps.product.execute(selected.prepared, {
          acknowledgeWarnings: input.acknowledgeWarnings === true,
          targetTabId: selected.targetTabId
        });

        selected.lastExecution = result;
        if (result?.state === 'completed') {
          await reportProgress({ stage: 'COMPLETED', runId: token });
        } else if (result?.state === 'uncertain') {
          await reportProgress({ stage: 'RECOVERING', runId: token, label: 'Vérification requise' });
        } else {
          await reportProgress({ stage: 'FAILED', runId: token, label: result?.view?.statusLabel || 'Import interrompu' });
        }

        return publish({
          ok: result?.state === 'completed',
          state: result?.state || 'failed',
          token,
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.targetTabId,
          result,
          view: result?.view || null
        });
      } catch (error) {
        await reportProgress({ stage: 'FAILED', runId: token });
        return failure(error, { state: 'failed', token });
      } finally {
        mutating = false;
      }
    }

    async function confirmReconciliation(token, input = {}) {
      let selected;
      try {
        selected = requireCurrent(token);
      } catch (error) {
        return failure(error, { state: 'stale', token });
      }
      if (mutating) {
        return failure(makeError('TARGET_IMPORT_ALREADY_RUNNING', 'Un import est déjà en cours.'), {
          state: 'busy', token
        });
      }

      try {
        const next = await deps.product.confirmReconciliation(selected.prepared, input);
        selected.prepared = next;
        selected.state = next?.state || (next?.ok ? 'ready' : 'blocked');
        return publish({
          ok: next?.ok === true,
          state: selected.state,
          token,
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.targetTabId,
          prepared: next,
          view: next?.view || null
        });
      } catch (error) {
        return failure(error, { state: 'blocked', token });
      }
    }

    async function reprepare(token, pkgOverride = null) {
      let selected;
      try {
        selected = requireCurrent(token);
      } catch (error) {
        return failure(error, { state: 'stale', token });
      }

      // The target has already been explicitly bound by the first preparation.
      // A reprepare (including question-subset selection) must not run the
      // chooser/enumerator again, because that creates a second, unrelated
      // target-selection race. We keep the same tab + target id and let the
      // production runtime perform its fresh URL/server/permission guard.
      if (mutating) {
        return failure(makeError(
          'TARGET_IMPORT_ALREADY_RUNNING',
          'Un import est déjà en cours; la préparation est bloquée jusqu’à sa fin.'
        ), { state: 'busy', token });
      }

      preparing = true;
      sequence += 1;
      const localSequence = sequence;
      const nextToken = tokenFactory(localSequence);
      const nextPkg = pkgOverride || selected.originalInput?.pkg || selected.pkg;

      try {
        if (canFreshReprepareRecovery(selected.prepared)) {
          if (typeof deps.product.discardIncompleteRecovery !== 'function') {
            throw makeError(
              'RECOVERY_FRESH_PREPARE_UNAVAILABLE',
              'La reprise peut être revérifiée sans doublon, mais le moteur courant ne peut pas libérer l’ancien journal.'
            );
          }
          await deps.product.discardIncompleteRecovery({
            targetFormativeId: selected.prepared.targetFormativeId || selected.targetFormativeId,
            assessmentFingerprint: selected.prepared.assessmentFingerprint,
            expectedRunId: selected.prepared.journal?.runId
          });
        }

        await reportProgress({ stage: 'CHECKING_TARGET', runId: nextToken });
        await reportProgress({ stage: 'READING_SERVER', runId: nextToken });

        const prepared = await deps.product.prepare({
          pkg: nextPkg,
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.targetTabId,
          targetTitle: selected.targetTitle || null,
          assessmentFingerprint: selected.originalInput?.assessmentFingerprint,
          legacyHints: selected.originalInput?.legacyHints || [],
          approvedDeleteFingerprints: selected.originalInput?.approvedDeleteFingerprints || [],
          preflightInjected: selected.originalInput?.preflightInjected,
          bootstrapInjected: selected.originalInput?.bootstrapInjected
        });

        if (localSequence !== sequence) {
          return failure(makeError('STALE_PREPARATION', 'Une préparation plus récente a remplacé celle-ci.'), {
            state: 'stale',
            token: nextToken,
            targetFormativeId: selected.targetFormativeId,
            targetTabId: selected.targetTabId
          });
        }

        current = {
          token: nextToken,
          pkg: nextPkg,
          originalInput: {
            ...(selected.originalInput || {}),
            pkg: nextPkg,
            requestedTabId: selected.targetTabId,
            requestedTargetId: selected.targetFormativeId
          },
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.targetTabId,
          targetTitle: selected.targetTitle || null,
          prepared,
          state: prepared?.state || (prepared?.ok ? 'ready' : 'blocked')
        };

        await reportProgress({
          stage: prepared?.ok ? 'READY' : 'BLOCKED',
          runId: nextToken,
          label: prepared?.view?.statusLabel || undefined
        });

        return publish({
          ok: prepared?.ok === true,
          state: current.state,
          token: nextToken,
          targetFormativeId: current.targetFormativeId,
          targetTabId: current.targetTabId,
          prepared,
          view: prepared?.view || null
        });
      } catch (error) {
        await reportProgress({ stage: 'BLOCKED', runId: nextToken, label: 'Préparation interrompue' });
        return failure(error, {
          state: 'blocked',
          token: nextToken,
          targetFormativeId: selected.targetFormativeId,
          targetTabId: selected.targetTabId
        });
      } finally {
        if (localSequence === sequence) preparing = false;
      }
    }

    function dismiss(token) {
      if (!current || token !== current.token) return false;
      // Dismiss is UI-only. It never cancels, rolls back or clears a journal.
      current.dismissed = true;
      return true;
    }

    return Object.freeze({
      preparePackage,
      execute,
      confirmReconciliation,
      reprepare,
      dismiss,
      snapshot: publicSnapshot
    });
  }

  const api = { canFreshReprepareRecovery, createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2BrowserController = api;
})();