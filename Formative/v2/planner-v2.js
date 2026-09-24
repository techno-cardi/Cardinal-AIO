(() => {
  'use strict';

  const ACTIONS = Object.freeze({
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    UNCHANGED: 'UNCHANGED',
    PRESERVE_EXTERNAL: 'PRESERVE_EXTERNAL',
    BLOCKED: 'BLOCKED',
    DELETE_PROPOSED: 'DELETE_PROPOSED'
  });

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

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function sameManaged(a, b) {
    return canonicalJson(a ?? null) === canonicalJson(b ?? null);
  }

  function recordIssue(issues, severity, code, message, fingerprint = null, formativeItemId = null) {
    const out = { severity, code, message };
    if (fingerprint) out.fingerprint = fingerprint;
    if (formativeItemId) out.formativeItemId = formativeItemId;
    issues.push(out);
  }

  function mapBy(list, key) {
    const out = new Map();
    for (const row of list || []) {
      const value = row?.[key];
      if (!value) continue;
      if (out.has(value)) throw new Error(`Duplicate ${key}: ${value}`);
      out.set(value, row);
    }
    return out;
  }

  function validateRecordShape(list, kind, issues) {
    const seenFingerprint = new Set();
    const seenServerId = new Set();

    for (const row of list || []) {
      if (!row?.fingerprint) {
        recordIssue(issues, 'blocker', 'PLANNER_RECORD_IDENTITY_MISSING', `${kind}: fingerprint manquant.`);
        continue;
      }
      if (seenFingerprint.has(row.fingerprint)) {
        recordIssue(issues, 'blocker', 'PLANNER_DUPLICATE_FINGERPRINT', `${kind}: fingerprint dupliqué ${row.fingerprint}.`, row.fingerprint);
      }
      seenFingerprint.add(row.fingerprint);

      if (kind !== 'desired' && row.formativeItemId) {
        if (seenServerId.has(row.formativeItemId)) {
          recordIssue(issues, 'blocker', 'PLANNER_DUPLICATE_SERVER_ID', `${kind}: formativeItemId dupliqué ${row.formativeItemId}.`, row.fingerprint, row.formativeItemId);
        }
        seenServerId.add(row.formativeItemId);
      }
    }
  }

  /**
   * Pure three-way planner.
   *
   * desired[]:  { fingerprint, managedState, sourceItemId? }
   * baseline[]: { fingerprint, formativeItemId, managedState }
   * server[]:   { formativeItemId, managedState }
   *
   * Only managedState participates in comparisons. Unknown server fields are
   * preserved by construction (field ownership).
   */
  function planThreeWay(input = {}) {
    const packageMode = input.packageMode;
    const desired = input.desired || [];
    const baseline = input.baseline || [];
    const server = input.server || [];
    const issues = [];
    const operations = [];

    if (!['full', 'patch'].includes(packageMode)) {
      recordIssue(issues, 'blocker', 'PLANNER_PACKAGE_MODE', 'packageMode doit être full ou patch.');
      return finish(operations, issues);
    }

    validateRecordShape(desired, 'desired', issues);
    validateRecordShape(baseline, 'baseline', issues);
    validateRecordShape(
      server.map(row => ({ ...row, fingerprint: row.fingerprint || `server:${row.formativeItemId || ''}` })),
      'server',
      issues
    );

    if (issues.some(x => x.severity === 'blocker')) return finish(operations, issues);

    let desiredByFp;
    let baselineByFp;
    let serverById;
    try {
      desiredByFp = mapBy(desired, 'fingerprint');
      baselineByFp = mapBy(baseline, 'fingerprint');
      serverById = mapBy(server, 'formativeItemId');
    } catch (error) {
      recordIssue(issues, 'blocker', 'PLANNER_DUPLICATE_IDENTITY', error.message);
      return finish(operations, issues);
    }

    for (const d of desired) {
      const b = baselineByFp.get(d.fingerprint) || null;

      if (!b) {
        operations.push({
          action: ACTIONS.CREATE,
          fingerprint: d.fingerprint,
          sourceItemId: d.sourceItemId || null,
          desired: d.managedState
        });
        continue;
      }

      if (!b.formativeItemId) {
        operations.push({ action: ACTIONS.BLOCKED, reason: 'BASELINE_SERVER_ID_MISSING', fingerprint: d.fingerprint, sourceItemId: d.sourceItemId || null });
        recordIssue(issues, 'blocker', 'BASELINE_SERVER_ID_MISSING', 'Le mapping baseline existe mais ne contient pas de formativeItemId.', d.fingerprint);
        continue;
      }

      const s = serverById.get(b.formativeItemId) || null;
      if (!s) {
        operations.push({ action: ACTIONS.BLOCKED, reason: 'SERVER_ITEM_MISSING', fingerprint: d.fingerprint, formativeItemId: b.formativeItemId, sourceItemId: d.sourceItemId || null });
        recordIssue(issues, 'blocker', 'SERVER_ITEM_MISSING', 'Un item connu de Cardinal n’existe plus sur le serveur. Ne pas le recréer aveuglément.', d.fingerprint, b.formativeItemId);
        continue;
      }

      const serverEqDesired = sameManaged(s.managedState, d.managedState);
      const serverEqBaseline = sameManaged(s.managedState, b.managedState);
      const desiredEqBaseline = sameManaged(d.managedState, b.managedState);

      if (serverEqDesired) {
        operations.push({ action: ACTIONS.UNCHANGED, fingerprint: d.fingerprint, formativeItemId: b.formativeItemId, sourceItemId: d.sourceItemId || null });
        continue;
      }

      if (serverEqBaseline && !desiredEqBaseline) {
        operations.push({ action: ACTIONS.UPDATE, fingerprint: d.fingerprint, formativeItemId: b.formativeItemId, sourceItemId: d.sourceItemId || null, baseline: b.managedState, desired: d.managedState });
        continue;
      }

      if (desiredEqBaseline && !serverEqBaseline) {
        operations.push({ action: ACTIONS.PRESERVE_EXTERNAL, fingerprint: d.fingerprint, formativeItemId: b.formativeItemId, sourceItemId: d.sourceItemId || null, server: s.managedState });
        recordIssue(issues, 'warning', 'SERVER_EXTERNAL_CHANGE', 'Le serveur a été modifié depuis le dernier import tandis que le paquet n’a pas changé. Modification externe préservée.', d.fingerprint, b.formativeItemId);
        continue;
      }

      operations.push({
        action: ACTIONS.BLOCKED,
        reason: 'SERVER_THREE_WAY_CONFLICT',
        fingerprint: d.fingerprint,
        formativeItemId: b.formativeItemId,
        sourceItemId: d.sourceItemId || null,
        baseline: b.managedState,
        server: s.managedState,
        desired: d.managedState
      });
      recordIssue(issues, 'blocker', 'SERVER_THREE_WAY_CONFLICT', 'Le serveur et le nouveau paquet ont modifié le même item depuis la baseline. Aucune écriture automatique.', d.fingerprint, b.formativeItemId);
    }

    // Missing desired items mean something only for a FULL package, and only
    // for items Cardinal already owns through its baseline. Unknown server
    // items are never deletion candidates.
    if (packageMode === 'full') {
      for (const b of baseline) {
        if (desiredByFp.has(b.fingerprint)) continue;

        const s = b.formativeItemId ? serverById.get(b.formativeItemId) : null;
        if (!b.formativeItemId || !s) {
          operations.push({ action: ACTIONS.BLOCKED, reason: 'DELETE_SERVER_ITEM_MISSING', fingerprint: b.fingerprint, formativeItemId: b.formativeItemId || null });
          recordIssue(issues, 'warning', 'DELETE_SERVER_ITEM_MISSING', 'Un ancien item Cardinal absent du paquet full est aussi introuvable sur le serveur; aucune suppression à faire ni supposition à faire.', b.fingerprint, b.formativeItemId || null);
          continue;
        }

        const externalChanged = !sameManaged(s.managedState, b.managedState);
        operations.push({
          action: ACTIONS.DELETE_PROPOSED,
          fingerprint: b.fingerprint,
          formativeItemId: b.formativeItemId,
          externalChanged,
          baseline: b.managedState,
          server: s.managedState
        });
        recordIssue(
          issues,
          'warning',
          externalChanged ? 'DELETE_PROPOSED_EXTERNAL_CHANGE' : 'DELETE_PROPOSED',
          externalChanged
            ? 'Item absent du paquet full mais modifié manuellement sur le serveur: suppression seulement proposée et signalée comme risquée.'
            : 'Item Cardinal absent du paquet full: suppression proposée, jamais automatique.',
          b.fingerprint,
          b.formativeItemId
        );
      }
    }

    const claimedServerIds = new Set(baseline.map(x => x.formativeItemId).filter(Boolean));
    const foreignServerItemCount = server.filter(x => x.formativeItemId && !claimedServerIds.has(x.formativeItemId)).length;

    return finish(operations, issues, { foreignServerItemCount });
  }

  function finish(operations, issues, extra = {}) {
    const counts = Object.create(null);
    for (const action of Object.values(ACTIONS)) counts[action] = 0;
    for (const op of operations) counts[op.action] = (counts[op.action] || 0) + 1;

    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;

    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      operations,
      issues,
      counts,
      blockers,
      warnings,
      ...extra
    };
  }

  const api = { ACTIONS, canonicalize, canonicalJson, sameManaged, planThreeWay };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Planner = api;
})();