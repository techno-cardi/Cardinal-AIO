const assert = require('assert');
const Reader = require('./formative-reader-v2.js');
const Readiness = require('./server-readiness-v2.js');

function item(id = 'I1') {
  return {
    _id: id,
    subtype: 'shortAnswer',
    text: '{"type":"doc","content":[]}',
    type: 'question',
    parentId: null,
    position: 1,
    updatedAt: '2026-09-21T12:00:00.000Z',
    details: {
      points: 4,
      correctAnswers: ['galette'],
      answerChoicePoints: [4],
      isCaseSensitive: false,
      isKeywordGrading: true,
      isPartialCredit: true,
      isRequired: true,
      showWordCount: false,
      blanks: []
    }
  };
}

function response(items = [item()]) {
  return {
    data: {
      formative: {
        _id: 'F1',
        title: 'Test',
        viewerPermissions: ['view', 'edit'],
        items
      }
    }
  };
}

(async () => {
  // Exact target + complete item list becomes a complete detailed snapshot.
  {
    const s = Reader.normalizeDetailedSnapshot(response(), 'F1');
    assert.equal(s.snapshotComplete, true);
    assert.equal(s.detailLevel, 'managed-v2');
    assert.equal(s.formative._id, 'F1');
    assert.equal(s.formative.items.length, 1);
  }

  // Cross-target responses are never accepted.
  {
    assert.throws(
      () => Reader.normalizeDetailedSnapshot(response(), 'OTHER'),
      e => e.code === 'TARGET_ID_MISMATCH'
    );
  }

  // Missing array and duplicate item IDs are blockers, not partial snapshots.
  {
    assert.throws(
      () => Reader.normalizeDetailedSnapshot({ data: { formative: { _id: 'F1' } } }, 'F1'),
      e => e.code === 'FORMATIVE_DETAILED_ITEMS_MISSING'
    );
    assert.throws(
      () => Reader.normalizeDetailedSnapshot(response([item('I1'), item('I1')]), 'F1'),
      e => e.code === 'FORMATIVE_DETAILED_DUPLICATE_ITEM_ID'
    );
  }

  // Reader uses the known query operation and returns a validated item.
  {
    const calls = [];
    const client = {
      async query(operationName, document, variables) {
        calls.push({ operationName, document, variables });
        return response();
      }
    };
    const r = Reader.createReader({ client, serverReadiness: Readiness });
    const s = await r.readDetailedSnapshot('F1');
    assert.equal(s.managedDetailComplete, true);
    const one = await r.readItemDetailed('F1', 'I1');
    assert.equal(one._id, 'I1');
    assert.equal(calls[0].operationName, 'FormativeTeacher');
    assert.equal(calls[0].variables.formativeId, 'F1');
    assert(calls[0].document.includes('isKeywordGrading'));
    assert(calls[0].document.includes('blanks'));
    assert(calls[0].document.includes('choiceLabels'));
    assert(calls[0].document.includes('choices'));
    assert(calls[0].document.includes('labels'));
  }

  // Missing item is a clean null, useful for delete/postcondition checks.
  {
    const r = Reader.createReader({
      client: { async query() { return response(); } },
      serverReadiness: Readiness
    });
    assert.equal(await r.readItemDetailed('F1', 'MISSING'), null);
  }

  // Omitted managed fields are caught even though GraphQL transport succeeded.
  {
    const broken = item();
    delete broken.details.isRequired;
    const r = Reader.createReader({
      client: { async query() { return response([broken]); } },
      serverReadiness: Readiness
    });
    const s = await r.readDetailedSnapshot('F1');
    assert.equal(s.managedDetailComplete, false);
    await assert.rejects(
      r.readItemDetailed('F1', 'I1'),
      e => e.code === 'SERVER_ITEM_DETAIL_INCOMPLETE'
    );
  }

  console.log('formative-reader-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});