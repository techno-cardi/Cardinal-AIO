(() => {
  'use strict';

  const OPERATION_NAME = 'FormativeTeacher';

  // Historical Extended/Smart Upsert generations used FormativeTeacher for a
  // richer server read. This v2 document intentionally asks only for fields
  // required by managed-state-v2. It does not fetch student answers, roster,
  // owner profile, standards, feedback, or other unnecessary personal data.
  const DOCUMENT = `query FormativeTeacher($formativeId: ID!) {
    formative(id: $formativeId) {
      _id
      title
      viewerPermissions
      items {
        _id
        parentId
        position
        subtype
        text
        type
        updatedAt
        details {
          points
          correctAnswers
          answerChoicePoints
          choiceLabels
          choices
          labels
          isCaseSensitive
          isKeywordGrading
          isPartialCredit
          isRequired
          showWordCount
          blanks {
            key
            correctAnswers
            choiceLabels
            choices
            numeric
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
  }`;

  function makeError(message, code, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  }

  function unwrapClientResponse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.data && typeof raw.data === 'object') return raw.data;
    return raw;
  }

  function normalizeDetailedSnapshot(raw, expectedFormativeId) {
    const data = unwrapClientResponse(raw);
    const formative = data?.formative || null;
    if (!formative || typeof formative !== 'object') {
      throw makeError('FormativeTeacher n’a retourné aucune évaluation.', 'FORMATIVE_DETAILED_READ_MISSING');
    }

    const id = formative._id || formative.id || null;
    if (!id) throw makeError('FormativeTeacher n’a retourné aucun ID de cible.', 'FORMATIVE_DETAILED_READ_ID_MISSING');
    if (expectedFormativeId && String(id) !== String(expectedFormativeId)) {
      throw makeError(
        'FormativeTeacher a retourné une autre évaluation que la cible demandée.',
        'TARGET_ID_MISMATCH',
        { expectedFormativeId: String(expectedFormativeId), actualFormativeId: String(id) }
      );
    }
    if (!Array.isArray(formative.items)) {
      throw makeError('FormativeTeacher n’a pas retourné une liste complète d’items.', 'FORMATIVE_DETAILED_ITEMS_MISSING');
    }

    const ids = new Set();
    for (const item of formative.items) {
      const itemId = item?._id || item?.id || null;
      if (!itemId) {
        throw makeError('Un item Formative détaillé ne contient aucun ID.', 'FORMATIVE_DETAILED_ITEM_ID_MISSING');
      }
      const key = String(itemId);
      if (ids.has(key)) {
        throw makeError(`FormativeTeacher a retourné deux fois l’item ${key}.`, 'FORMATIVE_DETAILED_DUPLICATE_ITEM_ID');
      }
      ids.add(key);
    }

    return {
      formative: {
        ...formative,
        _id: String(id),
        items: formative.items
      },
      snapshotComplete: true,
      detailLevel: 'managed-v2',
      sourceOperation: OPERATION_NAME,
      serverRevision: formative.updatedAt || null
    };
  }

  function createReader(options = {}) {
    const client = options.client;
    if (!client || typeof client.query !== 'function') throw new Error('GraphQL client.query required');
    const readiness = options.serverReadiness || globalThis.CardinalFormativeV2ServerReadiness || null;

    async function readDetailedSnapshot(targetFormativeId, context = {}) {
      if (!targetFormativeId) throw makeError('targetFormativeId required', 'TARGET_REQUIRED');
      const raw = await client.query(
        OPERATION_NAME,
        DOCUMENT,
        { formativeId: String(targetFormativeId) },
        context?.extraHeaders || undefined
      );
      const snapshot = normalizeDetailedSnapshot(raw, targetFormativeId);

      if (readiness && typeof readiness.checkSnapshot === 'function') {
        const check = readiness.checkSnapshot(snapshot.formative.items);
        snapshot.managedDetailComplete = check.ok === true;
        snapshot.detailState = check.state;
        snapshot.detailIssues = check.issues || [];
      }
      return snapshot;
    }

    async function readItemDetailed(targetFormativeId, formativeItemId, context = {}) {
      if (!formativeItemId) throw makeError('formativeItemId required', 'FORMATIVE_ITEM_ID_REQUIRED');
      const snapshot = await readDetailedSnapshot(targetFormativeId, context);
      const item = snapshot.formative.items.find(current => String(current?._id || current?.id) === String(formativeItemId)) || null;
      if (!item) return null;

      if (readiness && typeof readiness.checkItem === 'function') {
        const check = readiness.checkItem(item, { claimed: true });
        if (!check.ok) {
          throw makeError(
            'La relecture détaillée de la question est incomplète pour un diff sécuritaire.',
            'SERVER_ITEM_DETAIL_INCOMPLETE',
            { issues: check.issues || [] }
          );
        }
      }
      return item;
    }

    return { readDetailedSnapshot, readItemDetailed };
  }

  const api = { OPERATION_NAME, DOCUMENT, normalizeDetailedSnapshot, createReader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Reader = api;
})();