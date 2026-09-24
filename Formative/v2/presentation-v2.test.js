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

// Review -> one clear “verify then import” action rather than a wall of controls.
{
  const prepared = {
    ok: true, state: 'review', pkg: pkg(),
    preflight: { data: { ui: { status: '⚠ À vérifier', questions: 2, warnings: 1, blockers: 0 } } }
  };
  const view = P.buildPreparedView(prepared);
  assert.equal(view.primaryAction.id, 'import-review');
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
  assert.equal(view.primaryAction.label, 'Vérifier et reprendre');
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
