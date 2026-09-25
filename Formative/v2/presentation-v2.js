(() => {
  'use strict';

  const TYPE_LABELS = Object.freeze({
    shortAnswer: 'Réponse courte',
    longAnswer: 'Réponse libre',
    multipleChoice: 'Choix multiple',
    multipleSelection: 'Sélection multiple',
    fillInTheBlank: 'Texte à trous',
    inlineChoice: 'Choix dans le texte',
    resequence: 'Remise en ordre',
    matching: 'Association',
    unsupported: 'Non pris en charge'
  });

  const GRADING_LABELS = Object.freeze({
    auto: 'Auto',
    assisted: 'Assistée',
    manual: 'Manuelle'
  });

  const RECONCILIATION_LABELS = Object.freeze({
    'legacy-exact': 'Correspondance retrouvée',
    'exact-state': 'Correspondance identique',
    'legacy-changed': 'Modifiée dans Formative',
    'prompt-changed': 'Même énoncé, réglages différents'
  });

  function oneLine(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  }

  function questionIssues(pkgIssues, item) {
    const out = [];
    for (const i of item?.issues || []) out.push(i);
    for (const i of pkgIssues || []) {
      if (i?.itemId === item?.id) out.push(i);
    }
    return out;
  }

  function correctionFor(item) {
    const grading = item?.grading || {};
    const concepts = (grading.concepts || []).map(concept => ({
      id: concept.id,
      label: oneLine(concept.label),
      score: Number(concept.score || 0),
      terms: [...(concept.terms || [])],
      riskyTerms: [...(concept.riskyTerms || [])]
    }));

    return {
      mode: grading.mode || 'manual',
      modeLabel: GRADING_LABELS[grading.mode] || grading.mode || 'Manuelle',
      expectedAnswer: oneLine(grading.expectedAnswer),
      provenance: grading?.provenance?.kind || null,
      requirements: [...(grading.requirements || [])],
      concepts,
      activeTermCount: concepts.reduce((sum, c) => sum + c.terms.length, 0),
      riskyTermCount: concepts.reduce((sum, c) => sum + c.riskyTerms.length, 0)
    };
  }

  function buildValidationRows(pkg, extraIssues = []) {
    const rows = [];
    let visibleNumber = 0;
    const combinedIssues = [...(pkg?.issues || []), ...(extraIssues || [])];

    for (const item of [...(pkg?.items || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0))) {
      if (item?.kind !== 'question') continue;
      visibleNumber += 1;
      const issues = questionIssues(combinedIssues, item);
      const correction = correctionFor(item);
      const blockers = issues.filter(x => x.severity === 'blocker').length;
      const warnings = issues.filter(x => x.severity === 'warning').length;

      rows.push({
        itemId: item.id,
        number: item?.source?.number || String(visibleNumber),
        prompt: oneLine(item.prompt),
        type: item.subtype,
        typeLabel: TYPE_LABELS[item.subtype] || item.subtype || 'Question',
        points: Number(item?.points?.value || 0),
        pointsProvenance: item?.points?.provenance || null,
        correction,
        correctionSummary: correction.expectedAnswer || correction.concepts.map(c => c.label).filter(Boolean).join(' · '),
        status: blockers ? 'blocked' : warnings ? 'review' : 'ready',
        issues,
        flags: {
          proposedPoints: item?.points?.provenance === 'proposed',
          sourceMissing: item?.grading?.provenance?.kind === 'sourceMissing',
          assisted: item?.grading?.mode === 'assisted',
          manual: item?.grading?.mode === 'manual'
        }
      });
    }

    return rows;
  }

  function buildReconciliationRows(prepared) {
    const bySourceId = new Map((prepared?.pkg?.items || []).map(item => [String(item.id), item]));
    return (prepared?.reconciliation?.proposals || []).map(proposal => {
      const source = bySourceId.get(String(proposal.sourceItemId || '')) || null;
      return {
        fingerprint: proposal.fingerprint,
        sourceItemId: proposal.sourceItemId || null,
        number: source?.source?.number || null,
        prompt: oneLine(source?.prompt || proposal?.desiredState?.prompt || ''),
        formativeItemId: proposal.formativeItemId,
        subtype: proposal.subtype,
        typeLabel: TYPE_LABELS[proposal.subtype] || proposal.subtype || 'Question',
        match: proposal.match,
        matchLabel: RECONCILIATION_LABELS[proposal.match] || 'À vérifier',
        safeSuggestedLink: proposal.safeToAdoptServerAsBaseline === true || proposal.safeToAdoptDesiredAsBaseline === true,
        willUpdateAfterLink: proposal.safeToAdoptDesiredAsBaseline !== true && proposal.safeToAdoptServerAsBaseline === true,
        note: oneLine(proposal.note),
        // Hidden state-binding value used by the click handler. It is not a
        // credential and must never be treated as a user-visible secret.
        approvalToken: proposal.approvalToken
      };
    });
  }

  function recoveryFreshPrepareSafe(journal = {}) {
    if (!Array.isArray(journal?.operations)) return false;
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

  function primaryAction(model = {}) {
    const state = model.state;
    if (state === 'recovery') {
      if (model.freshReprepareSafe === true) {
        return { id: 'reimport', label: 'Revérifier et reprendre', enabled: true, emphasis: 'primary' };
      }
      return { id: 'resume', label: 'Reprendre l’import', enabled: true, emphasis: 'primary' };
    }
    if (state === 'uncertain') {
      return {
        id: 'resume',
        label: 'Reprendre l’import',
        enabled: true,
        emphasis: 'warning'
      };
    }
    if (state === 'failed') {
      return {
        id: 'resume',
        label: 'Reprendre en sécurité',
        enabled: true,
        emphasis: 'warning'
      };
    }
    if (state === 'reconciliation_required') {
      if (model.reconciliationConflicts > 0) {
        return { id: 'review-reconciliation', label: 'Vérifier les correspondances', enabled: true, emphasis: 'warning' };
      }
      if (model.reconciliationUpdates > 0) {
        return { id: 'confirm-reconciliation', label: 'Relier puis préparer les mises à jour', enabled: true, emphasis: 'warning' };
      }
      if (model.reconciliationProposals > 0) {
        return { id: 'confirm-reconciliation', label: 'Relier et continuer', enabled: true, emphasis: 'primary' };
      }
      return { id: 'confirm-reconciliation', label: 'Conserver l’existant et continuer', enabled: true, emphasis: 'primary' };
    }
    if (state === 'reconciliation_changed') return { id: 'refresh-reconciliation', label: 'Revérifier', enabled: true, emphasis: 'warning' };
    if (state === 'importing') return { id: 'none', label: 'Import en cours…', enabled: false, emphasis: 'primary' };
    if (state === 'completed') return { id: 'reimport', label: 'Réimporter dans Formative', enabled: true, emphasis: 'secondary' };
    if (state === 'blocked' || model.blockers > 0) return { id: 'none', label: 'Import bloqué', enabled: false, emphasis: 'danger' };
    if (state === 'review' || model.warnings > 0) return { id: 'import', label: 'Importer dans Formative', enabled: true, emphasis: 'primary' };
    return { id: 'import', label: 'Importer dans Formative', enabled: true, emphasis: 'primary' };
  }

  function buildPreparedView(prepared = {}) {
    if (prepared.state === 'recovery') {
      const summary = prepared?.journal?.summary || prepared?.ui?.summary || {};
      const model = {
        state: 'recovery',
        statusLabel: '↻ Reprise requise',
        targetTitle: prepared.targetTitle || null,
        create: 0, update: 0, unchanged: 0, deleteProposed: 0,
        warnings: 0, blockers: 0,
        recovery: {
          runId: prepared?.journal?.runId || null,
          verified: Number(summary.verified || 0),
          remaining: Number(summary.remaining || 0),
          uncertain: Number(summary.uncertain || 0),
          failed: Number(summary.failed || 0)
        },
        freshReprepareSafe: recoveryFreshPrepareSafe(prepared?.journal || {})
      };
      model.primaryAction = primaryAction(model);
      return model;
    }

    if (prepared.state === 'reconciliation_required') {
      const summary = prepared?.reconciliation?.summary || {};
      const rows = buildReconciliationRows(prepared);
      const conflicts = rows.filter(row => !row.safeSuggestedLink).length;
      const model = {
        state: 'reconciliation_required',
        statusLabel: conflicts ? '⚠ Questions modifiées à vérifier' : '⚠ Questions existantes à relier',
        targetTitle: prepared.targetTitle || null,
        questions: Number(summary.desired || 0),
        warnings: conflicts,
        blockers: 0,
        reconciliationProposals: Number(summary.proposed || 0),
        reconciliationConflicts: conflicts,
        reconciliationUpdates: rows.filter(row => row.willUpdateAfterLink).length,
        exactLegacyMatches: Number(summary.legacyExact || 0),
        exactStateMatches: Number(summary.exactState || 0),
        unmatchedDesired: Number(summary.unmatchedDesired || 0),
        preservedExisting: Number(summary.preservedForeign || 0),
        analysisToken: prepared?.reconciliation?.analysisToken || null,
        reconciliationRows: rows,
        suggestedLinks: rows
          .filter(row => row.safeSuggestedLink)
          .map(row => ({ fingerprint: row.fingerprint, approvalToken: row.approvalToken })),
        explanation: conflicts
          ? 'Certaines correspondances sont ambiguës. Cardinal ne choisira pas à ta place.'
          : rows.some(row => row.willUpdateAfterLink)
            ? 'Cardinal a retrouvé des questions existantes avec le même énoncé ou un ancien lien. Les relier ne modifie rien: Cardinal reprendra ensuite un dry-run et proposera les vraies mises à jour séparément.'
            : rows.length
              ? 'Cardinal a retrouvé des questions déjà présentes. Confirme les correspondances pour éviter les doublons.'
              : 'Aucune question existante ne correspond au nouveau questionnaire. Les questions déjà présentes seront conservées.'
      };
      model.primaryAction = primaryAction(model);
      model.validationRows = buildValidationRows(prepared.pkg || {});
      model.showCorrectionButton = model.validationRows.some(row =>
        row.correction.expectedAnswer || row.correction.concepts.length || row.correction.mode !== 'manual'
      );
      return model;
    }

    const ui = prepared?.preflight?.data?.ui || {};
    const validation = prepared?.preflight?.data?.validation || null;
    const preflightIssues = [
      ...(prepared?.preflight?.issues || []),
      ...((prepared?.issues || []).filter(issue =>
        !(prepared?.preflight?.issues || []).some(existing =>
          existing?.severity === issue?.severity &&
          existing?.code === issue?.code &&
          existing?.itemId === issue?.itemId &&
          existing?.message === issue?.message
        )
      ))
    ];
    const issueBlockers = preflightIssues.filter(issue => issue?.severity === 'blocker').length;
    const issueWarnings = preflightIssues.filter(issue => issue?.severity === 'warning').length;
    const validationRows = buildValidationRows(prepared.pkg || {}, preflightIssues);
    const count = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : Number(fallback || 0);
    };
    const blockers = count(ui.blockers, issueBlockers || (prepared.ok ? 0 : 1));
    const warnings = count(ui.warnings, issueWarnings);
    const model = {
      state: prepared.state || (prepared.ok ? 'ready' : 'blocked'),
      statusLabel: blockers > 0
        ? (ui.status || '✕ Bloqué')
        : warnings > 0
          ? (ui.status || '⚠ À vérifier')
          : '✓ Prêt',
      targetTitle: prepared.targetTitle || ui.targetTitle || null,
      questions: count(ui.questions, validation?.stats?.questions ?? validationRows.length),
      auto: count(ui.auto, validation?.stats?.auto),
      assisted: count(ui.assisted, validation?.stats?.assisted),
      manual: count(ui.manual, validation?.stats?.manual),
      create: count(ui.create),
      update: count(ui.update),
      unchanged: count(ui.unchanged),
      preserveExternal: count(ui.preserveExternal),
      deleteProposed: count(ui.deleteProposed),
      warnings,
      blockers,
      packageFingerprint: prepared.packageFingerprint || null,
      validationRows,
      issues: preflightIssues,
      globalIssues: preflightIssues.filter(issue => !issue?.itemId)
    };
    model.primaryAction = primaryAction(model);
    model.showCorrectionButton = model.validationRows.some(row =>
      row.correction.expectedAnswer || row.correction.concepts.length || row.correction.mode !== 'manual'
    );
    return model;
  }

  function buildExecutionView(result = {}, prepared = {}) {
    const journal = result.journal || {};
    const summary = journal.summary || {};
    const state = result.state === 'completed' ? 'completed' : result.state || 'blocked';
    const model = {
      state,
      statusLabel: state === 'completed'
        ? '✓ Import vérifié'
        : state === 'uncertain'
          ? '↻ Vérification requise'
          : state === 'failed'
            ? '✕ Import interrompu'
            : state === 'reconciliation_required'
              ? '⚠ Questions existantes à relier'
              : '✕ Import bloqué',
      targetTitle: prepared.targetTitle || null,
      verified: Number(summary.verified || 0),
      skipped: Number(summary.skipped || 0),
      remaining: Number(summary.remaining || 0),
      uncertain: Number(summary.uncertain || 0),
      failed: Number(summary.failed || 0),
      blocked: Number(summary.blocked || 0),
      reason: result.reason || null
    };
    model.primaryAction = primaryAction(model);
    return model;
  }

  const api = {
    TYPE_LABELS,
    GRADING_LABELS,
    RECONCILIATION_LABELS,
    buildValidationRows,
    buildReconciliationRows,
    buildPreparedView,
    buildExecutionView,
    recoveryFreshPrepareSafe,
    primaryAction
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Presentation = api;
})();
