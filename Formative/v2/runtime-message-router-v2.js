(() => {
  'use strict';

  const SOURCE_CHATGPT = 'chatgpt';
  const SOURCE_FORMATIVE = 'formative-editor';
  const SOURCE_EXTENSION = 'extension-page';
  const SOURCE_UNKNOWN = 'unknown';

  const TYPES = Object.freeze({
    PREPARE: 'CARDINAL_FORMATIVE_IMPORT_PREPARE',
    APPLY: 'CARDINAL_FORMATIVE_IMPORT_APPLY',
    REPREPARE: 'CARDINAL_FORMATIVE_IMPORT_REPREPARE',
    RECONCILE: 'CARDINAL_FORMATIVE_IMPORT_RECONCILE',
    DISMISS: 'CARDINAL_FORMATIVE_IMPORT_DISMISS',
    STATUS: 'CARDINAL_FORMATIVE_IMPORT_STATUS'
  });
  const OWNED_TYPES = new Set(Object.values(TYPES));

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function errorPayload(code, message, details = null) {
    return {
      code,
      title: 'Cardinal - Import Formative',
      message: message || code,
      action: { id: 'details', label: 'Voir les détails' },
      technicalDetails: details || null,
      showTechnicalByDefault: false
    };
  }

  function senderRole(sender = {}, extensionId = null) {
    if (extensionId && sender?.id && sender.id !== extensionId) return SOURCE_UNKNOWN;
    const url = String(sender?.url || sender?.documentUrl || '');
    if (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) return SOURCE_EXTENSION;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return SOURCE_UNKNOWN;
      if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') return SOURCE_CHATGPT;
      if (parsed.hostname === 'app.formative.com' && /^\/formatives\//i.test(parsed.pathname)) return SOURCE_FORMATIVE;
    } catch {}
    return SOURCE_UNKNOWN;
  }

  function packageBytes(pkg) {
    if (pkg == null) return 0;
    try {
      const json = JSON.stringify(pkg);
      if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).byteLength;
      if (typeof Buffer !== 'undefined') return Buffer.byteLength(json, 'utf8');
      return json.length * 2;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function publicResult(result = {}, requestId = null) {
    const out = {
      handled: true,
      requestId: requestId || null,
      ok: result?.ok === true,
      state: result?.state || (result?.ok === true ? 'ready' : 'blocked')
    };
    for (const key of ['reason', 'token', 'targetFormativeId', 'targetTabId', 'view', 'error', 'chooserRows']) {
      if (result?.[key] !== undefined) out[key] = result[key];
    }
    const prepared = result?.prepared;
    if (prepared?.packageFingerprint) out.packageFingerprint = prepared.packageFingerprint;
    if (prepared?.runId) out.runId = prepared.runId;
    if (result?.result?.view && out.view === undefined) out.view = result.result.view;
    return out;
  }

  function createRouter(options = {}) {
    const controller = required(options.controller, 'browser controller');
    const errorPresenter = options.errorPresenter || globalThis.CardinalFormativeV2ErrorPresenter || null;
    const extensionId = options.extensionId || null;
    const maxPackageBytes = Number.isFinite(options.maxPackageBytes) && options.maxPackageBytes > 0
      ? options.maxPackageBytes
      : 5 * 1024 * 1024;

    const allowedRoles = new Set(options.allowedCommandRoles || [SOURCE_CHATGPT, SOURCE_EXTENSION]);

    function owns(message) {
      return Boolean(message && typeof message === 'object' && OWNED_TYPES.has(message.type));
    }

    function present(error) {
      if (errorPresenter && typeof errorPresenter.present === 'function') return errorPresenter.present(error);
      return errorPayload(error?.code || 'UNKNOWN_ERROR', error?.message || 'Import interrompu');
    }

    function blocked(requestId, code, message, details = null) {
      const error = new Error(message || code);
      error.code = code;
      return {
        handled: true,
        requestId: requestId || null,
        ok: false,
        state: 'blocked',
        reason: code,
        error: errorPresenter && typeof errorPresenter.present === 'function'
          ? errorPresenter.present(error)
          : errorPayload(code, message, details)
      };
    }

    async function route(message, sender = {}) {
      // Critical host-compat rule: exact ownership only. A MOZAIK_*, legacy
      // FORMATIVE_* or unknown future CARDINAL_FORMATIVE_IMPORT_* message is not
      // consumed by this module and remains available to the host router.
      if (!owns(message)) return { handled: false };

      const requestId = message.requestId ? String(message.requestId).slice(0, 200) : null;
      const role = senderRole(sender, extensionId);
      if (!allowedRoles.has(role)) {
        return blocked(
          requestId,
          'IMPORTER_COMMAND_SOURCE_FORBIDDEN',
          'Cette commande d’import ne vient pas d’une surface Cardinal autorisée.'
        );
      }

      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

      try {
        let result;
        switch (message.type) {
          case TYPES.PREPARE: {
            const bytes = packageBytes(payload.pkg);
            if (!payload.pkg) {
              return blocked(requestId, 'PACKAGE_REQUIRED', 'Aucun questionnaire Cardinal n’a été reçu.');
            }
            if (!Number.isFinite(bytes) || bytes > maxPackageBytes) {
              return blocked(
                requestId,
                'PACKAGE_TOO_LARGE',
                `Le questionnaire préparé dépasse la taille maximale sécuritaire de ${Math.round(maxPackageBytes / 1024 / 1024)} Mo.`
              );
            }
            result = await controller.preparePackage(payload);
            break;
          }
          case TYPES.APPLY:
            result = await controller.execute(payload.token, {
              acknowledgeWarnings: payload.acknowledgeWarnings === true
            });
            break;
          case TYPES.REPREPARE:
            result = await controller.reprepare(payload.token, payload.pkg || null);
            break;
          case TYPES.RECONCILE:
            result = await controller.confirmReconciliation(payload.token, {
              approvedProposals: payload.approvedProposals,
              separateProposals: payload.separateProposals,
              useSuggestedLinks: payload.useSuggestedLinks === true,
              keepSeparateFingerprints: payload.keepSeparateFingerprints
            });
            break;
          case TYPES.DISMISS:
            result = {
              ok: controller.dismiss(payload.token) === true,
              state: 'dismissed',
              token: payload.token || null
            };
            break;
          case TYPES.STATUS: {
            const snapshot = controller.snapshot();
            result = snapshot
              ? { ok: true, ...snapshot }
              : { ok: true, state: 'idle', view: null };
            break;
          }
          default:
            return { handled: false };
        }
        return publicResult(result, requestId);
      } catch (error) {
        return {
          handled: true,
          requestId,
          ok: false,
          state: 'blocked',
          reason: error?.code || 'UNKNOWN_ERROR',
          error: present(error)
        };
      }
    }

    function attach(runtime) {
      required(runtime?.onMessage, 'runtime.onMessage');
      if (typeof runtime.onMessage.addListener !== 'function') throw new Error('runtime.onMessage.addListener required');

      const listener = (message, sender, sendResponse) => {
        if (!owns(message)) return false;
        route(message, sender)
          .then(sendResponse)
          .catch(error => sendResponse({
            handled: true,
            ok: false,
            state: 'blocked',
            reason: error?.code || 'UNKNOWN_ERROR',
            error: present(error)
          }));
        return true;
      };
      runtime.onMessage.addListener(listener);
      return () => {
        if (typeof runtime.onMessage.removeListener === 'function') runtime.onMessage.removeListener(listener);
      };
    }

    return Object.freeze({ owns, route, attach, senderRole: sender => senderRole(sender, extensionId) });
  }

  const api = {
    TYPES,
    OWNED_TYPES,
    SOURCE_CHATGPT,
    SOURCE_FORMATIVE,
    SOURCE_EXTENSION,
    SOURCE_UNKNOWN,
    senderRole,
    packageBytes,
    publicResult,
    createRouter
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2RuntimeMessageRouter = api;
})();