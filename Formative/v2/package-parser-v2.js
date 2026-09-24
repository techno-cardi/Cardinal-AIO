(() => {
  'use strict';

  const SENTINEL = 'CARDINAL_FORMATIVE_PACKAGE_V2';
  const SCHEMA = 'cardinal.formative/2';
  const PROTOCOL_VERSION = '2.0.0';
  const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

  function makeError(code, message, extra = {}) {
    const error = new Error(message || code);
    error.code = code;
    error.mutationMayHaveCommitted = false;
    Object.assign(error, extra);
    return error;
  }

  function byteLength(value) {
    const text = String(value || '');
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return text.length * 2;
  }

  // Returns one complete top-level JSON object starting at/after startIndex.
  // Braces inside quoted strings do not affect balancing. This intentionally
  // does not attempt to parse arrays or JavaScript object literals.
  function extractBalancedObject(text, startIndex = 0) {
    const source = String(text || '');
    const open = source.indexOf('{', Math.max(0, startIndex));
    if (open < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = open; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return {
            text: source.slice(open, i + 1),
            start: open,
            end: i + 1
          };
        }
        if (depth < 0) return null;
      }
    }
    return null;
  }

  function sentinelIndexes(text) {
    const source = String(text || '');
    const indexes = [];
    let cursor = 0;
    while (cursor < source.length) {
      const at = source.indexOf(SENTINEL, cursor);
      if (at < 0) break;
      indexes.push(at);
      cursor = at + SENTINEL.length;
    }
    return indexes;
  }

  function validateEnvelope(pkg) {
    const issues = [];
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) issues.push('package must be an object');
    if (pkg?.schema !== SCHEMA) issues.push(`schema expected ${SCHEMA}`);
    if (pkg?.protocolVersion !== PROTOCOL_VERSION) issues.push(`protocolVersion expected ${PROTOCOL_VERSION}`);
    if (!['full', 'patch'].includes(pkg?.packageMode)) issues.push('packageMode must be full or patch');
    if (!pkg?.assessment || typeof pkg.assessment !== 'object' || Array.isArray(pkg.assessment)) issues.push('assessment missing');
    if (!Array.isArray(pkg?.sources)) issues.push('sources must be an array');
    if (!Array.isArray(pkg?.items)) issues.push('items must be an array');
    if (!Array.isArray(pkg?.issues)) issues.push('issues must be an array');
    return { ok: issues.length === 0, issues };
  }

  function parseSingle(text, options = {}) {
    const source = String(text || '');
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_MAX_BYTES;

    if (byteLength(source) > maxBytes) {
      throw makeError('PACKAGE_BLOCK_TOO_LARGE', 'Le bloc Cardinal Formative est trop volumineux pour être analysé en sécurité.');
    }

    const indexes = sentinelIndexes(source);
    if (!indexes.length) return null;
    if (indexes.length > 1) {
      throw makeError(
        'PACKAGE_SENTINEL_AMBIGUOUS',
        'Plusieurs paquets Cardinal Formative v2 sont présents dans le même bloc. Cardinal ne choisira pas au hasard.',
        { count: indexes.length }
      );
    }

    const sentinelIndex = indexes[0];
    const balanced = extractBalancedObject(source, sentinelIndex + SENTINEL.length);
    if (!balanced) {
      throw makeError('PACKAGE_JSON_INCOMPLETE', 'La sentinelle Cardinal est présente, mais aucun objet JSON complet ne la suit.');
    }

    let pkg;
    try {
      pkg = JSON.parse(balanced.text);
    } catch (cause) {
      throw makeError('PACKAGE_JSON_INVALID', 'Le paquet Cardinal contient un JSON invalide.', {
        causeMessage: cause?.message || String(cause)
      });
    }

    const envelope = validateEnvelope(pkg);
    if (!envelope.ok) {
      throw makeError('PACKAGE_ENVELOPE_INVALID', `Le paquet Cardinal v2 est incomplet: ${envelope.issues.join('; ')}`, {
        issues: envelope.issues
      });
    }

    // Ignore markdown fences/whitespace after the parsed object, but a second
    // top-level JSON object after the first one is ambiguous and therefore
    // blocked. We do not reject prose because ChatGPT may append a short note.
    const tail = source.slice(balanced.end);
    const second = extractBalancedObject(tail, 0);
    if (second) {
      try {
        JSON.parse(second.text);
        throw makeError(
          'PACKAGE_MULTIPLE_JSON_OBJECTS',
          'Le bloc technique contient plus d’un objet JSON. Cardinal exige un seul paquet.'
        );
      } catch (error) {
        if (error?.code === 'PACKAGE_MULTIPLE_JSON_OBJECTS') throw error;
        // Braced prose/non-JSON after the package is harmless and ignored.
      }
    }

    return {
      pkg,
      sentinelIndex,
      jsonStart: balanced.start,
      jsonEnd: balanced.end,
      rawJson: balanced.text
    };
  }

  function parseCandidates(texts, options = {}) {
    const results = [];
    const errors = [];
    (Array.isArray(texts) ? texts : []).forEach((text, index) => {
      try {
        const parsed = parseSingle(text, options);
        if (parsed) results.push({ ...parsed, candidateIndex: index });
      } catch (error) {
        errors.push({ candidateIndex: index, error });
      }
    });

    if (results.length > 1) {
      return {
        ok: false,
        state: 'ambiguous',
        packages: results,
        errors,
        error: makeError(
          'PACKAGE_MULTIPLE_CANDIDATES',
          'Plusieurs paquets Cardinal Formative valides ont été détectés dans la même réponse. Choisis une seule version avant l’import.',
          { count: results.length }
        )
      };
    }
    if (results.length === 1) {
      return { ok: true, state: 'found', package: results[0], errors };
    }
    if (errors.length) {
      return { ok: false, state: 'invalid', packages: [], errors, error: errors[0].error };
    }
    return { ok: true, state: 'none', package: null, errors: [] };
  }

  const api = {
    SENTINEL,
    SCHEMA,
    PROTOCOL_VERSION,
    DEFAULT_MAX_BYTES,
    byteLength,
    extractBalancedObject,
    sentinelIndexes,
    validateEnvelope,
    parseSingle,
    parseCandidates
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2PackageParser = api;
})();