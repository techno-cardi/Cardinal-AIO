(() => {
  'use strict';

  const QUESTION_SUBTYPES = new Set(['shortAnswer', 'longAnswer', 'fillInTheBlank']);
  const TEXT_KIND = 'text';
  const KEYWORD_MODE = 'keyword-absolute';
  const MANUAL_MODE = 'manual';

  function makeError(message, code, field = null) {
    const error = new Error(message);
    error.code = code;
    error.field = field;
    error.mutationMayHaveCommitted = false;
    return error;
  }

  function stringValue(value) {
    return value == null ? '' : String(value).trim();
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hasAtMostOneDecimal(value) {
    const number = finiteNumber(value);
    if (number === null) return false;
    return Math.abs(number * 10 - Math.round(number * 10)) < 1e-9;
  }

  function normalizeTerm(value, caseSensitive) {
    let term = stringValue(value)
      .normalize('NFC')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s+/g, ' ');
    if (!caseSensitive) term = term.toLocaleLowerCase('fr-CA');
    return term;
  }

  function validatePoints(item) {
    const points = finiteNumber(item?.points);
    if (points === null || points < 0) {
      throw makeError('Le nombre de points doit être un nombre positif ou nul.', 'MUTATION_POINTS_INVALID', 'points');
    }
    if (!hasAtMostOneDecimal(points)) {
      throw makeError('Le nombre de points doit avoir au maximum une décimale.', 'MUTATION_POINTS_PRECISION', 'points');
    }
    return points;
  }

  function validateKeywordGrading(item, points) {
    const grading = item?.grading || {};
    const mode = grading.mode || MANUAL_MODE;
    if (![MANUAL_MODE, KEYWORD_MODE].includes(mode)) {
      throw makeError(`Mode de correction non pris en charge: ${mode}.`, 'MUTATION_GRADING_MODE_UNSUPPORTED', 'grading.mode');
    }

    const matches = Array.isArray(grading.matches) ? grading.matches : [];
    const enabled = matches.filter(match => match?.enabled !== false);

    if (mode === MANUAL_MODE) {
      if (enabled.length) {
        throw makeError(
          'Une question manuelle contient encore des réponses automatiques actives. Cardinal refuse une intention ambiguë.',
          'MUTATION_MANUAL_WITH_ACTIVE_MATCHES',
          'grading.matches'
        );
      }
      return;
    }

    if (!enabled.length) {
      throw makeError('Une correction par mots-clés doit contenir au moins une réponse active.', 'MUTATION_KEYWORD_EMPTY', 'grading.matches');
    }

    const caseSensitive = grading.caseSensitive === true;
    const seen = new Map();
    enabled.forEach((match, index) => {
      const text = stringValue(match?.text);
      if (!text) {
        throw makeError(`Mot-clé ${index + 1}: texte vide.`, 'MUTATION_KEYWORD_TEXT_EMPTY', `grading.matches[${index}].text`);
      }
      const score = finiteNumber(match?.score);
      if (score === null || score < 0 || score > points) {
        throw makeError(
          `Mot-clé « ${text} »: le pointage doit être compris entre 0 et ${points}.`,
          'MUTATION_KEYWORD_SCORE_RANGE',
          `grading.matches[${index}].score`
        );
      }
      if (!hasAtMostOneDecimal(score)) {
        throw makeError(
          `Mot-clé « ${text} »: le pointage doit avoir au maximum une décimale.`,
          'MUTATION_KEYWORD_SCORE_PRECISION',
          `grading.matches[${index}].score`
        );
      }
      const key = normalizeTerm(text, caseSensitive);
      if (seen.has(key) && seen.get(key) !== score) {
        throw makeError(
          `Le mot-clé « ${text} » existe avec deux pointages différents.`,
          'MUTATION_KEYWORD_SCORE_CONFLICT',
          'grading.matches'
        );
      }
      seen.set(key, score);
    });
  }

  function validateFitb(item, points) {
    if (item?.grading?.mode === MANUAL_MODE) {
      throw makeError('Un Fill In The Blank manuel n’est pas pris en charge par le pont 0.4.1.', 'MUTATION_MANUAL_FITB_UNSUPPORTED', 'grading.mode');
    }

    const segments = Array.isArray(item?.segments) ? item.segments : [];
    const blanks = segments.filter(segment => segment?.blank);
    if (!blanks.length) {
      throw makeError('Le Fill In The Blank ne contient aucun blanc.', 'MUTATION_FITB_EMPTY', 'segments');
    }

    blanks.forEach((segment, blankIndex) => {
      const answers = Array.isArray(segment?.blank?.answers)
        ? segment.blank.answers.map(stringValue).filter(Boolean)
        : [];
      if (!answers.length) {
        throw makeError(
          `Le blanc ${blankIndex + 1} ne contient aucune réponse acceptée.`,
          'MUTATION_FITB_ANSWERS_EMPTY',
          `segments.blank[${blankIndex}].answers`
        );
      }
      const normalized = answers.map(answer => normalizeTerm(answer, false));
      if (new Set(normalized).size !== normalized.length) {
        throw makeError(
          `Le blanc ${blankIndex + 1} contient des réponses acceptées en double.`,
          'MUTATION_FITB_DUPLICATE_ANSWERS',
          `segments.blank[${blankIndex}].answers`
        );
      }
    });

    if (item?.grading?.partialCreditMode && item.grading.partialCreditMode !== 'standard') {
      throw makeError(
        `Mode de crédit partiel FITB non prouvé: ${item.grading.partialCreditMode}.`,
        'MUTATION_FITB_PARTIAL_MODE_UNPROVEN',
        'grading.partialCreditMode'
      );
    }

    return points;
  }

  function validateLegacyItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw makeError('Élément Formative absent ou invalide.', 'MUTATION_ITEM_INVALID');
    }

    if (item.kind === TEXT_KIND) {
      if (!stringValue(item.content)) {
        throw makeError('Un bloc texte vide ne sera pas créé dans Formative.', 'MUTATION_TEXT_EMPTY', 'content');
      }
      return { ok: true, kind: TEXT_KIND, subtype: 'functionalizedText' };
    }

    if (item.kind !== 'question' || !QUESTION_SUBTYPES.has(item.subtype)) {
      throw makeError(
        `Type de question non autorisé par les primitives prouvées: ${item?.subtype || item?.kind || 'inconnu'}.`,
        'MUTATION_SUBTYPE_UNSUPPORTED',
        'subtype'
      );
    }

    const points = validatePoints(item);

    if (item.subtype === 'fillInTheBlank') {
      validateFitb(item, points);
    } else {
      if (!stringValue(item.prompt)) {
        throw makeError('La question ne contient aucun énoncé.', 'MUTATION_PROMPT_EMPTY', 'prompt');
      }
      validateKeywordGrading(item, points);
    }

    return { ok: true, kind: 'question', subtype: item.subtype, points };
  }

  function createGuardedPrimitives(raw) {
    if (!raw || typeof raw.createItem !== 'function' || typeof raw.updateItem !== 'function') {
      throw new Error('legacy primitives createItem/updateItem required');
    }

    return {
      ...raw,
      async createItem(input = {}) {
        validateLegacyItem(input.item);
        return raw.createItem(input);
      },
      async updateItem(input = {}) {
        validateLegacyItem(input.item);
        return raw.updateItem(input);
      }
    };
  }

  const api = {
    QUESTION_SUBTYPES,
    MANUAL_MODE,
    KEYWORD_MODE,
    finiteNumber,
    hasAtMostOneDecimal,
    normalizeTerm,
    validateLegacyItem,
    createGuardedPrimitives
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2MutationInputGuard = api;
})();
