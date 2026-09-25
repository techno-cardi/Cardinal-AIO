(() => {
  'use strict';

  const DISMISS_STORAGE_KEY = 'cardinal.formative.v2.ui.dismissed';
  const BAR_PREFIX = 'cardinalFormativeImportBar';
  const SCAN_DEBOUNCE_MS = 350;
  const INCOMPLETE_GRACE_MS = 1400;
  const UI_RESCAN_MESSAGE = 'CARDINAL_FORMATIVE_UI_RESCAN';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function oneLine(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  }

  function assessmentKey(pkg = {}) {
    const assessment = pkg.assessment || {};
    return [assessment.title, assessment.targetHint, assessment.language]
      .map(value => oneLine(value).toLocaleLowerCase())
      .join('|');
  }

  function fallbackHash(text) {
    const source = String(text || '');
    let a = 0x811c9dc5;
    let b = 5381;
    for (let i = 0; i < source.length; i++) {
      const code = source.charCodeAt(i);
      a ^= code;
      a = Math.imul(a, 0x01000193) >>> 0;
      b = (((b << 5) + b) ^ code) >>> 0;
    }
    return `f-${source.length}-${a.toString(16)}-${b.toString(16)}`;
  }

  async function signature(text, cryptoApi = globalThis.crypto) {
    const source = String(text || '');
    try {
      if (cryptoApi?.subtle && typeof TextEncoder !== 'undefined') {
        const bytes = new TextEncoder().encode(source);
        const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      }
    } catch {}
    return fallbackHash(source);
  }

  function invalidContextMessage(value) {
    const message = String(value?.message || value || '');
    return /Extension context invalidated/i.test(message) ||
      /Cannot read properties of undefined.*sendMessage/i.test(message) ||
      /CARDINAL_EXTENSION_CONTEXT_INVALIDATED/i.test(message);
  }

  function summarizeView(view = {}) {
    const parts = [];
    for (const [key, singular, plural] of [
      ['create', 'à créer', 'à créer'],
      ['update', 'à mettre à jour', 'à mettre à jour'],
      ['unchanged', 'inchangé', 'inchangés'],
      ['deleteProposed', 'retrait à vérifier', 'retraits à vérifier']
    ]) {
      const value = Number(view[key] || 0);
      if (value > 0) parts.push(`${value} ${value === 1 ? singular : plural}`);
    }
    if (Number(view.blockers || 0) > 0) parts.push(`${Number(view.blockers)} blocage${Number(view.blockers) > 1 ? 's' : ''}`);
    return parts.join(' · ') || oneLine(view.statusLabel) || 'Prêt';
  }

  function actionIntent(view = {}, reviewAcknowledged = false) {
    const action = view?.primaryAction || {};
    switch (action.id) {
      case 'import':
        return { command: 'APPLY', acknowledgeWarnings: Number(view?.warnings || 0) > 0 };
      case 'resume':
        return { command: 'APPLY', acknowledgeWarnings: true };
      case 'import-review':
        return { command: 'APPLY', acknowledgeWarnings: true };
      case 'reimport':
      case 'refresh-reconciliation':
        return { command: 'REPREPARE' };
      case 'confirm-reconciliation':
        return { command: 'RECONCILE_SAFE' };
      case 'review-reconciliation':
        return { command: 'OPEN_REVIEW' };
      default:
        return { command: 'NONE' };
    }
  }

  function questionSelectionRows(pkg = {}) {
    return [...(pkg?.items || [])]
      .filter(item => item?.kind === 'question' && item?.id)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({
        id: String(item.id),
        number: oneLine(item?.source?.number) || String(index + 1),
        prompt: oneLine(item.prompt),
        points: Number(item?.points?.value || 0),
        subtype: item.subtype || null
      }));
  }

  function buildSelectedQuestionPackage(pkg = {}, selectedIds = []) {
    const rows = questionSelectionRows(pkg);
    const allIds = rows.map(row => row.id);
    const available = new Set(allIds);
    const selected = [...new Set((selectedIds || []).map(String))];

    if (!selected.length) {
      const error = new Error('Choisis au moins une question à importer.');
      error.code = 'QUESTION_SELECTION_EMPTY';
      throw error;
    }

    const unknown = selected.filter(id => !available.has(id));
    if (unknown.length) {
      const error = new Error(`Sélection inconnue: ${unknown.join(', ')}`);
      error.code = 'QUESTION_SELECTION_UNKNOWN';
      error.unknownQuestionIds = unknown;
      throw error;
    }

    if (selected.length === allIds.length && allIds.every(id => selected.includes(id))) {
      return { pkg, partial: false, selectedQuestionIds: allIds };
    }

    const selectedSet = new Set(selected);
    const clone = JSON.parse(JSON.stringify(pkg));
    clone.packageMode = 'patch';
    clone.items = (clone.items || []).filter(item =>
      item?.kind === 'question' && selectedSet.has(String(item.id))
    );

    // A subset is not the complete assessment anymore. Keeping the original
    // declared total would be misleading for downstream validation/reporting.
    if (clone.assessment && typeof clone.assessment === 'object') {
      delete clone.assessment.declaredTotalPoints;
    }

    // Item-specific issues for unselected questions are irrelevant. A full-
    // assessment total mismatch is also irrelevant in patch mode.
    clone.issues = (clone.issues || []).filter(issue => {
      if (issue?.code === 'TOTAL_POINTS_MISMATCH') return false;
      if (issue?.itemId) return selectedSet.has(String(issue.itemId));
      return true;
    });

    return { pkg: clone, partial: true, selectedQuestionIds: selected };
  }

  function shouldOfferQuestionSelection() {
    return false;
  }

  function buttonStyle(kind = 'secondary') {
    const primary = kind === 'primary';
    return {
      appearance: 'none',
      WebkitAppearance: 'none',
      borderRadius: '9px',
      padding: '7px 11px',
      marginTop: '10px',
      marginRight: '7px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: primary ? '700' : '600',
      lineHeight: '1.2',
      border: primary ? '1px solid #111827' : '1px solid rgba(128,128,128,.38)',
      background: primary ? '#111827' : 'rgba(127,127,127,.10)',
      color: primary ? '#ffffff' : 'inherit',
      opacity: '1'
    };
  }

  function createContentBridge(options = {}) {
    const doc = required(options.document || globalThis.document, 'document');
    const runtime = required(options.runtime || globalThis.chrome?.runtime, 'chrome.runtime');
    const storage = options.storage || globalThis.chrome?.storage?.local || null;
    const scanner = required(options.scanner || globalThis.CardinalFormativeV2ChatGPTScanner, 'chatgpt-scanner');
    const parser = required(options.parser || globalThis.CardinalFormativeV2PackageParser, 'package-parser');
    const errorPresenter = required(options.errorPresenter || globalThis.CardinalFormativeV2ErrorPresenter, 'error-presenter');
    const locationApi = options.location || globalThis.location;
    const sessionStorageApi = options.sessionStorage || globalThis.sessionStorage;
    const MutationObserverApi = options.MutationObserver || globalThis.MutationObserver;

    const bars = new Map();
    const incompleteSince = new WeakMap();
    let scanTimer = null;
    let observer = null;
    let stopped = false;

    async function dismissedSet() {
      if (!storage || typeof storage.get !== 'function') return new Set();
      try {
        const value = await storage.get(DISMISS_STORAGE_KEY);
        const rows = Array.isArray(value?.[DISMISS_STORAGE_KEY]) ? value[DISMISS_STORAGE_KEY] : [];
        return new Set(rows.map(String));
      } catch {
        return new Set();
      }
    }

    async function persistDismissed(sig) {
      if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') return;
      try {
        const set = await dismissedSet();
        set.add(String(sig));
        const rows = [...set].slice(-100);
        await storage.set({ [DISMISS_STORAGE_KEY]: rows });
      } catch {}
    }

    function requestId() {
      try { return globalThis.crypto?.randomUUID?.() || `cfi-${Date.now()}-${Math.random()}`; }
      catch { return `cfi-${Date.now()}-${Math.random()}`; }
    }

    async function send(type, payload = {}) {
      if (!runtime?.id || typeof runtime.sendMessage !== 'function') {
        const error = new Error('Extension context invalidated');
        error.code = 'EXTENSION_CONTEXT_INVALIDATED';
        throw error;
      }
      try {
        const response = await runtime.sendMessage({ type, requestId: requestId(), payload });
        if (!response || response.handled !== true) {
          const error = new Error('Le service worker Cardinal n’a pas répondu à la commande d’import.');
          error.code = 'IMPORTER_RUNTIME_UNAVAILABLE';
          throw error;
        }
        return response;
      } catch (error) {
        if (invalidContextMessage(error)) {
          const wrapped = new Error(error?.message || 'Extension context invalidated');
          wrapped.code = 'EXTENSION_CONTEXT_INVALIDATED';
          throw wrapped;
        }
        throw error;
      }
    }

    function reloadOnceForInvalidContext() {
      const key = 'cardinal.formative.v2.contextReloaded';
      try {
        if (sessionStorageApi?.getItem(key) === '1') return false;
        sessionStorageApi?.setItem(key, '1');
        locationApi?.reload?.();
        return true;
      } catch {
        return false;
      }
    }

    function element(tag, text = '') {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      return node;
    }

    function styleShell(shell) {
      Object.assign(shell.style, {
        border: '1px solid rgba(128,128,128,.24)',
        borderRadius: '14px',
        padding: '14px 16px',
        margin: '12px 0',
        background: 'var(--main-surface-primary, rgba(127,127,127,.055))',
        boxShadow: '0 1px 2px rgba(0,0,0,.04)',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '14px',
        lineHeight: '1.35'
      });
    }

    function styleButton(button, kind = 'secondary') {
      Object.assign(button.style, buttonStyle(kind));
    }

    function hideTechnical(node) {
      if (!node?.style) return;
      node.dataset && (node.dataset.cardinalFormativeHidden = 'v2');
      node.style.display = 'none';
    }

    function insertShell(record) {
      const placement = scanner.placementAnchor(record.messageRoot, record.technicalNode);
      const shell = element('div');
      shell.id = `${BAR_PREFIX}-${record.signature.slice(0, 18)}`;
      shell.dataset.cardinalFormativeSignature = record.signature;
      styleShell(shell);

      if (placement.mode === 'after-validation-table' && placement.anchor?.parentNode) {
        placement.anchor.parentNode.insertBefore(shell, placement.anchor.nextSibling);
      } else if (placement.anchor?.parentNode) {
        placement.anchor.parentNode.insertBefore(shell, placement.anchor);
      } else if (record.messageRoot?.appendChild) {
        record.messageRoot.appendChild(shell);
      }
      return shell;
    }

    function renderError(record, errorLike) {
      const presentation = errorLike?.message && errorLike?.action
        ? errorLike
        : errorPresenter.present(errorLike || { code: 'UNKNOWN_ERROR' });
      record.shell.replaceChildren();
      const row = element('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'flex-start';
      const body = element('div');
      body.style.flex = '1';
      const title = element('div', presentation.title || 'Import interrompu');
      title.style.fontWeight = '650';
      const message = element('div', presentation.message || 'Cardinal a bloqué cette opération.');
      message.style.marginTop = '3px';
      body.append(title, message);
      if (presentation.technicalDetails) {
        const details = element('details');
        details.style.marginTop = '7px';
        const summary = element('summary', 'Détails techniques');
        summary.style.cursor = 'pointer';
        summary.style.fontSize = '11px';
        summary.style.opacity = '.72';
        const technical = element('div', presentation.technicalDetails);
        Object.assign(technical.style, {
          marginTop: '5px',
          fontSize: '11px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          opacity: '.82'
        });
        details.append(summary, technical);
        body.appendChild(details);
      }
      const close = element('button', '×');
      close.type = 'button';
      close.title = 'Masquer cette version';
      Object.assign(close.style, { border: '0', background: 'transparent', cursor: 'pointer', fontSize: '18px', lineHeight: '1', opacity: '.62', padding: '2px 4px' });
      close.addEventListener('click', () => dismiss(record));
      row.append(body, close);
      record.shell.appendChild(row);
    }

    function renderChooser(record, response) {
      record.shell.replaceChildren();
      const title = element('div', 'Choisir le Formative à utiliser');
      title.style.fontWeight = '650';
      record.shell.appendChild(title);
      const list = element('div');
      list.style.display = 'grid';
      list.style.gap = '6px';
      list.style.marginTop = '9px';
      list.style.maxHeight = '260px';
      list.style.overflowY = 'auto';
      list.style.padding = '4px 2px';
      for (const row of response.chooserRows || []) {
        const button = element('button', `${row.title || 'Formative'}${row.active ? ' · onglet actif' : ''}`);
        button.type = 'button';
        styleButton(button, 'secondary');
        button.style.textAlign = 'left';
        button.style.marginTop = '0';
        button.style.marginRight = '0';
        button.addEventListener('click', async () => {
          button.disabled = true;
          await prepare(record, { requestedTabId: row.tabId, requestedTargetId: row.targetFormativeId });
        });
        list.appendChild(button);
      }
      record.shell.appendChild(list);
    }


    function renderQuestionSelector(record) {
      const rows = questionSelectionRows(record.pkg);
      if (rows.length <= 1) return false;

      const previousResponse = record.response;
      record.shell.replaceChildren();

      const panel = element('div');
      Object.assign(panel.style, {
        border: '1px solid rgba(127,127,127,.22)',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'rgba(127,127,127,.035)'
      });

      const header = element('div');
      Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 12px',
        borderBottom: '1px solid rgba(127,127,127,.18)'
      });

      const headingWrap = element('div');
      headingWrap.style.flex = '1';
      const title = element('div', 'Questions à importer');
      title.style.fontWeight = '650';
      const note = element('div', 'Décoche seulement ce que tu veux laisser intact dans Formative.');
      Object.assign(note.style, { marginTop: '2px', opacity: '.68', fontSize: '11px' });
      headingWrap.append(title, note);

      const compactControls = element('div');
      Object.assign(compactControls.style, { display: 'flex', gap: '5px', alignItems: 'center' });
      const selectAll = element('button', 'Toutes');
      const selectNone = element('button', 'Aucune');
      for (const button of [selectAll, selectNone]) {
        button.type = 'button';
        styleButton(button, 'secondary');
        Object.assign(button.style, {
          padding: '4px 8px',
          minHeight: '28px',
          borderRadius: '8px',
          fontSize: '11px',
          marginTop: '0',
          marginRight: '0'
        });
      }
      compactControls.append(selectAll, selectNone);
      header.append(headingWrap, compactControls);
      panel.appendChild(header);

      const list = element('div');
      Object.assign(list.style, {
        display: 'grid',
        maxHeight: '255px',
        overflowY: 'auto',
        padding: '4px 0'
      });

      const inputs = [];
      const previousSelection = Array.isArray(record.selectedQuestionIds) && record.selectedQuestionIds.length
        ? new Set(record.selectedQuestionIds.map(String))
        : null;

      for (const row of rows) {
        const label = element('label');
        Object.assign(label.style, {
          display: 'grid',
          gridTemplateColumns: '22px minmax(0,1fr) auto',
          gap: '8px',
          alignItems: 'center',
          padding: '7px 11px',
          cursor: 'pointer',
          borderBottom: '1px solid rgba(127,127,127,.10)'
        });

        const input = element('input');
        input.type = 'checkbox';
        input.checked = previousSelection ? previousSelection.has(row.id) : true;
        input.value = row.id;
        input.style.margin = '0';
        inputs.push(input);

        const textWrap = element('div');
        textWrap.style.minWidth = '0';
        const line1 = element('div', `Q${row.number} · ${row.subtype || 'question'}`);
        Object.assign(line1.style, {
          fontWeight: '600',
          fontSize: '12px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        });

        const promptText = row.prompt || row.id;
        const line2 = element('div', promptText);
        line2.title = promptText;
        Object.assign(line2.style, {
          marginTop: '1px',
          fontSize: '11px',
          opacity: '.68',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        });
        textWrap.append(line1, line2);

        const points = element('div', `${row.points} pt${row.points === 1 ? '' : 's'}`);
        Object.assign(points.style, {
          fontSize: '11px',
          opacity: '.72',
          whiteSpace: 'nowrap'
        });

        label.append(input, textWrap, points);
        list.appendChild(label);
      }
      panel.appendChild(list);

      const footer = element('div');
      Object.assign(footer.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '9px 11px',
        borderTop: '1px solid rgba(127,127,127,.18)'
      });

      const status = element('div');
      Object.assign(status.style, { flex: '1', fontSize: '11px', opacity: '.72' });

      const cancel = element('button', 'Annuler');
      cancel.type = 'button';
      styleButton(cancel, 'secondary');
      Object.assign(cancel.style, { padding: '6px 10px', borderRadius: '8px', marginTop: '0', marginRight: '0' });
      cancel.addEventListener('click', () => renderResponse(record, previousResponse));

      const confirm = element('button', 'Appliquer la sélection');
      confirm.type = 'button';
      styleButton(confirm, 'primary');
      Object.assign(confirm.style, {
        padding: '6px 11px',
        borderRadius: '8px',
        fontWeight: '600',
        marginTop: '0',
        marginRight: '0'
      });

      function selectedIds() {
        return inputs.filter(input => input.checked).map(input => String(input.value));
      }

      function updateStatus() {
        const count = selectedIds().length;
        status.textContent = `${count} sur ${rows.length} sélectionnée${count === 1 ? '' : 's'}`;
        confirm.disabled = count === 0;
        confirm.textContent = count === rows.length
          ? 'Appliquer la sélection'
          : `Importer ${count}`;
      }

      for (const input of inputs) input.addEventListener('change', updateStatus);
      selectAll.addEventListener('click', () => {
        for (const input of inputs) input.checked = true;
        updateStatus();
      });
      selectNone.addEventListener('click', () => {
        for (const input of inputs) input.checked = false;
        updateStatus();
      });

      confirm.addEventListener('click', async () => {
        try {
          const selection = buildSelectedQuestionPackage(record.pkg, selectedIds());
          record.selectionConfirmed = true;
          record.selectedQuestionIds = selection.selectedQuestionIds;
          record.activePkg = selection.pkg;
          record.shell.replaceChildren(element('div', 'Cardinal applique la sélection…'));
          const response = await send('CARDINAL_FORMATIVE_IMPORT_REPREPARE', {
            token: record.token || previousResponse?.token,
            pkg: selection.pkg
          });
          renderResponse(record, response);
        } catch (error) {
          status.textContent = error?.message || String(error);
          status.style.opacity = '1';
        }
      });

      updateStatus();
      footer.append(status, cancel, confirm);
      panel.appendChild(footer);
      record.shell.appendChild(panel);
      return true;
    }

    function correctionPanel(record, view) {
      const panel = element('div');
      panel.dataset.cardinalFormativeReview = '1';
      panel.style.marginTop = '10px';
      panel.style.paddingTop = '10px';
      panel.style.borderTop = '1px solid rgba(128,128,128,.28)';

      const rows = view?.validationRows || [];
      if (!rows.length) {
        panel.appendChild(element('div', 'Aucun détail de correction supplémentaire à afficher.'));
        return panel;
      }

      for (const row of rows) {
        const block = element('div');
        block.style.margin = '0 0 9px 0';
        const heading = element('div', `${row.number || row.itemId || ''} · ${row.typeLabel || row.type || 'Question'} · ${row.points ?? 0} pt`);
        heading.style.fontWeight = '600';
        const correction = row.correction || {};
        const answer = correction.expectedAnswer || row.correctionSummary || '';
        block.appendChild(heading);
        if (answer) block.appendChild(element('div', answer));
        for (const requirement of correction.requirements || []) {
          const detail = [requirement.type, requirement.count, requirement.note].filter(value => value != null && value !== '').join(' · ');
          if (detail) block.appendChild(element('div', `Exigence : ${detail}`));
        }
        for (const concept of correction.concepts || []) {
          const detail = element('div');
          detail.style.marginTop = '5px';
          detail.appendChild(element('div', `${concept.label || concept.id}${Number.isFinite(concept.score) ? ` · ${concept.score} pt` : ''}`));
          if (concept.terms?.length) detail.appendChild(element('div', `Mots clés : ${concept.terms.join(' · ')}`));
          if (concept.riskyTerms?.length) {
            const label = concept.riskyTerms.length === 1 ? 'Terme à vérifier' : 'Termes à vérifier';
            detail.appendChild(element('div', `${label} : ${concept.riskyTerms.join(' · ')}`));
          }
          block.appendChild(detail);
        }
        if (Array.isArray(row.issues) && row.issues.length) {
          block.appendChild(element('div', row.issues.map(issue => issue.message || issue.code).filter(Boolean).join(' · ')));
        }
        panel.appendChild(block);
      }
      return panel;
    }

    function progressBar(record) {
      const wrap = element('div');
      wrap.style.marginTop = '8px';
      const track = element('div');
      Object.assign(track.style, {
        height: '4px',
        borderRadius: '999px',
        overflow: 'hidden',
        background: 'rgba(128,128,128,.25)'
      });
      const fill = element('div');
      Object.assign(fill.style, {
        height: '100%',
        width: '0%',
        background: 'currentColor',
        transition: 'width .18s ease'
      });
      track.appendChild(fill);
      const label = element('div');
      label.style.marginTop = '4px';
      label.style.fontSize = '12px';
      label.style.opacity = '.75';
      wrap.append(track, label);
      record.progressFill = fill;
      record.progressLabel = label;
      return wrap;
    }

    function setProgress(record, event = {}) {
      if (!record?.shell) return;
      if (!record.progressFill || !record.progressLabel) return;
      const percent = Number.isFinite(event.percent) ? Math.max(0, Math.min(100, event.percent)) : null;
      if (percent != null) record.progressFill.style.width = `${percent}%`;
      record.progressLabel.textContent = oneLine(event.label) || (percent != null ? `${percent}%` : '');
    }

    function renderResponse(record, response) {
      record.response = response;
      if (!response?.ok && response?.state === 'target_selection_required') {
        renderChooser(record, response);
        return;
      }
      if (!response?.ok && response?.error) {
        renderError(record, response.error);
        return;
      }

      const view = response?.view || {};
      record.token = response?.token || record.token || null;
      record.shell.replaceChildren();

      const top = element('div');
      top.style.display = 'flex';
      top.style.gap = '10px';
      top.style.alignItems = 'center';
      const body = element('div');
      body.style.flex = '1';
      const heading = element('div');
      Object.assign(heading.style, { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' });
      const title = element('div', 'Cardinal Formative');
      title.style.fontWeight = '750';
      const status = element('span', view.statusLabel || (response.ok ? '✓ Prêt' : 'Cardinal'));
      Object.assign(status.style, {
        fontSize: '11px',
        fontWeight: '700',
        padding: '2px 7px',
        borderRadius: '999px',
        border: '1px solid rgba(128,128,128,.24)',
        opacity: '.82'
      });
      heading.append(title, status);
      const summaryText = summarizeView(view);
      const summary = element('div', summaryText);
      summary.style.marginTop = summaryText ? '4px' : '0';
      summary.style.opacity = '.76';
      body.append(heading, summary);

      const close = element('button', '×');
      close.type = 'button';
      close.title = 'Masquer cette version';
      Object.assign(close.style, {
        appearance: 'none',
        WebkitAppearance: 'none',
        border: '0',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: '18px',
        lineHeight: '1',
        opacity: '.62',
        padding: '2px 4px'
      });
      close.addEventListener('click', () => dismiss(record));
      top.append(body, close);
      record.shell.appendChild(top);
      record.progressFill = null;
      record.progressLabel = null;
      if (['importing', 'recovery', 'uncertain'].includes(String(response?.state || ''))) {
        record.shell.appendChild(progressBar(record));
      }

      if (view.showCorrectionButton || (view.validationRows || []).length) {
        const correction = element('button', 'Voir le corrigé préparé');
        correction.type = 'button';
        styleButton(correction, 'secondary');
        correction.addEventListener('click', () => {
          const existing = record.shell.querySelector?.('[data-cardinal-formative-review="1"]');
          if (existing) existing.remove();
          else record.shell.appendChild(correctionPanel(record, view));
        });
        record.shell.appendChild(correction);
      }

      const action = view.primaryAction || {};
      const selectionRows = questionSelectionRows(record.pkg);
      if (selectionRows.length > 1 && response.state !== 'importing') {
        const selectedCount = Array.isArray(record.selectedQuestionIds) && record.selectedQuestionIds.length
          ? record.selectedQuestionIds.length
          : selectionRows.length;
        const choose = element(
          'button',
          `Questions ${selectedCount}/${selectionRows.length} · Modifier`
        );
        choose.type = 'button';
        styleButton(choose, 'secondary');
        choose.addEventListener('click', () => {
          record.selectionConfirmed = false;
          renderQuestionSelector(record);
        });
        record.shell.appendChild(choose);
      }

      if (action.id && action.id !== 'none') {
        const button = element('button', action.label || 'Importer dans Formative');
        button.type = 'button';
        button.disabled = action.enabled === false;
        styleButton(button, action.emphasis === 'warning' ? 'secondary' : 'primary');
        button.addEventListener('click', () => act(record, button));
        record.actionButton = button;
        record.shell.appendChild(button);
      }
      if (response.state === 'ready') setProgress(record, { percent: 42, label: 'Prêt à importer' });
      if (response.state === 'completed') {
        setProgress(record, { percent: 100, label: 'Import vérifié' });
        // A later reimport is a fresh decision. Re-open the selector and start
        // from the original package rather than silently reusing a past subset.
        record.selectionConfirmed = false;
        record.selectedQuestionIds = null;
        record.activePkg = record.pkg;
      }
    }

    async function prepare(record, target = {}, pkgOverride = null) {
      record.shell.replaceChildren(element('div', 'Cardinal analyse le questionnaire et le Formative ouvert…'));
      try {
        const pkgToPrepare = pkgOverride || record.activePkg || record.pkg;
        record.activePkg = pkgToPrepare;
        const response = await send('CARDINAL_FORMATIVE_IMPORT_PREPARE', {
          pkg: pkgToPrepare,
          ...target
        });
        renderResponse(record, response);
      } catch (error) {
        if (error?.code === 'EXTENSION_CONTEXT_INVALIDATED' && reloadOnceForInvalidContext()) return;
        renderError(record, error);
      }
    }

    async function act(record, button) {
      if (!record.token) return;
      const view = record.response?.view || {};

      if (shouldOfferQuestionSelection(record, view)) {
        renderQuestionSelector(record);
        return;
      }

      const intent = actionIntent(view, record.reviewAcknowledged === true);

      if (intent.command === 'OPEN_REVIEW') {
        const existing = record.shell.querySelector?.('[data-cardinal-formative-review="1"]');
        if (!existing) record.shell.appendChild(correctionPanel(record, view));
        record.reviewAcknowledged = true;
        if (view.primaryAction?.id === 'import-review') {
          button.textContent = 'Importer après vérification';
        }
        return;
      }

      if (intent.command === 'NONE') return;
      button.disabled = true;
      try {
        let response;
        if (intent.command === 'APPLY') {
          response = await send('CARDINAL_FORMATIVE_IMPORT_APPLY', {
            token: record.token,
            acknowledgeWarnings: intent.acknowledgeWarnings === true
          });
        } else if (intent.command === 'REPREPARE') {
          response = await send('CARDINAL_FORMATIVE_IMPORT_REPREPARE', { token: record.token });
        } else if (intent.command === 'RECONCILE_SAFE') {
          const suggestions = Array.isArray(view.suggestedLinks) ? view.suggestedLinks : [];
          response = await send('CARDINAL_FORMATIVE_IMPORT_RECONCILE', {
            token: record.token,
            approvedProposals: suggestions,
            separateProposals: [],
            useSuggestedLinks: true
          });
        }
        renderResponse(record, response);
      } catch (error) {
        if (error?.code === 'EXTENSION_CONTEXT_INVALIDATED' && reloadOnceForInvalidContext()) return;
        renderError(record, error);
      } finally {
        button.disabled = false;
      }
    }

    async function dismiss(record) {
      await persistDismissed(record.signature);
      if (record.token) {
        send('CARDINAL_FORMATIVE_IMPORT_DISMISS', { token: record.token }).catch(() => {});
      }
      record.shell?.remove?.();
      bars.delete(record.signature);
    }

    function removeSuperseded(activeSignatures) {
      for (const [sig, record] of bars) {
        if (activeSignatures.has(sig)) continue;
        record.shell?.remove?.();
        bars.delete(sig);
      }
    }

    async function renderInvalid(message, error) {
      const node = message.technicalNode;
      if (!node) return;
      if (error?.code === 'PACKAGE_JSON_INCOMPLETE') {
        const first = incompleteSince.get(node) || Date.now();
        incompleteSince.set(node, first);
        if (Date.now() - first < INCOMPLETE_GRACE_MS) return;
      }
      const raw = String(node.textContent || '');
      const sig = await signature(`invalid:${raw}`);
      if (bars.has(sig)) return;
      const dismissed = await dismissedSet();
      if (dismissed.has(sig)) return;
      const record = {
        signature: sig,
        pkg: null,
        messageRoot: message.messageRoot,
        technicalNode: node
      };
      record.shell = insertShell(record);
      bars.set(sig, record);
      renderError(record, error);
    }

    async function scanNow() {
      if (stopped) {
        return { ok: false, scanned: false, packages: 0, bars: bars.size, invalid: 0, ignored: 0 };
      }
      let result;
      try {
        result = scanner.scan(doc, parser);
      } catch (error) {
        return {
          ok: false,
          scanned: false,
          packages: 0,
          bars: bars.size,
          invalid: 0,
          ignored: 0,
          error: error?.message || String(error)
        };
      }

      const found = [];
      let invalidCount = 0;
      for (const message of result.messages || []) {
        if (message.parse?.state === 'found' && message.parse.package?.pkg) {
          found.push({ message, parsed: message.parse.package });
        } else if (message.parse?.state === 'invalid' || message.parse?.state === 'ambiguous') {
          invalidCount += 1;
          await renderInvalid(message, message.parse.error);
        }
      }

      // Only the newest package for the same assessment remains actionable.
      const latestByAssessment = new Map();
      for (const row of found) latestByAssessment.set(assessmentKey(row.parsed.pkg), row);
      const dismissed = await dismissedSet();
      const activeSignatures = new Set();

      for (const row of latestByAssessment.values()) {
        const sig = await signature(row.parsed.rawJson || JSON.stringify(row.parsed.pkg));
        hideTechnical(row.message.technicalNode);
        if (dismissed.has(sig)) continue;
        activeSignatures.add(sig);
        const existing = bars.get(sig);
        if (existing && (existing.messageRoot !== row.message.messageRoot || !existing.shell?.parentNode || existing.shell.isConnected === false)) {
          existing.shell?.remove?.();
          bars.delete(sig);
        }
        if (bars.has(sig)) continue;

        const record = {
          signature: sig,
          pkg: row.parsed.pkg,
          messageRoot: row.message.messageRoot,
          technicalNode: row.message.technicalNode,
          token: null,
          response: null,
          reviewAcknowledged: false,
          activePkg: row.parsed.pkg,
          selectionConfirmed: false,
          selectedQuestionIds: null
        };
        record.shell = insertShell(record);
        bars.set(sig, record);
        await prepare(record);
      }
      removeSuperseded(activeSignatures);
      return {
        ok: true,
        scanned: true,
        packages: found.length,
        bars: bars.size,
        invalid: invalidCount,
        ignored: (result.ignored || []).length
      };
    }

    function scheduleScan() {
      if (stopped) return;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scanNow().catch(() => {});
      }, SCAN_DEBOUNCE_MS);
    }

    function isOwnMutation(record) {
      const target = record?.target;
      const host = target?.nodeType === 3 ? target.parentNode : target;
      if (host && scanner.insideCardinalUi?.(host)) return true;
      const added = [...(record?.addedNodes || [])];
      const removed = [...(record?.removedNodes || [])];
      if (removed.length || !added.length) return false;
      return added.every(node => scanner.isCardinalUiElement?.(node));
    }

    function onMutations(records) {
      if (Array.isArray(records) && records.length && records.every(isOwnMutation)) return;
      scheduleScan();
    }

    function onRuntimeMessage(message, _sender, sendResponse) {
      if (message?.type === UI_RESCAN_MESSAGE) {
        Promise.resolve(scanNow())
          .then(summary => sendResponse?.(summary))
          .catch(error => sendResponse?.({
            ok: false,
            scanned: false,
            packages: 0,
            bars: bars.size,
            invalid: 0,
            ignored: 0,
            error: error?.message || String(error)
          }));
        return true;
      }
      if (message?.type !== 'CARDINAL_FORMATIVE_IMPORT_PROGRESS') return false;
      const event = message.payload || {};
      for (const record of bars.values()) {
        if (record.token && String(record.token) === String(event.runId || '')) {
          setProgress(record, event);
        }
      }
      return false;
    }

    function start() {
      if (stopped) stopped = false;
      if (typeof runtime.onMessage?.addListener === 'function') {
        runtime.onMessage.addListener(onRuntimeMessage);
      }
      if (MutationObserverApi) {
        observer = new MutationObserverApi(onMutations);
        observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true, characterData: true });
      }
      scheduleScan();
      return api;
    }

    function stop() {
      stopped = true;
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = null;
      observer?.disconnect?.();
      observer = null;
      if (typeof runtime.onMessage?.removeListener === 'function') {
        runtime.onMessage.removeListener(onRuntimeMessage);
      }
      return true;
    }

    const api = Object.freeze({ start, stop, scanNow, scheduleScan, onMutations, isOwnMutation, onRuntimeMessage });
    return api;
  }

  const exported = {
    DISMISS_STORAGE_KEY,
    BAR_PREFIX,
    UI_RESCAN_MESSAGE,
    assessmentKey,
    fallbackHash,
    signature,
    invalidContextMessage,
    summarizeView,
    actionIntent,
    questionSelectionRows,
    buildSelectedQuestionPackage,
    shouldOfferQuestionSelection,
    buttonStyle,
    createContentBridge
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  globalThis.CardinalFormativeV2ChatGPTContent = exported;
})();
