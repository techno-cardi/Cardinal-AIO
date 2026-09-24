const assert = require('assert');
const L = require('./legacy-gateway-v2.js');
const R = require('./server-readiness-v2.js');

function detailedItem(id = 'I1') {
  return {
    _id: id,
    subtype: 'shortAnswer',
    text: '{"type":"doc","content":[]}',
    details: {
      points: 4,
      isRequired: true,
      isPartialCredit: true,
      isKeywordGrading: true,
      isCaseSensitive: false,
      correctAnswers: ['galette'],
      answerChoicePoints: [4]
    }
  };
}

function primitives(overrides = {}) {
  return {
    async getPageContext() {
      return { targetFormativeId: 'F1', urlTargetFormativeId: 'F1', tabId: 10, title: 'Test', pageKind: 'editor', candidateTargetIds: ['F1'] };
    },
    async permissionCheck() {
      return { formative: { _id: 'F1', viewerPermissions: ['view', 'edit'] } };
    },
    async readLayout() {
      return { formative: { _id: 'F1', title: 'Test', items: [{ _id: 'I1', subtype: 'shortAnswer', text: 'x', details: { points: 4 } }] }, snapshotComplete: true };
    },
    async createItem(input) { return { formativeItemId: 'NEW', input }; },
    async updateItem(input) { return { formativeItemId: input.formativeItemId, input }; },
    ...overrides
  };
}

function gateway(legacy) {
  return L.createGateway({ legacy, serverReadiness: R });
}

(async () => {
  // Positive permission check and page context produce a fresh editable target observation.
  {
    const g = gateway(primitives());
    const o = await g.observeTarget({ targetTabId: 10 });
    assert.equal(o.targetFormativeId, 'F1');
    assert.equal(o.serverTargetFormativeId, 'F1');
    assert.equal(o.canEdit, true);
    assert.equal(o.authState, 'authenticated');
  }

  // Permission without edit never becomes writable.
  {
    const g = gateway(primitives({
      async permissionCheck() { return { formative: { _id: 'F1', viewerPermissions: ['view'] } }; }
    }));
    assert.equal((await g.observeTarget()).canEdit, false);
  }

  // 401/403 from the proven primitive becomes a reauth observation, not a crash/retry loop.
  {
    const g = gateway(primitives({
      async permissionCheck() { const e = new Error('401'); e.status = 401; throw e; }
    }));
    const o = await g.observeTarget();
    assert.equal(o.authState, 'expired');
  }

  // Layout must explicitly prove it is complete; an array alone is not enough.
  {
    const g = gateway(primitives({
      async readLayout() { return { formative: { _id: 'F1', items: [{ _id: 'I1' }] } }; }
    }));
    const s = await g.listItems({ targetFormativeId: 'F1' });
    assert.equal(s.snapshotComplete, false);
  }

  // A non-empty layout-only snapshot is list-complete but not safe for managed semantic diff.
  {
    const g = gateway(primitives());
    const s = await g.listItems({ targetFormativeId: 'F1' });
    assert.equal(s.snapshotComplete, true);
    assert.equal(s.managedDetailComplete, false);
    assert.equal(s.detailLevel, 'layout');
    assert(s.detailIssues.some(x => x.code === 'SERVER_DETAIL_READER_REQUIRED'));
    await assert.rejects(
      g.readItem({ targetFormativeId: 'F1', formativeItemId: 'I1' }),
      e => e.code === 'SERVER_DETAIL_READER_REQUIRED'
    );
  }

  // Empty target remains safe for CREATE even before the detailed reader is available.
  {
    const g = gateway(primitives({
      async readLayout() { return { formative: { _id: 'F1', title: 'Empty', items: [] }, snapshotComplete: true }; }
    }));
    const s = await g.listItems({ targetFormativeId: 'F1' });
    assert.equal(s.snapshotComplete, true);
    assert.equal(s.managedDetailComplete, true);
  }

  // A proven detailed snapshot enables safe list + item reads.
  {
    const g = gateway(primitives({
      async readDetailedSnapshot() {
        return {
          formative: { _id: 'F1', title: 'Test', items: [detailedItem()] },
          snapshotComplete: true,
          detailLevel: 'managed-v2'
        };
      }
    }));
    const s = await g.listItems({ targetFormativeId: 'F1' });
    assert.equal(s.snapshotComplete, true);
    assert.equal(s.managedDetailComplete, true);
    assert.equal(s.detailLevel, 'managed-v2');
    assert.equal((await g.readItem({ targetFormativeId: 'F1', formativeItemId: 'I1' }))._id, 'I1');
  }

  // An item-specific detailed reader is accepted and validated.
  {
    const g = gateway(primitives({
      async readItemDetailed(targetFormativeId, formativeItemId) {
        assert.equal(targetFormativeId, 'F1');
        return detailedItem(formativeItemId);
      }
    }));
    const item = await g.readItem({ targetFormativeId: 'F1', formativeItemId: 'I1' });
    assert.equal(item._id, 'I1');
  }

  // A detailed reader that omits managed fields is explicitly rejected.
  {
    const g = gateway(primitives({
      async readItemDetailed() {
        return { _id: 'I1', subtype: 'shortAnswer', text: 'x', details: { points: 4 } };
      }
    }));
    await assert.rejects(
      g.readItem({ targetFormativeId: 'F1', formativeItemId: 'I1' }),
      e => e.code === 'SERVER_ITEM_DETAIL_INCOMPLETE' && Array.isArray(e.issues)
    );
  }

  // Reader may never return a different item id.
  {
    const g = gateway(primitives({
      async readItemDetailed() { return detailedItem('OTHER'); }
    }));
    await assert.rejects(
      g.readItem({ targetFormativeId: 'F1', formativeItemId: 'I1' }),
      e => e.code === 'FORMATIVE_ITEM_ID_MISMATCH'
    );
  }

  // Wrong server target id blocks rather than returning another assessment's items.
  {
    const g = gateway(primitives({
      async readLayout() { return { formative: { _id: 'OTHER', items: [] }, snapshotComplete: true }; }
    }));
    await assert.rejects(g.listItems({ targetFormativeId: 'F1' }), e => e.code === 'TARGET_ID_MISMATCH');
  }

  // No guessed delete operation: unsupported legacy delete fails before a request can be sent.
  {
    const g = gateway(primitives());
    await assert.rejects(g.deleteItem({ formativeItemId: 'I1' }), e => e.code === 'DELETE_NOT_PROVEN' && e.mutationMayHaveCommitted === false);
  }

  console.log('legacy-gateway-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});