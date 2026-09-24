(() => {
  'use strict';

  const TURN_SELECTORS = Object.freeze([
    '[data-message-author-role]',
    '[data-turn]',
    '[data-role]',
    '[data-message-author]',
    '[data-chatgpt-search-unit-key]',
    '[data-content-search-unit-key]',
    '[data-conversation-role]',
    '[data-markdown-text-style]',
    '[data-user-message-bubble]',
    '[data-testid^="conversation-turn-"]',
    'article'
  ]);

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function normalizedRole(value) {
    const role = value == null ? '' : String(value).trim().toLowerCase();
    return role === 'assistant' || role === 'user' ? role : null;
  }

  function roleAttr(node) {
    if (!node || typeof node.getAttribute !== 'function') return null;
    for (const name of ['data-message-author-role', 'data-turn', 'data-role', 'data-message-author', 'data-conversation-role']) {
      const role = normalizedRole(node.getAttribute(name));
      if (role) return role;
    }

    for (const name of ['data-chatgpt-search-unit-key', 'data-content-search-unit-key']) {
      const key = String(node.getAttribute(name) || '');
      const match = key.match(/:(assistant|user)$/i);
      if (match) return match[1].toLowerCase();
    }

    const markdownStyle = String(node.getAttribute('data-markdown-text-style') || '').toLowerCase();
    if (markdownStyle === 'assistant-message') return 'assistant';
    if (/user/.test(markdownStyle)) return 'user';
    if (node.getAttribute('data-user-message-bubble') != null) return 'user';

    const cls = String(node.className || node.getAttribute('class') || '');
    if (/(?:^|\s)agent-turn(?:\s|$)/i.test(cls)) return 'assistant';
    if (/(?:^|\s)user-turn(?:\s|$)/i.test(cls)) return 'user';
    if (/(?:^|\s|\/)(?:bg-|text-|group\/)?user-message(?:\s|$)/i.test(cls)) return 'user';
    return null;
  }

  function ancestorChain(node, limit = 30) {
    const out = [];
    let current = node;
    while (current && out.length < limit) {
      out.push(current);
      current = current.parentElement || null;
    }
    return out;
  }

  function closestArticle(node) {
    for (const current of ancestorChain(node)) {
      if (typeof current.matches === 'function' && current.matches('article')) return current;
      if (String(current?.tagName || '').toLowerCase() === 'article') return current;
    }
    return null;
  }

  function isConversationTurn(node) {
    const testId = typeof node?.getAttribute === 'function' ? node.getAttribute('data-testid') : null;
    return /^conversation-turn-/i.test(String(testId || ''));
  }

  function queryAll(node, selector) {
    if (!node || typeof node.querySelectorAll !== 'function') return [];
    try { return [...node.querySelectorAll(selector)]; }
    catch { return []; }
  }

  function descendantRoles(node) {
    const roles = new Set();
    const own = roleAttr(node);
    if (own) roles.add(own);
    for (const selector of [
      '[data-message-author-role]',
      '[data-turn]',
      '[data-role]',
      '[data-message-author]',
      '[data-chatgpt-search-unit-key]',
      '[data-content-search-unit-key]',
      '[data-conversation-role]',
      '[data-markdown-text-style]',
      '[data-user-message-bubble]'
    ]) {
      for (const child of queryAll(node, selector)) {
        const role = roleAttr(child);
        if (role) roles.add(role);
      }
    }
    return roles;
  }

  function hasAssistantAction(node) {
    if (!node) return false;
    if (queryAll(node, 'button[data-testid="copy-turn-action-button"]').length) return true;
    try {
      if (typeof node.querySelector === 'function') {
        return Boolean(
          node.querySelector('button[data-testid="copy-turn-action-button"]') ||
          node.querySelector('button[aria-label*="Copy response" i]') ||
          node.querySelector('button[aria-label*="Copier la réponse" i]')
        );
      }
    } catch {}
    return false;
  }

  function inferRole(node) {
    const roles = descendantRoles(node);
    if (roles.size === 1) return { role: [...roles][0], evidence: 'explicit-role' };
    if (roles.size > 1) return { role: 'ambiguous', evidence: 'mixed-roles' };
    if (hasAssistantAction(node)) return { role: 'assistant', evidence: 'assistant-action' };
    return { role: 'unknown', evidence: 'unproven' };
  }

  function closestTurnShell(node) {
    for (const current of ancestorChain(node, 20)) {
      if (roleAttr(current)) return current;
      if (isConversationTurn(current)) return current;
      const tag = String(current?.tagName || '').toLowerCase();
      if (tag === 'article') return current;
      if (tag === 'section' && typeof current.getAttribute === 'function' && current.getAttribute('data-turn')) return current;
    }
    return null;
  }

  function messageContext(node) {
    for (const current of ancestorChain(node)) {
      const role = roleAttr(current);
      if (role) return { role, root: current, evidence: 'role-ancestor' };
    }

    const shell = closestTurnShell(node);
    if (shell) {
      const inferred = inferRole(shell);
      if (inferred.role !== 'unknown') {
        return { role: inferred.role, root: shell, evidence: inferred.evidence };
      }
    }

    const article = closestArticle(node);
    if (article && typeof article.querySelectorAll === 'function') {
      const roles = descendantRoles(article);
      if (roles.size === 1) return { role: [...roles][0], root: article, evidence: 'article-descendant-role' };
      if (roles.size > 1) return { role: 'ambiguous', root: article, evidence: 'article-mixed-roles' };
      if (hasAssistantAction(article)) return { role: 'assistant', root: article, evidence: 'assistant-action' };
    }

    return { role: 'unknown', root: shell || article, evidence: 'unproven' };
  }

  function canonicalTechnicalNode(node) {
    if (!node) return null;
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'pre') return node;
    if (tag === 'code') {
      for (const parent of ancestorChain(node, 8).slice(1)) {
        if (String(parent?.tagName || '').toLowerCase() === 'pre') return parent;
      }
    }
    return node;
  }

  function textOf(node) {
    return String(node?.textContent || node?.innerText || '');
  }

  const CARDINAL_UI_ATTRIBUTES = Object.freeze([
    'data-cardinal-ui',
    'data-cardinal-formative-signature',
    'data-cardinal-results-bar-v118',
    'data-cardinal-results-bar-v119'
  ]);

  function isCardinalUiElement(node) {
    if (!node || typeof node.getAttribute !== 'function') return false;
    for (const name of CARDINAL_UI_ATTRIBUTES) {
      if (node.getAttribute(name) != null) return true;
    }
    if (typeof node.getAttributeNames === 'function') {
      try {
        if (node.getAttributeNames().some(name => /^data-cardinal-results-bar/i.test(name))) return true;
      } catch {}
    }
    const id = String(node.getAttribute('id') || node.id || '');
    return /^cardinal/i.test(id);
  }

  function insideCardinalUi(node, boundary = null) {
    for (const current of ancestorChain(node, 60)) {
      if (isCardinalUiElement(current)) return true;
      if (boundary && current === boundary) return false;
    }
    return false;
  }

  function visibleText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return String(node.nodeValue ?? node.textContent ?? '');
    if (isCardinalUiElement(node)) return '';
    const kids = node.childNodes || node.children;
    if (!kids || typeof kids.length !== 'number' || kids.length === 0) return textOf(node);
    let out = '';
    for (const child of [...kids]) out += visibleText(child);
    return out;
  }

  function collectTurnRoots(root) {
    const out = [];
    const seen = new Set();
    for (const selector of TURN_SELECTORS) {
      for (const node of queryAll(root, selector)) {
        if (!node || seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }

  function collectCandidates(root, parser) {
    required(root, 'ChatGPT document/root');
    required(parser, 'package parser');
    if (typeof root.querySelectorAll !== 'function') throw new Error('root.querySelectorAll required');

    const sentinel = parser.SENTINEL || 'CARDINAL_FORMATIVE_PACKAGE_V2';
    const seenNodes = new Set();
    const candidates = [];
    const ignored = [];

    for (const rawRoot of collectTurnRoots(root)) {
      const context = inferRole(rawRoot);
      if (insideCardinalUi(rawRoot)) continue;
      const text = visibleText(rawRoot);
      if (!text.includes(sentinel)) continue;
      if (context.role !== 'assistant') {
        ignored.push({
          node: rawRoot,
          context: { ...context, root: rawRoot },
          reason: context.role === 'user' ? 'user-message' : 'assistant-not-proven'
        });
        continue;
      }
      candidates.push({
        node: null,
        text,
        messageRoot: rawRoot,
        context: { ...context, root: rawRoot },
        markerInBlock: false,
        wholeMessage: true
      });
    }

    for (const rawNode of queryAll(root, 'pre, code')) {
      const node = canonicalTechnicalNode(rawNode);
      if (!node || seenNodes.has(node)) continue;
      seenNodes.add(node);
      if (insideCardinalUi(node)) continue;
      const text = visibleText(node);
      const context = messageContext(node);
      const markerInBlock = text.includes(sentinel);
      const markerInMessage = context.root && visibleText(context.root).includes(sentinel);
      if (!markerInBlock && !markerInMessage) continue;
      if (context.role !== 'assistant') {
        ignored.push({ node, context, reason: context.role === 'user' ? 'user-message' : 'assistant-not-proven' });
        continue;
      }
      candidates.push({ node, text, messageRoot: context.root, context, markerInBlock, wholeMessage: false });
    }

    return { candidates, ignored };
  }

  function groupByMessage(candidates) {
    const groups = [];
    const map = new Map();
    for (const candidate of candidates || []) {
      const key = candidate.messageRoot || candidate.node;
      let group = map.get(key);
      if (!group) {
        group = { messageRoot: candidate.messageRoot || null, candidates: [] };
        map.set(key, group);
        groups.push(group);
      }
      group.candidates.push(candidate);
    }
    return groups;
  }

  function findTechnicalNode(messageRoot, rawJson) {
    if (!messageRoot || !rawJson) return null;
    const seen = new Set();
    for (const rawNode of queryAll(messageRoot, 'pre, code')) {
      const node = canonicalTechnicalNode(rawNode);
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (visibleText(node).includes(rawJson)) return node;
    }
    return null;
  }

  function scan(root, parser, options = {}) {
    const collected = collectCandidates(root, parser);
    const groups = groupByMessage(collected.candidates);
    const messages = groups.map(group => {
      const markedBlocks = group.candidates.filter(row => row.markerInBlock);
      const whole = group.candidates.find(row => row.wholeMessage === true);
      const messageText = visibleText(group.messageRoot) || whole?.text || '';
      const sentinel = parser.SENTINEL || 'CARDINAL_FORMATIVE_PACKAGE_V2';
      let parseFromMessage = false;
      let parsed;

      // More than one complete technical package in one assistant answer is
      // an explicit ambiguity. Parse the blocks independently before any
      // message-level concatenation can blur that distinction.
      if (markedBlocks.length > 1) {
        parsed = parser.parseCandidates(markedBlocks.map(row => row.text), options);
      } else {
        parseFromMessage = messageText.includes(sentinel);
        parsed = parser.parseCandidates(
          parseFromMessage ? [messageText] : markedBlocks.map(row => row.text), options
        );

        if (!parseFromMessage && markedBlocks.length === 0 && whole?.text) {
          parsed = parser.parseCandidates([whole.text], options);
          parseFromMessage = true;
        } else if (!parseFromMessage && parsed.state === 'invalid' && messageText.includes(sentinel)) {
          const combined = parser.parseCandidates([messageText], options);
          if (combined.state === 'found' || combined.state === 'ambiguous') {
            parsed = combined;
            parseFromMessage = true;
          }
        }
      }

      const technicalNode = parseFromMessage
        ? findTechnicalNode(group.messageRoot, parsed?.package?.rawJson) ||
          group.candidates.find(row => row.node && parsed?.package?.rawJson && row.text.includes(parsed.package.rawJson))?.node ||
          null
        : parsed?.package
          ? markedBlocks[parsed.package.candidateIndex]?.node || null
          : markedBlocks[0]?.node || null;

      return {
        messageRoot: group.messageRoot,
        technicalNode,
        candidates: group.candidates,
        parse: parsed
      };
    });
    return { messages, ignored: collected.ignored };
  }

  function isBefore(a, b) {
    if (!a || !b || a === b || typeof a.compareDocumentPosition !== 'function') return false;
    const position = a.compareDocumentPosition(b);
    return Boolean(position & 4);
  }

  function lastTableBefore(messageRoot, technicalNode) {
    if (!messageRoot || typeof messageRoot.querySelectorAll !== 'function') return null;
    const tables = [...messageRoot.querySelectorAll('table')];
    if (!technicalNode) return tables.at(-1) || null;
    let selected = null;
    for (const table of tables) {
      if (isBefore(table, technicalNode)) selected = table;
    }
    return selected;
  }

  function lowestCommonAncestor(a, b, boundary = null) {
    if (!a || !b) return boundary || null;
    const aAncestors = new Set(ancestorChain(a, 60));
    for (const current of ancestorChain(b, 60)) {
      if (aAncestors.has(current)) return current;
      if (boundary && current === boundary) return boundary;
    }
    return boundary || null;
  }

  function directChildUnder(ancestor, node) {
    if (!ancestor || !node) return null;
    let current = node;
    let previous = node;
    while (current && current !== ancestor) {
      previous = current;
      current = current.parentElement || null;
    }
    return current === ancestor ? previous : null;
  }

  function placementAnchor(messageRoot, technicalNode) {
    const table = lastTableBefore(messageRoot, technicalNode);
    if (!table) {
      if (!technicalNode) {
        return { mode: 'append-end', anchor: null, parent: messageRoot || null, table: null };
      }
      const parent = technicalNode?.parentElement || null;
      return { mode: 'before-technical', anchor: technicalNode || null, parent, table: null };
    }

    const lca = technicalNode
      ? (lowestCommonAncestor(table, technicalNode, messageRoot) || messageRoot)
      : (messageRoot || table.parentElement || null);
    const tableBranch = directChildUnder(lca, table) || table;
    return {
      mode: 'after-validation-table',
      anchor: tableBranch,
      parent: tableBranch?.parentElement || lca || null,
      table
    };
  }

  const api = {
    TURN_SELECTORS,
    CARDINAL_UI_ATTRIBUTES,
    normalizedRole,
    roleAttr,
    ancestorChain,
    closestArticle,
    isConversationTurn,
    descendantRoles,
    hasAssistantAction,
    inferRole,
    closestTurnShell,
    messageContext,
    canonicalTechnicalNode,
    textOf,
    isCardinalUiElement,
    insideCardinalUi,
    visibleText,
    collectTurnRoots,
    collectCandidates,
    groupByMessage,
    findTechnicalNode,
    scan,
    isBefore,
    lastTableBefore,
    lowestCommonAncestor,
    directChildUnder,
    placementAnchor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2ChatGPTScanner = api;
})();
