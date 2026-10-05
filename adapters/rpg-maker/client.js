/* Browser presentation-only adapter. No core import, Simulation or step here. */
(() => {
  'use strict';
  const PROTOCOL = 'yunshan-worker-v1';
  const copy = value => structuredClone(value);
  class WorkerCityError extends Error {
    constructor(code, message, details = {}) { super(message); this.name = 'WorkerCityError'; this.code = code; Object.assign(this, details); }
  }
  class WorkerCityClient {
    #worker; #epoch; #nextId = 1; #sequence = 0; #queue = []; #inFlight = null;
    #maxPending; #closed = false; #closing = false; #stopPromise = null;
    #idleWaiters = []; #metadata = null; #generation = 0; #appliedSequence = 0;
    #world = null; #worldGeneration = 0; #worldRequest = null;
    constructor({ workerUrl, coreUrl, options = {}, maxPendingRequests = 32, workerFactory } = {}) {
      if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 2 || maxPendingRequests > 256)
        throw new WorkerCityError('INVALID_CAPACITY', 'Request capacity must be 2..256.');
      if (typeof workerUrl !== 'string' || typeof coreUrl !== 'string')
        throw new WorkerCityError('INVALID_URL', 'Explicit worker and frozen core URLs are required.');
      this.#epoch = globalThis.crypto.randomUUID(); this.#maxPending = maxPendingRequests;
      this.#worker = workerFactory ? workerFactory(workerUrl) : new Worker(workerUrl);
      this.#worker.addEventListener('message', event => this.#receive(event.data));
      this.#worker.addEventListener('error', event => this.#fail(new WorkerCityError('WORKER_FAILED', event.message ?? 'Worker failed.', { uncertain: true })));
      this.#worker.addEventListener('messageerror', () => this.#fail(new WorkerCityError('MESSAGE_FAILED', 'Worker reply could not be cloned.', { uncertain: true })));
      this.ready = this.enqueue('create', [{ coreUrl, options }]).promise.then(reply => {
        this.#metadata = copy(reply.value.metadata); return copy(reply.value);
      });
    }
    get metadata() { if (!this.#metadata) throw new WorkerCityError('NOT_READY', 'Await client.ready.'); return copy(this.#metadata); }
    get status() { return { epoch: this.#epoch, generation: this.#generation,
      appliedSequence: this.#appliedSequence, queued: this.#queue.length,
      inFlight: this.#inFlight?.requestId ?? null, closing: this.#closing, closed: this.#closed }; }
    enqueue(method, args = []) {
      if (this.#closed || this.#closing) throw new WorkerCityError('WORKER_STOPPED', 'The worker is closing or stopped.');
      if (typeof method !== 'string' || !method.length || method.length > 64 || !Array.isArray(args))
        throw new WorkerCityError('INVALID_REQUEST', 'A method string and argument array are required.');
      if (this.#queue.length + (this.#inFlight ? 1 : 0) >= this.#maxPending)
        throw new WorkerCityError('REQUEST_BACKPRESSURE', 'Await existing requests before submitting more.');
      return this.#submit(method, args);
    }
    #submit(method, args) {
      // Clone before queue acceptance: caller edits cannot change later input.
      const cloned = copy(args), requestId = `${this.#epoch}:${this.#nextId++}`;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const entry = { requestId, method, args: cloned, state: 'queued', resolve, reject };
      this.#queue.push(entry); this.#pump();
      return { requestId, promise, cancel: () => this.cancel(requestId) };
    }
    cancel(requestId) {
      const index = this.#queue.findIndex(entry => entry.requestId === requestId);
      if (index < 0) return false; // Sent is irreversible even before its ack.
      const [entry] = this.#queue.splice(index, 1); entry.state = 'cancelled';
      entry.reject(new WorkerCityError('REQUEST_CANCELLED', 'Unsent request cancelled.', { requestId, accepted: false, uncertain: false }));
      this.#idle(); return true;
    }
    #pump() {
      if (this.#inFlight || this.#closed || !this.#queue.length) { this.#idle(); return; }
      const entry = this.#queue.shift(); entry.state = 'sent'; entry.sequence = ++this.#sequence;
      this.#inFlight = entry;
      try { this.#worker.postMessage({ protocol: PROTOCOL, kind: 'request', epoch: this.#epoch,
        requestId: entry.requestId, sequence: entry.sequence, method: entry.method, args: entry.args }); }
      catch (error) { this.#fail(new WorkerCityError('SEND_FAILED', error.message, { uncertain: true })); }
    }
    #receive(message) {
      const entry = this.#inFlight;
      if (!message || message.protocol !== PROTOCOL || message.epoch !== this.#epoch
        || !entry || message.requestId !== entry.requestId || message.sequence !== entry.sequence) {
        this.#fail(new WorkerCityError('INVALID_REPLY', 'Worker reply is stale, duplicate or out of order.', { uncertain: true })); return;
      }
      if (message.kind === 'accepted') {
        if (entry.state !== 'sent') { this.#fail(new WorkerCityError('DUPLICATE_ACK', 'Duplicate request acknowledgement.', { uncertain: true })); return; }
        entry.state = 'accepted'; return;
      }
      if (message.kind !== 'result' && message.kind !== 'rejected'
        || message.kind === 'result' && entry.state !== 'accepted') {
        this.#fail(new WorkerCityError('INVALID_REPLY', 'A terminal result requires exactly one acknowledgement.', { uncertain: true })); return;
      }
      this.#inFlight = null;
      // Even a failed call can have partially changed the core. Never keep an
      // earlier sample marked current after any terminal response.
      this.#appliedSequence = message.sequence;
      if (message.kind === 'rejected' || !message.ok) {
        entry.reject(new WorkerCityError(message.error?.code ?? 'CORE_ERROR', message.error?.message ?? 'Request failed.',
          { requestId: entry.requestId, accepted: message.kind !== 'rejected', uncertain: message.error?.retrySafe === false }));
      } else {
        this.#generation = message.generation; this.#appliedSequence = message.sequence;
        if (entry.method === 'importSave' && message.value.ok) { this.#world = null; this.#worldGeneration = 0; this.#metadata = null; }
        if (entry.method === 'metadata') this.#metadata = copy(message.value);
        entry.resolve(copy(message));
      }
      this.#pump();
    }
    #idle() { if (!this.#inFlight && !this.#queue.length) for (const resolve of this.#idleWaiters.splice(0)) resolve(); }
    #waitIdle() { return !this.#inFlight && !this.#queue.length ? Promise.resolve() : new Promise(resolve => this.#idleWaiters.push(resolve)); }
    #fail(error) {
      if (this.#closed) return;
      this.#closed = true;
      if (this.#inFlight) this.#inFlight.reject(new WorkerCityError(error.code, error.message,
        { requestId: this.#inFlight.requestId, accepted: this.#inFlight.state === 'accepted', uncertain: true }));
      this.#inFlight = null;
      for (const entry of this.#queue.splice(0)) entry.reject(new WorkerCityError(error.code, error.message,
        { requestId: entry.requestId, accepted: false, uncertain: false }));
      this.#worker.terminate(); this.#idle();
    }
    async #call(method, args = []) {
      // Capture at the public call boundary, before ready yields a microtask.
      const cloned = copy(args); await this.ready; return this.enqueue(method, cloned).promise;
    }
    async queueCommand(command, commandId) { return (await this.#call('queueCommand', [command, commandId])).value; }
    async advance(realSeconds, input = { x: 0, z: 0 }) { return (await this.#call('advance', [realSeconds, input])).value; }
    async drainResults() { return (await this.#call('drainResults')).value; }
    async exportSave() { return (await this.#call('exportSave')).value; }
    async exportCoreSave() { return (await this.#call('exportCoreSave')).value; }
    async importSave(save) {
      const reply = await this.#call('importSave', [save]);
      if (reply.value.ok) { this.#world = null; this.#worldGeneration = 0; this.#metadata = (await this.#call('metadata')).value; }
      return reply.value;
    }
    async worldSnapshot() {
      await this.ready;
      // A cached read must not jump over a previously submitted load. Await
      // the actual FIFO barrier before choosing a generation or pending read.
      await this.#waitIdle();
      if (this.#world && this.#worldGeneration === this.#generation) return copy(this.#world);
      if (this.#worldRequest && this.#worldRequest.generation === this.#generation)
        return copy((await this.#worldRequest.promise).value);
      const pending = { generation: this.#generation, promise: this.#call('worldSnapshot') };
      this.#worldRequest = pending;
      try {
        const reply = await pending.promise;
        if (reply.generation === this.#generation) { this.#world = reply.value; this.#worldGeneration = reply.generation; }
        return copy(reply.value);
      } finally { if (this.#worldRequest === pending) this.#worldRequest = null; }
    }
    async sample(name = 'snapshot', ...args) {
      const reply = await this.#call('query', [name, ...args]);
      return { value: reply.value, stamp: { epoch: reply.epoch, generation: reply.generation, sequence: reply.sequence } };
    }
    isCurrentSample(sample) { return sample?.stamp?.epoch === this.#epoch && sample.stamp.generation === this.#generation
      && sample.stamp.sequence === this.#appliedSequence && !this.#closed; }
    async useDoor(buildingId) { return (await this.#call('useDoor', [buildingId])).value; }
    async useStairs() { return (await this.#call('useStairs')).value; }
    async driveInput(throttle, turn, brake) { return (await this.#call('driveInput', [throttle, turn, brake])).value; }
    async aircraftInput(input) { return (await this.#call('aircraftInput', [input])).value; }
    stop() {
      if (this.#stopPromise) return this.#stopPromise;
      this.#closing = true;
      this.#stopPromise = (async () => {
        await this.ready; await this.#waitIdle();
        if (this.#closed) throw new WorkerCityError('WORKER_STOPPED', 'Worker failed before graceful shutdown.', { uncertain: true });
        const reply = await this.#submit('shutdown', []).promise;
        this.#closed = true; this.#worker.terminate(); return reply.value;
      })();
      return this.#stopPromise;
    }
    abort(reason = 'Host forcibly stopped the worker.') {
      const unknown = this.#inFlight ? [this.#inFlight.requestId] : [];
      const unsent = this.#queue.map(entry => entry.requestId);
      this.#fail(new WorkerCityError('WORKER_ABORTED', reason, { uncertain: true }));
      return { uncertainRequestIds: unknown, unsubmittedRequestIds: unsent };
    }
  }
  globalThis.YunshanWorker = Object.freeze({ WorkerCityClient, WorkerCityError,
    createClient: options => new WorkerCityClient(options), protocol: PROTOCOL });
})();
