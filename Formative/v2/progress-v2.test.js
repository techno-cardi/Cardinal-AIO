const assert = require('assert');
const P = require('./progress-v2.js');

{
  const e = P.event({ stage: 'IMPORTING', itemIndex: 5, itemTotal: 10, runId: 'R' });
  assert(e.percent > 45 && e.percent < 90);
  assert.equal(e.terminal, false);
}

// Same run never visually moves backwards because a late async message arrives.
{
  const a = P.event({ stage: 'VERIFYING', runId: 'R' });
  const late = P.event({ stage: 'IMPORTING', itemIndex: 1, itemTotal: 10, runId: 'R' });
  assert.equal(P.shouldReplace(a, late), false);
}

// Terminal state wins and stays terminal for that run.
{
  const done = P.event({ stage: 'COMPLETED', runId: 'R' });
  const stale = P.event({ stage: 'VERIFYING', runId: 'R' });
  assert.equal(P.shouldReplace(done, stale), false);
  assert.equal(P.shouldReplace(done, P.event({ stage: 'DETECTING', runId: 'R2' })), true);
}

// A broken UI sink cannot break the import or another sink.
(async () => {
  const received = [];
  const report = P.makeReporter([
    async () => { throw new Error('detached DOM'); },
    async e => received.push(e.stage)
  ]);
  await report({ stage: 'DETECTING', runId: 'R' });
  await report({ stage: 'READY', runId: 'R' });
  assert.deepEqual(received, ['DETECTING', 'READY']);
  console.log('progress-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});