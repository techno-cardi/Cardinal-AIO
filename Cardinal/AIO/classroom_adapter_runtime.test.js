#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node classroom_adapter_runtime.test.js <classroom-background-aio.js>');
const source = fs.readFileSync(sourcePath, 'utf8');

const listeners = [];
const store = Object.create(null);

const chrome = {
  runtime: {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onInstalled: { addListener() {} },
  },
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: store[key] };
        return {};
      },
      async set(obj) {
        Object.assign(store, obj);
      },
      async remove(key) {
        if (Array.isArray(key)) key.forEach(k => delete store[k]);
        else delete store[key];
      },
    },
  },
  alarms: {
    async create() {},
    async clear() { return true; },
    onAlarm: { addListener() {} },
  },
  tabs: {
    onRemoved: { addListener() {} },
    async get(id) { return { id, url: 'https://classroom.google.com/c/MTIz', status: 'complete' }; },
    async update() { return {}; },
    async sendMessage() { return null; },
    async create() { return { id: 99 }; },
  },
  debugger: {
    async attach() {},
    async detach() {},
    async sendCommand() {},
  },
};

const context = vm.createContext({
  chrome,
  console,
  URL,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  String,
  Number,
  Boolean,
  Array,
  Object,
  RegExp,
  Error,
});

vm.runInContext(source, context, { filename: sourcePath });

assert.strictEqual(listeners.length, 1, 'exactly one runtime listener expected');
const listener = listeners[0];

function dispatch(message, sender) {
  return new Promise((resolve, reject) => {
    let answered = false;
    const ret = listener(message, sender, response => {
      answered = true;
      resolve({ ret, answered, response });
    });
    if (ret === false || ret === undefined) {
      setImmediate(() => resolve({ ret, answered, response: undefined }));
    } else if (ret !== true) {
      reject(new Error('unexpected listener return: ' + String(ret)));
    }
  });
}

(async () => {
  const foreign = await dispatch(
    { type: 'CARDINAL_FORMATIVE_IMPORT_STATUS' },
    { tab: { id: 1, url: 'https://chatgpt.com/c/example' } },
  );
  assert.strictEqual(foreign.ret, false, 'foreign AIO messages must be ignored synchronously');
  assert.strictEqual(foreign.answered, false, 'foreign AIO messages must not receive a Classroom response');

  const legacyGeneric = await dispatch(
    { type: 'prepare', payload: {} },
    { tab: { id: 1, url: 'https://techno-cardi.github.io/Plan-de-cours/' } },
  );
  assert.strictEqual(legacyGeneric.ret, false, 'legacy generic message names must not be claimed');

  const generatorSender = {
    tab: {
      id: 7,
      windowId: 3,
      url: 'https://techno-cardi.github.io/Plan-de-cours/index.html',
    },
  };

  const remember = await dispatch(
    {
      type: 'PDC_NATIVE_REMEMBER_GROUPS',
      groups: [{
        group: 'Groupe 42',
        courseId: '123',
        courseName: 'Français groupe 42',
        courseSection: '4e secondaire',
        alternateLink: 'https://classroom.google.com/c/MTIz',
      }],
    },
    generatorSender,
  );
  assert.strictEqual(remember.ret, true);
  assert.strictEqual(remember.response.ok, true);
  assert.ok(remember.response.groups.includes('42'), 'future group 42 should be learned');

  const get = await dispatch(
    { type: 'PDC_NATIVE_GET_GROUPS' },
    generatorSender,
  );
  assert.strictEqual(get.ret, true);
  assert.strictEqual(get.response.ok, true);
  assert.strictEqual(get.response.groups['42'].courseId, '123');
  assert.strictEqual(get.response.groups['42'].group, '42');

  process.stdout.write('classroom adapter runtime ownership/group42: OK\n');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
