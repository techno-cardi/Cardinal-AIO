(() => {
  'use strict';

  const REVIEW_SELECTOR = '[data-cardinal-formative-review="1"]';
  const AUDIT_ATTR = 'data-cardinal-formative-exact-audit';

  function oneLine(value) {
    return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeTerm(value, caseSensitive = false) {
    let text = oneLine(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-')
      .toLowerCase();
    if (caseSensitive) text = oneLine(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘`´]/g, "'")
      .replace(/[‐‑‒–—−]/g, '-');
    return text.trim();
  }

  // Keep this behaviour aligned with adapter-v2.js. The audit panel must show
  // the real matches Cardinal will send, not only the model's source terms.
  function expandMechanicalVariants(term, options = {}) {
    const caseSensitive = options.caseSensitive === true;
    const source = oneLine(term);
    if (!source) return [];

    const values = new Set([source]);
    const apostrophe = source.replace(/[’‘`´]/g, "'");
    values.add(apostrophe);

    const deaccented = apostrophe.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    values.add(deaccented);

    if (/[A-Za-zÀ-ÿ]-[A-Za-zÀ-ÿ]/.test(source)) {
      values.add(source.replace(/-/g, ' '));
      values.add(deaccented.replace(/-/g, ' '));
    }

    if (!caseSensitive) {
      for (const value of [...values]) values.add(value.toLowerCase());
    }

    return [...values].filter(Boolean);
  }

  function exactMatches(item = {}) {
    const grading = item.grading || {};
    if (grading.mode === 'manual') return [];
    const caseSensitive = grading.caseSensitive === true;
    const byOutput = new Map();
    const canonicalScores = new Map();

    for (const concept of grading.concepts || []) {
      const score = Number(concept?.score || 0);
      for (const rawTerm of concept?.terms || []) {
        for (const variant of expandMechanicalVariants(rawTerm, { caseSensitive })) {
          const canonical = normalizeTerm(variant, caseSensitive);
          if (!canonical) continue;
          const previous = canonicalScores.get(canonical);
          if (previous != null && previous !== score) {
            const error = new Error(`Le terme « ${variant} » possède deux pointages après normalisation.`);
            error.code = 'AUDIT_TERM_SCORE_CONFLICT';
            throw error;
          }
          canonicalScores.set(canonical, score);

          let key = oneLine(variant)
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑‒–—−]/g, '-');
          if (!caseSensitive) key = key.toLowerCase();
          if (!byOutput.has(key)) byOutput.set(key, { text: variant, score });
        }
      }
    }

    let matches = [...byOutput.values()];

    if (['shortAnswer', 'longAnswer'].includes(item?.subtype) && grading.mode !== 'manual') {
      const maximum = Number(item?.points?.value);
      const expectedAnswer = oneLine(grading.expectedAnswer);
      const hasMaximumMatch = Number.isFinite(maximum) &&
        matches.some(match => Number(match?.score) === maximum);

      if (Number.isFinite(maximum) && !hasMaximumMatch && expectedAnswer) {
        const expectedCanonical = normalizeTerm(expectedAnswer, caseSensitive);
        const previous = canonicalScores.get(expectedCanonical);
        if (previous != null && previous !== maximum) {
          const error = new Error(`La réponse attendue complète possède déjà un pointage partiel (${previous}) différent du maximum (${maximum}).`);
          error.code = 'AUDIT_MAX_ANCHOR_CONFLICT';
          throw error;
        }
        if (previous == null) {
          canonicalScores.set(expectedCanonical, maximum);
          matches = [{ text: expectedAnswer, score: maximum }, ...matches];
        }
      }
    }

    return matches;
  }

  function exactBlankAnswers(item = {}) {
    const caseSensitive = item?.grading?.caseSensitive === true;
    return (item?.response?.blanks || []).map(blank => {
      const seen = new Set();
      const answers = [];
      for (const raw of blank?.answers || []) {
        for (const variant of expandMechanicalVariants(raw, { caseSensitive })) {
          let key = oneLine(variant)
            .replace(/[’‘`´]/g, "'")
            .replace(/[‐‑‒–—−]/g, '-');
          if (!caseSensitive) key = key.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          answers.push(variant);
        }
      }
      return { id: oneLine(blank?.id) || 'blanc', answers };
    });
  }

  function groupMatches(matches = []) {
    const groups = new Map();
    for (const row of matches) {
      const key = Number(row.score || 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(oneLine(row.text));
    }
    return [...groups.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([score, terms]) => ({ score, terms: [...new Set(terms)].sort((a, b) => a.localeCompare(b, 'fr')) }));
  }

  function formatQuestionAudit(item = {}, visibleNumber = null) {
    const grading = item.grading || {};
    const number = oneLine(item?.source?.number) || oneLine(visibleNumber) || oneLine(item.id) || 'Question';
    const points = Number(item?.points?.value || 0);
    const mode = grading.mode === 'auto' ? 'Auto' : grading.mode === 'assisted' ? 'Assistée' : 'Manuelle';
    const expectedAnswer = oneLine(grading.expectedAnswer);
    const risky = [];
    for (const concept of grading.concepts || []) {
      for (const term of concept?.riskyTerms || []) risky.push(oneLine(term));
    }
    return {
      itemId: item.id || null,
      number,
      prompt: oneLine(item.prompt),
      subtype: item.subtype || null,
      points,
      mode,
      expectedAnswer,
      groups: item.subtype === 'fillInTheBlank' ? [] : groupMatches(exactMatches(item)),
      blanks: item.subtype === 'fillInTheBlank' ? exactBlankAnswers(item) : [],
      riskyTerms: [...new Set(risky.filter(Boolean))],
      caseSensitive: grading.caseSensitive === true
    };
  }

  function auditRows(pkg = {}) {
    const items = [...(pkg.items || [])]
      .filter(item => item?.kind === 'question')
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    return items.map((item, index) => formatQuestionAudit(item, index + 1));
  }

  function element(doc, tag, text = '') {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function renderAudit(doc, panel, pkg) {
    panel.replaceChildren();
    panel.setAttribute(AUDIT_ATTR, '1');

    const intro = element(doc, 'div', 'Corrigé exact envoyé à Formative');
    intro.style.fontWeight = '650';
    const note = element(doc, 'div', 'Les variantes mécaniques (accents, apostrophes et certains traits d’union) sont incluses ci-dessous. Les termes risqués restent exclus de l’autocorrection.');
    note.style.marginTop = '3px';
    note.style.opacity = '.78';
    note.style.fontSize = '12px';
    panel.append(intro, note);

    for (const row of auditRows(pkg)) {
      const details = element(doc, 'details');
      details.style.marginTop = '8px';
      const totalTerms = row.groups.reduce((n, group) => n + group.terms.length, 0) + row.blanks.reduce((n, blank) => n + blank.answers.length, 0);
      const unit = row.subtype === 'fillInTheBlank' ? 'réponses acceptées' : 'mots-clés';
      const summary = element(doc, 'summary', `${row.number} · ${row.mode} · ${row.points} pt${totalTerms ? ` · ${totalTerms} ${unit}` : ''}`);
      summary.style.cursor = 'pointer';
      summary.style.fontWeight = '600';
      details.appendChild(summary);

      if (row.expectedAnswer) {
        const answer = element(doc, 'div', `Réponse attendue: ${row.expectedAnswer}`);
        answer.style.marginTop = '4px';
        details.appendChild(answer);
      }

      if (row.blanks.length) {
        for (const blank of row.blanks) {
          const line = element(doc, 'div', `Blanc ${blank.id}: ${blank.answers.join(', ')}`);
          line.style.marginTop = '3px';
          details.appendChild(line);
        }
      } else if (row.groups.length) {
        for (const group of row.groups) {
          const line = element(doc, 'div', `${group.score} pt: ${group.terms.join(', ')}`);
          line.style.marginTop = '3px';
          details.appendChild(line);
        }
      } else if (row.mode === 'Manuelle') {
        const manual = element(doc, 'div', 'Correction manuelle: aucun mot-clé automatique envoyé.');
        manual.style.marginTop = '3px';
        details.appendChild(manual);
      }

      if (row.riskyTerms.length) {
        const risky = element(doc, 'div', `Non importés automatiquement: ${row.riskyTerms.join(', ')}`);
        risky.style.marginTop = '3px';
        risky.style.opacity = '.72';
        details.appendChild(risky);
      }

      panel.appendChild(details);
    }
    return panel;
  }

  function createEnhancer(options = {}) {
    const doc = options.document || globalThis.document;
    const scanner = options.scanner || globalThis.CardinalFormativeV2ChatGPTScanner;
    const parser = options.parser || globalThis.CardinalFormativeV2PackageParser;
    const setTimer = options.setTimeout || globalThis.setTimeout;
    if (!doc || !scanner || !parser) throw new Error('ChatGPT correction audit dependencies unavailable');
    let started = false;

    function packageForShell(shell) {
      const scan = scanner.scan(doc, parser);
      for (const message of scan.messages || []) {
        if (!message?.parse?.package?.pkg) continue;
        if (message.messageRoot?.contains?.(shell)) return message.parse.package.pkg;
      }
      return null;
    }

    function enhanceButton(button) {
      const shell = button?.closest?.('[data-cardinal-formative-signature]');
      if (!shell) return false;
      const pkg = packageForShell(shell);
      if (!pkg) return false;
      const panel = shell.querySelector?.(REVIEW_SELECTOR);
      if (!panel) return false;
      try {
        renderAudit(doc, panel, pkg);
        return true;
      } catch (error) {
        panel.replaceChildren(element(doc, 'div', 'Cardinal n’a pas pu afficher le corrigé exact. L’import reste bloqué si les pointages sont incohérents.'));
        panel.setAttribute(AUDIT_ATTR, 'error');
        return false;
      }
    }

    function onClick(event) {
      const button = event?.target?.closest?.('button');
      if (!button || oneLine(button.textContent) !== 'Voir le corrigé préparé') return;
      setTimer(() => enhanceButton(button), 0);
    }

    function start() {
      if (started) return api;
      started = true;
      doc.addEventListener('click', onClick, true);
      return api;
    }

    function stop() {
      if (!started) return false;
      started = false;
      doc.removeEventListener('click', onClick, true);
      return true;
    }

    const api = Object.freeze({ start, stop, enhanceButton, packageForShell });
    return api;
  }

  const api = {
    REVIEW_SELECTOR,
    AUDIT_ATTR,
    normalizeTerm,
    expandMechanicalVariants,
    exactMatches,
    exactBlankAnswers,
    groupMatches,
    formatQuestionAudit,
    auditRows,
    renderAudit,
    createEnhancer
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2CorrectionAudit = api;

  if (typeof globalThis.document !== 'undefined' && typeof globalThis.chrome !== 'undefined') {
    try {
      globalThis.__cardinalFormativeCorrectionAuditV2 ||= createEnhancer().start();
    } catch (error) {
      console.error('[Cardinal Formative] correction audit', error);
    }
  }
})();
