(() => {
  'use strict';

  const STAGES = Object.freeze({
    DETECTING: { order: 10, percent: 5, label: 'Détection du paquet' },
    CHECKING_TARGET: { order: 20, percent: 12, label: 'Vérification de Formative' },
    READING_SERVER: { order: 30, percent: 20, label: 'Lecture du questionnaire' },
    VALIDATING: { order: 40, percent: 30, label: 'Validation pédagogique et technique' },
    PLANNING: { order: 50, percent: 38, label: 'Préparation des changements' },
    READY: { order: 60, percent: 42, label: 'Prêt à importer' },
    IMPORTING: { order: 70, percent: 45, label: 'Import dans Formative' },
    VERIFYING: { order: 80, percent: 90, label: 'Vérification des changements' },
    RECOVERING: { order: 85, percent: 90, label: 'Vérification après interruption' },
    COMPLETED: { order: 100, percent: 100, label: 'Import vérifié' },
    BLOCKED: { order: 100, percent: null, label: 'Import bloqué' },
    FAILED: { order: 100, percent: null, label: 'Import interrompu' }
  });

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function stage(name) {
    const s = STAGES[name];
    if (!s) throw new Error(`Unknown progress stage: ${name}`);
    return s;
  }

  function itemPercent(index, total) {
    if (!Number.isFinite(total) || total <= 0) return STAGES.IMPORTING.percent;
    const safeIndex = clamp(Number(index || 0), 0, total);
    const span = STAGES.VERIFYING.percent - STAGES.IMPORTING.percent - 2;
    return Math.round(STAGES.IMPORTING.percent + (safeIndex / total) * span);
  }

  function event(input = {}) {
    const def = stage(input.stage);
    const terminal = ['COMPLETED', 'BLOCKED', 'FAILED'].includes(input.stage);
    const percent = Number.isFinite(input.percent)
      ? clamp(Math.round(input.percent), 0, 100)
      : (input.stage === 'IMPORTING' && Number.isFinite(input.itemTotal)
          ? itemPercent(input.itemIndex, input.itemTotal)
          : def.percent);

    return {
      schema: 'cardinal.progress/1',
      module: 'formative',
      runId: input.runId || null,
      stage: input.stage,
      order: def.order,
      percent,
      label: input.label || def.label,
      detail: input.detail || null,
      itemId: input.itemId || null,
      itemIndex: Number.isFinite(input.itemIndex) ? input.itemIndex : null,
      itemTotal: Number.isFinite(input.itemTotal) ? input.itemTotal : null,
      terminal,
      severity: input.stage === 'FAILED' || input.stage === 'BLOCKED' ? 'error' : input.stage === 'COMPLETED' ? 'success' : 'info',
      at: input.at || new Date().toISOString()
    };
  }

  function shouldReplace(previous, next) {
    if (!previous) return true;
    if (!next) return false;
    if (previous.runId && next.runId && previous.runId !== next.runId) return true;
    if (previous.terminal) return next.runId !== previous.runId;
    if (next.terminal) return true;
    if (Number(next.order) > Number(previous.order)) return true;
    if (Number(next.order) < Number(previous.order)) return false;
    if (Number.isFinite(next.percent) && Number.isFinite(previous.percent) && next.percent < previous.percent) return false;
    return true;
  }

  function makeReporter(sinks = []) {
    let last = null;
    const listeners = (sinks || []).filter(fn => typeof fn === 'function');
    return async function report(raw) {
      const next = raw?.schema === 'cardinal.progress/1' ? raw : event(raw);
      if (!shouldReplace(last, next)) return last;
      last = next;
      await Promise.allSettled(listeners.map(fn => Promise.resolve(fn(next))));
      return last;
    };
  }

  const api = { STAGES, event, itemPercent, shouldReplace, makeReporter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalProgress = api;
})();