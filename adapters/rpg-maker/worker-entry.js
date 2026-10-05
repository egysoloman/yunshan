/* Classic DedicatedWorker. Load the unchanged, independently hash-bound
 * YunshanCore.js in this worker only; the presentation never owns Simulation. */
(() => {
  'use strict';
  const PROTOCOL = 'yunshan-worker-v1';
  const CORE_COMMIT = '6785ca7dcca09e8e97afd610cfd52176c7a1cfb1';
  const queries = new Set(['snapshot', 'actorsSnapshot', 'playerLocation', 'floorPlan',
    'canAccessFloor', 'atFunctionPoint', 'walkHeight', 'navigation', 'departures', 'eventsSince']);
  const methods = new Set(['create', 'queueCommand', 'advance', 'drainResults', 'exportSave',
    'exportCoreSave', 'importSave', 'useDoor', 'useStairs', 'driveInput', 'aircraftInput',
    'query', 'worldSnapshot', 'metadata', 'shutdown']);
  let session = null, epoch = null, nextSequence = 1, lastRequestNumber = 0, generation = 0, stopped = false;
  let pendingCommands = 0, undrainedResults = 0, worldSent = false;
  const fault = (code, message) => Object.assign(new Error(message), { code });
  const send = message => self.postMessage({ protocol: PROTOCOL, ...message });
  function counters() {
    const saved = JSON.parse(session.exportSave());
    pendingCommands = saved.commands.length; undrainedResults = saved.results.length;
  }
  function run(method, args) {
    if (!methods.has(method)) throw fault('UNKNOWN_METHOD', 'Only explicit bridge methods are exposed.');
    if (method === 'create') {
      if (session) throw fault('ALREADY_CREATED', 'One worker owns exactly one city session.');
      const config = args[0];
      if (!config || typeof config.coreUrl !== 'string' || !config.coreUrl.length)
        throw fault('INVALID_CREATE', 'A trusted, hash-bound core script URL is required.');
      self.importScripts(config.coreUrl);
      if (!self.YunshanCore || self.YunshanCore.CORE_COMMIT !== CORE_COMMIT
        || self.YunshanCore.BRIDGE_VERSION !== 1)
        throw fault('INCOMPATIBLE_CORE', 'The worker requires the frozen 6785ca7 bridge.');
      session = self.YunshanCore.createSession(config.options ?? {});
      generation = 1; counters();
      const state = session.snapshot();
      return { metadata: session.metadata, actorCount: state.citizens.length,
        tick: state.tick, clock: state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60 };
    }
    if (!session) throw fault('NOT_CREATED', 'Await create before using city APIs.');
    if (method === 'queueCommand') {
      if (pendingCommands + undrainedResults >= 256)
        throw fault('RESULT_BACKPRESSURE', 'Drain command results before accepting more commands.');
      const id = session.queueCommand(...args); pendingCommands++; return id;
    }
    if (method === 'advance') {
      // The original bridge trims results above 256. Never execute accepted
      // pending commands when that would discard an unclaimed result.
      if (pendingCommands && pendingCommands + undrainedResults > 256)
        throw fault('RESULT_BACKPRESSURE', 'Drain restored results before flushing pending commands.');
      const frame = session.advance(...args);
      undrainedResults += pendingCommands; pendingCommands = 0; return frame;
    }
    if (method === 'drainResults') {
      const results = session.drainResults(); undrainedResults = 0; return results;
    }
    if (method === 'importSave') {
      // Original import validates a candidate completely before replacing the
      // current session; an ok:false result never clears its queues or clock.
      const result = session.importSave(...args);
      if (result.ok) { generation++; worldSent = false; counters(); }
      return result;
    }
    if (method === 'query') {
      const [name, ...queryArgs] = args;
      if (!queries.has(name)) throw fault('UNKNOWN_QUERY', 'Only explicit read APIs are exposed.');
      return session[name](...queryArgs);
    }
    if (method === 'worldSnapshot') {
      if (worldSent) throw fault('WORLD_ALREADY_SENT', 'Keep the world copy once per loaded city generation.');
      const world = session.worldSnapshot(); worldSent = true; return world;
    }
    if (method === 'metadata') return session.metadata;
    if (method === 'shutdown') {
      const save = session.exportSave(); stopped = true;
      return { save, pendingCommands, undrainedResults,
        note: 'Queued core commands are preserved in this save; shutdown does not execute them.' };
    }
    return session[method](...args);
  }
  self.addEventListener('message', event => {
    const request = event.data;
    const prefix = `${request?.epoch}:`, tail = typeof request?.requestId === 'string' ? request.requestId.slice(prefix.length) : '';
    const requestNumber = Number(tail);
    const valid = request && request.protocol === PROTOCOL && request.kind === 'request'
      && typeof request.epoch === 'string' && request.epoch.length > 0 && request.epoch.length <= 128
      && typeof request.requestId === 'string' && request.requestId.length > 0 && request.requestId.length <= 128
      && Number.isSafeInteger(request.sequence) && request.sequence === nextSequence
      && typeof request.method === 'string' && request.method.length > 0 && request.method.length <= 64 && Array.isArray(request.args)
      && request.requestId.startsWith(prefix) && Number.isSafeInteger(requestNumber)
      && requestNumber > lastRequestNumber && String(requestNumber) === tail
      && (!epoch || request.epoch === epoch) && !stopped;
    if (!valid) {
      send({ kind: 'rejected', requestId: request?.requestId, sequence: request?.sequence,
        epoch, generation, accepted: false, error: { code: 'INVALID_PROTOCOL', message: 'Invalid, duplicate, stopped or out-of-order worker request.' } });
      return;
    }
    epoch ??= request.epoch; nextSequence++; lastRequestNumber = requestNumber;
    const stamp = { requestId: request.requestId, sequence: request.sequence, epoch };
    send({ ...stamp, kind: 'accepted', generation });
    try {
      const value = run(request.method, request.args);
      send({ ...stamp, kind: 'result', generation, ok: true, value });
    } catch (error) {
      // An unexpected core throw can have partially run business logic. Report
      // failure without retrying it, and re-read real queue counts for recovery.
      if (session) { try { counters(); } catch (_) { /* preserve original fault */ } }
      send({ ...stamp, kind: 'result', generation, ok: false,
        error: { code: error?.code ?? 'CORE_ERROR', message: error instanceof Error ? error.message : String(error), retrySafe: false } });
    }
    if (stopped) self.close();
  });
})();
