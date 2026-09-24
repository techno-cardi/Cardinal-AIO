const assert = require('assert');
const I = require('./identity-v2.js');

const base = {
  schema: 'cardinal.formative/2', protocolVersion: '2.0.0', packageMode: 'patch',
  assessment: { title: 'Test', language: 'fr-CA', sourceMode: 'external-reference-only' },
  sources: [{ id: 'q', role: 'questionnaire', label: 'Questions', status: 'provided' }],
  items: [{ id: 'q1', kind: 'question', order: 1, prompt: 'Question?', issues: [] }],
  issues: [], generator: { model: 'x', generatedAt: '2026-01-01T00:00:00Z' }
};

// Durable association depends only on the immutable Formative target id.
assert.equal(I.associationFingerprintForTarget('F1'), I.associationFingerprintForTarget('F1'));
assert.notEqual(I.associationFingerprintForTarget('F1'), I.associationFingerprintForTarget('F2'));

// Generator timestamps and derived issue arrays do not create fake package versions.
{
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  b.generator.generatedAt = '2030-01-01T00:00:00Z';
  b.issues = [{ severity: 'warning', code: 'X', message: 'derived' }];
  b.items[0].issues = [{ severity: 'warning', code: 'Y', message: 'derived' }];
  assert.equal(I.packageContentFingerprint(a), I.packageContentFingerprint(b));
}

// Import-relevant content changes package fingerprint but not target association.
{
  const changed = JSON.parse(JSON.stringify(base));
  changed.items[0].prompt = 'Question modifiée?';
  assert.notEqual(I.packageContentFingerprint(base), I.packageContentFingerprint(changed));
  assert.equal(I.associationFingerprintForTarget('F1'), I.associationFingerprintForTarget('F1'));
}

// Source semantic identity contributes when present.
{
  const a = JSON.parse(JSON.stringify(base));
  const b = JSON.parse(JSON.stringify(base));
  a.sources[0].semanticFingerprint = 'abc';
  b.sources[0].semanticFingerprint = 'def';
  assert.notEqual(I.packageContentFingerprint(a), I.packageContentFingerprint(b));
}

console.log('identity-v2: all tests passed');