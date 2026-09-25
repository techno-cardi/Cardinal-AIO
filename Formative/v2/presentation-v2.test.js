const assert = require('assert');
const P = require('./presentation-v2.js');

function pkg() {
  return {
    issues: [],
    items: [
      { id: 'section', kind: 'section', order: 1, content: 'Compréhension' },
      {
        id: 'q1', kind: 'question', order: 2,
        source: { number: '1' }, prompt: 'Quel type de réacteur?', subtype: 'shortAnswer',
        points: { value: 2, provenance: 'provided' },
        grading: {
          mode: 'auto', expectedAnswer: 'RBMK au graphite', provenance: { kind: 'sourceExplicit' },
          concepts: [{ id: 'rbmk', label: 'RBMK', score: 2, terms: ['RBMK'], riskyTerms: [] }], requirements: []
        }, issues: []
      },
      {
        id: 'q2', kind: 'question', order: 3,
        source: { number: '2' }, prompt: 'Explique deux conséquences.', subtype: 'longAnswer',
        points: { value: 4, provenance: 'proposed' },
        grading: {
          mode: 'assisted', expectedAnswer: 'Deux conséquences expliquées.', provenance: { kind: 'sourceInferred' },
          concepts: [{ id: 'c', label: 'Conséquences', score: 2, terms: ['cancer', 'brûlures'], riskyTerms: ['santé'] }], requirements: []
        }, issues: [{ severity: 'warning', code: 'PROPOSED_POINTS', message: 'Pointage proposé' }]
      }
    ]
  };
}

// Validation rows remain concise but retain the full correction detail for “Voir le corrigé”.
{
  const rows = P.buildValidationRows(pkg());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].number, '1');
  assert.equal(rows[0].typeLabel, 'Réponse courte');
  assert.equal(rows[0].correction.expectedAnswer, 'RBMK au graphite');
  assert.deepEqual(rows[0].correction.concepts[0].terms, ['RBMK']);
  assert.equal(rows[1].status, 'review');
  assert.equal(rows[1].flags.proposedPoints, true);
  assert.equal(rows[1].correction.riskyTermCount, 1);
}

// Ready -> simple import action.
{
  const prepared = {
    ok: true, state: 'ready', targetTitle: 'Tchernobyl', pkg: pkg(),
    preflight: { data: { ui: { status: '✓ Prêt', questions: 2, create: 2, update: 0, unchanged: 0, warnings: 0, blockers: 0 } } }
  };
  const view = P.buildPreparedView(prepared);
  assert.equal(view.primaryAction.id, 'import');
  assert.equal(view.primaryAction.label, 'Importer dans Formative');
  assert.equal(view.showCorrectionButton, true);
}

// Review-only pedagogical warnings do not add a second confirmation screen.
{
  const prepared = {
    ok: true, state: 'review', pkg: pkg(),
    preflight: { data: { ui: { status: '⚠ À vérifier', questions: 2, warnings: 1, blockers: 0 } } }
  };
  const view = P.buildPreparedView(prepared);
  assert.equal(view.primaryAction.id, 'import');
  assert.equal(view.primaryAction.label, 'Importer dans Formative');
  assert.equal(view.statusLabel, '✓ Prêt');
}

// A preflight blocker must keep the original questions and expose the exact
// reason instead of collapsing the UI to "0 question / 1 blocage".
{
  const blockedPkg = pkg();
  const issue = {
    severity: 'blocker',
    code: 'TECHNICAL_BLOCK',
    itemId: 'q2',
    message: 'Blocage technique de test'
  };
  const prepared = {
    ok: false,
    state: 'blocked',
    targetTitle: 'Tchernobyl',
    pkg: blockedPkg,
    preflight: {
      issues: [issue],
      data: {
        validation: {
          stats: { questions: 2, auto: 1, assisted: 1, manual: 0 }
        }
      }
    }
  };
  const view = P.buildPreparedView(prepared);
  assert.equal(view.questions, 2);
  assert.equal(view.blockers, 1);
  assert.equal(view.validationRows.length, 2);
  assert(view.validationRows[1].issues.some(x => x.code === 'TECHNICAL_BLOCK'));
  assert.equal(view.issues[0].message, 'Blocage technique de test');
  assert.equal(view.primaryAction.id, 'none');
}

// Recovery is explicit and resumable.
{
  const view = P.buildPreparedView({
    ok: true, state: 'recovery', targetTitle: 'Tchernobyl',
    journal: { runId: 'R1', summary: { verified: 4, remaining: 2, uncertain: 1, failed: 0 } }
  });
  assert.equal(view.primaryAction.id, 'resume');
  assert.equal(view.recovery.uncertain, 1);
}

// A recovery with zero verified work and only a possibly committed UPDATE can
// safely abandon its stale plan and perform a fresh dry-run on the same item.
{
  const journal = {
    runId: 'R-safe',
    summary: { verified: 0, remaining: 2, uncertain: 1, failed: 0 },
    operations: [
      {
        operationId: 'update:q1',
        action: 'UPDATE',
        formativeItemId: 'existing-q1',
        status: 'UNCERTAIN',
        mutationMayHaveCommitted: true
      },
      {
        operationId: 'create:q2',
        action: 'CREATE',
        formativeItemId: null,
        status: 'PENDING',
        mutationMayHaveCommitted: false
      }
    ]
  };
  assert.equal(P.recoveryFreshPrepareSafe(journal), true);
  const view = P.buildPreparedView({
    ok: true, state: 'recovery', mode: 'resume', targetTitle: 'Tchernobyl', journal
  });
  assert.equal(view.primaryAction.id, 'reimport');
  assert.equal(view.primaryAction.label, 'Revérifier et reprendre');
}

// A possibly committed CREATE must stay on strict resume/reconciliation.
{
  const journal = {
    runId: 'R-unsafe',
    summary: { verified: 0, remaining: 1, uncertain: 1, failed: 0 },
    operations: [{
      operationId: 'create:q1',
      action: 'CREATE',
      formativeItemId: 'maybe-created',
      status: 'UNCERTAIN',
      mutationMayHaveCommitted: true
    }]
  };
  assert.equal(P.recoveryFreshPrepareSafe(journal), false);
}

// Completed import keeps a non-destructive reimport action available.
{
  const view = P.buildExecutionView({ state: 'completed', journal: { summary: { verified: 3, skipped: 2 } } }, { targetTitle: 'T' });
  assert.equal(view.statusLabel, '✓ Import vérifié');
  assert.equal(view.primaryAction.id, 'reimport');
}

// An uncertain mutation must NEVER surface the ordinary Import button.
{
  const view = P.buildExecutionView({
    state: 'uncertain',
    journal: { summary: { verified: 1, remaining: 1, uncertain: 1, failed: 0 } }
  }, { targetTitle: 'T' });
  assert.equal(view.statusLabel, '↻ Vérification requise');
  assert.equal(view.primaryAction.id, 'resume');
  assert.equal(view.primaryAction.label, 'Reprendre l’import');
  assert.equal(view.primaryAction.emphasis, 'warning');
}

// A failed/incomplete journal is also resumed through recovery, not blind reimport.
{
  const view = P.buildExecutionView({
    state: 'failed',
    journal: { summary: { verified: 0, remaining: 1, uncertain: 0, failed: 1 } }
  }, { targetTitle: 'T' });
  assert.equal(view.primaryAction.id, 'resume');
  assert.equal(view.primaryAction.label, 'Reprendre en sécurité');
}

console.log('presentation-v2: all tests passed');
