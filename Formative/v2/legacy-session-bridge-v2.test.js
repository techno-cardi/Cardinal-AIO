'use strict';

const assert = require('node:assert/strict');
const B = require('./legacy-session-bridge-v2.js');

(async () => {
  const captures = [];
  const product = {
    async captureSession(headers, meta) {
      captures.push({ headers, meta });
      return { ok: true };
    }
  };

  let listener = null;
  let removed = null;
  const runtime = {
    id: 'ext-1',
    onMessage: {
      addListener(fn) { listener = fn; },
      removeListener(fn) { removed = fn; }
    }
  };

  const bridge = B.createBridge({ product, runtime });
  const trusted = {
    id: 'ext-1',
    url: 'https://app.formative.com/formatives/form-a',
    tab: { id: 22 }
  };

  // Exact legacy message type is owned; unrelated Gestion/Mozaïk traffic is not.
  assert.equal(bridge.owns({ type: B.MESSAGE_TYPE }), true);
  assert.equal(bridge.owns({ type: 'FORMATIVE_REQUEST' }), false);
  assert.equal(bridge.owns({ type: 'MOZAIK_EXTENSION_SYNC' }), false);

  // Only a Formative content script from this extension may refresh the v2 session.
  assert.equal(bridge.trustedSender(trusted), true);
  assert.equal(bridge.trustedSender({ ...trusted, url: 'https://chatgpt.com/c/a' }), false);
  assert.equal(bridge.trustedSender({ ...trusted, id: 'other-extension' }), false);
  assert.equal(bridge.trustedSender({ ...trusted, tab: null }), false);

  const result = await bridge.route({
    type: B.MESSAGE_TYPE,
    headers: { 'x-session-id': 'test-session-value' }
  }, trusted);
  assert.equal(result.ok, true);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].headers['x-session-id'], 'test-session-value');
  assert.equal(captures[0].meta.sourceUrl, trusted.url);

  const forbidden = await bridge.route({
    type: B.MESSAGE_TYPE,
    headers: { 'x-session-id': 'ignored' }
  }, { ...trusted, url: 'https://chatgpt.com/c/a' });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, 'FORMATIVE_SESSION_CAPTURE_SOURCE_FORBIDDEN');
  assert.equal(captures.length, 1);

  // Chrome listener coexistence contract: unowned returns false; owned keeps the
  // response port open and can be detached cleanly.
  const detach = bridge.attach();
  assert.equal(listener({ type: 'FORMATIVE_REQUEST' }, trusted, () => {}), false);
  const response = await new Promise(resolve => {
    assert.equal(listener({
      type: B.MESSAGE_TYPE,
      headers: { 'x-session-id': 'second-session-value' }
    }, trusted, resolve), true);
  });
  assert.equal(response.ok, true);
  detach();
  assert.equal(removed, listener);

  console.log('legacy-session-bridge-v2: all tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
