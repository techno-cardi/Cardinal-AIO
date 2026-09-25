(() => {
  'use strict';

  const SCHEMA = 'cardinal.formative/2';
  const PROTOCOL_VERSION = '2.0.0';

  const DEFAULT_CAPABILITIES = new Set([
    'shortAnswer',
    'longAnswer',
    'multipleChoice',
    'multipleSelection',
    'fillInTheBlank',
    'inlineChoice',
    'resequence',
    'matching'
  ]);

  const GENERIC_TERMS = new Set([
    'faire', 'voir', 'aller', 'chose', 'important', 'importance',
    'probleme', 'problème', 'texte', 'auteur', 'question', 'reponse',
    'réponse', 'expliquer', 'explication', 'element', 'élément'
  ]);

  const MULTIPART_REQUIREMENTS = new Set([
    'distinctConcepts',
    'explainEach',
    'compareSources',
    'argumentAndEvidence',
    'chooseNofM',
    'relation'
  ]);

  const SOURCE_ROLES = new Set(['questionnaire', 'text', 'answerKey', 'rubric', 'appendix', 'unknown']);
  const SOURCE_STATUSES = new Set(['provided', 'missing', 'external']);
  const POINT_PROVENANCE = new Set(['provided', 'proposed', 'derived']);
  const GRADING_PROVENANCE = new Set([
    'providedAnswerKey',
    'sourceExplicit',
    'sourceInferred',
    'questionIntrinsic',
    'teacherApproved',
    'sourceMissing'
  ]);
  const TRANSFORMATION_CODES = new Set([
    'removeSourceNumber',
    'normalizeTypography',
    'splitQuestion',
    'mergeQuestion',
    'changeResponseType',
    'other'
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
      .replace(/\s*-\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!caseSensitive) text = text.toLowerCase();
    return text;
  }

  function oneDecimal(value) {
    return Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
  }

  function stripSourceNumber(value) {
    return asString(value)
      .replace(/^\s*(?:q(?:uestion)?\s*)?\d+[A-Za-z]?\s*[.)\-:]\s*/i, '')
      .trim();
  }

  function uniquePush(array, value) {
    const key = [value.severity, value.code, value.itemId || '', value.sourceRef || '', value.message].join('|');
    if (!array.some(x => [x.severity, x.code, x.itemId || '', x.sourceRef || '', x.message].join('|') === key)) {
      array.push(value);
    }
  }

  function issue(issues, severity, code, message, itemId, sourceRef) {
    const out = { severity, code, message };
    if (itemId) out.itemId = itemId;
    if (sourceRef) out.sourceRef = sourceRef;
    uniquePush(issues, out);
  }

  function ingestDeclaredIssue(raw, issues, fallbackItemId = null) {
    const valid =
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      ['warning', 'blocker'].includes(raw.severity) &&
      typeof raw.code === 'string' &&
      /^[A-Z0-9_:-]{2,}$/.test(raw.code) &&
      typeof raw.message === 'string' &&
      raw.message.trim();

    if (!valid) {
      issue(
        issues,
        'blocker',
        'DECLARED_ISSUE_INVALID',
        'Une issue déclarée dans le paquet est invalide. Cardinal ne peut pas deviner son intention.',
        fallbackItemId || null
      );
      return;
    }

    issue(
      issues,
      raw.severity,
      raw.code,
      raw.message.trim(),
      raw.itemId || fallbackItemId || null,
      raw.sourceRef || null
    );
  }

  function ingestDeclaredIssues(pkg, issues) {
    if (!Array.isArray(pkg?.issues)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'issues doit être un tableau.');
    } else {
      for (const current of pkg.issues) ingestDeclaredIssue(current, issues);
    }

    for (const item of pkg?.items || []) {
      if (item?.kind === 'question' && !Array.isArray(item?.issues)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Chaque question doit contenir un tableau issues.', item?.id || '(sans id)');
        continue;
      }
      if (!Array.isArray(item?.issues)) continue;
      for (const current of item.issues) ingestDeclaredIssue(current, issues, item?.id || null);
    }
  }

  function refsFromQuestion(item) {
    const refs = new Set();
    if (item?.source?.sourceRef) refs.add(item.source.sourceRef);
    for (const ref of item?.sourceRefs || []) refs.add(ref);
    for (const ref of item?.grading?.provenance?.sourceRefs || []) refs.add(ref);
    return [...refs];
  }

  function placeholderIds(prompt) {
    const ids = [];
    const re = /\{\{\s*([A-Za-z0-9._:-]+)\s*\}\}/g;
    let match;
    while ((match = re.exec(asString(prompt)))) ids.push(match[1]);
    return ids;
  }

  function countActiveTerms(item) {
    let count = 0;
    for (const concept of item?.grading?.concepts || []) {
      count += Array.isArray(concept?.terms) ? concept.terms.length : 0;
    }
    return count;
  }

  function validatePackageV2(pkg, options = {}) {
    const issues = [];
    const capabilities = new Set(options.capabilities || [...DEFAULT_CAPABILITIES]);

    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Le paquet doit être un objet JSON.');
      return finish(pkg, issues);
    }

    if (pkg.schema !== SCHEMA) {
      issue(issues, 'blocker', 'BLOCKED_SCHEMA', `Schéma attendu: ${SCHEMA}.`);
    }

    if (pkg.protocolVersion !== PROTOCOL_VERSION) {
      issue(issues, 'blocker', 'BLOCKED_PROTOCOL_VERSION', `Version attendue: ${PROTOCOL_VERSION}.`);
    }

    if (!['full', 'patch'].includes(pkg.packageMode)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'packageMode doit être full ou patch.');
    }

    if (!pkg.assessment || typeof pkg.assessment !== 'object') {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'assessment est obligatoire.');
    } else {
      if (!asString(pkg.assessment.title).trim()) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'assessment.title est obligatoire.');
      }
      if (!asString(pkg.assessment.language).trim()) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'assessment.language est obligatoire.');
      }
      if (!['external-reference-only', 'embedded'].includes(pkg.assessment.sourceMode)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'assessment.sourceMode doit être external-reference-only ou embedded.');
      }
      if (pkg.assessment.declaredTotalPoints != null) {
        const declared = pkg.assessment.declaredTotalPoints;
        if (!declared || typeof declared !== 'object' || Array.isArray(declared) ||
            !Number.isFinite(declared.value) || declared.value < 0 || !oneDecimal(declared.value) ||
            !POINT_PROVENANCE.has(declared.provenance)) {
          issue(
            issues,
            'blocker',
            'DECLARED_TOTAL_INVALID',
            'assessment.declaredTotalPoints doit être {value, provenance} avec une valeur >= 0 et une provenance provided/proposed/derived.'
          );
        }
      }
    }

    const sourceList = Array.isArray(pkg.sources) ? pkg.sources : [];
    if (!Array.isArray(pkg.sources)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'sources doit être un tableau.');
    }

    if (!Array.isArray(pkg.items)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'items doit être un tableau.');
      return finish(pkg, issues);
    }

    // ChatGPT is the pedagogical authority for the package. Its explicit
    // warnings/blockers are part of the contract and must never be discarded
    // by Cardinal. Cardinal only adds technical consistency/safety findings.
    ingestDeclaredIssues(pkg, issues);

    const sourceMap = new Map();
    for (const source of sourceList) {
      if (!source?.id) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Chaque source doit avoir un id.');
        continue;
      }
      if (!SOURCE_ROLES.has(source.role)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', `Source ${source.id}: role invalide.`, null, source.id);
      }
      if (!SOURCE_STATUSES.has(source.status)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', `Source ${source.id}: status invalide.`, null, source.id);
      }
      if (!asString(source.label).trim()) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', `Source ${source.id}: label obligatoire.`, null, source.id);
      }
      if (sourceMap.has(source.id)) {
        issue(issues, 'blocker', 'DUPLICATE_SOURCE_ID', `Source dupliquée: ${source.id}.`, null, source.id);
      } else {
        sourceMap.set(source.id, source);
      }
    }

    const itemIds = new Set();
    const orders = new Map();
    let total = 0;
    let gradedCount = 0;

    for (const item of pkg.items) {
      const itemId = item?.id || '(sans id)';

      if (!item?.id) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Chaque item doit avoir un id.');
      } else if (itemIds.has(item.id)) {
        issue(issues, 'blocker', 'DUPLICATE_ITEM_ID', `ID d'item dupliqué: ${item.id}.`, item.id);
      } else {
        itemIds.add(item.id);
      }

      if (!Number.isInteger(item?.order) || item.order < 1) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'order doit être un entier >= 1.', itemId);
      } else if (pkg.packageMode === 'full') {
        if (orders.has(item.order)) {
          issue(issues, 'blocker', 'DUPLICATE_ORDER', `Ordre ${item.order} utilisé par ${orders.get(item.order)} et ${itemId}.`, itemId);
        } else {
          orders.set(item.order, itemId);
        }
      }

      if (!['section', 'instruction', 'question', 'passageGroup'].includes(item?.kind)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', `kind invalide: ${asString(item?.kind)}.`, itemId);
        continue;
      }

      if ((item.kind === 'section' || item.kind === 'instruction') && !asString(item.content).trim()) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', `${item.kind} exige un contenu non vide.`, itemId);
      }

      if (item.kind === 'passageGroup') {
        if (item.embed !== true) {
          issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'passageGroup exige embed=true.', itemId);
        }
        for (const ref of item.sourceRefs || []) {
          if (!sourceMap.has(ref)) {
            issue(issues, 'blocker', 'UNKNOWN_SOURCE_REF', `Source inconnue: ${ref}.`, itemId, ref);
          }
        }
        continue;
      }

      if (item.kind !== 'question') continue;

      validateQuestion(item, sourceMap, capabilities, issues);

      const points = item?.points;
      if (points?.graded !== false && Number.isFinite(points?.value)) {
        total += points.value;
        gradedCount++;
      }
    }

    for (const item of pkg.items) {
      if (item?.kind !== 'passageGroup') continue;
      for (const qid of item.questionIds || []) {
        if (!itemIds.has(qid)) {
          issue(issues, 'blocker', 'INVALID_ITEM_REFERENCE', `Passage ${item.id}: questionId inconnu ${qid}.`, item.id);
        }
      }
    }

    const declared = pkg?.assessment?.declaredTotalPoints;
    if (pkg.packageMode === 'full' && declared && Number.isFinite(declared.value)) {
      const roundedTotal = Math.round(total * 10) / 10;
      if (Math.abs(roundedTotal - declared.value) > 1e-9) {
        const authoritative = declared.provenance === 'provided';
        issue(
          issues,
          authoritative ? 'blocker' : 'warning',
          'TOTAL_POINTS_MISMATCH',
          authoritative
            ? `Total officiel déclaré ${declared.value}, total calculé ${roundedTotal}.`
            : `Total ${declared.provenance || 'non officiel'} déclaré ${declared.value}, total calculé ${roundedTotal}; Cardinal conserve les points des questions et signale l'écart.`
        );
      }
    }

    return finish(pkg, issues, { total: Math.round(total * 10) / 10, gradedCount });
  }

  function validateQuestion(item, sourceMap, capabilities, issues) {
    const id = item.id || '(sans id)';

    if (!item.source || typeof item.source !== 'object' || !item.source.sourceRef || !item.source.promptExact) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'source.sourceRef et source.promptExact sont obligatoires.', id);
    }

    for (const ref of refsFromQuestion(item)) {
      if (!sourceMap.has(ref)) {
        issue(issues, 'blocker', 'UNKNOWN_SOURCE_REF', `Source inconnue: ${ref}.`, id, ref);
      }
    }

    if (!asString(item.prompt).trim()) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Prompt vide.', id);
    }

    if (typeof item.required !== 'boolean') {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'required doit être un booléen explicite; Cardinal ne choisit pas à la place de ChatGPT.', id);
    }

    if (!Array.isArray(item.transformations)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'transformations doit être un tableau explicite.', id);
    }

    if (/^\s*(?:q(?:uestion)?\s*)?\d+[A-Za-z]?\s*[.)\-:]/i.test(asString(item.prompt))) {
      issue(issues, 'warning', 'SOURCE_NUMBER_IN_PROMPT', 'Le prompt Formative semble encore contenir la numérotation source.', id);
    }

    const exactBase = normalizeText(stripSourceNumber(item?.source?.promptExact));
    const promptBase = normalizeText(item.prompt);
    if (exactBase && promptBase && exactBase !== promptBase) {
      const declaredMeaningful = (item.transformations || []).some(t => t?.code && !['removeSourceNumber', 'normalizeTypography'].includes(t.code));
      if (!declaredMeaningful) {
        issue(issues, 'warning', 'SOURCE_PROMPT_DRIFT', 'Le prompt diffère de la source au-delà du retrait de numérotation/typographie.', id);
      }
    }

    for (const transformation of item.transformations || []) {
      if (transformation?.requiresReview === true) {
        issue(issues, 'warning', 'TRANSFORMATION_REVIEW_REQUIRED', transformation.description || `Transformation ${transformation.code} à vérifier.`, id);
      }
    }

    if (!capabilities.has(item.subtype)) {
      issue(issues, 'blocker', 'BLOCKED_UNSUPPORTED_SUBTYPE', `Subtype non intégré: ${asString(item.subtype)}.`, id);
    }

    const points = item.points;
    if (!points || !Number.isFinite(points.value) || points.value < 0 || !oneDecimal(points.value)) {
      issue(issues, 'blocker', 'INVALID_POINTS', 'Les points doivent être >= 0 avec au plus une décimale.', id);
    } else {
      if (!POINT_PROVENANCE.has(points.provenance)) {
        issue(issues, 'blocker', 'INVALID_POINTS', 'points.provenance doit être provided, proposed ou derived.', id);
      }
      if (typeof points.graded !== 'boolean' || typeof points.bonus !== 'boolean') {
        issue(issues, 'blocker', 'INVALID_POINTS', 'points.graded et points.bonus doivent être des booléens explicites.', id);
      }
      if (points.provenance === 'proposed') {
        issue(issues, 'warning', 'PROPOSED_POINTS', `Pointage proposé: ${points.value}.`, id);
      }
      if (points.value === 0 && points.graded !== false && points.bonus !== true) {
        issue(issues, 'warning', 'UNEXPECTED_ZERO_POINTS', 'Question notée à 0 point sans graded:false ni bonus.', id);
      }
    }

    const grading = item.grading;
    if (!grading || !['auto', 'assisted', 'manual'].includes(grading.mode)) {
      issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'grading.mode doit être auto, assisted ou manual.', id);
      return;
    }
    if (!grading.provenance || !GRADING_PROVENANCE.has(grading.provenance.kind)) {
      issue(
        issues,
        'blocker',
        'GRADING_PROVENANCE_INVALID',
        'grading.provenance.kind doit être providedAnswerKey, sourceExplicit, sourceInferred, questionIntrinsic, teacherApproved ou sourceMissing.',
        id
      );
    }

    const partialCreditRelevant = new Set([
      'fillInTheBlank',
      'inlineChoice',
      'multipleSelection',
      'resequence',
      'matching'
    ]);
    if (partialCreditRelevant.has(item.subtype) && typeof grading.partialCredit !== 'boolean') {
      issue(
        issues,
        'blocker',
        'GRADING_PARTIAL_CREDIT_REQUIRED',
        'grading.partialCredit doit être un booléen explicite pour ce subtype; Cardinal ne choisit pas ce comportement de notation.',
        id
      );
    }
    if (['shortAnswer', 'longAnswer'].includes(item.subtype) && grading.mode !== 'manual') {
      if (typeof grading.partialCredit !== 'boolean') {
        issue(
          issues,
          'blocker',
          'GRADING_PARTIAL_CREDIT_REQUIRED',
          'grading.partialCredit doit être explicite pour une correction Keyword.',
          id
        );
      }
      if (typeof grading.caseSensitive !== 'boolean') {
        issue(
          issues,
          'blocker',
          'GRADING_CASE_SENSITIVE_REQUIRED',
          'grading.caseSensitive doit être explicite pour une correction Keyword.',
          id
        );
      }
    }

    for (const transformation of item.transformations || []) {
      if (!TRANSFORMATION_CODES.has(transformation?.code) ||
          !asString(transformation?.description).trim() ||
          typeof transformation?.requiresReview !== 'boolean') {
        issue(
          issues,
          'blocker',
          'TRANSFORMATION_INVALID',
          'Chaque transformation doit utiliser {code, description, requiresReview}; le champ type n’est pas accepté à la place de code.',
          id
        );
      }
    }

    const declaredSourceMissing = grading?.provenance?.kind === 'sourceMissing';
    const referencedSourceMissing = refsFromQuestion(item).some(ref => sourceMap.get(ref)?.status === 'missing');
    if (declaredSourceMissing) {
      issue(issues, 'warning', 'SOURCE_REQUIRED', 'Le paquet déclare explicitement qu’une source nécessaire à la correction est manquante.', id);
      if (grading.mode === 'auto') {
        issue(
          issues,
          'blocker',
          'SOURCE_MODE_CONFLICT',
          'Contradiction du paquet: grading.provenance.kind=sourceMissing ne peut pas être combiné à grading.mode=auto.',
          id
        );
      }
    } else if (referencedSourceMissing) {
      // A missing referenced source is a consistency signal, not permission for
      // Cardinal to redo ChatGPT's pedagogical judgment.
      issue(issues, 'warning', 'SOURCE_REFERENCE_MISSING', 'Une source référencée est marquée manquante; Cardinal conserve le mode de correction fourni par ChatGPT.', id);
    }

    const requirements = grading.requirements || [];
    const hasMultipart = requirements.some(requirement =>
      MULTIPART_REQUIREMENTS.has(requirement?.type) &&
      (requirement?.count == null || requirement.count >= 2 || ['compareSources', 'argumentAndEvidence', 'chooseNofM', 'relation'].includes(requirement?.type))
    );
    if (grading.mode === 'auto' && hasMultipart) {
      // This is a pedagogical signal only. The package already contains the
      // teacher/ChatGPT grading decision; Cardinal must not replace it.
      issue(issues, 'warning', 'ASSISTED_REQUIRED', 'La tâche comporte plusieurs composantes. Cardinal conserve néanmoins le mode de correction fourni par ChatGPT.', id);
    }

    if (['shortAnswer', 'longAnswer'].includes(item.subtype) && grading.mode !== 'manual' &&
        (!Array.isArray(grading.concepts) || grading.concepts.length === 0)) {
      // The adapter can still use expectedAnswer as a technical full-score
      // anchor. Missing concepts therefore cannot be a global pedagogical veto.
      issue(issues, 'warning', 'MISSING_KEYWORD_CONCEPTS', 'Aucun concept Keyword n’est fourni; Cardinal utilisera la réponse attendue comme ancre technique si elle est disponible.', id);
    }

    validateConcepts(item, issues);
    validateAutoKeywordMaximum(item, issues);
    validateSubtypeStructure(item, issues);
    detectMediaDependency(item, sourceMap, issues);
  }

  function validateAutoKeywordMaximum(item, issues) {
    if (!['shortAnswer', 'longAnswer'].includes(item?.subtype)) return;
    if (item?.grading?.mode !== 'auto') return;

    const maximum = Number(item?.points?.value);
    const scores = (item?.grading?.concepts || [])
      .filter(concept => Array.isArray(concept?.terms) && concept.terms.length > 0)
      .map(concept => Number(concept?.score))
      .filter(Number.isFinite);

    if (!Number.isFinite(maximum) || scores.length === 0) return;
    const highest = Math.max(...scores);
    if (Math.abs(highest - maximum) > 1e-9) {
      issue(
        issues,
        'warning',
        'KEYWORD_MAX_SCORE_MISMATCH',
        `Le score Keyword maximal déclaré est ${highest}, alors que la question vaut ${maximum} point(s). L’adaptateur ajoutera la réponse attendue comme ancre technique de pleine note sans modifier les scores pédagogiques fournis.`,
        item.id || '(sans id)'
      );
    }
  }

  function validateConcepts(item, issues) {
    const id = item.id || '(sans id)';
    const grading = item.grading || {};
    const concepts = Array.isArray(grading.concepts) ? grading.concepts : [];
    const conceptIds = new Set();
    const termMap = new Map();
    const caseSensitive = grading.caseSensitive === true;
    const max = item?.points?.value;

    for (const concept of concepts) {
      const conceptId = asString(concept?.id).trim();
      if (!conceptId) {
        // Concept ids are pedagogical metadata. They do not participate in the
        // Formative mutation itself.
        issue(issues, 'warning', 'CONCEPT_ID_MISSING', 'Concept sans id; ses termes restent validés individuellement.', id);
      } else if (conceptIds.has(conceptId)) {
        issue(issues, 'warning', 'DUPLICATE_CONCEPT_ID', `Concept dupliqué: ${conceptId}.`, id);
      }
      if (conceptId) conceptIds.add(conceptId);

      if (concept?.terms != null && !Array.isArray(concept.terms)) {
        issue(issues, 'blocker', 'CONCEPT_TERMS_INVALID', `Concept ${conceptId || '?'}: terms doit être un tableau.`, id);
        continue;
      }

      const rawTerms = Array.isArray(concept?.terms) ? concept.terms : [];
      const activeTerms = rawTerms.filter(term => normalizeTerm(term, caseSensitive));
      if (!activeTerms.length) {
        issue(issues, 'warning', 'EMPTY_CONCEPT_TERMS', `Concept ${conceptId || '?'} sans terme actif; il ne sera pas envoyé comme match Keyword.`, id);
      }

      // Score validity is blocking only when that score would actually be
      // transported to Formative through at least one active term.
      if (activeTerms.length && !oneDecimal(concept?.score)) {
        issue(issues, 'blocker', 'INVALID_POINTS', `Concept ${conceptId || '?'}: score invalide ${concept?.score}.`, id);
      }
      if (activeTerms.length && Number.isFinite(max) && Number.isFinite(concept?.score) && concept.score > max + 1e-9) {
        issue(issues, 'blocker', 'SCORE_GT_MAX', `Concept ${conceptId || '?'}: score ${concept.score} > maximum ${max}.`, id);
      }

      if (concept?.provenance === 'sourceMissing' && activeTerms.length) {
        issue(
          issues,
          'blocker',
          'CONCEPT_PROVENANCE_CONFLICT',
          `Concept ${conceptId || '?'}: des termes actifs sont déclarés malgré provenance=sourceMissing.`,
          id
        );
      }

      for (const term of rawTerms) {
        const normalized = normalizeTerm(term, caseSensitive);
        if (!normalized) {
          issue(issues, 'warning', 'EMPTY_CONCEPT_TERM', `Concept ${conceptId || '?'}: terme vide ignoré.`, id);
          continue;
        }

        const previous = termMap.get(normalized);
        if (previous) {
          if (Math.abs(previous.score - concept.score) > 1e-9) {
            // This affects the exact payload sent to Formative and therefore is
            // a true transport ambiguity, not a pedagogical second opinion.
            issue(issues, 'blocker', 'TERM_SCORE_CONFLICT', `Terme « ${term} » normalisé déjà utilisé avec un autre score.`, id);
          } else if (previous.conceptId !== conceptId) {
            issue(issues, 'warning', 'DUPLICATE_TERM', `Terme « ${term} » partagé entre ${previous.conceptId || '?'} et ${conceptId || '?'}.`, id);
          }
        } else {
          termMap.set(normalized, { score: concept.score, conceptId: conceptId || null });
        }

        if (GENERIC_TERMS.has(normalized)) {
          issue(issues, 'warning', 'GENERIC_TERM', `Terme potentiellement trop générique: « ${term} ».`, id);
        }
      }

      if (Array.isArray(concept?.riskyTerms) && concept.riskyTerms.length) {
        issue(issues, 'warning', 'RISKY_TERM', `Concept ${conceptId || '?'}: ${concept.riskyTerms.length} terme(s) risqué(s) gardé(s) hors import automatique.`, id);
      }
    }
  }

  function validateSubtypeStructure(item, issues) {
    const id = item.id || '(sans id)';
    const response = item.response || {};

    if (item.subtype === 'multipleChoice' || item.subtype === 'multipleSelection') {
      const options = Array.isArray(response.options) ? response.options : [];
      if (options.length < 2) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Au moins deux options sont requises.', id);
        return;
      }

      const optionIds = new Set();
      for (const option of options) {
        if (!option?.id || optionIds.has(option.id)) {
          issue(issues, 'blocker', 'CHOICE_ID_DUPLICATE', `ID de choix invalide/dupliqué: ${asString(option?.id)}.`, id);
        }
        optionIds.add(option?.id);
        if (!asString(option?.text).trim()) {
          issue(issues, 'blocker', 'CHOICE_TEXT_EMPTY', `Choix ${asString(option?.id) || '?'} sans texte.`, id);
        }
        if (option?.points != null && (!Number.isFinite(Number(option.points)) || Number(option.points) < 0 || !oneDecimal(Number(option.points)))) {
          issue(issues, 'blocker', 'INVALID_POINTS', `Choix ${asString(option?.id) || '?'}: pondération invalide.`, id);
        }
      }

      const correctCount = options.filter(x => x?.correct === true).length;
      if (item.subtype === 'multipleChoice' && correctCount !== 1) {
        issue(issues, 'blocker', 'MCQ_CORRECT_COUNT', `Multiple Choice exige exactement 1 réponse correcte, reçu ${correctCount}.`, id);
      }
      if (item.subtype === 'multipleSelection' && correctCount < 1) {
        issue(issues, 'blocker', 'MCQ_CORRECT_COUNT', 'Multiple Selection exige au moins 1 réponse correcte.', id);
      }

      if (item.subtype === 'multipleSelection' && item?.grading?.partialCredit === true) {
        const correctOptions = options.filter(option => option?.correct === true);
        const missingWeights = correctOptions.filter(option => !Number.isFinite(Number(option?.points)));
        if (missingWeights.length) {
          issue(
            issues,
            'blocker',
            'MULTISELECT_WEIGHTS_REQUIRED',
            'Le crédit partiel en sélection multiple exige une pondération explicite pour chaque bonne réponse.',
            id
          );
        } else if (Number.isFinite(item?.points?.value)) {
          const weightTotal = Math.round(
            correctOptions.reduce((sum, option) => sum + Number(option.points), 0) * 10
          ) / 10;
          const itemTotal = Math.round(Number(item.points.value) * 10) / 10;
          if (weightTotal !== itemTotal) {
            issue(
              issues,
              'blocker',
              'MULTISELECT_WEIGHT_TOTAL',
              `La somme des pondérations de sélection multiple (${weightTotal}) doit égaler le total de la question (${itemTotal}).`,
              id
            );
          }
        }
      }
    }

    if (item.subtype === 'fillInTheBlank') {
      validatePlaceholders(item, response.blanks, 'answers', issues);
    }

    if (item.subtype === 'inlineChoice') {
      validatePlaceholders(item, response.dropdowns, 'options', issues);
      for (const dropdown of response.dropdowns || []) {
        const optionList = Array.isArray(dropdown?.options) ? dropdown.options : [];
        const options = new Set(optionList);
        if (optionList.length < 2 || optionList.some(value => !asString(value).trim())) {
          issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `Dropdown ${dropdown?.id}: au moins deux options non vides sont requises.`, id);
        }
        if (options.size !== optionList.length) {
          issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `Dropdown ${dropdown?.id}: options dupliquées.`, id);
        }
        const correct = Array.isArray(dropdown?.correct) ? dropdown.correct : [];
        if (correct.length !== 1) {
          issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `Dropdown ${dropdown?.id}: exactement une bonne réponse est requise.`, id);
        }
        for (const answer of correct) {
          if (!options.has(answer)) {
            issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `Dropdown ${dropdown?.id}: réponse correcte absente des options.`, id);
          }
        }
      }
    }

    if (item.subtype === 'resequence') {
      const sequence = Array.isArray(response.sequence) ? response.sequence.map(value => asString(value).trim()) : [];
      if (sequence.length < 2 || sequence.some(value => !value)) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Resequence exige au moins deux éléments non vides.', id);
      }
      const normalized = sequence.map(value => normalizeText(value));
      if (new Set(normalized).size !== normalized.length) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Resequence contient des éléments dupliqués ou indiscernables.', id);
      }
    }

    if (item.subtype === 'matching') {
      const pairs = Array.isArray(response.pairs) ? response.pairs : [];
      if (pairs.length < 2) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Matching exige au moins deux paires.', id);
      }
      for (const pair of pairs) {
        if (!asString(pair?.left).trim() || !asString(pair?.right).trim()) {
          issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Matching contient une paire vide.', id);
        }
      }
      const left = pairs.map(pair => normalizeText(pair?.left));
      const right = pairs.map(pair => normalizeText(pair?.right));
      if (new Set(left).size !== left.length || new Set(right).size !== right.length) {
        issue(issues, 'blocker', 'BLOCKED_STRUCTURE', 'Matching contient des libellés dupliqués ou ambigus.', id);
      }
    }
  }

  function validatePlaceholders(item, defs, answerField, issues) {
    const id = item.id || '(sans id)';
    const inPrompt = placeholderIds(item.prompt);
    const defined = Array.isArray(defs) ? defs.map(x => x?.id).filter(Boolean) : [];
    const promptSet = new Set(inPrompt);
    const definedSet = new Set(defined);

    const duplicates = defined.filter((value, index) => defined.indexOf(value) !== index);
    if (duplicates.length) {
      issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `ID de placeholder dupliqué: ${duplicates[0]}.`, id);
    }

    const mismatch = promptSet.size !== definedSet.size || [...promptSet].some(x => !definedSet.has(x)) || [...definedSet].some(x => !promptSet.has(x));
    if (mismatch) {
      issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `Placeholders prompt [${[...promptSet].join(', ')}] != définitions [${[...definedSet].join(', ')}].`, id);
    }

    for (const def of defs || []) {
      const values = def?.[answerField];
      if (!Array.isArray(values) || values.length === 0) {
        issue(issues, 'blocker', 'PLACEHOLDER_MISMATCH', `${def?.id || 'placeholder'}: aucune ${answerField}.`, id);
      }
    }
  }

  function detectMediaDependency(item, sourceMap, issues) {
    const prompt = normalizeText(item.prompt);
    const patterns = [
      /\bimage\b/,
      /\bfigure\b/,
      /\bschema\b/,
      /\bgraphique\b/,
      /\bcarte\b/,
      /\btableau\s+(?:ci-dessus|suivant|precedent)\b/,
      /\bdocument\s+\d+\b/,
      /\billustration\b/
    ];

    if (!patterns.some(re => re.test(prompt))) return;

    const refs = item.sourceRefs || [];
    const missing = refs.some(ref => sourceMap.get(ref)?.status === 'missing');
    issue(
      issues,
      'warning',
      missing ? 'MEDIA_DEPENDENCY_MISSING' : 'MEDIA_DEPENDENCY',
      missing
        ? 'La consigne semble dépendre d’un média/source marqué manquant. Cardinal le signale sans refaire le jugement pédagogique de ChatGPT.'
        : 'La consigne semble dépendre d’un média ou document externe; vérifier qu’il sera accessible aux élèves.',
      item.id
    );
  }

  function finish(pkg, issues, extra = {}) {
    const blockers = issues.filter(x => x.severity === 'blocker').length;
    const warnings = issues.filter(x => x.severity === 'warning').length;
    const state = blockers ? 'blocked' : warnings ? 'review' : 'ready';

    const questions = Array.isArray(pkg?.items) ? pkg.items.filter(x => x?.kind === 'question') : [];
    const stats = {
      questions: questions.length,
      auto: questions.filter(x => x?.grading?.mode === 'auto').length,
      assisted: questions.filter(x => x?.grading?.mode === 'assisted').length,
      manual: questions.filter(x => x?.grading?.mode === 'manual').length,
      activeTerms: questions.reduce((sum, question) => sum + countActiveTerms(question), 0),
      blockers,
      warnings,
      ...extra
    };

    return {
      ok: blockers === 0,
      state,
      issues,
      stats
    };
  }

  function expandMechanicalVariants(term, options = {}) {
    const caseSensitive = options.caseSensitive === true;
    const source = asString(term).trim();
    if (!source) return [];

    const variants = new Set([source]);
    const apostrophe = source.replace(/[’‘`´]/g, "'");
    variants.add(apostrophe);

    const deaccented = apostrophe.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    variants.add(deaccented);

    if (/[A-Za-zÀ-ÿ]-[A-Za-zÀ-ÿ]/.test(source)) {
      variants.add(source.replace(/-/g, ' '));
      variants.add(deaccented.replace(/-/g, ' '));
    }

    if (!caseSensitive) {
      for (const value of [...variants]) variants.add(value.toLowerCase());
    }

    return [...variants].filter(Boolean);
  }

  const api = {
    SCHEMA,
    PROTOCOL_VERSION,
    DEFAULT_CAPABILITIES,
    validatePackageV2,
    normalizeTerm,
    normalizeText,
    expandMechanicalVariants,
    placeholderIds
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalThis.CardinalFormativeV2 = api;
})();
