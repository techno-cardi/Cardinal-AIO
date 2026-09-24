(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function unique(values) {
    return [...new Set((values || []).filter(Boolean).map(String))];
  }

  function blocked(reason, message, issues = []) {
    return {
      ok: false,
      state: 'blocked',
      reason,
      issues: issues.length ? issues : [{ severity: 'blocker', code: reason, message }],
      view: {
        state: 'blocked',
        statusLabel: '✕ Bloqué',
        blockers: Math.max(1, issues.filter(issue => issue?.severity === 'blocker').length),
        warnings: issues.filter(issue => issue?.severity === 'warning').length,
        primaryAction: { id: 'none', label: 'Import bloqué', enabled: false, emphasis: 'danger' }
      }
    };
  }

  function createRuntime(options = {}) {
    const deps = {
      orchestrator: required(options.orchestrator, 'orchestrator'),
      gateway: required(options.gateway, 'gateway'),
      targetGuard: required(options.targetGuard || globalThis.CardinalFormativeV2TargetGuard, 'target-guard'),
      identity: required(options.identity || globalThis.CardinalFormativeV2Identity, 'identity'),
      presentation: required(options.presentation || globalThis.CardinalFormativeV2Presentation, 'presentation'),
      transportBridge: required(options.transportBridge || globalThis.CardinalFormativeV2TransportBridge, 'transport-bridge'),
      managed: required(options.managed || globalThis.CardinalFormativeV2ManagedState, 'managed-state'),
      reconciliation: required(options.reconciliation || globalThis.CardinalFormativeV2Reconciliation, 'reconciliation')
    };

    if (typeof deps.gateway.observeTarget !== 'function') throw new Error('gateway.observeTarget required');
    if (typeof deps.gateway.listItems !== 'function') throw new Error('gateway.listItems required');
    if (typeof deps.orchestrator.confirmReconciliation !== 'function') throw new Error('orchestrator.confirmReconciliation required');

    function makeTransport() {
      return deps.transportBridge.createTransport({
        gateway: deps.gateway,
        targetGuard: deps.targetGuard,
        managed: deps.managed,
        reconciliation: deps.reconciliation,
        targetObservationMaxAgeMs: options.targetObservationMaxAgeMs
      });
    }

    async function observeAndResolveTarget(input = {}) {
      const observation = await deps.gateway.observeTarget({
        targetFormativeId: input.targetFormativeId || null,
        targetTabId: input.targetTabId ?? null,
        context: { phase: input.phase || 'prepare' }
      });

      const ids = unique([
        input.targetFormativeId,
        observation?.targetFormativeId,
        observation?.urlTargetFormativeId,
        observation?.serverTargetFormativeId
      ]);

      if (ids.length !== 1) {
        return blocked(
          'TARGET_SELECTION_REQUIRED',
          ids.length > 1
            ? 'Plusieurs cibles Formative différentes sont détectées. Choisir explicitement l’évaluation à utiliser.'
            : 'Aucune évaluation Formative ouverte ne peut être identifiée avec certitude.'
        );
      }

      const targetFormativeId = ids[0];
      const expectedTabId = input.targetTabId ?? observation?.tabId ?? null;
      const verdict = deps.targetGuard.evaluateTarget(
        observation || {},
        { targetFormativeId, tabId: expectedTabId, title: null },
        { requireFresh: true, maxAgeMs: Number.isFinite(options.targetObservationMaxAgeMs) ? options.targetObservationMaxAgeMs : 15000 }
      );

      if (!verdict.ok) {
        const first = verdict.issues.find(x => x.severity === 'blocker') || verdict.issues[0];
        return blocked(first?.code || 'TARGET_GUARD_BLOCKED', first?.message || 'Cible Formative non sécuritaire.', verdict.issues);
      }

      return {
        ok: true,
        targetFormativeId,
        targetTabId: expectedTabId,
        targetTitle: observation?.title || input.targetTitle || null,
        observation,
        issues: verdict.issues || []
      };
    }

    async function readSafeSnapshot(target, phase) {
      const snapshot = await deps.gateway.listItems({
        targetFormativeId: target.targetFormativeId,
        context: { phase, targetTabId: target.targetTabId }
      });

      if (!snapshot || !Array.isArray(snapshot.items) || snapshot.snapshotComplete !== true) {
        return blocked(
          'PREFLIGHT_SERVER_SNAPSHOT_INCOMPLETE',
          'Cardinal n’a pas obtenu la liste complète des questions Formative. Aucun import ne sera préparé à partir d’une lecture partielle.'
        );
      }

      if (snapshot.items.length > 0 && snapshot.managedDetailComplete !== true) {
        const issues = Array.isArray(snapshot.detailIssues) && snapshot.detailIssues.length
          ? snapshot.detailIssues
          : [{
              severity: 'blocker',
              code: 'PREFLIGHT_SERVER_DETAIL_INCOMPLETE',
              message: 'Cardinal voit des questions existantes, mais ne possède pas assez de détails pour comparer leurs points et corrigés sans risque.'
            }];
        return blocked(
          'PREFLIGHT_SERVER_DETAIL_INCOMPLETE',
          'La lecture détaillée du Formative est incomplète. Aucun item existant ne sera modifié ni adopté à partir d’une lecture superficielle.',
          issues
        );
      }

      return { ok: true, snapshot };
    }

    async function prepare(input = {}) {
      if (!input.pkg) return blocked('PACKAGE_REQUIRED', 'Aucun paquet Cardinal Formative à préparer.');

      const target = await observeAndResolveTarget(input);
      if (!target.ok) return target;
      const read = await readSafeSnapshot(target, 'preflight');
      if (!read.ok) return read;
      const snapshot = read.snapshot;

      const associationFingerprint = input.assessmentFingerprint ||
        deps.identity.associationFingerprintForTarget(target.targetFormativeId);
      const packageFingerprint = deps.identity.packageContentFingerprint(input.pkg);

      const prepared = await deps.orchestrator.prepare({
        pkg: input.pkg,
        targetFormativeId: target.targetFormativeId,
        targetTabId: target.targetTabId,
        targetTitle: target.targetTitle,
        assessmentFingerprint: associationFingerprint,
        packageFingerprint,
        serverItems: snapshot.items,
        legacyHints: input.legacyHints || [],
        capabilities: input.capabilities,
        approvedDeleteFingerprints: input.approvedDeleteFingerprints || [],
        preflightInjected: input.preflightInjected,
        bootstrapInjected: input.bootstrapInjected
      });

      prepared.packageFingerprint = packageFingerprint;
      prepared.targetObservation = target.observation;
      prepared.runtimeIssues = target.issues || [];
      prepared.serverSnapshotRevision = snapshot.serverRevision || null;
      prepared.serverDetailLevel = snapshot.detailLevel || null;
      prepared.view = deps.presentation.buildPreparedView(prepared);
      return prepared;
    }

    function suggestedLinkApprovals(prepared) {
      return (prepared?.reconciliation?.proposals || [])
        .filter(proposal => proposal.safeToAdoptDesiredAsBaseline === true)
        .map(proposal => ({
          fingerprint: proposal.fingerprint,
          approvalToken: proposal.approvalToken
        }));
    }

    function explicitSeparateApprovals(prepared, fingerprints) {
      const wanted = new Set((fingerprints || []).map(String));
      return (prepared?.reconciliation?.proposals || [])
        .filter(proposal => wanted.has(String(proposal.fingerprint)))
        .map(proposal => ({
          fingerprint: proposal.fingerprint,
          approvalToken: proposal.approvalToken
        }));
    }

    async function confirmReconciliation(prepared, input = {}) {
      if (!prepared?.ok || prepared.mode !== 'bootstrap' || prepared.state !== 'reconciliation_required') {
        return blocked('RECONCILIATION_PREPARATION_REQUIRED', 'Aucune vérification de correspondances n’est en attente.');
      }

      const target = await observeAndResolveTarget({
        targetFormativeId: prepared.targetFormativeId,
        targetTabId: prepared.targetTabId,
        targetTitle: prepared.targetTitle,
        phase: 'reconciliation-confirm'
      });
      if (!target.ok) return target;
      const read = await readSafeSnapshot(target, 'reconciliation-confirm');
      if (!read.ok) return read;

      let approvedProposals = Array.isArray(input.approvedProposals) ? input.approvedProposals : null;
      let separateProposals = Array.isArray(input.separateProposals) ? input.separateProposals : [];

      if (input.useSuggestedLinks === true) {
        approvedProposals = suggestedLinkApprovals(prepared);
        if (Array.isArray(input.keepSeparateFingerprints) && input.keepSeparateFingerprints.length) {
          separateProposals = explicitSeparateApprovals(prepared, input.keepSeparateFingerprints);
          const separateSet = new Set(separateProposals.map(row => String(row.fingerprint)));
          approvedProposals = approvedProposals.filter(row => !separateSet.has(String(row.fingerprint)));
        }
      }

      if (!Array.isArray(approvedProposals)) {
        return {
          ok: false,
          state: 'review_required',
          reason: 'RECONCILIATION_EXPLICIT_DECISION_REQUIRED',
          message: 'Confirme les correspondances proposées avant de continuer.',
          view: deps.presentation.buildPreparedView(prepared)
        };
      }

      const result = await deps.orchestrator.confirmReconciliation(prepared, {
        serverItems: read.snapshot.items,
        analysisToken: prepared.reconciliation?.analysisToken || null,
        approvedProposals,
        separateProposals,
        importerVersion: input.importerVersion || null,
        capabilities: input.capabilities,
        bootstrapInjected: input.bootstrapInjected
      });

      if (!result.ok) {
        if (result.reconciliation) {
          const refreshed = {
            ...prepared,
            ok: true,
            state: 'reconciliation_required',
            reconciliation: result.reconciliation
          };
          result.view = deps.presentation.buildPreparedView(refreshed);
        } else {
          result.view = deps.presentation.primaryAction
            ? { state: result.state, statusLabel: '⚠ Vérification requise', primaryAction: deps.presentation.primaryAction({ state: result.state }) }
            : null;
        }
        return result;
      }

      // Baseline adoption itself never mutates Formative. Re-run the complete
      // preparation from a fresh server read before enabling the Import button.
      const next = await prepare({
        pkg: prepared.pkg,
        targetFormativeId: prepared.targetFormativeId,
        targetTabId: prepared.targetTabId,
        targetTitle: prepared.targetTitle,
        assessmentFingerprint: prepared.assessmentFingerprint,
        legacyHints: prepared.legacyHints || [],
        capabilities: input.capabilities,
        preflightInjected: input.preflightInjected,
        bootstrapInjected: input.bootstrapInjected
      });
      next.reconciliationResult = result;
      return next;
    }

    async function execute(prepared, input = {}) {
      if (!prepared?.ok) return blocked('PREPARATION_REQUIRED', 'Une préparation valide est requise avant l’import.');
      if (prepared.mode === 'bootstrap') {
        const result = {
          ok: false,
          state: 'reconciliation_required',
          reason: 'RECONCILIATION_REQUIRED',
          reconciliation: prepared.reconciliation
        };
        result.view = deps.presentation.buildPreparedView(prepared);
        return result;
      }

      const result = await deps.orchestrator.execute(prepared, {
        acknowledgeWarnings: input.acknowledgeWarnings === true,
        importerVersion: input.importerVersion || null,
        targetTabId: input.targetTabId ?? prepared.targetTabId ?? null,
        transport: makeTransport()
      });

      result.view = deps.presentation.buildExecutionView(result, prepared);
      return result;
    }

    return {
      prepare,
      confirmReconciliation,
      execute,
      observeAndResolveTarget,
      readSafeSnapshot,
      suggestedLinkApprovals,
      makeTransport
    };
  }

  const api = { createRuntime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Runtime = api;
})();