const assert = require('assert');
const E = require('./error-presenter-v2.js');

{
  const p = E.present({ code: 'SESSION_REAUTH_REQUIRED', message: '401 raw detail' });
  assert.equal(p.message, 'Reconnecte-toi à Formative, puis réessaie.');
  assert.equal(p.action.id, 'reauth');
  assert.equal(p.technicalDetails, '401 raw detail');
  assert.equal(p.showTechnicalByDefault, false);
}

{
  const p = E.present({ code: 'MUTATION_TARGET_CHANGED_SINCE_PREFLIGHT' });
  assert(p.message.includes('rien écrasé'));
  assert.equal(p.action.id, 'retry');
}

{
  const p = E.present({ reason: 'UNCERTAIN' });
  assert.equal(p.title, 'Vérification nécessaire');
  assert.equal(p.action.id, 'resume');
}

// Concurrent same-target import must not encourage a second retry click.
{
  const p = E.present({ code: 'TARGET_IMPORT_ALREADY_RUNNING' });
  assert(p.message.includes('déjà en cours'));
  assert.equal(p.action.id, 'details');
  assert.notEqual(p.action.id, 'retry');
}

// A stale explicit target never falls back silently to another open tab.
{
  const p = E.present({ code: 'REQUESTED_TARGET_TAB_MISMATCH' });
  assert(p.message.includes('mauvais endroit'));
  assert.equal(p.action.id, 'retry');
}

// Partial lower-level capability must be explained as not end-to-end safe.
{
  const p = E.present({ code: 'CAPABILITY_PARTIAL' });
  assert(p.message.includes('de bout en bout'));
  assert.equal(p.action.id, 'review');
}

// Package parser failures are explicit instead of silently hiding the button.
{
  const malformed = E.present({ code: 'PACKAGE_JSON_INVALID', message: 'Unexpected token' });
  assert(malformed.message.includes('JSON invalide'));
  assert.equal(malformed.action.id, 'details');
  assert.equal(malformed.technicalDetails, 'Unexpected token');

  const ambiguous = E.present({ code: 'PACKAGE_MULTIPLE_CANDIDATES' });
  assert(ambiguous.message.includes('Plusieurs paquets'));
  assert.equal(ambiguous.action.id, 'details');

  const incomplete = E.present({ code: 'PACKAGE_JSON_INCOMPLETE' });
  assert(incomplete.message.includes('incomplet'));
  assert.equal(incomplete.action.id, 'retry');
}

// Cross-tab/source safeguards produce useful recovery guidance.
{
  const tab = E.present({ code: 'IMPORTER_COMMAND_TAB_REQUIRED' });
  assert(tab.message.includes('onglet ChatGPT'));
  assert.equal(tab.action.id, 'reload');

  const stale = E.present({ code: 'STALE_UI_ACTION' });
  assert(stale.message.includes('ancienne préparation'));
  assert.equal(stale.action.id, 'retry');

  const forbidden = E.present({ code: 'IMPORTER_COMMAND_SOURCE_FORBIDDEN' });
  assert(forbidden.message.includes('surface Cardinal autorisée'));
  assert.equal(forbidden.action.id, 'details');
}

// Existing non-empty Formative needs the detailed reader; no blind comparison.
{
  const p = E.present({ code: 'SERVER_DETAIL_READER_REQUIRED' });
  assert(p.message.includes('relire en détail'));
  assert.equal(p.action.id, 'retry');
}

// Unknown errors remain safe and do not claim that a mutation did/did not happen.
{
  const p = E.present({ code: 'NEW_FUTURE_ERROR', message: 'opaque detail' });
  assert.equal(p.title, 'Import interrompu');
  assert(p.message.includes('état n’est pas vérifié'));
  assert.equal(p.technicalDetails, 'opaque detail');
}

{
  const s = E.summarizeIssues([
    { severity: 'warning', code: 'SOURCE_REQUIRED', message: 'x' },
    { severity: 'blocker', code: 'TOTAL_POINTS_MISMATCH', message: 'y' }
  ]);
  assert.equal(s.blockers, 1);
  assert.equal(s.warnings, 1);
  assert.equal(s.primary.code, 'TOTAL_POINTS_MISMATCH');
}

console.log('error-presenter-v2: all tests passed');