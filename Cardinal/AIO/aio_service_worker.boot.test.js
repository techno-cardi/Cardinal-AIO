#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = process.argv[2];
if (!root) throw new Error('Usage: node aio_service_worker.boot.test.js <dist-dir>');

function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener(fn) { return listeners.includes(fn); },
    _listeners: listeners,
  };
}

function storageArea(store) {
  return {
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, store[key]]));
      return { ...store };
    },
    async set(values) { Object.assign(store, values || {}); },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
    },
  };
}

const local = {};
const session = {};
const chrome = {
  runtime: {
    id: 'cardinal-aio-boot-test',
    onMessage: event(),
    onInstalled: event(),
  },
  tabs: {
    onRemoved: event(),
    onUpdated: event(),
    onActivated: event(),
    async query() { return []; },
    async get(id) {
      return {
        id,
        url: 'https://app.formative.com/formatives/test/results',
        status: 'complete',
        windowId: 1,
      };
    },
    async sendMessage() { return null; },
    async reload() {},
    async update() { return {}; },
    async create() { return { id: 99, status: 'complete', windowId: 1 }; },
  },
  windows: {
    WINDOW_ID_NONE: -1,
    onFocusChanged: event(),
  },
  webRequest: {
    onBeforeSendHeaders: event(),
    onBeforeRequest: event(),
    onHeadersReceived: event(),
    onCompleted: event(),
  },
  webNavigation: {
    onCommitted: event(),
    onHistoryStateUpdated: event(),
  },
  storage: {
    local: storageArea(local),
    session: storageArea(session),
    onChanged: event(),
  },
  scripting: {
    async executeScript() { return [{ result: null }]; },
  },
  alarms: {
    async create() {},
    async clear() { return true; },
    onAlarm: event(),
  },
  debugger: {
    async attach() {},
    async detach() {},
    async sendCommand() { return {}; },
  },
  action: {
    onClicked: event(),
    async setBadgeText() {},
    async setBadgeBackgroundColor() {},
  },
};

const context = {
  chrome,
  console,
  URL,
  Headers,
  Request,
  Response,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  RegExp,
  JSON,
  Symbol,
  Error,
  TypeError,
  Uint8Array,
  structuredClone,
  fetch: async () => new Response('{}', { status: 200 }),
};
context.globalThis = context;
vm.createContext(context);

context.importScripts = (...files) => {
  for (const file of files) {
    const full = path.join(root, file);
    assert.equal(fs.existsSync(full), true, `missing imported dependency: ${file}`);
    vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
  }
};

function claimedListenerCount(message, sender = {}) {
  let count = 0;
  for (const listener of chrome.runtime.onMessage._listeners) {
    let returned;
    try {
      returned = listener(message, sender, () => {});
    } catch (error) {
      throw new Error(`runtime listener threw for ${String(message?.type || '')}: ${error?.stack || error}`);
    }
    if (returned === true) count += 1;
  }
  return count;
}

const entry = path.join(root, 'service-worker.js');
assert.equal(fs.existsSync(entry), true, 'service-worker.js missing');
vm.runInContext(fs.readFileSync(entry, 'utf8'), context, { filename: 'service-worker.js' });

assert(context.CardinalFormativeV2Background, 'Formative v2 background API must load');
assert(context.CardinalFormativeV2Presentation, 'Formative v2 presentation dependency must load');
assert(context.__cardinalFormativeV2App, 'Formative v2 app must attach during AIO boot');
assert(chrome.runtime.onMessage._listeners.length >= 3, 'runtime listener families must attach');

const extensionSender = {
  id: chrome.runtime.id,
  url: `chrome-extension://${chrome.runtime.id}/popup.html`,
};
assert.equal(
  claimedListenerCount({ type: 'CARDINAL_AIO_UNKNOWN_PROBE' }, extensionSender),
  0,
  'unknown AIO messages must not be claimed by any runtime family'
);
assert.equal(
  claimedListenerCount({ type: 'CARDINAL_FORMATIVE_IMPORT_STATUS', requestId: 'boot-status', payload: {} }, extensionSender),
  1,
  'Formative v2 status must have exactly one runtime owner'
);

const classroomSender = {
  id: chrome.runtime.id,
  url: 'https://techno-cardi.github.io/Plan-de-cours/',
  tab: { id: 17, url: 'https://techno-cardi.github.io/Plan-de-cours/', windowId: 1 },
};
assert.equal(
  claimedListenerCount({ type: 'PDC_NATIVE_GET_GROUPS' }, classroomSender),
  1,
  'Classroom commands must have exactly one runtime owner'
);

assert(chrome.tabs.onRemoved._listeners.length >= 1, 'tab cleanup listener must attach');
assert(chrome.alarms.onAlarm._listeners.length >= 1, 'Classroom watchdog listener must attach');

console.log(
  'aio_service_worker.boot: wrapper + legacy + Classroom + Formative v2 booted',
  {
    runtimeListeners: chrome.runtime.onMessage._listeners.length,
    tabRemovedListeners: chrome.tabs.onRemoved._listeners.length,
    webRequestListeners:
      chrome.webRequest.onBeforeSendHeaders._listeners.length +
      chrome.webRequest.onBeforeRequest._listeners.length +
      chrome.webRequest.onHeadersReceived._listeners.length +
      chrome.webRequest.onCompleted._listeners.length,
  },
);
