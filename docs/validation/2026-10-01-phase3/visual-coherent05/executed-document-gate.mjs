import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from '/workspace/yunshan/node_modules/playwright-core/index.mjs';

const root = '/tmp/yunshan-phase3-root-coherent-05';
const expectedEntry = '/assets/index-BH13EXr_.js';
const expectedSHA = '9b1f4bced913e77feac1f47ded156beb2c08005688d5daa2709a87f501b7081e';
const output = process.env.YUNSHAN_GATE_OUTPUT;
assert(output, 'Provide a separate artifact path for the read-only document gate');
assert.equal(process.cwd(), root, 'Execute only the exact coherent05 workspace');
if (process.argv[1]?.endsWith('player-journey.mjs')) assert(process.argv.includes('--workspace=' + root), 'Native map and served build must use the same exact workspace');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(path.join(root, 'source-snapshot.json'), 'utf8'));
assert.equal(manifest.destination, root); assert.equal(manifest.threeWayMatch, true);
assert.equal(Object.keys(manifest.copiedHashes).length, 89);
const actual = Object.fromEntries(await Promise.all(Object.entries(manifest.copiedHashes).map(async ([file]) => [file, sha(await readFile(path.join(root, file)))])));
assert.deepEqual(actual, manifest.copiedHashes, 'All89 copied source files must match the immutable manifest');
const index = await readFile(path.join(root, 'dist/index.html'), 'utf8');
assert.equal(index.match(/src="([^"]+\.js)"/)?.[1], expectedEntry);
assert.equal(sha(await readFile(path.join(root, 'dist', expectedEntry))), expectedSHA);
const record = { scope: 'Read-only execution/document provenance gate. Exact workspace/89 copied files/entry bytes plus actual page DOM script URLs and actual loaded asset response bytes. No game globals, controls or saved data are changed.',
  startedAt: new Date().toISOString(), workspace: root, actualCwd: process.cwd(), actualArgv: process.argv,
  expectedEntry, expectedSHA, sourceFiles: 89, gateSHA256: sha(await readFile(import.meta.filename)), documents: [] };
await writeFile(output, JSON.stringify(record, null, 2));
console.log('EXACT_EXECUTION_GATE ' + JSON.stringify({ workspace: root, actualCwd: process.cwd(), actualArgv: process.argv, expectedEntry, expectedSHA, sourceFiles: 89 }));
const pages = new WeakSet(), contexts = new WeakSet(), browsers = new WeakSet();
function wrapPage(page) {
  if (pages.has(page)) return page; pages.add(page);
  const original = page.goto.bind(page);
  page.goto = async (...args) => {
    let loaded;
    const onResponse = response => {
      if (new URL(response.url()).pathname === expectedEntry) loaded = response.body().then(bytes => ({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: sha(bytes), fromServiceWorker: response.fromServiceWorker() }));
    };
    page.on('response', onResponse);
    try {
      const response = await original(...args);
      const urls = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.src));
      const expectedURL = new URL(expectedEntry, page.url()).href;
      assert(urls.includes(expectedURL), 'The actual loaded document must reference the expected main entry');
      assert(loaded, 'Observe the actual main module response loaded by this document');
      const asset = await loaded;
      assert.equal(asset.url, expectedURL); assert.equal(asset.status, 200); assert.equal(asset.sha256, expectedSHA);
      const document = { at: new Date().toISOString(), pageURL: page.url(), requestedURL: String(args[0]), moduleURLs: urls, loadedAsset: asset };
      record.documents.push(document); await writeFile(output, JSON.stringify(record, null, 2));
      console.log('ACTUAL_DOCUMENT_GATE ' + JSON.stringify(document));
      return response;
    } finally { page.off('response', onResponse); }
  };
  return page;
}
function wrapContext(context) {
  if (contexts.has(context)) return context; contexts.add(context);
  context.pages().forEach(wrapPage);
  const original = context.newPage.bind(context); context.newPage = async (...args) => wrapPage(await original(...args));
  return context;
}
function wrapBrowser(browser) {
  if (browsers.has(browser)) return browser; browsers.add(browser);
  const newPage = browser.newPage.bind(browser), newContext = browser.newContext.bind(browser);
  browser.newPage = async (...args) => wrapPage(await newPage(...args));
  browser.newContext = async (...args) => wrapContext(await newContext(...args));
  return browser;
}
const launch = chromium.launch.bind(chromium), persistent = chromium.launchPersistentContext.bind(chromium);
chromium.launch = async (...args) => wrapBrowser(await launch(...args));
chromium.launchPersistentContext = async (...args) => wrapContext(await persistent(...args));
