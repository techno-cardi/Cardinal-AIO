(() => {
  'use strict';

  const MANAGED_SUBTYPES = new Set([
    'functionalizedText',
    'shortAnswer',
    'longAnswer',
    'fillInTheBlank',
    'multipleChoice',
    'multipleSelection',
    'inlineChoice',
    'resequence',
    'matching'
  ]);

  function hasOwn(obj, key) {
    return Boolean(obj && Object.prototype.hasOwnProperty.call(obj, key));
  }

  function serverId(item) {
    return item?._id || item?.id || item?.formativeItemId || null;
  }

  function push(issues, severity, code, message, item) {
    const out = { severity, code, message };
    const id = serverId(item);
    if (id) out.formativeItemId = String(id);
    issues.push(out);
  }

  function requireOwn(issues, obj, key, code, label, item) {
    if (hasOwn(obj, key)) return true;
    push(issues, 'blocker', code, `${label} absent de la relecture serveur détaillée.`, item);
    return false;
  }

  function checkBlank(blank, index, item, issues, inlineChoice = false) {
    if (!blank || typeof blank !== 'object') {
      push(issues, 'blocker', 'SERVER_READ_BLANK_INVALID', `Blanc ${index + 1} invalide dans la relecture serveur.`, item);
      return;
    }
    requireOwn(issues, blank, 'key', 'SERVER_READ_BLANK_KEY_MISSING', `Clé du blanc ${index + 1}`, item);
    requireOwn(issues, blank, 'correctAnswers', 'SERVER_READ_BLANK_ANSWERS_MISSING', `Réponses du blanc ${index + 1}`, item);
    if (hasOwn(blank, 'correctAnswers') && !Array.isArray(blank.correctAnswers)) {
      push(issues, 'blocker', 'SERVER_READ_BLANK_ANSWERS_INVALID', `Les réponses du blanc ${index + 1} ne sont pas un tableau.`, item);
    }
    if (inlineChoice) {
      requireOwn(issues, blank, 'choiceLabels', 'SERVER_READ_INLINE_LABELS_MISSING', `Options du dropdown ${index + 1}`, item);
      requireOwn(issues, blank, 'choices', 'SERVER_READ_INLINE_KEYS_MISSING', `Clés du dropdown ${index + 1}`, item);
      if (hasOwn(blank, 'choiceLabels') && !Array.isArray(blank.choiceLabels)) {
        push(issues, 'blocker', 'SERVER_READ_INLINE_LABELS_INVALID', `choiceLabels du dropdown ${index + 1} doit être un tableau.`, item);
      }
      if (hasOwn(blank, 'choices') && !Array.isArray(blank.choices)) {
        push(issues, 'blocker', 'SERVER_READ_INLINE_KEYS_INVALID', `choices du dropdown ${index + 1} doit être un tableau.`, item);
      }
      if (Array.isArray(blank.choiceLabels) && Array.isArray(blank.choices) && blank.choiceLabels.length !== blank.choices.length) {
        push(issues, 'blocker', 'SERVER_READ_INLINE_LENGTH_MISMATCH', `choiceLabels et choices du dropdown ${index + 1} doivent avoir la même longueur.`, item);
      }
      if (Array.isArray(blank.correctAnswers)) {
        if (blank.correctAnswers.length !== 1) {
          push(issues, 'blocker', 'SERVER_READ_INLINE_CORRECT_COUNT', `Le dropdown ${index + 1} doit avoir exactement une bonne réponse.`, item);
        } else if (Array.isArray(blank.choices) && !new Set(blank.choices.map(String)).has(String(blank.correctAnswers[0]))) {
          push(issues, 'blocker', 'SERVER_READ_INLINE_CORRECT_KEY_UNKNOWN', `Bonne réponse inconnue dans le dropdown ${index + 1}.`, item);
        }
      }
    }
  }

  function checkItem(item, options = {}) {
    const issues = [];
    if (!item || typeof item !== 'object') {
      return {
        ok: false,
        state: 'blocked',
        issues: [{ severity: 'blocker', code: 'SERVER_READ_ITEM_INVALID', message: 'Item serveur absent ou invalide.' }]
      };
    }

    if (!serverId(item)) {
      push(issues, 'blocker', 'SERVER_READ_ITEM_ID_MISSING', 'ID serveur absent.', item);
    }
    if (!hasOwn(item, 'subtype') || !item.subtype) {
      push(issues, 'blocker', 'SERVER_READ_SUBTYPE_MISSING', 'Subtype serveur absent.', item);
    }

    const subtype = item.subtype;
    if (!MANAGED_SUBTYPES.has(subtype)) {
      if (options.claimed === true) {
        push(issues, 'blocker', 'SERVER_READ_CLAIMED_SUBTYPE_UNSUPPORTED', `Subtype Cardinal non normalisable: ${subtype || 'inconnu'}.`, item);
      } else {
        push(issues, 'warning', 'SERVER_READ_FOREIGN_SUBTYPE_OPAQUE', `Item non géré conservé opaque: ${subtype || 'inconnu'}.`, item);
      }
      return finish(issues);
    }

    requireOwn(issues, item, 'text', 'SERVER_READ_TEXT_MISSING', 'Texte/prompt', item);

    if (subtype === 'functionalizedText') return finish(issues);

    const details = item.details;
    if (!details || typeof details !== 'object') {
      push(issues, 'blocker', 'SERVER_READ_DETAILS_MISSING', 'Détails de question absents de la relecture serveur.', item);
      return finish(issues);
    }

    requireOwn(issues, details, 'points', 'SERVER_READ_POINTS_MISSING', 'Points', item);
    requireOwn(issues, details, 'isRequired', 'SERVER_READ_REQUIRED_MISSING', 'Réglage obligatoire', item);
    requireOwn(issues, details, 'isPartialCredit', 'SERVER_READ_PARTIAL_CREDIT_MISSING', 'Crédit partiel', item);

    if (subtype === 'fillInTheBlank') {
      requireOwn(issues, details, 'blanks', 'SERVER_READ_BLANKS_MISSING', 'Définition des blancs', item);
      if (hasOwn(details, 'blanks')) {
        if (!Array.isArray(details.blanks)) {
          push(issues, 'blocker', 'SERVER_READ_BLANKS_INVALID', 'La définition des blancs n’est pas un tableau.', item);
        } else {
          details.blanks.forEach((blank, index) => checkBlank(blank, index, item, issues));
        }
      }
      return finish(issues);
    }

    if (subtype === 'inlineChoice') {
      requireOwn(issues, details, 'blanks', 'SERVER_READ_BLANKS_MISSING', 'Définition des dropdowns', item);
      if (hasOwn(details, 'blanks')) {
        if (!Array.isArray(details.blanks)) {
          push(issues, 'blocker', 'SERVER_READ_BLANKS_INVALID', 'La définition des dropdowns n’est pas un tableau.', item);
        } else {
          details.blanks.forEach((blank, index) => checkBlank(blank, index, item, issues, true));
        }
      }
      return finish(issues);
    }

    if (subtype === 'multipleChoice' || subtype === 'multipleSelection') {
      requireOwn(issues, details, 'choiceLabels', 'SERVER_READ_CHOICE_LABELS_MISSING', 'Libellés de choix', item);
      requireOwn(issues, details, 'choices', 'SERVER_READ_CHOICE_KEYS_MISSING', 'Clés de choix', item);
      requireOwn(issues, details, 'correctAnswers', 'SERVER_READ_CORRECT_ANSWERS_MISSING', 'Bonnes réponses', item);
      if (hasOwn(details, 'choiceLabels') && !Array.isArray(details.choiceLabels)) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_LABELS_INVALID', 'choiceLabels doit être un tableau.', item);
      }
      if (hasOwn(details, 'choices') && !Array.isArray(details.choices)) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_KEYS_INVALID', 'choices doit être un tableau.', item);
      }
      if (hasOwn(details, 'correctAnswers') && !Array.isArray(details.correctAnswers)) {
        push(issues, 'blocker', 'SERVER_READ_CORRECT_ANSWERS_INVALID', 'correctAnswers doit être un tableau.', item);
      }
      if (Array.isArray(details.choiceLabels) && Array.isArray(details.choices) && details.choiceLabels.length !== details.choices.length) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_LENGTH_MISMATCH', 'choiceLabels et choices doivent avoir la même longueur.', item);
      }
      if (Array.isArray(details.choices) && Array.isArray(details.correctAnswers)) {
        const validKeys = new Set(details.choices.map(String));
        const unknown = details.correctAnswers.find(key => !validKeys.has(String(key)));
        if (unknown !== undefined) {
          push(issues, 'blocker', 'SERVER_READ_CORRECT_KEY_UNKNOWN', `Bonne réponse inconnue dans choices: ${unknown}.`, item);
        }
      }
      if (subtype === 'multipleChoice' && Array.isArray(details.correctAnswers) && details.correctAnswers.length !== 1) {
        push(issues, 'blocker', 'SERVER_READ_MC_CORRECT_COUNT', 'Multiple Choice doit avoir exactement une bonne réponse serveur.', item);
      }
      if (subtype === 'multipleSelection' && details.isPartialCredit === true) {
        requireOwn(issues, details, 'answerChoicePoints', 'SERVER_READ_ANSWER_POINTS_MISSING', 'Pondérations des choix', item);
        if (hasOwn(details, 'answerChoicePoints') && !Array.isArray(details.answerChoicePoints)) {
          push(issues, 'blocker', 'SERVER_READ_ANSWER_POINTS_INVALID', 'answerChoicePoints doit être un tableau.', item);
        }
        if (Array.isArray(details.answerChoicePoints) && Array.isArray(details.choiceLabels) && details.answerChoicePoints.length !== details.choiceLabels.length) {
          push(issues, 'blocker', 'SERVER_READ_ANSWER_POINTS_LENGTH_MISMATCH', 'answerChoicePoints et choiceLabels doivent avoir la même longueur.', item);
        }
      }
      return finish(issues);
    }

    if (subtype === 'resequence' || subtype === 'matching') {
      requireOwn(issues, details, 'choiceLabels', 'SERVER_READ_CHOICE_LABELS_MISSING', 'Libellés', item);
      requireOwn(issues, details, 'choices', 'SERVER_READ_CHOICE_KEYS_MISSING', 'Clés', item);
      requireOwn(issues, details, 'correctAnswers', 'SERVER_READ_CORRECT_ANSWERS_MISSING', 'Ordre/correspondances', item);
      if (subtype === 'matching') requireOwn(issues, details, 'labels', 'SERVER_READ_MATCHING_LABELS_MISSING', 'Libellés de droite', item);

      const choiceLabels = details.choiceLabels;
      const choices = details.choices;
      const answers = details.correctAnswers;
      const labels = details.labels;

      if (hasOwn(details, 'choiceLabels') && !Array.isArray(choiceLabels)) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_LABELS_INVALID', 'choiceLabels doit être un tableau.', item);
      }
      if (hasOwn(details, 'choices') && !Array.isArray(choices)) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_KEYS_INVALID', 'choices doit être un tableau.', item);
      }
      if (hasOwn(details, 'correctAnswers') && !Array.isArray(answers)) {
        push(issues, 'blocker', 'SERVER_READ_CORRECT_ANSWERS_INVALID', 'correctAnswers doit être un tableau.', item);
      }
      if (subtype === 'matching' && hasOwn(details, 'labels') && !Array.isArray(labels)) {
        push(issues, 'blocker', 'SERVER_READ_MATCHING_LABELS_INVALID', 'labels doit être un tableau.', item);
      }

      if (Array.isArray(choiceLabels) && Array.isArray(choices) && choiceLabels.length !== choices.length) {
        push(issues, 'blocker', 'SERVER_READ_CHOICE_LENGTH_MISMATCH', 'choiceLabels et choices doivent avoir la même longueur.', item);
      }
      if (Array.isArray(choices) && Array.isArray(answers)) {
        const valid = new Set(choices.map(String));
        const answerKeys = answers.map(String);
        if (answers.length !== choices.length || new Set(answerKeys).size !== answerKeys.length || answerKeys.some(key => !valid.has(key))) {
          push(issues, 'blocker', 'SERVER_READ_MAPPING_NOT_PERMUTATION', 'correctAnswers doit être une permutation complète des clés choices.', item);
        }
      }
      if (subtype === 'matching' && Array.isArray(labels) && Array.isArray(choices) && labels.length !== choices.length) {
        push(issues, 'blocker', 'SERVER_READ_MATCHING_LENGTH_MISMATCH', 'labels et choices doivent avoir la même longueur.', item);
      }
      return finish(issues);
    }

    requireOwn(issues, details, 'isKeywordGrading', 'SERVER_READ_KEYWORD_MODE_MISSING', 'Mode Keyword', item);
    requireOwn(issues, details, 'isCaseSensitive', 'SERVER_READ_CASE_SENSITIVE_MISSING', 'Sensibilité à la casse', item);

    if (subtype === 'longAnswer') {
      requireOwn(issues, details, 'showWordCount', 'SERVER_READ_WORD_COUNT_MISSING', 'Affichage du nombre de mots', item);
    }

    if (details.isKeywordGrading === true) {
      requireOwn(issues, details, 'correctAnswers', 'SERVER_READ_CORRECT_ANSWERS_MISSING', 'Réponses Keyword', item);
      requireOwn(issues, details, 'answerChoicePoints', 'SERVER_READ_ANSWER_POINTS_MISSING', 'Pondérations Keyword', item);
      if (hasOwn(details, 'correctAnswers') && !Array.isArray(details.correctAnswers)) {
        push(issues, 'blocker', 'SERVER_READ_CORRECT_ANSWERS_INVALID', 'correctAnswers doit être un tableau.', item);
      }
      if (hasOwn(details, 'answerChoicePoints') && !Array.isArray(details.answerChoicePoints)) {
        push(issues, 'blocker', 'SERVER_READ_ANSWER_POINTS_INVALID', 'answerChoicePoints doit être un tableau.', item);
      }
      if (Array.isArray(details.correctAnswers) && Array.isArray(details.answerChoicePoints) && details.correctAnswers.length !== details.answerChoicePoints.length) {
        push(
          issues,
          'blocker',
          'SERVER_READ_KEYWORD_LENGTH_MISMATCH',
          `Le serveur retourne ${details.correctAnswers.length} réponse(s) Keyword pour ${details.answerChoicePoints.length} pondération(s).`,
          item
        );
      }
    }

    return finish(issues);
  }

  function checkSnapshot(items, options = {}) {
    const claimedIds = new Set((options.claimedIds || []).filter(Boolean).map(String));
    const issues = [];
    const rows = [];

    if (!Array.isArray(items)) {
      return {
        ok: false,
        state: 'blocked',
        rows: [],
        issues: [{ severity: 'blocker', code: 'SERVER_READ_SNAPSHOT_ITEMS_INVALID', message: 'La liste serveur détaillée est absente.' }]
      };
    }

    const seen = new Set();
    for (const item of items) {
      const id = serverId(item);
      if (id) {
        const key = String(id);
        if (seen.has(key)) push(issues, 'blocker', 'SERVER_READ_DUPLICATE_ITEM_ID', `ID serveur dupliqué: ${key}.`, item);
        seen.add(key);
      }

      const row = checkItem(item, { claimed: id ? claimedIds.has(String(id)) : false });
      rows.push({ formativeItemId: id ? String(id) : null, state: row.state, issues: row.issues });
      for (const current of row.issues) {
        // Foreign opaque subtypes are intentionally warnings. Incomplete detail
        // for a managed-looking item is unsafe even if it is not yet claimed,
        // because automatic discovery must not compare against omitted fields.
        issues.push(current);
      }
    }

    for (const claimedId of claimedIds) {
      if (!seen.has(claimedId)) {
        issues.push({
          severity: 'blocker',
          code: 'SERVER_READ_CLAIMED_ITEM_MISSING',
          message: `Item Cardinal ${claimedId} absent de la relecture serveur détaillée.`,
          formativeItemId: claimedId
        });
      }
    }

    return finish(issues, { rows });
  }

  function finish(issues, extra = {}) {
    const blockers = issues.filter(issue => issue.severity === 'blocker').length;
    const warnings = issues.filter(issue => issue.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      blockers,
      warnings,
      issues,
      ...extra
    };
  }

  const api = { MANAGED_SUBTYPES, hasOwn, serverId, checkItem, checkSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ServerReadiness = api;
})();