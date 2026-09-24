(() => {
  'use strict';

  const ROOT_ID = 'cardinalFormativeImportProgress';
  const MESSAGE_TYPE = 'CARDINAL_FORMATIVE_IMPORT_PROGRESS';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function displayDuration(event = {}) {
    if (event.stage === 'COMPLETED') return 5500;
    if (event.stage === 'FAILED' || event.stage === 'BLOCKED') return 9000;
    return null;
  }

  function isFormativeProgress(message) {
    return Boolean(
      message?.type === MESSAGE_TYPE &&
      message?.payload?.schema === 'cardinal.progress/1' &&
      message?.payload?.module === 'formative'
    );
  }

  function createOverlay(options = {}) {
    const doc = required(options.document || globalThis.document, 'document');
    const runtime = required(options.runtime || globalThis.chrome?.runtime, 'chrome.runtime');
    const progressApi = required(options.progressApi || globalThis.CardinalProgress, 'progress');
    const locationApi = options.location || globalThis.location;
    const setTimer = options.setTimeout || globalThis.setTimeout;
    const clearTimer = options.clearTimeout || globalThis.clearTimeout;

    let root = null;
    let fill = null;
    let label = null;
    let detail = null;
    let last = null;
    let hideTimer = null;
    let started = false;

    function onAssessmentPage() {
      try {
        return String(locationApi?.hostname || '') === 'app.formative.com' &&
          /^\/formatives\//.test(String(locationApi?.pathname || ''));
      } catch {
        return false;
      }
    }

    function ensureRoot() {
      if (root?.isConnected) return root;
      const existing = doc.getElementById?.(ROOT_ID);
      if (existing) {
        root = existing;
        fill = existing.querySelector?.('[data-cardinal-progress-fill]') || null;
        label = existing.querySelector?.('[data-cardinal-progress-label]') || null;
        detail = existing.querySelector?.('[data-cardinal-progress-detail]') || null;
        return root;
      }

      root = doc.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      Object.assign(root.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        width: 'min(360px, calc(100vw - 36px))',
        zIndex: '2147483647',
        padding: '12px 14px',
        borderRadius: '12px',
        boxShadow: '0 8px 28px rgba(0,0,0,.24)',
        background: 'Canvas',
        color: 'CanvasText',
        border: '1px solid rgba(128,128,128,.35)',
        font: '13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'none'
      });

      const title = doc.createElement('div');
      title.textContent = 'Cardinal · Import Formative';
      title.style.fontWeight = '650';

      label = doc.createElement('div');
      label.dataset.cardinalProgressLabel = '1';
      label.style.marginTop = '4px';

      const track = doc.createElement('div');
      Object.assign(track.style, {
        height: '5px',
        marginTop: '8px',
        borderRadius: '999px',
        background: 'rgba(128,128,128,.25)',
        overflow: 'hidden'
      });

      fill = doc.createElement('div');
      fill.dataset.cardinalProgressFill = '1';
      Object.assign(fill.style, {
        width: '0%',
        height: '100%',
        background: 'currentColor',
        transition: 'width .18s ease'
      });
      track.appendChild(fill);

      detail = doc.createElement('div');
      detail.dataset.cardinalProgressDetail = '1';
      detail.style.marginTop = '5px';
      detail.style.opacity = '.72';
      detail.style.fontSize = '12px';

      root.append(title, label, track, detail);
      (doc.body || doc.documentElement).appendChild(root);
      return root;
    }

    function detailText(event = {}) {
      const pieces = [];
      if (event.itemId) pieces.push(String(event.itemId));
      if (event.detail?.action) pieces.push(String(event.detail.action));
      if (Number.isFinite(event.itemIndex) && Number.isFinite(event.itemTotal)) {
        pieces.push(`${event.itemIndex}/${event.itemTotal}`);
      }
      return pieces.join(' · ');
    }

    function hide() {
      if (hideTimer) clearTimer(hideTimer);
      hideTimer = null;
      if (root) root.style.display = 'none';
    }

    function render(event) {
      if (!onAssessmentPage()) {
        hide();
        return false;
      }
      if (!progressApi.shouldReplace(last, event)) return false;
      last = event;
      ensureRoot();
      root.style.display = 'block';
      const percent = Number.isFinite(event.percent) ? Math.max(0, Math.min(100, event.percent)) : null;
      fill.style.width = `${percent == null ? 0 : percent}%`;
      label.textContent = event.label || event.stage || 'Import en cours';
      detail.textContent = detailText(event);
      root.dataset.cardinalProgressStage = String(event.stage || '');
      root.dataset.cardinalProgressSeverity = String(event.severity || 'info');

      if (hideTimer) clearTimer(hideTimer);
      hideTimer = null;
      const duration = displayDuration(event);
      if (duration != null) hideTimer = setTimer(hide, duration);
      return true;
    }

    function onMessage(message) {
      if (!isFormativeProgress(message)) return false;
      render(message.payload);
      return false;
    }

    function start() {
      if (started) return api;
      started = true;
      runtime.onMessage?.addListener?.(onMessage);
      return api;
    }

    function stop() {
      if (!started) return false;
      started = false;
      runtime.onMessage?.removeListener?.(onMessage);
      hide();
      return true;
    }

    const api = Object.freeze({ start, stop, render, hide, onMessage });
    return api;
  }

  const api = { ROOT_ID, MESSAGE_TYPE, displayDuration, isFormativeProgress, createOverlay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ProgressContent = api;
})();
