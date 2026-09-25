(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function serverId(item) {
    return item?._id || item?.id || item?.formativeItemId || null;
  }

  function stable(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }

  function equal(a, b) {
    return stable(a) === stable(b);
  }

  function normalizedPrompt(value) {
    return String(value ?? '')
      .normalize('NFC')
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/[’‘`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('fr');
  }

  function fnv1a64(value) {
    const text = String(value ?? '');
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      hash ^= BigInt(code & 0xff);
      hash = BigInt.asUintN(64, hash * prime);
      if (code > 0xff) {
        hash ^= BigInt((code >>> 8) & 0xff);
        hash = BigInt.asUintN(64, hash * prime);
      }
    }
    return hash.toString(16).padStart(16, '0');
  }

  function hash128(value) {
    const text = String(value ?? '');
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  function approvalMaterial(input, proposal) {
    return stable({
      contract: 'cardinal.formative.bootstrap-approval/1',
      targetFormativeId: String(input.targetFormativeId || ''),
      assessmentFingerprint: String(input.assessmentFingerprint || ''),
      packageFingerprint: String(input.packageFingerprint || ''),
      fingerprint: proposal.fingerprint,
      sourceItemId: proposal.sourceItemId || null,
      formativeItemId: proposal.formativeItemId,
      subtype: proposal.subtype,
      match: proposal.match,
      managedState: proposal.managedState,
      desiredState: proposal.desiredState,
      safeToAdoptDesiredAsBaseline: proposal.safeToAdoptDesiredAsBaseline === true,
      safeToAdoptServerAsBaseline: proposal.safeToAdoptServerAsBaseline === true
    });
  }

  function approvalToken(input, proposal) {
    return `cfi-bootstrap-approval-${hash128(approvalMaterial(input, proposal))}`;
  }

  function issue(issues, severity, code, message, extra = {}) {
    issues.push({ severity, code, message, ...extra });
  }

  function normalizeDesired(pkg, targetFormativeId, deps, issues) {
    const adapted = deps.adapter.adaptPackageV2ToV1(pkg, { targetFormativeId });
    for (const current of adapted.issues || []) issues.push(current);
    if (!adapted.ok) return { adapted, rows: [] };

    const identityByAdapted = new Map((adapted.identity || []).map(row => [row.adaptedItemId, row]));
    const rows = [];
    for (const item of adapted.packageV1?.items || []) {
      const identity = identityByAdapted.get(item.id);
      if (!identity) {
        issue(issues, 'blocker', 'BOOTSTRAP_IDENTITY_MISSING', `Identité v2 absente pour ${item.id}.`);
        continue;
      }
      const normalized = deps.managed.managedFromDesiredV1(item);
      for (const current of normalized.issues || []) {
        issue(issues, current.severity, current.code, current.message, { sourceItemId: identity.sourceItemId || null });
      }
      if (!normalized.managedState || normalized.state === 'blocked') continue;
      rows.push({
        fingerprint: identity.fingerprint,
        sourceItemId: identity.sourceItemId || null,
        adaptedItemId: item.id,
        subtype: normalized.managedState.subtype,
        managedState: normalized.managedState
      });
    }
    return { adapted, rows };
  }

  function normalizeServer(serverItems, deps, issues) {
    const rows = [];
    const ids = new Set();
    for (const item of serverItems || []) {
      const formativeItemId = serverId(item);
      if (!formativeItemId) {
        issue(issues, 'blocker', 'BOOTSTRAP_SERVER_ID_MISSING', 'Un item serveur ne contient aucun ID.');
        continue;
      }
      const id = String(formativeItemId);
      if (ids.has(id)) {
        issue(issues, 'blocker', 'BOOTSTRAP_DUPLICATE_SERVER_ID', `ID serveur dupliqué: ${id}.`);
        continue;
      }
      ids.add(id);
      const normalized = deps.managed.managedFromServerItem(item);
      if (!normalized.managedState || normalized.state === 'blocked') {
        rows.push({ formativeItemId: id, subtype: item?.subtype || null, managedState: null, opaque: true, raw: item });
        continue;
      }
      rows.push({
        formativeItemId: id,
        subtype: normalized.managedState.subtype,
        managedState: normalized.managedState,
        raw: item,
        issues: normalized.issues || []
      });
    }
    return rows;
  }

  function hintMap(legacyHints) {
    const map = new Map();
    for (const hint of legacyHints || []) {
      const logicalId = hint?.logicalId || hint?.sourceItemId || hint?.id || null;
      const formativeItemId = hint?.formativeItemId || null;
      if (!logicalId || !formativeItemId) continue;
      if (!map.has(String(logicalId))) map.set(String(logicalId), []);
      map.get(String(logicalId)).push(String(formativeItemId));
    }
    return map;
  }

  function finalizeProposals(input, proposals) {
    return proposals.map(proposal => ({
      ...proposal,
      approvalToken: approvalToken(input, proposal)
    }));
  }

  function analyze(input = {}, injected = {}) {
    const deps = {
      validator: required(injected.validator || globalThis.CardinalFormativeV2, 'validator'),
      adapter: required(injected.adapter || globalThis.CardinalFormativeV2Adapter, 'adapter'),
      managed: required(injected.managed || globalThis.CardinalFormativeV2ManagedState, 'managed-state')
    };
    const issues = [];

    if (!input.targetFormativeId) {
      issue(issues, 'blocker', 'BOOTSTRAP_TARGET_REQUIRED', 'Une cible Formative explicite est requise.');
      return finish([], [], issues);
    }
    if (!Array.isArray(input.serverItems)) {
      issue(issues, 'blocker', 'BOOTSTRAP_SERVER_ITEMS_REQUIRED', 'Une relecture serveur détaillée et complète est requise.');
      return finish([], [], issues);
    }

    const validation = deps.validator.validatePackageV2(input.pkg, { capabilities: input.capabilities });
    issues.push(...(validation.issues || []));
    if (!validation.ok) return finish([], [], issues, { validation });

    const desiredResult = normalizeDesired(input.pkg, input.targetFormativeId, deps, issues);
    if (!desiredResult.adapted?.ok) return finish([], [], issues, { validation, adapted: desiredResult.adapted });
    const desired = desiredResult.rows;
    const server = normalizeServer(input.serverItems, deps, issues);
    const byServerId = new Map(server.map(row => [row.formativeItemId, row]));
    const hints = hintMap(input.legacyHints || []);

    const proposals = [];
    const reservedServerIds = new Set();
    const unresolved = [];

    // Pass 1: legacy mapping hint + independently reread current server state.
    for (const row of desired) {
      const hintedIds = hints.get(String(row.sourceItemId || '')) || [];
      const candidates = hintedIds.map(id => byServerId.get(id)).filter(Boolean);
      if (candidates.length > 1) {
        issue(issues, 'blocker', 'BOOTSTRAP_LEGACY_HINT_AMBIGUOUS', `Plusieurs anciens mappings pointent vers ${row.sourceItemId}.`, { sourceItemId: row.sourceItemId });
        unresolved.push(row);
        continue;
      }
      if (candidates.length === 1) {
        const candidate = candidates[0];
        if (!candidate.managedState) {
          issue(issues, 'blocker', 'BOOTSTRAP_LEGACY_HINT_UNREADABLE', `L’item lié historiquement à ${row.sourceItemId} ne peut pas être relu avec certitude.`, { sourceItemId: row.sourceItemId, formativeItemId: candidate.formativeItemId });
          unresolved.push(row);
          continue;
        }
        if (candidate.subtype !== row.subtype) {
          issue(issues, 'blocker', 'BOOTSTRAP_LEGACY_HINT_SUBTYPE_CONFLICT', `L’ancien mapping de ${row.sourceItemId} pointe vers un autre type de question.`, { sourceItemId: row.sourceItemId, formativeItemId: candidate.formativeItemId });
          unresolved.push(row);
          continue;
        }
        if (reservedServerIds.has(candidate.formativeItemId)) {
          issue(issues, 'blocker', 'BOOTSTRAP_SERVER_ITEM_REUSED', 'Le même item Formative serait relié à plusieurs questions Cardinal.', { formativeItemId: candidate.formativeItemId });
          unresolved.push(row);
          continue;
        }

        const exact = equal(candidate.managedState, row.managedState);
        proposals.push({
          fingerprint: row.fingerprint,
          sourceItemId: row.sourceItemId,
          formativeItemId: candidate.formativeItemId,
          subtype: row.subtype,
          managedState: candidate.managedState,
          desiredState: row.managedState,
          match: exact ? 'legacy-exact' : 'legacy-changed',
          confidence: exact ? 'high' : 'review',
          requiresExplicitApproval: true,
          safeToAdoptDesiredAsBaseline: exact,
          safeToAdoptServerAsBaseline: true,
          note: exact
            ? 'Ancien mapping retrouvé et état serveur identique au paquet.'
            : 'Ancien mapping retrouvé, mais la question actuelle n’est plus identique au paquet.'
        });
        reservedServerIds.add(candidate.formativeItemId);
        continue;
      }
      unresolved.push(row);
    }

    // Pass 2: exact semantic state only. No fuzzy prompt matching is allowed in bootstrap.
    for (const row of unresolved) {
      const candidates = server.filter(candidate =>
        !reservedServerIds.has(candidate.formativeItemId) &&
        candidate.managedState &&
        candidate.subtype === row.subtype &&
        equal(candidate.managedState, row.managedState)
      );

      if (candidates.length === 1) {
        const candidate = candidates[0];
        proposals.push({
          fingerprint: row.fingerprint,
          sourceItemId: row.sourceItemId,
          formativeItemId: candidate.formativeItemId,
          subtype: row.subtype,
          managedState: candidate.managedState,
          desiredState: row.managedState,
          match: 'exact-state',
          confidence: 'review',
          requiresExplicitApproval: true,
          safeToAdoptDesiredAsBaseline: true,
          safeToAdoptServerAsBaseline: true,
          note: 'Question serveur sémantiquement identique, sans ancien mapping fiable.'
        });
        reservedServerIds.add(candidate.formativeItemId);
      } else if (candidates.length > 1) {
        issue(
          issues,
          'blocker',
          'BOOTSTRAP_EXACT_MATCH_AMBIGUOUS',
          `Plusieurs questions Formative sont identiques à ${row.sourceItemId || row.fingerprint}; Cardinal ne choisira pas à ta place.`,
          { sourceItemId: row.sourceItemId || null, candidateIds: candidates.map(candidate => candidate.formativeItemId) }
        );
      }
    }

    // Pass 3: one unique question with the same subtype and normalized prompt
    // can be linked explicitly even when points/corrigé/settings changed.
    // Linking adopts the CURRENT SERVER state as baseline; it does not mutate
    // Formative. The next fresh dry-run will then produce an UPDATE to desired.
    const alreadyProposed = new Set(proposals.map(row => String(row.fingerprint)));
    for (const row of unresolved) {
      if (alreadyProposed.has(String(row.fingerprint))) continue;
      const prompt = normalizedPrompt(row.managedState?.prompt);
      if (!prompt) continue;
      const candidates = server.filter(candidate =>
        !reservedServerIds.has(candidate.formativeItemId) &&
        candidate.managedState &&
        candidate.subtype === row.subtype &&
        normalizedPrompt(candidate.managedState?.prompt) === prompt
      );

      if (candidates.length === 1) {
        const candidate = candidates[0];
        proposals.push({
          fingerprint: row.fingerprint,
          sourceItemId: row.sourceItemId,
          formativeItemId: candidate.formativeItemId,
          subtype: row.subtype,
          managedState: candidate.managedState,
          desiredState: row.managedState,
          match: 'prompt-changed',
          confidence: 'review',
          requiresExplicitApproval: true,
          safeToAdoptDesiredAsBaseline: false,
          safeToAdoptServerAsBaseline: true,
          note: 'Même type et même énoncé, mais réglages/corrigé différents. La liaison seule ne modifie rien; un UPDATE sera préparé ensuite.'
        });
        reservedServerIds.add(candidate.formativeItemId);
      } else if (candidates.length > 1) {
        issue(
          issues,
          'blocker',
          'BOOTSTRAP_PROMPT_MATCH_AMBIGUOUS',
          `Plusieurs questions Formative ont le même énoncé que ${row.sourceItemId || row.fingerprint}; Cardinal ne choisira pas à ta place.`,
          { sourceItemId: row.sourceItemId || null, candidateIds: candidates.map(candidate => candidate.formativeItemId) }
        );
      }
    }

    const finalizedProposals = finalizeProposals(input, proposals);
    const proposedFingerprints = new Set(finalizedProposals.map(row => row.fingerprint));
    const unmatchedDesired = desired.filter(row => !proposedFingerprints.has(row.fingerprint));
    const adoptedServerIds = new Set(finalizedProposals.map(row => row.formativeItemId));
    const foreignServer = server.filter(row => !adoptedServerIds.has(row.formativeItemId));

    return finish(finalizedProposals, unmatchedDesired, issues, {
      validation,
      adapted: desiredResult.adapted,
      desired,
      server,
      foreignServer,
      summary: {
        desired: desired.length,
        proposed: finalizedProposals.length,
        legacyExact: finalizedProposals.filter(row => row.match === 'legacy-exact').length,
        legacyChanged: finalizedProposals.filter(row => row.match === 'legacy-changed').length,
        exactState: finalizedProposals.filter(row => row.match === 'exact-state').length,
        promptChanged: finalizedProposals.filter(row => row.match === 'prompt-changed').length,
        unmatchedDesired: unmatchedDesired.length,
        preservedForeign: foreignServer.length
      }
    });
  }

  function approvalMap(input) {
    const map = new Map();
    for (const approval of input.approvedProposals || []) {
      if (!approval?.fingerprint || !approval?.approvalToken) continue;
      map.set(String(approval.fingerprint), String(approval.approvalToken));
    }
    return map;
  }

  function buildBaseline(input = {}, injected = {}) {
    const baseline = required(injected.baseline || globalThis.CardinalFormativeV2Baseline, 'baseline');
    const analysis = input.analysis;
    if (!analysis?.ok) throw new Error('successful bootstrap analysis required');
    if (!input.targetFormativeId || !input.assessmentFingerprint) throw new Error('targetFormativeId and assessmentFingerprint required');

    const approved = approvalMap(input);
    if (!approved.size) {
      const error = new Error('At least one state-bound reconciliation approval is required.');
      error.code = 'BOOTSTRAP_APPROVAL_REQUIRED';
      throw error;
    }

    const entries = [];
    for (const proposal of analysis.proposals || []) {
      const token = approved.get(String(proposal.fingerprint));
      if (!token) continue;
      if (token !== proposal.approvalToken) {
        const error = new Error(`Proposal ${proposal.fingerprint} changed after it was reviewed.`);
        error.code = 'BOOTSTRAP_APPROVAL_STALE';
        error.fingerprint = proposal.fingerprint;
        throw error;
      }
      if (proposal.safeToAdoptServerAsBaseline !== true && proposal.safeToAdoptDesiredAsBaseline !== true) {
        const error = new Error(`Proposal ${proposal.fingerprint} cannot be safely linked to the current server state.`);
        error.code = 'BOOTSTRAP_PROPOSAL_NOT_LINKABLE';
        throw error;
      }
      entries.push({
        fingerprint: proposal.fingerprint,
        sourceItemId: proposal.sourceItemId || null,
        formativeItemId: proposal.formativeItemId,
        subtype: proposal.subtype,
        managedState: proposal.managedState,
        serverRevision: null
      });
    }

    for (const fingerprint of approved.keys()) {
      if (!(analysis.proposals || []).some(proposal => String(proposal.fingerprint) === fingerprint)) {
        const error = new Error(`Approved proposal ${fingerprint} no longer exists.`);
        error.code = 'BOOTSTRAP_APPROVAL_PROPOSAL_MISSING';
        throw error;
      }
    }

    if (!entries.length) {
      const error = new Error('No approved reconciliation proposal can be safely adopted.');
      error.code = 'BOOTSTRAP_NO_SAFE_APPROVED_PROPOSAL';
      throw error;
    }

    return baseline.createBaseline({
      targetFormativeId: input.targetFormativeId,
      assessmentFingerprint: input.assessmentFingerprint,
      sourceProtocolVersion: '2.0.0',
      packageMode: input.packageMode || null,
      assessmentTitle: input.assessmentTitle || null,
      sourceFingerprints: input.sourceFingerprints || [],
      importerVersion: input.importerVersion || null,
      entries
    });
  }

  function finish(proposals, unmatchedDesired, issues, extra = {}) {
    const blockers = issues.filter(current => current.severity === 'blocker').length;
    const warnings = issues.filter(current => current.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : 'review',
      proposals,
      unmatchedDesired,
      issues,
      blockers,
      warnings,
      ...extra
    };
  }

  const api = { stable, equal, normalizedPrompt, approvalMaterial, approvalToken, analyze, buildBaseline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Bootstrap = api;
})();