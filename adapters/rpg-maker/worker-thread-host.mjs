// TEST HOST ONLY: Node worker_threads stands in for a DedicatedWorker transport.
// It executes the actual classic worker entry and the unchanged browser IIFE.
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let listener = null, loaded = false;
const context = vm.createContext({ TextEncoder, TextDecoder });
context.self = context;
context.postMessage = message => parentPort.postMessage(message);
context.close = () => parentPort.close();
context.addEventListener = (name, handler) => {
  assert.equal(name, 'message'); assert.equal(listener, null); listener = handler;
};
context.importScripts = url => {
  assert.equal(loaded, false, 'the worker loads exactly one core script');
  assert.equal(fileURLToPath(url), workerData.bundlePath);
  const bytes = readFileSync(workerData.bundlePath);
  assert.equal(sha(bytes), 'b376c8480b707ef51f109e52b3c2469e41e6d132e217f080423df51b16cee2db');
  // Only VM-own standard intrinsics; no host game objects or replacement core.
  vm.runInContext('const Math = globalThis.Math, JSON = globalThis.JSON;\n' + bytes.toString('utf8'), context);
  loaded = true;
  for (const forbidden of ['window', 'document', 'THREE', 'PIXI', 'require', 'process', '$gameMap'])
    assert.equal(forbidden in context, false);
};
vm.runInContext(readFileSync(workerData.entryPath, 'utf8'), context, { filename: workerData.entryPath });
parentPort.on('message', message => listener({ data: message }));
