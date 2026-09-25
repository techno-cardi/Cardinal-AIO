(() => {
  'use strict';

  const V2_SCHEMA = 'cardinal.formative/2';
  const V1_SCHEMA = 'cardinal.formative/1';
  const V2_PROTOCOL = '2.0.0';

  // Mapping intentionally conservative. These are the shapes already exercised
  // end-to-end by the 0.4.1 baseline and the Tchernobyl workflow.
  const PROVEN_V1_ADAPTER_SUBTYPES = new Set([
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
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeTerm(value, caseSensitive = false) {
    let text = asString(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    if (!caseSensitive) text = text.toLowerCase();
    return text;
  }

  // FNV-1a 64-bit is not a security primitive. Here it is used only to create
  // stable local identifiers from already non-secret metadata.
  function fnv1a64(value) {
    const text = asString(value);
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

  function issue(issues, severity, code, message, itemId = null) {
    const obj = { severity, code, message };
    if (itemId) obj.itemId = itemId;
    issues.push(obj);
  }

  function sourceMap(pkg) {
    return new Map((pkg?.sources || []).map(source => [source.id, source]));
  }

  function roleCount(pkg, role) {
    return (pkg?.sources || []).filter(source => source?.role === role).length;
  }

  function sourceIdentityToken(pkg, ref) {
    const map = sourceMap(pkg);
    const source = map.get(ref);
    if (!source) return `missing:${ref || ''}`;

    if (source.semanticFingerprint) {
      return `semantic:${source.semanticFingerprint}`;
    }

    if (source.role === 'questionnaire' && roleCount(pkg, 'questionnaire') === 1) {
      return 'role:questionnaire:single';
    }

    return [
      `role:${source.role || 'unknown'}`,
      `label:${normalizeText(source.label || '')}`,
      `id:${normalizeText(source.id || '')}`
    ].join('|');
  }

  function itemIdentityMaterial(pkg, item) {
    if (item?.kind === 'question') {
      const source = item.source || {};
      const sourceToken = sourceIdentityToken(pkg, source.sourceRef);
      const page = source.page == null ? '' : asString(source.page).trim();
      const printedPage = source.printedPage == null ? '' : asString(source.printedPage).trim();
      const number = source.number == null ? '' : asString(source.number).trim();
      const subNumber = source.subNumber == null ? '' : asString(source.subNumber).trim();

      if (number || subNumber || page || printedPage) {
        return [
          'question-location',
          sourceToken,
          `page:${page}`,
          `printed:${printedPage}`,
          `number:${normalizeText(number)}`,
          `sub:${normalizeText(subNumber)}`
        ].join('|');
      }

      return [
        'question-prompt',
        sourceToken,
        normalizeText(source.promptExact || item.prompt || '')
      ].join('|');
    }

    if (item?.source?.sourceRef) {
      const source = item.source;
      return [
        item?.kind || 'item',
        sourceIdentityToken(pkg, source.sourceRef),
        `page:${source.page == null ? '' : asString(source.page).trim()}`,
        `printed:${source.printedPage == null ? '' : asString(source.printedPage).trim()}`,
        `number:${normalizeText(source.number || '')}`,
        `sub:${normalizeText(source.subNumber || '')}`,
        normalizeText(source.promptExact || item?.content || '')
      ].join('|');
    }

    return [
      item?.kind || 'item',
      normalizeText(item?.content || ''),
      `order:${item?.order ?? ''}`
    ].join('|');
  }

  function stableHash128(value) {
    const text = asString(value);
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  function itemFingerprint(pkg, item) {
    return `cfi-item-${stableHash128(itemIdentityMaterial(pkg, item))}`;
  }

  function targetAssessmentId(targetFormativeId) {
    if (!targetFormativeId) return null;
    return `cfi-v2-target-${stableHash128(`formative:${targetFormativeId}`)}`;
  }

  function expandMechanicalVariants(term, options = {}) {
    const caseSensitive = options.caseSensitive === true;
    const source = asString(term).trim();
    if (!source) return [];

    const values = new Set([source]);
    const apostrophe = source.replace(/[’‘`´]/g, "'");
    values.add(apostrophe);

    const deaccented = apostrophe.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    values.add(deaccented);

    if (/[A-Za-zÀ-ÿ]-[A-Za-zÀ-ÿ]/.test(source)) {
      values.add(source.replace(/-/g, ' '));
      values.add(deaccented.replace(/-/g, ' '));
    }

    if (!caseSensitive) {
      for (const value of [...values]) values.add(value.toLowerCase());
    }

    return [...values].filter(Boolean);
  }

  function flattenConceptMatches(item, issues) {
    const grading = item?.grading || {};
    if (grading.mode === 'manual') return [];

    const caseSensitive = grading.caseSensitive === true;
    const canonicalScore = new Map();
    const output = new Map();

    for (const concept of grading.concepts || []) {
      for (const rawTerm of concept?.terms || []) {
        for (const variant of expandMechanicalVariants(rawTerm, { caseSensitive })) {
          const canonicalKey = normalizeTerm(variant, caseSensitive);
          if (!canonicalKey) continue;

          const previousScore = canonicalScore.get(canonicalKey);
          if (previousScore != null && Number(previousScore) !== Number(concept.score)) {
            issue(
              issues,
              'blocker',
              'ADAPTER_TERM_SCORE_CONFLICT',
              `Le terme « ${variant} » se normalise comme un terme déjà présent avec un autre score.`,
              item.id
            );
            continue;
          }
          canonicalScore.set(canonicalKey, Number(concept.score));

          let outputKey = asString(variant)
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑‒–—−]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
          if (!caseSensitive) outputKey = outputKey.toLowerCase();

          if (!output.has(outputKey)) {
            output.set(outputKey, {
              text: variant,
              score: Number(concept.score),
              enabled: true
            });
          }
        }
      }
    }

    return [...output.values()];
  }

  function parseTemplate(prompt) {
    const source = asString(prompt);
    const parts = [];
    const re = /\{\{\s*([A-Za-z0-9._:-]+)\s*\}\}/g;
    let cursor = 0;
    let match;

    while ((match = re.exec(source))) {
      if (match.index > cursor) {
        parts.push({ type: 'text', value: source.slice(cursor, match.index) });
      }
      parts.push({ type: 'placeholder', id: match[1] });
      cursor = re.lastIndex;
    }

    if (cursor < source.length) {
      parts.push({ type: 'text', value: source.slice(cursor) });
    }

    return parts;
  }

  function fitbSegments(item, issues) {
    const definitions = new Map((item?.response?.blanks || []).map(blank => [blank.id, blank]));
    const parts = parseTemplate(item.prompt);
    const seen = new Set();
    const segments = [];

    for (const part of parts) {
      if (part.type === 'text') {
        if (part.value) segments.push({ text: part.value });
        continue;
      }

      const blank = definitions.get(part.id);
      if (!blank) {
        issue(issues, 'blocker', 'ADAPTER_PLACEHOLDER_MISSING', `Placeholder ${part.id} sans définition.`, item.id);
        continue;
      }

      seen.add(part.id);
      const answers = [];
      const outputSeen = new Set();

      for (const answer of blank.answers || []) {
        for (const variant of expandMechanicalVariants(answer, { caseSensitive: item?.grading?.caseSensitive === true })) {
          let outputKey = asString(variant)
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑‒–—−]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
          if (item?.grading?.caseSensitive !== true) outputKey = outputKey.toLowerCase();
          if (!outputSeen.has(outputKey)) {
            outputSeen.add(outputKey);
            answers.push(variant);
          }
        }
      }

      if (!answers.length) {
        issue(issues, 'blocker', 'ADAPTER_EMPTY_BLANK', `Le blanc ${part.id} n'a aucune réponse après normalisation.`, item.id);
      }

      segments.push({ blank: { answers } });
    }

    for (const id of definitions.keys()) {
      if (!seen.has(id)) {
        issue(issues, 'blocker', 'ADAPTER_ORPHAN_BLANK', `Le blanc ${id} n'apparaît pas dans le prompt.`, item.id);
      }
    }

    return segments;
  }

  function inlineChoiceSegments(item, issues) {
    const definitions = new Map((item?.response?.dropdowns || []).map(dropdown => [dropdown.id, dropdown]));
    const parts = parseTemplate(item.prompt);
    const seen = new Set();
    const segments = [];

    for (const part of parts) {
      if (part.type === 'text') {
        if (part.value) segments.push({ text: part.value });
        continue;
      }
      const dropdown = definitions.get(part.id);
      if (!dropdown) {
        issue(issues, 'blocker', 'ADAPTER_PLACEHOLDER_MISSING', `Dropdown ${part.id} sans définition.`, item.id);
        continue;
      }
      seen.add(part.id);
      const options = (dropdown.options || []).map(asString).filter(Boolean);
      const correct = (dropdown.correct || [])[0];
      if (options.length < 2 || !correct || !options.includes(correct)) {
        issue(issues, 'blocker', 'ADAPTER_INLINE_CHOICE_INVALID', `Dropdown ${part.id} invalide.`, item.id);
      }
      segments.push({ blank: { choices: options, correct: asString(correct) } });
    }
    for (const id of definitions.keys()) {
      if (!seen.has(id)) issue(issues, 'blocker', 'ADAPTER_ORPHAN_BLANK', `Le dropdown ${id} n'apparaît pas dans le prompt.`, item.id);
    }
    return segments;
  }

  function choiceDefinitions(item, issues) {
    const options = Array.isArray(item?.response?.options) ? item.response.options : [];
    const correctCount = options.filter(option => option?.correct === true).length;
    const multi = item.subtype === 'multipleSelection';
    const partial = multi && item?.grading?.partialCredit !== false;

    const defs = options.map(option => {
      const correct = option?.correct === true;
      const explicit = Number.isFinite(Number(option?.points)) ? Number(option.points) : null;
      if (partial && correct && explicit === null) {
        issue(
          issues,
          'blocker',
          'ADAPTER_MULTISELECT_WEIGHTS_REQUIRED',
          'Le crédit partiel en sélection multiple exige une pondération explicite pour chaque bonne réponse.',
          item.id
        );
      }
      return {
        text: asString(option?.text),
        correct,
        ...(partial && correct && explicit !== null ? { points: explicit } : {})
      };
    });

    if (defs.length < 2) issue(issues, 'blocker', 'ADAPTER_CHOICES_INVALID', 'Au moins deux choix sont requis.', item.id);
    if (item.subtype === 'multipleChoice' && correctCount !== 1) {
      issue(issues, 'blocker', 'ADAPTER_CHOICES_INVALID', 'Multiple Choice exige exactement une bonne réponse.', item.id);
    }
    if (multi && correctCount < 1) {
      issue(issues, 'blocker', 'ADAPTER_CHOICES_INVALID', 'Multiple Selection exige au moins une bonne réponse.', item.id);
    }

    if (partial && defs.filter(x => x.correct).every(x => Number.isFinite(Number(x.points)))) {
      const weightTotal = Math.round(
        defs.filter(x => x.correct).reduce((sum, x) => sum + Number(x.points), 0) * 10
      ) / 10;
      const itemTotal = Math.round(Number(item?.points?.value || 0) * 10) / 10;
      if (weightTotal !== itemTotal) {
        issue(
          issues,
          'blocker',
          'ADAPTER_MULTISELECT_WEIGHT_TOTAL',
          `La somme des pondérations (${weightTotal}) doit égaler le total de la question (${itemTotal}).`,
          item.id
        );
      }
    }
    return defs;
  }

  function adaptQuestion(pkg, item, issues) {
    if (item?.points?.bonus === true) {
      issue(issues, 'blocker', 'ADAPTER_BONUS_NOT_PROVEN', 'Le moteur 0.4.1 ne possède pas encore une sémantique bonus v2 prouvée.', item.id);
      return null;
    }

    if (item?.points?.graded === false) {
      issue(issues, 'blocker', 'ADAPTER_UNGRADED_NOT_PROVEN', 'La sémantique graded:false n’est pas encore mappée de façon prouvée vers 0.4.1.', item.id);
      return null;
    }

    if (!PROVEN_V1_ADAPTER_SUBTYPES.has(item.subtype)) {
      issue(
        issues,
        'blocker',
        'ADAPTER_SUBTYPE_NOT_PROVEN',
        `L'adaptateur v2 -> moteur 0.4.1 n'a pas encore une représentation v1 verrouillée pour ${item.subtype}.`,
        item.id
      );
      return null;
    }

    const common = {
      id: itemFingerprint(pkg, item),
      kind: 'question',
      subtype: item.subtype,
      points: Number(item?.points?.value ?? 0),
      isRequired: item?.required !== false
    };

    if (item.subtype === 'fillInTheBlank') {
      if (item?.grading?.mode === 'manual') {
        issue(issues, 'blocker', 'ADAPTER_MANUAL_FITB_NOT_PROVEN', 'Un Fill In The Blank manuel ne doit pas recevoir silencieusement un answer key automatique.', item.id);
        return null;
      }
      return {
        ...common,
        grading: {
          partialCredit: item?.grading?.partialCredit !== false
        },
        segments: fitbSegments(item, issues)
      };
    }

    if (item.subtype === 'inlineChoice') {
      if (item?.grading?.mode === 'manual') {
        issue(issues, 'blocker', 'ADAPTER_MANUAL_INLINE_NOT_PROVEN', 'Un dropdown manuel ne doit pas recevoir silencieusement un corrigé automatique.', item.id);
        return null;
      }
      return {
        ...common,
        grading: { partialCredit: item?.grading?.partialCredit !== false },
        segments: inlineChoiceSegments(item, issues)
      };
    }

    if (item.subtype === 'multipleChoice' || item.subtype === 'multipleSelection') {
      if (item?.grading?.mode === 'manual') {
        issue(issues, 'blocker', 'ADAPTER_MANUAL_CHOICE_NOT_PROVEN', 'Une question à choix sans clé de correction ne peut pas être importée automatiquement.', item.id);
        return null;
      }
      return {
        ...common,
        prompt: asString(item.prompt),
        grading: { partialCredit: item?.grading?.partialCredit !== false },
        choices: choiceDefinitions(item, issues)
      };
    }

    if (item.subtype === 'resequence') {
      const sequence = Array.isArray(item?.response?.sequence)
        ? item.response.sequence.map(asString).filter(Boolean)
        : [];
      if (sequence.length < 2 || new Set(sequence).size !== sequence.length) {
        issue(issues, 'blocker', 'ADAPTER_RESEQUENCE_INVALID', 'Resequence exige au moins deux éléments uniques non vides.', item.id);
      }
      return {
        ...common,
        prompt: asString(item.prompt),
        grading: { partialCredit: item?.grading?.partialCredit !== false },
        choices: sequence
      };
    }

    if (item.subtype === 'matching') {
      const pairs = Array.isArray(item?.response?.pairs)
        ? item.response.pairs.map(pair => ({ left: asString(pair?.left), right: asString(pair?.right) }))
        : [];
      if (pairs.length < 2 || pairs.some(pair => !pair.left.trim() || !pair.right.trim())) {
        issue(issues, 'blocker', 'ADAPTER_MATCHING_INVALID', 'Matching exige au moins deux paires complètes.', item.id);
      }
      const left = pairs.map(pair => normalizeText(pair.left));
      const right = pairs.map(pair => normalizeText(pair.right));
      if (new Set(left).size !== left.length || new Set(right).size !== right.length) {
        issue(issues, 'blocker', 'ADAPTER_MATCHING_AMBIGUOUS', 'Matching contient des libellés dupliqués; la correspondance ne serait pas réversible.', item.id);
      }
      return {
        ...common,
        prompt: asString(item.prompt),
        grading: { partialCredit: item?.grading?.partialCredit !== false },
        pairs
      };
    }

    let matches = flattenConceptMatches(item, issues);
    if (item?.grading?.mode !== 'manual' && !matches.length) {
      issue(issues, 'blocker', 'ADAPTER_EMPTY_GRADING', 'Une question auto/assisted doit produire au moins un match actif avant conversion.', item.id);
      return null;
    }

    if (item?.grading?.mode === 'assisted' && matches.length) {
      const maximum = Number(item?.points?.value);
      const hasMaximumMatch = Number.isFinite(maximum) &&
        matches.some(match => Number(match?.score) === maximum);

      if (Number.isFinite(maximum) && !hasMaximumMatch) {
        const expectedAnswer = asString(item?.grading?.expectedAnswer).replace(/\s+/g, ' ').trim();
        if (!expectedAnswer) {
          issue(
            issues,
            'blocker',
            'ADAPTER_ASSISTED_MAX_ANCHOR_REQUIRED',
            'Une correction assisted sans match de pleine note exige une réponse attendue complète pour préserver le maximum Formative.',
            item.id
          );
        } else {
          const caseSensitive = item?.grading?.caseSensitive === true;
          const expectedKey = normalizeTerm(expectedAnswer, caseSensitive);
          const existing = matches.find(match => normalizeTerm(match?.text, caseSensitive) === expectedKey);
          if (existing && Number(existing.score) !== maximum) {
            issue(
              issues,
              'blocker',
              'ADAPTER_ASSISTED_MAX_ANCHOR_CONFLICT',
              'La réponse attendue complète correspond déjà à un match ayant un score partiel différent.',
              item.id
            );
          } else if (!existing) {
            matches = [
              { text: expectedAnswer, score: maximum, enabled: true },
              ...matches
            ];
          }
        }
      }
    }

    const out = {
      ...common,
      prompt: asString(item.prompt),
      settings: {
        showWordCount: item?.settings?.showWordCount !== false
      }
    };

    if (item?.grading?.mode !== 'manual' && matches.length) {
      out.grading = {
        mode: 'keyword-absolute',
        partialCredit: item?.grading?.partialCredit !== false,
        caseSensitive: item?.grading?.caseSensitive === true,
        matches
      };
    } else {
      out.grading = {
        mode: 'manual',
        partialCredit: false,
        caseSensitive: item?.grading?.caseSensitive === true,
        matches: []
      };
    }

    return out;
  }

  function adaptContentItem(pkg, item) {
    return {
      id: itemFingerprint(pkg, item),
      kind: 'text',
      content: asString(item.content)
    };
  }

  function adaptPackageV2ToV1(pkg, options = {}) {
    const issues = [];

    if (!pkg || pkg.schema !== V2_SCHEMA || pkg.protocolVersion !== V2_PROTOCOL) {
      issue(issues, 'blocker', 'ADAPTER_WRONG_PROTOCOL', 'Le paquet n’est pas un cardinal.formative/2 protocolVersion 2.0.0.');
      return finish(null, issues);
    }

    if (!['full', 'patch'].includes(pkg.packageMode)) {
      issue(issues, 'blocker', 'ADAPTER_PACKAGE_MODE', 'packageMode doit être full ou patch.');
      return finish(null, issues);
    }

    const assessmentId = targetAssessmentId(options.targetFormativeId);
    if (!assessmentId) {
      issue(
        issues,
        'blocker',
        'ADAPTER_TARGET_REQUIRED',
        'Un targetFormativeId explicite est requis avant de convertir un paquet v2 pour mutation.'
      );
      return finish(null, issues);
    }

    const questionnaireSources = (pkg.sources || []).filter(source => source?.role === 'questionnaire');
    if (questionnaireSources.length > 1 && questionnaireSources.some(source => !source.semanticFingerprint)) {
      issue(
        issues,
        'warning',
        'ADAPTER_SOURCE_IDENTITY_WEAK',
        'Plusieurs sources questionnaire sont présentes sans semanticFingerprint Cardinal; la portabilité inter-chat de certains itemFingerprint est moins forte.'
      );
    }

    const ordered = [...(pkg.items || [])].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const items = [];
    const identity = [];

    for (const item of ordered) {
      let adapted = null;

      if (item?.kind === 'section' || item?.kind === 'instruction') {
        adapted = adaptContentItem(pkg, item);
      } else if (item?.kind === 'question') {
        adapted = adaptQuestion(pkg, item, issues);
      } else if (item?.kind === 'passageGroup') {
        issue(
          issues,
          'blocker',
          'ADAPTER_PASSAGE_NOT_PROVEN',
          'Le passageGroup v2 doit être branché sur le parent/enfants 0.4.1 après vérification exacte de la représentation v1.',
          item.id
        );
      } else {
        issue(issues, 'blocker', 'ADAPTER_ITEM_KIND', `kind non pris en charge: ${asString(item?.kind)}.`, item?.id);
      }

      if (adapted) {
        items.push(adapted);
        identity.push({
          sourceItemId: item.id,
          adaptedItemId: adapted.id,
          fingerprint: adapted.id,
          kind: item.kind,
          subtype: item.subtype || null,
          source: item.source || null
        });
      }
    }

    if (issues.some(x => x.severity === 'blocker')) {
      return finish(null, issues, { identity });
    }

    const packageV1 = {
      schema: V1_SCHEMA,
      assessment: {
        id: assessmentId,
        title: asString(pkg?.assessment?.title),
        language: asString(pkg?.assessment?.language || 'fr-CA'),
        sourceMode: asString(pkg?.assessment?.sourceMode || 'external-reference-only')
      },
      items
    };

    return finish(packageV1, issues, {
      identity,
      packageMode: pkg.packageMode,
      targetFormativeId: options.targetFormativeId,
      sourceAssessmentTitle: pkg?.assessment?.title || '',
      v2Metadata: {
        protocolVersion: pkg.protocolVersion,
        packageMode: pkg.packageMode,
        declaredTotalPoints: pkg?.assessment?.declaredTotalPoints ?? null
      }
    });
  }

  function finish(packageV1, issues, extra = {}) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    return {
      ok: blockers === 0,
      state: blockers ? 'blocked' : warnings ? 'review' : 'ready',
      packageV1,
      issues,
      ...extra
    };
  }

  const api = {
    V2_SCHEMA,
    V1_SCHEMA,
    V2_PROTOCOL,
    PROVEN_V1_ADAPTER_SUBTYPES,
    normalizeText,
    normalizeTerm,
    expandMechanicalVariants,
    itemIdentityMaterial,
    stableHash128,
    itemFingerprint,
    targetAssessmentId,
    adaptPackageV2ToV1
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalThis.CardinalFormativeV2Adapter = api;
})();