(() => {
  'use strict';

  function resolveDependencies(injected = {}) {
    const deps = {
      validator: injected.validator || globalThis.CardinalFormativeV2,
      adapter: injected.adapter || globalThis.CardinalFormativeV2Adapter,
      managed: injected.managed || globalThis.CardinalFormativeV2ManagedState,
      planner: injected.planner || globalThis.CardinalFormativeV2Planner,
      baseline: injected.baseline || globalThis.CardinalFormativeV2Baseline
    };

    const missing = Object.entries(deps).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new Error(`Missing preflight dependencies: ${missing.join(', ')}`);
    return deps;
  }

  function issue(issues, severity, code, message, itemId = null) {
    const out = { severity, code, message };
    if (itemId) out.itemId = itemId;
    issues.push(out);
  }

  function readBaseline(record, deps, expected) {
    if (!record) return { entries: [], issues: [], exists: false };
    const check = deps.baseline.validateBaseline(record, expected);
    if (!check.ok) {
      return {
        entries: [], exists: true,
        issues: check.issues.map(message => ({ severity: 'blocker', code: 'BASELINE_INVALID', message }))
      };
    }
    return { entries: deps.baseline.toPlannerBaseline(record), issues: [], exists: true };
  }

  function normalizeDesired(adapted, identityRows, deps, issues) {
    const identityByAdaptedId = new Map((identityRows || []).map(row => [row.adaptedItemId, row]));
    const out = [];

    for (const item of adapted?.items || []) {
      const identity = identityByAdaptedId.get(item.id);
      if (!identity) {
        issue(issues, 'blocker', 'PREFLIGHT_IDENTITY_MISSING', `Aucune identité v2 pour l'item adapté ${item.id}.`);
        continue;
      }

      const normalized = deps.managed.managedFromDesiredV1(item);
      for (const i of normalized.issues || []) {
        issue(issues, i.severity, i.code, i.message, identity.sourceItemId || null);
      }
      if (!normalized.managedState || normalized.state === 'blocked') continue;

      out.push({
        fingerprint: identity.fingerprint,
        sourceItemId: identity.sourceItemId || null,
        managedState: normalized.managedState,
        adaptedItem: item
      });
    }

    return out;
  }

  function normalizeServer(serverItems, baselineEntries, deps, issues) {
    const baselineByServerId = new Map((baselineEntries || []).map(row => [row.formativeItemId, row]));
    const out = [];

    for (const item of serverItems || []) {
      const formativeItemId = item?._id || item?.id || null;
      if (!formativeItemId) {
        issue(issues, 'warning', 'SERVER_ITEM_ID_MISSING', 'Un item serveur sans ID a été ignoré du planner.');
        continue;
      }

      const normalized = deps.managed.managedFromServerItem(item);
      const claimed = baselineByServerId.get(formativeItemId) || null;

      for (const i of normalized.issues || []) {
        const severity = claimed ? i.severity : (i.severity === 'blocker' ? 'warning' : i.severity);
        issue(
          issues,
          severity,
          claimed && i.severity === 'blocker' ? i.code : `FOREIGN_${i.code}`,
          claimed ? i.message : `Item serveur non revendiqué ${formativeItemId}: ${i.message}`
        );
      }

      if (!normalized.managedState) {
        out.push({
          formativeItemId,
          fingerprint: claimed?.fingerprint || null,
          managedState: claimed ? null : { opaqueForeign: true, subtype: item?.subtype || null }
        });
        continue;
      }

      out.push({
        formativeItemId,
        fingerprint: claimed?.fingerprint || null,
        managedState: normalized.managedState
      });
    }

    return out;
  }

  function riskGates({ packageMode, desired, baselineExists, baselineEntries, serverItems, plannerResult, issues }) {
    const serverCount = (serverItems || []).length;

    if (!baselineExists && serverCount > 0 && desired.length > 0) {
      issue(
        issues,
        'blocker',
        'INITIAL_NONEMPTY_TARGET_REQUIRES_RECONCILIATION',
        "La cible Formative contient déjà des items mais aucune baseline v2 fiable n'existe. Faire une découverte/réconciliation avant toute création afin d’éviter les doublons ou l’adoption du mauvais item."
      );
    }

    if (packageMode === 'full' && desired.length === 0) {
      issue(issues, 'blocker', 'EMPTY_FULL_PACKAGE', 'Un paquet full vide ne peut pas servir de signal implicite de suppression globale.');
    }

    if ((plannerResult?.counts?.CREATE || 0) > 0 && (plannerResult?.foreignServerItemCount || 0) > 0 && baselineEntries.length > 0) {
      issue(
        issues,
        'warning',
        'CREATE_WITH_FOREIGN_ITEMS',
        'La cible contient des items non revendiqués par Cardinal. Ils seront préservés; vérifier visuellement que la nouvelle création n’est pas un doublon conceptuel.'
      );
    }
  }

  /**
   * Pure dry-run. No mutation, no storage write, no network call.
   * Raw serverItems must come from an independent server read.
   */
  function preflightPackageV2(input = {}, injected = {}) {
    const deps = resolveDependencies(injected);
    const issues = [];

    if (!input.targetFormativeId) {
      issue(issues, 'blocker', 'TARGET_REQUIRED', 'Une cible Formative explicite est requise.');
      return finish(null, issues);
    }

    const validation = deps.validator.validatePackageV2(input.pkg, {
      capabilities: input.capabilities
    });
    issues.push(...(validation.issues || []));
    if (!validation.ok) return finish({ validation }, issues);

    const adapted = deps.adapter.adaptPackageV2ToV1(input.pkg, {
      targetFormativeId: input.targetFormativeId
    });
    issues.push(...(adapted.issues || []));
    if (!adapted.ok) return finish({ validation, adapted }, issues);

    const baselineRead = readBaseline(input.baselineRecord || null, deps, {
      targetFormativeId: input.targetFormativeId,
      assessmentFingerprint: input.assessmentFingerprint || undefined
    });
    issues.push(...baselineRead.issues);
    if (baselineRead.issues.some(x => x.severity === 'blocker')) {
      return finish({ validation, adapted }, issues);
    }

    const desired = normalizeDesired(adapted.packageV1, adapted.identity, deps, issues);
    const server = normalizeServer(input.serverItems || [], baselineRead.entries, deps, issues);

    const claimedOpaque = server.filter(row => row.fingerprint && row.managedState == null);
    if (claimedOpaque.length) {
      issue(
        issues,
        'blocker',
        'CLAIMED_SERVER_ITEM_UNREADABLE',
        `${claimedOpaque.length} item(s) Cardinal connu(s) ne peuvent pas être normalisés avec les capacités actuelles.`
      );
      return finish({ validation, adapted, desired, server }, issues);
    }

    const planner = deps.planner.planThreeWay({
      packageMode: input.pkg.packageMode,
      desired: desired.map(row => ({
        fingerprint: row.fingerprint,
        sourceItemId: row.sourceItemId,
        managedState: row.managedState
      })),
      baseline: baselineRead.entries,
      server
    });
    issues.push(...(planner.issues || []));

    riskGates({
      packageMode: input.pkg.packageMode,
      desired,
      baselineExists: baselineRead.exists,
      baselineEntries: baselineRead.entries,
      serverItems: input.serverItems || [],
      plannerResult: planner,
      issues
    });

    const ui = buildUiSummary({ validation, planner, issues, targetTitle: input.targetTitle || null });

    return finish({
      validation,
      adapted,
      desired,
      server,
      baseline: baselineRead.entries,
      planner,
      ui
    }, issues);
  }

  function buildUiSummary({ validation, planner, issues, targetTitle }) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    const counts = planner?.counts || {};
    return {
      status: blockers ? '✕ Bloqué' : warnings ? '⚠ À vérifier' : '✓ Prêt',
      targetTitle,
      questions: validation?.stats?.questions || 0,
      auto: validation?.stats?.auto || 0,
      assisted: validation?.stats?.assisted || 0,
      manual: validation?.stats?.manual || 0,
      create: counts.CREATE || 0,
      update: counts.UPDATE || 0,
      unchanged: counts.UNCHANGED || 0,
      preserveExternal: counts.PRESERVE_EXTERNAL || 0,
      deleteProposed: counts.DELETE_PROPOSED || 0,
      blockedOperations: counts.BLOCKED || 0,
      warnings,
      blockers
    };
  }

  function finish(data, issues) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      issues,
      data
    };
  }

  const api = { preflightPackageV2, buildUiSummary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Preflight = api;
})();