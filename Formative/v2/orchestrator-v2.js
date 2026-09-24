(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function uniqueSorted(values) {
    return [...new Set(values || [])].sort();
  }

  function defaultRunId() {
    if (globalThis.crypto?.randomUUID) return `cfi-${globalThis.crypto.randomUUID()}`;
    return `cfi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function createOrchestrator(options = {}) {
    const deps = {
      preflight: required(options.preflight || globalThis.CardinalFormativeV2Preflight, 'preflight'),
      executor: required(options.executor || globalThis.CardinalFormativeV2Executor, 'executor'),
      contract: required(options.contract || globalThis.CardinalFormativeV2ExecutionContract, 'execution contract'),
      journal: required(options.journal || globalThis.CardinalFormativeV2Journal, 'journal'),
      baseline: required(options.baseline || globalThis.CardinalFormativeV2Baseline, 'baseline'),
      bootstrap: options.bootstrap || globalThis.CardinalFormativeV2Bootstrap || null,
      persistence: required(options.persistence, 'persistence'),
      executorInjected: options.executorInjected || {}
    };
    const runIdFactory = options.runIdFactory || defaultRunId;

    function enrichPlannerOperations(preflightResult) {
      const desiredRows = preflightResult?.data?.desired || [];
      const byFingerprint = new Map(desiredRows.map(row => [row.fingerprint, row]));
      const preexistingServerItemIds = uniqueSorted(
        (preflightResult?.data?.server || []).map(row => row.formativeItemId).filter(Boolean)
      );

      return (preflightResult?.data?.planner?.operations || []).map(op => {
        const desired = byFingerprint.get(op.fingerprint);
        const enriched = { ...op };
        if (desired?.adaptedItem) enriched.adaptedItem = desired.adaptedItem;
        if (op.action === 'CREATE') enriched.preexistingServerItemIds = preexistingServerItemIds;
        return enriched;
      });
    }

    function validateRecoveryJournal(record) {
      const issues = [];
      if (!record.executionContractHash) issues.push('executionContractHash missing');
      if (!Array.isArray(record.executionPlan)) issues.push('executionPlan missing');
      const mutating = (record.operations || []).some(op => ['CREATE', 'UPDATE', 'DELETE'].includes(op.action));
      if (mutating && (!Array.isArray(record.executionPlan) || record.executionPlan.length === 0)) {
        issues.push('executionPlan empty for mutating journal');
      }
      return { ok: issues.length === 0, issues };
    }

    function reconciliationOnlyBlocker(preflightResult) {
      const blockers = (preflightResult?.issues || []).filter(issue => issue?.severity === 'blocker');
      return blockers.length > 0 && blockers.every(issue => issue.code === 'INITIAL_NONEMPTY_TARGET_REQUIRES_RECONCILIATION');
    }

    function reconciliationMaterial(input, analysis) {
      return {
        schema: 'cardinal.formative.reconciliation-contract/2',
        version: '2.0.0',
        targetFormativeId: String(input.targetFormativeId || ''),
        assessmentFingerprint: String(input.assessmentFingerprint || ''),
        packageFingerprint: String(input.packageFingerprint || ''),
        desired: (analysis?.desired || []).map(row => ({
          fingerprint: row.fingerprint,
          sourceItemId: row.sourceItemId || null,
          managedState: row.managedState
        })),
        server: (analysis?.server || []).map(row => ({
          formativeItemId: row.formativeItemId,
          subtype: row.subtype || null,
          managedState: row.managedState || null,
          opaque: row.opaque === true
        })),
        proposals: (analysis?.proposals || []).map(row => ({
          fingerprint: row.fingerprint,
          formativeItemId: row.formativeItemId,
          match: row.match,
          safeToAdoptDesiredAsBaseline: row.safeToAdoptDesiredAsBaseline === true,
          approvalToken: row.approvalToken
        }))
      };
    }

    function reconciliationToken(input, analysis) {
      const canonical = deps.contract.canonicalJson(reconciliationMaterial(input, analysis));
      return `cfi-reconcile-${deps.contract.hash128(canonical)}`;
    }

    function analyzeReconciliation(input) {
      if (!deps.bootstrap || typeof deps.bootstrap.analyze !== 'function') {
        return {
          ok: false,
          state: 'blocked',
          issues: [{ severity: 'blocker', code: 'RECONCILIATION_ENGINE_UNAVAILABLE', message: 'Le module de rapprochement des questions existantes est indisponible.' }]
        };
      }
      return deps.bootstrap.analyze({
        pkg: input.pkg,
        targetFormativeId: input.targetFormativeId,
        assessmentFingerprint: input.assessmentFingerprint,
        packageFingerprint: input.packageFingerprint || null,
        serverItems: input.serverItems || [],
        legacyHints: input.legacyHints || [],
        capabilities: input.capabilities
      }, input.bootstrapInjected || {});
    }

    async function prepare(input = {}) {
      const targetFormativeId = input.targetFormativeId;
      const assessmentFingerprint = input.assessmentFingerprint;
      if (!targetFormativeId) return { ok: false, state: 'blocked', reason: 'TARGET_REQUIRED' };
      if (!assessmentFingerprint) return { ok: false, state: 'blocked', reason: 'ASSESSMENT_FINGERPRINT_REQUIRED' };

      // Recovery takes priority over generating a fresh diff. A partially
      // completed run may already have changed Formative and the baseline, so a
      // fresh planner result is not an equivalent replacement for the old plan.
      const existingJournal = await deps.persistence.loadJournal(targetFormativeId, assessmentFingerprint);
      const existingIncomplete = existingJournal && !deps.journal.isSummaryComplete(existingJournal.summary || {});
      if (existingIncomplete) {
        const recoveryCheck = validateRecoveryJournal(existingJournal);
        if (!recoveryCheck.ok) {
          return {
            ok: false,
            state: 'recovery_blocked',
            reason: 'RECOVERY_PLAN_MISSING',
            journal: existingJournal,
            issues: recoveryCheck.issues
          };
        }

        const approvals = uniqueSorted(existingJournal.approvedDeleteFingerprints || []);
        const rebuilt = deps.contract.buildExecutionContract({
          targetFormativeId,
          assessmentFingerprint,
          packageMode: existingJournal.packageMode,
          plannerOperations: existingJournal.executionPlan,
          approvedDeleteFingerprints: approvals
        });
        const check = deps.contract.validateJournalContract(existingJournal, rebuilt);
        if (!check.ok) {
          return {
            ok: false,
            state: 'recovery_blocked',
            reason: 'RECOVERY_CONTRACT_INVALID',
            journal: existingJournal,
            issues: check.issues
          };
        }

        return {
          ok: true,
          state: 'recovery',
          mode: 'resume',
          targetFormativeId,
          targetTabId: input.targetTabId ?? null,
          targetTitle: input.targetTitle || null,
          assessmentFingerprint,
          journal: existingJournal,
          plannerOperations: existingJournal.executionPlan,
          approvedDeleteFingerprints: approvals,
          executionContract: rebuilt,
          ui: {
            status: '↻ Reprise requise',
            runId: existingJournal.runId,
            summary: existingJournal.summary
          }
        };
      }

      const baselineRecord = await deps.persistence.loadBaseline(targetFormativeId, assessmentFingerprint);
      const preflight = deps.preflight.preflightPackageV2({
        pkg: input.pkg,
        targetFormativeId,
        targetTitle: input.targetTitle || null,
        assessmentFingerprint,
        baselineRecord,
        serverItems: input.serverItems || [],
        capabilities: input.capabilities
      }, input.preflightInjected || {});

      if (!preflight.ok) {
        if (!baselineRecord && reconciliationOnlyBlocker(preflight)) {
          const analysis = analyzeReconciliation(input);
          if (!analysis.ok) {
            return {
              ok: false,
              state: 'blocked',
              mode: 'bootstrap',
              reason: 'RECONCILIATION_BLOCKED',
              targetFormativeId,
              targetTabId: input.targetTabId ?? null,
              targetTitle: input.targetTitle || null,
              assessmentFingerprint,
              pkg: input.pkg,
              packageFingerprint: input.packageFingerprint || null,
              reconciliation: analysis,
              preflight,
              issues: analysis.issues || []
            };
          }

          const token = reconciliationToken(input, analysis);
          return {
            ok: true,
            canImport: false,
            state: 'reconciliation_required',
            mode: 'bootstrap',
            targetFormativeId,
            targetTabId: input.targetTabId ?? null,
            targetTitle: input.targetTitle || null,
            assessmentFingerprint,
            packageFingerprint: input.packageFingerprint || null,
            pkg: input.pkg,
            legacyHints: input.legacyHints || [],
            preflight,
            reconciliation: { ...analysis, analysisToken: token }
          };
        }

        return {
          ok: false,
          state: 'blocked',
          mode: 'new',
          targetFormativeId,
          targetTabId: input.targetTabId ?? null,
          targetTitle: input.targetTitle || null,
          assessmentFingerprint,
          baselineRecord,
          preflight,
          reason: 'PREFLIGHT_BLOCKED'
        };
      }

      const plannerOperations = enrichPlannerOperations(preflight);
      const approvedDeleteFingerprints = uniqueSorted(input.approvedDeleteFingerprints || []);
      const executionContract = deps.contract.buildExecutionContract({
        targetFormativeId,
        assessmentFingerprint,
        packageMode: input.pkg.packageMode,
        plannerOperations,
        approvedDeleteFingerprints
      });

      return {
        ok: true,
        state: preflight.state,
        mode: 'new',
        targetFormativeId,
        targetTabId: input.targetTabId ?? null,
        assessmentFingerprint,
        targetTitle: input.targetTitle || null,
        baselineRecord,
        preflight,
        plannerOperations,
        approvedDeleteFingerprints,
        executionContract,
        runId: runIdFactory(),
        pkg: input.pkg
      };
    }

    async function confirmReconciliation(prepared, input = {}) {
      if (!prepared?.ok || prepared.mode !== 'bootstrap' || prepared.state !== 'reconciliation_required') {
        return { ok: false, state: 'blocked', reason: 'RECONCILIATION_PREPARATION_REQUIRED' };
      }
      if (!deps.bootstrap || typeof deps.bootstrap.buildBaseline !== 'function') {
        return { ok: false, state: 'blocked', reason: 'RECONCILIATION_ENGINE_UNAVAILABLE' };
      }
      if (!Array.isArray(input.serverItems)) {
        return { ok: false, state: 'blocked', reason: 'RECONCILIATION_SERVER_READ_REQUIRED' };
      }

      const freshAnalysis = analyzeReconciliation({
        pkg: prepared.pkg,
        targetFormativeId: prepared.targetFormativeId,
        assessmentFingerprint: prepared.assessmentFingerprint,
        packageFingerprint: prepared.packageFingerprint,
        serverItems: input.serverItems,
        legacyHints: prepared.legacyHints || [],
        capabilities: input.capabilities,
        bootstrapInjected: input.bootstrapInjected
      });
      if (!freshAnalysis.ok) {
        return {
          ok: false,
          state: 'blocked',
          reason: 'RECONCILIATION_RECHECK_BLOCKED',
          reconciliation: freshAnalysis,
          issues: freshAnalysis.issues || []
        };
      }

      const freshToken = reconciliationToken({
        targetFormativeId: prepared.targetFormativeId,
        assessmentFingerprint: prepared.assessmentFingerprint,
        packageFingerprint: prepared.packageFingerprint
      }, freshAnalysis);
      if (!input.analysisToken || input.analysisToken !== freshToken) {
        return {
          ok: false,
          state: 'reconciliation_changed',
          reason: 'RECONCILIATION_STATE_CHANGED',
          message: 'Le Formative a changé depuis la vérification. Cardinal a relu les questions; vérifie les correspondances à nouveau.',
          reconciliation: { ...freshAnalysis, analysisToken: freshToken }
        };
      }

      const unsafe = (freshAnalysis.proposals || []).filter(row => row.safeToAdoptDesiredAsBaseline !== true);
      if (unsafe.length) {
        return {
          ok: false,
          state: 'review_required',
          reason: 'RECONCILIATION_CONFLICTS_REQUIRE_RESOLUTION',
          message: `${unsafe.length} question(s) semblent correspondre à un ancien import, mais leur contenu actuel a changé. Cardinal ne les écrasera pas automatiquement.`,
          reconciliation: { ...freshAnalysis, analysisToken: freshToken },
          conflicts: unsafe
        };
      }

      const approved = new Map((input.approvedProposals || []).map(row => [String(row?.fingerprint || ''), row]));
      const separate = new Map((input.separateProposals || []).map(row => [String(row?.fingerprint || ''), row]));
      for (const proposal of freshAnalysis.proposals || []) {
        const key = String(proposal.fingerprint);
        const link = approved.get(key);
        const keepSeparate = separate.get(key);
        if (Boolean(link) === Boolean(keepSeparate)) {
          return {
            ok: false,
            state: 'review_required',
            reason: 'RECONCILIATION_DECISION_REQUIRED',
            message: 'Chaque correspondance proposée doit être confirmée ou conservée séparément.',
            fingerprint: proposal.fingerprint
          };
        }
        const decision = link || keepSeparate;
        if (decision.approvalToken !== proposal.approvalToken) {
          return {
            ok: false,
            state: 'reconciliation_changed',
            reason: 'RECONCILIATION_APPROVAL_STALE',
            message: 'Une correspondance a changé depuis son affichage. Vérifie-la de nouveau.',
            fingerprint: proposal.fingerprint
          };
        }
      }

      let baselineRecord;
      if ((freshAnalysis.proposals || []).length === 0 || approved.size === 0) {
        // Zero linked matches is valid only because the user approved the exact
        // state-bound reconciliation token. Existing items remain foreign and
        // are preserved; desired unmatched questions may then be created.
        baselineRecord = deps.baseline.createBaseline({
          targetFormativeId: prepared.targetFormativeId,
          assessmentFingerprint: prepared.assessmentFingerprint,
          sourceProtocolVersion: '2.0.0',
          packageMode: prepared.pkg?.packageMode || null,
          assessmentTitle: prepared.pkg?.assessment?.title || prepared.targetTitle || null,
          sourceFingerprints: (prepared.pkg?.sources || []).map(source => source.semanticFingerprint).filter(Boolean),
          importerVersion: input.importerVersion || null,
          entries: []
        });
      } else {
        baselineRecord = deps.bootstrap.buildBaseline({
          analysis: freshAnalysis,
          targetFormativeId: prepared.targetFormativeId,
          assessmentFingerprint: prepared.assessmentFingerprint,
          approvedProposals: [...approved.values()],
          packageMode: prepared.pkg?.packageMode || null,
          assessmentTitle: prepared.pkg?.assessment?.title || prepared.targetTitle || null,
          sourceFingerprints: (prepared.pkg?.sources || []).map(source => source.semanticFingerprint).filter(Boolean),
          importerVersion: input.importerVersion || null
        }, { baseline: deps.baseline });
      }

      await deps.persistence.saveBaseline(baselineRecord);
      return {
        ok: true,
        state: 'reconciled',
        targetFormativeId: prepared.targetFormativeId,
        assessmentFingerprint: prepared.assessmentFingerprint,
        baselineRecord,
        linked: approved.size,
        keptSeparate: separate.size,
        reconciliation: { ...freshAnalysis, analysisToken: freshToken }
      };
    }

    function requireTransport(transport = {}) {
      const names = [
        'assertOperationPrecondition',
        'applyMutation',
        'readServerForVerification',
        'verifyOperation',
        'reconcileOperation'
      ];
      for (const name of names) {
        if (typeof transport[name] !== 'function') throw new Error(`${name} transport callback required`);
      }
      return transport;
    }

    async function execute(prepared, input = {}) {
      if (!prepared?.ok) return { ok: false, state: 'blocked', reason: prepared?.reason || 'PREPARATION_REQUIRED' };
      if (prepared.mode === 'bootstrap') {
        return { ok: false, state: 'reconciliation_required', reason: 'RECONCILIATION_REQUIRED', reconciliation: prepared.reconciliation };
      }
      if (!['new', 'resume'].includes(prepared.mode)) return { ok: false, state: 'blocked', reason: 'PREPARATION_MODE_INVALID' };
      if (prepared.mode === 'new' && prepared.state === 'review' && input.acknowledgeWarnings !== true) {
        return { ok: false, state: 'review_required', reason: 'WARNINGS_REQUIRE_EXPLICIT_IMPORT_CLICK', preflight: prepared.preflight };
      }

      const transport = requireTransport(input.transport);
      let baselineRecord = prepared.baselineRecord || await deps.persistence.loadBaseline(prepared.targetFormativeId, prepared.assessmentFingerprint);
      let journalRecord = prepared.mode === 'resume' ? prepared.journal : null;

      if (!journalRecord) {
        journalRecord = deps.journal.createJournal({
          runId: prepared.runId,
          targetFormativeId: prepared.targetFormativeId,
          assessmentFingerprint: prepared.assessmentFingerprint,
          packageMode: prepared.pkg.packageMode,
          executionContractHash: prepared.executionContract.hash,
          executionPlan: prepared.plannerOperations,
          operations: deps.executor.makeJournalOperations(prepared.plannerOperations, {
            approvedDeleteFingerprints: prepared.approvedDeleteFingerprints
          })
        });
        journalRecord.approvedDeleteFingerprints = uniqueSorted(prepared.approvedDeleteFingerprints);
        await deps.persistence.saveJournal(journalRecord);
      }

      async function commitBaselineVerified({ op, mutationResult, verdict }) {
        if (op.action === 'DELETE') {
          if (!baselineRecord) throw new Error('Cannot confirm deletion without an existing baseline.');
          baselineRecord = deps.baseline.updateAfterVerified(
            baselineRecord,
            [],
            {
              confirmedDeletedFingerprints: [op.fingerprint],
              packageMode: journalRecord.packageMode,
              importerVersion: input.importerVersion || null
            }
          );
          await deps.persistence.saveBaseline(baselineRecord);
          return;
        }

        const formativeItemId = verdict?.formativeItemId || mutationResult?.formativeItemId || op.formativeItemId || null;
        if (!formativeItemId) throw new Error(`Verified ${op.action} missing formativeItemId.`);
        if (!op.desired || typeof op.desired !== 'object') throw new Error(`Verified ${op.action} missing desired managedState.`);

        const entry = {
          fingerprint: op.fingerprint,
          sourceItemId: op.sourceItemId || null,
          formativeItemId,
          subtype: op.desired.subtype || op.adaptedItem?.subtype || null,
          managedState: op.desired,
          serverRevision: verdict?.serverRevision || null
        };

        if (!baselineRecord) {
          baselineRecord = deps.baseline.createBaseline({
            targetFormativeId: prepared.targetFormativeId,
            assessmentFingerprint: prepared.assessmentFingerprint,
            packageMode: journalRecord.packageMode,
            assessmentTitle: prepared.pkg?.assessment?.title || prepared.targetTitle || null,
            sourceFingerprints: (prepared.pkg?.sources || []).map(source => source.semanticFingerprint).filter(Boolean),
            importerVersion: input.importerVersion || null,
            entries: [entry]
          });
        } else {
          baselineRecord = deps.baseline.updateAfterVerified(
            baselineRecord,
            [entry],
            {
              packageMode: journalRecord.packageMode,
              importerVersion: input.importerVersion || null
            }
          );
        }
        await deps.persistence.saveBaseline(baselineRecord);
      }

      const callbacks = {
        saveJournal: async next => {
          await deps.persistence.saveJournal(next);
          journalRecord = next;
        },
        assertOperationPrecondition: transport.assertOperationPrecondition,
        applyMutation: transport.applyMutation,
        readServerForVerification: transport.readServerForVerification,
        verifyOperation: transport.verifyOperation,
        reconcileOperation: transport.reconcileOperation,
        commitBaselineVerified
      };

      const result = await deps.executor.run({
        runId: journalRecord.runId,
        journal: journalRecord,
        targetFormativeId: prepared.targetFormativeId,
        assessmentFingerprint: prepared.assessmentFingerprint,
        packageMode: journalRecord.packageMode,
        plannerOperations: prepared.plannerOperations,
        approvedDeleteFingerprints: prepared.approvedDeleteFingerprints,
        callbacks,
        context: {
          targetFormativeId: prepared.targetFormativeId,
          targetTabId: prepared.targetTabId ?? input.targetTabId ?? null,
          targetTitle: prepared.targetTitle || null,
          mode: prepared.mode
        }
      }, deps.executorInjected);

      return {
        ...result,
        mode: prepared.mode,
        baselineRecord,
        journal: result.journal || journalRecord
      };
    }

    async function discardIncompleteRecovery(input = {}) {
      if (!input.targetFormativeId || !input.assessmentFingerprint || !input.expectedRunId) {
        throw new Error('targetFormativeId, assessmentFingerprint and expectedRunId required');
      }
      return deps.persistence.clearJournal(
        input.targetFormativeId,
        input.assessmentFingerprint,
        { allowIncomplete: true, expectedRunId: input.expectedRunId }
      );
    }

    return {
      prepare,
      confirmReconciliation,
      execute,
      discardIncompleteRecovery,
      enrichPlannerOperations,
      reconciliationMaterial,
      reconciliationToken
    };
  }

  const api = { createOrchestrator };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Orchestrator = api;
})();