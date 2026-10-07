'use strict';

// Loads the complete shipped extension. Only the external websites and
// GraphQL responses are fixtures. Chrome messaging, storage, scripts, DOM,
// mutation builders, guards, planning and re-read verification are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pw = require(process.env.CARDINAL_PLAYWRIGHT || '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const artifact = path.resolve(process.argv[2] || 'candidate');
const root = path.resolve(process.env.CARDINAL_BROWSER_ROOT || 'verification');
const output = path.resolve(process.argv[3] || 'verification/browser-flow-result.json');
const packet = JSON.parse(fs.readFileSync(process.env.CARDINAL_BROWSER_PACKET || path.join(root, 'Formative/fixtures/v2/exact-six-cygnes-c14.json')));
const clone = value => JSON.parse(JSON.stringify(value));
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const items = new Map();
const requests = [];
const mutations = [];
const errors = [];
const checks = [];
let nextId = 0;
let context;

async function check(name, fn) {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); }
  console.log(JSON.stringify(checks.at(-1)));
}

function graph(body) {
  const { operationName: name, variables: vars = {} } = body;
  requests.push({ name });
  if (name === 'LocalSessionProbe') return { data: { formative: { _id: 'F' } } };
  if (['FormativePermissionCheck', 'FormativeLayout', 'FormativeTeacher'].includes(name)) {
    assert.equal(vars.formativeId, 'F');
    return { data: { formative: { _id: 'F', title: 'Les Six Cygnes', viewerPermissions: ['edit'], items: [...items.values()].map(clone) } } };
  }
  mutations.push({ name, variables: clone(vars) });
  if (name === 'FormativeTeacherAddFormativeItem') {
    assert.equal(vars.formativeId, 'F');
    const id = 'browser-item-' + (++nextId);
    items.set(id, { _id: id, subtype: vars.subtype, type: 'question', text: '', details: {
      points: 0, isRequired: true, isKeywordGrading: false, isPartialCredit: false,
      isCaseSensitive: false, showWordCount: false, correctAnswers: [], answerChoicePoints: [], blanks: []
    } });
    return { data: { payload: { formativeItem: { _id: id } } } };
  }
  const item = items.get(String(vars.formativeItemId || vars.id));
  if (!item) throw new Error('Unexpected operation or item: ' + name);
  const input = vars.input || {};
  if (name === 'QuestionEditableUpdateFormativeItem') {
    if (Object.hasOwn(input, 'text')) item.text = input.text;
    for (const [key, value] of Object.entries(input)) if (key !== 'text') item.details[key] = clone(value);
  } else if (name === 'FillInTheBlankEditableContainerMutation') {
    item.text = input.text; item.details.blanks = clone(input.blanks);
  } else if (['WithChoicesMutation', 'MatchingEditableDetailsContainerMutation'].includes(name)) {
    for (const [key, value] of Object.entries(input)) item.details[key] = clone(value);
  } else throw new Error('Unexpected mutation: ' + name);
  return { data: { payload: { formativeItem: clone(item) } } };
}

function html(theme = 'dark', source = packet) {
  const colors = theme === 'dark'
    ? 'color-scheme:dark;--text-primary:#fff;--bg-primary:#212121;background:#212121;color:#fff'
    : 'color-scheme:light;--text-primary:#111;--bg-primary:#fff;background:#fff;color:#111';
  return '<!doctype html><html><head><meta charset="utf-8"><style>html{' + colors + '}body{font:16px system-ui;padding:24px}button{color:inherit}</style></head><body>' +
    '<main><article data-testid="conversation-turn-1" data-message-author-role="assistant"><div class="markdown">' +
    '<p>Questionnaire prêt.</p><p>CARDINAL_FORMATIVE_PACKAGE_V2</p><pre><code>' + escape(JSON.stringify(source, null, 2)) +
    '</code></pre></div></article></main><form><textarea id="prompt-textarea" style="width:90%;height:80px">Prépare ce questionnaire.</textarea></form></body></html>';
}

async function popupFor(chat, id) {
  const popup = await context.newPage();
  await popup.goto('chrome-extension://' + id + '/popup.html');
  await popup.evaluate(async url => {
    const tabs = await chrome.tabs.query({ url });
    await chrome.tabs.update(tabs[0].id, { active: true });
    await CardinalAioPopup.start();
  }, chat.url());
  return popup;
}

async function main() {
  context = await pw.chromium.launchPersistentContext(path.join(root, 'browser-profile-' + Date.now()), {
    executablePath: process.env.CARDINAL_BROWSER_CHROMIUM || path.join(root, 'browser-deps/root/usr/lib/chromium/chromium'),
    ignoreDefaultArgs: ['--disable-extensions'],
    headless: true, ignoreHTTPSErrors: true, colorScheme: 'dark', viewport: { width: 1250, height: 1100 },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-extensions-except=' + artifact, '--load-extension=' + artifact]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
  worker.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const id = worker.url().split('/')[2];
  let theme = 'dark';
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'chatgpt.com') return route.fulfill({ contentType: 'text/html', body: html(theme) });
    if (url.hostname === 'app.formative.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Les Six Cygnes</title><main>Éditeur de test</main><script>setTimeout(()=>fetch("https://svc.goformative.com/graphql/query/LocalSessionProbe",{method:"POST",headers:{"authorization":"Bearer local-test-session","content-type":"application/json"},body:JSON.stringify({operationName:"LocalSessionProbe",variables:{}})}),300)</script>' });
    if (url.hostname === 'svc.goformative.com' && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST,OPTIONS' } });
    if (url.hostname === 'svc.goformative.com') {
      try { return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(graph(request.postDataJSON())) }); }
      catch (error) { errors.push(error.message); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ errors: [{ message: error.message }] }) }); }
    }
    return route.abort();
  });
  const form = await context.newPage();
  await form.goto('https://app.formative.com/formatives/F/edit');
  await form.waitForTimeout(700);
  const chat = await context.newPage();
  chat.on('pageerror', e => errors.push(e.message));
  await chat.goto('https://chatgpt.com/c/cardinal-test');
  const bar = chat.locator('[data-cardinal-formative-signature]').first();
  await bar.waitFor({ timeout: 20000 });
  await bar.getByRole('button', { name: 'Importer dans Formative', exact: true }).waitFor({ timeout: 20000 });
  await chat.screenshot({ path: output.replace(/\.json$/, '-initial.png'), fullPage: true });

  await check('primary action is readable with the current dark-theme variables', async () => {
    const styles = await bar.getByRole('button', { name: 'Importer dans Formative', exact: true }).evaluate(button => {
      const style = getComputedStyle(button); return { text: button.textContent, color: style.color, background: style.backgroundColor };
    });
    assert(styles.text.trim()); assert.notEqual(styles.color, styles.background, JSON.stringify(styles));
  });
  await check('real popup receives and copies the Formative prompt', async () => {
    const popup = await popupFor(chat, id);
    const response = await popup.evaluate(async () => {
      const copied = [];
      const message = await CardinalAioPopup.prepareChatGpt(chrome, { copyText: async text => { copied.push(text); return true; } });
      return { message, copied };
    });
    assert.equal(response.copied.length, 1);
    assert(response.copied[0].includes('CARDINAL_FORMATIVE_COMPACT_V2'));
    await popup.close();
  });
  await check('popup recovers a missing prompt-helper receiver instead of a generic failure', async () => {
    const popup = await popupFor(chat, id);
    await popup.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
      await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => { globalThis.__cardinalFormativePrepareHelperV2?.stop(); globalThis.__cardinalFormativePrepareHelperV2 = null; } });
    });
    const response = await popup.evaluate(async () => {
      const copied = [];
      await CardinalAioPopup.prepareChatGpt(chrome, { copyText: async text => { copied.push(text); return true; } });
      return copied;
    });
    assert.equal(response.length, 1);
    assert(response[0].includes('CARDINAL_FORMATIVE_COMPACT_V2'));
    await popup.close();
  });
  await check('all 15 questions import through the real button and the real worker', async () => {
    await bar.getByRole('button', { name: 'Voir le corrigé préparé', exact: true }).click();
    await bar.getByRole('button', { name: 'Importer dans Formative', exact: true }).click();
    await bar.getByRole('button', { name: 'Réimporter dans Formative', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(items.size, 15);
    assert.equal([...items.values()].reduce((sum, item) => sum + item.details.points, 0), 60);
    assert.equal(mutations.filter(row => row.name === 'FormativeTeacherAddFormativeItem').length, 15);
    assert.equal([...items.values()].find(item => item.subtype === 'matching' && item.details.points === 5).details.choices.length, 5);
    assert.equal([...items.values()].find(item => item.subtype === 'matching' && item.details.points === 4).details.choices.length, 4);
  });
  await chat.screenshot({ path: output.replace(/\.json$/, '-after-import.png'), fullPage: true });
  await check('the real reimport button refreshes without duplicating questions', async () => {
    const before = mutations.length;
    await bar.getByRole('button', { name: 'Réimporter dans Formative', exact: true }).click();
    await bar.getByRole('button', { name: 'Importer dans Formative', exact: true }).waitFor({ timeout: 20000 });
    await bar.getByRole('button', { name: 'Importer dans Formative', exact: true }).click();
    await bar.getByRole('button', { name: 'Réimporter dans Formative', exact: true }).waitFor({ timeout: 60000 });
    assert.equal(items.size, 15); assert.equal(mutations.length, before);
  });
  await check('closing the bar and refreshing the page restores the usable menu', async () => {
    await bar.locator('button[title]').filter({ hasText: '×' }).click();
    await bar.waitFor({ state: 'detached' });
    await chat.reload();
    await chat.locator('[data-cardinal-formative-signature]').first().waitFor({ timeout: 10000 });
  });
  await check('reloading recovers bars hidden by the previous version', async () => {
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/*' });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: async () => CardinalFormativeV2ChatGPTContent.signature(document.querySelector('pre code').textContent) });
      await chrome.storage.local.set({ 'cardinal.formative.v2.ui.dismissed': [result] });
    });
    await chat.reload();
    await chat.locator('[data-cardinal-formative-signature]').first().waitFor({ timeout: 10000 });
  });
  await check('the light-theme primary action remains readable', async () => {
    theme = 'light'; await chat.emulateMedia({ colorScheme: 'light' }); await chat.reload();
    const button = chat.locator('[data-cardinal-formative-signature]').first().getByRole('button', { name: 'Importer dans Formative', exact: true });
    await button.waitFor({ timeout: 10000 });
    const styles = await button.evaluate(button => { const s = getComputedStyle(button); return { color: s.color, background: s.backgroundColor }; });
    assert.notEqual(styles.color, styles.background);
  });
}

main().catch(error => { checks.push({ name: 'browser setup and real extension startup', ok: false, error: error.stack }); console.log(error.stack); }).finally(async () => {
  const result = { artifact, chromium: context ? context.browser()?.version() : null, checks, errors, serverItems: items.size, mutations: mutations.length, requests: requests.length };
  fs.writeFileSync(output, JSON.stringify(result, null, 2));
  if (context) await context.close();
  process.exitCode = checks.some(row => !row.ok) || errors.length ? 1 : 0;
});
