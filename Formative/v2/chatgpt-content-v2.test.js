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
    }), '2 à créer · 1 à mettre à jour · 3 inchangés · 2 retraits à vérifier');

    assert.equal(U.summarizeView({
      create: 1,
      unchanged: 1,
      deleteProposed: 1
    }), '1 à créer · 1 inchangé · 1 retrait à vérifier');
  }

  // Pedagogical warnings remain visible in Details but no longer create a
  // mechanical review step before an otherwise technically valid import.
  {
    const view = { warnings: 4, primaryAction: { id: 'import' } };
    assert.deepEqual(U.actionIntent(view, false), { command: 'APPLY', acknowledgeWarnings: true });
    assert.deepEqual(U.actionIntent({ warnings: 0, primaryAction: { id: 'import' } }, false), { command: 'APPLY', acknowledgeWarnings: false });
    assert.deepEqual(U.actionIntent({ primaryAction: { id: 'import-review' } }, false), { command: 'APPLY', acknowledgeWarnings: true });
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

  // Cardinal buttons must not inherit ChatGPT's current theme variables for the
  // primary surface. The import button keeps explicit contrast in every theme.
  {
    const primary = U.buttonStyle('primary');
    assert.equal(primary.background, '#111827');
    assert.equal(primary.color, '#ffffff');
    assert.equal(primary.appearance, 'none');
    assert.equal(primary.WebkitAppearance, 'none');

    const secondary = U.buttonStyle('secondary');
    assert.equal(secondary.background, 'rgba(127,127,127,.10)');
    assert.equal(secondary.color, 'inherit');
  }



  // Partial question selection must become a PATCH so unselected questions are
  // never interpreted as deletions from an existing questionnaire.
  {
    const original = {
      schema: 'cardinal.formative/2',
      protocolVersion: '2.0.0',
      packageMode: 'full',
      assessment: {
        title: 'Classes de mots',
        language: 'fr-CA',
        sourceMode: 'external-reference-only',
        declaredTotalPoints: { value: 6, provenance: 'source' }
      },
      sources: [{ id: 'src', role: 'questionnaire', status: 'provided' }],
      items: [
        { id: 's1', kind: 'section', order: 1, content: 'Section A' },
        { id: 'q1', kind: 'question', order: 2, source: { sourceRef: 'src' }, prompt: 'Q1', subtype: 'shortAnswer', required: true, points: { value: 2, provenance: 'source', graded: true, bonus: false }, grading: { mode: 'manual' }, transformations: [], issues: [] },
        { id: 'q2', kind: 'question', order: 3, source: { sourceRef: 'src' }, prompt: 'Q2', subtype: 'longAnswer', required: true, points: { value: 4, provenance: 'source', graded: true, bonus: false }, grading: { mode: 'manual' }, transformations: [], issues: [] },
        { id: 'i1', kind: 'instruction', order: 4, content: 'Fin' }
      ],
      issues: [
        { severity: 'warning', code: 'TOTAL_POINTS_MISMATCH', message: 'ancien total' },
        { severity: 'warning', code: 'Q1_ONLY', itemId: 'q1', message: 'q1' },
        { severity: 'warning', code: 'Q2_ONLY', itemId: 'q2', message: 'q2' },
        { severity: 'warning', code: 'GLOBAL_SOURCE_NOTE', message: 'global' }
      ]
    };

    assert.deepEqual(
      U.questionSelectionRows(original).map(row => row.id),
      ['q1', 'q2']
    );

    const partial = U.buildSelectedQuestionPackage(original, ['q2']);
    assert.equal(partial.partial, true);
    assert.equal(partial.pkg.packageMode, 'patch');
    assert.deepEqual(partial.pkg.items.map(item => item.id), ['q2']);
    assert.equal('declaredTotalPoints' in partial.pkg.assessment, false);
    assert.deepEqual(partial.pkg.issues.map(issue => issue.code), ['Q2_ONLY', 'GLOBAL_SOURCE_NOTE']);
    assert.equal(original.packageMode, 'full', 'selection must not mutate the source package');
    assert.deepEqual(original.items.map(item => item.id), ['s1', 'q1', 'q2', 'i1']);

    const all = U.buildSelectedQuestionPackage(original, ['q2', 'q1']);
    assert.equal(all.partial, false);
    assert.equal(all.pkg, original, 'selecting every question keeps the exact full package');
    assert.throws(
      () => U.buildSelectedQuestionPackage(original, []),
      error => error.code === 'QUESTION_SELECTION_EMPTY'
    );
    assert.throws(
      () => U.buildSelectedQuestionPackage(original, ['q404']),
      error => error.code === 'QUESTION_SELECTION_UNKNOWN'
    );
    assert.equal(
      U.shouldOfferQuestionSelection(
        { pkg: original, selectionConfirmed: false },
        { primaryAction: { id: 'import' } }
      ),
      false,
      'question selection is optional and must not interrupt the normal import flow'
    );
  }

  // Mutations caused only by Cardinal's own bar must not schedule a
  // destructive rescan. ChatGPT mutations still do.
  {
    const runtime = {
      id: 'cardinal-test',
      onMessage: { addListener() {}, removeListener() {} }
    };
    const scanner = {
      scan() { return { messages: [], ignored: [] }; },
      placementAnchor() { return { mode: 'append-end', anchor: null, parent: null, table: null }; },
      isCardinalUiElement(node) { return node?.cardinal === true; },
      insideCardinalUi(node) { return node?.insideCardinal === true; }
    };
    const bridge = U.createContentBridge({
      document: { documentElement: {}, createElement() { return { style: {}, dataset: {}, addEventListener() {} }; } },
      runtime,
      scanner,
      parser: {},
      errorPresenter: {},
      MutationObserver: null,
      storage: null
    });
    assert.equal(
      bridge.isOwnMutation({ target: {}, addedNodes: [{ cardinal: true }], removedNodes: [] }),
      true
    );
    assert.equal(
      bridge.isOwnMutation({ target: { insideCardinal: true }, addedNodes: [], removedNodes: [] }),
      true
    );
    assert.equal(
      bridge.isOwnMutation({ target: {}, addedNodes: [{ cardinal: false }], removedNodes: [] }),
      false
    );
  }

  // Manual page analysis must acknowledge the popup and report what the scan
  // actually found instead of silently scheduling work with no response.
  {
    let listener = null;
    function fakeElement() {
      return {
        style: {},
        dataset: {},
        children: [],
        textContent: '',
        parentNode: null,
        isConnected: true,
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        append(...children) { children.forEach(child => this.appendChild(child)); },
        replaceChildren(...children) { this.children = []; this.append(...children); },
        addEventListener() {},
        remove() { this.isConnected = false; },
        querySelector() { return null; }
      };
    }
    const doc = {
      documentElement: {},
      querySelectorAll() { return []; },
      createElement() { return fakeElement(); }
    };
    const runtime = {
      id: 'cardinal-test',
      async sendMessage() {
        return {
          handled: true,
          ok: true,
          state: 'ready',
          token: 'manual-scan-token',
          view: { statusLabel: 'Prêt', primaryAction: { id: 'none' } }
        };
      },
      onMessage: {
        addListener(fn) { listener = fn; },
        removeListener(fn) { if (listener === fn) listener = null; }
      }
    };
    const scanner = {
      scan() {
        return {
          messages: [{
            messageRoot: null,
            technicalNode: null,
            parse: { state: 'found', package: { pkg: {
              schema: 'cardinal.formative/2',
              protocolVersion: '2.0.0',
              packageMode: 'full',
              assessment: { title: 'Test' },
              sources: [],
              items: [],
              issues: []
            }, rawJson: '{"schema":"cardinal.formative/2"}' } }
          }],
          ignored: []
        };
      },
      placementAnchor() { return { mode: 'append-end', anchor: null, parent: null, table: null }; }
    };
    const parser = { SENTINEL: 'CARDINAL_FORMATIVE_PACKAGE_V2' };
    const bridge = U.createContentBridge({
      document: doc,
      runtime,
      scanner,
      parser,
      errorPresenter: { present(error) { return { message: error?.message || String(error) }; } },
      MutationObserver: null,
      storage: null
    });
    bridge.start();
    assert.equal(typeof listener, 'function');
    const response = await new Promise(resolve => {
      const claimed = listener({ type: U.UI_RESCAN_MESSAGE }, {}, resolve);
      assert.equal(claimed, true);
    });
    assert.equal(response.ok, true);
    assert.equal(response.packages, 1);
    bridge.stop();
  }

  // Exact blocker messages must be available to the visible ChatGPT bar instead
// of collapsing to an opaque "1 blocage".
{
  const messages = U.issueMessages({
    issues: [
      { severity: 'blocker', code: 'X', message: 'Raison exacte' },
      { severity: 'blocker', code: 'X2', message: 'Raison exacte' },
      { severity: 'warning', code: 'W', message: 'À vérifier' }
    ]
  });
  assert.deepEqual(messages, [
    { severity: 'blocker', code: 'X', message: 'Raison exacte' },
    { severity: 'warning', code: 'W', message: 'À vérifier' }
  ]);
}

console.log('chatgpt-content-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
