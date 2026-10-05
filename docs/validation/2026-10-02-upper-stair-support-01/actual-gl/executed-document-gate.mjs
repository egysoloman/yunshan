// Adapted from the actual coherent05 document gate. Loaded before the bounded new-candidate
// single-home controlled round-trip wrapper; no game/save/profile writes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config, sha, verifyFixedSource, requireRootReady } from './fixed-source-gate.mjs';

const ready = await requireRootReady(); // No Playwright import or child launch before this succeeds.
const sourceStart = await verifyFixedSource();
assert.equal(process.cwd(), config.snapshot, 'Actual process cwd equals exact snapshot');
const output = process.env.YUNSHAN_GATE_OUTPUT;
assert(output, 'Give a separate document-provenance output path');
const record = { scope: 'Exact 99-input/cwd/entry gate and actual DOM module response bytes. No game/profile mutation.',
  startedAt: new Date().toISOString(), actualCwd: process.cwd(), actualArgv: process.argv, ready, sourceStart,
  gateSHA256: sha(await readFile(import.meta.filename)), documents: [], errors: [], consoleEvents: [], pageErrors: [] };
const save = async () => writeFile(output, JSON.stringify(record, null, 2));
await save();
const { chromium } = await import(path.join(config.snapshot, 'node_modules/playwright-core/index.mjs'));
const pages = new WeakSet(), contexts = new WeakSet(), browsers = new WeakSet();
function wrapPage(page) {
  if (pages.has(page)) return page; pages.add(page);
  page.on('pageerror',error=>record.pageErrors.push({at:new Date().toISOString(),url:page.url(),message:error.message}));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))record.consoleEvents.push({
    at:new Date().toISOString(),type:message.type(),text:message.text(),location:message.location(),pageURL:page.url()});});
  const original = page.goto.bind(page);
  page.goto = async (...args) => {
    let loaded;
    const onResponse = response => {
      if (new URL(response.url()).pathname === config.entry) loaded = response.body().then(bytes => ({
        url: response.url(), status: response.status(), bytes: bytes.length,
        sha256: sha(bytes), fromServiceWorker: response.fromServiceWorker() }));
    };
    page.on('response', onResponse);
    try {
      const response = await original(...args);
      const urls = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.src));
      const expectedURL = new URL(config.entry, page.url()).href;
      assert(urls.includes(expectedURL), 'Actual DOM references root-specified main module');
      assert(loaded, 'Observe actual module response loaded by this page');
      const asset = await loaded;
      assert.equal(asset.url, expectedURL); assert.equal(asset.status, 200);
      assert.equal(asset.bytes, config.entryBytes); assert.equal(asset.sha256, config.entrySHA256); assert.equal(asset.fromServiceWorker,false);
      const document = { at: new Date().toISOString(), requestedURL: String(args[0]),
        actualPageURL: page.url(), moduleURLs: urls, loadedAsset: asset };
      record.documents.push(document); await save();
      console.log('ACTUAL_DOCUMENT_GATE ' + JSON.stringify(document));
      return response;
    } catch (error) { record.errors.push(String(error)); await save(); throw error; }
    finally { page.off('response', onResponse); }
  };
  return page;
}
function wrapContext(context) {
  if (contexts.has(context)) return context; contexts.add(context);
  context.pages().forEach(wrapPage);
  const original = context.newPage.bind(context);
  context.newPage = async (...args) => wrapPage(await original(...args));
  return context;
}
function wrapBrowser(browser) {
  if (browsers.has(browser)) return browser; browsers.add(browser);
  const newPage = browser.newPage.bind(browser), newContext = browser.newContext.bind(browser);
  browser.newPage = async (...args) => wrapPage(await newPage(...args));
  browser.newContext = async (...args) => wrapContext(await newContext(...args));
  const close = browser.close.bind(browser);
  browser.close = async (...args) => {
    try { return await close(...args); }
    finally { record.sourceEnd=await verifyFixedSource();record.completedAt=new Date().toISOString();await save(); }
  };
  return browser;
}
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => wrapBrowser(await launch(...args));
// Persistent contexts are deliberately unavailable in this batch. r10 is root-owned.
chromium.launchPersistentContext = async () => { throw new Error('This batch cannot open a persistent profile'); };
