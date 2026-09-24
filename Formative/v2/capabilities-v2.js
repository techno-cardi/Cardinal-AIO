(() => {
  'use strict';

  const LEVEL = Object.freeze({
    PROVEN: 'PROVEN',
    PARTIAL: 'PARTIAL',
    NOT_PROVEN: 'NOT_PROVEN',
    OUT_OF_PROFILE: 'OUT_OF_PROFILE'
  });

  // IMPORTANT: this registry describes the COMPLETE v2 production pipeline,
  // not merely what the archived 0.4.1 transport can mutate. A subtype is
  // PROVEN only when validation -> adapter -> managed-state server read ->
  // planner -> guarded mutation -> verification are all available.
  //
  // legacyTransport records useful lower-level evidence without accidentally
  // advertising a subtype as safe for the current product surface.
  const REGISTRY = Object.freeze({
    shortAnswer: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Keyword absolu prouvé de bout en bout.'
    },
    longAnswer: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Free Response + Keyword prouvé de bout en bout.'
    },
    fillInTheBlank: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Texte à trous texte libre prouvé de bout en bout.'
    },

    multipleChoice: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'QCM natif verrouillé: adaptateur v2, mutation 0.4.1, relecture et diff sémantique.'
    },
    multipleSelection: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Sélection multiple native verrouillée avec crédit partiel et pondérations.'
    },
    inlineChoice: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Dropdowns intégrés verrouillés avec clés serveur préservées et diff sémantique.'
    },
    resequence: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Ordonnancement natif verrouillé avec clés opaques normalisées par ordre correct.'
    },
    matching: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      note: 'Appariement natif verrouillé avec correspondance complète et diff sémantique réversible.'
    },

    functionalizedText: {
      level: LEVEL.PROVEN,
      create: true, update: true, read: true,
      legacyTransport: { create: true, update: true, read: true },
      contentOnly: true
    },
    passageGroup: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: true, update: false, read: true },
      virtual: true,
      note: 'Transport parent/enfants connu, mais baseline/diff parent-enfant v2 pas encore promus.'
    },
    categorize: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: true, update: false, read: true },
      note: 'Transport partiel seulement.'
    },
    dragAndDrop: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    hotText: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    matchTableGrid: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    trueFalse: {
      level: LEVEL.PARTIAL,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    drawing: {
      level: LEVEL.NOT_PROVEN,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    graphing: {
      level: LEVEL.NOT_PROVEN,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    hotSpot: {
      level: LEVEL.NOT_PROVEN,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    },
    numeric: {
      level: LEVEL.OUT_OF_PROFILE,
      create: false, update: false, read: false,
      legacyTransport: { create: false, update: false, read: true }
    }
  });

  function capability(subtype) {
    return REGISTRY[subtype] || {
      level: LEVEL.NOT_PROVEN,
      create: false,
      update: false,
      read: false,
      legacyTransport: { create: false, update: false, read: false },
      unknown: true
    };
  }

  function can(subtype, operation, options = {}) {
    const row = capability(subtype);
    if (!['create', 'update', 'read'].includes(operation)) return false;
    if (row.level !== LEVEL.PROVEN && options.allowPartial !== true) return false;
    return row[operation] === true;
  }

  function legacyTransportCan(subtype, operation) {
    const row = capability(subtype);
    if (!['create', 'update', 'read'].includes(operation)) return false;
    return row?.legacyTransport?.[operation] === true;
  }

  function productionQuestionTypes() {
    return Object.entries(REGISTRY)
      .filter(([, row]) =>
        row.level === LEVEL.PROVEN &&
        row.create === true &&
        row.update === true &&
        row.read === true &&
        !row.contentOnly &&
        !row.virtual
      )
      .map(([name]) => name)
      .sort();
  }

  function mutationDecision(subtype, action) {
    const op = action === 'CREATE'
      ? 'create'
      : action === 'UPDATE'
        ? 'update'
        : action === 'READ'
          ? 'read'
          : null;
    if (!op) return { ok: false, code: 'CAPABILITY_OPERATION_UNKNOWN', subtype, action };

    const row = capability(subtype);
    if (row.level !== LEVEL.PROVEN) {
      return {
        ok: false,
        code: row.level === LEVEL.PARTIAL ? 'CAPABILITY_PARTIAL' : 'CAPABILITY_NOT_PROVEN',
        subtype,
        action,
        capability: row
      };
    }
    if (row[op] !== true) {
      return {
        ok: false,
        code: 'CAPABILITY_OPERATION_NOT_PROVEN',
        subtype,
        action,
        capability: row
      };
    }
    return { ok: true, subtype, action, capability: row };
  }

  const api = {
    LEVEL,
    REGISTRY,
    capability,
    can,
    legacyTransportCan,
    productionQuestionTypes,
    mutationDecision
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Capabilities = api;
})();