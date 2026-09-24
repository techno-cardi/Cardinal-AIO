(() => {
  'use strict';

  const GLOBAL_KEY = '__cardinalFormativeV2ProgressOverlay';

  function start(options = {}) {
    if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY];
    const api = options.api || globalThis.CardinalFormativeV2ProgressContent;
    if (!api || typeof api.createOverlay !== 'function') {
      throw new Error('CardinalFormativeV2ProgressContent.createOverlay unavailable');
    }
    const overlay = api.createOverlay(options.overlayOptions || {});
    if (!overlay || typeof overlay.start !== 'function') {
      throw new Error('Formative progress overlay start unavailable');
    }
    overlay.start();
    globalThis[GLOBAL_KEY] = overlay;
    return overlay;
  }

  const api = { GLOBAL_KEY, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ProgressEntry = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    try { start(); } catch (error) { console.error('[Cardinal Formative] progress entry', error); }
  }
})();
