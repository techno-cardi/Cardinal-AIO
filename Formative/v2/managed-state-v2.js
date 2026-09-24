(() => {
  'use strict';

  const SUPPORTED = new Set([
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

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function normalizeText(value) {
    return asString(value)
      .normalize('NFC')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim();
  }

  function parseTiptap(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

  function tiptapSemantic(value) {
    const doc = parseTiptap(value);
    if (!doc) {
      return {
        ok: false,
        text: normalizeText(value),
        template: normalizeText(value),
        blankKeys: []
      };
    }

    const tokens = [];
    const blankKeys = [];
    let blankIndex = 0;

    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      if (typeof node !== 'object') return;

      if (node.type === 'text' && typeof node.text === 'string') {
        tokens.push(node.text);
      } else if (node.type === 'blankItem') {
        blankIndex += 1;
        blankKeys.push(node?.attrs?.id || null);
        tokens.push(`{{blank${blankIndex}}}`);
      } else if (node.type === 'hardBreak') {
        tokens.push(' ');
      }

      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child);
      }

      if (['paragraph', 'heading', 'listItem'].includes(node.type)) {
        tokens.push(' ');
      }
    }

    walk(doc);

    const template = normalizeText(tokens.join(' '));
    const plain = normalizeText(template.replace(/\{\{blank\d+\}\}/g, ' '));

    return {
      ok: true,
      text: plain,
      template,
      blankKeys
    };
  }

  function sortedStrings(values, caseSensitive = false) {
    const seen = new Map();
    for (const raw of values || []) {
      const value = normalizeText(raw);
      if (!value) continue;
      const key = caseSensitive ? value : value.toLocaleLowerCase('fr-CA');
      if (!seen.has(key)) seen.set(key, value);
    }
    return [...seen.values()].sort((a, b) => {
      const ak = caseSensitive ? a : a.toLocaleLowerCase('fr-CA');
      const bk = caseSensitive ? b : b.toLocaleLowerCase('fr-CA');
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  function normalizedMatches(answers, scores, caseSensitive = false) {
    const a = Array.isArray(answers) ? answers : [];
    const s = Array.isArray(scores) ? scores : [];
    const map = new Map();

    for (let i = 0; i < a.length; i++) {
      let text = normalizeText(a[i]);
      if (!text) continue;
      const score = Number.isFinite(Number(s[i])) ? Number(s[i]) : null;

      // Case-insensitive grading treats Chat/chat as one semantic match, but
      // accents remain distinct until Formative accent equivalence is proven.
      const key = caseSensitive ? text : text.toLocaleLowerCase('fr-CA');
      if (!caseSensitive) text = key;

      const previous = map.get(key);
      if (!previous) {
        map.set(key, { text, score });
      } else if (previous.score !== score) {
        // Preserve a score conflict instead of accidentally comparing equal.
        map.set(`${key}#score:${score}`, { text, score });
      }
    }

    const out = [...map.values()];
    out.sort((x, y) => {
      const ax = caseSensitive ? x.text : x.text.toLocaleLowerCase('fr-CA');
      const ay = caseSensitive ? y.text : y.text.toLocaleLowerCase('fr-CA');
      const cmp = ax < ay ? -1 : ax > ay ? 1 : 0;
      if (cmp) return cmp;
      const raw = x.text < y.text ? -1 : x.text > y.text ? 1 : 0;
      return raw || Number(x.score ?? -Infinity) - Number(y.score ?? -Infinity);
    });
    return out;
  }

  function desiredSegmentsSemantic(segments) {
    let blankIndex = 0;
    const template = [];
    const blanks = [];

    for (const segment of segments || []) {
      if (Object.prototype.hasOwnProperty.call(segment || {}, 'text')) {
        template.push(asString(segment.text));
        continue;
      }
      if (segment?.blank) {
        blankIndex += 1;
        template.push(`{{blank${blankIndex}}}`);
        blanks.push({
          index: blankIndex,
          answers: sortedStrings(segment.blank.answers || [], false)
        });
      }
    }

    return {
      template: normalizeText(template.join('')),
      blanks
    };
  }

  function serverBlanksSemantic(text, blanks) {
    const tiptap = tiptapSemantic(text);
    const byKey = new Map((blanks || []).map(blank => [blank?.key, blank]));
    const ordered = [];

    for (let index = 0; index < tiptap.blankKeys.length; index++) {
      const key = tiptap.blankKeys[index];
      const blank = byKey.get(key);
      ordered.push({
        index: index + 1,
        answers: sortedStrings(blank?.correctAnswers || [], false)
      });
    }

    const referenced = new Set(tiptap.blankKeys.filter(Boolean));
    for (const blank of blanks || []) {
      if (blank?.key && referenced.has(blank.key)) continue;
      ordered.push({
        index: ordered.length + 1,
        answers: sortedStrings(blank?.correctAnswers || [], false),
        orphanServerBlank: true
      });
    }

    return {
      template: tiptap.template,
      blanks: ordered,
      parseOk: tiptap.ok
    };
  }

  function desiredChoiceSemantic(item) {
    const weighted = item?.subtype === 'multipleSelection' && item?.grading?.partialCredit !== false;
    return (item?.choices || []).map(choice => {
      const correct = choice?.correct === true;
      return {
        text: normalizeText(choice?.text || ''),
        correct,
        points: weighted && correct && Number.isFinite(Number(choice?.points))
          ? Number(choice.points)
          : null
      };
    });
  }

  function serverChoiceSemantic(subtype, details = {}) {
    const labels = Array.isArray(details.choiceLabels) ? details.choiceLabels : [];
    const keys = Array.isArray(details.choices) ? details.choices.map(String) : [];
    const correct = new Set((details.correctAnswers || []).map(String));
    const scores = Array.isArray(details.answerChoicePoints) ? details.answerChoicePoints : [];
    return labels.map((label, index) => {
      const isCorrect = correct.has(String(keys[index]));
      return {
        text: normalizeText(label),
        correct: isCorrect,
        points: subtype === 'multipleSelection' && details.isPartialCredit === true && isCorrect && Number.isFinite(Number(scores[index]))
          ? Number(scores[index])
          : null
      };
    });
  }

  function desiredResequenceSemantic(item) {
    return (item?.choices || []).map(value => normalizeText(value));
  }

  function serverResequenceSemantic(details = {}) {
    const labels = Array.isArray(details.choiceLabels) ? details.choiceLabels.map(normalizeText) : [];
    const keys = Array.isArray(details.choices) ? details.choices.map(String) : [];
    const order = Array.isArray(details.correctAnswers) ? details.correctAnswers.map(String) : [];
    const byKey = new Map(keys.map((key, index) => [key, labels[index]]));
    return {
      sequence: order.map(key => byKey.get(key) || ''),
      complete: labels.length >= 2 &&
        labels.length === keys.length &&
        order.length === keys.length &&
        new Set(keys).size === keys.length &&
        new Set(order).size === order.length &&
        order.every(key => byKey.has(key))
    };
  }

  function desiredMatchingSemantic(item) {
    return (item?.pairs || []).map(pair => ({
      left: normalizeText(pair?.left || ''),
      right: normalizeText(pair?.right || '')
    }));
  }

  function serverMatchingSemantic(details = {}) {
    const leftLabels = Array.isArray(details.choiceLabels) ? details.choiceLabels.map(normalizeText) : [];
    const keys = Array.isArray(details.choices) ? details.choices.map(String) : [];
    const rightLabels = Array.isArray(details.labels)
      ? details.labels.map(value => tiptapSemantic(value).text)
      : [];
    const answers = Array.isArray(details.correctAnswers) ? details.correctAnswers.map(String) : [];
    const leftByKey = new Map(keys.map((key, index) => [key, leftLabels[index]]));
    const pairs = rightLabels.map((right, index) => ({
      left: leftByKey.get(answers[index]) || '',
      right: normalizeText(right)
    }));
    const complete = pairs.length >= 2 &&
      leftLabels.length === keys.length &&
      rightLabels.length === answers.length &&
      rightLabels.length === keys.length &&
      new Set(keys).size === keys.length &&
      new Set(answers).size === answers.length &&
      answers.every(key => leftByKey.has(key)) &&
      pairs.every(pair => pair.left && pair.right);
    return { pairs, complete };
  }

  function desiredInlineSemantic(segmentsValue) {
    const templateParts = [];
    const blanks = [];
    let index = 0;
    for (const segment of segmentsValue || []) {
      if (Object.prototype.hasOwnProperty.call(segment || {}, 'text')) {
        templateParts.push(normalizeText(segment.text || ''));
      } else if (segment?.newParagraph) {
        templateParts.push(' ');
      } else if (segment?.blank) {
        index += 1;
        templateParts.push(`{{blank${index}}}`);
        blanks.push({
          options: (segment.blank.choices || []).map(normalizeText),
          correct: normalizeText(segment.blank.correct || '')
        });
      }
    }
    return { template: normalizeText(templateParts.join(' ')), blanks };
  }

  function serverInlineSemantic(text, defs) {
    const parsed = tiptapSemantic(text);
    const byKey = new Map((defs || []).map(def => [String(def?.key || ''), def]));
    const blanks = [];
    for (const key of parsed.blankKeys) {
      const def = byKey.get(String(key));
      if (!def) {
        blanks.push({ options: [], correct: '', orphanServerBlank: true });
        continue;
      }
      const labels = Array.isArray(def.choiceLabels) ? def.choiceLabels.map(normalizeText) : [];
      const keys = Array.isArray(def.choices) ? def.choices.map(String) : [];
      const correctSet = new Set((def.correctAnswers || []).map(String));
      const correctIndex = keys.findIndex(keyValue => correctSet.has(String(keyValue)));
      blanks.push({
        options: labels,
        correct: correctIndex >= 0 ? labels[correctIndex] : '',
        orphanServerBlank: correctIndex < 0
      });
    }
    return { template: parsed.template, blanks, parseOk: parsed.ok };
  }

  function managedFromDesiredV1(item) {
    if (!item || typeof item !== 'object') {
      return blocked('MANAGED_DESIRED_INVALID', 'Desired item absent/invalide.');
    }

    if (item.kind === 'text') {
      return ready({
        kind: 'text',
        subtype: 'functionalizedText',
        content: normalizeText(item.content || '')
      });
    }

    if (item.kind !== 'question' || !SUPPORTED.has(item.subtype)) {
      return blocked('MANAGED_SUBTYPE_NOT_SUPPORTED', `Desired subtype non normalisé: ${item.subtype || item.kind || 'unknown'}.`);
    }

    if (item.subtype === 'fillInTheBlank') {
      const fitb = desiredSegmentsSemantic(item.segments || []);
      return ready({
        kind: 'question',
        subtype: 'fillInTheBlank',
        points: numberOrNull(item.points),
        isRequired: item.isRequired !== false,
        template: fitb.template,
        blanks: fitb.blanks,
        partialCredit: item?.grading?.partialCredit !== false
      });
    }

    if (item.subtype === 'inlineChoice') {
      const inline = desiredInlineSemantic(item.segments || []);
      return ready({
        kind: 'question',
        subtype: 'inlineChoice',
        points: numberOrNull(item.points),
        isRequired: item.isRequired !== false,
        template: inline.template,
        blanks: inline.blanks,
        partialCredit: item?.grading?.partialCredit !== false
      });
    }

    if (item.subtype === 'multipleChoice' || item.subtype === 'multipleSelection') {
      return ready({
        kind: 'question',
        subtype: item.subtype,
        points: numberOrNull(item.points),
        isRequired: item.isRequired !== false,
        prompt: normalizeText(item.prompt || ''),
        choices: desiredChoiceSemantic(item),
        partialCredit: item.subtype === 'multipleSelection'
          ? item?.grading?.partialCredit !== false
          : false
      });
    }

    if (item.subtype === 'resequence') {
      return ready({
        kind: 'question',
        subtype: 'resequence',
        points: numberOrNull(item.points),
        isRequired: item.isRequired !== false,
        prompt: normalizeText(item.prompt || ''),
        sequence: desiredResequenceSemantic(item),
        partialCredit: item?.grading?.partialCredit !== false
      });
    }

    if (item.subtype === 'matching') {
      return ready({
        kind: 'question',
        subtype: 'matching',
        points: numberOrNull(item.points),
        isRequired: item.isRequired !== false,
        prompt: normalizeText(item.prompt || ''),
        pairs: desiredMatchingSemantic(item),
        partialCredit: item?.grading?.partialCredit !== false
      });
    }

    const caseSensitive = item?.grading?.caseSensitive === true;
    return ready({
      kind: 'question',
      subtype: item.subtype,
      points: numberOrNull(item.points),
      isRequired: item.isRequired !== false,
      prompt: normalizeText(item.prompt || ''),
      grading: {
        mode: item?.grading?.mode || 'manual',
        isKeywordGrading: item?.grading?.mode === 'keyword-absolute',
        partialCredit: item?.grading?.partialCredit === true,
        caseSensitive,
        matches: normalizedMatches(
          (item?.grading?.matches || []).map(x => x.text),
          (item?.grading?.matches || []).map(x => x.score),
          caseSensitive
        )
      },
      showWordCount: item.subtype === 'longAnswer'
        ? item?.settings?.showWordCount !== false
        : null
    });
  }

  function managedFromServerItem(item) {
    if (!item || typeof item !== 'object') {
      return blocked('MANAGED_SERVER_INVALID', 'Server item absent/invalide.');
    }

    const subtype = item.subtype;
    if (!SUPPORTED.has(subtype)) {
      return blocked('MANAGED_SUBTYPE_NOT_SUPPORTED', `Server subtype non normalisé: ${subtype || 'unknown'}.`);
    }

    const details = item.details || {};

    if (subtype === 'functionalizedText') {
      const text = tiptapSemantic(item.text);
      if (!text.ok) {
        return review(
          { kind: 'text', subtype, content: text.text },
          'SERVER_TIPTAP_PARSE_FALLBACK',
          'Bloc texte serveur non parsable en Tiptap; fallback texte utilisé.'
        );
      }
      return ready({ kind: 'text', subtype, content: text.text });
    }

    if (subtype === 'fillInTheBlank') {
      const fitb = serverBlanksSemantic(item.text, details.blanks || []);
      const state = {
        kind: 'question',
        subtype,
        points: numberOrNull(details.points),
        isRequired: details.isRequired !== false,
        template: fitb.template,
        blanks: fitb.blanks,
        partialCredit: details.isPartialCredit === true
      };
      if (!fitb.parseOk || fitb.blanks.some(x => x.orphanServerBlank)) {
        return review(state, 'SERVER_FITB_PARSE_UNCERTAIN', 'FITB serveur partiellement ambigu; ne pas écrire avant vérification.');
      }
      return ready(state);
    }

    if (subtype === 'inlineChoice') {
      const inline = serverInlineSemantic(item.text, details.blanks || []);
      const state = {
        kind: 'question',
        subtype,
        points: numberOrNull(details.points),
        isRequired: details.isRequired !== false,
        template: inline.template,
        blanks: inline.blanks.map(({ orphanServerBlank, ...blank }) => blank),
        partialCredit: details.isPartialCredit === true
      };
      if (!inline.parseOk || inline.blanks.some(x => x.orphanServerBlank)) {
        return review(state, 'SERVER_INLINE_PARSE_UNCERTAIN', 'Dropdown serveur partiellement ambigu; ne pas écrire avant vérification.');
      }
      return ready(state);
    }

    if (subtype === 'multipleChoice' || subtype === 'multipleSelection') {
      const tiptap = tiptapSemantic(item.text);
      const state = {
        kind: 'question',
        subtype,
        points: numberOrNull(details.points),
        isRequired: details.isRequired !== false,
        prompt: tiptap.text,
        choices: serverChoiceSemantic(subtype, details),
        partialCredit: subtype === 'multipleSelection' ? details.isPartialCredit === true : false
      };
      if (!tiptap.ok || !Array.isArray(details.choiceLabels) || !Array.isArray(details.choices)) {
        return review(state, 'SERVER_CHOICES_PARSE_UNCERTAIN', 'Choix serveur incomplets ou prompt non parsable; ne pas écrire avant vérification.');
      }
      return ready(state);
    }

    if (subtype === 'resequence') {
      const tiptap = tiptapSemantic(item.text);
      const sequence = serverResequenceSemantic(details);
      const state = {
        kind: 'question',
        subtype,
        points: numberOrNull(details.points),
        isRequired: details.isRequired !== false,
        prompt: tiptap.text,
        sequence: sequence.sequence,
        partialCredit: details.isPartialCredit === true
      };
      if (!tiptap.ok || !sequence.complete) {
        return review(state, 'SERVER_RESEQUENCE_PARSE_UNCERTAIN', 'Ordre serveur incomplet ou ambigu; ne pas écrire avant vérification.');
      }
      return ready(state);
    }

    if (subtype === 'matching') {
      const tiptap = tiptapSemantic(item.text);
      const matching = serverMatchingSemantic(details);
      const state = {
        kind: 'question',
        subtype,
        points: numberOrNull(details.points),
        isRequired: details.isRequired !== false,
        prompt: tiptap.text,
        pairs: matching.pairs,
        partialCredit: details.isPartialCredit === true
      };
      if (!tiptap.ok || !matching.complete) {
        return review(state, 'SERVER_MATCHING_PARSE_UNCERTAIN', 'Appariement serveur incomplet ou ambigu; ne pas écrire avant vérification.');
      }
      return ready(state);
    }

    const tiptap = tiptapSemantic(item.text);
    const caseSensitive = details.isCaseSensitive === true;
    const answers = details.isKeywordGrading === true ? (details.correctAnswers || []) : [];
    const scores = details.isKeywordGrading === true ? (details.answerChoicePoints || []) : [];

    const state = {
      kind: 'question',
      subtype,
      points: numberOrNull(details.points),
      isRequired: details.isRequired !== false,
      prompt: tiptap.text,
      grading: {
        mode: details.isKeywordGrading === true ? 'keyword-absolute' : 'manual',
        isKeywordGrading: details.isKeywordGrading === true,
        partialCredit: details.isPartialCredit === true,
        caseSensitive,
        matches: normalizedMatches(answers, scores, caseSensitive)
      },
      showWordCount: subtype === 'longAnswer' ? details.showWordCount === true : null
    };

    const issues = [];
    if (!tiptap.ok) {
      issues.push({ severity: 'warning', code: 'SERVER_TIPTAP_PARSE_FALLBACK', message: 'Prompt serveur non parsable en Tiptap; fallback texte utilisé.' });
    }
    if (details.isKeywordGrading === true && answers.length !== scores.length) {
      issues.push({ severity: 'blocker', code: 'SERVER_KEYWORD_SCORE_LENGTH_MISMATCH', message: `correctAnswers=${answers.length}, answerChoicePoints=${scores.length}.` });
    }

    return finish(state, issues);
  }

  function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function ready(state) {
    return finish(state, []);
  }

  function review(state, code, message) {
    return finish(state, [{ severity: 'warning', code, message }]);
  }

  function blocked(code, message) {
    return finish(null, [{ severity: 'blocker', code, message }]);
  }

  function finish(managedState, issues) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      managedState,
      issues
    };
  }

  const api = {
    SUPPORTED,
    normalizeText,
    parseTiptap,
    tiptapSemantic,
    desiredSegmentsSemantic,
    serverBlanksSemantic,
    managedFromDesiredV1,
    managedFromServerItem
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ManagedState = api;
})();