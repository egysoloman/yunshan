import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appendCivicHistory, createCivicHistory, decodeCivicHistory, civicHistorySha256, CIVIC_HISTORY_PAGE_BYTES } from '../src/simulation/civic-history';
const raw = readFileSync(new URL('./fixtures/civic-history/root13-four-day.save.json', import.meta.url), 'utf8');
const document = JSON.parse(raw), civic = document.state.civicStaffing, at = document.state.extension.lastUpdate, tick = document.state.tick;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function opening() {
  return createCivicHistory(civic.enablement.id, document.motionVersion, at, tick, { sourceSave: { version: 3, sha256: hash(raw) },
    sourceCounts: { proofs: civic.proofs.length, applications: civic.applications.length, polls: civic.polls.length, terms: civic.terms.length,
      retiredProofCount: civic.retiredProofCount, nextProofId: civic.nextProofId, nextApplicationId: civic.nextApplicationId, nextPollId: civic.nextPollId, nextTermId: civic.nextTermId } });
}
function actualClosedRows() {
  const polls = civic.polls.filter((poll: any) => poll.result !== 'open'), pollIds = new Set(polls.map((poll: any) => poll.id));
  const applications = civic.applications.filter((row: any) => row.cancelledAt !== null || row.receipt && pollIds.has(row.pollId));
  const proofIds = new Set(applications.map((row: any) => row.proofId));
  return { proofs: civic.proofs.filter((row: any) => proofIds.has(row.id)), applications, polls, terms: [] };
}
test('history UTF8 digest matches native SHA for multiblock Unicode without runtime module imports', () => {
  for (const text of ['', 'abc', '云山🙂', '工资\n🙂'.repeat(512)]) assert.equal(civicHistorySha256(text), hash(text));
});
test('actual four-day raw58/58/13 retains every fee/census/window byte in bounded immutable pages', () => {
  const rows = actualClosedRows(), history = appendCivicHistory(opening(), rows, at, tick), decoded = decodeCivicHistory(history, civic.enablement.id, at, tick);
  assert.deepEqual([history.totals.proofs, history.totals.applications, history.totals.polls, history.totals.terms], [58, 58, 13, 0]);
  for (const kind of ['proofs', 'applications', 'polls', 'terms'] as const) assert.equal(JSON.stringify(decoded[kind]), JSON.stringify(rows[kind]));
  assert.equal(history.totals.utf8Bytes, Buffer.byteLength(JSON.stringify(history)));
  for (const descriptor of history.pageDescriptors) assert.ok(descriptor.bytes <= CIVIC_HISTORY_PAGE_BYTES);
  assert.ok(Object.isFrozen(history) && Object.isFrozen(history.pages[0].fragments) && Object.isFrozen(decoded.applications[0].windows));
  const before = JSON.stringify(history); assert.throws(() => appendCivicHistory(history, rows, at, tick), /duplicate/); assert.equal(JSON.stringify(history), before);
});
test('transport splits large Unicode raw records losslessly and rejects absent/duplicate/changed parts and indexes', () => {
  // This extra payload tests transport only; it is not a valid civic business record.
  const record = { ...actualClosedRows().polls[0], id: 'civic-poll-999', transportOnly: '档案🙂\\"\n'.repeat(70_000) };
  const history = appendCivicHistory(opening(), { polls: [record] }, at, tick);
  assert.ok(history.index.polls[0].parts.length > 1);
  assert.equal(JSON.stringify(decodeCivicHistory(history, civic.enablement.id, at, tick).polls[0]), JSON.stringify(record));
  const changes: [string, (h: any) => void][] = [
    ['missing page', h => h.pages.pop()], ['duplicate page', h => h.pages.push(h.pages[0])],
    ['missing fragment', h => h.pages[0].fragments.pop()], ['changed fragment', h => h.pages[0].fragments[0].jsonPart += ' '],
    ['wrong record bytes', h => h.pages[0].fragments[0].recordBytes++], ['wrong index', h => h.index.polls[0].parts[0].fragmentIndex++],
    ['wrong descriptor', h => h.pageDescriptors[0].bytes++], ['fake total', h => h.totals.polls--], ['broken chain', h => h.pages[1].previousSha256 = '0'.repeat(64)],
    ['unknown storage policy', h => h.policyId = 'more-cap'], ['unknown page field', h => h.pages[0].summary = true],
  ];
  for (const [label, change] of changes) { const bad = structuredClone(history); change(bad); assert.throws(() => decodeCivicHistory(bad, civic.enablement.id, at, tick), /civic history/, label); }
});
test('finite archive quota rejects a complete oversized record atomically rather than truncating paid history', () => {
  const history = opening(), before = JSON.stringify(history);
  const record = { ...actualClosedRows().proofs[0], transportOnly: '汉'.repeat(6 * 1024 * 1024) };
  assert.throws(() => appendCivicHistory(history, { proofs: [record] }, at, tick), /storage backpressure/);
  assert.equal(JSON.stringify(history), before);
});
