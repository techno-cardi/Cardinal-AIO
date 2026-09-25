(() => {
  'use strict';

  const MANAGED_SUBTYPES = new Set([
    'shortAnswer',
    'longAnswer',
    'fillInTheBlank',
    'multipleChoice',
    'multipleSelection',
    'inlineChoice',
    'resequence',
    'matching'
  ]);

  function required(value, name) {
    if (!value) throw new Error(`${name} required`);
    return value;
  }

  function makeError(message, code, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  }

  function oneDecimal(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round((n + Number.EPSILON) * 10) / 10;
  }

  function tiptap(text) {
    const content = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => ({
      type: 'paragraph',
      attrs: { dir: 'auto', textAlign: null },
      content: line ? [{ type: 'text', text: line }] : []
    }));
    return JSON.stringify({
      type: 'doc',
      attrs: { dir: 'auto' },
      content
    });
  }

  function tiptapWithBlanks(parts) {
    const content = [];
    const emptyParagraph = () => ({
      type: 'paragraph',
      attrs: { dir: 'auto', textAlign: null },
      content: []
    });
    let paragraph = emptyParagraph();

    for (const part of parts || []) {
      if (part?.newParagraph) {
        if (paragraph.content.length) content.push(paragraph);
        paragraph = emptyParagraph();
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(part || {}, 'text')) {
        const lines = String(part.text ?? '').replace(/\r\n?/g, '\n').split('\n');
        lines.forEach((line, index) => {
          if (index > 0) {
            content.push(paragraph);
            paragraph = emptyParagraph();
          }
          if (line) paragraph.content.push({ type: 'text', text: line });
        });
        continue;
      }
      if (part?.blankKey) {
        paragraph.content.push({
          type: 'blankItem',
          attrs: { dir: 'auto', id: part.blankKey, index: null, type: 'text' }
        });
      }
    }

    if (paragraph.content.length) content.push(paragraph);
    return JSON.stringify({ type: 'doc', attrs: { dir: 'auto' }, content });
  }

  function enabledMatches(item) {
    return (item?.grading?.matches || [])
      .filter(match => match?.enabled !== false)
      .map(match => ({
        text: String(match?.text || '').trim(),
        score: oneDecimal(match?.score)
      }))
      .filter(match => match.text && match.score !== null);
  }

  function segments(item) {
    return Array.isArray(item?.segments) ? item.segments : [];
  }

  function blankSegments(item) {
    return segments(item).filter(segment => segment?.blank);
  }

  function blankKeysFromTiptap(value) {
    let doc = value;
    if (typeof value === 'string') {
      try { doc = JSON.parse(value); } catch { return []; }
    }
    if (!doc || typeof doc !== 'object') return [];
    const keys = [];
    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object') return;
      if (node.type === 'blankItem' && node?.attrs?.id) keys.push(String(node.attrs.id));
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(doc);
    return keys;
  }

  function defaultRandomKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    if (!globalThis.crypto?.getRandomValues) {
      throw makeError('crypto.getRandomValues indisponible pour générer une clé Formative.', 'CRYPTO_UNAVAILABLE');
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
    return [...bytes].map(byte => chars[byte % chars.length]).join('');
  }

  function assertUniqueKeys(keys, label) {
    if (!Array.isArray(keys) || keys.some(key => !key)) {
      throw makeError(`${label}: clé absente.`, 'FORMATIVE_KEY_MISSING');
    }
    if (new Set(keys.map(String)).size !== keys.length) {
      throw makeError(`${label}: clés dupliquées.`, 'FORMATIVE_KEY_DUPLICATE');
    }
  }

  function createPrimitives(options = {}) {
    const client = required(options.client, 'GraphQL client');
    const contract = required(options.contract || globalThis.CardinalFormativeV041Contract, '0.4.1 contract');
    const reader = required(options.reader, 'detailed Formative reader');
    const getPageContext = required(options.getPageContext, 'getPageContext');
    const randomKey = options.randomKey || defaultRandomKey;
    const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const pauseMs = Number.isFinite(options.pauseMs) ? Math.max(0, options.pauseMs) : 140;

    async function settle() {
      if (pauseMs > 0) await pause(pauseMs);
    }

    async function invoke(name, variables) {
      const op = contract.get(name);
      if (op.kind === 'query') {
        return client.query(op.operationName, op.document, variables);
      }
      if (op.kind === 'mutation') {
        return client.mutation(op.operationName, op.document, variables);
      }
      throw makeError(`Type d’opération inconnu: ${op.kind}`, 'LEGACY_OPERATION_KIND_INVALID');
    }

    function attachContext(error, extra = {}) {
      if (!error || typeof error !== 'object') return error;
      for (const [key, value] of Object.entries(extra)) {
        if (value != null && error[key] == null) error[key] = value;
      }
      return error;
    }

    async function permissionCheck(formativeId) {
      return invoke('permission', { formativeId: String(formativeId) });
    }

    async function readLayout(formativeId) {
      const raw = await invoke('layout', { formativeId: String(formativeId) });
      const formative = raw?.data?.formative;
      if (!formative?._id) {
        throw makeError('Formative introuvable pendant la lecture du layout.', 'FORMATIVE_LAYOUT_MISSING');
      }
      if (String(formative._id) !== String(formativeId)) {
        throw makeError('Le layout retourné appartient à un autre Formative.', 'TARGET_ID_MISMATCH');
      }
      if (!Array.isArray(formative.items)) {
        throw makeError('Le layout Formative ne contient pas une liste d’items complète.', 'FORMATIVE_LAYOUT_ITEMS_MISSING');
      }
      return {
        formative,
        snapshotComplete: true,
        detailLevel: 'layout'
      };
    }

    async function readDetailedSnapshot(formativeId, context = {}) {
      return reader.readDetailedSnapshot(String(formativeId), context);
    }

    async function readItemDetailed(formativeId, formativeItemId, context = {}) {
      return reader.readItemDetailed(String(formativeId), String(formativeItemId), context);
    }

    async function createRaw(formativeId, subtype, parentId = null) {
      const variables = {
        formativeId: String(formativeId),
        subtype,
        input: { isRequired: true, preventReuseChoices: null }
      };
      if (parentId) variables.parentId = String(parentId);
      const raw = await invoke('create', variables);
      const id = raw?.data?.payload?.formativeItem?._id;
      if (!id) {
        throw makeError(`Création ${subtype}: aucun ID retourné.`, 'FORMATIVE_CREATE_ID_MISSING', {
          mutationMayHaveCommitted: true
        });
      }
      await settle();
      return String(id);
    }

    async function updateQuestion(id, input) {
      const raw = await invoke('updateQuestion', {
        formativeItemId: String(id),
        input
      });
      await settle();
      return raw;
    }

    async function updateChoices(id, labels, choices, correctAnswers) {
      const raw = await invoke('updateChoices', {
        id: String(id),
        input: { choiceLabels: labels, choices, correctAnswers }
      });
      await settle();
      return raw;
    }

    async function updateMatching(id, choiceLabels, labels, choices, correctAnswers) {
      const raw = await invoke('updateMatching', {
        formativeItemId: String(id),
        input: { choiceLabels, labels, choices, correctAnswers }
      });
      await settle();
      return raw;
    }

    async function updateFillBlank(id, text, blanks) {
      const raw = await invoke('updateFillBlank', {
        formativeItemId: String(id),
        input: { text, blanks }
      });
      await settle();
      return raw;
    }

    async function updateText(id, text) {
      const raw = await invoke('updateText', {
        formativeItemId: String(id),
        text: tiptap(text)
      });
      await settle();
      return raw;
    }

    async function setPoints(id, points) {
      const normalized = oneDecimal(points);
      if (normalized === null) {
        throw makeError('Nombre de points invalide.', 'POINTS_INVALID');
      }
      return updateQuestion(id, { points: normalized });
    }

    function assertQuestionItem(item) {
      if (!item || item.kind !== 'question' || !MANAGED_SUBTYPES.has(item.subtype)) {
        throw makeError(`Subtype non branché dans les primitives 0.4.1: ${item?.subtype || item?.kind || 'inconnu'}.`, 'LEGACY_MANAGED_SUBTYPE_UNSUPPORTED');
      }
      if (oneDecimal(item.points) === null) throw makeError('Points absents ou invalides.', 'POINTS_INVALID');
    }

    async function configureKeywordQuestion(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const isLong = item.subtype === 'longAnswer';
      const gradingMode = item?.grading?.mode || 'manual';

      // 0.4.1 did not clear a previous Keyword key when a question switched to
      // manual. Until a controlled live probe proves the exact safe clearing
      // mutation, block that transition before the first write.
      if (gradingMode === 'manual' && currentRaw?.details?.isKeywordGrading === true) {
        throw makeError(
          'Cette question est actuellement corrigée par mots-clés dans Formative. Le passage automatique vers une correction manuelle n’est pas encore prouvé; Cardinal la préserve.',
          'KEYWORD_TO_MANUAL_TRANSITION_NOT_PROVEN',
          { mutationMayHaveCommitted: false, formativeItemId: String(id) }
        );
      }

      await updateQuestion(id, {
        text: tiptap(item.prompt || ''),
        ...(isLong ? { showWordCount: item.settings?.showWordCount !== false } : {}),
        isRequired: item.isRequired !== false,
        isCaseSensitive: item.grading?.caseSensitive === true
      });

      // Proven invariant for Keyword grading: maximum first, weighted matches last.
      await setPoints(id, item.points);

      if (gradingMode === 'keyword-absolute') {
        const matches = enabledMatches(item);
        if (!matches.length) {
          throw makeError('Une correction Keyword ne contient aucun mot-clé actif.', 'KEYWORD_MATCHES_EMPTY', {
            mutationMayHaveCommitted: true,
            formativeItemId: String(id)
          });
        }
        await updateQuestion(id, {
          correctAnswers: matches.map(match => match.text),
          answerChoicePoints: matches.map(match => match.score),
          isKeywordGrading: true,
          isPartialCredit: item.grading?.partialCredit !== false,
          isCaseSensitive: item.grading?.caseSensitive === true
        });
      }
    }

    function buildFitb(item, blankKeys) {
      assertQuestionItem(item);
      const sourceSegments = segments(item);
      const blanks = blankSegments(item);
      if (!blanks.length) throw makeError('Fill In The Blank sans blanc.', 'FITB_BLANKS_EMPTY');
      if (!Array.isArray(blankKeys) || blankKeys.length !== blanks.length) {
        throw makeError('Le nombre de clés FITB ne correspond pas au nombre de blancs.', 'FITB_KEY_COUNT_MISMATCH');
      }
      assertUniqueKeys(blankKeys, 'FITB');

      const textParts = [];
      const blankDefs = [];
      let blankIndex = 0;
      for (const segment of sourceSegments) {
        if (Object.prototype.hasOwnProperty.call(segment || {}, 'text')) {
          textParts.push({ text: String(segment.text ?? '') });
          continue;
        }
        if (segment?.newParagraph) {
          textParts.push({ newParagraph: true });
          continue;
        }
        if (!segment?.blank) continue;

        const key = String(blankKeys[blankIndex]);
        const answers = (segment.blank.answers || [])
          .map(answer => String(answer ?? '').trim())
          .filter(Boolean);
        if (!answers.length) {
          throw makeError(`Le blanc ${blankIndex + 1} n’a aucune réponse acceptée.`, 'FITB_ANSWERS_EMPTY');
        }
        textParts.push({ blankKey: key });
        blankDefs.push({ key, correctAnswers: answers, numeric: false });
        blankIndex += 1;
      }

      if (blankIndex !== blanks.length) {
        throw makeError('Structure FITB incohérente pendant la génération.', 'FITB_STRUCTURE_MISMATCH');
      }

      return {
        text: tiptapWithBlanks(textParts),
        blanks: blankDefs
      };
    }

    function choiceKeysFromCurrent(currentRaw, count) {
      const keys = Array.isArray(currentRaw?.details?.choices) ? currentRaw.details.choices.map(String) : [];
      if (keys.length === count && keys.every(Boolean) && new Set(keys).size === keys.length) return keys;
      return Array.from({ length: count }, () => String(randomKey()));
    }

    async function configureMultipleChoice(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const defs = Array.isArray(item.choices) ? item.choices : [];
      const keys = choiceKeysFromCurrent(currentRaw, defs.length);
      assertUniqueKeys(keys, 'CHOICES');

      await updateQuestion(id, {
        text: tiptap(item.prompt || ''),
        isRequired: item.isRequired !== false
      });
      await updateChoices(
        id,
        defs.map(x => String(x.text ?? '')),
        keys,
        defs.map((x, index) => x.correct === true ? keys[index] : null).filter(Boolean)
      );

      if (item.subtype === 'multipleSelection') {
        const partial = item.grading?.partialCredit !== false;
        if (partial) {
          const answerChoicePoints = defs.map(x => {
            if (x.correct !== true) return 0;
            const explicit = oneDecimal(x.points);
            if (explicit === null) {
              throw makeError(
                'Le crédit partiel Multiple Selection exige des pondérations explicites.',
                'MULTISELECT_WEIGHT_MISSING',
                { mutationMayHaveCommitted: true, formativeItemId: String(id) }
              );
            }
            return explicit;
          });

          // Formative peut redimensionner answerChoicePoints si le maximum est
          // modifié après les pondérations. Invariant prouvé: maximum d'abord,
          // pondérations finales ensuite, puis ne plus toucher au maximum.
          await setPoints(id, item.points);
          await updateQuestion(id, {
            isPartialCredit: true,
            answerChoicePoints
          });
        } else {
          await updateQuestion(id, { isPartialCredit: false });
          await setPoints(id, item.points);
        }
        return;
      }

      await setPoints(id, item.points);
    }

    async function configureResequence(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const labels = (item.choices || []).map(String);
      const keys = choiceKeysFromCurrent(currentRaw, labels.length);
      assertUniqueKeys(keys, 'RESEQUENCE');
      await updateQuestion(id, {
        text: tiptap(item.prompt || ''),
        isRequired: item.isRequired !== false
      });
      await updateChoices(id, labels, keys, [...keys]);
      await updateQuestion(id, { isPartialCredit: item.grading?.partialCredit !== false });
      await setPoints(id, item.points);
    }

    function matchingKeysFromCurrent(currentRaw, count) {
      const keys = Array.isArray(currentRaw?.details?.choices)
        ? currentRaw.details.choices.map(String)
        : [];
      if (keys.length === count && keys.every(Boolean) && new Set(keys).size === keys.length) return keys;
      return Array.from({ length: count }, () => String(randomKey()));
    }

    async function configureMatching(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const pairs = Array.isArray(item.pairs) ? item.pairs : [];
      const keys = matchingKeysFromCurrent(currentRaw, pairs.length);
      assertUniqueKeys(keys, 'MATCHING');
      await updateQuestion(id, {
        text: tiptap(item.prompt || ''),
        isRequired: item.isRequired !== false
      });
      await updateMatching(
        id,
        pairs.map(pair => String(pair.left ?? '')),
        pairs.map(pair => tiptap(String(pair.right ?? ''))),
        keys,
        [...keys]
      );
      await updateQuestion(id, { isPartialCredit: item.grading?.partialCredit !== false });
      await setPoints(id, item.points);
    }

    async function configureInlineChoice(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const sourceSegments = segments(item);
      const blanks = blankSegments(item);
      let blankKeys = currentRaw ? blankKeysFromTiptap(currentRaw.text) : [];
      if (blankKeys.length !== blanks.length || new Set(blankKeys).size !== blankKeys.length) {
        blankKeys = Array.from({ length: blanks.length }, () => String(randomKey()));
      }
      assertUniqueKeys(blankKeys, 'INLINE');

      const existingDefs = new Map(
        (currentRaw?.details?.blanks || []).map(blank => [String(blank?.key || ''), blank])
      );
      const textParts = [];
      const blankDefs = [];
      let blankIndex = 0;

      for (const segment of sourceSegments) {
        if (Object.prototype.hasOwnProperty.call(segment || {}, 'text')) {
          textParts.push({ text: String(segment.text ?? '') });
          continue;
        }
        if (segment?.newParagraph) {
          textParts.push({ newParagraph: true });
          continue;
        }
        if (!segment?.blank) continue;

        const key = blankKeys[blankIndex];
        const labels = (segment.blank.choices || []).map(String);
        const previous = existingDefs.get(String(key));
        let choiceKeys = Array.isArray(previous?.choices) ? previous.choices.map(String) : [];
        if (choiceKeys.length !== labels.length || new Set(choiceKeys).size !== choiceKeys.length) {
          choiceKeys = labels.map(() => String(randomKey()));
        }
        const correctIndex = labels.findIndex(label => label === String(segment.blank.correct));
        if (correctIndex < 0) throw makeError('Bonne réponse absente des choix inline.', 'INLINE_CHOICE_CORRECT_MISSING');

        textParts.push({ blankKey: key });
        blankDefs.push({
          key,
          choiceLabels: labels,
          choices: choiceKeys,
          correctAnswers: [choiceKeys[correctIndex]],
          numeric: false
        });
        blankIndex += 1;
      }

      const renderedText = tiptapWithBlanks(textParts);
      await updateFillBlank(id, renderedText, blankDefs);

      // Ne pas supposer que FillInTheBlankEditableContainerMutation persiste
      // toujours le texte visible d'un inlineChoice. Réécrire explicitement le
      // même document Tiptap par l'update générique garantit que les libellés
      // humains entourant chaque dropdown restent visibles.
      await updateQuestion(id, {
        text: renderedText,
        isRequired: item.isRequired !== false,
        isPartialCredit: item.grading?.partialCredit !== false
      });
      await setPoints(id, item.points);
    }

    async function configureFitb(id, item, currentRaw = null) {
      assertQuestionItem(item);
      const count = blankSegments(item).length;
      let keys;

      if (currentRaw) {
        keys = blankKeysFromTiptap(currentRaw.text);
        if (keys.length !== count || new Set(keys).size !== keys.length) {
          throw makeError(
            'Cardinal ne peut pas préserver avec certitude les clés internes des blancs existants. Aucun changement n’a été envoyé.',
            'FITB_EXISTING_KEYS_UNSAFE',
            { mutationMayHaveCommitted: false, formativeItemId: String(id) }
          );
        }
      } else {
        keys = Array.from({ length: count }, () => String(randomKey()));
        assertUniqueKeys(keys, 'FITB');
      }

      const structure = buildFitb(item, keys);
      await updateFillBlank(id, structure.text, structure.blanks);
      await updateQuestion(id, {
        text: structure.text,
        isRequired: item.isRequired !== false,
        isKeywordGrading: true,
        isPartialCredit: item.grading?.partialCredit !== false,
        partialCreditMode: item.grading?.partialCreditMode || 'standard'
      });
      await setPoints(id, item.points);
    }

    async function configureExisting(id, item, currentRaw = null) {
      if (item?.kind === 'text') {
        await updateText(id, item.content || '');
        return;
      }
      assertQuestionItem(item);
      if (item.subtype === 'fillInTheBlank') {
        await configureFitb(id, item, currentRaw);
        return;
      }
      if (item.subtype === 'inlineChoice') {
        await configureInlineChoice(id, item, currentRaw);
        return;
      }
      if (item.subtype === 'multipleChoice' || item.subtype === 'multipleSelection') {
        await configureMultipleChoice(id, item, currentRaw);
        return;
      }
      if (item.subtype === 'resequence') {
        await configureResequence(id, item, currentRaw);
        return;
      }
      if (item.subtype === 'matching') {
        await configureMatching(id, item, currentRaw);
        return;
      }
      await configureKeywordQuestion(id, item, currentRaw);
    }

    async function createItem(input = {}) {
      const formativeId = input.targetFormativeId;
      const item = input.item;
      if (!formativeId) throw makeError('targetFormativeId requis.', 'TARGET_REQUIRED');
      if (!item || !['text', 'question'].includes(item.kind)) throw makeError('Item v1 invalide.', 'LEGACY_ITEM_INVALID');
      if (item.kind === 'question') assertQuestionItem(item);

      const subtype = item.kind === 'text' ? 'functionalizedText' : item.subtype;
      let id = null;
      try {
        id = await createRaw(formativeId, subtype, input.parentId || null);
        await configureExisting(id, item, null);
        return {
          formativeItemId: id,
          subtype,
          operationId: input.operationId || null
        };
      } catch (error) {
        attachContext(error, {
          formativeItemId: id,
          operationId: input.operationId || null,
          targetFormativeId: String(formativeId)
        });
        // Once CREATE returned an ID, at least one server mutation definitely
        // committed even if a later configuration step failed.
        if (id) error.mutationMayHaveCommitted = true;
        throw error;
      }
    }

    async function updateItem(input = {}) {
      const formativeId = input.targetFormativeId;
      const id = input.formativeItemId;
      const item = input.item;
      if (!formativeId) throw makeError('targetFormativeId requis.', 'TARGET_REQUIRED');
      if (!id) throw makeError('formativeItemId requis.', 'FORMATIVE_ITEM_ID_REQUIRED');
      if (!item || !['text', 'question'].includes(item.kind)) throw makeError('Item v1 invalide.', 'LEGACY_ITEM_INVALID');

      const current = await readItemDetailed(formativeId, id, {
        ...(input.context || {}),
        phase: 'mutation-adapter-precheck'
      });
      if (!current) {
        throw makeError('La question à modifier n’existe plus.', 'MUTATION_TARGET_MISSING', {
          mutationMayHaveCommitted: false,
          formativeItemId: String(id)
        });
      }

      const expectedSubtype = item.kind === 'text' ? 'functionalizedText' : item.subtype;
      if (String(current.subtype) !== String(expectedSubtype)) {
        throw makeError(
          `Subtype serveur ${current.subtype} différent du subtype demandé ${expectedSubtype}.`,
          'MUTATION_SUBTYPE_CONFLICT',
          { mutationMayHaveCommitted: false, formativeItemId: String(id) }
        );
      }

      try {
        await configureExisting(id, item, current);
        return {
          formativeItemId: String(id),
          subtype: expectedSubtype,
          operationId: input.operationId || null
        };
      } catch (error) {
        attachContext(error, {
          formativeItemId: String(id),
          operationId: input.operationId || null,
          targetFormativeId: String(formativeId)
        });
        throw error;
      }
    }

    return {
      getPageContext,
      permissionCheck,
      readLayout,
      readDetailedSnapshot,
      readItemDetailed,
      createItem,
      updateItem,
      // Deliberately absent: deleteItem. legacy-gateway-v2 will expose a safe
      // DELETE_NOT_PROVEN stub until a native deletion contract is proven.
      _internals: {
        invoke,
        createRaw,
        updateQuestion,
        updateFillBlank,
        updateText,
        setPoints,
        configureKeywordQuestion,
        configureFitb
      }
    };
  }

  const api = {
    MANAGED_SUBTYPES,
    oneDecimal,
    tiptap,
    tiptapWithBlanks,
    enabledMatches,
    blankKeysFromTiptap,
    createPrimitives
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2LegacyPrimitives = api;
})();
