import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assembleSave, partitionSave } from './source/src/persistence/partition.ts';
// Pure partition encoding of already completed immutable Simulation results.
// No Simulation imports/construction/commands/steps, no business mutation.
const base = new URL('.', import.meta.url);
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const world = JSON.parse(readFileSync(new URL('inherited-originals/origins/world.json', base), 'utf8'));
const records = [];
for (const filename of ['complete-one-patient.save.json', 'complete-one-patient.after24.save.json']) {
  const raw = readFileSync(new URL(`actual01/artifacts/${filename}`, base), 'utf8');
  const parts = partitionSave(raw, world);
  assert.equal(parts.length, 44);
  const directory = new URL(`persisted-parts/${filename}/`, base); mkdirSync(directory, { recursive: true });
  const files = parts.map((part, index) => {
    const name = `part-${String(index).padStart(3, '0')}.json`, bytes = JSON.stringify(part);
    writeFileSync(new URL(name, directory), bytes);
    return { name, bytes: Buffer.byteLength(bytes), sha256: sha(bytes) };
  });
  const readback = files.map(file => JSON.parse(readFileSync(new URL(file.name, directory), 'utf8')));
  const assembled = assembleSave(readback); assert.equal(assembled, raw);
  writeFileSync(new URL('assembled.save.json', directory), assembled);
  records.push({ filename, fullSHA256: sha(raw), parts: parts.length, files, assembledReadbackSHA256: sha(assembled), exact: true });
}
writeFileSync(new URL('PARTITION-DISK-READBACK.json', base), JSON.stringify({ status: 'PASS', zeroSimulationSteps: 0, scope: 'Pure actual completed source and actual future24 output partition files write/read/assemble exact; does not repeat or extend medical Simulation.', records }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS', zeroSimulationSteps: 0, records: records.map(({ files, ...rest }) => rest) }));
