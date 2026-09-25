'use strict';

const assert = require('node:assert/strict');
const U = require('./chatgpt-content-v2.js');

(async () => {
  // A patch for the same assessment supersedes the earlier full package in the
  // UI group; packageMode is deliberately not part of assessment identity.
  {
    const full = {
      packageMode: 'full',
      assessment: { title: 'Tchernobyl', targetHint: 'Groupe 51', language: 'fr-CA' }
    };
    const patch = {
      packageMode: 'patch',
      assessment: { title: ' TCHERNOBYL ', targetHint: 'Groupe 51', language: 'fr-ca' }
    };
    assert.equal(U.assessmentKey(full), U.assessmentKey(patch));
  }

  // Exact package dismissal identity changes with technical content.
  {
    const a = await U.signature('{"a":1}');
    const b = await U.signature('{"a":1}');
    const c = await U.signature('{"a":2}');
    assert.equal(a, b);
    assert.notEqual(a, c);
  }

  // Both Chrome stale-context failure forms are recognized.
  {
    assert.equal(U.invalidContextMessage(new Error('Extension context invalidated.')), true);
    assert.equal(U.invalidContextMessage(new Error("Cannot read properties of undefined (reading 'sendMessage')")), true);
    assert.equal(U.invalidContextMessage(new Error('ordinary network error')), false);
  }

  // Summary stays compact, grammatical and never needs the technical prepared object.
  {
    assert.equal(U.summarizeView({
      create: 2,
      update: 1,
      unchanged: 3,
      deleteProposed: 2,
      warnings: 1
    }), '2 à créer · 1 à mettre à jour · 3 inchangés · 2 retraits à vérifier · 1 avertissement');

    assert.equal(U.summarizeView({
      create: 1,
      unchanged: 1,
      deleteProposed: 1
    }), '1 à créer · 1 inchangé · 1 retrait à vérifier');
  }

  // Warnings require an explicit review gesture before APPLY can acknowledge
  // them. The first click never mutates Formative.
  {
    const view = { primaryAction: { id: 'import-review' } };
    assert.deepEqual(U.actionIntent(view, false), { command: 'OPEN_REVIEW' });
    assert.deepEqual(U.actionIntent(view, true), { command: 'APPLY', acknowledgeWarnings: true });
  }

  // Reimport always means fresh dry-run first, never replay the old mutation.
  {
    assert.deepEqual(U.actionIntent({ primaryAction: { id: 'reimport' } }), { command: 'REPREPARE' });
    assert.deepEqual(U.actionIntent({ primaryAction: { id: 'refresh-reconciliation' } }), { command: 'REPREPARE' });
  }

  // Safe reconciliation is explicit. Conflicted reconciliation only opens
  // review and cannot silently link questions.
  {
    assert.deepEqual(U.actionIntent({ primaryAction: { id: 'confirm-reconciliation' } }), { command: 'RECONCILE_SAFE' });
    assert.deepEqual(U.actionIntent({ primaryAction: { id: 'review-reconciliation' } }), { command: 'OPEN_REVIEW' });
  }

  // Disabled/unknown actions produce no mutation command.
  assert.deepEqual(U.actionIntent({ primaryAction: { id: 'none' } }), { command: 'NONE' });
  assert.deepEqual(U.actionIntent({ primaryAction: { id: 'future-action' } }), { command: 'NONE' });

  // Cardinal buttons must not depend on ChatGPT host button colors. The
  // primary action always owns a dark background and contrasting text.
  {
    const primary = U.buttonStyle({ primary: true });
    assert.equal(primary.background, '#111827');
    assert.equal(primary.color, '#ffffff');
    assert.equal(primary.appearance, 'none');

    const secondary = U.buttonStyle();
    assert.equal(secondary.color, 'inherit');
    assert.notEqual(secondary.background, '');
  }

  console.log('chatgpt-content-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
