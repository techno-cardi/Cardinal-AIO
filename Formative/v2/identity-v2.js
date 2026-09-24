(() => {
  'use strict';

  function asString(value) {
    return value == null ? '' : String(value);
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = canonicalize(value[key]);
      }
      return out;
    }
    return value;
  }

  function fnv1a64(value) {
    const text = asString(value);
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      hash ^= BigInt(code & 0xff);
      hash = BigInt.asUintN(64, hash * prime);
      if (code > 0xff) {
        hash ^= BigInt((code >>> 8) & 0xff);
        hash = BigInt.asUintN(64, hash * prime);
      }
    }
    return hash.toString(16).padStart(16, '0');
  }

  function hash128(value) {
    const text = asString(value);
    return `${fnv1a64(`a:${text}`)}${fnv1a64(`b:${text}`)}`;
  }

  /**
   * Baseline association is intentionally tied to the immutable Formative id,
   * not to PDF bytes or question wording. Otherwise a revised PDF would lose
   * the baseline and look like a brand-new assessment.
   */
  function associationFingerprintForTarget(targetFormativeId) {
    const id = asString(targetFormativeId).trim();
    if (!id) throw new Error('targetFormativeId required');
    return `cfi-association-${hash128(`formative-target:${id}`)}`;
  }

  function cleanPackageForContentHash(pkg) {
    if (!pkg || typeof pkg !== 'object') throw new Error('package required');
    return canonicalize({
      schema: pkg.schema || null,
      protocolVersion: pkg.protocolVersion || null,
      packageMode: pkg.packageMode || null,
      assessment: pkg.assessment || null,
      sources: (pkg.sources || []).map(source => ({
        id: source.id || null,
        role: source.role || null,
        label: source.label || null,
        status: source.status || null,
        semanticFingerprint: source.semanticFingerprint || null,
        pageCount: source.pageCount || null
      })),
      items: (pkg.items || []).map(item => {
        const copy = { ...item };
        delete copy.issues;
        return copy;
      })
    });
  }

  /**
   * Changes whenever import-relevant package content changes. Used for UI
   * signatures/status only, never as the durable baseline association key.
   */
  function packageContentFingerprint(pkg) {
    return `cfi-package-${hash128(JSON.stringify(cleanPackageForContentHash(pkg)))}`;
  }

  function sourceIdentitySummary(pkg) {
    return (pkg?.sources || []).map(source => ({
      role: source?.role || 'unknown',
      label: source?.label || null,
      semanticFingerprint: source?.semanticFingerprint || null,
      status: source?.status || null
    }));
  }

  const api = {
    canonicalize,
    hash128,
    associationFingerprintForTarget,
    cleanPackageForContentHash,
    packageContentFingerprint,
    sourceIdentitySummary
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalThis.CardinalFormativeV2Identity = api;
})();