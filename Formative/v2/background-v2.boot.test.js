'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function event() {
  const listeners = [];
  return {
    addListener(fn) { listeners.push(fn); },
    removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    hasListener(fn) { return listeners.includes(fn); },
    _listeners: listeners
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
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]; }
  };
}

(() => {
  const root = __dirname;
  const local = {};
  const session = {};
  const chrome = {
    runtime: { id: 'cardinal-formative-boot-test', onMessage: event(), onInstalled: event() },
    tabs: {
      onRemoved: event(), onUpdated: event(), onActivated: event(),
      async query() { return []; },
      async get(id) { return { id, url: 'https://app.formative.com/formatives/test', status: 'complete', windowId: 1 }; },
      async sendMessage() { return null; },
      async reload() {}, async update() { return {}; }
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event() },
    webRequest: { onBeforeSendHeaders: event() },
    storage: { local: storageArea(local), session: storageArea(session), onChanged: event() },
    scripting: { async executeScript() { return [{ result: null }]; } }
  };

  const context = {
    chrome, console, URL, Headers, Request, Response,
    TextEncoder, TextDecoder, setTimeout, clearTimeout, Date, Math,
    Number, String, Boolean, Array, Object, Map, Set, WeakMap, WeakSet,
    Promise, RegExp, JSON, Symbol, Error, TypeError, Uint8Array, structuredClone,
    fetch: async () => new Response('{}', { status: 200 })
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

  const entry = fs.readFileSync(path.join(root, 'background-v2.js'), 'utf8');
  vm.runInContext(entry, context, { filename: 'background-v2.js' });

  assert(context.CardinalFormativeV2Background, 'background API must load');
  assert(context.CardinalFormativeV2Presentation, 'presentation dependency must load before runtime');
  assert(context.__cardinalFormativeV2App, 'service worker must create and attach the Formative v2 app');
  assert.equal(typeof context.__cardinalFormativeV2App.detach, 'function');
  assert(chrome.runtime.onMessage._listeners.length > 0, 'runtime listener must be attached');

  console.log('background-v2.boot: service worker booted with all runtime dependencies');
})();
