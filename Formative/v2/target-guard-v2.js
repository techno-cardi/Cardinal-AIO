(() => {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizeTitle(value) {
    return text(value).normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase('fr-CA');
  }

  function issue(issues, severity, code, message, details = null) {
    const out = { severity, code, message };
    if (details && typeof details === 'object') out.details = details;
    issues.push(out);
  }

  function uniqueNonEmpty(values) {
    return [...new Set((values || []).map(text).filter(Boolean))];
  }

  /**
   * Evaluate whether an observed Formative editor is the exact target Cardinal
   * is allowed to mutate. The Formative assessment id is authoritative; title
   * is informational only because teachers can rename an assessment.
   *
   * observation supports:
   * - targetFormativeId: id resolved by the page/gateway
   * - urlTargetFormativeId: id parsed from the active Formative URL
   * - serverTargetFormativeId: id returned by a fresh server read
   * - tabId: Chrome tab id used for this operation
   * - title: current assessment title
   * - canEdit: true only when edit permission has been positively established
   * - authState: authenticated | expired | unauthenticated | unknown
   * - pageKind: editor | assessment | other
   * - observedAt: epoch ms for the fresh observation
   * - candidateTargetIds: optional ids from other eligible Formative tabs
   */
  function evaluateTarget(observation = {}, expected = {}, options = {}) {
    const issues = [];
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 15000;
    const requireFresh = options.requireFresh !== false;

    const expectedId = text(expected.targetFormativeId);
    if (!expectedId) {
      issue(issues, 'blocker', 'TARGET_EXPECTED_ID_MISSING', 'Aucune cible Formative explicite n’est liée à cette opération.');
      return finish(issues, observation, expected);
    }

    const observedIds = uniqueNonEmpty([
      observation.targetFormativeId,
      observation.urlTargetFormativeId,
      observation.serverTargetFormativeId
    ]);

    if (!observedIds.length) {
      issue(issues, 'blocker', 'TARGET_ID_NOT_OBSERVED', 'Cardinal ne peut pas confirmer l’identifiant du Formative ouvert.');
    } else {
      for (const id of observedIds) {
        if (id !== expectedId) {
          issue(issues, 'blocker', 'TARGET_ID_MISMATCH', 'Le Formative observé n’est pas la cible préparée pour cet import.', { expectedId, observedId: id });
        }
      }
      if (observedIds.length > 1) {
        issue(issues, 'blocker', 'TARGET_ID_INCONSISTENT', 'L’URL, la page et le serveur ne s’entendent pas sur la cible Formative.', { observedIds });
      }
    }

    if (expected.tabId != null && observation.tabId != null && Number(expected.tabId) !== Number(observation.tabId)) {
      issue(issues, 'blocker', 'TARGET_TAB_CHANGED', 'L’onglet Formative actif n’est plus celui qui a été préparé pour l’import.');
    }

    const candidates = uniqueNonEmpty(observation.candidateTargetIds || []);
    const foreignCandidates = candidates.filter(id => id !== expectedId);
    if (observation.ambiguousTabSelection === true || foreignCandidates.length > 0 && !observation.explicitTabBinding) {
      issue(issues, 'blocker', 'TARGET_TAB_AMBIGUOUS', 'Plusieurs Formative sont ouverts et Cardinal ne peut pas choisir la bonne cible sans liaison explicite.', { candidates });
    }

    if (!['editor', 'assessment'].includes(observation.pageKind)) {
      issue(issues, 'blocker', 'TARGET_NOT_EDITOR', 'La page Formative active n’est pas un éditeur d’évaluation reconnu.');
    }

    if (observation.authState === 'expired' || observation.authState === 'unauthenticated') {
      issue(issues, 'blocker', 'SESSION_REAUTH_REQUIRED', 'La session Formative doit être reconnectée avant l’import.');
    } else if (observation.authState !== 'authenticated') {
      issue(issues, 'blocker', 'SESSION_NOT_PROVEN', 'Cardinal ne peut pas confirmer une session Formative authentifiée.');
    }

    if (observation.canEdit !== true) {
      issue(
        issues,
        'blocker',
        observation.canEdit === false ? 'TARGET_READ_ONLY' : 'TARGET_EDIT_PERMISSION_NOT_PROVEN',
        observation.canEdit === false
          ? 'Cette évaluation Formative est en lecture seule pour la session actuelle.'
          : 'Cardinal ne peut pas confirmer le droit de modifier cette évaluation.'
      );
    }

    if (requireFresh) {
      if (!Number.isFinite(observation.observedAt)) {
        issue(issues, 'blocker', 'TARGET_OBSERVATION_TIMESTAMP_MISSING', 'La vérification de cible n’est pas datée; une lecture fraîche est requise.');
      } else {
        const age = Math.max(0, now - observation.observedAt);
        if (age > maxAgeMs) {
          issue(issues, 'blocker', 'TARGET_OBSERVATION_STALE', 'La vérification de cible est trop ancienne; Cardinal doit relire Formative avant d’écrire.', { ageMs: age, maxAgeMs });
        }
      }
    }

    const expectedTitle = normalizeTitle(expected.title);
    const actualTitle = normalizeTitle(observation.title);
    if (expectedTitle && actualTitle && expectedTitle !== actualTitle) {
      issue(issues, 'warning', 'TARGET_TITLE_CHANGED', 'Le titre du Formative a changé depuis la préparation. L’identifiant reste la référence.', {
        expectedTitle: text(expected.title),
        actualTitle: text(observation.title)
      });
    }

    return finish(issues, observation, expected);
  }

  function finish(issues, observation, expected) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      issues,
      blockers,
      warnings,
      targetFormativeId: text(expected?.targetFormativeId) || null,
      tabId: observation?.tabId ?? null
    };
  }

  const api = { normalizeTitle, evaluateTarget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2TargetGuard = api;
})();