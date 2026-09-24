'use strict';

const assert = require('node:assert/strict');
const P = require('./package-parser-v2.js');

function pkg(overrides = {}) {
  return {
    schema: 'cardinal.formative/2',
    protocolVersion: '2.0.0',
    packageMode: 'full',
    assessment: { title: 'Test' },
    sources: [],
    items: [],
    issues: [],
    ...overrides
  };
}

// Balanced extraction ignores braces and escaped quotes inside JSON strings.
{
  const source = 'prefix {"a":"texte { avec } et \\\"quote\\\"","b":{"c":1}} suffix';
  const result = P.extractBalancedObject(source);
  assert.equal(result.text, '{"a":"texte { avec } et \\\"quote\\\"","b":{"c":1}}');
  assert.deepEqual(JSON.parse(result.text), { a: 'texte { avec } et "quote"', b: { c: 1 } });
}

// Normal markdown/code-block-like text is accepted.
{
  const raw = `Voici le paquet\n\n${P.SENTINEL}\n\n\`\`\`json\n${JSON.stringify(pkg())}\n\`\`\``;
  const result = P.parseSingle(raw);
  assert.equal(result.pkg.schema, P.SCHEMA);
  assert.equal(result.pkg.protocolVersion, P.PROTOCOL_VERSION);
  assert.equal(result.pkg.packageMode, 'full');
}

// JSON fields can contain literal sentinel text without confusing the parser
// because only sentinel occurrences in the surrounding raw block count. The
// generator should not emit it, but ambiguity must fail closed if it does.
{
  const raw = `${P.SENTINEL}\n${JSON.stringify(pkg({ assessment: { title: P.SENTINEL } }))}`;
  assert.throws(
    () => P.parseSingle(raw),
    error => error.code === 'PACKAGE_SENTINEL_AMBIGUOUS'
  );
}

// Missing sentinel is not an error: scanner can inspect many assistant code
// blocks without creating noisy parse failures.
assert.equal(P.parseSingle('{"schema":"cardinal.formative/2"}'), null);

// Incomplete/malformed package states are explicit instead of silently hiding
// the importer button.
{
  assert.throws(
    () => P.parseSingle(`${P.SENTINEL}\n{"schema":"cardinal.formative/2"`),
    error => error.code === 'PACKAGE_JSON_INCOMPLETE'
  );

  assert.throws(
    () => P.parseSingle(`${P.SENTINEL}\n{schema:"cardinal.formative/2"}`),
    error => error.code === 'PACKAGE_JSON_INVALID'
  );
}

// Envelope mismatch fails before the validator/mutation pipeline.
{
  assert.throws(
    () => P.parseSingle(`${P.SENTINEL}\n${JSON.stringify(pkg({ schema: 'cardinal.formative/1' }))}`),
    error => error.code === 'PACKAGE_ENVELOPE_INVALID' && error.issues.some(x => x.includes('schema'))
  );
  assert.throws(
    () => P.parseSingle(`${P.SENTINEL}\n${JSON.stringify(pkg({ protocolVersion: '9.9.9' }))}`),
    error => error.code === 'PACKAGE_ENVELOPE_INVALID' && error.issues.some(x => x.includes('protocolVersion'))
  );
  assert.throws(
    () => P.parseSingle(`${P.SENTINEL}\n${JSON.stringify(pkg({ packageMode: 'replace-everything' }))}`),
    error => error.code === 'PACKAGE_ENVELOPE_INVALID' && error.issues.some(x => x.includes('packageMode'))
  );
}

// Multiple sentinels in one candidate are ambiguous. Cardinal must never pick
// whichever package happens to parse first.
{
  const raw = `${P.SENTINEL}\n${JSON.stringify(pkg())}\n${P.SENTINEL}\n${JSON.stringify(pkg({ packageMode: 'patch' }))}`;
  assert.throws(
    () => P.parseSingle(raw),
    error => error.code === 'PACKAGE_SENTINEL_AMBIGUOUS' && error.count === 2
  );
}

// A second valid top-level JSON object after the package is also rejected.
{
  const raw = `${P.SENTINEL}\n${JSON.stringify(pkg())}\n${JSON.stringify({ accidental: true })}`;
  assert.throws(
    () => P.parseSingle(raw),
    error => error.code === 'PACKAGE_MULTIPLE_JSON_OBJECTS'
  );
}

// Braced prose after the object is harmless if it is not a second valid JSON
// object. This tolerates natural ChatGPT closing notes.
{
  const raw = `${P.SENTINEL}\n${JSON.stringify(pkg())}\nNote {à vérifier au besoin}.`;
  assert.equal(P.parseSingle(raw).pkg.schema, P.SCHEMA);
}

// Candidate scanner returns one package, preserves malformed-candidate errors,
// and blocks two independently valid packages in the same assistant response.
{
  const one = P.parseCandidates([
    'ordinary code',
    `${P.SENTINEL}\n{"bad":`,
    `${P.SENTINEL}\n${JSON.stringify(pkg())}`
  ]);
  assert.equal(one.ok, true);
  assert.equal(one.state, 'found');
  assert.equal(one.package.candidateIndex, 2);
  assert.equal(one.errors.length, 1);

  const many = P.parseCandidates([
    `${P.SENTINEL}\n${JSON.stringify(pkg())}`,
    `${P.SENTINEL}\n${JSON.stringify(pkg({ packageMode: 'patch' }))}`
  ]);
  assert.equal(many.ok, false);
  assert.equal(many.state, 'ambiguous');
  assert.equal(many.error.code, 'PACKAGE_MULTIPLE_CANDIDATES');
}

// Size check happens before parsing, including multibyte text.
{
  const raw = `${P.SENTINEL}\n${JSON.stringify(pkg({ assessment: { title: 'é'.repeat(200) } }))}`;
  assert(P.byteLength(raw) > raw.length);
  assert.throws(
    () => P.parseSingle(raw, { maxBytes: 100 }),
    error => error.code === 'PACKAGE_BLOCK_TOO_LARGE'
  );
}

console.log('package-parser-v2: all tests passed');