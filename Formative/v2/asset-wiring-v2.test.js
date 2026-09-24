'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const background = require('./background-v2.js');

(() => {
  const root = __dirname;
  const builder = fs.readFileSync(path.join(root, 'build-extension-v2.py'), 'utf8');
  const serviceWorkerBlock = builder.match(/SERVICE_WORKER_FILES\s*=\s*\[(.*?)\]\s*\n\s*CHATGPT_FILES/s);
  assert(serviceWorkerBlock, 'build-extension-v2.py SERVICE_WORKER_FILES block must remain parseable');

  const builderFiles = [...serviceWorkerBlock[1].matchAll(/"([^"\n]+\.js)"/g)].map(match => match[1]);
  const runtimeFiles = [...background.CORE_SCRIPTS, 'background-v2.js'];

  assert.deepEqual(
    builderFiles,
    runtimeFiles,
    'builder SERVICE_WORKER_FILES must exactly match background CORE_SCRIPTS + entrypoint, including order'
  );
  assert.equal(new Set(builderFiles).size, builderFiles.length, 'service worker build list must not contain duplicates');
  assert.equal(background.CORE_SCRIPTS.includes('background-v2.js'), false, 'entrypoint must not import itself');
  assert.equal(
    background.CORE_SCRIPTS.includes('presentation-v2.js'),
    true,
    'presentation-v2.js is a required runtime dependency and must remain packaged'
  );

  for (const name of builderFiles) {
    assert.equal(fs.existsSync(path.join(root, name)), true, `missing service worker asset: ${name}`);
  }

  console.log('asset-wiring-v2: all tests passed');
})();
