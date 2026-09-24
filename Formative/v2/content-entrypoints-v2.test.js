'use strict';

const assert = require('node:assert/strict');
const chat = require('./chatgpt-entry-v2.js');
const progress = require('./formative-progress-entry-v2.js');

(() => {
  delete globalThis[chat.GLOBAL_KEY];
  let chatCreated = 0;
  let chatStarted = 0;
  const chatBridge = { start() { chatStarted += 1; return this; } };
  const chatApi = {
    createContentBridge() {
      chatCreated += 1;
      return chatBridge;
    }
  };
  assert.equal(chat.start({ api: chatApi }), chatBridge);
  assert.equal(chat.start({ api: chatApi }), chatBridge);
  assert.equal(chatCreated, 1);
  assert.equal(chatStarted, 1);
  delete globalThis[chat.GLOBAL_KEY];

  delete globalThis[progress.GLOBAL_KEY];
  let progressCreated = 0;
  let progressStarted = 0;
  const overlay = { start() { progressStarted += 1; return this; } };
  const progressApi = {
    createOverlay() {
      progressCreated += 1;
      return overlay;
    }
  };
  assert.equal(progress.start({ api: progressApi }), overlay);
  assert.equal(progress.start({ api: progressApi }), overlay);
  assert.equal(progressCreated, 1);
  assert.equal(progressStarted, 1);
  delete globalThis[progress.GLOBAL_KEY];

  console.log('content-entrypoints-v2: all tests passed');
})();
