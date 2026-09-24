const assert = require('assert');
const R = require('./server-readiness-v2.js');

function keywordItem(overrides = {}) {
  return {
    _id: 'I1',
    subtype: 'shortAnswer',
    text: '{"type":"doc","content":[]}',
    details: {
      points: 4,
      isRequired: true,
      isPartialCredit: true,
      isKeywordGrading: true,
      isCaseSensitive: false,
      correctAnswers: ['galette', 'beurre'],
      answerChoicePoints: [4, 4]
    },
    ...overrides
  };
}

(() => {
  // A detailed short-answer read is safe for semantic diff.
  {
    const r = R.checkItem(keywordItem(), { claimed: true });
    assert.equal(r.ok, true);
    assert.equal(r.state, 'ready');
  }

  // A layout-only item must never be treated as a complete mutation precondition.
  {
    const r = R.checkItem({ _id: 'I1', subtype: 'shortAnswer', text: 'x', details: { points: 4 } }, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_REQUIRED_MISSING'));
    assert(r.issues.some(x => x.code === 'SERVER_READ_KEYWORD_MODE_MISSING'));
  }

  // False is meaningful: own properties must be accepted, not confused with absence.
  {
    const item = keywordItem({
      details: {
        points: 4,
        isRequired: false,
        isPartialCredit: false,
        isKeywordGrading: false,
        isCaseSensitive: false
      }
    });
    const r = R.checkItem(item, { claimed: true });
    assert.equal(r.ok, true);
  }

  // Long Answer needs showWordCount because omission could hide a manual teacher change.
  {
    const item = keywordItem({ subtype: 'longAnswer' });
    const r = R.checkItem(item, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_WORD_COUNT_MISSING'));
  }

  // Keyword arrays must stay aligned.
  {
    const item = keywordItem();
    item.details.answerChoicePoints = [4];
    const r = R.checkItem(item, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_KEYWORD_LENGTH_MISMATCH'));
  }

  // FITB requires semantic blank data, not only points/text.
  {
    const item = {
      _id: 'FITB',
      subtype: 'fillInTheBlank',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 2,
        isRequired: true,
        isPartialCredit: true,
        blanks: [{ key: 'b1', correctAnswers: ['eau'] }]
      }
    };
    assert.equal(R.checkItem(item, { claimed: true }).ok, true);
    delete item.details.blanks[0].correctAnswers;
    const r = R.checkItem(item, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_BLANK_ANSWERS_MISSING'));
  }

  // Native choice questions require complete choice arrays.
  {
    const mc = {
      _id: 'MC',
      subtype: 'multipleChoice',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 2,
        isRequired: true,
        isPartialCredit: false,
        choiceLabels: ['A', 'B'],
        choices: ['ka', 'kb'],
        correctAnswers: ['kb']
      }
    };
    assert.equal(R.checkItem(mc, { claimed: true }).ok, true);
    delete mc.details.choiceLabels;
    const r = R.checkItem(mc, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_CHOICE_LABELS_MISSING'));
  }

  // Multiple Selection rejects stale/unknown keys and misaligned weight arrays.
  {
    const ms = {
      _id: 'MS',
      subtype: 'multipleSelection',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 4,
        isRequired: true,
        isPartialCredit: true,
        choiceLabels: ['A', 'B', 'C'],
        choices: ['k1', 'k2', 'k3'],
        correctAnswers: ['k1', 'missing'],
        answerChoicePoints: [2, 0]
      }
    };
    const r = R.checkItem(ms, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_CORRECT_KEY_UNKNOWN'));
    assert(r.issues.some(x => x.code === 'SERVER_READ_ANSWER_POINTS_LENGTH_MISMATCH'));
  }

  // Inline choice needs labels + keys for each blank, not only the correct key.
  {
    const inline = {
      _id: 'IC',
      subtype: 'inlineChoice',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 2,
        isRequired: true,
        isPartialCredit: true,
        blanks: [{
          key: 'b1',
          correctAnswers: ['c2'],
          choiceLabels: ['nom', 'verbe'],
          choices: ['c1', 'c2']
        }]
      }
    };
    assert.equal(R.checkItem(inline, { claimed: true }).ok, true);
    delete inline.details.blanks[0].choices;
    const r = R.checkItem(inline, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_INLINE_KEYS_MISSING'));

    inline.details.blanks[0].choices = ['c1', 'c2'];
    inline.details.blanks[0].correctAnswers = ['c1', 'c2'];
    const ambiguous = R.checkItem(inline, { claimed: true });
    assert.equal(ambiguous.ok, false);
    assert(ambiguous.issues.some(x => x.code === 'SERVER_READ_INLINE_CORRECT_COUNT'));
  }

  // Resequence requires a complete permutation of opaque choice keys.
  {
    const item = {
      _id: 'RS',
      subtype: 'resequence',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 3,
        isRequired: true,
        isPartialCredit: true,
        choiceLabels: ['A', 'B', 'C'],
        choices: ['k1', 'k2', 'k3'],
        correctAnswers: ['k2', 'k3', 'k1']
      }
    };
    assert.equal(R.checkItem(item, { claimed: true }).ok, true);
    item.details.correctAnswers = ['k2', 'k2', 'k1'];
    const bad = R.checkItem(item, { claimed: true });
    assert.equal(bad.ok, false);
    assert(bad.issues.some(x => x.code === 'SERVER_READ_MAPPING_NOT_PERMUTATION'));
  }

  // Matching additionally requires one right label per key.
  {
    const item = {
      _id: 'MT',
      subtype: 'matching',
      text: '{"type":"doc","content":[]}',
      details: {
        points: 2,
        isRequired: true,
        isPartialCredit: true,
        choiceLabels: ['Nom', 'Verbe'],
        choices: ['k1', 'k2'],
        labels: ['chat', 'court'],
        correctAnswers: ['k1', 'k2']
      }
    };
    assert.equal(R.checkItem(item, { claimed: true }).ok, true);
    item.details.labels = ['chat'];
    const bad = R.checkItem(item, { claimed: true });
    assert.equal(bad.ok, false);
    assert(bad.issues.some(x => x.code === 'SERVER_READ_MATCHING_LENGTH_MISMATCH'));
  }

  // Foreign unsupported items remain opaque warnings, never adopted silently.
  {
    const r = R.checkItem({ _id: 'X', subtype: 'drawing', text: '' }, { claimed: false });
    assert.equal(r.ok, true);
    assert.equal(r.state, 'review');
    assert(r.issues.some(x => x.code === 'SERVER_READ_FOREIGN_SUBTYPE_OPAQUE'));
  }

  // A claimed unsupported item is a blocker.
  {
    const r = R.checkItem({ _id: 'X', subtype: 'drawing', text: '' }, { claimed: true });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_CLAIMED_SUBTYPE_UNSUPPORTED'));
  }

  // Duplicate IDs or missing claimed IDs make a whole snapshot unsafe.
  {
    const duplicate = [keywordItem(), { ...keywordItem(), text: 'other' }];
    const r = R.checkSnapshot(duplicate, { claimedIds: ['I1', 'MISSING'] });
    assert.equal(r.ok, false);
    assert(r.issues.some(x => x.code === 'SERVER_READ_DUPLICATE_ITEM_ID'));
    assert(r.issues.some(x => x.code === 'SERVER_READ_CLAIMED_ITEM_MISSING'));
  }

  console.log('server-readiness-v2: all tests passed');
})();