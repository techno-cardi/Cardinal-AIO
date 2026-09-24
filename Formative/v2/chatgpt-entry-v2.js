(() => {
  'use strict';

  const GLOBAL_KEY = '__cardinalFormativeV2ChatGPTBridge';

  function start(options = {}) {
    if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY];
    const api = options.api || globalThis.CardinalFormativeV2ChatGPTContent;
    if (!api || typeof api.createContentBridge !== 'function') {
      throw new Error('CardinalFormativeV2ChatGPTContent.createContentBridge unavailable');
    }
    const bridge = api.createContentBridge(options.bridgeOptions || {});
    if (!bridge || typeof bridge.start !== 'function') {
      throw new Error('ChatGPT Formative content bridge start unavailable');
    }
    bridge.start();
    globalThis[GLOBAL_KEY] = bridge;
    return bridge;
  }

  const api = { GLOBAL_KEY, start };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ChatGPTEntry = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    try { start(); } catch (error) { console.error('[Cardinal Formative] ChatGPT entry', error); }
  }
})();
