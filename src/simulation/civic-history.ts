import type { CivicApplication, CivicPoll, CivicStaffingState, CivicTerm, CivicWorkProof } from './civic-staffing';

/** Storage policy only: the civic rule and its semantic validator remain unchanged. */
export const CIVIC_HISTORY_POLICY = 'civic-history-pages-v1' as const;
export const CIVIC_HISTORY_PAGE_BYTES = 256 * 1024;
export const CIVIC_HISTORY_BYTES = 16 * 1024 * 1024;
export const CIVIC_HISTORY_MAX_PAGES = 256;
export const CIVIC_HISTORY_MAX_RECORD_PARTS = 256;
export const CIVIC_HISTORY_MAX_RECORDS = 100_000;
const RECORD_DEPTH = 24, RECORD_NODES = 2_000_000;
const encoder = new TextEncoder();
const kinds = ['proof', 'application', 'poll', 'term'] as const;
const collections = ['proofs', 'applications', 'polls', 'terms'] as const;
export type CivicHistoryKind = typeof kinds[number];
export interface CivicHistorySourceCounts {
  proofs: number; applications: number; polls: number; terms: number; retiredProofCount: number;
  nextProofId: number; nextApplicationId: number; nextPollId: number; nextTermId: number;
}
export interface CivicHistoryUpgradeSource {
  sourceSave: { version: 3; sha256: string }; sourceCounts: CivicHistorySourceCounts;
}
export type CivicHistoryOrigin = {
  kind: 'new-city'; motionVersion: 1 | 2; createdAt: number; createdTick: number;
} | {
  kind: 'host-format-upgrade'; motionVersion: 1 | 2; sourceSave: { version: 3; sha256: string };
  createdAt: number; createdTick: number; sourceCounts: CivicHistorySourceCounts;
};
export interface CivicHistoryFragment {
  kind: CivicHistoryKind; id: string; recordSha256: string; recordBytes: number;
  partIndex: number; partCount: number; jsonPart: string;
}
export interface CivicHistoryPage {
  id: string; sequence: number; historyId: string; enablementId: string;
  sealedAt: number; sealedTick: number; previousSha256: string | null;
  fragments: CivicHistoryFragment[]; sha256: string;
}
export interface CivicHistoryPageDescriptor { id: string; sha256: string; bytes: number; fragmentCount: number }
export interface CivicHistoryPartLocation { pageId: string; fragmentIndex: number }
export interface CivicHistoryIndexEntry {
  id: string; recordSha256: string; recordBytes: number; parts: CivicHistoryPartLocation[];
}
export interface CivicHistoryIndex {
  proofs: CivicHistoryIndexEntry[]; applications: CivicHistoryIndexEntry[];
  polls: CivicHistoryIndexEntry[]; terms: CivicHistoryIndexEntry[];
}
export interface CivicHistoryTotals { proofs: number; applications: number; polls: number; terms: number; utf8Bytes: number }
export interface CivicHistoryState {
  version: 1; id: string; policyId: typeof CIVIC_HISTORY_POLICY; enablementId: string;
  origin: CivicHistoryOrigin; nextPageId: number; totals: CivicHistoryTotals;
  index: CivicHistoryIndex; pageDescriptors: CivicHistoryPageDescriptor[]; pages: CivicHistoryPage[];
}
export interface CivicHistoryRecords {
  proofs: CivicWorkProof[]; applications: CivicApplication[]; polls: CivicPoll[]; terms: CivicTerm[];
}
export interface CivicHistoryAppendRecords {
  proofs?: readonly CivicWorkProof[]; applications?: readonly CivicApplication[];
  polls?: readonly CivicPoll[]; terms?: readonly CivicTerm[];
}

const immutableDecoded = new WeakMap<CivicHistoryState, CivicHistoryRecords>();
function need(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`civic history ${label}`);
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
/** Exact own, enumerable data properties: getters and invisible fields cannot evade hashing. */
function shape(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  need(object(value), label);
  const actual = Reflect.ownKeys(value);
  need(actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key)), label);
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    need(descriptor.enumerable && 'value' in descriptor, `${label} data properties`);
  }
}
function array(value: unknown, maximum: number, label: string): asserts value is unknown[] {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum, label);
  const keys = Reflect.ownKeys(value);
  need(keys.length === value.length + 1, `${label} dense own array`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    need(descriptor && descriptor.enumerable && 'value' in descriptor, `${label} data elements`);
  }
}
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => uint(value) && value > 0;
const clock = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const byteLength = (value: string) => encoder.encode(value).length;
function recordNumber(id: unknown, kind: CivicHistoryKind): number {
  need(typeof id === 'string' && new RegExp(`^civic-${kind}-[1-9][0-9]*$`).test(id), `${kind} record identity`);
  const number = Number(id.slice(`civic-${kind}-`.length));
  need(positive(number), `${kind} safe record identity`);
  return number;
}
function collection(kind: CivicHistoryKind): typeof collections[number] {
  return collections[kinds.indexOf(kind)];
}
function emptyRecords(): CivicHistoryRecords { return { proofs: [], applications: [], polls: [], terms: [] }; }
function emptyIndex(): CivicHistoryIndex { return { proofs: [], applications: [], polls: [], terms: [] }; }
function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
/** Mirrors the original record resource boundary without adding an aggregate archive node cap. */
function finiteJson(value: unknown): void {
  type Frame = { value: unknown; depth: number; leave?: boolean };
  const stack: Frame[] = [{ value, depth: 0 }], ancestors = new Set<object>();
  let nodes = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.leave) { ancestors.delete(frame.value as object); continue; }
    need(++nodes <= RECORD_NODES && frame.depth <= RECORD_DEPTH, 'record JSON complexity');
    const current = frame.value;
    if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
    if (typeof current === 'number') { need(Number.isFinite(current), 'finite record JSON number'); continue; }
    need(current && typeof current === 'object' && !ancestors.has(current), 'plain acyclic record JSON');
    if (Array.isArray(current)) array(current, RECORD_NODES, 'record JSON array');
    else need(object(current), 'plain record JSON object');
    ancestors.add(current);
    stack.push({ value: current, depth: frame.depth, leave: true });
    for (const key of Reflect.ownKeys(current)) {
      if (Array.isArray(current) && key === 'length') continue;
      need(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key), 'safe record JSON key');
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
      need(descriptor.enumerable && 'value' in descriptor, 'record JSON data properties');
      stack.push({ value: descriptor.value, depth: frame.depth + 1 });
    }
  }
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ('value' in descriptor) deepFreeze(descriptor.value);
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
function deeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return 'value' in descriptor && deeplyFrozen(descriptor.value);
  });
}

/** Local synchronous SHA-256 keeps the storage codec independent of budget/runtime modules. */
export function civicHistorySha256(text: string): string {
  const bytes = encoder.encode(text), length = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(length); buffer.set(bytes); buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer); view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], w = new Uint32Array(64);
  const rotate = (n: number, bits: number) => n >>> bits | n << (32 - bits);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = w[i - 16] + (rotate(a,7) ^ rotate(a,18) ^ a >>> 3) + w[i - 7] + (rotate(b,17) ^ rotate(b,19) ^ b >>> 10); }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) { const t1 = (j + (rotate(e,6) ^ rotate(e,11) ^ rotate(e,25)) + (e & f ^ ~e & g) + k[i] + w[i]) >>> 0, t2 = ((rotate(a,2) ^ rotate(a,13) ^ rotate(a,22)) + (a & b ^ a & c ^ b & c)) >>> 0; j = g; g = f; f = e; e = d + t1 >>> 0; d = c; c = b; b = a; a = t1 + t2 >>> 0; }
    for (const [i,n] of [a,b,c,d,e,f,g,j].entries()) h[i] = h[i] + n >>> 0;
  }
  return h.map(n => n.toString(16).padStart(8, '0')).join('');
}

function canonicalFragment(fragment: CivicHistoryFragment): CivicHistoryFragment {
  return { kind: fragment.kind, id: fragment.id, recordSha256: fragment.recordSha256, recordBytes: fragment.recordBytes,
    partIndex: fragment.partIndex, partCount: fragment.partCount, jsonPart: fragment.jsonPart };
}
function pagePayload(page: Omit<CivicHistoryPage, 'sha256'>): Omit<CivicHistoryPage, 'sha256'> {
  return { id: page.id, sequence: page.sequence, historyId: page.historyId, enablementId: page.enablementId,
    sealedAt: page.sealedAt, sealedTick: page.sealedTick, previousSha256: page.previousSha256,
    fragments: page.fragments.map(canonicalFragment) };
}
function pageBytes(page: CivicHistoryPage): number {
  return byteLength(JSON.stringify({ ...pagePayload(page), sha256: page.sha256 }));
}
function sealedPage(payload: Omit<CivicHistoryPage, 'sha256'>): CivicHistoryPage {
  const canonical = pagePayload(payload);
  return { ...canonical, sha256: civicHistorySha256(JSON.stringify(canonical)) };
}
const sourceCountKeys = ['proofs', 'applications', 'polls', 'terms', 'retiredProofCount', 'nextProofId', 'nextApplicationId', 'nextPollId', 'nextTermId'] as const;
function validateSource(source: CivicHistoryUpgradeSource): void {
  shape(source, ['sourceSave', 'sourceCounts'], 'upgrade source shape');
  shape(source.sourceSave, ['version', 'sha256'], 'upgrade source save shape');
  need(source.sourceSave.version === 3 && sha(source.sourceSave.sha256), 'upgrade version-three source digest');
  shape(source.sourceCounts, sourceCountKeys, 'upgrade source counts shape');
  for (const name of sourceCountKeys) need(uint(source.sourceCounts[name]), `upgrade ${name}`);
  const counts = source.sourceCounts;
  need(positive(counts.nextProofId) && positive(counts.nextApplicationId) && positive(counts.nextPollId) && positive(counts.nextTermId), 'upgrade source next counters');
  need(counts.nextProofId - 1 === counts.proofs + counts.retiredProofCount
    && counts.nextApplicationId - 1 === counts.applications && counts.nextPollId - 1 === counts.polls
    && counts.nextTermId - 1 === counts.terms, 'upgrade source count identities');
}
function validateOrigin(origin: CivicHistoryOrigin, at: number, tick: number): void {
  need(object(origin) && (origin.kind === 'new-city' || origin.kind === 'host-format-upgrade'), 'origin kind');
  shape(origin, origin.kind === 'new-city' ? ['kind', 'motionVersion', 'createdAt', 'createdTick']
    : ['kind', 'motionVersion', 'sourceSave', 'createdAt', 'createdTick', 'sourceCounts'], 'origin shape');
  need([1, 2].includes(origin.motionVersion) && clock(origin.createdAt) && uint(origin.createdTick)
    && origin.createdAt <= at && origin.createdTick <= tick, 'origin motion and creation time');
  if (origin.kind === 'host-format-upgrade') validateSource({ sourceSave: origin.sourceSave, sourceCounts: origin.sourceCounts });
}
function validateIndex(index: CivicHistoryIndex): void {
  shape(index, collections, 'index shape');
  for (let i = 0; i < collections.length; i++) {
    const name = collections[i], entries = index[name], kind = kinds[i];
    array(entries, CIVIC_HISTORY_MAX_RECORDS, `${name} index`);
    let previous = 0;
    for (const entry of entries) {
      shape(entry, ['id', 'recordSha256', 'recordBytes', 'parts'], 'index entry shape');
      const number = recordNumber(entry.id, kind);
      need(number > previous && sha(entry.recordSha256) && positive(entry.recordBytes) && entry.recordBytes <= CIVIC_HISTORY_BYTES, 'ordered unique index records');
      previous = number;
      array(entry.parts, CIVIC_HISTORY_MAX_RECORD_PARTS, 'index parts');
      need(entry.parts.length > 0, 'nonempty index parts');
      for (const part of entry.parts) {
        shape(part, ['pageId', 'fragmentIndex'], 'index part shape');
        need(typeof part.pageId === 'string' && /^civic-history-page-[1-9][0-9]*$/.test(part.pageId)
          && uint(part.fragmentIndex), 'index part location');
      }
    }
  }
}
function sameIndex(actual: CivicHistoryIndex, expected: CivicHistoryIndex): boolean {
  return collections.every(name => actual[name].length === expected[name].length && actual[name].every((entry, i) => {
    const wanted = expected[name][i];
    return entry.id === wanted.id && entry.recordSha256 === wanted.recordSha256 && entry.recordBytes === wanted.recordBytes
      && entry.parts.length === wanted.parts.length && entry.parts.every((part, j) =>
        part.pageId === wanted.parts[j].pageId && part.fragmentIndex === wanted.parts[j].fragmentIndex);
  }));
}

/** Integrity and JSON structure only. Call the existing civic semantic validator on the merged view. */
export function decodeCivicHistory(history: CivicHistoryState, enablementId: string, at: number, tick: number): CivicHistoryRecords {
  need(clock(at) && uint(tick), 'decode clock and tick');
  shape(history, ['version', 'id', 'policyId', 'enablementId', 'origin', 'nextPageId', 'totals', 'index', 'pageDescriptors', 'pages'], 'body shape');
  need(typeof enablementId === 'string' && enablementId.length > 0 && history.version === 1
    && history.policyId === CIVIC_HISTORY_POLICY && history.enablementId === enablementId
    && history.id === `civic-history-${enablementId}`, 'body identity and policy');
  validateOrigin(history.origin, at, tick);
  array(history.pages, CIVIC_HISTORY_MAX_PAGES, 'pages');
  array(history.pageDescriptors, CIVIC_HISTORY_MAX_PAGES, 'page descriptors');
  need(history.nextPageId === history.pages.length + 1 && history.pageDescriptors.length === history.pages.length, 'page counter and descriptors');
  shape(history.totals, [...collections, 'utf8Bytes'], 'totals shape');
  for (const name of collections) need(uint(history.totals[name]), `${name} total`);
  need(positive(history.totals.utf8Bytes) && history.totals.utf8Bytes <= CIVIC_HISTORY_BYTES, 'history byte budget');
  validateIndex(history.index);
  const records = emptyRecords(), index = emptyIndex(), seen = new Set<string>();
  let previousHash: string | null = null, previousAt = history.origin.createdAt, previousTick = history.origin.createdTick;
  let active: { kind: CivicHistoryKind; id: string; recordSha256: string; recordBytes: number; partCount: number;
    jsonParts: string[]; bytes: number; locations: CivicHistoryPartLocation[] } | undefined;
  for (let pageIndex = 0; pageIndex < history.pages.length; pageIndex++) {
    const page = history.pages[pageIndex], sequence = pageIndex + 1;
    shape(page, ['id', 'sequence', 'historyId', 'enablementId', 'sealedAt', 'sealedTick', 'previousSha256', 'fragments', 'sha256'], 'page shape');
    need(page.sequence === sequence && page.id === `civic-history-page-${sequence}` && page.historyId === history.id
      && page.enablementId === enablementId && page.previousSha256 === previousHash && sha(page.sha256), 'page identity and chain');
    need(clock(page.sealedAt) && uint(page.sealedTick) && page.sealedAt >= previousAt && page.sealedTick >= previousTick
      && page.sealedAt <= at && page.sealedTick <= tick, 'page monotonic seal time');
    array(page.fragments, CIVIC_HISTORY_PAGE_BYTES, 'page fragments');
    need(page.fragments.length > 0, 'nonempty sealed page');
    const descriptor = history.pageDescriptors[pageIndex];
    shape(descriptor, ['id', 'sha256', 'bytes', 'fragmentCount'], 'page descriptor shape');
    for (let fragmentIndex = 0; fragmentIndex < page.fragments.length; fragmentIndex++) {
      const fragment = page.fragments[fragmentIndex];
      shape(fragment, ['kind', 'id', 'recordSha256', 'recordBytes', 'partIndex', 'partCount', 'jsonPart'], 'fragment shape');
      need(kinds.includes(fragment.kind), 'fragment kind');
      recordNumber(fragment.id, fragment.kind);
      need(sha(fragment.recordSha256) && positive(fragment.recordBytes) && fragment.recordBytes <= CIVIC_HISTORY_BYTES
        && positive(fragment.partCount) && fragment.partCount <= CIVIC_HISTORY_MAX_RECORD_PARTS
        && uint(fragment.partIndex) && fragment.partIndex < fragment.partCount && typeof fragment.jsonPart === 'string'
        && fragment.jsonPart.length > 0 && wellFormed(fragment.jsonPart), 'fragment digest, bytes and UTF-8-safe part');
      if (!active) {
        need(fragment.partIndex === 0 && !seen.has(fragment.id) && seen.size < CIVIC_HISTORY_MAX_RECORDS, 'unique complete record start');
        seen.add(fragment.id);
        active = { kind: fragment.kind, id: fragment.id, recordSha256: fragment.recordSha256, recordBytes: fragment.recordBytes,
          partCount: fragment.partCount, jsonParts: [], bytes: 0, locations: [] };
      }
      need(fragment.kind === active.kind && fragment.id === active.id && fragment.recordSha256 === active.recordSha256
        && fragment.recordBytes === active.recordBytes && fragment.partCount === active.partCount
        && fragment.partIndex === active.jsonParts.length, 'contiguous matching ordered record parts');
      active.jsonParts.push(fragment.jsonPart); active.bytes += byteLength(fragment.jsonPart);
      active.locations.push({ pageId: page.id, fragmentIndex });
      need(active.bytes <= active.recordBytes, 'record fragment byte sum');
      if (active.jsonParts.length === active.partCount) {
        const text = active.jsonParts.join('');
        need(active.bytes === active.recordBytes && civicHistorySha256(text) === active.recordSha256, 'complete record bytes and hash');
        let record: unknown;
        try { record = JSON.parse(text); } catch { throw new Error('civic history complete record JSON'); }
        finiteJson(record);
        need(object(record) && record.id === active.id && JSON.stringify(record) === text, 'complete original record identity and JSON');
        const name = collection(active.kind);
        (records[name] as unknown[]).push(record);
        index[name].push({ id: active.id, recordSha256: active.recordSha256, recordBytes: active.recordBytes, parts: active.locations });
        active = undefined;
      }
    }
    need(civicHistorySha256(JSON.stringify(pagePayload(page))) === page.sha256, 'sealed page hash');
    const bytes = pageBytes(page);
    need(bytes <= CIVIC_HISTORY_PAGE_BYTES && descriptor.id === page.id && descriptor.sha256 === page.sha256
      && descriptor.bytes === bytes && descriptor.fragmentCount === page.fragments.length, 'derived page descriptor and byte budget');
    previousHash = page.sha256; previousAt = page.sealedAt; previousTick = page.sealedTick;
  }
  need(!active, 'all record parts present');
  for (let i = 0; i < collections.length; i++) {
    const name = collections[i], kind = kinds[i];
    records[name].sort((a, b) => recordNumber(a.id, kind) - recordNumber(b.id, kind));
    index[name].sort((a, b) => recordNumber(a.id, kind) - recordNumber(b.id, kind));
    need(history.totals[name] === records[name].length, `${name} derived total`);
  }
  need(sameIndex(history.index, index), 'exact derived full record index');
  // Measure after every own schema is checked, so serialization cannot invoke an accessor.
  // Stored bytes include escaped fragments, indexes, descriptors and the total itself.
  need(byteLength(JSON.stringify(history)) === history.totals.utf8Bytes, 'actual history UTF-8 bytes');
  deepFreeze(records);
  if (deeplyFrozen(history)) immutableDecoded.set(history, records);
  return records;
}

function settleBytes(history: CivicHistoryState): void {
  history.totals.utf8Bytes = 0;
  for (let i = 0; i < 8; i++) {
    const bytes = byteLength(JSON.stringify(history));
    need(bytes <= CIVIC_HISTORY_BYTES, 'archive storage backpressure');
    if (bytes === history.totals.utf8Bytes) return;
    history.totals.utf8Bytes = bytes;
  }
  throw new Error('civic history byte total did not stabilize');
}
export function createCivicHistory(enablementId: string, motionVersion: 1 | 2, createdAt: number, createdTick: number,
  source?: CivicHistoryUpgradeSource): CivicHistoryState {
  if (source !== undefined) validateSource(source);
  const origin: CivicHistoryOrigin = source === undefined
    ? { kind: 'new-city', motionVersion, createdAt, createdTick }
    : { kind: 'host-format-upgrade', motionVersion, sourceSave: { ...source.sourceSave }, createdAt, createdTick,
      sourceCounts: { ...source.sourceCounts } };
  const history: CivicHistoryState = { version: 1, id: `civic-history-${enablementId}`, policyId: CIVIC_HISTORY_POLICY,
    enablementId, origin, nextPageId: 1, totals: { proofs: 0, applications: 0, polls: 0, terms: 0, utf8Bytes: 0 },
    index: emptyIndex(), pageDescriptors: [], pages: [] };
  settleBytes(history);
  return freezeCivicHistory(history, enablementId, createdAt, createdTick);
}

/** Validate before establishing immutability; a boundary decode never skips validation via this cache. */
export function freezeCivicHistory(history: CivicHistoryState, enablementId: string, at: number, tick: number): CivicHistoryState {
  const decoded = decodeCivicHistory(history, enablementId, at, tick);
  deepFreeze(history);
  immutableDecoded.set(history, decoded);
  return history;
}

/** Each part reserves worst-case sequence/part metadata; escaping is measured, never estimated. */
function splitRecord(kind: CivicHistoryKind, id: string, text: string, history: CivicHistoryState, at: number, tick: number): CivicHistoryFragment[] {
  const recordSha256 = civicHistorySha256(text), recordBytes = byteLength(text);
  need(recordBytes <= CIVIC_HISTORY_BYTES, 'record storage backpressure');
  const fragments: CivicHistoryFragment[] = [];
  let offset = 0;
  const fits = (part: string) => {
    const fragment: CivicHistoryFragment = { kind, id, recordSha256, recordBytes,
      partIndex: CIVIC_HISTORY_MAX_RECORD_PARTS - 1, partCount: CIVIC_HISTORY_MAX_RECORD_PARTS, jsonPart: part };
    const page: CivicHistoryPage = { id: `civic-history-page-${CIVIC_HISTORY_MAX_PAGES}`, sequence: CIVIC_HISTORY_MAX_PAGES,
      historyId: history.id, enablementId: history.enablementId, sealedAt: at, sealedTick: tick,
      previousSha256: '0'.repeat(64), fragments: [fragment], sha256: '0'.repeat(64) };
    return pageBytes(page) <= CIVIC_HISTORY_PAGE_BYTES;
  };
  while (offset < text.length) {
    need(fragments.length < CIVIC_HISTORY_MAX_RECORD_PARTS, 'record part storage backpressure');
    let low = offset, high = Math.min(text.length, offset + CIVIC_HISTORY_PAGE_BYTES);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(text.slice(offset, middle))) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < text.length && end > offset && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
      && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
    need(end > offset, 'page metadata storage backpressure');
    fragments.push({ kind, id, recordSha256, recordBytes, partIndex: fragments.length, partCount: 0, jsonPart: text.slice(offset, end) });
    offset = end;
  }
  for (const fragment of fragments) fragment.partCount = fragments.length;
  return fragments;
}

/** Append sealed pages transactionally. Existing objects are neither changed nor frozen by this operation. */
export function appendCivicHistory(history: CivicHistoryState, additions: CivicHistoryAppendRecords, at: number, tick: number): CivicHistoryState {
  const cold = decodeCivicHistory(history, history.enablementId, at, tick);
  need(object(additions), 'append collections');
  shape(additions, Object.keys(additions), 'append collection own shape');
  need(Object.keys(additions).every(key => (collections as readonly string[]).includes(key)), 'append known collections');
  const last = history.pages[history.pages.length - 1];
  need(at >= (last?.sealedAt ?? history.origin.createdAt) && tick >= (last?.sealedTick ?? history.origin.createdTick), 'append monotonic seal time');
  const newFragments: CivicHistoryFragment[] = [];
  let fragmentBytes = 0;
  let recordCount = collections.reduce((sum, name) => sum + cold[name].length, 0);
  for (let i = 0; i < collections.length; i++) {
    const name = collections[i], kind = kinds[i], value: unknown = additions[name];
    if (value === undefined) continue;
    array(value, CIVIC_HISTORY_MAX_RECORDS, `append ${name}`);
    const rows = value as readonly (CivicWorkProof | CivicApplication | CivicPoll | CivicTerm)[];
    const existing = new Set(cold[name].map(row => row.id));
    const sorted = [...rows];
    for (const record of sorted) {
      need(object(record), 'append complete record object');
      const identity = Object.getOwnPropertyDescriptor(record, 'id');
      need(identity && identity.enumerable && 'value' in identity, 'append own record identity');
      const id: unknown = identity.value;
      need(typeof id === 'string', 'append record identity string'); recordNumber(id, kind);
      need(!existing.has(id), 'append duplicate record'); existing.add(id);
      need(++recordCount <= CIVIC_HISTORY_MAX_RECORDS, 'record count storage backpressure');
    }
    sorted.sort((a, b) => recordNumber(a.id, kind) - recordNumber(b.id, kind));
    for (const record of sorted) {
      finiteJson(record);
      const fragments = splitRecord(kind, record.id, JSON.stringify(record), history, at, tick);
      // Fragment bytes alone are a lower bound on the new stored bytes; fail before accumulating unbounded input.
      for (const fragment of fragments) fragmentBytes += byteLength(JSON.stringify(fragment));
      need(history.totals.utf8Bytes + fragmentBytes <= CIVIC_HISTORY_BYTES, 'archive storage backpressure');
      newFragments.push(...fragments);
    }
  }
  // Copy the mutable boundary representation so freezing the result cannot affect its caller.
  const result: CivicHistoryState = JSON.parse(JSON.stringify(history));
  if (newFragments.length === 0) return freezeCivicHistory(result, result.enablementId, at, tick);
  let current: Omit<CivicHistoryPage, 'sha256'> | undefined;
  const open = (): Omit<CivicHistoryPage, 'sha256'> => {
    need(result.pages.length < CIVIC_HISTORY_MAX_PAGES, 'page count storage backpressure');
    const sequence = result.pages.length + 1;
    return { id: `civic-history-page-${sequence}`, sequence, historyId: result.id, enablementId: result.enablementId,
      sealedAt: at, sealedTick: tick, previousSha256: result.pages.at(-1)?.sha256 ?? null, fragments: [] };
  };
  const seal = () => {
    need(current && current.fragments.length > 0, 'append nonempty page');
    const page = sealedPage(current), bytes = pageBytes(page);
    need(bytes <= CIVIC_HISTORY_PAGE_BYTES, 'page storage backpressure');
    result.pages.push(page); result.pageDescriptors.push({ id: page.id, sha256: page.sha256, bytes, fragmentCount: page.fragments.length });
    current = undefined;
  };
  for (const fragment of newFragments) {
    current ??= open();
    const candidate = { ...current, fragments: [...current.fragments, fragment], sha256: '0'.repeat(64) };
    if (pageBytes(candidate) > CIVIC_HISTORY_PAGE_BYTES) { seal(); current = open(); }
    current.fragments.push(fragment);
  }
  if (current) seal();
  result.nextPageId = result.pages.length + 1;
  for (let pageIndex = history.pages.length; pageIndex < result.pages.length; pageIndex++) {
    const page = result.pages[pageIndex];
    for (let fragmentIndex = 0; fragmentIndex < page.fragments.length; fragmentIndex++) {
      const fragment = page.fragments[fragmentIndex], name = collection(fragment.kind);
      if (fragment.partIndex === 0) {
        result.index[name].push({ id: fragment.id, recordSha256: fragment.recordSha256, recordBytes: fragment.recordBytes, parts: [] });
        result.totals[name]++;
      }
      const entry = result.index[name].at(-1)!;
      need(entry.id === fragment.id, 'append part index derivation');
      entry.parts.push({ pageId: page.id, fragmentIndex });
    }
  }
  for (let i = 0; i < collections.length; i++) result.index[collections[i]].sort((a, b) => recordNumber(a.id, kinds[i]) - recordNumber(b.id, kinds[i]));
  settleBytes(result);
  return freezeCivicHistory(result, result.enablementId, at, tick);
}

/** Body1 preserves the original hot array references. Body2 cold rows are immutable. */
export function civicHistoryView(state: { civicStaffing?: CivicStaffingState; civicHistory?: CivicHistoryState }): CivicHistoryRecords {
  const civic = state.civicStaffing, history = state.civicHistory;
  if (!civic) { need(!history, 'history requires civic body'); return emptyRecords(); }
  const body = civic as CivicStaffingState & { historyId?: string };
  if (!history) { need(Number(body.version) === 1, 'body2 requires history');
    return { proofs: civic.proofs, applications: civic.applications, polls: civic.polls, terms: civic.terms }; }
  need(Number(body.version) === 2 && body.historyId === history.id && civic.enablement.id === history.enablementId, 'paired body2 history');
  const last = history.pages.at(-1);
  const cold = immutableDecoded.get(history) ?? decodeCivicHistory(history, civic.enablement.id,
    last?.sealedAt ?? history.origin.createdAt, last?.sealedTick ?? history.origin.createdTick);
  const merged = emptyRecords();
  for (let i = 0; i < collections.length; i++) {
    const name = collections[i], kind = kinds[i], seen = new Set<string>();
    for (const record of [...civic[name], ...cold[name]]) {
      recordNumber(record.id, kind);
      need(!seen.has(record.id), 'hot/cold duplicate record'); seen.add(record.id);
      (merged[name] as unknown[]).push(record);
    }
    merged[name].sort((a, b) => recordNumber(a.id, kind) - recordNumber(b.id, kind));
  }
  return merged;
}
