(() => {
  'use strict';

  // Compatibility contract for the future merge into Cardinal - Gestion des notes.
  // This module is deliberately pure: production wiring can validate itself
  // without loading or mutating the Gestion des notes page.

  const CONTRACT_VERSION = 'gestion-v14-2026-09-20';
  const IMPORTER_MESSAGE_PREFIX = 'CARDINAL_FORMATIVE_IMPORT_';
  // Keep the namespace already used by session-store, baseline and persistence.
  // Renaming it during the merge would orphan recovery journals/baselines.
  const IMPORTER_STORAGE_PREFIX = 'cardinal.formative.v2.';

  const HOST = Object.freeze({
    mozaik: Object.freeze({
      pageSource: 'cardinal-mozaik-console',
      extensionSource: 'cardinal-mozaik-extension',
      buttonId: 'syncMozaikBtn',
      ownerDatasetKey: 'cardinalSyncOwner',
      ownerDatasetValue: 'v14',
      messageTypes: Object.freeze([
        'MOZAIK_EXTENSION_READY',
        'MOZAIK_EXTENSION_PING',
        'MOZAIK_EXTENSION_SHOW_PROGRESS',
        'MOZAIK_EXTENSION_PROGRESS',
        'MOZAIK_EXTENSION_SYNC',
        'MOZAIK_EXTENSION_RESULT',
        'SHOW_MOZAIK_SYNC_UI',
        'START_MOZAIK_SYNC'
      ]),
      boundedTimeoutMs: Object.freeze({
        extensionReady: 1800,
        flushGradeSaves: 7000,
        prepareJob: 10000,
        claimExactJob: 10000,
        extensionSync: 35000,
        completeJob: 10000,
        closeFailedJob: 5000
      })
    }),
    formativeCorrection: Object.freeze({
      pageSource: 'cardinal-formative-console',
      extensionSource: 'cardinal-formative-extension',
      messageTypes: Object.freeze([
        'FORMATIVE_EXTENSION_PING',
        'FORMATIVE_EXTENSION_REQUEST',
        'FORMATIVE_EXTENSION_READY',
        'FORMATIVE_EXTENSION_RESULT',
        'FORMATIVE_REQUEST',
        'FORMATIVE_IMPORT_AVAILABLE',
        'FORMATIVE_CHATGPT_FEEDBACK_AVAILABLE'
      ]),
      storageKeys: Object.freeze([
        'pending_formative_import',
        'pending_formative_chatgpt_feedback',
        'cardinal_global_formative_import'
      ]),
      domIds: Object.freeze([
        'formativeCard',
        'formativeImportDialog',
        'formativeQuestionList',
        'formativeDestination',
        'formativeImportGrades',
        'formativePullBtn',
        'formativePushBtn',
        'confirmFormativeImport'
      ])
    })
  });

  const RESERVED_MESSAGE_TYPES = new Set([
    ...HOST.mozaik.messageTypes,
    ...HOST.formativeCorrection.messageTypes
  ]);
  const RESERVED_SOURCES = new Set([
    HOST.mozaik.pageSource,
    HOST.mozaik.extensionSource,
    HOST.formativeCorrection.pageSource,
    HOST.formativeCorrection.extensionSource
  ]);
  const RESERVED_STORAGE_KEYS = new Set(HOST.formativeCorrection.storageKeys);
  const RESERVED_DOM_IDS = new Set([
    HOST.mozaik.buttonId,
    ...HOST.formativeCorrection.domIds
  ]);

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function issue(issues, code, message, field = null) {
    issues.push({ severity: 'blocker', code, message, field });
  }

  function validateImporterSurface(surface = {}) {
    const issues = [];

    for (const type of asArray(surface.messageTypes)) {
      if (RESERVED_MESSAGE_TYPES.has(type)) {
        issue(issues, 'HOST_MESSAGE_COLLISION', `Le message ${type} appartient déjà à Gestion des notes.`, 'messageTypes');
      }
      if (!String(type).startsWith(IMPORTER_MESSAGE_PREFIX)) {
        issue(issues, 'IMPORTER_MESSAGE_NAMESPACE', `Le message ${type} doit commencer par ${IMPORTER_MESSAGE_PREFIX}.`, 'messageTypes');
      }
    }

    for (const source of asArray(surface.windowSources)) {
      if (RESERVED_SOURCES.has(source)) {
        issue(issues, 'HOST_SOURCE_COLLISION', `La source window.postMessage ${source} appartient déjà à Gestion des notes.`, 'windowSources');
      }
      if (!String(source).startsWith('cardinal-formative-import-')) {
        issue(issues, 'IMPORTER_SOURCE_NAMESPACE', `La source ${source} doit être dédiée à l’importeur.`, 'windowSources');
      }
    }

    for (const key of asArray(surface.storageKeys)) {
      if (RESERVED_STORAGE_KEYS.has(key)) {
        issue(issues, 'HOST_STORAGE_COLLISION', `La clé ${key} appartient déjà au workflow Formative/Gestion.`, 'storageKeys');
      }
      if (!String(key).startsWith(IMPORTER_STORAGE_PREFIX)) {
        issue(issues, 'IMPORTER_STORAGE_NAMESPACE', `La clé ${key} doit commencer par ${IMPORTER_STORAGE_PREFIX}.`, 'storageKeys');
      }
    }

    for (const id of asArray(surface.domIds)) {
      if (RESERVED_DOM_IDS.has(id)) {
        issue(issues, 'HOST_DOM_COLLISION', `L’identifiant DOM #${id} appartient déjà à Gestion des notes.`, 'domIds');
      }
      if (!String(id).startsWith('cardinalFormativeImport')) {
        issue(issues, 'IMPORTER_DOM_NAMESPACE', `L’identifiant DOM #${id} doit être dédié à l’importeur.`, 'domIds');
      }
    }

    const roles = asArray(surface.contentScriptRoles);
    if (roles.includes('gestion-des-notes')) {
      issue(
        issues,
        'IMPORTER_GESTION_INJECTION_FORBIDDEN',
        'Le module d’import de questions ne doit pas injecter son UI dans Gestion des notes.',
        'contentScriptRoles'
      );
    }
    for (const role of roles) {
      if (!['chatgpt', 'formative-editor'].includes(role)) {
        issue(issues, 'IMPORTER_ROLE_UNKNOWN', `Rôle de content script importeur non autorisé: ${role}.`, 'contentScriptRoles');
      }
    }

    if (surface.runtimeRouting !== 'delegate-unhandled') {
      issue(
        issues,
        'RUNTIME_ROUTER_MUST_DELEGATE',
        'Le routeur service worker doit ignorer/déléguer les messages qu’il ne possède pas; aucun catch-all importeur.',
        'runtimeRouting'
      );
    }

    if (surface.formativeObserverPolicy !== 'read-only-or-owned-ui') {
      issue(
        issues,
        'FORMATIVE_OBSERVER_POLICY',
        'Sur Formative, un observer peut seulement lire ou maintenir une UI Cardinal possédée; il ne doit pas réécrire le DOM applicatif Formative.',
        'formativeObserverPolicy'
      );
    }

    if (surface.mozaikButtonPolicy !== 'never-touch') {
      issue(
        issues,
        'MOZAIK_BUTTON_OWNERSHIP',
        'L’importeur ne doit jamais attacher, remplacer, désactiver ou réécrire #syncMozaikBtn.',
        'mozaikButtonPolicy'
      );
    }

    if (surface.authIsolation !== 'formative-only-session') {
      issue(
        issues,
        'AUTH_ISOLATION_REQUIRED',
        'Les en-têtes Formative de l’importeur doivent rester en session et ne jamais toucher au bearer Mozaïk ni aux tokens Gestion.',
        'authIsolation'
      );
    }

    return {
      ok: issues.length === 0,
      state: issues.length ? 'blocked' : 'ready',
      contractVersion: CONTRACT_VERSION,
      issues
    };
  }

  function recommendedSurface() {
    return {
      messageTypes: [
        // Exact inbound commands owned by runtime-message-router-v2.
        'CARDINAL_FORMATIVE_IMPORT_PREPARE',
        'CARDINAL_FORMATIVE_IMPORT_APPLY',
        'CARDINAL_FORMATIVE_IMPORT_REPREPARE',
        'CARDINAL_FORMATIVE_IMPORT_RECONCILE',
        'CARDINAL_FORMATIVE_IMPORT_DISMISS',
        'CARDINAL_FORMATIVE_IMPORT_STATUS',
        // Outbound-only UI events remain in the same importer namespace.
        'CARDINAL_FORMATIVE_IMPORT_PROGRESS',
        'CARDINAL_FORMATIVE_IMPORT_RESULT'
      ],
      windowSources: [
        'cardinal-formative-import-chatgpt',
        'cardinal-formative-import-formative'
      ],
      storageKeys: [
        'cardinal.formative.v2.session',
        'cardinal.formative.v2.baseline:example',
        'cardinal.formative.v2.journal:example',
        'cardinal.formative.v2.history:example'
      ],
      domIds: [
        'cardinalFormativeImportBar',
        'cardinalFormativeImportProgress',
        'cardinalFormativeImportReview',
        'cardinalFormativeImportTargetChooser'
      ],
      contentScriptRoles: ['chatgpt', 'formative-editor'],
      runtimeRouting: 'delegate-unhandled',
      formativeObserverPolicy: 'read-only-or-owned-ui',
      mozaikButtonPolicy: 'never-touch',
      authIsolation: 'formative-only-session'
    };
  }

  const api = {
    CONTRACT_VERSION,
    IMPORTER_MESSAGE_PREFIX,
    IMPORTER_STORAGE_PREFIX,
    HOST,
    validateImporterSurface,
    recommendedSurface
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2HostCompat = api;
})();
