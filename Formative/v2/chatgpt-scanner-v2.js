(() => {
  'use strict';

  function required(value, name) {
    if (!value) throw new Error(`${name} dependency required`);
    return value;
  }

  function roleAttr(node) {
    if (!node || typeof node.getAttribute !== 'function') return null;
    const value = node.getAttribute('data-message-author-role');
    return value ? String(value).toLowerCase() : null;
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

  function messageContext(node) {
    // Strongest signal: an explicit author-role ancestor.
    for (const current of ancestorChain(node)) {
      const role = roleAttr(current);
      if (role) return { role, root: current, evidence: 'role-ancestor' };
    }

    // ChatGPT has changed wrapper structure before. An article may contain the
    // role marker as a sibling/descendant rather than an ancestor of <pre>.
    // We only accept this fallback if exactly one author role is provable.
    const article = closestArticle(node);
    if (article && typeof article.querySelectorAll === 'function') {
      const marked = [...article.querySelectorAll('[data-message-author-role]')];
      const roles = new Set(marked.map(roleAttr).filter(Boolean));
      if (roles.size === 1) {
        return { role: [...roles][0], root: article, evidence: 'article-descendant-role' };
      }
      if (roles.size > 1) {
        return { role: 'ambiguous', root: article, evidence: 'article-mixed-roles' };
      }
    }

    // Fail closed. A package pasted by the user must never become executable
    // just because ChatGPT changed an unrelated CSS class.
    return { role: 'unknown', root: article, evidence: 'unproven' };
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

  function collectCandidates(root, parser) {
    required(root, 'ChatGPT document/root');
    required(parser, 'package parser');
    if (typeof root.querySelectorAll !== 'function') throw new Error('root.querySelectorAll required');

    const sentinel = parser.SENTINEL || 'CARDINAL_FORMATIVE_PACKAGE_V2';
    const rawNodes = [...root.querySelectorAll('pre, code')];
    const seenNodes = new Set();
    const candidates = [];
    const ignored = [];

    for (const rawNode of rawNodes) {
      const node = canonicalTechnicalNode(rawNode);
      if (!node || seenNodes.has(node)) continue;
      seenNodes.add(node);
      const text = textOf(node);
      const context = messageContext(node);
      const markerInBlock = text.includes(sentinel);
      const markerInMessage = context.root && textOf(context.root).includes(sentinel);
      if (!markerInBlock && !markerInMessage) continue;
      if (context.role !== 'assistant') {
        ignored.push({ node, context, reason: context.role === 'user' ? 'user-message' : 'assistant-not-proven' });
        continue;
      }
      candidates.push({ node, text, messageRoot: context.root, context, markerInBlock });
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

  function scan(root, parser, options = {}) {
    const collected = collectCandidates(root, parser);
    const groups = groupByMessage(collected.candidates);
    const messages = groups.map(group => {
      const markedBlocks = group.candidates.filter(row => row.markerInBlock);
      const messageText = textOf(group.messageRoot);
      let parseFromMessage = markedBlocks.length === 0;
      let parsed = parser.parseCandidates(
        parseFromMessage ? [messageText] : markedBlocks.map(row => row.text), options
      );
      const sentinel = parser.SENTINEL || 'CARDINAL_FORMATIVE_PACKAGE_V2';
      if (!parseFromMessage && messageText.split(sentinel).length > 2) {
        parsed = parser.parseCandidates([messageText], options);
        parseFromMessage = true;
      } else if (!parseFromMessage && parsed.state === 'invalid' && messageText.includes(sentinel)) {
        const combined = parser.parseCandidates([messageText], options);
        if (combined.state === 'found' || combined.state === 'ambiguous') {
          parsed = combined;
          parseFromMessage = true;
        }
      }
      const technicalNode = parseFromMessage
        ? group.candidates.find(row => parsed?.package?.rawJson && row.text.includes(parsed.package.rawJson))?.node || group.candidates.at(-1)?.node || null
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
    // Node.DOCUMENT_POSITION_FOLLOWING = 4. Avoid referencing Node in service
    // worker/unit tests where the DOM global does not exist.
    return Boolean(position & 4);
  }

  function lastTableBefore(messageRoot, technicalNode) {
    if (!messageRoot || typeof messageRoot.querySelectorAll !== 'function') return null;
    const tables = [...messageRoot.querySelectorAll('table')];
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

  // Returns the branch after which the importer UI should be inserted. This
  // keeps the bar below the human validation table instead of inside table DOM
  // or above the whole assistant response.
  function placementAnchor(messageRoot, technicalNode) {
    const table = lastTableBefore(messageRoot, technicalNode);
    if (!table) {
      const parent = technicalNode?.parentElement || null;
      return {
        mode: 'before-technical',
        anchor: technicalNode || null,
        parent,
        table: null
      };
    }

    const lca = lowestCommonAncestor(table, technicalNode, messageRoot) || messageRoot;
    const tableBranch = directChildUnder(lca, table) || table;
    return {
      mode: 'after-validation-table',
      anchor: tableBranch,
      parent: tableBranch?.parentElement || lca || null,
      table
    };
  }

  const api = {
    roleAttr,
    ancestorChain,
    closestArticle,
    messageContext,
    canonicalTechnicalNode,
    textOf,
    collectCandidates,
    groupByMessage,
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
